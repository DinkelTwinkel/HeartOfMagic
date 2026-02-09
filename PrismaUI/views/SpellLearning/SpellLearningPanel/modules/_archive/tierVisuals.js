/**
 * TierVisuals Module - Shared tier-differentiated rendering for spell nodes
 *
 * Provides shape, size, and brightness tables based on skillLevel:
 *   - Novice/Apprentice: circle (small/dim → medium)
 *   - Adept/Expert: diamond (larger, brighter; Expert gets double border)
 *   - Master: star (largest, brightest, glow ring)
 *
 * Used by SpellTreeRenderer (and optionally ClassicRenderer / TreeRenderer).
 *
 * Depends on: nothing (self-contained utility)
 */

var TierVisuals = {

    // Size multiplier per skill level
    _sizeTable: {
        'Novice':     0.8,
        'Apprentice': 1.0,
        'Adept':      1.2,
        'Expert':     1.4,
        'Master':     1.8
    },

    // Brightness multiplier per skill level (values >1 push past base opacity)
    _brightnessTable: {
        'Novice':     0.3,
        'Apprentice': 0.5,
        'Adept':      0.8,
        'Expert':     1.2,
        'Master':     1.8
    },

    /**
     * Get size multiplier for a skill level.
     * @param {string} level
     * @returns {number}
     */
    getSize: function(level) {
        return this._sizeTable[level] !== undefined ? this._sizeTable[level] : 1.0;
    },

    /**
     * Get brightness multiplier for a skill level.
     * @param {string} level
     * @returns {number}
     */
    getBrightness: function(level) {
        return this._brightnessTable[level] !== undefined ? this._brightnessTable[level] : 0.5;
    },

    // =========================================================================
    // FULL NODE RENDER
    // =========================================================================

    /**
     * Render a single tier-differentiated node (glow + body + extras + border).
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} x - Center X in canvas coords
     * @param {number} y - Center Y in canvas coords
     * @param {string} skillLevel - Novice/Apprentice/Adept/Expert/Master
     * @param {string} color - Hex color e.g. '#4488ff'
     * @param {number} opacity - Final opacity 0..1 (already includes state modulation)
     * @param {number} baseRadius - Base node radius in px
     */
    renderNode: function(ctx, x, y, skillLevel, color, opacity, baseRadius) {
        var level = skillLevel || '';
        var mult = this.getSize(level);
        var size = baseRadius * mult;

        // Glow (outer soft fill)
        ctx.fillStyle = this._hexToRgba(color, opacity * 0.15);
        this._fillShape(ctx, level, x, y, size + 3);

        // Body
        ctx.fillStyle = this._hexToRgba(color, opacity);
        this._fillShape(ctx, level, x, y, size);

        // Expert: double border
        if (level === 'Expert') {
            ctx.strokeStyle = this._hexToRgba(color, opacity * 0.5);
            ctx.lineWidth = 1.0;
            this._strokeShape(ctx, level, x, y, size + 1.5);
        }

        // Master: glow ring
        if (level === 'Master') {
            ctx.beginPath();
            ctx.arc(x, y, size + 4, 0, Math.PI * 2);
            ctx.strokeStyle = this._hexToRgba(color, opacity * 0.35);
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        // Border
        ctx.strokeStyle = 'rgba(255, 255, 255, ' + (opacity * 0.3) + ')';
        ctx.lineWidth = 0.5;
        this._strokeShape(ctx, level, x, y, size);
    },

    /**
     * Draw a root marker ring around a node.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} x
     * @param {number} y
     * @param {string} color - Hex color (currently unused; ring is white)
     * @param {number} radius - Base node radius
     */
    renderRootMarker: function(ctx, x, y, color, radius) {
        ctx.beginPath();
        ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    },

    // =========================================================================
    // SHAPE DISPATCHERS
    // =========================================================================

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

    // =========================================================================
    // SHAPE PRIMITIVES
    // =========================================================================

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

    // =========================================================================
    // COLOR HELPERS
    // =========================================================================

    _hexToRgba: function(hex, alpha) {
        if (!hex || hex.charAt(0) !== '#' || hex.length < 7) {
            return 'rgba(136,136,136,' + alpha + ')';
        }
        var r = parseInt(hex.slice(1, 3), 16);
        var g = parseInt(hex.slice(3, 5), 16);
        var b = parseInt(hex.slice(5, 7), 16);
        if (isNaN(r) || isNaN(g) || isNaN(b)) {
            return 'rgba(136,136,136,' + alpha + ')';
        }
        return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    },

    _hexToRgb: function(hex) {
        if (!hex) return { r: 136, g: 136, b: 136 };
        hex = hex.replace('#', '');
        return {
            r: parseInt(hex.substring(0, 2), 16) || 136,
            g: parseInt(hex.substring(2, 4), 16) || 136,
            b: parseInt(hex.substring(4, 6), 16) || 136
        };
    },

    parseColor: function(color) {
        if (!color) return null;
        if (color.charAt(0) === '#') {
            return {
                r: parseInt(color.slice(1, 3), 16),
                g: parseInt(color.slice(3, 5), 16),
                b: parseInt(color.slice(5, 7), 16)
            };
        }
        var match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
            return { r: parseInt(match[1]), g: parseInt(match[2]), b: parseInt(match[3]) };
        }
        return null;
    },

    dimColor: function(color, factor) {
        var rgb = this.parseColor(color);
        if (!rgb) return color;
        return 'rgb(' + Math.round(rgb.r * factor) + ',' +
                        Math.round(rgb.g * factor) + ',' +
                        Math.round(rgb.b * factor) + ')';
    },

    getInnerAccentColor: function(color) {
        var rgb = this.parseColor(color);
        if (!rgb) return '#1a1a2e';
        return 'rgb(' + Math.round(rgb.r * 0.35) + ',' +
                        Math.round(rgb.g * 0.3) + ',' +
                        Math.round(rgb.b * 0.4) + ')';
    }
};

console.log('[TierVisuals] Loaded');
