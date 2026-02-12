/**
 * ThematicSettings Module - Settings panel for Thematic Growth mode
 *
 * Builds the Thematic Growth settings panel HTML (layout toggle, sliders,
 * checkboxes) and binds event handlers for user interaction. Supports two
 * layout modes: Normal BFS (school-colored) and Themed BFS (angular sub-arcs
 * per theme with branch spines and labels).
 *
 * Usage:
 *   var html = ThematicSettings.buildHTML(settings);
 *   ThematicSettings.bindEvents({ onBuild, onApply, onClear, onSetupPython, onSettingChanged });
 *   ThematicSettings.updatePythonStatus(installed, hasScript, hasPython);
 *   ThematicSettings.updateScanStatus(hasSpells);
 *   ThematicSettings.setTreeBuilt(built, nodeCount, totalPool);
 *   ThematicSettings.setStatusText(text, color);
 *
 * Depends on: treePreviewUtils.js (settingHTML, bindInput)
 */

var ThematicSettings = {

    // Internal state tracking
    _pythonInstalled: false,
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
     * @param {string} settings.layoutMode - 'normal' or 'themed'
     * @param {number} settings.branchSpacing - Angular gap between theme wedges (0-100)
     * @param {boolean} settings.showLabels - Show theme branch labels
     * @param {boolean} settings.showSpines - Show thick colored branch spine lines
     * @returns {string} HTML string for the settings panel
     */
    buildHTML: function (settings) {
        var s = settings || {};
        var opacity = s.ghostOpacity !== undefined ? s.ghostOpacity : 35;
        var nodeSize = s.nodeRadius !== undefined ? s.nodeRadius : 5;
        var layoutMode = s.layoutMode || 'themed';
        var branchSpacing = s.branchSpacing !== undefined ? s.branchSpacing : 30;
        var showLabels = s.showLabels !== false;
        var showSpines = s.showSpines !== false;
        var H = TreePreviewUtils.settingHTML;

        // Toggle button styles (same as classicSettings / graphSettings)
        var btnBase = 'display:inline-block; padding:3px 10px; font-size:10px; cursor:pointer; border:1px solid rgba(184,168,120,0.3); transition:background 0.15s;';
        var btnAct = 'background:rgba(184,168,120,0.25); color:rgba(184,168,120,0.9);';
        var btnOff = 'background:transparent; color:rgba(184,168,120,0.4);';

        return '' +
            '<div class="tree-preview-settings-title">Thematic Growth</div>' +

            // --- Layout Mode toggle (2-way) ---
            '<div style="display:flex; align-items:center; gap:8px; margin-bottom:2px; padding:0 4px;">' +
                '<span style="font-size:10px; color:rgba(184,168,120,0.6); white-space:nowrap;">Layout</span>' +
                '<div style="display:flex;">' +
                    '<div id="tgThematicLayoutNormal" style="' + btnBase + ' border-radius:3px 0 0 3px; ' + (layoutMode === 'normal' ? btnAct : btnOff) + '">Normal BFS</div>' +
                    '<div id="tgThematicLayoutThemed" style="' + btnBase + ' border-radius:0 3px 3px 0; border-left:none; ' + (layoutMode === 'themed' ? btnAct : btnOff) + '">Themed BFS</div>' +
                '</div>' +
            '</div>' +
            '<div id="tgThematicLayoutDesc" style="font-size:9px; color:rgba(184,168,120,0.35); padding:0 4px 4px; min-height:22px;">' +
                (layoutMode === 'normal'
                    ? 'Standard BFS placement with school colors. No theme awareness in layout. Baseline/fallback mode.'
                    : 'Angular sub-arcs per theme with theme-colored nodes, branch spines, and labels. Full thematic visualization.') +
            '</div>' +

            // --- Slider grid ---
            '<div class="tree-preview-settings-grid">' +
                H('Opacity', 'tgThematicOpacity', 0, 100, 5, opacity, '%') +
                H('Node Size', 'tgThematicNodeSize', 1, 20, 1, nodeSize) +
            '</div>' +

            // --- Branch Spacing slider (only visible in themed mode) ---
            '<div id="tgThematicBranchSpacingWrap" style="' + (layoutMode === 'themed' ? '' : 'display:none;') + '">' +
                '<div class="tree-preview-settings-grid">' +
                    H('Branch Spacing', 'tgThematicBranchSpacing', 0, 100, 5, branchSpacing, '\u00B0') +
                '</div>' +
                '<div style="font-size:9px; color:rgba(184,168,120,0.3); padding:0 4px 2px;">Angular gap between theme wedges</div>' +
            '</div>' +

            // --- Show Branch Labels checkbox ---
            '<div style="display:flex; align-items:center; gap:8px; margin:4px 4px 2px; font-size:10px;">' +
                '<label style="display:flex; align-items:center; gap:5px; cursor:pointer; color:rgba(184,168,120,0.6);">' +
                    '<input type="checkbox" id="tgThematicShowLabels"' + (showLabels ? ' checked' : '') + '>' +
                    'Show Branch Labels' +
                '</label>' +
                '<span style="color:rgba(184,168,120,0.3); font-size:9px;">Theme name labels along branch spines</span>' +
            '</div>' +

            // --- Show Branch Spines checkbox ---
            '<div style="display:flex; align-items:center; gap:8px; margin:2px 4px 6px; font-size:10px;">' +
                '<label style="display:flex; align-items:center; gap:5px; cursor:pointer; color:rgba(184,168,120,0.6);">' +
                    '<input type="checkbox" id="tgThematicShowSpines"' + (showSpines ? ' checked' : '') + '>' +
                    'Show Branch Spines' +
                '</label>' +
                '<span style="color:rgba(184,168,120,0.3); font-size:9px;">Thick colored lines along theme branches</span>' +
            '</div>';
    },

    // =========================================================================
    // BIND EVENTS
    // =========================================================================

    /**
     * Bind click handlers on buttons and change handlers on sliders/checkboxes.
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
        var onChanged = cb.onSettingChanged || function () {};

        // Slider bindings
        TreePreviewUtils.bindInput('tgThematicOpacity', function (v) {
            onChanged('ghostOpacity', v);
        });

        TreePreviewUtils.bindInput('tgThematicNodeSize', function (v) {
            onChanged('nodeRadius', v);
        });

        TreePreviewUtils.bindInput('tgThematicBranchSpacing', function (v) {
            onChanged('branchSpacing', v);
        });

        // Layout Mode 2-way toggle
        var btnNormal = document.getElementById('tgThematicLayoutNormal');
        var btnThemed = document.getElementById('tgThematicLayoutThemed');
        var btnBase = 'display:inline-block; padding:3px 10px; font-size:10px; cursor:pointer; border:1px solid rgba(184,168,120,0.3); transition:background 0.15s;';
        var actBg = 'background:rgba(184,168,120,0.25)';
        var actCol = 'color:rgba(184,168,120,0.9)';
        var offBg = 'background:transparent';
        var offCol = 'color:rgba(184,168,120,0.4)';

        var layoutDescs = {
            normal: 'Standard BFS placement with school colors. No theme awareness in layout. Baseline/fallback mode.',
            themed: 'Angular sub-arcs per theme with theme-colored nodes, branch spines, and labels. Full thematic visualization.'
        };
        var descEl = document.getElementById('tgThematicLayoutDesc');
        var spacingWrap = document.getElementById('tgThematicBranchSpacingWrap');

        var setLayoutActive = function (mode) {
            if (btnNormal) {
                btnNormal.style.cssText = btnBase + ' border-radius:3px 0 0 3px; ' +
                    (mode === 'normal' ? actBg + '; ' + actCol : offBg + '; ' + offCol);
            }
            if (btnThemed) {
                btnThemed.style.cssText = btnBase + ' border-radius:0 3px 3px 0; border-left:none; ' +
                    (mode === 'themed' ? actBg + '; ' + actCol : offBg + '; ' + offCol);
            }
            if (descEl) descEl.textContent = layoutDescs[mode] || '';
            if (spacingWrap) spacingWrap.style.display = (mode === 'themed') ? '' : 'none';
        };

        if (btnNormal) {
            btnNormal.addEventListener('click', function () {
                setLayoutActive('normal');
                onChanged('layoutMode', 'normal');
            });
        }
        if (btnThemed) {
            btnThemed.addEventListener('click', function () {
                setLayoutActive('themed');
                onChanged('layoutMode', 'themed');
            });
        }

        // Show Branch Labels checkbox
        var labelsCheck = document.getElementById('tgThematicShowLabels');
        if (labelsCheck) {
            labelsCheck.addEventListener('change', function () {
                onChanged('showLabels', this.checked);
            });
        }

        // Show Branch Spines checkbox
        var spinesCheck = document.getElementById('tgThematicShowSpines');
        if (spinesCheck) {
            spinesCheck.addEventListener('change', function () {
                onChanged('showSpines', this.checked);
            });
        }
    },

    // =========================================================================
    // STATE UPDATES (delegated to TreeGrowth orchestrator)
    // =========================================================================

    /**
     * Update button states after a tree is built or cleared.
     *
     * @param {boolean} built - True if a tree has been generated
     * @param {number} [nodeCount] - Number of positioned nodes
     * @param {number} [totalPool] - Total nodes in pool
     */
    setTreeBuilt: function (built, nodeCount, totalPool) {
        if (typeof TreeGrowth !== 'undefined') TreeGrowth.setTreeBuilt(built, nodeCount, totalPool);
    },

    /**
     * Set the status text element's content and color.
     *
     * @param {string} text - Status message
     * @param {string} color - CSS color value
     */
    setStatusText: function (text, color) {
        if (typeof TreeGrowth !== 'undefined') TreeGrowth.setStatusText(text, color);
    },

    /**
     * Called when Python environment status changes.
     *
     * @param {boolean} installed - True if Python environment is fully ready
     * @param {boolean} hasScript - True if SpellTreeBuilder script exists on disk
     * @param {boolean} hasPython - True if Python binary is detected
     */
    onPythonStatusChanged: function (installed, hasScript, hasPython) {
        this._pythonInstalled = installed;
        this.updatePythonStatus(installed, hasScript, hasPython);
    },

    updatePythonStatus: function (installed, hasScript, hasPython) {
        this._pythonInstalled = installed;
        if (typeof TreeGrowth !== 'undefined') TreeGrowth.updatePythonStatus(installed, hasScript, hasPython);
    },

    /**
     * Called when spell scan data changes.
     *
     * @param {boolean} hasSpells - True if spell data is available
     */
    updateScanStatus: function (hasSpells) {
        this._hasSpells = hasSpells;
        if (typeof TreeGrowth !== 'undefined') TreeGrowth.updateScanStatus(hasSpells);
    }
};

console.log('[ThematicSettings] Loaded');
