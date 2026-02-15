/**
 * Tree Growth — Orchestrator
 *
 * Manages the tree growth section: tab switching, shared canvas with pan/zoom,
 * and delegates rendering to the active growth mode module (CLASSIC, TREE, LIFE).
 *
 * Pulls base data (grid + root nodes) from TreePreview.getOutput() and passes
 * it to the active growth mode's render function.
 *
 * Loaded AFTER treeGrowthClassic.js and treeGrowthTree.js so they can self-register.
 *
 * Depends on: treePreview.js (TreePreview.getOutput)
 * Mode modules register via: TreeGrowth.registerMode(name, module)
 */

var TreeGrowth = {

    // State
    activeMode: 'classic',
    modes: {},
    _initialized: false,
    _visible: false,

    // Shared button state
    _builderReady: false,
    _hasSpells: false,
    _treeBuilt: false,
    _nodeCount: 0,
    _totalPool: 0,

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
    _rafRunning: false,
    _idleFrames: 0,
    _resizeObserver: null,
    _resizeTimeout: null,

    // =========================================================================
    // MODE REGISTRATION
    // =========================================================================

    registerMode: function(name, module) {
        this.modes[name] = module;
        console.log('[TreeGrowth] Registered mode: ' + name);

        // If already initialized, dynamically add the tab
        if (this._initialized) {
            this._addTab(name, module);
        }
    },

    /** Placeholder for modes that are coming soon (shown as disabled tab). */
    registerPlaceholder: function(name) {
        this._placeholders = this._placeholders || [];
        this._placeholders.push(name);
    },

    // =========================================================================
    // INITIALIZATION
    // =========================================================================

    init: function() {
        if (this._initialized) return;

        var container = document.getElementById('treeGrowthSection');
        if (!container) {
            console.warn('[TreeGrowth] #treeGrowthSection not found');
            return;
        }

        // Inject HTML structure
        container.innerHTML = this._buildHTML();
        container.style.display = 'none';

        // Set up tab click handlers (scoped to this section)
        var self = this;
        var tabs = container.querySelectorAll('.tree-growth-tab:not(.disabled)');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].addEventListener('click', function() {
                var mode = this.getAttribute('data-mode');
                if (mode) self.switchMode(mode);
            });
        }

        // Wire shared buttons
        this._bindSharedButtons();

        // Set up canvas
        this._setupCanvas();

        // Load initial mode settings
        this._loadModeSettings(this.activeMode);

        this._initialized = true;
        console.log('[TreeGrowth] Initialized');
    },

    _buildHTML: function() {
        // Build tabs dynamically from registered modes
        var tabsHTML = '';
        var modeNames = [];
        for (var name in this.modes) {
            if (this.modes.hasOwnProperty(name)) modeNames.push(name);
        }
        for (var i = 0; i < modeNames.length; i++) {
            var m = modeNames[i];
            var isActive = m === this.activeMode ? ' active' : '';
            var label = this.modes[m].tabLabel || m.toUpperCase();
            tabsHTML += '<button class="tree-growth-tab' + isActive + '" data-mode="' + m + '">' + label + '</button>';
        }
        // Placeholder tabs (coming soon)
        var ph = this._placeholders || [];
        for (var p = 0; p < ph.length; p++) {
            tabsHTML += '<button class="tree-growth-tab disabled" data-mode="' + ph[p] + '" disabled>' + ph[p].toUpperCase() + '</button>';
        }

        return '' +
            '<div class="tree-preview-header">' +
                '<span class="tree-preview-title">' + t('treeViewer.treeGrowthPreview') + '</span>' +
            '</div>' +
            '<div class="tree-preview-tabs" id="treeGrowthTabs">' +
                tabsHTML +
            '</div>' +
            // Shared action buttons now live in index.html scan-actions-bottom
            '<div class="tree-preview-split" style="height:800px;">' +
                '<div class="tree-preview-left" id="treeGrowthSettings">' +
                    '<!-- Settings injected by active growth mode module -->' +
                '</div>' +
                '<div class="tree-preview-right" id="treeGrowthCanvasWrap">' +
                    '<!-- Canvas created dynamically -->' +
                '</div>' +
            '</div>';
    },

    /** Add a tab button for a mode registered after init. */
    _addTab: function(name, module) {
        var tabsEl = document.getElementById('treeGrowthTabs');
        if (!tabsEl) return;

        var label = module.tabLabel || name.toUpperCase();
        var btn = document.createElement('button');
        btn.className = 'tree-growth-tab';
        btn.setAttribute('data-mode', name);
        btn.textContent = label;

        var self = this;
        btn.addEventListener('click', function() {
            self.switchMode(name);
        });

        // Insert before placeholder tabs
        var placeholders = tabsEl.querySelectorAll('.tree-growth-tab.disabled');
        if (placeholders.length > 0) {
            tabsEl.insertBefore(btn, placeholders[0]);
        } else {
            tabsEl.appendChild(btn);
        }
    },

    // =========================================================================
    // SHOW / HIDE
    // =========================================================================

    show: function() {
        console.log('[TreeGrowth] show() called');
        this.init();

        var container = document.getElementById('treeGrowthSection');
        if (container) container.style.display = '';

        this._visible = true;
        this._updateCanvasSize();
        this._startRenderLoop();
        this._markDirty();
    },

    hide: function() {
        var container = document.getElementById('treeGrowthSection');
        if (container) container.style.display = 'none';

        this._visible = false;
        this._stopRenderLoop();
    },

    // =========================================================================
    // TAB SWITCHING
    // =========================================================================

    switchMode: function(mode) {
        if (!this.modes[mode]) {
            console.warn('[TreeGrowth] Unknown mode: ' + mode);
            return;
        }

        this.activeMode = mode;

        // Update tab active states (scoped to this section)
        var container = document.getElementById('treeGrowthSection');
        if (container) {
            var tabs = container.querySelectorAll('.tree-growth-tab');
            for (var i = 0; i < tabs.length; i++) {
                var tabMode = tabs[i].getAttribute('data-mode');
                tabs[i].classList.toggle('active', tabMode === mode);
            }
        }

        // Load the mode's settings panel
        this._loadModeSettings(mode);

        this._markDirty();
    },

    _loadModeSettings: function(mode) {
        var settingsEl = document.getElementById('treeGrowthSettings');
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
        var wrap = document.getElementById('treeGrowthCanvasWrap');
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
        var wrap = document.getElementById('treeGrowthCanvasWrap');
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
        this._markDirty();
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
                    self._markDirty();
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

            self._markDirty();
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
        this._idleFrames = 0;
        // Restart the RAF loop if it has stopped due to idling
        if (!this._rafRunning) {
            this._startRenderLoop();
        }
    },

    getSpellData: function() {
        return (typeof state !== 'undefined' && state.lastSpellData) ? state.lastSpellData : null;
    },

    _startRenderLoop: function() {
        if (this._rafRunning) return;

        this._rafRunning = true;
        this._idleFrames = 0;
        var self = this;
        function loop() {
            if (self._needsRender) {
                self._idleFrames = 0;
                self._needsRender = false;
                self._render();
            } else {
                self._idleFrames++;
                if (self._idleFrames >= 60) {
                    self._rafRunning = false;
                    self._rafId = null;
                    return; // Stop loop after ~1s of idle
                }
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
        this._rafRunning = false;
        this._idleFrames = 0;
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

        // Get base data from Root Base section
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

        // Delegate to active growth mode renderer
        var modeModule = this.modes[this.activeMode];
        if (modeModule && typeof modeModule.render === 'function') {
            modeModule.render(ctx, w, h, baseData);
        }

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

    // =========================================================================
    // SHARED BUTTON BINDING
    // =========================================================================

    _bindSharedButtons: function() {
        var self = this;
        var buildBtn = document.getElementById('tgBuildBtn');
        var applyBtn = document.getElementById('tgApplyBtn');
        var clearBtn = document.getElementById('tgClearBtn');

        if (buildBtn) buildBtn.addEventListener('click', function() {
            var mod = self.modes[self.activeMode];
            if (mod && mod.buildTree) mod.buildTree();
        });
        if (applyBtn) applyBtn.addEventListener('click', function() {
            var mod = self.modes[self.activeMode];
            if (mod && mod.applyTree) mod.applyTree();
        });
        if (clearBtn) clearBtn.addEventListener('click', function() {
            var mod = self.modes[self.activeMode];
            if (mod && mod.clearTree) mod.clearTree();
        });
        // (Native C++ builder — no setup button needed)
    },

    // =========================================================================
    // SHARED STATE METHODS
    // =========================================================================

    setTreeBuilt: function(built, nodeCount, totalPool) {
        var wasBuilt = this._treeBuilt;
        this._treeBuilt = built;
        this._nodeCount = nodeCount || 0;
        this._totalPool = totalPool || 0;

        var applyBtn = document.getElementById('tgApplyBtn');
        var clearBtn = document.getElementById('tgClearBtn');

        if (built) {
            if (applyBtn) applyBtn.disabled = false;
            if (clearBtn) clearBtn.disabled = false;

            var label = t('treeGrowth.treeBuilt');
            if (this._nodeCount > 0) {
                label += ' \u2014 ' + t('treeGrowth.nodesPlaced', {placed: this._nodeCount, total: this._totalPool || this._nodeCount});
            }
            this.setStatusText(label, '#22c55e');

            // Force the main tree growth preview canvas to re-render
            this._markDirty();

            // Only auto-run PRM on FIRST build (not on layout recalculations)
            if (!wasBuilt) {
                if (typeof PreReqMaster !== 'undefined' && PreReqMaster.isEnabled && PreReqMaster.isEnabled()) {
                    setTimeout(function() {
                        PreReqMaster.autoApplyLocks();
                    }, 100); // Small delay to let tree data settle
                } else {
                    // No PRM → advance build progress to finalize and complete
                    if (typeof BuildProgress !== 'undefined' && BuildProgress.isActive()) {
                        BuildProgress.setStage('finalize');
                        setTimeout(function() {
                            BuildProgress.complete();
                        }, 300);
                    }
                }
            }

            // Update PRM preview canvas (may be in Easy mode)
            if (typeof PreReqMaster !== 'undefined' && PreReqMaster.renderPreview) {
                setTimeout(function() { PreReqMaster.renderPreview(); }, 200);
            }

            // Capture + play tree build animation on PRM preview
            // Uses requestCapture() which retries if _builtPlacements isn't ready yet
            if (typeof TreeAnimation !== 'undefined') {
                TreeAnimation.requestCapture();
            }

            // Show Replay button on Easy mode
            var replayBtn = document.getElementById('easyReplayBtn');
            if (replayBtn) replayBtn.style.display = '';
        } else {
            if (applyBtn) applyBtn.disabled = true;
            if (clearBtn) clearBtn.disabled = true;
            this.updateBuildButton();

            // Stop animation and hide Replay button
            if (typeof TreeAnimation !== 'undefined') {
                TreeAnimation.stop();
            }
            var replayBtn = document.getElementById('easyReplayBtn');
            if (replayBtn) replayBtn.style.display = 'none';
        }
    },

    setStatusText: function(text, color) {
        var el = document.getElementById('tgStatus');
        if (!el) return;
        el.textContent = text;
        if (color) el.style.color = color;
    },

    updateBuildButton: function() {
        var buildBtn = document.getElementById('tgBuildBtn');
        if (!buildBtn) return;
        if (this._hasSpells && !this._treeBuilt) {
            buildBtn.disabled = false;
        } else {
            buildBtn.disabled = true;
        }
    },

    /** Called by onPythonAddonStatus — native C++ builder is always ready. */
    updateBuilderReady: function() {
        this._builderReady = true;
        this.setStatusText(t('treeGrowth.builderReady') || 'Builder ready', '#22c55e');
        this.updateBuildButton();
    },

    updateScanStatus: function(hasSpells) {
        this._hasSpells = hasSpells;
        this.updateBuildButton();
    }
};

// Now register any mode modules that loaded before us
if (typeof TreeGrowthClassic !== 'undefined') {
    TreeGrowth.registerMode('classic', TreeGrowthClassic);
}
if (typeof TreeGrowthTree !== 'undefined') {
    TreeGrowth.registerMode('tree', TreeGrowthTree);
}

// Graph Growth mode
if (typeof TreeGrowthGraph !== 'undefined') {
    TreeGrowth.registerMode('graph', TreeGrowthGraph);
}
// Oracle Growth mode
if (typeof TreeGrowthOracle !== 'undefined') {
    TreeGrowth.registerMode('oracle', TreeGrowthOracle);
}
// Thematic Growth mode
if (typeof TreeGrowthThematic !== 'undefined') {
    TreeGrowth.registerMode('thematic', TreeGrowthThematic);
}
