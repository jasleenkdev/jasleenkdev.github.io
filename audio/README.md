# audio

`background.mp3` — the looping background track. It is played by the floating
toggle button (`#music-toggle`), which drives the `<audio id="bg-music">`
element in `index.html` directly. The element loops itself via its `loop`
attribute.

`click.mp3` — the short, quiet click/pop played on every click anywhere on the
page, from a pool of copies so rapid clicks overlap. Keep it quiet *in the file*:
iOS ignores the `volume` property entirely.

Both are same-origin on purpose. This used to be a hidden YouTube embed driven
by the IFrame Player API; it served ads, and Safari does not hand user
activation to a cross-origin iframe, so un-muting it was unreliable.

See section 7 of `js/scrapbook.js`.
