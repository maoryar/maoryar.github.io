# maoryar.github.io
just my website. because I can...

## Layout

```
index.html                  www.maoryaron.com — minimal landing page
data/setlist.json           the setlist: song titles, BPM, and asset paths relative to baseUrl (S3)
hugzi/index.html            band page: photo gallery, videos, contact
hugzi/setlist.html          setlist: player, BPM / chart / lyrics viewer
hugzi/assets/
  base.css                  shared tokens, reset, header, footer, round buttons
  home.css, home.js         band page styles + gallery/lightbox
  setlist.css               setlist styles
  setlist/
    main.js                 entry: loads setlist.json, renders rows, wires everything
    player.js               playback (versions, repeat, seek, lock-screen controls)
    viewer.js               the full-screen viewer dialog: open/close, prev/next, swipe
    panels.js               the three viewer panels: BPM, chart, lyrics
    util.js                 small helpers
```

No build step: plain HTML, CSS and ES modules, served as-is by GitHub Pages.

## Editing the setlist

Edit `data/setlist.json`. Each song's `audio`, `chart` and `lyrics` are paths under
`baseUrl`; use `null` for a missing asset (its button shows disabled). Alternate
mixes are looked up at `remixes/<id>_<version>.mp3`.

## Running locally

```
python3 -m http.server 8000
```

then open http://localhost:8000/hugzi/setlist.html (opening the file directly
can't load the JSON).
