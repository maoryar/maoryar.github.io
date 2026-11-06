/* Small shared helpers. */

export const byId = (id) => document.getElementById(id);

/**
 * Create an element.
 *   el('button', { class: 'chip', attrs: { title: 'x' }, on: { click } }, [child, 'text'])
 */
export function el(tag, { class: className, attrs = {}, on = {} } = {}, children = []) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    for (const [name, value] of Object.entries(attrs)) {
        if (value != null && value !== false) node.setAttribute(name, value === true ? '' : value);
    }
    for (const [type, handler] of Object.entries(on)) node.addEventListener(type, handler);
    for (const child of [].concat(children)) {
        if (child != null) node.append(child);
    }
    return node;
}

/** Parse an inline SVG string into an element. */
export function svg(markup) {
    const tpl = document.createElement('template');
    tpl.innerHTML = markup.trim();
    return tpl.content.firstElementChild;
}

export const ICONS = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>',
    download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    lyrics: '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="11" x2="20" y2="11"/><line x1="4" y1="16" x2="13" y2="16"/></svg>',
    chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
};

/** Join the bucket base URL with a relative asset path, encoding each segment
 *  separately so "charts/foo bar.png" keeps its slash. */
export function assetUrl(baseUrl, path) {
    return baseUrl + String(path).split('/').map(encodeURIComponent).join('/');
}

export function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

/** Fetch with a readable error for non-2xx responses. */
export async function fetchOk(url, options) {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
}

/** Returns a function that hands out tokens; isCurrent(token) is true only for
 *  the latest one. Guards async work against fast swipes between songs. */
export function latestOnly() {
    let counter = 0;
    const next = () => ++counter;
    next.isCurrent = (token) => token === counter;
    next.invalidate = () => { counter++; };
    return next;
}
