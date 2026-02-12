/**
 * GraphRenderer Module - Canvas rendering for Graph Growth mode
 *
 * Draws edges (straight or Bezier curved), level-differentiated spell nodes,
 * optional affinity debug overlay, and root markers onto a Canvas 2D context.
 * Graph mode visualizes globally optimal arborescence trees.
 *
 * Usage:
 *   GraphRenderer.renderEdges(ctx, cx, cy, nodes, schoolColor, opacity, curved);
 *   GraphRenderer.renderNodes(ctx, cx, cy, nodes, schoolColor, opacity, nodeRadius);
 *   GraphRenderer.renderAffinityOverlay(ctx, cx, cy, affinityPairs, opacity);
 *   GraphRenderer.renderRootMarker(ctx, x, y, color, radius);
 *
 * Depends on: (none — self-contained)
 */

var GraphRenderer = {

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
     * Render parent→child edges for all positioned nodes.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} cx - Canvas center X offset
     * @param {number} cy - Canvas center Y offset
     * @param {Array} nodes - Positioned nodes with x, y, parentFormId, formId
     * @param {string} schoolColor - Hex color for this school
     * @param {number} opacity - Base opacity 0..1
     * @param {boolean} curved - If true, draw quadratic Bezier curves
     */
    renderEdges: function (ctx, cx, cy, nodes, schoolColor, opacity, curved) {
        if (!nodes || nodes.length === 0) return;

        // Build position lookup
        var posMap = {};
        for (var i = 0; i < nodes.length; i++) {
            posMap[nodes[i].formId] = nodes[i];
        }

        ctx.save();

        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (!node.parentFormId) continue;
            var parent = posMap[node.parentFormId];
            if (!parent) continue;

            var x1 = cx + parent.x;
            var y1 = cy + parent.y;
            var x2 = cx + node.x;
            var y2 = cy + node.y;

            // Glow pass
            ctx.beginPath();
            if (curved) {
                var cpx = (x1 + x2) / 2 + (y2 - y1) * 0.15;
                var cpy = (y1 + y2) / 2 - (x2 - x1) * 0.15;
                ctx.moveTo(x1, y1);
                ctx.quadraticCurveTo(cpx, cpy, x2, y2);
            } else {
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
            }
            ctx.strokeStyle = this._hexToRgba(schoolColor, opacity * 0.15);
            ctx.lineWidth = 4;
            ctx.stroke();

            // Main edge
            ctx.beginPath();
            if (curved) {
                var cpx2 = (x1 + x2) / 2 + (y2 - y1) * 0.15;
                var cpy2 = (y1 + y2) / 2 - (x2 - x1) * 0.15;
                ctx.moveTo(x1, y1);
                ctx.quadraticCurveTo(cpx2, cpy2, x2, y2);
            } else {
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
            }
            ctx.strokeStyle = this._hexToRgba(schoolColor, opacity * 0.7);
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        ctx.restore();
    },

    // =========================================================================
    // NODE RENDERING
    // =========================================================================

    /**
     * Render spell nodes with tier-differentiated shapes.
     * Novice/Apprentice = circles, Adept/Expert = diamonds, Master = stars.
     */
    renderNodes: function (ctx, cx, cy, nodes, schoolColor, opacity, nodeRadius) {
        if (!nodes || nodes.length === 0) return;

        ctx.save();

        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var x = cx + node.x;
            var y = cy + node.y;
            var sl = node.skillLevel || 'Apprentice';
            var sizeMult = this._sizeTable[sl] || 1.0;
            var brightMult = this._brightnessTable[sl] || 0.5;
            var r = nodeRadius * sizeMult;

            // Choose shape based on skill level
            if (sl === 'Master') {
                this._drawStarNode(ctx, x, y, r, schoolColor, opacity, brightMult);
            } else if (sl === 'Expert' || sl === 'Adept') {
                this._drawDiamondNode(ctx, x, y, r, schoolColor, opacity, brightMult);
            } else {
                this._drawCircleNode(ctx, x, y, r, schoolColor, opacity, brightMult);
            }
        }

        ctx.restore();
    },

    _drawCircleNode: function (ctx, x, y, r, color, opacity, bright) {
        // Glow
        ctx.beginPath();
        ctx.arc(x, y, r * 1.8, 0, Math.PI * 2);
        ctx.fillStyle = this._hexToRgba(color, opacity * 0.12 * bright);
        ctx.fill();

        // Body
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = this._hexToRgba(color, opacity * 0.6 * Math.min(bright, 1.2));
        ctx.fill();

        // Border
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = this._hexToRgba(color, opacity * 0.9);
        ctx.lineWidth = 0.8;
        ctx.stroke();
    },

    _drawDiamondNode: function (ctx, x, y, r, color, opacity, bright) {
        // Glow
        ctx.beginPath();
        var gr = r * 1.8;
        ctx.moveTo(x, y - gr); ctx.lineTo(x + gr, y); ctx.lineTo(x, y + gr); ctx.lineTo(x - gr, y);
        ctx.closePath();
        ctx.fillStyle = this._hexToRgba(color, opacity * 0.12 * bright);
        ctx.fill();

        // Body
        ctx.beginPath();
        ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y);
        ctx.closePath();
        ctx.fillStyle = this._hexToRgba(color, opacity * 0.6 * Math.min(bright, 1.2));
        ctx.fill();

        // Border
        ctx.beginPath();
        ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y);
        ctx.closePath();
        ctx.strokeStyle = this._hexToRgba(color, opacity * 0.9);
        ctx.lineWidth = 0.8;
        ctx.stroke();
    },

    _drawStarNode: function (ctx, x, y, r, color, opacity, bright) {
        var points = 5;
        var outerR = r;
        var innerR = r * 0.45;

        // Glow
        ctx.beginPath();
        this._starPath(ctx, x, y, outerR * 1.8, innerR * 1.8, points);
        ctx.fillStyle = this._hexToRgba(color, opacity * 0.15 * bright);
        ctx.fill();

        // Body
        ctx.beginPath();
        this._starPath(ctx, x, y, outerR, innerR, points);
        ctx.fillStyle = this._hexToRgba(color, opacity * 0.7 * Math.min(bright, 1.2));
        ctx.fill();

        // Border
        ctx.beginPath();
        this._starPath(ctx, x, y, outerR, innerR, points);
        ctx.strokeStyle = this._hexToRgba(color, opacity * 0.95);
        ctx.lineWidth = 0.8;
        ctx.stroke();

        // Center ring (Master highlight)
        ctx.beginPath();
        ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
        ctx.strokeStyle = this._hexToRgba('#ffffff', opacity * 0.3);
        ctx.lineWidth = 0.5;
        ctx.stroke();
    },

    _starPath: function (ctx, cx, cy, outerR, innerR, points) {
        var step = Math.PI / points;
        ctx.moveTo(cx, cy - outerR);
        for (var i = 0; i < 2 * points; i++) {
            var r = (i % 2 === 0) ? outerR : innerR;
            var angle = -Math.PI / 2 + (i + 1) * step;
            ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
        }
        ctx.closePath();
    },

    // =========================================================================
    // AFFINITY OVERLAY (DEBUG)
    // =========================================================================

    /**
     * Render faint dashed lines between high-affinity spell pairs that
     * aren't connected by a parent-child edge. Debug visualization.
     *
     * @param {Array} affinityPairs - Array of { fromFormId, toFormId, score }
     * @param {Object} posMap - formId -> {x, y}
     */
    renderAffinityOverlay: function (ctx, cx, cy, affinityPairs, posMap, opacity) {
        if (!affinityPairs || affinityPairs.length === 0 || !posMap) return;

        ctx.save();
        ctx.setLineDash([2, 4]);
        ctx.lineWidth = 0.5;

        for (var i = 0; i < affinityPairs.length; i++) {
            var pair = affinityPairs[i];
            var from = posMap[pair.fromFormId];
            var to = posMap[pair.toFormId];
            if (!from || !to) continue;

            var alpha = Math.min(0.3, (pair.score || 0.5) * 0.4) * opacity;
            ctx.beginPath();
            ctx.moveTo(cx + from.x, cy + from.y);
            ctx.lineTo(cx + to.x, cy + to.y);
            ctx.strokeStyle = 'rgba(184, 168, 120, ' + alpha + ')';
            ctx.stroke();
        }

        ctx.setLineDash([]);
        ctx.restore();
    },

    // =========================================================================
    // ROOT MARKER
    // =========================================================================

    renderRootMarker: function (ctx, x, y, color, radius) {
        var r = (radius || 5) * 2.2;
        ctx.save();

        // Outer glow ring
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = this._hexToRgba(color, 0.4);
        ctx.lineWidth = 2;
        ctx.stroke();

        // Inner bright ring
        ctx.beginPath();
        ctx.arc(x, y, r * 0.7, 0, Math.PI * 2);
        ctx.strokeStyle = this._hexToRgba(color, 0.6);
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.restore();
    },

    // =========================================================================
    // UTILITIES
    // =========================================================================

    _hexToRgba: function (hex, alpha) {
        if (typeof hexToRgba === 'function') return hexToRgba(hex, alpha);

        // Fallback inline parser
        var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (!result) return 'rgba(128,128,128,' + alpha + ')';
        var r = parseInt(result[1], 16);
        var g = parseInt(result[2], 16);
        var b = parseInt(result[3], 16);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    }
};
