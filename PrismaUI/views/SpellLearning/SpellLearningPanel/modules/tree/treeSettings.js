/**
 * TreeSettings Module - Settings panel for Tree Growth mode
 *
 * Builds the Tree Growth settings panel HTML (buttons, status, sliders,
 * section allocation bar) and binds event handlers for user interaction.
 *
 * Depends on: treePreviewUtils.js (settingHTML, bindInput)
 */
var TreeSettings = {

    _hasSpells: false,
    _treeBuilt: false,
    _nodeCount: 0,

    /** Build the settings panel HTML string. */
    buildHTML: function (settings) {
        var s = settings || {};
        var thickness = s.trunkThickness !== undefined ? s.trunkThickness : 70;
        var opacity = s.ghostOpacity !== undefined ? s.ghostOpacity : 35;
        var nodeSize = s.nodeRadius !== undefined ? s.nodeRadius : 5;
        var spread = s.branchSpread !== undefined ? s.branchSpread : 2.5;
        var rootSpread = s.rootSpread !== undefined ? s.rootSpread : 2.5;
        var H = TreePreviewUtils.settingHTML;

        return '' +
            '<div class="tree-preview-settings-title">' + t('preview.tree.title') + '</div>' +
            '<div class="tree-preview-settings-grid">' +
                H(t('preview.tree.trunkThickness'), 'tgTreeTrunkThickness', 1, 100, 1, thickness, '%') +
                H(t('preview.tree.branchSpread'), 'tgTreeBranchSpread', 0, 10, 0.5, spread, 'x') +
                H(t('preview.tree.rootSpread'), 'tgTreeRootSpread', 0, 10, 0.5, rootSpread, 'x') +
                H(t('preview.ghostOpacity'), 'tgTreeOpacity', 0, 100, 5, opacity, '%') +
                H(t('preview.nodeSize'), 'tgTreeNodeSize', 1, 20, 1, nodeSize) +
            '</div>' +
            '<div class="tree-preview-settings-title" style="margin-top:8px;">' + t('preview.tree.sectionAllocation') + '</div>' +
            '<div id="tgTreeAllocBar" style="display:flex; height:36px; border:1px solid rgba(184,168,120,0.2); border-radius:4px; overflow:hidden; cursor:col-resize; user-select:none;">' +
                '<div id="tgTreeAllocBranch" style="background:rgba(74,124,74,0.4); flex-basis:30%; display:flex; flex-direction:column; align-items:center; justify-content:center; position:relative;">' +
                    '<span style="font-size:9px; color:rgba(184,168,120,0.7);">' + t('preview.tree.branches') + '</span>' +
                    '<span class="tg-tree-alloc-pct" style="font-size:10px; color:#b8a878;">30%</span>' +
                '</div>' +
                '<div class="tg-tree-alloc-divider" data-left="branch" data-right="trunk" style="width:12px; background:rgba(184,168,120,0.15); cursor:col-resize; flex-shrink:0; display:flex; align-items:center; justify-content:center;"><span style="color:rgba(184,168,120,0.5); font-size:10px; pointer-events:none;">&#x2807;</span></div>' +
                '<div id="tgTreeAllocTrunk" style="background:rgba(138,112,64,0.4); flex-basis:50%; display:flex; flex-direction:column; align-items:center; justify-content:center; position:relative;">' +
                    '<span style="font-size:9px; color:rgba(184,168,120,0.7);">' + t('preview.tree.trunk') + '</span>' +
                    '<span class="tg-tree-alloc-pct" style="font-size:10px; color:#b8a878;">50%</span>' +
                '</div>' +
                '<div class="tg-tree-alloc-divider" data-left="trunk" data-right="root" style="width:12px; background:rgba(184,168,120,0.15); cursor:col-resize; flex-shrink:0; display:flex; align-items:center; justify-content:center;"><span style="color:rgba(184,168,120,0.5); font-size:10px; pointer-events:none;">&#x2807;</span></div>' +
                '<div id="tgTreeAllocRoot" style="background:rgba(160,96,48,0.4); flex-basis:20%; display:flex; flex-direction:column; align-items:center; justify-content:center; position:relative;">' +
                    '<span style="font-size:9px; color:rgba(184,168,120,0.7);">' + t('preview.tree.root') + '</span>' +
                    '<span class="tg-tree-alloc-pct" style="font-size:10px; color:#b8a878;">20%</span>' +
                '</div>' +
            '</div>' +
            '<div style="text-align:center; margin-top:2px; font-size:9px; color:rgba(184,168,120,0.3);">' + t('preview.dragDividers') + '</div>';
    },

    /** Bind click handlers on buttons, change handlers on sliders, and drag on allocation bar. */
    bindEvents: function (callbacks) {
        var cb = callbacks || {};
        var onChanged = cb.onSettingChanged || function () {};
        TreePreviewUtils.bindInput('tgTreeTrunkThickness', function (v) { onChanged('trunkThickness', v); });
        TreePreviewUtils.bindInput('tgTreeBranchSpread', function (v) { onChanged('branchSpread', v); });
        TreePreviewUtils.bindInput('tgTreeRootSpread', function (v) { onChanged('rootSpread', v); });
        TreePreviewUtils.bindInput('tgTreeOpacity', function (v) { onChanged('ghostOpacity', v); });
        TreePreviewUtils.bindInput('tgTreeNodeSize', function (v) { onChanged('nodeRadius', v); });

        this._bindAllocationDrag(cb);

        // Re-apply internal state to fresh DOM
        this._refreshDOM();
    },

    /** Re-apply tracked state to freshly built DOM elements. @private */
    _refreshDOM: function () {
        // Shared buttons handled by TreeGrowth; no local DOM to refresh
    },

    /** Bind mousedown/mousemove/mouseup on allocation bar dividers. @private */
    _bindAllocationDrag: function (callbacks) {
        var bar = document.getElementById('tgTreeAllocBar');
        if (!bar) return;

        var self = this;
        var pcts = { branch: 30, trunk: 50, root: 20 };
        var dragging = null;

        var dividers = bar.querySelectorAll('.tg-tree-alloc-divider');
        for (var i = 0; i < dividers.length; i++) {
            (function (div) {
                div.addEventListener('mousedown', function (e) {
                    e.preventDefault();
                    dragging = {
                        left: div.getAttribute('data-left'),
                        right: div.getAttribute('data-right'),
                        startX: e.clientX
                    };
                });
            })(dividers[i]);
        }

        document.addEventListener('mousemove', function (e) {
            if (!dragging) return;
            var barRect = bar.getBoundingClientRect();
            var barWidth = barRect.width;
            if (barWidth <= 0) return;

            var dx = e.clientX - dragging.startX;
            var deltaPct = Math.round((dx / barWidth) * 100);
            if (deltaPct === 0) return;

            var leftKey = dragging.left;
            var rightKey = dragging.right;
            var newLeft = pcts[leftKey] + deltaPct;
            var newRight = pcts[rightKey] - deltaPct;
            if (newLeft < 5 || newRight < 5) return;

            pcts[leftKey] = newLeft;
            pcts[rightKey] = newRight;
            dragging.startX = e.clientX;

            self._updateAllocationDisplay(pcts.branch, pcts.trunk, pcts.root);
            if (callbacks.onAllocationChanged) {
                callbacks.onAllocationChanged(pcts.branch, pcts.trunk, pcts.root);
            }
        });

        document.addEventListener('mouseup', function () { dragging = null; });
    },

    /** Update the allocation bar visuals with percentages and optional spell counts. */
    _updateAllocationDisplay: function (pctBranches, pctTrunk, pctRoot, schoolSpellCount) {
        var counts = schoolSpellCount || {};
        var sections = [
            { id: 'tgTreeAllocBranch', pct: pctBranches, key: 'branch' },
            { id: 'tgTreeAllocTrunk', pct: pctTrunk, key: 'trunk' },
            { id: 'tgTreeAllocRoot', pct: pctRoot, key: 'root' }
        ];
        for (var i = 0; i < sections.length; i++) {
            var sec = sections[i];
            var el = document.getElementById(sec.id);
            if (!el) continue;
            el.style.flexBasis = sec.pct + '%';
            var pctSpan = el.querySelector('.tg-tree-alloc-pct');
            if (pctSpan) {
                var text = sec.pct + '%';
                if (counts[sec.key] !== undefined) text += ' (' + counts[sec.key] + ')';
                pctSpan.textContent = text;
            }
        }
    },

    /** Called when spell scan data changes. */
    updateScanStatus: function (hasSpells) {
        if (typeof TreeGrowth !== 'undefined') TreeGrowth.updateScanStatus(hasSpells);
    },

    /** Update button states after a tree is built or cleared. */
    setTreeBuilt: function (built, nodeCount, totalPool) {
        if (typeof TreeGrowth !== 'undefined') TreeGrowth.setTreeBuilt(built, nodeCount, totalPool);
    },

    /** Set the status text element's content and color. */
    setStatusText: function (text, color) {
        if (typeof TreeGrowth !== 'undefined') TreeGrowth.setStatusText(text, color);
    },

    /** Enable or disable the Build Tree button based on current state. @private */
    _updateBuildButton: function () {
        if (typeof TreeGrowth !== 'undefined') TreeGrowth.updateBuildButton();
    }
};

console.log('[TreeSettings] Loaded');
