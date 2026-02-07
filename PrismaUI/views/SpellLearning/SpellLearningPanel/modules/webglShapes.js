/**
 * WebGL Shape Definitions for Spell Tree Renderer
 * 
 * Pre-computed vertex data for school-specific shapes.
 * Each shape is defined as triangles (for gl.TRIANGULAR fan/strip).
 */

var WebGLShapes = {
    
    // Shape indices (must match shader expectations)
    SHAPE_CIRCLE: 0,      // Default/fallback
    SHAPE_DIAMOND: 1,     // Destruction
    SHAPE_OVAL: 2,        // Restoration
    SHAPE_HEXAGON: 3,     // Alteration
    SHAPE_PENTAGON: 4,    // Conjuration
    SHAPE_TRIANGLE: 5,    // Illusion
    
    // School to shape mapping
    // Restoration uses CIRCLE (index 0), not oval
    schoolShapes: {
        'Destruction': 1,   // Diamond
        'Restoration': 0,   // Circle (NOT oval - user requested)
        'Alteration': 3,    // Hexagon
        'Conjuration': 4,   // Pentagon
        'Illusion': 5       // Triangle (pointing toward origin)
    },
    
    /**
     * Get shape index for a school name
     * @param {string} school
     * @returns {number}
     */
    getShapeIndex: function(school) {
        return this.schoolShapes[school] || 0;
    },
    
    /**
     * Generate circle vertices (triangle fan from center)
     * @param {number} segments - Number of segments (more = smoother)
     * @returns {Float32Array} - Vertex positions [x,y, x,y, ...]
     */
    createCircle: function(segments) {
        segments = segments || 16;
        // Triangle fan: center + outer vertices
        var vertices = [0, 0];  // Center
        
        for (var i = 0; i <= segments; i++) {
            var angle = (i / segments) * Math.PI * 2;
            vertices.push(Math.cos(angle));
            vertices.push(Math.sin(angle));
        }
        
        return new Float32Array(vertices);
    },
    
    /**
     * Generate diamond vertices (4-pointed shape)
     * @returns {Float32Array}
     */
    createDiamond: function() {
        // Triangle fan from center
        return new Float32Array([
            0, 0,       // Center
            0, -1,      // Top
            1, 0,       // Right
            0, 1,       // Bottom
            -1, 0,      // Left
            0, -1       // Back to top (close)
        ]);
    },
    
    /**
     * Generate oval vertices (horizontally stretched circle)
     * @returns {Float32Array}
     */
    createOval: function() {
        var segments = 16;
        var vertices = [0, 0];  // Center
        var scaleX = 1.0;
        var scaleY = 0.7;  // Vertically compressed
        
        for (var i = 0; i <= segments; i++) {
            var angle = (i / segments) * Math.PI * 2;
            vertices.push(Math.cos(angle) * scaleX);
            vertices.push(Math.sin(angle) * scaleY);
        }
        
        return new Float32Array(vertices);
    },
    
    /**
     * Generate hexagon vertices
     * @returns {Float32Array}
     */
    createHexagon: function() {
        var vertices = [0, 0];  // Center
        var scaleW = 0.9;
        var scaleH = 0.5;
        
        // 6 outer points for hexagon
        vertices.push(0, -1);                    // Top
        vertices.push(scaleW, -scaleH);          // Top-right
        vertices.push(scaleW, scaleH);           // Bottom-right
        vertices.push(0, 1);                     // Bottom
        vertices.push(-scaleW, scaleH);          // Bottom-left
        vertices.push(-scaleW, -scaleH);         // Top-left
        vertices.push(0, -1);                    // Close
        
        return new Float32Array(vertices);
    },
    
    /**
     * Generate pentagon vertices
     * @returns {Float32Array}
     */
    createPentagon: function() {
        var vertices = [0, 0];  // Center
        
        for (var i = 0; i <= 5; i++) {
            var angle = (i * 72 - 90) * Math.PI / 180;
            vertices.push(Math.cos(angle));
            vertices.push(Math.sin(angle));
        }
        
        return new Float32Array(vertices);
    },
    
    /**
     * Generate triangle vertices (pointing DOWN toward origin)
     * @returns {Float32Array}
     */
    createTriangle: function() {
        // Triangle fan from center - tip pointing DOWN (toward center/origin)
        return new Float32Array([
            0, 0,       // Center
            0, 1,       // Bottom tip (pointing toward origin)
            -1, -0.7,   // Top-left
            1, -0.7,    // Top-right
            0, 1        // Close
        ]);
    },
    
    /**
     * Get all shape vertex arrays
     * @returns {Object}
     */
    getAllShapes: function() {
        return {
            circle: this.createCircle(16),
            diamond: this.createDiamond(),
            oval: this.createOval(),
            hexagon: this.createHexagon(),
            pentagon: this.createPentagon(),
            triangle: this.createTriangle()
        };
    },
    
    /**
     * Create shape vertex buffers for WebGL
     * @param {WebGL2RenderingContext} gl
     * @returns {Object} - Shape name -> { buffer, vertexCount }
     */
    createShapeBuffers: function(gl) {
        var shapes = this.getAllShapes();
        var buffers = {};
        
        for (var name in shapes) {
            var vertices = shapes[name];
            var buffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
            
            buffers[name] = {
                buffer: buffer,
                vertexCount: vertices.length / 2
            };
        }
        
        // Map shape indices to buffer info
        buffers.byIndex = [
            buffers.circle,     // 0 - default
            buffers.diamond,    // 1 - Destruction
            buffers.oval,       // 2 - Restoration
            buffers.hexagon,    // 3 - Alteration
            buffers.pentagon,   // 4 - Conjuration
            buffers.triangle    // 5 - Illusion
        ];
        
        console.log('[WebGLShapes] Created buffers for', Object.keys(shapes).length, 'shapes');
        return buffers;
    },
    
    /**
     * Create a filled circle for center hub
     * @param {number} radius
     * @param {number} segments
     * @returns {Float32Array}
     */
    createFilledCircle: function(radius, segments) {
        segments = segments || 32;
        var vertices = [0, 0];  // Center
        
        for (var i = 0; i <= segments; i++) {
            var angle = (i / segments) * Math.PI * 2;
            vertices.push(Math.cos(angle) * radius);
            vertices.push(Math.sin(angle) * radius);
        }
        
        return new Float32Array(vertices);
    },
    
    /**
     * Create a circle outline (for stroke)
     * @param {number} radius
     * @param {number} segments
     * @returns {Float32Array}
     */
    createCircleOutline: function(radius, segments) {
        segments = segments || 32;
        var vertices = [];
        
        for (var i = 0; i <= segments; i++) {
            var angle = (i / segments) * Math.PI * 2;
            vertices.push(Math.cos(angle) * radius);
            vertices.push(Math.sin(angle) * radius);
        }
        
        return new Float32Array(vertices);
    }
};

// Export
window.WebGLShapes = WebGLShapes;
