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
    public function __construct()
    {
        $requiredDirs = [
            storage_path('app/temp_pdfs'),
            storage_path('app/temp_split'),
            storage_path('app/public/temp_thumbs'),
            storage_path('app/public/temp_zips')
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
            $request->validate(['pdf' => 'required|mimes:pdf|max:50000']);
            
            $file = $request->file('pdf');
            $originalName = $file->getClientOriginalName();
            $sessionId = Str::random(20);
            $tempDir = 'temp_pdfs/' . $sessionId;
            
            $pdfPath = $file->storeAs($tempDir, $originalName);
            
            Log::info('File stored successfully', [
                'path' => $pdfPath,
                'size' => Storage::size($pdfPath),
                'session_id' => $sessionId
            ]);

            $response = [
                'success' => true,
                'original_name' => $originalName,
                'pages' => $this->generateThumbnails(storage_path('app/' . $pdfPath), $sessionId),
                'session_id' => $sessionId,
                'pdf_path' => $pdfPath
            ];

            Log::info('API Response:', $response);
            return response()->json($response);
            
        } catch (\Exception $e) {
            Log::error('Upload failed', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
                'request' => $request->all()
            ]);
            
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
            'documents.*.pdf_path' => 'required|string',
            'ranges' => 'required|array',
            'ranges.*.range' => 'required|string',
            'ranges.*.name' => 'required|string',
        ]);

        try {
            // Создаем необходимые директории
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

                // Создаем PDF для диапазона
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
        return preg_replace('/[^a-zA-Z0-9_\-]/', '', $name);
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
        // Создаем директорию для выходного файла
        $outputDir = dirname($outputPath);
        if (!file_exists($outputDir)) {
            mkdir($outputDir, 0755, true);
        }

        if (!file_exists($sourcePath)) {
            throw new \Exception("Исходный PDF не найден: $sourcePath");
        }

        $pdf = new Pdf($sourcePath);
        $imagick = new Imagick();
        $tempImages = [];

        try {
            foreach ($pages as $page) {
                $tempImage = tempnam(sys_get_temp_dir(), 'pdf') . '.jpg';
                
                try {
                    $pdf->setPage($page)
                        ->setResolution(150)
                        ->saveImage($tempImage);
                    
                    if (!file_exists($tempImage)) {
                        throw new \Exception("Не удалось создать изображение для страницы $page");
                    }
                    
                    $tempImages[] = $tempImage;
                    $pageImage = new Imagick($tempImage);
                    $imagick->addImage($pageImage);
                    $pageImage->clear();
                } catch (\Exception $e) {
                    Log::error("Error processing page $page", [
                        'error' => $e->getMessage()
                    ]);
                    continue;
                }
            }

            if ($imagick->getNumberImages() === 0) {
                throw new \Exception("Не добавлено ни одной страницы");
            }

            $imagick->setImageFormat('pdf');
            if (!$imagick->writeImages($outputPath, true)) {
                throw new \Exception("Ошибка записи PDF файла");
            }

            return true;
        } finally {
            // Очистка временных файлов
            foreach ($tempImages as $tempImage) {
                if (file_exists($tempImage)) {
                    @unlink($tempImage);
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