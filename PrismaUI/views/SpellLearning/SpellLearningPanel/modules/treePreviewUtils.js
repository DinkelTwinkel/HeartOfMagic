/**
 * Tree Preview — Shared Utilities
 *
 * Provides reusable UI components for tree preview settings panels:
 * - Drag-to-slide number inputs with +/- buttons
 * - Setting row HTML generation
 *
 * Must load BEFORE treePreviewSun.js and treePreviewFlat.js.
 */

var TreePreviewUtils = {

    /**
     * Generate HTML for a setting row with drag input
     * @param {string} label - Display label
     * @param {string} id - Input element ID
     * @param {number} min
     * @param {number} max
     * @param {number} step
     * @param {number} value - Current value
     * @param {string} [suffix] - Optional suffix like '%' or '°'
     */
    settingHTML: function(label, id, min, max, step, value, suffix) {
        return '<div class="tree-preview-setting">' +
            '<label class="tree-preview-label">' + label + '</label>' +
            '<div class="tree-preview-drag-input">' +
                '<button class="drag-input-btn drag-input-minus" data-for="' + id + '">\u2212</button>' +
                '<input type="number" class="drag-input-field" id="' + id + '" ' +
                    'min="' + min + '" max="' + max + '" step="' + (step || 1) + '" value="' + value + '">' +
                '<button class="drag-input-btn drag-input-plus" data-for="' + id + '">+</button>' +
                (suffix ? '<span class="drag-input-suffix">' + suffix + '</span>' : '') +
            '</div>' +
        '</div>';
    },

    /**
     * Bind a drag input: +/- buttons, direct typing, and drag-to-slide
     * @param {string} id - Input element ID
     * @param {function} onChange - Called with (newValue) on change
     */
    bindInput: function(id, onChange) {
        var field = document.getElementById(id);
        if (!field) return;
        var min = parseFloat(field.min) || 0;
        var max = parseFloat(field.max) || 100;
        var step = parseFloat(field.step) || 1;
        var sensitivity = step * 0.3;

        function clamp(v) {
            return Math.max(min, Math.min(max, v));
        }

        function snap(v) {
            return Math.round((v - min) / step) * step + min;
        }

        function apply(v) {
            v = clamp(snap(v));
            field.value = v;
            onChange(v);
        }

        // Direct keyboard input
        field.addEventListener('change', function() {
            apply(parseFloat(this.value) || min);
        });

        // +/- buttons
        var parent = field.parentElement;
        var minusBtn = parent.querySelector('.drag-input-minus');
        var plusBtn = parent.querySelector('.drag-input-plus');

        if (minusBtn) {
            minusBtn.addEventListener('click', function(e) {
                e.preventDefault();
                apply(parseFloat(field.value) - step);
            });
        }
        if (plusBtn) {
            plusBtn.addEventListener('click', function(e) {
                e.preventDefault();
                apply(parseFloat(field.value) + step);
            });
        }

        // Drag-to-slide on the number field
        var dragging = false;
        var didDrag = false;
        var dragStartX = 0;
        var dragStartValue = 0;

        field.addEventListener('mousedown', function(e) {
            if (e.button !== 0) return;
            dragging = true;
            didDrag = false;
            dragStartX = e.clientX;
            dragStartValue = parseFloat(field.value) || min;
            e.preventDefault();
        });

        document.addEventListener('mousemove', function(e) {
            if (!dragging) return;
            var dx = e.clientX - dragStartX;
            if (Math.abs(dx) < 3 && !didDrag) return;
            didDrag = true;
            field.style.cursor = 'ew-resize';
            apply(dragStartValue + dx * sensitivity);
        });

        document.addEventListener('mouseup', function() {
            if (!dragging) return;
            dragging = false;
            field.style.cursor = '';
            if (!didDrag) {
                // Was a click, not a drag — focus for typing
                field.focus();
                field.select();
            }
        });
    },

    // =========================================================================
    // SHARED PADDED GRID RENDERER
    // =========================================================================

    /**
     * Render a grid function into a padded offscreen canvas (cached).
     *
     * All preview modes (SUN, FLAT, future) should use this instead of
     * managing their own offscreen canvases. The padded area ensures the
     * grid extends well beyond the visible viewport, so pan/zoom never
     * reveals blank space.
     *
     * @param {CanvasRenderingContext2D} ctx - Target context to blit into
     * @param {number} cx  - Grid center X in the target coordinate space
     * @param {number} cy  - Grid center Y in the target coordinate space
     * @param {number} w   - Logical canvas width
     * @param {number} h   - Logical canvas height
     * @param {function} renderFn - function(offCtx, padCx, padCy, opts)
     * @param {string} cacheKey - Settings-based key (no w/h needed)
     * @param {object} cacheStore - Object to store _gridCanvas/_gridCacheKey on
     */
    renderGridCached: function(ctx, cx, cy, w, h, renderFn, cacheKey, cacheStore) {
        var pad = 4;
        var padW = Math.ceil(w * pad);
        var padH = Math.ceil(h * pad);
        var offX = Math.floor((padW - w) / 2);
        var offY = Math.floor((padH - h) / 2);
        var padCx = cx + offX;
        var padCy = cy + offY;

        var fullKey = cacheKey + '|' + padW + '|' + padH;

        if (cacheStore._gridCanvas && cacheStore._gridCacheKey === fullKey) {
            // Cache hit
            ctx.drawImage(cacheStore._gridCanvas, -offX, -offY);
            return;
        }

        // Cache miss — create/resize offscreen canvas
        if (!cacheStore._gridCanvas ||
            cacheStore._gridCanvas.width !== padW ||
            cacheStore._gridCanvas.height !== padH) {
            cacheStore._gridCanvas = document.createElement('canvas');
            cacheStore._gridCanvas.width = padW;
            cacheStore._gridCanvas.height = padH;
        }

        var offCtx = cacheStore._gridCanvas.getContext('2d');
        offCtx.clearRect(0, 0, padW, padH);

        // Render grid into the padded canvas (centered at padCx, padCy)
        renderFn(offCtx, padCx, padCy);

        cacheStore._gridCacheKey = fullKey;
        ctx.drawImage(cacheStore._gridCanvas, -offX, -offY);
    }
};

console.log('[TreePreviewUtils] Loaded');
