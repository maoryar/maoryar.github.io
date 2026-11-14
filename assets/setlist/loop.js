/* Section loop UI in the mini player: the loop button starts a 30-second loop
 * from the current position; a row then shows the loop on the song's timeline
 * with two handles to drag (times shown while dragging) and a clear button.
 *
 * The handles' touch areas reach outward (the start's to the left, the end's
 * to the right), so both can be grabbed with a finger even on a short loop. */
import { byId, formatTime } from './util.js';

const DEFAULT_LOOP_S = 30;
const MIN_GAP_S = 1;
const KEY_STEP_S = 1;

export function bindLoopUi(player) {
    const bar = byId('player');
    const button = byId('loop-btn');
    const row = byId('loop-row');
    const track = byId('loop-track');
    const range = byId('loop-range');
    const head = byId('loop-head');
    const handles = { a: byId('loop-a'), b: byId('loop-b') };
    const times = { a: byId('loop-a-time'), b: byId('loop-b-time') };

    const pct = (t, d) => `${(100 * Math.min(Math.max(t / d, 0), 1)).toFixed(3)}%`;

    function paint() {
        const d = player.duration;
        button.disabled = player.index < 0 || !d;
        const loop = player.loop;
        button.setAttribute('aria-pressed', String(!!loop));
        bar.classList.toggle('looping', !!loop);
        row.hidden = !loop;
        if (!loop || !d) return;
        range.style.left = pct(loop.a, d);
        range.style.width = pct(loop.b - loop.a, d);
        for (const k of ['a', 'b']) {
            handles[k].style.left = pct(loop[k], d);
            const text = formatTime(loop[k]);
            times[k].textContent = text;
            handles[k].firstElementChild.textContent = text;
            handles[k].setAttribute('aria-valuetext', text);
        }
        head.style.left = pct(player.audio.currentTime, d);
    }

    /** Move one end of the loop to time t, keeping the ends apart. */
    function move(k, t, opts) {
        const d = player.duration;
        const { a, b } = player.loop;
        if (k === 'a') player.setLoop(Math.min(Math.max(t, 0), b - MIN_GAP_S), b, opts);
        else player.setLoop(a, Math.max(Math.min(t, d), a + MIN_GAP_S), opts);
    }

    const timeAt = (clientX) => {
        const r = track.getBoundingClientRect();
        return ((clientX - r.left) / r.width) * player.duration;
    };

    for (const k of ['a', 'b']) {
        const h = handles[k];
        let held = null;
        let grab = 0;   // seconds between the finger and the loop end it holds
        h.addEventListener('pointerdown', (e) => {
            if (!player.loop) return;
            e.preventDefault();
            e.stopPropagation();
            held = e.pointerId;
            grab = timeAt(e.clientX) - player.loop[k];
            h.setPointerCapture(e.pointerId);
            h.classList.add('dragging');
            player.dragging = true;
        });
        h.addEventListener('pointermove', (e) => {
            if (held !== e.pointerId || !player.loop) return;
            move(k, timeAt(e.clientX) - grab, { seek: false });
        });
        const end = (e) => {
            if (held !== e.pointerId) return;
            held = null;
            h.classList.remove('dragging');
            player.dragging = false;
            // Now that it's let go: a position outside the loop moves to its start.
            if (player.loop) player.setLoop(player.loop.a, player.loop.b);
        };
        h.addEventListener('pointerup', end);
        h.addEventListener('pointercancel', end);
        h.addEventListener('keydown', (e) => {
            if (!player.loop) return;
            const delta = { ArrowLeft: -KEY_STEP_S, ArrowRight: KEY_STEP_S }[e.key];
            if (!delta) return;
            e.preventDefault();
            e.stopPropagation();
            move(k, player.loop[k] + delta);
        });
    }

    // A tap on the timeline (not a handle) seeks there.
    track.addEventListener('click', (e) => {
        if (e.target.closest('.loop-handle') || !player.duration) return;
        player.audio.currentTime = Math.min(Math.max(timeAt(e.clientX), 0), player.duration);
    });

    button.addEventListener('click', () => {
        if (player.loop) player.clearLoop();
        else player.startLoop(DEFAULT_LOOP_S);
    });
    byId('loop-clear').addEventListener('click', () => player.clearLoop());

    player.addEventListener('change', paint);
    // Also when the duration arrives (the button enables then) and as it plays.
    player.addEventListener('progress', paint);
    paint();
}
