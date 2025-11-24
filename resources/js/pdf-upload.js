class PdfSplitter {
    constructor() {
        this.uploadedDocuments = [];
        this.pendingUrls = [];
        this.uploadForm = document.getElementById('upload-form');
        this.fileInput = document.getElementById('pdf');
        this.previewContainer = document.getElementById('preview-container');
        this.thumbnailsContainer = document.getElementById('thumbnails-container');
        this.pdfTitle = document.getElementById('pdf-title');
        this.backButton = document.getElementById('back-button');
        this.rangesContainer = document.getElementById('ranges-container');
        this.addRangeBtn = document.getElementById('add-range');
        this.splitButton = document.getElementById('split-button');
        this.documentStatuses = new Map(); // Храним статусы документов

        this.counterpartySelect = document.getElementById('counterparty-select');
        this.selectedCounterparty = null;
        this.isResultsVisible = false;

        this.pageRotations = {}; // Храним повороты страниц: {pageNum: degrees}
        this.rotationIndicators = {}; // Для хранения индикаторов поворота

        // Явно находим кнопку загрузки
        this.uploadButton = this.uploadForm.querySelector('button[type="submit"]');
        
        this._totalPages = 0;
        this.currentMaxPage = 0; // Текущая максимальная страница для новых диапазонов
        this.rangeCounter = 0; // Добавляем счетчик диапазонов
        
        this.initEventListeners();
        this.setupDragAndDrop();
        this.initCustomCounterpartySelect();
        this.initAddFilesFunctionality();

        if (!this.splitButton) {
            console.error('Элемент split-button не найден');
            return;
        }

        if (!this.previewContainer) {
            console.error('Элемент preview-container не найден');
            return;
        }
    }

    get totalPages() {
        return this._totalPages;
    }

    set totalPages(value) {
        this._totalPages = value;
        // Обновляем max-атрибуты всех range-инпутов
        document.querySelectorAll('.from-input, .to-input').forEach(input => {
            input.setAttribute('max', this._totalPages);
        });
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
            const items = e.dataTransfer.items;
            
            // Проверяем, есть ли среди перетаскиваемых элементов ссылки
            let hasUrls = false;
            let hasFiles = false;
            
            // Сначала проверяем ссылки
            for (let i = 0; i < items.length; i++) {
                if (items[i].type === 'text/uri-list') {
                    hasUrls = true;
                    break;
                }
                if (items[i].kind === 'file') {
                    hasFiles = true;
                }
            }
            
            // Если есть ссылки - обрабатываем их
            if (hasUrls) {
                e.dataTransfer.items[0].getAsString((url) => {
                    if (this.isValidFileUrl(url)) {
                        this.handleUrlDrop(url);
                    } else {
                        this.showFileError('Некорректная ссылка. Поддерживаются только ссылки на PDF и MSG файлы');
                    }
                });
            } 
            // Если есть файлы - обрабатываем их
            else if (hasFiles) {
                const files = e.dataTransfer.files;
                
                if (files.length > 0) {
                    // Очищаем предыдущие ошибки
                    this.clearFileError();
                    // Проверяем типы файлов перед установкой
                    const invalidFiles = this.validateFileTypes(files);

                    if (invalidFiles.length > 0) {
                        this.showFileError(`Вы пытаетесь загрузить недопустимый тип файла: ${invalidFiles.map(f => f.name).join(', ')}. Разрешены только PDF и MSG.`);
                        return; // Не добавляем файлы
                    }

                    // Создаем искусственное событие change для fileInput
                    this.fileInput.files = files;
                    const event = new Event('change', { bubbles: true });
                    this.fileInput.dispatchEvent(event);
                    
                    uploadArea.classList.add('border-green-500');
                    setTimeout(() => uploadArea.classList.remove('border-green-500'), 1000);
                }
            }
        });
    }

    // Проверка валидности URL файла
    isValidFileUrl(url) {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname.toLowerCase();
            
            // Получаем расширение файла
            const extension = pathname.split('.').pop();
            const isSupportedExtension = (extension === 'pdf' || extension === 'msg');
            const isHttpProtocol = (urlObj.protocol === 'http:' || urlObj.protocol === 'https:');
           
            if (!isHttpProtocol) {
                this.showNotification('Ссылка должна использовать HTTP или HTTPS протокол', 'error');
                return false;
            }
            
            if (!isSupportedExtension) {
                this.showNotification(
                    `Неподдерживаемый тип файла: .${extension}. Разрешены только .pdf и .msg файлы`, 
                    'error'
                );
                return false;
            }
            
            return true;
            
        } catch (error) {
            console.log('URL validation failed:', error);
            this.showNotification('Некорректная ссылка', 'error');
            return false;
        }
    }

    // Получение имени файла из URL
    getFileNameFromUrl(url) {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            const fileName = pathname.split('/').pop() || 'file_from_url';
            return decodeURIComponent(fileName);
        } catch {
            return 'file_from_url';
        }
    }

    // Обработка перетаскивания URL - просто добавляем в список
    handleUrlDrop(url) {
        if (!this.isValidFileUrl(url)) {
            this.showFileError('Некорректная ссылка. Поддерживаются только ссылки на PDF и MSG файлы');
            return;
        }

        // Добавляем URL в массив ожидающих загрузки
        this.pendingUrls.push(url);
        
        // Вызываем handleFileChange для обновления интерфейса и проверок
        // Создаем искусственное событие
        const event = new Event('change', { bubbles: true });
        Object.defineProperty(event, 'target', {
            value: this.fileInput,
            writable: false
        });
        this.handleFileChange(event);
    }

    initAddFilesFunctionality() {
        const addMoreBtn = document.getElementById('addMoreFiles');
        const additionalFilesInput = document.getElementById('additionalFiles');
        const globalDropOverlay = document.getElementById('globalDropOverlay');
        const previewContainer = document.getElementById('preview-container');
        
        // Обработчик кнопки "Добавить файлы"
        addMoreBtn.addEventListener('click', () => {
            additionalFilesInput.click();
        });
        
        // Обработчик выбора файлов через input
        additionalFilesInput.addEventListener('change', (e) => {
            this.handleAdditionalFiles(e.target.files);
            e.target.value = ''; // Сбрасываем значение
        });
        
        // Глобальный drag & drop для всей страницы preview
        this.setupGlobalDropZone(previewContainer, globalDropOverlay);
    }

    // Глобальный drag & drop для контейнера preview
    setupGlobalDropZone(previewContainer, dropOverlay) {
        let dragCounter = 0;
        let isDragging = false;
        
        const preventDefaults = (e) => {
            e.preventDefault();
            e.stopPropagation();
        };
        
        // Обработчики для всей страницы
        const events = ['dragenter', 'dragover', 'dragleave', 'drop'];
        
        events.forEach(eventName => {
            document.addEventListener(eventName, preventDefaults, false);
        });
        
        // Показываем overlay при dragenter
        document.addEventListener('dragenter', (e) => {
            // Проверяем, что перетаскиваются файлы ИЛИ ссылки
            if (e.dataTransfer.types && 
                (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('text/uri-list'))) {
                dragCounter++;
                isDragging = true;
                
                if (dragCounter === 1) {
                    dropOverlay.classList.remove('hidden');
                }
            }
        }, false);
        
        // dragover - ничего не делаем, только предотвращаем стандартное поведение
        document.addEventListener('dragover', preventDefaults, false);
        
        // dragleave - уменьшаем счетчик когда вышли из документа
        document.addEventListener('dragleave', (e) => {
            // Проверяем, что курсор вышел за пределы окна браузера
            if (e.clientX <= 0 || e.clientY <= 0 || 
                e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
                dragCounter = 0;
                isDragging = false;
                dropOverlay.classList.add('hidden');
            }
        }, false);
        
        // drop - обрабатываем файлы/ссылки и сбрасываем счетчик
        document.addEventListener('drop', (e) => {
            preventDefaults(e);
            
            // Сбрасываем состояние
            dragCounter = 0;
            isDragging = false;
            dropOverlay.classList.add('hidden');
            
            // Проверяем, что элементы перетащены в область preview контейнера
            const previewRect = previewContainer.getBoundingClientRect();
            const isInPreviewArea = e.clientX >= previewRect.left && 
                                e.clientX <= previewRect.right &&
                                e.clientY >= previewRect.top && 
                                e.clientY <= previewRect.bottom;
            
            if (isInPreviewArea) {
                // Получаем URL из text/uri-list
                let url = null;
                if (e.dataTransfer.types.includes('text/uri-list')) {
                    url = e.dataTransfer.getData('text/uri-list');
                }
                
                // Если нашли URL - обрабатываем
                if (url) {
                    if (this.isValidFileUrl(url)) {
                        this.processUrlInPreview(url);
                    }
                    // Если URL невалидный - isValidFileUrl уже показал уведомление
                    return; // Важно: выходим после обработки URL
                }
                
                // Если нет URL, проверяем файлы
                if (e.dataTransfer.files.length > 0) {
                    this.handleAdditionalFiles(e.dataTransfer.files);
                } else {
                    console.log('No files or URL found in drop');
                }
            }
        }, false);
        
        // Дополнительная защита - скрываем overlay при клике или ESC
        document.addEventListener('click', () => {
            if (isDragging) {
                dragCounter = 0;
                isDragging = false;
                dropOverlay.classList.add('hidden');
            }
        });
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && isDragging) {
                dragCounter = 0;
                isDragging = false;
                dropOverlay.classList.add('hidden');
            }
        });
        
        // Защита от "зависшего" overlay при перезагрузке или навигации
        window.addEventListener('beforeunload', () => {
            dropOverlay.classList.add('hidden');
        });
    }

    // Обработка URL в режиме preview
    async processUrlInPreview(url) {
        try {
            this.showNotification('Загружаем файл по ссылке...', 'info');
            
            await this.processSingleUrl(url);
            
            // После успешной загрузки обновляем preview
            this.showPreview();
            this.showNotification('Файл успешно добавлен по ссылке', 'success');
            
        } catch (error) {
            console.error('URL upload in preview failed:', error);
            this.showNotification('Ошибка при добавлении файла по ссылке: ' + error.message, 'error');
        }
    }

    // Обработка дополнительных файлов
    async handleAdditionalFiles(files) {
        if (files.length === 0) return;
        
        // Показываем индикатор загрузки
        this.showNotification(`Загружаем ${files.length} файл(ов)...`, 'info');
        
        try {
            const formData = new FormData();
            Array.from(files).forEach(file => {
                formData.append('pdf_files[]', file);
            });
            
            const response = await fetch('/upload-additional', {
                method: 'POST',
                headers: {
                    'X-CSRF-TOKEN': this.previewContainer.dataset.csrfToken,
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: formData
            });
            
            if (!response.ok) throw new Error('Ошибка загрузки');
            
            const result = await response.json();
            
            if (result.success) {
                // Добавляем новые документы к существующим
                this.uploadedDocuments = [...this.uploadedDocuments, ...result.documents];
                
                // Пересоздаем preview с обновленными документами
                this.showPreview();
                
                this.showNotification(`Добавлено ${result.documents.length} файл(ов)`, 'success');
            } else {
                throw new Error(result.message || 'Ошибка обработки файлов');
            }
            
        } catch (error) {
            console.error('Error adding files:', error);
            this.showNotification('Ошибка при добавлении файлов', 'error');
        }
    }

    validateFileTypes(files) {
        const allowedExtensions = ['pdf', 'msg'];
        
        return Array.from(files).filter(file => {
            const extension = file.name.toLowerCase().split('.').pop();
            return !allowedExtensions.includes(extension);
        });
    }

    handleFileChange(e) {
        const files = e.target.files;

        // Очищаем ошибку при новом выборе файлов
        this.clearFileError();
        
        if (files.length > 0 || this.pendingUrls.length > 0) {
            // Проверяем типы файлов (только для обычных файлов)
            const invalidFiles = this.validateFileTypes(files);

            if (invalidFiles.length > 0) {
                this.showFileError(`Вы пытаетесь загрузить недопустимый тип файла: ${invalidFiles.map(f => f.name).join(', ')}. Разрешены только PDF и MSG.`);
                this.fileInput.value = ''; // Очищаем input
                this.pendingUrls = []; // Очищаем URL тоже
                this.showSelectedFiles(this.fileInput.files, this.pendingUrls);
                return;
            }

            this.showSelectedFiles(files, this.pendingUrls);
            this.uploadButton.disabled = false;
        } else {
            // Если нет ни файлов ни URL - деактивируем кнопку
            this.uploadButton.disabled = true;
            // Скрываем контейнер с файлами
            const container = document.querySelector('.file-info-container');
            if (container) {
                container.classList.add('hidden');
            }
        }
    }

    showSelectedFiles(fileList, urlList = []) {
        const container = document.querySelector('.file-info-container');
        const fileNameSpan = document.querySelector('.file-name');
        
        if (container && fileNameSpan) {
            // Очищаем предыдущее содержимое
            fileNameSpan.innerHTML = '';
            
            // Преобразуем FileList в массив
            const files = Array.from(fileList || []);
            const urls = urlList || [];
            
            const allItems = [];
            
            // Добавляем обычные файлы
            files.forEach((file, index) => {
                allItems.push({
                    type: 'file',
                    name: file.name,
                    index: index,
                    isPDF: file.name.toLowerCase().endsWith('.pdf'),
                    isMSG: file.name.toLowerCase().endsWith('.msg')
                });
            });
            
            // Добавляем URL
            urls.forEach((url, index) => {
                const fileName = this.getFileNameFromUrl(url);
                allItems.push({
                    type: 'url',
                    name: fileName,
                    url: url,
                    index: index,
                    isPDF: fileName.toLowerCase().endsWith('.pdf'),
                    isMSG: fileName.toLowerCase().endsWith('.msg')
                });
            });
            
            // Создаем список файлов и URL (БЕЗ КНОПОК УДАЛЕНИЯ)
            allItems.forEach((item, globalIndex) => {
                const fileElement = document.createElement('div');
                fileElement.className = 'file-item flex items-center mb-1 last:mb-0'; // Убрали justify-between
                
                let icon = '';
                
                if (item.type === 'file') {
                    icon = item.isPDF 
                        ? '<svg class="w-4 h-4 mr-2 text-red-500" fill="currentColor" viewBox="0 0 20 20"><path d="M9 2a2 2 0 00-2 2v8a2 2 0 002 2h6a2 2 0 002-2V6.414A2 2 0 0016.414 5L14 2.586A2 2 0 0012.586 2H9z"/></svg>'
                        : '<svg class="w-4 h-4 mr-2 text-blue-500" fill="currentColor" viewBox="0 0 20 20"><path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z"/><path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z"/></svg>';
                } else {
                    // Для URL используем иконку ссылки
                    icon = '<svg class="w-4 h-4 mr-2 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path></svg>';
                }
                
                fileElement.innerHTML = `
                    <div class="flex items-center truncate">
                        ${icon}
                        <span class="text-sm truncate" title="${item.type === 'url' ? item.url : item.name}">${item.name}</span>
                    </div>
                `;
                
                fileNameSpan.appendChild(fileElement);
            });
            
            // Показываем контейнер
            container.classList.remove('hidden');
            
            // Автоматически расширяем блок если много файлов
            if (allItems.length > 2) {
                container.classList.add('overflow-y-auto', 'max-h-32');
            }
            
            // Активируем кнопку загрузки если есть файлы или URL
            this.uploadButton.disabled = allItems.length === 0;
            
            // УБИРАЕМ обработчики для кнопок удаления - их больше нет
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
                    fileNameSpan.innerHTML = '';
                }
                fileInfoContainer.style.animation = '';
                fileInfoContainer.classList.remove('overflow-y-auto', 'max-h-32');
            }, 300);
        }
    }

    async handleSubmit(e) {
        e.preventDefault();
        const files = Array.from(this.fileInput.files);
        const hasFiles = files.length > 0;
        const hasUrls = this.pendingUrls.length > 0;

        // Очищаем предыдущие ошибки
        this.clearFileError();
        
        if (!hasFiles && !hasUrls) {
            this.showFileError('Пожалуйста, выберите файлы или добавьте ссылки');
            return;
        }

        // Дополнительная проверка перед отправкой (только для файлов)
        if (hasFiles) {
            const invalidFiles = this.validateFileTypes(files);
            if (invalidFiles.length > 0) {
                this.showFileError(`Недопустимые типы файлов: ${invalidFiles.map(f => f.name).join(', ')}. Разрешены только PDF и MSG.`);
                return;
            }
        }

        // Частичный сброс (сохраняем выбранные файлы)
        this.resetForm(true);
        
        const totalItems = files.length + this.pendingUrls.length;
        this.showLoader(totalItems);
        const originalButtonHtml = this.uploadButton.innerHTML;

        try {
            // Обрабатываем URL если есть
            if (hasUrls) {
                for (const url of this.pendingUrls) {
                    await this.processSingleUrl(url);
                }
            }
            
            // Обрабатываем локальные файлы если есть
            if (hasFiles) {
                await this.processLocalFiles(files);
            }
            
            // Если есть загруженные документы - показываем preview
            if (this.uploadedDocuments.length > 0) {
                this.showPreview();
                this.showNotification('Все файлы успешно загружены', 'success');
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

    // Обработка одного URL
    async processSingleUrl(url) {
        try {
            const response = await fetch('/upload-from-url', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-TOKEN': this.previewContainer.dataset.csrfToken,
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify({ url: url })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (result.success) {
                this.uploadedDocuments = [...this.uploadedDocuments, ...result.documents];
                this.sessionId = result.session_id;
            } else {
                throw new Error(result.message);
            }
            
        } catch (error) {
            throw new Error(`Ошибка загрузки по ссылке: ${error.message}`);
        }
    }

    // Обработка локальных файлов
    async processLocalFiles(files) {
        const formData = new FormData();
        
        // Добавляем все файлы
        files.forEach(file => {
            formData.append('pdf[]', file); // Важно: pdf[] для массива
        });
        
        formData.append('_token', document.querySelector('input[name="_token"]').value);
        
        // Добавляем флаг множественной загрузки
        if (files.length > 1) {
            formData.append('hasMultipleFiles', 'true');
        }

        const response = await fetch(this.uploadForm.action, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) throw new Error('HTTP error');
        
        const result = await response.json();
        
        if (result.success) {
            this.uploadedDocuments = [...this.uploadedDocuments, ...result.documents];
            this.sessionId = result.session_id;
        } else {
            throw new Error(result.message);
        }
    }

    showLoader(fileCount) {
        this.uploadButton.disabled = true;
        this.uploadButton.innerHTML = `
            <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Обработка ${fileCount} файлов...
        `;
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
        
        // Создаем новое сообщение об ошибке
        const errorElement = document.createElement('div');
        errorElement.className = 'upload-error text-red-500 text-sm mt-2 mb-3 text-center';
        errorElement.innerHTML = `
            <div class="flex items-center justify-center">
                <span class="mr-2">❌</span>
                <span>${message}</span>
            </div>
        `;
        
        // Вставляем после области загрузки
        const uploadArea = this.uploadForm.querySelector('.upload-area');
        uploadArea.insertAdjacentElement('afterend', errorElement);
        
        // Подсвечиваем область загрузки
        uploadArea.classList.add('border-red-500');
    }

    // Добавим метод для очистки ошибок
    clearFileError() {
        const oldError = this.uploadForm.querySelector('.upload-error');
        if (oldError) oldError.remove();
        
        const uploadArea = this.uploadForm.querySelector('.upload-area');
        if (uploadArea) {
            uploadArea.classList.remove('border-red-500');
        }
    }

    showPreview() {
        this.hideFileInfo();
        this.previewContainer.classList.remove('hidden');
        document.getElementById('upload-container').classList.add('hidden');
        
        const previewContainer = document.getElementById('documents-preview');
        previewContainer.innerHTML = '';
        
        this.totalPages = this.uploadedDocuments.reduce(
            (total, doc) => total + doc.pages.length, 
            0
        );
        
        let globalPageNum = 1;
        let currentPage = 1;
        
        this.rangesContainer.innerHTML = '';
        
        this.uploadedDocuments.forEach((doc, docIndex) => {
            const docPageCount = doc.pages.length;
            const docName = doc.original_name.replace(/\.pdf$/i, '');
            
            const rangeEnd = currentPage + docPageCount - 1;
            this.addRange(
                currentPage,
                rangeEnd,
                docName,
                true // isInitial = true
            );
            currentPage = rangeEnd + 1;
            
            const docContainer = document.createElement('div');
            docContainer.className = 'bg-white rounded-lg shadow-sm p-4 border border-gray-200 mb-6';
            docContainer.dataset.docIndex = docIndex;
            
            const title = document.createElement('h3');
            title.className = 'text-lg font-semibold text-gray-800 mb-3';
            title.textContent = `${docIndex + 1}. ${doc.original_name}`;
            docContainer.appendChild(title);
            
            const thumbsContainer = document.createElement('div');
            thumbsContainer.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3';
            
            doc.pages.forEach((page, pageIndex) => {
                const pageNumber = globalPageNum++;
                const thumb = document.createElement('div');
                thumb.className = 'thumbnail-page border-2 border-gray-200 rounded overflow-hidden hover:shadow-md transition';
                thumb.dataset.pageNumber = pageNumber;
                
                // Создаем контейнер для миниатюры и кнопки разделения
                const thumbContainer = document.createElement('div');
                thumbContainer.className = 'thumbnail-container';
                
                thumb.innerHTML = `
                    <a href="${page.image_url}" data-glightbox="title: Страница ${pageNumber}" class="block relative">
                        <img src="${page.image_url}" 
                            alt="Страница ${pageNumber}" 
                            class="w-full h-92 object-contain">
                    </a>
                    <div class="p-2 text-center bg-gray-50 border-t flex justify-between items-center">
                        <span class="text-xs font-medium">Стр. ${pageNumber}</span>
                        <span class="text-xs range-highlight hidden"></span>
                    </div>
                `;
                
                // Добавляем кнопку разделения (кроме последней страницы в диапазоне)
                if (pageIndex < doc.pages.length - 1) {
                    const splitBtn = document.createElement('button');
                    splitBtn.className = 'split-range-btn';
                    splitBtn.innerHTML = '➗';
                    splitBtn.title = 'Разделить диапазон здесь';
                    splitBtn.dataset.splitAfter = pageNumber;
                    splitBtn.dataset.docIndex = docIndex;
                    
                    splitBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.handleSplitRange(parseInt(e.target.dataset.splitAfter));
                    });
                    
                    thumbContainer.appendChild(thumb);
                    thumbContainer.appendChild(splitBtn);
                }
                // если есть следующий документ
                else if (pageIndex === doc.pages.length - 1 && docIndex < this.uploadedDocuments.length - 1) {
                    const mergeBtn = document.createElement('button');
                    mergeBtn.className = 'merge-range-btn';
                    mergeBtn.innerHTML = '➕';
                    mergeBtn.title = 'Объединить с следующим документом';
                    mergeBtn.dataset.afterPage = pageNumber; // ← Страница, после которой находится кнопка
                    mergeBtn.dataset.docIndex = docIndex;
                    
                    
                    mergeBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.handleMergeDocuments(parseInt(e.target.dataset.docIndex));
                    });
                    
                    thumbContainer.appendChild(thumb);
                    thumbContainer.appendChild(mergeBtn);
                }
                else {
                    thumbContainer.appendChild(thumb);
                }

                setTimeout(() => {
                    this.addRotationControlsToThumbnails();
                }, 100);

                thumbsContainer.appendChild(thumbContainer);
            });
            
            docContainer.appendChild(thumbsContainer);
            previewContainer.appendChild(docContainer);
        });
        
        // Инициализируем подсветку
        this.updateThumbnailsHighlight();
        
        if (window._glightbox) {
            window._glightbox.reload();
        }
    }

    handleSplitRange(splitAfterPage) {
        // Находим диапазон, который нужно разделить
        const rangeElements = this.rangesContainer.children;
        let targetRangeElement = null;
        let targetRangeIndex = -1;
        
        Array.from(rangeElements).forEach((element, index) => {
            const fromInput = element.querySelector('.from-input');
            const toInput = element.querySelector('.to-input');
            
            if (fromInput && toInput) {
                const from = parseInt(fromInput.value);
                const to = parseInt(toInput.value);
                
                if (splitAfterPage >= from && splitAfterPage < to) {
                    targetRangeElement = element;
                    targetRangeIndex = index;
                }
            }
        });
        
        if (!targetRangeElement) {
            this.showNotification('Не удалось найти диапазон для разделения', 'error');
            return;
        }
        
        // Подтверждение действия
        const fromInput = targetRangeElement.querySelector('.from-input');
        const toInput = targetRangeElement.querySelector('.to-input');
        const from = parseInt(fromInput.value);
        const to = parseInt(toInput.value);
        
        if (confirm(`Действительно разделить диапазон на страницы ${from}-${splitAfterPage} и ${splitAfterPage + 1}-${to}?`)) {
            // Обновляем первый диапазон
            toInput.value = splitAfterPage;
            
            // Создаем второй диапазон
            const docNameInput = targetRangeElement.querySelector('.document-name');
            const originalName = docNameInput.value;
            
            this.addRange(
                splitAfterPage + 1,
                to,
                `${originalName} (продолжение)`
            );
            
            this.showNotification('Диапазон успешно разделен', 'success');
        }
    }

    handleMergeDocuments(docIndex) {
        const ranges = this.getRanges();
        
        if (docIndex >= ranges.length - 1) {
            this.showNotification('Нет следующего документа для объединения', 'error');
            return;
        }
        
        const currentRange = ranges[docIndex];
        const nextRange = ranges[docIndex + 1];
        
        if (confirm(`Действительно объединить диапазоны ${currentRange.from}-${currentRange.to} и ${nextRange.from}-${nextRange.to}?`)) {
            // Обновляем правую границу текущего диапазона
            const rangeElements = this.rangesContainer.children;
            const currentRangeElement = rangeElements[docIndex];
            const toInput = currentRangeElement.querySelector('.to-input');
            toInput.value = nextRange.to;
            
            // Обновляем имя если нужно
            const nameInput = currentRangeElement.querySelector('.document-name');
            const nextNameInput = rangeElements[docIndex + 1].querySelector('.document-name');
            if (nameInput.value !== nextNameInput.value) {
                nameInput.value = `${nameInput.value} + ${nextNameInput.value}`;
            }
            
            // Удаляем следующий диапазон
            rangeElements[docIndex + 1].remove();
            
            // Просто обновляем видимость кнопок
            this.updateThumbnailsHighlight();
            this.showNotification('Диапазоны успешно объединены', 'success');
        }
    }

    updateThumbnailsHighlight() {
        // Сбрасываем все подсветки
        document.querySelectorAll('.thumbnail-page').forEach(thumb => {
            // Все возможные цветовые классы для удаления
            const colorTypes = ['blue', 'green', 'yellow', 'purple', 'pink', 'indigo',
                            'red', 'teal', 'orange', 'cyan', 'lime', 'amber',
                            'emerald', 'violet', 'fuchsia', 'rose', 'sky', 'gray'];
            
            const classesToRemove = [];
            colorTypes.forEach(color => {
                classesToRemove.push(
                    `border-${color}-500`, 
                    `shadow-${color}-100`,
                    `border-${color}-300`,
                    `bg-${color}-50`
                );
            });
            
            thumb.classList.remove(...classesToRemove);
            
            // Убираем перечеркивание
            thumb.classList.remove('opacity-60', 'line-through');
            
            // Базовые классы
            thumb.className = 'thumbnail-page border-2 rounded overflow-hidden hover:shadow-md transition';
            
            // Добавляем серую рамку по умолчанию
            thumb.classList.add('border-gray-200');
            
            // Удаляем старые бейджи
            const badge = thumb.querySelector('.range-highlight');
            if (badge) {
                badge.remove();
            }
        });
        
        // Получаем текущие диапазоны
        const rangeElements = this.rangesContainer.children;
        
        // Массив полных классов Tailwind для каждого цвета
        const colorStyles = [
            { border: 'border-blue-500', shadow: 'shadow-blue-100', bg: 'bg-blue-100', text: 'text-blue-800' },
            { border: 'border-green-500', shadow: 'shadow-green-100', bg: 'bg-green-100', text: 'text-green-800' },
            { border: 'border-yellow-500', shadow: 'shadow-yellow-100', bg: 'bg-yellow-100', text: 'text-yellow-800' },
            { border: 'border-purple-500', shadow: 'shadow-purple-100', bg: 'bg-purple-100', text: 'text-purple-800' },
            { border: 'border-pink-500', shadow: 'shadow-pink-100', bg: 'bg-pink-100', text: 'text-pink-800' },
            { border: 'border-indigo-500', shadow: 'shadow-indigo-100', bg: 'bg-indigo-100', text: 'text-indigo-800' },
            { border: 'border-red-500', shadow: 'shadow-red-100', bg: 'bg-red-100', text: 'text-red-800' },
            { border: 'border-teal-500', shadow: 'shadow-teal-100', bg: 'bg-teal-100', text: 'text-teal-800' },
            { border: 'border-orange-500', shadow: 'shadow-orange-100', bg: 'bg-orange-100', text: 'text-orange-800' },
            { border: 'border-cyan-500', shadow: 'shadow-cyan-100', bg: 'bg-cyan-100', text: 'text-cyan-800' },
            { border: 'border-lime-500', shadow: 'shadow-lime-100', bg: 'bg-lime-100', text: 'text-lime-800' },
            { border: 'border-amber-500', shadow: 'shadow-amber-100', bg: 'bg-amber-100', text: 'text-amber-800' },
            { border: 'border-emerald-500', shadow: 'shadow-emerald-100', bg: 'bg-emerald-100', text: 'text-emerald-800' },
            { border: 'border-violet-500', shadow: 'shadow-violet-100', bg: 'bg-violet-100', text: 'text-violet-800' },
            { border: 'border-fuchsia-500', shadow: 'shadow-fuchsia-100', bg: 'bg-fuchsia-100', text: 'text-fuchsia-800' },
            { border: 'border-rose-500', shadow: 'shadow-rose-100', bg: 'bg-rose-100', text: 'text-rose-800' },
            { border: 'border-sky-500', shadow: 'shadow-sky-100', bg: 'bg-sky-100', text: 'text-sky-800' }
        ];
        
        // Собираем все страницы, которые входят в диапазоны
        const pagesInRanges = new Set();
        
        Array.from(rangeElements).forEach((rangeElement, rangeIndex) => {
            // Получаем исходный индекс цвета из data-атрибута
            const originalColorIndex = parseInt(rangeElement.getAttribute('data-color-index')) || rangeIndex;
            const style = colorStyles[originalColorIndex % colorStyles.length];
            
            const fromInput = rangeElement.querySelector('.from-input');
            const toInput = rangeElement.querySelector('.to-input');
            
            if (fromInput && toInput) {
                const from = parseInt(fromInput.value) || 1;
                const to = parseInt(toInput.value) || 1;
                
                // Обновляем цвет самого элемента диапазона
                const currentClasses = rangeElement.className.split(' ');
                const colorClasses = currentClasses.filter(cls => 
                    cls.startsWith('border-') && cls.includes('-500') ||
                    cls.startsWith('bg-') && cls.includes('-50')
                );
                
                rangeElement.classList.remove(...colorClasses);
                rangeElement.classList.add(`border-${style.border.split('-')[1]}-500`, `bg-${style.border.split('-')[1]}-50`);
                
                for (let page = from; page <= to; page++) {
                    pagesInRanges.add(page);
                    
                    const thumb = document.querySelector(`.thumbnail-page[data-page-number="${page}"]`);
                    if (thumb) {
                        thumb.classList.remove('border-gray-200', 'opacity-60', 'line-through');
                        thumb.classList.add(style.border, style.shadow);
                        
                        const badgeContainer = thumb.querySelector('.bg-gray-50');
                        if (badgeContainer) {
                            const oldBadge = badgeContainer.querySelector('.range-highlight');
                            if (oldBadge) oldBadge.remove();
                            
                            const badge = document.createElement('span');
                            badge.className = `range-highlight text-xs px-2 py-1 rounded ml-2 ${style.bg} ${style.text} font-medium`;
                            badge.textContent = `Д${rangeIndex + 1}`;
                            badgeContainer.appendChild(badge);
                        }
                    }
                }
            }
        });

        // Для страниц НЕ входящих в диапазоны - добавляем перечеркивание
        document.querySelectorAll('.thumbnail-page').forEach(thumb => {
            const pageNumber = parseInt(thumb.getAttribute('data-page-number'));
            
            if (!pagesInRanges.has(pageNumber)) {
                // Добавляем визуальное перечеркивание
                thumb.classList.add('opacity-80', 'line-through', 'border-gray-300');
                thumb.classList.remove('border-gray-200');
                
                // Добавляем бейдж "Искл."
                const badgeContainer = thumb.querySelector('.bg-gray-50');
                if (badgeContainer) {
                    // Удаляем старые бейджи исключенных страниц
                    const excludeBadge = badgeContainer.querySelector('.excluded-badge');
                    if (excludeBadge) {
                        excludeBadge.remove();
                    }
                    
                    const badge = document.createElement('span');
                    badge.className = 'excluded-badge text-xs px-2 py-1 rounded ml-2 bg-gray-200 text-gray-600 font-medium';
                    badge.textContent = 'Искл.';
                    badgeContainer.appendChild(badge);
                }
            } else {
                // Убираем перечеркивание и бейдж "Искл." для страниц, которые снова в диапазонах
                thumb.classList.remove('opacity-80', 'line-through', 'border-gray-300');
                
                const badgeContainer = thumb.querySelector('.bg-gray-50');
                if (badgeContainer) {
                    const excludeBadge = badgeContainer.querySelector('.excluded-badge');
                    if (excludeBadge) {
                        excludeBadge.remove();
                    }
                }
            }
        });
        
        // ОБНОВЛЯЕМ КНОПКИ РАЗДЕЛЕНИЯ
        this.updateSplitButtonsVisibility(pagesInRanges);
        this.updateMergeButtons();
    }

    updateSplitButtonsVisibility(pagesInRanges) {
        const ranges = this.getRanges();
        const splitButtons = document.querySelectorAll('.split-range-btn');
        
        splitButtons.forEach(button => {
            const splitAfterPage = parseInt(button.dataset.splitAfter);
            const nextPage = splitAfterPage + 1;
            
            // Проверяем, находятся ли страницы в одном диапазоне
            let inSameRange = false;
            
            for (const range of ranges) {
                if (splitAfterPage >= range.from && splitAfterPage <= range.to &&
                    nextPage >= range.from && nextPage <= range.to) {
                    inSameRange = true;
                    break;
                }
            }
            
            const shouldHide = !inSameRange || 
                            !pagesInRanges.has(splitAfterPage) || 
                            !pagesInRanges.has(nextPage);
            
            button.style.display = shouldHide ? 'none' : 'flex';
        });
    }

    updateMergeButtons() {
        // Удаляем все существующие кнопки объединения
        document.querySelectorAll('.merge-range-btn').forEach(btn => btn.remove());
        
        const rangeElements = this.rangesContainer.querySelectorAll('[data-doc-number]');
        
        // Создаем кнопки объединения для смежных диапазонов
        for (let i = 0; i < rangeElements.length - 1; i++) {
            const currentRange = rangeElements[i];
            const nextRange = rangeElements[i + 1];
            
            const currentTo = parseInt(currentRange.querySelector('.to-input').value);
            const nextFrom = parseInt(nextRange.querySelector('.from-input').value);
            
            // Проверяем, что диапазоны смежные
            if (currentTo + 1 === nextFrom) {
                // Находим миниатюру последней страницы текущего диапазона
                const lastPageThumb = document.querySelector(`.thumbnail-page[data-page-number="${currentTo}"]`);
                
                if (lastPageThumb) {
                    // Находим контейнер миниатюры
                    const thumbContainer = lastPageThumb.closest('.thumbnail-container') || lastPageThumb.parentElement;
                    
                    // Создаем кнопку объединения
                    const mergeBtn = document.createElement('button');
                    mergeBtn.className = 'merge-range-btn';
                    mergeBtn.innerHTML = '➕';
                    mergeBtn.title = 'Объединить с следующим документом';
                    mergeBtn.dataset.docIndex = i;
                    
                    mergeBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.handleMergeDocuments(parseInt(e.target.dataset.docIndex));
                    });
                    
                    // Добавляем кнопку в контейнер миниатюры
                    if (thumbContainer.classList.contains('thumbnail-container')) {
                        thumbContainer.appendChild(mergeBtn);
                    } else {
                        // Если нет специального контейнера, создаем его
                        const newContainer = document.createElement('div');
                        newContainer.className = 'thumbnail-container relative';
                        lastPageThumb.parentNode.insertBefore(newContainer, lastPageThumb);
                        newContainer.appendChild(lastPageThumb);
                        newContainer.appendChild(mergeBtn);
                    }
                }
            }
        }
    }

    determineDocumentType(fileName) {
        if (!fileName) return '134'; // По умолчанию "Прочие документы"

        const lowerName = fileName.toLowerCase();
        
        // Протокол
        if (/протокол|protokol|protocol/i.test(lowerName)) {
            return '14';
        } 
        // Приложение
        else if (/приложение|прил|pril/i.test(lowerName)) {
            return '15';
        } 
        // Доп.соглашение
        else if (/соглашение|допсоглашение|дс_|доп|dop|доп\.|доп_|dop\.|dop_/i.test(lowerName)) {
            return '16';
        } 
        // Договор
        else if (/договор|dogovor|contract/i.test(lowerName)) {
            return '91';
        } 
        // Письма
        else if (/письмо|pismo|letter/i.test(lowerName)) {
            return '93';
        }
        
        // Если ни одно условие не подошло - прочие документы
        return '134';
    }

    addRange(from = null, to = null, fileName, isInitial = false) {
        if (!isInitial) {
            this.rangeCounter++; // Увеличиваем только для пользовательских диапазонов
        }
        const ranges = this.getRanges();
        const docNumber = isInitial ? ranges.length + 1 : this.rangeCounter;
        const selectedType = this.determineDocumentType(fileName);

        const rangeColors = [
            'border-blue-500 bg-blue-50', 
            'border-green-500 bg-green-50',
            'border-yellow-500 bg-yellow-50', 
            'border-purple-500 bg-purple-50',
            'border-pink-500 bg-pink-50', 
            'border-indigo-500 bg-indigo-50',
            'border-red-500 bg-red-50', 
            'border-teal-500 bg-teal-50',
            'border-orange-500 bg-orange-50',
            'border-cyan-500 bg-cyan-50',
            'border-lime-500 bg-lime-50',
            'border-amber-500 bg-amber-50',
            'border-emerald-500 bg-emerald-50',
            'border-violet-500 bg-violet-50',
            'border-fuchsia-500 bg-fuchsia-50',
            'border-rose-500 bg-rose-50',
            'border-sky-500 bg-sky-50'
        ];
        
        const colorIndex = isInitial ? ranges.length : this.rangeCounter;
        const colorClass = rangeColors[colorIndex % rangeColors.length];

        if (ranges.length >= this.totalPages) {
            alert(`Максимальное количество диапазонов: ${this.totalPages}`);
            this.rangeCounter--; // Откатываем счетчик если не удалось создать
            return;
        }

        // Рассчитываем значения по умолчанию
        if (from === null || to === null) {
            if (ranges.length > 0) {
                // 1. Находим все "дыры" между диапазонами
                let holes = [];
                let lastEnd = 0;
                
                // Сортируем диапазоны по начальной странице
                const sortedRanges = [...ranges].sort((a, b) => a.from - b.from);
                
                for (const range of sortedRanges) {
                    if (range.from > lastEnd + 1) {
                        holes.push({from: lastEnd + 1, to: range.from - 1});
                    }
                    lastEnd = Math.max(lastEnd, range.to);
                }
                
                // Проверяем есть ли дыра в конце
                if (lastEnd < this.totalPages) {
                    holes.push({from: lastEnd + 1, to: this.totalPages});
                }

                // 2. Если есть дыры - используем первую
                if (holes.length > 0) {
                    const hole = holes[0];
                    from = hole.from;
                    to = hole.to;
                } 
                // 3. Если дыр нет - делим самый большой диапазон
                else {
                    this.showNotification('Нет свободных страниц для добавления диапазона. Удалите или измените существующие диапазоны.', 'warning');
                    if (!isInitial) this.rangeCounter--; // Откатываем счетчик
                    return;
                }
            } else {
                // Первый диапазон
                from = 1;
                to = this.totalPages;
            }
        }

        // Проверяем границы
        if (from < 1) from = 1;
        if (to > this.totalPages) to = this.totalPages;
        if (from > to) from = to;

        // Создаем новый диапазон
        const rangeElement = document.createElement('div');
        rangeElement.className = `space-y-2 p-4 rounded-lg border-2 ${colorClass}`;
        rangeElement.setAttribute('data-color-index', colorIndex); // Сохраняем глобальный индекс
        rangeElement.setAttribute('data-doc-number', docNumber);
        
        // Генерируем уникальное имя для нового диапазона
        const newName = fileName || `Документ ${docNumber}`;
        
        rangeElement.innerHTML = `
            <!-- Верхняя строка с названием документа и индикатором статуса -->
            <div class="flex justify-between items-center mb-2">
                <div class="flex items-center gap-2 flex-1">
                    <input type="text" 
                        value="${newName}" 
                        class="document-name border rounded px-2 py-1 text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500 flex-1"
                        placeholder="Название документа">
                    <!-- Индикатор статуса БЕЗ id - будем искать по классу -->
                    <div class="flex-shrink-0">
                        <div class="status-indicator w-4 h-4 bg-gray-400 rounded-full border-2 border-white shadow" title="Статус не определен"></div>
                    </div>
                </div>
            </div>

            <!-- Строка с типом документа и системным номером -->
            <div class="flex items-center space-x-3 mb-2">
                <select class="document-type border rounded px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 cursor-pointer w-48">
                    <option value="14" ${selectedType === '14' ? 'selected' : ''}>Протокол к договору</option>
                    <option value="15" ${selectedType === '15' ? 'selected' : ''}>Приложение к договору</option>
                    <option value="16" ${selectedType === '16' ? 'selected' : ''}>Доп.соглашение</option>
                    <option value="91" ${selectedType === '91' ? 'selected' : ''}>Договор с покупателем</option>
                    <option value="93" ${selectedType === '93' ? 'selected' : ''}>Письма</option>
                    <option value="134" ${selectedType === '134' ? 'selected' : ''}>Прочие документы</option>
                </select>
                <div class="system-number-container relative flex-1 w-40">
                    <input type="text" 
                        class="system-number-search border rounded px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 w-full" 
                        placeholder="Документ"
                        data-snd="">
                    <div class="system-number-results absolute z-50 w-full bg-white border border-gray-300 rounded-md shadow-lg hidden max-h-60 overflow-y-auto mt-1"></div>
                </div>
            </div>

            <!-- Строка со страницами -->
            <div class="flex items-center space-x-3 mb-2">
                <span class="text-gray-700 whitespace-nowrap text-sm">Страницы</span>
                <input type="number" min="1" max="${this.totalPages}" value="${from}" 
                    class="range-input from-input w-16 px-2 py-1 border rounded text-sm">
                <span class="text-gray-700 whitespace-nowrap text-sm">—</span>
                <input type="number" min="1" max="${this.totalPages}" value="${to}" 
                    class="range-input to-input w-16 px-2 py-1 border rounded text-sm">
            </div>

            <!-- Кнопка удаления перенесена вниз -->
            <div class="flex justify-end pt-2 border-t border-gray-200">
                <button type="button" class="remove-range text-red-500 hover:text-red-700 cursor-pointer flex items-center text-sm">
                    <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                    </svg>
                    Удалить
                </button>
            </div>
        `;

        // Обработчик удаления
        const removeBtn = rangeElement.querySelector('.remove-range');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                if (this.rangesContainer.children.length > 1) {
                    rangeElement.remove();
                    this.updateRemoveButtonsVisibility();
                    this.updateThumbnailsHighlight();
                }
            });
        }

        // Обработчики изменений
        const fromInput = rangeElement.querySelector('.from-input');
        const toInput = rangeElement.querySelector('.to-input');
        const documentTypeSelect = rangeElement.querySelector('.document-type');
        const documentNameInput = rangeElement.querySelector('.document-name');

        fromInput.addEventListener('change', () => {
            this.adjustRangesAfterManualEdit(rangeElement);
            this.sortRangesByPages();
            this.updateThumbnailsHighlight();
        });

        toInput.addEventListener('change', () => {
            this.adjustRangesAfterManualEdit(rangeElement);
            this.sortRangesByPages();
            this.updateThumbnailsHighlight();
        });

        this.initSystemNumberSelect(rangeElement);

        // Обработчик изменения названия документа
        documentNameInput.addEventListener('input', (e) => {
            this.updateDocumentTypeBasedOnName(e.target.value, documentTypeSelect);
        });
        documentNameInput.addEventListener('change', (e) => {
            this.updateDocumentTypeBasedOnName(e.target.value, documentTypeSelect);
        });

        // Обработчик изменения типа документа
        documentTypeSelect.addEventListener('change', async (e) => {
            await this.handleDocumentTypeChange(e.target, rangeElement);
        });

        this.rangesContainer.appendChild(rangeElement);
        this.sortRangesByPages(); // Сортируем по страницам
        this.updateRemoveButtonsVisibility();
        this.updateThumbnailsHighlight();
    }

    initSystemNumberSelect(rangeElement) {
        const systemNumberSearch = rangeElement.querySelector('.system-number-search');
        const systemNumberResults = rangeElement.querySelector('.system-number-results');

        // Очищаем поле при инициализации
        systemNumberSearch.value = '';
        systemNumberSearch.dataset.snd = '';
        
        // Храним опции для этого диапазона
        rangeElement.systemNumberOptions = [];
        
        let preventAutoOpen = false;

        // Показываем список при фокусе (даже если поле пустое)
        systemNumberSearch.addEventListener('focus', () => {
            if (!preventAutoOpen) {
                this.showSystemNumberResults(rangeElement);
            }
            preventAutoOpen = false;
        });

        // Показываем список при клике (даже если поле пустое)
        systemNumberSearch.addEventListener('click', () => {
            this.showSystemNumberResults(rangeElement);
        });

        // Обработка ввода - фильтруем результаты
        systemNumberSearch.addEventListener('input', (e) => {
            this.filterSystemNumberResults(rangeElement, e.target.value);
        });

        // Обработка клавиш
        systemNumberSearch.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideSystemNumberResults(rangeElement);
                return;
            }
            
            // Показываем список при Backspace, Delete (даже если поле стало пустым)
            if (e.key === 'Backspace' || e.key === 'Delete') {
                setTimeout(() => {
                    this.showSystemNumberResults(rangeElement);
                }, 10);
            }
        });

        // Обработка клика вне - скрываем результаты
        document.addEventListener('click', (e) => {
            const container = rangeElement.querySelector('.system-number-container');
            if (!container.contains(e.target)) {
                this.hideSystemNumberResults(rangeElement);
            }
        });

        // Предотвращаем скрытие при клике внутри результатов
        systemNumberResults.addEventListener('mousedown', (e) => {
            e.preventDefault();
        });
        
        rangeElement.preventSystemNumberAutoOpen = () => {
            preventAutoOpen = true;
        };
    }

    // Убедимся, что этот метод загружает документы при показе списка
    showSystemNumberResults(rangeElement) {
        const systemNumberSearch = rangeElement.querySelector('.system-number-search');
        const systemNumberResults = rangeElement.querySelector('.system-number-results');
        
        // Если опции еще не загружены, загружаем их
        if (rangeElement.systemNumberOptions.length === 0) {
            this.loadSystemNumberOptions(rangeElement);
        } else {
            // Показываем все опции (без фильтрации)
            this.filterSystemNumberResults(rangeElement, systemNumberSearch.value);
        }
        
        systemNumberResults.classList.remove('hidden');
    }

    showSystemNumberResults(rangeElement) {
        const systemNumberResults = rangeElement.querySelector('.system-number-results');
        const systemNumberSearch = rangeElement.querySelector('.system-number-search');
        
        // Используем текущий текст из поля для фильтрации
        const currentSearchTerm = systemNumberSearch.value;
        this.populateSystemNumberResults(rangeElement, currentSearchTerm);
        systemNumberResults.classList.remove('hidden');
    }

    hideSystemNumberResults(rangeElement) {
        const systemNumberResults = rangeElement.querySelector('.system-number-results');
        systemNumberResults.classList.add('hidden');
    }

    filterSystemNumberResults(rangeElement, searchTerm) {
        this.populateSystemNumberResults(rangeElement, searchTerm);
    }

    populateSystemNumberResults(rangeElement, searchTerm) {
        const systemNumberResults = rangeElement.querySelector('.system-number-results');
        const options = rangeElement.systemNumberOptions || [];
        const searchLower = searchTerm.toLowerCase();

        systemNumberResults.innerHTML = '';

        const filteredOptions = searchLower === '' 
            ? options
            : options.filter(opt => {
                const matches = opt.display_text.toLowerCase().includes(searchLower) ||
                            opt.snd.toString().includes(searchTerm);
                return matches;
            });

        filteredOptions.forEach(option => {
            const resultItem = document.createElement('div');
            resultItem.className = 'px-3 py-2 hover:bg-gray-100 cursor-pointer border-b border-gray-100 last:border-b-0';
            resultItem.innerHTML = `
                <div class="text-sm font-medium">${option.display_text}</div>
                <div class="text-xs text-gray-500">ID: ${option.snd}</div>
            `;
            
            resultItem.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.selectSystemNumber(rangeElement, option);
            });

            systemNumberResults.appendChild(resultItem);
        });

        if (filteredOptions.length === 0) {
            const noResults = document.createElement('div');
            noResults.className = 'px-3 py-2 text-gray-500 text-sm';
            noResults.textContent = options.length === 0 ? 'Документы не загружены' : 'Ничего не найдено';
            systemNumberResults.appendChild(noResults);
        }
    }

    selectSystemNumber(rangeElement, option) {
        const systemNumberSearch = rangeElement.querySelector('.system-number-search');
        systemNumberSearch.value = option.display_text;
        systemNumberSearch.dataset.snd = option.snd;
        
        this.hideSystemNumberResults(rangeElement);
        systemNumberSearch.focus();
    }

    showNotification(message, type = 'info', duration = 5000) {
        // Создаем элемент уведомления
        const notification = document.createElement('div');
        notification.className = `fixed top-4 right-4 p-4 rounded-lg shadow-lg z-50 ${
            type === 'warning' ? 'bg-yellow-100 border border-yellow-400 text-yellow-700' :
            type === 'error' ? 'bg-red-100 border border-red-400 text-red-700' :
            'bg-blue-100 border border-blue-400 text-blue-700'
        }`;
        
        notification.innerHTML = `
            <div class="flex items-center">
                <span class="mr-2">${type === 'warning' ? '⚠️' : type === 'error' ? '❌' : 'ℹ️'}</span>
                <span>${message}</span>
            </div>
        `;
        
        // Добавляем на страницу
        document.body.appendChild(notification);
        
        // Автоматически скрываем через указанное время
        if (duration > 0) {
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, duration);
        }
    }

    sortRangesByPages() {
        const rangeElements = Array.from(this.rangesContainer.children);
        
        rangeElements.sort((a, b) => {
            const aFrom = parseInt(a.querySelector('.from-input').value) || 0;
            const bFrom = parseInt(b.querySelector('.from-input').value) || 0;
            return aFrom - bFrom;
        });
        
        // Сохраняем scroll position
        const scrollTop = this.rangesContainer.scrollTop;
        
        this.rangesContainer.innerHTML = '';
        rangeElements.forEach(element => {
            this.rangesContainer.appendChild(element);
        });
        
        this.rangesContainer.scrollTop = scrollTop;
        // Убрали this.updateDocumentNames();
        this.updateThumbnailsHighlight();
    }

    updateDocumentTypeBasedOnName(fileName, documentTypeSelect) {
        if (!fileName || !documentTypeSelect) return;
        // Используем новый метод для определения типа документа
        const newType = this.determineDocumentType(fileName);
        // Устанавливаем выбранный тип
        documentTypeSelect.value = newType;
        // Добавляем визуальную обратную связь
        this.showTypeChangeFeedback(documentTypeSelect);
    }

    showTypeChangeFeedback(selectElement) {
        // Временно добавляем класс для визуальной обратной связи
        selectElement.classList.add('ring-2', 'ring-blue-500');
        
        setTimeout(() => {
            selectElement.classList.remove('ring-2', 'ring-blue-500');
        }, 1000);
    }

    adjustRangesAfterManualEdit(editedRange) {
        const rangeElements = Array.from(this.rangesContainer.children);
        const currentIndex = rangeElements.indexOf(editedRange);
        
        if (currentIndex === -1) return;

        const fromInput = editedRange.querySelector('.from-input');
        const toInput = editedRange.querySelector('.to-input');
        
        let from = parseInt(fromInput.value) || 1;
        let to = parseInt(toInput.value) || 1;

        // Корректируем значения текущего диапазона
        if (from < 1) from = 1;
        if (to > this.totalPages) to = this.totalPages;
        if (from > to) {
            // Если начало больше конца, меняем их местами
            [from, to] = [to, from];
        }
        
        fromInput.value = from;
        toInput.value = to;

        // Корректируем предыдущий диапазон (если есть)
        if (currentIndex > 0) {
            const prevRange = rangeElements[currentIndex - 1];
            const prevToInput = prevRange.querySelector('.to-input');
            const prevTo = parseInt(prevToInput.value) || 1;
            
            if (from <= prevTo) {
                prevToInput.value = from - 1;
                // Рекурсивно корректируем предыдущий диапазон
                this.adjustRangesAfterManualEdit(prevRange);
            }
        }

        // Корректируем следующий диапазон (если есть)
        if (currentIndex < rangeElements.length - 1) {
            const nextRange = rangeElements[currentIndex + 1];
            const nextFromInput = nextRange.querySelector('.from-input');
            const nextToInput = nextRange.querySelector('.to-input');
            let nextFrom = parseInt(nextFromInput.value) || this.totalPages;
            let nextTo = parseInt(nextToInput.value) || this.totalPages;
            
            if (to >= nextFrom) {
                // Новое начало следующего диапазона
                nextFrom = Math.min(to + 1, this.totalPages);
                nextFromInput.value = nextFrom;
                
                // Корректируем конец следующего диапазона
                if (nextTo < nextFrom) {
                    nextTo = Math.min(nextFrom, this.totalPages);
                    nextToInput.value = nextTo;
                }
                
                // Рекурсивно корректируем следующий диапазон
                this.adjustRangesAfterManualEdit(nextRange);
            }
        }

        // Дополнительная проверка для последнего диапазона
        if (currentIndex === rangeElements.length - 1) {
            if (to > this.totalPages) {
                toInput.value = this.totalPages;
            }
        }

        this.updateThumbnailsHighlight();
    }

    adjustRanges() {
        const rangeElements = Array.from(this.rangesContainer.children);
        if (rangeElements.length === 0) return;

        let remainingPages = this.totalPages;
        let currentPosition = 1;

        // Распределяем страницы между диапазонами
        rangeElements.forEach((rangeEl, index) => {
            const fromInput = rangeEl.querySelector('.from-input');
            const toInput = rangeEl.querySelector('.to-input');
            
            // Последний диапазон получает все оставшиеся страницы
            if (index === rangeElements.length - 1) {
                fromInput.value = currentPosition;
                toInput.value = this.totalPages;
                return;
            }

            // Вычисляем количество страниц для этого диапазона
            const pagesForThisRange = Math.max(1, Math.floor(remainingPages / (rangeElements.length - index)));
            
            fromInput.value = currentPosition;
            toInput.value = currentPosition + pagesForThisRange - 1;
            
            currentPosition += pagesForThisRange;
            remainingPages -= pagesForThisRange;
        });
    }

    // Новый метод для обеспечения минимального размера диапазона
    enforceMinimumRangeSize() {
        const rangeElements = Array.from(this.rangesContainer.children);
        
        // Идем с конца, чтобы корректировать предыдущие диапазоны
        for (let i = rangeElements.length - 1; i > 0; i--) {
            const currentRange = rangeElements[i];
            const prevRange = rangeElements[i - 1];
            
            const currentFromInput = currentRange.querySelector('.from-input');
            const prevToInput = prevRange.querySelector('.to-input');
            
            const currentFrom = parseInt(currentFromInput.value) || 1;
            const prevTo = parseInt(prevToInput.value) || 1;
            
            // Если диапазон сжат до минимума, уменьшаем предыдущий
            if (currentFrom === prevTo + 1) {
                prevToInput.value = prevTo - 1;
                
                // Если предыдущий диапазон стал некорректным, удаляем его
                if (parseInt(prevRange.querySelector('.from-input').value) > parseInt(prevToInput.value)) {
                    prevRange.remove();
                    this.updateRemoveButtonsVisibility();
                    this.adjustRanges(); // Рекурсивно корректируем
                    return;
                }
            }
        }
    }

    updateRemoveButtonsVisibility() {
        const ranges = this.rangesContainer.children;
        
        Array.from(ranges).forEach((range, index) => {
            const removeBtn = range.querySelector('.remove-range');
            if (removeBtn) {
                if (ranges.length > 1) {
                    removeBtn.classList.remove('hidden');
                } else {
                    removeBtn.classList.add('hidden');
                }
            }
        });
    }

    resetForm(keepFiles = false) {
        // Скрываем превью и показываем форму загрузки
        this.previewContainer.classList.add('hidden');
        document.getElementById('upload-container').classList.remove('hidden');
        
        // Очищаем кнопки действий
        this.hideActionButtons();
        
        // Сбрасываем файлы и URL только если явно указано
        if (!keepFiles) {
            this.fileInput.value = '';
            this.pendingUrls = []; // Очищаем URL
            this.hideFileInfo();
            this.clearFileError(); // Очищаем ошибки
            this.rangeCounter = 0; // Сбрасываем счетчик диапазонов!
        }
        
        // Сбрасываем состояние кнопки загрузки
        this.resetUploadButton();

        // Сбрасываем повороты
        if (!keepFiles) {
            this.pageRotations = {};
            this.rotationIndicators = {};
        }
        
        // Очищаем сообщения об ошибках
        const errorElement = this.uploadForm.querySelector('.upload-error');
        if (errorElement) errorElement.remove();
        
        // Сбрасываем данные
        this.uploadedDocuments = [];
        this.totalPages = 0;
    }

    // Метод для сброса кнопки загрузки
    resetUploadButton() {
        this.uploadButton.disabled = false;
        this.uploadButton.innerHTML = 'Загрузить';
    }

    async handleSplit() {
        const selectedCounterparty = this.getSelectedCounterparty();
        
        if (!selectedCounterparty) {
            this.showNotification('Пожалуйста, выберите контрагента', 'error');
            return;
        }
        const originalHtml = this.splitButton.innerHTML;
        this.splitButton.disabled = true;
        this.splitButton.innerHTML = `
            <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Обработка...
        `;

        this.hideActionButtons();

        // Проверяем, что все диапазоны валидны
        const ranges = this.getRanges();
        const usedPages = new Set();
        
        for (const range of ranges) {
            // Проверка на минимальный размер диапазона
            if (range.from > range.to) {
                this.showSplitError(`Диапазон "${range.name}" некорректен: начальная страница больше конечной`);
                return;
            }
            
            // Проверка на пересечение диапазонов
            for (let page = range.from; page <= range.to; page++) {
                if (usedPages.has(page)) {
                    this.showSplitError(`Страница ${page} используется в нескольких диапазонах`);
                    return;
                }
                usedPages.add(page);
            }
        }

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
                    ranges: ranges,
                    page_rotations: this.pageRotations // ДОБАВЛЯЕМ ПОВОРОТЫ
                })
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.message || 'Ошибка сервера');
            
            // Передаем ranges в showDownloadButton
            this.showDownloadButton(data.download_url, data.filename, ranges, data.session_id);

        } catch (error) {
            this.showSplitError(error.message);
        } finally {
            this.splitButton.disabled = false;
            this.splitButton.innerHTML = originalHtml;
        }
    }

    showDownloadButton(downloadUrl, filename, ranges, sessionId) {
        // Удаляем предыдущие кнопки
        const oldDownloadBtn = document.getElementById('download-button-container');
        if (oldDownloadBtn) oldDownloadBtn.remove();
        
        const oldArchiveBtn = document.getElementById('archive-button-container');
        if (oldArchiveBtn) oldArchiveBtn.remove();

        // Создаем контейнер для кнопок
        const buttonsContainer = document.createElement('div');
        buttonsContainer.className = 'flex flex-col sm:flex-row gap-3 mt-4';
        buttonsContainer.id = 'action-buttons-container';

        // Кнопка скачивания
        const downloadBtn = document.createElement('a');
        downloadBtn.id = 'download-button-container';
        downloadBtn.href = downloadUrl;
        downloadBtn.className = 'flex-1 bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded-md font-medium transition duration-200 cursor-pointer flex items-center justify-center';
        downloadBtn.download = filename;
        downloadBtn.innerHTML = `
            <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
            </svg>
            Скачать файлы
        `;

        // Кнопка отправки в Архив
        const archiveBtn = document.createElement('button');
        archiveBtn.id = 'archive-button-container';
        archiveBtn.type = 'button';
        archiveBtn.className = 'flex-1 bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded-md font-medium transition duration-200 cursor-pointer flex items-center justify-center';
        archiveBtn.innerHTML = `
            <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7l4-4m0 0l4 4m-4-4v18m0 0l-4-4m4 4l4-4"></path>
            </svg>
            Отправить в архив
        `;

        // Обработчик для кнопки Архив
        archiveBtn.addEventListener('click', () => {
            this.sendToArchive(ranges, sessionId);
        });

        // Добавляем кнопки в контейнер
        buttonsContainer.appendChild(downloadBtn);
        buttonsContainer.appendChild(archiveBtn);

        // Вставляем контейнер после кнопки "Разделить PDF"
        this.splitButton.insertAdjacentElement('afterend', buttonsContainer);
    }

    async sendToArchive(ranges, sessionId) {
        const selectedCounterparty = this.getSelectedCounterparty();
        
        if (!selectedCounterparty) {
            this.showNotification('Пожалуйста, выберите контрагента', 'error');
            return;
        }

        const archiveBtn = document.getElementById('archive-button-container');
        const originalHtml = archiveBtn.innerHTML;
        
        try {
            archiveBtn.disabled = true;
            archiveBtn.innerHTML = `
                <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Отправка...
            `;

            const response = await fetch('/send-to-archive', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-TOKEN': this.previewContainer.dataset.csrfToken,
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    session_id: sessionId,
                    counterparty: selectedCounterparty,
                    ranges: ranges
                })
            });

            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.message || 'Ошибка отправки в архив');
            }

        if (result.success) {
            this.showNotification('Документы поставлены в очередь', 'success');
            
            // Сохраняем ID документов для отслеживания
            if (result.document_ids && result.document_ids.length > 0) {
                this.saveDocumentStatuses(result.document_ids, ranges);
                
                // Сохраняем ссылку на кнопку для последующего обновления
                this.archiveButton = archiveBtn;
                this.archiveButtonOriginalHtml = originalHtml;
                
                // Запускаем отслеживание статуса
                this.startStatusTracking(result.document_ids);
            } else {
                // Если нет document_ids, восстанавливаем кнопку сразу
                this.restoreArchiveButton();
            }
        } else {
            throw new Error(result.message || 'Неизвестная ошибка');
        }

        } catch (error) {
            console.error('Archive send error:', error);
            this.showNotification(`Ошибка отправки в архив: ${error.message}`, 'error');
            this.restoreArchiveButton();
        }
    }

    // Восстанавливаем кнопку архива
    restoreArchiveButton() {
        if (this.archiveButton && this.archiveButtonOriginalHtml) {
            this.archiveButton.disabled = false;
            this.archiveButton.innerHTML = this.archiveButtonOriginalHtml;
            this.archiveButton = null;
            this.archiveButtonOriginalHtml = null;
        }
    }

    // Сохраняем статусы документов на фронтенде
    saveDocumentStatuses(documentIds, ranges) {
        this.documentStatuses.clear();
        
        // console.log('Saving document statuses - using element indexes:');
        
        documentIds.forEach((docId, index) => {
            // Используем индекс элемента в контейнере как идентификатор
            const elementIndex = index;
            
            // console.log(`Document ${index}:`, {
            //     docId: docId,
            //     elementIndex: elementIndex
            // });
            
            this.documentStatuses.set(docId, {
                id: docId,
                pst: 0,
                name: ranges[index]?.name || `Документ ${index + 1}`,
                elementIndex: elementIndex // Используем индекс элемента
            });
        });
        
        this.updateAllStatusIndicators();
    }

    // Запускаем отслеживание статуса
    async startStatusTracking(documentIds) {
        // Останавливаем предыдущее отслеживание если было
        if (this.statusCheckInterval) {
            clearInterval(this.statusCheckInterval);
        }
        
        // Запускаем периодическую проверку
        this.statusCheckInterval = setInterval(async () => {
            await this.checkDocumentsStatus(documentIds);
        }, 2000); // Каждые 2 секунды
        
        // Первая проверка через 2 секунды
        setTimeout(async () => {
            await this.checkDocumentsStatus(documentIds);
        }, 2000);
    }

    // Проверка статуса документов
    async checkDocumentsStatus(documentIds) {
        try {
            const response = await fetch('/check-archive-status', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-TOKEN': this.previewContainer.dataset.csrfToken,
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    document_ids: Array.from(documentIds)
                })
            });

            const data = await response.json();
            
            if (data.success && data.documents_status) {
                // console.log('Received status update:', data.documents_status);
                
                // Обновляем статусы
                data.documents_status.forEach(docStatus => {
                    if (this.documentStatuses.has(docStatus.id)) {
                        const currentDoc = this.documentStatuses.get(docStatus.id);
                        currentDoc.pst = docStatus.pst;
                        this.documentStatuses.set(docStatus.id, currentDoc);
                    }
                });
                
                // Обновляем индикаторы
                this.updateAllStatusIndicators();
                
                // Проверяем, все ли документы завершены
                const allCompleted = Array.from(this.documentStatuses.values()).every(doc => doc.pst === 1);
                if (allCompleted) {
                    clearInterval(this.statusCheckInterval);
                    this.statusCheckInterval = null;
                    this.restoreArchiveButton();
                    this.showNotification('Все документы успешно отправлены в архив', 'success');
                }
            }
        } catch (error) {
            console.error('Status check error:', error);
        }
    }

    // Обновляем все индикаторы статуса
    updateAllStatusIndicators() {
        Array.from(this.documentStatuses.values()).forEach(doc => {
            this.updateStatusIndicator(doc.elementIndex, doc.pst);
        });
    }

    // Обновляем конкретный индикатор
    updateStatusIndicator(elementIndex, status) {
        // Ищем индикатор по индексу элемента
        const rangeElement = this.rangesContainer.children[elementIndex];
        if (!rangeElement) {
            console.warn(`Диапазон не найден для индекса: ${elementIndex}`);
            return;
        }
        
        // Находим индикатор внутри этого элемента
        const indicator = rangeElement.querySelector('.status-indicator');
        if (!indicator) {
            console.warn(`Индикатор статуса не найден в диапазоне: ${elementIndex}`);
            return;
        }
        
        // Обновляем цвет и подсказку
        switch(status) {
            case 0: // В очереди - КРАСНЫЙ
                indicator.className = 'status-indicator w-4 h-4 bg-red-500 rounded-full border-2 border-white shadow';
                indicator.title = 'В очереди на отправку';
                break;
            case 1: // Успешно отправлен - ЗЕЛЕНЫЙ
                indicator.className = 'status-indicator w-4 h-4 bg-green-500 rounded-full border-2 border-white shadow';
                indicator.title = 'Успешно отправлен в архив';
                break;
            case 2: // В процессе отправки - ЖЕЛТЫЙ
                indicator.className = 'status-indicator w-4 h-4 bg-yellow-500 rounded-full border-2 border-white shadow';
                indicator.title = 'В процессе отправки';
                break;
            default:
                indicator.className = 'status-indicator w-4 h-4 bg-gray-400 rounded-full border-2 border-white shadow';
                indicator.title = 'Статус не определен';
        }
    }

    hideActionButtons() {
        const actionButtons = document.getElementById('action-buttons-container');
        if (actionButtons) {
            actionButtons.remove();
        }
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
            const fromInput = rangeEl.querySelector('.from-input');
            const toInput = rangeEl.querySelector('.to-input');
            const nameInput = rangeEl.querySelector('.document-name');
            const typeSelect = rangeEl.querySelector('.document-type');
            const systemNumberSearch = rangeEl.querySelector('.system-number-search');
            
            const from = parseInt(fromInput.value);
            const to = parseInt(toInput.value);
            const name = nameInput.value.trim();
            const type = typeSelect.value;
            const systemNumber = systemNumberSearch.dataset.snd;

            if (!isNaN(from) && !isNaN(to) && from <= to) {
                ranges.push({
                    range: `${from}-${to}`,
                    name: name,
                    type: type,
                    systemNumber: systemNumber,
                    from: from,
                    to: to
                });
            }
        });
        
        return ranges;
    }

    initCustomCounterpartySelect() {
        if (!this.counterpartySelect) return;

        // Сохраняем оригинальные options
        const originalOptions = Array.from(this.counterpartySelect.options);
        
        // Создаем контейнер для кастомного select
        const customSelectContainer = document.createElement('div');
        customSelectContainer.className = 'relative';
        this.counterpartySelect.parentNode.appendChild(customSelectContainer);

        // Создаем поле поиска
        this.counterpartySearch = document.createElement('input');
        this.counterpartySearch.type = 'text';
        this.counterpartySearch.placeholder = 'Поиск контрагента...';
        this.counterpartySearch.className = 'w-full px-3 py-2 border border-gray-300 rounded-md mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500';
        customSelectContainer.appendChild(this.counterpartySearch);

        // Создаем контейнер для результатов поиска
        const resultsContainer = document.createElement('div');
        resultsContainer.className = 'absolute z-50 w-full bg-white border border-gray-300 rounded-md shadow-lg hidden max-h-60 overflow-y-auto';
        resultsContainer.id = 'counterparty-results';
        customSelectContainer.appendChild(resultsContainer);

        // Скрываем оригинальный select
        this.counterpartySelect.style.display = 'none';

        // Обработка фокуса
        this.counterpartySearch.addEventListener('focus', () => {
            this.showResults(originalOptions, this.counterpartySearch.value);
        });

        // Обработка ввода - показываем результаты при каждом изменении
        this.counterpartySearch.addEventListener('input', (e) => {
            this.showResults(originalOptions, e.target.value);
        });

        // Обработка клика по документу - скрываем результаты если кликнули вне
        document.addEventListener('click', (e) => {
            if (!customSelectContainer.contains(e.target)) {
                this.hideResults();
            }
        });

        // Обработка клавиш - скрываем результаты при нажатии Escape
        this.counterpartySearch.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideResults();
            }
        });

        // Предотвращаем скрытие при клике внутри результатов
        resultsContainer.addEventListener('mousedown', (e) => {
            e.preventDefault(); // Предотвращаем blur поля поиска
        });
    }

    showResults(options, searchTerm) {
        const resultsContainer = document.getElementById('counterparty-results');
        if (!resultsContainer) return;

        this.populateResults(options, searchTerm);
        resultsContainer.classList.remove('hidden');
        this.isResultsVisible = true;
    }

    hideResults() {
        const resultsContainer = document.getElementById('counterparty-results');
        if (resultsContainer) {
            resultsContainer.classList.add('hidden');
            this.isResultsVisible = false;
        }
    }

    populateResults(options, searchTerm) {
        const resultsContainer = document.getElementById('counterparty-results');
        if (!resultsContainer) return;

        resultsContainer.innerHTML = '';
        const searchLower = searchTerm.toLowerCase();

        // Всегда показываем все options при пустом поиске
        const filteredOptions = searchLower === '' 
            ? options.filter(opt => opt.value !== '')
            : options.filter(opt => opt.value !== '' && opt.text.toLowerCase().includes(searchLower));

        filteredOptions.forEach(option => {
            const resultItem = document.createElement('div');
            resultItem.className = 'px-3 py-2 hover:bg-gray-100 cursor-pointer border-b border-gray-100 last:border-b-0';
            resultItem.textContent = option.text;
            
            resultItem.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.selectCounterparty(option);
            });

            resultsContainer.appendChild(resultItem);
        });

        if (filteredOptions.length === 0) {
            const noResults = document.createElement('div');
            noResults.className = 'px-3 py-2 text-gray-500';
            noResults.textContent = 'Контрагенты не найдены';
            resultsContainer.appendChild(noResults);
        }
    }

    async selectCounterparty(option) {
        this.counterpartySearch.value = option.text;
        this.selectedCounterparty = {
            kpl: option.value,
            name: option.getAttribute('data-name') || option.text
        };
        
        // Скрываем результаты после выбора
        this.hideResults();
        
        // Автоматически заполняем системные номера для всех диапазонов с типом "Договор"
        await this.updateSystemNumbersForContractRanges();
        
        // Фокус остается на поле поиска для возможного редактирования
        this.counterpartySearch.focus();
        
        // Выделяем весь текст для удобства редактирования
        this.counterpartySearch.select();
    }

    getSelectedCounterparty() {
        return this.selectedCounterparty;
    }

    async fetchSystemNumber(counterpartyKpl, documentType) {
        try {
            const response = await fetch('/get-system-number', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-TOKEN': this.previewContainer.dataset.csrfToken,
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify({
                    kpl: counterpartyKpl,
                    document_type: documentType
                })
            });

            if (!response.ok) {
                throw new Error('Ошибка сервера');
            }

            const result = await response.json();
            
            if (result.success) {
                return result.system_numbers;
            } else {
                throw new Error(result.message || 'Документ не найден');
            }

        } catch (error) {
            console.error('Error fetching system number:', error);
            this.showNotification(`Ошибка получения системного номера: ${error.message}`, 'error');
            return null;
        }
    }

    async updateSystemNumbersForContractRanges() {
        if (!this.selectedCounterparty) return;

        const rangeElements = this.rangesContainer.children;
        
        for (let rangeElement of rangeElements) {
            await this.updateSystemNumberForRange(rangeElement);
        }
    }

    async handleDocumentTypeChange(typeSelect, rangeElement) {
        await this.updateSystemNumberForRange(rangeElement, typeSelect.value);
    }

    async updateSystemNumberForRange(rangeElement, documentType = null) {
        const documentTypeSelect = rangeElement.querySelector('.document-type');
        const systemNumberSearch = rangeElement.querySelector('.system-number-search');
        
        const currentDocumentType = documentType || documentTypeSelect.value;
        
        if (!this.selectedCounterparty) {
            systemNumberSearch.value = '';
            systemNumberSearch.dataset.snd = '';
            rangeElement.systemNumberOptions = [];
            return;
        }

        // Предотвращаем автоматическое открытие списка
        if (rangeElement.preventSystemNumberAutoOpen) {
            rangeElement.preventSystemNumberAutoOpen();
        }

        // Получаем системные номера
        const systemNumbers = await this.fetchSystemNumber(this.selectedCounterparty.kpl, currentDocumentType);
        
        // Сохраняем опции для этого диапазона
        rangeElement.systemNumberOptions = systemNumbers || [];
        
        // УБИРАЕМ АВТОМАТИЧЕСКУЮ ПОДСТАНОВКУ ПЕРВОГО ЗНАЧЕНИЯ
        // Просто очищаем поле и оставляем опции для выбора
        systemNumberSearch.value = '';
        systemNumberSearch.dataset.snd = '';
        
        // Можно показать уведомление, что доступны документы для выбора
        if (systemNumbers && systemNumbers.length > 0) {
            this.showTypeChangeFeedback(systemNumberSearch, systemNumbers.length);
        } else {
            this.showTypeChangeFeedback(systemNumberSearch, 0);
        }
    }

    addRotationControlsToThumbnails() {
        const thumbnails = document.querySelectorAll('.thumbnail-page');
        
        thumbnails.forEach(thumb => {
            const pageNum = parseInt(thumb.dataset.pageNumber);
            const link = thumb.querySelector('a');
            const img = thumb.querySelector('img');
            
            if (!img || !link) return;
            
            // Добавляем фиксированную высоту изображению
            img.classList.add('h-48', 'object-contain', 'bg-gray-50');
            
            // Создаем контейнер для кнопок поворота
            const rotationContainer = document.createElement('div');
            rotationContainer.className = 'absolute top-1 right-1 opacity-0 hover:opacity-100 transition-opacity duration-200 z-10';
            
            rotationContainer.innerHTML = `
                <button type="button" 
                        class="rotate-left bg-white hover:bg-gray-100 rounded p-1 shadow-sm border border-gray-300"
                        title="Повернуть против часовой (90°)">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <!-- Изогнутая против часовой -->
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                            d="M15 19l-7-7 7-7"/>
                    </svg>
                </button>
                <button type="button" 
                        class="rotate-right bg-white hover:bg-gray-100 rounded p-1 shadow-sm border border-gray-300"
                        title="Повернуть по часовой (90°)">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <!-- Изогнутая по часовой -->
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                            d="M9 5l7 7-7 7"/>
                    </svg>
                </button>
            `;
            
            // Добавляем индикатор поворота
            const rotationIndicator = document.createElement('div');
            rotationIndicator.className = 'rotation-indicator absolute top-1 left-1 bg-blue-500 text-white text-xs px-1 rounded hidden z-10';
            rotationIndicator.textContent = '0°';
            
            // Сохраняем индикатор
            this.rotationIndicators[pageNum] = rotationIndicator;
            
            // Добавляем hover эффект на ссылку
            link.addEventListener('mouseenter', () => {
                rotationContainer.style.opacity = '1';
            });
            
            link.addEventListener('mouseleave', () => {
                rotationContainer.style.opacity = '0';
            });
            
            // Вставляем элементы в ссылку (теперь они внутри <a>)
            link.style.position = 'relative';
            link.appendChild(rotationContainer);
            link.appendChild(rotationIndicator);
            
            // Обработчики поворота
            const rotateLeft = rotationContainer.querySelector('.rotate-left');
            const rotateRight = rotationContainer.querySelector('.rotate-right');
            
            rotateLeft.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.rotatePage(pageNum, img, -90);
            });
            
            rotateRight.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.rotatePage(pageNum, img, 90);
            });
            
            // Предотвращаем открытие картинки при клике на кнопки поворота
            rotationContainer.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });
    }

    setFixedThumbnailSize(imgElement) {
        // Фиксированные размеры для всех миниатюр
        const maxWidth = 150;
        const maxHeight = 200;
        
        imgElement.style.maxWidth = `${maxWidth}px`;
        imgElement.style.maxHeight = `${maxHeight}px`;
        imgElement.style.width = 'auto';
        imgElement.style.height = 'auto';
        imgElement.style.objectFit = 'contain';
        imgElement.style.display = 'block';
        imgElement.style.margin = '0 auto';
    }

    /**
     * Поворот страницы
     */
    rotatePage(pageNum, imgElement, degrees) {
        const currentRotation = this.pageRotations[pageNum] || 0;
        const newRotation = (currentRotation + degrees + 360) % 360;
        
        // Сохраняем поворот
        this.pageRotations[pageNum] = newRotation;
        
        // Удаляем предыдущие классы поворота
        const rotationClasses = ['rotated-90', 'rotated-180', 'rotated-270'];
        imgElement.classList.remove(...rotationClasses);
        
        // Добавляем соответствующий класс поворота
        if (newRotation === 90) {
            imgElement.classList.add('rotated-90');
        } else if (newRotation === 180) {
            imgElement.classList.add('rotated-180');
        } else if (newRotation === 270) {
            imgElement.classList.add('rotated-270');
        }
        // 0 градусов - убираем все классы
        
        // Обновляем индикатор поворота
        this.updateRotationIndicator(pageNum, newRotation);
        
        console.log(`Page ${pageNum} rotated to ${newRotation}°`);
    }

    /**
     * Обновление индикатора поворота
     */
    updateRotationIndicator(pageNum, degrees) {
        const indicator = this.rotationIndicators[pageNum];
        if (indicator) {
            indicator.textContent = `${degrees}°`;
            indicator.classList.remove('hidden');
            
            // Скрываем индикатор через 3 секунды
            setTimeout(() => {
                indicator.classList.add('hidden');
            }, 3000);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new PdfSplitter();
});