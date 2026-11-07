/* Where marks live.
 *
 * Mine: this browser only, in localStorage, no backend.
 * Band: the API, with a local copy for offline viewing and an outbox of saves
 * that haven't reached the API yet. Saves leave the outbox only once the API
 * confirms them, so nothing is lost when a rehearsal room has no Wi-Fi.
 */
const RETRY_MS = 30000;
const K = {
    mine: (id) => `marks:mine:${id}`,
    band: (id) => `marks:band:${id}`,
    outbox: 'marks:outbox',
    password: 'marks:bandKey',
};

export const chartId = ({ band, song, chart }) => `${band}|${song}|${chart}`;

/** A random stroke id. crypto.randomUUID doesn't exist on plain http pages. */
export function newId() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function readJson(key, fallback) {
    try {
        return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
        return fallback;
    }
}

export class MarksStore extends EventTarget {
    constructor(api) {
        super();
        this.api = api;
        this.outbox = readJson(K.outbox, []);
        this.flushing = false;
        this.offline = false;
        this.retryTimer = null;
        this.lastBody = new Map();
        window.addEventListener('online', () => this.flush());
    }

    /* ---------- Mine ---------- */

    mine(key) {
        return readJson(K.mine(chartId(key)), []);
    }

    /** Throws if the browser's storage is full. */
    saveMine(key, strokes) {
        localStorage.setItem(K.mine(chartId(key)), JSON.stringify(strokes));
        navigator.storage?.persist?.().catch(() => {});
    }

    /* ---------- Band ---------- */

    get hasPassword() { return !!localStorage.getItem(K.password); }
    get pending() { return this.outbox.length; }

    /** The band's marks as this device should show them: the last copy from
     *  the API with this device's unsent saves applied on top. */
    band(key) {
        const id = chartId(key);
        const removed = new Set();
        const added = [];
        for (const op of this.outbox) {
            if (chartId(op.key) !== id) continue;
            op.remove.forEach((strokeId) => removed.add(strokeId));
            added.push(...op.add);
        }
        return [...readJson(K.band(id), []), ...added].filter((s) => !removed.has(s.id));
    }

    /** Fetch the latest marks. Emits 'change' only if they differ. */
    async refresh(key) {
        const query = new URLSearchParams(key);
        try {
            const res = await fetch(`${this.api}/marks?${query}`, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = await res.text();
            const id = chartId(key);
            this.setOffline(false);
            if (this.lastBody.get(id) === body) return;
            this.lastBody.set(id, body);
            this.cache(id, JSON.parse(body).strokes);
            this.dispatchEvent(new CustomEvent('change', { detail: { key } }));
        } catch {
            this.setOffline(true);
        }
    }

    cache(id, strokes) {
        try {
            localStorage.setItem(K.band(id), JSON.stringify(strokes));
        } catch (err) {
            console.warn('Could not cache band marks', err);
        }
    }

    /** Queue a save, then try to send it. */
    saveBand(key, { add = [], remove = [] }) {
        this.outbox.push({ key, add, remove });
        this.persistOutbox();
        this.flush();
    }

    persistOutbox() {
        localStorage.setItem(K.outbox, JSON.stringify(this.outbox));
        this.emitStatus();
    }

    async flush() {
        const password = localStorage.getItem(K.password);
        if (this.flushing || !password) return;
        this.flushing = true;
        clearTimeout(this.retryTimer);
        try {
            while (this.outbox.length) {
                const op = this.outbox[0];
                let res;
                try {
                    res = await fetch(`${this.api}/marks`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-Band-Key': password },
                        body: JSON.stringify({ ...op.key, add: op.add, remove: op.remove }),
                    });
                } catch {
                    this.retryLater();
                    return;
                }
                if (res.status === 401) {
                    localStorage.removeItem(K.password);
                    this.dispatchEvent(new CustomEvent('auth-needed'));
                    return;
                }
                if (res.status >= 500) {
                    this.retryLater();
                    return;
                }
                if (res.ok) this.applyToCache(op);
                else console.error('The API refused a save, dropping it', res.status, op);
                this.outbox.shift();
                this.setOffline(false);
                this.persistOutbox();
            }
        } finally {
            this.flushing = false;
            this.emitStatus();
        }
    }

    applyToCache(op) {
        const id = chartId(op.key);
        const removed = new Set(op.remove);
        const strokes = readJson(K.band(id), []).filter((s) => !removed.has(s.id));
        const seen = new Set(strokes.map((s) => s.id));
        strokes.push(...op.add.filter((s) => !seen.has(s.id)));
        this.cache(id, strokes);
    }

    retryLater() {
        this.setOffline(true);
        this.retryTimer = setTimeout(() => this.flush(), RETRY_MS);
    }

    setOffline(offline) {
        if (this.offline === offline) return;
        this.offline = offline;
        this.emitStatus();
    }

    emitStatus() {
        this.dispatchEvent(new CustomEvent('status'));
    }

    /** Check a password against the API, and remember it if it's right.
     *  Returns false if wrong, throws if the API can't be reached. */
    async login(password) {
        const res = await fetch(`${this.api}/auth`, { method: 'POST', headers: { 'X-Band-Key': password } });
        if (res.status === 401) return false;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        localStorage.setItem(K.password, password);
        this.flush();
        return true;
    }
}
