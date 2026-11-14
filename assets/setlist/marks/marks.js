/* Chart marks: drawing on a chart, in two layers.
 *
 *   Mine  this device only
 *   Band  shared through the API; anyone can see it, editing needs the password
 *
 * Fabric only renders. Input is handled here, so the rule "only the Pencil
 * draws, fingers keep scrolling and zooming" doesn't fight Fabric's own touch
 * handling: a finger never reaches the drawing code, and Pencil touches are
 * kept from scrolling the page.
 */
import { StaticCanvas } from '../../vendor/fabric-7.4.0.min.mjs';
import { el, svg } from '../util.js';
import { API } from '../api.js';
import { askManagerPassword, managerPassword } from '../manager.js';
import { SCENE_WIDTH, toObject, touches } from './ink.js';
import { MarksStore, chartId, newId } from './store.js';
import { trackDraw } from '../usage.js';

const LAYERS = ['mine', 'band'];
const LAYER_NAMES = { mine: 'שלי', band: 'להקה' };
const COLORS = ['#111827', '#dc2626', '#2563eb'];
const HIGHLIGHT = '#facc15';
const SIZES = { pen: 4, highlighter: 22, text: 26 };
const ERASER_RADIUS = 8;
const REFRESH_MS = 20000;
const MAX_CANVAS_PIXELS = 8e6;   // well under iOS's per-canvas limit (16.7 M)
const HEBREW = /[֐-׿]/;

const ICON = {
    pen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    highlighter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>',
    text: '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
    eraser: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 19"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>',
    undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>',
    marks: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
};
const TOOL_NAMES = { pen: 'עט', highlighter: 'מרקר', text: 'טקסט', eraser: 'מחק' };

function loadPrefs() {
    const defaults = { layer: 'mine', tool: 'pen', color: COLORS[0], show: { mine: true, band: true } };
    try {
        const saved = JSON.parse(localStorage.getItem('marks:prefs'));
        return { ...defaults, ...saved, show: { ...defaults.show, ...saved?.show } };
    } catch {
        return defaults;
    }
}

export function createMarks({ stage, bar, band }) {
    const store = new MarksStore(API);
    const prefs = loadPrefs();
    const savePrefs = () => localStorage.setItem('marks:prefs', JSON.stringify(prefs));

    const canvasEl = el('canvas', { class: 'marks-canvas', attrs: { 'aria-hidden': 'true' } });
    stage.append(canvasEl);
    // Resolution is managed in resize(), not by Fabric's retina scaling.
    const canvas = new StaticCanvas(canvasEl, { renderOnAddRemove: false, enableRetinaScaling: false });

    let key = null;           // { band, song, chart } of the chart on screen
    let editing = false;      // tools open
    let strokes = { mine: [], band: [] };
    const objects = new Map(); // stroke id -> Fabric object, reused between renders
    const undoStacks = new Map();
    let live = null;          // the stroke being drawn: { pointerId, stroke, object }
    let erasing = null;       // pointerId of an eraser drag
    let tap = null;           // text tool: where the pointer went down
    let refreshTimer = null;
    let scale = 1;

    /* ---------- Toolbar ---------- */

    const button = (cls, attrs, children, onClick) =>
        el('button', { class: cls, attrs: { type: 'button', ...attrs }, on: { click: onClick } }, children);

    const toggle = button('marks-btn marks-toggle', { title: 'סימון על התווים', 'aria-pressed': 'false' },
        [svg(ICON.marks), el('span', {}, 'סימון')], () => setEditing(!editing));

    const showChips = LAYERS.map((layer) => button('marks-chip', {
        'data-show': layer, title: `הצג או הסתר את שכבת ${LAYER_NAMES[layer]}`,
    }, `👁 ${LAYER_NAMES[layer]}`, () => {
        prefs.show[layer] = !prefs.show[layer];
        savePrefs();
        render();
        updateBar();
    }));

    const layerButtons = LAYERS.map((layer) => button('marks-seg', { 'data-layer': layer }, LAYER_NAMES[layer],
        () => chooseLayer(layer)));

    const toolButtons = Object.keys(TOOL_NAMES).map((tool) => button('marks-btn', {
        'data-tool': tool, title: TOOL_NAMES[tool], 'aria-label': TOOL_NAMES[tool],
    }, svg(ICON[tool]), () => { prefs.tool = tool; savePrefs(); updateBar(); }));

    const colorButtons = COLORS.map((color) => button('marks-color', {
        'data-color': color, title: 'צבע', 'aria-label': 'צבע', style: `--swatch:${color}`,
    }, null, () => { prefs.color = color; if (prefs.tool === 'eraser' || prefs.tool === 'highlighter') prefs.tool = 'pen'; savePrefs(); updateBar(); }));

    const undoButton = button('marks-btn', { 'data-action': 'undo', title: 'בטל', 'aria-label': 'בטל' },
        svg(ICON.undo), () => undo());

    const sync = el('span', { class: 'marks-sync', attrs: { 'aria-live': 'polite' } });

    const tools = el('div', { class: 'marks-tools' }, [
        el('div', { class: 'marks-segs', attrs: { role: 'group', 'aria-label': 'שכבה לציור' } }, layerButtons),
        ...toolButtons, ...colorButtons, undoButton,
    ]);
    bar.replaceChildren(toggle, ...showChips, sync, tools);
    bar.hidden = false;

    store.addEventListener('auth-needed', async () => {
        if (await askManagerPassword()) store.flush();
    });

    async function chooseLayer(layer) {
        if (layer === 'band' && !managerPassword() && !(await askManagerPassword())) return;
        prefs.layer = layer;
        prefs.show[layer] = true;
        savePrefs();
        render();
        updateBar();
    }

    function setEditing(on) {
        editing = on;
        if (!on) {
            finishLive();
            commitText();
        }
        updateBar();
    }

    function updateBar() {
        toggle.setAttribute('aria-pressed', String(editing));
        bar.classList.toggle('editing', editing);
        stage.classList.toggle('drawing', editing);
        stage.dataset.tool = editing ? prefs.tool : '';
        for (const b of showChips) b.setAttribute('aria-pressed', String(prefs.show[b.dataset.show]));
        for (const b of layerButtons) b.setAttribute('aria-pressed', String(prefs.layer === b.dataset.layer));
        for (const b of toolButtons) b.setAttribute('aria-pressed', String(prefs.tool === b.dataset.tool));
        for (const b of colorButtons) {
            b.setAttribute('aria-pressed', String(prefs.color === b.dataset.color && prefs.tool !== 'eraser' && prefs.tool !== 'highlighter'));
        }
        undoButton.disabled = !key || !undoStack().length;
        updateSync();
    }

    function updateSync() {
        const n = store.pending;
        sync.textContent = n
            ? `⏳ ${n} ${store.offline ? 'ממתינים לחיבור' : 'נשלחים…'}`
            : (store.offline ? 'ללא חיבור · מוצג עותק שמור' : '');
        sync.classList.toggle('warn', store.offline);
    }
    store.addEventListener('status', updateSync);

    /* ---------- Rendering ---------- */

    function objectFor(stroke) {
        if (!objects.has(stroke.id)) objects.set(stroke.id, toObject(stroke.data));
        return objects.get(stroke.id);
    }

    function render() {
        canvas.remove(...canvas.getObjects());
        if (key) {
            for (const layer of LAYERS) {
                if (!prefs.show[layer]) continue;
                for (const stroke of strokes[layer]) {
                    const object = objectFor(stroke);
                    if (object) canvas.add(object);
                }
            }
        }
        if (live?.object) canvas.add(live.object);
        canvas.requestRenderAll();
    }

    function reload() {
        strokes = key ? { mine: store.mine(key), band: store.band(key) } : { mine: [], band: [] };
        render();
        updateBar();
    }

    store.addEventListener('change', (e) => {
        if (key && chartId(e.detail.key) === chartId(key)) reload();
    });

    /* ---------- Saving ---------- */

    const undoStack = () => {
        const id = key ? chartId(key) : '';
        if (!undoStacks.has(id)) undoStacks.set(id, []);
        return undoStacks.get(id);
    };

    function apply(layer, { add = [], remove = [] }) {
        if (layer === 'mine') {
            const removed = new Set(remove);
            const next = [...strokes.mine.filter((s) => !removed.has(s.id)), ...add];
            try {
                store.saveMine(key, next);
            } catch {
                sync.textContent = 'האחסון במכשיר מלא · הסימון לא נשמר';
                sync.classList.add('warn');
                return false;
            }
        } else {
            store.saveBand(key, { add, remove });
        }
        reload();
        return true;
    }

    function addStroke(layer, data) {
        const stroke = { id: newId(), data };
        if (key) trackDraw(key.band, key.song);
        if (apply(layer, { add: [stroke] })) {
            undoStack().push({ op: 'add', layer, stroke });
            updateBar();
        }
    }

    function removeStrokes(layer, list) {
        if (!list.length) return;
        if (apply(layer, { remove: list.map((s) => s.id) })) {
            undoStack().push({ op: 'remove', layer, strokes: list });
            updateBar();
        }
    }

    function undo() {
        const action = undoStack().pop();
        if (!action) return;
        if (action.op === 'add') {
            apply(action.layer, { remove: [action.stroke.id] });
        } else {
            // Strokes are immutable and a deleted id stays deleted, so restore as copies.
            apply(action.layer, { add: action.strokes.map((s) => ({ id: newId(), data: s.data })) });
        }
        updateBar();
    }

    /* ---------- Input ---------- */

    function toScene(e) {
        const rect = stage.getBoundingClientRect();
        const f = SCENE_WIDTH / rect.width;
        return [(e.clientX - rect.left) * f, (e.clientY - rect.top) * f];
    }

    const round = (n) => Math.round(n * 10) / 10;
    const drawsWith = (e) => e.pointerType === 'pen' || e.pointerType === 'mouse';

    // iPadOS scrolls on a Pencil touch unless touchstart is cancelled. Fingers
    // are left alone, so they keep scrolling, zooming and swiping songs.
    const stopStylusScroll = (e) => {
        if (editing && prefs.tool !== 'text' && [...e.changedTouches].some((t) => t.touchType === 'stylus')) {
            e.preventDefault();
        }
    };
    stage.addEventListener('touchstart', stopStylusScroll, { passive: false });
    stage.addEventListener('touchmove', stopStylusScroll, { passive: false });

    // Before the chart has loaded the stage has no size, and positions on it
    // would be meaningless (a division by zero).
    const sized = () => stage.getBoundingClientRect().width > 50;

    stage.addEventListener('pointerdown', (e) => {
        if (!editing || !key || !sized() || e.target.closest('.marks-text')) return;
        if (prefs.tool === 'text') {
            tap = { id: e.pointerId, x: e.clientX, y: e.clientY };
            return;
        }
        if (!drawsWith(e) || e.button !== 0) return;
        e.preventDefault();
        try {
            stage.setPointerCapture(e.pointerId);
        } catch { /* already lifted */ }
        if (prefs.tool === 'eraser') {
            erasing = e.pointerId;
            eraseAt(toScene(e));
            return;
        }
        const highlighter = prefs.tool === 'highlighter';
        const data = {
            t: prefs.tool,
            c: highlighter ? HIGHLIGHT : prefs.color,
            s: SIZES[prefs.tool],
            p: [],
        };
        if (e.pointerType !== 'pen') data.sim = 1;
        live = { pointerId: e.pointerId, stroke: data, object: null };
        addPoint(e);
    });

    function addPoint(e) {
        const [x, y] = toScene(e);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const pressure = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5;
        live.stroke.p.push(round(x), round(y), Math.round(pressure * 100) / 100);
    }

    // The Pencil reports more points than there are frames; use them all. The
    // list can be empty (e.g. for synthetic events), so fall back to the event.
    const samples = (e) => {
        const list = e.getCoalescedEvents?.();
        return list?.length ? list : [e];
    };

    stage.addEventListener('pointermove', (e) => {
        if (erasing === e.pointerId) {
            for (const ev of samples(e)) eraseAt(toScene(ev));
            return;
        }
        if (!live || live.pointerId !== e.pointerId) return;
        for (const ev of samples(e)) addPoint(ev);
        live.object = toObject(live.stroke);
        render();
    });

    const endPointer = (e) => {
        if (tap && tap.id === e.pointerId) {
            const near = Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 12;
            tap = null;
            if (e.type === 'pointerup' && near) openText(e);
            return;
        }
        if (erasing === e.pointerId) {
            erasing = null;
            flushErase();
            return;
        }
        if (live && live.pointerId === e.pointerId) finishLive();
    };
    stage.addEventListener('pointerup', endPointer);
    stage.addEventListener('pointercancel', endPointer);

    function finishLive() {
        if (!live) return;
        const { stroke } = live;
        live = null;
        if (stroke.p.length) addStroke(prefs.layer, stroke);
        else render();
    }

    /* Eraser: collect what the drag touches, save once when it lifts. */
    let toErase = new Map();

    function eraseAt([x, y]) {
        const layer = prefs.layer;
        if (!prefs.show[layer] || !Number.isFinite(x) || !Number.isFinite(y)) return;
        for (const stroke of strokes[layer]) {
            if (toErase.has(stroke.id)) continue;
            if (touches(stroke.data, objects.get(stroke.id), x, y, ERASER_RADIUS)) {
                toErase.set(stroke.id, stroke);
                const object = objects.get(stroke.id);
                if (object) object.opacity = 0.15;
                canvas.requestRenderAll();
            }
        }
    }

    function flushErase() {
        const list = [...toErase.values()];
        toErase = new Map();
        for (const stroke of list) objects.delete(stroke.id);
        removeStrokes(prefs.layer, list);
    }

    /* ---------- Text ---------- */

    let textBox = null;

    function openText(e) {
        commitText();
        const [x, y] = toScene(e);
        const input = el('input', {
            class: 'marks-text',
            attrs: { type: 'text', dir: 'auto', enterkeyhint: 'done', 'aria-label': 'טקסט לסימון' },
        });
        input.style.left = `${x * scale}px`;
        input.style.top = `${y * scale}px`;
        input.style.color = prefs.color;
        input.style.fontSize = `${SIZES.text * scale}px`;
        textBox = { input, x, y, color: prefs.color, layer: prefs.layer };
        input.addEventListener('keydown', (ev) => {
            ev.stopPropagation();   // keep arrows and Escape away from the viewer
            if (ev.key === 'Enter') { ev.preventDefault(); commitText(); }
            if (ev.key === 'Escape') { ev.preventDefault(); input.value = ''; commitText(); }
        });
        input.addEventListener('blur', () => commitText());
        stage.append(input);
        input.focus();
    }

    function commitText() {
        if (!textBox) return;
        const { input, x, y, color, layer } = textBox;
        textBox = null;
        const text = input.value.trim();
        input.remove();
        if (!text || !key) return;
        const data = { t: 'text', c: color, s: SIZES.text, x: round(x), y: round(y), text };
        if (HEBREW.test(text[0])) data.rtl = 1;
        addStroke(layer, data);
    }

    /* ---------- Chart lifecycle ---------- */

    function refresh() {
        if (key && document.visibilityState === 'visible') store.refresh(key);
    }
    document.addEventListener('visibilitychange', refresh);

    return {
        /** A chart is about to be shown. */
        show(song) {
            finishLive();
            commitText();
            const chart = song.chartRev ? `${song.chart}#${song.chartRev}` : song.chart;
            key = { band, song: song.id, chart };
            objects.clear();
            reload();
            refresh();
            store.flush();
            clearInterval(refreshTimer);
            refreshTimer = setInterval(refresh, REFRESH_MS);
        },

        /** The chart's on-screen size changed. */
        resize(width, height) {
            if (!width || !height) return;
            scale = width / SCENE_WIDTH;
            // Sharp on a Retina screen, but a zoomed multi-page chart would make a
            // canvas bigger than iOS allows (it then shows nothing), so the pixel
            // count is capped and the marks get a little softer instead.
            const ratio = Math.min(Math.max(window.devicePixelRatio || 1, 1),
                Math.sqrt(MAX_CANVAS_PIXELS / (width * height)));
            canvas.setDimensions({ width: Math.round(width * ratio), height: Math.round(height * ratio) }, { backstoreOnly: true });
            canvas.setDimensions({ width: `${width}px`, height: `${height}px` }, { cssOnly: true });
            canvas.setViewportTransform([scale * ratio, 0, 0, scale * ratio, 0, 0]);
            canvas.requestRenderAll();
        },

        hide() {
            finishLive();
            commitText();
            clearInterval(refreshTimer);
            key = null;
            render();
        },
    };
}
