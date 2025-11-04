@extends('layouts.app')

@section('content')
<div id="upload-container" class="bg-white rounded-lg shadow-md p-8 w-full max-w-md mx-auto">
    <h1 class="text-2xl font-bold text-gray-800 mb-6 text-center">Загрузить документ</h1>
    
    <form id="upload-form" action="{{ route('pdf.process') }}" method="POST" enctype="multipart/form-data" novalidate>
        @csrf
        <div id="upload-area" class="upload-area border-2 border-dashed border-gray-300 rounded-lg p-6 text-center mb-4">
            <input type="file" id="pdf" class="hidden" accept=".pdf,.msg" multiple>
            <label for="pdf" class="cursor-pointer flex flex-col items-center">
                <svg class="w-12 h-12 text-blue-500 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
                </svg>
                <span class="text-lg font-medium text-gray-700">Выберите файл</span>
                <span class="text-sm text-gray-500 mt-1">Или перетащите сюда</span>
            </label>
        </div>

        <!-- Контейнер для информации о выбранном файле -->
        <div class="file-info-container mt-3 mb-4 px-4 py-3 bg-gray-50 rounded-lg hidden">
            <div class="file-info text-sm font-medium text-gray-700">
                <div class="file-name overflow-hidden"></div>
            </div>
        </div>

        <button type="submit" id="upload-button" class="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition duration-200 font-medium cursor-pointer">
            Загрузить
        </button>
    </form>
</div>

<div id="preview-container" data-download-url="{{ route('pdf.download-ranges') }}" data-csrf-token="{{ csrf_token() }}" class="hidden fixed inset-0 bg-white z-50 overflow-y-auto pb-6">
    <!-- Заголовок и кнопки управления -->
    <div class="flex justify-between items-center sticky top-0 bg-white p-4 z-10 border-b">
        <h2 class="text-xl font-bold text-gray-800">Загруженные документы</h2>
        <div class="flex space-x-3">
            <!-- Кнопка добавления файлов -->
            <button type="button" id="addMoreFiles" title="Добавить файлы"
                    class="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors font-medium cursor-pointer">
                <span>➕</span>
            </button>
            <input type="file" id="additionalFiles" class="hidden" multiple accept=".pdf,.msg">
            
            <!-- Кнопка назад -->
            <button id="back-button" type="button" class="flex items-center space-x-2 bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg transition-colors font-medium cursor-pointer">
                <span>←</span>
                <span>Назад</span>
            </button>
        </div>
    </div>
    
    <!-- Overlay для drag & drop -->
    <div id="globalDropOverlay" class="hidden fixed inset-0 bg-gray-500/40 border-4 border-gray-400 border-dashed z-50 flex items-center justify-center">
        <div class="bg-white rounded-lg p-8 text-center shadow-xl">
            <span class="text-6xl mb-4">📁</span>
            <h3 class="text-2xl font-bold text-gray-800 mb-2">Перетащите файлы сюда</h3>
            <p class="text-gray-600">PDF и Outlook .msg файлы</p>
        </div>
    </div>
    
    <!-- Основная область с двумя колонками -->
    <div class="flex flex-col lg:flex-row gap-6 min-h-[calc(100vh-150px)]">
        <!-- Левая колонка - превью документов -->
        <div class="w-full">
            <div id="documents-preview" class="space-y-8 pl-2">
            </div>
        </div>
        
        <!-- Правая колонка - настройки разделения -->
        <div class="w-full md:w-1/3">
            <div id="split-options" class="bg-gray-50 p-5 rounded-lg border border-gray-200 sticky top-15">
                <!-- Выпадающий список контрагентов -->
                <div class="mb-4">
                    <select id="counterparty-select" class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="">Выберите контрагента</option>
                        @foreach($counterparties as $counterparty)
                            <option value="{{ $counterparty['kpl'] }}" data-name="{{ $counterparty['name'] }}">
                                {{ $counterparty['name'] }} ({{ $counterparty['krkpl'] }})
                            </option>
                        @endforeach
                    </select>
                </div>

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
                    Завершить обработку
                </button>
            </div>
        </div>
    </div>
</div>

@vite(['resources/js/pdf-upload.js', 'resources/css/app.css'])
@endsection