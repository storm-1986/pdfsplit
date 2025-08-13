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
            $file = $request->file('pdf');
            $originalName = $file->getClientOriginalName();
            $sessionId = Str::random(20);
            $tempDir = 'temp_pdfs/' . $sessionId;
            
            $pdfPath = $file->storeAs($tempDir, $originalName);
            $pages = $this->generateThumbnails(storage_path('app/' . $pdfPath), $sessionId);

            return response()->json([
                'success' => true,
                'original_name' => $originalName,
                'pages' => $pages,
                'session_id' => $sessionId,
                'pdf_path' => $pdfPath
            ]);
            
        } catch (\Exception $e) {
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
        $validated = $request->validate([
            'documents' => 'required|array',
            'documents.*.session_id' => 'required|string',
            'documents.*.pdf_path' => 'required|string',
            'documents.*.original_name' => 'required|string',
            'ranges' => 'required|array',
            'ranges.*.range' => 'required|string|regex:/^\d+(-\d+)?$/',
            'ranges.*.name' => 'nullable|string|max:100',
            'ranges.*.type' => 'required|string|in:14,15,16,91,93,134'
        ]);

        try {
            // Создаём уникальное имя для ZIP-архива
            $zipPath = storage_path("app/public/temp_zips/" . Str::uuid() . ".zip");
            
            $zip = new ZipArchive();
            if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
                throw new \Exception("Не удалось создать ZIP архив");
            }

            // Обрабатываем все документы
            foreach ($validated['documents'] as $document) {
                $pdfPath = storage_path('app/' . $document['pdf_path']);
                
                if (!file_exists($pdfPath)) {
                    Log::error("Файл не найден: {$document['pdf_path']}");
                    continue;
                }

                // Обрабатываем все диапазоны для документа
                foreach ($validated['ranges'] as $rangeData) {
                    $pages = $this->parseRange($rangeData['range'], (new Pdf($pdfPath))->getNumberOfPages());
                    
                    if (empty($pages)) {
                        Log::warning("Пустой диапазон: {$rangeData['range']}");
                        continue;
                    }

                    $originalName = pathinfo($document['original_name'], PATHINFO_FILENAME);
                    $safeName = Str::slug($rangeData['name'] ?? $originalName);
                    $fileName = "{$originalName}_range_{$rangeData['range']}.pdf";
                    
                    $tempPdfPath = storage_path("app/temp_split/" . Str::random(20) . ".pdf");
                    $this->createPdfFromRange($pdfPath, $pages, $tempPdfPath);
                    
                    $zip->addFile($tempPdfPath, $fileName);
                }
            }

            if ($zip->numFiles === 0) {
                throw new \Exception("Не создано ни одного PDF файла");
            }

            $zip->close();

            // Удаляем временные файлы
            array_map('unlink', glob(storage_path('app/temp_split/*.pdf')));

            return response()->json([
                'success' => true,
                'download_url' => asset("storage/temp_zips/" . basename($zipPath)),
                'filename' => "Разделенные_документы_" . date('Y-m-d') . ".zip"
            ]);

        } catch (\Exception $e) {
            Log::error("PDF split error: " . $e->getMessage());
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