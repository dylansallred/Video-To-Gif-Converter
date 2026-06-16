/**
 * Crop Nyanpasu! — crop.js
 *
 * Architecture:
 *   ImageEntry    — data model for one loaded image file
 *   ImageCropper  — main application class: queue, canvas, drag overlay,
 *                   aspect ratio constraints, batch crop, output grid
 *
 * Depends on shared.js being loaded first (clamp, fmtBytes, saveSetting
 * are globals from that file).

'use strict';

/* ═══════════════════════════════════════════════════════════════════
   IMAGE ENTRY
   Data model for one file in the queue.
   ═══════════════════════════════════════════════════════════════════ */
class ImageEntry {
    /**
     * @param {File}   file
     * @param {string} objectUrl  - URL.createObjectURL result for the source file
     * @param {number} naturalW   - original pixel width
     * @param {number} naturalH   - original pixel height
     */
    constructor(file, objectUrl, naturalW, naturalH) {
        this.file = file;
        this.objectUrl = objectUrl;
        this.naturalW = naturalW;
        this.naturalH = naturalH;
        /** Normalised crop region (0-1 ratios). Persists across selection changes. */
        this.region = { x: 0, y: 0, w: 1, h: 1 };
        /** Cropped result Blob, set after _cropEntry() runs. */
        this.cropped = null;
        /**
         * Object URL for the cropped preview card.
         * Stored here so the overlay can reuse it without revoking it.
         */
        this.previewUrl = null;
        /** Stable id used to key output card DOM nodes. */
        this.id = crypto.randomUUID();
    }

    /**
     * The crop region expressed in source image pixels.
     * @returns {{ x: number, y: number, w: number, h: number }}
     */
    get pixelRegion() {
        return {
            x: Math.round(this.region.x * this.naturalW),
            y: Math.round(this.region.y * this.naturalH),
            w: Math.max(1, Math.round(this.region.w * this.naturalW)),
            h: Math.max(1, Math.round(this.region.h * this.naturalH)),
        };
    }
}


/* ═══════════════════════════════════════════════════════════════════
   IMAGE CROPPER
   ═══════════════════════════════════════════════════════════════════ */
class ImageCropper {
    constructor() {
        /** @type {ImageEntry[]} */
        this.entries = [];
        this.activeIndex = -1;
        /** null = free, or a number (w/h ratio) */
        this.aspectRatio = null;

        // Drag state
        this._dragging = false;
        this._handle = '';
        this._startX = 0;
        this._startY = 0;
        this._startRegion = null;

        this._bindElements();
        this._buildCropOverlay();
        this._bindEvents();
    }

    /* ── DOM references ── */
    _bindElements() {
        const $ = id => document.getElementById(id);
        this.el = {
            fileInput: $('fileInput'),
            dropZone: $('dropZone'),
            imageQueue: $('imageQueue'),
            canvasWrapper: $('canvasWrapper'),
            emptyPreview: $('emptyPreview'),
            sourceCanvas: $('sourceCanvas'),
            aspectPresets: $('aspectPresets'),
            formatSelect: $('formatSelect'),
            qualityInput: $('qualityInput'),
            qualityLabel: $('qualityLabel'),
            qualityGroup: $('qualityGroup'),
            cropReadout: $('cropReadout'),
            inX: $('inX'), inY: $('inY'), inW: $('inW'), inH: $('inH'),
            resetCropBtn: $('resetCropBtn'),
            cropBtn: $('cropBtn'),
            cropAllBtn: $('cropAllBtn'),
            outputGrid: $('outputGrid'),
            emptyOutput: $('emptyOutput'),
            downloadAllBtn: $('downloadAllBtn'),
            previewOverlay: $('previewOverlay'),
            overlayImg: $('overlayImg'),
            clearAllBtn: $('clearAllBtn'),
        };
    }

    /* ── Build drag-resize crop overlay ── */
    _buildCropOverlay() {
        this._overlayEl = document.createElement('div');
        this._overlayEl.className = 'crop-overlay';

        this._regionEl = document.createElement('div');
        this._regionEl.className = 'crop-region';

        // Eight handles: corners + edge midpoints
        ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'].forEach(pos => {
            const h = document.createElement('div');
            h.className = `crop-handle ${pos}`;
            this._regionEl.appendChild(h);
        });

        this._overlayEl.appendChild(this._regionEl);

        // Move drag (clicking directly on the region body)
        this._regionEl.addEventListener('mousedown', e => {
            if (e.target === this._regionEl) {
                this._dragStart(e.clientX, e.clientY, 'move'); e.preventDefault();
            }
        });
        this._regionEl.addEventListener('touchstart', e => {
            if (e.target === this._regionEl) {
                this._dragStart(e.touches[0].clientX, e.touches[0].clientY, 'move');
                e.preventDefault();
            }
        }, { passive: false });

        // Handle drags
        this._regionEl.querySelectorAll('.crop-handle').forEach(h => {
            const kind = h.className.split(' ')[1];
            h.addEventListener('mousedown', e => {
                this._dragStart(e.clientX, e.clientY, kind);
                e.stopPropagation(); e.preventDefault();
            });
            h.addEventListener('touchstart', e => {
                this._dragStart(e.touches[0].clientX, e.touches[0].clientY, kind);
                e.stopPropagation(); e.preventDefault();
            }, { passive: false });
        });

        document.addEventListener('mousemove', e => this._dragMove(e.clientX, e.clientY));
        document.addEventListener('mouseup', () => this._dragEnd());
        document.addEventListener('touchmove', e => {
            if (this._dragging) { this._dragMove(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); }
        }, { passive: false });
        document.addEventListener('touchend', () => this._dragEnd());
    }

    /* ── Event wiring ── */
    _bindEvents() {
        // File input + drop zone
        this.el.fileInput.addEventListener('change', e => this._addFiles(e.target.files));
        this.el.dropZone.addEventListener('click', () => this.el.fileInput.click());
        this.el.dropZone.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') this.el.fileInput.click();
        });
        this.el.dropZone.addEventListener('dragover', e => {
            e.preventDefault(); this.el.dropZone.classList.add('drag-over');
        });
        this.el.dropZone.addEventListener('dragleave', () => {
            this.el.dropZone.classList.remove('drag-over');
        });
        this.el.dropZone.addEventListener('drop', e => {
            e.preventDefault();
            this.el.dropZone.classList.remove('drag-over');
            this._addFiles(e.dataTransfer.files);
        });

        // Aspect ratio presets
        this.el.aspectPresets.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.el.aspectPresets.querySelectorAll('.preset-btn')
                    .forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const r = btn.dataset.ratio;
                if (r === 'free') {
                    this.aspectRatio = null;
                } else {
                    const [w, h] = r.split(':').map(Number);
                    this.aspectRatio = w / h;
                }

                if (this.activeIndex >= 0) {
                    this._applyAspectConstraint();
                    this._renderCropRegion();
                    this._syncInputsFromRegion();
                    this._updateReadout();
                }
            });
        });

        // Format / quality
        this.el.formatSelect.addEventListener('change', () => {
            const isPng = this.el.formatSelect.value === 'image/png';
            this.el.qualityGroup.style.display = isPng ? 'none' : '';
        });
        this.el.qualityInput.addEventListener('input', () => {
            this.el.qualityLabel.textContent = `${this.el.qualityInput.value}%`;
        });

        // Manual pixel inputs — live sync
        [this.el.inX, this.el.inY, this.el.inW, this.el.inH].forEach(inp => {
            inp.addEventListener('input', () => this._applyManualInputs());
        });

        // Buttons
        this.el.resetCropBtn.addEventListener('click', () => this._resetCrop());
        this.el.cropBtn.addEventListener('click', () => this._cropActive());
        this.el.cropAllBtn.addEventListener('click', () => this._cropAll());
        this.el.downloadAllBtn.addEventListener('click', () => this._downloadAll());
        this.el.clearAllBtn.addEventListener('click', () => this._clearAll());

        // Fullscreen overlay — close only; never revoke the card's previewUrl
        this.el.previewOverlay.addEventListener('click', () => {
            this.el.previewOverlay.hidden = true;
            document.body.style.overflow = '';
            // Clear src without revoking — the URL belongs to the output card
            this.el.overlayImg.src = '';
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && !this.el.previewOverlay.hidden)
                this.el.previewOverlay.click();
        });
    }

    /* ═══ File loading ═══════════════════════════════════════════════ */

    /**
     * Load a FileList, build ImageEntry objects, add to queue.
     * @param {FileList} files
     */
    _addFiles(files) {
        [...files].forEach(file => {
            if (!file.type.startsWith('image/')) return;
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                const entry = new ImageEntry(file, url, img.naturalWidth, img.naturalHeight);
                this.entries.push(entry);
                this._renderQueue();
                this.el.clearAllBtn.disabled = false;
                // Auto-select the first image added
                if (this.entries.length === 1) this._selectEntry(0);
                // Enable Crop All once there are at least 2 images
                this.el.cropAllBtn.disabled = this.entries.length < 2;
            };
            img.src = url;
        });
    }

    /* ═══ Queue rendering ════════════════════════════════════════════ */

    /** Re-render the queue list from this.entries. */
    _renderQueue() {
        this.el.imageQueue.innerHTML = '';
        this.entries.forEach((entry, idx) => {
            const item = document.createElement('div');
            item.className = 'queue-item' + (idx === this.activeIndex ? ' active' : '');

            const thumb = document.createElement('img');
            thumb.className = 'queue-thumb';
            thumb.src = entry.objectUrl;
            thumb.alt = entry.file.name;

            const info = document.createElement('div');
            info.className = 'queue-info';
            info.innerHTML =
                `<div class="queue-name">${entry.file.name}</div>` +
                `<div class="queue-dims">${entry.naturalW} × ${entry.naturalH}px</div>`;

            const status = document.createElement('span');
            status.className = 'queue-status' +
                (entry.cropped ? ' done' : (idx === this.activeIndex ? ' active' : ''));
            status.textContent = entry.cropped
                ? '✓ Done'
                : (idx === this.activeIndex ? '● Active' : '');

            const rmBtn = document.createElement('button');
            rmBtn.className = 'queue-remove';
            rmBtn.title = 'Remove';
            rmBtn.setAttribute('aria-label', 'Remove image');
            rmBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
                stroke-linejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
            rmBtn.addEventListener('click', e => { e.stopPropagation(); this._removeEntry(idx); });

            item.appendChild(thumb);
            item.appendChild(info);
            item.appendChild(status);
            item.appendChild(rmBtn);
            item.addEventListener('click', () => this._selectEntry(idx));
            this.el.imageQueue.appendChild(item);
        });
    }

    /**
     * Remove entry at idx, clean up its object URLs, update active selection.
     * @param {number} idx
     */
    _removeEntry(idx) {
        const entry = this.entries[idx];
        URL.revokeObjectURL(entry.objectUrl);
        // previewUrl is used by the output card img — only revoke if card was removed too
        this.entries.splice(idx, 1);

        if (this.activeIndex === idx) {
            this.activeIndex = -1;
            this._clearCanvas();
        } else if (this.activeIndex > idx) {
            this.activeIndex--;
        }

        this.el.cropAllBtn.disabled = this.entries.length < 2;
        this._renderQueue();
        if (this.entries.length > 0 && this.activeIndex < 0) this._selectEntry(0);
    }

    /** Revoke all object URLs and reset the workspace to its initial state. */
    _clearAll() {
        // Revoke every URL we own to avoid memory leaks
        this.entries.forEach(e => {
            URL.revokeObjectURL(e.objectUrl);
            if (e.previewUrl) URL.revokeObjectURL(e.previewUrl);
        });
        this.entries = [];
        this.activeIndex = -1;

        this._clearCanvas();
        this.el.imageQueue.innerHTML = '';

        // Reset output grid back to just the empty-state placeholder
        this.el.outputGrid.innerHTML = '';
        const placeholder = document.createElement('div');
        placeholder.className = 'empty-state';
        placeholder.id = 'emptyOutput';
        placeholder.style.gridColumn = '1 / -1';
        placeholder.innerHTML = `
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
        <p>Cropped images will appear here</p>`;
        this.el.outputGrid.appendChild(placeholder);
        // Re-point the cached reference
        this.el.emptyOutput = placeholder;

        this.el.clearAllBtn.disabled = true;
        this.el.downloadAllBtn.disabled = true;
        this.el.cropAllBtn.disabled = true;
        this.el.fileInput.value = '';
    }

    /* ═══ Entry selection / canvas ═══════════════════════════════════ */

    /**
     * Activate entry at idx — draw source image to canvas, restore crop region.
     * @param {number} idx
     */
    _selectEntry(idx) {
        if (idx < 0 || idx >= this.entries.length) return;
        this.activeIndex = idx;
        const entry = this.entries[idx];

        const canvas = this.el.sourceCanvas;
        const ctx = canvas.getContext('2d');
        const img = new Image();

        img.onload = () => {
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            ctx.drawImage(img, 0, 0);

            // Fit the canvas display into the wrapper respecting both axes.
            // For wide images: constrain by width. For tall images: constrain
            // by height (62vh) so the overlay never goes off-screen.
            const wrapW = this.el.canvasWrapper.clientWidth;
            const maxH = Math.floor(window.innerHeight * 0.62);
            const byWidth = { w: wrapW, h: Math.round(img.naturalHeight * (wrapW / img.naturalWidth)) };
            const byHeight = { h: maxH, w: Math.round(img.naturalWidth * (maxH / img.naturalHeight)) };

            // Use whichever constraint produces the smaller result
            const fitted = byWidth.h <= maxH ? byWidth : byHeight;
            canvas.style.width = `${fitted.w}px`;
            canvas.style.height = `${fitted.h}px`;

            canvas.hidden = false;
            this.el.emptyPreview.style.display = 'none';

            // Attach overlay to the wrapper but size+position it to sit exactly
            // over the canvas, not the full wrapper width.
            if (!this._overlayEl.parentElement) {
                this.el.canvasWrapper.appendChild(this._overlayEl);
            }
            this._positionOverlayToCanvas();

            this._renderCropRegion();
            this._syncInputsFromRegion();
            this._updateReadout();

            this.el.cropReadout.hidden = false;
            this.el.resetCropBtn.disabled = false;
            this.el.cropBtn.disabled = false;
            this.el.cropAllBtn.disabled = this.entries.length < 2;

            // Re-align overlay whenever the wrapper is resized (e.g. window resize,
            // panel layout reflow on mobile)
            if (this._resizeObs) this._resizeObs.disconnect();
            this._resizeObs = new ResizeObserver(() => {
                if (this.activeIndex >= 0) {
                    this._positionOverlayToCanvas();
                    this._renderCropRegion();
                }
            });
            this._resizeObs.observe(this.el.canvasWrapper);
        };
        img.src = entry.objectUrl;

        this._renderQueue();
    }

    /** Clear the canvas area when no image is active. */
    _clearCanvas() {
        this.el.sourceCanvas.hidden = true;
        this.el.emptyPreview.style.display = '';
        if (this._overlayEl.parentElement) this._overlayEl.parentElement.removeChild(this._overlayEl);
        this.el.cropReadout.hidden = true;
        this.el.resetCropBtn.disabled = true;
        this.el.cropBtn.disabled = true;
        this.el.cropAllBtn.disabled = true;
    }

    /* ═══ Crop region rendering ═══════════════════════════════════════ */

    /**
 * Size and position the crop overlay div so it sits exactly over the
 * rendered canvas element, regardless of how the canvas is aligned
 * inside the wrapper.
 * Called after every canvas resize and on window resize.
 */
    _positionOverlayToCanvas() {
        const canvas = this.el.sourceCanvas;
        const wrapperRect = this.el.canvasWrapper.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();

        // Offset of canvas inside the wrapper
        const offsetLeft = canvasRect.left - wrapperRect.left;
        const offsetTop = canvasRect.top - wrapperRect.top;

        Object.assign(this._overlayEl.style, {
            position: 'absolute',
            left: `${offsetLeft}px`,
            top: `${offsetTop}px`,
            width: `${canvasRect.width}px`,
            height: `${canvasRect.height}px`,
            // Override inset:0 from shared.css
            inset: 'unset',
        });
    }

    /** Position the overlay div from the active entry's normalised region. */
    _renderCropRegion() {
        if (this.activeIndex < 0) return;
        const entry = this.entries[this.activeIndex];
        const canvas = this.el.sourceCanvas;

        // Overlay now matches canvas exactly — use its own dimensions
        const dW = this._overlayEl.offsetWidth;
        const dH = this._overlayEl.offsetHeight;

        Object.assign(this._regionEl.style, {
            left: `${entry.region.x * dW}px`,
            top: `${entry.region.y * dH}px`,
            width: `${entry.region.w * dW}px`,
            height: `${entry.region.h * dH}px`,
        });
    }

    /** Populate the four pixel inputs from the active entry's region. */
    _syncInputsFromRegion() {
        if (this.activeIndex < 0) return;
        const entry = this.entries[this.activeIndex];
        const px = entry.pixelRegion;

        this.el.inX.max = entry.naturalW - 1;
        this.el.inY.max = entry.naturalH - 1;
        this.el.inW.max = entry.naturalW;
        this.el.inH.max = entry.naturalH;

        this.el.inX.value = px.x;
        this.el.inY.value = px.y;
        this.el.inW.value = px.w;
        this.el.inH.value = px.h;
    }

    /** Refresh the crop dimensions readout strip. */
    _updateReadout() {
        if (this.activeIndex < 0) return;
        const px = this.entries[this.activeIndex].pixelRegion;
        this.el.cropReadout.innerHTML =
            `Crop: <span style="color:var(--accent)">${px.w}&thinsp;×&thinsp;${px.h}px</span>` +
            `&ensp;at&ensp;<span style="color:var(--text2)">(${px.x}, ${px.y})</span>`;
    }

    /* ═══ Aspect ratio constraint ════════════════════════════════════ */

    /**
     * Constrain the active entry's region to this.aspectRatio if set,
     * keeping the top-left anchor and shrinking the over-sized axis.
     */
    _applyAspectConstraint() {
        if (!this.aspectRatio || this.activeIndex < 0) return;
        const r = this.entries[this.activeIndex].region;

        let w = r.w, h = r.h;
        if (w / h > this.aspectRatio) w = h * this.aspectRatio;
        else h = w / this.aspectRatio;

        // Clamp within image bounds
        w = Math.min(w, 1 - r.x);
        h = Math.min(h, 1 - r.y);
        // Re-balance after clamp
        if (w / h > this.aspectRatio) w = h * this.aspectRatio;
        else h = w / this.aspectRatio;

        r.w = Math.max(0.01, w);
        r.h = Math.max(0.01, h);
    }

    /* ═══ Manual pixel inputs ════════════════════════════════════════ */

    /** Read pixel inputs, clamp, normalise, commit to active entry. */
    _applyManualInputs() {
        if (this.activeIndex < 0) return;
        const entry = this.entries[this.activeIndex];
        const vw = entry.naturalW, vh = entry.naturalH;

        let x = clamp(parseInt(this.el.inX.value) || 0, 0, vw - 1);
        let y = clamp(parseInt(this.el.inY.value) || 0, 0, vh - 1);
        let w = clamp(parseInt(this.el.inW.value) || vw, 1, vw - x);
        let h = clamp(parseInt(this.el.inH.value) || vh, 1, vh - y);

        // Enforce aspect ratio by locking h to w
        if (this.aspectRatio) {
            h = Math.round(w / this.aspectRatio);
            h = clamp(h, 1, vh - y);
            w = Math.round(h * this.aspectRatio);
            w = clamp(w, 1, vw - x);
        }

        entry.region = { x: x / vw, y: y / vh, w: w / vw, h: h / vh };

        this._renderCropRegion();
        this._syncInputsFromRegion();
        this._updateReadout();
    }

    /** Reset the active entry's crop to the full image frame. */
    _resetCrop() {
        if (this.activeIndex < 0) return;
        this.entries[this.activeIndex].region = { x: 0, y: 0, w: 1, h: 1 };
        this._renderCropRegion();
        this._syncInputsFromRegion();
        this._updateReadout();
    }

    /* ═══ Drag logic ═════════════════════════════════════════════════ */

    /**
     * Begin a drag operation.
     * @param {number} clientX
     * @param {number} clientY
     * @param {string} handle - 'move' | 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se'
     */
    _dragStart(clientX, clientY, handle) {
        if (this.activeIndex < 0) return;
        this._dragging = true;
        this._handle = handle;
        this._startX = clientX;
        this._startY = clientY;
        this._startRegion = { ...this.entries[this.activeIndex].region };
        this._regionEl.style.transition = 'none';
        document.body.classList.add('dragging-active');
    }

    /**
     * Update the crop region while dragging.
     * @param {number} clientX
     * @param {number} clientY
     */
    _dragMove(clientX, clientY) {
        if (!this._dragging || this.activeIndex < 0) return;

        // Deltas must be relative to the overlay (which sits over the canvas),
        // not the wrapper or the raw canvas element
        const rect = this._overlayEl.getBoundingClientRect();

        const dx = (clientX - this._startX) / rect.width;
        const dy = (clientY - this._startY) / rect.height;
        const MIN = 0.02;
        const sr = this._startRegion;
        const r = { ...this.entries[this.activeIndex].region };

        if (this._handle === 'move') {
            r.x = clamp(sr.x + dx, 0, 1 - sr.w);
            r.y = clamp(sr.y + dy, 0, 1 - sr.h);
        } else {
            const isL = this._handle.includes('w');
            const isR = this._handle === 'e' || (!this._handle.includes('w') && this._handle.includes('e'));
            const isT = this._handle.includes('n');
            const isB = this._handle === 's' || (!this._handle.includes('n') && this._handle.includes('s'));

            if (isL) {
                const nx = clamp(sr.x + dx, 0, 1);
                const nw = sr.w - dx;
                if (nw >= MIN) { r.x = nx; r.w = Math.min(1 - nx, nw); }
            } else if (isR) {
                const nw = sr.w + dx;
                if (nw >= MIN) r.w = Math.min(1 - r.x, nw);
            }

            if (isT) {
                const ny = clamp(sr.y + dy, 0, 1);
                const nh = sr.h - dy;
                if (nh >= MIN) { r.y = ny; r.h = Math.min(1 - ny, nh); }
            } else if (isB) {
                const nh = sr.h + dy;
                if (nh >= MIN) r.h = Math.min(1 - r.y, nh);
            }
        }

        // Safety clamps
        if (r.x + r.w > 1) r.w = 1 - r.x;
        if (r.y + r.h > 1) r.h = 1 - r.y;

        // Apply aspect ratio constraint during resize drags
        if (this.aspectRatio && this._handle !== 'move') {
            if (r.w / r.h > this.aspectRatio) r.h = r.w / this.aspectRatio;
            else r.w = r.h * this.aspectRatio;
            // Safety re-clamp after ratio correction
            if (r.x + r.w > 1) { r.w = 1 - r.x; r.h = r.w / this.aspectRatio; }
            if (r.y + r.h > 1) { r.h = 1 - r.y; r.w = r.h * this.aspectRatio; }
        }

        this.entries[this.activeIndex].region = r;
        this._renderCropRegion();
        this._syncInputsFromRegion();
        this._updateReadout();
    }

    /** End the current drag. */
    _dragEnd() {
        if (!this._dragging) return;
        this._dragging = false;
        this._handle = '';
        this._regionEl.style.transition = '';
        document.body.classList.remove('dragging-active');
    }

    /* ═══ Cropping ═══════════════════════════════════════════════════ */

    /**
     * Crop a single ImageEntry using its current region.
     * Creates the output Blob, stores the preview URL on the entry,
     * and adds a card to the output grid.
     * @param {ImageEntry} entry
     * @param {string}     mime    - output MIME type
     * @param {number}     quality - 0-1 quality for lossy formats
     */
    async _cropEntry(entry, mime, quality) {
        const px = entry.pixelRegion;
        const out = document.createElement('canvas');
        out.width = px.w;
        out.height = px.h;
        const ctx = out.getContext('2d');

        const img = new Image();
        await new Promise(res => { img.onload = res; img.src = entry.objectUrl; });
        ctx.drawImage(img, px.x, px.y, px.w, px.h, 0, 0, px.w, px.h);

        const blob = await new Promise(res => out.toBlob(res, mime, quality));
        entry.cropped = blob;

        // Store the preview URL on the entry so the overlay can reuse it
        // without revoking it when the overlay closes.
        if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
        entry.previewUrl = URL.createObjectURL(blob);

        this._addOutputCard(entry, mime);
        this.el.emptyOutput.style.display = 'none';
        this.el.downloadAllBtn.disabled = false;
    }

    /** Crop the currently active image. */
    async _cropActive() {
        if (this.activeIndex < 0) return;
        const mime = this.el.formatSelect.value;
        const quality = parseInt(this.el.qualityInput.value) / 100;

        await this._cropEntry(this.entries[this.activeIndex], mime, quality);
        this._renderQueue();

        // Auto-advance to the next un-cropped entry
        const next = this.entries.findIndex((e, i) => i > this.activeIndex && !e.cropped);
        if (next >= 0) this._selectEntry(next);
    }

    /**
     * Apply the current active region to every entry and crop them all.
     * Uses the normalised region, so the same proportional area is taken
     * from images of any dimension.
     */
    async _cropAll() {
        if (this.activeIndex < 0 || this.entries.length < 2) return;

        // Snapshot the template region before iteration mutates entries
        const templateRegion = { ...this.entries[this.activeIndex].region };
        const mime = this.el.formatSelect.value;
        const quality = parseInt(this.el.qualityInput.value) / 100;

        // Disable buttons while running to prevent double-triggers
        this.el.cropBtn.disabled = true;
        this.el.cropAllBtn.disabled = true;

        for (const entry of this.entries) {
            entry.region = { ...templateRegion };
            await this._cropEntry(entry, mime, quality);
        }

        this._renderQueue();
        this.el.cropBtn.disabled = false;
        this.el.cropAllBtn.disabled = this.entries.length < 2;
    }

    /**
     * Add (or replace) an output card for the given entry.
     * @param {ImageEntry} entry
     * @param {string}     mime
     */
    _addOutputCard(entry, mime) {
        // Remove previous card for this entry if re-cropping
        const existing = document.getElementById(`out-${entry.id}`);
        if (existing) existing.remove();

        const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mime] || 'png';
        const name = entry.file.name.replace(/\.[^.]+$/, '') + `_crop.${ext}`;
        const px = entry.pixelRegion;

        const card = document.createElement('div');
        card.className = 'output-card';
        card.id = `out-${entry.id}`;

        const img = document.createElement('img');
        img.src = entry.previewUrl;
        img.alt = name;
        // Open overlay using the stored previewUrl — never re-creates or revokes it here
        img.addEventListener('click', () => {
            this.el.overlayImg.src = entry.previewUrl;
            this.el.previewOverlay.hidden = false;
            document.body.style.overflow = 'hidden';
        });

        const info = document.createElement('div');
        info.className = 'output-card-info';
        info.innerHTML =
            `<div class="output-card-name">${name}</div>` +
            `<div>${px.w} × ${px.h}px · ${(entry.cropped.size / 1024).toFixed(1)} KB</div>`;

        const dlBtn = document.createElement('button');
        dlBtn.className = 'output-card-btn';
        dlBtn.innerHTML =
            `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line></svg> Download`;
        dlBtn.addEventListener('click', () => this._downloadBlob(entry.cropped, name));

        card.appendChild(img);
        card.appendChild(info);
        card.appendChild(dlBtn);

        // Insert before the empty-state placeholder so it stays at the bottom
        this.el.outputGrid.insertBefore(card, this.el.emptyOutput);
    }

    /* ═══ Download helpers ═══════════════════════════════════════════ */

    /**
     * Trigger a browser download for a Blob.
     * @param {Blob}   blob
     * @param {string} filename
     */
    _downloadBlob(blob, filename) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        // Revoke after a tick — the download is initiated synchronously
        setTimeout(() => URL.revokeObjectURL(a.href), 100);
    }

    /** Download all cropped images sequentially. */
    _downloadAll() {
        const mime = this.el.formatSelect.value;
        const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mime] || 'png';
        this.entries
            .filter(e => e.cropped)
            .forEach(e => {
                const name = e.file.name.replace(/\.[^.]+$/, '') + `_crop.${ext}`;
                this._downloadBlob(e.cropped, name);
            });
    }
}


/* ═══════════════════════════════════════════════════════════════════
   BOOTSTRAP
   ═══════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
    new ImageCropper();
});
