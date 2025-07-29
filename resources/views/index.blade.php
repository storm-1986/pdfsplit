<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        @vite('resources/css/app.css')
        <title>{{ config('app.name', 'Laravel') }}</title>
    </head>
    <body class="bg-gray-100 flex items-center justify-center h-screen">
        <div class="bg-white rounded-lg shadow-md p-8 w-96">
            <h1 class="text-3xl font-bold mb-6 text-center">Загрузите PDF файл</h2>
            <form action="#" method="POST" enctype="multipart/form-data">
                <div class="mb-4">
                    <label for="file-upload" class="block text-sm font-medium text-gray-700">Выберите файл</label>
                    <input type="file" id="file-upload" name="file" accept=".pdf" class="mt-1 block w-full text-sm text-gray-500 
                    file:mr-4 file:py-2 file:px-4 
                    file:rounded-md file:border-0 
                    file:text-sm file:font-semibold 
                    file:bg-blue-50 file:text-blue-700 
                    hover:file:bg-blue-100 
                    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2" required>
                </div>
                <button type="submit" class="w-full py-2 px-4 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700 transition duration-200 cursor-pointer">Загрузить</button>
            </form>
        </div>
    </body>
</html>
