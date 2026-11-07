/* Playback: one <audio> element walking the setlist.
 *
 * Emits on itself (EventTarget):
 *   'change'   song, play/pause state or repeat mode changed
 *   'progress' playback position moved
 *   'error'    the current file failed to load
 */
import { assetUrl } from './util.js';

export const REPEAT_MODES = [
    { id: 'off', label: 'ללא חזרה', badge: '' },
    { id: 'one', label: 'חזרה על שיר', badge: '1' },
    { id: 'all', label: 'חזרה על הסט', badge: '∞' },
];

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

        const emit = (type) => () => this.dispatchEvent(new Event(type));
        audio.addEventListener('play', emit('change'));
        audio.addEventListener('pause', emit('change'));
        audio.addEventListener('timeupdate', emit('progress'));
        audio.addEventListener('loadedmetadata', () => {
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

    onEnded() {
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
