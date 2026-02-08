/**
 * Starfield Module - Twinkling star background effect
 *
 * Supports two modes:
 * - Fixed: stars are screen-space (drift + wrap around edges)
 * - World-space: stars are deterministic based on seed + position
 *   so they remain stable as the user pans/zooms
 */

var Starfield = {
    // Star data
    stars: null,

    // Configuration
    enabled: true,
    starCount: 200,
    maxSize: 2.5,
    minSize: 0.5,
    twinkleSpeed: 0.02,
    driftSpeed: 0.05,
    color: { r: 255, g: 255, b: 255 },
    seed: 42,

    // Canvas dimensions (set by init)
    width: 0,
    height: 0,

    // Twinkle phase accumulator (for world-space mode)
    _twinklePhase: 0,

    /**
     * Seeded pseudo-random number generator (mulberry32)
     * Returns a function that produces deterministic floats [0, 1)
     */
    _seededRng: function(seed) {
        var s = seed | 0;
        return function() {
            s = (s + 0x6D2B79F5) | 0;
            var t = Math.imul(s ^ (s >>> 15), 1 | s);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    },

    /**
     * Initialize starfield with seeded random star positions (fixed mode)
     */
    init: function(width, height) {
        this.width = width || 800;
        this.height = height || 600;
        this.stars = [];

        var rng = this._seededRng(this.seed);

        for (var i = 0; i < this.starCount; i++) {
            this.stars.push({
                x: rng() * this.width,
                y: rng() * this.height,
                size: this.minSize + rng() * (this.maxSize - this.minSize),
                phase: rng() * Math.PI * 2,
                twinkleRate: 0.5 + rng() * 1.5,
                baseOpacity: 0.3 + rng() * 0.5,
                dx: (rng() - 0.5) * this.driftSpeed,
                dy: (rng() - 0.5) * this.driftSpeed
            });
        }

        console.log('[Starfield] Initialized with', this.starCount, 'stars, seed:', this.seed);
    },

    /**
     * Update canvas dimensions (call on resize)
     */
    resize: function(width, height) {
        var oldWidth = this.width;
        var oldHeight = this.height;
        this.width = width;
        this.height = height;

        if (this.stars && oldWidth > 0 && oldHeight > 0) {
            var scaleX = width / oldWidth;
            var scaleY = height / oldHeight;
            for (var i = 0; i < this.stars.length; i++) {
                this.stars[i].x *= scaleX;
                this.stars[i].y *= scaleY;
            }
        }
    },

    /**
     * Update star positions and twinkle (fixed mode only)
     */
    update: function() {
        if (!this.stars) return;

        for (var i = 0; i < this.stars.length; i++) {
            var star = this.stars[i];
            star.phase += this.twinkleSpeed * star.twinkleRate;
            star.x += star.dx;
            star.y += star.dy;
            if (star.x < 0) star.x = this.width;
            if (star.x > this.width) star.x = 0;
            if (star.y < 0) star.y = this.height;
            if (star.y > this.height) star.y = 0;
        }
    },

    /**
     * Render stars (fixed to screen mode)
     */
    render: function(ctx) {
        if (!this.enabled || !this.stars) return;

        this.update();

        var rgb = this.color;

        for (var i = 0; i < this.stars.length; i++) {
            var star = this.stars[i];
            var twinkle = 0.5 + 0.5 * Math.sin(star.phase);
            var opacity = star.baseOpacity * twinkle;

            ctx.beginPath();
            ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + opacity.toFixed(2) + ')';
            ctx.fill();
        }
    },

    /**
     * Render stars in world-space mode (deterministic based on seed + viewport)
     * Stars are generated per-tile so they stay fixed as user pans.
     * @param {CanvasRenderingContext2D} ctx - Already transformed by pan/zoom
     * @param {number} panX - Current pan X offset
     * @param {number} panY - Current pan Y offset
     * @param {number} zoom - Current zoom level
     * @param {number} canvasW - Canvas width in pixels
     * @param {number} canvasH - Canvas height in pixels
     */
    renderWorldSpace: function(ctx, panX, panY, zoom, canvasW, canvasH) {
        if (!this.enabled) return;

        this._twinklePhase += this.twinkleSpeed;

        var rgb = this.color;
        // Tile size in world units - each tile gets a fixed set of stars
        var tileSize = 400;
        // Stars per tile (scale with density setting)
        var starsPerTile = Math.max(2, Math.round(this.starCount / 12));

        // Calculate visible world bounds from pan/zoom
        // Screen pixel (sx, sy) maps to world: wx = (sx - panX) / zoom
        var worldLeft = -panX / zoom;
        var worldTop = -panY / zoom;
        var worldRight = (canvasW - panX) / zoom;
        var worldBottom = (canvasH - panY) / zoom;

        // Add margin for stars near edges
        var margin = tileSize;
        worldLeft -= margin;
        worldTop -= margin;
        worldRight += margin;
        worldBottom += margin;

        // Tile range
        var tileMinX = Math.floor(worldLeft / tileSize);
        var tileMaxX = Math.floor(worldRight / tileSize);
        var tileMinY = Math.floor(worldTop / tileSize);
        var tileMaxY = Math.floor(worldBottom / tileSize);

        // Cap to prevent too many tiles at extreme zoom-out
        var maxTiles = 400;
        var tileCount = (tileMaxX - tileMinX + 1) * (tileMaxY - tileMinY + 1);
        if (tileCount > maxTiles) return;

        for (var tx = tileMinX; tx <= tileMaxX; tx++) {
            for (var ty = tileMinY; ty <= tileMaxY; ty++) {
                // Unique seed per tile
                var tileSeed = this.seed * 73856093 + tx * 19349663 + ty * 83492791;
                var rng = this._seededRng(tileSeed);

                for (var si = 0; si < starsPerTile; si++) {
                    var sx = tx * tileSize + rng() * tileSize;
                    var sy = ty * tileSize + rng() * tileSize;
                    var size = this.minSize + rng() * (this.maxSize - this.minSize);
                    var baseOpacity = 0.3 + rng() * 0.5;
                    var twinkleRate = 0.5 + rng() * 1.5;
                    var phaseOffset = rng() * Math.PI * 2;

                    // Twinkle
                    var twinkle = 0.5 + 0.5 * Math.sin(this._twinklePhase * twinkleRate + phaseOffset);
                    var opacity = baseOpacity * twinkle;

                    ctx.beginPath();
                    ctx.arc(sx, sy, size, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + opacity.toFixed(2) + ')';
                    ctx.fill();
                }
            }
        }
    },

    /**
     * Set star color from hex
     */
    setColor: function(hex) {
        if (!hex) return;
        var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (result) {
            this.color = {
                r: parseInt(result[1], 16),
                g: parseInt(result[2], 16),
                b: parseInt(result[3], 16)
            };
        }
    },

    /**
     * Configure starfield
     */
    configure: function(options) {
        if (!options) return;

        var needsReinit = false;

        if (options.enabled !== undefined) this.enabled = options.enabled;
        if (options.starCount !== undefined && options.starCount !== this.starCount) {
            this.starCount = options.starCount;
            needsReinit = true;
        }
        if (options.seed !== undefined && options.seed !== this.seed) {
            this.seed = options.seed;
            needsReinit = true;
        }
        if (options.maxSize !== undefined) this.maxSize = options.maxSize;
        if (options.minSize !== undefined) this.minSize = options.minSize;
        if (options.twinkleSpeed !== undefined) this.twinkleSpeed = options.twinkleSpeed;
        if (options.driftSpeed !== undefined) this.driftSpeed = options.driftSpeed;
        if (options.color) this.setColor(options.color);

        if (needsReinit) {
            this.init(this.width, this.height);
        }
    }
};

window.Starfield = Starfield;
