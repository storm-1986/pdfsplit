<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Spatie\PdfToImage\Pdf;
use ZipArchive;
use Imagick;
use Hfig\MAPI\MapiMessageFactory;
use Hfig\MAPI\OLE\Pear\DocumentFactory;

class PdfSplitterController extends Controller
{
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

    public function showUploadForm()
    {
        return view('index');
    }

    public function uploadAndSplit(Request $request)
    {
        try {
            // Правильно получаем файлы (массив или одиночный файл)
            $files = $request->allFiles()['pdf'] ?? [];
            
            // Если это одиночный файл, превращаем в массив
            if (!is_array($files)) {
                $files = [$files];
            }

            // Валидация для каждого файла
            foreach ($files as $file) {
                $extension = strtolower($file->getClientOriginalExtension());
                if (!in_array($extension, ['pdf', 'msg'])) {
                    return response()->json([
                        'success' => false,
                        'message' => 'Файл должен быть в формате PDF или MSG'
                    ], 422);
                }
                
                if ($file->getSize() > 50000000) {
                    return response()->json([
                        'success' => false,
                        'message' => 'Размер файла не должен превышать 50MB'
                    ], 422);
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

                    $documents = $this->extractPdfFromBinary($tempMsgPath, $sessionId, $tempDir, $documentIndex);
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

            // Всегда возвращаем новый формат для единообразия
            return response()->json([
                'success' => true,
                'documents' => $allDocuments,
                'session_id' => $sessionId
            ]);

        } catch (\Exception $e) {
            Log::error('Upload failed', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            return response()->json([
                'success' => false,
                'message' => 'Ошибка обработки файла: ' . $e->getMessage()
            ], 500);
        }
    }

    protected function extractPdfFromBinary($filePath, $sessionId, $tempDir, &$documentIndex)
    {
        $documents = [];
        
        try {
            // Пробуем MAPI-парсер для Outlook MSG
            $documents = $this->extractWithMapi($filePath, $sessionId, $tempDir, $documentIndex);
            
            if (!empty($documents)) {
                return $documents;
            }
            
            // Если MAPI не сработал, используем бинарный fallback
            Log::debug('MAPI parser found no attachments, using binary fallback');
            return $this->extractPdfFromBinaryFallback($filePath, $sessionId, $tempDir, $documentIndex);
            
        } catch (\Exception $e) {
            Log::error('MAPI parser failed, using binary fallback', [
                'error' => $e->getMessage(),
                'file' => $filePath
            ]);
            return $this->extractPdfFromBinaryFallback($filePath, $sessionId, $tempDir, $documentIndex);
        }
    }

    protected function extractWithMapi($filePath, $sessionId, $tempDir, &$documentIndex)
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
            
            Log::debug('MAPI found attachments: ' . count($attachments));
            
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
                        Log::debug('Skipping non-PDF attachment: ' . $filename);
                        continue;
                    }
                    
                    Log::debug('Processing PDF attachment: ' . $filename);
                    
                    // Получаем содержимое вложения через свойство
                    $content = $props['attach_data'] ?? $props['attach_data_bin'] ?? null;
                    
                    if (!empty($content) && is_string($content) && strpos($content, '%PDF') === 0) {
                        $safeName = $this->sanitizeFilename($filename);
                        $pdfPath = $tempDir . '/' . $safeName;
                        
                        Storage::put($pdfPath, $content);
                        
                        try {
                            $pages = $this->generateThumbnails(storage_path('app/' . $pdfPath), $sessionId, $documentIndex);
                            
                            $documents[] = [
                                'original_name' => $safeName,
                                'pages' => $pages,
                                'pdf_path' => $pdfPath,
                                'session_id' => $sessionId
                            ];
                            
                            $documentIndex++;
                            
                            Log::info('MAPI successfully extracted PDF: ' . $safeName);
                            
                        } catch (\Exception $e) {
                            Log::error('Failed to process PDF: ' . $safeName, ['error' => $e->getMessage()]);
                            Storage::delete($pdfPath);
                        }
                    } else {
                        Log::debug('Attachment content is not PDF or empty: ' . $filename);
                    }
                    
                } catch (\Exception $e) {
                    Log::warning('Failed to process MAPI attachment', [
                        'error' => $e->getMessage(),
                        'filename' => $filename ?? 'unknown'
                    ]);
                    continue;
                }
            }
            
        } catch (\Exception $e) {
            Log::error('MAPI parsing failed', [
                'error' => $e->getMessage(),
                'file' => $filePath,
                'trace' => $e->getTraceAsString()
            ]);
            throw $e;
        }
        
        return $documents;
    }

    protected function extractPdfFromBinaryFallback($filePath, $sessionId, $tempDir, &$documentIndex)
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
                    $pages = $this->generateThumbnails(storage_path('app/' . $pdfPath), $sessionId, $documentIndex);
                    
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

    protected function generateThumbnails($pdfPath, $sessionId, $documentIndex = null)
    {
        $pdf = new Pdf($pdfPath);
        $pages = [];
        
        // Создаем уникальную поддиректорию для каждого документа
        $thumbDir = "temp_thumbs/{$sessionId}";
        if ($documentIndex !== null) {
            $thumbDir .= "/doc_{$documentIndex}";
        }
        
        Storage::disk('public')->makeDirectory($thumbDir);
        
        for ($i = 1; $i <= $pdf->getNumberOfPages(); $i++) {
            $imageName = "page_{$i}.jpg";
            $storagePath = "{$thumbDir}/{$imageName}";
            
            $pdf->setPage($i)
                ->saveImage(storage_path("app/public/{$storagePath}"));
            
            $pages[] = [
                'number' => $i,
                'image_url' => asset("storage/{$storagePath}"),
                'storage_path' => $storagePath
            ];
        }
        
        return $pages;
    }

    public function downloadRanges(Request $request)
    {
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

            // Собираем все страницы всех документов
            $allPages = [];
            foreach ($validated['documents'] as $document) {
                $pdf = new Pdf(storage_path('app/' . $document['pdf_path']));
                $pagesCount = $pdf->getNumberOfPages();
                $allPages = array_merge($allPages, range(1, $pagesCount));
            }

            // Обрабатываем каждый диапазон
            foreach ($validated['ranges'] as $rangeData) {
                $pages = $this->parseRange($rangeData['range'], count($allPages));
                $fileName = $this->sanitizeFilename($rangeData['name']) . '.pdf';
                $tempPdfPath = storage_path("app/temp_split/" . Str::random(20) . ".pdf");

                $imagick = new Imagick();
                $currentPage = 0;
                
                foreach ($validated['documents'] as $document) {
                    $pdf = new Pdf(storage_path('app/' . $document['pdf_path']));
                    $pagesCount = $pdf->getNumberOfPages();
                    
                    foreach (range(1, $pagesCount) as $pageNum) {
                        $currentPage++;
                        if (in_array($currentPage, $pages)) {
                            $tempImage = tempnam(sys_get_temp_dir(), 'pdf') . '.jpg';
                            $pdf->setPage($pageNum)->saveImage($tempImage);
                            $pageImage = new Imagick($tempImage);
                            $imagick->addImage($pageImage);
                            unlink($tempImage);
                        }
                    }
                }

                $imagick->setImageFormat('pdf');
                $imagick->writeImages($tempPdfPath, true);
                $imagick->clear();

                $zip->addFile($tempPdfPath, $fileName);
            }

            $zip->close();
            array_map('unlink', glob(storage_path('app/temp_split/*.pdf')));

            return response()->json([
                'success' => true,
                'download_url' => asset("storage/temp_zips/" . basename($zipPath)),
                'filename' => "ranges_" . date('Ymd_His') . ".zip"
            ]);

        } catch (\Exception $e) {
            Log::error("Download ranges error", [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            return response()->json([
                'success' => false,
                'message' => $e->getMessage()
            ], 500);
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