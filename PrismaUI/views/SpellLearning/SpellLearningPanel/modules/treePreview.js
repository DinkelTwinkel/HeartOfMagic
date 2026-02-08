/**
 * Tree Preview — Orchestrator
 *
 * Manages the tree preview section: tab switching, shared canvas with pan/zoom,
 * and delegates rendering to the active mode module (SUN or FLAT).
 *
 * Loaded AFTER treePreviewSun.js and treePreviewFlat.js so they can self-register.
 *
 * Depends on: state.js (state, settings)
 * Mode modules register via: TreePreview.registerMode(name, module)
 */

var TreePreview = {

    // State
    activeMode: 'sun',
    modes: {},
    schoolData: null,
    _initialized: false,
    _visible: false,

    // Canvas
    canvas: null,
    ctx: null,
    _width: 0,
    _height: 0,

    // Transform
    zoom: 1,
    panX: 0,
    panY: 0,
    _isPanning: false,
    _panStartX: 0,
    _panStartY: 0,
    _pendingPanX: 0,
    _pendingPanY: 0,
    _panRafPending: false,

    // Render loop
    _needsRender: false,
    _rafId: null,
    _resizeObserver: null,
    _resizeTimeout: null,

    // =========================================================================
    // MODE REGISTRATION
    // =========================================================================

    registerMode: function(name, module) {
        this.modes[name] = module;
        console.log('[TreePreview] Registered mode: ' + name);
    },

    // =========================================================================
    // INITIALIZATION
    // =========================================================================

    init: function() {
        if (this._initialized) return;

        var container = document.getElementById('treeBuildSection');
        if (!container) {
            console.warn('[TreePreview] #treeBuildSection not found');
            return;
        }

        // Inject HTML structure
        container.innerHTML = this._buildHTML();
        container.style.display = 'none';

        // Set up tab click handlers
        var self = this;
        var tabs = container.querySelectorAll('.tree-preview-tab:not(.disabled)');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].addEventListener('click', function() {
                var mode = this.getAttribute('data-mode');
                if (mode) self.switchMode(mode);
            });
        }

        // Set up canvas
        this._setupCanvas();

        // Load initial mode settings
        this._loadModeSettings(this.activeMode);

        this._initialized = true;
        console.log('[TreePreview] Initialized');
    },

    _buildHTML: function() {
        return '' +
            '<div class="tree-preview-header">' +
                '<span class="tree-preview-title">Root Base Preview</span>' +
            '</div>' +
            '<div class="tree-preview-tabs">' +
                '<button class="tree-preview-tab active" data-mode="sun">SUN</button>' +
                '<button class="tree-preview-tab" data-mode="flat">FLAT</button>' +
                '<button class="tree-preview-tab disabled" data-mode="roguelike" disabled>ROGUELIKE</button>' +
            '</div>' +
            '<div class="tree-preview-split">' +
                '<div class="tree-preview-left" id="treePreviewSettings">' +
                    '<!-- Settings injected by active mode module -->' +
                '</div>' +
                '<div class="tree-preview-right" id="treePreviewCanvasWrap">' +
                    '<!-- Canvas created dynamically -->' +
                '</div>' +
            '</div>';
    },

    // =========================================================================
    // SHOW / HIDE
    // =========================================================================

    show: function(spellData) {
        console.log('[TreePreview] show() called, spells:', spellData && spellData.spells ? spellData.spells.length : 0);
        this.init();

        // Extract school counts from spell data
        var self = this;
        this.schoolData = {};
        if (spellData && spellData.spells) {
            spellData.spells.forEach(function(spell) {
                var school = spell.school || 'Unknown';
                self.schoolData[school] = (self.schoolData[school] || 0) + 1;
            });
        }
        console.log('[TreePreview] School data:', JSON.stringify(this.schoolData));

        var container = document.getElementById('treeBuildSection');
        if (container) container.style.display = '';

        this._visible = true;
        this._updateCanvasSize();
        this._startRenderLoop();
        this._markDirty();
    },

    hide: function() {
        var container = document.getElementById('treeBuildSection');
        if (container) container.style.display = 'none';

        this._visible = false;
        this._stopRenderLoop();
    },

    // =========================================================================
    // TAB SWITCHING
    // =========================================================================

    switchMode: function(mode) {
        if (!this.modes[mode]) {
            console.warn('[TreePreview] Unknown mode: ' + mode);
            return;
        }

        this.activeMode = mode;

        // Update tab active states
        var tabs = document.querySelectorAll('.tree-preview-tab');
        for (var i = 0; i < tabs.length; i++) {
            var tabMode = tabs[i].getAttribute('data-mode');
            tabs[i].classList.toggle('active', tabMode === mode);
        }

        // Load the mode's settings panel
        this._loadModeSettings(mode);

        this._markDirty();
    },

    _loadModeSettings: function(mode) {
        var settingsEl = document.getElementById('treePreviewSettings');
        if (!settingsEl) return;

        var modeModule = this.modes[mode];
        if (!modeModule) {
            settingsEl.innerHTML = '<div class="tree-preview-empty">No settings available</div>';
            return;
        }

        settingsEl.innerHTML = modeModule.buildSettingsHTML();
        modeModule.bindEvents();
    },

    // =========================================================================
    // CANVAS SETUP
    // =========================================================================

    _setupCanvas: function() {
        var wrap = document.getElementById('treePreviewCanvasWrap');
        if (!wrap) return;

        this.canvas = document.createElement('canvas');
        this.canvas.className = 'tree-preview-canvas';
        this.ctx = this.canvas.getContext('2d');
        wrap.appendChild(this.canvas);

        this._setupEvents();

        // ResizeObserver with debounce
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
        var wrap = document.getElementById('treePreviewCanvasWrap');
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
    // EVENTS — PAN & ZOOM
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
            var zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
            var newZoom = self.zoom * zoomFactor;
            newZoom = Math.max(0.1, Math.min(5, newZoom));

            var rect = canvas.getBoundingClientRect();
            var mouseX = e.clientX - rect.left - rect.width / 2;
            var mouseY = e.clientY - rect.top - rect.height / 2;

            self.panX = mouseX - (mouseX - self.panX) * (newZoom / self.zoom);
            self.panY = mouseY - (mouseY - self.panY) * (newZoom / self.zoom);
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
        // Also notify downstream sections that depend on our output
        if (typeof TreeCore !== 'undefined' && TreeCore._markDirty) {
            TreeCore._markDirty();
        }
        if (typeof TreeGrowth !== 'undefined' && TreeGrowth._markDirty) {
            TreeGrowth._markDirty();
        }
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

        // Compute auto-fit scale from last render's content extent
        var modeModule = this.modes[this.activeMode];
        var fitScale = this._computeFitScale(modeModule, w, h);

        // Apply pan and zoom transforms with auto-fit
        ctx.save();
        ctx.translate(w / 2 + this.panX, h / 2 + this.panY);
        ctx.scale(this.zoom * fitScale, this.zoom * fitScale);
        ctx.translate(-w / 2, -h / 2);

        // Delegate to active mode renderer
        if (modeModule && typeof modeModule.render === 'function') {
            modeModule.render(ctx, w, h, this.schoolData);
        }

        ctx.restore();

        // Draw zoom level indicator
        ctx.font = '10px sans-serif';
        ctx.fillStyle = 'rgba(184, 168, 120, 0.4)';
        ctx.textAlign = 'right';
        ctx.fillText(Math.round(this.zoom * 100) + '%', w - 8, h - 8);
    },

    /** Compute a scale factor that fits root content within the canvas. */
    _computeFitScale: function(modeModule, w, h) {
        if (!modeModule || !modeModule._lastRenderData) return 1;

        var ld = modeModule._lastRenderData;
        var contentRadius = 0;

        // Try rootNodes first (most accurate)
        if (ld.rootNodes && ld.rootNodes.length > 0) {
            for (var i = 0; i < ld.rootNodes.length; i++) {
                var n = ld.rootNodes[i];
                var d = Math.sqrt(n.x * n.x + n.y * n.y);
                if (d > contentRadius) contentRadius = d;
            }
        } else if (ld.ringRadius) {
            contentRadius = ld.ringRadius;
        }

        if (contentRadius <= 0) return 1;

        // Add padding for node decorations (arrows, labels, glow)
        contentRadius += 45;
        var availableRadius = Math.min(w, h) / 2 - 10;
        return Math.min(1, availableRadius / contentRadius);
    },

    // =========================================================================
    // DATA OUTPUT — Universal format for downstream sections
    // =========================================================================

    getOutput: function() {
        var modeModule = this.modes[this.activeMode];
        if (!modeModule) return null;
        var gridData = modeModule.getGridData ? modeModule.getGridData() : null;
        var lastData = modeModule._lastRenderData;
        if (!lastData) return null;

        var self = this;
        return {
            mode: gridData ? gridData.mode : self.activeMode,
            schools: gridData ? gridData.schools : [],
            rootNodes: lastData.rootNodes || [],
            grid: gridData ? gridData.grid : null,
            gridPoints: gridData ? (gridData.gridPoints || []) : [],
            schoolData: self.schoolData || {},
            renderGrid: function(ctx, w, h) {
                modeModule.render(ctx, w, h, self.schoolData);
            }
        };
    }
};

// Now register any mode modules that loaded before us
if (typeof TreePreviewSun !== 'undefined') {
    TreePreview.registerMode('sun', TreePreviewSun);
}
if (typeof TreePreviewFlat !== 'undefined') {
    TreePreview.registerMode('flat', TreePreviewFlat);
}
