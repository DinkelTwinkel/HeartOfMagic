/**
 * TreeCore Module — Globe position/size state management
 *
 * Stripped version: HTML is now in index.html (Extra Settings > Core tab).
 * Canvas rendering is handled by prereqMaster.js preview canvas.
 * This module just manages globe state, binds to the new slider IDs,
 * and exposes getOutput() / renderGlobeOverlay() for consumers.
 *
 * Depends on: state.js (state)
 */

var TreeCore = {

    // State
    _initialized: false,
    globeX: 0,
    globeY: 0,
    globeRadius: 45,

    // =========================================================================
    // INITIALIZATION
    // =========================================================================

    init: function() {
        if (this._initialized) return;

        this._bindSettings();
        this._initialized = true;
        console.log('[TreeCore] Initialized (tab mode)');
    },

    // =========================================================================
    // SETTINGS BINDING — binds to new IDs in Extra Settings > Core tab
    // =========================================================================

    _bindSettings: function() {
        var self = this;

        var mappings = [
            { slider: 'prmGlobeHOffset', display: 'prmGlobeHValue', prop: 'globeX' },
            { slider: 'prmGlobeVOffset', display: 'prmGlobeVValue', prop: 'globeY' },
            { slider: 'prmGlobeRadius', display: 'prmGlobeRadiusValue', prop: 'globeRadius' }
        ];

        mappings.forEach(function(m) {
            var slider = document.getElementById(m.slider);
            var display = document.getElementById(m.display);
            if (slider) {
                // Set initial value
                slider.value = self[m.prop];
                if (display) display.textContent = self[m.prop];
                if (typeof updateSliderFillGlobal === 'function') updateSliderFillGlobal(slider);

                slider.addEventListener('input', function() {
                    self[m.prop] = parseInt(slider.value);
                    if (display) display.textContent = slider.value;
                    if (typeof updateSliderFillGlobal === 'function') updateSliderFillGlobal(slider);

                    // Notify preview canvas to re-render
                    if (typeof PreReqMaster !== 'undefined' && PreReqMaster.renderPreview) {
                        PreReqMaster.renderPreview();
                    }
                    // Also notify tree growth preview
                    if (typeof TreeGrowth !== 'undefined' && TreeGrowth._markDirty) {
                        TreeGrowth._markDirty();
                    }
                });
            }
        });
    },

    /** Update slider DOM values from internal state. */
    _updateSliders: function() {
        var mappings = [
            { slider: 'prmGlobeHOffset', display: 'prmGlobeHValue', prop: 'globeX' },
            { slider: 'prmGlobeVOffset', display: 'prmGlobeVValue', prop: 'globeY' },
            { slider: 'prmGlobeRadius', display: 'prmGlobeRadiusValue', prop: 'globeRadius' }
        ];

        var self = this;
        mappings.forEach(function(m) {
            var slider = document.getElementById(m.slider);
            var display = document.getElementById(m.display);
            if (slider) {
                slider.value = self[m.prop];
                if (display) display.textContent = self[m.prop];
                if (typeof updateSliderFillGlobal === 'function') updateSliderFillGlobal(slider);
            }
        });
    },

    // =========================================================================
    // SHOW / HIDE — now just manages state, section visibility handled elsewhere
    // =========================================================================

    show: function() {
        this.init();
        this._updateSliders();
    },

    hide: function() {
        // No-op — visibility managed by Extra Settings section
    },

    // =========================================================================
    // OUTPUT
    // =========================================================================

    /** Return current globe settings for downstream consumers (applyTree). */
    getOutput: function() {
        return { x: this.globeX, y: this.globeY, radius: this.globeRadius };
    },

    // =========================================================================
    // GLOBE OVERLAY RENDERING — called by prereqMaster.js preview canvas
    // =========================================================================

    /**
     * Draw the globe preview overlay on a canvas context.
     * @param {CanvasRenderingContext2D} ctx - Canvas context (already transformed)
     * @param {number} w - Canvas width in CSS pixels
     * @param {number} h - Canvas height in CSS pixels
     */
    renderGlobeOverlay: function(ctx, w, h) {
        var cx = w / 2 + this.globeX;
        var cy = h / 2 + this.globeY;
        var r = this.globeRadius;

        // Dashed crosshair through globe center
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(184, 168, 120, 0.25)';
        ctx.lineWidth = 1;

        ctx.beginPath();
        ctx.moveTo(cx - r - 20, cy);
        ctx.lineTo(cx + r + 20, cy);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(cx, cy - r - 20);
        ctx.lineTo(cx, cy + r + 20);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.restore();

        // Outer glow ring
        ctx.beginPath();
        ctx.arc(cx, cy, r + 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(184, 168, 120, 0.15)';
        ctx.fill();

        // Background circle
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.fill();

        // Inner decorative ring
        ctx.beginPath();
        ctx.arc(cx, cy, r - 5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(184, 168, 120, 0.3)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Border ring
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = '#b8a878';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Text label
        ctx.fillStyle = '#b8a878';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('HoM', cx, cy);

        // Offset label below globe
        ctx.font = '9px sans-serif';
        ctx.fillStyle = 'rgba(184, 168, 120, 0.5)';
        ctx.fillText(this.globeX + ', ' + this.globeY, cx, cy + r + 16);
    }
};

console.log('[TreeCore] Loaded (tab mode)');
