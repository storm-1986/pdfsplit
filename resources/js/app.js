import './bootstrap';
import GLightbox from 'glightbox';
import 'glightbox/dist/css/glightbox.css';

// Инициализируем GLightbox
const lightbox = GLightbox({
  selector: '[data-glightbox]',
  touchNavigation: true
});

// Делаем доступным для PdfUploader
window._glightbox = lightbox;