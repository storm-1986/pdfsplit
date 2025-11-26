<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Support\Facades\Storage;
use Carbon\Carbon; // Теперь используется явно

class CleanOldPdfFiles
{
    protected $tempDirectories = [
        'temp_pdfs',
        'public/temp_thumbs',
        'public/temp_merged',
        'public/temp_zips',
        'temp_split'
    ];

    public function handle($request, Closure $next)
    {
        if ($request->is('/')) {
            $this->cleanOldFiles();
        }
        
        return $next($request);
    }

    protected function cleanOldFiles()
    {
        foreach ($this->tempDirectories as $directory) {
            if (!Storage::exists($directory)) {
                continue;
            }

            $this->deleteOldFiles($directory);
            $this->removeEmptySubdirectories($directory);
        }
    }

    protected function deleteOldFiles($directory)
    {
        $files = Storage::allFiles($directory);
        $cutoffTime = Carbon::now()->subHours(24)->timestamp; // Явное использование Carbon

        foreach ($files as $file) {
            if (Storage::lastModified($file) < $cutoffTime) {
                Storage::delete($file);
            }
        }
    }

    protected function removeEmptySubdirectories($directory)
    {
        $directories = Storage::allDirectories($directory);
        
        foreach (array_reverse($directories) as $dir) {
            if (empty(Storage::allFiles($dir))) {
                Storage::deleteDirectory($dir);
            }
        }
    }
}