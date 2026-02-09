/**
 * CanvasRenderer V2 - Adapted for universal coordinate data from the new scan system
 *
 * Changes from V1:
 * - Self-contained school color lookup (no TREE_CONFIG dependency)
 * - Self-contained tooltip (no WheelRenderer dependency)
 * - Direct event dispatch for node clicks (no WheelRenderer.onNodeClick)
 * - Simple spiral fallback layout (no WheelRenderer.layoutRadial)
 * - Debug grid works without GRID_CONFIG
 * - Reads pre-baked x,y positions from scan system data
 *
 * Depends on: settings, state (no TREE_CONFIG, no WheelRenderer, no GRID_CONFIG)
 */

var CanvasRenderer = {
    canvas: null,
    ctx: null,
    container: null,
    
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
    noRotate: false,
    
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
    _animationOnlyRender: false,  // True when only animations need update (can be throttled)
    _lastRenderTime: 0,
    _logNextRender: false,
    _pendingPanX: 0,
    _pendingPanY: 0,
    _panRafPending: false,
    
    // Node lookup
    _nodeMap: null,
    _nodeByFormId: null,
    
    // Discovery mode visibility
    _discoveryVisibleIds: null,
    
    // Dimensions
    _width: 0,
    _height: 0,
    
    // Debug grid
    showDebugGrid: false,
    
    // Heartbeat animation for central hub (configurable via settings)
    _heartbeatPhase: 0,
    _heartbeatSpeed: 0.2,   // Radians per frame (default 0.2)
    _heartPulseDelay: 5.0,  // Time (in seconds) between pulse groups (default 5s)
    _heartAnimationEnabled: true,
    _heartBgOpacity: 1.0,
    _heartBgColor: '#000000',
    _bgColor: '#000000',
    _heartRingColor: '#b8a878',
    _learningPathColor: '#00ffff',
    _globeBgFill: true,
    
    // Learning path animation (glowing line from center to newly learned spell)
    _learningPath: null,       // { nodeId, path: [{x,y}...], progress: 0-1, startTime, color }
    _learningPathDuration: 1200,  // ms for the path to animate
    _learningPathAnimationComplete: true,  // Static path only shows after animation
    _animatingPathNodes: null,    // Set of node IDs in the CURRENTLY ANIMATING path only

    // Persistent learning state - tracks which nodes are being learned
    _learningNodeIds: null,       // Set of node IDs currently in learning state
    _learningPathNodes: null,     // Set of all node IDs along paths to learning nodes
    
    // Traveling pulse particles along learning paths
    _learningPulses: [],          // Array of {x, y, progress, pathIndex, speed}
    _lastHeartbeatPulse: false,   // Track heartbeat state for pulse spawning
    _learningPathSegments: [],    // Cached path segments [{from:{x,y}, to:{x,y}, nodeId}...]
    _learningPulseSpeed: 0.015,   // Default pulse travel speed (configurable)
    _learningPulseSize: 4,        // Default pulse size (configurable)
    
    // 3D Globe (uses Globe3D module)
    _globeEnabled: true,
    
    // Starfield background (uses Starfield module)
    _starfieldEnabled: true,
    _starfieldFixed: false,  // true = fixed to screen, false = moves with world
    _starfieldColor: '#ffffff',
    _starfieldDensity: 200,
    _starfieldMaxSize: 2.5,
    _starfieldSeed: 42,

    // =========================================================================
    // SELF-CONTAINED SCHOOL COLORS (no TREE_CONFIG dependency)
    // =========================================================================

    _defaultSchoolColors: {
        'Destruction': '#ef4444',
        'Restoration': '#facc15',
        'Alteration': '#22c55e',
        'Conjuration': '#a855f7',
        'Illusion': '#38bdf8'
    },

    /**
     * Get school color - checks settings first, then defaults
     * Replaces TREE_CONFIG.getSchoolColor()
     */
    _getSchoolColor: function(school) {
        if (typeof settings !== 'undefined' && settings.schoolColors && settings.schoolColors[school]) {
            return settings.schoolColors[school];
        }
        if (typeof getOrAssignSchoolColor === 'function') {
            return getOrAssignSchoolColor(school);
        }
        return this._defaultSchoolColors[school] || '#888888';
    },

    // =========================================================================
    // SELF-CONTAINED TOOLTIP (no WheelRenderer dependency)
    // =========================================================================

    _showTooltip: function(node, event) {
        var tooltip = document.getElementById('tooltip');
        if (!tooltip) return;

        // Progressive reveal logic (same as WheelRenderer/details panel)
        var _tCanonId = (typeof getCanonicalFormId === 'function') ? getCanonicalFormId(node) : node.formId;
        var progress = (typeof state !== 'undefined' && state.spellProgress) ? (state.spellProgress[_tCanonId] || {}) : {};
        var progressPercent = progress.required > 0 ? (progress.xp / progress.required) * 100 : 0;
        var playerHasSpell = progress.unlocked || node.state === 'unlocked';

        var showFullInfo = playerHasSpell || (typeof settings !== 'undefined' && settings.cheatMode);
        var isRootWithReveal = node.isRoot && (typeof settings !== 'undefined' && settings.showRootSpellNames);
        var isLearning = node.state === 'learning';
        var isLocked = node.state === 'locked';
        var revealThreshold = (typeof settings !== 'undefined' && settings.revealName !== undefined) ? settings.revealName : 10;
        var showName = showFullInfo || isLearning || (!isLocked && progressPercent >= revealThreshold) || isRootWithReveal;
        var showDetails = node.state !== 'locked' || (typeof settings !== 'undefined' && settings.cheatMode);

        var nameText = showName ? (node.name || node.formId) : '???';
        var infoText;
        if (node.state === 'locked') {
            infoText = 'Unlock prerequisites first';
        } else if (showDetails) {
            infoText = node.school + ' \u2022 ' + (node.level || '?') + ' \u2022 ' + (node.cost || '?') + ' magicka';
        } else {
            infoText = node.school + ' \u2022 Progress: ' + Math.round(progressPercent) + '%';
        }

        var nameEl = tooltip.querySelector('.tooltip-name');
        var infoEl = tooltip.querySelector('.tooltip-info');
        var stateEl = tooltip.querySelector('.tooltip-state');
        if (nameEl) nameEl.textContent = nameText;
        if (infoEl) infoEl.textContent = infoText;
        if (stateEl) {
            stateEl.textContent = node.state;
            stateEl.className = 'tooltip-state ' + node.state;
        }

        tooltip.classList.remove('hidden');
        tooltip.style.left = (event.clientX + 15) + 'px';
        tooltip.style.top = (event.clientY + 15) + 'px';
    },

    _hideTooltip: function() {
        var tooltip = document.getElementById('tooltip');
        if (tooltip) tooltip.classList.add('hidden');
    },

    // =========================================================================
    // PATH2D CACHE - Pre-computed shapes for performance
    // =========================================================================
    
    _shapePaths: null,
    
    /**
     * Initialize Path2D cache for all school shapes
     * Called once at startup - shapes are reused for all nodes
     */
    _initShapePaths: function() {
        this._shapePaths = {};
        
        // Diamond - Destruction (aggressive, sharp)
        var diamond = new Path2D();
        diamond.moveTo(0, -1);
        diamond.lineTo(1, 0);
        diamond.lineTo(0, 1);
        diamond.lineTo(-1, 0);
        diamond.closePath();
        this._shapePaths['Destruction'] = diamond;
        
        // Circle - Restoration (healing, soft) - NOT oval!
        var circle = new Path2D();
        circle.arc(0, 0, 1, 0, Math.PI * 2);
        this._shapePaths['Restoration'] = circle;
        
        // Hexagon - Alteration (transformation)
        var hexagon = new Path2D();
        var hexW = 0.9;
        var hexH = 0.5;
        hexagon.moveTo(0, -1);
        hexagon.lineTo(hexW, -hexH);
        hexagon.lineTo(hexW, hexH);
        hexagon.lineTo(0, 1);
        hexagon.lineTo(-hexW, hexH);
        hexagon.lineTo(-hexW, -hexH);
        hexagon.closePath();
        this._shapePaths['Alteration'] = hexagon;
        
        // Pentagon - Conjuration (summoning, mystical)
        var pentagon = new Path2D();
        for (var i = 0; i < 5; i++) {
            var angle = (i * 72 - 90) * Math.PI / 180;
            var x = Math.cos(angle);
            var y = Math.sin(angle);
            if (i === 0) {
                pentagon.moveTo(x, y);
            } else {
                pentagon.lineTo(x, y);
            }
        }
        pentagon.closePath();
        this._shapePaths['Conjuration'] = pentagon;
        
        // Triangle - Illusion (tip pointing INWARD toward origin)
        // Since nodes are placed radially, "inward" means toward (0,0)
        // We draw a downward-pointing triangle, but it will be drawn at each node's position
        // pointing toward center due to how canvas coordinates work
        var triangle = new Path2D();
        triangle.moveTo(0, 1);       // Tip pointing down (toward origin when node is above center)
        triangle.lineTo(-0.85, -0.6); // Top-left
        triangle.lineTo(0.85, -0.6);  // Top-right
        triangle.closePath();
        this._shapePaths['Illusion'] = triangle;
        
        // Default circle for unknown schools
        this._shapePaths['default'] = circle;
        
        console.log('[CanvasRenderer] Path2D cache initialized for', Object.keys(this._shapePaths).length, 'shapes');
    },
    
    /**
     * Get cached Path2D for a school
     */
    _getShapePath: function(school) {
        return this._shapePaths[school] || this._shapePaths['default'];
    },
    
    // =========================================================================
    // INITIALIZATION
    // =========================================================================
    
    init: function(container) {
        this.container = container;
        
        // Initialize Path2D cache
        if (!this._shapePaths) {
            this._initShapePaths();
        }
        
        // Create canvas element if not already created
        if (!this.canvas) {
            this.canvas = document.createElement('canvas');
            this.canvas.id = 'tree-canvas';
            this.canvas.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: block; z-index: 1;';
            this.ctx = this.canvas.getContext('2d');
            
            this.setupEvents();
        }
        
        console.log('[CanvasRenderer] Initialized');
        return this;
    },
    
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
        
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.scale(dpr, dpr);
        
        this._width = width;
        this._height = height;
        this._needsRender = true;
    },
    
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
        
        // Window resize handler
        window.addEventListener('resize', function() {
            self.updateCanvasSize();
        });
        
        // ResizeObserver for container size changes (more reliable than window resize)
        // This catches cases where the panel resizes without the window changing
        if (typeof ResizeObserver !== 'undefined' && this.container) {
            this._resizeObserver = new ResizeObserver(function(entries) {
                // Debounce resize updates
                if (self._resizeTimeout) {
                    clearTimeout(self._resizeTimeout);
                }
                self._resizeTimeout = setTimeout(function() {
                    self.updateCanvasSize();
                }, 50);
            });
            this._resizeObserver.observe(this.container);
        }
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

        // Check if nodes need position calculation (all at center = no positions)
        var nodesNeedLayout = false;
        if (this.nodes.length > 0) {
            var nodesWithPositions = this.nodes.filter(function(n) {
                return (n.x !== 0 || n.y !== 0) || n._fromVisualFirst || n._fromLayoutEngine;
            }).length;
            nodesNeedLayout = nodesWithPositions < this.nodes.length * 0.1; // <10% have positions
            console.log('[CanvasRenderer] Position check: ' + nodesWithPositions + '/' + this.nodes.length + ' have positions, needLayout=' + nodesNeedLayout);
        }

        // If nodes don't have positions, use simple spiral layout as fallback
        if (nodesNeedLayout) {
            console.log('[CanvasRenderer] FALLBACK: Applying spiral layout for ' + this.nodes.length + ' nodes');
            this._applySpiralLayout();
        }

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
        this._buildDiscoveryVisibility();
        this._buildLearningPaths();

        this._needsRender = true;
        this._logNextRender = true;

        console.log('[CanvasRenderer] Data set:', this.nodes.length, 'nodes,', this.edges.length, 'edges');
    },
    
    _computeSchoolAngles: function() {
        var schoolNames = Object.keys(this.schools);
        if (schoolNames.length === 0) return;

        var self = this;
        var numSchools = schoolNames.length;
        var sliceAngle = 360 / numSchools;

        // DATA-DRIVEN: Derive sector centers from actual root node positions
        // This ensures dividers always align with nodes regardless of generation formula
        schoolNames.forEach(function(name, i) {
            var school = self.schools[name];

            // Skip if already set from external data
            if (school.spokeAngle !== undefined && school.startAngle !== undefined) {
                return;
            }

            // Find root node(s) for this school
            var rootNodes = self.nodes.filter(function(n) {
                return n.school === name && n.isRoot;
            });

            // Fallback: find node closest to center
            if (rootNodes.length === 0) {
                var schoolNodes = self.nodes.filter(function(n) { return n.school === name; });
                if (schoolNodes.length > 0) {
                    var closest = schoolNodes.reduce(function(best, n) {
                        var dist = Math.sqrt(n.x * n.x + n.y * n.y);
                        var bestDist = Math.sqrt(best.x * best.x + best.y * best.y);
                        return dist < bestDist ? n : best;
                    });
                    rootNodes = [closest];
                }
            }

            if (rootNodes.length > 0) {
                // Average angle of all root nodes = sector center
                var sumSin = 0, sumCos = 0;
                rootNodes.forEach(function(rn) {
                    var a = Math.atan2(rn.y, rn.x);
                    sumSin += Math.sin(a);
                    sumCos += Math.cos(a);
                });
                var avgAngle = Math.atan2(sumSin, sumCos) * 180 / Math.PI;

                school.spokeAngle = avgAngle;
                school.startAngle = avgAngle - sliceAngle / 2;
                school.endAngle = avgAngle + sliceAngle / 2;
                school.angleSpan = sliceAngle;
            } else {
                // No nodes at all — fallback to even distribution
                var startAngle = i * sliceAngle - 90;
                school.startAngle = startAngle;
                school.endAngle = startAngle + sliceAngle;
                school.angleSpan = sliceAngle;
                school.spokeAngle = startAngle + sliceAngle / 2;
            }
        });
    },
    
    /**
     * Simple spiral fallback layout for nodes without pre-baked positions.
     * Groups nodes by school, places roots around the center, spirals children outward.
     */
    _applySpiralLayout: function() {
        var schoolNames = Object.keys(this.schools);
        if (schoolNames.length === 0) {
            // No schools: simple spiral for all nodes
            var spacing = 55;
            for (var i = 0; i < this.nodes.length; i++) {
                var angle = i * 2.4;  // golden angle approximation
                var radius = 100 + i * spacing * 0.15;
                this.nodes[i].x = Math.cos(angle) * radius;
                this.nodes[i].y = Math.sin(angle) * radius;
            }
            return;
        }

        var numSchools = schoolNames.length;
        var sliceAngle = (2 * Math.PI) / numSchools;
        var self = this;

        // Build parent lookup from edges
        var childrenOf = {};
        for (var e = 0; e < this.edges.length; e++) {
            var edge = this.edges[e];
            if (!childrenOf[edge.from]) childrenOf[edge.from] = [];
            childrenOf[edge.from].push(edge.to);
        }

        schoolNames.forEach(function(name, schoolIdx) {
            var school = self.schools[name];
            var schoolNodes = self.nodes.filter(function(n) { return n.school === name; });
            if (schoolNodes.length === 0) return;

            var baseAngle = schoolIdx * sliceAngle - Math.PI / 2;
            var baseRadius = 100;
            var tierSpacing = 55;
            var arcSpread = sliceAngle * 0.7;

            // BFS from root(s)
            var rootId = school.root;
            var rootNode = rootId ? schoolNodes.find(function(n) { return n.id === rootId || n.formId === rootId; }) : null;
            if (!rootNode) rootNode = schoolNodes[0];

            // Place root
            rootNode.x = Math.cos(baseAngle) * baseRadius;
            rootNode.y = Math.sin(baseAngle) * baseRadius;

            var placed = new Set([rootNode.id]);
            var queue = [{ node: rootNode, depth: 0 }];
            var depthCounters = {};

            while (queue.length > 0) {
                var item = queue.shift();
                var parentNode = item.node;
                var depth = item.depth + 1;
                var radius = baseRadius + depth * tierSpacing;

                var kids = childrenOf[parentNode.id] || [];
                if (kids.length === 0 && parentNode.formId) {
                    kids = childrenOf[parentNode.formId] || [];
                }

                if (!depthCounters[depth]) depthCounters[depth] = 0;

                for (var k = 0; k < kids.length; k++) {
                    var childId = kids[k];
                    if (placed.has(childId)) continue;

                    var childNode = schoolNodes.find(function(n) { return n.id === childId || n.formId === childId; });
                    if (!childNode) continue;

                    var idx = depthCounters[depth]++;
                    var totalAtDepth = Math.max(kids.length, 3);
                    var angleOffset = (idx - (totalAtDepth - 1) / 2) * (arcSpread / Math.max(totalAtDepth - 1, 1));
                    childNode.x = Math.cos(baseAngle + angleOffset) * radius;
                    childNode.y = Math.sin(baseAngle + angleOffset) * radius;

                    placed.add(childNode.id);
                    queue.push({ node: childNode, depth: depth });
                }
            }

            // Place any unplaced nodes (orphans) in a spiral within the school sector
            var orphanIdx = 0;
            schoolNodes.forEach(function(n) {
                if (!placed.has(n.id)) {
                    var oAngle = baseAngle + (orphanIdx * 0.5 - arcSpread / 2);
                    var oRadius = baseRadius + 200 + orphanIdx * 30;
                    n.x = Math.cos(oAngle) * oRadius;
                    n.y = Math.sin(oAngle) * oRadius;
                    orphanIdx++;
                }
            });
        });

        console.log('[CanvasRenderer] Spiral layout applied to ' + this.nodes.length + ' nodes');
    },

    /**
     * Build discovery mode visibility set
     * Shows: unlocked, available, and locked nodes ONE STEP from available/unlocked
     */
    _buildDiscoveryVisibility: function() {
        if (!settings.discoveryMode || settings.cheatMode) {
            this._discoveryVisibleIds = null;
            return;
        }
        
        var visible = new Set();
        var availableOrUnlockedIds = new Set();
        
        // First pass: collect unlocked, learning, and available nodes
        for (var i = 0; i < this.nodes.length; i++) {
            var node = this.nodes[i];
            if (node.state === 'unlocked' || node.state === 'learning' || node.state === 'available') {
                visible.add(node.id);
                if (node.formId) visible.add(node.formId);
                availableOrUnlockedIds.add(node.id);
                if (node.formId) availableOrUnlockedIds.add(node.formId);
            }
        }
        
        // Second pass: find locked nodes ONE STEP away from visible
        for (var i = 0; i < this.edges.length; i++) {
            var edge = this.edges[i];
            var fromVisible = availableOrUnlockedIds.has(edge.from);
            var toVisible = availableOrUnlockedIds.has(edge.to);
            
            if (fromVisible && !toVisible) {
                visible.add(edge.to);
            }
            if (toVisible && !fromVisible) {
                visible.add(edge.from);
            }
        }
        
        this._discoveryVisibleIds = visible;
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
    
    // =========================================================================
    // COORDINATE TRANSFORMS
    // =========================================================================
    
    screenToWorld: function(screenX, screenY) {
        var cx = this._width / 2;
        var cy = this._height / 2;
        
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

    findGlobeAt: function(worldX, worldY) {
        var globe = (state.treeData && state.treeData.globe) || { x: 0, y: 0, radius: 45 };
        var dx = worldX - globe.x;
        var dy = worldY - globe.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        return dist <= globe.radius ? globe : null;
    },

    // =========================================================================
    // EVENT HANDLERS
    // =========================================================================
    
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
            // Batch pan updates using RAF to prevent multiple renders per frame
            this._pendingPanX = e.clientX - this.panStartX;
            this._pendingPanY = e.clientY - this.panStartY;
            
            if (!this._panRafPending) {
                this._panRafPending = true;
                var self = this;
                requestAnimationFrame(function() {
                    self._panRafPending = false;
                    self.panX = self._pendingPanX;
                    self.panY = self._pendingPanY;
                    self._needsRender = true;
                });
            }
        } else {
            var rect = this.canvas.getBoundingClientRect();
            var world = this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
            var node = this.findNodeAt(world.x, world.y);
            
            if (node !== this.hoveredNode) {
                this.hoveredNode = node;
                this.canvas.style.cursor = node ? 'pointer' : 'grab';
                this._needsRender = true;
                
                if (node) {
                    self._showTooltip(node, e);
                } else {
                    self._hideTooltip();
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
        
        var rect = this.canvas.getBoundingClientRect();
        var mouseX = e.clientX - rect.left - rect.width / 2;
        var mouseY = e.clientY - rect.top - rect.height / 2;
        
        this.panX = mouseX - (mouseX - this.panX) * (newZoom / this.zoom);
        this.panY = mouseY - (mouseY - this.panY) * (newZoom / this.zoom);
        this.zoom = newZoom;
        
        this._needsRender = true;
        
        var zoomEl = document.getElementById('zoom-level');
        if (zoomEl) zoomEl.textContent = Math.round(this.zoom * 100) + '%';
    },
    
    onClick: function(e) {
        var rect = this.canvas.getBoundingClientRect();
        var world = this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        var clickedNode = this.findNodeAt(world.x, world.y);

        if (clickedNode) {
            this.selectedNode = clickedNode;
            this._buildSelectedPathToRoot(clickedNode);
            this._needsRender = true;

            console.log('[CanvasRenderer] Node clicked:', clickedNode.name || clickedNode.id);

            // ALWAYS rotate school to top on click
            this.rotateSchoolToTop(clickedNode.school);

            // Dispatch nodeSelected event (same as WheelRenderer) for detail panel
            window.dispatchEvent(new CustomEvent('nodeSelected', { detail: clickedNode }));
        } else {
            if (this.selectedNode) {
                this.selectedNode = null;
                this._selectedPathEdges = null;
                this._selectedPathNodes = null;
                this._needsRender = true;
            }
        }
    },

    /**
     * Build the complete path from selected node in BOTH directions:
     * - Back to root (ancestors via prerequisites)
     * - Forward to leaves (descendants via children)
     * Stores edges in _selectedPathEdges for highlighting.
     */
    _buildSelectedPathToRoot: function(node) {
        this._selectedPathEdges = new Set();
        this._selectedPathNodes = new Set();

        if (!node || !this._nodeMap) return;

        this._selectedPathNodes.add(node.id);

        // === TRACE BACK TO ROOT (via prerequisites) ===
        var visitedBack = new Set();
        var queueBack = [node.id];

        while (queueBack.length > 0) {
            var currentId = queueBack.shift();
            if (visitedBack.has(currentId)) continue;
            visitedBack.add(currentId);

            var currentNode = this._nodeMap.get(currentId);
            if (!currentNode) continue;

            this._selectedPathNodes.add(currentId);

            var prereqs = currentNode.prerequisites || [];
            for (var i = 0; i < prereqs.length; i++) {
                var prereqId = prereqs[i];
                var edgeKey = prereqId + '->' + currentId;
                this._selectedPathEdges.add(edgeKey);

                if (!visitedBack.has(prereqId)) {
                    queueBack.push(prereqId);
                }
            }
        }

        // === TRACE FORWARD TO LEAVES (via children) ===
        var visitedForward = new Set();
        var queueForward = [node.id];

        while (queueForward.length > 0) {
            var currentId = queueForward.shift();
            if (visitedForward.has(currentId)) continue;
            visitedForward.add(currentId);

            var currentNode = this._nodeMap.get(currentId);
            if (!currentNode) continue;

            this._selectedPathNodes.add(currentId);

            var children = currentNode.children || [];
            for (var i = 0; i < children.length; i++) {
                var childId = children[i];
                var edgeKey = currentId + '->' + childId;
                this._selectedPathEdges.add(edgeKey);

                if (!visitedForward.has(childId)) {
                    queueForward.push(childId);
                }
            }
        }

        console.log('[CanvasRenderer] Selected path (bidirectional): ' + this._selectedPathNodes.size + ' nodes, ' + this._selectedPathEdges.size + ' edges');
    },
    
    // =========================================================================
    // RENDERING
    // =========================================================================
    
    startRenderLoop: function() {
        if (this._rafId) return;
        
        var self = this;
        console.log('[CanvasRenderer] Starting render loop');
        
        // Throttle animation renders to reduce CPU load
        var lastAnimationRender = 0;
        var animationThrottleMs = 50;  // ~20fps for passive animations
        
        function loop(timestamp) {
            var shouldRender = self._needsRender;
            
            // For animation-only updates, throttle to save CPU
            if (shouldRender && self._animationOnlyRender) {
                if (timestamp - lastAnimationRender < animationThrottleMs) {
                    shouldRender = false;
                } else {
                    lastAnimationRender = timestamp;
                }
            }
            
            if (shouldRender) {
                self._needsRender = false;
                self._animationOnlyRender = false;
                self.render();
            }
            
            self._rafId = requestAnimationFrame(loop);
        }
        
        loop(performance.now());
    },
    
    stopRenderLoop: function() {
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
    },
    
    forceRender: function() {
        this._needsRender = true;
        this.render();
    },
    
    render: function() {
        if (!this.ctx || !this.canvas) return;
        
        var startTime = performance.now();
        var ctx = this.ctx;
        var width = this._width || 800;
        var height = this._height || 600;
        
        if (width === 0 || height === 0) return;
        
        var cx = width / 2;
        var cy = height / 2;
        var dpr = window.devicePixelRatio || 1;
        
        // FULL RESET - prevent ghosting
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1.0;
        ctx.globalCompositeOperation = 'source-over';
        
        // Clear the ENTIRE canvas buffer (including offscreen areas)
        ctx.fillStyle = this._bgColor || '#000000';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Scale for DPR
        ctx.scale(dpr, dpr);
        
        // =====================================================================
        // RENDER STARFIELD BACKGROUND (behind everything)
        // =====================================================================
        if (this._starfieldEnabled && typeof Starfield !== 'undefined') {
            // Apply settings
            Starfield.setColor(this._starfieldColor || '#ffffff');
            Starfield.maxSize = this._starfieldMaxSize || 2.5;
            if (Starfield.seed !== this._starfieldSeed) {
                Starfield.seed = this._starfieldSeed || 42;
                Starfield.stars = null;  // Force reinit with new seed
            }
            if (Starfield.starCount !== this._starfieldDensity) {
                Starfield.starCount = this._starfieldDensity || 200;
                Starfield.stars = null;  // Force reinit
            }

            // Render - either fixed to screen or world-space (seed-based)
            if (this._starfieldFixed) {
                // Fixed mode: screen-space stars that drift
                if (!Starfield.stars || Starfield.width !== this._width || Starfield.height !== this._height) {
                    Starfield.init(this._width, this._height);
                }
                Starfield.render(ctx);
            } else {
                // World-space: deterministic tile-based stars from seed
                Starfield.renderWorldSpace(ctx, this.panX, this.panY, this.zoom, this._width, this._height);
            }
            // Keep animation running (throttled)
            this._needsRender = true;
            this._animationOnlyRender = true;
        }
        
        // Calculate rotation values
        var rotRad = this.rotation * Math.PI / 180;
        var cos = Math.cos(rotRad);
        var sin = Math.sin(rotRad);
        
        // Calculate view bounds in WORLD coordinates (accounting for pan)
        // The view center in world space is at (-panX/zoom, -panY/zoom) before rotation
        var viewCenterX = -this.panX / this.zoom;
        var viewCenterY = -this.panY / this.zoom;
        
        // Undo rotation to get world-space view center
        var worldCenterX = viewCenterX * cos + viewCenterY * sin;
        var worldCenterY = -viewCenterX * sin + viewCenterY * cos;
        
        // View extent in world units (add generous padding)
        var viewExtent = Math.max(cx, cy) / this.zoom + 500;
        var viewLeft = worldCenterX - viewExtent;
        var viewRight = worldCenterX + viewExtent;
        var viewTop = worldCenterY - viewExtent;
        var viewBottom = worldCenterY + viewExtent;
        
        // =====================================================================
        // RENDER ROTATING ELEMENTS FIRST (dividers, edges, nodes)
        // =====================================================================
        ctx.save();
        ctx.translate(cx + this.panX, cy + this.panY);
        ctx.rotate(rotRad);  // Apply wheel rotation
        ctx.scale(this.zoom, this.zoom);
        
        // School dividers
        this.renderSchoolDividers(ctx);
        
        // Debug grid (behind edges/nodes)
        this.renderDebugGrid(ctx);
        
        // Edges
        this.renderEdges(ctx, viewLeft, viewRight, viewTop, viewBottom);
        
        // Learning path animation (glowing line from center to learned spell)
        this.renderLearningPath(ctx);
        
        // Detached particles (above lines, below nodes)
        if (typeof Globe3D !== 'undefined' && Globe3D.detachedParticles && Globe3D.detachedParticles.length > 0) {
            Globe3D._renderDetachedParticles(ctx);
        }
        
        // Nodes
        this.renderNodes(ctx, viewLeft, viewRight, viewTop, viewBottom);

        // Edit mode overlay (pen line, eraser path)
        if (typeof EditMode !== 'undefined' && EditMode.isActive) {
            EditMode.renderOverlay(ctx);
        }

        ctx.restore();
        
        // =====================================================================
        // RENDER CENTER HUB ON TOP (does NOT rotate with wheel) - with heartbeat
        // =====================================================================
        var globeData = (state.treeData && state.treeData.globe) || { x: 0, y: 0, radius: 45 };
        ctx.save();
        ctx.translate(cx + this.panX, cy + this.panY);
        ctx.scale(this.zoom, this.zoom);
        ctx.translate(globeData.x, globeData.y);
        // No rotation applied to hub!
        
        // Heartbeat animation - pulsing scale with configurable delay between pulse groups
        var pulse = 0;
        var scale = 1;
        if (this._heartAnimationEnabled) {
            this._heartbeatPhase += this._heartbeatSpeed;
            
            // Heartbeat animation: double beat (systole-diastole) then delay
            // pulse_speed controls how fast each beat is
            // pulse_delay controls the pause between heartbeat groups
            
            // Convert delay from seconds to "phase units" at 60fps
            // At speed 0.06 and 60fps, one second = 0.06 * 60 = 3.6 phase units
            var phasePerSecond = this._heartbeatSpeed * 60;
            var pulseDelay = (this._heartPulseDelay || 2.0) * phasePerSecond;
            var beatDuration = Math.PI;  // The double-beat takes PI radians
            var cycleLength = beatDuration + pulseDelay;
            var cyclePos = this._heartbeatPhase % cycleLength;
            
            // Only pulse during the "beat" part of the cycle (first PI radians)
            if (cyclePos < beatDuration) {
                // Double-beat pattern: quick pulse, pause, quick pulse
                var beat1 = Math.max(0, Math.sin(cyclePos * 2));
                var beat2 = Math.max(0, Math.sin(cyclePos * 2 - 0.8));
                pulse = (beat1 + beat2 * 0.6) * 0.08;  // Max ~8% scale change
            }
            scale = 1 + pulse;
        }
        
        // Keep animation running for heartbeat or globe (throttled to reduce CPU)
        var globeEnabled = this._globeEnabled && (typeof Globe3D !== 'undefined') && Globe3D.enabled;
        if (this._heartAnimationEnabled || globeEnabled) {
            this._needsRender = true;
            this._animationOnlyRender = true;  // Mark as throttleable
        }
        
        ctx.scale(scale, scale);
        
        // Core Size: use settings.globeSize if available, else fall back to globeData
        var baseRadius = (typeof settings !== 'undefined' && settings.globeSize) ? settings.globeSize : (globeData.radius || 45);
        var ringColor = this._heartRingColor || '#b8a878';
        var bgColor = this._heartBgColor || '#000000';
        
        // Parse ring color for glow
        var ringRgb = this.parseColor(ringColor);
        var glowColor = ringRgb ? 'rgba(' + ringRgb.r + ',' + ringRgb.g + ',' + ringRgb.b + ',' : 'rgba(184, 168, 120, ';
        
        // Outer glow ring (pulses with heartbeat)
        var glowAlpha = 0.15 + pulse * 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, baseRadius + 8, 0, Math.PI * 2);
        ctx.fillStyle = glowColor + glowAlpha + ')';
        ctx.fill();
        
        // Background circle (dark center) - toggleable on/off
        if (this._globeBgFill) {
            ctx.beginPath();
            ctx.arc(0, 0, baseRadius, 0, Math.PI * 2);
            ctx.fillStyle = bgColor;
            ctx.fill();
        }
        
        // Inner decorative ring
        ctx.beginPath();
        ctx.arc(0, 0, baseRadius - 5, 0, Math.PI * 2);
        ctx.strokeStyle = glowColor + '0.3)';
        ctx.lineWidth = 1;
        ctx.stroke();
        
        // Outer border ring
        ctx.beginPath();
        ctx.arc(0, 0, baseRadius, 0, Math.PI * 2);
        ctx.strokeStyle = ringColor;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        
        // Globe text - use separate text color if set, supports \n for line breaks
        var textColor = this._magicTextColor || ringColor;
        var fontSize = this._globeTextSize || 16;
        var globeText = this._globeText || 'HoM';
        ctx.fillStyle = textColor;
        ctx.font = 'bold ' + fontSize + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Split by \n for multi-line support
        var lines = globeText.replace(/\\n/g, '\n').split('\n');
        var lineHeight = fontSize * 1.2;
        var totalHeight = (lines.length - 1) * lineHeight;
        var startY = -totalHeight / 2;
        
        for (var i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], 0, startY + i * lineHeight);
        }
        
        // 3D Globe particle effect (uses Globe3D module)
        if (this._globeEnabled && typeof Globe3D !== 'undefined') {
            // Use globe color if set, otherwise ring color
            var globeColor = this._globeColor || ringColor;
            Globe3D.setColor(globeColor);
            Globe3D.render(ctx);
        }
        
        ctx.restore();
        
        // =====================================================================
        // RENDER LABELS (screen-aligned, do NOT rotate with wheel)
        // =====================================================================
        this.renderLabels(ctx, cx, cy, cos, sin);
        
        var elapsed = performance.now() - startTime;
        if (elapsed > 16 || this._logNextRender) {
            console.log('[CanvasRenderer] Render:', Math.round(elapsed) + 'ms,', this.nodes.length, 'nodes');
            this._logNextRender = false;
        }
    },
    
    renderSchoolDividers: function(ctx) {
        // Check if dividers are enabled
        if (!settings.showSchoolDividers) return;
        
        var schoolNames = Object.keys(this.schools);
        if (schoolNames.length < 2) return;
        
        var length = settings.dividerLength !== undefined ? settings.dividerLength : 800;
        var fade = (settings.dividerFade !== undefined ? settings.dividerFade : 50) / 100;  // Convert to 0-1
        var lineWidth = settings.dividerSpacing !== undefined ? settings.dividerSpacing : 3;
        var colorMode = settings.dividerColorMode || 'school';
        var customColor = settings.dividerCustomColor || '#ffffff';
        
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';
        
        // Draw dividers at each school's START angle (derived from actual node data)
        for (var i = 0; i < schoolNames.length; i++) {
            var schoolName = schoolNames[i];
            var school = this.schools[schoolName];
            var angle = school.startAngle !== undefined ? school.startAngle : (i * (360 / schoolNames.length) - 90);
            var rad = angle * Math.PI / 180;
            
            // Determine color based on mode
            var color;
            if (colorMode === 'custom') {
                color = customColor;
            } else {
                // Use school color (the school whose boundary this divider represents)
                color = this._getSchoolColor(schoolName) || '#ffffff';
            }
            
            // Create gradient for fade effect (globe center to outer edge)
            var gd = (state.treeData && state.treeData.globe) || { x: 0, y: 0 };
            var endX = gd.x + Math.cos(rad) * length;
            var endY = gd.y + Math.sin(rad) * length;
            var gradient = ctx.createLinearGradient(gd.x, gd.y, endX, endY);
            
            // Fade setting: 0% = solid line, 100% = fades to transparent
            // Higher fade = more transparent at the end
            var rgb = this._hexToRgb(color);
            var startAlpha = 0.8;  // Always start fairly visible
            var endAlpha = startAlpha * (1 - fade);  // At 100% fade, end is transparent
            
            gradient.addColorStop(0, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + startAlpha + ')');
            gradient.addColorStop(0.5, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + (startAlpha * 0.7 + endAlpha * 0.3) + ')');
            gradient.addColorStop(1, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + endAlpha + ')');
            
            ctx.strokeStyle = gradient;
            
            ctx.beginPath();
            ctx.moveTo(gd.x, gd.y);
            ctx.lineTo(endX, endY);
            ctx.stroke();
        }
    },
    
    _hexToRgb: function(hex) {
        hex = hex.replace('#', '');
        return {
            r: parseInt(hex.substring(0, 2), 16),
            g: parseInt(hex.substring(2, 4), 16),
            b: parseInt(hex.substring(4, 6), 16)
        };
    },
    
    _hexToRgba: function(hex, alpha) {
        var rgb = this._hexToRgb(hex);
        return 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + alpha + ')';
    },
    
    renderEdges: function(ctx, viewLeft, viewRight, viewTop, viewBottom) {
        var learningPathColor = this._learningPathColor || '#00ffff';
        var hasLearningPaths = this._learningPathNodes instanceof Set && this._learningPathNodes.size > 0;
        
        // Detect heartbeat for spawning traveling pulses
        var isHeartbeating = false;
        if (hasLearningPaths && this._heartAnimationEnabled) {
            var phasePerSecond = this._heartbeatSpeed * 60;
            var pulseDelay = (this._heartPulseDelay || 2.0) * phasePerSecond;
            var beatDuration = Math.PI;
            var cycleLength = beatDuration + pulseDelay;
            var cyclePos = this._heartbeatPhase % cycleLength;
            
            // Detect start of heartbeat (rising edge)
            var nowBeating = cyclePos < beatDuration && cyclePos < 0.5;
            if (nowBeating && !this._lastHeartbeatPulse) {
                // Detach globe particle to travel along learning path
                this._detachGlobeParticleToLearningPath();
            }
            this._lastHeartbeatPulse = nowBeating;
            isHeartbeating = cyclePos < beatDuration;
        }
        
        // =====================================================================
        // FIRST: Draw lines from CENTER to ROOT NODES
        // =====================================================================
        for (var i = 0; i < this.nodes.length; i++) {
            var node = this.nodes[i];
            
            // Check if this is a root node ONLY (not tier 1)
            if (!node.isRoot) continue;
            
            // Skip if hidden school
            if (settings.schoolVisibility && settings.schoolVisibility[node.school] === false) continue;
            
            // Check if this node is on a learning path
            var isOnLearningPath = this._learningPathNodes instanceof Set &&
                                   this._learningPathNodes.has(node.id);

            // During animation, hide ONLY the nodes in the currently animating path
            // (let animation draw that path progressively, but keep other learning paths visible)
            if (isOnLearningPath && this._animatingPathNodes && this._animatingPathNodes.has(node.id)) {
                isOnLearningPath = false;  // Hide - animation will draw this
            }
            
            // Draw if unlocked OR if on a learning path (after animation)
            if (node.state !== 'unlocked' && !isOnLearningPath) continue;
            
            // Check if this root is on the selected path
            var isRootOnSelectedPath = this._selectedPathNodes && this._selectedPathNodes.has(node.id);
            var hasSelectedPath = this._selectedPathEdges && this._selectedPathEdges.size > 0;
            var showSelectionPathRoot = settings.showSelectionPath !== false;

            // Draw line from globe center to root node
            var gd = (state.treeData && state.treeData.globe) || { x: 0, y: 0 };
            ctx.beginPath();
            ctx.moveTo(gd.x, gd.y);
            ctx.lineTo(node.x, node.y);

            if (isOnLearningPath) {
                // Glowing learning path style - static, pulses travel along it
                ctx.strokeStyle = learningPathColor;
                ctx.lineWidth = 3;
                ctx.globalAlpha = 0.7;
            } else if (isRootOnSelectedPath && showSelectionPathRoot) {
                // Root is on selected path - WHITE highlight (if enabled)
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 3;
                ctx.globalAlpha = 0.45;
            } else {
                // Normal unlocked root line - always visible regardless of selection
                ctx.strokeStyle = this._getSchoolColor(node.school);
                ctx.lineWidth = 2;
                ctx.globalAlpha = 0.4;
            }
            ctx.stroke();
        }
        
        // =====================================================================
        // SECOND: Draw regular edges (3-pass for z-order)
        // Pass 1: Dim/normal edges (bottom)
        // Pass 2: Selected path edges (WHITE, middle)
        // Pass 3: Learning path edges (top)
        // =====================================================================
        var hasSelectedPath = this._selectedPathEdges && this._selectedPathEdges.size > 0;
        var self = this;

        // Helper to check visibility and culling
        function shouldDrawEdge(edge) {
            var fromNode = self._nodeMap.get(edge.from);
            var toNode = self._nodeMap.get(edge.to);
            if (!fromNode || !toNode) return null;

            // Discovery mode: skip if either node not visible
            if (self._discoveryVisibleIds && !(typeof EditMode !== 'undefined' && EditMode.isActive)) {
                var fromVisible = self._discoveryVisibleIds.has(edge.from) || self._discoveryVisibleIds.has(fromNode.id);
                var toVisible = self._discoveryVisibleIds.has(edge.to) || self._discoveryVisibleIds.has(toNode.id);
                if (!fromVisible || !toVisible) return null;
            }

            // Viewport culling
            var minX = Math.min(fromNode.x, toNode.x);
            var maxX = Math.max(fromNode.x, toNode.x);
            var minY = Math.min(fromNode.y, toNode.y);
            var maxY = Math.max(fromNode.y, toNode.y);
            if (maxX < viewLeft || minX > viewRight || maxY < viewTop || minY > viewBottom) {
                return null;
            }

            return { fromNode: fromNode, toNode: toNode };
        }

        // === PASS 1: Dim/normal edges (background) ===
        // Check if base connections should be shown (setting)
        var showBaseConnections = settings.showBaseConnections !== false;

        ctx.lineWidth = 1;
        for (var i = 0; i < this.edges.length; i++) {
            var edge = this.edges[i];
            var nodes = shouldDrawEdge(edge);
            if (!nodes) continue;

            var fromNode = nodes.fromNode;
            var toNode = nodes.toNode;
            var edgeKey = edge.from + '->' + edge.to;
            var isOnSelectedPath = this._selectedPathEdges && this._selectedPathEdges.has(edgeKey);
            var fromOnPath = hasLearningPaths && this._learningPathNodes.has(fromNode.id);
            var toOnPath = hasLearningPaths && this._learningPathNodes.has(toNode.id);
            var isLearningEdge = fromOnPath && toOnPath;

            // Skip selected and learning edges - they go in later passes
            if (isOnSelectedPath || isLearningEdge) continue;

            var bothUnlocked = fromNode.state === 'unlocked' && toNode.state === 'unlocked';

            // Unlocked connections always show; base connections respect setting
            if (!bothUnlocked && !showBaseConnections) continue;

            // Only dim when selection path highlighting is enabled
            var showSelectionPathDim = settings.showSelectionPath !== false;

            if (hasSelectedPath && showSelectionPathDim) {
                // Node selected but this edge NOT on path - dim heavily
                ctx.strokeStyle = '#222';
                ctx.lineWidth = 1;
                ctx.globalAlpha = 0.08;
            } else if (bothUnlocked) {
                // Unlocked connections always visible at full opacity
                ctx.strokeStyle = this._getSchoolColor(fromNode.school);
                ctx.lineWidth = 2;
                ctx.globalAlpha = 0.5;
            } else {
                ctx.strokeStyle = '#333';
                ctx.lineWidth = 1;
                ctx.globalAlpha = 0.15;
            }

            ctx.beginPath();
            ctx.moveTo(fromNode.x, fromNode.y);
            ctx.lineTo(toNode.x, toNode.y);
            ctx.stroke();
        }

        // === PASS 2: Selected path edges (WHITE, middle layer) ===
        // Only draw if selection path highlighting is enabled
        var showSelectionPath = settings.showSelectionPath !== false;

        if (hasSelectedPath && showSelectionPath) {
            for (var i = 0; i < this.edges.length; i++) {
                var edge = this.edges[i];
                var nodes = shouldDrawEdge(edge);
                if (!nodes) continue;

                var edgeKey = edge.from + '->' + edge.to;
                if (!this._selectedPathEdges.has(edgeKey)) continue;

                // Don't draw over learning edges - they get their own pass
                var fromOnPath = hasLearningPaths && this._learningPathNodes.has(nodes.fromNode.id);
                var toOnPath = hasLearningPaths && this._learningPathNodes.has(nodes.toNode.id);
                if (fromOnPath && toOnPath) continue;

                ctx.strokeStyle = '#555555';  // Gray highlight (not pure white)
                ctx.lineWidth = 2;
                ctx.globalAlpha = 0.5;

                ctx.beginPath();
                ctx.moveTo(nodes.fromNode.x, nodes.fromNode.y);
                ctx.lineTo(nodes.toNode.x, nodes.toNode.y);
                ctx.stroke();
            }
        }

        // === PASS 3: Learning path edges (top layer) ===
        if (hasLearningPaths) {
            for (var i = 0; i < this.edges.length; i++) {
                var edge = this.edges[i];
                var nodes = shouldDrawEdge(edge);
                if (!nodes) continue;

                var fromNode = nodes.fromNode;
                var toNode = nodes.toNode;
                var fromOnPath = this._learningPathNodes.has(fromNode.id);
                var toOnPath = this._learningPathNodes.has(toNode.id);

                if (!fromOnPath || !toOnPath) continue;

                // Skip if animating
                if (this._animatingPathNodes) {
                    if (this._animatingPathNodes.has(fromNode.id) && this._animatingPathNodes.has(toNode.id)) {
                        continue;
                    }
                }

                var toLearning = toNode.state === 'learning';
                ctx.strokeStyle = learningPathColor;
                ctx.lineWidth = toLearning ? 3 : 2;
                ctx.globalAlpha = 0.7;

                ctx.beginPath();
                ctx.moveTo(fromNode.x, fromNode.y);
                ctx.lineTo(toNode.x, toNode.y);
                ctx.stroke();
            }
        }

        // === PASS 4: Chain edges for hardPrereqs on selected node ===
        if (this.selectedNode && this.selectedNode.hardPrereqs && this.selectedNode.hardPrereqs.length > 0) {
            var selNode = this.selectedNode;

            for (var li = 0; li < selNode.hardPrereqs.length; li++) {
                var hpId = selNode.hardPrereqs[li];
                var hpNode = this._nodeMap ? this._nodeMap.get(hpId) : null;
                if (!hpNode) continue;

                // Chain goes FROM hardPrereq TO selected node
                var fromNode = hpNode;
                var toNode = selNode;

                // Viewport culling
                if (fromNode.x < viewLeft && toNode.x < viewLeft) continue;
                if (fromNode.x > viewRight && toNode.x > viewRight) continue;
                if (fromNode.y < viewTop && toNode.y < viewTop) continue;
                if (fromNode.y > viewBottom && toNode.y > viewBottom) continue;

                var dx = toNode.x - fromNode.x;
                var dy = toNode.y - fromNode.y;
                var dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 1) continue;

                // Chain-link parameters
                var linkW = 5;       // Link width (along chain)
                var linkH = 3.2;     // Link height (perpendicular)
                var linkThick = 1.8; // Stroke thickness of each link
                var linkSpacing = linkW * 1.15; // Center-to-center distance
                var numLinks = Math.max(3, Math.round(dist / linkSpacing));
                var angle = Math.atan2(dy, dx);

                ctx.globalAlpha = 0.8;

                // Draw interlocking chain links (alternating orientation)
                for (var cl = 0; cl < numLinks; cl++) {
                    var t = (cl + 0.5) / numLinks;
                    var cx = fromNode.x + dx * t;
                    var cy = fromNode.y + dy * t;

                    ctx.save();
                    ctx.translate(cx, cy);
                    ctx.rotate(angle);

                    // Alternate: even links are horizontal (along chain), odd are rotated 90 degrees
                    if (cl % 2 !== 0) {
                        ctx.rotate(Math.PI / 2);
                    }

                    // Draw a rounded-rectangle chain link (pill shape)
                    var hw = linkW * 0.5;
                    var hh = linkH * 0.5;
                    var r = Math.min(hw, hh) * 0.8; // corner radius

                    ctx.beginPath();
                    ctx.moveTo(-hw + r, -hh);
                    ctx.lineTo(hw - r, -hh);
                    ctx.arcTo(hw, -hh, hw, -hh + r, r);
                    ctx.lineTo(hw, hh - r);
                    ctx.arcTo(hw, hh, hw - r, hh, r);
                    ctx.lineTo(-hw + r, hh);
                    ctx.arcTo(-hw, hh, -hw, hh - r, r);
                    ctx.lineTo(-hw, -hh + r);
                    ctx.arcTo(-hw, -hh, -hw + r, -hh, r);
                    ctx.closePath();

                    // Gray fill + darker stroke = solid chain look
                    ctx.fillStyle = 'rgba(130, 130, 140, 0.6)';
                    ctx.strokeStyle = 'rgba(80, 80, 90, 0.9)';
                    ctx.lineWidth = linkThick;
                    ctx.fill();
                    ctx.stroke();

                    // Inner cutout (hollow center of each link)
                    var ihw = hw * 0.45;
                    var ihh = hh * 0.35;
                    var ir = Math.min(ihw, ihh) * 0.6;
                    ctx.beginPath();
                    ctx.moveTo(-ihw + ir, -ihh);
                    ctx.lineTo(ihw - ir, -ihh);
                    ctx.arcTo(ihw, -ihh, ihw, -ihh + ir, ir);
                    ctx.lineTo(ihw, ihh - ir);
                    ctx.arcTo(ihw, ihh, ihw - ir, ihh, ir);
                    ctx.lineTo(-ihw + ir, ihh);
                    ctx.arcTo(-ihw, ihh, -ihw, ihh - ir, ir);
                    ctx.lineTo(-ihw, -ihh + ir);
                    ctx.arcTo(-ihw, -ihh, -ihw + ir, -ihh, ir);
                    ctx.closePath();

                    ctx.fillStyle = 'rgba(20, 20, 30, 0.7)';
                    ctx.fill();

                    ctx.restore();
                }
            }
        }

        ctx.globalAlpha = 1.0;
    },
    
    renderNodes: function(ctx, viewLeft, viewRight, viewTop, viewBottom) {
        for (var i = 0; i < this.nodes.length; i++) {
            var node = this.nodes[i];
            
            // Viewport culling
            if (node.x < viewLeft || node.x > viewRight || node.y < viewTop || node.y > viewBottom) {
                continue;
            }
            
            // Skip hidden schools
            if (settings.schoolVisibility && settings.schoolVisibility[node.school] === false) {
                continue;
            }
            
            // Discovery mode visibility (disabled in edit mode - show everything)
            if (this._discoveryVisibleIds && !(typeof EditMode !== 'undefined' && EditMode.isActive)) {
                if (!this._discoveryVisibleIds.has(node.id) && !this._discoveryVisibleIds.has(node.formId)) {
                    continue;
                }

                // Show locked nodes as mystery
                if (node.state === 'locked') {
                    this.renderMysteryNode(ctx, node);
                    continue;
                }
            }
            
            this.renderNode(ctx, node);
        }
    },
    
    renderMysteryNode: function(ctx, node) {
        var color = this._getSchoolColor(node.school);
        var dimmedColor = this.dimColor(color, 0.4);
        var size = 8;
        var path = this._getShapePath(node.school);
        
        ctx.save();
        ctx.translate(node.x, node.y);
        
        // Rotate all shapes so flat edge faces toward center (tangent to central circle)
        var angleToCenter = Math.atan2(node.y, node.x);
        var rotationOffset = 0;
        
        switch (node.school) {
            case 'Destruction':  // Diamond (4 sides)
                rotationOffset = Math.PI / 4;
                break;
            case 'Alteration':   // Hexagon (6 sides)
                rotationOffset = Math.PI / 6;
                break;
            case 'Conjuration':  // Pentagon (5 sides) - tip points toward center
                rotationOffset = Math.PI / 2;
                break;
            case 'Illusion':     // Triangle (3 sides)
                rotationOffset = Math.PI / 2;
                break;
        }
        
        if (rotationOffset !== 0) {
            ctx.rotate(angleToCenter + rotationOffset);
        }
        
        ctx.scale(size, size);
        
        ctx.fillStyle = 'rgba(20, 20, 30, 0.9)';
        ctx.strokeStyle = dimmedColor;
        ctx.lineWidth = 1 / size;
        ctx.globalAlpha = 0.6;
        
        ctx.fill(path);
        ctx.stroke(path);
        
        ctx.restore();
        
        // Draw "?" - counter-rotate so it stays screen-aligned
        ctx.save();
        ctx.translate(node.x, node.y);
        
        // Counter-rotate to cancel out the wheel rotation
        var rotRad = this.rotation * Math.PI / 180;
        ctx.rotate(-rotRad);
        
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = dimmedColor;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', 0, 0);
        
        ctx.restore();
        ctx.globalAlpha = 1.0;
    },
    
    renderNode: function(ctx, node) {
        var schoolColor = this._getSchoolColor(node.school);
        var isSelected = this.selectedNode && this.selectedNode.id === node.id;
        var isHovered = this.hoveredNode && this.hoveredNode.id === node.id;
        var path = this._getShapePath(node.school);
        
        var size, fillColor, strokeColor, strokeWidth, alpha;
        var learningPathColor = this._learningPathColor || '#00ffff';
        var ringColor = this._heartRingColor || '#b8a878';  // Gold ring color for outlines
        // Check if on learning path
        var isOnLearningPath = (this._learningPathNodes instanceof Set) &&
                               this._learningPathNodes.has(node.id);
        var isLearning = (node.state === 'learning' || node.state === 'Learning');

        // Check if this node has hard prereqs (locks) - needs gray outline treatment
        var hasLockPrereqs = node.hardPrereqs && node.hardPrereqs.length > 0;

        // During animation, hide learning path styling ONLY for nodes in the animating path
        // (other learning paths remain visible)
        var isBeingAnimated = this._animatingPathNodes && this._animatingPathNodes.has(node.id);
        if (isOnLearningPath && isBeingAnimated) {
            isOnLearningPath = false;  // Hide path styling - animation will draw this
        }

        // If this is the learning node but it's being animated, don't show learning styling yet
        // (show as 'available' until animation completes and reaches this node)
        var showLearningStyle = isLearning && !isBeingAnimated;

        if (node.state === 'unlocked') {
            size = 12;
            fillColor = schoolColor;
            // Use ring color only if on learning path, else school color
            strokeColor = isOnLearningPath ? ringColor : schoolColor;
            strokeWidth = 1.5;
            alpha = 1.0;
        } else if (showLearningStyle) {
            // Learning state - cyan fill, ring color outline (only after animation completes)
            size = 12;  // Same as unlocked
            fillColor = learningPathColor;  // Cyan fill
            strokeColor = ringColor;  // Ring color outline for learning node
            strokeWidth = 1.5;
            alpha = 1.0;
        } else if (node.state === 'available' || (isLearning && isBeingAnimated)) {
            // Available nodes OR learning nodes still being animated (show as available temporarily)
            size = 9;
            fillColor = '#1a1a2e';
            strokeColor = schoolColor;  // Use school/tree color for available nodes
            strokeWidth = 1;
            alpha = 0.8;
        } else {
            size = 7;
            fillColor = '#1a1a2e';
            strokeColor = schoolColor;  // Use school/tree color for locked nodes (dimmed by alpha)
            strokeWidth = 1;
            alpha = 0.4;
        }
        
        if (isSelected || isHovered) {
            size += 1.5;  // Subtle hover expansion
            strokeColor = '#fff';
            strokeWidth = 1.5;
            alpha = 1.0;
        }

        // Lock visual overrides for nodes with hardPrereqs
        // Not-unlocked: gray fill + small school-colored center hole
        // Unlocked: normal look + gray outline ring
        var lockGrayFill = false;
        var lockGrayOutline = false;
        if (hasLockPrereqs) {
            if (node.state === 'unlocked') {
                lockGrayOutline = true;  // Unlocked but was locked: gray ring persists
            } else {
                lockGrayFill = true;     // Not yet unlocked: gray body + school color hole
            }
        }
        
        ctx.save();
        ctx.translate(node.x, node.y);
        
        // Rotate all shapes so flat edge faces toward center (tangent to central circle)
        var angleToCenter = Math.atan2(node.y, node.x);
        var rotationOffset = 0;
        
        switch (node.school) {
            case 'Destruction':  // Diamond (4 sides) - rotate 45° for flat edge
                rotationOffset = Math.PI / 4;
                break;
            case 'Alteration':   // Hexagon (6 sides) - rotate 30° for flat edge
                rotationOffset = Math.PI / 6;
                break;
            case 'Conjuration':  // Pentagon (5 sides) - rotate 90° so tip points toward center
                rotationOffset = Math.PI / 2;
                break;
            case 'Illusion':     // Triangle (3 sides) - rotate 90° so tip points in
                rotationOffset = Math.PI / 2;
                break;
            // Restoration (circle) needs no rotation
        }
        
        if (rotationOffset !== 0) {
            ctx.rotate(angleToCenter + rotationOffset);
        }
        
        if (lockGrayFill) {
            // === LOCKED NODE WITH HARD PREREQS ===
            // Outer: gray filled shape (the "lock shell")
            var outerSize = size + 2;
            ctx.save();
            ctx.scale(outerSize, outerSize);
            ctx.globalAlpha = Math.min(alpha + 0.2, 0.75);
            ctx.fillStyle = 'rgba(90, 90, 100, 0.7)';
            ctx.strokeStyle = 'rgba(140, 140, 155, 0.8)';
            ctx.lineWidth = 1.2 / outerSize;
            ctx.fill(path);
            ctx.stroke(path);
            ctx.restore();

            // Inner: small school-colored center hole
            var holeSize = Math.max(size * 0.45, 3);
            ctx.scale(holeSize, holeSize);
            ctx.globalAlpha = Math.min(alpha + 0.15, 0.65);
            ctx.fillStyle = schoolColor;
            ctx.fill(path);
        } else if (lockGrayOutline) {
            // === UNLOCKED NODE WITH HARD PREREQS ===
            // Gray outline ring behind the normal shape
            var ringSize = size + 3;
            ctx.save();
            ctx.scale(ringSize, ringSize);
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = 'rgba(90, 90, 100, 0.25)';
            ctx.strokeStyle = 'rgba(150, 150, 160, 0.7)';
            ctx.lineWidth = 1.5 / ringSize;
            ctx.fill(path);
            ctx.stroke(path);
            ctx.restore();

            // Normal unlocked node on top
            ctx.scale(size, size);
            ctx.globalAlpha = alpha;
            ctx.fillStyle = fillColor;
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = strokeWidth / size;
            ctx.fill(path);
            ctx.stroke(path);

            // Inner accent
            ctx.scale(0.5, 0.5);
            ctx.fillStyle = this.getInnerAccentColor(schoolColor);
            ctx.fill(path);
        } else {
            // === NORMAL NODE (no lock prereqs) ===
            ctx.scale(size, size);
            ctx.globalAlpha = alpha;
            ctx.fillStyle = fillColor;
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = strokeWidth / size;
            ctx.fill(path);
            ctx.stroke(path);

            // Draw inner accent for unlocked nodes
            if (node.state === 'unlocked') {
                ctx.scale(0.5, 0.5);
                ctx.fillStyle = this.getInnerAccentColor(schoolColor);
                ctx.fill(path);
            }

            // Draw white center for learning node
            if (isLearning) {
                ctx.scale(0.4, 0.4);
                ctx.fillStyle = '#ffffff';
                ctx.fill(path);
            }
        }
        
        ctx.restore();
        ctx.globalAlpha = 1.0;
    },
    
    /**
     * Render debug grid showing all candidate positions
     * Called within the rotated context
     * Uses ACTUAL school data for alignment
     */
    renderDebugGrid: function(ctx) {
        if (!this.showDebugGrid) return;

        var spacing = 50;
        var extent = 1300;

        ctx.fillStyle = 'rgba(184, 168, 120, 0.35)';
        for (var gx = -extent; gx <= extent; gx += spacing) {
            for (var gy = -extent; gy <= extent; gy += spacing) {
                ctx.beginPath();
                ctx.arc(gx, gy, 3, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    },
    
    /**
     * Toggle debug grid visibility
     */
    toggleDebugGrid: function() {
        this.showDebugGrid = !this.showDebugGrid;
        this._needsRender = true;
        console.log('[CanvasRenderer] Debug grid:', this.showDebugGrid ? 'ON' : 'OFF');
        return this.showDebugGrid;
    },
    
    // =========================================================================
    // LEARNING PATH ANIMATION
    // =========================================================================
    
    /**
     * Build the path from center (0,0) to a node, following prerequisite edges
     * Returns array of {x, y} points
     */
    _buildPathToNode: function(nodeId) {
        var path = [];
        var visited = new Set();
        var node = this._nodeMap.get(nodeId);
        
        if (!node) return path;
        
        // Build path backwards from target to root, then reverse
        var current = node;
        var safety = 100;  // Prevent infinite loops
        
        while (current && safety-- > 0) {
            path.unshift({ x: current.x, y: current.y, node: current });
            visited.add(current.id);
            
            // Find prerequisite (parent node that connects to this one)
            var prereq = null;
            for (var i = 0; i < this.edges.length; i++) {
                var edge = this.edges[i];
                if (edge.to === current.id && !visited.has(edge.from)) {
                    prereq = this._nodeMap.get(edge.from);
                    break;
                }
            }
            
            if (!prereq) break;
            current = prereq;
        }
        
        // Add globe position at start (instead of hardcoded origin)
        var gd = (state.treeData && state.treeData.globe) || { x: 0, y: 0 };
        path.unshift({ x: gd.x, y: gd.y, node: null });
        
        return path;
    },
    
    /**
     * Trigger learning animation for a node
     * Call this when a spell is learned/unlocked
     */
    triggerLearningAnimation: function(nodeId) {
        var node = this._nodeMap ? this._nodeMap.get(nodeId) : null;
        if (!node) {
            console.warn('[CanvasRenderer] triggerLearningAnimation: node not found:', nodeId);
            return;
        }
        
        var path = this._buildPathToNode(nodeId);
        if (path.length < 2) {
            console.warn('[CanvasRenderer] triggerLearningAnimation: path too short');
            return;
        }
        
        // Use learning path color (cyan)
        var color = this._learningPathColor || '#00ffff';
        
        // Use learning path color (cyan)
        var color = this._learningPathColor || '#00ffff';
        
        this._learningPath = {
            nodeId: nodeId,
            path: path,
            progress: 0,
            startTime: performance.now(),
            color: color
        };

        // Store which nodes are in THIS specific animating path
        // (so we can hide only these during animation, not other learning paths)
        this._animatingPathNodes = new Set();
        for (var i = 0; i < path.length; i++) {
            if (path[i].node && path[i].node.id) {
                this._animatingPathNodes.add(path[i].node.id);
            }
        }

        // Don't show static learning path until animation completes
        this._learningPathAnimationComplete = false;

        console.log('[CanvasRenderer] Learning animation started for:', node.name, 'path length:', path.length, 'animating nodes:', this._animatingPathNodes.size);
        this._needsRender = true;
    },
    
    /**
     * Render the learning path animation (glowing line from center to spell)
     * Called within rotated context
     */
    renderLearningPath: function(ctx) {
        if (!this._learningPath) return;
        
        var lp = this._learningPath;
        var elapsed = performance.now() - lp.startTime;
        var progress = Math.min(elapsed / this._learningPathDuration, 1);
        
        // Ease-out for smooth arrival
        var easedProgress = 1 - Math.pow(1 - progress, 2);
        
        var path = lp.path;
        if (path.length < 2) return;
        
        // Calculate total path length
        var totalLength = 0;
        var segmentLengths = [];
        for (var i = 1; i < path.length; i++) {
            var dx = path[i].x - path[i-1].x;
            var dy = path[i].y - path[i-1].y;
            var len = Math.sqrt(dx * dx + dy * dy);
            segmentLengths.push(len);
            totalLength += len;
        }
        
        // How far along the path we are
        var targetLength = totalLength * easedProgress;
        
        // Draw the glowing path up to the current progress point
        ctx.save();
        
        // Outer glow
        ctx.beginPath();
        ctx.moveTo(path[0].x, path[0].y);
        
        var drawnLength = 0;
        var lastPoint = path[0];
        
        for (var i = 1; i < path.length; i++) {
            var segLen = segmentLengths[i-1];
            
            if (drawnLength + segLen <= targetLength) {
                // Full segment
                ctx.lineTo(path[i].x, path[i].y);
                lastPoint = path[i];
                drawnLength += segLen;
            } else {
                // Partial segment - interpolate
                var remaining = targetLength - drawnLength;
                var t = remaining / segLen;
                var interpX = path[i-1].x + (path[i].x - path[i-1].x) * t;
                var interpY = path[i-1].y + (path[i].y - path[i-1].y) * t;
                ctx.lineTo(interpX, interpY);
                lastPoint = { x: interpX, y: interpY };
                break;
            }
        }
        
        // Draw line - same style as static learning path
        var learningPathColor = this._learningPathColor || '#00ffff';
        ctx.strokeStyle = learningPathColor;
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.7;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        
        ctx.restore();
        
        // Continue animation or end it
        if (progress >= 1) {
            // Animation complete - mark as done so static path can show
            this._learningPathAnimationComplete = true;
            this._animatingPathNodes = null;  // Clear animating nodes - all paths now visible

            // Clear the animation object shortly after completion
            if (elapsed > this._learningPathDuration + 200) {
                this._learningPath = null;
            }
        }
        
        // Keep rendering while animation is active (throttled)
        if (this._learningPath) {
            this._needsRender = true;
            this._animationOnlyRender = true;
        }
    },
    
    /**
     * Render labels - SCREEN ALIGNED (don't rotate with wheel)
     */
    renderLabels: function(ctx, cx, cy, cos, sin) {
        if (this.zoom < 0.6) return;  // Show labels at lower zoom too
        if (settings.showNodeNames === false) return;

        var fontSize = settings.nodeFontSize || 10;
        ctx.font = fontSize + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        
        var labelsDrawn = 0;
        var maxLabels = 150;  // Allow more labels
        
        for (var i = 0; i < this.nodes.length && labelsDrawn < maxLabels; i++) {
            var node = this.nodes[i];
            
            // In edit mode: show ALL labels. Otherwise: only unlocked/learning/available
            var isEditActive = typeof EditMode !== 'undefined' && EditMode.isActive;
            if (!isEditActive && node.state !== 'unlocked' && node.state !== 'learning' && node.state !== 'available') continue;
            if (!node.name && !isEditActive) continue;
            if (settings.schoolVisibility && settings.schoolVisibility[node.school] === false) continue;

            // Check if name should be revealed based on XP progress
            var labelText = node.name || node.formId;
            if (!isEditActive && node.state !== 'unlocked' && settings.cheatMode !== true) {
                var _canonId = (typeof getCanonicalFormId === 'function') ? getCanonicalFormId(node) : node.formId;
                var _prog = state.spellProgress ? state.spellProgress[_canonId] : null;
                var _pct = _prog && _prog.required > 0 ? (_prog.xp / _prog.required) * 100 : 0;
                var _threshold = settings.revealName !== undefined ? settings.revealName : 10;
                if (_pct < _threshold && node.state !== 'learning') {
                    labelText = '???';
                }
            }

            // Set color based on state
            if (node.state === 'unlocked') {
                ctx.fillStyle = '#fff';
            } else if (node.state === 'learning') {
                // Learning - static cyan text
                ctx.fillStyle = this._learningPathColor || '#00ffff';
            } else if (labelText === '???') {
                // Hidden name - very dim
                ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
            } else {
                // Available/learnable - use dimmer color
                ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            }

            // Transform node position WITH rotation, but text stays screen-aligned
            var rotatedX = node.x * cos - node.y * sin;
            var rotatedY = node.x * sin + node.y * cos;

            var screenX = rotatedX * this.zoom + this.panX + cx;
            var screenY = rotatedY * this.zoom + this.panY + cy;

            // Viewport check
            if (screenX < -50 || screenX > this._width + 50 || screenY < -50 || screenY > this._height + 50) {
                continue;
            }

            // Draw text at screen position (no rotation)
            ctx.fillText(labelText.substring(0, 12), screenX, screenY + (fontSize + 4) * this.zoom);
            labelsDrawn++;
        }
    },
    
    // =========================================================================
    // COLOR UTILITIES
    // =========================================================================
    
    dimColor: function(color, factor) {
        var rgb = this.parseColor(color);
        if (!rgb) return color;
        return 'rgb(' + Math.round(rgb.r * factor) + ',' + 
                        Math.round(rgb.g * factor) + ',' + 
                        Math.round(rgb.b * factor) + ')';
    },
    
    brightenColor: function(color, factor) {
        var rgb = this.parseColor(color);
        if (!rgb) return color;
        return 'rgb(' + Math.min(255, Math.round(rgb.r + (255 - rgb.r) * (factor - 1))) + ',' + 
                        Math.min(255, Math.round(rgb.g + (255 - rgb.g) * (factor - 1))) + ',' + 
                        Math.min(255, Math.round(rgb.b + (255 - rgb.b) * (factor - 1))) + ')';
    },
    
    blendColors: function(color1, color2, t) {
        var rgb1 = this.parseColor(color1);
        var rgb2 = this.parseColor(color2);
        if (!rgb1 || !rgb2) return color1;
        return 'rgb(' + Math.round(rgb1.r + (rgb2.r - rgb1.r) * t) + ',' + 
                        Math.round(rgb1.g + (rgb2.g - rgb1.g) * t) + ',' + 
                        Math.round(rgb1.b + (rgb2.b - rgb1.b) * t) + ')';
    },
    
    getInnerAccentColor: function(color) {
        var rgb = this.parseColor(color);
        if (!rgb) return '#1a1a2e';
        return 'rgb(' + Math.round(rgb.r * 0.35) + ',' + 
                        Math.round(rgb.g * 0.3) + ',' + 
                        Math.round(rgb.b * 0.4) + ')';
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
    
    // =========================================================================
    // ROTATION
    // =========================================================================
    
    rotateToNode: function(node) {
        if (this.noRotate) return;
        if (!node || typeof node.angle === 'undefined') return;
        var targetRotation = -node.angle;
        var delta = targetRotation - this.rotation;
        while (delta > 180) delta -= 360;
        while (delta < -180) delta += 360;
        this.animateRotation(this.rotation + delta);
    },
    
    rotateSchoolToTop: function(schoolName) {
        if (this.noRotate) return;
        var schoolConfig = this.schools[schoolName];
        if (!schoolConfig || schoolConfig.spokeAngle === undefined) return;
        
        // Formula: rotate so spokeAngle ends up at visual TOP (-90 degrees)
        // targetRotation = -90 - spokeAngle
        var targetRotation = -90 - schoolConfig.spokeAngle;
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
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                self.rotation = target;
                self.isAnimating = false;
            }
        }
        
        animate();
    },
    
    // =========================================================================
    // PUBLIC API
    // =========================================================================
    
    show: function() {
        if (!this.canvas || !this.container) {
            console.error('[CanvasRenderer] Cannot show - not initialized');
            return;
        }
        
        var svg = document.getElementById('tree-svg');
        if (svg) svg.style.display = 'none';
        
        if (!this.canvas.parentNode) {
            this.container.appendChild(this.canvas);
        }
        
        // Update canvas size immediately
        this.updateCanvasSize();
        this.startRenderLoop();
        this.forceRender();
        
        // Also update after a brief delay to catch layout changes
        var self = this;
        setTimeout(function() {
            self.updateCanvasSize();
        }, 100);
        
        console.log('[CanvasRenderer] Shown with', this.nodes.length, 'nodes');
    },
    
    hide: function() {
        this.stopRenderLoop();
        
        // Clear any pending resize timeout
        if (this._resizeTimeout) {
            clearTimeout(this._resizeTimeout);
            this._resizeTimeout = null;
        }
        
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
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
        
        var zoomEl = document.getElementById('zoom-level');
        if (zoomEl) zoomEl.textContent = Math.round(this.zoom * 100) + '%';
    },
    
    setZoom: function(z) {
        this.zoom = Math.max(0.1, Math.min(5, z));
        this._needsRender = true;
        
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
        this._discoveryVisibleIds = null;
        this.selectedNode = null;
        this.hoveredNode = null;
        
        if (this.ctx && this.canvas) {
            this.ctx.setTransform(1, 0, 0, 1, 0, 0);
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
        
        this._needsRender = true;
    },
    
    /**
     * Refresh renderer when node states change (e.g., spell unlocked)
     */
    refresh: function() {
        // Rebuild discovery visibility if in discovery mode
        this._buildDiscoveryVisibility();
        this._buildLearningPaths();
        this._needsRender = true;
    },
    
    /**
     * Build persistent learning paths - tracks nodes in learning state
     * and the path from center to each learning node
     */
    _buildLearningPaths: function() {
        var log = window.debugOutput || console.log;
        log('[CANVAS] _buildLearningPaths called');
        
        // Clear any traveling particles from previous learning target
        if (typeof Globe3D !== 'undefined' && Globe3D.clearDetachedParticles) {
            Globe3D.clearDetachedParticles();
        }
        
        // Initialize sets (can't use new Set() in property definition for compatibility)
        this._learningNodeIds = new Set();
        this._learningPathNodes = new Set();
        this._learningPathSegments = [];  // Clear cached segments
        this._learningPulses = [];  // Clear active pulses
        
        if (!this.nodes || this.nodes.length === 0) {
            log('[CANVAS] No nodes available');
            return;
        }
        
        log('[CANVAS] Checking ' + this.nodes.length + ' nodes for learning state...');
        
        // Debug: log all unique states
        var statesFound = {};
        for (var s = 0; s < this.nodes.length; s++) {
            var st = this.nodes[s].state || 'undefined';
            statesFound[st] = (statesFound[st] || 0) + 1;
        }
        log('[CANVAS] Node states: ' + JSON.stringify(statesFound));
        
        // Find all nodes in learning state
        var learningFound = [];
        for (var i = 0; i < this.nodes.length; i++) {
            var node = this.nodes[i];
            var nodeState = (node.state || '').toLowerCase();
            
            // Check various possible learning state values
            if (nodeState === 'learning') {
                log('[CANVAS] FOUND learning: ' + node.name + ' (id:' + node.id + ')');
                this._learningNodeIds.add(node.id);
                learningFound.push(node.name || node.id);
                
                // Build path from this node back to root
                var pathNodes = this._getPathToRoot(node.id);
                log('[CANVAS] Path for ' + node.name + ': ' + pathNodes.length + ' nodes');
                for (var j = 0; j < pathNodes.length; j++) {
                    this._learningPathNodes.add(pathNodes[j]);
                }
            }
        }
        
        log('[CANVAS] RESULT: ' + this._learningNodeIds.size + ' learning, ' + this._learningPathNodes.size + ' path nodes');
        if (learningFound.length > 0) {
            log('[CANVAS] Learning: ' + learningFound.join(', '));
        }
    },
    
    /**
     * Get all node IDs from a node back to root (or center)
     */
    _getPathToRoot: function(nodeId) {
        var log = window.debugOutput || console.log;
        var path = [nodeId];
        var visited = new Set([nodeId]);
        var current = nodeId;
        var safety = 100;
        
        // Get the starting node to check if it's already a root
        var startNode = this._nodeMap ? this._nodeMap.get(nodeId) : null;
        if (startNode && (startNode.isRoot || startNode.tier === 1)) {
            log('[CANVAS] Node ' + (startNode.name || nodeId) + ' is root, path = [self]');
            return path;
        }
        
        while (safety-- > 0) {
            // Find prerequisite (parent) node
            var prereqId = null;
            for (var i = 0; i < this.edges.length; i++) {
                var edge = this.edges[i];
                // Try both exact match and formId match
                var formIdNode = this._nodeByFormId ? this._nodeByFormId.get(current) : null;
                var altId = formIdNode ? formIdNode.id : null;
                if ((edge.to === current || (altId && edge.to === altId)) && !visited.has(edge.from)) {
                    prereqId = edge.from;
                    break;
                }
            }
            
            if (!prereqId) break;
            
            path.push(prereqId);
            visited.add(prereqId);
            current = prereqId;
            
            // Check if we reached root
            var currentNode = this._nodeMap ? this._nodeMap.get(current) : null;
            if (currentNode && (currentNode.isRoot || currentNode.tier === 1)) {
                log('[CANVAS] Reached root: ' + (currentNode.name || current));
                break;
            }
        }
        
        log('[CANVAS] Path built: ' + path.length + ' nodes -> ' + path.join(' -> '));
        return path;
    },
    
    /**
     * Build path segments for pulse animation
     * Returns array of {from: {x,y}, to: {x,y}} segments from center to learning nodes
     */
    _buildLearningPathSegments: function() {
        this._learningPathSegments = [];
        
        if (!this._learningNodeIds || this._learningNodeIds.size === 0) return;
        if (!this._nodeMap) return;
        
        var self = this;
        
        // For each learning node, build segments from center through path
        this._learningNodeIds.forEach(function(learningId) {
            var pathNodeIds = self._getPathToRoot(learningId);
            if (pathNodeIds.length === 0) return;
            
            // Reverse so we go from root to learning node
            pathNodeIds.reverse();
            
            var segments = [];
            
            // First segment: globe center to root node
            var gd = (state.treeData && state.treeData.globe) || { x: 0, y: 0 };
            var rootNode = self._nodeMap.get(pathNodeIds[0]);
            if (rootNode) {
                segments.push({
                    from: { x: gd.x, y: gd.y },
                    to: { x: rootNode.x, y: rootNode.y }
                });
            }
            
            // Subsequent segments: node to node
            for (var i = 0; i < pathNodeIds.length - 1; i++) {
                var fromNode = self._nodeMap.get(pathNodeIds[i]);
                var toNode = self._nodeMap.get(pathNodeIds[i + 1]);
                if (fromNode && toNode) {
                    segments.push({
                        from: { x: fromNode.x, y: fromNode.y },
                        to: { x: toNode.x, y: toNode.y }
                    });
                }
            }
            
            if (segments.length > 0) {
                self._learningPathSegments.push({
                    learningNodeId: learningId,
                    segments: segments,
                    totalLength: self._calculatePathLength(segments)
                });
            }
        });
    },
    
    /**
     * Calculate total length of path segments
     */
    _calculatePathLength: function(segments) {
        var total = 0;
        for (var i = 0; i < segments.length; i++) {
            var seg = segments[i];
            var dx = seg.to.x - seg.from.x;
            var dy = seg.to.y - seg.from.y;
            total += Math.sqrt(dx * dx + dy * dy);
        }
        return total;
    },
    
    /**
     * Detach a globe particle to travel along learning paths (called on heartbeat)
     */
    _detachGlobeParticleToLearningPath: function() {
        if (typeof Globe3D === 'undefined' || !Globe3D.enabled) return;
        
        if (!this._learningPathSegments || this._learningPathSegments.length === 0) {
            this._buildLearningPathSegments();
        }
        
        if (!this._learningPathSegments || this._learningPathSegments.length === 0) return;
        
        // For each learning path, detach a globe particle with learning color
        var learningColor = this._learningPathColor || '#00ffff';
        for (var i = 0; i < this._learningPathSegments.length; i++) {
            var pathData = this._learningPathSegments[i];
            Globe3D.detachParticleToPath(pathData.segments, this._learningPulseSpeed, learningColor);
        }
    },
    
    /**
     * Update traveling pulses
     */
    _updateLearningPulses: function() {
        if (!this._learningPulses || this._learningPulses.length === 0) return;
        
        // Update each pulse
        for (var i = this._learningPulses.length - 1; i >= 0; i--) {
            var pulse = this._learningPulses[i];
            pulse.progress += pulse.speed;
            
            // Fade out near the end
            if (pulse.progress > 0.8) {
                pulse.alpha = Math.max(0, 1 - (pulse.progress - 0.8) / 0.2);
            }
            
            // Remove completed pulses
            if (pulse.progress >= 1.0) {
                this._learningPulses.splice(i, 1);
            }
        }
    },
    
    /**
     * Render traveling pulses
     */
    _renderLearningPulses: function(ctx) {
        if (!this._learningPulses || this._learningPulses.length === 0) return;
        if (!this._learningPathSegments || this._learningPathSegments.length === 0) return;
        
        var learningPathColor = this._learningPathColor || '#00ffff';
        
        for (var i = 0; i < this._learningPulses.length; i++) {
            var pulse = this._learningPulses[i];
            var pathData = this._learningPathSegments[pulse.pathIndex];
            
            if (!pathData) continue;
            
            // Find position along path
            var pos = this._getPositionAlongPath(pathData.segments, pulse.progress);
            if (!pos) continue;
            
            // Draw glowing pulse
            ctx.save();
            ctx.globalAlpha = pulse.alpha * 0.9;
            
            // Outer glow
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, pulse.size * 2, 0, Math.PI * 2);
            ctx.fillStyle = learningPathColor;
            ctx.globalAlpha = pulse.alpha * 0.3;
            ctx.fill();
            
            // Inner bright core
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, pulse.size, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.globalAlpha = pulse.alpha * 0.9;
            ctx.fill();
            
            ctx.restore();
        }
    },
    
    /**
     * Get x,y position along a path given progress (0-1)
     */
    _getPositionAlongPath: function(segments, progress) {
        if (!segments || segments.length === 0) return null;
        
        // Calculate total length
        var totalLength = 0;
        var segmentLengths = [];
        for (var i = 0; i < segments.length; i++) {
            var seg = segments[i];
            var dx = seg.to.x - seg.from.x;
            var dy = seg.to.y - seg.from.y;
            var len = Math.sqrt(dx * dx + dy * dy);
            segmentLengths.push(len);
            totalLength += len;
        }
        
        // Find position
        var targetDist = progress * totalLength;
        var distSoFar = 0;
        
        for (var i = 0; i < segments.length; i++) {
            var segLen = segmentLengths[i];
            
            if (distSoFar + segLen >= targetDist) {
                // Position is in this segment
                var segProgress = (targetDist - distSoFar) / segLen;
                var seg = segments[i];
                return {
                    x: seg.from.x + (seg.to.x - seg.from.x) * segProgress,
                    y: seg.from.y + (seg.to.y - seg.from.y) * segProgress
                };
            }
            
            distSoFar += segLen;
        }
        
        // Return end position
        var lastSeg = segments[segments.length - 1];
        return { x: lastSeg.to.x, y: lastSeg.to.y };
    }
};

// Export
window.CanvasRenderer = CanvasRenderer;
