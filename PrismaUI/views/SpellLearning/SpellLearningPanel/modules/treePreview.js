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
    _mouseDownX: 0,
    _mouseDownY: 0,

    // Root selection
    _rootSelectionSchool: null,
    _rootSelectionSpells: [],

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
        console.log('[TreePreview] Registered mode: ' + name);

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
            tabsHTML += '<button class="tree-preview-tab' + isActive + '" data-mode="' + m + '">' + label + '</button>';
        }
        // Placeholder tabs (coming soon)
        var ph = this._placeholders || [];
        for (var p = 0; p < ph.length; p++) {
            tabsHTML += '<button class="tree-preview-tab disabled" data-mode="' + ph[p] + '" disabled>' + ph[p].toUpperCase() + '</button>';
        }

        return '' +
            '<div class="tree-preview-header">' +
                '<span class="tree-preview-title">' + t('preview.title') + '</span>' +
            '</div>' +
            '<div class="tree-preview-tabs" id="treePreviewTabs">' +
                tabsHTML +
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

    /** Add a tab button for a mode registered after init. */
    _addTab: function(name, module) {
        var tabsEl = document.getElementById('treePreviewTabs');
        if (!tabsEl) return;

        var label = module.tabLabel || name.toUpperCase();
        var btn = document.createElement('button');
        btn.className = 'tree-preview-tab';
        btn.setAttribute('data-mode', name);
        btn.textContent = label;

        var self = this;
        btn.addEventListener('click', function() {
            self.switchMode(name);
        });

        // Insert before placeholder tabs
        var placeholders = tabsEl.querySelectorAll('.tree-preview-tab.disabled');
        if (placeholders.length > 0) {
            tabsEl.insertBefore(btn, placeholders[0]);
        } else {
            tabsEl.appendChild(btn);
        }
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
                self._mouseDownX = e.clientX;
                self._mouseDownY = e.clientY;
                canvas.style.cursor = 'grabbing';
            }
        });

        canvas.addEventListener('mousemove', function(e) {
            if (!self._isPanning) {
                // Hover cursor: pointer if over a root node, grab otherwise
                var hit = self._hitTestRootNode(e);
                canvas.style.cursor = hit ? 'pointer' : 'grab';
                return;
            }

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

        document.addEventListener('mouseup', function(e) {
            if (self._isPanning) {
                self._isPanning = false;

                // Click vs pan: if mouse moved < 5px, it's a click
                var dx = e.clientX - self._mouseDownX;
                var dy = e.clientY - self._mouseDownY;
                if (Math.sqrt(dx * dx + dy * dy) < 5) {
                    self._handleClick(e);
                }

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
        // Also notify downstream sections that depend on our output
        if (typeof TreeCore !== 'undefined' && TreeCore._markDirty) {
            TreeCore._markDirty();
        }
        if (typeof TreeGrowth !== 'undefined' && TreeGrowth._markDirty) {
            TreeGrowth._markDirty();
        }
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

        // Overlay: selected root indicators (inside transform context)
        this._renderSelectedRootOverlays(ctx, w, h, modeModule);

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
    // ROOT NODE CLICK DETECTION
    // =========================================================================

    /** Convert screen (CSS) coordinates to world coordinates in the preview canvas. */
    _screenToWorld: function(clientX, clientY) {
        if (!this.canvas) return null;
        var rect = this.canvas.getBoundingClientRect();
        var cssX = clientX - rect.left;
        var cssY = clientY - rect.top;
        var w = this._width || 400;
        var h = this._height || 400;
        var modeModule = this.modes[this.activeMode];
        var fitScale = this._computeFitScale(modeModule, w, h);
        var totalScale = this.zoom * fitScale;
        if (totalScale === 0) return null;
        // Invert the render transform: translate(w/2+panX, h/2+panY) → scale(totalScale) → translate(-w/2, -h/2)
        var worldX = (cssX - (w / 2 + this.panX)) / totalScale + w / 2;
        var worldY = (cssY - (h / 2 + this.panY)) / totalScale + h / 2;
        return { x: worldX, y: worldY };
    },

    /** Hit-test root nodes. Returns the rootNode object if hit, or null. */
    _hitTestRootNode: function(e) {
        var world = this._screenToWorld(e.clientX, e.clientY);
        if (!world) return null;
        var modeModule = this.modes[this.activeMode];
        if (!modeModule || !modeModule._lastRenderData) return null;
        var rootNodes = modeModule._lastRenderData.rootNodes;
        if (!rootNodes) return null;
        var w = this._width || 400;
        var h = this._height || 400;
        var hitRadius = 12; // pixels in world space
        for (var i = 0; i < rootNodes.length; i++) {
            var n = rootNodes[i];
            // rootNodes store x,y relative to center (0,0), rendering adds w/2, h/2
            var nx = n.x + w / 2;
            var ny = n.y + h / 2;
            var dx = world.x - nx;
            var dy = world.y - ny;
            if (Math.sqrt(dx * dx + dy * dy) <= hitRadius) {
                return n;
            }
        }
        return null;
    },

    /** Handle a click (not a pan) on the preview canvas. */
    _handleClick: function(e) {
        var hitNode = this._hitTestRootNode(e);
        if (hitNode && hitNode.school) {
            this.showRootSelectionModal(hitNode.school);
        }
    },

    // =========================================================================
    // ROOT SELECTION MODAL (reuses #spawn-spell-modal)
    // =========================================================================

    showRootSelectionModal: function(school) {
        this._rootSelectionSchool = school;

        var modal = document.getElementById('spawn-spell-modal');
        if (!modal) {
            console.warn('[TreePreview] #spawn-spell-modal not found');
            return;
        }

        // Update title
        var title = modal.querySelector('.modal-header h3');
        if (title) {
            title.textContent = 'Select Root \u2014 ' + school;
        }

        // Load primed spells for this school
        if (typeof getPrimedSpellsForSchool === 'function') {
            this._rootSelectionSpells = getPrimedSpellsForSchool(school);
        } else {
            this._rootSelectionSpells = [];
        }

        // Show modal
        modal.classList.remove('hidden');

        // Focus search
        var searchInput = document.getElementById('spawn-search');
        if (searchInput) {
            searchInput.value = '';
            searchInput.focus();
        }

        // Render initial list
        this._renderRootSelectionList('');

        // Set up listeners
        this._setupRootSelectionListeners();
    },

    hideRootSelectionModal: function() {
        var modal = document.getElementById('spawn-spell-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
        this._rootSelectionSchool = null;

        // Restore original title
        var title = modal ? modal.querySelector('.modal-header h3') : null;
        if (title) {
            title.textContent = 'Spawn Spell Node';
        }
    },

    _renderRootSelectionList: function(searchTerm) {
        var spellList = document.getElementById('spawn-spell-list');
        if (!spellList) return;

        var self = this;
        var school = this._rootSelectionSchool;
        searchTerm = (searchTerm || '').toLowerCase();

        // Filter by search term
        var filtered = this._rootSelectionSpells.filter(function(spell) {
            if (!searchTerm) return true;
            var nameMatch = (spell.name || '').toLowerCase().indexOf(searchTerm) !== -1;
            var idMatch = (spell.formId || '').toLowerCase().indexOf(searchTerm) !== -1;
            var levelMatch = (spell.skillLevel || spell.level || '').toLowerCase().indexOf(searchTerm) !== -1;
            return nameMatch || idMatch || levelMatch;
        });

        // Sort alphabetically
        filtered.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        // Limit results
        filtered = filtered.slice(0, 50);

        // Check current selection
        var currentRoot = settings.selectedRoots ? settings.selectedRoots[school] : null;
        var currentFormId = currentRoot ? currentRoot.formId : null;

        if (filtered.length === 0 && !searchTerm) {
            spellList.innerHTML = '<div class="spawn-no-results">No primed spells for ' + school + '</div>';
            return;
        }
        if (filtered.length === 0) {
            spellList.innerHTML = '<div class="spawn-no-results">No matching spells</div>';
            return;
        }

        spellList.innerHTML = '';
        filtered.forEach(function(spell) {
            var isSelected = spell.formId === currentFormId;
            var item = document.createElement('div');
            item.className = 'spawn-spell-item' + (isSelected ? ' on-tree' : '');
            item.dataset.formId = spell.formId;

            var badge = isSelected ? '<span class="spawn-on-tree-badge">CURRENT</span>' : '';
            item.innerHTML =
                '<div class="spawn-spell-name">' + (spell.name || spell.formId) + badge + '</div>' +
                '<div class="spawn-spell-info">' +
                    '<span>' + (spell.skillLevel || spell.level || '') + '</span>' +
                    '<span style="opacity:0.5">' + (spell.formId || '') + '</span>' +
                '</div>';

            item.addEventListener('click', function() {
                self._selectRoot(spell);
            });

            spellList.appendChild(item);
        });
    },

    _setupRootSelectionListeners: function() {
        var self = this;
        var modal = document.getElementById('spawn-spell-modal');
        if (!modal) return;

        // Clone search input to remove old listeners
        var searchInput = document.getElementById('spawn-search');
        if (searchInput) {
            var newInput = searchInput.cloneNode(true);
            searchInput.parentNode.replaceChild(newInput, searchInput);
            newInput.addEventListener('input', function() {
                self._renderRootSelectionList(this.value);
            });
        }

        // Close button
        var closeBtn = document.getElementById('spawn-modal-close');
        if (closeBtn) {
            closeBtn.onclick = function() { self.hideRootSelectionModal(); };
        }

        // Cancel button — repurpose as "Clear Selection" if a root is selected
        var cancelBtn = document.getElementById('spawn-cancel');
        if (cancelBtn) {
            var school = this._rootSelectionSchool;
            var hasSelection = settings.selectedRoots && settings.selectedRoots[school];
            if (hasSelection) {
                cancelBtn.textContent = 'Clear Selection';
                cancelBtn.onclick = function() {
                    self._clearRoot(school);
                };
            } else {
                cancelBtn.textContent = 'Cancel';
                cancelBtn.onclick = function() { self.hideRootSelectionModal(); };
            }
        }

        // Backdrop click
        var backdrop = modal.querySelector('.modal-backdrop');
        if (backdrop) {
            backdrop.onclick = function() { self.hideRootSelectionModal(); };
        }
    },

    _selectRoot: function(spell) {
        var school = this._rootSelectionSchool;
        if (!school) return;

        if (!settings.selectedRoots) {
            settings.selectedRoots = {};
        }

        settings.selectedRoots[school] = {
            formId: spell.formId,
            name: spell.name || spell.formId,
            school: school,
            plugin: spell.plugin || '',
            localFormId: typeof getLocalFormId === 'function' ? getLocalFormId(spell.formId) : spell.formId
        };

        console.log('[TreePreview] Selected root for ' + school + ': ' + spell.name + ' (' + spell.formId + ')');

        if (typeof autoSaveSettings === 'function') {
            autoSaveSettings();
        }

        this.hideRootSelectionModal();
        this._markDirty();
    },

    _clearRoot: function(school) {
        if (settings.selectedRoots && settings.selectedRoots[school]) {
            delete settings.selectedRoots[school];
            console.log('[TreePreview] Cleared root selection for ' + school);

            if (typeof autoSaveSettings === 'function') {
                autoSaveSettings();
            }
        }

        this.hideRootSelectionModal();
        this._markDirty();
    },

    // =========================================================================
    // SELECTED ROOT VISUAL OVERLAYS
    // =========================================================================

    _renderSelectedRootOverlays: function(ctx, w, h, modeModule) {
        if (!settings.selectedRoots) return;
        if (!modeModule || !modeModule._lastRenderData) return;
        var rootNodes = modeModule._lastRenderData.rootNodes;
        if (!rootNodes || rootNodes.length === 0) return;

        var nodeSize = modeModule.settings ? (modeModule.settings.nodeSize || 6) : 6;

        for (var i = 0; i < rootNodes.length; i++) {
            var n = rootNodes[i];
            var sel = settings.selectedRoots[n.school];
            if (!sel) continue;

            var nx = n.x + w / 2;
            var ny = n.y + h / 2;

            // Gold selection ring
            ctx.beginPath();
            ctx.arc(nx, ny, nodeSize + 5, 0, Math.PI * 2);
            ctx.strokeStyle = '#b8a878';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Outer glow
            ctx.beginPath();
            ctx.arc(nx, ny, nodeSize + 8, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(184, 168, 120, 0.25)';
            ctx.lineWidth = 3;
            ctx.stroke();

            // Spell name label below the node
            ctx.font = '9px sans-serif';
            ctx.fillStyle = '#b8a878';
            ctx.textAlign = 'center';
            ctx.fillText(sel.name || sel.formId, nx, ny + nodeSize + 18);
        }
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
            selectedRoots: settings.selectedRoots || {},
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

// Placeholder tabs for upcoming modes
TreePreview.registerPlaceholder('roguelike');
