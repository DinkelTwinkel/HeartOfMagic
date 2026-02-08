/**
 * TrustedRenderer - Bare minimum canvas renderer for pre-baked positions.
 *
 * Reads x/y directly from node data, draws circles and edges.
 * No layout logic whatsoever. No WheelRenderer, no SmartRenderer, no fallback.
 * If a node has x=0, y=0 it draws at (0,0). Period.
 *
 * ES5 only (CEF / Ultralight).
 */
var TrustedRenderer = {
    canvas: null,
    ctx: null,
    container: null,

    nodes: [],
    edges: [],
    schools: {},

    zoom: 1,
    panX: 0,
    panY: 0,

    isPanning: false,
    _panStartX: 0,
    _panStartY: 0,
    _panStartPanX: 0,
    _panStartPanY: 0,

    selectedNode: null,
    hoveredNode: null,
    _nodeMap: {},

    _rafId: null,
    _needsRender: true,
    _width: 800,
    _height: 600,

    // Known school colors (matching CanvasRendererV2)
    _knownSchoolColors: {
        'Destruction': '#ef4444',
        'Restoration': '#facc15',
        'Alteration': '#22c55e',
        'Conjuration': '#a855f7',
        'Illusion': '#38bdf8'
    },
    // Fallback for unknown schools
    _defaultColors: [
        '#4a7c4a', '#4a6a9e', '#8a7040', '#9e4a4a', '#7a4a8a',
        '#4a8a7a', '#8a6a4a', '#5a7a5a', '#6a5a8a', '#8a5a6a'
    ],
    _schoolColorMap: {},

    // =========================================================================
    // INIT
    // =========================================================================

    init: function(container) {
        this.container = container;
        this._log('init: container=' + (container ? container.id : 'null'));

        // Remove old canvas if present
        var old = container.querySelector('.trusted-canvas');
        if (old) old.parentNode.removeChild(old);

        // Hide ALL other canvases in the container so we're the only renderer visible
        var otherCanvases = container.querySelectorAll('canvas');
        for (var ci = 0; ci < otherCanvases.length; ci++) {
            if (!otherCanvases[ci].classList.contains('trusted-canvas')) {
                otherCanvases[ci].style.display = 'none';
                this._log('init: hid canvas ' + (otherCanvases[ci].className || otherCanvases[ci].id || 'unknown'));
            }
        }

        var canvas = document.createElement('canvas');
        canvas.className = 'trusted-canvas';
        canvas.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; z-index:100;';
        container.appendChild(canvas);
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        this._resize();
        this._bindEvents();
        this._startLoop();

        // Delayed resize — container may not be sized yet (tab switch pending)
        var self = this;
        setTimeout(function() {
            self._resize();
            if (self.nodes.length > 0) self._autoFit();
            self._needsRender = true;
            self._log('init: delayed resize w=' + self._width + ' h=' + self._height);
        }, 500);
    },

    _resize: function() {
        if (!this.canvas || !this.container) return;
        var rect = this.container.getBoundingClientRect();
        var dpr = window.devicePixelRatio || 1;
        this._width = rect.width;
        this._height = rect.height;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this._needsRender = true;
    },

    // =========================================================================
    // DATA
    // =========================================================================

    setData: function(nodes, edges, schools) {
        this.nodes = nodes || [];
        this.edges = edges || [];
        this.schools = schools || {};

        // Build node map
        this._nodeMap = {};
        for (var i = 0; i < this.nodes.length; i++) {
            var n = this.nodes[i];
            this._nodeMap[n.id || n.formId] = n;
            if (n.formId) this._nodeMap[n.formId] = n;
        }

        // Assign school colors: known name → data.color → fallback
        this._schoolColorMap = {};
        var ci = 0;
        for (var sn in this.schools) {
            if (!this.schools.hasOwnProperty(sn)) continue;
            var sc = this.schools[sn];
            this._schoolColorMap[sn] = this._knownSchoolColors[sn] || sc.color || this._defaultColors[ci % this._defaultColors.length];
            ci++;
        }

        // LOG: Dump position stats
        var withPos = 0;
        var withoutPos = 0;
        var sample = [];
        for (var j = 0; j < this.nodes.length; j++) {
            var nd = this.nodes[j];
            if (nd.x !== 0 || nd.y !== 0) {
                withPos++;
            } else {
                withoutPos++;
            }
            if (j < 5) {
                sample.push('{id:' + nd.formId + ',x:' + nd.x + ',y:' + nd.y + ',school:' + nd.school + '}');
            }
        }
        this._log('setData: ' + this.nodes.length + ' nodes, ' + this.edges.length + ' edges, ' +
                   Object.keys(this.schools).length + ' schools');
        this._log('setData: withPos=' + withPos + ', withoutPos=' + withoutPos);
        this._log('setData: sample nodes: ' + sample.join(', '));

        // Log per-school counts
        for (var sk in this.schools) {
            if (!this.schools.hasOwnProperty(sk)) continue;
            var sNodes = this.schools[sk].nodeIds || [];
            this._log('setData: school "' + sk + '" has ' + sNodes.length + ' nodes, color=' + this._schoolColorMap[sk]);
        }

        // Auto-fit zoom
        this._autoFit();
        this._needsRender = true;
    },

    _autoFit: function() {
        if (this.nodes.length === 0) return;
        var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (var i = 0; i < this.nodes.length; i++) {
            var n = this.nodes[i];
            if (n.x < minX) minX = n.x;
            if (n.x > maxX) maxX = n.x;
            if (n.y < minY) minY = n.y;
            if (n.y > maxY) maxY = n.y;
        }
        var rangeX = maxX - minX;
        var rangeY = maxY - minY;
        if (rangeX < 1) rangeX = 1;
        if (rangeY < 1) rangeY = 1;

        // Use available dimensions, fallback to 800x600 if container not yet sized
        var w = this._width > 100 ? this._width : 800;
        var h = this._height > 100 ? this._height : 600;
        var pad = 40;
        var zx = Math.max(0.01, (w - pad * 2) / rangeX);
        var zy = Math.max(0.01, (h - pad * 2) / rangeY);
        this.zoom = Math.min(zx, zy, 3);
        this.zoom = Math.max(0.05, this.zoom); // Never go below 0.05

        // Center the view on the midpoint of all nodes
        var midX = (minX + maxX) / 2;
        var midY = (minY + maxY) / 2;
        this.panX = -midX * this.zoom;
        this.panY = -midY * this.zoom;

        this._log('autoFit: range=(' + Math.round(minX) + '..' + Math.round(maxX) + ', ' +
                   Math.round(minY) + '..' + Math.round(maxY) + '), w=' + w + ', h=' + h +
                   ', zoom=' + this.zoom.toFixed(3) + ', pan=(' + Math.round(this.panX) + ',' + Math.round(this.panY) + ')');
    },

    // =========================================================================
    // RENDER
    // =========================================================================

    _startLoop: function() {
        var self = this;
        if (this._rafId) cancelAnimationFrame(this._rafId);
        function loop() {
            if (self._needsRender) {
                self._render();
                self._needsRender = false;
            }
            self._rafId = requestAnimationFrame(loop);
        }
        loop();
    },

    _render: function() {
        var ctx = this.ctx;
        var w = this._width;
        var h = this._height;
        if (!ctx || w === 0 || h === 0) return;

        var dpr = window.devicePixelRatio || 1;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#0a0a12';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.scale(dpr, dpr);

        // Transform: center of view + pan + zoom
        var cx = w / 2;
        var cy = h / 2;
        ctx.save();
        ctx.translate(cx + this.panX, cy + this.panY);
        ctx.scale(this.zoom, this.zoom);

        // Draw edges
        ctx.strokeStyle = 'rgba(184, 168, 120, 0.25)';
        ctx.lineWidth = 1 / this.zoom;
        for (var e = 0; e < this.edges.length; e++) {
            var edge = this.edges[e];
            var fromNode = this._nodeMap[edge.from];
            var toNode = this._nodeMap[edge.to];
            if (!fromNode || !toNode) continue;
            ctx.beginPath();
            ctx.moveTo(fromNode.x, fromNode.y);
            ctx.lineTo(toNode.x, toNode.y);
            ctx.stroke();
        }

        // Draw nodes
        var nodeRadius = 4;
        for (var i = 0; i < this.nodes.length; i++) {
            var n = this.nodes[i];
            var color = this._schoolColorMap[n.school] || '#888';
            ctx.beginPath();
            ctx.arc(n.x, n.y, nodeRadius, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.4)';
            ctx.lineWidth = 0.5 / this.zoom;
            ctx.stroke();

            // Draw name if zoomed in enough
            if (this.zoom > 1 && n.name) {
                ctx.fillStyle = 'rgba(255,255,255,0.7)';
                ctx.font = Math.max(8, 10 / this.zoom) + 'px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillText(n.name, n.x, n.y + nodeRadius + 2);
            }
        }

        // Draw origin crosshair for reference
        ctx.strokeStyle = 'rgba(255,0,0,0.3)';
        ctx.lineWidth = 1 / this.zoom;
        ctx.beginPath();
        ctx.moveTo(-20, 0);
        ctx.lineTo(20, 0);
        ctx.moveTo(0, -20);
        ctx.lineTo(0, 20);
        ctx.stroke();

        ctx.restore();

        // HUD
        ctx.fillStyle = 'rgba(184, 168, 120, 0.6)';
        ctx.font = '11px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('TRUSTED RENDERER', 10, 10);
        ctx.fillText('nodes: ' + this.nodes.length + '  edges: ' + this.edges.length +
                      '  zoom: ' + this.zoom.toFixed(2), 10, 24);
        var withPos = 0;
        for (var k = 0; k < this.nodes.length; k++) {
            if (this.nodes[k].x !== 0 || this.nodes[k].y !== 0) withPos++;
        }
        ctx.fillText('withPos: ' + withPos + '/' + this.nodes.length, 10, 38);
    },

    // =========================================================================
    // EVENTS
    // =========================================================================

    _bindEvents: function() {
        var self = this;
        var c = this.canvas;

        c.addEventListener('mousedown', function(e) {
            self.isPanning = true;
            self._panStartX = e.clientX;
            self._panStartY = e.clientY;
            self._panStartPanX = self.panX;
            self._panStartPanY = self.panY;
        });

        c.addEventListener('mousemove', function(e) {
            if (self.isPanning) {
                self.panX = self._panStartPanX + (e.clientX - self._panStartX);
                self.panY = self._panStartPanY + (e.clientY - self._panStartY);
                self._needsRender = true;
            }
        });

        c.addEventListener('mouseup', function() { self.isPanning = false; });
        c.addEventListener('mouseleave', function() { self.isPanning = false; });

        c.addEventListener('wheel', function(e) {
            e.preventDefault();
            var factor = e.deltaY < 0 ? 1.15 : 0.87;
            self.zoom *= factor;
            self.zoom = Math.max(0.05, Math.min(20, self.zoom));
            self._needsRender = true;
        });

        window.addEventListener('resize', function() { self._resize(); });
    },

    // =========================================================================
    // SHOW / HIDE
    // =========================================================================

    show: function() {
        if (this.canvas) this.canvas.style.display = 'block';
        this._needsRender = true;
    },

    hide: function() {
        if (this.canvas) this.canvas.style.display = 'none';
    },

    clear: function() {
        this.nodes = [];
        this.edges = [];
        this.schools = {};
        this._nodeMap = {};
        this._needsRender = true;
    },

    // =========================================================================
    // LOGGING
    // =========================================================================

    _log: function(msg) {
        var full = '[TrustedRenderer] ' + msg;
        console.log(full);
        if (window.callCpp) {
            try {
                window.callCpp('LogMessage', JSON.stringify({ message: full, level: 'info' }));
            } catch (e) { /* ignore */ }
        }
    }
};

console.log('[TrustedRenderer] Loaded');
