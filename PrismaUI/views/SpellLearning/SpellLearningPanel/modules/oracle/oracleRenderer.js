/**
 * OracleRenderer Module - Canvas rendering for Oracle Growth mode
 *
 * Draws parallel chain lane ribbons, intra/cross-chain edges, level-differentiated
 * spell nodes, and optional narrative labels onto a Canvas 2D context.
 * Oracle mode visualizes thematic chains as parallel lanes (like railroad tracks),
 * each chain being a track with spells as stations.
 *
 * Usage:
 *   OracleRenderer.renderChainLanes(ctx, cx, cy, chains, lanePositions, opacity);
 *   OracleRenderer.renderEdges(ctx, cx, cy, nodes, schoolColor, opacity);
 *   OracleRenderer.renderNodes(ctx, cx, cy, nodes, schoolColor, opacity, nodeRadius);
 *   OracleRenderer.renderNarrativeLabels(ctx, cx, cy, chains, lanePositions, opacity);
 *   OracleRenderer.renderRootMarker(ctx, x, y, color, radius);
 *
 * Depends on: colorUtils.js (hexToRgba global)
 */

var OracleRenderer = {

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
    // CHAIN LANE RENDERING
    // =========================================================================

    /**
     * Draw semi-transparent colored ribbons for each chain lane.
     * Each chain gets a slightly different hue within the school color to
     * visually distinguish parallel lanes.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} cx - Canvas center X offset
     * @param {number} cy - Canvas center Y offset
     * @param {Array} chains - Array of { name, narrative, nodes[], color }
     * @param {Array} lanePositions - Array of { startX, startY, endX, endY, width }
     *                                per chain, defining the lane ribbon geometry
     * @param {number} opacity - Base opacity 0..1
     */
    renderChainLanes: function (ctx, cx, cy, chains, lanePositions, opacity) {
        if (!chains || !lanePositions || chains.length === 0) return;

        ctx.save();

        for (var i = 0; i < chains.length; i++) {
            if (i >= lanePositions.length) break;
            var chain = chains[i];
            var lane = lanePositions[i];
            var laneColor = chain.color || '#888888';
            var laneWidth = lane.width || 12;

            // Compute lane direction vector
            var dx = lane.endX - lane.startX;
            var dy = lane.endY - lane.startY;
            var len = Math.sqrt(dx * dx + dy * dy);
            if (len < 1) continue;

            // Perpendicular vector for ribbon width
            var perpX = (-dy / len) * (laneWidth / 2);
            var perpY = (dx / len) * (laneWidth / 2);

            // Draw ribbon as a filled quadrilateral
            ctx.beginPath();
            ctx.moveTo(cx + lane.startX + perpX, cy + lane.startY + perpY);
            ctx.lineTo(cx + lane.endX + perpX,   cy + lane.endY + perpY);
            ctx.lineTo(cx + lane.endX - perpX,   cy + lane.endY - perpY);
            ctx.lineTo(cx + lane.startX - perpX, cy + lane.startY - perpY);
            ctx.closePath();

            ctx.fillStyle = this._hexToRgba(laneColor, opacity * 0.08);
            ctx.fill();

            // Ribbon border (subtle)
            ctx.strokeStyle = this._hexToRgba(laneColor, opacity * 0.15);
            ctx.lineWidth = 0.5;
            ctx.stroke();
        }

        ctx.restore();
    },

    // =========================================================================
    // EDGE RENDERING
    // =========================================================================

    /**
     * Draw edges between nodes. Intra-chain edges are thicker and brighter;
     * cross-chain edges (connecting chain roots to school root) are thinner
     * and dimmer.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} cx - Canvas center X offset
     * @param {number} cy - Canvas center Y offset
     * @param {Array} nodes - Array of { x, y, formId, parentFormId, chain, ... }
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

        ctx.save();

        // First pass: cross-chain edges (thinner, dimmer — drawn underneath)
        ctx.strokeStyle = this._hexToRgba(schoolColor, opacity * 0.15);
        ctx.lineWidth = 1;
        ctx.beginPath();

        for (i = 0; i < nodes.length; i++) {
            node = nodes[i];
            if (node.parentFormId === undefined || node.parentFormId === null) continue;
            var parent = lookup[node.parentFormId];
            if (!parent) continue;

            // Cross-chain: parent and child have different chain IDs
            if (node.chain !== parent.chain) {
                ctx.moveTo(cx + parent.x, cy + parent.y);
                ctx.lineTo(cx + node.x, cy + node.y);
            }
        }
        ctx.stroke();

        // Second pass: intra-chain edges (thicker, brighter — drawn on top)
        ctx.strokeStyle = this._hexToRgba(schoolColor, opacity * 0.4);
        ctx.lineWidth = 2;
        ctx.beginPath();

        for (i = 0; i < nodes.length; i++) {
            node = nodes[i];
            if (node.parentFormId === undefined || node.parentFormId === null) continue;
            var intraParent = lookup[node.parentFormId];
            if (!intraParent) continue;

            // Intra-chain: same chain ID
            if (node.chain === intraParent.chain) {
                ctx.moveTo(cx + intraParent.x, cy + intraParent.y);
                ctx.lineTo(cx + node.x, cy + node.y);
            }
        }
        ctx.stroke();

        ctx.restore();
    },

    // =========================================================================
    // NODE RENDERING
    // =========================================================================

    /**
     * Draw all nodes with shape/size based on skillLevel.
     * Uses the same tier-based shapes as ClassicRenderer:
     *   - Novice, Apprentice: circles
     *   - Adept, Expert: diamonds
     *   - Master: stars
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} cx - Canvas center X offset
     * @param {number} cy - Canvas center Y offset
     * @param {Array} nodes - Array of { x, y, formId, tier, skillLevel, name }
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
            if (!levelGroups.hasOwnProperty(lvl)) continue;
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
    // NARRATIVE LABEL RENDERING
    // =========================================================================

    /**
     * Draw chain name text along each lane spine when showNarrative is enabled.
     * Uses small font, rotated to follow lane direction, with text shadow for
     * readability against the background.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} cx - Canvas center X offset
     * @param {number} cy - Canvas center Y offset
     * @param {Array} chains - Array of { name, narrative, nodes[], color }
     * @param {Array} lanePositions - Array of { startX, startY, endX, endY, width }
     * @param {number} opacity - Base opacity 0..1
     */
    renderNarrativeLabels: function (ctx, cx, cy, chains, lanePositions, opacity) {
        if (!chains || !lanePositions || chains.length === 0) return;

        ctx.save();

        for (var i = 0; i < chains.length; i++) {
            if (i >= lanePositions.length) break;
            var chain = chains[i];
            var lane = lanePositions[i];

            var label = chain.name || '';
            if (!label) continue;

            // Compute lane midpoint and direction angle
            var midX = cx + (lane.startX + lane.endX) / 2;
            var midY = cy + (lane.startY + lane.endY) / 2;
            var dx = lane.endX - lane.startX;
            var dy = lane.endY - lane.startY;
            var angle = Math.atan2(dy, dx);

            // Keep text readable: flip if upside-down
            if (angle > Math.PI / 2 || angle < -Math.PI / 2) {
                angle += Math.PI;
            }

            ctx.save();
            ctx.translate(midX, midY);
            ctx.rotate(angle);

            // Text shadow for readability
            ctx.font = '9px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            ctx.fillStyle = 'rgba(0, 0, 0, ' + (opacity * 0.6) + ')';
            ctx.fillText(label, 1, 1);

            // Actual label
            var labelColor = chain.color || '#888888';
            ctx.fillStyle = this._hexToRgba(labelColor, opacity * 0.7);
            ctx.fillText(label, 0, 0);

            ctx.restore();
        }

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

console.log('[OracleRenderer] Loaded');
