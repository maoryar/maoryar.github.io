/* Setlist page entry point: builds the page for the band declared on <body>,
 * loads its setlist JSON, and connects the song list to the player and viewer. */
import { ICONS, byId, el, fetchOk, formatTime, svg } from './util.js';
import { Player } from './player.js';
import { Viewer } from './viewer.js';
import { bpmPanel, chartPanel, lyricsPanel } from './panels.js';
import { readConfig, renderShell } from './shell.js';
import { keepScreenOn } from './wakelock.js';
import { EMPTY, applyEdits, cachedEdits, fetchEdits } from './order.js';
import { track } from './usage.js';

// Without a cached copy, wait this long for the manager's edits before
// showing the JSON order (the API can be slow to wake up).
const FIRST_EDITS_WAIT_MS = 1500;

const config = readConfig();
renderShell(config);
keepScreenOn();   // a chart on the music stand must not go dark

const status = byId('status');

byId('year').textContent = new Date().getFullYear();
start();

async function start() {
    // A file:// page can't fetch the JSON, and the browser's own error
    // ("Load failed") doesn't say why.
    if (location.protocol === 'file:') {
        showStatus(fileProtocolHelp(), true);
        return;
    }

    const band = config.bandId;
    track('page_view', { band });
    const fresh = fetchEdits(band);
    let data;
    try {
        // no-cache: revalidate every time so a setlist edit shows up at once.
        const res = await fetchOk(config.dataUrl, { cache: 'no-cache' });
        data = await res.json();
        jsonDate = new Date(res.headers.get('Last-Modified'));
    } catch (err) {
        showStatus(`לא ניתן לטעון את הסטליסט: ${err.message} — ודאו שהקובץ ${config.dataUrl} קיים ונגיש.`, true);
        return;
    }

    baseSongs = Array.isArray(data.songs) ? data.songs : [];
    if (!baseSongs.length) {
        showStatus('הסטליסט ריק.');
        return;
    }

    // The manager's order and BPMs: the device's copy if it has one, else a
    // short wait for the API. Either way the latest is applied when it arrives.
    edits = cachedEdits(band)
        ?? await Promise.race([fresh, new Promise((r) => setTimeout(r, FIRST_EDITS_WAIT_MS))])
        ?? EMPTY;
    status.hidden = true;
    initPage(applyEdits(baseSongs, edits), data.baseUrl || '', band);
    showLastUpdated();
    const latest = await fresh;
    if (latest) setEdits(latest);
}

/* ---------- manager edits (order, BPM) ---------- */

let baseSongs = [];       // the JSON's songs, in JSON order
let edits = EMPTY;        // the manager's edits on screen
let jsonDate = null;
let page = null;          // { songs, rows, player, viewer, editor }
let pendingEdits = null;  // newer edits waiting for the viewer or editor to close

function setEdits(next) {
    if (!page || next.version === edits.version) return;
    if (page.viewer.isOpen || page.editor?.isOpen) {
        pendingEdits = next;
        return;
    }
    edits = next;
    pendingEdits = null;
    relayout(applyEdits(baseSongs, edits));
    showLastUpdated();
}

/** Show songs in a new order without interrupting playback. The player and
 *  viewer share the `songs` array, so it is updated in place. */
function relayout(next) {
    const { songs, rows, player } = page;
    const playingId = player.song?.id;
    songs.splice(0, songs.length, ...next);
    player.index = playingId ? songs.findIndex((s) => s.id === playingId) : -1;
    rows.splice(0, rows.length, ...songs.map((song, i) => renderRow(song, i, page)));
    byId('song-list').replaceChildren(...rows.map((r) => r.li));
    player.dispatchEvent(new Event('change'));
}

function initPage(songs, baseUrl, bandId) {
    const player = new Player(byId('audio'), { songs, baseUrl });
    const viewer = new Viewer(byId('viewer'), songs, {
        bpm: bpmPanel(),
        chart: counted(chartPanel(baseUrl, bandId), 'chart_open', bandId),
        lyrics: counted(lyricsPanel(baseUrl), 'lyrics_open', bandId),
    });
    countPlays(player, bandId);

    const rows = songs.map((song, i) => renderRow(song, i, { player, viewer }));
    byId('song-list').replaceChildren(...rows.map((r) => r.li));
    page = { songs, rows, player, viewer, editor: null };

    bindPlayerUi(player, rows);
    bindToolbar(player);

    // Edits that arrived while the viewer or editor was open.
    byId('viewer').addEventListener('close', () => { if (pendingEdits) setEdits(pendingEdits); });

    // Edit mode loads on first use (it brings the drag-and-drop library). The
    // button stays disabled until the page is ready, so an early tap isn't lost.
    byId('edit-btn').disabled = false;
    byId('edit-btn').addEventListener('click', async () => {
        if (!page.editor) {
            const { createEditor } = await import('./editor.js');
            page.editor = createEditor({
                band: bandId,
                base: () => baseSongs,
                edits: () => edits,
                onSaved: (saved) => {
                    pendingEdits = null;
                    edits = saved;
                    relayout(applyEdits(baseSongs, edits));
                    showLastUpdated();
                },
            });
        }
        await page.editor.toggle();
        if (!page.editor.isOpen && pendingEdits) setEdits(pendingEdits);
    });

    // Keep up with edits made elsewhere while the page stays open.
    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState !== 'visible') return;
        const latest = await fetchEdits(bandId);
        if (latest) setEdits(latest);
    });

    document.addEventListener('keydown', (e) => {
        if (viewer.isOpen) return;   // Space must not reach the player behind the viewer
        // Space is play/pause everywhere except form fields (it also stops a
        // focused button from re-triggering itself).
        const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
        if (e.code === 'Space' && !typing) {
            e.preventDefault();
            player.togglePlayback();
        }
    });

    // Rows are rendered after load, so the browser can't jump to #song-<id> itself.
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'center' });
}

/* ---------- usage counts (anonymous, see usage.js) ---------- */

/** A panel whose every shown song counts as opened. */
function counted(panel, event, band) {
    const show = panel.show;
    return { ...panel, show: (song) => { track(event, { band, song: song.id }); return show(song); } };
}

/** One play per song and version: resuming after a pause doesn't count again. */
function countPlays(player, band) {
    let last = null;
    player.audio.addEventListener('play', () => {
        const song = player.song;
        if (!song) return;
        const now = `${song.id}|${player.version}|${player.audio.src}`;
        if (now === last) return;
        last = now;
        if (player.version === 'original') track('audio_play', { band, song: song.id });
        else track('remix_play', { band, song: song.id, version: player.version });
    });
}

/* ---------- song rows ---------- */

function renderRow(song, i, { player, viewer }) {
    const playBtn = el('button', {
        class: 'play-btn',
        attrs: { type: 'button', 'aria-label': `נגן את ${song.title}` },
        on: { click: () => player.toggleSong(i) },
    });
    playBtn.innerHTML = ICONS.play;

    const seek = el('input', {
        class: 'seek',
        attrs: {
            type: 'range', min: 0, max: 100, step: 0.1, value: 0,
            'aria-label': `התקדמות בשיר ${song.title}`,
        },
        on: {
            input: () => {
                setSeek(seek, Number(seek.value));
                player.seek(i, Number(seek.value) / 100);
            },
        },
    });

    // Every chip is on every row so the rows line up; a missing asset
    // disables its chip instead of removing it.
    const dlChip = chip({
        icon: ICONS.download,
        available: !!song.audio,
        title: 'הורד את ההקלטה',
        unavailableTitle: 'אין הקלטה לשיר זה',
        onClick: () => download(player, song, dlChip),
    });

    const actions = el('div', { class: 'song-actions' }, [
        chip({
            className: 'bpm',
            content: [
                el('span', { class: 'bpm-num' }, song.bpm ? String(song.bpm) : '--'),
                el('span', { class: 'bpm-sub' }, 'bpm'),
            ],
            available: !!song.bpm,
            title: 'הצג ויזואליזציה של הקצב',
            unavailableTitle: 'אין נתון קצב לשיר זה',
            onClick: () => viewer.open('bpm', i),
        }),
        dlChip,
        chip({
            icon: ICONS.lyrics,
            available: !!song.lyrics,
            title: 'הצג מילים',
            unavailableTitle: 'אין מילים לשיר זה',
            onClick: () => viewer.open('lyrics', i),
        }),
        chip({
            icon: ICONS.chart,
            available: !!song.chart,
            title: 'הצג אקורדים',
            unavailableTitle: 'אין אקורדים לשיר זה',
            onClick: () => viewer.open('chart', i),
        }),
    ]);

    const li = el('li', {
        class: song.disabled ? 'song disabled' : 'song',
        attrs: { id: `song-${song.id}`, title: song.disabled ? 'השיר מושבת: מדלגים עליו בניגון ובמעבר בין שירים' : null },
    }, [
        el('div', { class: 'song-row' }, [
            playBtn,
            el('span', { class: 'song-title' }, song.title),
            actions,
        ]),
        seek,
    ]);

    return { li, playBtn, seek };
}

function chip({ className = '', icon, content, available, title, unavailableTitle, onClick }) {
    const label = available ? title : unavailableTitle;
    const btn = el('button', {
        class: `chip ${className}`.trim(),
        attrs: { type: 'button', title: label, 'aria-label': label, disabled: !available },
        on: available ? { click: onClick } : {},
    }, content ?? svg(icon));
    return btn;
}

function setSeek(input, pct) {
    input.value = String(pct);
    input.style.setProperty('--pct', `${pct}%`);
}

/* ---------- player UI ---------- */

function bindPlayerUi(player, rows) {
    const bar = byId('player');
    const title = byId('player-title');
    const time = byId('player-time');
    const toggle = byId('player-toggle');
    const repeatBtn = byId('repeat-btn');
    let shownIndex = -1;

    toggle.innerHTML = ICONS.play;

    const paint = () => {
        const { index, playing, repeat } = player;

        rows.forEach((row, i) => {
            const isCurrent = i === index;
            row.li.classList.toggle('active', isCurrent);
            row.playBtn.innerHTML = isCurrent && playing ? ICONS.pause : ICONS.play;
            if (!isCurrent) setSeek(row.seek, 0);
        });

        if (index >= 0 && index !== shownIndex) {
            shownIndex = index;
            title.textContent = player.song.title;
            bar.classList.add('visible');
        }
        toggle.innerHTML = playing ? ICONS.pause : ICONS.play;

        byId('repeat-badge').textContent = repeat.badge;
        repeatBtn.setAttribute('aria-pressed', String(repeat.id !== 'off'));
        repeatBtn.title = repeat.label;
        repeatBtn.setAttribute('aria-label', repeat.label);
    };

    player.addEventListener('change', paint);
    player.addEventListener('progress', () => {
        const row = rows[player.index];
        if (!row) return;
        const { currentTime, duration, fraction } = player.progress;
        // Don't fight the user's finger while they drag the bar.
        if (!row.seek.matches(':active')) setSeek(row.seek, fraction * 100);
        time.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
    });
    player.addEventListener('error', () => {
        title.textContent = `שגיאה בטעינת ${player.song.title}`;
        shownIndex = -1;   // next change repaints the real title
    });

    toggle.addEventListener('click', () => player.togglePlayback());
    byId('player-prev').addEventListener('click', () => player.step(-1));
    byId('player-next').addEventListener('click', () => player.step(1));

    paint();
}

function bindToolbar(player) {
    byId('play-all').addEventListener('click', () => player.playAll());
    byId('repeat-btn').addEventListener('click', () => player.cycleRepeat());
    byId('version-select').addEventListener('change', (e) => player.setVersion(e.target.value));
}

/* ---------- download ----------
   The download attribute is ignored for cross-origin links, so a plain
   <a download> would just open the MP3. Fetch it as a blob instead (needs
   CORS on the bucket) and fall back to opening the URL. */

async function download(player, song, btn) {
    const url = player.audioUrl(song);
    const filename = player.version === 'original' ? song.audio : `${song.id}_${player.version}.mp3`;
    btn.setAttribute('aria-busy', 'true');
    try {
        const blob = await (await fetchOk(url)).blob();
        const href = URL.createObjectURL(blob);
        const a = el('a', { attrs: { href, download: filename } });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 30000);
    } catch {
        window.open(url, '_blank', 'noopener');
    } finally {
        btn.removeAttribute('aria-busy');
    }
}

/* ---------- status / footer ---------- */

function showStatus(content, isError = false) {
    status.hidden = false;
    status.className = isError ? 'status error' : 'status';
    status.replaceChildren(content);
}

/** "Last updated" is the later of the JSON's Last-Modified header (GitHub
 *  Pages sets it on every deploy) and the manager's last edit. */
function showLastUpdated() {
    const times = [jsonDate?.getTime(), edits.updated].filter((t) => Number.isFinite(t) && t > 0);
    if (!times.length) return;
    const date = new Date(Math.max(...times));
    const text = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Jerusalem',
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(date).replace(',', '');
    const node = byId('last-updated');
    node.textContent = `עודכן לאחרונה: ${text}`;
    node.hidden = false;
}

function fileProtocolHelp() {
    // e.g. http://localhost:8000/mishmeret/setlist.html for this page
    const url = `http://localhost:8000/${location.pathname.split('/').slice(-2).join('/')}`;
    return el('div', {}, [
        'הדף נפתח ישירות מהקובץ (file://) ולכן הדפדפן חוסם את טעינת הנתונים.',
        el('br'),
        'להרצה מקומית יש להריץ שרת מקומי בתיקיית הפרויקט:',
        el('br'),
        el('code', {}, 'python3 -m http.server 8000'),
        el('br'),
        'ואז לפתוח ',
        el('span', { attrs: { dir: 'ltr' } }, url),
    ]);
}
