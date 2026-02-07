/**
 * Starfield Module - Twinkling star background effect
 * 
 * Lightweight pure-canvas implementation, no external libraries
 * Inspired by: https://codepen.io/bob6664569/pen/rOzmve
 * 
 * Performance: ~200 stars at 60fps with minimal CPU usage
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
    
    // Canvas dimensions (set by init)
    width: 0,
    height: 0,
    
    /**
     * Initialize starfield with random star positions
     */
    init: function(width, height) {
        this.width = width || 800;
        this.height = height || 600;
        this.stars = [];
        
        for (var i = 0; i < this.starCount; i++) {
            this.stars.push({
                x: Math.random() * this.width,
                y: Math.random() * this.height,
                size: this.minSize + Math.random() * (this.maxSize - this.minSize),
                // Twinkle phase (random start)
                phase: Math.random() * Math.PI * 2,
                // Twinkle speed variation
                twinkleRate: 0.5 + Math.random() * 1.5,
                // Base opacity
                baseOpacity: 0.3 + Math.random() * 0.5,
                // Drift direction
                dx: (Math.random() - 0.5) * this.driftSpeed,
                dy: (Math.random() - 0.5) * this.driftSpeed
            });
        }
        
        console.log('[Starfield] Initialized with', this.starCount, 'stars');
    },
    
    /**
     * Update canvas dimensions (call on resize)
     */
    resize: function(width, height) {
        var oldWidth = this.width;
        var oldHeight = this.height;
        this.width = width;
        this.height = height;
        
        // Scale star positions to new dimensions
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
     * Update star positions and twinkle
     */
    update: function() {
        if (!this.stars) return;
        
        for (var i = 0; i < this.stars.length; i++) {
            var star = this.stars[i];
            
            // Update twinkle phase
            star.phase += this.twinkleSpeed * star.twinkleRate;
            
            // Slow drift
            star.x += star.dx;
            star.y += star.dy;
            
            // Wrap around edges
            if (star.x < 0) star.x = this.width;
            if (star.x > this.width) star.x = 0;
            if (star.y < 0) star.y = this.height;
            if (star.y > this.height) star.y = 0;
        }
    },
    
    /**
     * Render stars to canvas
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     */
    render: function(ctx) {
        if (!this.enabled || !this.stars) return;
        
        this.update();
        
        var rgb = this.color;
        
        for (var i = 0; i < this.stars.length; i++) {
            var star = this.stars[i];
            
            // Calculate twinkle opacity (sine wave)
            var twinkle = 0.5 + 0.5 * Math.sin(star.phase);
            var opacity = star.baseOpacity * twinkle;
            
            // Draw star as small circle
            ctx.beginPath();
            ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + opacity.toFixed(2) + ')';
            ctx.fill();
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
