/**
 * WheelRenderer Module - SVG Radial Tree Rendering
 * Handles all visualization of the spell tree
 *
 * Depends on:
 * - config.js (TREE_CONFIG, GRID_CONFIG)
 * - shapeProfiles.js (SHAPE_PROFILES, getShapeProfile) - unified shape definitions
 * - layoutEngine.js (LayoutEngine) - optional, for unified position calculations
 * - settings, state, SpellCache, TreeParser, GROWTH_DSL
 */

var WheelRenderer = {
    svg: null,
    wheelGroup: null,
    spokesLayer: null,
    edgesLayer: null,
    nodesLayer: null,
    debugGridLayer: null,  // Debug grid visualization layer
    showDebugGrid: false,  // Toggle for debug grid
    centerHub: null,
    nodes: [],
    edges: [],
    schools: {},
    nodeElements: new Map(),
    edgeElements: new Map(),
    rotation: 0,
    zoom: 1,
    panX: 0,
    panY: 0,
    isAnimating: false,
    isPanning: false,
    panStartX: 0,
    panStartY: 0,
    selectedNode: null,
    
    // Performance optimization state
    _edgePathCache: {},
    _viewportUpdatePending: false,
    _lastViewportUpdate: 0,
    _lodLevel: 'full',
    _visibleNodes: new Set(),
    _renderedNodes: new Set(),  // Tracks which nodes have DOM elements
    _renderedEdges: new Set(),  // Tracks which edges have DOM elements
    _layoutCalculated: false,
    _nodeMap: null,  // O(1) node lookup by ID
    _delegatedEventsSetup: false,
    _svgEventsSetup: false,  // Guard for SVG event listeners
    _virtualizeThreshold: 200,  // Use virtualization above this node count (lowered for better perf)
    _viewportPadding: 150,      // Extra padding to prevent pop-in
    _ultraLightThreshold: 800,  // Ultra-light mode for massive trees
    _rafPending: false,         // RAF throttle for pan
    _pendingPanX: 0,
    _pendingPanY: 0,
    
    // Growth recipes per school
    growthRecipes: {},
    
    // School configs from Python (shape, density, etc.)
    schoolConfigs: {},
    
    // LLM-enhanced themed groups (with colors)
    llmGroups: {},
    
    // Node-to-group mapping for color overrides
    nodeGroupMap: {},
    
    // Visual shape modifiers - FALLBACK ONLY when shapeProfiles.js not loaded
    // Prefer using getShapeProfile() from shapeProfiles.js (unified source)
    shapeVisualModifiers: {
        organic: {
            radiusJitter: 0.20,      // Noticeable radius variation
            angleJitter: 12,         // Flowing angle jitter (degrees)
            tierSpacingMult: 0.9,    // Slightly compact
            spreadMult: 0.95,        // Fill pie slice well
            fillPieSlice: true,      // Ensure nodes fill the slice
            curveEdges: true
        },
        spiky: {
            radiusJitter: 0.35,      // DRAMATIC radius changes
            angleJitter: 20,         // Sharp angular spikes
            tierSpacingMult: 1.4,    // Elongated outward
            spreadMult: 0.6,         // Narrow spikes
            fillPieSlice: false,     // Let spikes poke out
            curveEdges: false
        },
        radial: {
            radiusJitter: 0.08,      // Very uniform
            angleJitter: 3,          // Evenly spread
            tierSpacingMult: 0.85,   // Compact tiers
            spreadMult: 1.0,         // Full pie usage
            fillPieSlice: true,
            curveEdges: true
        },
        mountain: {
            radiusJitter: 0.20,
            angleJitter: 15,         // More scatter to fill space
            tierSpacingMult: 0.6,    // Very compressed tiers = nodes packed vertically
            spreadMult: 1.0,         // Use full pie width
            fillPieSlice: true,
            curveEdges: true,
            taperSpread: true,       // Narrows toward tips
            taperAmount: 0.4,        // How much to narrow (0.4 = 40% width at peak)
            fillTriangle: true       // Special flag: distribute nodes to fill triangular area
        },
        cloud: {
            radiusJitter: 0.30,      // Clustered groupings
            angleJitter: 18,         // Irregular
            tierSpacingMult: 1.0,
            spreadMult: 0.85,
            fillPieSlice: true,
            curveEdges: true,
            clusterNodes: true
        },
        cascade: {
            radiusJitter: 0.06,
            angleJitter: 4,
            tierSpacingMult: 1.3,    // Clear tier separation
            spreadMult: 1.0,
            fillPieSlice: true,
            curveEdges: false
        },
        linear: {
            radiusJitter: 0.05,
            angleJitter: 2,
            tierSpacingMult: 1.1,
            spreadMult: 0.5,         // Narrow focused beam
            fillPieSlice: false,     // Intentionally narrow
            curveEdges: true
        },
        grid: {
            radiusJitter: 0.0,       // Perfect grid
            angleJitter: 0,
            tierSpacingMult: 0.95,
            spreadMult: 1.0,
            fillPieSlice: true,
            curveEdges: false
        }
    },
    
    // Toggle for strict pie slice containment
    strictPieSlices: true,

    init: function(svgElement) {
        this.svg = svgElement;
        this.wheelGroup = svgElement.querySelector('#wheel-group');
        this.spokesLayer = svgElement.querySelector('#spokes-layer');
        this.edgesLayer = svgElement.querySelector('#edges-layer');
        this.nodesLayer = svgElement.querySelector('#nodes-layer');
        this.centerHub = svgElement.querySelector('#center-hub');
        this._edgePathCache = {};
        
        // Create debug grid layer (behind edges)
        this.debugGridLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.debugGridLayer.setAttribute('id', 'debug-grid-layer');
        this.debugGridLayer.style.display = 'none';
        if (this.edgesLayer && this.edgesLayer.parentNode) {
            this.edgesLayer.parentNode.insertBefore(this.debugGridLayer, this.edgesLayer);
        }
        
        this.setupEvents();
    },
    
    // Toggle debug grid visibility
    toggleDebugGrid: function() {
        this.showDebugGrid = !this.showDebugGrid;
        if (this.debugGridLayer) {
            this.debugGridLayer.style.display = this.showDebugGrid ? 'block' : 'none';
        }
        console.log('[WheelRenderer] Debug grid:', this.showDebugGrid ? 'ON' : 'OFF');
        if (this.showDebugGrid) {
            this.renderDebugGrid();
        }
        return this.showDebugGrid;
    },
    
    // Render debug grid showing all candidate positions
    renderDebugGrid: function() {
        if (!this.debugGridLayer) return;
        
        // Clear existing
        while (this.debugGridLayer.firstChild) {
            this.debugGridLayer.removeChild(this.debugGridLayer.firstChild);
        }
        
        // Get layout config - Use unified source from config.js
        var gridCfg = GRID_CONFIG.getComputedConfig();
        var nodeSize = gridCfg.nodeSize;
        var baseRadius = gridCfg.baseRadius;
        var tierSpacing = gridCfg.tierSpacing;
        var arcSpacing = gridCfg.arcSpacing;
        var maxTiers = gridCfg.maxTiers;
        
        // Get school slices (match wheelRenderer sector calculation with padding)
        var numSchools = 5;
        var schoolPadding = TREE_CONFIG.wheel.schoolPadding || 5;
        var totalPadding = numSchools * schoolPadding;
        var availableAngle = 360 - totalPadding;
        var sliceAngle = availableAngle / numSchools;

        var colors = ['#ff6666', '#66ff66', '#6666ff', '#ffff66', '#ff66ff'];

        console.log('[DebugGrid] Rendering with tierSpacing=' + tierSpacing + ', arcSpacing=' + arcSpacing);

        for (var schoolIdx = 0; schoolIdx < numSchools; schoolIdx++) {
            var startAngle = schoolIdx * (sliceAngle + schoolPadding) - 90;
            var endAngle = startAngle + sliceAngle;
            var color = colors[schoolIdx];
            
            // Draw sector boundary lines
            var startRad = startAngle * Math.PI / 180;
            var endRad = endAngle * Math.PI / 180;
            var outerRadius = baseRadius + maxTiers * tierSpacing;
            
            // Start boundary
            var line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line1.setAttribute('x1', 0);
            line1.setAttribute('y1', 0);
            line1.setAttribute('x2', Math.cos(startRad) * outerRadius);
            line1.setAttribute('y2', Math.sin(startRad) * outerRadius);
            line1.setAttribute('stroke', color);
            line1.setAttribute('stroke-width', '1');
            line1.setAttribute('stroke-opacity', '0.3');
            this.debugGridLayer.appendChild(line1);

            // End boundary
            var line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line2.setAttribute('x1', 0);
            line2.setAttribute('y1', 0);
            line2.setAttribute('x2', Math.cos(endRad) * outerRadius);
            line2.setAttribute('y2', Math.sin(endRad) * outerRadius);
            line2.setAttribute('stroke', color);
            line2.setAttribute('stroke-width', '1');
            line2.setAttribute('stroke-opacity', '0.3');
            this.debugGridLayer.appendChild(line2);
            
            // Draw grid points for this school
            for (var tier = 0; tier < maxTiers; tier++) {
                var radius = baseRadius + tier * tierSpacing;
                
                // Calculate arc length and candidate count
                var arcLength = (sliceAngle / 360) * 2 * Math.PI * radius;
                var candidateCount = Math.max(3, Math.floor(arcLength / arcSpacing));
                
                // Draw tier arc
                var arc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                var arcStartX = Math.cos(startRad) * radius;
                var arcStartY = Math.sin(startRad) * radius;
                var arcEndX = Math.cos(endRad) * radius;
                var arcEndY = Math.sin(endRad) * radius;
                var largeArc = sliceAngle > 180 ? 1 : 0;
                arc.setAttribute('d', 'M ' + arcStartX + ' ' + arcStartY + 
                                     ' A ' + radius + ' ' + radius + ' 0 ' + largeArc + ' 1 ' + 
                                     arcEndX + ' ' + arcEndY);
                arc.setAttribute('stroke', color);
                arc.setAttribute('stroke-width', '0.5');
                arc.setAttribute('stroke-opacity', '0.2');
                arc.setAttribute('fill', 'none');
                this.debugGridLayer.appendChild(arc);
                
                // Draw candidate positions as small circles
                var usableAngle = sliceAngle * 0.85;  // Match layoutGenerator
                var angleStep = candidateCount > 1 ? usableAngle / (candidateCount - 1) : 0;
                var centerAngle = startAngle + sliceAngle / 2;
                var halfSpread = usableAngle / 2;
                
                for (var i = 0; i < candidateCount; i++) {
                    var angle = candidateCount === 1 
                        ? centerAngle 
                        : (centerAngle - halfSpread + i * angleStep);
                    var rad = angle * Math.PI / 180;
                    var x = Math.cos(rad) * radius;
                    var y = Math.sin(rad) * radius;
                    
                    var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    dot.setAttribute('cx', x);
                    dot.setAttribute('cy', y);
                    dot.setAttribute('r', 4);
                    dot.setAttribute('fill', color);
                    dot.setAttribute('fill-opacity', '0.5');
                    this.debugGridLayer.appendChild(dot);
                }
            }
        }
        
        console.log('[DebugGrid] Rendered grid points');
    },
    
    // Store school configs from Python for visual rendering
    setSchoolConfigs: function(configs) {
        this.schoolConfigs = configs || {};
        console.log('[WheelRenderer] School configs loaded:', Object.keys(this.schoolConfigs));
        for (var school in this.schoolConfigs) {
            var cfg = this.schoolConfigs[school];
            console.log('[WheelRenderer]   ' + school + ': shape=' + cfg.shape + 
                ', density=' + (cfg.density || 0.6).toFixed(2));
        }
    },
    
    // Store LLM-enhanced groups for color overrides
    setLLMGroups: function(groups) {
        this.llmGroups = groups || {};
        this.nodeGroupMap = {}; // Will be populated during node processing
        console.log('[WheelRenderer] LLM groups loaded:', Object.keys(this.llmGroups));
        for (var groupKey in this.llmGroups) {
            var grp = this.llmGroups[groupKey];
            console.log('[WheelRenderer]   ' + groupKey + ': name="' + (grp.group_name || grp.original_theme) + 
                '", color=' + (grp.group_color || '#888') + ', style=' + (grp.growth_style || 'default'));
        }
    },
    
    // Get visual modifier for a school based on its shape config
    // Uses unified SHAPE_PROFILES from shapeProfiles.js when available
    getSchoolVisualModifier: function(schoolName) {
        var cfg = this.schoolConfigs[schoolName];
        var shape = cfg ? cfg.shape : 'organic';

        // Use unified shapeProfiles.js module when available (preferred)
        var modifier;
        if (typeof getShapeProfile === 'function') {
            modifier = getShapeProfile(shape);
        } else {
            // Fallback to inline definitions (backwards compatibility)
            modifier = this.shapeVisualModifiers[shape] || this.shapeVisualModifiers.organic;
        }
        
        // Get config values with defaults
        var density = cfg ? (cfg.density || 0.6) : 0.6;
        var symmetry = cfg ? (cfg.symmetry || 0.3) : 0.3;
        var convergence = cfg ? (cfg.convergence_chance || 0.4) : 0.4;
        
        // DRAMATIC scaling based on density and symmetry
        // Low density = more jitter/spread, High density = compact/uniform
        var densityFactor = 1.5 - density;  // 0.3 density -> 1.2x jitter, 0.9 density -> 0.6x jitter
        var symmetryFactor = 1 - symmetry * 0.8;  // High symmetry = less randomness
        
        return {
            // Jitter scales inversely with density (sparse = more random)
            radiusJitter: modifier.radiusJitter * densityFactor * symmetryFactor,
            angleJitter: modifier.angleJitter * densityFactor * symmetryFactor,
            
            // Tier spacing: low density = spread out, high density = compact
            tierSpacingMult: modifier.tierSpacingMult * (0.6 + density * 0.8),
            
            // Spread: fill pie slice based on density (low = narrow, high = wide)
            spreadMult: modifier.spreadMult * (0.5 + density * 0.7),
            
            // Pass through shape-specific flags
            curveEdges: modifier.curveEdges,
            taperSpread: modifier.taperSpread || false,
            clusterNodes: modifier.clusterNodes || false,
            fillPieSlice: modifier.fillPieSlice !== false,
            fillTriangle: modifier.fillTriangle || false,
            taperAmount: modifier.taperAmount || 0.4,
            
            // Config values for reference
            symmetry: symmetry,
            density: density,
            convergence: convergence,
            shape: shape
        };
    },
    
    // Get full group settings for a node (if it belongs to an LLM-enhanced group)
    getNodeGroup: function(node) {
        if (!node || !node.school) return null;
        
        var nodeName = (node.name || '').toLowerCase();
        var nodeTheme = (node.theme || '').toLowerCase();
        
        for (var groupKey in this.llmGroups) {
            var grp = this.llmGroups[groupKey];
            if (grp.school !== node.school) continue;
            
            var theme = (grp.original_theme || '').toLowerCase();
            if (theme && (nodeName.indexOf(theme) >= 0 || nodeTheme.indexOf(theme) >= 0)) {
                return grp;
            }
        }
        return null;
    },
    
    // Get group color for a node (if it belongs to an LLM-enhanced group)
    getNodeGroupColor: function(node) {
        var grp = this.getNodeGroup(node);
        return grp ? (grp.group_color || null) : null;
    },
    
    // Apply group visual modifiers to a node's position
    applyGroupModifiers: function(node, baseRadius, baseAngle, spokeAngle) {
        var grp = this.getNodeGroup(node);
        if (!grp) return { radius: baseRadius, angle: baseAngle };
        
        var radius = baseRadius;
        var angle = baseAngle;
        
        // Apply radius offset from group
        if (grp.radius_offset) {
            radius += grp.radius_offset;
        }
        
        // Apply angle spread from group
        if (grp.angle_spread && grp.angle_spread !== 1.0) {
            var angleFromSpoke = baseAngle - spokeAngle;
            angle = spokeAngle + (angleFromSpoke * grp.angle_spread);
        }
        
        return { radius: radius, angle: angle };
    },
    
    getLOD: function() {
        if (this.zoom > 0.8) return 'full';
        if (this.zoom > 0.4) return 'simple';
        return 'minimal';
    },
    
    getViewportBounds: function() {
        if (!this.svg) return null;
        var rect = this.svg.getBoundingClientRect();
        var invZoom = 1 / this.zoom;
        var halfW = (rect.width / 2) * invZoom;
        var halfH = (rect.height / 2) * invZoom;
        var worldCenterX = -this.panX * invZoom;
        var worldCenterY = -this.panY * invZoom;
        
        // Scale padding with inverse zoom for consistent coverage
        // Tighter viewport for ultra-light mode
        var basePadding = this._lodLevel === 'ultralight' ? 50 : this._viewportPadding;
        var padding = basePadding * invZoom;
        
        return {
            left: worldCenterX - halfW,
            right: worldCenterX + halfW,
            top: worldCenterY - halfH,
            bottom: worldCenterY + halfH,
            paddedLeft: worldCenterX - halfW - padding,
            paddedRight: worldCenterX + halfW + padding,
            paddedTop: worldCenterY - halfH - padding,
            paddedBottom: worldCenterY + halfH + padding
        };
    },
    
    isNodeInViewport: function(node, bounds) {
        if (!bounds) return true;
        return node.x >= bounds.paddedLeft && 
               node.x <= bounds.paddedRight &&
               node.y >= bounds.paddedTop && 
               node.y <= bounds.paddedBottom;
    },

    setupEvents: function() {
        var self = this;
        
        // Guard against duplicate event listeners (memory leak prevention)
        if (this._svgEventsSetup) {
            return;
        }
        this._svgEventsSetup = true;
        
        this.svg.addEventListener('contextmenu', function(e) { e.preventDefault(); });
        this.svg.addEventListener('mousedown', function(e) { self.onMouseDown(e); });
        this.svg.addEventListener('mousemove', function(e) { self.onMouseMove(e); });
        this.svg.addEventListener('mouseup', function(e) { self.onMouseUp(e); });
        this.svg.addEventListener('mouseleave', function(e) { self.onMouseUp(e); });
        this.svg.addEventListener('wheel', function(e) { self.onWheel(e); }, { passive: false });
        
        // Event delegation for nodes (instead of per-node listeners)
        if (!this._delegatedEventsSetup) {
            this._delegatedEventsSetup = true;
            
            this.nodesLayer.addEventListener('click', function(e) {
                var nodeEl = e.target.closest('.spell-node, .mystery-node');
                if (nodeEl) {
                    e.stopPropagation();
                    var nodeId = nodeEl.getAttribute('data-id');
                    var node = self._nodeMap ? self._nodeMap.get(nodeId) : null;
                    if (node) self.onNodeClick(node);
                }
            });
            
            this.nodesLayer.addEventListener('mouseenter', function(e) {
                var nodeEl = e.target.closest('.spell-node, .mystery-node');
                if (nodeEl) {
                    var nodeId = nodeEl.getAttribute('data-id');
                    var node = self._nodeMap ? self._nodeMap.get(nodeId) : null;
                    if (node) self.showTooltip(node, e);
                }
            }, true);
            
            this.nodesLayer.addEventListener('mouseleave', function(e) {
                var nodeEl = e.target.closest('.spell-node, .mystery-node');
                if (nodeEl) {
                    self.hideTooltip();
                }
            }, true);
        }
    },

    setData: function(nodes, edges, schools) {
        this.nodes = nodes;
        this.edges = edges;
        this.schools = schools;
        
        // Build O(1) lookup maps for nodes
        this._nodeMap = new Map();
        this._nodeByFormId = new Map();
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            this._nodeMap.set(node.id, node);
            if (node.formId) {
                this._nodeByFormId.set(node.formId, node);
            }
        }
        
        this._edgePathCache = {};
        this._layoutCalculated = false;
        this._visibleNodes.clear();
        
        if (typeof detectAllSchools === 'function') {
            detectAllSchools(nodes);
        }
        if (typeof updateSchoolColorPickerUI === 'function') {
            updateSchoolColorPickerUI();
        }
        
        this.layout();
        
        this.render();
        this.centerView();
    },
    
    // Layout function - recalculates positions for all visible nodes
    layout: function() {
        // Clear layout data for hidden schools
        var self = this;
        Object.keys(this.schools).forEach(function(schoolName) {
            if (settings.schoolVisibility && settings.schoolVisibility[schoolName] === false) {
                // Mark as hidden - clear layout data
                self.schools[schoolName].spokeAngle = undefined;
                self.schools[schoolName].startAngle = undefined;
                self.schools[schoolName].endAngle = undefined;
            }
        });
        
        this._edgePathCache = {};
        this._layoutCalculated = false;
        
        this.layoutRadial();
        
        // DISABLED: Dynamic shrink causes visual inconsistency
        // this.calculateOverlapShrink();
        
        this._layoutCalculated = true;
        
        // Update render positions
        this.nodes.forEach(function(node) {
            node._renderX = node.x;
            node._renderY = node.y;
        });
    },

    layoutRadial: function() {
        var cfg = TREE_CONFIG.wheel;
        var schoolNames = Object.keys(this.schools);
        var self = this;
        
        // Check if nodes have pre-computed positions from any builder
        var nodesWithPos = this.nodes.filter(function(n) {
            return n._visualFirstX !== undefined ||
                   n._fromVisualFirst ||
                   n._fromLayoutEngine ||
                   (n.x !== undefined && n.y !== undefined && (n.x !== 0 || n.y !== 0));
        });
        var hasPrecomputedPositions = nodesWithPos.length > 0;

        console.log('[WheelRenderer] layoutAllSchools: ' + this.nodes.length + ' total nodes');
        console.log('[WheelRenderer] Nodes with pre-computed positions: ' + nodesWithPos.length);
        if (this.nodes.length > 0) {
            var sample = this.nodes[0];
            console.log('[WheelRenderer] Sample node: x=' + sample.x + ', y=' + sample.y +
                        ', _fromVisualFirst=' + sample._fromVisualFirst +
                        ', _fromLayoutEngine=' + sample._fromLayoutEngine);
        }

        if (hasPrecomputedPositions) {
            console.log('[WheelRenderer] Using pre-computed positions');
            // Just calculate school sectors for spokes/dividers, don't move nodes
            this.layoutSectorsOnly();
            return;
        }
        
        console.log('[WheelRenderer] No pre-computed positions, using standard layout');
        
        // Filter to only visible schools (visibility off = school not in tree at all)
        var visibleSchools = schoolNames.filter(function(name) {
            return !settings.schoolVisibility || settings.schoolVisibility[name] !== false;
        });
        var numSchools = visibleSchools.length;
        
        if (numSchools === 0) return;

        var totalPadding = numSchools * cfg.schoolPadding;
        var availableAngle = 360 - totalPadding;
        var anglePerSchool = availableAngle / numSchools;

        var currentAngle = -90;
        
        // Layout only visible schools - hidden schools are completely excluded
        visibleSchools.forEach(function(schoolName, i) {
            var school = self.schools[schoolName];
            var spokeAngle = currentAngle + anglePerSchool / 2;
            
            school.startAngle = currentAngle;
            school.endAngle = currentAngle + anglePerSchool;
            school.spokeAngle = spokeAngle;
            
            self.layoutSchoolNodes(schoolName, school, spokeAngle, anglePerSchool);
            
            currentAngle += anglePerSchool + cfg.schoolPadding;
        });
    },
    
    // Layout sectors only (for visual-first mode where node positions are pre-computed)
    layoutSectorsOnly: function() {
        var cfg = TREE_CONFIG.wheel;
        var self = this;
        var schoolNames = Object.keys(this.schools);
        
        var visibleSchools = schoolNames.filter(function(name) {
            return !settings.schoolVisibility || settings.schoolVisibility[name] !== false;
        });
        var numSchools = visibleSchools.length;
        
        if (numSchools === 0) return;
        
        // Try to use pre-computed sliceInfo from layoutGenerator
        var hasSliceInfo = visibleSchools.some(function(name) {
            return self.schools[name].sliceInfo;
        });
        
        if (hasSliceInfo) {
            // USE PRE-COMPUTED SLICE INFO (exact match with layoutGenerator)
            console.log('[WheelRenderer] Using pre-computed sliceInfo from layoutGenerator');
            
            visibleSchools.forEach(function(schoolName) {
                var school = self.schools[schoolName];
                var sliceInfo = school.sliceInfo;
                
                if (sliceInfo) {
                    school.startAngle = sliceInfo.startAngle;
                    school.endAngle = sliceInfo.endAngle;
                    school.spokeAngle = sliceInfo.spokeAngle;
                } else {
                    console.warn('[WheelRenderer] Missing sliceInfo for', schoolName);
                }
                
                // Calculate max radius from pre-computed positions
                var schoolNodes = self.nodes.filter(function(n) { return n.school === schoolName; });
                school.maxRadius = 0;
                school.maxDepth = 0;
                schoolNodes.forEach(function(n) {
                    var r = n.radius || Math.sqrt(n.x * n.x + n.y * n.y);
                    if (r > school.maxRadius) school.maxRadius = r;
                    if (n.depth > school.maxDepth) school.maxDepth = n.depth;
                });
            });
        } else {
            // FALLBACK: Use equal sectors matching layoutEngine's grid system
            console.log('[WheelRenderer] No sliceInfo, using equal sectors (matching layoutEngine grid)');

            var totalPadding = numSchools * cfg.schoolPadding;
            var availableAngle = 360 - totalPadding;
            var anglePerSchool = availableAngle / numSchools;
            var currentAngle = -90;  // Start at top

            visibleSchools.forEach(function(schoolName) {
                var school = self.schools[schoolName];

                school.startAngle = currentAngle;
                school.endAngle = currentAngle + anglePerSchool;
                school.spokeAngle = currentAngle + anglePerSchool / 2;

                // Calculate max radius from pre-computed positions
                var schoolNodes = self.nodes.filter(function(n) { return n.school === schoolName; });
                school.maxRadius = 0;
                school.maxDepth = 0;
                schoolNodes.forEach(function(n) {
                    var r = n.radius || Math.sqrt(n.x * n.x + n.y * n.y);
                    if (r > school.maxRadius) school.maxRadius = r;
                    if (n.depth > school.maxDepth) school.maxDepth = n.depth;
                });

                currentAngle += anglePerSchool + cfg.schoolPadding;
            });
        }
    },

    layoutSchoolNodes: function(schoolName, school, spokeAngle, sectorAngle) {
        var cfg = TREE_CONFIG.wheel;
        var self = this;
        var schoolNodes = this.nodes.filter(function(n) { return n.school === schoolName; });
        
        // Get visual modifier for this school's shape
        var visMod = this.getSchoolVisualModifier(schoolName);
        
        var depthGroups = {};
        schoolNodes.forEach(function(n) {
            if (!depthGroups[n.depth]) depthGroups[n.depth] = [];
            depthGroups[n.depth].push(n);
        });

        var nodeArcLength = cfg.nodeWidth + cfg.minArcSpacing;
        var maxSectorUsage = 0.95;
        // Apply spread multiplier from shape
        var effectiveSectorAngle = sectorAngle * visMod.spreadMult;
        var maxSectorRad = (effectiveSectorAngle * maxSectorUsage) * Math.PI / 180;
        
        var tierRadii = [];
        // Apply tier spacing multiplier from shape
        var effectiveTierSpacing = cfg.tierSpacing * visMod.tierSpacingMult;
        var cumulativeRadius = cfg.baseRadius;
        
        for (var d = 0; d <= school.maxDepth; d++) {
            var tier = depthGroups[d] || [];
            var nodeCount = tier.length;
            
            if (nodeCount <= 1) {
                tierRadii[d] = cumulativeRadius;
                cumulativeRadius += effectiveTierSpacing;
            } else {
                var paddingMultiplier = 1 + (nodeCount > 5 ? 0.15 : 0);
                var totalArcNeeded = nodeCount * nodeArcLength * paddingMultiplier;
                var minRadiusForSpread = totalArcNeeded / maxSectorRad;
                var actualRadius = Math.max(cumulativeRadius, minRadiusForSpread);
                tierRadii[d] = actualRadius;
                cumulativeRadius = actualRadius + effectiveTierSpacing;
            }
        }
        
        for (var d = 1; d <= school.maxDepth; d++) {
            var minRequired = tierRadii[d - 1] + cfg.tierSpacing;
            if (tierRadii[d] < minRequired) {
                tierRadii[d] = minRequired;
            }
        }
        
        school.maxRadius = tierRadii[school.maxDepth] || cumulativeRadius;

        // Seeded random for consistent jitter (based on school name hash)
        var seedHash = 0;
        for (var i = 0; i < schoolName.length; i++) {
            seedHash = ((seedHash << 5) - seedHash) + schoolName.charCodeAt(i);
            seedHash |= 0;
        }
        var seededRandom = function() {
            seedHash = (seedHash * 9301 + 49297) % 233280;
            return seedHash / 233280;
        };
        
        // Multi-root detection: find all root nodes at depth 0
        var multiRoot = false;
        var nodeOwner = {};
        var rootAngles = {};
        var depth0Roots = (depthGroups[0] || []).filter(function(n) { return n.isRoot; });
        if (depth0Roots.length <= 1) {
            // Check if there are multiple depth-0 nodes that should be roots
            depth0Roots = depthGroups[0] || [];
        }
        if (depth0Roots.length > 1) {
            multiRoot = true;
            // BFS from each root to determine subtree ownership
            depth0Roots.forEach(function(root) {
                var rootId = root.id || root.formId;
                nodeOwner[rootId] = rootId;
                var bfsQueue = [root];
                while (bfsQueue.length) {
                    var cur = bfsQueue.shift();
                    (cur.children || []).forEach(function(cid) {
                        if (!nodeOwner[cid]) {
                            nodeOwner[cid] = rootId;
                            var child = schoolNodes.find(function(c) { return (c.id || c.formId) === cid; });
                            if (child) bfsQueue.push(child);
                        }
                    });
                }
            });
            // Assign orphan nodes to the first root
            var firstRootId = depth0Roots[0].id || depth0Roots[0].formId;
            schoolNodes.forEach(function(n) {
                var nid = n.id || n.formId;
                if (!nodeOwner[nid]) nodeOwner[nid] = firstRootId;
            });
        }

        for (var d = 0; d <= school.maxDepth; d++) {
            var tier = depthGroups[d] || [];
            var radius = tierRadii[d];

            // Apply taper for mountain shape (spread narrows at higher tiers)
            var taperFactor = 1.0;
            if (visMod.taperSpread && school.maxDepth > 0) {
                taperFactor = 1.0 - (d / school.maxDepth) * 0.5;
            }

            if (d === 0) {
                tier.forEach(function(node, j) {
                    var angleOffset = 0;
                    if (tier.length > 1) {
                        // Multi-root: spread roots across 70% of sector for clear visual separation
                        var rootSpread = multiRoot ? effectiveSectorAngle * 0.7 : Math.min(effectiveSectorAngle * 0.3, 30);
                        angleOffset = (j - (tier.length - 1) / 2) * (rootSpread / Math.max(tier.length - 1, 1));
                    }

                    var nodeAngle = spokeAngle + angleOffset;
                    node.angle = nodeAngle;
                    node.radius = cfg.baseRadius;
                    node.spokeAngle = spokeAngle;
                    node.isRoot = true;
                    // Record root angle for sub-sector positioning of children
                    if (multiRoot) rootAngles[node.id || node.formId] = nodeAngle;

                    var rad = nodeAngle * Math.PI / 180;
                    node.x = Math.cos(rad) * cfg.baseRadius;
                    node.y = Math.sin(rad) * cfg.baseRadius;
                });
            } else {
                var halfSector = sectorAngle / 2;

                // Calculate spread based on shape and tier depth
                var spreadAngle;
                var fillTriangle = visMod.fillTriangle || false;

                if (fillTriangle) {
                    var taperAmount = visMod.taperAmount || 0.4;
                    var depthRatio = d / Math.max(school.maxDepth, 1);
                    var fillSpread = 1.0 - (depthRatio * (1.0 - taperAmount));
                    spreadAngle = sectorAngle * maxSectorUsage * fillSpread;
                } else {
                    var availableArcLength = radius * maxSectorRad * taperFactor;
                    var neededArcLength = tier.length * nodeArcLength;

                    if (tier.length === 1) {
                        spreadAngle = 0;
                    } else if (neededArcLength >= availableArcLength) {
                        spreadAngle = effectiveSectorAngle * maxSectorUsage * taperFactor;
                    } else {
                        var minSpreadPercent = Math.min(0.6 + (tier.length * 0.05), maxSectorUsage);
                        var calculatedSpread = (neededArcLength / availableArcLength) * effectiveSectorAngle;
                        spreadAngle = Math.max(calculatedSpread, effectiveSectorAngle * minSpreadPercent);
                        spreadAngle = Math.min(spreadAngle, effectiveSectorAngle * maxSectorUsage * taperFactor);
                    }
                }

                // Multi-root: position nodes in sub-sectors around their owning root
                if (multiRoot && Object.keys(rootAngles).length > 1) {
                    // Group tier nodes by their owning root
                    var groups = {};
                    tier.forEach(function(n) {
                        var nid = n.id || n.formId;
                        var ownerId = nodeOwner[nid] || firstRootId;
                        if (!groups[ownerId]) groups[ownerId] = [];
                        groups[ownerId].push(n);
                    });

                    var rootIds = Object.keys(groups);
                    rootIds.sort(function(a, b) { return (rootAngles[a] || 0) - (rootAngles[b] || 0); });

                    var totalInTier = tier.length;

                    rootIds.forEach(function(rId) {
                        var group = groups[rId];
                        var centerAngle = rootAngles[rId] || spokeAngle;
                        // Each group gets a proportional share of the spread
                        var groupShare = group.length / Math.max(totalInTier, 1);
                        var groupSpread = spreadAngle * groupShare * 0.85;

                        group.forEach(function(node, j) {
                            var angleOffset = 0;
                            if (group.length > 1) {
                                angleOffset = (j - (group.length - 1) / 2) * (groupSpread / Math.max(group.length - 1, 1));
                            }

                            var symmetryDamper = visMod.symmetry;
                            var angleJitter = visMod.angleJitter * (1 - symmetryDamper * 0.8) * (seededRandom() - 0.5) * 2;
                            var radiusJitter = visMod.radiusJitter * (1 - symmetryDamper * 0.7) * radius * (seededRandom() - 0.5) * 2;

                            var nodeAngle = centerAngle + angleOffset + angleJitter;
                            var nodeRadius = radius + radiusJitter;

                            var groupMod = self.applyGroupModifiers(node, nodeRadius, nodeAngle, centerAngle);
                            nodeAngle = groupMod.angle;
                            nodeRadius = groupMod.radius;

                            // Clamp to overall sector boundaries
                            var minAngle = spokeAngle - halfSector * 0.95;
                            var maxAngle = spokeAngle + halfSector * 0.95;
                            nodeAngle = Math.max(minAngle, Math.min(maxAngle, nodeAngle));

                            node.angle = nodeAngle;
                            node.radius = nodeRadius;
                            node.spokeAngle = centerAngle;

                            var rad = nodeAngle * Math.PI / 180;
                            node.x = Math.cos(rad) * nodeRadius;
                            node.y = Math.sin(rad) * nodeRadius;
                        });
                    });
                } else {
                    // Single-root: standard tier-wide positioning
                    tier.forEach(function(node, j) {
                        var angleOffset = 0;
                        if (tier.length > 1) {
                            angleOffset = (j - (tier.length - 1) / 2) * (spreadAngle / (tier.length - 1));
                        } else if (fillTriangle) {
                            angleOffset = (seededRandom() - 0.5) * spreadAngle * 0.5;
                        }

                        var symmetryDamper = visMod.symmetry;
                        var angleJitter = visMod.angleJitter * (1 - symmetryDamper * 0.8) * (seededRandom() - 0.5) * 2;
                        var radiusJitter = visMod.radiusJitter * (1 - symmetryDamper * 0.7) * radius * (seededRandom() - 0.5) * 2;

                        var nodeAngle = spokeAngle + angleOffset + angleJitter;
                        var nodeRadius = radius + radiusJitter;

                        var groupMod = self.applyGroupModifiers(node, nodeRadius, nodeAngle, spokeAngle);
                        nodeAngle = groupMod.angle;
                        nodeRadius = groupMod.radius;

                        if (settings.strictPieSlices) {
                            var minAngle = spokeAngle - halfSector * 0.95;
                            var maxAngle = spokeAngle + halfSector * 0.95;
                            nodeAngle = Math.max(minAngle, Math.min(maxAngle, nodeAngle));
                        }

                        node.angle = nodeAngle;
                        node.radius = nodeRadius;
                        node.spokeAngle = spokeAngle;

                        var rad = nodeAngle * Math.PI / 180;
                        node.x = Math.cos(rad) * nodeRadius;
                        node.y = Math.sin(rad) * nodeRadius;
                    });
                }
            }
        }
        
        this.resolveCollisions(schoolNodes, spokeAngle, settings.strictPieSlices ? sectorAngle * 0.95 : effectiveSectorAngle * maxSectorUsage);
        
        // Apply Growth DSL branching rules for layout optimization
        this.applyBranchingRulesToSchool(schoolName, schoolNodes, spokeAngle, effectiveSectorAngle);
        
        // Apply Growth DSL modifiers if a recipe exists for this school
        this.applyModifiersToSchool(schoolName, schoolNodes, spokeAngle);
        this.applyConstraintsToSchool(schoolName, schoolNodes, spokeAngle, effectiveSectorAngle);
        
        // FILL GAPS: Pull nodes inward to fill empty middle areas
        this.fillGaps(schoolNodes, spokeAngle, sectorAngle, cfg, school.maxDepth);
        
        // Re-resolve collisions after modifiers
        this.resolveCollisions(schoolNodes, spokeAngle, sectorAngle * maxSectorUsage);
    },
    
    // Fill empty gaps by pulling outer nodes inward AND scattering some toward root
    fillGaps: function(nodes, spokeAngle, sectorAngle, cfg, maxDepth) {
        if (nodes.length < 5) return;  // Too few nodes to worry about gaps
        
        var self = this;
        
        // Calculate radius statistics
        var avgRadius = 0;
        var minRadius = Infinity;
        var maxRadius = 0;
        
        nodes.forEach(function(n) {
            avgRadius += n.radius;
            minRadius = Math.min(minRadius, n.radius);
            maxRadius = Math.max(maxRadius, n.radius);
        });
        avgRadius /= nodes.length;
        
        // Find root nodes
        var rootNodes = nodes.filter(function(n) { return n.isRoot || n.depth === 0; });
        var nonRootNodes = nodes.filter(function(n) { return !n.isRoot && n.depth > 0; });
        
        // STEP 1: Scatter some early-tier nodes closer to root
        // The area between center (0) and baseRadius is often empty
        var earlyTierNodes = nonRootNodes.filter(function(n) { 
            return (n.depth <= 2) && !n._gapFilled; 
        });
        
        if (earlyTierNodes.length > 2) {
            // Pull 15-25% of early tier nodes closer to root
            var scatterCount = Math.max(2, Math.floor(earlyTierNodes.length * 0.2));
            
            // Shuffle early tier nodes
            for (var i = earlyTierNodes.length - 1; i > 0; i--) {
                var j = Math.floor(Math.random() * (i + 1));
                var temp = earlyTierNodes[i];
                earlyTierNodes[i] = earlyTierNodes[j];
                earlyTierNodes[j] = temp;
            }
            
            var halfSector = sectorAngle / 2;
            for (var i = 0; i < scatterCount && i < earlyTierNodes.length; i++) {
                var node = earlyTierNodes[i];
                
                // Pull closer to root - between baseRadius * 0.4 and baseRadius * 0.8
                var pullTarget = cfg.baseRadius * (0.4 + Math.random() * 0.4);
                var newRadius = Math.min(node.radius, pullTarget + Math.random() * cfg.tierSpacing * 0.3);
                
                // Add angular scatter within sector
                var angleJitter = (Math.random() - 0.5) * sectorAngle * 0.6;
                var newAngle = spokeAngle + angleJitter;
                
                // Clamp to sector
                newAngle = Math.max(spokeAngle - halfSector * 0.85, Math.min(spokeAngle + halfSector * 0.85, newAngle));
                
                node.radius = newRadius;
                node.angle = newAngle;
                node._gapFilled = true;
                
                var rad = newAngle * Math.PI / 180;
                node.x = Math.cos(rad) * newRadius;
                node.y = Math.sin(rad) * newRadius;
            }
            
            console.log('[WheelRenderer] Inner scatter: moved ' + scatterCount + ' nodes closer to center');
        }
        
        // STEP 2: Fill middle gaps by pulling outer nodes inward
        var midRadius = (minRadius + maxRadius) / 2;
        var innerNodes = nodes.filter(function(n) { return n.radius < midRadius && !n._gapFilled; });
        var outerNodes = nodes.filter(function(n) { return n.radius >= midRadius && !n._gapFilled && !n.isRoot; });
        
        var innerDensity = innerNodes.length / Math.max(1, midRadius - minRadius);
        var outerDensity = outerNodes.length / Math.max(1, maxRadius - midRadius);
        
        if (outerDensity > innerDensity * 1.3 && outerNodes.length > 3) {
            var pullCount = Math.min(Math.floor(outerNodes.length * 0.35), Math.floor(nodes.length * 0.25));
            
            // Sort by radius descending (outermost first)
            outerNodes.sort(function(a, b) { return b.radius - a.radius; });
            
            for (var i = 0; i < pullCount && i < outerNodes.length; i++) {
                var node = outerNodes[i];
                if (node._gapFilled) continue;
                
                // Pull 30-60% toward center
                var pullFactor = 0.3 + Math.random() * 0.3;
                var newRadius = node.radius * (1 - pullFactor) + avgRadius * pullFactor;
                
                // Angular jitter
                var angleJitter = (Math.random() - 0.5) * sectorAngle * 0.35;
                var newAngle = node.angle + angleJitter;
                
                var halfSector = sectorAngle / 2;
                newAngle = Math.max(spokeAngle - halfSector * 0.9, Math.min(spokeAngle + halfSector * 0.9, newAngle));
                
                node.radius = newRadius;
                node.angle = newAngle;
                node._gapFilled = true;
                
                var rad = newAngle * Math.PI / 180;
                node.x = Math.cos(rad) * newRadius;
                node.y = Math.sin(rad) * newRadius;
            }
            
            console.log('[WheelRenderer] Mid gap fill: pulled ' + pullCount + ' nodes inward');
        }
    },
    
    resolveCollisions: function(nodes, spokeAngle, maxSpread) {
        var cfg = TREE_CONFIG.wheel;
        var minDistance = Math.sqrt(cfg.nodeWidth * cfg.nodeWidth + cfg.nodeHeight * cfg.nodeHeight) * 0.7;
        var iterations = 5;
        var pushStrength = 0.3;
        var halfSpread = maxSpread / 2;
        
        for (var iter = 0; iter < iterations; iter++) {
            var moved = false;
            
            for (var i = 0; i < nodes.length; i++) {
                for (var j = i + 1; j < nodes.length; j++) {
                    var a = nodes[i];
                    var b = nodes[j];
                    
                    var dx = b.x - a.x;
                    var dy = b.y - a.y;
                    var dist = Math.sqrt(dx * dx + dy * dy);
                    
                    if (dist < minDistance && dist > 0) {
                        var overlap = minDistance - dist;
                        var pushX = (dx / dist) * overlap * pushStrength;
                        var pushY = (dy / dist) * overlap * pushStrength;
                        
                        var newAx = a.x - pushX;
                        var newAy = a.y - pushY;
                        var newBx = b.x + pushX;
                        var newBy = b.y + pushY;
                        
                        var aAngle = Math.atan2(newAy, newAx) * 180 / Math.PI;
                        var bAngle = Math.atan2(newBy, newBx) * 180 / Math.PI;
                        
                        if (Math.abs(aAngle - spokeAngle) <= halfSpread) {
                            a.x = newAx;
                            a.y = newAy;
                            a.angle = aAngle;
                            moved = true;
                        }
                        if (Math.abs(bAngle - spokeAngle) <= halfSpread) {
                            b.x = newBx;
                            b.y = newBy;
                            b.angle = bAngle;
                            moved = true;
                        }
                    }
                }
            }
            
            if (!moved) break;
        }
    },
    
    // Calculate shrink factors for overlapping nodes
    calculateOverlapShrink: function() {
        var cfg = TREE_CONFIG.wheel;
        var baseMinDist = Math.sqrt(cfg.nodeWidth * cfg.nodeWidth + cfg.nodeHeight * cfg.nodeHeight) * 0.6;
        
        // Reset all shrink factors
        this.nodes.forEach(function(node) {
            node._shrinkFactor = 1.0;
        });
        
        // Check all pairs for overlap
        var self = this;
        var overlapCount = 0;
        
        for (var i = 0; i < this.nodes.length; i++) {
            var a = this.nodes[i];
            var aNeighborCount = 0;
            var closestDist = Infinity;
            
            for (var j = 0; j < this.nodes.length; j++) {
                if (i === j) continue;
                var b = this.nodes[j];
                
                var dx = b.x - a.x;
                var dy = b.y - a.y;
                var dist = Math.sqrt(dx * dx + dy * dy);
                
                if (dist < baseMinDist * 1.5) {
                    aNeighborCount++;
                    closestDist = Math.min(closestDist, dist);
                }
            }
            
            // If node has many close neighbors, shrink it
            if (aNeighborCount >= 2 || closestDist < baseMinDist * 0.8) {
                // Shrink based on how close neighbors are
                var shrinkFactor = Math.max(0.5, Math.min(1.0, closestDist / baseMinDist));
                // Also shrink more if many neighbors
                if (aNeighborCount >= 3) shrinkFactor *= 0.85;
                if (aNeighborCount >= 5) shrinkFactor *= 0.85;
                
                a._shrinkFactor = shrinkFactor;
                overlapCount++;
            }
        }
        
        if (overlapCount > 0) {
            console.log('[WheelRenderer] Shrink factors applied to ' + overlapCount + ' overlapping nodes');
        }
    },

    render: function() {
        var startTime = performance.now();
        var nodeCount = this.nodes ? this.nodes.length : 0;
        
        // Warn about very large trees
        if (nodeCount > 1000) {
            console.warn('[WheelRenderer] LARGE TREE: ' + nodeCount + ' nodes - using aggressive performance mode');
        }
        
        this.debugDiscoveryMode();
        
        this.spokesLayer.innerHTML = '';
        this.edgesLayer.innerHTML = '';
        this.nodesLayer.innerHTML = '';
        this.centerHub.innerHTML = '';
        this.nodeElements.clear();
        this.edgeElements.clear();
        this._visibleNodes.clear();
        this._renderedNodes.clear();
        this._renderedEdges.clear();

        this._lodLevel = this.getLOD();

        this.renderCenterHub();
        this.renderSpokes();
        this.renderOriginLines();
        
        var self = this;
        // nodeCount already defined at start of render()
        
        // Use TRUE virtualization for large trees - don't render off-screen nodes at all
        var useVirtualization = nodeCount > this._virtualizeThreshold;
        var viewport = this.getViewportBounds();
        
        // Force simpler LOD for large trees - more aggressive thresholds
        if (nodeCount > 300) {
            this._lodLevel = 'simple';
        }
        if (nodeCount > 600) {
            this._lodLevel = 'minimal';
        }
        if (nodeCount > this._ultraLightThreshold) {
            this._lodLevel = 'ultralight';
            console.warn('[WheelRenderer] ULTRA-LIGHT MODE: ' + nodeCount + ' nodes - minimal DOM elements');
        }
        
        // Build set of visible node IDs for edge culling
        var visibleNodeIds = new Set();
        
        this.nodes.forEach(function(node) {
            // Skip hidden schools
            if (settings.schoolVisibility && settings.schoolVisibility[node.school] === false) {
                return;
            }
            
            // TRUE viewport culling for virtualized mode - skip nodes outside viewport
            if (useVirtualization && viewport && !self.isNodeInViewport(node, viewport)) {
                return;
            }
            
            visibleNodeIds.add(node.id);
            visibleNodeIds.add(node.formId);
        });
        
        // Render edges - only where at least one endpoint is visible
        var edgeFragment = document.createDocumentFragment();
        var edgeCount = 0;
        var edgeSkipped = 0;
        
        // For very large trees, skip most edges entirely (only show mastered paths)
        var skipNonMasteredEdges = (this._lodLevel === 'minimal' && nodeCount > 800) || this._lodLevel === 'ultralight';
        
        this.edges.forEach(function(edge) {
            // Edge culling: skip if BOTH endpoints are off-screen
            if (useVirtualization && !visibleNodeIds.has(edge.from) && !visibleNodeIds.has(edge.to)) {
                edgeSkipped++;
                return;
            }
            
            // For very large trees, only render mastered edges (both unlocked)
            if (skipNonMasteredEdges) {
                var fromNode = self._nodeMap ? self._nodeMap.get(edge.from) : null;
                var toNode = self._nodeMap ? self._nodeMap.get(edge.to) : null;
                if (!fromNode || !toNode || fromNode.state !== 'unlocked' || toNode.state !== 'unlocked') {
                    edgeSkipped++;
                    return;
                }
            }
            
            var edgeEl = self.createEdgeElement(edge);
            if (edgeEl) {
                edgeFragment.appendChild(edgeEl);
                self._renderedEdges.add(edge.from + '-' + edge.to);
                edgeCount++;
            }
        });
        
        // Render visible nodes
        var nodeFragment = document.createDocumentFragment();
        var nodesRendered = 0;
        
        // Hard limit on DOM elements for ultra-light mode to prevent memory issues
        var maxNodes = this._lodLevel === 'ultralight' ? 300 : Infinity;
        
        this.nodes.forEach(function(node) {
            if (nodesRendered >= maxNodes) {
                return;
            }
            
            if (!visibleNodeIds.has(node.id) && !visibleNodeIds.has(node.formId)) {
                return;
            }
            
            var nodeEl = self.createNodeElement(node);
            if (nodeEl) {
                nodeFragment.appendChild(nodeEl);
                self._visibleNodes.add(node.id);
                self._renderedNodes.add(node.id);
                nodesRendered++;
            }
        });
        
        this.edgesLayer.appendChild(edgeFragment);
        this.nodesLayer.appendChild(nodeFragment);

        this.updateTransform();
        
        var elapsed = performance.now() - startTime;
        if (elapsed > 50 || nodeCount > 400) {
            console.log('[WheelRenderer] Render: ' + Math.round(elapsed) + 'ms, ' + 
                        nodesRendered + '/' + nodeCount + ' nodes visible, ' +
                        edgeCount + '/' + this.edges.length + ' edges, LOD: ' + this._lodLevel +
                        (useVirtualization ? ' (VIRTUALIZED)' : ''));
        }
    },
    
    // Gap filler function removed in visual-first redesign
    // Positions are now pre-computed to avoid gaps
    
    createEdgeElement: function(edge) {
        // Use O(1) map lookup instead of O(n) find
        var fromNode = this._nodeMap ? this._nodeMap.get(edge.from) : null;
        var toNode = this._nodeMap ? this._nodeMap.get(edge.to) : null;
        
        if (!fromNode || !toNode) return null;
        
        if (!this.isNodeVisible(fromNode) || !this.isNodeVisible(toNode)) {
            return null;
        }
        
        var cacheKey = edge.from + '-' + edge.to;
        var pathData = this._edgePathCache[cacheKey];
        
        if (!pathData) {
            pathData = this.calculateEdgePath(fromNode, toNode);
            this._edgePathCache[cacheKey] = pathData;
        }
        
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathData.d);
        path.classList.add('edge');
        path.setAttribute('data-from', edge.from);
        path.setAttribute('data-to', edge.to);
        path.setAttribute('data-school', fromNode.school);  // Add school for CSS styling
        
        var toMystery = this.isPreviewNode(toNode);
        
        if (this._lodLevel === 'minimal') {
            path.setAttribute('stroke', '#444');
            path.setAttribute('stroke-width', 1);
        } else {
            var color = TREE_CONFIG.getSchoolColor(fromNode.school);
            var bothUnlocked = (fromNode.state === 'unlocked' && toNode.state === 'unlocked');
            
            if (toMystery) {
                path.setAttribute('stroke', this.dimColor(color, 0.4));
                path.setAttribute('stroke-width', 1);
                path.setAttribute('stroke-opacity', 0.5);
            } else if (bothUnlocked) {
                // BRIGHT PATH: Both nodes are mastered - show prominent connection
                path.setAttribute('stroke', color);
                path.setAttribute('stroke-width', this._lodLevel === 'simple' ? 2.5 : 3);
                path.setAttribute('stroke-opacity', 1.0);
                path.classList.add('mastered-path');
            } else {
                // All other edges: dim neutral color (no bright school colors for unlocked->available)
                path.setAttribute('stroke', '#333');
                path.setAttribute('stroke-width', this._lodLevel === 'simple' ? 1 : 1.5);
                path.setAttribute('stroke-opacity', 0.4);
            }
        }
        
        this.edgeElements.set(cacheKey, path);
        return path;
    },
    
    calculateEdgePath: function(fromNode, toNode) {
        return {
            d: 'M ' + fromNode.x + ' ' + fromNode.y + ' L ' + toNode.x + ' ' + toNode.y
        };
    },
    
    isNodeVisible: function(node) {
        // Check school visibility first - if school is hidden, node doesn't exist in tree
        if (settings.schoolVisibility && settings.schoolVisibility[node.school] === false) {
            return false;
        }
        
        if (settings.cheatMode) return true;
        if (!settings.discoveryMode) return true;
        
        if (node.state === 'unlocked' || node.state === 'available' || node.state === 'learning') {
            return true;
        }
        
        if (this.isPreviewNode(node)) {
            return true;
        }
        
        return false;
    },
    
    debugDiscoveryMode: function() {
        if (!this.nodes) {
            if (typeof logTreeParser === 'function') {
                logTreeParser('Discovery Debug - NO NODES!', true);
            }
            return;
        }
        
        var stateCount = { unlocked: 0, available: 0, learning: 0, locked: 0, other: 0 };
        var visibleCount = 0;
        var previewCount = 0;
        var self = this;
        
        this.nodes.forEach(function(node) {
            if (stateCount.hasOwnProperty(node.state)) {
                stateCount[node.state]++;
            } else {
                stateCount.other++;
            }
            if (self.isNodeVisible(node)) visibleCount++;
            if (self.isPreviewNode(node)) previewCount++;
        });
        
        if (typeof logTreeParser === 'function') {
            logTreeParser('Discovery Debug - discoveryMode=' + settings.discoveryMode + 
                ', cheatMode=' + settings.cheatMode +
                ', totalNodes=' + this.nodes.length +
                ', visible=' + visibleCount +
                ', preview=' + previewCount +
                ', states: unlocked=' + stateCount.unlocked + 
                ', available=' + stateCount.available + 
                ', learning=' + stateCount.learning + 
                ', locked=' + stateCount.locked);
        }
    },
    
    getTreeUnlockPercent: function() {
        if (!this.nodes || this.nodes.length === 0) return 0;
        var unlockedCount = 0;
        for (var i = 0; i < this.nodes.length; i++) {
            if (this.nodes[i].state === 'unlocked') unlockedCount++;
        }
        return Math.floor((unlockedCount / this.nodes.length) * 100);
    },
    
    isPreviewNode: function(node) {
        if (!settings.discoveryMode || settings.cheatMode) return false;
        
        if (node.state === 'unlocked' || node.state === 'available' || node.state === 'learning') {
            return false;
        }
        
        if (!this.nodes) return false;
        
        for (var i = 0; i < this.nodes.length; i++) {
            var parent = this.nodes[i];
            if (parent.state !== 'unlocked' && parent.state !== 'available' && parent.state !== 'learning') {
                continue;
            }
            if (parent.children && parent.children.indexOf(node.id) !== -1) {
                var parentProgress = this.getNodeXPProgress(parent);
                if (parentProgress >= 20) {
                    return true;
                }
            }
        }
        return false;
    },
    
    getNodeXPProgress: function(node) {
        if (node.state === 'unlocked') return 100;
        var _canonId = (typeof getCanonicalFormId === 'function') ? getCanonicalFormId(node) : node.formId;
        if (!state.spellProgress || !state.spellProgress[_canonId]) return 0;
        var progress = state.spellProgress[_canonId];
        var currentXP = progress.xp || 0;
        var requiredXP = (typeof getXPForTier === 'function' ? getXPForTier(node.level) : 100) || 100;
        return Math.min(100, Math.floor((currentXP / requiredXP) * 100));
    },
    
    createNodeElement: function(node) {
        if (!this.isNodeVisible(node)) {
            return null;
        }
        
        // Ultra-light: just colored dots, no groups, no text
        if (this._lodLevel === 'ultralight') {
            return this.createUltraLightNode(node);
        }
        
        // Use minimal nodes for LOD 'minimal' - much faster rendering
        if (this._lodLevel === 'minimal') {
            return this.createMinimalNode(node);
        }
        
        if (this.isPreviewNode(node)) {
            return this.createMysteryNode(node);
        }
        
        return this.createFullNode(node);
    },
    
    // Ultra-light node: single circle, no group wrapper, minimal attributes
    createUltraLightNode: function(node) {
        var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', node.x);
        circle.setAttribute('cy', node.y);
        
        // Size based on state
        var r = node.state === 'unlocked' ? 5 : 3;
        circle.setAttribute('r', r);
        
        // Color based on state
        var color;
        if (node.state === 'unlocked') {
            color = TREE_CONFIG.getSchoolColor(node.school);
        } else if (node.state === 'available') {
            color = '#666';
        } else {
            color = '#333';
        }
        circle.setAttribute('fill', color);
        
        // Minimal data for click handling
        circle.setAttribute('data-id', node.id);
        circle.classList.add('spell-node', 'ultralight');
        
        this.nodeElements.set(node.id, circle);
        return circle;
    },
    
    createMysteryNode: function(node) {
        var cfg = TREE_CONFIG.wheel;
        var self = this;
        
        // Use school-specific shape for mystery nodes
        var shapeSize = cfg.nodeWidth * 0.35;  // Slightly smaller than locked nodes
        
        var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'node mystery-node');
        g.setAttribute('data-id', node.id);
        g.setAttribute('data-school', node.school);
        
        var rotationAngle = node.angle + 90;
        g.setAttribute('transform', 'translate(' + node.x + ',' + node.y + ') rotate(' + rotationAngle + ')');
        
        var schoolColor = TREE_CONFIG.getSchoolColor(node.school);
        var dimmedColor = this.dimColor(schoolColor, 0.4);
        
        // Create school-specific shape instead of rectangle
        var shape = this.createSchoolShape(node.school, shapeSize, shapeSize);
        shape.setAttribute('fill', 'rgba(20, 20, 30, 0.9)');
        shape.setAttribute('stroke', dimmedColor);
        shape.setAttribute('stroke-width', '1');
        shape.classList.add('mystery-bg');
        g.appendChild(shape);
        
        // Single "?" text inside
        var text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'middle');
        text.setAttribute('fill', dimmedColor);
        text.setAttribute('font-size', '10px');
        text.setAttribute('font-weight', 'bold');
        text.textContent = '?';
        g.appendChild(text);
        
        // Event listeners delegated at nodesLayer level
        // Hover effects handled via CSS :hover pseudo-class instead
        this.nodeElements.set(node.id, g);
        return g;
    },
    
    dimColor: function(color, factor) {
        if (color.startsWith('#')) {
            var r = parseInt(color.slice(1, 3), 16);
            var g = parseInt(color.slice(3, 5), 16);
            var b = parseInt(color.slice(5, 7), 16);
            r = Math.round(r * factor);
            g = Math.round(g * factor);
            b = Math.round(b * factor);
            return 'rgb(' + r + ',' + g + ',' + b + ')';
        }
        var match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
            var r = Math.round(parseInt(match[1]) * factor);
            var g = Math.round(parseInt(match[2]) * factor);
            var b = Math.round(parseInt(match[3]) * factor);
            return 'rgb(' + r + ',' + g + ',' + b + ')';
        }
        return color;
    },
    
    brightenColor: function(color, factor) {
        // Brighten a color by factor (1.0 = same, 1.5 = 50% brighter)
        var r, g, b;
        if (color.startsWith('#')) {
            r = parseInt(color.slice(1, 3), 16);
            g = parseInt(color.slice(3, 5), 16);
            b = parseInt(color.slice(5, 7), 16);
        } else {
            var match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            if (match) {
                r = parseInt(match[1]);
                g = parseInt(match[2]);
                b = parseInt(match[3]);
            } else {
                return color;
            }
        }
        // Brighten toward white
        r = Math.min(255, Math.round(r + (255 - r) * (factor - 1)));
        g = Math.min(255, Math.round(g + (255 - g) * (factor - 1)));
        b = Math.min(255, Math.round(b + (255 - b) * (factor - 1)));
        return 'rgb(' + r + ',' + g + ',' + b + ')';
    },
    
    getInnerAccentColor: function(schoolColor) {
        // Create a contrasting inner color - darker and slightly different hue
        var r, g, b;
        if (schoolColor.startsWith('#')) {
            r = parseInt(schoolColor.slice(1, 3), 16);
            g = parseInt(schoolColor.slice(3, 5), 16);
            b = parseInt(schoolColor.slice(5, 7), 16);
        } else {
            var match = schoolColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            if (match) {
                r = parseInt(match[1]);
                g = parseInt(match[2]);
                b = parseInt(match[3]);
            } else {
                return '#1a1a2e';  // Default dark
            }
        }
        // Make it darker (40% of original) with slight warmth
        r = Math.round(r * 0.35);
        g = Math.round(g * 0.3);
        b = Math.round(b * 0.4);
        return 'rgb(' + r + ',' + g + ',' + b + ')';
    },
    
    createMinimalNode: function(node) {
        var color = node.state === 'unlocked' ? TREE_CONFIG.getSchoolColor(node.school) : '#333';
        var shape;
        
        if (node.state === 'unlocked') {
            // Unlocked: circle
            shape = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            shape.setAttribute('cx', node.x);
            shape.setAttribute('cy', node.y);
            shape.setAttribute('r', 6);
        } else {
            // Locked/available: diamond (using polygon with transform)
            shape = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            var r = 6;
            var points = [
                (node.x) + ',' + (node.y - r),    // top
                (node.x + r) + ',' + (node.y),    // right
                (node.x) + ',' + (node.y + r),    // bottom
                (node.x - r) + ',' + (node.y)     // left
            ].join(' ');
            shape.setAttribute('points', points);
        }
        shape.setAttribute('fill', color);
        shape.classList.add('spell-node', 'minimal', node.state);
        shape.setAttribute('data-id', node.id);
        
        // Event listeners delegated at nodesLayer level
        this.nodeElements.set(node.id, shape);
        return shape;
    },
    
    createSimpleNode: function(node) {
        var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.classList.add('spell-node', 'simple', node.state);
        g.setAttribute('data-id', node.id);
        g.setAttribute('transform', 'translate(' + node.x + ', ' + node.y + ')');
        
        // Check for LLM group color override
        var groupColor = this.getNodeGroupColor(node);
        var color = groupColor || TREE_CONFIG.getSchoolColor(node.school);
        
        var lockedSize = 16;
        var unlockedSize = 24;  // Bigger when unlocked
        var innerSize = 10;     // Inner accent
        
        var shape;
        if (node.state === 'unlocked') {
            // Unlocked: larger filled school shape with inner accent
            shape = this.createSchoolShape(node.school, unlockedSize, unlockedSize);
            shape.setAttribute('fill', color);
            shape.setAttribute('stroke', this.brightenColor(color, 1.3));
            shape.setAttribute('stroke-width', '2');
            g.appendChild(shape);
            
            // Inner accent
            var innerShape = this.createSchoolShape(node.school, innerSize, innerSize);
            innerShape.setAttribute('fill', this.getInnerAccentColor(color));
            innerShape.setAttribute('stroke', 'none');
            g.appendChild(innerShape);
        } else {
            // Locked/available: small outline school shape
            shape = this.createSchoolShape(node.school, lockedSize, lockedSize);
            shape.setAttribute('fill', '#1a1a2e');
            shape.setAttribute('stroke', color);
            shape.setAttribute('stroke-width', '1');
            shape.setAttribute('stroke-opacity', node.state === 'locked' ? 0.3 : 0.8);
            g.appendChild(shape);
        }
        
        if (groupColor) {
            shape.classList.add('group-colored');
        }
        
        // No text for simple nodes - clean shapes only
        
        // Event listeners delegated at nodesLayer level
        this.nodeElements.set(node.id, g);
        return g;
    },
    
    // Create school-specific shape for locked nodes
    createSchoolShape: function(school, width, height) {
        var shape;
        var hw = width / 2;
        var hh = height / 2;
        var points;
        
        switch (school) {
            case 'Destruction':
                // Diamond - aggressive, sharp
                shape = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                points = [
                    '0,' + (-hh),
                    hw + ',0',
                    '0,' + hh,
                    (-hw) + ',0'
                ].join(' ');
                shape.setAttribute('points', points);
                break;
                
            case 'Restoration':
                // Rounded pill/oval - healing, soft
                shape = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                shape.setAttribute('x', -hw);
                shape.setAttribute('y', -hh);
                shape.setAttribute('width', width);
                shape.setAttribute('height', height);
                shape.setAttribute('rx', Math.min(hw, hh));  // Fully rounded ends
                break;
                
            case 'Alteration':
                // Hexagon - transformation, change
                shape = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                var hexW = hw * 0.9;
                var hexH = hh * 0.5;
                points = [
                    '0,' + (-hh),
                    hexW + ',' + (-hexH),
                    hexW + ',' + hexH,
                    '0,' + hh,
                    (-hexW) + ',' + hexH,
                    (-hexW) + ',' + (-hexH)
                ].join(' ');
                shape.setAttribute('points', points);
                break;
                
            case 'Conjuration':
                // Pentagon - summoning, mystical
                shape = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                var r = Math.min(hw, hh);
                points = [];
                for (var i = 0; i < 5; i++) {
                    var angle = (i * 72 - 90) * Math.PI / 180;
                    points.push((Math.cos(angle) * r) + ',' + (Math.sin(angle) * r));
                }
                shape.setAttribute('points', points.join(' '));
                break;
                
            case 'Illusion':
                // Triangle pointing up - mysterious, mind
                shape = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                points = [
                    '0,' + (-hh),
                    hw + ',' + hh,
                    (-hw) + ',' + hh
                ].join(' ');
                shape.setAttribute('points', points);
                break;
                
            default:
                // Default: diamond
                shape = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                points = [
                    '0,' + (-hh),
                    hw + ',0',
                    '0,' + hh,
                    (-hw) + ',0'
                ].join(' ');
                shape.setAttribute('points', points);
        }
        
        return shape;
    },
    
    createFullNode: function(node) {
        var cfg = TREE_CONFIG.wheel;
        var tierScale = TREE_CONFIG.tierScaling;
        var self = this;
        
        var tier = node.level ? this.getTierFromLevel(node.level) : (node.tier || 0);
        tier = Math.min(4, Math.max(0, tier));
        
        // FIXED NODE SIZE - no tier scaling, no shrink
        // All nodes should be the same size for visual consistency
        var nodeWidth = cfg.nodeWidth;
        var nodeHeight = cfg.nodeHeight;
        
        node._renderWidth = nodeWidth;
        node._renderHeight = nodeHeight;
        
        var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.classList.add('spell-node', node.state);
        g.setAttribute('data-id', node.id);
        g.setAttribute('data-school', node.school);
        g.setAttribute('data-tier', tier);
        
        var rotationAngle = node.angle + 90;
        g.setAttribute('transform', 'translate(' + node.x + ', ' + node.y + ') rotate(' + rotationAngle + ')');

        // Check for LLM group color override
        var groupColor = this.getNodeGroupColor(node);
        var color = groupColor || TREE_CONFIG.getSchoolColor(node.school);

        // ALL NODES: School-specific shapes
        // UNLOCKED: Bigger shape, filled with school color, inner shape with accent
        // LOCKED/AVAILABLE: Smaller shape, outline only
        var bgShape;
        var lockedSize = nodeWidth * 0.4;
        var unlockedSize = nodeWidth * 0.6;  // Bigger when unlocked
        var innerSize = unlockedSize * 0.5;  // Inner accent shape
        
        if (node.state === 'unlocked') {
            // UNLOCKED: Larger filled shape with inner accent
            bgShape = this.createSchoolShape(node.school, unlockedSize, unlockedSize);
            bgShape.setAttribute('fill', color);
            bgShape.setAttribute('stroke', this.brightenColor(color, 1.3));
            bgShape.setAttribute('stroke-width', '2');
            bgShape.setAttribute('stroke-opacity', '1');
            bgShape.classList.add('node-bg', 'unlocked-shape');
            g.appendChild(bgShape);
            
            // Inner accent shape (learning color or darker version)
            var innerShape = this.createSchoolShape(node.school, innerSize, innerSize);
            var innerColor = this.getInnerAccentColor(color);
            innerShape.setAttribute('fill', innerColor);
            innerShape.setAttribute('stroke', 'none');
            innerShape.classList.add('node-inner');
            g.appendChild(innerShape);
        } else {
            // LOCKED/AVAILABLE: Smaller outline shape
            bgShape = this.createSchoolShape(node.school, lockedSize, lockedSize);
            bgShape.classList.add('node-bg');
            g.appendChild(bgShape);
        }
        
        // Mark node if it has group color
        if (groupColor) {
            g.classList.add('group-colored');
            g.setAttribute('data-group-color', groupColor);
            bgShape.setAttribute('stroke', groupColor);
            bgShape.setAttribute('stroke-width', '2');
            bgShape.setAttribute('stroke-opacity', '0.6');
        }
        
        // NO text for any nodes - clean shapes only

        // Event listeners are now delegated at nodesLayer level for performance
        this.nodeElements.set(node.id, g);
        return g;
    },
    
    getNodeDisplayName: function(node, nodeWidth) {
        // Cheat mode shows all names
        if (settings.cheatMode) {
            var name = node.name || 'Unknown';
            return name.length > 10 ? name.slice(0, 9) + '…' : name;
        }
        
        // Locked nodes show ??? (unless showNodeNames is on)
        if (node.state === 'locked' && !settings.showNodeNames) {
            return '???';
        }
        
        // Unlocked nodes always show name
        if (node.state === 'unlocked') {
            if (node.name) {
                var maxLen = Math.floor(nodeWidth / 7);
                return node.name.length > maxLen ? node.name.slice(0, maxLen - 1) + '…' : node.name;
            }
            return node.formId.replace('0x', '').slice(-6);
        }
        
        // Learning nodes always show name (player explicitly chose them)
        if (node.state === 'learning') {
            if (node.name) {
                var maxLen = Math.floor(nodeWidth / 7);
                return node.name.length > maxLen ? node.name.slice(0, maxLen - 1) + '…' : node.name;
            }
            return node.formId.replace('0x', '').slice(-6);
        }

        // Available and other states: check progressive reveal threshold
        var nodeProgress = this.getNodeXPProgress(node);
        if (nodeProgress < settings.revealName) {
            return '???';
        }
        
        // Show name if above reveal threshold
        if (node.name) {
            var maxLen = Math.floor(nodeWidth / 7);
            return node.name.length > maxLen ? node.name.slice(0, maxLen - 1) + '…' : node.name;
        } else if (SpellCache.isPending(node.formId)) {
            return '...';
        } else {
            return node.formId.replace('0x', '').slice(-6);
        }
    },
    
    renderOriginLines: function() {
        var self = this;
        var hubRadius = 45;
        
        // Create a group for origin lines that will be inserted FIRST (renders below)
        var originGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        originGroup.setAttribute('class', 'origin-lines-group');
        
        this.nodes.forEach(function(node) {
            // Skip hidden schools
            if (settings.schoolVisibility && settings.schoolVisibility[node.school] === false) {
                return;
            }
            
            // Render origin line for ALL root nodes (not just unlocked)
            if (node.isRoot) {
                var color = TREE_CONFIG.getSchoolColor(node.school);
                var isUnlocked = node.state === 'unlocked';
                
                var rad = node.angle * Math.PI / 180;
                var startX = Math.cos(rad) * hubRadius;
                var startY = Math.sin(rad) * hubRadius;
                
                var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                // Line from hub edge TO root node
                var d = 'M ' + startX + ' ' + startY + ' L ' + node.x + ' ' + node.y;
                path.setAttribute('d', d);
                path.setAttribute('fill', 'none');
                path.setAttribute('data-school', node.school);
                path.classList.add('origin-line');
                
                if (isUnlocked) {
                    path.setAttribute('stroke', color);
                    path.setAttribute('stroke-width', 3);
                    path.setAttribute('stroke-opacity', 1.0);
                    path.classList.add('mastered-path');
                } else {
                    // Dim line for locked root
                    path.setAttribute('stroke', '#333');
                    path.setAttribute('stroke-width', 1.5);
                    path.setAttribute('stroke-opacity', 0.3);
                }
                
                originGroup.appendChild(path);
            }
        });
        
        // Insert at the BEGINNING of edges layer so it renders below other edges
        if (this.edgesLayer.firstChild) {
            this.edgesLayer.insertBefore(originGroup, this.edgesLayer.firstChild);
        } else {
            this.edgesLayer.appendChild(originGroup);
        }
    },

    renderCenterHub: function() {
        var hub = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        hub.classList.add('center-hub-bg');
        hub.setAttribute('cx', 0);
        hub.setAttribute('cy', 0);
        hub.setAttribute('r', 45);
        this.centerHub.appendChild(hub);

        var text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.classList.add('center-hub-text');
        text.setAttribute('x', 0);
        text.setAttribute('y', 0);
        text.textContent = 'MAGIC';
        this.centerHub.appendChild(text);
    },

    renderSpokes: function() {
        var cfg = TREE_CONFIG.wheel;
        var self = this;
        
        // Only consider visible schools for spokes
        var schoolNames = Object.keys(this.schools).filter(function(name) {
            return !settings.schoolVisibility || settings.schoolVisibility[name] !== false;
        });
        var numSchools = schoolNames.length;
        
        if (numSchools === 0) return;
        
        var globalMaxRadius = 0;
        schoolNames.forEach(function(schoolName) {
            var school = self.schools[schoolName];
            var schoolMaxRadius = (school.maxRadius || cfg.baseRadius + (school.maxDepth + 0.5) * cfg.tierSpacing) + 30;
            if (schoolMaxRadius > globalMaxRadius) {
                globalMaxRadius = schoolMaxRadius;
            }
        });
        
        if (settings.showSchoolDividers) {
            var defs = self.svg.querySelector('defs') || document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            if (!self.svg.querySelector('defs')) {
                self.svg.insertBefore(defs, self.svg.firstChild);
            }
            
            var oldGradients = defs.querySelectorAll('[id^="divider-grad-"]');
            oldGradients.forEach(function(grad) { grad.remove(); });
            
            schoolNames.forEach(function(schoolName, i) {
                var school = self.schools[schoolName];
                var nextSchoolName = schoolNames[(i + 1) % numSchools];
                
                var color, nextColor;
                if (settings.dividerColorMode === 'custom' && settings.dividerCustomColor) {
                    color = settings.dividerCustomColor;
                    nextColor = settings.dividerCustomColor;
                } else {
                    color = TREE_CONFIG.getSchoolColor(schoolName) || '#888888';
                    nextColor = TREE_CONFIG.getSchoolColor(nextSchoolName) || '#888888';
                }
                
                var boundaryAngle = school.endAngle + (cfg.schoolPadding / 2);
                var rad = boundaryAngle * Math.PI / 180;
                
                var dirX = Math.cos(rad);
                var dirY = Math.sin(rad);
                
                var perpX = -dirY;
                var perpY = dirX;
                var lineSpacing = settings.dividerSpacing || 3;
                
                var fadePercent = settings.dividerFade !== undefined ? settings.dividerFade : 50;
                var fadeStart = 100 - fadePercent;
                
                var startRadius = 50;
                var endRadius = globalMaxRadius;
                
                var x1Start = dirX * startRadius + perpX * lineSpacing;
                var y1Start = dirY * startRadius + perpY * lineSpacing;
                var x1End = dirX * endRadius + perpX * lineSpacing;
                var y1End = dirY * endRadius + perpY * lineSpacing;
                
                var x2Start = dirX * startRadius - perpX * lineSpacing;
                var y2Start = dirY * startRadius - perpY * lineSpacing;
                var x2End = dirX * endRadius - perpX * lineSpacing;
                var y2End = dirY * endRadius - perpY * lineSpacing;
                
                var gradId1 = 'divider-grad-' + i + '-1';
                var grad1 = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
                grad1.setAttribute('id', gradId1);
                grad1.setAttribute('gradientUnits', 'userSpaceOnUse');
                grad1.setAttribute('x1', x1Start);
                grad1.setAttribute('y1', y1Start);
                grad1.setAttribute('x2', x1End);
                grad1.setAttribute('y2', y1End);
                grad1.innerHTML = '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.4"/>' +
                                  '<stop offset="' + fadeStart + '%" stop-color="' + color + '" stop-opacity="0.3"/>' +
                                  '<stop offset="100%" stop-color="' + color + '" stop-opacity="0"/>';
                defs.appendChild(grad1);
                
                var gradId2 = 'divider-grad-' + i + '-2';
                var grad2 = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
                grad2.setAttribute('id', gradId2);
                grad2.setAttribute('gradientUnits', 'userSpaceOnUse');
                grad2.setAttribute('x1', x2Start);
                grad2.setAttribute('y1', y2Start);
                grad2.setAttribute('x2', x2End);
                grad2.setAttribute('y2', y2End);
                grad2.innerHTML = '<stop offset="0%" stop-color="' + nextColor + '" stop-opacity="0.4"/>' +
                                  '<stop offset="' + fadeStart + '%" stop-color="' + nextColor + '" stop-opacity="0.3"/>' +
                                  '<stop offset="100%" stop-color="' + nextColor + '" stop-opacity="0"/>';
                defs.appendChild(grad2);
                
                var line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line1.setAttribute('x1', x1Start);
                line1.setAttribute('y1', y1Start);
                line1.setAttribute('x2', x1End);
                line1.setAttribute('y2', y1End);
                line1.setAttribute('stroke', 'url(#' + gradId1 + ')');
                line1.setAttribute('stroke-width', 1.5);
                line1.classList.add('school-divider');
                self.spokesLayer.appendChild(line1);
                
                var line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line2.setAttribute('x1', x2Start);
                line2.setAttribute('y1', y2Start);
                line2.setAttribute('x2', x2End);
                line2.setAttribute('y2', y2End);
                line2.setAttribute('stroke', 'url(#' + gradId2 + ')');
                line2.setAttribute('stroke-width', 1.5);
                line2.classList.add('school-divider');
                self.spokesLayer.appendChild(line2);
            });
        }
        
        // Render school labels - ONLY for visible schools
        for (var schoolName in this.schools) {
            // Skip hidden schools
            if (settings.schoolVisibility && settings.schoolVisibility[schoolName] === false) {
                continue;
            }
            
            var school = this.schools[schoolName];
            // Skip schools without layout (also hidden)
            if (school.spokeAngle === undefined) {
                continue;
            }
            
            var color = TREE_CONFIG.getSchoolColor(schoolName);
            var angle = school.spokeAngle * Math.PI / 180;
            var maxRadius = (school.maxRadius || cfg.baseRadius + (school.maxDepth + 0.5) * cfg.tierSpacing) + 30;

            var labelRadius = maxRadius + 35;
            var label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            label.classList.add('school-label');
            label.dataset.school = schoolName;
            
            var labelX = Math.cos(angle) * labelRadius;
            var labelY = Math.sin(angle) * labelRadius;
            
            label.setAttribute('x', labelX);
            label.setAttribute('y', labelY);
            label.setAttribute('fill', color);
            label.setAttribute('text-anchor', 'middle');
            label.setAttribute('dominant-baseline', 'middle');
            
            // Rotate label to be PARALLEL to the spoke (along the radial direction)
            // Adjust so text reads from center outward, flip if on left side
            var labelAngleDeg = school.spokeAngle;
            if (labelAngleDeg > 90 && labelAngleDeg < 270) {
                labelAngleDeg += 180;  // Flip so text is right-side up
            }
            label.setAttribute('transform', 'rotate(' + labelAngleDeg + ', ' + labelX + ', ' + labelY + ')');
            label.textContent = schoolName.toUpperCase();
            this.spokesLayer.appendChild(label);
        }
    },
    
    // Update school label sizes based on zoom (called from updateTransform)
    updateSchoolLabelScale: function() {
        var labels = this.spokesLayer.querySelectorAll('.school-label');
        // Scale labels inversely with zoom so they stay readable when zoomed out
        // At zoom 1.0 = font-size 1em, at zoom 0.5 = font-size 1.5em, at zoom 0.2 = font-size 2.5em
        var inverseZoom = 1 / Math.max(this.zoom, 0.2);
        var scaleFactor = Math.min(2.5, Math.max(1, inverseZoom * 0.8));
        
        labels.forEach(function(label) {
            label.style.fontSize = scaleFactor + 'em';
        });
    },

    getTierFromLevel: function(level) {
        if (!level) return 0;
        var levelLower = level.toLowerCase();
        if (levelLower === 'novice') return 0;
        if (levelLower === 'apprentice') return 1;
        if (levelLower === 'adept') return 2;
        if (levelLower === 'expert') return 3;
        if (levelLower === 'master') return 4;
        return 0;
    },
    
    onNodeClick: function(node) {
        this.selectNode(node);
        
        // Count visible schools
        var self = this;
        var visibleSchoolCount = Object.keys(this.schools).filter(function(name) {
            return !settings.schoolVisibility || settings.schoolVisibility[name] !== false;
        }).length;
        
        // Get the school for this node
        var nodeSchool = node.school;
        var school = nodeSchool ? this.schools[nodeSchool] : null;
        
        // If 2 or fewer schools: always rotate to center the school's axis
        if (visibleSchoolCount <= 2 && school && school.spokeAngle !== undefined) {
            this.rotateSchoolToTop(nodeSchool);
            return;
        }
        
        // For 3+ schools: use 45-degree threshold logic
        // Calculate node's visual angle (accounting for current wheel rotation)
        var nodeAngle = node.angle || 0;
        var visualAngle = nodeAngle + this.rotation;
        
        // Normalize to -180 to 180 range
        while (visualAngle > 180) visualAngle -= 360;
        while (visualAngle < -180) visualAngle += 360;
        
        // "Top" of wheel is at -90 degrees visual
        // Calculate how far the node is from top center
        var distanceFromTop = Math.abs(visualAngle + 90);  // +90 because top is at -90
        if (distanceFromTop > 180) distanceFromTop = 360 - distanceFromTop;
        
        // If node is more than 45 degrees from view center, rotate school axis to top
        if (distanceFromTop > 45 && school && school.spokeAngle !== undefined) {
            this.rotateSchoolToTop(nodeSchool);
        }
    },
    
    rotateToNode: function(node) {
        // Rotate wheel so the clicked node is at the top (visual -90 degrees)
        var nodeAngle = node.angle || 0;
        var targetRotation = -90 - nodeAngle;
        
        var delta = targetRotation - this.rotation;
        while (delta > 180) delta -= 360;
        while (delta < -180) delta += 360;
        
        this.animateRotation(this.rotation + delta);
    },

    rotateSchoolToTop: function(schoolName) {
        var school = this.schools[schoolName];
        if (!school) return;
        
        var targetRotation = -90 - school.spokeAngle;
        var delta = targetRotation - this.rotation;
        while (delta > 180) delta -= 360;
        while (delta < -180) delta += 360;
        
        this.animateRotation(this.rotation + delta);
    },

    animateRotation: function(target) {
        if (this.isAnimating) return;
        
        var self = this;
        var start = this.rotation;
        var startTime = performance.now();
        var duration = TREE_CONFIG.animation.rotateDuration;
        
        this.isAnimating = true;
        
        function animate(time) {
            var elapsed = time - startTime;
            var progress = Math.min(elapsed / duration, 1);
            var eased = 1 - Math.pow(1 - progress, 3);
            
            self.rotation = start + (target - start) * eased;
            self.updateTransform();
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                self.rotation = target;
                self.isAnimating = false;
                self.updateTransform();
            }
        }
        
        requestAnimationFrame(animate);
    },

    selectNode: function(node) {
        var self = this;
        
        if (this.selectedNode) {
            var prev = this.nodeElements.get(this.selectedNode.id);
            if (prev) prev.classList.remove('selected');
        }
        this.edgeElements.forEach(function(e) {
            e.classList.remove('highlighted', 'path-highlight');
        });

        this.selectedNode = node;
        var el = this.nodeElements.get(node.id);
        if (el) el.classList.add('selected');

        var visited = new Set();
        var queue = [node.id];
        while (queue.length) {
            var id = queue.shift();
            if (visited.has(id)) continue;
            visited.add(id);
            var n = this._nodeMap ? this._nodeMap.get(id) : null;
            if (!n) continue;
            n.prerequisites.forEach(function(prereq) {
                var ek = prereq + '-' + id;
                var edge = self.edgeElements.get(ek);
                if (edge) edge.classList.add('path-highlight');
                queue.push(prereq);
            });
        }

        if (node.state === 'unlocked') {
            node.children.forEach(function(cid) {
                var ek = node.id + '-' + cid;
                var edge = self.edgeElements.get(ek);
                if (edge) edge.classList.add('highlighted');
            });
        }

        window.dispatchEvent(new CustomEvent('nodeSelected', { detail: node }));
    },

    showTooltip: function(node, event) {
        var tooltip = document.getElementById('tooltip');
        
        // Get progress for this node
        var progressPercent = this.getNodeXPProgress(node);
        
        // Check if player has spell (via early learning) or it's fully unlocked
        var _tCanonId = (typeof getCanonicalFormId === 'function') ? getCanonicalFormId(node) : node.formId;
        var progress = state.spellProgress[_tCanonId] || {};
        var playerHasSpell = progress.unlocked || node.state === 'unlocked';
        
        // Progressive reveal logic (same as details panel)
        var showFullInfo = playerHasSpell || settings.cheatMode;
        // Show name if: full info, reached reveal threshold, available (learnable), OR root node with showRootSpellNames enabled
        var isRootWithReveal = node.isRoot && settings.showRootSpellNames;
        var isLearning = node.state === 'learning';
        var isLocked = node.state === 'locked';
        var showName = showFullInfo || isLearning || (!isLocked && progressPercent >= settings.revealName) || isRootWithReveal;
        var showDetails = node.state !== 'locked' || settings.cheatMode;
        
        var nameText = showName ? (node.name || node.formId) : '???';
        var infoText;
        if (node.state === 'locked') {
            infoText = 'Unlock prerequisites first';
        } else if (showDetails) {
            infoText = node.school + ' • ' + (node.level || '?') + ' • ' + (node.cost || '?') + ' magicka';
        } else {
            infoText = node.school + ' • Progress: ' + progressPercent + '%';
        }
        
        tooltip.querySelector('.tooltip-name').textContent = nameText;
        tooltip.querySelector('.tooltip-info').textContent = infoText;
        
        var stateEl = tooltip.querySelector('.tooltip-state');
        stateEl.textContent = node.state;
        stateEl.className = 'tooltip-state ' + node.state;
        
        tooltip.classList.remove('hidden');
        tooltip.style.left = (event.clientX + 15) + 'px';
        tooltip.style.top = (event.clientY + 15) + 'px';
    },

    hideTooltip: function() {
        document.getElementById('tooltip').classList.add('hidden');
    },

    updateTransform: function() {
        var rect = this.svg.getBoundingClientRect();
        var cx = rect.width / 2;
        var cy = rect.height / 2;
        
        var tx = cx + this.panX;
        var ty = cy + this.panY;
        
        var wheelTransform = 'translate(' + tx + ', ' + ty + ') rotate(' + this.rotation + ') scale(' + this.zoom + ')';
        this.wheelGroup.setAttribute('transform', wheelTransform);
        
        var hubTransform = 'translate(' + tx + ', ' + ty + ') scale(' + this.zoom + ')';
        this.centerHub.setAttribute('transform', hubTransform);
        
        // Update school label sizes for zoom level
        this.updateSchoolLabelScale();
        
        this.scheduleViewportUpdate();
    },
    
    scheduleViewportUpdate: function() {
        if (this._viewportUpdatePending) return;
        if (this.nodes.length < 50) return;
        
        // Skip during active panning for large trees - update happens on mouseup
        if (this.isPanning && this.nodes.length > this._virtualizeThreshold) {
            return;
        }
        
        var self = this;
        this._viewportUpdatePending = true;
        
        // Faster updates for large trees
        var delay = this.nodes.length > this._virtualizeThreshold ? 50 : 150;
        
        setTimeout(function() {
            self._viewportUpdatePending = false;
            
            var newLOD = self.getLOD();
            if (newLOD !== self._lodLevel) {
                console.log('[WheelRenderer] LOD changed to ' + newLOD + ', re-rendering');
                self.render();
                return;
            }
            
            // For virtualized trees, do incremental updates (skip if panning)
            if (self.nodes.length > self._virtualizeThreshold && !self.isPanning) {
                self.updateVirtualizedView();
            }
        }, delay);
    },
    
    updateVirtualizedView: function() {
        if (!this.nodes || this.nodes.length === 0) return;
        
        var startTime = performance.now();
        var viewport = this.getViewportBounds();
        if (!viewport) return;
        
        var self = this;
        var nodesAdded = 0;
        var nodesRemoved = 0;
        var edgesAdded = 0;
        
        // Use document fragments for batch DOM operations
        var nodeFragment = document.createDocumentFragment();
        var edgeFragment = document.createDocumentFragment();
        
        // Track newly added node IDs for edge rendering
        var newlyVisible = [];
        
        // Single pass: check each node, add if newly visible
        this.nodes.forEach(function(node) {
            if (settings.schoolVisibility && settings.schoolVisibility[node.school] === false) {
                return;
            }
            
            var inViewport = self.isNodeInViewport(node, viewport);
            var isRendered = self._renderedNodes.has(node.id);
            
            if (inViewport && !isRendered) {
                // Node entered viewport - create and queue for batch add
                var nodeEl = self.createNodeElement(node);
                if (nodeEl) {
                    nodeFragment.appendChild(nodeEl);
                    self._renderedNodes.add(node.id);
                    self._visibleNodes.add(node.id);
                    newlyVisible.push(node);
                    nodesAdded++;
                }
            }
        });
        
        // Batch add all new nodes at once
        if (nodesAdded > 0) {
            this.nodesLayer.appendChild(nodeFragment);
        }
        
        // Only add edges connected to newly visible nodes (much faster than checking all edges)
        if (newlyVisible.length > 0 && newlyVisible.length < 100) {
            var newNodeIds = new Set(newlyVisible.map(function(n) { return n.id; }));
            newlyVisible.forEach(function(n) { newNodeIds.add(n.formId); });
            
            self.edges.forEach(function(edge) {
                var edgeKey = edge.from + '-' + edge.to;
                if (self._renderedEdges.has(edgeKey)) return;
                
                // Only render if connected to a newly visible node
                if (newNodeIds.has(edge.from) || newNodeIds.has(edge.to)) {
                    var edgeEl = self.createEdgeElement(edge);
                    if (edgeEl) {
                        edgeFragment.appendChild(edgeEl);
                        self._renderedEdges.add(edgeKey);
                        edgesAdded++;
                    }
                }
            });
            
            if (edgesAdded > 0) {
                this.edgesLayer.appendChild(edgeFragment);
            }
        }
        
        // Aggressive cleanup: remove nodes far outside viewport to keep DOM small
        // Only check if we have many rendered nodes (performance optimization)
        if (this._renderedNodes.size > 600) {
            var toRemove = [];
            self._renderedNodes.forEach(function(nodeId) {
                var node = self._nodeMap ? self._nodeMap.get(nodeId) : null;
                if (node && !self.isNodeInViewport(node, viewport)) {
                    toRemove.push(nodeId);
                }
            });
            
            // Remove in batches to avoid layout thrashing
            if (toRemove.length > 100) {
                toRemove.slice(0, 200).forEach(function(nodeId) {
                    var el = self.nodeElements.get(nodeId);
                    if (el && el.parentNode) {
                        el.parentNode.removeChild(el);
                        self.nodeElements.delete(nodeId);
                        self._renderedNodes.delete(nodeId);
                        self._visibleNodes.delete(nodeId);
                        nodesRemoved++;
                    }
                });
            }
        }
        
        var elapsed = performance.now() - startTime;
        if (nodesAdded > 0 || nodesRemoved > 0 || elapsed > 15) {
            console.log('[WheelRenderer] Viewport update: +' + nodesAdded + '/-' + nodesRemoved + 
                        ' nodes, +' + edgesAdded + ' edges, rendered: ' + this._renderedNodes.size + 
                        ', ' + Math.round(elapsed) + 'ms');
        }
    },

    centerView: function() {
        this.rotation = 0;
        this.panX = 0;
        this.panY = 0;
        this.zoom = 0.75;
        this.updateTransform();
        document.getElementById('zoom-level').textContent = Math.round(this.zoom * 100) + '%';
    },

    setZoom: function(z) {
        var oldLOD = this.getLOD();
        this.zoom = Math.max(TREE_CONFIG.zoom.min, Math.min(TREE_CONFIG.zoom.max, z));
        
        var newLOD = this.getLOD();
        if (newLOD !== oldLOD && this.nodes.length > 0) {
            console.log('[WheelRenderer] LOD changed: ' + oldLOD + ' -> ' + newLOD);
            this.render();
        }
        this.updateTransform();
        document.getElementById('zoom-level').textContent = Math.round(this.zoom * 100) + '%';
    },
    
    // Growth DSL Recipe Interpreter
    applyGrowthRecipe: function(schoolName, recipe) {
        console.log('[WheelRenderer] Applying growth recipe to ' + schoolName);
        
        var parsed = GROWTH_DSL.parseRecipe(recipe);
        if (!parsed.valid) {
            console.warn('[WheelRenderer] Invalid recipe: ' + parsed.error);
            return false;
        }
        
        this.growthRecipes[schoolName] = parsed.recipe;
        return true;
    },
    
    getRecipeForSchool: function(schoolName) {
        return this.growthRecipes[schoolName] || GROWTH_DSL.getDefaultRecipe(schoolName);
    },
    
    clearRecipes: function() {
        this.growthRecipes = {};
    },
    
    // =============================================================================
    // GROWTH DSL MODIFIERS - Apply recipe effects to node positions
    // =============================================================================
    
    /**
     * Apply branching rules to optimize layout
     */
    applyBranchingRulesToSchool: function(schoolName, nodes, spokeAngle, sectorAngle) {
        var recipe = this.growthRecipes[schoolName];
        if (!recipe || !recipe.branching) {
            return; // No branching rules to apply
        }
        
        var branching = recipe.branching;
        var self = this;
        
        // Apply fillEmptySpaces - redistribute nodes to minimize gaps
        if (branching.fillEmptySpaces) {
            this.fillEmptySpacesInSchool(nodes, spokeAngle, sectorAngle);
        }
        
        // Apply preferWideOverDeep - spread out shallow tiers
        if (branching.preferWideOverDeep) {
            this.spreadWideTiers(nodes, spokeAngle, sectorAngle);
        }
        
        console.log('[WheelRenderer] Applied branching rules to ' + schoolName);
    },
    
    /**
     * Redistribute nodes to fill empty spaces in the layout
     */
    fillEmptySpacesInSchool: function(nodes, spokeAngle, sectorAngle) {
        if (nodes.length < 3) return;
        
        // Group nodes by depth/tier
        var byDepth = {};
        var maxDepth = 0;
        nodes.forEach(function(node) {
            var d = node.depth || 0;
            if (!byDepth[d]) byDepth[d] = [];
            byDepth[d].push(node);
            if (d > maxDepth) maxDepth = d;
        });
        
        var spokeRad = spokeAngle * Math.PI / 180;
        var halfSector = (sectorAngle / 2) * Math.PI / 180;
        
        // For each tier, check if there are gaps and redistribute
        for (var d = 1; d <= maxDepth; d++) {
            var tier = byDepth[d];
            if (!tier || tier.length < 2) continue;
            
            var prevTier = byDepth[d - 1] || [];
            
            // If this tier has fewer nodes than prev and there are gaps, spread them
            if (tier.length < prevTier.length * 2) {
                // Sort by current angle
                tier.sort(function(a, b) {
                    return (a.angle || 0) - (b.angle || 0);
                });
                
                // Calculate ideal even distribution across sector
                var usableSector = sectorAngle * 0.8; // Use 80% of sector
                var startAngle = spokeAngle - usableSector / 2;
                var angleStep = tier.length > 1 ? usableSector / (tier.length - 1) : 0;
                
                tier.forEach(function(node, idx) {
                    var targetAngle = tier.length === 1 ? spokeAngle : startAngle + angleStep * idx;
                    
                    // Blend toward target (don't snap completely)
                    var currentAngle = node.angle || spokeAngle;
                    var newAngle = currentAngle * 0.4 + targetAngle * 0.6;
                    
                    var rad = newAngle * Math.PI / 180;
                    var radius = node.radius || Math.sqrt(node.x * node.x + node.y * node.y);
                    
                    node.x = Math.cos(rad) * radius;
                    node.y = Math.sin(rad) * radius;
                    node.angle = newAngle;
                });
            }
        }
    },
    
    /**
     * Spread out nodes in shallow tiers (prefer wide over deep)
     */
    spreadWideTiers: function(nodes, spokeAngle, sectorAngle) {
        // Group by depth
        var byDepth = {};
        nodes.forEach(function(node) {
            var d = node.depth || 0;
            if (!byDepth[d]) byDepth[d] = [];
            byDepth[d].push(node);
        });
        
        // For tiers 1-2 (shallow), spread more aggressively
        for (var d = 1; d <= 2; d++) {
            var tier = byDepth[d];
            if (!tier || tier.length < 2) continue;
            
            // Sort by angle
            tier.sort(function(a, b) {
                return (a.angle || 0) - (b.angle || 0);
            });
            
            // Use more of the sector for shallow tiers
            var usableSector = sectorAngle * 0.9;
            var startAngle = spokeAngle - usableSector / 2;
            var angleStep = usableSector / (tier.length - 1);
            
            tier.forEach(function(node, idx) {
                var targetAngle = startAngle + angleStep * idx;
                var rad = targetAngle * Math.PI / 180;
                var radius = node.radius || Math.sqrt(node.x * node.x + node.y * node.y);
                
                node.x = Math.cos(rad) * radius;
                node.y = Math.sin(rad) * radius;
                node.angle = targetAngle;
            });
        }
    },

    /**
     * Apply all modifiers from a growth recipe to a school's nodes
     */
    applyModifiersToSchool: function(schoolName, nodes, spokeAngle) {
        var recipe = this.growthRecipes[schoolName];
        if (!recipe || !recipe.modifiers || recipe.modifiers.length === 0) {
            console.log('[WheelRenderer] No modifiers for ' + schoolName + (recipe ? ' (recipe exists but no modifiers)' : ' (no recipe)'));
            return; // No modifiers to apply
        }
        console.log('[WheelRenderer] Applying ' + recipe.modifiers.length + ' modifiers to ' + schoolName + ':', recipe.modifiers.map(function(m) { return m.type; }).join(', '));
        
        var self = this;
        var centerX = 0, centerY = 0;
        
        recipe.modifiers.forEach(function(modifier) {
            switch (modifier.type) {
                case 'spiral':
                    self.applySpiralModifier(nodes, spokeAngle, modifier);
                    break;
                case 'gravity':
                    self.applyGravityModifier(nodes, modifier);
                    break;
                case 'wind':
                    self.applyWindModifier(nodes, modifier);
                    break;
                case 'taper':
                    self.applyTaperModifier(nodes, spokeAngle, modifier);
                    break;
                case 'attractTo':
                    self.applyAttractModifier(nodes, modifier);
                    break;
                case 'repelFrom':
                    self.applyRepelModifier(nodes, modifier);
                    break;
            }
        });
        
        console.log('[WheelRenderer] Applied ' + recipe.modifiers.length + ' modifiers to ' + schoolName);
    },
    
    /**
     * Spiral modifier - rotates nodes based on their depth
     */
    applySpiralModifier: function(nodes, spokeAngle, modifier) {
        var tightness = modifier.tightness || 0.5;
        var direction = modifier.direction || 1;
        var maxTwist = 30 * tightness; // Max degrees of twist
        
        nodes.forEach(function(node) {
            if (!node.depth) return;
            
            var twist = (node.depth / 5) * maxTwist * direction;
            var newAngle = (node.angle || spokeAngle) + twist;
            var rad = newAngle * Math.PI / 180;
            var radius = node.radius || Math.sqrt(node.x * node.x + node.y * node.y);
            
            node.x = Math.cos(rad) * radius;
            node.y = Math.sin(rad) * radius;
            node.angle = newAngle;
        });
    },
    
    /**
     * Gravity modifier - pulls nodes toward a direction
     */
    applyGravityModifier: function(nodes, modifier) {
        var strength = modifier.strength || 0.3;
        var direction = modifier.direction || 'down';
        
        var pullX = 0, pullY = 0;
        switch (direction) {
            case 'down': pullY = 1; break;
            case 'up': pullY = -1; break;
            case 'left': pullX = -1; break;
            case 'right': pullX = 1; break;
            case 'center': pullX = 0; pullY = 0; break;
        }
        
        nodes.forEach(function(node) {
            var depth = node.depth || 1;
            var effect = strength * depth * 10;
            
            if (direction === 'center') {
                // Pull toward center
                var dist = Math.sqrt(node.x * node.x + node.y * node.y);
                if (dist > 0) {
                    node.x -= (node.x / dist) * effect * 0.5;
                    node.y -= (node.y / dist) * effect * 0.5;
                }
            } else {
                node.x += pullX * effect;
                node.y += pullY * effect;
            }
        });
    },
    
    /**
     * Wind modifier - directional displacement
     */
    applyWindModifier: function(nodes, modifier) {
        var angle = (modifier.angle || 45) * Math.PI / 180;
        var intensity = modifier.intensity || 0.3;
        
        var windX = Math.cos(angle) * intensity * 30;
        var windY = Math.sin(angle) * intensity * 30;
        
        nodes.forEach(function(node) {
            var depth = node.depth || 1;
            var effect = depth / 3;
            
            node.x += windX * effect;
            node.y += windY * effect;
        });
    },
    
    /**
     * Taper modifier - reduces spacing as depth increases
     */
    applyTaperModifier: function(nodes, spokeAngle, modifier) {
        var startScale = modifier.startScale || 1.0;
        var endScale = modifier.endScale || 0.3;
        
        var maxDepth = 0;
        nodes.forEach(function(node) {
            if ((node.depth || 0) > maxDepth) maxDepth = node.depth;
        });
        
        if (maxDepth === 0) return;
        
        nodes.forEach(function(node) {
            var depth = node.depth || 0;
            var t = depth / maxDepth;
            var scale = startScale + (endScale - startScale) * t;
            
            // Scale distance from spoke center line
            var spokeRad = spokeAngle * Math.PI / 180;
            var spokeX = Math.cos(spokeRad);
            var spokeY = Math.sin(spokeRad);
            
            // Project node onto spoke line
            var dist = Math.sqrt(node.x * node.x + node.y * node.y);
            var projLength = node.x * spokeX + node.y * spokeY;
            
            // Calculate perpendicular offset
            var projX = spokeX * projLength;
            var projY = spokeY * projLength;
            var offsetX = node.x - projX;
            var offsetY = node.y - projY;
            
            // Apply taper to offset
            node.x = projX + offsetX * scale;
            node.y = projY + offsetY * scale;
        });
    },
    
    /**
     * Attract modifier - pulls nodes toward a point
     */
    applyAttractModifier: function(nodes, modifier) {
        var targetX = modifier.x || 0;
        var targetY = modifier.y || 0;
        var strength = modifier.strength || 0.2;
        
        nodes.forEach(function(node) {
            var dx = targetX - node.x;
            var dy = targetY - node.y;
            var dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist > 0) {
                node.x += (dx / dist) * strength * 20;
                node.y += (dy / dist) * strength * 20;
            }
        });
    },
    
    /**
     * Repel modifier - pushes nodes away from a point
     */
    applyRepelModifier: function(nodes, modifier) {
        var sourceX = modifier.x || 0;
        var sourceY = modifier.y || 0;
        var strength = modifier.strength || 0.2;
        
        nodes.forEach(function(node) {
            var dx = node.x - sourceX;
            var dy = node.y - sourceY;
            var dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist > 0 && dist < 300) {
                var force = (1 - dist / 300) * strength * 30;
                node.x += (dx / dist) * force;
                node.y += (dy / dist) * force;
            }
        });
    },
    
    /**
     * Apply constraints from recipe
     */
    applyConstraintsToSchool: function(schoolName, nodes, spokeAngle, sectorAngle) {
        var recipe = this.growthRecipes[schoolName];
        if (!recipe || !recipe.constraints || recipe.constraints.length === 0) {
            return;
        }
        
        var self = this;
        
        recipe.constraints.forEach(function(constraint) {
            switch (constraint.type) {
                case 'minSpacing':
                    // Already handled by resolveCollisions, but can adjust
                    break;
                case 'clampHeight':
                    self.applyClampHeight(nodes, constraint);
                    break;
                case 'forceSymmetry':
                    self.applyForceSymmetry(nodes, spokeAngle, constraint);
                    break;
                case 'constrainToVolume':
                    self.applyVolumeConstraint(nodes, spokeAngle, sectorAngle, constraint, recipe.volume);
                    break;
            }
        });
    },
    
    applyClampHeight: function(nodes, constraint) {
        var maxHeight = constraint.maxHeight || 400;
        
        nodes.forEach(function(node) {
            var dist = Math.sqrt(node.x * node.x + node.y * node.y);
            if (dist > maxHeight) {
                var scale = maxHeight / dist;
                node.x *= scale;
                node.y *= scale;
                node.radius = maxHeight;
            }
        });
    },
    
    applyForceSymmetry: function(nodes, spokeAngle, constraint) {
        var axis = constraint.axis || 'vertical';
        var spokeRad = spokeAngle * Math.PI / 180;
        
        // Sort nodes by depth
        var byDepth = {};
        nodes.forEach(function(node) {
            var d = node.depth || 0;
            if (!byDepth[d]) byDepth[d] = [];
            byDepth[d].push(node);
        });
        
        // For each depth, mirror positions around spoke
        for (var d in byDepth) {
            var tier = byDepth[d];
            if (tier.length <= 1) continue;
            
            // Sort by angle offset from spoke
            tier.sort(function(a, b) {
                var aOffset = (a.angle || 0) - spokeAngle;
                var bOffset = (b.angle || 0) - spokeAngle;
                return aOffset - bOffset;
            });
            
            // Mirror positions
            var mid = Math.floor(tier.length / 2);
            for (var i = 0; i < mid; i++) {
                var left = tier[i];
                var right = tier[tier.length - 1 - i];
                
                var avgRadius = (left.radius + right.radius) / 2;
                var avgOffset = Math.abs(left.angle - spokeAngle);
                
                left.angle = spokeAngle - avgOffset;
                right.angle = spokeAngle + avgOffset;
                left.radius = avgRadius;
                right.radius = avgRadius;
                
                var leftRad = left.angle * Math.PI / 180;
                var rightRad = right.angle * Math.PI / 180;
                
                left.x = Math.cos(leftRad) * avgRadius;
                left.y = Math.sin(leftRad) * avgRadius;
                right.x = Math.cos(rightRad) * avgRadius;
                right.y = Math.sin(rightRad) * avgRadius;
            }
        }
    },
    
    applyVolumeConstraint: function(nodes, spokeAngle, sectorAngle, constraint, volume) {
        if (!volume) return;
        
        var spokeRad = spokeAngle * Math.PI / 180;
        var halfSector = (sectorAngle / 2) * Math.PI / 180;
        
        nodes.forEach(function(node) {
            var nodeAngleRad = Math.atan2(node.y, node.x);
            var dist = Math.sqrt(node.x * node.x + node.y * node.y);
            
            // Check if within sector
            var angleDiff = Math.abs(nodeAngleRad - spokeRad);
            if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
            
            if (angleDiff > halfSector) {
                // Clamp to sector edge
                var clampAngle = spokeRad + (nodeAngleRad > spokeRad ? halfSector : -halfSector);
                node.x = Math.cos(clampAngle) * dist;
                node.y = Math.sin(clampAngle) * dist;
                node.angle = clampAngle * 180 / Math.PI;
            }
            
            // Apply volume-specific constraints
            if (volume.type === 'cone') {
                var maxDist = volume.baseRadius || 350;
                var topRadius = volume.topRadius || 50;
                var height = volume.height || 400;
                
                // Cone narrows with distance
                var t = Math.min(dist / height, 1);
                var maxAtDist = maxDist - (maxDist - topRadius) * t;
                
                // Clamp perpendicular distance
                var projLength = Math.cos(nodeAngleRad - spokeRad) * dist;
                var perpDist = Math.abs(Math.sin(nodeAngleRad - spokeRad) * dist);
                
                if (perpDist > maxAtDist) {
                    var scale = maxAtDist / perpDist;
                    var perpX = node.x - Math.cos(spokeRad) * projLength;
                    var perpY = node.y - Math.sin(spokeRad) * projLength;
                    node.x = Math.cos(spokeRad) * projLength + perpX * scale;
                    node.y = Math.sin(spokeRad) * projLength + perpY * scale;
                }
            }
        });
    },

    clear: function() {
        this.nodes = [];
        this.edges = [];
        this.schools = {};
        this.nodeElements.clear();
        this.edgeElements.clear();
        this.selectedNode = null;
        this.clearRecipes();
        
        // Clear all caches to prevent memory leaks
        this._edgePathCache = {};
        this._nodeMap = null;
        this._nodeByFormId = null;
        this._visibleNodes.clear();
        this._renderedNodes.clear();
        this._renderedEdges.clear();
        this._layoutCalculated = false;
        
        if (this.spokesLayer) this.spokesLayer.innerHTML = '';
        if (this.edgesLayer) this.edgesLayer.innerHTML = '';
        if (this.nodesLayer) this.nodesLayer.innerHTML = '';
        if (this.centerHub) this.centerHub.innerHTML = '';
        if (this.debugGridLayer) this.debugGridLayer.innerHTML = '';
        
        this.centerView();
        
        console.log('[SpellLearning] WheelRenderer cleared (all caches reset)');
    },

    onMouseDown: function(e) {
        if (e.target.closest('.spell-node')) return;
        if (e.button === 0 || e.button === 2) {
            this.isPanning = true;
            this.panStartX = e.clientX - this.panX;
            this.panStartY = e.clientY - this.panY;
            this._pendingPanX = this.panX;
            this._pendingPanY = this.panY;
            this.svg.classList.add('dragging');
        }
    },

    onMouseMove: function(e) {
        if (this.isPanning) {
            this._pendingPanX = e.clientX - this.panStartX;
            this._pendingPanY = e.clientY - this.panStartY;
            
            // Use requestAnimationFrame for smooth 60fps updates
            if (!this._rafPending) {
                this._rafPending = true;
                var self = this;
                requestAnimationFrame(function() {
                    self._rafPending = false;
                    self.panX = self._pendingPanX;
                    self.panY = self._pendingPanY;
                    self.updateTransform();
                });
            }
        }
    },

    onMouseUp: function() {
        var wasPanning = this.isPanning;
        this.isPanning = false;
        this._rafPending = false;
        this.svg.classList.remove('dragging');
        
        // Trigger viewport update after pan ends for virtualized trees
        if (wasPanning && this.nodes.length > this._virtualizeThreshold) {
            this.updateVirtualizedView();
        }
    },

    onWheel: function(e) {
        e.preventDefault();
        var delta = -e.deltaY * TREE_CONFIG.zoom.wheelFactor * this.zoom;
        
        // Throttle zoom updates for large trees
        if (this.nodes.length > this._virtualizeThreshold && this._rafPending) {
            return;
        }
        
        this.setZoom(this.zoom + delta);
    },

    updateNodeStates: function() {
        var self = this;
        if (!this.nodes) return;
        
        this.nodes.forEach(function(node) {
            var el = self.nodeElements.get(node.id);
            if (el) {
                el.classList.remove('learning');
                el.classList.remove('on-learning-path');
            }
        });
        
        if (this.edgeElements) {
            this.edgeElements.forEach(function(edgeEl) {
                edgeEl.classList.remove('learning-path');
            });
        }
        
        var learningPathNodes = {};
        var learningPathEdges = {};
        
        for (var school in state.learningTargets) {
            var targetFormId = state.learningTargets[school];
            if (!targetFormId) continue;
            
            var targetNode = this._nodeByFormId ? this._nodeByFormId.get(targetFormId) : null;
            if (!targetNode || targetNode.state === 'unlocked') continue;
            
            self.tracePathToCenter(targetNode, learningPathNodes, learningPathEdges);
        }
        
        this.nodes.forEach(function(node) {
            var el = self.nodeElements.get(node.id);
            if (!el) return;
            
            el.classList.remove('locked', 'available', 'unlocked');
            el.classList.add(node.state || 'locked');
            
            var nodeBg = el.querySelector('.node-bg');
            if (nodeBg && node.state === 'unlocked') {
                nodeBg.classList.add('unlocked-bg');
            } else if (nodeBg) {
                nodeBg.classList.remove('unlocked-bg');
            }
            
            var _uCanonId = (typeof getCanonicalFormId === 'function') ? getCanonicalFormId(node) : node.formId;
            var isLearningTarget = state.learningTargets[node.school] === _uCanonId || state.learningTargets[node.school] === node.formId;
            var progress = state.spellProgress[_uCanonId];
            
            if (isLearningTarget && node.state !== 'unlocked') {
                el.classList.add('learning');
            } else if (learningPathNodes[node.id]) {
                el.classList.add('on-learning-path');
            }
            
            var progressEl = el.querySelector('.node-progress');
            if (progress && node.state === 'available' && !progress.unlocked) {
                var tier = self.getTierFromLevel(node.level);
                var tierScaleVal = 1;
                if (settings.nodeSizeScaling) {
                    tierScaleVal = 1 + ((tier - 1) * (TREE_CONFIG.tierScaling.maxScale - 1) / 4);
                }
                var nodeWidth = TREE_CONFIG.wheel.nodeWidth * tierScaleVal;
                var nodeHeight = TREE_CONFIG.wheel.nodeHeight * tierScaleVal;
                
                if (!progressEl) {
                    progressEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                    progressEl.classList.add('node-progress');
                    progressEl.setAttribute('height', 3);
                    progressEl.setAttribute('rx', 1.5);
                    el.appendChild(progressEl);
                }
                progressEl.setAttribute('x', -nodeWidth / 2);
                progressEl.setAttribute('y', nodeHeight / 2 + 2);
                var percent = progress.required > 0 ? (progress.xp / progress.required) : 0;
                progressEl.setAttribute('width', (nodeWidth * Math.min(percent, 1)));
                progressEl.classList.toggle('ready', progress.ready || percent >= 1);
            } else if (progressEl) {
                progressEl.remove();
            }
        });
        
        if (this.edgeElements) {
            this.edgeElements.forEach(function(edgeEl, edgeKey) {
                edgeEl.classList.remove('unlocked-path');
                edgeEl.removeAttribute('data-school');
                
                if (learningPathEdges[edgeKey]) {
                    edgeEl.classList.add('learning-path');
                }
            });
        }
        
        if (this.edgeElements && this.nodes) {
            var nodeMap = {};
            self.nodes.forEach(function(n) { nodeMap[n.id] = n; });
            
            this.edgeElements.forEach(function(edgeEl, edgeKey) {
                if (edgeEl.classList.contains('learning-path')) return;
                
                var parts = edgeKey.split('-');
                var fromId = parts[0];
                var toId = parts[1];
                var fromNode = nodeMap[fromId];
                var toNode = nodeMap[toId];
                
                if (fromNode && toNode && fromNode.state === 'unlocked' && toNode.state === 'unlocked') {
                    edgeEl.classList.add('unlocked-path');
                    edgeEl.setAttribute('data-school', toNode.school || fromNode.school);
                }
            });
        }
    },
    
    tracePathToCenter: function(node, pathNodes, pathEdges) {
        if (!node || !node.prerequisites) return;
        
        var self = this;
        var nodeMap = {};
        this.nodes.forEach(function(n) { nodeMap[n.id] = n; });
        
        var visited = {};
        var queue = [node];
        
        while (queue.length > 0) {
            var current = queue.shift();
            if (visited[current.id]) continue;
            visited[current.id] = true;
            
            if (current.id !== node.id) {
                pathNodes[current.id] = true;
            }
            
            if (current.prerequisites && current.prerequisites.length > 0) {
                current.prerequisites.forEach(function(prereqId) {
                    var prereqNode = nodeMap[prereqId];
                    if (prereqNode && !visited[prereqId]) {
                        queue.push(prereqNode);
                        pathEdges[prereqId + '-' + current.id] = true;
                    }
                });
            }
        }
    }
};
