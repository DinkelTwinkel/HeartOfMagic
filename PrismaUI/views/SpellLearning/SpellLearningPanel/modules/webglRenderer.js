/**
 * WebGLRenderer Module - GPU-accelerated rendering for large spell trees
 * 
 * Uses WebGL 2.0 with instanced rendering for high performance.
 * Falls back to CanvasRenderer if WebGL is not available.
 * 
 * Depends on: TREE_CONFIG, settings, state, WebGLShaders, WebGLShapes
 */

var WebGLRenderer = {
    // WebGL context and canvas
    canvas: null,
    gl: null,
    container: null,
    
    // Label overlay canvas (for text)
    labelCanvas: null,
    labelCtx: null,
    
    // Data
    nodes: [],
    edges: [],
    schools: {},
    
    // Transform state
    zoom: 1,
    panX: 0,
    panY: 0,
    rotation: 0,
    isAnimating: false,
    
    // Interaction state
    isPanning: false,
    panStartX: 0,
    panStartY: 0,
    selectedNode: null,
    hoveredNode: null,
    
    // Spatial index for hit detection
    _nodeGrid: null,
    _gridCellSize: 50,
    
    // Performance
    _rafId: null,
    _needsRender: true,
    _needsLabelRender: true,
    _lastRenderTime: 0,
    
    // Node lookup
    _nodeMap: null,
    _nodeByFormId: null,
    
    // WebGL resources
    _programs: null,
    _shapeBuffers: null,
    _nodeInstanceBuffer: null,
    _nodeInstanceData: null,
    _edgeBuffer: null,
    _edgeColorBuffer: null,
    _hubBuffer: null,
    _dividerBuffer: null,
    
    // Cached counts
    _nodeCount: 0,
    _edgeVertexCount: 0,
    _visibleNodeCount: 0,
    
    // Dimensions
    _width: 0,
    _height: 0,
    
    // WebGL availability
    _webglAvailable: null,
    
    // =========================================================================
    // INITIALIZATION
    // =========================================================================
    
    /**
     * Initialize WebGL renderer
     * @param {HTMLElement} container
     * @returns {WebGLRenderer|null}
     */
    init: function(container) {
        this.container = container;
        
        // Check WebGL availability
        if (!this.checkWebGLSupport()) {
            console.warn('[WebGLRenderer] WebGL 2.0 not available, falling back to Canvas');
            return null;
        }
        
        // Create WebGL canvas
        if (!this.canvas) {
            this.canvas = document.createElement('canvas');
            this.canvas.id = 'tree-webgl';
            this.canvas.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: block;';
            
            // Get WebGL 2.0 context
            this.gl = this.canvas.getContext('webgl2', {
                alpha: true,
                antialias: true,
                premultipliedAlpha: false
            });
            
            if (!this.gl) {
                console.error('[WebGLRenderer] Failed to get WebGL 2.0 context');
                return null;
            }
            
            // Create label overlay canvas
            this.labelCanvas = document.createElement('canvas');
            this.labelCanvas.id = 'tree-webgl-labels';
            this.labelCanvas.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;';
            this.labelCtx = this.labelCanvas.getContext('2d');
            
            // Initialize shaders and buffers
            if (!this.initShaders()) {
                console.error('[WebGLRenderer] Failed to initialize shaders');
                return null;
            }
            
            this.initBuffers();
            this.setupEvents();
        }
        
        console.log('[WebGLRenderer] Initialized with container:', container ? container.id : 'null');
        return this;
    },
    
    /**
     * Check if WebGL 2.0 is supported
     * @returns {boolean}
     */
    checkWebGLSupport: function() {
        if (this._webglAvailable !== null) {
            return this._webglAvailable;
        }
        
        try {
            var testCanvas = document.createElement('canvas');
            var gl = testCanvas.getContext('webgl2');
            this._webglAvailable = !!gl;
            
            if (gl) {
                // Check for instanced rendering support (core in WebGL 2.0)
                var ext = gl.getExtension('ANGLE_instanced_arrays');
                // WebGL 2.0 has instancing built-in, no extension needed
                console.log('[WebGLRenderer] WebGL 2.0 available, max texture size:', gl.getParameter(gl.MAX_TEXTURE_SIZE));
            }
        } catch (e) {
            this._webglAvailable = false;
        }
        
        return this._webglAvailable;
    },
    
    /**
     * Initialize shader programs
     * @returns {boolean}
     */
    initShaders: function() {
        var gl = this.gl;
        
        this._programs = {};
        
        // Node shader program
        this._programs.node = WebGLShaders.createProgram(gl, WebGLShaders.nodeVertex, WebGLShaders.nodeFragment);
        if (!this._programs.node) return false;
        
        this._programs.nodeUniforms = WebGLShaders.getUniformLocations(gl, this._programs.node, 
            ['u_viewMatrix', 'u_resolution']);
        this._programs.nodeAttribs = WebGLShaders.getAttribLocations(gl, this._programs.node,
            ['a_shapeVertex', 'a_position', 'a_size', 'a_color', 'a_state']);
        
        // Edge shader program
        this._programs.edge = WebGLShaders.createProgram(gl, WebGLShaders.edgeVertex, WebGLShaders.edgeFragment);
        if (!this._programs.edge) return false;
        
        this._programs.edgeUniforms = WebGLShaders.getUniformLocations(gl, this._programs.edge,
            ['u_viewMatrix', 'u_resolution']);
        this._programs.edgeAttribs = WebGLShaders.getAttribLocations(gl, this._programs.edge,
            ['a_position', 'a_color']);
        
        // Hub shader program
        this._programs.hub = WebGLShaders.createProgram(gl, WebGLShaders.hubVertex, WebGLShaders.hubFragment);
        if (!this._programs.hub) return false;
        
        this._programs.hubUniforms = WebGLShaders.getUniformLocations(gl, this._programs.hub,
            ['u_viewMatrix', 'u_resolution', 'u_color']);
        this._programs.hubAttribs = WebGLShaders.getAttribLocations(gl, this._programs.hub,
            ['a_position']);
        
        console.log('[WebGLRenderer] Shaders compiled successfully');
        return true;
    },
    
    /**
     * Initialize vertex buffers
     */
    initBuffers: function() {
        var gl = this.gl;
        
        // Create shape template buffers
        this._shapeBuffers = WebGLShapes.createShapeBuffers(gl);
        
        // Create center hub buffer (filled circle, radius 45)
        var hubVertices = WebGLShapes.createFilledCircle(45, 32);
        this._hubBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this._hubBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, hubVertices, gl.STATIC_DRAW);
        this._hubVertexCount = hubVertices.length / 2;
        
        // Node instance buffer (will be filled in setData)
        this._nodeInstanceBuffer = gl.createBuffer();
        
        // Edge buffer (will be filled in setData)
        this._edgeBuffer = gl.createBuffer();
        this._edgeColorBuffer = gl.createBuffer();
        
        // School divider buffer (will be created in setData based on school count)
        this._dividerBuffer = gl.createBuffer();
        
        console.log('[WebGLRenderer] Buffers initialized');
    },
    
    // =========================================================================
    // EVENT HANDLING
    // =========================================================================
    
    setupEvents: function() {
        var self = this;
        
        this.canvas.addEventListener('mousedown', function(e) {
            self.onMouseDown(e);
        });
        
        this.canvas.addEventListener('mousemove', function(e) {
            self.onMouseMove(e);
        });
        
        this.canvas.addEventListener('mouseup', function(e) {
            self.onMouseUp(e);
        });
        
        this.canvas.addEventListener('mouseleave', function(e) {
            self.onMouseUp(e);
        });
        
        this.canvas.addEventListener('wheel', function(e) {
            e.preventDefault();
            self.onWheel(e);
        }, { passive: false });
        
        this.canvas.addEventListener('click', function(e) {
            self.onClick(e);
        });
        
        window.addEventListener('resize', function() {
            self.updateCanvasSize();
        });
    },
    
    onMouseDown: function(e) {
        if (e.button === 0 || e.button === 2) {
            this.isPanning = true;
            this.panStartX = e.clientX - this.panX;
            this.panStartY = e.clientY - this.panY;
            this.canvas.style.cursor = 'grabbing';
            this._needsRender = true;
        }
    },
    
    onMouseMove: function(e) {
        if (this.isPanning) {
            this.panX = e.clientX - this.panStartX;
            this.panY = e.clientY - this.panStartY;
            this._needsRender = true;
            this._needsLabelRender = true;
        } else {
            // Hover detection
            var rect = this.canvas.getBoundingClientRect();
            var world = this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
            var node = this.findNodeAt(world.x, world.y);
            
            if (node !== this.hoveredNode) {
                this.hoveredNode = node;
                this.canvas.style.cursor = node ? 'pointer' : 'grab';
                this._needsRender = true;
                
                if (node && typeof WheelRenderer !== 'undefined' && WheelRenderer.showTooltip) {
                    WheelRenderer.showTooltip(node, e);
                } else if (typeof WheelRenderer !== 'undefined' && WheelRenderer.hideTooltip) {
                    WheelRenderer.hideTooltip();
                }
            }
        }
    },
    
    onMouseUp: function(e) {
        this.isPanning = false;
        this.canvas.style.cursor = this.hoveredNode ? 'pointer' : 'grab';
        this._needsRender = true;
    },
    
    onWheel: function(e) {
        var zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
        var newZoom = this.zoom * zoomFactor;
        newZoom = Math.max(0.1, Math.min(5, newZoom));
        
        // Zoom toward mouse position
        var rect = this.canvas.getBoundingClientRect();
        var mouseX = e.clientX - rect.left - rect.width / 2;
        var mouseY = e.clientY - rect.top - rect.height / 2;
        
        this.panX = mouseX - (mouseX - this.panX) * (newZoom / this.zoom);
        this.panY = mouseY - (mouseY - this.panY) * (newZoom / this.zoom);
        this.zoom = newZoom;
        
        this._needsRender = true;
        this._needsLabelRender = true;
        
        var zoomEl = document.getElementById('zoom-level');
        if (zoomEl) zoomEl.textContent = Math.round(this.zoom * 100) + '%';
    },
    
    onClick: function(e) {
        var rect = this.canvas.getBoundingClientRect();
        var world = this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        var clickedNode = this.findNodeAt(world.x, world.y);
        
        if (clickedNode) {
            this.selectedNode = clickedNode;
            this._needsRender = true;
            
            console.log('[WebGLRenderer] Node clicked:', clickedNode.name || clickedNode.id);
            
            this.handleNodeClickRotation(clickedNode);
            
            if (typeof WheelRenderer !== 'undefined' && WheelRenderer.onNodeClick) {
                WheelRenderer.onNodeClick(clickedNode);
            }
        } else {
            if (this.selectedNode) {
                this.selectedNode = null;
                this._needsRender = true;
            }
        }
    },
    
    // =========================================================================
    // COORDINATE TRANSFORMS
    // =========================================================================
    
    screenToWorld: function(screenX, screenY) {
        var cx = this._width / 2;
        var cy = this._height / 2;
        
        // Remove pan and zoom
        var x = (screenX - cx - this.panX) / this.zoom;
        var y = (screenY - cy - this.panY) / this.zoom;
        
        // Undo rotation
        var rotRad = -this.rotation * Math.PI / 180;
        var cos = Math.cos(rotRad);
        var sin = Math.sin(rotRad);
        var worldX = x * cos - y * sin;
        var worldY = x * sin + y * cos;
        
        return { x: worldX, y: worldY };
    },
    
    /**
     * Create the view transformation matrix (3x3)
     * @returns {Float32Array}
     */
    createViewMatrix: function() {
        var cx = this._width / 2;
        var cy = this._height / 2;
        var rotRad = this.rotation * Math.PI / 180;
        var cos = Math.cos(rotRad);
        var sin = Math.sin(rotRad);
        var z = this.zoom;
        
        // Combined matrix: translate to center, apply pan, rotate, scale
        // Matrix is column-major for WebGL
        return new Float32Array([
            z * cos,  z * sin, 0,
            -z * sin, z * cos, 0,
            cx + this.panX, cy + this.panY, 1
        ]);
    },
    
    // =========================================================================
    // DATA MANAGEMENT
    // =========================================================================
    
    setData: function(nodes, edges, schools) {
        this.selectedNode = null;
        this.hoveredNode = null;
        this.rotation = 0;
        
        this.nodes = nodes || [];
        this.edges = edges || [];
        this.schools = schools || {};
        
        // Build lookup maps
        this._nodeMap = new Map();
        this._nodeByFormId = new Map();
        for (var i = 0; i < this.nodes.length; i++) {
            var node = this.nodes[i];
            this._nodeMap.set(node.id, node);
            if (node.formId) {
                this._nodeByFormId.set(node.formId, node);
                this._nodeMap.set(node.formId, node);
            }
        }
        
        this.buildSpatialIndex();
        this._computeSchoolAngles();
        
        // Update GPU buffers
        this.updateNodeBuffer();
        this.updateEdgeBuffer();
        this.updateDividerBuffer();
        
        this._needsRender = true;
        this._needsLabelRender = true;
        
        console.log('[WebGLRenderer] Data set:', this.nodes.length, 'nodes,', this.edges.length, 'edges');
    },
    
    _computeSchoolAngles: function() {
        var schoolNames = Object.keys(this.schools);
        if (schoolNames.length === 0) return;
        
        var sliceAngle = 360 / schoolNames.length;
        
        for (var i = 0; i < schoolNames.length; i++) {
            var name = schoolNames[i];
            if (!this.schools[name].startAngle) {
                this.schools[name].startAngle = i * sliceAngle - 90;
                this.schools[name].angleSpan = sliceAngle;
            }
        }
    },
    
    buildSpatialIndex: function() {
        this._nodeGrid = {};
        
        for (var i = 0; i < this.nodes.length; i++) {
            var node = this.nodes[i];
            var cellX = Math.floor(node.x / this._gridCellSize);
            var cellY = Math.floor(node.y / this._gridCellSize);
            var key = cellX + ',' + cellY;
            
            if (!this._nodeGrid[key]) {
                this._nodeGrid[key] = [];
            }
            this._nodeGrid[key].push(node);
        }
    },
    
    findNodeAt: function(worldX, worldY) {
        var cellX = Math.floor(worldX / this._gridCellSize);
        var cellY = Math.floor(worldY / this._gridCellSize);
        
        for (var dx = -1; dx <= 1; dx++) {
            for (var dy = -1; dy <= 1; dy++) {
                var key = (cellX + dx) + ',' + (cellY + dy);
                var cell = this._nodeGrid[key];
                if (!cell) continue;
                
                for (var i = 0; i < cell.length; i++) {
                    var node = cell[i];
                    var dist = Math.sqrt(Math.pow(node.x - worldX, 2) + Math.pow(node.y - worldY, 2));
                    var hitRadius = node.state === 'unlocked' ? 14 : 10;
                    
                    if (dist <= hitRadius) {
                        return node;
                    }
                }
            }
        }
        
        return null;
    },
    
    // =========================================================================
    // GPU BUFFER UPDATES
    // =========================================================================
    
    /**
     * Update node instance buffer with current node data
     */
    updateNodeBuffer: function() {
        var gl = this.gl;
        var self = this;
        
        // Build visibility set for discovery mode
        // In discovery mode: show unlocked, available, and locked nodes that are ONE STEP from available/unlocked
        var discoveryVisibleIds = null;
        if (settings.discoveryMode && !settings.cheatMode) {
            discoveryVisibleIds = this._buildDiscoveryVisibleSet();
        }
        
        // Count visible nodes
        var visibleNodes = [];
        for (var i = 0; i < this.nodes.length; i++) {
            var node = this.nodes[i];
            
            // Skip hidden schools
            if (settings.schoolVisibility && settings.schoolVisibility[node.school] === false) {
                continue;
            }
            
            // Discovery mode visibility check
            if (discoveryVisibleIds && !discoveryVisibleIds.has(node.id) && !discoveryVisibleIds.has(node.formId)) {
                continue;  // Not visible in discovery mode
            }
            
            visibleNodes.push(node);
        }
        
        this._visibleNodeCount = visibleNodes.length;
        this._visibleNodes = visibleNodes;  // Store for edge filtering
        this._discoveryVisibleIds = discoveryVisibleIds;  // Store for edge filtering
        
        // Create instance data array
        // Format: [x, y, size, r, g, b, a, state] per node
        var instanceData = new Float32Array(visibleNodes.length * 8);
        
        for (var i = 0; i < visibleNodes.length; i++) {
            var node = visibleNodes[i];
            var offset = i * 8;
            
            // Position
            instanceData[offset + 0] = node.x;
            instanceData[offset + 1] = node.y;
            
            // Size based on state
            var size;
            if (node.state === 'unlocked') {
                size = 12;
            } else if (node.state === 'available') {
                size = 9;
            } else {
                size = 7;
            }
            
            // Increase size for selected/hovered
            if (this.selectedNode && this.selectedNode.id === node.id) {
                size += 4;
            } else if (this.hoveredNode && this.hoveredNode.id === node.id) {
                size += 3;
            }
            
            instanceData[offset + 2] = size;
            
            // Color
            var color = this.getNodeColor(node);
            instanceData[offset + 3] = color.r;
            instanceData[offset + 4] = color.g;
            instanceData[offset + 5] = color.b;
            instanceData[offset + 6] = color.a;
            
            // State (for shader effects)
            var stateVal = 0;
            if (node.state === 'unlocked') stateVal = 2;
            else if (node.state === 'available') stateVal = 1;
            if (this.selectedNode && this.selectedNode.id === node.id) stateVal = 3;
            
            // Mystery nodes in discovery mode (locked nodes that are visible)
            if (settings.discoveryMode && !settings.cheatMode && node.state === 'locked') {
                stateVal = 4;  // Mystery
            }
            
            instanceData[offset + 7] = stateVal;
            
            // Store shape index on node for rendering
            node._shapeIndex = WebGLShapes.getShapeIndex(node.school);
        }
        
        this._nodeInstanceData = instanceData;
        
        // Upload to GPU
        gl.bindBuffer(gl.ARRAY_BUFFER, this._nodeInstanceBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, instanceData, gl.DYNAMIC_DRAW);
    },
    
    /**
     * Build set of node IDs visible in discovery mode
     * Unlocked/available nodes + locked nodes ONE STEP away from available/unlocked
     */
    _buildDiscoveryVisibleSet: function() {
        var visible = new Set();
        var availableOrUnlockedIds = new Set();
        
        // First pass: collect all unlocked and available nodes
        for (var i = 0; i < this.nodes.length; i++) {
            var node = this.nodes[i];
            if (node.state === 'unlocked' || node.state === 'available') {
                visible.add(node.id);
                if (node.formId) visible.add(node.formId);
                availableOrUnlockedIds.add(node.id);
                if (node.formId) availableOrUnlockedIds.add(node.formId);
            }
        }
        
        // Second pass: find locked nodes that are connected to available/unlocked
        // These are "one step away" and should be shown as mystery nodes
        for (var i = 0; i < this.edges.length; i++) {
            var edge = this.edges[i];
            var fromVisible = availableOrUnlockedIds.has(edge.from);
            var toVisible = availableOrUnlockedIds.has(edge.to);
            
            // If one end is visible (available/unlocked), show the other end as mystery
            if (fromVisible && !toVisible) {
                visible.add(edge.to);
            }
            if (toVisible && !fromVisible) {
                visible.add(edge.from);
            }
        }
        
        return visible;
    },
    
    /**
     * Get color for a node
     * @param {Object} node
     * @returns {Object} {r, g, b, a} normalized 0-1
     */
    getNodeColor: function(node) {
        var schoolColor = TREE_CONFIG.getSchoolColor(node.school);
        var rgb = this.parseColor(schoolColor);
        
        if (!rgb) {
            return { r: 0.5, g: 0.5, b: 0.5, a: 1.0 };
        }
        
        var r = rgb.r / 255;
        var g = rgb.g / 255;
        var b = rgb.b / 255;
        var a = 1.0;
        
        if (node.state === 'unlocked') {
            // Full color
            a = 1.0;
        } else if (node.state === 'available') {
            // Slightly dimmed
            a = 0.8;
        } else {
            // Locked - dimmed
            r *= 0.5;
            g *= 0.5;
            b *= 0.5;
            a = 0.5;
        }
        
        // Discovery mode mystery
        if (settings.discoveryMode && !settings.cheatMode && node.state === 'locked') {
            r *= 0.4;
            g *= 0.4;
            b *= 0.4;
            a = 0.6;
        }
        
        return { r: r, g: g, b: b, a: a };
    },
    
    parseColor: function(color) {
        if (!color) return null;
        if (color.startsWith('#')) {
            return {
                r: parseInt(color.slice(1, 3), 16),
                g: parseInt(color.slice(3, 5), 16),
                b: parseInt(color.slice(5, 7), 16)
            };
        }
        var match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
            return {
                r: parseInt(match[1]),
                g: parseInt(match[2]),
                b: parseInt(match[3])
            };
        }
        return null;
    },
    
    /**
     * Update edge buffer with current edge data
     */
    updateEdgeBuffer: function() {
        var gl = this.gl;
        
        // Build edge vertices (2 vertices per edge)
        var vertices = [];
        var colors = [];
        
        for (var i = 0; i < this.edges.length; i++) {
            var edge = this.edges[i];
            var fromNode = this._nodeMap.get(edge.from);
            var toNode = this._nodeMap.get(edge.to);
            
            if (!fromNode || !toNode) continue;
            
            // Skip if either school is hidden
            if (settings.schoolVisibility) {
                if (settings.schoolVisibility[fromNode.school] === false) continue;
                if (settings.schoolVisibility[toNode.school] === false) continue;
            }
            
            // Discovery mode: only show edges where BOTH nodes are visible
            if (this._discoveryVisibleIds) {
                var fromVisible = this._discoveryVisibleIds.has(edge.from) || this._discoveryVisibleIds.has(fromNode.id);
                var toVisible = this._discoveryVisibleIds.has(edge.to) || this._discoveryVisibleIds.has(toNode.id);
                if (!fromVisible || !toVisible) continue;
            }
            
            // Add vertices
            vertices.push(fromNode.x, fromNode.y);
            vertices.push(toNode.x, toNode.y);
            
            // Color based on state
            var bothUnlocked = fromNode.state === 'unlocked' && toNode.state === 'unlocked';
            var color;
            var alpha;
            
            if (bothUnlocked) {
                color = this.parseColor(TREE_CONFIG.getSchoolColor(fromNode.school));
                alpha = 1.0;
            } else {
                color = { r: 51, g: 51, b: 51 };  // #333
                alpha = 0.3;
            }
            
            if (!color) color = { r: 51, g: 51, b: 51 };
            
            // Both vertices same color
            colors.push(color.r / 255, color.g / 255, color.b / 255, alpha);
            colors.push(color.r / 255, color.g / 255, color.b / 255, alpha);
        }
        
        this._edgeVertexCount = vertices.length / 2;
        
        // Upload to GPU
        gl.bindBuffer(gl.ARRAY_BUFFER, this._edgeBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this._edgeColorBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.DYNAMIC_DRAW);
    },
    
    /**
     * Update school divider lines buffer
     */
    updateDividerBuffer: function() {
        var gl = this.gl;
        var schoolNames = Object.keys(this.schools);
        
        if (schoolNames.length < 2) {
            this._dividerVertexCount = 0;
            return;
        }
        
        var sliceAngle = 360 / schoolNames.length;
        var radius = 800;
        var vertices = [];
        
        for (var i = 0; i < schoolNames.length; i++) {
            var angle = (i * sliceAngle - 90) * Math.PI / 180;
            vertices.push(0, 0);
            vertices.push(Math.cos(angle) * radius, Math.sin(angle) * radius);
        }
        
        this._dividerVertexCount = vertices.length / 2;
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this._dividerBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    },
    
    // =========================================================================
    // RENDERING
    // =========================================================================
    
    updateCanvasSize: function() {
        if (!this.container || !this.canvas) return;
        
        var rect = this.container.getBoundingClientRect();
        var width = rect.width || 800;
        var height = rect.height || 600;
        var dpr = window.devicePixelRatio || 1;
        
        this.canvas.width = width * dpr;
        this.canvas.height = height * dpr;
        this.canvas.style.width = width + 'px';
        this.canvas.style.height = height + 'px';
        
        this.labelCanvas.width = width * dpr;
        this.labelCanvas.height = height * dpr;
        this.labelCanvas.style.width = width + 'px';
        this.labelCanvas.style.height = height + 'px';
        
        this._width = width;
        this._height = height;
        
        // Update WebGL viewport
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        
        this._needsRender = true;
        this._needsLabelRender = true;
    },
    
    startRenderLoop: function() {
        if (this._rafId) return;
        
        var self = this;
        console.log('[WebGLRenderer] Starting render loop');
        
        function loop() {
            if (self._needsRender) {
                self.render();
                self._needsRender = false;
            }
            if (self._needsLabelRender) {
                self.renderLabels();
                self._needsLabelRender = false;
            }
            self._rafId = requestAnimationFrame(loop);
        }
        
        loop();
    },
    
    stopRenderLoop: function() {
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
    },
    
    forceRender: function() {
        this._needsRender = true;
        this._needsLabelRender = true;
        this.render();
        this.renderLabels();
    },
    
    render: function() {
        var gl = this.gl;
        if (!gl) return;
        
        var startTime = performance.now();
        
        // Clear
        gl.clearColor(0, 0, 0, 0);  // Transparent background
        gl.clear(gl.COLOR_BUFFER_BIT);
        
        // Enable blending for transparency
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        
        // Get view matrices - one with rotation (for tree), one without (for hub)
        var viewMatrix = this.createViewMatrix();
        var hubMatrix = this.createViewMatrixNoRotation();  // Hub doesn't rotate
        var resolution = new Float32Array([this._width, this._height]);
        
        // Render center hub FIRST (doesn't rotate with wheel)
        this.renderHub(hubMatrix, resolution);
        
        // Render school dividers (rotate with wheel)
        this.renderDividers(viewMatrix, resolution);
        
        // Render edges
        this.renderEdges(viewMatrix, resolution);
        
        // Render nodes (instanced by shape)
        this.renderNodes(viewMatrix, resolution);
        
        var elapsed = performance.now() - startTime;
        if (elapsed > 8) {
            console.log('[WebGLRenderer] Render:', Math.round(elapsed) + 'ms,', 
                        this._visibleNodeCount, 'nodes,', this._edgeVertexCount / 2, 'edges');
        }
    },
    
    /**
     * Create view matrix WITHOUT rotation (for static elements like hub)
     */
    createViewMatrixNoRotation: function() {
        var cx = this._width / 2;
        var cy = this._height / 2;
        var z = this.zoom;
        
        // Matrix without rotation - just pan and zoom
        return new Float32Array([
            z, 0, 0,
            0, z, 0,
            cx + this.panX, cy + this.panY, 1
        ]);
    },
    
    renderHub: function(viewMatrix, resolution) {
        var gl = this.gl;
        var program = this._programs.hub;
        
        gl.useProgram(program);
        
        // Set uniforms - use non-rotating matrix so hub stays fixed
        gl.uniformMatrix3fv(this._programs.hubUniforms.u_viewMatrix, false, viewMatrix);
        gl.uniform2fv(this._programs.hubUniforms.u_resolution, resolution);
        
        // Draw filled hub
        gl.uniform4f(this._programs.hubUniforms.u_color, 0.72, 0.66, 0.47, 0.1);  // rgba(184, 168, 120, 0.1)
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this._hubBuffer);
        gl.enableVertexAttribArray(this._programs.hubAttribs.a_position);
        gl.vertexAttribPointer(this._programs.hubAttribs.a_position, 2, gl.FLOAT, false, 0, 0);
        
        gl.drawArrays(gl.TRIANGLE_FAN, 0, this._hubVertexCount);
    },
    
    renderDividers: function(viewMatrix, resolution) {
        if (this._dividerVertexCount === 0) return;
        
        var gl = this.gl;
        var program = this._programs.hub;  // Reuse simple shader
        
        gl.useProgram(program);
        gl.uniformMatrix3fv(this._programs.hubUniforms.u_viewMatrix, false, viewMatrix);
        gl.uniform2fv(this._programs.hubUniforms.u_resolution, resolution);
        gl.uniform4f(this._programs.hubUniforms.u_color, 1, 1, 1, 0.1);  // rgba(255, 255, 255, 0.1)
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this._dividerBuffer);
        gl.enableVertexAttribArray(this._programs.hubAttribs.a_position);
        gl.vertexAttribPointer(this._programs.hubAttribs.a_position, 2, gl.FLOAT, false, 0, 0);
        
        gl.drawArrays(gl.LINES, 0, this._dividerVertexCount);
    },
    
    renderEdges: function(viewMatrix, resolution) {
        if (this._edgeVertexCount === 0) return;
        
        var gl = this.gl;
        var program = this._programs.edge;
        
        gl.useProgram(program);
        gl.uniformMatrix3fv(this._programs.edgeUniforms.u_viewMatrix, false, viewMatrix);
        gl.uniform2fv(this._programs.edgeUniforms.u_resolution, resolution);
        
        // Position attribute
        gl.bindBuffer(gl.ARRAY_BUFFER, this._edgeBuffer);
        gl.enableVertexAttribArray(this._programs.edgeAttribs.a_position);
        gl.vertexAttribPointer(this._programs.edgeAttribs.a_position, 2, gl.FLOAT, false, 0, 0);
        
        // Color attribute
        gl.bindBuffer(gl.ARRAY_BUFFER, this._edgeColorBuffer);
        gl.enableVertexAttribArray(this._programs.edgeAttribs.a_color);
        gl.vertexAttribPointer(this._programs.edgeAttribs.a_color, 4, gl.FLOAT, false, 0, 0);
        
        gl.drawArrays(gl.LINES, 0, this._edgeVertexCount);
    },
    
    renderNodes: function(viewMatrix, resolution) {
        if (this._visibleNodeCount === 0) return;
        
        var gl = this.gl;
        var program = this._programs.node;
        
        gl.useProgram(program);
        gl.uniformMatrix3fv(this._programs.nodeUniforms.u_viewMatrix, false, viewMatrix);
        gl.uniform2fv(this._programs.nodeUniforms.u_resolution, resolution);
        
        // Group nodes by shape for instanced rendering
        var nodesByShape = {};
        for (var i = 0; i < this.nodes.length; i++) {
            var node = this.nodes[i];
            if (settings.schoolVisibility && settings.schoolVisibility[node.school] === false) continue;
            
            var shapeIndex = WebGLShapes.getShapeIndex(node.school);
            if (!nodesByShape[shapeIndex]) {
                nodesByShape[shapeIndex] = [];
            }
            nodesByShape[shapeIndex].push(i);
        }
        
        // Render each shape type with instancing
        for (var shapeIndex in nodesByShape) {
            var nodeIndices = nodesByShape[shapeIndex];
            var shapeInfo = this._shapeBuffers.byIndex[shapeIndex];
            
            if (!shapeInfo) continue;
            
            // Bind shape template
            gl.bindBuffer(gl.ARRAY_BUFFER, shapeInfo.buffer);
            gl.enableVertexAttribArray(this._programs.nodeAttribs.a_shapeVertex);
            gl.vertexAttribPointer(this._programs.nodeAttribs.a_shapeVertex, 2, gl.FLOAT, false, 0, 0);
            
            // Create per-shape instance data
            var instanceData = new Float32Array(nodeIndices.length * 8);
            for (var j = 0; j < nodeIndices.length; j++) {
                var srcOffset = nodeIndices[j] * 8;
                var dstOffset = j * 8;
                // Copy from main instance data (but we need to recalculate for visible nodes)
                var node = this.nodes[nodeIndices[j]];
                
                instanceData[dstOffset + 0] = node.x;
                instanceData[dstOffset + 1] = node.y;
                
                var size = node.state === 'unlocked' ? 12 : (node.state === 'available' ? 9 : 7);
                if (this.selectedNode && this.selectedNode.id === node.id) size += 4;
                else if (this.hoveredNode && this.hoveredNode.id === node.id) size += 3;
                instanceData[dstOffset + 2] = size;
                
                var color = this.getNodeColor(node);
                instanceData[dstOffset + 3] = color.r;
                instanceData[dstOffset + 4] = color.g;
                instanceData[dstOffset + 5] = color.b;
                instanceData[dstOffset + 6] = color.a;
                
                var stateVal = node.state === 'unlocked' ? 2 : (node.state === 'available' ? 1 : 0);
                if (this.selectedNode && this.selectedNode.id === node.id) stateVal = 3;
                if (settings.discoveryMode && !settings.cheatMode && node.state === 'locked') stateVal = 4;
                instanceData[dstOffset + 7] = stateVal;
            }
            
            // Upload instance data
            var instanceBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, instanceData, gl.DYNAMIC_DRAW);
            
            // Set up instanced attributes
            var stride = 8 * 4;  // 8 floats * 4 bytes
            
            gl.enableVertexAttribArray(this._programs.nodeAttribs.a_position);
            gl.vertexAttribPointer(this._programs.nodeAttribs.a_position, 2, gl.FLOAT, false, stride, 0);
            gl.vertexAttribDivisor(this._programs.nodeAttribs.a_position, 1);
            
            gl.enableVertexAttribArray(this._programs.nodeAttribs.a_size);
            gl.vertexAttribPointer(this._programs.nodeAttribs.a_size, 1, gl.FLOAT, false, stride, 8);
            gl.vertexAttribDivisor(this._programs.nodeAttribs.a_size, 1);
            
            gl.enableVertexAttribArray(this._programs.nodeAttribs.a_color);
            gl.vertexAttribPointer(this._programs.nodeAttribs.a_color, 4, gl.FLOAT, false, stride, 12);
            gl.vertexAttribDivisor(this._programs.nodeAttribs.a_color, 1);
            
            gl.enableVertexAttribArray(this._programs.nodeAttribs.a_state);
            gl.vertexAttribPointer(this._programs.nodeAttribs.a_state, 1, gl.FLOAT, false, stride, 28);
            gl.vertexAttribDivisor(this._programs.nodeAttribs.a_state, 1);
            
            // Draw instanced
            gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, shapeInfo.vertexCount, nodeIndices.length);
            
            // Reset divisors
            gl.vertexAttribDivisor(this._programs.nodeAttribs.a_position, 0);
            gl.vertexAttribDivisor(this._programs.nodeAttribs.a_size, 0);
            gl.vertexAttribDivisor(this._programs.nodeAttribs.a_color, 0);
            gl.vertexAttribDivisor(this._programs.nodeAttribs.a_state, 0);
            
            // Clean up temp buffer
            gl.deleteBuffer(instanceBuffer);
        }
    },
    
    renderLabels: function() {
        var ctx = this.labelCtx;
        if (!ctx) return;
        
        var dpr = window.devicePixelRatio || 1;
        
        // Clear
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.labelCanvas.width, this.labelCanvas.height);
        ctx.scale(dpr, dpr);
        
        var cx = this._width / 2;
        var cy = this._height / 2;
        var rotRad = this.rotation * Math.PI / 180;
        var cos = Math.cos(rotRad);
        var sin = Math.sin(rotRad);
        
        // Draw center hub text FIRST (doesn't rotate, stays at center)
        ctx.fillStyle = '#b8a878';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('MAGIC', cx + this.panX, cy + this.panY);
        
        // Only show node labels when zoomed in
        if (this.zoom < 0.8) return;
        
        // Draw labels for unlocked nodes
        // Text stays SCREEN-ALIGNED (doesn't rotate with wheel)
        // But positions DO rotate with the wheel
        ctx.fillStyle = '#fff';
        ctx.font = '10px sans-serif';
        ctx.textBaseline = 'top';
        
        var labelsDrawn = 0;
        var maxLabels = 100;
        
        for (var i = 0; i < this.nodes.length && labelsDrawn < maxLabels; i++) {
            var node = this.nodes[i];
            
            if (node.state !== 'unlocked') continue;
            if (!node.name) continue;
            if (settings.schoolVisibility && settings.schoolVisibility[node.school] === false) continue;
            
            // Transform node position WITH rotation, but text stays screen-aligned
            var rotatedX = node.x * cos - node.y * sin;
            var rotatedY = node.x * sin + node.y * cos;
            
            var screenX = rotatedX * this.zoom + this.panX + cx;
            var screenY = rotatedY * this.zoom + this.panY + cy;
            
            // Viewport check
            if (screenX < -50 || screenX > this._width + 50 || screenY < -50 || screenY > this._height + 50) {
                continue;
            }
            
            // Draw text at screen position (no rotation applied to text itself)
            ctx.fillText(node.name.substring(0, 12), screenX, screenY + 14 * this.zoom);
            labelsDrawn++;
        }
    },
    
    // =========================================================================
    // ROTATION
    // =========================================================================
    
    rotateToNode: function(node) {
        if (!node || typeof node.angle === 'undefined') return;
        var targetRotation = -node.angle;
        var delta = targetRotation - this.rotation;
        while (delta > 180) delta -= 360;
        while (delta < -180) delta += 360;
        this.animateRotation(this.rotation + delta);
    },
    
    rotateSchoolToTop: function(schoolName) {
        var schoolConfig = this.schools[schoolName];
        if (!schoolConfig) return;
        var targetRotation = -(schoolConfig.startAngle + schoolConfig.angleSpan / 2);
        var delta = targetRotation - this.rotation;
        while (delta > 180) delta -= 360;
        while (delta < -180) delta += 360;
        this.animateRotation(this.rotation + delta);
    },
    
    animateRotation: function(target) {
        var self = this;
        var start = this.rotation;
        var duration = 300;
        var startTime = performance.now();
        
        if (this.isAnimating) return;
        this.isAnimating = true;
        
        function animate() {
            var elapsed = performance.now() - startTime;
            var progress = Math.min(elapsed / duration, 1);
            var eased = 1 - Math.pow(1 - progress, 3);
            
            self.rotation = start + (target - start) * eased;
            self._needsRender = true;
            self._needsLabelRender = true;
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                self.rotation = target;
                self.isAnimating = false;
            }
        }
        
        animate();
    },
    
    handleNodeClickRotation: function(node) {
        if (!node) return;
        
        // ALWAYS rotate the clicked node's school to top
        this.rotateSchoolToTop(node.school);
    },
    
    // =========================================================================
    // PUBLIC API
    // =========================================================================
    
    show: function() {
        if (!this.canvas || !this.container) {
            console.error('[WebGLRenderer] Cannot show - not initialized');
            return;
        }
        
        // Hide SVG and Canvas
        var svg = document.getElementById('tree-svg');
        if (svg) svg.style.display = 'none';
        
        var canvas2d = document.getElementById('tree-canvas');
        if (canvas2d) canvas2d.style.display = 'none';
        
        // Append WebGL canvas
        if (!this.canvas.parentNode) {
            this.container.appendChild(this.canvas);
            this.container.appendChild(this.labelCanvas);
        }
        
        this.updateCanvasSize();
        this.startRenderLoop();
        this.forceRender();
        
        console.log('[WebGLRenderer] Shown with', this.nodes.length, 'nodes');
    },
    
    hide: function() {
        this.stopRenderLoop();
        
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
        if (this.labelCanvas && this.labelCanvas.parentNode) {
            this.labelCanvas.parentNode.removeChild(this.labelCanvas);
        }
        
        var svg = document.getElementById('tree-svg');
        if (svg) svg.style.display = 'block';
    },
    
    centerView: function() {
        this.panX = 0;
        this.panY = 0;
        this.zoom = 0.75;
        this.rotation = 0;
        this._needsRender = true;
        this._needsLabelRender = true;
        
        var zoomEl = document.getElementById('zoom-level');
        if (zoomEl) zoomEl.textContent = Math.round(this.zoom * 100) + '%';
    },
    
    setZoom: function(z) {
        this.zoom = Math.max(0.1, Math.min(5, z));
        this._needsRender = true;
        this._needsLabelRender = true;
        
        var zoomEl = document.getElementById('zoom-level');
        if (zoomEl) zoomEl.textContent = Math.round(this.zoom * 100) + '%';
    },
    
    clear: function() {
        this.nodes = [];
        this.edges = [];
        this.schools = {};
        this._nodeMap = new Map();
        this._nodeByFormId = new Map();
        this._nodeGrid = {};
        this.selectedNode = null;
        this.hoveredNode = null;
        this._visibleNodeCount = 0;
        this._edgeVertexCount = 0;
        
        this._needsRender = true;
        this._needsLabelRender = true;
    },
    
    /**
     * Check if WebGL mode should be used
     * @param {number} nodeCount
     * @returns {boolean}
     */
    shouldUseWebGL: function(nodeCount) {
        return this.checkWebGLSupport() && nodeCount > 800;
    },
    
    /**
     * Refresh the renderer when node states change (e.g., spell unlocked)
     * Call this after spell unlock/progression changes
     */
    refresh: function() {
        if (!this.gl) return;
        
        console.log('[WebGLRenderer] Refreshing node/edge states');
        
        // Rebuild buffers with current node states
        this.updateNodeBuffer();
        this.updateEdgeBuffer();
        
        // Trigger re-render
        this._needsRender = true;
        this._needsLabelRender = true;
    },
    
    /**
     * Update a specific node's state and refresh
     * @param {string|number} nodeId - Node ID or formId
     * @param {string} newState - 'locked', 'available', 'unlocked'
     */
    updateNodeState: function(nodeId, newState) {
        var node = this._nodeMap.get(nodeId);
        if (node) {
            node.state = newState;
            this.refresh();
        }
    }
};

// Export
window.WebGLRenderer = WebGLRenderer;
