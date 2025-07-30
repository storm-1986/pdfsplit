<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Spatie\PdfToImage\Pdf;

class indexController extends Controller
{
    public function index(){
        return view('index');
    }

    public function upload(Request $request){

        $request->validate(['pdf' => 'required|mimes:pdf|max:50000']);
            
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
            'session_id' => $sessionId,
            'pages' => $pages
        ]);
    }
    
    protected function generateThumbnails($pdfPath, $sessionId)
    {
        $pdf = new Pdf($pdfPath);
        $pages = [];
        $outputDir = storage_path("app/public/temp_thumbs/{$sessionId}");
        
        if (!file_exists($outputDir)) {
            mkdir($outputDir, 0777, true);
        }
        
        for ($i = 1; $i <= $pdf->getNumberOfPages(); $i++) {
            $imagePath = $outputDir . '/page_' . $i . '.jpg';
            $pdf->setPage($i)
                ->saveImage($imagePath);
            
            $relativePath = "storage/temp_thumbs/{$sessionId}/page_{$i}.jpg";
            
            $pages[] = [
                'page_number' => $i,
                'image_url' => asset($relativePath),
                'thumb_path' => $relativePath
            ];
        }
        
        return $pages;
    }
}
