/* The manager's setlist edits: song order and BPM changes, kept in the API
 * on top of the setlist JSON. The JSON stays the list of songs; a song added
 * to it shows up at the end, a removed one simply drops out.
 *
 *   { version, order: [song id, ...], bpm: { song id: number }, disabled: [song id, ...], updated }
 *
 * A disabled song stays in the list, greyed out, and every sequence (play all,
 * next/previous, swiping through BPM, lyrics and charts) skips it.
 *
 * A copy is cached on the device, so the page shows the right order at once
 * and also without a connection. */
import { API } from './api.js';
import { forgetManagerPassword, managerPassword } from './manager.js';

const cacheKey = (band) => `setlist:${band}`;
export const EMPTY = { version: 0, order: [], bpm: {}, disabled: [], updated: 0 };

export function cachedEdits(band) {
    try {
        return JSON.parse(localStorage.getItem(cacheKey(band))) ?? null;
    } catch {
        return null;
    }
}

function cache(band, edits) {
    try {
        localStorage.setItem(cacheKey(band), JSON.stringify(edits));
    } catch { /* full storage: the page still works, just not offline */ }
}

/** The latest edits from the API, or null without a connection. */
export async function fetchEdits(band) {
    try {
        const res = await fetch(`${API}/setlist?band=${encodeURIComponent(band)}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const edits = await res.json();
        cache(band, edits);
        return edits;
    } catch {
        return null;
    }
}

/** The JSON's songs with the edits applied. Doesn't modify `base`. */
export function applyEdits(base, edits) {
    if (!edits?.version) return base.slice();
    const byId = new Map(base.map((s) => [s.id, s]));
    const out = [];
    for (const id of edits.order) {
        const song = byId.get(id);
        if (song) {
            out.push(song);
            byId.delete(id);
        }
    }
    out.push(...base.filter((s) => byId.has(s.id)));
    const disabled = new Set(edits.disabled ?? []);
    return out.map((s) => {
        const bpm = edits.bpm?.[s.id];
        if (!bpm && !disabled.has(s.id)) return s;
        return { ...s, ...(bpm && { bpm }), ...(disabled.has(s.id) && { disabled: true }) };
    });
}

/** Save. Returns { status: 'ok' | 'conflict' | 'auth', edits }; throws offline.
 *  On a conflict, `edits` is what the other manager saved. */
export async function saveEdits(band, { version, order, bpm, disabled }) {
    const res = await fetch(`${API}/setlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Band-Key': managerPassword() || '' },
        body: JSON.stringify({ band, version, order, bpm, disabled }),
    });
    if (res.status === 401) {
        forgetManagerPassword();
        return { status: 'auth' };
    }
    const body = await res.json().catch(() => ({}));
    if (res.status === 409) {
        cache(band, body.latest);
        return { status: 'conflict', edits: body.latest };
    }
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    cache(band, body);
    return { status: 'ok', edits: body };
}
