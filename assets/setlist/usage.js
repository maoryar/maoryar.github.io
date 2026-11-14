/* Anonymous usage counts for the setlist pages, sent to the site's own backend.
 *
 * No cookies, no third party, no names. Each browser gets a random id in
 * localStorage (`usage:device`); events say what was opened or played, plus a
 * coarse device class and whether the page runs as a Home Screen app. The raw
 * user agent never leaves the device.
 *
 * Never in the way: events are queued in localStorage, sent in the background
 * (fetch keepalive, or sendBeacon when the page is hidden), kept for later when
 * offline, and every failure is silent. Automated browsers are not counted.
 */
import { API } from './api.js';

const DEVICE_KEY = 'usage:device';
const QUEUE_KEY = 'usage:queue';
const DREW_KEY = 'usage:drew';     // sessionStorage: charts already counted as drawn on
const MAX_QUEUE = 200;
const BATCH = 50;                  // the API's limit per request
const SEND_DELAY_MS = 3000;

const off = (() => {
    try {
        return navigator.webdriver === true || !window.localStorage;
    } catch {
        return true;   // storage blocked
    }
})();

function randomId(bytes = 12) {
    return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function deviceId() {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!/^[0-9a-f]{32}$/.test(id || '')) {
        id = randomId(16);
        localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
}

/** iphone, ipad, mac, android or other. iPadOS Safari says "Macintosh";
 *  a touch screen gives it away. */
export function deviceClass(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints || 0) {
    if (/iPhone|iPod/.test(ua)) return 'iphone';
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return 'ipad';
    if (/Android/.test(ua)) return 'android';
    if (/Macintosh/.test(ua)) return 'mac';
    return 'other';
}

function isApp() {
    try {
        return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
    } catch {
        return false;
    }
}

function readQueue() {
    try {
        const q = JSON.parse(localStorage.getItem(QUEUE_KEY));
        return Array.isArray(q) ? q : [];
    } catch {
        return [];
    }
}

function writeQueue(q) {
    try {
        if (q.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-MAX_QUEUE)));
        else localStorage.removeItem(QUEUE_KEY);
    } catch { /* storage full or blocked: drop */ }
}

let timer = null;
let sending = false;

function body(events) {
    return JSON.stringify({ d: deviceId(), c: deviceClass(), a: isApp(), ev: events });
}

/** Send what is queued. 'beacon' is for a page being hidden: hand the batch to
 *  the browser and forget it. Otherwise a keepalive fetch: sent events leave the
 *  queue on any answer (a refused batch is not retried), stay on a network error. */
async function flush(mode) {
    clearTimeout(timer);
    timer = null;
    if (off || sending) return;
    const batch = readQueue().slice(0, BATCH);
    if (!batch.length) return;
    const url = `${API}/usage`;
    const sent = new Set(batch.map((e) => e.i));
    const drop = () => writeQueue(readQueue().filter((e) => !sent.has(e.i)));

    if (mode === 'beacon' && navigator.sendBeacon) {
        try {
            // text/plain keeps it a simple request: no CORS preflight.
            if (navigator.sendBeacon(url, new Blob([body(batch)], { type: 'text/plain' }))) drop();
        } catch { /* keep for next time */ }
        return;
    }
    if (!navigator.onLine) return;
    sending = true;
    try {
        const res = await fetch(url, {
            method: 'POST', body: body(batch), keepalive: true,
            headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
            credentials: 'omit', cache: 'no-store',
        });
        if (res.status < 500) drop();
    } catch {
        /* offline or the API is down: try again later */
    } finally {
        sending = false;
    }
    if (readQueue().length > 0 && batch.length === BATCH) schedule();
}

function schedule() {
    if (!timer) timer = setTimeout(() => flush(), SEND_DELAY_MS);
}

/**
 * Count one event. Never throws.
 *   track('chart_open', { band: 'hugzi', song: 'ad-hakatze' })
 *   track('remix_play', { band, song, version: 'bassboost' })
 */
export function track(event, { band, song, version } = {}) {
    if (off) return;
    try {
        const e = { i: randomId(8), e: event, t: Date.now(), b: band };
        if (song) e.s = song;
        if (version) e.v = version;
        const q = readQueue();
        q.push(e);
        writeQueue(q);
        schedule();
    } catch { /* never break the page */ }
}

/** Drawing counts once per chart per browser session, not per stroke. */
export function trackDraw(band, song) {
    if (off) return;
    try {
        const k = `${band}|${song}`;
        const done = JSON.parse(sessionStorage.getItem(DREW_KEY) || '[]');
        if (done.includes(k)) return;
        sessionStorage.setItem(DREW_KEY, JSON.stringify([...done, k]));
        track('draw', { band, song });
    } catch { /* never break the page */ }
}

if (!off) {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush('beacon');
        else schedule();
    });
    window.addEventListener('pagehide', () => flush('beacon'));
    window.addEventListener('online', () => schedule());
    schedule();   // whatever is left from an earlier visit
}
