/**
 * ThematicRenderer Module - Canvas rendering for Thematic Growth mode
 *
 * Draws theme-colored branch spines, branch labels, parent/child edges,
 * and level-differentiated spell nodes onto a Canvas 2D context. Nodes use
 * shapes determined by skillLevel (Novice/Apprentice = circles, Adept/Expert
 * = diamonds, Master = stars) but colors come from themeColor instead of
 * school color.
 *
 * Usage:
 *   ThematicRenderer.renderBranchSpines(ctx, cx, cy, branches, layoutData, opacity);
 *   ThematicRenderer.renderBranchLabels(ctx, cx, cy, branches, layoutData, opacity);
 *   ThematicRenderer.renderEdges(ctx, cx, cy, nodes, opacity);
 *   ThematicRenderer.renderNodes(ctx, cx, cy, nodes, opacity, nodeRadius);
 *   ThematicRenderer.renderTrunkEmphasis(ctx, cx, cy, trunkNodes, opacity);
 *   ThematicRenderer.renderRootMarker(ctx, x, y, color, radius);
 *
 * Depends on: nothing (self-contained utility)
 */

var ThematicRenderer = {

    // =========================================================================
    // SIZE MULTIPLIERS PER SKILL LEVEL
    // =========================================================================

    _sizeTable: {
        'Novice':     0.8,
        'Apprentice': 1.0,
        'Adept':      1.2,
        'Expert':     1.4,
        'Master':     1.8
    },

    // Brightness multiplier per skill level (Novice dimmest -> Master brightest)
    _brightnessTable: {
        'Novice':     0.3,
        'Apprentice': 0.5,
        'Adept':      0.8,
        'Expert':     1.2,
        'Master':     1.8
    },

    // =========================================================================
    // BRANCH SPINE RENDERING
    // =========================================================================

    /**
     * Draw thick colored lines connecting nodes within each theme branch.
     * This is the primary visual differentiator from Classic mode.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} cx - Canvas center X offset
     * @param {number} cy - Canvas center Y offset
     * @param {Array} branches - Array of { name, themeColor, nodeFormIds }
     * @param {Object} layoutData - { schools: { name: { nodes: [...] } } }
     * @param {number} opacity - Base opacity 0..1
     */
    renderBranchSpines: function (ctx, cx, cy, branches, layoutData, opacity) {
        if (!branches || branches.length === 0) return;

        // Build a global formId -> node position lookup from layoutData
        var posLookup = {};
        if (layoutData && layoutData.schools) {
            for (var sn in layoutData.schools) {
                if (!layoutData.schools.hasOwnProperty(sn)) continue;
                var nodes = layoutData.schools[sn].nodes || [];
                for (var ni = 0; ni < nodes.length; ni++) {
                    var n = nodes[ni];
                    if (n.formId) posLookup[n.formId] = n;
                }
            }
        }

        ctx.save();
        for (var bi = 0; bi < branches.length; bi++) {
            var branch = branches[bi];
            var color = branch.themeColor || '#888888';
            var formIds = branch.nodeFormIds || [];
            if (formIds.length < 2) continue;

            ctx.strokeStyle = this._hexToRgba(color, opacity * 0.6);
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();

            var started = false;
            for (var fi = 0; fi < formIds.length; fi++) {
                var node = posLookup[formIds[fi]];
                if (!node) continue;
                if (!started) {
                    ctx.moveTo(cx + node.x, cy + node.y);
                    started = true;
                } else {
                    ctx.lineTo(cx + node.x, cy + node.y);
                }
            }
            ctx.stroke();
        }
        ctx.restore();
    },

    // =========================================================================
    // BRANCH LABEL RENDERING
    // =========================================================================

    /**
     * Draw theme name text along each branch spine. 9px font, rotated to
     * follow spine direction, with text shadow for readability.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} cx - Canvas center X offset
     * @param {number} cy - Canvas center Y offset
     * @param {Array} branches - Array of { name, themeColor, nodeFormIds }
     * @param {Object} layoutData - { schools: { name: { nodes: [...] } } }
     * @param {number} opacity - Base opacity 0..1
     */
    renderBranchLabels: function (ctx, cx, cy, branches, layoutData, opacity) {
        if (!branches || branches.length === 0) return;

        // Build a global formId -> node position lookup from layoutData
        var posLookup = {};
        if (layoutData && layoutData.schools) {
            for (var sn in layoutData.schools) {
                if (!layoutData.schools.hasOwnProperty(sn)) continue;
                var nodes = layoutData.schools[sn].nodes || [];
                for (var ni = 0; ni < nodes.length; ni++) {
                    var n = nodes[ni];
                    if (n.formId) posLookup[n.formId] = n;
                }
            }
        }

        ctx.save();
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (var bi = 0; bi < branches.length; bi++) {
            var branch = branches[bi];
            var label = branch.name || '';
            if (!label) continue;
            var color = branch.themeColor || '#888888';
            var formIds = branch.nodeFormIds || [];
            if (formIds.length < 2) continue;

            // Find start and end positions for direction
            var startNode = null;
            var endNode = null;
            for (var fi = 0; fi < formIds.length; fi++) {
                var node = posLookup[formIds[fi]];
                if (!node) continue;
                if (!startNode) startNode = node;
                endNode = node;
            }
            if (!startNode || !endNode || (startNode === endNode)) continue;

            // Compute midpoint and angle
            var midX = cx + (startNode.x + endNode.x) / 2;
            var midY = cy + (startNode.y + endNode.y) / 2;
            var angle = Math.atan2(endNode.y - startNode.y, endNode.x - startNode.x);

            // Keep text readable (flip if upside-down)
            if (angle > Math.PI / 2) angle -= Math.PI;
            if (angle < -Math.PI / 2) angle += Math.PI;

            ctx.save();
            ctx.translate(midX, midY);
            ctx.rotate(angle);

            // Text shadow for readability
            ctx.fillStyle = 'rgba(0, 0, 0, ' + (opacity * 0.6) + ')';
            ctx.fillText(label, 1, 1);

            // Actual label text
            ctx.fillStyle = this._hexToRgba(color, opacity * 0.8);
            ctx.fillText(label, 0, 0);

            ctx.restore();
        }
        ctx.restore();
    },

    // =========================================================================
    // EDGE RENDERING
    // =========================================================================

    /**
     * Draw edges between nodes. Intra-theme edges are 2px and theme-colored.
     * Cross-theme edges are 1px and dimmer.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} cx - Canvas center X offset
     * @param {number} cy - Canvas center Y offset
     * @param {Array} nodes - Array of { x, y, formId, parentFormId, theme, themeColor, ... }
     * @param {number} opacity - Base opacity 0..1
     */
    renderEdges: function (ctx, cx, cy, nodes, opacity) {
        if (!nodes || nodes.length === 0) return;

        // Build a quick formId -> node lookup
        var lookup = {};
        var i, node;
        for (i = 0; i < nodes.length; i++) {
            node = nodes[i];
            if (node.formId !== undefined && node.formId !== null) {
                lookup[node.formId] = node;
            }
        }

        ctx.save();

        // First pass: cross-theme edges (underneath, dimmer)
        ctx.lineWidth = 1;
        ctx.beginPath();
        var crossColor = 'rgba(184, 168, 120, ' + (opacity * 0.15) + ')';
        ctx.strokeStyle = crossColor;
        for (i = 0; i < nodes.length; i++) {
            node = nodes[i];
            if (node.parentFormId === undefined || node.parentFormId === null) continue;
            var parent = lookup[node.parentFormId];
            if (!parent) continue;
            if (node.theme && parent.theme && node.theme === parent.theme) continue; // skip same-theme
            ctx.moveTo(cx + parent.x, cy + parent.y);
            ctx.lineTo(cx + node.x, cy + node.y);
        }
        ctx.stroke();

        // Second pass: intra-theme edges (on top, theme-colored, thicker)
        // Group by theme color for batch drawing
        var themeEdges = {};
        for (i = 0; i < nodes.length; i++) {
            node = nodes[i];
            if (node.parentFormId === undefined || node.parentFormId === null) continue;
            var parent2 = lookup[node.parentFormId];
            if (!parent2) continue;
            if (!node.theme || !parent2.theme || node.theme !== parent2.theme) continue;
            var tc = node.themeColor || '#888888';
            if (!themeEdges[tc]) themeEdges[tc] = [];
            themeEdges[tc].push({ px: parent2.x, py: parent2.y, nx: node.x, ny: node.y });
        }

        ctx.lineWidth = 2;
        for (var color in themeEdges) {
            if (!themeEdges.hasOwnProperty(color)) continue;
            ctx.strokeStyle = this._hexToRgba(color, opacity * 0.4);
            ctx.beginPath();
            var edges = themeEdges[color];
            for (var ei = 0; ei < edges.length; ei++) {
                ctx.moveTo(cx + edges[ei].px, cy + edges[ei].py);
                ctx.lineTo(cx + edges[ei].nx, cy + edges[ei].ny);
            }
            ctx.stroke();
        }

        ctx.restore();
    },

    // =========================================================================
    // NODE RENDERING
    // =========================================================================

    /**
     * Draw all nodes with shape/size based on skillLevel, colored by themeColor.
     * Same tier-based shapes as ClassicRenderer: circles for Novice/Apprentice,
     * diamonds for Adept/Expert, stars for Master.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} cx - Canvas center X offset
     * @param {number} cy - Canvas center Y offset
     * @param {Array} nodes - Array of { x, y, formId, tier, skillLevel, name, themeColor }
     * @param {number} opacity - Base opacity 0..1
     * @param {number} nodeRadius - Base node radius in pixels
     */
    renderNodes: function (ctx, cx, cy, nodes, opacity, nodeRadius) {
        if (!nodes || nodes.length === 0) return;

        // Group nodes by level AND themeColor for batched rendering
        var groups = {};
        var i, node, level, tc, key;
        for (i = 0; i < nodes.length; i++) {
            node = nodes[i];
            level = node.skillLevel || '';
            tc = node.themeColor || '#888888';
            key = level + '|' + tc;
            if (!groups[key]) groups[key] = { level: level, color: tc, nodes: [] };
            groups[key].nodes.push(node);
        }

        var self = this;
        for (var gk in groups) {
            if (!groups.hasOwnProperty(gk)) continue;
            var group = groups[gk];
            var lvl = group.level;
            var color = group.color;
            var gNodes = group.nodes;
            var mult = self._sizeTable[lvl];
            if (mult === undefined) mult = 1.0;
            var bright = self._brightnessTable[lvl];
            if (bright === undefined) bright = 0.5;
            var nodeOp = opacity * bright;
            var sz = nodeRadius * mult;

            // Glow pass
            ctx.fillStyle = self._hexToRgba(color, nodeOp * 0.15);
            ctx.beginPath();
            for (i = 0; i < gNodes.length; i++) { self._addShapePath(ctx, lvl, cx + gNodes[i].x, cy + gNodes[i].y, sz + 3); }
            ctx.fill();

            // Body pass
            ctx.fillStyle = self._hexToRgba(color, nodeOp);
            ctx.beginPath();
            for (i = 0; i < gNodes.length; i++) { self._addShapePath(ctx, lvl, cx + gNodes[i].x, cy + gNodes[i].y, sz); }
            ctx.fill();

            // Expert: outer stroke ring
            if (lvl === 'Expert') {
                ctx.strokeStyle = self._hexToRgba(color, nodeOp * 0.5);
                ctx.lineWidth = 1.0;
                ctx.beginPath();
                for (i = 0; i < gNodes.length; i++) { self._addShapePath(ctx, lvl, cx + gNodes[i].x, cy + gNodes[i].y, sz + 1.5); }
                ctx.stroke();
            }

            // Master: glow ring
            if (lvl === 'Master') {
                ctx.strokeStyle = self._hexToRgba(color, nodeOp * 0.35);
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                for (i = 0; i < gNodes.length; i++) {
                    var mgx = cx + gNodes[i].x, mgy = cy + gNodes[i].y;
                    ctx.moveTo(mgx + sz + 4, mgy);
                    ctx.arc(mgx, mgy, sz + 4, 0, Math.PI * 2);
                }
                ctx.stroke();
            }

            // Border pass
            ctx.strokeStyle = 'rgba(255, 255, 255, ' + (nodeOp * 0.3) + ')';
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            for (i = 0; i < gNodes.length; i++) { self._addShapePath(ctx, lvl, cx + gNodes[i].x, cy + gNodes[i].y, sz); }
            ctx.stroke();
        }
    },

    // =========================================================================
    // TRUNK EMPHASIS
    // =========================================================================

    /**
     * Draw the root theme chain with extra glow/thickness to make the trunk
     * visually prominent.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} cx - Canvas center X offset
     * @param {number} cy - Canvas center Y offset
     * @param {Array} trunkNodes - Ordered array of { x, y, themeColor } for the trunk chain
     * @param {number} opacity - Base opacity 0..1
     */
    renderTrunkEmphasis: function (ctx, cx, cy, trunkNodes, opacity) {
        if (!trunkNodes || trunkNodes.length < 2) return;

        var color = trunkNodes[0].themeColor || '#888888';

        ctx.save();

        // Outer glow
        ctx.strokeStyle = this._hexToRgba(color, opacity * 0.2);
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(cx + trunkNodes[0].x, cy + trunkNodes[0].y);
        for (var i = 1; i < trunkNodes.length; i++) {
            ctx.lineTo(cx + trunkNodes[i].x, cy + trunkNodes[i].y);
        }
        ctx.stroke();

        // Inner bright line
        ctx.strokeStyle = this._hexToRgba(color, opacity * 0.5);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx + trunkNodes[0].x, cy + trunkNodes[0].y);
        for (var j = 1; j < trunkNodes.length; j++) {
            ctx.lineTo(cx + trunkNodes[j].x, cy + trunkNodes[j].y);
        }
        ctx.stroke();

        ctx.restore();
    },

    // =========================================================================
    // ROOT MARKER
    // =========================================================================

    /**
     * Draw a special ring around a root node to visually distinguish it.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} x - Node center X (already in canvas coords)
     * @param {number} y - Node center Y
     * @param {string} color - Hex color (unused; marker is always white)
     * @param {number} radius - Base node radius
     */
    renderRootMarker: function (ctx, x, y, color, radius) {
        ctx.beginPath();
        ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    },

    // =========================================================================
    // SHAPE DISPATCHERS (fill / stroke by skill level)
    // =========================================================================

    /** Add shape sub-path without beginPath/fill/stroke (for batching) */
    _addShapePath: function (ctx, level, x, y, size) {
        if (level === 'Adept' || level === 'Expert') {
            this._drawDiamond(ctx, x, y, size);
        } else if (level === 'Master') {
            this._drawStar(ctx, x, y, size, size * 0.5, 5);
        } else {
            ctx.moveTo(x + size, y);
            ctx.arc(x, y, size, 0, Math.PI * 2);
        }
    },

    // =========================================================================
    // HELPERS
    // =========================================================================

    /**
     * Draw a diamond (rotated square) path. Does NOT call fill/stroke.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} x - Center X
     * @param {number} y - Center Y
     * @param {number} size - Half-diagonal length
     */
    _drawDiamond: function (ctx, x, y, size) {
        ctx.moveTo(x, y - size);
        ctx.lineTo(x + size, y);
        ctx.lineTo(x, y + size);
        ctx.lineTo(x - size, y);
        ctx.closePath();
    },

    /**
     * Draw a star shape path. Does NOT call fill/stroke.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} x - Center X
     * @param {number} y - Center Y
     * @param {number} outerR - Outer point radius
     * @param {number} innerR - Inner notch radius
     * @param {number} [points] - Number of star points (default 5)
     */
    _drawStar: function (ctx, x, y, outerR, innerR, points) {
        points = points || 5;
        var step = Math.PI / points;
        var angle = -Math.PI / 2; // start pointing up
        var i;

        ctx.moveTo(
            x + Math.cos(angle) * outerR,
            y + Math.sin(angle) * outerR
        );

        for (i = 0; i < points * 2; i++) {
            angle += step;
            var r = (i % 2 === 0) ? innerR : outerR;
            ctx.lineTo(
                x + Math.cos(angle) * r,
                y + Math.sin(angle) * r
            );
        }

        ctx.closePath();
    },

    /**
     * Convert a "#RRGGBB" hex string to an "rgba(r,g,b,alpha)" string.
     * Falls back to gray if the hex value is invalid.
     *
     * @param {string} hex - Color in "#RRGGBB" format
     * @param {number} alpha - Opacity 0..1
     * @returns {string} CSS rgba() color string
     */
    _hexToRgba: function (hex, alpha) { return hexToRgba(hex, alpha); }
};

console.log('[ThematicRenderer] Loaded');
