<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

class CleanTempPdfs extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */

    protected $signature = 'clean:temp-pdfs {--hours=24 : Удалить файлы старше N часов}';

    public function handle()
    {
        $ttl = config('filesystems.temp_ttl_hours'); // Получаем из конфига
        $cutoffTime = now()->subHours($ttl);
        
        $this->cleanDirectory('temp_pdfs', $cutoffTime);
        $this->cleanDirectory('public/temp_thumbs', $cutoffTime);
        $this->cleanDirectory('public/temp_merged', $cutoffTime);
        
        $this->info('Очистка временных PDF завершена');
    }

    protected function cleanDirectory($directory, $cutoffTime)
    {
        $directories = Storage::directories($directory);
        
        foreach ($directories as $dir) {
            $lastModified = Storage::lastModified($dir);
            if ($lastModified < $cutoffTime->timestamp) {
                Storage::deleteDirectory($dir);
                $this->line("Удалено: {$dir}");
            }
        }
    }
}
