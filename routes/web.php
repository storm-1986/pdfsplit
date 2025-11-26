<?php

use App\Http\Controllers\PdfSplitterController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Web Routes
|--------------------------------------------------------------------------
|
| Here is where you can register web routes for your application. These
| routes are loaded by the RouteServiceProvider and all of them will
| be assigned to the "web" middleware group. Make something great!
|
*/
Route::get('/', [PdfSplitterController::class, 'showUploadForm'])->name('pdf.upload');
Route::post('/', [PdfSplitterController::class, 'uploadAndSplit'])->name('pdf.process');
Route::post('/upload-additional', [PdfSplitterController::class, 'uploadAdditional'])->name('pdf.upload.additional');
// Route::post('/pdf/cleanup', [PdfSplitterController::class, 'cleanup'])->name('pdf.cleanup');
Route::post('/pdf/download-ranges', [PdfSplitterController::class, 'downloadRanges'])->name('pdf.download-ranges');
Route::post('/upload-from-url', [PdfSplitterController::class, 'uploadFromUrl'])->name('pdf.upload.url');
Route::post('/get-system-number', [PdfSplitterController::class, 'getSystemNumber']);
Route::post('/send-to-archive', [PdfSplitterController::class, 'sendToArchive']);
Route::post('/check-archive-status', [PdfSplitterController::class, 'checkArchiveStatus']);
Route::post('/rotate-page', [PdfSplitterController::class, 'rotatePage']);