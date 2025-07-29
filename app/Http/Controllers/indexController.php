<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class indexController extends Controller
{
    public function index(){
        return view('index');
    }

    public function upload(Request $request){
        if ($request->hasFile('file')) {
            $file = $request->file('file');
            $originalFileName = $file->getClientOriginalName();
            $uniqueFolderName = uniqid();
            $uploadPath = 'uploads/' . $uniqueFolderName;
            Storage::disk('public')->makeDirectory($uploadPath);
            $path = $file->storeAs($uploadPath, $originalFileName, 'public');
            return "Файл загружен в: " . $path;
        }
        return "Файл не был загружен.";
    }
}
