/* Playback: one <audio> element walking the setlist.
 *
 * Emits on itself (EventTarget):
 *   'change'   song, play/pause state, repeat mode or loop changed
 *   'progress' playback position moved
 *   'error'    the current file failed to load
 */
import { assetUrl } from './util.js';

export const REPEAT_MODES = [
    { id: 'off', label: 'ללא חזרה', badge: '' },
    { id: 'one', label: 'חזרה על שיר', badge: '1' },
    { id: 'all', label: 'חזרה על הסט', badge: '∞' },
];

const LOOP_MIN_S = 1;           // the shortest loop

export class Player extends EventTarget {
    constructor(audio, { songs, baseUrl }) {
        super();
        this.audio = audio;
        this.songs = songs;
        this.baseUrl = baseUrl;
        this.index = -1;              // loaded song, -1 = none
        this.version = 'original';
        this.repeatIdx = 0;
        this.pendingSeek = null;      // fraction to apply once metadata arrives
        this.loop = null;             // { a, b } seconds: the section played over and over
        this.loopTimer = 0;
        this.dragging = false;        // a loop handle is held: don't jump yet
        this.knownDuration = 0;       // the song's length, kept while another version loads

        const emit = (type) => () => this.dispatchEvent(new Event(type));
        audio.addEventListener('play', () => { this.watchLoop(); this.dispatchEvent(new Event('change')); });
        audio.addEventListener('pause', emit('change'));
        audio.addEventListener('timeupdate', emit('progress'));
        audio.addEventListener('loadedmetadata', () => {
            if (Number.isFinite(audio.duration) && audio.duration > 0) this.knownDuration = audio.duration;
            if (this.pendingSeek != null) {
                audio.currentTime = audio.duration * this.pendingSeek;
                this.pendingSeek = null;
            }
            this.dispatchEvent(new Event('progress'));
        });
        audio.addEventListener('ended', () => this.onEnded());
        audio.addEventListener('error', () => {
            if (this.index >= 0) this.dispatchEvent(new Event('error'));
        });

        this.setupMediaSession();
    }

    /* ---------- state ---------- */

    get song() { return this.songs[this.index] ?? null; }

    /** The next song from `from` in direction `delta` (wrapping around) that
     *  isn't disabled, or -1 if there is none. from = -1 means "before the first". */
    nextIndex(from, delta) {
        const n = this.songs.length;
        for (let k = 1; k <= n; k++) {
            const i = (((from + delta * k) % n) + n) % n;
            if (!this.songs[i].disabled) return i;
        }
        return -1;
    }

    /** True if no enabled song comes after song i (the end of the set). */
    isLastEnabled(i) {
        return !this.songs.slice(i + 1).some((s) => !s.disabled);
    }
    get playing() { return this.index >= 0 && !this.audio.paused && !this.audio.ended; }
    get repeat() { return REPEAT_MODES[this.repeatIdx]; }

    get progress() {
        const { currentTime, duration } = this.audio;
        const fraction = Number.isFinite(duration) && duration > 0 ? currentTime / duration : 0;
        return { currentTime, duration, fraction };
    }

    /** URL of a song's recording in the given version. Remixes live under
     *  remixes/<id>_<version>.mp3 in the bucket. */
    audioUrl(song, version = this.version) {
        if (version === 'original') return assetUrl(this.baseUrl, song.audio);
        return assetUrl(this.baseUrl, `remixes/${song.id}_${version}.mp3`);
    }

    /* ---------- commands ---------- */

    load(i, { autoplay = false } = {}) {
        const song = this.songs[i];
        if (!song) return;
        if (i !== this.index) {
            this.loop = null;          // a loop belongs to its song
            this.knownDuration = 0;
            this.index = i;
            this.pendingSeek = null;
            this.audio.src = this.audioUrl(song);
            this.updateMediaMetadata();
            this.dispatchEvent(new Event('change'));
        }
        if (autoplay) this.play();
    }

    play() {
        // play() rejects when autoplay is blocked or a newer load interrupts it;
        // neither needs handling, the UI follows the real play/pause events.
        this.audio.play()?.catch(() => {});
    }

    /** Play the set from its first enabled song. */
    playAll() {
        const first = this.nextIndex(-1, 1);
        if (first >= 0) this.load(first, { autoplay: true });
    }

    togglePlayback() {
        if (this.index < 0) return this.playAll();
        if (this.audio.paused) this.play(); else this.audio.pause();
    }

    /** Row play button: same song toggles, another song starts. */
    toggleSong(i) {
        if (i === this.index) this.togglePlayback();
        else this.load(i, { autoplay: true });
    }

    /** Next / previous, skipping disabled songs. A disabled song can still be
     *  played on purpose (its own play button); stepping leaves it. */
    step(delta) {
        if (!this.songs.length) return;
        const next = this.index < 0 ? this.nextIndex(-1, 1) : this.nextIndex(this.index, delta);
        if (next >= 0) this.load(next, { autoplay: true });
    }

    /** Seek song i to a 0..1 fraction. Seeking a song that isn't loaded loads
     *  it (without playing) and seeks once its duration is known. */
    seek(i, fraction) {
        if (i !== this.index) {
            this.load(i);
            this.pendingSeek = fraction;
            return;
        }
        const { duration } = this.audio;
        if (Number.isFinite(duration)) this.audio.currentTime = duration * fraction;
        else this.pendingSeek = fraction;
    }

    /** Switch recording version, keeping position and play state. */
    setVersion(version) {
        this.version = version;
        if (this.index < 0) return;
        const wasPlaying = this.playing;
        const { fraction } = this.progress;
        this.audio.src = this.audioUrl(this.song);
        this.pendingSeek = fraction || null;
        if (wasPlaying) this.play();
    }

    cycleRepeat() {
        this.repeatIdx = (this.repeatIdx + 1) % REPEAT_MODES.length;
        this.dispatchEvent(new Event('change'));
    }

    /* ---------- section loop ----------
       Kept when the version changes (remixes have the original's length),
       cleared when the song changes. */

    /** The song's length; while a version switch loads the new file, the
     *  length already known (remixes have the original's length), so the
     *  timeline and the loop don't blink. */
    get duration() {
        const d = this.audio.duration;
        return Number.isFinite(d) && d > 0 ? d : this.knownDuration;
    }

    /** The position to show: a pending seek (version switch) counts already. */
    get position() {
        return this.pendingSeek != null ? this.pendingSeek * this.duration : this.audio.currentTime;
    }

    /** Start a loop: `length` seconds from the current position, clamped to
     *  the song (near the end it starts earlier so it keeps its length). */
    startLoop(length = 30) {
        const d = this.duration;
        if (this.index < 0 || !d) return;
        const b = Math.min(this.audio.currentTime + length, d);
        this.setLoop(Math.max(0, b - length), b);
    }

    /** Set the loop to a..b seconds. Unless `seek` is false (while a handle
     *  is being dragged), a position outside it moves to its start. */
    setLoop(a, b, { seek = true } = {}) {
        const d = this.duration;
        if (!d) return;
        a = Math.max(0, Math.min(a, d));
        b = Math.max(0, Math.min(b, d));
        if (b - a < LOOP_MIN_S) return;
        this.loop = { a, b };
        const t = this.audio.currentTime;
        if (seek && (t < a || t >= b)) this.audio.currentTime = a;
        this.watchLoop();
        this.dispatchEvent(new Event('change'));
    }

    clearLoop() {
        if (!this.loop) return;
        this.loop = null;
        this.dispatchEvent(new Event('change'));
    }

    /** timeupdate comes only ~4 times a second, so a short timer watches the
     *  loop's end while playing (a late jump would be heard). */
    watchLoop() {
        clearTimeout(this.loopTimer);
        if (!this.loop || this.audio.paused) return;
        const { a, b } = this.loop;
        if (!this.dragging && this.audio.currentTime >= b - 0.02) this.audio.currentTime = a;
        this.loopTimer = setTimeout(() => this.watchLoop(), 40);
    }

    onEnded() {
        if (this.loop) {               // the loop ran to the song's end
            this.audio.currentTime = this.loop.a;
            this.play();
            return;
        }
        const mode = this.repeat.id;
        if (mode === 'one') {
            this.audio.currentTime = 0;
            this.play();
            return;
        }
        if (mode === 'off' && this.isLastEnabled(this.index)) {
            // End of the set: stop and rewind, keep the last song selected.
            this.audio.currentTime = 0;
            this.dispatchEvent(new Event('change'));
            return;
        }
        this.step(1);
    }

    /* ---------- lock screen / headphone controls ---------- */

    setupMediaSession() {
        const ms = navigator.mediaSession;
        if (!ms) return;
        const handlers = {
            play: () => this.play(),
            pause: () => this.audio.pause(),
            previoustrack: () => this.step(-1),
            nexttrack: () => this.step(1),
        };
        for (const [action, handler] of Object.entries(handlers)) {
            try { ms.setActionHandler(action, handler); } catch { /* unsupported action */ }
        }
    }

    updateMediaMetadata() {
        if (!navigator.mediaSession || !window.MediaMetadata || !this.song) return;
        navigator.mediaSession.metadata = new MediaMetadata({
            title: this.song.title,
            artist: 'חוגזי',
            album: 'סטליסט',
        });
    }
}
