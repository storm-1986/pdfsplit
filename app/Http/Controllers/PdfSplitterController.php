<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Spatie\PdfToImage\Pdf;

class PdfSplitterController extends Controller
{
    public function showUploadForm(){
        return view('index');
    }

    public function uploadAndSplit(Request $request){

        $request->validate(['pdf' => 'required|mimes:pdf|max:50000']);
        try {
            $pdfFile = $request->file('pdf');
            $sessionId = Str::random(20); // Уникальный ID сессии
            $originalName = $pdfFile->getClientOriginalName();

            // Создаем уникальную папку для этого PDF
            $storagePath = "temp_pdfs/{$sessionId}";
            Storage::makeDirectory($storagePath);

            // Сохраняем файл с оригинальным именем в уникальной папке
            $pdfPath = $pdfFile->storeAs($storagePath, $originalName);
            $absolutePath = storage_path('app/' . $pdfPath);

            // Генерируем миниатюры страниц
            $pages = $this->generateThumbnails($absolutePath, $sessionId);
            // Сохраняем информацию в сессии
            session(["pdf_session_{$sessionId}" => [
                'original_name' => $originalName,
                'pdf_path' => $pdfPath,
                'pages' => $pages,
                'session_id' => $sessionId
            ]]);

            return response()->json([
                'success' => true,
                'original_name' => $originalName,
                'pages' => $pages,
                'session_id' => $sessionId
            ]);
        }
        catch (\Exception $e) {
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
        
        // Создаем директорию в storage/app/public
        Storage::disk('public')->makeDirectory($thumbDir);
        
        for ($i = 1; $i <= $pdf->getNumberOfPages(); $i++) {
            $imageName = "page_{$i}.jpg";
            $storagePath = "{$thumbDir}/{$imageName}";
            
            $pdf->setPage($i)
                ->saveImage(storage_path("app/public/{$storagePath}"));
            
            $pages[] = [
                'number' => $i,
                'image_url' => asset("storage/{$storagePath}"), // Полный URL с доменом
                'storage_path' => $storagePath
            ];
        }
        
        return $pages;
    }

    public function cleanup($sessionId)
    {
        try {
            // Удаляем PDF
            Storage::deleteDirectory("temp_pdfs/{$sessionId}");
            
            // Удаляем миниатюры
            Storage::disk('public')->deleteDirectory("temp_thumbs/{$sessionId}");
            
            // Удаляем собранные документы
            Storage::disk('public')->deleteDirectory("temp_merged/{$sessionId}");
            
            return true;
        } catch (\Exception $e) {
            Log::error("Ошибка очистки файлов сессии {$sessionId}: " . $e->getMessage());
            return false;
        }
    }
}
