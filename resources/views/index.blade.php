@extends('layouts.app')

@section('content')
<div id="upload-container" class="bg-white rounded-lg shadow-md p-8 w-96 mx-auto">
    <h1 class="text-2xl font-bold text-gray-800 mb-6 text-center">Загрузите PDF файл</h1>
    
    <form id="upload-form" action="{{ route('pdf.process') }}" method="POST" enctype="multipart/form-data" class="space-y-4">
        @csrf
        
        <div>
            <label for="pdf" class="block text-sm font-medium text-gray-700 mb-1">Выберите файл PDF</label>
            <input type="file" id="pdf" name="pdf" accept=".pdf" required
                   class="block w-full text-sm text-gray-500
                          file:mr-4 file:py-2 file:px-4
                          file:rounded-md file:border-0
                          file:text-sm file:font-semibold
                          file:bg-blue-50 file:text-blue-700
                          hover:file:bg-blue-100">
        </div>
        
        <button type="submit" 
                class="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition duration-200 cursor-pointer">
            Разбить на страницы
        </button>
    </form>
</div>

<div id="preview-container" class="hidden w-full p-4">
    <div class="max-w-7xl mx-auto bg-white rounded-lg shadow-md p-6">
        <div class="flex justify-between items-center mb-6">
            <h2 id="pdf-title" class="text-2xl font-bold text-gray-800"></h2>
            <button id="back-button" class="bg-gray-200 hover:bg-gray-300 text-gray-800 py-2 px-4 rounded-md transition cursor-pointer">
                ← Назад к загрузке
            </button>
        </div>
        
        <div id="thumbnails-container" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4"></div>
    </div>
</div>

@vite('resources/js/pdf-upload.js')
@endsection