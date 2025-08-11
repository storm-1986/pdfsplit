@extends('layouts.app')

@section('content')
<div id="upload-container" class="bg-white rounded-lg shadow-md p-8 w-full max-w-md mx-auto">
    <h1 class="text-2xl font-bold text-gray-800 mb-6 text-center">Разделить PDF</h1>
    
    <form id="upload-form" action="{{ route('pdf.process') }}" method="POST" enctype="multipart/form-data" novalidate>
        @csrf
        <div id="upload-area" class="upload-area border-2 border-dashed border-gray-300 rounded-lg p-6 text-center mb-4">
            <input type="file" id="pdf" name="pdf" accept=".pdf" class="hidden">
            <label for="pdf" class="cursor-pointer flex flex-col items-center">
                <svg class="w-12 h-12 text-blue-500 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
                </svg>
                <span class="text-lg font-medium text-gray-700">Выберите PDF файл</span>
                <span class="text-sm text-gray-500 mt-1">Или перетащите файл сюда</span>
            </label>
        </div>

        <!-- Контейнер для информации о выбранном файле -->
        <div class="file-info-container mt-3 mb-4 px-4 py-3 bg-gray-50 rounded-lg hidden">
            <div class="file-info text-sm font-medium text-gray-700 flex items-center">
                <svg class="w-5 h-5 text-green-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <span class="file-name truncate"></span>
            </div>
        </div>

        <button type="submit" id="upload-button" class="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition duration-200 cursor-pointer">
            Загрузить
        </button>
    </form>
</div>

<div id="preview-container" data-download-url="{{ route('pdf.download-ranges') }}" data-csrf-token="{{ csrf_token() }}" class="hidden w-full mx-auto px-4 py-6">
    <div class="flex justify-between items-center mb-4">
        <h2 id="pdf-title" class="text-xl font-bold text-gray-800"></h2>
        <button id="back-button" type="button" class="text-blue-500 hover:text-blue-700">
            ← Выбрать другой файл
        </button>
    </div>
    
    <div class="flex flex-col md:flex-row gap-6">
        <div class="w-full">
            <div id="thumbnails-container" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4"></div>
        </div>
        
        <div class="w-full md:w-1/3">
            <div id="split-options" class="bg-gray-50 p-5 rounded-lg border border-gray-200 sticky top-4">
                <h3 class="text-lg font-medium mb-4">Настройки разделения</h3>
                
                <div id="ranges-container" class="space-y-3 mb-4">
                </div>
                
                <button type="button" id="add-range" class="w-full text-blue-500 hover:text-blue-700 flex items-center justify-center mb-4 cursor-pointer">
                    <svg class="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
                    </svg>
                    Добавить диапазон
                </button>
                
                <button type="button" id="split-button" 
                        class="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-md font-medium transition duration-200 cursor-pointer">
                    Разделить PDF
                </button>
            </div>
        </div>
    </div>
</div>

@vite(['resources/js/pdf-upload.js', 'resources/css/app.css'])
@endsection