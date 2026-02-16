/**
 * GraphSettings Module - Settings panel for Graph Growth mode
 *
 * Builds the Graph Growth settings panel HTML (sliders, toggles) and binds
 * event handlers for user interaction. Graph mode uses Edmonds' arborescence
 * to find globally optimal directed trees.
 *
 * Usage:
 *   var html = GraphSettings.buildHTML(settings);
 *   GraphSettings.bindEvents({ onSettingChanged });
 *   GraphSettings.updateScanStatus(hasSpells);
 *   GraphSettings.setTreeBuilt(built, nodeCount, totalPool);
 *   GraphSettings.setStatusText(text, color);
 *
 * Depends on: treePreviewUtils.js (settingHTML, bindInput)
 */

var GraphSettings = {

    // Internal state tracking
    _hasSpells: false,
    _treeBuilt: false,
    _nodeCount: 0,

    // =========================================================================
    // BUILD HTML
    // =========================================================================

    /**
     * Build the settings panel HTML string.
     *
     * @param {Object} settings - Current settings values
     * @param {number} settings.ghostOpacity - Ghost node opacity (0-100)
     * @param {number} settings.nodeRadius - Node radius in pixels
     * @param {number} settings.chaos - Cross-school factor (0-100)
     * @param {number} settings.forceBalance - Tree shape balance (0-100)
     * @param {string} settings.edgeStyle - 'straight' or 'curved'
     * @param {boolean} settings.showAffinity - Show debug affinity overlay
     * @returns {string} HTML string for the settings panel
     */
    buildHTML: function (settings) {
        var s = settings || {};
        var opacity = s.ghostOpacity !== undefined ? s.ghostOpacity : 35;
        var nodeSize = s.nodeRadius !== undefined ? s.nodeRadius : 5;
        var chaos = s.chaos !== undefined ? s.chaos : 30;
        var forceBalance = s.forceBalance !== undefined ? s.forceBalance : 50;
        var edgeStyle = s.edgeStyle || 'straight';
        var showAffinity = !!s.showAffinity;

        var H = TreePreviewUtils.settingHTML;

        // Toggle button styles (same as classicSettings)
        var btnBase = 'display:inline-block; padding:3px 10px; font-size:10px; cursor:pointer; border:1px solid rgba(184,168,120,0.3); transition:background 0.15s;';
        var btnAct = 'background:rgba(184,168,120,0.25); color:rgba(184,168,120,0.9);';
        var btnOff = 'background:transparent; color:rgba(184,168,120,0.4);';

        return '' +
            '<div class="tree-preview-settings-title">Graph Growth</div>' +

            // --- Edge Style toggle (2-way) ---
            '<div style="display:flex; align-items:center; gap:8px; margin-bottom:6px; padding:0 4px;">' +
                '<span style="font-size:10px; color:rgba(184,168,120,0.6); white-space:nowrap;">Edge Style</span>' +
                '<div style="display:flex;">' +
                    '<div id="tgGraphEdgeStraight" title="Direct parent-to-child connections" style="' + btnBase + ' border-radius:3px 0 0 3px; ' + (edgeStyle === 'straight' ? btnAct : btnOff) + '">Straight</div>' +
                    '<div id="tgGraphEdgeCurved" title="Curved Bezier edges for visual clarity" style="' + btnBase + ' border-radius:0 3px 3px 0; border-left:none; ' + (edgeStyle === 'curved' ? btnAct : btnOff) + '">Curved</div>' +
                '</div>' +
            '</div>' +

            // --- Chaos hero slider (promoted, full-width) ---
            '<div style="margin:8px 0 4px; padding:6px 8px; border:1px solid rgba(184,168,120,0.15); border-radius:4px; background:rgba(184,168,120,0.03);">' +
                '<div class="tree-preview-settings-grid">' +
                    H('Chaos', 'tgGraphChaosSlider', 0, 100, 5, chaos, '%',
                        'Controls cross-school connections. Low = strict school boundaries, High = spells freely migrate between schools.') +
                '</div>' +
                '<div style="font-size:9px; color:rgba(184,168,120,0.35); margin-top:2px;">Cross-school connection strength</div>' +
            '</div>' +

            // --- Remaining slider grid ---
            '<div class="tree-preview-settings-grid">' +
                H('Balance', 'tgGraphBalanceSlider', 0, 100, 5, forceBalance, '%',
                    'Tree shape control. Low = allows deep narrow trees, High = forces wide flat trees.') +
                H('Opacity', 'tgGraphOpacitySlider', 0, 100, 1, opacity, '%') +
                H('Node Size', 'tgGraphNodeSizeSlider', 1, 20, 1, nodeSize, 'px') +
            '</div>' +

            // --- Show Affinity checkbox ---
            '<div style="display:flex; align-items:center; gap:6px; margin:6px 0 8px 4px;">' +
                '<input type="checkbox" id="tgGraphShowAffinity"' + (showAffinity ? ' checked' : '') + ' style="margin:0;">' +
                '<label for="tgGraphShowAffinity" title="Debug overlay showing high-affinity spell pairs that aren\'t connected" style="font-size:10px; color:rgba(184,168,120,0.6); cursor:pointer;">Show Affinity</label>' +
            '</div>';
    },

    // =========================================================================
    // BIND EVENTS
    // =========================================================================

    /**
     * Bind DOM events for the settings panel.
     *
     * @param {Object} callbacks
     * @param {Function} callbacks.onSettingChanged - Called with (key, value) on change
     */
    bindEvents: function (callbacks) {
        var onChanged = callbacks.onSettingChanged || function () {};

        // Sliders
        TreePreviewUtils.bindInput('tgGraphChaosSlider', function (v) { onChanged('chaos', v); });
        TreePreviewUtils.bindInput('tgGraphBalanceSlider', function (v) { onChanged('forceBalance', v); });
        TreePreviewUtils.bindInput('tgGraphOpacitySlider', function (v) { onChanged('ghostOpacity', v); });
        TreePreviewUtils.bindInput('tgGraphNodeSizeSlider', function (v) { onChanged('nodeRadius', v); });

        // Edge style toggle
        var btnStraight = document.getElementById('tgGraphEdgeStraight');
        var btnCurved = document.getElementById('tgGraphEdgeCurved');
        var btnBase = 'display:inline-block; padding:3px 10px; font-size:10px; cursor:pointer; border:1px solid rgba(184,168,120,0.3); transition:background 0.15s;';
        var btnAct = 'background:rgba(184,168,120,0.25); color:rgba(184,168,120,0.9);';
        var btnOff = 'background:transparent; color:rgba(184,168,120,0.4);';

        function setEdgeActive(mode) {
            if (btnStraight) btnStraight.style.cssText = btnBase + ' border-radius:3px 0 0 3px; ' + (mode === 'straight' ? btnAct : btnOff);
            if (btnCurved) btnCurved.style.cssText = btnBase + ' border-radius:0 3px 3px 0; border-left:none; ' + (mode === 'curved' ? btnAct : btnOff);
        }

        if (btnStraight) {
            btnStraight.addEventListener('click', function () {
                setEdgeActive('straight');
                onChanged('edgeStyle', 'straight');
            });
        }
        if (btnCurved) {
            btnCurved.addEventListener('click', function () {
                setEdgeActive('curved');
                onChanged('edgeStyle', 'curved');
            });
        }

        // Show affinity checkbox
        var affinityCheck = document.getElementById('tgGraphShowAffinity');
        if (affinityCheck) {
            affinityCheck.addEventListener('change', function () {
                onChanged('showAffinity', this.checked);
            });
        }
    },

    // =========================================================================
    // STATE UPDATES (delegated to TreeGrowth orchestrator)
    // =========================================================================

    setTreeBuilt: function (built, nodeCount, totalPool) {
        if (typeof TreeGrowth !== 'undefined') TreeGrowth.setTreeBuilt(built, nodeCount, totalPool);
    },

    setStatusText: function (text, color) {
        if (typeof TreeGrowth !== 'undefined') TreeGrowth.setStatusText(text, color);
    },

    updateScanStatus: function (hasSpells) {
        this._hasSpells = hasSpells;
        if (typeof TreeGrowth !== 'undefined') TreeGrowth.updateScanStatus(hasSpells);
    }
};
