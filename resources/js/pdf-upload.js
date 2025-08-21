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
        
        this._totalPages = 0;
        this.currentMaxPage = 0; // Текущая максимальная страница для новых диапазонов
        
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
        } else {
            this.uploadButton.disabled = true;
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
            this.showFileError('Пожалуйста, выберите файлы');
            return;
        }

        // Частичный сброс (сохраняем выбранные файлы)
        this.resetForm(true);
        this.showLoader(files.length);
        const originalButtonHtml = this.uploadButton.innerHTML;

        try {
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
            
            const result = await response.json();
            
            if (!response.ok || !result.success) {
                throw new Error(result.message || 'Ошибка загрузки');
            }

            // Всегда используем documents, даже если один файл
            this.uploadedDocuments = result.documents || [];
                
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
        this.hideFileInfo();
        this.previewContainer.classList.remove('hidden');
        document.getElementById('upload-container').classList.add('hidden');
        
        const previewContainer = document.getElementById('documents-preview');
        previewContainer.innerHTML = '';
        
        // 1. Сначала вычисляем общее количество страниц
        this.totalPages = this.uploadedDocuments.reduce(
            (total, doc) => total + doc.pages.length, 
            0
        );
        
        let globalPageNum = 1;
        let currentPage = 1; // Отслеживаем текущую страницу для диапазонов
        
        // Очищаем предыдущие диапазоны
        this.rangesContainer.innerHTML = '';
        
        // Создаем превью и диапазоны для каждого документа
        this.uploadedDocuments.forEach((doc, index) => {
            const docPageCount = doc.pages.length;
            const docName = doc.original_name.replace(/\.pdf$/i, '');
            
            // 2. Создаем контейнер документа
            const docContainer = document.createElement('div');
            docContainer.className = 'bg-white rounded-lg shadow-sm p-4 border border-gray-200 mb-6';
            
            // 3. Добавляем заголовок документа
            const title = document.createElement('h3');
            title.className = 'text-lg font-semibold text-gray-800 mb-3';
            title.textContent = `${index + 1}. ${doc.original_name}`;
            docContainer.appendChild(title);
            
            // 4. Создаем диапазон для этого документа
            const rangeEnd = currentPage + docPageCount - 1;
            this.addRange(
                currentPage,      // Начало диапазона
                rangeEnd,         // Конец диапазона
                docName           // Имя файла без .pdf
            );
            currentPage = rangeEnd + 1;
            
            // 5. Добавляем миниатюры страниц
            const thumbsContainer = document.createElement('div');
            thumbsContainer.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3';
            
            doc.pages.forEach(page => {
                const thumb = document.createElement('div');
                thumb.className = 'border rounded overflow-hidden hover:shadow-md transition';
                thumb.innerHTML = `
                    <a href="${page.image_url}" data-glightbox="title: Страница ${globalPageNum}">
                        <img src="${page.image_url}" 
                            alt="Страница ${globalPageNum}" 
                            class="w-full object-contain">
                    </a>
                    <div class="p-2 text-center bg-gray-50 border-t">
                        <span class="text-xs font-medium">Стр. ${globalPageNum++}</span>
                    </div>
                `;
                thumbsContainer.appendChild(thumb);
            });
            
            docContainer.appendChild(thumbsContainer);
            previewContainer.appendChild(docContainer);
        });
        
        // 6. Обновляем GLightbox
        if (window._glightbox) {
            window._glightbox.reload();
        }
    }

    updateAllRangeInputs() {
        document.querySelectorAll('.from-input, .to-input').forEach(input => {
            input.setAttribute('max', this.totalPages);
            const value = parseInt(input.value);
            if (value > this.totalPages) {
                input.value = this.totalPages;
            }
        });
    }

    addRange(from = null, to = null, fileName) {
        const ranges = this.getRanges();
        const docNumber = ranges.length + 1;
        
        if (ranges.length >= this.totalPages) {
            alert(`Максимальное количество диапазонов: ${this.totalPages}`);
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
                    // Находим самый большой диапазон
                    let largestRange = null;
                    let largestSize = 0;
                    
                    for (const range of ranges) {
                        const size = range.to - range.from;
                        if (size > largestSize) {
                            largestSize = size;
                            largestRange = range;
                        }
                    }
                    
                    if (largestRange) {
                        const rangeElement = Array.from(this.rangesContainer.children)
                            .find(el => parseInt(el.querySelector('.from-input').value) === largestRange.from);
                        
                        if (rangeElement) {
                            const toInput = rangeElement.querySelector('.to-input');
                            const newEnd = largestRange.from + Math.floor(largestSize / 2);
                            toInput.value = newEnd;
                            
                            from = newEnd + 1;
                            to = largestRange.to;
                        }
                    }
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
        rangeElement.className = 'space-y-2 bg-white p-4 rounded-lg border';
        
        // Генерируем уникальное имя для нового диапазона
        const newName = fileName || `Документ ${docNumber}`;
        
        rangeElement.innerHTML = `
            <div class="range-container">
                <div class="flex justify-between items-center mb-2">
                    <input type="text" 
                        value="${newName}" 
                        class="document-name border rounded px-2 py-1 w-87 text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                    <input type="text" class="system-number border rounded px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 w-full sm:w-32 md:w-35" placeholder="Системный номер">
                </div>
                <div class="flex items-center space-x-3">
                    <span class="text-gray-700 whitespace-nowrap text-sm">Страницы</span>
                    <input type="number" min="1" max="${this.totalPages}" value="${from}" 
                        class="range-input from-input w-16 px-2 py-1 border rounded text-sm">
                    <span class="text-gray-700 whitespace-nowrap text-sm">—</span>
                    <input type="number" min="1" max="${this.totalPages}" value="${to}" 
                        class="range-input to-input w-16 px-2 py-1 border rounded text-sm">
                </div>
            </div>
        `;

        // Обработчик удаления
        const removeBtn = rangeElement.querySelector('.remove-range');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                if (this.rangesContainer.children.length > 1) {
                    rangeElement.remove();
                    this.renumberDocuments();
                    this.updateRemoveButtonsVisibility();
                }
            });
        }

        // Обработчики изменений
        const fromInput = rangeElement.querySelector('.from-input');
        const toInput = rangeElement.querySelector('.to-input');
        
        fromInput.addEventListener('change', () => {
            this.adjustRangesAfterManualEdit(rangeElement);
        });
        
        toInput.addEventListener('change', () => {
            this.adjustRangesAfterManualEdit(rangeElement);
        });

        this.rangesContainer.appendChild(rangeElement);
        this.updateRemoveButtonsVisibility();
    }

    // Новый метод для корректировки последнего диапазона после удаления
    adjustLastRange() {
        const ranges = this.getRanges();
        if (ranges.length === 0) return;
        
        const lastRange = ranges[ranges.length - 1];
        const lastRangeElement = this.rangesContainer.children[ranges.length - 1];
        const lastToInput = lastRangeElement.querySelector('.to-input');
        
        // Устанавливаем конец последнего диапазона на последнюю страницу
        lastToInput.value = this.totalPages;
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

        // Проверяем, не стал ли диапазон пустым (from > to)
        if (from > to) {
            // Если диапазон стал пустым, удаляем его
            editedRange.remove();
            this.renumberDocuments();
            this.updateRemoveButtonsVisibility();
            // Корректируем последний диапазон
            // this.adjustLastRange();
        }

        // Дополнительная проверка для последнего диапазона
        if (currentIndex === rangeElements.length - 1) {
            if (to > this.totalPages) {
                toInput.value = this.totalPages;
            }
        }
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
                    this.renumberDocuments();
                    this.updateRemoveButtonsVisibility();
                    this.adjustRanges(); // Рекурсивно корректируем
                    return;
                }
            }
        }
    }

    renumberDocuments() {
        const rangeContainers = this.rangesContainer.querySelectorAll('.range-container');
        
        rangeContainers.forEach((container, index) => {
            const nameInput = container.querySelector('.document-name');
            if (nameInput && nameInput.value.startsWith('Документ ')) {
                nameInput.value = `Документ ${index + 1}`;
            }
        });
    }

    updateRemoveButtonsVisibility() {
        const ranges = this.rangesContainer.children;
        
        // Показываем кнопку удаления только на последнем диапазоне (если их больше одного)
        Array.from(ranges).forEach((range, index) => {
            const removeBtn = range.querySelector('.remove-range');
            if (removeBtn) {
                if (ranges.length > 1 && index === ranges.length - 1) {
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
        
        // Очищаем кнопку скачивания
        const downloadBtn = document.getElementById('download-button-container');
        if (downloadBtn) downloadBtn.remove();
        
        // Сбрасываем файлы только если явно указано
        if (!keepFiles) {
            this.fileInput.value = '';
            this.hideFileInfo();
        }
        
        // Сбрасываем состояние кнопки загрузки
        this.resetUploadButton();
        
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
        const originalHtml = this.splitButton.innerHTML;
        this.splitButton.disabled = true;
        this.splitButton.innerHTML = `
            <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Обработка...
        `;
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
                    ranges: ranges
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
        // Удаляем предыдущую кнопку
        const oldButton = document.getElementById('download-button-container');
        if (oldButton) oldButton.remove();
        
        // Создаем кнопку
        const downloadBtn = document.createElement('a');
        downloadBtn.id = 'download-button-container'; // Важно: тот же ID
        downloadBtn.href = downloadUrl;
        downloadBtn.className = 'w-full bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded-md font-medium transition duration-200 cursor-pointer text-sm flex items-center justify-center mt-4';
        downloadBtn.download = filename;
        downloadBtn.innerHTML = `
            <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
            </svg>
            Скачать файлы
        `;
        
        // Вставляем после кнопки "Разделить PDF"
        this.splitButton.insertAdjacentElement('afterend', downloadBtn);
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
            const systemNumberInput = rangeEl.querySelector('.system-number');
            
            const from = parseInt(fromInput.value);
            const to = parseInt(toInput.value);
            const name = nameInput.value.trim();
            const type = typeSelect.value;
            const systemNumber = systemNumberInput.value.trim();
            
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
}

document.addEventListener('DOMContentLoaded', () => {
    new PdfSplitter();
});