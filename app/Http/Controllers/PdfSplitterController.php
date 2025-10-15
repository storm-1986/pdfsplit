<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Spatie\PdfToImage\Pdf;
use ZipArchive;
use Imagick;
use Hfig\MAPI\MapiMessageFactory;
use Hfig\MAPI\OLE\Pear\DocumentFactory;

class PdfSplitterController extends Controller
{
    private $bearerToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJQbGF0Zm9ybSBmb3IgZGV2ZWxvcG1lbnQiLCJ1c2VybmFtZSI6Indkb2MiLCJpYXQiOjE3NTg4MDg2ODUsImlzcyI6IlNwcmluZy1Ub29sLVNlcnZlciIsImV4cCI6MTgwMDgwODY4NX0.XkZlJ1brxBv7ltZ7dOYAilsYS4jfaZQ2jT3Ng2XXsMc';

    public function __construct()
    {
        $requiredDirs = [
            storage_path('app/temp_pdfs'),
            storage_path('app/temp_split'),
            storage_path('app/public/temp_thumbs'),
            storage_path('app/public/temp_zips'),
            storage_path('app/temp_msg') // Добавляем временную директорию для MSG
        ];

        foreach ($requiredDirs as $dir) {
            if (!file_exists($dir)) {
                mkdir($dir, 0755, true);
            }
        }
    }

    public function showUploadForm(Request $request)
    {
        $ipAddress = $request->ip();
        $counterparties = $this->getCounterparties($ipAddress);
        return view('index', compact('counterparties'));
    }
    
    private function getCounterparties($ipAddress)
    {
        try {
            $response = Http::withOptions([
                'verify' => false,
            ])->withHeaders([
                'Authorization' => 'Bearer ' . $this->bearerToken,
                'Content-Type' => 'application/json',
            ])->timeout(30)->withBody('{}', 'application/json')->post('https://edi1.savushkin.com:5050/web/docs/clients');
            
            if ($response->successful()) {
                return $response->json();
            }
            
            Log::error($ipAddress . ' Не удалось загрузить контрагентов: ' . $response->status());
            return [];

        } catch (\Exception $e) {
            Log::error($ipAddress . ' Ошибка при загрузке контрагентов: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Общий метод для обработки файлов
     */
    private function processFiles($files, $ipAddress)
    {
        // Если это одиночный файл, превращаем в массив
        if (!is_array($files)) {
            $files = [$files];
        }

        // Валидация для каждого файла
        foreach ($files as $file) {
            $extension = strtolower($file->getClientOriginalExtension());
            if (!in_array($extension, ['pdf', 'msg'])) {
                throw new \Exception('Файл должен быть в формате PDF или MSG');
            }
            
            if ($file->getSize() > 50000000) {
                throw new \Exception('Размер файла не должен превышать 50MB');
            }
        }

        $sessionId = Str::random(20);
        $allDocuments = [];
        $documentIndex = 0;
        
        foreach ($files as $file) {
            if (strtolower($file->getClientOriginalExtension()) === 'msg') {
                $tempDir = 'temp_pdfs/' . $sessionId;
                Storage::makeDirectory($tempDir);

                $tempMsgPath = storage_path('app/temp_msg/' . Str::random(20) . '.msg');
                file_put_contents($tempMsgPath, file_get_contents($file->getRealPath()));

                $documents = $this->extractPdfFromBinary($tempMsgPath, $sessionId, $tempDir, $documentIndex, $ipAddress);
                @unlink($tempMsgPath);

                if (!empty($documents)) {
                    $allDocuments = array_merge($allDocuments, $documents);
                    $documentIndex += count($documents);
                }
            } else {
                $pdfPath = $file->storeAs('temp_pdfs/' . $sessionId, $file->getClientOriginalName());
                
                $allDocuments[] = [
                    'original_name' => $file->getClientOriginalName(),
                    'pages' => $this->generateThumbnails(storage_path('app/' . $pdfPath), $sessionId, $documentIndex),
                    'pdf_path' => $pdfPath,
                    'session_id' => $sessionId
                ];
                $documentIndex++;
            }
        }

        if (empty($allDocuments)) {
            throw new \Exception('Не удалось обработать ни один файл');
        }

        return [
            'documents' => $allDocuments,
            'session_id' => $sessionId
        ];
    }

    public function uploadFromUrl(Request $request)
    {
        $request->validate([
            'url' => 'required|url'
        ]);

        $ipAddress = $request->ip();
        
        try {
            $url = $request->input('url');
            
            // Проверяем расширение файла
            $urlPath = parse_url($url, PHP_URL_PATH);
            $extension = strtolower(pathinfo($urlPath, PATHINFO_EXTENSION));
            
            if (!in_array($extension, ['pdf', 'msg'])) {
                return response()->json([
                    'success' => false,
                    'message' => 'Поддерживаются только ссылки на PDF и MSG файлы'
                ], 422);
            }
            
            // Скачиваем файл
            $fileContent = $this->downloadFromOldSharePoint($url);
            
            // Создаем временный файл
            $tempFileName = tempnam(sys_get_temp_dir(), 'pdfsplit_') . '.' . $extension;
            file_put_contents($tempFileName, $fileContent);
            
            // Создаем UploadedFile объект с правильными аргументами
            $uploadedFile = new \Illuminate\Http\UploadedFile(
                $tempFileName,
                basename($urlPath),
                mime_content_type($tempFileName),
                null, // size - может быть null
                UPLOAD_ERR_OK,
                true // test = true для временных файлов
            );
            
            // Используем существующий processFiles
            $result = $this->processFiles([$uploadedFile], $ipAddress);
            
            // Удаляем временный файл
            unlink($tempFileName);
            
            return response()->json([
                'success' => true,
                'documents' => $result['documents'],
                'session_id' => $result['session_id']
            ]);
            
        } catch (\Exception $e) {
            \Log::error($ipAddress . ' URL upload failed: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'Ошибка загрузки файла: ' . $e->getMessage()
            ], 500);
        }
    }

    private function downloadFromOldSharePoint($url)
    {
        $credentials = [
            'username' => 'bmk\\shtorm',
            'password' => 'inxDZ567'
        ];
        
        $ch = curl_init();
        
        curl_setopt_array($ch, [
            CURLOPT_URL => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            CURLOPT_HTTPAUTH => CURLAUTH_NTLM,
            CURLOPT_USERPWD => $credentials['username'] . ':' . $credentials['password'],
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => false,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 10,
        ]);
        
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        
        if (curl_error($ch)) {
            $error = curl_error($ch);
            curl_close($ch);
            throw new \Exception("cURL error: $error");
        }
        
        curl_close($ch);
        
        if ($httpCode === 200 && $response && strlen($response) > 0) {
            return $response;
        }
        
        throw new \Exception("HTTP error: $httpCode");
    }

    public function uploadAndSplit(Request $request)
    {
        $ipAddress = $request->ip();
        try {
            $files = $request->allFiles()['pdf'] ?? [];
            $result = $this->processFiles($files, $ipAddress);

            return response()->json([
                'success' => true,
                'documents' => $result['documents'],
                'session_id' => $result['session_id']
            ]);

        } catch (\Exception $e) {
            Log::error($ipAddress . ' Upload failed ', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            return response()->json([
                'success' => false,
                'message' => 'Ошибка обработки файла: ' . $e->getMessage()
            ], 500);
        }
    }

    public function uploadAdditional(Request $request)
    {
        $ipAddress = $request->ip();
        try {
            $files = $request->allFiles()['pdf_files'] ?? [];
            $result = $this->processFiles($files, $ipAddress);

            return response()->json([
                'success' => true,
                'documents' => $result['documents'],
                'session_id' => $result['session_id']
            ]);

        } catch (\Exception $e) {
            Log::error($ipAddress . ' Upload additional failed ', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            return response()->json([
                'success' => false,
                'message' => 'Ошибка обработки файла: ' . $e->getMessage()
            ], 500);
        }
    }

    protected function extractPdfFromBinary($filePath, $sessionId, $tempDir, &$documentIndex, $ipAddress)
    {
        $documents = [];
        
        try {
            // Пробуем MAPI-парсер для Outlook MSG
            $documents = $this->extractWithMapi($filePath, $sessionId, $tempDir, $documentIndex, $ipAddress);
            
            if (!empty($documents)) {
                return $documents;
            }
            
            // Если MAPI не сработал, используем бинарный fallback
            Log::debug($ipAddress . ' MAPI parser found no attachments, using binary fallback');
            return $this->extractPdfFromBinaryFallback($filePath, $sessionId, $tempDir, $documentIndex, $ipAddress);
            
        } catch (\Exception $e) {
            Log::error($ipAddress . ' MAPI parser failed, using binary fallback', [
                'error' => $e->getMessage(),
                'file' => $filePath
            ]);
            return $this->extractPdfFromBinaryFallback($filePath, $sessionId, $tempDir, $documentIndex, $ipAddress);
        }
    }

    protected function extractWithMapi($filePath, $sessionId, $tempDir, &$documentIndex, $ipAddress)
    {
        $documents = [];
        
        try {
            // Создаем фабрики согласно документации
            $messageFactory = new MapiMessageFactory();
            $documentFactory = new DocumentFactory(); 
            
            // Открываем MSG-файл
            $ole = $documentFactory->createFromFile($filePath);
            $message = $messageFactory->parseMessage($ole);
            
            // Получаем вложения
            $attachments = $message->getAttachments();
            
            Log::debug($ipAddress . ' MAPI found attachments: ' . count($attachments));
            
            foreach ($attachments as $attachment) {
                try {
                    // Получаем свойства вложения
                    $props = $attachment->properties;
                    
                    // Пытаемся получить имя файла
                    $filename = $props['attach_long_filename'] ?? 
                            $props['display_name'] ?? 
                            $props['attach_filename'] ?? 
                            'document_' . uniqid();
                    
                    // Добавляем расширение если отсутствует
                    if (!pathinfo($filename, PATHINFO_EXTENSION)) {
                        $filename .= '.pdf';
                    }
                    
                    // Проверяем что это PDF по расширению
                    $extension = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
                    if ($extension !== 'pdf') {
                        Log::debug($ipAddress . ' Skipping non-PDF attachment: ' . $filename);
                        continue;
                    }
                    
                    Log::debug($ipAddress . ' Processing PDF attachment: ' . $filename);
                    
                    // Получаем содержимое вложения через свойство
                    $content = $props['attach_data'] ?? $props['attach_data_bin'] ?? null;
                    
                    if (!empty($content) && is_string($content) && strpos($content, '%PDF') === 0) {
                        $safeName = $this->sanitizeFilename($filename);
                        $pdfPath = $tempDir . '/' . $safeName;
                        
                        Storage::put($pdfPath, $content);
                        
                        try {
                            $pages = $this->generateThumbnails(storage_path('app/' . $pdfPath), $sessionId, $ipAddress, $documentIndex);
                            
                            $documents[] = [
                                'original_name' => $safeName,
                                'pages' => $pages,
                                'pdf_path' => $pdfPath,
                                'session_id' => $sessionId
                            ];
                            
                            $documentIndex++;
                            
                            Log::info($ipAddress . ' MAPI successfully extracted PDF: ' . $safeName);
                            
                        } catch (\Exception $e) {
                            Log::error($ipAddress . ' Failed to process PDF: ' . $safeName, ['error' => $e->getMessage()]);
                            Storage::delete($pdfPath);
                        }
                    } else {
                        Log::debug($ipAddress . ' Attachment content is not PDF or empty: ' . $filename);
                    }
                    
                } catch (\Exception $e) {
                    Log::warning($ipAddress . ' Failed to process MAPI attachment', [
                        'error' => $e->getMessage(),
                        'filename' => $filename ?? 'unknown'
                    ]);
                    continue;
                }
            }
            
        } catch (\Exception $e) {
            Log::error($ipAddress . ' MAPI parsing failed', [
                'error' => $e->getMessage(),
                'file' => $filePath,
                'trace' => $e->getTraceAsString()
            ]);
            throw $e;
        }
        
        return $documents;
    }

    protected function extractPdfFromBinaryFallback($filePath, $sessionId, $tempDir, &$documentIndex, $ipAddress)
    {
        $documents = [];
        $content = file_get_contents($filePath);
        
        // Ищем PDF файлы по сигнатуре
        $offset = 0;
        $pdfCount = 0;
        
        while (($pdfStart = strpos($content, '%PDF', $offset)) !== false) {
            $pdfEnd = strpos($content, '%%EOF', $pdfStart);
            
            if ($pdfEnd === false) {
                $nextPdf = strpos($content, '%PDF', $pdfStart + 4);
                $pdfEnd = $nextPdf !== false ? $nextPdf : strlen($content);
            } else {
                $pdfEnd += 5;
            }
            
            $pdfContent = substr($content, $pdfStart, $pdfEnd - $pdfStart);
            
            if (strlen($pdfContent) > 100 && strpos($pdfContent, '%PDF') === 0) {
                $pdfCount++;
                
                // Генерируем имя на основе номера документа
                $safeName = 'document_' . $pdfCount . '.pdf';
                $pdfPath = $tempDir . '/' . $safeName;
                
                Storage::put($pdfPath, $pdfContent);
                
                try {
                    $pages = $this->generateThumbnails(storage_path('app/' . $pdfPath), $sessionId, $ipAddress, $documentIndex);
                    
                    $documents[] = [
                        'original_name' => $safeName,
                        'pages' => $pages,
                        'pdf_path' => $pdfPath,
                        'session_id' => $sessionId
                    ];
                    
                    $documentIndex++;
                    
                } catch (\Exception $e) {
                    Storage::delete($pdfPath);
                }
            }
            
            $offset = $pdfStart + 4;
        }
        
        return $documents;
    }

    protected function generateThumbnails($pdfPath, $sessionId, $ipAddress, $documentIndex = null)
    {
        $pdf = new Pdf($pdfPath);
        $pages = [];
        
        // Создаем уникальную поддиректорию для каждого документа
        $thumbDir = "temp_thumbs/{$sessionId}";
        if ($documentIndex !== null) {
            $thumbDir .= "/doc_{$documentIndex}";
        }
        
        Storage::disk('public')->makeDirectory($thumbDir);
        
        // Устанавливаем оптимизированные параметры для ускорения
        $pdf->setCompressionQuality(75); // Оптимальное качество для превью
        $pdf->setResolution(120);
        
        $pageCount = $pdf->getNumberOfPages();
        
        for ($i = 1; $i <= $pageCount; $i++) {
            $imageName = "page_{$i}.jpg";
            $storagePath = "{$thumbDir}/{$imageName}";
            $fullPath = storage_path("app/public/{$storagePath}");
            
            try {
                // Генерируем превью для каждой страницы
                $pdf->setPage($i)->saveImage($fullPath);
                
                // Оптимизируем сохраненное изображение (уменьшаем размер без потери визуального качества)
                if (file_exists($fullPath)) {
                    $this->optimizeThumbnail($fullPath, $ipAddress);
                }
                
                $pages[] = [
                    'number' => $i,
                    'image_url' => asset("storage/{$storagePath}"),
                    'storage_path' => $storagePath
                ];
            } catch (\Exception $e) {
                Log::error($ipAddress . " Failed to generate thumbnail for page {$i}: " . $e->getMessage());
                // Продолжаем генерировать превью для остальных страниц
                continue;
            }
        }
        
        return $pages;
    }

    private function optimizeThumbnail($imagePath, $ipAddress)
    {
        try {
            $image = new Imagick($imagePath);
            
            // Оптимизируем только большие изображения
            if ($image->getImageWidth() > 1200) {
                $image->resizeImage(1200, 0, Imagick::FILTER_LANCZOS, 1);
            }
            
            // Устанавливаем оптимальные параметры сжатия
            $image->setImageCompression(Imagick::COMPRESSION_JPEG);
            $image->setImageCompressionQuality(75);
            $image->setInterlaceScheme(Imagick::INTERLACE_PLANE); // Прогрессивная загрузка
            $image->stripImage(); // Удаляем метаданные для уменьшения размера
            
            $image->writeImage($imagePath);
            $image->clear();
        } catch (\Exception $e) {
            Log::error($ipAddress . " Thumbnail optimization failed: " . $e->getMessage());
            // Не прерываем выполнение если оптимизация не удалась
        }
    }

    public function downloadRanges(Request $request)
    {
        $ipAddress = $request->ip();
        $validated = $request->validate([
            'documents' => 'required|array',
            'documents.*.pdf_path' => 'required|string',
            'ranges' => 'required|array',
            'ranges.*.range' => 'required|string',
            'ranges.*.name' => 'required|string',
        ]);

        try {
            Storage::makeDirectory('temp_split');
            Storage::disk('public')->makeDirectory('temp_zips');
            
            $zipPath = storage_path("app/public/temp_zips/" . Str::uuid() . ".zip");
            $zip = new ZipArchive();
            
            if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
                throw new \Exception("Не удалось создать ZIP-архив");
            }

            // Используем pdftk для быстрого извлечения страниц
            foreach ($validated['ranges'] as $rangeData) {
                $pages = $this->parseRange($rangeData['range'], $this->getTotalPages($validated['documents'], $ipAddress));
                $fileName = $this->sanitizeFilename($rangeData['name']) . '.pdf';
                $tempPdfPath = storage_path("app/temp_split/" . Str::random(20) . ".pdf");

                if ($this->isPdftkAvailable($ipAddress)) {
                    // Быстрый метод с pdftk
                    Log::info($ipAddress . ' Using PDFTK for fast PDF processing');
                    $this->extractPagesWithPdftk($validated['documents'], $pages, $tempPdfPath);
                } else {
                    // Резервный медленный метод
                    Log::warning($ipAddress . 'PDFTK not available, using fallback Imagick method');
                    $this->extractPagesWithImagick($validated['documents'], $pages, $tempPdfPath);
                }
                
                $zip->addFile($tempPdfPath, $fileName);
            }

            $zip->close();
            
            // Очищаем временные файлы
            array_map('unlink', glob(storage_path('app/temp_split/*.pdf')));

            return response()->json([
                'success' => true,
                'download_url' => asset("storage/temp_zips/" . basename($zipPath)),
                'filename' => "ranges_" . date('Ymd_His') . ".zip"
            ]);

        } catch (\Exception $e) {
            Log::error($ipAddress . "Download ranges error", [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            return response()->json([
                'success' => false,
                'message' => $e->getMessage()
            ], 500);
        }
    }

    private function isPdftkAvailable($ipAddress)
    {
        // Определяем ОС и выбираем соответствующую команду
        $isWindows = strtoupper(substr(PHP_OS, 0, 3)) === 'WIN';
        $command = $isWindows ? 'where pdftk' : 'which pdftk';
        
        exec($command, $output, $returnCode);
        return $returnCode === 0;
    }

    private function getTotalPages($documents, $ipAddress)
    {
        $totalPages = 0;
        foreach ($documents as $document) {
            try {
                $pdf = new Pdf(storage_path('app/' . $document['pdf_path']));
                $totalPages += $pdf->getNumberOfPages();
            } catch (\Exception $e) {
                Log::error($ipAddress . " Failed to get page count for document: " . $e->getMessage());
            }
        }
        return $totalPages;
    }

    private function extractPagesWithPdftk($documents, $targetPages, $outputPath)
    {
        $pageCounter = 0;
        $pdfFiles = [];
        $tempFiles = [];

        try {
            foreach ($documents as $document) {
                $pdfPath = storage_path('app/' . $document['pdf_path']);
                $pdf = new Pdf($pdfPath);
                $pageCount = $pdf->getNumberOfPages();
                
                $documentPages = [];
                for ($i = 1; $i <= $pageCount; $i++) {
                    $pageCounter++;
                    if (in_array($pageCounter, $targetPages)) {
                        $documentPages[] = $i;
                    }
                }
                
                if (!empty($documentPages)) {
                    $tempFile = storage_path("app/temp_split/" . Str::random(20) . ".pdf");
                    $this->extractDocumentPages($pdfPath, $documentPages, $tempFile);
                    $pdfFiles[] = $tempFile;
                    $tempFiles[] = $tempFile;
                }
            }

            if (count($pdfFiles) > 1) {
                $this->mergePdfFiles($pdfFiles, $outputPath);
            } else if (count($pdfFiles) === 1) {
                copy($pdfFiles[0], $outputPath);
            }

            foreach ($tempFiles as $tempFile) {
                if (file_exists($tempFile)) {
                    unlink($tempFile);
                }
            }

        } catch (\Exception $e) {
            foreach ($tempFiles as $tempFile) {
                if (file_exists($tempFile)) {
                    @unlink($tempFile);
                }
            }
            throw $e;
        }
    }

    private function extractDocumentPages($pdfPath, $pages, $outputPath)
    {
        try {
            $pagesString = implode(' ', $pages);
            
            // Создаем временные файлы с ASCII именами
            $tempInputPath = storage_path('app/temp_split/input_' . Str::random(16) . '.pdf');
            $tempOutputPath = storage_path('app/temp_split/output_' . Str::random(16) . '.pdf');
            
            // Копируем исходный файл
            if (!copy($pdfPath, $tempInputPath)) {
                throw new \Exception("Failed to create temporary input file");
            }
            
            $command = "pdftk " . escapeshellarg($tempInputPath) . " cat {$pagesString} output " . escapeshellarg($tempOutputPath) . " 2>&1";
            
            exec($command, $output, $returnCode);
            
            // Проверяем результат
            if ($returnCode === 0 && file_exists($tempOutputPath)) {
                if (!copy($tempOutputPath, $outputPath)) {
                    throw new \Exception("Failed to copy result to output path");
                }
            } else {
                throw new \Exception("PDFTK failed: " . implode("\n", $output));
            }
            
            return true;
            
        } catch (\Exception $e) {
            Log::error("PDFTK extraction failed", [
                'pdf_path' => $pdfPath,
                'pages' => $pages,
                'error' => $e->getMessage()
            ]);
            throw $e;
            
        } finally {
            // Всегда очищаем временные файлы
            if (isset($tempInputPath) && file_exists($tempInputPath)) {
                @unlink($tempInputPath);
            }
            if (isset($tempOutputPath) && file_exists($tempOutputPath)) {
                @unlink($tempOutputPath);
            }
        }
    }

    private function mergePdfFiles($pdfFiles, $outputPath)
    {
        // Создаем временный выходной файл
        $tempOutputPath = storage_path('app/temp_split/' . Str::random(20) . '.pdf');
        
        // Экранируем все пути
        $filesString = implode(' ', array_map(function($file) {
            return escapeshellarg($file);
        }, $pdfFiles));
        
        $command = "pdftk {$filesString} cat output " . escapeshellarg($tempOutputPath) . " 2>&1";
        
        exec($command, $output, $returnCode);
        
        // Копируем результат
        if ($returnCode === 0 && file_exists($tempOutputPath)) {
            copy($tempOutputPath, $outputPath);
        }
        
        // Очищаем временный файл
        if (file_exists($tempOutputPath)) {
            unlink($tempOutputPath);
        }
        
        if ($returnCode !== 0) {
            throw new \Exception("Failed to merge PDF files: " . implode("\n", $output));
        }
    }

    private function extractPagesWithImagick($documents, $targetPages, $outputPath)
    {
        // Старый медленный метод как fallback
        $imagick = new Imagick();
        $pageCounter = 0;
        
        foreach ($documents as $document) {
            $pdfPath = storage_path('app/' . $document['pdf_path']);
            $pdf = new Pdf($pdfPath);
            $pagesCount = $pdf->getNumberOfPages();
            
            for ($pageNum = 1; $pageNum <= $pagesCount; $pageNum++) {
                $pageCounter++;
                if (in_array($pageCounter, $targetPages)) {
                    $tempImage = tempnam(sys_get_temp_dir(), 'pdf') . '.jpg';
                    
                    // Устанавливаем оптимизированные параметры
                    $pdf->setCompressionQuality(80);
                    $pdf->setResolution(150);
                    $pdf->setPage($pageNum)->saveImage($tempImage);
                    
                    $pageImage = new Imagick($tempImage);
                    $imagick->addImage($pageImage);
                    unlink($tempImage);
                }
            }
        }

        $imagick->setImageFormat('pdf');
        $imagick->writeImages($outputPath, true);
        $imagick->clear();
    }

    private function sanitizeFilename($name)
    {
        // Удаляем только действительно опасные символы, разрешаем русские буквы
        $name = preg_replace('/[<>:"\/\\|?*]/', '', $name);
        
        // Заменяем пробелы на подчеркивания
        $name = str_replace(' ', '_', $name);
        
        // Убедимся что есть расширение
        if (!pathinfo($name, PATHINFO_EXTENSION)) {
            $name .= '.pdf';
        }
        
        return $name;
    }

    protected function parseRange($range, $maxPages)
    {
        $pages = [];
        $parts = explode(',', $range);
        
        foreach ($parts as $part) {
            if (strpos($part, '-') !== false) {
                [$start, $end] = explode('-', $part, 2);
                $start = max(1, (int)$start);
                $end = min($maxPages, (int)$end);
                for ($i = $start; $i <= $end; $i++) {
                    $pages[] = $i;
                }
            } else {
                $page = (int)$part;
                if ($page >= 1 && $page <= $maxPages) {
                    $pages[] = $page;
                }
            }
        }
        
        return array_unique($pages);
    }

    public function cleanup($sessionId)
    {
        try {
            Storage::deleteDirectory("temp_pdfs/{$sessionId}");
            Storage::disk('public')->deleteDirectory("temp_thumbs/{$sessionId}");
            Storage::disk('public')->deleteDirectory("temp_merged/{$sessionId}");
            Storage::disk('public')->delete("temp_zips/{$sessionId}.zip");
            
            return response()->json(['success' => true]);
        } catch (\Exception $e) {
            Log::error("Ошибка очистки файлов сессии {$sessionId}: " . $e->getMessage());
            return response()->json(['success' => false], 500);
        }
    }
}