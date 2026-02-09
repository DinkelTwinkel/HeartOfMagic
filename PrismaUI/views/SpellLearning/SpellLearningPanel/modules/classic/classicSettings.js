/**
 * ClassicSettings Module - Settings panel for Classic Growth mode
 *
 * Builds the Classic Growth settings panel HTML (buttons, status, sliders)
 * and binds event handlers for user interaction. Tracks Python addon status
 * and spell scan state to enable/disable the Build, Apply, and Clear buttons.
 *
 * Usage:
 *   var html = ClassicSettings.buildHTML(settings);
 *   ClassicSettings.bindEvents({ onBuild, onApply, onClear, onSetupPython, onSettingChanged });
 *   ClassicSettings.updatePythonStatus(installed, hasScript, hasPython);
 *   ClassicSettings.updateScanStatus(hasSpells);
 *   ClassicSettings.setTreeBuilt(built);
 *   ClassicSettings.setStatusText(text, color);
 *
 * Depends on: treePreviewUtils.js (settingHTML, bindInput)
 */

var ClassicSettings = {

    // Internal state tracking
    _pythonInstalled: false,
    _hasSpells: false,
    _treeBuilt: false,
    _nodeCount: 0,

    // Tier zone defaults
    _tierZones: {
        Novice:     { min: 0,  max: 40 },
        Apprentice: { min: 10, max: 55 },
        Adept:      { min: 30, max: 75 },
        Expert:     { min: 50, max: 90 },
        Master:     { min: 65, max: 100 }
    },

    // Tier display config
    _tierConfig: [
        { key: 'Novice',     label: 'Novice',     color: 'rgba(100,180,100,0.5)' },
        { key: 'Apprentice', label: 'Apprentice', color: 'rgba(80,150,200,0.5)' },
        { key: 'Adept',      label: 'Adept',      color: 'rgba(180,160,80,0.5)' },
        { key: 'Expert',     label: 'Expert',     color: 'rgba(200,120,60,0.5)' },
        { key: 'Master',     label: 'Master',     color: 'rgba(180,60,60,0.5)' }
    ],

    // =========================================================================
    // BUILD HTML
    // =========================================================================

    /**
     * Build the settings panel HTML string.
     *
     * @param {Object} settings - Current settings values
     * @param {number} settings.ghostOpacity - Ghost node opacity (0-100)
     * @param {number} settings.nodeRadius - Node radius in pixels
     * @returns {string} HTML string for the settings panel
     */
    buildHTML: function (settings) {
        var s = settings || {};
        var opacity = s.ghostOpacity !== undefined ? s.ghostOpacity : 35;
        var nodeSize = s.nodeRadius !== undefined ? s.nodeRadius : 5;
        var spread = s.spread !== undefined ? s.spread : 50;
        var radialBias = s.radialBias !== undefined ? s.radialBias : 50;
        var centerMask = s.centerMask !== undefined ? s.centerMask : 3;
        var spellMatching = s.spellMatching || 'layered';
        var dynamicExpansion = s.dynamicGridExpansion !== false;
        var H = TreePreviewUtils.settingHTML;

        // Toggle button styles
        var btnBase = 'display:inline-block; padding:3px 10px; font-size:10px; cursor:pointer; border:1px solid rgba(184,168,120,0.3); transition:background 0.15s;';
        var btnAct = 'background:rgba(184,168,120,0.25); color:rgba(184,168,120,0.9);';
        var btnOff = 'background:transparent; color:rgba(184,168,120,0.4);';

        return '' +
            '<div class="tree-preview-settings-title">Classic Growth Settings</div>' +

            // --- Spell Matching toggle (3-way) ---
            '<div style="display:flex; align-items:center; gap:8px; margin-bottom:6px; padding:0 4px;">' +
                '<span style="font-size:10px; color:rgba(184,168,120,0.6); white-space:nowrap;">Spell Matching</span>' +
                '<div style="display:flex;">' +
                    '<div id="tgClassicMatchSimple" style="' + btnBase + ' border-radius:3px 0 0 3px; ' + (spellMatching === 'simple' ? btnAct : btnOff) + '">Simple</div>' +
                    '<div id="tgClassicMatchLayered" style="' + btnBase + ' border-left:none; ' + (spellMatching === 'layered' ? btnAct : btnOff) + '">Layered</div>' +
                    '<div id="tgClassicMatchSmart" style="' + btnBase + ' border-radius:0 3px 3px 0; border-left:none; ' + (spellMatching === 'smart' ? btnAct : btnOff) + '">Smart</div>' +
                '</div>' +
            '</div>' +

            // --- Slider grid ---
            '<div class="tree-preview-settings-grid">' +
                H('Ghost Opacity', 'tgClassicOpacity', 0, 100, 5, opacity, '%') +
                H('Node Size', 'tgClassicNodeSize', 1, 20, 1, nodeSize) +
                H('Spread', 'tgClassicSpread', 0, 100, 5, spread) +
                H('Radial Bias', 'tgClassicRadialBias', 0, 100, 5, radialBias) +
                H('Globe Mask', 'tgClassicCenterMask', 0, 10, 1, centerMask, ' tiers') +
            '</div>' +

            // --- Dynamic Grid Expansion toggle ---
            '<div style="display:flex; align-items:center; gap:8px; margin:4px 4px 6px; font-size:10px;">' +
                '<label style="display:flex; align-items:center; gap:5px; cursor:pointer; color:rgba(184,168,120,0.6);">' +
                    '<input type="checkbox" id="tgClassicDynExpand"' + (dynamicExpansion ? ' checked' : '') + '>' +
                    'Dynamic Grid Expansion' +
                '</label>' +
                '<span style="color:rgba(184,168,120,0.3); font-size:9px;" title="Automatically expand grid when a school runs out of placement space (e.g. large Destruction trees)">(?)</span>' +
            '</div>' +

            // --- Tier zone bar chart ---
            '<div class="tree-preview-settings-title" style="margin-top:8px;">Tier Placement Zones</div>' +
            this._buildTierChartHTML(s) +
            '<div style="text-align:center; margin-top:2px; font-size:9px; color:rgba(184,168,120,0.3);">drag handles to adjust</div>';
    },

    /** Build the tier zone bar chart HTML. @private */
    _buildTierChartHTML: function (settings) {
        var zones = (settings && settings.tierZones) || this._tierZones;
        // Use inline styles to avoid CSS loading issues (matches treeSettings alloc bar pattern)
        var html = '<div id="tgClassicTierChart" style="display:flex; flex-direction:row; gap:6px; padding:6px 8px; height:260px; border:1px solid rgba(184,168,120,0.2); border-radius:4px; user-select:none; -webkit-user-select:none;">';

        for (var i = 0; i < this._tierConfig.length; i++) {
            var cfg = this._tierConfig[i];
            var zone = zones[cfg.key] || { min: 0, max: 100 };
            var fillH = zone.max - zone.min;

            // Column: vertical flex, equal width
            html += '<div class="classic-tier-col" data-tier="' + cfg.key + '" ' +
                'style="flex:1; display:flex; flex-direction:column; align-items:center; min-width:0;">' +

                // Track: the vertical bar area
                '<div class="classic-tier-track" style="flex:1; width:100%; position:relative; background:rgba(184,168,120,0.08); border-radius:3px; overflow:visible;">' +

                    // Fill: positioned from bottom, height = zone range
                    '<div class="classic-tier-fill" ' +
                        'style="position:absolute; left:2px; right:2px; bottom:' + zone.min + '%; height:' + fillH + '%; background:' + cfg.color + '; border-radius:2px;">' +

                        // Top handle (max)
                        '<div class="classic-tier-handle" data-handle="max" ' +
                            'style="position:absolute; left:-1px; right:-1px; top:-2px; height:5px; cursor:ns-resize; background:rgba(255,255,255,0.7); border-radius:2px;"></div>' +

                        // Bottom handle (min)
                        '<div class="classic-tier-handle" data-handle="min" ' +
                            'style="position:absolute; left:-1px; right:-1px; bottom:-2px; height:5px; cursor:ns-resize; background:rgba(255,255,255,0.7); border-radius:2px;"></div>' +

                        // Percentage label centered in fill
                        '<span class="classic-tier-pct" style="position:absolute; width:100%; text-align:center; font-size:8px; color:rgba(255,255,255,0.8); pointer-events:none; top:50%; transform:translateY(-50%); white-space:nowrap;">' +
                            zone.min + '-' + zone.max +
                        '</span>' +

                    '</div>' +
                '</div>' +

                // Label below the bar
                '<div class="classic-tier-label" style="font-size:9px; color:rgba(184,168,120,0.7); margin-top:3px; white-space:nowrap;">' + cfg.label + '</div>' +
            '</div>';
        }

        html += '</div>';
        return html;
    },

    // =========================================================================
    // BIND EVENTS
    // =========================================================================

    /**
     * Bind click handlers on buttons and change handlers on sliders.
     *
     * @param {Object} callbacks
     * @param {function} callbacks.onBuild - Called when Build Tree is clicked
     * @param {function} callbacks.onApply - Called when Apply Tree is clicked
     * @param {function} callbacks.onClear - Called when Clear Tree is clicked
     * @param {function} callbacks.onSetupPython - Called when Setup Python is clicked
     * @param {function} callbacks.onSettingChanged - Called with (key, value)
     */
    bindEvents: function (callbacks) {
        var cb = callbacks || {};

        // Slider bindings
        var onChanged = cb.onSettingChanged || function () {};

        TreePreviewUtils.bindInput('tgClassicOpacity', function (v) {
            onChanged('ghostOpacity', v);
        });

        TreePreviewUtils.bindInput('tgClassicNodeSize', function (v) {
            onChanged('nodeRadius', v);
        });

        TreePreviewUtils.bindInput('tgClassicSpread', function (v) {
            onChanged('spread', v);
        });

        TreePreviewUtils.bindInput('tgClassicRadialBias', function (v) {
            onChanged('radialBias', v);
        });

        TreePreviewUtils.bindInput('tgClassicCenterMask', function (v) {
            onChanged('centerMask', v);
        });

        // Spell Matching 3-way toggle
        var matchBtns = {
            simple: document.getElementById('tgClassicMatchSimple'),
            layered: document.getElementById('tgClassicMatchLayered'),
            smart: document.getElementById('tgClassicMatchSmart')
        };
        var actBg = 'background:rgba(184,168,120,0.25)';
        var actCol = 'color:rgba(184,168,120,0.9)';
        var offBg = 'background:transparent';
        var offCol = 'color:rgba(184,168,120,0.4)';
        var setMatchActive = function (mode) {
            for (var mk in matchBtns) {
                if (!matchBtns.hasOwnProperty(mk) || !matchBtns[mk]) continue;
                var isAct = (mk === mode);
                matchBtns[mk].style.cssText = matchBtns[mk].style.cssText
                    .replace(/background:[^;]+/, isAct ? actBg : offBg)
                    .replace(/color:[^;]+/, isAct ? actCol : offCol);
            }
        };
        var modes = ['simple', 'layered', 'smart'];
        for (var mi = 0; mi < modes.length; mi++) {
            (function (mode) {
                if (matchBtns[mode]) {
                    matchBtns[mode].addEventListener('click', function () {
                        setMatchActive(mode);
                        onChanged('spellMatching', mode);
                    });
                }
            })(modes[mi]);
        }

        // Dynamic Grid Expansion toggle
        var dynExpandCheck = document.getElementById('tgClassicDynExpand');
        if (dynExpandCheck) {
            dynExpandCheck.addEventListener('change', function () {
                onChanged('dynamicGridExpansion', this.checked);
            });
        }

        // Tier zone drag
        this._bindTierZoneDrag(cb);

        // Re-apply internal state to fresh DOM
        this._refreshDOM();
    },

    /** Return a copy of the current tier zones. */
    getTierZones: function () {
        var copy = {};
        for (var key in this._tierZones) {
            if (this._tierZones.hasOwnProperty(key)) {
                copy[key] = { min: this._tierZones[key].min, max: this._tierZones[key].max };
            }
        }
        return copy;
    },

    /** Update tier zones from external data and refresh the bar chart. */
    setTierZones: function (zones) {
        if (!zones) return;
        for (var key in zones) {
            if (zones.hasOwnProperty(key) && this._tierZones.hasOwnProperty(key)) {
                this._tierZones[key].min = zones[key].min;
                this._tierZones[key].max = zones[key].max;
            }
        }
        this._refreshTierChart();
    },

    /** Update bar chart fill positions from _tierZones state. @private */
    _refreshTierChart: function () {
        var chart = document.getElementById('tgClassicTierChart');
        if (!chart) return;
        var cols = chart.querySelectorAll('.classic-tier-col');
        for (var ci = 0; ci < cols.length; ci++) {
            var tier = cols[ci].getAttribute('data-tier');
            var zone = this._tierZones[tier];
            if (!zone) continue;
            var fill = cols[ci].querySelector('.classic-tier-fill');
            if (!fill) continue;
            fill.style.bottom = zone.min + '%';
            fill.style.height = (zone.max - zone.min) + '%';
            var pctEl = fill.querySelector('.classic-tier-pct');
            if (pctEl) pctEl.textContent = zone.min + '-' + zone.max;
        }
    },

    /** Bind mousedown/mousemove/mouseup on tier zone bar handles. @private */
    _bindTierZoneDrag: function (callbacks) {
        var chart = document.getElementById('tgClassicTierChart');
        if (!chart) return;

        var self = this;
        var dragging = null;

        var handles = chart.querySelectorAll('.classic-tier-handle');
        for (var i = 0; i < handles.length; i++) {
            (function (handle) {
                handle.addEventListener('mousedown', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    var col = handle.closest('.classic-tier-col');
                    if (!col) return;
                    var track = col.querySelector('.classic-tier-track');
                    if (!track) return;
                    dragging = {
                        tier: col.getAttribute('data-tier'),
                        handleType: handle.getAttribute('data-handle'), // 'min' or 'max'
                        track: track,
                        fill: track.querySelector('.classic-tier-fill')
                    };
                });
            })(handles[i]);
        }

        document.addEventListener('mousemove', function (e) {
            if (!dragging) return;
            var rect = dragging.track.getBoundingClientRect();
            var trackH = rect.height;
            if (trackH <= 0) return;

            // Y is inverted: top of track = 100%, bottom = 0%
            var relY = rect.bottom - e.clientY;
            var pct = Math.round((relY / trackH) * 100);
            // Snap to 5%
            pct = Math.round(pct / 5) * 5;
            pct = Math.max(0, Math.min(100, pct));

            var zone = self._tierZones[dragging.tier];
            if (!zone) return;

            if (dragging.handleType === 'max') {
                // Top handle: can't go below min + 5
                if (pct <= zone.min + 5) pct = zone.min + 5;
                if (pct > 100) pct = 100;
                zone.max = pct;
            } else {
                // Bottom handle: can't go above max - 5
                if (pct >= zone.max - 5) pct = zone.max - 5;
                if (pct < 0) pct = 0;
                zone.min = pct;
            }

            // Update visuals
            dragging.fill.style.bottom = zone.min + '%';
            dragging.fill.style.height = (zone.max - zone.min) + '%';
            var pctLabel = dragging.fill.querySelector('.classic-tier-pct');
            if (pctLabel) pctLabel.textContent = zone.min + '-' + zone.max;

            if (callbacks.onTierZoneChanged) {
                callbacks.onTierZoneChanged(dragging.tier, zone.min, zone.max);
            }
        });

        document.addEventListener('mouseup', function () { dragging = null; });
    },

    /** Re-apply tracked state to freshly built DOM elements. @private */
    _refreshDOM: function () {
        this._refreshTierChart();
    },

    // =========================================================================
    // PYTHON STATUS
    // =========================================================================

    /**
     * Update the status text and button states based on Python addon status.
     *
     * @param {boolean} installed - True if Python environment is fully ready
     * @param {boolean} hasScript - True if SpellTreeBuilder script exists on disk
     * @param {boolean} hasPython - True if Python binary is detected
     */
    updatePythonStatus: function (installed, hasScript, hasPython) {
        if (typeof TreeGrowth !== 'undefined') TreeGrowth.updatePythonStatus(installed, hasScript, hasPython);
    },

    // =========================================================================
    // SCAN STATUS
    // =========================================================================

    /**
     * Called when spell scan data changes.
     *
     * @param {boolean} hasSpells - True if spell data is available
     */
    updateScanStatus: function (hasSpells) {
        if (typeof TreeGrowth !== 'undefined') TreeGrowth.updateScanStatus(hasSpells);
    },

    // =========================================================================
    // TREE BUILT STATE
    // =========================================================================

    /**
     * Update button states after a tree is built or cleared.
     *
     * @param {boolean} built - True if a tree has been generated
     * @param {number} [nodeCount] - Number of nodes in the built tree
     */
    setTreeBuilt: function (built, nodeCount, totalPool) {
        if (typeof TreeGrowth !== 'undefined') TreeGrowth.setTreeBuilt(built, nodeCount, totalPool);
    },

    // =========================================================================
    // STATUS TEXT HELPER
    // =========================================================================

    /**
     * Set the status text element's content and color.
     *
     * @param {string} text - Status message
     * @param {string} color - CSS color value
     */
    setStatusText: function (text, color) {
        if (typeof TreeGrowth !== 'undefined') TreeGrowth.setStatusText(text, color);
    },

    // =========================================================================
    // INTERNAL HELPERS
    // =========================================================================

    /**
     * Enable or disable the Build Tree button based on current state.
     * Requires both Python installed AND spells scanned.
     * @private
     */
    _updateBuildButton: function () {
        if (typeof TreeGrowth !== 'undefined') TreeGrowth.updateBuildButton();
    }
};

console.log('[ClassicSettings] Loaded');
