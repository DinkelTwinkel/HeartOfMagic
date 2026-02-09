/**
 * TreeRenderer Module - Canvas rendering for Tree Growth mode
 *
 * Draws trunk corridors, edges, and tier-differentiated spell nodes onto a
 * Canvas 2D context. Nodes with a skillLevel get shape/size/brightness
 * matching ClassicRenderer's visual language:
 *   - Novice/Apprentice: circle (small/dim → medium)
 *   - Adept/Expert: diamond (larger, brighter; Expert gets double border)
 *   - Master: star (largest, brightest, glow ring)
 *
 * Ghost preview nodes (no skillLevel) render as plain translucent circles.
 *
 * Usage:
 *   TreeRenderer.renderCorridors(ctx, cx, cy, corridors, opacity);
 *   TreeRenderer.renderEdges(ctx, cx, cy, edges, opacity);
 *   TreeRenderer.renderNodes(ctx, cx, cy, nodes, opacity, nodeRadius);
 *   TreeRenderer.renderGhostNodes(ctx, cx, cy, placements, opacity, nodeRadius);
 *
 * Depends on: nothing (self-contained utility)
 */

var TreeRenderer = {

    // =====================================================================
    // TIER VISUAL TABLES (matches ClassicRenderer)
    // =====================================================================

    _sizeTable: {
        'Novice':     0.8,
        'Apprentice': 1.0,
        'Adept':      1.2,
        'Expert':     1.4,
        'Master':     1.8
    },

    _brightnessTable: {
        'Novice':     0.3,
        'Apprentice': 0.5,
        'Adept':      0.8,
        'Expert':     1.2,
        'Master':     1.8
    },

    // =====================================================================
    // TRUNK CORRIDOR RENDERING
    // =====================================================================

    /**
     * Draw the trunk corridor as two semi-transparent boundary lines.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} cx - Canvas center X
     * @param {number} cy - Canvas center Y
     * @param {Array} corridors - Array of corridor objects (4-point rectangles)
     * @param {number} opacity - Base opacity 0..1
     */
    renderCorridors: function(ctx, cx, cy, corridors, opacity) {
        for (var i = 0; i < corridors.length; i++) {
            var c = corridors[i];
            if (c.x1 === undefined) continue;
            var color = c.color || '#888888';

            // Filled rectangle (very faint)
            ctx.beginPath();
            ctx.moveTo(cx + c.x1, cy + c.y1);
            ctx.lineTo(cx + c.x2, cy + c.y2);
            ctx.lineTo(cx + c.x3, cy + c.y3);
            ctx.lineTo(cx + c.x4, cy + c.y4);
            ctx.closePath();
            ctx.fillStyle = this._hexToRgba(color, opacity * 0.08);
            ctx.fill();

            // Two parallel edge lines (trunk boundaries)
            ctx.strokeStyle = this._hexToRgba(color, opacity * 0.25);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(cx + c.x1, cy + c.y1);
            ctx.lineTo(cx + c.x2, cy + c.y2);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(cx + c.x4, cy + c.y4);
            ctx.lineTo(cx + c.x3, cy + c.y3);
            ctx.stroke();
        }
    },

    // =====================================================================
    // EDGE RENDERING
    // =====================================================================

    /**
     * Draw edges (lines) between connected tree nodes.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} cx - Canvas center X
     * @param {number} cy - Canvas center Y
     * @param {Array} edges - Array of { x1, y1, x2, y2, color }
     * @param {number} opacity - Base opacity 0..1
     */
    renderEdges: function(ctx, cx, cy, edges, opacity) {
        ctx.lineCap = 'round';
        for (var i = 0; i < edges.length; i++) {
            var e = edges[i];
            var color = e.color || '#b8a878';

            // Glow pass (wider, faint)
            ctx.beginPath();
            ctx.moveTo(cx + e.x1, cy + e.y1);
            ctx.lineTo(cx + e.x2, cy + e.y2);
            ctx.strokeStyle = this._hexToRgba(color, opacity * 0.15);
            ctx.lineWidth = 4;
            ctx.stroke();

            // Main line
            ctx.beginPath();
            ctx.moveTo(cx + e.x1, cy + e.y1);
            ctx.lineTo(cx + e.x2, cy + e.y2);
            ctx.strokeStyle = this._hexToRgba(color, opacity * 0.7);
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
    },

    // =====================================================================
    // TIER-DIFFERENTIATED NODE RENDERING
    // =====================================================================

    /**
     * Draw built tree nodes with shape/size/brightness based on skillLevel.
     * Nodes must include { x, y, color, skillLevel }.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} cx - Canvas center X
     * @param {number} cy - Canvas center Y
     * @param {Array} nodes - Array of { x, y, color, skillLevel }
     * @param {number} opacity - Base opacity 0..1
     * @param {number} nodeRadius - Base node radius px
     */
    renderNodes: function(ctx, cx, cy, nodes, opacity, nodeRadius) {
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            var px = cx + n.x;
            var py = cy + n.y;
            var color = n.color || '#888888';

            var level = n.skillLevel || '';
            var mult = this._sizeTable[level];
            if (mult === undefined) mult = 1.0;
            var size = nodeRadius * mult;

            var bright = this._brightnessTable[level];
            if (bright === undefined) bright = 0.5;
            var nodeOp = opacity * bright;

            // Glow (outer soft fill)
            ctx.fillStyle = this._hexToRgba(color, nodeOp * 0.15);
            this._fillShape(ctx, level, px, py, size + 3);

            // Body
            ctx.fillStyle = this._hexToRgba(color, nodeOp);
            this._fillShape(ctx, level, px, py, size);

            // Expert: double border
            if (level === 'Expert') {
                ctx.strokeStyle = this._hexToRgba(color, nodeOp * 0.5);
                ctx.lineWidth = 1.0;
                this._strokeShape(ctx, level, px, py, size + 1.5);
            }

            // Master: glow ring
            if (level === 'Master') {
                ctx.beginPath();
                ctx.arc(px, py, size + 4, 0, Math.PI * 2);
                ctx.strokeStyle = this._hexToRgba(color, nodeOp * 0.35);
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }

            // Border
            ctx.strokeStyle = 'rgba(255, 255, 255, ' + (nodeOp * 0.3) + ')';
            ctx.lineWidth = 0.5;
            this._strokeShape(ctx, level, px, py, size);
        }
    },

    // =====================================================================
    // GHOST NODE RENDERING (pre-build preview, no tier info)
    // =====================================================================

    /**
     * Draw ghost nodes as plain translucent circles (pre-build preview).
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} cx - Canvas center X
     * @param {number} cy - Canvas center Y
     * @param {Array} placements - Array of { x, y, color }
     * @param {number} opacity - Ghost opacity 0..1
     * @param {number} nodeRadius - Base node radius px
     */
    renderGhostNodes: function(ctx, cx, cy, placements, opacity, nodeRadius) {
        for (var i = 0; i < placements.length; i++) {
            var p = placements[i];
            var gx = cx + p.x;
            var gy = cy + p.y;

            // Glow
            ctx.beginPath();
            ctx.arc(gx, gy, nodeRadius + 2, 0, Math.PI * 2);
            ctx.fillStyle = this._hexToRgba(p.color, opacity * 0.3);
            ctx.fill();

            // Body
            ctx.beginPath();
            ctx.arc(gx, gy, nodeRadius, 0, Math.PI * 2);
            ctx.fillStyle = this._hexToRgba(p.color, opacity);
            ctx.fill();

            // Border
            ctx.strokeStyle = 'rgba(255, 255, 255, ' + (opacity * 0.3) + ')';
            ctx.lineWidth = 0.5;
            ctx.stroke();
        }
    },

    // =====================================================================
    // SHAPE DISPATCHERS
    // =====================================================================

    _fillShape: function(ctx, level, x, y, size) {
        if (level === 'Adept' || level === 'Expert') {
            ctx.beginPath();
            this._drawDiamond(ctx, x, y, size);
            ctx.fill();
        } else if (level === 'Master') {
            ctx.beginPath();
            this._drawStar(ctx, x, y, size, size * 0.5, 5);
            ctx.fill();
        } else {
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();
        }
    },

    _strokeShape: function(ctx, level, x, y, size) {
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

    // =====================================================================
    // HELPERS
    // =====================================================================

    _drawDiamond: function(ctx, x, y, size) {
        ctx.moveTo(x, y - size);
        ctx.lineTo(x + size, y);
        ctx.lineTo(x, y + size);
        ctx.lineTo(x - size, y);
        ctx.closePath();
    },

    _drawStar: function(ctx, x, y, outerR, innerR, points) {
        points = points || 5;
        var step = Math.PI / points;
        var angle = -Math.PI / 2;

        ctx.moveTo(
            x + Math.cos(angle) * outerR,
            y + Math.sin(angle) * outerR
        );

        for (var i = 0; i < points * 2; i++) {
            angle += step;
            var r = (i % 2 === 0) ? innerR : outerR;
            ctx.lineTo(
                x + Math.cos(angle) * r,
                y + Math.sin(angle) * r
            );
        }

        ctx.closePath();
    },

    _hexToRgba: function(hex, alpha) { return hexToRgba(hex, alpha); }
};

console.log('[TreeRenderer] Loaded');
