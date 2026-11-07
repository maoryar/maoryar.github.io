/* Full-screen viewer for a song's BPM, chart or lyrics.
 *
 * One <dialog> holds one panel per kind. A panel is
 *   { el, has(song) -> bool, show(song), hide() }
 * and the viewer only handles opening, closing and walking the setlist
 * (buttons, arrow keys, swipe), skipping songs that lack that asset.
 */
import { byId } from './util.js';

const SWIPE_MIN_PX = 50;     // horizontal travel needed for a swipe
const SWIPE_RATIO = 1.5;     // must be this much more horizontal than vertical

export class Viewer {
    constructor(dialog, songs, panels) {
        this.dialog = dialog;
        this.songs = songs;
        this.panels = panels;
        this.kind = null;
        this.index = -1;

        this.nav = byId('viewer-nav');
        this.counter = byId('viewer-counter');

        byId('viewer-close').addEventListener('click', () => this.close());
        byId('viewer-prev').addEventListener('click', () => this.navigate(-1));
        byId('viewer-next').addEventListener('click', () => this.navigate(1));

        // A click that lands on the dialog itself (not a panel) is the backdrop.
        dialog.addEventListener('click', (e) => { if (e.target === dialog) this.close(); });

        // Covers Escape too: the browser closes the dialog and fires 'close'.
        dialog.addEventListener('close', () => this.cleanup());

        // Arrow keys mirror the home page gallery: Right = next, Left = previous.
        dialog.addEventListener('keydown', (e) => {
            if (e.target.closest?.('input, textarea')) return;
            if (e.key === 'ArrowRight') { e.preventDefault(); this.navigate(1); }
            if (e.key === 'ArrowLeft') { e.preventDefault(); this.navigate(-1); }
        });

        this.setupSwipe();
    }

    get isOpen() { return this.dialog.open; }

    /** Indices of songs that have this kind of asset and aren't disabled. */
    eligible(kind) {
        const { has } = this.panels[kind];
        return this.songs.flatMap((song, i) => (has(song) && !song.disabled ? [i] : []));
    }

    open(kind, index) {
        const panel = this.panels[kind];
        const song = this.songs[index];
        if (!panel || !song) return;

        if (this.kind && this.kind !== kind) this.panels[this.kind].hide();
        for (const [k, p] of Object.entries(this.panels)) p.el.hidden = k !== kind;

        this.kind = kind;
        this.index = index;

        if (!this.dialog.open) {
            this.dialog.showModal();
            document.body.classList.add('no-scroll');
        }
        // Shown before rendering so panels can measure themselves.
        panel.show(song);
        this.updateNav();
    }

    close() {
        if (this.dialog.open) this.dialog.close();
    }

    cleanup() {
        if (this.kind) this.panels[this.kind].hide();
        this.kind = null;
        this.index = -1;
        document.body.classList.remove('no-scroll');
    }

    navigate(delta) {
        if (!this.kind) return;
        const list = this.eligible(this.kind);
        const pos = list.indexOf(this.index);
        if (pos >= 0) {
            if (list.length < 2) return;
            this.open(this.kind, list[(pos + delta + list.length) % list.length]);
            return;
        }
        // The open song is disabled (opened on purpose): go to the nearest
        // eligible song in that direction.
        if (!list.length) return;
        const after = list.find((i) => i > this.index);
        const before = [...list].reverse().find((i) => i < this.index);
        this.open(this.kind, delta > 0 ? (after ?? list[0]) : (before ?? list.at(-1)));
    }

    updateNav() {
        const list = this.eligible(this.kind);
        const pos = list.indexOf(this.index);
        this.nav.hidden = pos >= 0 ? list.length < 2 : !list.length;
        this.counter.textContent = pos >= 0 ? `${pos + 1} / ${list.length}` : `– / ${list.length}`;
    }

    setupSwipe() {
        let start = null;

        this.dialog.addEventListener('touchstart', (e) => {
            // Two fingers is a pinch, and an Apple Pencil draws: neither is a swipe.
            start = e.touches.length === 1 && e.touches[0].touchType !== 'stylus'
                ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
                : null;
        }, { passive: true });

        this.dialog.addEventListener('touchend', (e) => {
            if (!start) return;
            const t = e.changedTouches[0];
            const dx = t.clientX - start.x;
            const dy = t.clientY - start.y;
            start = null;

            // While pinch-zoomed in, one-finger drags pan the chart.
            if ((window.visualViewport?.scale ?? 1) > 1.01) return;
            if (Math.abs(dx) < SWIPE_MIN_PX) return;
            // Mostly-vertical drags scroll the lyrics instead.
            if (Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return;

            // Swipe left = next, like a photo gallery.
            this.navigate(dx < 0 ? 1 : -1);
        }, { passive: true });
    }
}
