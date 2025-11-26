<?php

namespace App\Http\Controllers;

use DateTime;
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

    public function getSystemNumber(Request $request)
    {
        $request->validate([
            'kpl' => 'required|string',
            'document_type' => 'required|string'
        ]);

        $ipAddress = $request->ip();
        
        try {
            $response = Http::withOptions([
                'verify' => false,
            ])->withHeaders([
                'Authorization' => 'Bearer ' . $this->bearerToken,
                'Content-Type' => 'application/json',
            ])->timeout(30)->withBody(json_encode([
                'kpl' => $request->input('kpl'),
                'type' => $request->input('document_type')
            ]), 'application/json')->post('https://edi1.savushkin.com:5050/web/docs/client/documents');
            
            if ($response->successful()) {
                $documents = $response->json();
                
                // Форматируем системный номер из документов
                $systemNumbers = $this->formatSystemNumber($documents);
                
                return response()->json([
                    'success' => true,
                    'system_numbers' => $systemNumbers
                ]);
            }
            
            return response()->json([
                'success' => false,
                'message' => 'Не удалось получить данные о документах'
            ], 500);
            
        } catch (\Exception $e) {
            \Log::error($ipAddress . ' System number fetch failed: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'Ошибка получения системного номера: ' . $e->getMessage()
            ], 500);
        }
    }

    private function formatSystemNumber($documents)
    {
        if (empty($documents)) {
            return [];
        }
        
        foreach ($documents as $document) {
            if (isset($document['dt']) && isset($document['nd']) && isset($document['snd'])) {
                $formattedDate = $this->formatDate($document['dt']);
                $formattedNumbers[] = [
                    'display_text' => $document['nd'] . ' от ' . $formattedDate,
                    'snd' => $document['snd'],
                    'dt' => $document['dt'],
                    'nd' => $document['nd']
                ];
            }
        }
        
        return $formattedNumbers;
    }

    private function formatDate($dateString)
    {
        try {
            $date = DateTime::createFromFormat('Y-m-d', $dateString);
            if ($date) {
                return $date->format('d-m-Y');
            }
        } catch (\Exception $e) {
            // Если не удалось преобразовать, возвращаем как есть
        }
        
        return $dateString;
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
            'url' => ['required', function ($attribute, $value, $fail) {
                // Простая проверка, что это похоже на URL
                if (!preg_match('~^(https?|ftp)://~i', $value)) {
                    $fail('URL должен начинаться с http://, https:// или ftp://');
                    return;
                }
                
                // Проверяем расширение файла
                $parsed = parse_url($value);
                $urlPath = $parsed['path'] ?? '';
                $extension = strtolower(pathinfo($urlPath, PATHINFO_EXTENSION));
                
                if (!in_array($extension, ['pdf', 'msg'])) {
                    $fail('Поддерживаются только ссылки на PDF и MSG файлы');
                }
            }]
        ]);

        $ipAddress = $request->ip();
        
        try {
            $url = $request->input('url');
            
            // Скачиваем файл
            $fileContent = $this->downloadFromOldSharePoint($url);
            
            // Получаем расширение из URL (уже проверено в валидации)
            $urlPath = parse_url($url, PHP_URL_PATH);
            $extension = strtolower(pathinfo($urlPath, PATHINFO_EXTENSION));
            
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
            'username' => env('SHAREPOINT_USERNAME'),
            'password' => env('SHAREPOINT_PASSWORD')
        ];

        // Проверяем, что credentials загружены из .env
        if (empty($credentials['username']) || empty($credentials['password'])) {
            throw new \Exception('Не указаны логин и пароль SharePoint в env файле');
        }
        
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

    protected function generateThumbnails($pdfPath, $sessionId, $ipAddress, $documentIndex = 0)
    {
        $pdf = new Pdf($pdfPath);
        $pages = [];
        
        // Создаем уникальную поддиректорию для каждого документа
        $thumbDir = "temp_thumbs/{$sessionId}/doc_{$documentIndex}";
        
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
        set_time_limit(300);
        $ipAddress = $request->ip();
        $validated = $request->validate([
            'documents' => 'required|array',
            'documents.*.pdf_path' => 'required|string',
            'ranges' => 'required|array',
            'ranges.*.range' => 'required|string',
            'ranges.*.name' => 'required|string',
            'page_rotations' => 'sometimes|array',
        ]);

        $rotations = $validated['page_rotations'] ?? [];

        try {
            Storage::makeDirectory('temp_split');
            Storage::disk('public')->makeDirectory('temp_zips');
            
            $sessionId = Str::uuid();
            $zipPath = storage_path("app/public/temp_zips/" . $sessionId . ".zip");
            $zip = new ZipArchive();
            
            if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
                throw new \Exception("Не удалось создать ZIP-архив");
            }

            // Создаем PDF файлы для каждого диапазона
            foreach ($validated['ranges'] as $rangeData) {
                $pages = $this->parseRange($rangeData['range'], $this->getTotalPages($validated['documents'], $ipAddress));
                $fileName = $this->sanitizeFilename($rangeData['name']) . '.pdf';
                $tempPdfPath = storage_path("app/temp_split/" . Str::random(20) . ".pdf");

                if ($this->isPdftkAvailable($ipAddress)) {
                    $this->extractPagesWithPdftk($validated['documents'], $pages, $tempPdfPath, $rotations);
                } else {
                    $this->extractPagesWithImagick($validated['documents'], $pages, $tempPdfPath, $rotations);
                }
                
                $zip->addFile($tempPdfPath, $fileName);
            }

            $zip->close();
            
            // Очищаем временные файлы
            array_map('unlink', glob(storage_path('app/temp_split/*.pdf')));

            return response()->json([
                'success' => true,
                'download_url' => asset("storage/temp_zips/" . basename($zipPath)),
                'filename' => "ranges_" . date('Ymd_His') . ".zip",
                'session_id' => $sessionId
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

    private function extractPagesWithPdftk($documents, $targetPages, $outputPath, $rotations = [])
    {
        $pdfFiles = [];
        $tempFiles = [];

        try {
            // Сначала создаем карту всех глобальных страниц
            $globalPageMap = [];
            $globalPageCounter = 1;
            
            foreach ($documents as $document) {
                $pdfPath = storage_path('app/' . $document['pdf_path']);
                $pdf = new Pdf($pdfPath);
                $pageCount = $pdf->getNumberOfPages();
                
                for ($localPage = 1; $localPage <= $pageCount; $localPage++) {
                    $globalPageMap[$globalPageCounter] = [
                        'document' => $document,
                        'local_page' => $localPage,
                        'pdf_path' => $pdfPath
                    ];
                    $globalPageCounter++;
                }
            }

            // Группируем целевые страницы по документам для эффективной обработки
            $documentGroups = [];
            foreach ($targetPages as $globalPage) {
                if (!isset($globalPageMap[$globalPage])) {
                    throw new \Exception("Страница {$globalPage} не найдена");
                }
                
                $pageInfo = $globalPageMap[$globalPage];
                $docKey = $pageInfo['pdf_path'];
                
                if (!isset($documentGroups[$docKey])) {
                    $documentGroups[$docKey] = [
                        'pdf_path' => $pageInfo['pdf_path'],
                        'pages' => [],
                        'global_pages' => []
                    ];
                }
                
                $documentGroups[$docKey]['pages'][] = $pageInfo['local_page'];
                $documentGroups[$docKey]['global_pages'][] = $globalPage;
            }

            // Обрабатываем каждую группу документов
            foreach ($documentGroups as $docGroup) {
                $tempFile = storage_path("app/temp_split/" . Str::random(20) . ".pdf");
                
                // Извлекаем страницы из документа
                $this->extractDocumentPages($docGroup['pdf_path'], $docGroup['pages'], $tempFile);
                
                // Применяем повороты с правильными глобальными номерами
                $this->applyRotationsToExtractedPages($tempFile, $docGroup['global_pages'], $rotations);
                
                $pdfFiles[] = $tempFile;
                $tempFiles[] = $tempFile;
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

    private function applyRotationsToExtractedPages($pdfPath, $globalPages, $rotations)
    {
        // Создаем маппинг поворотов для локальных страниц в извлеченном PDF
        $localRotations = [];
        
        foreach ($globalPages as $index => $globalPage) {
            $localPageNumber = $index + 1; // Номер страницы в извлеченном PDF
            
            if (isset($rotations[$globalPage]) && $rotations[$globalPage] != 0) {
                $localRotations[$localPageNumber] = $rotations[$globalPage];
            }
        }
        
        if (!empty($localRotations)) {
            Log::info("Applying rotations to extracted PDF", [
                'pdf_path' => $pdfPath,
                'global_pages' => $globalPages,
                'local_rotations' => $localRotations
            ]);
            
            $this->applyRotationsWithPdftk($pdfPath, $localRotations);
        }
    }

    private function applyRotationsWithPdftk($pdfPath, $rotations)
    {
        try {
            $tempOutput = storage_path("app/temp_split/" . Str::random(20) . ".pdf");
            
            // Получаем количество страниц в PDF
            $pdf = new Pdf($pdfPath);
            $totalPages = $pdf->getNumberOfPages();
            
            // Строим команду pdftk
            $command = "pdftk " . escapeshellarg($pdfPath) . " cat";
            
            for ($pageNum = 1; $pageNum <= $totalPages; $pageNum++) {
                $degrees = $rotations[$pageNum] ?? 0;
                
                $rotationParam = '';
                if ($degrees == 90) {
                    $rotationParam = 'right';
                } elseif ($degrees == 180) {
                    $rotationParam = 'down';
                } elseif ($degrees == 270) {
                    $rotationParam = 'left';
                }
                
                if ($rotationParam) {
                    $command .= " {$pageNum}{$rotationParam}";
                    Log::info("Rotating page {$pageNum} by {$degrees}° ({$rotationParam})");
                } else {
                    $command .= " {$pageNum}";
                }
            }
            
            $command .= " output " . escapeshellarg($tempOutput);
            
            Log::info("PDftk rotation command: " . $command);
            
            exec($command, $output, $returnCode);
            
            if ($returnCode === 0 && file_exists($tempOutput)) {
                copy($tempOutput, $pdfPath);
                unlink($tempOutput);
                Log::info("Successfully applied rotations with pdftk");
                return true;
            } else {
                Log::error("Pdftk rotation failed", [
                    'return_code' => $returnCode,
                    'output' => implode("\n", $output)
                ]);
                if (file_exists($tempOutput)) {
                    unlink($tempOutput);
                }
                return false;
            }
            
        } catch (\Exception $e) {
            Log::error("Pdftk rotation error: " . $e->getMessage());
            return false;
        }
    }

    private function extractPagesWithImagick($documents, $targetPages, $outputPath, $rotations = [])
    {
        try {
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
                        
                        $pdf->setCompressionQuality(80);
                        $pdf->setResolution(150);
                        $pdf->setPage($pageNum)->saveImage($tempImage);
                        
                        $pageImage = new Imagick($tempImage);
                        
                        // Применяем поворот если указан
                        if (isset($rotations[$pageCounter]) && $rotations[$pageCounter] != 0) {
                            $pageImage->rotateImage('white', $rotations[$pageCounter]);
                            Log::info("Applied rotation {$rotations[$pageCounter]}° to page {$pageCounter} with Imagick");
                        }
                        
                        $imagick->addImage($pageImage);
                        unlink($tempImage);
                    }
                }
            }

            $imagick->setImageFormat('pdf');
            $imagick->writeImages($outputPath, true);
            $imagick->clear();
            
            return true;
        } catch (\Exception $e) {
            Log::error("Imagick extraction failed: " . $e->getMessage());
            throw $e;
        }
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

    public function sendToArchive(Request $request)
    {
        $request->validate([
            'session_id' => 'required|string',
            'counterparty' => 'required|array',
            'ranges' => 'required|array',
            'ranges.*.type' => 'required|string',
            'ranges.*.systemNumber' => 'nullable|string',
            'ranges.*.name' => 'required|string',
        ]);

        $ipAddress = $request->ip();
        
        try {
            $sessionId = $request->input('session_id');
            $counterparty = $request->input('counterparty');
            $ranges = $request->input('ranges');

            // Получаем ZIP файл
            $zipPath = storage_path("app/public/temp_zips/" . $sessionId . ".zip");
            
            if (!file_exists($zipPath)) {
                throw new \Exception('ZIP файл не найден');
            }

            // Создаем временную директорию для распаковки
            $tempExtractPath = storage_path("app/temp_extract/" . $sessionId);
            if (!file_exists($tempExtractPath)) {
                mkdir($tempExtractPath, 0755, true);
            }

            // Разархивируем ZIP
            $zip = new ZipArchive();
            if ($zip->open($zipPath) === TRUE) {
                $zip->extractTo($tempExtractPath);
                $zip->close();
            } else {
                throw new \Exception('Не удалось открыть ZIP архив');
            }

            // Получаем все PDF файлы из распакованного архива
            $pdfFiles = glob($tempExtractPath . '/*.pdf');
            
            if (empty($pdfFiles)) {
                throw new \Exception('PDF файлы не найдены в архиве');
            }

            // Создаем массив для сопоставления имен файлов с диапазонами
            $fileMap = [];
            foreach ($ranges as $range) {
                $expectedFileName = $this->sanitizeFilename($range['name']) . '.pdf';
                $fileMap[$expectedFileName] = $range;
            }

            // Отправляем каждый документ в архив
            $documentIds = [];
            $documentNumbers = [];
            foreach ($pdfFiles as $pdfFile) {
                $fileName = basename($pdfFile);
                if (isset($fileMap[$fileName])) {
                    $rangeData = $fileMap[$fileName];
                    $result = $this->sendDocumentToArchive($rangeData, $counterparty, $pdfFile);
                    
                    if ($result['success'] && isset($result['document_number'])) {
                        $documentIds[] = $result['document_number'];
                        $documentNumbers[] = $result['document_number'];
                    }
                }
            }

            // Очищаем временную директорию распаковки
            array_map('unlink', glob($tempExtractPath . '/*'));
            rmdir($tempExtractPath);
            
            return response()->json([
                'success' => true,
                'message' => "Отправлено " . count($documentIds) . " документов в архив",
                'document_numbers' => $documentNumbers,
                'document_ids' => $documentIds, // Возвращаем ID для отслеживания
                'session_id' => $sessionId
            ]);

        } catch (\Exception $e) {
            Log::error($ipAddress . ' Archive send failed: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'Ошибка отправки в архив: ' . $e->getMessage()
            ], 500);
        }
    }

    // Новый метод для проверки статуса нескольких документов
    public function checkArchiveStatus(Request $request)
    {
        $request->validate([
            'document_ids' => 'required|array',
            'document_ids.*' => 'required|integer'
        ]);

        $documentIds = $request->input('document_ids');
        $documentStatuses = [];

        try {
            // Проверяем статус каждого документа через API
            foreach ($documentIds as $docId) {
                $status = $this->checkDocumentStatusViaApi($docId);
                $documentStatuses[] = [
                    'id' => $docId,
                    'pst' => $status
                ];
            }

            return response()->json([
                'success' => true,
                'documents_status' => $documentStatuses
            ]);

        } catch (\Exception $e) {
            Log::error('Status check failed: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'Ошибка проверки статуса'
            ], 500);
        }
    }

    // Проверка статуса через API архива
    private function checkDocumentStatusViaApi($documentId)
    {
        try {
            $response = Http::withOptions([
                'verify' => false,
            ])->withHeaders([
                'Authorization' => 'Bearer ' . $this->bearerToken,
                'Content-Type' => 'application/json',
            ])->timeout(10)->withBody(json_encode([
                'id' => $documentId
            ]), 'application/json')->post('https://edi1.savushkin.com:5050/web/docs/directum/status');
            
            if ($response->successful()) {
                $result = $response->json();
                return $result['pst'] ?? 0;
            }
            
            return 0;
            
        } catch (\Exception $e) {
            Log::error("Status check failed for document {$documentId}: " . $e->getMessage());
            return 0;
        }
    }

    private function sendDocumentToArchive($rangeData, $counterparty, $pdfFilePath)
    {
        try {
            $pdfContent = file_get_contents($pdfFilePath);
            $base64Pdf = base64_encode($pdfContent);

            $response = Http::withOptions([
                'verify' => false,
            ])->withHeaders([
                'Authorization' => 'Bearer ' . $this->bearerToken,
                'Content-Type' => 'application/json',
            ])->timeout(30)->withBody(json_encode([
                'type' => $rangeData['type'],
                'snd' => $rangeData['systemNumber'] ?? '',
                'kpl' => $counterparty['kpl'],
                'file' => $base64Pdf,
                'extension' => 'pdf'
            ]), 'application/json')->post('https://edi1.savushkin.com:5050/web/docs/directum/add');
            
            if ($response->successful()) {
                $result = $response->json();
                Log::info('Документ отправлен в очередь: ' . $result['id'] . ', тип: ' . $rangeData['type'] . ', контрагент: ' . $counterparty['kpl']);
                return [
                    'success' => true,
                    'document_number' => $result['id'] // Возвращаем ID для отслеживания
                ];
            }
            Log::error('Ошибка HTTP при отправке документа: ' . $response->status() . ', тип: ' . $rangeData['type'] . ', контрагент: ' . $counterparty['kpl']);
            
            return [
                'success' => false,
                'error' => 'HTTP error: ' . $response->status()
            ];
            
        } catch (\Exception $e) {
            Log::error('Ошибка при отправке документа в очередь: ' . $e->getMessage() . ', тип: ' . $rangeData['type'] . ', контрагент: ' . $counterparty['kpl']);
            return [
                'success' => false,
                'error' => $e->getMessage()
            ];
        }
    }

    public function rotatePage(Request $request)
    {
        $validated = $request->validate([
            'session_id' => 'required|string',
            'doc_index' => 'required|integer', 
            'page_number' => 'required|integer',
            'degrees' => 'required|integer|in:-90,90'
        ]);

        try {
            $sessionId = $validated['session_id'];
            $docIndex = $validated['doc_index'];
            $pageNumber = $validated['page_number'];
            $degrees = $validated['degrees'];

            $newThumbUrl = $this->updateThumbnail($sessionId, $docIndex, $pageNumber, $degrees);

            return response()->json([
                'success' => true,
                'new_thumb_url' => $newThumbUrl,
                'message' => 'Thumbnail rotated successfully'
            ]);

        } catch (\Exception $e) {
            Log::error('Thumbnail rotation error', ['error' => $e->getMessage()]);
            return response()->json([
                'success' => false,
                'message' => 'Rotation failed: ' . $e->getMessage()
            ], 500);
        }
    }

    private function updateThumbnail($sessionId, $docIndex, $pageNumber, $degrees)
    {
        try {

            // Путь к существующей миниатюре
            $thumbPath = "temp_thumbs/{$sessionId}/doc_{$docIndex}/page_{$pageNumber}.jpg";
            $fullThumbPath = storage_path('app/public/' . $thumbPath);
            
            Log::info("Existing thumbnail", [
                'thumb_path' => $thumbPath,
                'exists' => file_exists($fullThumbPath)
            ]);

            if (!file_exists($fullThumbPath)) {
                throw new \Exception("Thumbnail not found: {$thumbPath}");
            }

            // Загружаем и поворачиваем существующую миниатюру
            $image = new Imagick($fullThumbPath);
            
            $image->rotateImage('white', $degrees);
            $image->setImagePage(0, 0, 0, 0);
            
            // Сохраняем поверх оригинала
            $image->writeImage($fullThumbPath);
            $image->clear();

            Log::info("Thumbnail rotated successfully");

            return asset("storage/{$thumbPath}") . '?t=' . time();
            
        } catch (\Exception $e) {
            Log::error('Thumbnail rotation failed', ['error' => $e->getMessage()]);
            throw $e;
        }
    }

    // public function cleanup($sessionId)
    // {
    //     try {
    //         Storage::deleteDirectory("temp_pdfs/{$sessionId}");
    //         Storage::disk('public')->deleteDirectory("temp_thumbs/{$sessionId}");
    //         Storage::disk('public')->deleteDirectory("temp_merged/{$sessionId}");
    //         Storage::disk('public')->delete("temp_zips/{$sessionId}.zip");
            
    //         return response()->json(['success' => true]);
    //     } catch (\Exception $e) {
    //         Log::error("Ошибка очистки файлов сессии {$sessionId}: " . $e->getMessage());
    //         return response()->json(['success' => false], 500);
    //     }
    // }
}