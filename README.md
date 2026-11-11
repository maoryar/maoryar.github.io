# maoryar.github.io
just my website. because I can...

**www.maoryaron.com**, served by GitHub Pages straight from the `main` branch: plain
HTML, CSS and ES modules, no build step. Mostly rehearsal setlists for the bands:
recordings, chord charts, lyrics, BPM, chart marks, and a manager mode for the song
order.

Everything in this repo is public and published, so it never holds passwords,
keys or account details. The backend (chart marks and setlist edits) lives in the
private `setlist-marks-backend` repo.

## Layout

```
index.html                    landing page
hugzi/index.html              Choogzi band page: photo gallery, videos, contact
hugzi/setlist.html            Choogzi setlist          -> data/setlist.json
mishmeret/setlist.html        Mishmeret Layla setlist  -> data/mishmeret_setlist.json
hugzi-old/setlist.html        archived Choogzi setlist -> data/hugzi_old_setlist.json
data/                         setlist JSON files
archive/                      backups, not served by any page
assets/
  base.css                    shared tokens, reset, header, footer, round buttons
  home.css, home.js           band page styles + gallery/lightbox
  setlist.css                 setlist styles
  setlist/
    shell.js                  the setlist page markup, shared by every setlist page
    main.js                   entry: builds the page, loads the JSON, applies manager edits
    player.js                 playback (versions, repeat, seek, lock screen), skips disabled songs
    viewer.js                 the full-screen viewer dialog: open/close, prev/next, swipe
    panels.js                 the three viewer panels: BPM, chart, lyrics
    util.js                   small helpers
    api.js                    backend address: test stage on http (local), production on https
    manager.js                the manager password prompt (band marks and setlist editing)
    order.js                  manager edits (order, BPM, disabled songs) applied over the JSON
    editor.js                 setlist edit mode: drag to reorder, change BPM, swipe to disable
    marks/                    drawing on charts: Mine (this device) and Band (shared) layers
      marks.js                toolbar and input; only a Pencil or mouse draws, fingers scroll
      ink.js                  stored mark data -> Fabric objects; eraser hit test
      store.js                localStorage, band API, offline outbox
  vendor/                     Fabric.js, perfect-freehand, SortableJS, copied from npm (MIT)
```

Each `*/setlist.html` is ~15 lines that only declare its band on `<body>`; all
behavior is shared in `assets/setlist/`. The page is Hebrew (RTL), but controls are
laid out left to right: play on the left, song tools on the right.

## Where things come from

| What | Where | Who changes it |
|---|---|---|
| The songs of a setlist: ids, titles, file paths, default BPM | `data/*.json` in this repo | a commit |
| Recordings, remixes, charts, lyrics | S3 bucket `maoryaron-webpage-storage`, under the JSON's `baseUrl` | an upload |
| Song order, BPM changes, disabled songs | the backend, per band | the manager, on the page |
| Band chart marks | the backend, per band + song + chart | anyone with the manager password, on the page |
| "Mine" chart marks | the device's browser storage | the device |

Manager edits sit **on top of** the JSON. Two consequences:
- A BPM the manager changed on the page wins over the JSON. Changing that song's
  `bpm` in the JSON has no visible effect until the manager resets it.
- A new song in the JSON appears at the end of the manager's order. Removing a
  song from the JSON removes it from the page, whatever the manager saved.

## Updating songs

### A song's fields

```json
{
  "id": "chatul-mifletzet",
  "title": "חתול מפלצת",
  "audio": "chatul_mifletzet.mp3",
  "chart": "charts/chatul-mifletzet.png",
  "lyrics": "lyrics/chatul-mifletzet.txt",
  "bpm": 120,
  "chartRev": "2"
}
```

- `id`: lowercase latin, words joined by `-`. **Never change an existing id**: the
  manager's order and BPMs, disabled songs, chart marks and `#song-<id>` links
  all hang on it. It also names the remixes.
- `audio`, `chart`, `lyrics`: paths under the JSON's `baseUrl`. Use `null` for a
  missing one; its button shows disabled.
- `bpm`: the default tempo (the manager can override it on the page).
- `chartRev`: optional. Chart marks are stored per chart path; when a chart image is
  replaced **under the same name**, raise `chartRev` so its marks start clean. Leave
  it alone for a small correction that the existing marks still fit.

### Files in S3

The JSON's `baseUrl` decides the folder: Choogzi (both pages) uses
`choogzi_setlist/`, Mishmeret Layla `choogzi_setlist/mishmeret/`.

| File | Key under the folder | Content-Type |
|---|---|---|
| recording | as in `audio`, e.g. `chatul_mifletzet.mp3` | `audio/mpeg` |
| remix | `remixes/<id>_<version>.mp3`, version one of `novocals`, `bassboost`, `keysboost`, `guitarboost`, `drumsboost` | `audio/mpeg` |
| chart | as in `chart`, e.g. `charts/<id>.png` | `image/png` |
| lyrics | as in `lyrics`, e.g. `lyrics/<id>.txt`, UTF-8 | `text/plain; charset=utf-8` |

Upload with `Cache-Control: no-cache` so a replaced file shows up at once. The
bucket is publicly readable, so anything uploaded there is public.

**Charts** are PNGs shown as a plain image. From a one-page A4 PDF:

```
pdftoppm -png -r 200 -singlefile "Song.pdf" charts/<id>
```

That gives 1653 × 2339, like the existing charts. Look at the result before
uploading (Hebrew fonts can render wrong).

A chart of several pages is still one PNG: render every page the same way
(`pdftoppm -png -r 200 "Song.pdf" <dir>/p`) and stack them top to bottom, e.g.
`ffmpeg -i <dir>/p-1.png -i <dir>/p-2.png -filter_complex vstack=inputs=2 charts/<id>.png`
(two A4 pages: 1653 × 4678). The viewer counts the pages from the height
(A4 proportions), fits one page to the screen like a one-page chart, and scrolls
to the rest.

**Remixes** are optional per song; a missing one shows an error in the player only
when someone picks that version.

### Steps for a new song

1. Upload its files to S3 (table above).
2. Add the song to the right `data/*.json`.
3. Test locally (below), then deploy (below).
4. If the manager has saved an order, the song appears at the end; the manager
   drags it into place on the page.

### Adding a setlist page

Copy any `*/setlist.html` into a new folder and change the attributes on `<body>`
(and the `<title>`):

```html
<body data-band="Band name" data-setlist="../data/<band>_setlist.json" data-home="index.html">
```

`data-home` is optional; without it the page has no back arrow. The folder name is
the band's id for chart marks and setlist edits, so the backend must know it: add it
to `BANDS` in the backend and deploy that first.

## Testing locally

```
python3 -m http.server 8000
```

then open http://localhost:8000/hugzi/setlist.html. Opening the file directly
(`file://`) can't load the JSON. Pages served over plain http use the backend's
**test** stage, so nothing done locally touches the live marks or setlist edits.

To test on an iPad, serve on the Wi-Fi (`--bind 0.0.0.0`) and open
`http://<the Mac's IP>:8000/...`. Serve a copy without any private, git-ignored
files: everything in the served folder is readable by the whole network.
Apple Pencil input can only be checked on the iPad itself.

## Deploying

Push to `main`; GitHub Pages publishes within about a minute. There is no other
step for the site.

1. Test locally (above), on the iPad too if the change touches drawing or touch.
2. Push to `main`.
3. Check the live page, e.g. that a changed file is served:
   `curl -s https://www.maoryaron.com/assets/setlist/main.js | head`
4. Open the setlist on the phone or iPad. A Home Screen web app may need closing
   and reopening to pick up new code.

A change that needs a new backend feature: deploy the backend first (see its
README), then push the site.

Third-party libraries in `assets/vendor/` are copied from npm with the version in
the file name. To update one, install the new version with npm, copy the same
`dist` file over, rename it, update the imports, and test.
