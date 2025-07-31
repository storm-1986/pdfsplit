class PdfUploader {
    constructor() {
        this.uploadForm = document.getElementById('upload-form');
        this.uploadContainer = document.getElementById('upload-container');
        this.previewContainer = document.getElementById('preview-container');
        this.pdfTitle = document.getElementById('pdf-title');
        this.thumbnailsContainer = document.getElementById('thumbnails-container');
        this.backButton = document.getElementById('back-button');
        this.submitButton = this.uploadForm?.querySelector('button[type="submit"]');
        this.sessionId = null; // Добавляем хранение sessionId

        if (this.uploadForm) {
            this.init();
        }
        
        // Обработчик для очистки при закрытии страницы
        window.addEventListener('beforeunload', () => this.cleanupSession());
        
        // Обработчик для кнопки "Назад"
        if (this.backButton) {
            this.backButton.addEventListener('click', () => {
                this.cleanupSession();
                this.resetForm();
            });
        }
    }
    
    init() {
        this.uploadForm.addEventListener('submit', (e) => this.handleSubmit(e));
        this.backButton.addEventListener('click', () => this.resetForm());
    }
    
    async handleSubmit(e) {
        e.preventDefault();
        
        const formData = new FormData(this.uploadForm);
        
        this.showLoading(true);
        
        try {
            const response = await fetch(this.uploadForm.action, {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.showResults(data);
            } else {
                this.showError(data.message);
            }
        } catch (error) {
            console.error('Error:', error);
            this.showError('Произошла ошибка при загрузке файла');
        } finally {
            this.showLoading(false);
        }
    }
    
    showLoading(show) {
        if (!this.submitButton) return;

        if (show) {
            this.submitButton.innerHTML = `
                <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Обработка...
            `;
            this.submitButton.disabled = true;
        } else {
            this.submitButton.innerHTML = 'Разбить на страницы';
            this.submitButton.disabled = false;
        }
    }

    async cleanupSession() {
        if (!this.sessionId) return;
        
        try {
            await fetch('/pdf/cleanup', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').content
                },
                body: JSON.stringify({ session_id: this.sessionId })
            });
        } catch (error) {
            console.error('Ошибка при очистке сессии:', error);
        }
    }
    
    showResults(data) {
        this.sessionId = data.session_id; // Сохраняем sessionId для очистки
        this.pdfTitle.textContent = `Страницы документа: ${data.original_name}`;
        this.thumbnailsContainer.innerHTML = '';
        
        data.pages.forEach(page => {
            const thumbElement = document.createElement('div');
            thumbElement.className = 'border rounded-lg overflow-hidden shadow-sm hover:shadow-md transition cursor-pointer';
            thumbElement.innerHTML = `
                <img src="${page.image_url}" 
                     alt="Страница ${page.number}" 
                     class="w-full h-auto">
                <div class="p-2 text-center bg-gray-50 border-t">
                    <span class="text-sm font-medium text-gray-700">Стр. ${page.number}</span>
                </div>
            `;
            this.thumbnailsContainer.appendChild(thumbElement);
        });
        
        this.uploadContainer.classList.add('hidden');
        this.previewContainer.classList.remove('hidden');
    }
    
    resetForm() {
        this.sessionId = null; // Сбрасываем sessionId
        this.previewContainer.classList.add('hidden');
        this.uploadContainer.classList.remove('hidden');
        this.uploadForm.reset();
    }
    
    showError(message) {
        alert(message);
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    new PdfUploader();
});