/* The mini player's timeline and section loop.
 *
 * The timeline is always shown: elapsed and total time, and a track to tap or
 * drag to seek (disabled until a song is loaded). The loop button starts a
 * 30-second loop from the current position; the track then shows the loop's
 * range with two handles to drag (each shows its time while held) and a clear
 * button. The handles' touch areas reach outward (the start's to the left,
 * the end's to the right), so both can be grabbed even on a short loop. */
import { byId, formatTime } from './util.js';

const DEFAULT_LOOP_S = 30;
const MIN_GAP_S = 1;
const LOOP_KEY_STEP_S = 1;
const SEEK_KEY_STEP_S = 5;

export function bindTimeline(player) {
    const bar = byId('player');
    const timeline = byId('timeline');
    const track = byId('tl-track');
    const fill = byId('tl-fill');
    const thumb = byId('tl-thumb');
    const elapsed = byId('tl-elapsed');
    const total = byId('tl-total');
    const range = byId('loop-range');
    const button = byId('loop-btn');
    const loopText = byId('player-time');
    const handles = { a: byId('loop-a'), b: byId('loop-b') };

    let seekingTo = null;   // seconds under the finger while dragging the track

    const pct = (t, d) => `${(100 * Math.min(Math.max(t / d, 0), 1)).toFixed(3)}%`;
    const clampTime = (t) => Math.min(Math.max(t, 0), player.duration);

    function paint() {
        const d = player.duration;
        const ready = player.index >= 0 && d > 0;
        timeline.classList.toggle('disabled', !ready);
        track.setAttribute('aria-disabled', String(!ready));
        button.disabled = !ready;
        const loop = ready ? player.loop : null;
        button.setAttribute('aria-pressed', String(!!loop));
        bar.classList.toggle('looping', !!loop);

        const now = seekingTo ?? player.audio.currentTime;
        elapsed.textContent = formatTime(ready ? now : 0);
        total.textContent = formatTime(ready ? d : 0);
        const at = ready ? pct(now, d) : '0%';
        fill.style.width = at;
        thumb.style.left = at;
        track.setAttribute('aria-valuemax', String(Math.round(d)));
        track.setAttribute('aria-valuenow', String(Math.round(ready ? now : 0)));
        track.setAttribute('aria-valuetext', `${formatTime(now)} / ${formatTime(d)}`);

        // The line under the title: the idle hint (main.js), else the loop.
        if (!loop) {
            if (player.index >= 0) loopText.textContent = '';
            return;
        }
        range.style.left = pct(loop.a, d);
        range.style.width = pct(loop.b - loop.a, d);
        for (const k of ['a', 'b']) {
            handles[k].style.left = pct(loop[k], d);
            const text = formatTime(loop[k]);
            handles[k].firstElementChild.textContent = text;
            handles[k].setAttribute('aria-valuetext', text);
        }
        const span = document.createElement('span');
        span.dir = 'ltr';
        span.textContent = `${formatTime(loop.a)}–${formatTime(loop.b)}`;
        loopText.replaceChildren('לולאה ', span);
    }

    const timeAt = (clientX) => {
        const r = track.getBoundingClientRect();
        return ((clientX - r.left) / r.width) * player.duration;
    };

    /* ---------- seeking: tap or drag the track ---------- */

    let seekPointer = null;
    const seekTo = (clientX) => {
        seekingTo = clampTime(timeAt(clientX));
        player.audio.currentTime = seekingTo;
        paint();
    };
    track.addEventListener('pointerdown', (e) => {
        if (timeline.classList.contains('disabled') || e.target.closest('.loop-handle')) return;
        e.preventDefault();
        seekPointer = e.pointerId;
        track.setPointerCapture(e.pointerId);
        timeline.classList.add('seeking');
        player.dragging = true;   // the loop doesn't pull the position back mid-drag
        seekTo(e.clientX);
    });
    track.addEventListener('pointermove', (e) => {
        if (seekPointer === e.pointerId) seekTo(e.clientX);
    });
    const endSeek = (e) => {
        if (seekPointer !== e.pointerId) return;
        seekPointer = null;
        seekingTo = null;
        timeline.classList.remove('seeking');
        player.dragging = false;
        player.watchLoop();
        paint();
    };
    track.addEventListener('pointerup', endSeek);
    track.addEventListener('pointercancel', endSeek);
    track.addEventListener('keydown', (e) => {
        if (e.target !== track || timeline.classList.contains('disabled')) return;
        const delta = { ArrowLeft: -SEEK_KEY_STEP_S, ArrowRight: SEEK_KEY_STEP_S }[e.key];
        if (!delta) return;
        e.preventDefault();
        e.stopPropagation();
        player.audio.currentTime = clampTime(player.audio.currentTime + delta);
    });

    /* ---------- loop handles ---------- */

    /** Move one end of the loop to time t, keeping the ends apart. */
    function move(k, t, opts) {
        const d = player.duration;
        const { a, b } = player.loop;
        if (k === 'a') player.setLoop(Math.min(Math.max(t, 0), b - MIN_GAP_S), b, opts);
        else player.setLoop(a, Math.max(Math.min(t, d), a + MIN_GAP_S), opts);
    }

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
            const delta = { ArrowLeft: -LOOP_KEY_STEP_S, ArrowRight: LOOP_KEY_STEP_S }[e.key];
            if (!delta) return;
            e.preventDefault();
            e.stopPropagation();
            move(k, player.loop[k] + delta);
        });
    }

    button.addEventListener('click', () => {
        if (player.loop) player.clearLoop();
        else player.startLoop(DEFAULT_LOOP_S);
    });
    byId('loop-clear').addEventListener('click', () => player.clearLoop());

    player.addEventListener('change', paint);
    // Also when the duration arrives and as it plays.
    player.addEventListener('progress', paint);
    paint();
}
