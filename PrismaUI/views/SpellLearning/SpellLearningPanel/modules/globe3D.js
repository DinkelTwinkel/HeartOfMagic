/**
 * Globe3D Module - 3D particle sphere effect for central hub
 * 
 * Renders a rotating sphere of particles using 2D Canvas API
 * Based on improved projection from: https://codepen.io/mamboleoo/pen/bGvJjoj
 * 
 * Depends on: None (standalone)
 */

var Globe3D = {
    // Particle data
    particles: null,
    
    // Rotation state (single value for smooth rotation)
    rotation: 0,
    
    // Configuration
    enabled: true,
    particleCount: 200,       // More particles for denser look
    radius: 30,               // Globe radius
    dotSizeMin: 1,            // Minimum dot size
    dotSizeMax: 3,            // Maximum dot size
    fieldOfView: 80,          // Perspective field of view
    globeCenterZ: -30,        // Globe center behind camera (creates wrap effect)
    rotationSpeed: 0.008,     // Single rotation speed
    
    // Color (will be updated from renderer settings)
    color: { r: 184, g: 168, b: 120 },
    
    // Orbiting stars with trails (disabled by default)
    orbitingStarsEnabled: false,
    orbitingStars: [],
    orbitRadius: 42,
    orbitTrailLength: 12,
    starSpawnTimer: 0,
    
    // Detached particles traveling along paths
    detachedParticles: [],
    particleRegenerationQueue: [],
    trailEnabled: true,  // Whether to show particle trail
    
    /**
     * Initialize globe particles with random spherical distribution
     */
    init: function() {
        this.particles = [];
        var count = this.particleCount;
        var radius = this.radius;
        var centerZ = this.globeCenterZ;
        var sizeMin = this.dotSizeMin || 1;
        var sizeMax = this.dotSizeMax || 3;
        var sizeRange = sizeMax - sizeMin;
        
        for (var i = 0; i < count; i++) {
            // Random spherical distribution (uniform on sphere surface)
            var theta = Math.random() * 2 * Math.PI;           // Random [0, 2PI]
            var phi = Math.acos((Math.random() * 2) - 1);      // Random [-1, 1] -> uniform on sphere
            
            // Calculate 3D coordinates
            var x = radius * Math.sin(phi) * Math.cos(theta);
            var y = radius * Math.sin(phi) * Math.sin(theta);
            var z = (radius * Math.cos(phi)) + centerZ;
            
            // Random size within range
            var particleSize = sizeMin + Math.random() * sizeRange;
            
            this.particles.push({
                // Base 3D position (before rotation)
                baseX: x,
                baseY: y, 
                baseZ: z,
                // Current 3D position (after rotation)
                x: x,
                y: y,
                z: z,
                // 2D projected coords
                projX: 0,
                projY: 0,
                projScale: 1,
                // Visual properties
                size: particleSize,
                alpha: 0.7 + Math.random() * 0.3
            });
        }
        
        console.log('[Globe3D] Initialized with', count, 'particles, size range:', sizeMin, '-', sizeMax);
    },
    
    /**
     * Set color from hex string
     */
    setColor: function(hex) {
        if (!hex) return;
        
        // Parse hex color
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
     * Project all particles from 3D to 2D based on current rotation
     * Uses improved projection math for better depth effect
     */
    project: function() {
        if (!this.particles) return;
        
        var fov = this.fieldOfView;
        var centerZ = this.globeCenterZ;
        var sin = Math.sin(this.rotation);
        var cos = Math.cos(this.rotation);
        
        for (var i = 0; i < this.particles.length; i++) {
            var p = this.particles[i];
            
            // Rotate around Y axis (relative to globe center)
            var rotX = cos * p.baseX + sin * (p.baseZ - centerZ);
            var rotZ = -sin * p.baseX + cos * (p.baseZ - centerZ) + centerZ;
            
            // Perspective projection with field of view
            var scale = fov / (fov - rotZ);
            
            p.x = rotX;
            p.y = p.baseY;
            p.z = rotZ;
            p.projX = rotX * scale;
            p.projY = p.baseY * scale;
            p.projScale = scale;
        }
        
        // Depth sort (back to front)
        this.particles.sort(function(a, b) {
            return a.z - b.z;
        });
    },
    
    /**
     * Update rotation (call each frame)
     */
    update: function() {
        this.rotation += this.rotationSpeed;
        
        // Update orbiting stars
        this._updateOrbitingStars();
        
        // Update detached particles
        this._updateDetachedParticles();
    },
    
    /**
     * Spawn a new orbiting star
     */
    _spawnOrbitingStar: function() {
        // Random orbit plane (tilt angle)
        var tiltX = (Math.random() - 0.5) * Math.PI * 0.6;  // -54 to +54 degrees
        var tiltZ = (Math.random() - 0.5) * Math.PI * 0.4;  // -36 to +36 degrees
        
        // Random starting position on orbit
        var angle = Math.random() * Math.PI * 2;
        
        // Random speed (direction and magnitude)
        var speed = (0.03 + Math.random() * 0.04) * (Math.random() > 0.5 ? 1 : -1);
        
        // Random lifetime (3-8 seconds at ~20fps throttled = 60-160 frames)
        var lifetime = 60 + Math.floor(Math.random() * 100);
        
        this.orbitingStars.push({
            angle: angle,
            tiltX: tiltX,
            tiltZ: tiltZ,
            speed: speed,
            lifetime: lifetime,
            age: 0,
            trail: [],  // Array of {x, y, alpha}
            size: 2 + Math.random() * 1.5
        });
    },
    
    /**
     * Update all orbiting stars
     */
    _updateOrbitingStars: function() {
        if (!this.orbitingStarsEnabled) return;
        
        // Manage star count (1-3 stars)
        this.starSpawnTimer++;
        
        // Try to spawn if we have less than 3 and timer allows
        if (this.orbitingStars.length < 3 && this.starSpawnTimer > 30) {
            // Probability increases when fewer stars
            var spawnChance = (3 - this.orbitingStars.length) * 0.02;
            if (Math.random() < spawnChance) {
                this._spawnOrbitingStar();
                this.starSpawnTimer = 0;
            }
        }
        
        // Ensure at least 1 star
        if (this.orbitingStars.length === 0) {
            this._spawnOrbitingStar();
        }
        
        // Update each star
        for (var i = this.orbitingStars.length - 1; i >= 0; i--) {
            var star = this.orbitingStars[i];
            
            // Age the star
            star.age++;
            
            // Remove if expired
            if (star.age > star.lifetime) {
                this.orbitingStars.splice(i, 1);
                continue;
            }
            
            // Update position
            star.angle += star.speed;
            
            // Calculate 3D position on tilted orbit
            var orbitR = this.orbitRadius;
            var x = orbitR * Math.cos(star.angle);
            var y = orbitR * Math.sin(star.angle);
            var z = 0;
            
            // Apply orbit tilt around X axis
            var cosX = Math.cos(star.tiltX);
            var sinX = Math.sin(star.tiltX);
            var y1 = y * cosX - z * sinX;
            var z1 = y * sinX + z * cosX;
            
            // Apply orbit tilt around Z axis
            var cosZ = Math.cos(star.tiltZ);
            var sinZ = Math.sin(star.tiltZ);
            var x2 = x * cosZ - y1 * sinZ;
            var y2 = x * sinZ + y1 * cosZ;
            
            // Apply globe rotation
            var cosRX = Math.cos(this.rotationX * 0.3);  // Stars rotate slower
            var sinRX = Math.sin(this.rotationX * 0.3);
            var cosRY = Math.cos(this.rotationY * 0.3);
            var sinRY = Math.sin(this.rotationY * 0.3);
            
            var y3 = y2 * cosRX - z1 * sinRX;
            var z3 = y2 * sinRX + z1 * cosRX;
            var x4 = x2 * cosRY + z3 * sinRY;
            var z4 = -x2 * sinRY + z3 * cosRY;
            
            // Project to 2D
            var scale = this.perspective / (this.perspective + z4);
            var projX = x4 * scale;
            var projY = y3 * scale;
            
            // Calculate alpha (fade in/out at edges of lifetime)
            var lifeProgress = star.age / star.lifetime;
            var alpha = 1.0;
            if (lifeProgress < 0.1) {
                alpha = lifeProgress / 0.1;  // Fade in
            } else if (lifeProgress > 0.8) {
                alpha = (1 - lifeProgress) / 0.2;  // Fade out
            }
            
            // Add to trail
            star.trail.unshift({ x: projX, y: projY, alpha: alpha, z: z4 });
            
            // Limit trail length
            if (star.trail.length > this.orbitTrailLength) {
                star.trail.pop();
            }
        }
    },
    
    /**
     * Render orbiting stars with trails
     */
    _renderOrbitingStars: function(ctx) {
        if (this.orbitingStars.length === 0) return;
        
        for (var i = 0; i < this.orbitingStars.length; i++) {
            var star = this.orbitingStars[i];
            if (star.trail.length === 0) continue;
            
            // Draw trail (older = more faded)
            for (var j = star.trail.length - 1; j >= 0; j--) {
                var pos = star.trail[j];
                var trailAlpha = (1 - j / star.trail.length) * pos.alpha * 0.8;
                var trailSize = star.size * (1 - j / star.trail.length * 0.5);
                
                // Skip if behind globe center
                if (pos.z < -this.radius * 0.5 && j > 0) continue;
                
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, Math.max(0.5, trailSize), 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255, 255, 255, ' + trailAlpha.toFixed(2) + ')';
                ctx.fill();
            }
            
            // Draw star head (brightest)
            if (star.trail.length > 0) {
                var head = star.trail[0];
                
                // Outer glow
                ctx.beginPath();
                ctx.arc(head.x, head.y, star.size * 2.5, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255, 255, 255, ' + (head.alpha * 0.3).toFixed(2) + ')';
                ctx.fill();
                
                // Inner bright core
                ctx.beginPath();
                ctx.arc(head.x, head.y, star.size, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255, 255, 255, ' + head.alpha.toFixed(2) + ')';
                ctx.fill();
            }
        }
    },
    
    /**
     * Render the globe particles
     * @param {CanvasRenderingContext2D} ctx - Canvas context (should be at center position)
     */
    render: function(ctx) {
        if (!this.enabled || !this.particles) return;
        
        // Update rotation and project
        this.update();
        this.project();
        
        var rgb = this.color;
        
        // Draw particles (sorted back to front - all particles visible)
        for (var i = 0; i < this.particles.length; i++) {
            var p = this.particles[i];
            
            // Skip regenerating particles
            if (p.regenerating && p.size < 0.5) continue;
            
            // Calculate size with projection
            var size = p.size * p.projScale;
            
            // Alpha based on depth and projection (creates natural depth fade)
            var alpha = Math.min(1, p.alpha * p.projScale * 0.9);
            
            // Draw particle
            ctx.beginPath();
            ctx.arc(p.projX, p.projY, Math.max(0.5, size), 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + alpha.toFixed(2) + ')';
            ctx.fill();
        }
        
        // Draw orbiting stars on top (if enabled)
        this._renderOrbitingStars(ctx);
        
        // NOTE: Detached particles are rendered separately by canvasRenderer
        // in the wheel's rotated context (not here in the hub's context)
    },
    
    /**
     * Configure globe settings
     */
    configure: function(options) {
        if (!options) return;
        
        if (options.enabled !== undefined) this.enabled = options.enabled;
        if (options.particleCount !== undefined) {
            this.particleCount = options.particleCount;
            this.init();  // Reinitialize with new count
        }
        if (options.radius !== undefined) {
            this.radius = options.radius;
            this.globeCenterZ = -options.radius;  // Keep center behind camera
        }
        if (options.fieldOfView !== undefined) this.fieldOfView = options.fieldOfView;
        if (options.dotRadius !== undefined) this.dotRadius = options.dotRadius;
        if (options.rotationSpeed !== undefined) this.rotationSpeed = options.rotationSpeed;
        if (options.color) this.setColor(options.color);
    },
    
    /**
     * Clear all detached particles (call when learning target changes)
     */
    clearDetachedParticles: function() {
        this.detachedParticles = [];
        console.log('[Globe3D] Cleared detached particles');
    },
    
    /**
     * Detach a particle from the globe to travel along a path
     * @param {Array} pathSegments - Array of {from:{x,y}, to:{x,y}} segments
     * @param {number} speed - Travel speed (0-1 progress per frame)
     * @param {string} colorHex - Optional hex color for the particle (defaults to learning color)
     * @returns {boolean} - Whether a particle was successfully detached
     */
    detachParticleToPath: function(pathSegments, speed, colorHex) {
        if (!this.particles || this.particles.length === 0) return false;
        if (!pathSegments || pathSegments.length === 0) return false;
        
        // Find a visible particle (front-facing based on projection scale)
        // In new projection, larger projScale = closer to camera = front-facing
        var candidates = [];
        for (var i = 0; i < this.particles.length; i++) {
            var p = this.particles[i];
            // Skip regenerating particles and check if front-facing
            if (!p.regenerating && p.projScale > 1.0) {
                candidates.push(i);
            }
        }
        
        // If no ideal candidates, use any non-regenerating particle
        if (candidates.length === 0) {
            for (var i = 0; i < this.particles.length; i++) {
                if (!this.particles[i].regenerating) {
                    candidates.push(i);
                }
            }
        }
        
        if (candidates.length === 0) return false;
        
        // Pick a random front-facing particle
        var idx = candidates[Math.floor(Math.random() * candidates.length)];
        var particle = this.particles[idx];
        
        // Calculate initial progress so particle starts at globe edge (not center)
        // Calculate total path length first
        var totalLength = 0;
        for (var j = 0; j < pathSegments.length; j++) {
            var seg = pathSegments[j];
            var dx = seg.to.x - seg.from.x;
            var dy = seg.to.y - seg.from.y;
            totalLength += Math.sqrt(dx * dx + dy * dy);
        }
        
        // Start at globe radius (30) plus a small buffer
        var startDistance = this.radius + 5;  // Start just outside globe edge
        var initialProgress = Math.min(0.3, startDistance / totalLength);  // Cap at 30% of path
        
        // Pre-populate trail so it doesn't "pop" into existence
        var initialPos = this._getPositionAlongPath(pathSegments, initialProgress);
        var initialTrail = [];
        if (initialPos) {
            initialTrail.push({ x: initialPos.x, y: initialPos.y, alpha: 1.0 });
        }
        
        // Parse color if provided (hex to RGB)
        var particleColor = this.color;  // Default to globe color
        if (colorHex) {
            var hex = colorHex.replace('#', '');
            particleColor = {
                r: parseInt(hex.substring(0, 2), 16),
                g: parseInt(hex.substring(2, 4), 16),
                b: parseInt(hex.substring(4, 6), 16)
            };
        }
        
        // Create detached particle - follows path from center outward
        this.detachedParticles.push({
            pathSegments: pathSegments,
            progress: initialProgress,
            speed: speed || 0.015,
            // Visual properties - use same size as globe particle
            size: particle.size,
            alpha: 1.0,
            color: particleColor,  // Use learning color if provided
            trail: initialTrail
        });
        
        // Queue this particle for regeneration (will smoothly regrow)
        this.particles[idx].regenerating = true;
        this.particles[idx].regenProgress = 0;
        this.particles[idx].originalSize = particle.size;
        this.particles[idx].size = 0;  // Shrink to nothing
        
        return true;
    },
    
    /**
     * Update detached particles traveling along paths
     */
    _updateDetachedParticles: function() {
        for (var i = this.detachedParticles.length - 1; i >= 0; i--) {
            var dp = this.detachedParticles[i];
            
            // Update progress
            dp.progress += dp.speed;
            
            // Calculate position along path
            var pos = this._getPositionAlongPath(dp.pathSegments, dp.progress);
            if (pos) {
                // Add to trail (longer trail for more visible effect)
                dp.trail.unshift({ x: pos.x, y: pos.y, alpha: dp.alpha });
                if (dp.trail.length > 30) dp.trail.pop();  // Longer trail (30 frames)
            }
            
            // No fade - particle stays solid until it reaches destination
            
            // Remove when complete
            if (dp.progress >= 1.0) {
                this.detachedParticles.splice(i, 1);
            }
        }
        
        // Regenerate shrunk particles
        for (var j = 0; j < this.particles.length; j++) {
            var p = this.particles[j];
            if (p.regenerating) {
                p.regenProgress += 0.02;  // Slow regrowth
                p.size = p.originalSize * Math.min(1, p.regenProgress);
                if (p.regenProgress >= 1) {
                    p.regenerating = false;
                }
            }
        }
    },
    
    /**
     * Render detached particles with trails
     * Renders like a globe particle traveling along the path
     */
    _renderDetachedParticles: function(ctx) {
        for (var i = 0; i < this.detachedParticles.length; i++) {
            var dp = this.detachedParticles[i];
            var rgb = dp.color || this.color;  // Use particle's color (learning color)
            
            // Draw trail (fading behind the head) - only if enabled
            if (this.trailEnabled) {
                for (var j = dp.trail.length - 1; j >= 1; j--) {
                    var t = dp.trail[j];
                    var trailFade = 1 - j / dp.trail.length;
                    var trailAlpha = trailFade * dp.alpha * 0.7;  // More visible trail
                    var trailSize = dp.size * (0.3 + trailFade * 0.7);  // Gradual size fade
                    
                    ctx.beginPath();
                    ctx.arc(t.x, t.y, Math.max(1, trailSize), 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + trailAlpha.toFixed(2) + ')';
                    ctx.fill();
                }
            }
            
            // Draw head - slightly larger and brighter
            if (dp.trail.length > 0) {
                var head = dp.trail[0];
                
                // Soft glow around head
                ctx.beginPath();
                ctx.arc(head.x, head.y, dp.size * 1.5, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + (dp.alpha * 0.3).toFixed(2) + ')';
                ctx.fill();
                
                // Bright core
                ctx.beginPath();
                ctx.arc(head.x, head.y, dp.size, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + dp.alpha.toFixed(2) + ')';
                ctx.fill();
            }
        }
    },
    
    /**
     * Get position along path segments
     */
    _getPositionAlongPath: function(segments, progress) {
        if (!segments || segments.length === 0) return null;
        
        // Calculate total length
        var totalLength = 0;
        var lengths = [];
        for (var i = 0; i < segments.length; i++) {
            var s = segments[i];
            var dx = s.to.x - s.from.x;
            var dy = s.to.y - s.from.y;
            var len = Math.sqrt(dx * dx + dy * dy);
            lengths.push(len);
            totalLength += len;
        }
        
        var targetDist = progress * totalLength;
        var distSoFar = 0;
        
        for (var i = 0; i < segments.length; i++) {
            if (distSoFar + lengths[i] >= targetDist) {
                var segProgress = (targetDist - distSoFar) / lengths[i];
                var s = segments[i];
                return {
                    x: s.from.x + (s.to.x - s.from.x) * segProgress,
                    y: s.from.y + (s.to.y - s.from.y) * segProgress
                };
            }
            distSoFar += lengths[i];
        }
        
        var last = segments[segments.length - 1];
        return { x: last.to.x, y: last.to.y };
    }
};

// Auto-initialize
Globe3D.init();

window.Globe3D = Globe3D;
