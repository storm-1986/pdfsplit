class PdfUploader {
    constructor() {
        this.uploadForm = document.getElementById('upload-form');
        this.uploadContainer = document.getElementById('upload-container');
        this.previewContainer = document.getElementById('preview-container');
        this.pdfTitle = document.getElementById('pdf-title');
        this.thumbnailsContainer = document.getElementById('thumbnails-container');
        this.backButton = document.getElementById('back-button');
        this.submitButton = this.uploadForm?.querySelector('button[type="submit"]');

        if (this.uploadForm) {
            this.init();
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
                body: formData,
                headers: {
                    'X-CSRF-TOKEN': document.querySelector('input[name="_token"]').value
                }
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
    
    showResults(data) {
        this.pdfTitle.textContent = data.original_name;
        
        this.uploadContainer.classList.add('hidden');
        this.previewContainer.classList.remove('hidden');
        
        this.thumbnailsContainer.innerHTML = data.pages.map(page => `
            <a href="${page.image_url}" 
               data-glightbox="title: Страница ${page.number}"
               class="block border rounded overflow-hidden hover:shadow-md transition">
                <img src="${page.image_url}" 
                     alt="Страница ${page.number}"
                     class="w-full h-67 object-cover">
                <div class="p-2 text-center bg-gray-50 border-t">
                    <span class="text-sm font-medium">Стр. ${page.number}</span>
                </div>
            </a>
        `).join('');

        // Адаптивное количество колонок
        const updateColumns = () => {
            const width = window.innerWidth;
            const cols = width > 1536 ? 7 : 
                        width > 1280 ? 6 :
                        width > 1024 ? 5 :
                        width > 768 ? 4 :
                        width > 640 ? 3 : 2;
            
            this.thumbnailsContainer.className = `grid grid-cols-${cols} gap-4 px-2`;
        };
        
        updateColumns();
        window.addEventListener('resize', updateColumns);

        if (window._glightbox) {
            window._glightbox.reload();
        }
    }
    
    resetForm() {
        this.previewContainer.classList.add('hidden');
        this.uploadContainer.classList.remove('hidden');
        this.uploadForm.reset();
    }
    
    showError(message) {
        alert(message);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new PdfUploader();
});