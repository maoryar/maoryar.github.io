/* The three viewer panels: BPM pulse, chart image, lyrics text. */
import { assetUrl, byId, el, fetchOk, latestOnly } from './util.js';

/* ---------- BPM ---------- */

const BEATS_PER_BAR = 4;

export function bpmPanel() {
    const panel = byId('bpm-song').closest('.panel');
    const core = byId('pulse-core');
    const ring = byId('pulse-ring');
    const dotsBox = byId('beat-dots');
    let rafId = null;

    function stop() {
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = null;
    }

    function show(song) {
        stop();   // a previous song's loop must not keep running
        byId('bpm-song').textContent = song.title;
        byId('bpm-value').textContent = song.bpm;

        const dots = Array.from({ length: BEATS_PER_BAR }, (_, b) =>
            el('span', { class: b === 0 ? 'beat-dot downbeat' : 'beat-dot' }));
        dotsBox.replaceChildren(...dots);

        // requestAnimationFrame against a fixed start time, not setInterval,
        // so the pulse never drifts out of tempo.
        const interval = 60000 / song.bpm;
        const t0 = performance.now();
        let lastBeat = -1;

        const frame = (now) => {
            const beat = Math.floor((now - t0) / interval);
            if (beat !== lastBeat) {
                lastBeat = beat;
                const pos = beat % BEATS_PER_BAR;
                dots.forEach((d, i) => d.classList.toggle('on', i === pos));

                core.classList.remove('hit');
                ring.classList.remove('hit');
                void core.offsetWidth;   // reflow, so the animation restarts
                core.classList.add('hit');
                ring.classList.add('hit');
                setTimeout(() => core.classList.remove('hit'), Math.min(120, interval / 2));
            }
            rafId = requestAnimationFrame(frame);
        };
        rafId = requestAnimationFrame(frame);
    }

    return { el: panel, has: (song) => !!song.bpm, show, hide: stop };
}

/* ---------- Chart ----------
   The image sits in a stage sized to exactly the chart's on-screen box, so the
   marks layer on top of it covers the chart and nothing else. A multi-page chart
   is one PNG with the pages stacked.

   Zoom is the app's own, not the browser's: the stage (image and marks layer
   together) is laid out at the zoomed size and the viewport scrolls, so marks
   stay on the chart and the Pencil keeps drawing at any zoom. Zoom 1 fits the
   chart's width to the screen (the default); the smallest zoom fits one whole
   page. Two fingers pinch, the buttons step, and the level is remembered on
   the device. */

const VIEWPORT_PADDING = 8;
const ZOOM_MAX = 3;
const ZOOM_STEP = 1.25;
const ZOOM_KEY = 'chart:zoom';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function savedZoom() {
    try {
        const z = Number(localStorage.getItem(ZOOM_KEY));
        return Number.isFinite(z) && z > 0 ? z : 1;
    } catch {
        return 1;
    }
}

export function chartPanel(baseUrl, bandId) {
    const viewport = byId('chart-viewport');
    const panel = viewport.closest('.panel');
    const stage = byId('chart-stage');
    const img = byId('chart-img');
    const status = byId('chart-status');
    const openLink = byId('chart-open');
    const zoomLabel = byId('chart-zoom-reset');

    const setStatus = (text = '', isError = false) => {
        status.textContent = text;
        status.className = 'chart-status' + (text ? ' visible' : '') + (isError ? ' error' : '');
    };

    let marks = null;
    let marksLoading = null;
    let current = null;
    // Relative to fitting the chart's width. `wanted` is what was asked for; it
    // is only limited when laid out (`zoom`), so a passing size change (the
    // toolbar appearing) doesn't overwrite it.
    let wanted = savedZoom();
    let zoom = 1;
    let minZoom = 1;            // fits one whole page

    const ready = () => img.getAttribute('src') && img.complete && img.naturalWidth;

    function fit() {
        if (!ready()) {
            stage.style.width = stage.style.height = stage.style.maxWidth = stage.style.maxHeight = '';
            viewport.classList.remove('pannable');
            return;
        }
        const w = viewport.clientWidth - 2 * VIEWPORT_PADDING;
        const h = viewport.clientHeight - 2 * VIEWPORT_PADDING;
        // A chart of several A4 pages is one tall image, pages stacked.
        const pages = Math.max(1, Math.round(img.naturalHeight / (img.naturalWidth * Math.SQRT2)));
        const widthScale = w / img.naturalWidth;
        const pageScale = Math.min(widthScale, h / (img.naturalHeight / pages));
        minZoom = Math.min(1, pageScale / widthScale);
        zoom = clamp(wanted, minZoom, ZOOM_MAX);
        const scale = widthScale * zoom;
        const width = Math.floor(img.naturalWidth * scale);
        const height = Math.floor(img.naturalHeight * scale);
        stage.style.maxWidth = stage.style.maxHeight = 'none';
        stage.style.width = `${width}px`;
        stage.style.height = `${height}px`;
        viewport.classList.toggle('pannable', width > w + 1);
        zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
        marks?.resize(width, height);
    }
    new ResizeObserver(() => fit()).observe(viewport);

    /** Zoom to z, keeping the chart point under (x, y) where it is. */
    function setZoom(z, x, y) {
        if (!ready()) return;
        const v = viewport.getBoundingClientRect();
        x ??= v.left + v.width / 2;
        y ??= v.top + v.height / 2;
        const before = stage.getBoundingClientRect();
        const fx = (x - before.left) / before.width;
        const fy = (y - before.top) / before.height;
        wanted = clamp(z, minZoom, ZOOM_MAX);
        try { localStorage.setItem(ZOOM_KEY, String(Math.round(wanted * 1000) / 1000)); } catch { /* private mode */ }
        fit();
        const after = stage.getBoundingClientRect();
        viewport.scrollLeft += after.left + fx * after.width - x;
        viewport.scrollTop += after.top + fy * after.height - y;
    }

    byId('chart-zoom-in').addEventListener('click', () => setZoom(zoom * ZOOM_STEP));
    byId('chart-zoom-out').addEventListener('click', () => setZoom(zoom / ZOOM_STEP));
    zoomLabel.addEventListener('click', () => setZoom(1));

    /* Pinch with two fingers. While the fingers move only a CSS scale is
       applied (cheap); the real layout, and the marks at full sharpness, follow
       when they lift. A Pencil is never one of the two. */
    let pinch = null;
    const fingers = (e) => [...e.touches].filter((t) => t.touchType !== 'stylus');
    const spread = ([a, b]) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

    viewport.addEventListener('touchstart', (e) => {
        const f = fingers(e);
        if (f.length !== 2 || !ready()) return;
        const x = (f[0].clientX + f[1].clientX) / 2;
        const y = (f[0].clientY + f[1].clientY) / 2;
        const rect = stage.getBoundingClientRect();
        pinch = { d0: spread(f) || 1, x, y, z0: zoom, ratio: 1 };
        stage.style.transformOrigin = `${x - rect.left}px ${y - rect.top}px`;
    }, { passive: true });

    viewport.addEventListener('touchmove', (e) => {
        if (!pinch) return;
        const f = fingers(e);
        if (f.length < 2) return;
        e.preventDefault();   // the fingers zoom the chart, not the page
        pinch.ratio = clamp(pinch.z0 * spread(f) / pinch.d0, minZoom, ZOOM_MAX) / pinch.z0;
        stage.style.transform = `scale(${pinch.ratio})`;
    }, { passive: false });

    const endPinch = (e) => {
        if (!pinch || fingers(e).length >= 2) return;
        const { x, y, z0, ratio } = pinch;
        pinch = null;
        stage.style.transform = stage.style.transformOrigin = '';
        if (Math.abs(ratio - 1) > 0.01) setZoom(z0 * ratio, x, y);
    };
    viewport.addEventListener('touchend', endPinch);
    viewport.addEventListener('touchcancel', endPinch);

    // Safari's own pinch gesture: the chart handles it, the page must not zoom.
    for (const type of ['gesturestart', 'gesturechange']) {
        viewport.addEventListener(type, (e) => e.preventDefault(), { passive: false });
    }

    // Trackpad pinch (and Ctrl+wheel) on a computer.
    viewport.addEventListener('wheel', (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        setZoom(zoom * Math.exp(-e.deltaY / 200), e.clientX, e.clientY);
    }, { passive: false });

    /* The drawing code (and Fabric) loads on first use. If it fails, the chart
       still works; there are just no marks. */
    function loadMarks() {
        marksLoading ??= import('./marks/marks.js')
            .then(({ createMarks }) => {
                marks = createMarks({ stage, bar: byId('marks-bar'), band: bandId });
                if (current) marks.show(current);
                fit();
            })
            .catch((err) => {
                // Try again on the next chart, e.g. after a dropped connection.
                marksLoading = null;
                console.warn('Chart marks are unavailable', err);
            });
    }

    img.addEventListener('load', () => { setStatus(); fit(); });
    img.addEventListener('error', () => {
        fit();
        if (img.getAttribute('src')) setStatus('טעינת האקורדים נכשלה · נסו לפתוח את הקובץ בלשונית חדשה.', true);
    });

    function show(song) {
        const url = assetUrl(baseUrl, song.chart);
        openLink.href = url;
        img.alt = `אקורדים: ${song.title}`;
        if (current?.id !== song.id) viewport.scrollTop = viewport.scrollLeft = 0;
        current = song;
        marks?.show(song);
        loadMarks();
        if (img.getAttribute('src') === url && img.complete) return fit();
        setStatus('טוען אקורדים…');
        img.src = url;
        fit();
    }

    function hide() {
        current = null;
        pinch = null;
        stage.style.transform = '';
        marks?.hide();
        img.removeAttribute('src');   // stop any in-flight download
        setStatus();
        fit();
    }

    return { el: panel, has: (song) => !!song.chart, show, hide };
}

/* ---------- Lyrics ----------
   Plain-text files fetched from the bucket (needs CORS), cached per song. */

export function lyricsPanel(baseUrl) {
    const panel = byId('lyrics-title').closest('.panel');
    const title = byId('lyrics-title');
    const body = byId('lyrics-body');
    const cache = new Map();
    const request = latestOnly();

    const showText = (text) => {
        body.className = 'lyrics-body';
        body.textContent = text;
        body.scrollTop = 0;
    };

    const showMessage = (...content) => {
        body.className = 'lyrics-body message';
        body.replaceChildren(...content);
    };

    async function show(song) {
        title.textContent = song.title;
        if (cache.has(song.id)) return showText(cache.get(song.id));

        showMessage('טוען מילים…');
        const token = request();
        const url = assetUrl(baseUrl, song.lyrics);
        try {
            const text = await (await fetchOk(url)).text();
            cache.set(song.id, text);
            if (request.isCurrent(token)) showText(text);
        } catch (err) {
            if (!request.isCurrent(token)) return;
            showMessage(
                `לא ניתן לטעון את המילים (${err.message}). `,
                el('a', { attrs: { href: url, target: '_blank', rel: 'noopener noreferrer' } },
                    'פתח את הקובץ בלשונית חדשה'),
            );
        }
    }

    return { el: panel, has: (song) => !!song.lyrics, show, hide: () => request.invalidate() };
}
