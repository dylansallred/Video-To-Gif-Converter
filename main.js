/**
 * GIF Nyanpasu! — main.js
 *
 * Architecture:
 *   SizeEstimator      — live pre-conversion file size estimation
 *   CropController     — visual drag crop + manual pixel inputs, two-way sync
 *   TimelineController — video scrubbing, markers, playhead, keyboard nav
 *   GifConverter       — orchestrates encoding using gif.js (seek-based capture)
 *
 * Depends on shared.js being loaded first (clamp, fmtTime, fmtBytes,
 * loadSetting, saveSetting are globals from that file).
 *
 * Encoding engine: web-worker based, fastest + best file sizes of the tested
 * options. Frame capture is seek-based (no real-time playback), so no frames
 * are ever dropped or duplicated.
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════════
   SIZE ESTIMATOR
   Strategy: encode a single real frame with gif.js at the target
   settings, measure the resulting byte count, then extrapolate
   linearly across totalFrames.  This is inherently accurate because
   it uses the actual encoder rather than a heuristic formula.

   The single-frame encode runs in < 200 ms for typical resolutions
   and is triggered debounced 400 ms after the last settings change
   so it never fires mid-interaction.
   ═══════════════════════════════════════════════════════════════════ */
class SizeEstimator {
    /**
     * @param {HTMLElement}      wrapEl       - outer container (shown/hidden)
     * @param {HTMLElement}      valueEl      - text node target
     * @param {HTMLVideoElement} videoEl      - the video element
     * @param {() => string}     getWorkerUrl - returns a gif.js worker Blob URL
     */
    constructor(wrapEl, valueEl, videoEl, getWorkerUrl) {
        this.wrapEl = wrapEl;
        this.valueEl = valueEl;
        this.video = videoEl;
        this._getWorkerUrl = getWorkerUrl;
        this._estimateTimer = null;
    }

    /**
     * Recompute the estimate and update the UI (debounced 400 ms).
     *
     * @param {object} p
     * @param {number} p.outW          - output width px
     * @param {number} p.outH          - output height px
     * @param {number} p.srcX          - crop source X in video pixels
     * @param {number} p.srcY          - crop source Y in video pixels
     * @param {number} p.srcW          - crop source width in video pixels
     * @param {number} p.srcH          - crop source height in video pixels
     * @param {number} p.dur           - clip duration in source seconds
     * @param {number} p.speed         - speed multiplier
     * @param {string} p.dither        - dither algorithm name or 'false'
     * @param {number} p.start         - clip start time in seconds
     * @param {number} p.frameInterval - ms between output frames
     * @param {number} p.totalFrames   - total output frame count
     */
    update(p) {
        clearTimeout(this._estimateTimer);
        this.valueEl.textContent = 'Estimating…';
        this.wrapEl.hidden = false;

        if (!this.video.src || !this.video.videoWidth) return;

        this._estimateTimer = setTimeout(() => this._run(p), 400);
    }

    /** Hide the estimate widget. */
    hide() { this.wrapEl.hidden = true; }

    /* ── Internal ── */
    async _run(p) {
        const video = this.video;
        if (!video.src || !video.videoWidth) return;

        const canvas = document.createElement('canvas');
        canvas.width = p.outW;
        canvas.height = p.outH;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        // No seek needed — draw whatever frame is currently visible.
        ctx.drawImage(video, p.srcX, p.srcY, p.srcW, p.srcH, 0, 0, p.outW, p.outH);

        // One-frame gif.js encode to measure real byte cost.
        const sampleBytes = await new Promise((resolve, reject) => {
            const gif = new GIF({
                workers: 1,
                quality: 50,
                width: p.outW,
                height: p.outH,
                dither: p.dither === 'false' ? false : p.dither,
                workerScript: this._getWorkerUrl(),
            });
            gif.addFrame(ctx, { copy: true, delay: p.frameInterval });
            gif.on('finished', blob => resolve(blob.size));
            gif.on('error', reject);
            gif.render();
        });

        // Extrapolate: a multi-frame GIF shares one global palette written once.
        // Strip the one-time header overhead from the sample so we scale only
        // per-frame payload, then add the header back exactly once.
        const GIF_HEADER_BYTES = 800; // header + palette + Netscape ext
        const perFrameBytes = Math.max(1, sampleBytes - GIF_HEADER_BYTES);
        const estimated = GIF_HEADER_BYTES + perFrameBytes * p.totalFrames;

        const gifDur = (p.dur / p.speed).toFixed(1);

        this.valueEl.textContent =
            `~${fmtBytes(estimated)}  (${p.outW}×${p.outH} · ${p.totalFrames} frames · ${gifDur}s)`;

        // Colour-code by size
        this.valueEl.className = 'size-estimate-value';
        if (estimated > 30 * 1024 * 1024) this.valueEl.classList.add('large');
        else if (estimated > 8 * 1024 * 1024) this.valueEl.classList.add('warn');
    }
}


/* ═══════════════════════════════════════════════════════════════════
   CROP CONTROLLER
   Manages the drag-resize overlay on the video element and the manual
   pixel-input fields.  The two are kept in sync at all times.
   Internal state: region {x, y, w, h} normalised 0-1 ratios.
   ═══════════════════════════════════════════════════════════════════ */
class CropController {
    /**
     * @param {HTMLVideoElement} videoEl
     * @param {Function}         onChangeCb - called whenever the crop changes
     */
    constructor(videoEl, onChangeCb) {
        this.video = videoEl;
        this.onChangeCb = onChangeCb;
        this.enabled = false;
        this.region = { x: 0, y: 0, w: 1, h: 1 }; // normalised 0-1

        this.cropOverlay = null;
        this.cropRegionEl = null;
        this.panel = document.getElementById('cropPanel');
        this.readout = document.getElementById('cropReadout');
        this.inX = document.getElementById('cropInputX');
        this.inY = document.getElementById('cropInputY');
        this.inW = document.getElementById('cropInputW');
        this.inH = document.getElementById('cropInputH');

        this._buildOverlay();
        this._bindManualInputs();
        this._restoreFromStorage(); // ① restore persisted crop on construction
    }

    /* ── Build DOM overlay ── */
    _buildOverlay() {
        this.cropOverlay = document.createElement('div');
        this.cropOverlay.className = 'crop-overlay';

        this.cropRegionEl = document.createElement('div');
        this.cropRegionEl.className = 'crop-region';

        ['nw', 'ne', 'sw', 'se'].forEach(pos => {
            const h = document.createElement('div');
            h.className = `crop-handle ${pos}`;
            this.cropRegionEl.appendChild(h);
        });

        this.cropOverlay.appendChild(this.cropRegionEl);
        this._initDrag();
    }

    /* ── Enable / disable ── */
    enable() {
        if (!this.video.src || this.enabled) return;

        const wrapper = this.video.parentElement;
        wrapper.appendChild(this.cropOverlay);
        this.cropOverlay.style.display = 'block';

        this._positionOverlay();   // ← always position from stored region, skip the isFullFrame reset
        this._syncManualInputs();  // ← video is loaded here, so videoWidth is available
        this._updateReadout();

        this.panel.hidden = false;
        this.enabled = true;

        if (!this._resizeObs) {
            this._resizeObs = new ResizeObserver(() => {
                if (this.enabled) this._positionOverlay();
            });
            this._resizeObs.observe(wrapper);
        }
    }

    disable() {
        if (!this.enabled) return;
        if (this.cropOverlay.parentElement) {
            this.cropOverlay.parentElement.removeChild(this.cropOverlay);
        }
        if (this._resizeObs) { this._resizeObs.disconnect(); this._resizeObs = null; }
        this.enabled = false;
        this.panel.hidden = true;
        this.onChangeCb();
    }

    toggle() { this.enabled ? this.disable() : this.enable(); }

    /** Reset crop to full video frame. */
    reset() {
        this.region = { x: 0, y: 0, w: 1, h: 1 };
        this._positionOverlay();
        this._syncManualInputs();
        this._updateReadout();
        this._saveToStorage(); // ① persist reset
        this.onChangeCb();
    }

    /**
     * Returns the crop region in video pixels.
     * @returns {{ x: number, y: number, w: number, h: number }}
     */
    get pixelRegion() {
        const vw = this.video.videoWidth;
        const vh = this.video.videoHeight;
        return {
            x: Math.round(this.region.x * vw),
            y: Math.round(this.region.y * vh),
            w: Math.max(1, Math.round(this.region.w * vw)),
            h: Math.max(1, Math.round(this.region.h * vh)),
        };
    }

    _saveToStorage() {
        try { localStorage.setItem('cropRegion', JSON.stringify(this.region)); } catch (_) { }
    }

    _restoreFromStorage() {
        try {
            const raw = localStorage.getItem('cropRegion');
            if (!raw) return;
            const parsed = JSON.parse(raw);
            const keys = ['x', 'y', 'w', 'h'];
            const valid = keys.every(k =>
                typeof parsed[k] === 'number' && isFinite(parsed[k]) &&
                parsed[k] >= 0 && parsed[k] <= 1);
            if (valid) this.region = { ...parsed };
        } catch (_) { }
    }

    /* ── Internal: position the overlay div from normalised region ── */
    _positionOverlay() {
        const rect = this.video.getBoundingClientRect();
        if (!rect.width) return;
        Object.assign(this.cropRegionEl.style, {
            left: `${this.region.x * rect.width}px`,
            top: `${this.region.y * rect.height}px`,
            width: `${this.region.w * rect.width}px`,
            height: `${this.region.h * rect.height}px`,
        });
    }

    /* ── Internal: sync manual inputs from normalised region ── */
    _syncManualInputs() {
        if (!this.video.videoWidth) return;
        const vw = this.video.videoWidth;
        const vh = this.video.videoHeight;
        const px = this.pixelRegion;

        // ③ Set bounds first so the browser enforces them on display
        this.inX.min = 0; this.inX.max = vw - 1;
        this.inY.min = 0; this.inY.max = vh - 1;
        this.inW.min = 1; this.inW.max = vw;
        this.inH.min = 1; this.inH.max = vh;

        this.inX.value = px.x;
        this.inY.value = px.y;
        this.inW.value = px.w;
        this.inH.value = px.h;
    }

    _updateReadout() {
        if (!this.video.videoWidth) return;
        const px = this.pixelRegion;
        this.readout.innerHTML =
            `Crop: <span style="color:var(--accent)">${px.w}&thinsp;×&thinsp;${px.h}px</span>` +
            `&ensp;at&ensp;<span style="color:var(--text2)">${px.x}, ${px.y}</span>`;
    }

    _bindManualInputs() {
        [this.inX, this.inY, this.inW, this.inH].forEach(inp => {
            inp.addEventListener('input', () => this._applyManualInputs());
        });
        document.getElementById('applyCropInputs')
            .addEventListener('click', () => this._applyManualInputs());
        [this.inX, this.inY, this.inW, this.inH].forEach(inp => {
            inp.addEventListener('keydown', e => { if (e.key === 'Enter') this._applyManualInputs(); });
        });
    }

    _applyManualInputs() {
        const vw = this.video.videoWidth;
        const vh = this.video.videoHeight;
        if (!vw) return;

        const x = clamp(parseInt(this.inX.value) || 0, 0, vw - 1);
        const y = clamp(parseInt(this.inY.value) || 0, 0, vh - 1);
        const w = clamp(parseInt(this.inW.value) || vw, 1, vw - x);
        const h = clamp(parseInt(this.inH.value) || vh, 1, vh - y);

        this.region = { x: x / vw, y: y / vh, w: w / vw, h: h / vh };

        this._positionOverlay();
        this._syncManualInputs();
        this._updateReadout();
        this._saveToStorage();
        this.onChangeCb();
    }

    /* ── Drag logic (mouse + touch) ── */
    _initDrag() {
        let dragging = false, handle = '', startX = 0, startY = 0, startRegion = null;

        const onStart = (clientX, clientY, h) => {
            dragging = true;
            handle = h;
            startX = clientX;
            startY = clientY;
            startRegion = { ...this.region };
            this.cropRegionEl.style.transition = 'none';
            document.body.classList.add('dragging-active');
        };

        const onMove = (clientX, clientY) => {
            if (!dragging) return;
            const rect = this.video.getBoundingClientRect();
            const dx = (clientX - startX) / rect.width;
            const dy = (clientY - startY) / rect.height;
            const MIN = 0.04;

            if (handle === 'move') {
                this.region.x = clamp(startRegion.x + dx, 0, 1 - startRegion.w);
                this.region.y = clamp(startRegion.y + dy, 0, 1 - startRegion.h);
            } else {
                const isL = handle.includes('w');
                const isT = handle.includes('n');

                if (isL) {
                    const nx = clamp(startRegion.x + dx, 0, 1);
                    const nw = startRegion.w - dx;
                    if (nw >= MIN) { this.region.x = nx; this.region.w = Math.min(1 - nx, nw); }
                } else {
                    const nw = startRegion.w + dx;
                    if (nw >= MIN) this.region.w = Math.min(1 - this.region.x, nw);
                }

                if (isT) {
                    const ny = clamp(startRegion.y + dy, 0, 1);
                    const nh = startRegion.h - dy;
                    if (nh >= MIN) { this.region.y = ny; this.region.h = Math.min(1 - ny, nh); }
                } else {
                    const nh = startRegion.h + dy;
                    if (nh >= MIN) this.region.h = Math.min(1 - this.region.y, nh);
                }
            }

            if (this.region.x + this.region.w > 1) this.region.w = 1 - this.region.x;
            if (this.region.y + this.region.h > 1) this.region.h = 1 - this.region.y;

            this._positionOverlay();
            this._syncManualInputs();
            this._updateReadout();
            this._saveToStorage();
            this.onChangeCb();
        };

        const onEnd = () => {
            if (!dragging) return;
            dragging = false;
            handle = '';
            this.cropRegionEl.style.transition = '';
            document.body.classList.remove('dragging-active');
        };

        // Mouse
        this.cropRegionEl.addEventListener('mousedown', e => {
            if (e.target === this.cropRegionEl) { onStart(e.clientX, e.clientY, 'move'); e.preventDefault(); }
        });
        this.cropRegionEl.querySelectorAll('.crop-handle').forEach(h => {
            h.addEventListener('mousedown', e => {
                onStart(e.clientX, e.clientY, h.className.split(' ')[1]);
                e.stopPropagation(); e.preventDefault();
            });
        });
        document.addEventListener('mousemove', e => onMove(e.clientX, e.clientY));
        document.addEventListener('mouseup', onEnd);

        // Touch
        this.cropRegionEl.addEventListener('touchstart', e => {
            if (e.target === this.cropRegionEl) {
                onStart(e.touches[0].clientX, e.touches[0].clientY, 'move');
                e.preventDefault();
            }
        }, { passive: false });
        this.cropRegionEl.querySelectorAll('.crop-handle').forEach(h => {
            h.addEventListener('touchstart', e => {
                onStart(e.touches[0].clientX, e.touches[0].clientY, h.className.split(' ')[1]);
                e.stopPropagation(); e.preventDefault();
            }, { passive: false });
        });
        document.addEventListener('touchmove', e => {
            if (dragging) { onMove(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); }
        }, { passive: false });
        document.addEventListener('touchend', onEnd);
    }
}


/* ═══════════════════════════════════════════════════════════════════
   TIMELINE CONTROLLER
   Video scrubbing, start/end markers, playhead, keyboard shortcuts.
   ═══════════════════════════════════════════════════════════════════ */
class TimelineController {
    /**
     * @param {HTMLVideoElement} video
     * @param {Function}         onChangeCb - called when time range changes
     */
    constructor(video, onChangeCb) {
        this.video = video;
        this.onChangeCb = onChangeCb;
        this.videoDuration = 0;
        this.isPlaying = false;
        this.isDragging = false;
        this.isScrubbing = false;
        this.wasPaused = true;
        this.dragTarget = null;
        this.isKeyHeld = false;

        this.el = {
            timeline: document.getElementById('timeline'),
            startMarker: document.querySelector('.start-marker'),
            endMarker: document.querySelector('.end-marker'),
            playhead: document.querySelector('.playhead'),
            progress: document.querySelector('.timeline-progress'),
            startDisplay: document.querySelector('.start-time'),
            endDisplay: document.querySelector('.end-time'),
            durationDisp: document.querySelector('.duration-time'),
            startInput: document.getElementById('startTime'),
            endInput: document.getElementById('endTime'),
            playBtn: document.getElementById('playPauseBtn'),
            muteBtn: document.getElementById('muteBtn'),
            speedSelect: document.getElementById('speedSelect'),
        };

        this._bindEvents();
        this._loadMuteState();
    }

    _bindEvents() {
        this.video.addEventListener('loadedmetadata', () => this._onLoaded());
        this.video.addEventListener('timeupdate', () => this._onTimeUpdate());
        this.video.addEventListener('play', () => { this.isPlaying = true; this._syncPlayBtn(); });
        this.video.addEventListener('pause', () => { this.isPlaying = false; this._syncPlayBtn(); });
        this.video.addEventListener('ended', () => {
            this.isPlaying = false;
            this._syncPlayBtn();
            this.video.currentTime = parseFloat(this.el.startInput.value);
        });

        [this.el.startMarker, this.el.endMarker].forEach(m => {
            m.addEventListener('mousedown', e => this._markerDragStart(e, m));
            m.addEventListener('touchstart', e => this._markerDragStart(e.touches[0], m), { passive: false });
        });
        document.addEventListener('mousemove', e => this._markerDragMove(e));
        document.addEventListener('mouseup', () => this._markerDragEnd());
        document.addEventListener('touchmove', e => this._markerDragMove(e.touches[0]), { passive: false });
        document.addEventListener('touchend', () => this._markerDragEnd());

        this._initTimelineScrub();
        this._initPlayheadDrag();

        this.el.playBtn.addEventListener('click', () => this._togglePlay());
        this.el.muteBtn.addEventListener('click', () => this._toggleMute());

        [this.el.startInput, this.el.endInput].forEach(inp => {
            inp.addEventListener('change', e => this._onManualTimeChange(e));
        });

        this.el.speedSelect.addEventListener('change', () => this._updateDurationDisplay());

        document.addEventListener('keydown', e => this._onKeyDown(e));
        document.addEventListener('keyup', e => this._onKeyUp(e));
    }

    _onLoaded() {
        const file = document.getElementById('videoInput').files[0];
        let dur = this.video.duration;

        if (file && file.type === 'video/webm') {
            const m = file.name.match(/_(\d+(?:\.\d+)?)s\.[^.]+$/);
            if (m && !isNaN(m[1])) dur = parseFloat(m[1]);
        }
        this.videoDuration = isFinite(dur) ? dur : 0;
        const max = Math.round(this.videoDuration * 100) / 100;

        this.el.startInput.value = '0.00';
        this.el.endInput.value = max.toFixed(2);
        this.el.startInput.max = max;
        this.el.endInput.max = max;
        this.el.startDisplay.textContent = fmtTime(0);
        this.el.endDisplay.textContent = fmtTime(max);

        this.el.playBtn.disabled = false;
        this.el.playhead.style.display = 'block';
        document.querySelectorAll('.time-stepper-btn').forEach(b => { b.disabled = false; });

        this._updateMarkers();
        this._updateDurationDisplay();
        this._updateProgress();
    }

    _onTimeUpdate() {
        const ct = this.video.currentTime;
        const end = parseFloat(this.el.endInput.value);
        const st = parseFloat(this.el.startInput.value);

        if (this.isPlaying && ct >= end) {
            this.video.currentTime = st;
            this.video.play().catch(() => { });
        }
        if (!this.isScrubbing) this._updatePlayhead();
        this._updateProgress();
    }

    _markerDragStart(e, marker) {
        if (!this.video.src) return;
        this.isDragging = true;
        this.dragTarget = marker;
        e.preventDefault && e.preventDefault();
        e.stopPropagation && e.stopPropagation();
    }

    _markerDragMove(e) {
        if (!this.isDragging || !this.dragTarget) return;
        if (e.preventDefault) e.preventDefault();
        const cx = e.touches ? e.touches[0].clientX : e.clientX;
        const pos = this._clientXToPos(cx);
        const dur = this.videoDuration;
        const t = clamp(pos * dur, 0, dur);
        const isStart = this.dragTarget === this.el.startMarker;
        const other = parseFloat(isStart ? this.el.endInput.value : this.el.startInput.value);

        if (isStart && t >= other) return;
        if (!isStart && t <= other) return;

        this._setMarkerTime(isStart, t);
        this.video.currentTime = t;
        this._updatePlayhead();
        this.onChangeCb();
    }

    _markerDragEnd() { this.isDragging = false; this.dragTarget = null; }

    _initTimelineScrub() {
        const tl = this.el.timeline;

        tl.addEventListener('mousedown', e => {
            if (e.target === this.el.startMarker || e.target === this.el.endMarker ||
                e.target === this.el.playhead) return;
            this._scrubStart(e.clientX);
            const mm = ev => this._scrubMove(ev.clientX);
            const mu = () => { this._scrubEnd(); document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
            document.addEventListener('mousemove', mm);
            document.addEventListener('mouseup', mu);
        });

        tl.addEventListener('touchstart', e => {
            if (e.target === this.el.startMarker || e.target === this.el.endMarker ||
                e.target === this.el.playhead) return;
            this._scrubStart(e.touches[0].clientX);
            e.preventDefault();
        }, { passive: false });

        document.addEventListener('touchmove', e => {
            if (this.isScrubbing) { this._scrubMove(e.touches[0].clientX); e.preventDefault(); }
        }, { passive: false });
        document.addEventListener('touchend', () => { if (this.isScrubbing) this._scrubEnd(); });
    }

    _scrubStart(clientX) {
        this.isScrubbing = true;
        this.wasPaused = !this.isPlaying;
        if (this.isPlaying) this.video.pause();
        this._seekToPos(clientX);
    }
    _scrubMove(clientX) { if (this.isScrubbing) this._seekToPos(clientX); }
    _scrubEnd() {
        this.isScrubbing = false;
        if (!this.wasPaused) this.video.play().catch(() => { });
    }

    _seekToPos(clientX) {
        const pos = this._clientXToPos(clientX);
        const t = clamp(pos * this.videoDuration, 0, this.videoDuration);
        if (isFinite(t)) { this.video.currentTime = t; this._updatePlayhead(); }
    }

    _initPlayheadDrag() {
        const ph = this.el.playhead;
        ph.addEventListener('mousedown', e => {
            this._scrubStart(e.clientX);
            const mm = ev => this._scrubMove(ev.clientX);
            const mu = () => { this._scrubEnd(); document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
            document.addEventListener('mousemove', mm);
            document.addEventListener('mouseup', mu);
            e.stopPropagation(); e.preventDefault();
        });
    }

    _onManualTimeChange(e) {
        if (!this.video.src) return;
        const isStart = e.target === this.el.startInput;
        let val = parseFloat(e.target.value) || 0;
        val = clamp(val, 0, Math.round(this.videoDuration * 100) / 100);
        if (isStart) val = Math.min(val, parseFloat(this.el.endInput.value) - 0.01);
        else val = Math.max(val, parseFloat(this.el.startInput.value) + 0.01);
        e.target.value = val.toFixed(2);
        this._updateDisplay(isStart, val);
        this._updateMarkers();
        this._updateDurationDisplay();
        this.onChangeCb();
    }

    async _togglePlay() {
        if (!this.video.src) return;
        const st = parseFloat(this.el.startInput.value);
        const et = parseFloat(this.el.endInput.value);
        this.el.playBtn.disabled = true;
        try {
            if (!this.isPlaying) {
                if (this.video.currentTime < st || this.video.currentTime >= et)
                    this.video.currentTime = st;
                await this.video.play();
            } else {
                await this.video.pause();
            }
        } catch (_) { /* ignore AbortError */ }
        finally { this.el.playBtn.disabled = false; }
    }

    _syncPlayBtn() { this.el.playBtn.textContent = this.isPlaying ? 'Pause' : 'Play'; }

    _toggleMute() {
        this.video.muted = !this.video.muted;
        saveSetting('videoMuted', this.video.muted);
        this._renderMuteBtn();
    }

    _loadMuteState() {
        this.video.muted = localStorage.getItem('videoMuted') === 'true';
        this._renderMuteBtn();
    }

    _renderMuteBtn() {
        const btn = this.el.muteBtn;
        const muted = this.video.muted;
        btn.classList.toggle('is-muted', muted);
        btn.innerHTML = muted
            ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`
            : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;
    }

    _onKeyDown(e) {
        if (!this.video.src) return;
        if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
        if (this.isKeyHeld) return;

        if (e.code === 'Space') { e.preventDefault(); this._togglePlay(); return; }

        if (e.key === '[' || e.key === ']') {
            e.preventDefault();
            const ct = this.video.currentTime;
            const st = parseFloat(this.el.startInput.value);
            const et = parseFloat(this.el.endInput.value);
            if (e.key === '[' && ct < et) { this._setMarkerTime(true, ct); this.onChangeCb(); }
            if (e.key === ']' && ct > st) { this._setMarkerTime(false, ct); this.onChangeCb(); }
            return;
        }

        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            if (this.isPlaying) this.video.pause();
            this.isKeyHeld = true;
            this._startFrameStep(e.key === 'ArrowLeft' ? -(1 / 30) : (1 / 30));
        }
    }

    _onKeyUp(e) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') this.isKeyHeld = false;
    }

    _startFrameStep(delta) {
        const step = () => {
            const st = parseFloat(this.el.startInput.value);
            const et = parseFloat(this.el.endInput.value);
            let t = this.video.currentTime + delta;
            if (t > et) t = st;
            if (t < st) t = et;
            this.video.currentTime = t;
            this._updatePlayhead();
        };
        step();
        const tick = () => {
            if (!this.isKeyHeld) return;
            step();
            setTimeout(() => requestAnimationFrame(tick), 38);
        };
        setTimeout(() => { if (this.isKeyHeld) requestAnimationFrame(tick); }, 220);
    }

    _clientXToPos(clientX) {
        const rect = this.el.timeline.getBoundingClientRect();
        return clamp((clientX - rect.left) / rect.width, 0, 1);
    }

    _setMarkerTime(isStart, t) {
        const inp = isStart ? this.el.startInput : this.el.endInput;
        const clamped = clamp(t, 0, this.videoDuration);
        inp.value = clamped.toFixed(2);
        this._updateDisplay(isStart, clamped);
        this._updateMarkers();
        this._updateDurationDisplay();
    }

    _updateDisplay(isStart, t) {
        (isStart ? this.el.startDisplay : this.el.endDisplay).textContent = fmtTime(t);
    }

    _updateMarkers() {
        const dur = this.videoDuration;
        if (!dur) return;
        const st = parseFloat(this.el.startInput.value);
        const et = parseFloat(this.el.endInput.value);
        this.el.startMarker.style.left = `${(st / dur) * 100}%`;
        this.el.endMarker.style.left = `${(et / dur) * 100}%`;
    }

    _updatePlayhead() {
        const dur = this.videoDuration;
        if (!dur || !this.video.src) return;
        this.el.playhead.style.display = 'block';
        this.el.playhead.style.left = `${(this.video.currentTime / dur) * 100}%`;
    }

    _updateProgress() {
        const dur = this.videoDuration;
        if (!dur) return;
        const st = parseFloat(this.el.startInput.value);
        const et = parseFloat(this.el.endInput.value);
        this.el.progress.style.left = `${(st / dur) * 100}%`;
        this.el.progress.style.width = `${((et - st) / dur) * 100}%`;
    }

    _updateDurationDisplay() {
        const st = parseFloat(this.el.startInput.value);
        const et = parseFloat(this.el.endInput.value);
        const spd = parseFloat(this.el.speedSelect.value);
        const raw = et - st;
        this.el.durationDisp.innerHTML = spd !== 1
            ? `<span style="color:var(--text2)">${raw.toFixed(1)}s</span>` +
            ` → <span style="color:var(--accent2)">${(raw / spd).toFixed(1)}s</span>` +
            ` <span style="color:var(--accent);font-size:.9em">${spd}×</span>`
            : `<span style="color:var(--text2)">${raw.toFixed(1)}s</span>`;
    }

    /**
     * Adjust a time input by delta seconds — used by stepper buttons.
     * @param {string} inputId
     * @param {number} delta
     */
    adjustTime(inputId, delta) {
        const inp = document.getElementById(inputId);
        if (!inp || !this.video.src) return;
        const isStart = inputId === 'startTime';
        const dur = this.videoDuration;
        const other = parseFloat(document.getElementById(isStart ? 'endTime' : 'startTime').value);
        let val = Math.round((parseFloat(inp.value) + delta) * 100) / 100;
        if (isStart) val = clamp(val, 0, other - 0.01);
        else val = clamp(val, other + 0.01, Math.round(dur * 100) / 100);
        inp.value = val.toFixed(2);
        this._updateDisplay(isStart, val);
        this._updateMarkers();
        this._updateDurationDisplay();
        this._updateProgress();
        this.onChangeCb();
    }
}


/* ═══════════════════════════════════════════════════════════════════
   GIF CONVERTER
   Orchestrates the full encode pipeline using gif.js.
   Frame capture is seek-based: no real-time playback required,
   so every frame is captured accurately regardless of clip length.
   ═══════════════════════════════════════════════════════════════════ */
class GifConverter {
    constructor() {
        this.currentBlob = null;
        this.originalName = '';
        this.lastSettings = null;
        this.cancelFlag = false;
        this.startedAt = 0;
        this.workerCount = Math.max(2, Math.min(navigator.hardwareConcurrency ?? 4, 8));
        this._cachedWorkerUrl = null;

        this._bindElements();
        this._loadSettings();
        this._bindEvents();
        this._initTimecodePreview();
        this._initPreviewOverlay();
        this._initExpandButtons();
    }

    _bindElements() {
        const $ = id => document.getElementById(id);
        this.el = {
            videoInput: $('videoInput'),
            videoPreview: $('videoPreview'),
            convertButton: $('convertButton'),
            progressOverlay: $('progressOverlay'),
            progressStatus: $('progressStatus'),
            progressFill: $('progressFill'),
            progressDetails: $('progressDetails'),
            cancelBtn: $('cancelBtn'),
            previewGif: $('previewGif'),
            downloadButton: $('downloadButton'),
            sizeIndicator: $('sizeIndicator'),
            fpsSelect: $('fpsSelect'),
            sizeSelect: $('sizeSelect'),
            ditherSelect: $('ditherSelect'),
            speedSelect: $('speedSelect'),
            startTime: $('startTime'),
            endTime: $('endTime'),
            showTimecode: $('showTimecode'),
            timecodePreviewer: $('timecodePreviewer'),
            previewOverlay: $('previewOverlay'),
            overlayGif: $('overlayGif'),
            toggleCrop: $('toggleCrop'),
            sizeEstimate: $('sizeEstimate'),
            sizeEstimateVal: $('sizeEstimateValue'),
        };
    }

    _loadSettings() {
        ['fpsSelect', 'sizeSelect', 'ditherSelect', 'speedSelect'].forEach(id => {
            const v = loadSetting(id, null);
            if (v) this.el[id].value = v;
        });
        this.el.showTimecode.checked = loadSetting('showTimecode', 'false') === 'true';
    }

    _bindEvents() {
        this.el.videoInput.addEventListener('change', e => this._onFileInput(e));
        this.el.convertButton.addEventListener('click', () => this._startConversion());
        this.el.downloadButton.addEventListener('click', () => this._downloadGif());
        this.el.cancelBtn.addEventListener('click', () => { this.cancelFlag = true; });

        ['fpsSelect', 'sizeSelect', 'ditherSelect', 'speedSelect'].forEach(id => {
            this.el[id].addEventListener('change', e => {
                saveSetting(id, e.target.value);
                if (id === 'speedSelect')
                    this.el.videoPreview.playbackRate = parseFloat(e.target.value);
                this._refreshEstimate();
                this._markChanged();
            });
        });

        this.el.showTimecode.addEventListener('change', e => {
            saveSetting('showTimecode', e.target.checked);
            this.el.timecodePreviewer.style.display = e.target.checked ? 'block' : 'none';
            this._markChanged();
        });

        [this.el.startTime, this.el.endTime].forEach(inp => {
            inp.addEventListener('change', () => { this._refreshEstimate(); this._markChanged(); });
        });

        document.querySelectorAll('.time-stepper-btn').forEach(btn => {
            let hold = null, rep = null;
            const go = () => this.timeline.adjustTime(btn.dataset.target, parseFloat(btn.dataset.delta));
            btn.addEventListener('mousedown', e => {
                e.preventDefault(); go();
                hold = setTimeout(() => { rep = setInterval(go, 50); }, 380);
            });
            btn.addEventListener('mouseup', () => { clearTimeout(hold); clearInterval(rep); });
            btn.addEventListener('mouseleave', () => { clearTimeout(hold); clearInterval(rep); });
            btn.addEventListener('touchstart', e => {
                e.preventDefault(); go();
                hold = setTimeout(() => { rep = setInterval(go, 50); }, 380);
            });
            btn.addEventListener('touchend', () => { clearTimeout(hold); clearInterval(rep); });
        });

        this.el.toggleCrop.addEventListener('click', () => {
            this.crop.toggle();
            const active = this.crop.enabled;
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                stroke-linejoin="round" aria-hidden="true">
                <path d="M6.13 1L6 16a2 2 0 0 0 2 2h15"></path>
                <path d="M1 6.13L16 6a2 2 0 0 1 2 2v15"></path></svg>`;
            this.el.toggleCrop.classList.toggle('active', active);
            this.el.toggleCrop.setAttribute('aria-pressed', active);
            this.el.toggleCrop.innerHTML = (active ? 'Disable Crop' : 'Enable Crop') + svg;
            this._refreshEstimate();
            this._markChanged();
        });

        document.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('keydown', e => { if (e.code === 'Space') e.preventDefault(); });
        });
    }

    _initSubControllers() {
        const onTimeChange = () => { this._refreshEstimate(); this._markChanged(); };

        this.timeline = new TimelineController(this.el.videoPreview, onTimeChange);

        this.crop = new CropController(this.el.videoPreview, () => {
            this._refreshEstimate();
            this._markChanged();
        });

        this.estimator = new SizeEstimator(
            this.el.sizeEstimate,
            this.el.sizeEstimateVal,
            this.el.videoPreview,
            () => this._workerBlobUrl(),
        );
    }

    _onFileInput(e) {
        const file = e.target.files[0];
        if (!file) return;

        const supported = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'];
        if (!supported.includes(file.type)) {
            alert('Unsupported format. Please use MP4, WebM, OGG, or MOV.');
            return;
        }

        this.originalName = file.name.replace(/\.[^/.]+$/, '');
        this.lastSettings = null;
        this.currentBlob = null;

        const url = URL.createObjectURL(file);
        const v = this.el.videoPreview;
        v.src = url;
        v.style.display = 'block';

        this.el.toggleCrop.disabled = false;
        this.el.convertButton.disabled = false;
        this.el.convertButton.classList.remove('needs-reconvert');
        this.el.previewGif.style.display = 'none';
        this.el.downloadButton.hidden = true;
        this.el.sizeIndicator.hidden = true;
        this.el.timecodePreviewer.style.display =
            this.el.showTimecode.checked ? 'block' : 'none';

        v.onloadedmetadata = () => {
            v.style.aspectRatio = `${v.videoWidth / v.videoHeight}`;
            const spd = parseFloat(this.el.speedSelect.value);
            if (!isNaN(spd)) v.playbackRate = spd;
            this._refreshEstimate();
        };

        v.onerror = () => {
            alert('Could not load video. Try another file.');
            this.el.videoInput.value = '';
            v.style.display = 'none';
        };

        if (this.crop.enabled) this.crop.reset();
    }

    _refreshEstimate() {
        const video = this.el.videoPreview;
        if (!video.src || !video.videoWidth) return;

        let srcX, srcY, srcW, srcH;
        if (this.crop && this.crop.enabled) {
            const px = this.crop.pixelRegion;
            srcX = px.x; srcY = px.y; srcW = px.w; srcH = px.h;
        } else {
            srcX = 0; srcY = 0;
            srcW = video.videoWidth;
            srcH = video.videoHeight;
        }

        const sizePercent = parseFloat(this.el.sizeSelect.value);
        const outW = Math.max(2, Math.round(srcW * sizePercent));
        const outH = Math.max(2, Math.round(srcH * sizePercent));

        const fps = parseInt(this.el.fpsSelect.value);
        const speed = parseFloat(this.el.speedSelect.value);
        const start = parseFloat(this.el.startTime.value);
        const end = parseFloat(this.el.endTime.value);
        const dither = this.el.ditherSelect.value;

        const dur = Math.max(0, end - start);
        const frameInterval = 1000 / fps;
        const totalFrames = Math.max(1, Math.round((dur / speed) * fps));

        this.estimator.update({ outW, outH, srcX, srcY, srcW, srcH, dur, speed, dither, start, frameInterval, totalFrames });
    }

    _markChanged() {
        if (!this.lastSettings || !this.currentBlob) return;
        const cur = this._captureSettings();
        const changed = JSON.stringify(cur) !== JSON.stringify(this.lastSettings);
        this.el.convertButton.disabled = !changed;
        this.el.convertButton.classList.toggle('needs-reconvert', changed);
    }

    _captureSettings() {
        return {
            fps: parseInt(this.el.fpsSelect.value),
            sizePercent: parseFloat(this.el.sizeSelect.value),
            startTime: parseFloat(this.el.startTime.value),
            endTime: parseFloat(this.el.endTime.value),
            dither: this.el.ditherSelect.value,
            speed: parseFloat(this.el.speedSelect.value),
            showTimecode: this.el.showTimecode.checked,
            crop: this.crop.enabled ? { ...this.crop.region } : null,
        };
    }

    _startConversion() {
        const s = this._captureSettings();
        this.lastSettings = s;
        this.cancelFlag = false;
        this.startedAt = performance.now();

        this.el.convertButton.disabled = true;
        this.el.convertButton.classList.remove('needs-reconvert');
        this.el.progressOverlay.hidden = false;
        this._setProgress(0, 'Starting…', 'Building frame list');

        this._runConversion(s).catch(err => {
            if (!this.cancelFlag) console.error('Conversion error:', err);
            this._endConversion(false);
        });
    }

    async _runConversion(s) {
        const video = this.el.videoPreview;

        let srcX, srcY, srcW, srcH, outW, outH;
        if (s.crop) {
            const vw = video.videoWidth, vh = video.videoHeight;
            srcX = Math.round(s.crop.x * vw); srcY = Math.round(s.crop.y * vh);
            srcW = Math.round(s.crop.w * vw); srcH = Math.round(s.crop.h * vh);
            outW = Math.max(2, Math.round(srcW * s.sizePercent));
            outH = Math.max(2, Math.round(srcH * s.sizePercent));
        } else {
            srcX = 0; srcY = 0;
            srcW = video.videoWidth; srcH = video.videoHeight;
            outW = Math.max(2, Math.round(srcW * s.sizePercent));
            outH = Math.max(2, Math.round(srcH * s.sizePercent));
        }

        const frameInterval = 1000 / s.fps;
        const sourceStep = frameInterval * s.speed;
        const startMs = s.startTime * 1000;
        const endMs = s.endTime * 1000;
        const timestamps = [];
        for (let t = startMs; t < endMs - sourceStep * 0.01; t += sourceStep) timestamps.push(t / 1000);
        if (timestamps.length === 0) timestamps.push(s.startTime);
        const total = timestamps.length;

        const canvas = document.createElement('canvas');
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        const gif = new GIF({
            workers: this.workerCount,
            quality: 50,
            width: outW,
            height: outH,
            dither: s.dither === 'false' ? false : s.dither,
            workerScript: this._workerBlobUrl(),
        });

        for (let i = 0; i < total; i++) {
            if (this.cancelFlag) { gif.abort(); this._endConversion(false); return; }

            await this._seekAndCapture(video, timestamps[i], ctx, srcX, srcY, srcW, srcH, outW, outH, s);
            gif.addFrame(ctx, { copy: true, delay: frameInterval });

            const pct = ((i + 1) / total) * 100;
            this._setProgress(pct * 0.75, `Capturing frame ${i + 1} / ${total}`, `${outW}×${outH}px · ${Math.round(pct)}% captured`);
        }

        if (this.cancelFlag) { gif.abort(); this._endConversion(false); return; }

        this._setProgress(75, 'Rendering…', 'gif.js workers encoding');

        await new Promise((resolve, reject) => {
            gif.on('progress', p => {
                if (this.cancelFlag) { gif.abort(); reject(new Error('cancelled')); return; }
                this._setProgress(75 + p * 25, `Rendering… ${Math.round(p * 100)}%`, 'Quantising palettes & compressing');
            });
            gif.on('finished', blob => { this.currentBlob = blob; resolve(); });
            gif.on('abort', () => reject(new Error('cancelled')));
            gif.on('error', err => reject(err));
            try { gif.render(); } catch (err) { reject(err); }
        });

        const elapsed = ((performance.now() - this.startedAt) / 1000).toFixed(2);
        this._setProgress(100, 'Done!', '');
        this._showResult(outW, outH, s, elapsed);
        this._endConversion(true);
    }

    _seekAndCapture(video, t, ctx, srcX, srcY, srcW, srcH, outW, outH, s) {
        return new Promise((resolve, reject) => {
            const onSeeked = () => {
                video.removeEventListener('seeked', onSeeked);
                try {
                    ctx.clearRect(0, 0, outW, outH);
                    ctx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, outW, outH);
                    if (s.showTimecode) {
                        const relT = t - s.startTime;
                        this._drawTimecode(ctx, Math.max(0, relT), outW, outH);
                    }
                    resolve();
                } catch (err) { reject(err); }
            };
            video.addEventListener('seeked', onSeeked);
            video.currentTime = t;
        });
    }

    _endConversion(success) {
        this.el.progressOverlay.hidden = true;
        if (!success) {
            this.el.convertButton.disabled = false;
            this.el.progressStatus.style.color = '';
        }
    }

    _showResult(outW, outH, s, elapsed) {
        const url = URL.createObjectURL(this.currentBlob);
        this.el.previewGif.onload = () => {
            this.el.previewGif.style.display = 'block';
            const kb = this.currentBlob.size / 1024;
            const size = kb >= 1024 ? `${(kb / 1024).toFixed(2)} MB` : `${kb.toFixed(2)} KB`;
            const dur = ((s.endTime - s.startTime) / s.speed).toFixed(1);
            this.el.sizeIndicator.innerHTML =
                `<span style="color:var(--accent2)">${outW}×${outH}px</span>` +
                ` &nbsp;·&nbsp; <span style="color:var(--orange)">${size}</span>` +
                ` &nbsp;·&nbsp; <span>${dur}s @ ${s.fps}fps</span>` +
                ` &nbsp;·&nbsp; <span style="color:var(--accent)">⏱ ${elapsed}s</span>`;
            this.el.sizeIndicator.hidden = false;
        };
        this.el.previewGif.src = url;
        this.el.downloadButton.hidden = false;
    }

    _setProgress(pct, status, details) {
        this.el.progressFill.style.width = `${clamp(pct, 0, 100)}%`;
        this.el.progressStatus.textContent = status;
        this.el.progressDetails.textContent = details;
        const bar = this.el.progressFill.parentElement;
        if (bar) bar.setAttribute('aria-valuenow', Math.round(pct));
    }

    _downloadGif() {
        if (!this.currentBlob) return;
        const video = this.el.videoPreview;
        if (!video.src || !video.videoWidth) return;

        let srcW, srcH;
        if (this.crop && this.crop.enabled) {
            const px = this.crop.pixelRegion;
            srcW = px.w; srcH = px.h;
        } else {
            srcW = video.videoWidth;
            srcH = video.videoHeight;
        }

        const sizePercent = parseFloat(this.el.sizeSelect.value);
        const outW = Math.max(2, Math.round(srcW * sizePercent));
        const outH = Math.max(2, Math.round(srcH * sizePercent));
        const fps = parseInt(this.el.fpsSelect.value);
        const speed = parseFloat(this.el.speedSelect.value);

        const a = document.createElement('a');
        a.href = URL.createObjectURL(this.currentBlob);
        a.download = `${this.originalName || 'gif-nyanpasu-output'}--${sizePercent * 100}%-(${outW}x${outH})-${fps}fps-${speed}x.gif`;
        a.click();
    }

    _drawTimecode(ctx, t, w, h) {
        const mins = Math.floor(t / 60);
        const secs = t % 60;
        const ts = `${String(mins).padStart(2, '0')}:${secs.toFixed(2).padStart(5, '0')}`;
        const fs = Math.max(13, Math.round(h * 0.062));
        ctx.font = `bold ${fs}px 'JetBrains Mono', monospace`;
        const m = ctx.measureText(ts);
        const pad = Math.max(7, fs * 0.42);
        const bx = w - m.width - pad * 1.6;
        const by = h - fs - pad * 1.2;
        const bw = m.width + pad;
        const bh = fs + pad * 0.7;
        const r = Math.min(5, bh / 3);

        ctx.fillStyle = 'rgba(0,0,0,0.72)';
        ctx.beginPath();
        ctx.moveTo(bx + r, by);
        ctx.lineTo(bx + bw - r, by);
        ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
        ctx.lineTo(bx + bw, by + bh - r);
        ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
        ctx.lineTo(bx + r, by + bh);
        ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
        ctx.lineTo(bx, by + r);
        ctx.quadraticCurveTo(bx, by, bx + r, by);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.fillText(ts, bx + pad / 2, by + fs * 0.88 + pad * 0.35);
    }

    _initTimecodePreview() {
        const video = this.el.videoPreview;
        const canvas = this.el.timecodePreviewer;

        const resize = () => {
            if (!video.videoWidth) return;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            canvas.style.width = `${video.offsetWidth}px`;
            canvas.style.height = `${video.offsetHeight}px`;
        };

        video.addEventListener('loadedmetadata', resize);
        new ResizeObserver(resize).observe(video);

        const tick = () => {
            requestAnimationFrame(tick);
            if (!this.el.showTimecode.checked || !video.src || !video.videoWidth) return;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const st = parseFloat(this.el.startTime.value) || 0;
            this._drawTimecode(ctx, Math.max(0, video.currentTime - st), canvas.width, canvas.height);
        };
        tick();
    }

    _initPreviewOverlay() {
        // Open on double-click; each open creates a fresh object URL for the overlay.
        this.el.previewGif.addEventListener('dblclick', () => {
            if (!this.currentBlob) return;
            this.el.overlayGif.src = URL.createObjectURL(this.currentBlob);
            this.el.previewOverlay.hidden = false;
            document.body.style.overflow = 'hidden';
        });
        // Close: revoke the overlay-specific URL, leave the gif src alone.
        this.el.previewOverlay.addEventListener('click', () => {
            this.el.previewOverlay.hidden = true;
            document.body.style.overflow = '';
            URL.revokeObjectURL(this.el.overlayGif.src);
            this.el.overlayGif.src = '';
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && !this.el.previewOverlay.hidden)
                this.el.previewOverlay.click();
        });
    }

    _initExpandButtons() {
        document.querySelectorAll('.expand-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const panel = btn.closest('.panel');
                const isFs = panel.classList.contains('is-fullscreen');
                panel.classList.toggle('is-fullscreen', !isFs);
                btn.querySelector('svg').innerHTML = isFs
                    ? '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>'
                    : '<polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line>';
                document.querySelectorAll('.panel').forEach(p => {
                    if (p !== panel) p.classList.toggle('is-hidden', !isFs);
                });
                window.dispatchEvent(new Event('resize'));
            });
        });
    }

    /** Create / return a cached Blob URL for the embedded gif.js worker source. */
    _workerBlobUrl() {
        if (this._cachedWorkerUrl) return this._cachedWorkerUrl;
        if (typeof GIF_WORKER_SOURCE !== 'undefined') {
            const blob = new Blob([GIF_WORKER_SOURCE], { type: 'application/javascript' });
            this._cachedWorkerUrl = URL.createObjectURL(blob);
            return this._cachedWorkerUrl;
        }
        return 'gif.worker.js'; // fallback for local server
    }
}


/* ═══════════════════════════════════════════════════════════════════
   BOOTSTRAP
   ═══════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
    const app = new GifConverter();
    app._initSubControllers();
});
