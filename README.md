# [🎞️ GIF Nyanpasu!](https://gif-nyanpasu.vercel.app)

**Free, browser-based video → GIF converter.**  
Trim, crop, adjust frame rate and speed.  
Runs 100% client-side — nothing ever leaves your device.

[![License: MIT](https://img.shields.io/badge/License-MIT-7c6af7.svg)](LICENSE)
[![No server required](https://img.shields.io/badge/server-none-34d399.svg)](#)
[![Works offline](https://img.shields.io/badge/offline-yes-34d399.svg)](#)

---

![Main Application Interface](/public/screenshot.jpeg)

---

## Live Demo

Visit [Video To GIF Converter](https://gif-nyanpasu.vercel.app)

---

## Features

| Feature                | Details                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Seek-based capture** | Every frame is captured by seeking the video directly — no dropped or duplicate frames regardless of clip length |
| **Timeline scrubber**  | Drag start/end markers, click to scrub, or use keyboard shortcuts                                                |
| **Visual crop**        | Drag-resize overlay with corner handles; or type exact pixel values                                              |
| **Frame rate**         | 5, 10, 15, 24, or 30 fps                                                                                         |
| **Output size**        | 20% – 100% of source resolution                                                                                  |
| **Speed**              | 1× – 5× playback speed                                                                                           |
| **Dithering**          | None, Floyd-Steinberg, Light, or Stucki                                                                          |
| **Timecode overlay**   | Optional burnt-in timestamp on every frame                                                                       |
| **Live size estimate** | Encodes a single sample frame to extrapolate real file size before the full conversion runs                      |
| **100% offline**       | All processing happens in Web Workers inside the browser — no uploads, no accounts                               |

---

## Usage

### Option A — Open directly

Because GIF Nyanpasu! is pure HTML/CSS/JS with no build step, you can just open `index.html` in any modern browser.

> **Note:** the Web Workers used by gif.js require the page to be served over HTTP(S), not `file://`.  
> Use Option B below for local development.

### Option B — Local dev server

Any static file server works. Examples:

```bash
# Python (built-in)
python -m http.server 8080

# Node.js (npx, no install needed)
npx serve .

# VS Code — install the "Live Server" extension and click "Go Live"
```

Then open `http://localhost:8080` in your browser.

### Option C — Deploy to GitHub Pages

1. Push the repo to GitHub.
2. Go to **Settings → Pages → Source** and select the `main` branch, root folder.
3. GitHub Pages will serve the site at `https://YOUR_USERNAME.github.io/YOUR_REPO/`.

---

## File Structure

```
gif-nyanpasu/
├── index.html          # App shell + markup
├── styles.css          # All styles (design tokens → components → responsive)
├── app.js              # Application logic (SizeEstimator, CropController,
│                       #   TimelineController, GifConverter)
├── gif.lib.js          # Bundled gif.js + worker source (GIF_WORKER_SOURCE)
├── /public             # Favicons, manifest, og-image, etc
└── README.md
```

---

## Keyboard Shortcuts

| Key     | Action                                            |
| ------- | ------------------------------------------------- |
| `Space` | Play / Pause                                      |
| `[`     | Set **start** marker at current playhead position |
| `]`     | Set **end** marker at current playhead position   |
| `←`     | Step one frame backward (hold to continue)        |
| `→`     | Step one frame forward (hold to continue)         |
| `Esc`   | Close fullscreen GIF preview                      |

---

## Architecture

GIF Nyanpasu! is structured as four plain ES6 classes, no framework or bundler required.

```
GifConverter  (top-level orchestrator)
│
├── TimelineController   video scrubbing, markers, playhead, keyboard nav
├── CropController       drag overlay + manual pixel inputs, localStorage sync
└── SizeEstimator        single-frame encode → linear extrapolation
```

**Encoding pipeline (`GifConverter._runConversion`):**

1. Build a list of source timestamps based on `fps`, `speed`, and the trimmed range.
2. For each timestamp: seek the `<video>` element, wait for `seeked`, draw to an off-screen `<canvas>` (with optional crop + timecode), then hand the frame to gif.js via `addFrame()`.
3. After all frames are captured, gif.js dispatches encoding to parallel Web Workers and emits a `Blob` on `finished`.

---

## Dependencies

| Library                                                            | Version | Purpose                         |
| ------------------------------------------------------------------ | ------- | ------------------------------- |
| [gif.js](https://github.com/jnordberg/gif.js)                      | 0.2.0   | GIF encoding (web worker based) |
| [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) | —       | Monospace UI font               |
| [Syne](https://fonts.google.com/specimen/Syne)                     | —       | Display / heading font          |

No build tools, no npm, no bundler. Just three files.

---

## Browser Support

Any modern browser with Web Worker and Canvas support:

| Browser                | Supported |
| ---------------------- | --------- |
| Chrome / Edge 88+      | ✅         |
| Firefox 78+            | ✅         |
| Safari 14+             | ✅         |
| Mobile Chrome / Safari | ✅         |

---

## Contributing

Pull requests are welcome. For significant changes, please open an issue first to discuss what you'd like to change.

1. Fork the repo and create your branch from `main`.
2. Make your changes — no build step needed, just edit and refresh.
3. Open a pull request with a clear description of the change and why.

---

## License

[MIT](LICENSE) — free to use, modify, and distribute.


## Credits
- Uses [video-to-gif-converter](https://dylansallred.github.io/Video-To-Gif-Converter/Video-To-Gif-Converter.html) (og project by [dylansallred](https://github.com/dylansallred))
- Uses [gif.js](https://jnordberg.github.io/gif.js/) for GIF encoding
- Interface design inspired by modern web applications
- SVG Icons from [Feather Icons](https://feathericons.com/)
- Agent: [Claude](https://claude.ai)

### Concerning the name 😜

All good ones were takes, so let's go with Nyanpasu! since i'm currently watching Non-Non Biyori.