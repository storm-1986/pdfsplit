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