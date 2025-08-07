<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Spatie\PdfToImage\Pdf;

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
            $tempDir = 'temp_pdfs/' . Str::random(20);
            
            // Сохраняем PDF
            $pdfPath = $pdfFile->storeAs($tempDir, $originalName);
            
            // Генерируем миниатюры
            $pages = $this->generateThumbnails(
                storage_path('app/' . $pdfPath),
                basename($tempDir)
            );

            return response()->json([
                'success' => true,
                'original_name' => $originalName,
                'pages' => $pages
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
}