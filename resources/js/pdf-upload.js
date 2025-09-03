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

        this.counterpartySelect = document.getElementById('counterparty-select');
        this.selectedCounterparty = null;
        this.isResultsVisible = false;
                
        // Явно находим кнопку загрузки
        this.uploadButton = this.uploadForm.querySelector('button[type="submit"]');
        
        this._totalPages = 0;
        this.currentMaxPage = 0; // Текущая максимальная страница для новых диапазонов
        
        this.initEventListeners();
        this.setupDragAndDrop();
        this.initCustomCounterpartySelect();

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
            
            if (files.length > 0) {
                // Создаем искусственное событие change для fileInput
                this.fileInput.files = files;
                const event = new Event('change', { bubbles: true });
                this.fileInput.dispatchEvent(event);
                
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

    showSelectedFiles(fileList) {
        const container = document.querySelector('.file-info-container');
        const fileNameSpan = document.querySelector('.file-name');
        
        if (container && fileNameSpan) {
            // Очищаем предыдущее содержимое
            fileNameSpan.innerHTML = '';
            
            // Преобразуем FileList в массив
            const files = Array.from(fileList);
            
            // Создаем список файлов
            files.forEach((file, index) => {
                const fileElement = document.createElement('div');
                fileElement.className = 'file-item flex items-center mb-1 last:mb-0';
                
                // Определяем тип файла по расширению, так как file.type может быть пустым для MSG
                const isPDF = file.name.toLowerCase().endsWith('.pdf');
                const isMSG = file.name.toLowerCase().endsWith('.msg');
                
                const icon = isPDF 
                    ? '<svg class="w-4 h-4 mr-2 text-red-500" fill="currentColor" viewBox="0 0 20 20"><path d="M9 2a2 2 0 00-2 2v8a2 2 0 002 2h6a2 2 0 002-2V6.414A2 2 0 0016.414 5L14 2.586A2 2 0 0012.586 2H9z"/></svg>'
                    : '<svg class="w-4 h-4 mr-2 text-blue-500" fill="currentColor" viewBox="0 0 20 20"><path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z"/><path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z"/></svg>';
                
                fileElement.innerHTML = `
                    ${icon}
                    <span class="text-sm truncate">${file.name}</span>
                `;
                
                fileNameSpan.appendChild(fileElement);
            });
            
            // Показываем контейнер
            container.classList.remove('hidden');
            
            // Автоматически расширяем блок если много файлов
            if (files.length > 2) {
                container.classList.add('overflow-y-auto', 'max-h-32');
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
                docName
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
                
                thumb.innerHTML = `
                    <a href="${page.image_url}" data-glightbox="title: Страница ${pageNumber}">
                        <img src="${page.image_url}" 
                            alt="Страница ${pageNumber}" 
                            class="w-full object-contain">
                    </a>
                    <div class="p-2 text-center bg-gray-50 border-t flex justify-between items-center">
                        <span class="text-xs font-medium">Стр. ${pageNumber}</span>
                        <span class="text-xs range-highlight hidden"></span>
                    </div>
                `;
                thumbsContainer.appendChild(thumb);
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
        const ranges = this.getRanges();
        const colors = [
            'blue', 'green', 'yellow', 'purple', 'pink', 'indigo',
            'red', 'teal', 'orange', 'cyan', 'lime', 'amber',
            'emerald', 'violet', 'fuchsia', 'rose', 'sky'
        ];
        
        // Собираем все страницы, которые входят в диапазоны
        const pagesInRanges = new Set();
        
        ranges.forEach((range, rangeIndex) => {
            const colorClass = colors[rangeIndex % colors.length];
            
            for (let page = range.from; page <= range.to; page++) {
                pagesInRanges.add(page);
                
                const thumb = document.querySelector(`.thumbnail-page[data-page-number="${page}"]`);
                if (thumb) {
                    // Убираем серую рамку и добавляем цветную
                    thumb.classList.remove('border-gray-200');
                    thumb.classList.add(`border-${colorClass}-500`, `shadow-${colorClass}-100`);
                    
                    // Убираем перечеркивание для страниц в диапазонах
                    thumb.classList.remove('opacity-60', 'line-through');
                    
                    // Добавляем бейдж с номером диапазона
                    const badgeContainer = thumb.querySelector('.bg-gray-50');
                    if (badgeContainer) {
                        const badge = document.createElement('span');
                        badge.className = `range-highlight text-xs px-2 py-1 rounded ml-2 bg-${colorClass}-100 text-${colorClass}-800 font-medium`;
                        badge.textContent = `Д${rangeIndex + 1}`;
                        badgeContainer.appendChild(badge);
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
                
                // Убираем цветную подсветку если была
                thumb.classList.remove('border-gray-200');
                
                // Добавляем иконку перечеркивания или текст
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
            }
        });
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

    addRange(from = null, to = null, fileName) {
        const ranges = this.getRanges();
        const docNumber = ranges.length + 1;
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
        const colorClass = rangeColors[(docNumber - 1) % rangeColors.length];

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
        rangeElement.className = `space-y-2 p-4 rounded-lg border-2 ${colorClass}`;
        
        // Генерируем уникальное имя для нового диапазона
        const newName = fileName || `Документ ${docNumber}`;
        
        rangeElement.innerHTML = `
            <div class="flex justify-between items-center mb-2">
                <input type="text" 
                    value="${newName}" 
                    class="document-name border rounded px-2 py-1 w-87 text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Название документа">
                <button type="button" class="remove-range text-red-500 hover:text-red-700 cursor-pointer">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                    </svg>
                </button>
            </div>
            <div class="flex items-center space-x-3 mb-2">
                <select class="document-type border rounded px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 cursor-pointer">
                    <option value="14" ${selectedType === '14' ? 'selected' : ''}>Протокол к договору</option>
                    <option value="15" ${selectedType === '15' ? 'selected' : ''}>Приложение к договору</option>
                    <option value="16" ${selectedType === '16' ? 'selected' : ''}>Доп.соглашение</option>
                    <option value="91" ${selectedType === '91' ? 'selected' : ''}>Договор с покупателем</option>
                    <option value="93" ${selectedType === '93' ? 'selected' : ''}>Письма</option>
                    <option value="134" ${selectedType === '134' ? 'selected' : ''}>Прочие документы</option>
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
        `;

        // Обработчик удаления
        const removeBtn = rangeElement.querySelector('.remove-range');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                if (this.rangesContainer.children.length > 1) {
                    rangeElement.remove();
                    this.renumberDocuments();
                    this.updateRemoveButtonsVisibility();
                    this.updateThumbnailsHighlight();
                }
            });
        }

        // Обработчики изменений
        const fromInput = rangeElement.querySelector('.from-input');
        const toInput = rangeElement.querySelector('.to-input');
        
        fromInput.addEventListener('change', () => {
            this.adjustRangesAfterManualEdit(rangeElement);
            this.updateThumbnailsHighlight();
        });

        toInput.addEventListener('change', () => {
            this.adjustRangesAfterManualEdit(rangeElement);
            this.updateThumbnailsHighlight();
        });

        // ДОБАВЛЯЕМ: Обработчик изменения названия документа
        const documentNameInput = rangeElement.querySelector('.document-name');
        const documentTypeSelect = rangeElement.querySelector('.document-type');
        
        documentNameInput.addEventListener('input', (e) => {
            this.updateDocumentTypeBasedOnName(e.target.value, documentTypeSelect);
        });

        documentNameInput.addEventListener('change', (e) => {
            this.updateDocumentTypeBasedOnName(e.target.value, documentTypeSelect);
        });

        this.rangesContainer.appendChild(rangeElement);
        this.updateRemoveButtonsVisibility();
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
        
        rangeContainers.forEach((container, index) => {
            // Обновляем цвет контейнера
            const colorClass = rangeColors[index % rangeColors.length];
            container.className = `range-container ${colorClass} p-4 rounded-lg border`;
            
            // Обновляем имя документа если нужно
            const nameInput = container.querySelector('.document-name');
            if (nameInput && nameInput.value.startsWith('Документ ')) {
                nameInput.value = `Документ ${index + 1}`;
            }
        });
        
        this.updateThumbnailsHighlight(); // Обновляем подсветку после перенумерации
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
        const selectedCounterparty = this.getSelectedCounterparty();
        const originalHtml = this.splitButton.innerHTML;
        this.splitButton.disabled = true;
        this.splitButton.innerHTML = `
            <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Обработка...
        `;

        this.hideDownloadButton();

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

    hideDownloadButton() {
        const downloadBtn = document.getElementById('download-button-container');
        if (downloadBtn) {
            downloadBtn.style.display = 'none';
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

    selectCounterparty(option) {
        this.counterpartySearch.value = option.text;
        this.selectedCounterparty = {
            kpl: option.value,
            name: option.getAttribute('data-name') || option.text
        };
        
        // Скрываем результаты после выбора
        this.hideResults();
        
        // Фокус остается на поле поиска для возможного редактирования
        this.counterpartySearch.focus();
        
        // Выделяем весь текст для удобства редактирования
        this.counterpartySearch.select();
    }

    getSelectedCounterparty() {
        return this.selectedCounterparty;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new PdfSplitter();
});