/* Setlist edit mode (manager only): drag songs into a new order, change BPMs,
 * and disable songs (swipe a row left, or its button), then save for everyone.
 * Playback keeps going while editing. */
import Sortable from '../vendor/sortable-1.15.7.esm.js';
import { byId, el } from './util.js';
import { askManagerPassword, ensureManager } from './manager.js';
import { applyEdits, saveEdits } from './order.js';

const MIN_BPM = 20;
const MAX_BPM = 400;
const SWIPE_PX = 60;        // leftward travel that toggles a row
const SWIPE_RATIO = 1.5;    // must be this much more horizontal than vertical

/**
 *   band       band id
 *   base()     the JSON's songs, in JSON order
 *   edits()    the edits the page currently shows
 *   onSaved(edits)  apply newly saved (or newer) edits to the page
 */
export function createEditor({ band, base, edits, onSaved }) {
    const songList = byId('song-list');
    const button = byId('edit-btn');
    const list = el('ul', { class: 'edit-list', attrs: { 'aria-label': 'סדר השירים' } });
    const status = el('span', { class: 'editor-status', attrs: { 'aria-live': 'polite' } });
    const saveBtn = el('button', { class: 'editor-btn primary', attrs: { type: 'button' }, on: { click: save } }, 'שמירה');
    const panel = el('section', { class: 'setlist-editor', attrs: { hidden: true, 'aria-label': 'עריכת הסטליסט' } }, [
        el('div', { class: 'editor-bar' }, [
            saveBtn,
            el('button', { class: 'editor-btn', attrs: { type: 'button' }, on: { click: close } }, 'ביטול'),
            el('button', { class: 'editor-btn', attrs: { type: 'button' }, on: { click: reset } }, 'איפוס לסדר המקורי'),
            status,
        ]),
        el('p', { class: 'editor-hint' }, 'גררו שיר בידית ⠿ כדי לשנות את הסדר. החליקו שיר שמאלה כדי להשבית אותו (ושוב כדי להחזיר). השינויים נשמרים לכולם.'),
        list,
    ]);
    songList.before(panel);
    // forceFallback: the same pointer-driven dragging on iPad, Mac and in tests.
    Sortable.create(list, { handle: '.drag-handle', animation: 150, ghostClass: 'dragging', forceFallback: true });

    let startVersion = 0;
    let open = false;

    function setDisabled(row, off) {
        row.classList.toggle('disabled', off);
        const toggle = row.querySelector('.edit-toggle');
        toggle.setAttribute('aria-pressed', String(off));
        toggle.textContent = off ? 'מושבת' : 'פעיל';
        toggle.title = off ? 'השיר מושבת · לחצו כדי להחזיר' : 'לחצו כדי להשבית את השיר';
    }

    function fill(songs) {
        const original = new Map(base().map((s) => [s.id, s.bpm]));
        list.replaceChildren(...songs.map((song) => {
            const toggle = el('button', { class: 'edit-toggle', attrs: { type: 'button' } });
            const row = el('li', { class: 'edit-row', attrs: { 'data-id': song.id } }, [
                el('span', { class: 'drag-handle', attrs: { 'aria-hidden': 'true' } }, '⠿'),
                el('span', { class: 'edit-title' }, song.title),
                toggle,
                el('label', { class: 'edit-bpm' }, [
                    el('input', {
                        attrs: {
                            type: 'number', inputmode: 'numeric', min: MIN_BPM, max: MAX_BPM, step: 1,
                            value: song.bpm ?? '', placeholder: original.get(song.id) ?? '', 'aria-label': `BPM של ${song.title}`,
                        },
                    }),
                    el('span', {}, 'bpm'),
                ]),
            ]);
            toggle.addEventListener('click', () => setDisabled(row, !row.classList.contains('disabled')));
            setDisabled(row, !!song.disabled);
            return row;
        }));
    }

    /* Swipe a row left to toggle it. Only the handle drags (Sortable), and
       rows let the page scroll vertically, so the three don't clash. */
    let swipe = null;
    list.addEventListener('pointerdown', (e) => {
        const row = e.target.closest('.edit-row');
        if (!row || e.target.closest('.drag-handle, input, button')) return;
        swipe = { row, id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0 };
    });
    list.addEventListener('pointermove', (e) => {
        if (!swipe || e.pointerId !== swipe.id) return;
        const dx = e.clientX - swipe.x;
        const dy = e.clientY - swipe.y;
        if (Math.abs(dy) > Math.abs(dx)) return;
        swipe.dx = Math.min(0, dx);
        swipe.row.style.transform = `translateX(${Math.max(swipe.dx, -2 * SWIPE_PX)}px)`;
        swipe.dy = dy;
    });
    const endSwipe = (e) => {
        if (!swipe || e.pointerId !== swipe.id) return;
        const { row, dx, dy = 0 } = swipe;
        swipe = null;
        row.style.transform = '';
        if (e.type === 'pointerup' && -dx >= SWIPE_PX && -dx >= Math.abs(dy) * SWIPE_RATIO) {
            setDisabled(row, !row.classList.contains('disabled'));
        }
    };
    list.addEventListener('pointerup', endSwipe);
    list.addEventListener('pointercancel', endSwipe);

    function setStatus(text, warn = false) {
        status.textContent = text;
        status.classList.toggle('warn', warn);
    }

    function show(on) {
        open = on;
        panel.hidden = !on;
        songList.hidden = on;
        button.setAttribute('aria-pressed', String(on));
        document.body.classList.toggle('editing-setlist', on);
    }

    async function start() {
        if (open) return close();
        if (!(await ensureManager())) return;
        const current = edits();
        startVersion = current.version;
        fill(applyEdits(base(), current));
        setStatus('');
        show(true);
    }

    function close() {
        show(false);
    }

    function reset() {
        fill(base());
        setStatus('הסדר והקצב המקוריים, כל השירים פעילים · לחצו שמירה כדי להחיל.');
    }

    /** Order and BPM changes from the form, or null if a BPM is invalid. */
    function collect() {
        const original = new Map(base().map((s) => [s.id, s.bpm]));
        const order = [];
        const bpm = {};
        const disabled = [];
        let valid = true;
        for (const row of list.children) {
            const id = row.dataset.id;
            order.push(id);
            if (row.classList.contains('disabled')) disabled.push(id);
            const input = row.querySelector('input');
            const raw = input.value.trim();
            const value = Number(raw);
            const ok = raw === '' || (Number.isInteger(value) && value >= MIN_BPM && value <= MAX_BPM);
            input.classList.toggle('invalid', !ok);
            valid &&= ok;
            if (ok && raw !== '' && value !== original.get(id)) bpm[id] = value;
        }
        return valid ? { order, bpm, disabled } : null;
    }

    async function save() {
        const changes = collect();
        if (!changes) return setStatus(`BPM צריך להיות מספר שלם בין ${MIN_BPM} ל-${MAX_BPM}.`, true);
        saveBtn.disabled = true;
        setStatus('שומר…');
        try {
            const result = await saveEdits(band, { version: startVersion, ...changes });
            if (result.status === 'auth') {
                setStatus('');
                if (await askManagerPassword()) return save();
                return;
            }
            onSaved(result.edits);
            if (result.status === 'conflict') {
                // Someone saved first: show their version and let the manager redo.
                startVersion = result.edits.version;
                fill(applyEdits(base(), result.edits));
                setStatus('מנהל אחר שמר בינתיים. הרשימה עודכנה לגרסה שלו, אפשר לערוך שוב.', true);
                return;
            }
            close();
        } catch {
            setStatus('אין חיבור · השינויים לא נשמרו. נסו שוב.', true);
        } finally {
            saveBtn.disabled = false;
        }
    }

    return { toggle: start, get isOpen() { return open; } };
}
