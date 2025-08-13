class PdfSplitter {
    constructor() {
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

        // Обработчики событий
        const highlight = () => {
            uploadArea.classList.add('border-blue-500', 'bg-blue-50');
            uploadArea.classList.remove('border-gray-300');
        };

        const unhighlight = () => {
            uploadArea.classList.remove('border-blue-500', 'bg-blue-50');
            uploadArea.classList.add('border-gray-300');
        };

        // События drag and drop
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

        // Обработка сброса файла
        uploadArea.addEventListener('drop', (e) => {
            const file = e.dataTransfer.files[0];
            if (file && file.type === 'application/pdf') {
                this.fileInput.files = e.dataTransfer.files;
                this.showSelectedFile(file.name);
                if (this.uploadButton) {
                    this.uploadButton.disabled = false;
                }
                
                // Визуальная обратная связь об успешной загрузке
                uploadArea.classList.add('border-green-500');
                setTimeout(() => uploadArea.classList.remove('border-green-500'), 1000);
            }
        });
    }

    handleFileChange(e) {
        const file = e.target.files[0];
        if (file) {
            this.showSelectedFile(file.name);
            if (this.uploadButton) {
                this.uploadButton.disabled = false;
            }
            
            // Удаляем сообщения об ошибках при успешном выборе
            const errorElement = this.uploadForm.querySelector('.upload-error');
            if (errorElement) errorElement.remove();
        }
    }

    showSelectedFile(filename) {
        const container = document.querySelector('.file-info-container');
        const fileNameSpan = document.querySelector('.file-name');
        
        if (container && fileNameSpan) {
            fileNameSpan.textContent = filename;
            container.classList.remove('hidden');
            container.style.animation = 'fadeIn 0.3s ease-out';
            
            // Также добавим визуальное подтверждение в области загрузки
            const uploadArea = document.getElementById('upload-area');
            if (uploadArea) {
                uploadArea.classList.add('border-green-500');
                setTimeout(() => uploadArea.classList.remove('border-green-500'), 1000);
            }
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
        
        // Явная проверка выбора файла
        if (!this.fileInput.files || this.fileInput.files.length === 0) {
            this.showFileError('Пожалуйста, выберите PDF файл');
            return;
        }

        const file = this.fileInput.files[0]; // Добавляем получение файла
        
        // Проверка типа файла
        if (file.type !== 'application/pdf') {
            this.showFileError('Пожалуйста, выберите файл в формате PDF');
            return;
        }

        // Блокируем кнопку на время загрузки
        const originalButtonText = this.uploadButton.textContent;
        this.uploadButton.disabled = true;
        this.uploadButton.innerHTML = `
            <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Загрузка...
        `;

        try {
            const formData = new FormData();
            formData.append('pdf', file);
            formData.append('_token', document.querySelector('input[name="_token"]').value);

            const response = await fetch(this.uploadForm.action, {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                this.showPreview(data);
            } else {
                throw new Error(data.message || 'Произошла ошибка при обработке файла');
            }
        } catch (error) {
            console.error('Error:', error);
            this.showFileError(error.message || 'Произошла ошибка при загрузке файла');
        } finally {
            this.uploadButton.disabled = false;
            this.uploadButton.textContent = originalButtonText;
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

    showPreview(data) {
        if (!data.session_id) {
            console.error('Отсутствует session_id в данных');
            return;
        }
        // Сохраняем данные PDF в контейнере
        this.previewContainer.dataset.pdfInfo = JSON.stringify({
            session_id: data.session_id,
            pdf_path: data.pdf_path,  // Добавляем путь к файлу
            original_name: data.original_name
        });
        // Убираем центрирование у body
        document.body.classList.remove('justify-center');
        
        // Показываем preview с отступами
        this.previewContainer.classList.remove('hidden');
        this.previewContainer.classList.add('px-4', 'py-6');

        // Сохраняем данные документа
        this.totalPages = data.pages.length;
        this.pdfTitle.textContent = data.original_name;
        
        // Скрываем форму загрузки
        document.getElementById('upload-container').classList.add('hidden');

        // Очищаем и создаём миниатюры страниц
        this.thumbnailsContainer.innerHTML = '';
        data.pages.forEach((page, index) => {
            const thumb = document.createElement('a');
            thumb.href = page.image_url;
            thumb.dataset.glightbox = `title: Страница ${page.number}`;
            thumb.className = 'block border rounded overflow-hidden hover:shadow-md transition';
            thumb.innerHTML = `
                <img src="${page.image_url}" 
                    alt="Страница ${page.number}"
                    class="w-full object-cover">
                <div class="p-2 text-center bg-gray-50 border-t">
                    <span class="text-sm font-medium">Стр. ${page.number}</span>
                </div>
            `;
            this.thumbnailsContainer.appendChild(thumb);
        });

        // Инициализируем/обновляем GLightbox
        if (window._glightbox) {
            window._glightbox.reload();
        }

        // Очищаем и создаём диапазоны
        this.rangesContainer.innerHTML = '';
        
        // Создаём первый диапазон (от 1 до последней страницы)
        this.addRange(1, this.totalPages);

        // Обновляем видимость кнопок удаления
        this.updateRemoveButtonsVisibility();
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
                <div class="flex justify-between items-center">
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
                <div class="flex items-center space-x-3 mt-2">
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
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Обработка...
        `;

        try {
            const pdfData = JSON.parse(this.previewContainer.dataset.pdfInfo);
            const ranges = this.getRanges(); // Теперь получаем массив объектов
            
            const response = await fetch('/pdf/download-ranges', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-TOKEN': this.previewContainer.dataset.csrfToken,
                    'X-Requested-With': 'XMLHttpRequest',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    session_id: pdfData.session_id,
                    pdf_path: pdfData.pdf_path,
                    ranges: ranges, // Теперь передаем объекты с range и name
                    original_name: pdfData.original_name
                })
            });

            // Проверяем content-type перед парсингом
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                const text = await response.text();
                throw new Error(`Ожидался JSON, получен: ${text.substring(0, 100)}...`);
            }

            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.message || 'Ошибка сервера');
            }

            // Показываем кнопку скачивания
            this.showDownloadButton(data.download_url, data.filename);

        } catch (error) {
            console.error('Split Error:', error);
            this.showSplitError(
                error.message.includes('<!DOCTYPE html>') 
                    ? 'Сервер вернул HTML вместо JSON (проверьте URL)' 
                    : error.message
            );
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
                
                const from = parseInt(fromInput.value);
                const to = parseInt(toInput.value);
                const name = nameInput.value.trim(); // Получаем введенное название
                
                if (!isNaN(from) && !isNaN(to)) {
                    if (from <= to) {
                        ranges.push({
                            range: `${from}-${to}`, // Диапазон страниц (как было)
                            name: name // Новое поле - название документа
                        });
                    }
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