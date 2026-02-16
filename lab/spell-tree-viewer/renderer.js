/**
 * renderer.js - Canvas2D Dendrogram Renderer
 *
 * Renders a botanical spell tree with 50-600 nodes using sprite caching,
 * text caching, and batched draw calls for performance.
 *
 * Global classes: GlowSpriteCache, TextCache, DendrogramRenderer
 * Dependencies: spatial-hash.js (SpatialHashGrid)
 *
 * Expected node format (from JSON, after reference resolution in app.js):
 *   {
 *     id, x, y, zone, depth, parent (object|null), children (array),
 *     thickness, isHub, isOrbital, assignedSpell: { formId, name, skillLevel, magickaCost }
 *   }
 */


// ---------------------------------------------------------------------------
//  GlowSpriteCache
// ---------------------------------------------------------------------------

/**
 * Pre-renders radial gradient glow sprites to offscreen canvases so the
 * main render loop can blit them with drawImage() instead of creating
 * gradients each frame.
 */
class GlowSpriteCache {
    constructor() {
        /** @type {Map<string, HTMLCanvasElement>} */
        this._cache = new Map();
        /** @type {Array<string>} Insertion-order keys for LRU eviction. */
        this._keys = [];
        this.maxSize = 50;
    }

    /**
     * Get (or create) a glow sprite for the given color and radius.
     * Radius is snapped to the nearest multiple of 4 for cache efficiency.
     *
     * @param {string} color - CSS hex color, e.g. "#ef4444"
     * @param {number} radius - Desired glow radius in screen pixels
     * @returns {HTMLCanvasElement} Offscreen canvas of size (radius*2) x (radius*2)
     */
    getSprite(color, radius) {
        // Snap radius to nearest 4px for cache reuse
        var snapped = (Math.round(radius / 4) * 4) || 4;
        var key = color + '|' + snapped;

        var cached = this._cache.get(key);
        if (cached) return cached;

        // Evict oldest entry if at capacity
        if (this._keys.length >= this.maxSize) {
            var oldest = this._keys.shift();
            this._cache.delete(oldest);
        }

        var size = snapped * 2;
        var c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        var g = c.getContext('2d');

        // Parse hex color to rgb components for rgba usage
        var r = parseInt(color.slice(1, 3), 16);
        var gr = parseInt(color.slice(3, 5), 16);
        var b = parseInt(color.slice(5, 7), 16);

        var grad = g.createRadialGradient(snapped, snapped, 0, snapped, snapped, snapped);
        grad.addColorStop(0, 'rgba(' + r + ',' + gr + ',' + b + ',0.4)');
        grad.addColorStop(1, 'rgba(' + r + ',' + gr + ',' + b + ',0)');

        g.fillStyle = grad;
        g.fillRect(0, 0, size, size);

        this._cache.set(key, c);
        this._keys.push(key);
        return c;
    }
}


// ---------------------------------------------------------------------------
//  TextCache
// ---------------------------------------------------------------------------

/**
 * Caches rendered text labels on offscreen canvases so the main loop can
 * blit them without re-measuring or re-rasterizing text each frame.
 */
class TextCache {
    constructor() {
        /** @type {Map<string, {canvas: HTMLCanvasElement, width: number, height: number}>} */
        this._cache = new Map();
    }

    /**
     * Get a pre-rendered label canvas for the given text, fontSize, and color.
     *
     * @param {string} text
     * @param {number} fontSize - In CSS pixels
     * @param {string} color - CSS color string
     * @returns {{canvas: HTMLCanvasElement, width: number, height: number}}
     */
    getLabel(text, fontSize, color) {
        var key = text + '|' + fontSize + '|' + color;
        var cached = this._cache.get(key);
        if (cached) return cached;

        // Measure text using a scratch canvas
        var measure = document.createElement('canvas');
        var mctx = measure.getContext('2d');
        var font = fontSize + 'px "Segoe UI", Tahoma, sans-serif';
        mctx.font = font;
        var metrics = mctx.measureText(text);

        // Add padding for sub-pixel rendering
        var w = Math.ceil(metrics.width) + 4;
        var h = Math.ceil(fontSize * 1.3) + 4;

        var c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        var ctx = c.getContext('2d');
        ctx.font = font;
        ctx.textBaseline = 'top';
        ctx.fillStyle = color;
        ctx.fillText(text, 2, 2);

        var entry = { canvas: c, width: w, height: h };
        this._cache.set(key, entry);
        return entry;
    }

    /** Flush all cached labels (call when zoom level changes significantly). */
    clear() {
        this._cache.clear();
    }
}


// ---------------------------------------------------------------------------
//  DendrogramRenderer
// ---------------------------------------------------------------------------

/**
 * Main renderer for the spell dendrogram. Handles camera (pan/zoom),
 * mouse interaction, hover detection via spatial hash, and a batched
 * Canvas2D render pipeline with LOD gating.
 *
 * Usage:
 *   var renderer = new DendrogramRenderer(document.getElementById('canvas'));
 *   renderer.render(nodes, '#22c55e', { nodeSizeMultiplier: 1.0, lineThicknessMultiplier: 1.0 });
 */
class DendrogramRenderer {

    // -- School color constants --
    static SCHOOL_COLORS = {
        Alteration:  '#22c55e',
        Conjuration: '#a855f7',
        Destruction: '#ef4444',
        Illusion:    '#38bdf8',
        Restoration: '#facc15'
    };

    /**
     * @param {HTMLCanvasElement} canvas
     */
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        // -- Caches --
        this.spatialHash = new SpatialHashGrid(80);
        this.glowCache = new GlowSpriteCache();
        this.textCache = new TextCache();

        // -- Data --
        /** @type {Array} Node array set by render() */
        this.nodes = [];
        /** @type {string} Current school hex color */
        this.schoolColor = '#22c55e';
        /** @type {object} Extra params from render() */
        this.params = {};

        // -- Camera --
        this.panX = 0;
        this.panY = 200;  // Start looking above origin
        this.scale = 0.8;
        this._minScale = 0.02;
        this._maxScale = 30;

        // -- Viewport dimensions (CSS pixels) --
        this._cssWidth = 800;
        this._cssHeight = 600;
        this._dpr = window.devicePixelRatio || 1;

        // -- Interaction state --
        this._dragging = false;
        this._dragStartX = 0;
        this._dragStartY = 0;
        this._panStartX = 0;
        this._panStartY = 0;
        this._hoveredNode = null;

        // -- Render state --
        this._needsRedraw = true;
        this._loopRunning = false;
        this._ghostMode = false;

        // -- Node rendering constants --
        this._nodeSizeBase = 6;
        this._zoneScaleMap = {
            origin:   1.0,
            roots:    0.7,
            trunk:    0.9,
            branches: 1.0,
            fruits:   1.4
        };
        this._zoneLineMultiplier = {
            origin:   1.0,
            roots:    1.2,
            trunk:    1.5,
            branches: 1.0,
            fruits:   0.6
        };

        // -- Skill-level brightness map --
        this._skillBrightness = {
            'Novice':     0.5,
            'Apprentice': 0.65,
            'Adept':      0.8,
            'Expert':     0.9,
            'Master':     1.0
        };

        // -- Zone ghost-mode colors --
        this._zoneGhostColors = {
            roots:    '#4a3a20',
            trunk:    '#5a4a30',
            branches: '#3a4a5a',
            fruits:   '#6a5a3a',
            origin:   '#5a5a5a'
        };

        // -- Zone connection colors (earthy for roots/trunk) --
        this._zoneEarthColors = {
            roots: '#5a4a30',
            trunk: '#7a6a40'
        };

        // -- Visual multipliers (controlled by sliders in app.js) --
        this._nodeSizeMultiplier = 1.0;
        this._lineThicknessMultiplier = 1.0;

        // -- Tooltip element --
        this._tooltip = document.getElementById('tooltip');

        // -- Bind event handlers --
        this._bindEvents();

        // -- Initial resize --
        this.resize();

        // -- Start render loop --
        this.startLoop();
    }

    // ======================================================================
    //  PUBLIC API
    // ======================================================================

    /**
     * Ghost mode: show zone-based muted colors, hide spell labels.
     * @type {boolean}
     */
    get ghostMode() {
        return this._ghostMode;
    }
    set ghostMode(val) {
        this._ghostMode = !!val;
        this._needsRedraw = true;
    }

    /** @type {number} Node size multiplier from slider */
    get nodeSizeMultiplier() {
        return this._nodeSizeMultiplier;
    }
    set nodeSizeMultiplier(val) {
        this._nodeSizeMultiplier = val;
        this._needsRedraw = true;
    }

    /** @type {number} Line thickness multiplier from slider */
    get lineThicknessMultiplier() {
        return this._lineThicknessMultiplier;
    }
    set lineThicknessMultiplier(val) {
        this._lineThicknessMultiplier = val;
        this._needsRedraw = true;
    }

    /**
     * Supply new node data and trigger a redraw.
     *
     * @param {Array} nodes - Array of resolved node objects
     * @param {string} schoolColor - Hex color for the school, e.g. '#22c55e'
     * @param {object} [params] - Additional parameters
     */
    render(nodes, schoolColor, params) {
        this.nodes = nodes || [];
        this.schoolColor = schoolColor || '#22c55e';
        this.params = params || {};

        // Apply visual params if provided
        if (this.params.nodeSizeMultiplier !== undefined) {
            this._nodeSizeMultiplier = this.params.nodeSizeMultiplier;
        }
        if (this.params.lineThicknessMultiplier !== undefined) {
            this._lineThicknessMultiplier = this.params.lineThicknessMultiplier;
        }

        // Wheel mode
        this._isWheel = !!this.params.isWheel;
        this._ringData = this.params.ring || null;

        // Rebuild spatial hash and node map
        this.spatialHash.clear();
        this._nodeMap = new Map();
        for (var i = 0, len = this.nodes.length; i < len; i++) {
            this.spatialHash.insert(this.nodes[i]);
            this._nodeMap.set(this.nodes[i].id, this.nodes[i]);
        }

        this._needsRedraw = true;
    }

    /** Reset pan/zoom to defaults and center on origin. */
    resetView() {
        this.panX = 0;
        this.panY = 200;
        this.scale = 0.8;
        this.textCache.clear();
        this._needsRedraw = true;
    }

    /** DPR-aware canvas resize. Call on window resize. */
    resize() {
        var dpr = window.devicePixelRatio || 1;
        this._dpr = dpr;

        var rect = this.canvas.getBoundingClientRect();
        var cssW = rect.width || this.canvas.clientWidth || 800;
        var cssH = rect.height || this.canvas.clientHeight || 600;

        this._cssWidth = cssW;
        this._cssHeight = cssH;

        this.canvas.width = cssW * dpr;
        this.canvas.height = cssH * dpr;
        this.canvas.style.width = cssW + 'px';
        this.canvas.style.height = cssH + 'px';

        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        this._needsRedraw = true;
    }

    /** Start the requestAnimationFrame render loop. */
    startLoop() {
        if (this._loopRunning) return;
        this._loopRunning = true;
        var self = this;
        var loop = function () {
            if (!self._loopRunning) return;
            if (self._needsRedraw) {
                self._draw();
                self._needsRedraw = false;
            }
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    /** Stop the render loop. */
    stopLoop() {
        this._loopRunning = false;
    }

    // ======================================================================
    //  COORDINATE TRANSFORMS
    // ======================================================================

    /**
     * World to screen coordinates.
     * World is Y-up (positive Y = up). Screen is Y-down.
     */
    _worldToScreen(wx, wy) {
        var sx = (wx - this.panX) * this.scale + this._cssWidth * 0.5;
        var sy = -(wy - this.panY) * this.scale + this._cssHeight * 0.5;
        return [sx, sy];
    }

    /**
     * Screen to world coordinates (inverse of _worldToScreen).
     */
    _screenToWorld(sx, sy, optionalScale) {
        var s = (optionalScale !== undefined) ? optionalScale : this.scale;
        var wx = (sx - this._cssWidth * 0.5) / s + this.panX;
        var wy = -((sy - this._cssHeight * 0.5) / s) + this.panY;
        return [wx, wy];
    }

    // ======================================================================
    //  COLOR UTILITIES
    // ======================================================================

    _parseHex(hex) {
        var h = hex.charAt(0) === '#' ? hex.slice(1) : hex;
        return [
            parseInt(h.slice(0, 2), 16),
            parseInt(h.slice(2, 4), 16),
            parseInt(h.slice(4, 6), 16)
        ];
    }

    _alphaColor(hex, alpha) {
        var c = this._parseHex(hex);
        return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + alpha + ')';
    }

    _brighten(hex, factor) {
        var c = this._parseHex(hex);
        var r = Math.min(255, Math.round(c[0] * factor));
        var g = Math.min(255, Math.round(c[1] * factor));
        var b = Math.min(255, Math.round(c[2] * factor));
        return 'rgb(' + r + ',' + g + ',' + b + ')';
    }

    _spellColor(spell, fallback) {
        if (!spell || !spell.skillLevel) return fallback;
        var brightness = this._skillBrightness[spell.skillLevel];
        if (brightness === undefined) brightness = 0.7;
        return this._brighten(fallback, brightness);
    }

    _zoneColor(zone, schoolColor) {
        if (zone === 'roots') return this._zoneEarthColors.roots;
        if (zone === 'trunk') return this._zoneEarthColors.trunk;
        return schoolColor;
    }

    _zoneGhostColor(zone) {
        return this._zoneGhostColors[zone] || '#5a5a5a';
    }

    /** Blend two hex colors. t=0 gives colorA, t=1 gives colorB. */
    _alphaBlend(hexA, hexB, t) {
        var a = this._parseHex(hexA);
        var b = this._parseHex(hexB);
        var r = Math.round(a[0] * (1 - t) + b[0] * t);
        var g = Math.round(a[1] * (1 - t) + b[1] * t);
        var bl = Math.round(a[2] * (1 - t) + b[2] * t);
        return 'rgb(' + r + ',' + g + ',' + bl + ')';
    }

    // ======================================================================
    //  EVENT BINDING
    // ======================================================================

    _bindEvents() {
        var self = this;
        var canvas = this.canvas;

        canvas.style.cursor = 'grab';

        // -- Mouse wheel: zoom toward cursor --
        canvas.addEventListener('wheel', function (e) {
            e.preventDefault();

            var rect = canvas.getBoundingClientRect();
            var mx = e.clientX - rect.left;
            var my = e.clientY - rect.top;

            // World point under mouse before zoom
            var before = self._screenToWorld(mx, my);

            // Compute new scale
            var zoomFactor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
            var newScale = self.scale * zoomFactor;
            newScale = Math.max(self._minScale, Math.min(self._maxScale, newScale));
            self.scale = newScale;

            // World point under mouse after zoom (with new scale)
            var after = self._screenToWorld(mx, my);

            // Adjust pan so the world point stays under the mouse
            self.panX += (before[0] - after[0]);
            self.panY += (before[1] - after[1]);

            // Clear text cache on zoom changes for font clarity
            self.textCache.clear();

            self._needsRedraw = true;
        }, { passive: false });

        // -- Mouse down: start drag --
        canvas.addEventListener('mousedown', function (e) {
            if (e.button !== 0) return;
            self._dragging = true;
            self._dragStartX = e.clientX;
            self._dragStartY = e.clientY;
            self._panStartX = self.panX;
            self._panStartY = self.panY;
            canvas.style.cursor = 'grabbing';
        });

        // -- Mouse move: drag pan + hover detection --
        canvas.addEventListener('mousemove', function (e) {
            var rect = canvas.getBoundingClientRect();
            var mx = e.clientX - rect.left;
            var my = e.clientY - rect.top;

            if (self._dragging) {
                var dxScreen = e.clientX - self._dragStartX;
                var dyScreen = e.clientY - self._dragStartY;

                self.panX = self._panStartX - dxScreen / self.scale;
                self.panY = self._panStartY + dyScreen / self.scale;

                self._needsRedraw = true;
                return;
            }

            // Hover detection via spatial hash
            var world = self._screenToWorld(mx, my);
            var hoverWorldRadius = 20 / self.scale;
            var nearest = self.spatialHash.nearest(world[0], world[1], hoverWorldRadius);

            if (nearest !== self._hoveredNode) {
                self._hoveredNode = nearest;
                self._needsRedraw = true;
                self._updateTooltip(mx, my, nearest);
            } else if (nearest) {
                self._updateTooltip(mx, my, nearest);
            }
        });

        // -- Mouse up: end drag --
        var onMouseUp = function () {
            if (self._dragging) {
                self._dragging = false;
                canvas.style.cursor = 'grab';
            }
        };
        canvas.addEventListener('mouseup', onMouseUp);
        document.addEventListener('mouseup', onMouseUp);

        // -- Mouse leave: clear hover --
        canvas.addEventListener('mouseleave', function () {
            if (self._hoveredNode) {
                self._hoveredNode = null;
                self._needsRedraw = true;
            }
            if (self._tooltip) {
                self._tooltip.style.display = 'none';
            }
        });

        // -- Window resize --
        window.addEventListener('resize', function () {
            self.resize();
        });
    }

    /**
     * Update the #tooltip element with spell info for the hovered node.
     */
    _updateTooltip(mx, my, node) {
        if (!this._tooltip) return;

        if (!node || !node.assignedSpell) {
            this._tooltip.style.display = 'none';
            return;
        }

        var spell = node.assignedSpell;
        var html = '<strong>' + this._escapeHtml(spell.name) + '</strong>';
        if (spell.skillLevel) html += '<br>Level: ' + spell.skillLevel;
        if (spell.magickaCost !== undefined) html += '<br>Magicka: ' + spell.magickaCost;
        if (spell.formId) html += '<br><small>FormID: ' + spell.formId + '</small>';
        if (spell.editorId) html += '<br><small>' + this._escapeHtml(spell.editorId) + '</small>';
        if (node.school) html += '<br>School: ' + node.school;
        html += '<br><small>Zone: ' + (node.zone || '?') + ' | Depth: ' + (node.depth !== undefined ? node.depth : '?') + '</small>';

        this._tooltip.innerHTML = html;
        this._tooltip.style.display = 'block';

        // Position tooltip, keeping it within viewport
        var tipX = mx + 16;
        var tipY = my + 16;
        var tipRect = this._tooltip.getBoundingClientRect();
        if (tipX + tipRect.width > this._cssWidth + this.canvas.getBoundingClientRect().left) {
            tipX = mx - tipRect.width - 8;
        }
        if (tipY + tipRect.height > this._cssHeight + this.canvas.getBoundingClientRect().top) {
            tipY = my - tipRect.height - 8;
        }

        this._tooltip.style.left = tipX + 'px';
        this._tooltip.style.top = tipY + 'px';
    }

    /** Simple HTML escape to prevent injection from spell names. */
    _escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ======================================================================
    //  RENDER PIPELINE
    // ======================================================================

    /** Main draw call, invoked by the rAF loop when _needsRedraw is true. */
    _draw() {
        var ctx = this.ctx;
        var w = this._cssWidth;
        var h = this._cssHeight;
        var scale = this.scale;
        var nodes = this.nodes;
        var nodeCount = nodes.length;

        // 1. Background (always draw)
        this._drawBackground(ctx, w, h);

        if (nodeCount === 0) {
            // Draw empty state message
            ctx.save();
            ctx.font = '16px "Segoe UI", Tahoma, sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.textAlign = 'center';
            ctx.fillText('Drop a spell_tree.json file here or use Load buttons', w * 0.5, h * 0.5);
            ctx.restore();
            return;
        }

        // LOD flags
        var showLabels = scale >= 0.15;
        var showGlow = scale >= 0.4;

        // 2. Central ring (wheel mode)
        if (this._isWheel && this._ringData) {
            this._drawCentralRing(ctx, scale);
        }

        // 3. Connections (batched by zone)
        this._drawConnections(ctx, nodes, nodeCount, scale);

        // 4. Fruit cluster circles
        this._drawFruitClusters(ctx, nodes, nodeCount, scale);

        // 5. Nodes
        this._drawNodes(ctx, nodes, nodeCount, scale, showGlow);

        // 6. Labels (zoom-gated)
        if (showLabels) {
            this._drawLabels(ctx, nodes, nodeCount, scale);
        }
    }

    /** Draw the dark radial gradient background. */
    _drawBackground(ctx, w, h) {
        var cx = w * 0.5;
        var cy = h * 0.5;
        var maxDim = Math.max(w, h);

        var grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxDim * 0.7);
        grad.addColorStop(0, '#0f0f18');
        grad.addColorStop(1, '#050508');

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
    }

    /**
     * Draw all parent-child connections, batched by stroke style.
     * Groups connections by zone for minimal style changes.
     */
    _drawConnections(ctx, nodes, nodeCount, scale) {
        var batches = {};
        var schoolColor = this.schoolColor;
        var ghostMode = this._ghostMode;
        var lineMult = this._lineThicknessMultiplier;
        var isWheel = this._isWheel;

        for (var i = 0; i < nodeCount; i++) {
            var node = nodes[i];
            if (!node.parent) continue;

            var parent = node.parent;
            if (!parent || typeof parent !== 'object') continue;

            var isOrbital = node.isOrbital;
            var zone = node.zone || 'branches';
            var nodeSchoolColor = isWheel ? (node.schoolColor || schoolColor) : schoolColor;

            var batchKey;
            var color;
            var alpha;
            var lineW;

            if (isOrbital) {
                batchKey = isWheel ? ('orbital_' + (node.school || '')) : 'orbital';
                color = ghostMode ? this._zoneGhostColor(zone) : this._zoneColor(zone, nodeSchoolColor);
                alpha = 0.3;
                lineW = 0.5 * scale * lineMult;
            } else if (zone === 'roots' || zone === 'trunk') {
                batchKey = isWheel ? (zone + '_' + (node.school || '')) : zone;
                color = isWheel ? this._alphaBlend(this._zoneEarthColors[zone] || '#5a4a30', nodeSchoolColor, 0.3) : (this._zoneEarthColors[zone] || '#5a4a30');
                alpha = 0.5;
                var thickness = (node.thickness || 1) * scale * (this._zoneLineMultiplier[zone] || 1) * lineMult;
                lineW = Math.max(0.3, thickness);
            } else {
                batchKey = isWheel ? ('school_' + zone + '_' + (node.school || '')) : ('school_' + zone);
                color = ghostMode ? this._zoneGhostColor(zone) : nodeSchoolColor;
                alpha = 0.5;
                var thickness2 = (node.thickness || 1) * scale * (this._zoneLineMultiplier[zone] || 1) * lineMult;
                lineW = Math.max(0.3, thickness2);
            }

            if (!batches[batchKey]) {
                batches[batchKey] = {
                    color: color,
                    alpha: alpha,
                    lineW: lineW,
                    connections: []
                };
            }

            batches[batchKey].connections.push({
                parent: parent,
                child: node,
                isOrbital: isOrbital,
                lineW: lineW
            });
        }

        // Draw each batch
        var keys = Object.keys(batches);
        for (var k = 0; k < keys.length; k++) {
            var batch = batches[keys[k]];
            var conns = batch.connections;

            ctx.save();
            ctx.strokeStyle = this._alphaColor(batch.color, batch.alpha);
            ctx.lineWidth = batch.lineW;
            ctx.lineCap = 'round';

            ctx.beginPath();

            for (var c = 0; c < conns.length; c++) {
                var conn = conns[c];
                var p = conn.parent;
                var ch = conn.child;

                var ps = this._worldToScreen(p.x, p.y);
                var cs = this._worldToScreen(ch.x, ch.y);

                // Adjust line width per-connection if varying thickness
                if (Math.abs(conn.lineW - batch.lineW) > 0.3) {
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.lineWidth = conn.lineW;
                }

                if (conn.isOrbital) {
                    // Straight line for orbital connections
                    ctx.moveTo(ps[0], ps[1]);
                    ctx.lineTo(cs[0], cs[1]);
                } else {
                    // Organic Bezier curve
                    var offset = (ch.curveOffset || 0) * scale;
                    var midY = (ps[1] + cs[1]) * 0.5;

                    var cp1x = ps[0] + offset;
                    var cp1y = midY;
                    var cp2x = cs[0] - offset;
                    var cp2y = midY;

                    ctx.moveTo(ps[0], ps[1]);
                    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, cs[0], cs[1]);
                }
            }

            ctx.stroke();
            ctx.restore();
        }
    }

    /**
     * Draw dashed circles around fruit cluster hubs at their orbital radius.
     */
    _drawFruitClusters(ctx, nodes, nodeCount, scale) {
        var ghostMode = this._ghostMode;
        var lineMult = this._lineThicknessMultiplier;

        for (var i = 0; i < nodeCount; i++) {
            var node = nodes[i];
            if (!node.isHub || node.zone !== 'fruits') continue;

            var ringIds = node.ringIds || node.ring_ids;
            if (!ringIds || ringIds.length === 0) continue;

            // Resolve ring nodes from the node map
            var ringNodes = [];
            for (var r = 0; r < ringIds.length; r++) {
                var rn = this._nodeMap ? this._nodeMap.get(ringIds[r]) : null;
                if (rn) ringNodes.push(rn);
            }
            if (ringNodes.length === 0) continue;

            var color = ghostMode ? this._zoneGhostColor('fruits') : (this._isWheel ? (node.schoolColor || this.schoolColor) : this.schoolColor);
            var hubScreen = this._worldToScreen(node.x, node.y);

            // Draw ring chain (consecutive ring nodes connected)
            ctx.save();
            ctx.strokeStyle = this._alphaColor(color, 0.4);
            ctx.lineWidth = Math.max(0.5, 1.2 * scale * lineMult);
            ctx.lineCap = 'round';
            ctx.beginPath();
            for (var j = 0; j < ringNodes.length; j++) {
                var rn1 = ringNodes[j];
                var rn2 = ringNodes[(j + 1) % ringNodes.length]; // wraps to form closed ring
                var s1 = this._worldToScreen(rn1.x, rn1.y);
                var s2 = this._worldToScreen(rn2.x, rn2.y);
                ctx.moveTo(s1[0], s1[1]);
                ctx.lineTo(s2[0], s2[1]);
            }
            ctx.stroke();
            ctx.restore();

            // Draw spoke connections (each ring node to center hub)
            ctx.save();
            ctx.strokeStyle = this._alphaColor(color, 0.2);
            ctx.lineWidth = Math.max(0.3, 0.6 * scale * lineMult);
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            for (var j = 0; j < ringNodes.length; j++) {
                var rs = this._worldToScreen(ringNodes[j].x, ringNodes[j].y);
                ctx.moveTo(rs[0], rs[1]);
                ctx.lineTo(hubScreen[0], hubScreen[1]);
            }
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
        }
    }

    /**
     * Draw the central ring in wheel mode.
     * Connects ring points as a closed polygon with faint lines.
     */
    _drawCentralRing(ctx, scale) {
        var ring = this._ringData;
        if (!ring || !ring.points || ring.points.length === 0) return;

        var pts = ring.points;
        var lineMult = this._lineThicknessMultiplier;

        ctx.save();
        ctx.strokeStyle = 'rgba(100, 100, 140, 0.3)';
        ctx.lineWidth = Math.max(0.5, 1.5 * scale * lineMult);
        ctx.beginPath();

        var s0 = this._worldToScreen(pts[0].x, pts[0].y);
        ctx.moveTo(s0[0], s0[1]);
        for (var i = 1; i < pts.length; i++) {
            var si = this._worldToScreen(pts[i].x, pts[i].y);
            ctx.lineTo(si[0], si[1]);
        }
        ctx.closePath();
        ctx.stroke();

        // Draw small dots at ring points
        if (scale > 0.1) {
            ctx.fillStyle = 'rgba(120, 120, 160, 0.4)';
            for (var j = 0; j < pts.length; j++) {
                var sp = this._worldToScreen(pts[j].x, pts[j].y);
                ctx.beginPath();
                ctx.arc(sp[0], sp[1], Math.max(1, 2 * scale), 0, Math.PI * 2);
                ctx.fill();
            }
        }

        ctx.restore();
    }

    /**
     * Draw all nodes: glow, fill, stroke.
     */
    _drawNodes(ctx, nodes, nodeCount, scale, showGlow) {
        var ghostMode = this._ghostMode;
        var schoolColor = this.schoolColor;
        var hoveredNode = this._hoveredNode;
        var baseSize = this._nodeSizeBase * this._nodeSizeMultiplier;
        var isWheel = this._isWheel;

        for (var i = 0; i < nodeCount; i++) {
            var node = nodes[i];
            var zone = node.zone || 'branches';

            // Compute node screen position
            var sc = this._worldToScreen(node.x, node.y);
            var sx = sc[0];
            var sy = sc[1];

            // Cull nodes outside viewport (with generous margin)
            if (sx < -60 || sx > this._cssWidth + 60 ||
                sy < -60 || sy > this._cssHeight + 60) {
                continue;
            }

            // Node radius
            var zoneScale = this._zoneScaleMap[zone] || 1.0;
            if (node.isHub) zoneScale = 1.8;
            if (node.isOrbital) zoneScale = 0.9;
            var r = baseSize * zoneScale * scale;

            if (r < 0.3) continue;

            // Node color
            var nodeSchoolColor = isWheel ? (node.schoolColor || schoolColor) : schoolColor;
            var nodeColor;
            if (ghostMode) {
                nodeColor = this._zoneGhostColor(zone);
            } else if (node.assignedSpell) {
                nodeColor = this._spellColor(node.assignedSpell, nodeSchoolColor);
            } else {
                nodeColor = nodeSchoolColor;
            }

            // Glow (for hubs and hovered node)
            var isHovered = (node === hoveredNode);
            if (showGlow && (node.isHub || isHovered)) {
                var glowRadius = r * (isHovered ? 5 : 3.5);
                if (glowRadius >= 4) {
                    var glowColor = ghostMode ? this._zoneGhostColor(zone) : nodeSchoolColor;
                    var sprite = this.glowCache.getSprite(glowColor, glowRadius);

                    ctx.save();
                    ctx.globalCompositeOperation = 'lighter';
                    ctx.drawImage(
                        sprite,
                        sx - glowRadius,
                        sy - glowRadius,
                        glowRadius * 2,
                        glowRadius * 2
                    );
                    ctx.restore();
                }
            }

            // Fill circle
            ctx.beginPath();
            ctx.arc(sx, sy, Math.max(r, 1), 0, Math.PI * 2);
            ctx.fillStyle = nodeColor;
            ctx.fill();

            // Stroke outline
            ctx.strokeStyle = this._alphaColor(nodeColor, 0.6);
            ctx.lineWidth = Math.max(0.5, r * 0.2);
            ctx.stroke();

            // Extra highlight ring for hovered node
            if (isHovered) {
                ctx.beginPath();
                ctx.arc(sx, sy, r + 2, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255,255,255,0.7)';
                ctx.lineWidth = 1.2;
                ctx.stroke();
            }
        }
    }

    /**
     * Draw text labels for spell names. Zoom-gated:
     *   - scale > 1.2: show all assigned spell labels
     *   - scale > 0.6 but <= 1.2: show only hovered node label
     *   - scale <= 0.6: no labels
     */
    _drawLabels(ctx, nodes, nodeCount, scale) {
        if (this._ghostMode) return;

        var showAll = scale > 1.2;
        var showHovered = scale > 0.6;
        var hoveredNode = this._hoveredNode;

        if (!showAll && !showHovered) return;

        var baseSize = this._nodeSizeBase * this._nodeSizeMultiplier;

        for (var i = 0; i < nodeCount; i++) {
            var node = nodes[i];
            if (!node.assignedSpell || !node.assignedSpell.name) continue;

            var isHovered = (node === hoveredNode);

            if (!showAll && !isHovered) continue;

            var sc = this._worldToScreen(node.x, node.y);
            var sx = sc[0];
            var sy = sc[1];

            // Viewport cull
            if (sx < -100 || sx > this._cssWidth + 100 ||
                sy < -40 || sy > this._cssHeight + 40) {
                continue;
            }

            var fontSize = Math.round(Math.max(9, Math.min(14, 10 * scale)));
            var alpha = isHovered ? 1.0 : 0.75;
            var color = 'rgba(255,255,255,' + alpha + ')';
            var text = node.assignedSpell.name;

            var label = this.textCache.getLabel(text, fontSize, color);

            // Position label centered above node
            var zone = node.zone || 'branches';
            var zoneScale = this._zoneScaleMap[zone] || 1.0;
            if (node.isHub) zoneScale = 1.8;
            if (node.isOrbital) zoneScale = 0.9;
            var r = baseSize * zoneScale * scale;

            var lx = sx - label.width * 0.5;
            var ly = sy - r - label.height - 2;

            ctx.drawImage(label.canvas, lx, ly);
        }
    }
}
