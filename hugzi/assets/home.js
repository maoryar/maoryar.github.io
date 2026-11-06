/* Band home page: photo carousel + lightbox. */

const PHOTO_BASE = 'https://maoryaron-webpage-storage.s3.eu-north-1.amazonaws.com/';

// Display order of choogzi-live-<n>.jpg in the bucket.
const PHOTO_ORDER = [8, 14, 7, 5, 11, 1, 15, 9, 2, 12, 18, 3, 16, 4, 13, 17, 6, 10, 19];
const photos = PHOTO_ORDER.map((n) => `${PHOTO_BASE}choogzi-live-${n}.jpg`);

const ZOOM_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/>' +
    '<line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/>' +
    '<line x1="8" y1="11" x2="14" y2="11"/></svg>';

const $ = (id) => document.getElementById(id);

$('year').textContent = new Date().getFullYear();

/* ---------- carousel ---------- */

const carousel = $('carousel');

carousel.replaceChildren(...photos.map((src, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'photo';
    btn.setAttribute('aria-label', `הגדלת תמונה ${i + 1}`);
    btn.innerHTML = `<img src="${src}" alt="חוגזי בהופעה ${i + 1}" loading="lazy"><span class="zoom-icon">${ZOOM_ICON}</span>`;
    btn.addEventListener('click', () => openLightbox(i));

    const li = document.createElement('li');
    li.append(btn);
    return li;
}));

// "Forward" scrolls toward the end of the RTL track, i.e. to the left.
const SCROLL_STEP = 340 * 2;   // about two photos
const scrollCarousel = (direction) => carousel.scrollBy({ left: -direction * SCROLL_STEP, behavior: 'smooth' });

$('carousel-forward').addEventListener('click', () => scrollCarousel(1));
$('carousel-back').addEventListener('click', () => scrollCarousel(-1));

/* ---------- lightbox ---------- */

const lightbox = $('lightbox');
const lbImg = $('lb-img');
let current = 0;

function showPhoto(index) {
    current = (index + photos.length) % photos.length;
    lbImg.src = photos[current];
    lbImg.alt = `חוגזי בהופעה ${current + 1}`;
    $('lb-counter').textContent = `${current + 1} / ${photos.length}`;
}

function openLightbox(index) {
    showPhoto(index);
    lightbox.showModal();
    document.body.classList.add('no-scroll');
}

lightbox.addEventListener('close', () => document.body.classList.remove('no-scroll'));
lightbox.addEventListener('click', (e) => { if (e.target === lightbox) lightbox.close(); });
lightbox.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') showPhoto(current + 1);
    if (e.key === 'ArrowLeft') showPhoto(current - 1);
});

$('lb-close').addEventListener('click', () => lightbox.close());
$('lb-forward').addEventListener('click', () => showPhoto(current + 1));
$('lb-back').addEventListener('click', () => showPhoto(current - 1));
