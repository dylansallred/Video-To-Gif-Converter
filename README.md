# [🎞️ GIF Nyanpasu!](https://gif-nyanpasu.vercel.app)

**Free, browser-based video → GIF converter + image cropper.**  
Trim, crop, adjust frame rate and speed. Crop images individually or in batch.  
Runs 100% client-side — nothing ever leaves your device.

[![License: MIT](https://img.shields.io/badge/License-MIT-7c6af7.svg)](LICENSE)
[![No server required](https://img.shields.io/badge/server-none-34d399.svg)](#)
[![Works offline](https://img.shields.io/badge/offline-yes-34d399.svg)](#)

---

![Cover Image](/public/og-image.png)

---

## Live Demo

| Tool          | URL                                                                            |
| ------------- | ------------------------------------------------------------------------------ |
| GIF Converter | [gif-nyanpasu.vercel.app](https://gif-nyanpasu.vercel.app)                     |
| Image Cropper | [gif-nyanpasu.vercel.app/crop.html](https://gif-nyanpasu.vercel.app/crop.html) |

---

## Features

### 🎞 GIF Converter

![Main Application Interface](/public/screenshot.jpeg)

---

| Feature                | Details                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Seek-based capture** | Every frame is captured by seeking the video directly — no dropped or duplicate frames regardless of clip length |
| **Timeline scrubber**  | Drag start/end markers, click to scrub, or use keyboard shortcuts                                                |
| **Visual crop**        | Drag-resize overlay with corner and edge handles; or type exact pixel values                                     |
| **Frame rate**         | 5, 10, 15, 24, or 30 fps                                                                                         |
| **Output size**        | 20% – 100% of source resolution                                                                                  |
| **Speed**              | 1× – 5× playback speed                                                                                           |
| **Dithering**          | None, Floyd-Steinberg, Light, or Stucki                                                                          |
| **Timecode overlay**   | Optional burnt-in timestamp on every frame                                                                       |
| **Live size estimate** | Encodes a single sample frame to extrapolate real file size before the full conversion runs                      |
| **100% offline**       | All processing happens in Web Workers inside the browser — no uploads, no accounts                               |

### ✂️ Image Cropper

![Crop Tool Interface](/public/crop-screenshot.jpeg)

---

| Feature                 | Details                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| **Multi-image queue**   | Load any number of images at once; click between them to switch                              |
| **Visual crop**         | Drag-resize overlay with corner + edge handles and rule-of-thirds grid lines                 |
| **Aspect ratio lock**   | Free, 1:1, 4:3, 16:9, 3:2, 9:16, 2:3, 4:5 — constraint enforced during drag and manual input |
| **Manual inputs**       | Type exact pixel X / Y / W / H values, live-synced with the drag overlay                     |
| **Batch crop**          | "Crop All" applies the current normalised region to every image in the queue at once         |
| **Output format**       | PNG (lossless), JPEG, or WebP with adjustable quality                                        |
| **Individual download** | Download any single cropped result from the output grid                                      |
| **Download All**        | One click to download every completed crop                                                   |

---

## Usage

### Option A — Open directly

Because GIF Nyanpasu! is pure HTML/CSS/JS with no build step, you can open `index.html` or `crop.html` directly in any modern browser.

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
├── index.html        # GIF converter — markup shell
├── crop.html         # Image cropper — markup shell
│
├── shared.css        # Design tokens + components used by both pages
├── shared.js         # Shared helpers (clamp, fmtTime, fmtBytes, loadSetting, saveSetting)
│
├── styles.css        # GIF converter — page-specific styles
├── main.js           # GIF converter — SizeEstimator, CropController,
│                     # TimelineController, GifConverter
│
├── crop.css          # Image cropper — page-specific styles
├── crop.js           # Image cropper — ImageEntry, ImageCropper
│
├── gif_lib.js        # Bundled gif.js 0.2.0 + embedded worker source (GIF_WORKER_SOURCE)
└── /public           # Favicons, manifest, og-image, screenshots
```

### Load order

**`index.html`**
```html
<link rel="stylesheet" href="shared.css">
<link rel="stylesheet" href="styles.css">
...
<script src="shared.js"></script>
<script src="gif_lib.js"></script>
<script src="main.js"></script>
```

**`crop.html`**
```html
<link rel="stylesheet" href="shared.css">
<link rel="stylesheet" href="crop.css">
...
<script src="shared.js"></script>
<script src="crop.js"></script>
```

---

## Keyboard Shortcuts

### GIF Converter

| Key     | Action                                            |
| ------- | ------------------------------------------------- |
| `Space` | Play / Pause                                      |
| `[`     | Set **start** marker at current playhead position |
| `]`     | Set **end** marker at current playhead position   |
| `←`     | Step one frame backward (hold to continue)        |
| `→`     | Step one frame forward (hold to continue)         |
| `Esc`   | Close fullscreen GIF preview                      |

### Image Cropper

| Key   | Action                         |
| ----- | ------------------------------ |
| `Esc` | Close fullscreen image preview |

---

## Dependencies

| Library                                                            | Version | Purpose                         |
| ------------------------------------------------------------------ | ------- | ------------------------------- |
| [gif.js](https://github.com/jnordberg/gif.js)                      | 0.2.0   | GIF encoding (web worker based) |
| [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) | —       | Monospace UI font               |
| [Syne](https://fonts.google.com/specimen/Syne)                     | —       | Display / heading font          |

No build tools, no npm, no bundler.

---

## Contributing

Pull requests are welcome. For significant changes, please open an issue first to discuss what you'd like to change.

1. Fork the repo and create your branch from `main`.
2. Make your changes — no build step needed, just edit and refresh.
3. Open a pull request with a clear description of the change and why.

---

## License

[MIT](LICENSE) — free to use, modify, and distribute.

---

## Credits

- Original concept: [video-to-gif-converter](https://dylansallred.github.io/Video-To-Gif-Converter/Video-To-Gif-Converter.html) by [dylansallred](https://github.com/dylansallred)
- GIF encoding: [gif.js](https://jnordberg.github.io/gif.js/) by jnordberg
- SVG icons: [Feather Icons](https://feathericons.com/)
- Agent: [Claude](https://claude.ai)

### Concerning the name 😜

All good ones were taken, so let's go with Nyanpasu! since I'm currently watching Non Non Biyori.
