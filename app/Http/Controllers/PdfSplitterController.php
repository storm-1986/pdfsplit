<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Spatie\PdfToImage\Pdf;
use ZipArchive;
use Imagick;

class PdfSplitterController extends Controller
{
    public function showUploadForm()
    {
        return view('index');
    }

    public function uploadAndSplit(Request $request)
    {
        $request->validate(['pdf' => 'required|mimes:pdf|max:50000']);
        
        try {
            $pdfFile = $request->file('pdf');
            $originalName = $pdfFile->getClientOriginalName();
            $sessionId = Str::random(20); // Генерируем уникальный ID сессии
            $tempDir = 'temp_pdfs/' . $sessionId;
            
            // Сохраняем PDF
            $pdfPath = $pdfFile->storeAs($tempDir, $originalName);
            $absolutePath = storage_path('app/' . $pdfPath);
            
            // Генерируем миниатюры
            $pages = $this->generateThumbnails($absolutePath, $sessionId);

            Log::debug('Returning response', [
                'session_id' => $sessionId,
                'pdf_path' => $pdfPath,
                'original_name' => $originalName
            ]);

            return response()->json([
                'success' => true,
                'original_name' => $originalName,
                'pages' => $pages,
                'session_id' => $sessionId, // Возвращаем session_id клиенту
                'pdf_path' => $pdfPath // Возвращаем путь к файлу
            ]);
            
        } catch (\Exception $e) {
            Log::error('PDF processing error: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Ошибка обработки PDF: ' . $e->getMessage()
            ], 500);
        }
    }
    
    protected function generateThumbnails($pdfPath, $sessionId)
    {
        $pdf = new Pdf($pdfPath);
        $pages = [];
        $thumbDir = "temp_thumbs/{$sessionId}";
        
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
        $request->validate([
            'session_id' => 'required|string',
            'pdf_path' => 'required|string',
            'ranges' => 'required|array',
            'ranges.*.range' => 'required|string|regex:/^\d+(-\d+)?$/',
            'ranges.*.name' => 'nullable|string|max:100',
            'ranges.*.type' => 'required|string|in:14,15,16,91,93,134', // Валидация типа документа
            'original_name' => 'required|string'
        ]);

        try {
            $originalPath = storage_path('app/' . $request->pdf_path);
            $originalName = pathinfo($request->original_name, PATHINFO_FILENAME);
            
            if (!file_exists($originalPath)) {
                throw new \Exception("Исходный PDF файл не найден");
            }

            $pdf = new Pdf($originalPath);
            $totalPages = $pdf->getNumberOfPages();
            
            if ($totalPages < 1) {
                throw new \Exception("PDF не содержит страниц");
            }

            // Создаем временную директорию
            $tempDir = "temp_split/{$request->session_id}";
            Storage::makeDirectory($tempDir);
            
            $zip = new ZipArchive();
            $zipPath = storage_path("app/public/temp_zips/{$request->session_id}.zip");
            
            if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
                throw new \Exception("Не удалось создать ZIP архив");
            }

            foreach ($request->ranges as $rangeData) {
                $range = $rangeData['range']; // Используем только диапазон
                // $name = $rangeData['name']; // Пока не используем (но доступно)
                // $type = $rangeData['type']; // Получаем тип документа (пока не используем)
                
                $pages = $this->parseRange($range, $totalPages);
                
                if (empty($pages)) {
                    Log::warning("Пропущен пустой диапазон: $range");
                    continue;
                }

                $rangeFileName = "{$originalName}_range_{$range}.pdf";
                $tempPdfPath = storage_path("app/{$tempDir}/{$rangeFileName}");
                
                $this->createPdfFromRange($originalPath, $pages, $tempPdfPath);
                
                $zip->addFile($tempPdfPath, $rangeFileName);
            }

            if ($zip->numFiles == 0) {
                throw new \Exception("Не создано ни одного PDF файла");
            }

            $zip->close();
            Storage::deleteDirectory($tempDir);

            $publicZipPath = "temp_zips/{$request->session_id}.zip";
            return response()->json([
                'success' => true,
                'download_url' => asset("storage/{$publicZipPath}"),
                'filename' => "{$originalName}_ranges.zip" // Также обновляем имя ZIP-архива
            ]);

        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => $e->getMessage()
            ], 500);
        }
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

    protected function createPdfFromRange($sourcePath, $pages, $outputPath)
    {
        if (!file_exists($sourcePath)) {
            throw new \Exception("Исходный PDF не найден: $sourcePath");
        }

        $pdf = new Pdf($sourcePath);
        $imagick = new Imagick();
        $tempImages = [];

        try {
            foreach ($pages as $page) {
                $tempImage = tempnam(sys_get_temp_dir(), 'pdf') . '.jpg';
                
                // Конвертируем страницу PDF в изображение
                $pdf->setPage($page)
                    ->setResolution(150)
                    ->saveImage($tempImage);
                
                if (!file_exists($tempImage)) {
                    throw new \Exception("Не удалось создать изображение для страницы $page");
                }
                
                $tempImages[] = $tempImage;
                
                // Добавляем изображение в Imagick
                $pageImage = new Imagick($tempImage);
                $imagick->addImage($pageImage);
                $pageImage->clear();
            }

            if ($imagick->getNumberImages() === 0) {
                throw new \Exception("Не добавлено ни одной страницы");
            }

            // Конвертируем изображения обратно в PDF
            $imagick->setImageFormat('pdf');
            $imagick->writeImages($outputPath, true);

        } catch (\Exception $e) {
            throw new \Exception("Ошибка создания PDF: " . $e->getMessage());
        } finally {
            // Очистка временных файлов
            foreach ($tempImages as $tempImage) {
                if (file_exists($tempImage)) {
                    unlink($tempImage);
                }
            }
            $imagick->clear();
        }
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