/**
 * ClassicRenderer Module - Canvas rendering for Classic Growth mode
 *
 * Draws parent/child edges and level-differentiated spell nodes onto a
 * Canvas 2D context. Nodes are rendered with shapes and sizes determined
 * by their skillLevel (Novice, Apprentice, Adept, Expert, Master).
 *
 * Usage:
 *   ClassicRenderer.renderEdges(ctx, cx, cy, nodes, schoolColor, opacity);
 *   ClassicRenderer.renderNodes(ctx, cx, cy, nodes, schoolColor, opacity, nodeRadius);
 *   ClassicRenderer.renderRootMarker(ctx, x, y, color, radius);
 *
 * Depends on: nothing (self-contained utility)
 */

var ClassicRenderer = {

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

    // Brightness multiplier per skill level (Novice dimmest → Master brightest)
    // Values above 1.0 intentionally push opacity past the base ghost opacity
    _brightnessTable: {
        'Novice':     0.3,
        'Apprentice': 0.5,
        'Adept':      0.8,
        'Expert':     1.2,
        'Master':     1.8
    },

    // =========================================================================
    // EDGE RENDERING
    // =========================================================================

    /**
     * Draw edges from parent nodes to child nodes (call BEFORE renderNodes).
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} cx  - Canvas center X offset
     * @param {number} cy  - Canvas center Y offset
     * @param {Array}  nodes - Array of { x, y, formId, parentFormId, ... }
     * @param {string} schoolColor - Hex color e.g. "#4488ff"
     * @param {number} opacity - Base opacity 0..1
     */
    renderEdges: function (ctx, cx, cy, nodes, schoolColor, opacity) {
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

        var edgeColor = this._hexToRgba(schoolColor, 0.3);

        ctx.save();
        ctx.strokeStyle = edgeColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();

        for (i = 0; i < nodes.length; i++) {
            node = nodes[i];
            if (node.parentFormId === undefined || node.parentFormId === null) continue;

            var parent = lookup[node.parentFormId];
            if (!parent) continue;

            ctx.moveTo(cx + parent.x, cy + parent.y);
            ctx.lineTo(cx + node.x, cy + node.y);
        }
        ctx.stroke();

        ctx.restore();
    },

    // =========================================================================
    // NODE RENDERING
    // =========================================================================

    /**
     * Draw all nodes with shape/size based on skillLevel.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} cx  - Canvas center X offset
     * @param {number} cy  - Canvas center Y offset
     * @param {Array}  nodes - Array of { x, y, formId, tier, skillLevel, name }
     * @param {string} schoolColor - Hex color e.g. "#4488ff"
     * @param {number} opacity - Base opacity 0..1
     * @param {number} nodeRadius - Base node radius in pixels
     */
    renderNodes: function (ctx, cx, cy, nodes, schoolColor, opacity, nodeRadius) {
        if (!nodes || nodes.length === 0) return;

        // Group nodes by level for batched rendering
        var levelGroups = {};
        var i, node, level;
        for (i = 0; i < nodes.length; i++) {
            node = nodes[i];
            level = node.skillLevel || '';
            if (!levelGroups[level]) levelGroups[level] = [];
            levelGroups[level].push(node);
        }

        var self = this;
        for (var lvl in levelGroups) {
            var group = levelGroups[lvl];
            var mult = self._sizeTable[lvl];
            if (mult === undefined) mult = 1.0;
            var bright = self._brightnessTable[lvl];
            if (bright === undefined) bright = 0.5;
            var nodeOp = opacity * bright;
            var sz = nodeRadius * mult;

            // Glow pass
            ctx.fillStyle = self._hexToRgba(schoolColor, nodeOp * 0.15);
            ctx.beginPath();
            for (i = 0; i < group.length; i++) { self._addShapePath(ctx, lvl, cx + group[i].x, cy + group[i].y, sz + 3); }
            ctx.fill();

            // Body pass
            ctx.fillStyle = self._hexToRgba(schoolColor, nodeOp);
            ctx.beginPath();
            for (i = 0; i < group.length; i++) { self._addShapePath(ctx, lvl, cx + group[i].x, cy + group[i].y, sz); }
            ctx.fill();

            // Expert: outer stroke ring
            if (lvl === 'Expert') {
                ctx.strokeStyle = self._hexToRgba(schoolColor, nodeOp * 0.5);
                ctx.lineWidth = 1.0;
                ctx.beginPath();
                for (i = 0; i < group.length; i++) { self._addShapePath(ctx, lvl, cx + group[i].x, cy + group[i].y, sz + 1.5); }
                ctx.stroke();
            }

            // Master: glow ring
            if (lvl === 'Master') {
                ctx.strokeStyle = self._hexToRgba(schoolColor, nodeOp * 0.35);
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                for (i = 0; i < group.length; i++) {
                    var mgx = cx + group[i].x, mgy = cy + group[i].y;
                    ctx.moveTo(mgx + sz + 4, mgy);
                    ctx.arc(mgx, mgy, sz + 4, 0, Math.PI * 2);
                }
                ctx.stroke();
            }

            // Border pass
            ctx.strokeStyle = 'rgba(255, 255, 255, ' + (nodeOp * 0.3) + ')';
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            for (i = 0; i < group.length; i++) { self._addShapePath(ctx, lvl, cx + group[i].x, cy + group[i].y, sz); }
            ctx.stroke();
        }
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

    _fillShape: function (ctx, level, x, y, size) {
        if (level === 'Adept' || level === 'Expert') {
            ctx.beginPath();
            this._drawDiamond(ctx, x, y, size);
            ctx.fill();
        } else if (level === 'Master') {
            ctx.beginPath();
            this._drawStar(ctx, x, y, size, size * 0.5, 5);
            ctx.fill();
        } else {
            // Novice, Apprentice, or default — circle
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();
        }
    },

    _strokeShape: function (ctx, level, x, y, size) {
        if (level === 'Adept' || level === 'Expert') {
            ctx.beginPath();
            this._drawDiamond(ctx, x, y, size);
            ctx.stroke();
        } else if (level === 'Master') {
            ctx.beginPath();
            this._drawStar(ctx, x, y, size, size * 0.5, 5);
            ctx.stroke();
        } else {
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.stroke();
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
