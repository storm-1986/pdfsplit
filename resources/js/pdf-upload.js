class PdfSplitter {
    constructor() {
        this.uploadedDocuments = [];
        this.uploadForm = document.getElementById('upload-form');
        this.fileInput = document.getElementById('pdf');
        this.previewContainer = document.getElementById('preview-container');
        this.thumbnailsContainer = document.getElementById('thumbnails-container');
        this.pdfTitle = document.getElementById('pdf-title');
        this.backButton = document.getElementById('back-button');
        this.rangesContainer = document.getElementById('ranges-container');
        this.addRangeBtn = document.getElementById('add-range');
        this.splitButton = document.getElementById('split-button');
        
        // Явно находим кнопку загрузки
        this.uploadButton = this.uploadForm.querySelector('button[type="submit"]');
        
        this.totalPages = 0;
        this.initEventListeners();
        this.setupDragAndDrop();

        if (!this.splitButton) {
            console.error('Элемент split-button не найден');
            return;
        }

        if (!this.previewContainer) {
            console.error('Элемент preview-container не найден');
            return;
        }
    }

    initEventListeners() {
        this.fileInput.addEventListener('change', (e) => this.handleFileChange(e));
        this.uploadForm.addEventListener('submit', (e) => this.handleSubmit(e));
        this.addRangeBtn.addEventListener('click', () => this.addRange());
        this.splitButton.addEventListener('click', () => this.handleSplit());
        this.backButton.addEventListener('click', (e) => {
            e.preventDefault();
            this.resetForm();
        });
    }

    setupDragAndDrop() {
        const uploadArea = document.getElementById('upload-area');
        if (!uploadArea) return;

        const highlight = () => uploadArea.classList.add('border-blue-500', 'bg-blue-50');
        const unhighlight = () => uploadArea.classList.remove('border-blue-500', 'bg-blue-50');

        ['dragenter', 'dragover'].forEach(event => {
            uploadArea.addEventListener(event, (e) => {
                e.preventDefault();
                highlight();
            });
        });

        ['dragleave', 'drop'].forEach(event => {
            uploadArea.addEventListener(event, (e) => {
                e.preventDefault();
                unhighlight();
            });
        });

        uploadArea.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            const pdfFiles = Array.from(files).filter(file => file.type === 'application/pdf');
            
            if (pdfFiles.length > 0) {
                this.fileInput.files = e.dataTransfer.files;
                this.showSelectedFiles(pdfFiles); // Используем новый метод
                this.uploadButton.disabled = false;
                
                uploadArea.classList.add('border-green-500');
                setTimeout(() => uploadArea.classList.remove('border-green-500'), 1000);
            }
        });
    }

    handleFileChange(e) {
        const files = e.target.files;
        if (files.length > 0) {
            this.showSelectedFiles(files);
            this.uploadButton.disabled = false;
            this.uploadForm.querySelector('.upload-error')?.remove();
        }
    }

    showSelectedFiles(files) {
        const container = document.querySelector('.file-info-container');
        const fileNameSpan = document.querySelector('.file-name');
        
        if (container && fileNameSpan) {
            const names = Array.from(files).map(f => f.name).join(', ');
            fileNameSpan.textContent = files.length > 1 
                ? `${files.length} файлов: ${names}` 
                : names;
            container.classList.remove('hidden');
        }
    }

    hideFileInfo() {
        const fileInfoContainer = document.querySelector('.file-info-container');
        if (fileInfoContainer) {
            // Добавляем анимацию исчезновения
            fileInfoContainer.style.animation = 'fadeOut 0.3s ease-out';
            setTimeout(() => {
                fileInfoContainer.classList.add('hidden');
                const fileNameSpan = fileInfoContainer.querySelector('.file-name');
                if (fileNameSpan) {
                    fileNameSpan.textContent = '';
                }
                fileInfoContainer.style.animation = '';
            }, 300);
        }
    }

    async handleSubmit(e) {
        e.preventDefault();
        const files = Array.from(this.fileInput.files);
        
        if (files.length === 0) {
            this.showFileError('Пожалуйста, выберите PDF файлы');
            return;
        }

        const originalButtonHtml = this.uploadButton.innerHTML;
        this.uploadButton.disabled = true;
        this.uploadButton.innerHTML = `
            <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <!-- spinner icon -->
            </svg>
            Загрузка ${files.length} файлов...
        `;

        try {
            const uploadPromises = files.map(file => this.uploadFile(file));
            const results = await Promise.all(uploadPromises);
            
            this.uploadedDocuments = results.filter(r => r.success);
            if (this.uploadedDocuments.length > 0) {
                this.showPreview();
            } else {
                throw new Error('Не удалось загрузить ни один файл');
            }
            
        } catch (error) {
            this.showFileError(error.message);
        } finally {
            this.uploadButton.disabled = false;
            this.uploadButton.innerHTML = originalButtonHtml;
        }
    }

    async uploadFile(file) {
        const formData = new FormData();
        formData.append('pdf', file);
        formData.append('_token', document.querySelector('input[name="_token"]').value);

        try {
            const response = await fetch(this.uploadForm.action, {
                method: 'POST',
                body: formData
            });
            return await response.json();
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    showFileError(message) {
        // Удаляем предыдущие сообщения об ошибках
        const oldError = this.uploadForm.querySelector('.upload-error');
        if (oldError) oldError.remove();
        
        // Создаем новое сообщение с дополнительным отступом
        const errorElement = document.createElement('div');
        errorElement.className = 'upload-error text-red-500 text-sm mt-2 mb-3 text-center'; // Добавили mb-3
        errorElement.textContent = message;
        
        // Вставляем после области загрузки
        const uploadArea = this.uploadForm.querySelector('.upload-area');
        uploadArea.insertAdjacentElement('afterend', errorElement);
        
        // Подсвечиваем область загрузки
        uploadArea.classList.add('border-red-500');
        setTimeout(() => {
            uploadArea.classList.remove('border-red-500');
            errorElement.remove();
        }, 3000);
    }

    showPreview() {
        this.previewContainer.classList.remove('hidden');
        document.getElementById('upload-container').classList.add('hidden');
        
        const previewContainer = document.getElementById('documents-preview');
        previewContainer.innerHTML = '';
        
        let globalPageNum = 1;
        
        this.uploadedDocuments.forEach((doc, docIndex) => {
            const docContainer = document.createElement('div');
            docContainer.className = 'bg-white rounded-lg shadow-sm p-4 border border-gray-200 mb-6';
            
            // Заголовок документа
            const title = document.createElement('h3');
            title.className = 'text-lg font-semibold text-gray-800 mb-3';
            title.textContent = `${docIndex + 1}. ${doc.original_name}`;
            docContainer.appendChild(title);
            
            // Миниатюры страниц
            const thumbsContainer = document.createElement('div');
            thumbsContainer.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3';
            
            doc.pages.forEach(page => {
                const thumb = document.createElement('div');
                thumb.className = 'border rounded overflow-hidden hover:shadow-md transition';
                thumb.innerHTML = `
                    <a href="${page.image_url}" data-glightbox="title: Страница ${globalPageNum}">
                        <img src="${page.image_url}" alt="Страница ${globalPageNum}" class="w-full object-contain">
                        <div class="p-2 text-center bg-gray-50 border-t">
                            <span class="text-xs font-medium">Стр. ${globalPageNum++}</span>
                        </div>
                    </a>
                `;
                thumbsContainer.appendChild(thumb);
            });
            
            docContainer.appendChild(thumbsContainer);
            previewContainer.appendChild(docContainer);
        });
        
        this.totalPages = globalPageNum - 1;
        this.rangesContainer.innerHTML = '';
        this.addRange(1, this.totalPages);
        
        // Инициализация GLightbox
        if (window._glightbox) {
            window._glightbox.reload();
        }
    }

    addRange(from = null, to = null) {
        const ranges = this.getRanges();
        const lastRange = ranges[ranges.length - 1];
        const docNumber = ranges.length + 1;
        
        if (!from || !to) {
            if (lastRange) {
                from = lastRange.to < this.totalPages ? lastRange.to + 1 : this.totalPages;
                to = this.totalPages;
            } else {
                from = 1;
                to = this.totalPages;
            }
        }

        const rangeElement = document.createElement('div');
        rangeElement.className = 'space-y-2 bg-white p-4 rounded-lg border';
        rangeElement.innerHTML = `
            <div class="range-container">
                <div class="flex justify-between items-center mb-2">
                    <input type="text" 
                        value="Документ ${docNumber}" 
                        class="document-name border rounded px-2 py-1 w-40 text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Название документа">
                    <button type="button" class="remove-range text-red-500 hover:text-red-700 cursor-pointer ${ranges.length === 0 ? 'hidden' : ''}">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                    </button>
                </div>
                <div class="flex items-center space-x-3 mb-2">
                    <select class="document-type border rounded px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 cursor-pointer">
                        <option value="14">Протокол к договору</option>
                        <option value="15">Приложение к договору</option>
                        <option value="16">Доп.соглашение</option>
                        <option value="91">Договор с покупателем</option>
                        <option value="93">Письма</option>
                        <option value="134" selected>Прочие документы</option>
                    </select>
                </div>
                <div class="flex items-center space-x-3">
                    <span class="text-gray-700 whitespace-nowrap">От страницы</span>
                    <input type="number" min="1" max="${this.totalPages}" value="${from}" 
                        class="range-input from-input w-16 px-2 py-1 border rounded">
                    <span class="text-gray-700 whitespace-nowrap">к</span>
                    <input type="number" min="1" max="${this.totalPages}" value="${to}" 
                        class="range-input to-input w-16 px-2 py-1 border rounded">
                </div>
            </div>
        `;
        
        const removeBtn = rangeElement.querySelector('.remove-range');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                if (this.rangesContainer.children.length > 1) {
                    rangeElement.remove();
                    this.renumberDocuments(); // Пересчитываем номера документов
                    this.updateRemoveButtonsVisibility();
                }
            });
        }
        
        this.rangesContainer.appendChild(rangeElement);
        this.updateRemoveButtonsVisibility();
        
        // Обновляем значения при изменении
        const fromInput = rangeElement.querySelector('.from-input');
        const toInput = rangeElement.querySelector('.to-input');
        
        fromInput.addEventListener('change', () => {
            const fromValue = parseInt(fromInput.value);
            const toValue = parseInt(toInput.value);
            
            if (fromValue > toValue) {
                toInput.value = fromValue;
            }
        });
        
        toInput.addEventListener('change', () => {
            const fromValue = parseInt(fromInput.value);
            const toValue = parseInt(toInput.value);
            
            if (toValue < fromValue) {
                fromInput.value = toValue;
            }
        });
    }

    renumberDocuments() {
        // Получаем все контейнеры диапазонов
        const rangeContainers = this.rangesContainer.querySelectorAll('.range-container');
        
        // Проверяем наличие диапазонов
        if (!rangeContainers || rangeContainers.length === 0) return;

        // Перебираем и переименовываем с проверкой каждого элемента
        Array.from(rangeContainers).forEach((container, index) => {
            try {
                const titleElement = container.querySelector('.document-title');
                
                // Проверяем существование элемента и актуальность названия
                if (titleElement) {
                    const newTitle = `Документ ${index + 1}`;
                    
                    // Обновляем только если название изменилось
                    if (titleElement.textContent !== newTitle) {
                        titleElement.textContent = newTitle;
                    }
                } else {
                    console.warn('Элемент заголовка не найден в диапазоне', container);
                }
            } catch (error) {
                console.error('Ошибка при переименовании документа:', error);
            }
        });
    }

    updateRemoveButtonsVisibility() {
        const ranges = this.rangesContainer.children;
        const showRemoveButtons = ranges.length > 1;
        
        Array.from(ranges).forEach((range, index) => {
            const removeBtn = range.querySelector('.remove-range');
            if (removeBtn) {
                if (showRemoveButtons) {
                    removeBtn.classList.remove('hidden');
                } else {
                    removeBtn.classList.add('hidden');
                }
            }
        });
    }

    resetForm() {
        // 1. Переключаем видимость контейнеров
        this.previewContainer.classList.add('hidden');
        document.getElementById('upload-container').classList.remove('hidden');
        
        // 2. Очищаем информацию о файле (добавлено)
        this.hideFileInfo();
        
        // 3. Сбрасываем значение файлового ввода (добавлено)
        this.fileInput.value = '';
        
        // 4. Блокируем кнопку загрузки
        this.uploadButton.disabled = true;
        
        // 5. Возвращаем центрирование
        document.body.classList.add('justify-center');
        
        // 6. Очищаем сообщения об ошибках (добавлено)
        const errorElement = this.uploadForm.querySelector('.upload-error');
        if (errorElement) errorElement.remove();
    }

    async handleSplit() {
        const originalHtml = this.splitButton.innerHTML;
        this.splitButton.disabled = true;
        this.splitButton.innerHTML = `
            <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <!-- spinner icon -->
            </svg>
            Обработка...
        `;

        try {
            const response = await fetch(this.previewContainer.dataset.downloadUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-TOKEN': this.previewContainer.dataset.csrfToken,
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    documents: this.uploadedDocuments,
                    ranges: this.getRanges()
                })
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.message || 'Ошибка сервера');
            
            this.showDownloadButton(data.download_url, data.filename);

        } catch (error) {
            this.showSplitError(error.message);
        } finally {
            this.splitButton.disabled = false;
            this.splitButton.innerHTML = originalHtml;
        }
    }

    showDownloadButton(downloadUrl, filename) {
        // Удаляем предыдущую кнопку, если есть
        const oldButton = document.getElementById('download-button-container');
        if (oldButton) oldButton.remove();
        
        // Создаем контейнер для кнопки
        const container = document.createElement('div');
        container.id = 'download-button-container';
        container.className = 'mt-4';
        
        // Создаем кнопку с такими же стилями как "Разделить PDF"
        const downloadBtn = document.createElement('a');
        downloadBtn.href = downloadUrl;
        downloadBtn.className = 'flex items-center justify-center px-4 py-2 bg-green-600 border border-transparent rounded-md font-semibold text-xs text-white uppercase tracking-widest hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition ease-in-out duration-150';
        downloadBtn.download = filename;
        downloadBtn.innerHTML = `
            <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
            </svg>
            Скачать файлы
        `;
        
        container.appendChild(downloadBtn);
        
        // Вставляем после кнопки "Разделить PDF"
        this.splitButton.parentNode.insertBefore(container, this.splitButton.nextSibling);
    }

    // Новый метод для генерации имени архива
    generateArchiveName(fileId) {
        const now = new Date();
        const timestamp = `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}-${now.getMinutes().toString().padStart(2, '0')}`;
        return `pdf_ranges_${fileId}_${timestamp}.zip`;
    }

    // Новый метод для показа ошибок при разделении
    showSplitError(message) {
        // Создаем или находим контейнер для ошибок
        let errorContainer = document.getElementById('split-error-container');
        if (!errorContainer) {
            errorContainer = document.createElement('div');
            errorContainer.id = 'split-error-container';
            errorContainer.className = 'mt-4 p-4 bg-red-50 text-red-600 rounded';
            this.previewContainer.appendChild(errorContainer);
        }
        
        errorContainer.textContent = message;
        
        // Автоматическое скрытие через 5 секунд
        setTimeout(() => {
            errorContainer.remove();
        }, 5000);
    }

    getRanges() {
        const ranges = [];
        const rangeElements = this.rangesContainer.children;
        
        Array.from(rangeElements).forEach(rangeEl => {
            try {
                const fromInput = rangeEl.querySelector('.from-input');
                const toInput = rangeEl.querySelector('.to-input');
                const nameInput = rangeEl.querySelector('.document-name');
                const typeSelect = rangeEl.querySelector('.document-type');
                
                const from = parseInt(fromInput.value);
                const to = parseInt(toInput.value);
                const name = nameInput.value.trim();
                const type = typeSelect.value;
                
                if (!isNaN(from) && !isNaN(to) && from <= to) {
                    ranges.push({
                        range: `${from}-${to}`,
                        name: name || `Документ ${ranges.length + 1}`,
                        type: type
                    });
                }
            } catch (e) {
                console.error('Ошибка обработки диапазона:', e);
            }
        });
        
        return ranges;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new PdfSplitter();
});