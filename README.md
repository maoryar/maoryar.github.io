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
```

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
