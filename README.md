# maoryar.github.io
just my website. because I can...

## Layout

```
index.html                    www.maoryaron.com — minimal landing page
hugzi/index.html              Choogzi band page: photo gallery, videos, contact
hugzi/setlist.html            Choogzi setlist          -> data/setlist.json
mishmeret/setlist.html        Mishmeret Layla setlist  -> data/mishmeret_setlist.json
hugzi-old/setlist.html        archived Choogzi setlist -> data/hugzi_old_setlist.json
data/                         setlist JSON files (song titles, BPM, asset paths under baseUrl on S3)
archive/                      backups, not served by any page
assets/
  base.css                    shared tokens, reset, header, footer, round buttons
  home.css, home.js           band page styles + gallery/lightbox
  setlist.css                 setlist styles
  setlist/
    shell.js                  the setlist page markup, shared by every setlist page
    main.js                   entry: builds the page, loads the JSON, wires everything
    player.js                 playback (versions, repeat, seek, lock-screen controls)
    viewer.js                 the full-screen viewer dialog: open/close, prev/next, swipe
    panels.js                 the three viewer panels: BPM, chart, lyrics
    util.js                   small helpers
    api.js                    backend address: test stage on http (local), production on https
    manager.js                the manager password prompt (band marks and setlist editing)
    order.js                  the manager's song order and BPM changes, applied over the JSON
    editor.js                 setlist edit mode: drag to reorder, change BPM
    marks/                    drawing on charts: Mine (this device) and Band (shared) layers
      marks.js                toolbar and input; only a Pencil or mouse draws, fingers scroll
      ink.js                  stored mark data -> Fabric objects; eraser hit test
      store.js                localStorage, band API, offline outbox
  vendor/                     Fabric.js, perfect-freehand and SortableJS, copied from npm (MIT)
```

Chart marks are keyed by band folder + song id + chart path. Add `"chartRev": "2"`
to a song in the setlist JSON to start that chart's marks clean (e.g. after
replacing the chart image under the same name). The API lives in the private
`setlist-marks-backend` repo.

The manager can reorder songs and change BPMs on the page (the list icon in the
toolbar). Those edits live in the API, on top of the JSON: the JSON is still the
list of songs and where to add or remove them. A song added to the JSON shows up
at the end of the manager's order. The manager can also disable a song (swipe
it left in edit mode): it stays in the list, greyed out, and play all,
next/previous and the viewer's song-to-song navigation skip it.

No build step: plain HTML, CSS and ES modules, served as-is by GitHub Pages.

## Adding a setlist page

Copy any `*/setlist.html` into a new folder and change the three attributes on
`<body>` (and the `<title>`):

```html
<body data-band="Band name" data-setlist="../data/<band>_setlist.json" data-home="index.html">
```

`data-home` is optional; leave it out and the page has no back arrow.

## Editing a setlist

Edit its JSON in `data/`. Each song's `audio`, `chart` and `lyrics` are paths under
`baseUrl`; use `null` for a missing asset (its button shows disabled). Alternate
mixes are looked up at `remixes/<id>_<version>.mp3`.

## Running locally

```
python3 -m http.server 8000
```

then open e.g. http://localhost:8000/hugzi/setlist.html (opening the file directly
can't load the JSON).
