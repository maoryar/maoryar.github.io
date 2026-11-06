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

/* ---------- Chart ---------- */

export function chartPanel(baseUrl) {
    const panel = byId('chart-viewport').closest('.panel');
    const img = byId('chart-img');
    const status = byId('chart-status');
    const openLink = byId('chart-open');

    const setStatus = (text = '', isError = false) => {
        status.textContent = text;
        status.className = 'chart-status' + (text ? ' visible' : '') + (isError ? ' error' : '');
    };

    img.addEventListener('load', () => setStatus());
    img.addEventListener('error', () => {
        if (img.getAttribute('src')) setStatus('טעינת האקורדים נכשלה · נסו לפתוח את הקובץ בלשונית חדשה.', true);
    });

    function show(song) {
        const url = assetUrl(baseUrl, song.chart);
        openLink.href = url;
        img.alt = `אקורדים: ${song.title}`;
        if (img.getAttribute('src') === url && img.complete) return;
        setStatus('טוען אקורדים…');
        img.src = url;
    }

    function hide() {
        img.removeAttribute('src');   // stop any in-flight download
        setStatus();
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
