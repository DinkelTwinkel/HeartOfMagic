/**
 * WebGL Shaders for Spell Tree Renderer
 * 
 * Contains GLSL shader source code for:
 * - Node rendering (instanced shapes)
 * - Edge rendering (lines)
 */

var WebGLShaders = {
    
    // =========================================================================
    // NODE SHADERS - Instanced rendering of school-specific shapes
    // =========================================================================
    
    nodeVertex: `#version 300 es
        precision highp float;
        
        // Shape template vertex (from shape VBO)
        in vec2 a_shapeVertex;
        
        // Per-instance data
        in vec2 a_position;      // Node world position (x, y)
        in float a_size;         // Node size
        in vec4 a_color;         // Node color (r, g, b, a)
        in float a_state;        // 0=locked, 1=available, 2=unlocked, 3=selected, 4=mystery
        
        // Uniforms
        uniform mat3 u_viewMatrix;    // Combined pan/zoom/rotation matrix
        uniform vec2 u_resolution;    // Canvas resolution
        
        // Output to fragment shader
        out vec4 v_color;
        out float v_state;
        
        void main() {
            // Scale shape by node size
            vec2 scaledVertex = a_shapeVertex * a_size;
            
            // Apply node position
            vec2 worldPos = scaledVertex + a_position;
            
            // Apply view transform (pan, zoom, rotation)
            vec3 transformed = u_viewMatrix * vec3(worldPos, 1.0);
            
            // Convert to clip space (-1 to 1)
            vec2 clipSpace = (transformed.xy / u_resolution) * 2.0 - 1.0;
            clipSpace.y = -clipSpace.y;  // Flip Y for WebGL
            
            gl_Position = vec4(clipSpace, 0.0, 1.0);
            
            v_color = a_color;
            v_state = a_state;
        }
    `,
    
    nodeFragment: `#version 300 es
        precision highp float;
        
        in vec4 v_color;
        in float v_state;
        
        out vec4 fragColor;
        
        void main() {
            vec4 color = v_color;
            
            // Add subtle glow for unlocked/selected nodes
            if (v_state >= 2.0) {
                // Unlocked or selected - full brightness
                color.rgb *= 1.1;
            } else if (v_state >= 1.0) {
                // Available - slightly dimmed
                color.a *= 0.9;
            } else {
                // Locked/mystery - more dimmed
                color.a *= 0.6;
            }
            
            fragColor = color;
        }
    `,
    
    // =========================================================================
    // EDGE SHADERS - Simple line rendering
    // =========================================================================
    
    edgeVertex: `#version 300 es
        precision highp float;
        
        in vec2 a_position;
        in vec4 a_color;
        
        uniform mat3 u_viewMatrix;
        uniform vec2 u_resolution;
        
        out vec4 v_color;
        
        void main() {
            // Apply view transform
            vec3 transformed = u_viewMatrix * vec3(a_position, 1.0);
            
            // Convert to clip space
            vec2 clipSpace = (transformed.xy / u_resolution) * 2.0 - 1.0;
            clipSpace.y = -clipSpace.y;
            
            gl_Position = vec4(clipSpace, 0.0, 1.0);
            v_color = a_color;
        }
    `,
    
    edgeFragment: `#version 300 es
        precision highp float;
        
        in vec4 v_color;
        out vec4 fragColor;
        
        void main() {
            fragColor = v_color;
        }
    `,
    
    // =========================================================================
    // CENTER HUB SHADER - For the central "MAGIC" circle
    // =========================================================================
    
    hubVertex: `#version 300 es
        precision highp float;
        
        in vec2 a_position;
        
        uniform mat3 u_viewMatrix;
        uniform vec2 u_resolution;
        
        void main() {
            vec3 transformed = u_viewMatrix * vec3(a_position, 1.0);
            vec2 clipSpace = (transformed.xy / u_resolution) * 2.0 - 1.0;
            clipSpace.y = -clipSpace.y;
            gl_Position = vec4(clipSpace, 0.0, 1.0);
        }
    `,
    
    hubFragment: `#version 300 es
        precision highp float;
        
        uniform vec4 u_color;
        out vec4 fragColor;
        
        void main() {
            fragColor = u_color;
        }
    `,
    
    // =========================================================================
    // UTILITY FUNCTIONS
    // =========================================================================
    
    /**
     * Compile a shader from source
     * @param {WebGL2RenderingContext} gl
     * @param {number} type - gl.VERTEX_SHADER or gl.FRAGMENT_SHADER
     * @param {string} source - GLSL source code
     * @returns {WebGLShader|null}
     */
    compileShader: function(gl, type, source) {
        var shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('[WebGLShaders] Shader compile error:', gl.getShaderInfoLog(shader));
            console.error('[WebGLShaders] Source:', source.substring(0, 200));
            gl.deleteShader(shader);
            return null;
        }
        
        return shader;
    },
    
    /**
     * Create a shader program from vertex and fragment sources
     * @param {WebGL2RenderingContext} gl
     * @param {string} vertexSrc
     * @param {string} fragmentSrc
     * @returns {WebGLProgram|null}
     */
    createProgram: function(gl, vertexSrc, fragmentSrc) {
        var vertexShader = this.compileShader(gl, gl.VERTEX_SHADER, vertexSrc);
        var fragmentShader = this.compileShader(gl, gl.FRAGMENT_SHADER, fragmentSrc);
        
        if (!vertexShader || !fragmentShader) {
            return null;
        }
        
        var program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('[WebGLShaders] Program link error:', gl.getProgramInfoLog(program));
            gl.deleteProgram(program);
            return null;
        }
        
        // Clean up shaders (they're linked into program now)
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
        
        return program;
    },
    
    /**
     * Get all uniform locations for a program
     * @param {WebGL2RenderingContext} gl
     * @param {WebGLProgram} program
     * @param {string[]} names
     * @returns {Object}
     */
    getUniformLocations: function(gl, program, names) {
        var locations = {};
        for (var i = 0; i < names.length; i++) {
            locations[names[i]] = gl.getUniformLocation(program, names[i]);
        }
        return locations;
    },
    
    /**
     * Get all attribute locations for a program
     * @param {WebGL2RenderingContext} gl
     * @param {WebGLProgram} program
     * @param {string[]} names
     * @returns {Object}
     */
    getAttribLocations: function(gl, program, names) {
        var locations = {};
        for (var i = 0; i < names.length; i++) {
            locations[names[i]] = gl.getAttribLocation(program, names[i]);
        }
        return locations;
    }
};

// Export
window.WebGLShaders = WebGLShaders;
