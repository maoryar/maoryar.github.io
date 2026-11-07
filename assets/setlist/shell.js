/* The setlist page's markup, shared by every band's setlist page.
 *
 * A page only declares its band on <body>:
 *   data-band     band name for the header, footer and title
 *   data-setlist  URL of its setlist JSON, relative to the page
 *   data-home     optional: where the header's back arrow links
 */

const TEMPLATE = `
<header class="page-header">
    <h1 class="band-logo" data-band-name></h1>
    <p class="band-subtitle">סטליסט • הקלטות, אקורדים וקצב</p>
</header>

<main>
    <div class="toolbar">
        <button type="button" class="play-all-btn" id="play-all">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
            נגן הכל
        </button>

        <label class="version-picker">
            <span class="version-label">גרסה:</span>
            <select id="version-select" aria-label="בחר גרסת השמעה">
                <option value="original" selected>🎵 מקור</option>
                <option value="novocals">🎤 קריוקי / פלייבק</option>
                <option value="bassboost">🎸 בס מוגבר</option>
                <option value="keysboost">🎹 קלידים מוגברים</option>
                <option value="guitarboost">🎸 גיטרה מוגברת</option>
                <option value="drumsboost">🥁 תופים מוגברים</option>
            </select>
        </label>

        <button type="button" class="tool-btn" id="repeat-btn" aria-pressed="false" title="ללא חזרה" aria-label="ללא חזרה">
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <polyline points="17 1 21 5 17 9"/>
                <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                <polyline points="7 23 3 19 7 15"/>
                <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
            </svg>
            <span class="repeat-badge" id="repeat-badge"></span>
        </button>

        <button type="button" class="tool-btn" id="edit-btn" aria-pressed="false" title="עריכת הסטליסט (מנהל)" aria-label="עריכת הסטליסט (מנהל)">
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <line x1="10" y1="6" x2="21" y2="6"/>
                <line x1="10" y1="12" x2="21" y2="12"/>
                <line x1="10" y1="18" x2="21" y2="18"/>
                <polyline points="3 8 5 6 7 8"/>
                <polyline points="3 16 5 18 7 16"/>
                <line x1="5" y1="6" x2="5" y2="18"/>
            </svg>
        </button>
    </div>

    <ul class="song-list" id="song-list"></ul>
    <div class="status" id="status">טוען את הסטליסט…</div>
</main>

<footer class="site-footer">
    <div>&copy; <span id="year"></span> <span data-band-name></span> • Choogzi - כל הזכויות שמורות</div>
    <div class="last-updated" id="last-updated" hidden></div>
</footer>

<!-- Sticky mini player -->
<div class="player" id="player">
    <button type="button" class="player-btn" id="player-prev" title="השיר הקודם" aria-label="השיר הקודם">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
    </button>
    <button type="button" class="player-btn main" id="player-toggle" title="נגן / השהה" aria-label="נגן או השהה"></button>
    <button type="button" class="player-btn" id="player-next" title="השיר הבא" aria-label="השיר הבא">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg>
    </button>
    <div class="player-info">
        <div class="player-title" id="player-title">—</div>
        <div class="player-time" id="player-time">0:00 / 0:00</div>
    </div>
</div>

<!-- One viewer dialog; the active panel (bpm / chart / lyrics) is swapped in. -->
<dialog class="viewer" id="viewer" aria-label="צפייה">
    <button type="button" class="round-btn viewer-close" id="viewer-close" aria-label="סגור">&times;</button>

    <section class="panel bpm-panel" data-kind="bpm" hidden>
        <h2 class="bpm-song" id="bpm-song"></h2>
        <div class="bpm-value" id="bpm-value"></div>
        <div class="bpm-unit">BPM</div>
        <div class="pulse-stage" aria-hidden="true">
            <div class="pulse-ring" id="pulse-ring"></div>
            <div class="pulse-core" id="pulse-core"></div>
        </div>
        <div class="beat-dots" id="beat-dots" aria-hidden="true"></div>
        <p class="bpm-hint">ויזואליזציה של הקצב • 4/4</p>
    </section>

    <section class="panel chart-panel" data-kind="chart" hidden>
        <div class="marks-bar" id="marks-bar" hidden></div>
        <div class="chart-viewport" id="chart-viewport">
            <div class="chart-stage" id="chart-stage"><img id="chart-img" alt=""></div>
            <div class="chart-status" id="chart-status"></div>
        </div>
        <div class="chart-footer">
            <a id="chart-open" href="#" target="_blank" rel="noopener noreferrer">פתח את הקובץ בלשונית חדשה ↗</a>
        </div>
    </section>

    <section class="panel lyrics-panel" data-kind="lyrics" hidden>
        <h2 class="lyrics-title" id="lyrics-title"></h2>
        <div class="lyrics-body" id="lyrics-body"></div>
    </section>

    <!-- Prev / position / next. direction:ltr in CSS keeps the chevrons physical. -->
    <nav class="viewer-nav" id="viewer-nav" aria-label="ניווט בין שירים">
        <button type="button" class="viewer-nav-btn" id="viewer-prev" aria-label="הקודם">&#10094;</button>
        <span class="viewer-nav-counter" id="viewer-counter"></span>
        <button type="button" class="viewer-nav-btn" id="viewer-next" aria-label="הבא">&#10095;</button>
    </nav>
</dialog>

<audio id="audio" preload="auto"></audio>
`;

export function readConfig(body = document.body) {
    const { band = '', setlist = '../data/setlist.json', home = '' } = body.dataset;
    // The page's folder (hugzi, mishmeret, hugzi-old) identifies the band for chart marks.
    const bandId = location.pathname.split('/').filter(Boolean).at(-2) || 'site';
    return { band, bandId, dataUrl: setlist, homeUrl: home };
}

export function renderShell({ band, homeUrl }) {
    document.body.innerHTML = TEMPLATE;
    for (const node of document.querySelectorAll('[data-band-name]')) node.textContent = band;

    if (homeUrl) {
        const back = document.createElement('a');
        back.className = 'round-btn back-link';
        back.href = homeUrl;
        back.title = 'חזרה לעמוד הראשי';
        back.setAttribute('aria-label', back.title);
        back.textContent = '→';
        document.querySelector('.page-header').prepend(back);
    }
}
