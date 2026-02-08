/**
 * TreeCore Module — Core Settings panel for globe position/size
 *
 * Sits between Root Base and Tree Growth. Renders the Root Base grid
 * with a globe overlay so the user can visually configure the hub's
 * position and radius before building the tree.
 *
 * Depends on: treePreview.js (TreePreview), treePreviewUtils.js (TreePreviewUtils),
 *             state.js (state)
 */

var TreeCore = {

    // =========================================================================
    // STATE
    // =========================================================================

    _initialized: false,
    _visible: false,
    canvas: null,
    ctx: null,

    // Pan & zoom
    panX: 0,
    panY: 0,
    zoom: 1,
    _isPanning: false,
    _panStartX: 0,
    _panStartY: 0,
    _pendingPanX: 0,
    _pendingPanY: 0,
    _panRafPending: false,

    // Canvas size
    _width: 400,
    _height: 400,

    // Render loop
    _needsRender: false,
    _rafId: null,

    // Globe settings (local copy, synced to state.treeData.globe)
    globeX: 0,
    globeY: 0,
    globeRadius: 45,

    // =========================================================================
    // INITIALIZATION
    // =========================================================================

    init: function() {
        if (this._initialized) return;

        var container = document.getElementById('treeCoreSection');
        if (!container) {
            console.warn('[TreeCore] #treeCoreSection not found');
            return;
        }

        container.innerHTML = this._buildHTML();
        container.style.display = 'none';

        this._setupCanvas();
        this._bindSettings();

        this._initialized = true;
        console.log('[TreeCore] Initialized');
    },

    _buildHTML: function() {
        var H = TreePreviewUtils.settingHTML;

        var settingsHTML =
            '<div class="tree-preview-settings-title">Globe Position</div>' +
            '<div class="tree-preview-settings-grid">' +
                H('H Offset', 'tcGlobeHOffset', -500, 500, 5, this.globeX) +
                H('V Offset', 'tcGlobeVOffset', -500, 500, 5, this.globeY) +
                H('Radius', 'tcGlobeRadius', 10, 200, 5, this.globeRadius) +
            '</div>';

        return '' +
            '<div class="tree-preview-header">' +
                '<span class="tree-preview-title">Core Settings</span>' +
            '</div>' +
            '<div class="tree-preview-split">' +
                '<div class="tree-preview-left" id="treeCoreSettings">' +
                    settingsHTML +
                '</div>' +
                '<div class="tree-preview-right" id="treeCoreCanvasWrap">' +
                    '<!-- Canvas created dynamically -->' +
                '</div>' +
            '</div>';
    },

    // =========================================================================
    // SHOW / HIDE
    // =========================================================================

    show: function() {
        console.log('[TreeCore] show() called');
        this.init();

        // CORE panel keeps its own values — does NOT read from the loaded tree.
        // Values only flow to state.treeData when "Apply Tree" is clicked.
        this._updateSliders();

        var container = document.getElementById('treeCoreSection');
        if (container) container.style.display = '';

        this._visible = true;
        this._updateCanvasSize();
        this._startRenderLoop();
        this._markDirty();
    },

    hide: function() {
        var container = document.getElementById('treeCoreSection');
        if (container) container.style.display = 'none';

        this._visible = false;
        this._stopRenderLoop();
    },

    // =========================================================================
    // SETTINGS BINDING
    // =========================================================================

    _bindSettings: function() {
        var self = this;

        TreePreviewUtils.bindInput('tcGlobeHOffset', function(v) {
            self.globeX = v;
            self._markDirty();
        });

        TreePreviewUtils.bindInput('tcGlobeVOffset', function(v) {
            self.globeY = v;
            self._markDirty();
        });

        TreePreviewUtils.bindInput('tcGlobeRadius', function(v) {
            self.globeRadius = v;
            self._markDirty();
        });
    },

    /** Update slider DOM values from internal state (e.g. after loading tree). */
    _updateSliders: function() {
        var hField = document.getElementById('tcGlobeHOffset');
        var vField = document.getElementById('tcGlobeVOffset');
        var rField = document.getElementById('tcGlobeRadius');
        if (hField) hField.value = this.globeX;
        if (vField) vField.value = this.globeY;
        if (rField) rField.value = this.globeRadius;
    },

    /** Return current globe settings for downstream consumers (applyTree). */
    getOutput: function() {
        return { x: this.globeX, y: this.globeY, radius: this.globeRadius };
    },

    // =========================================================================
    // CANVAS SETUP
    // =========================================================================

    _setupCanvas: function() {
        var wrap = document.getElementById('treeCoreCanvasWrap');
        if (!wrap) return;

        this.canvas = document.createElement('canvas');
        this.canvas.className = 'tree-preview-canvas';
        this.ctx = this.canvas.getContext('2d');
        wrap.appendChild(this.canvas);

        this._setupEvents();

        var self = this;
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObserver = new ResizeObserver(function() {
                if (self._resizeTimeout) clearTimeout(self._resizeTimeout);
                self._resizeTimeout = setTimeout(function() {
                    self._updateCanvasSize();
                }, 50);
            });
            this._resizeObserver.observe(wrap);
        }
    },

    _updateCanvasSize: function() {
        var wrap = document.getElementById('treeCoreCanvasWrap');
        if (!wrap || !this.canvas) return;

        var rect = wrap.getBoundingClientRect();
        var width = rect.width || 400;
        var height = rect.height || 400;
        var dpr = window.devicePixelRatio || 1;

        this.canvas.width = width * dpr;
        this.canvas.height = height * dpr;
        this.canvas.style.width = width + 'px';
        this.canvas.style.height = height + 'px';

        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.scale(dpr, dpr);

        this._width = width;
        this._height = height;
        this._needsRender = true;
    },

    // =========================================================================
    // EVENTS — PAN & ZOOM (same pattern as TreePreview)
    // =========================================================================

    _setupEvents: function() {
        var self = this;
        var canvas = this.canvas;

        canvas.addEventListener('mousedown', function(e) {
            if (e.button === 0 || e.button === 2) {
                self._isPanning = true;
                self._panStartX = e.clientX - self.panX;
                self._panStartY = e.clientY - self.panY;
                canvas.style.cursor = 'grabbing';
            }
        });

        canvas.addEventListener('mousemove', function(e) {
            if (!self._isPanning) return;

            self._pendingPanX = e.clientX - self._panStartX;
            self._pendingPanY = e.clientY - self._panStartY;

            if (!self._panRafPending) {
                self._panRafPending = true;
                requestAnimationFrame(function() {
                    self._panRafPending = false;
                    self.panX = self._pendingPanX;
                    self.panY = self._pendingPanY;
                    self._needsRender = true;
                });
            }
        });

        document.addEventListener('mouseup', function() {
            if (self._isPanning) {
                self._isPanning = false;
                if (self.canvas) self.canvas.style.cursor = 'grab';
            }
        });

        canvas.addEventListener('wheel', function(e) {
            e.preventDefault();
            var delta = e.deltaY > 0 ? 0.9 : 1.1;
            var newZoom = self.zoom * delta;
            newZoom = Math.max(0.1, Math.min(10, newZoom));

            // Zoom toward mouse position
            var rect = canvas.getBoundingClientRect();
            var mx = e.clientX - rect.left;
            var my = e.clientY - rect.top;

            var factor = newZoom / self.zoom;
            self.panX = mx - factor * (mx - self.panX);
            self.panY = my - factor * (my - self.panY);
            self.zoom = newZoom;

            self._needsRender = true;
        }, { passive: false });

        canvas.addEventListener('contextmenu', function(e) {
            e.preventDefault();
        });

        canvas.style.cursor = 'grab';
    },

    // =========================================================================
    // RENDER LOOP
    // =========================================================================

    _markDirty: function() {
        this._needsRender = true;
    },

    _startRenderLoop: function() {
        if (this._rafId) return;

        var self = this;
        function loop() {
            if (self._needsRender) {
                self._needsRender = false;
                self._render();
            }
            self._rafId = requestAnimationFrame(loop);
        }
        loop();
    },

    _stopRenderLoop: function() {
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
    },

    _render: function() {
        if (!this.ctx || !this.canvas) return;

        var ctx = this.ctx;
        var w = this._width || 400;
        var h = this._height || 400;
        var dpr = window.devicePixelRatio || 1;

        // Full reset
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1.0;

        // Clear
        ctx.fillStyle = '#0a0a0f';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Scale for DPR
        ctx.scale(dpr, dpr);

        // Get Root Base output
        var baseData = null;
        if (typeof TreePreview !== 'undefined' && TreePreview.getOutput) {
            baseData = TreePreview.getOutput();
        }

        // Compute auto-fit scale from Root Base content extent
        var fitScale = this._computeFitScale(baseData, w, h);

        // Apply pan and zoom transforms with auto-fit
        ctx.save();
        ctx.translate(w / 2 + this.panX, h / 2 + this.panY);
        ctx.scale(this.zoom * fitScale, this.zoom * fitScale);
        ctx.translate(-w / 2, -h / 2);

        // Draw Root Base grid underneath
        if (baseData && baseData.renderGrid) {
            ctx.globalAlpha = 0.5;
            baseData.renderGrid(ctx, w, h);
            ctx.globalAlpha = 1.0;
        }

        // Draw globe overlay at configured position
        this._renderGlobeOverlay(ctx, w, h);

        ctx.restore();

        // Draw zoom level indicator
        ctx.font = '10px sans-serif';
        ctx.fillStyle = 'rgba(184, 168, 120, 0.4)';
        ctx.textAlign = 'right';
        ctx.fillText(Math.round(this.zoom * 100) + '%', w - 8, h - 8);
    },

    /** Compute a scale factor that fits root content within the canvas. */
    _computeFitScale: function(baseData, w, h) {
        if (!baseData || !baseData.rootNodes || baseData.rootNodes.length === 0) return 1;

        var contentRadius = 0;
        for (var i = 0; i < baseData.rootNodes.length; i++) {
            var n = baseData.rootNodes[i];
            var d = Math.sqrt(n.x * n.x + n.y * n.y);
            if (d > contentRadius) contentRadius = d;
        }

        if (contentRadius <= 0) return 1;

        // Add padding for node decorations (arrows, labels, glow)
        contentRadius += 45;
        var availableRadius = Math.min(w, h) / 2 - 10;
        return Math.min(1, availableRadius / contentRadius);
    },

    /** Draw the globe preview circle at the configured offset. */
    _renderGlobeOverlay: function(ctx, w, h) {
        var cx = w / 2 + this.globeX;
        var cy = h / 2 + this.globeY;
        var r = this.globeRadius;

        // Dashed crosshair through globe center
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(184, 168, 120, 0.25)';
        ctx.lineWidth = 1;

        // Horizontal line
        ctx.beginPath();
        ctx.moveTo(cx - r - 20, cy);
        ctx.lineTo(cx + r + 20, cy);
        ctx.stroke();

        // Vertical line
        ctx.beginPath();
        ctx.moveTo(cx, cy - r - 20);
        ctx.lineTo(cx, cy + r + 20);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.restore();

        // Outer glow ring
        ctx.beginPath();
        ctx.arc(cx, cy, r + 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(184, 168, 120, 0.15)';
        ctx.fill();

        // Background circle
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.fill();

        // Inner decorative ring
        ctx.beginPath();
        ctx.arc(cx, cy, r - 5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(184, 168, 120, 0.3)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Border ring
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = '#b8a878';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Text label
        ctx.fillStyle = '#b8a878';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('HoM', cx, cy);

        // Offset label below globe
        ctx.font = '9px sans-serif';
        ctx.fillStyle = 'rgba(184, 168, 120, 0.5)';
        ctx.fillText(this.globeX + ', ' + this.globeY, cx, cy + r + 16);
    }
};

console.log('[TreeCore] Loaded');
