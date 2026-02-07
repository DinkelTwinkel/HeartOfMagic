/**
 * Layout Engine - Unified position calculation for spell trees
 *
 * This is THE SINGLE SOURCE OF TRUTH for all position calculations.
 * Both tree builders and renderers should use this engine.
 *
 * Depends on:
 * - config.js (GRID_CONFIG)
 * - shapeProfiles.js (SHAPE_PROFILES, SHAPE_MASKS)
 * - growthBehaviors.js (GROWTH_BEHAVIORS) - optional
 *
 * Exports (global):
 * - LayoutEngine.calculatePositions(spells, schoolConfig, options)
 * - LayoutEngine.applyGrowthBehavior(positions, behaviorName, rng)
 * - LayoutEngine.getNodePosition(tier, angleNorm, shape)
 */

// =============================================================================
// LAYOUT ENGINE
// =============================================================================

// Log to SKSE log file via C++ bridge (visible in Documents/My Games/.../SKSE/SpellLearning.log)
function _skseLog(msg) {
    if (window.callCpp) {
        window.callCpp('LogMessage', JSON.stringify({ level: 'info', message: '[LayoutEngine] ' + msg }));
    }
    console.log('[LayoutEngine] ' + msg);
}

var LayoutEngine = {
    // Cached configuration
    _config: null,

    // =================================================================
    // INITIALIZATION
    // =================================================================

    /**
     * Get the base layout configuration
     * @returns {Object} - Layout config from GRID_CONFIG
     */
    getConfig: function() {
        if (this._config) return this._config;

        // Use GRID_CONFIG as the single source
        if (typeof GRID_CONFIG !== 'undefined') {
            this._config = GRID_CONFIG.getComputedConfig();
        } else {
            // Fallback defaults (should never happen)
            this._config = {
                nodeSize: 75,
                baseRadius: 90,
                tierSpacing: 52,
                arcSpacing: 56,
                minNodeSpacing: 52,
                maxTiers: 25,
                schoolPadding: 15
            };
        }
        return this._config;
    },

    /**
     * Clear cached config (call after GRID_CONFIG changes)
     */
    clearCache: function() {
        this._config = null;
    },

    // =================================================================
    // CORE POSITION CALCULATION
    // =================================================================

    /**
     * Calculate x,y position from tier and angle
     * @param {number} tier - Tier index (0 = center)
     * @param {number} angleDeg - Angle in degrees
     * @param {Object} shapeConfig - Optional shape-adjusted config
     * @returns {Object} - {x, y, radius, angle}
     */
    getNodePosition: function(tier, angleDeg, shapeConfig) {
        var cfg = shapeConfig || this.getConfig();
        var radius = cfg.baseRadius + tier * cfg.tierSpacing;
        var angleRad = angleDeg * Math.PI / 180;

        return {
            x: Math.cos(angleRad) * radius,
            y: Math.sin(angleRad) * radius,
            radius: radius,
            angle: angleDeg
        };
    },

    /**
     * Calculate positions with jitter applied
     * @param {number} tier
     * @param {number} angleDeg
     * @param {string} shapeName - Shape profile to use
     * @param {function} rng - Random number generator
     * @returns {Object} - {x, y, radius, angle} with jitter
     */
    getNodePositionWithJitter: function(tier, angleDeg, shapeName, rng) {
        var cfg = this.getConfig();

        // Get profile with guaranteed defaults
        var profile = { radiusJitter: 0.1, angleJitter: 5 };
        if (typeof getShapeProfile === 'function') {
            var p = getShapeProfile(shapeName);
            if (p) {
                profile.radiusJitter = typeof p.radiusJitter === 'number' ? p.radiusJitter : 0.1;
                profile.angleJitter = typeof p.angleJitter === 'number' ? p.angleJitter : 5;
            }
        }

        var baseRadius = cfg.baseRadius + (tier || 0) * cfg.tierSpacing;

        // Apply radius jitter (with NaN protection)
        var radiusJitter = (rng() - 0.5) * 2 * profile.radiusJitter * baseRadius;
        var radius = baseRadius + (isFinite(radiusJitter) ? radiusJitter : 0);

        // Apply angle jitter (with NaN protection)
        var angleJitter = (rng() - 0.5) * 2 * profile.angleJitter;
        var angleDegJittered = (angleDeg || 0) + (isFinite(angleJitter) ? angleJitter : 0);

        var angleRad = angleDegJittered * Math.PI / 180;

        return {
            x: Math.cos(angleRad) * radius,
            y: Math.sin(angleRad) * radius,
            radius: radius,
            angle: angleDegJittered,
            baseRadius: baseRadius,
            baseAngle: angleDeg || 0
        };
    },

    // =================================================================
    // SECTOR CALCULATION
    // =================================================================

    /**
     * Calculate sector info for a school
     * @param {number} schoolIndex - Index of school (0-4 for 5 schools)
     * @param {number} totalSchools - Total number of schools
     * @returns {Object} - {spokeAngle, sectorAngle, startAngle, endAngle}
     */
    calculateSector: function(schoolIndex, totalSchools) {
        var cfg = this.getConfig();
        var sectorAngle = 360 / totalSchools;
        var spokeAngle = schoolIndex * sectorAngle + sectorAngle / 2;

        return {
            spokeAngle: spokeAngle,
            sectorAngle: sectorAngle,
            startAngle: spokeAngle - sectorAngle / 2 + cfg.schoolPadding / 2,
            endAngle: spokeAngle + sectorAngle / 2 - cfg.schoolPadding / 2,
            usableAngle: sectorAngle - cfg.schoolPadding
        };
    },

    // =================================================================
    // FIXED GRID POSITIONS - Single source of truth matching debug grid
    // =================================================================

    /**
     * Get ALL fixed grid positions for a school sector.
     * These are the EXACT same positions shown by the debug grid toggle.
     * This is the centralized grid system - all tree generation should use this.
     *
     * @param {number} schoolIndex - Index of school (0-4 for 5 schools)
     * @param {number} totalSchools - Total number of schools (default 5)
     * @returns {Array} - Array of {x, y, tier, slotIndex, angle, radius} for ALL valid positions
     */
    getFixedGridPositions: function(schoolIndex, totalSchools) {
        var cfg = this.getConfig();
        totalSchools = totalSchools || 5;

        // Account for school padding to align with wheelRenderer sector borders
        var totalPadding = totalSchools * (cfg.schoolPadding || 5);
        var availableAngle = 360 - totalPadding;
        var sliceAngle = availableAngle / totalSchools;
        var startAngle = schoolIndex * (sliceAngle + (cfg.schoolPadding || 5)) - 90;
        var usableAngle = sliceAngle * 0.85;
        var centerAngle = startAngle + sliceAngle / 2;
        var halfSpread = usableAngle / 2;

        var positions = [];

        // Generate positions for each tier (same logic as renderDebugGrid)
        for (var tier = 0; tier < cfg.maxTiers; tier++) {
            var radius = cfg.baseRadius + tier * cfg.tierSpacing;

            // Calculate arc length and candidate count (same as renderDebugGrid)
            var arcLength = (sliceAngle / 360) * 2 * Math.PI * radius;
            var candidateCount = Math.max(3, Math.floor(arcLength / cfg.arcSpacing));

            var angleStep = candidateCount > 1 ? usableAngle / (candidateCount - 1) : 0;

            for (var i = 0; i < candidateCount; i++) {
                var angle = candidateCount === 1
                    ? centerAngle
                    : (centerAngle - halfSpread + i * angleStep);
                var rad = angle * Math.PI / 180;
                var x = Math.cos(rad) * radius;
                var y = Math.sin(rad) * radius;

                positions.push({
                    x: x,
                    y: y,
                    tier: tier,
                    slotIndex: i,
                    slotsInTier: candidateCount,
                    angle: angle,
                    radius: radius,
                    schoolIndex: schoolIndex,
                    _isFixedGrid: true
                });
            }
        }

        console.log('[LayoutEngine] Generated', positions.length, 'fixed grid positions for school', schoolIndex);
        return positions;
    },

    /**
     * Get fixed grid positions filtered by tier range
     * @param {number} schoolIndex
     * @param {number} totalSchools
     * @param {number} maxTier - Only include positions up to this tier
     * @returns {Array}
     */
    getFixedGridPositionsForTiers: function(schoolIndex, totalSchools, maxTier) {
        var allPositions = this.getFixedGridPositions(schoolIndex, totalSchools);
        return allPositions.filter(function(p) {
            return p.tier <= maxTier;
        });
    },

    /**
     * Find the nearest unoccupied grid position for a spell
     * @param {Object} spell - Spell with tier info
     * @param {Array} availablePositions - Array of unoccupied positions
     * @param {number} preferredTier - Tier to prefer (usually spell's tier)
     * @returns {Object|null} - Best matching position or null
     */
    findBestGridPosition: function(spell, availablePositions, preferredTier) {
        if (!availablePositions || availablePositions.length === 0) return null;

        // First try to find a position at the preferred tier
        var sameTier = availablePositions.filter(function(p) {
            return p.tier === preferredTier;
        });

        if (sameTier.length > 0) {
            // Return the middle position of this tier for balanced distribution
            return sameTier[Math.floor(sameTier.length / 2)];
        }

        // If no positions at preferred tier, find closest tier
        var sorted = availablePositions.slice().sort(function(a, b) {
            return Math.abs(a.tier - preferredTier) - Math.abs(b.tier - preferredTier);
        });

        return sorted[0];
    },

    // =================================================================
    // LEGACY GRID GENERATION (kept for backwards compatibility)
    // =================================================================

    /**
     * Generate a grid of positions for a school sector
     * @deprecated Use getFixedGridPositions instead
     * @param {Object} sector - Sector info from calculateSector
     * @param {number} spellCount - Number of spells to place
     * @param {string} shapeName - Shape profile to use
     * @param {number} seed - Random seed for reproducibility
     * @returns {Array} - Array of position objects
     */
    generateGrid: function(sector, spellCount, shapeName, seed) {
        var cfg = this.getConfig();

        // Safety check for invalid inputs
        if (!sector || !spellCount || spellCount <= 0) {
            console.warn('[LayoutEngine] generateGrid: Invalid sector or spellCount');
            return [];
        }

        // Get profile with fallback
        var profile = { radiusJitter: 0.1, angleJitter: 5, tierSpacingMult: 1, densityMult: 1 };
        if (typeof getShapeProfile === 'function') {
            profile = getShapeProfile(shapeName) || profile;
        } else if (typeof SHAPE_PROFILES !== 'undefined' && SHAPE_PROFILES[shapeName]) {
            profile = SHAPE_PROFILES[shapeName];
        }

        var mask = typeof getShapeMask === 'function'
            ? getShapeMask(shapeName)
            : function() { return true; };

        var rng = this._createSeededRandom(seed);
        var positions = [];

        // Calculate how many tiers we need (ensure at least 1)
        var numTiers = Math.max(1, Math.min(cfg.maxTiers, Math.ceil(Math.sqrt(spellCount) * 1.5)));

        // Adjust tier spacing for shape (ensure positive)
        var tierSpacing = Math.max(10, cfg.tierSpacing * (profile.tierSpacingMult || 1));

        // Validate sector angles
        var usableAngle = sector.usableAngle || 60;  // Default to 60 degrees if missing
        var startAngle = sector.startAngle || 0;

        // Generate positions tier by tier
        for (var tier = 0; tier < numTiers; tier++) {
            var radius = cfg.baseRadius + tier * tierSpacing;
            var arcLength = (usableAngle / 360) * 2 * Math.PI * radius;

            // How many nodes can fit on this tier (ensure at least 1)
            var nodesOnTier = Math.max(1, Math.floor(arcLength / cfg.arcSpacing));

            // Apply taper for mountain shape
            if (profile.taperSpread) {
                var taperAmount = profile.taperAmount || 0.5;
                var depthNorm = numTiers > 1 ? tier / (numTiers - 1) : 0;
                nodesOnTier = Math.max(1, Math.floor(nodesOnTier * (1 - depthNorm * (1 - taperAmount))));
            }

            // Apply density multiplier (ensure at least 1 node per tier)
            var densityMult = profile.densityMult || 1;
            nodesOnTier = Math.max(1, Math.floor(nodesOnTier * densityMult));

            // Generate node positions on this tier
            for (var i = 0; i < nodesOnTier; i++) {
                var angleNorm = nodesOnTier > 1 ? i / (nodesOnTier - 1) : 0.5;
                var angle = startAngle + angleNorm * usableAngle;

                // Check shape mask (use safe depthNorm)
                var tierDepthNorm = numTiers > 1 ? tier / (numTiers - 1) : 0;
                if (!mask(tierDepthNorm, angleNorm, rng, profile)) {
                    continue;
                }

                // Get position with jitter
                var pos = this.getNodePositionWithJitter(tier, angle, shapeName, rng);

                // Validate position values (prevent NaN)
                var x = isFinite(pos.x) ? pos.x : 0;
                var y = isFinite(pos.y) ? pos.y : 0;

                positions.push({
                    tier: tier,
                    tierNorm: tierDepthNorm,
                    angleNorm: angleNorm,
                    x: x,
                    y: y,
                    radius: isFinite(pos.radius) ? pos.radius : cfg.baseRadius,
                    angle: isFinite(pos.angle) ? pos.angle : angle,
                    baseRadius: isFinite(pos.baseRadius) ? pos.baseRadius : cfg.baseRadius,
                    baseAngle: isFinite(pos.baseAngle) ? pos.baseAngle : angle,
                    shape: shapeName,
                    isRoot: tier === 0 && i === Math.floor(nodesOnTier / 2)
                });
            }

            // Early exit if we have enough positions
            if (positions.length >= spellCount * 1.2) break;
        }

        return positions;
    },

    // =================================================================
    // GROWTH BEHAVIOR APPLICATION
    // =================================================================

    /**
     * Apply growth behavior to positions
     * @param {Array} positions - Array of position objects
     * @param {string} behaviorName - Growth behavior name
     * @param {function} rng - Random number generator
     * @returns {Array} - Modified positions
     */
    applyGrowthBehavior: function(positions, behaviorName, rng) {
        if (typeof GROWTH_BEHAVIORS === 'undefined') {
            console.log('[LayoutEngine] GROWTH_BEHAVIORS not available, skipping');
            return positions;
        }

        var behavior = GROWTH_BEHAVIORS[behaviorName];
        if (!behavior) {
            console.log('[LayoutEngine] Unknown behavior:', behaviorName);
            return positions;
        }

        var cfg = this.getConfig();
        var self = this;

        return positions.map(function(pos, idx) {
            var progress = idx / positions.length;
            var phase = self._getPhaseParams(behavior, progress);

            // Apply vertical bias
            var verticalBias = phase.verticalBias !== undefined ? phase.verticalBias : behavior.verticalBias || 0;
            var radiusAdjust = 1 + verticalBias * 0.2;
            var newRadius = pos.radius * radiusAdjust;

            // Apply spread factor
            var spreadFactor = phase.spreadFactor !== undefined ? phase.spreadFactor : behavior.spreadFactor || 0.5;
            var centerAngle = (pos.baseAngle || pos.angle);
            var spreadAmount = (pos.angle - centerAngle) * spreadFactor;
            var newAngle = centerAngle + spreadAmount;

            // Apply angular wander
            var wander = behavior.angularWander || 0;
            newAngle += (rng() - 0.5) * wander;

            // Apply wave if present
            if (behavior.waveAmplitude) {
                var wavePhase = progress * Math.PI * 2 * (behavior.waveFrequency || 1);
                newAngle += Math.sin(wavePhase) * behavior.waveAmplitude;
            }

            var angleRad = newAngle * Math.PI / 180;

            return Object.assign({}, pos, {
                x: Math.cos(angleRad) * newRadius,
                y: Math.sin(angleRad) * newRadius,
                radius: newRadius,
                angle: newAngle,
                behaviorApplied: behaviorName
            });
        });
    },

    /**
     * Get phase-adjusted parameters based on progress
     */
    _getPhaseParams: function(behavior, progress) {
        if (!behavior.phases || behavior.phases.length === 0) {
            return {};
        }

        // Find active phase
        var activePhase = null;
        for (var i = behavior.phases.length - 1; i >= 0; i--) {
            if (progress >= behavior.phases[i].at) {
                activePhase = behavior.phases[i];
                break;
            }
        }

        return activePhase ? activePhase.changes : {};
    },

    // =================================================================
    // FULL LAYOUT CALCULATION
    // =================================================================

    /**
     * Calculate full layout for a school's spells
     * @param {Array} spells - Array of spell objects
     * @param {Object} schoolConfig - School configuration
     * @param {Object} options - Layout options
     * @returns {Array} - Spells with positions assigned
     */
    calculatePositions: function(spells, schoolConfig, options) {
        options = options || {};

        var cfg = this.getConfig();
        var shapeName = schoolConfig.shape || options.shape || 'organic';
        var behaviorName = schoolConfig.growthBehavior || options.growthBehavior || null;
        var seed = options.seed || Date.now();

        var rng = this._createSeededRandom(seed);

        // Get sector info
        var sector = this.calculateSector(
            schoolConfig.index || 0,
            schoolConfig.totalSchools || 5
        );

        // Generate grid positions
        var positions = this.generateGrid(sector, spells.length, shapeName, seed);

        // Apply growth behavior if specified
        if (behaviorName && typeof GROWTH_BEHAVIORS !== 'undefined') {
            positions = this.applyGrowthBehavior(positions, behaviorName, rng);
        }

        // Sort spells by tier
        var sortedSpells = spells.slice().sort(function(a, b) {
            var tierA = typeof getSpellTier === 'function' ? getSpellTier(a) : (a.tier || 0);
            var tierB = typeof getSpellTier === 'function' ? getSpellTier(b) : (b.tier || 0);
            return tierA - tierB;
        });

        // Assign spells to positions
        var result = [];
        for (var i = 0; i < sortedSpells.length && i < positions.length; i++) {
            var spell = sortedSpells[i];
            var pos = positions[i];

            result.push(Object.assign({}, spell, {
                x: pos.x,
                y: pos.y,
                radius: pos.radius,
                angle: pos.angle,
                tier: pos.tier,
                isRoot: pos.isRoot,
                shape: pos.shape,
                _fromLayoutEngine: true
            }));
        }

        return result;
    },

    // =================================================================
    // UTILITIES
    // =================================================================

    /**
     * Create a seeded random number generator
     */
    _createSeededRandom: function(seed) {
        var m = 0x80000000;
        var a = 1103515245;
        var c = 12345;
        var state = seed || Date.now();

        return function() {
            state = (a * state + c) % m;
            return state / m;
        };
    },

    /**
     * Calculate distance between two points
     */
    distance: function(p1, p2) {
        var dx = p1.x - p2.x;
        var dy = p1.y - p2.y;
        return Math.sqrt(dx * dx + dy * dy);
    },

    /**
     * Check if two nodes overlap
     */
    nodesOverlap: function(n1, n2, minSpacing) {
        var cfg = this.getConfig();
        minSpacing = minSpacing || cfg.minNodeSpacing;
        return this.distance(n1, n2) < minSpacing;
    },

    /**
     * Resolve overlaps by nudging nodes
     */
    resolveOverlaps: function(positions, iterations) {
        var cfg = this.getConfig();
        var minSpacing = cfg.minNodeSpacing;
        iterations = iterations || 3;

        for (var iter = 0; iter < iterations; iter++) {
            var moved = false;

            for (var i = 0; i < positions.length; i++) {
                for (var j = i + 1; j < positions.length; j++) {
                    var dist = this.distance(positions[i], positions[j]);

                    if (dist < minSpacing && dist > 0) {
                        // Calculate push direction
                        var dx = positions[j].x - positions[i].x;
                        var dy = positions[j].y - positions[i].y;
                        var pushDist = (minSpacing - dist) / 2;
                        var pushX = (dx / dist) * pushDist;
                        var pushY = (dy / dist) * pushDist;

                        // Push nodes apart
                        positions[i].x -= pushX;
                        positions[i].y -= pushY;
                        positions[j].x += pushX;
                        positions[j].y += pushY;

                        moved = true;
                    }
                }
            }

            if (!moved) break;
        }

        return positions;
    },

    // =================================================================
    // TREE-LEVEL POSITION APPLICATION
    // =================================================================

    /**
     * Apply positions to all nodes in a tree structure.
     * This is the main integration point for settingsAwareTreeBuilder.
     *
     * GROWTH-BEHAVIOR-AWARE: Uses shape masks, growth behaviors, and vertical bias.
     * - Shape masks filter which grid positions are valid (spiky = rays, mountain = triangle)
     * - Growth behaviors control vertical vs horizontal expansion
     * - Angular wander allows children to spread from parent
     * - layerFillThreshold controls when to move to next tier
     *
     * @param {Object} treeData - Tree data with schools property
     * @param {Object} options - Layout options {shape, seed, schoolConfigs}
     * @returns {Object} - Same treeData with positions applied to nodes
     */
    applyPositionsToTree: function(treeData, options) {
        options = options || {};
        var self = this;

        if (!treeData || !treeData.schools) {
            console.warn('[LayoutEngine] applyPositionsToTree: No schools in treeData');
            return treeData;
        }

        var schoolNames = Object.keys(treeData.schools);
        var totalSchools = schoolNames.length;
        var cfg = self.getConfig();

        console.log('[LayoutEngine] Applying GROWTH-BEHAVIOR-AWARE positions to', totalSchools, 'schools');

        schoolNames.forEach(function(schoolName, schoolIndex) {
            var school = treeData.schools[schoolName];
            if (!school || !school.nodes || school.nodes.length === 0) {
                console.log('[LayoutEngine] Skipping empty school:', schoolName);
                return;
            }

            var schoolConfig = options.schoolConfigs ? options.schoolConfigs[schoolName] : null;

            // Get shape: per-school config > SCHOOL_DEFAULT_SHAPES > options.shape > 'organic'
            var shapeName = (schoolConfig && schoolConfig.shape);
            if (!shapeName && typeof SCHOOL_DEFAULT_SHAPES !== 'undefined') {
                shapeName = SCHOOL_DEFAULT_SHAPES[schoolName];
            }
            if (!shapeName) {
                shapeName = options.shape || 'organic';
            }

            // Get growth behavior for this school
            var behavior = null;
            if (typeof GROWTH_BEHAVIORS !== 'undefined') {
                // Map schools to behaviors
                var behaviorMap = {
                    'Destruction': 'fire_explosion',
                    'Restoration': 'gentle_bloom',
                    'Alteration': 'mountain_builder',
                    'Conjuration': 'portal_network',
                    'Illusion': 'spider_web'
                };
                var behaviorName = behaviorMap[schoolName];
                behavior = behaviorName ? GROWTH_BEHAVIORS[behaviorName] : null;
                if (behavior) {
                    _skseLog(schoolName + ': Growth behavior=' + behaviorName +
                        ' (vertBias=' + (behavior.verticalBias || 0) +
                        ', spread=' + (behavior.spreadFactor || 0.6) +
                        ', wander=' + (behavior.angularWander || 15) + ')');
                }
            }

            // Get shape profile and mask
            var shapeProfile = typeof getShapeProfile === 'function' ? getShapeProfile(shapeName) : null;
            var shapeMask = typeof getShapeMask === 'function' ? getShapeMask(shapeName) : function() { return true; };
            shapeProfile = shapeProfile || { radiusJitter: 0.1, angleJitter: 5 };

            // Extract shape-aware growth parameters
            var shapSpreadMult = typeof shapeProfile.spreadMult === 'number' ? shapeProfile.spreadMult : 1.0;
            var shapTierMult = typeof shapeProfile.tierSpacingMult === 'number' ? shapeProfile.tierSpacingMult : 1.0;
            var shapHasTaper = shapeProfile.taperSpread || false;
            var shapTaperAmount = typeof shapeProfile.taperAmount === 'number' ? shapeProfile.taperAmount : 0.5;

            // Create seeded RNG
            var seed = (options.seed || Date.now()) + self._hashString(schoolName);
            var rng = self._createSeededRandom(seed);

            // Get ALL fixed grid positions for this school
            var allGridPositions = self.getFixedGridPositions(schoolIndex, totalSchools);
            var totalSpells = school.nodes.length;

            console.log('[LayoutEngine]', schoolName + ':', totalSpells, 'spells, shape=' + shapeName +
                        (behavior ? ', behavior=' + (behavior.name || 'custom') : ''));

            // Build node lookup by formId
            var nodeByFormId = {};
            school.nodes.forEach(function(n) { nodeByFormId[n.formId] = n; });

            // Find root node(s) - support multi-root trees
            var allRootNodes = school.nodes.filter(function(n) { return n.isRoot; });
            if (allRootNodes.length === 0) {
                allRootNodes = [school.nodes.find(function(n) { return n.tier === 0; }) || school.nodes[0]];
            }
            var rootNode = allRootNodes[0];

            if (!rootNode) {
                console.warn('[LayoutEngine]', schoolName + ': No root node found!');
                return;
            }

            // === FILTER POSITIONS BY SHAPE MASK ===
            // Use padding-aware sector angles to match wheelRenderer
            var totalPaddingForSlice = totalSchools * (cfg.schoolPadding || 5);
            var availableAngleForSlice = 360 - totalPaddingForSlice;
            var sliceAngle = availableAngleForSlice / totalSchools;
            var centerAngle = schoolIndex * (sliceAngle + (cfg.schoolPadding || 5)) - 90 + sliceAngle / 2;
            var maxTierUsed = Math.max.apply(null, allGridPositions.map(function(p) { return p.tier; }));

            // Build shape mask set: positions passing mask get scoring bonus (soft filter)
            var shapeMaskedSet = {};
            var maskedCount = 0;
            allGridPositions.forEach(function(pos) {
                var key = pos.tier + '_' + pos.slotIndex;
                if (pos.tier === 0) { shapeMaskedSet[key] = true; maskedCount++; return; }
                var depthNorm = maxTierUsed > 0 ? pos.tier / maxTierUsed : 0;
                var slotsInTier = pos.slotsInTier || 3;
                var angleNorm = slotsInTier > 1 ? pos.slotIndex / (slotsInTier - 1) : 0.5;
                if (shapeMask(depthNorm, angleNorm, rng, shapeProfile)) {
                    shapeMaskedSet[key] = true;
                    maskedCount++;
                }
            });

            // Use ALL grid positions — shape preference applied via scoring, not hard filter
            var validPositions = allGridPositions;
            _skseLog(schoolName + ': Shape ' + shapeName + ' mask=' + maskedCount + '/' + allGridPositions.length +
                ' (spreadMult=' + shapSpreadMult.toFixed(2) + ', tierMult=' + shapTierMult.toFixed(2) +
                (shapHasTaper ? ', taper=' + shapTaperAmount : '') + ')');

            // Mark positions as used
            var usedPositions = new Set();

            // (Edge-line collision detection removed — handled at render time via curved edges)

            // === SPACING SKIP ===
            // Calculate how many positions to skip between placed nodes
            // More nodes = less skip (denser), fewer nodes = more skip (spacier)
            var gridCapacity = validPositions.length;
            var skipFactor = Math.max(0, Math.floor((gridCapacity / totalSpells) - 1));
            skipFactor = Math.min(skipFactor, 2);  // Cap at 2 (skip at most 2 adjacent slots)

            // Shape-specific skip overrides — shapes need different node densities
            if (shapeName === 'spiky') skipFactor = 0;       // Tight on rays — no spacing
            else if (shapeName === 'swords') skipFactor = 0;   // Dense blade fill
            else if (shapeName === 'explosion') skipFactor = 0; // Dense core packing
            else if (shapeName === 'mountain') skipFactor = 0;  // Dense base packing
            else if (shapeName === 'portals') skipFactor = 0;   // Dense (holes remove nodes via mask)
            else if (shapeName === 'cloud') skipFactor = Math.min(3, skipFactor + 1); // Extra gaps
            console.log('[LayoutEngine]', schoolName + ': Skip factor=' + skipFactor + ' (capacity=' + gridCapacity + ', spells=' + totalSpells + ', shape=' + shapeName + ')');

            // Helper: mark a position and its adjacent slots as used
            function markPositionUsed(pos) {
                usedPositions.add(pos.tier + '_' + pos.slotIndex);

                // Mark adjacent slots on same tier as spacing-reserved
                for (var skip = 1; skip <= skipFactor; skip++) {
                    usedPositions.add(pos.tier + '_' + (pos.slotIndex + skip));
                    usedPositions.add(pos.tier + '_' + (pos.slotIndex - skip));
                }
            }

            // === GET GROWTH BEHAVIOR SETTINGS ===
            var verticalBias = behavior ? (behavior.verticalBias || 0) : 0;
            var layerFillThreshold = behavior ? (behavior.layerFillThreshold || 0.3) : 0.3;
            var angularWander = behavior ? (behavior.angularWander || 15) : 15;
            var spreadFactor = behavior ? (behavior.spreadFactor || 0.6) : 0.6;

            // Apply shape profile to growth parameters
            // Narrow shapes (spiky=0.6, linear=0.5) → less wander/spread
            // Wide shapes (mountain=1.0, radial=1.0) → full wander/spread
            angularWander = angularWander * shapSpreadMult;
            spreadFactor = spreadFactor * shapSpreadMult;

            // Shape-specific behavior overrides — force growth pattern to match silhouette
            if (shapeName === 'spiky') {
                verticalBias = 0.9;        // Always push outward for elongated spikes
                angularWander = 2;         // Almost no wander — stay on ray
                layerFillThreshold = 0.1;  // Don't wait — advance immediately
            } else if (shapeName === 'swords') {
                verticalBias = 0.7;        // Push outward (elongated blades)
                angularWander = 8;         // Moderate — stay within blade width
                layerFillThreshold = 0.2;  // Advance quickly for blade length
            } else if (shapeName === 'explosion') {
                verticalBias = 0.75;       // Strong outward push (blast radiates)
                angularWander = 5;         // Moderate — mask/conformity handles shape
                layerFillThreshold = 0.10; // Dense core, then rapid advance outward
            } else if (shapeName === 'tree') {
                verticalBias = 0.7;        // Push outward for trunk + canopy
                angularWander = 4;         // Allow some trunk width
                layerFillThreshold = 0.15; // Some inner fill for visible trunk
            } else if (shapeName === 'mountain') {
                verticalBias = -0.8;       // Pack inner tiers densely (wide base)
                layerFillThreshold = 0.9;  // Fill 90% before advancing (dense layers)
            } else if (shapeName === 'cloud') {
                verticalBias = 0.0;        // No preference — scatter to any depth
                angularWander = 40;        // Maximum scatter
            } else if (shapeName === 'cascade') {
                verticalBias = 0.3;        // Slight outward preference
                layerFillThreshold = 0.5;  // Balanced tier filling
            }

            // Track tier fill levels
            var tierFillCounts = {};
            var tierCapacities = {};
            validPositions.forEach(function(p) {
                tierCapacities[p.tier] = (tierCapacities[p.tier] || 0) + 1;
                tierFillCounts[p.tier] = 0;
            });

            // === POSITION ALL ROOTS ===
            // In multi-root mode, all roots go at tier 0 (center ring)
            var tier0Positions = validPositions.filter(function(p) {
                return p.tier === 0;
            });

            // Spread roots across 50% of usable angle — keeps them well inside sector borders
            var usableAngle = sliceAngle * 0.85;
            var rootSpreadTotal = allRootNodes.length > 1 ? usableAngle * 0.5 : 0;
            var rootStep = allRootNodes.length > 1 ? rootSpreadTotal / (allRootNodes.length - 1) : 0;
            var processedFormIds = new Set();
            var assignedCount = 0;
            var rootRadius = cfg.baseRadius;  // tier 0 radius

            allRootNodes.forEach(function(rn, rIdx) {
                var targetAngle = allRootNodes.length > 1
                    ? centerAngle - rootSpreadTotal / 2 + rIdx * rootStep
                    : centerAngle;

                // Place roots at EXACT target angle — don't snap to grid
                // Roots define the tree center, they should be precisely positioned
                var rad = targetAngle * Math.PI / 180;
                rn.x = Math.cos(rad) * rootRadius;
                rn.y = Math.sin(rad) * rootRadius;
                rn.radius = rootRadius;
                rn.angle = targetAngle;
                rn._gridTier = 0;
                rn._fromLayoutEngine = true;
                rn._gridSlot = '0_root_' + rIdx;

                // Mark closest tier-0 grid slot as used so children don't land on top of root
                var closestSlot = tier0Positions.filter(function(p) {
                    return !usedPositions.has(p.tier + '_' + p.slotIndex);
                }).sort(function(a, b) {
                    return Math.abs(a.angle - targetAngle) - Math.abs(b.angle - targetAngle);
                })[0];
                if (closestSlot) {
                    usedPositions.add(closestSlot.tier + '_' + closestSlot.slotIndex);
                }
                tierFillCounts[0] = (tierFillCounts[0] || 0) + 1;
                processedFormIds.add(rn.formId);
                assignedCount++;

                _skseLog(schoolName + ': Root ' + rIdx + ' (' + (rn.name || rn.formId) + ') at angle ' + targetAngle.toFixed(1) + ' (center=' + centerAngle.toFixed(1) + ')');
            });

            console.log('[LayoutEngine]', schoolName + ': Positioned', allRootNodes.length, 'root nodes at tier 0',
                        '(spread=' + rootSpreadTotal.toFixed(1) + '° across ' + usableAngle.toFixed(1) + '° usable)');

            // === LEVEL-BASED ROUND-ROBIN BFS GROWTH ===
            // Level 0: All roots place their children first (evenly spread)
            // Level 1+: Each parent takes turns placing ONE child, cycling through parents
            // New children added to NEXT level queue (not current)

            // Current level heads: start with ALL root nodes
            // Track rootAngle for sub-sector containment in multi-root mode
            var isMultiRoot = allRootNodes.length > 1;
            var currentLevel = allRootNodes.map(function(rn) {
                return {
                    node: rn,
                    childIndex: 0,
                    numChildren: (rn.children || []).length,
                    baseSpread: sliceAngle * spreadFactor / Math.max((rn.children || []).length, 1),
                    rootAngle: rn.angle || centerAngle
                };
            });
            var nextLevel = [];

            var totalRootChildren = allRootNodes.reduce(function(sum, rn) { return sum + (rn.children || []).length; }, 0);
            console.log('[LayoutEngine] Level-based round-robin starting with', totalRootChildren, 'root children from', allRootNodes.length, 'roots');

            while (currentLevel.length > 0 || nextLevel.length > 0) {
                // If current level exhausted, move to next level
                if (currentLevel.length === 0) {
                    currentLevel = nextLevel;
                    nextLevel = [];
                    continue;
                }

                var head = currentLevel.shift();
                var parent = head.node;
                var childrenIds = parent.children || [];

                // Skip if no more children to place
                if (head.childIndex >= childrenIds.length) continue;

                var childId = childrenIds[head.childIndex];

                // Skip already processed
                if (processedFormIds.has(childId)) {
                    head.childIndex++;
                    if (head.childIndex < childrenIds.length) {
                        currentLevel.push(head);  // Re-queue in CURRENT level
                    }
                    continue;
                }

                var childNode = nodeByFormId[childId];
                if (!childNode) {
                    head.childIndex++;
                    if (head.childIndex < childrenIds.length) {
                        currentLevel.push(head);  // Re-queue in CURRENT level
                    }
                    continue;
                }

                var parentTier = parent._gridTier || 0;
                var parentAngle = parent.angle || centerAngle;

                // === DETERMINE TARGET TIER BASED ON BEHAVIOR ===
                var childTier = parentTier + 1;

                if (verticalBias > 0 && rng() < verticalBias) {
                    childTier = parentTier + 1 + Math.floor(rng() * 2);
                } else if (verticalBias < 0) {
                    var currentFill = tierFillCounts[parentTier] / (tierCapacities[parentTier] || 1);
                    if (currentFill < layerFillThreshold && tierCapacities[parentTier] > tierFillCounts[parentTier]) {
                        childTier = parentTier;
                    }
                }

                // Tier 0 is RESERVED for root nodes only - non-root children must be tier 1+
                if (childTier < 1) childTier = 1;

                // Shape-aware tier bias
                if (shapTierMult > 1.1) {
                    // Elongated shapes (spiky 1.4): skip extra tiers → tall narrow growth
                    if (rng() < (shapTierMult - 1.0) * 0.5) childTier += 1;
                } else if (shapTierMult < 0.9) {
                    // Compact shapes (mountain 0.6, radial 0.85): pack tiers tightly
                    if (rng() < (1.0 - shapTierMult) * 0.4 && childTier > 1 &&
                        tierCapacities[childTier - 1] > (tierFillCounts[childTier - 1] || 0)) {
                        childTier = childTier - 1;
                    }
                }

                // === GET AVAILABLE POSITIONS WITH SHAPE FILTERING ===
                // Shapes that need strong silhouettes get wider tier search
                var tierSearchRange = 2;
                if (shapeName === 'spiky') tierSearchRange = 6;      // Spikes extend far outward
                else if (shapeName === 'cloud') tierSearchRange = 5;  // Clouds scatter at various depths
                else if (shapeName === 'tree' && depthRatio >= 0.35) tierSearchRange = 4; // Canopy spreads

                var allCandidatePositions = validPositions.filter(function(p) {
                    return p.tier >= childTier &&
                           p.tier <= childTier + tierSearchRange &&
                           !usedPositions.has(p.tier + '_' + p.slotIndex);
                });

                // CRITICAL: Pre-filter to on-mask positions only.
                // This FORCES nodes into the shape's silhouette instead of soft-penalizing.
                var onMaskCandidates = allCandidatePositions.filter(function(p) {
                    return shapeMaskedSet[p.tier + '_' + p.slotIndex];
                });

                // Use on-mask positions when available; fall back to all only when exhausted
                var availablePositions = onMaskCandidates.length > 0 ? onMaskCandidates : allCandidatePositions;

                // === CALCULATE TARGET ANGLE WITH SPREAD AND WANDER ===
                var spreadOffset = head.numChildren > 1 ?
                    (head.childIndex - (head.numChildren - 1) / 2) * head.baseSpread : 0;
                var wanderOffset = (rng() - 0.5) * 2 * angularWander;
                var targetAngle = parentAngle + spreadOffset + wanderOffset;

                // === SHAPE-SPECIFIC ANGULAR CONTROL ===
                // This is what actually makes trees look different.
                // Each shape overrides the target angle to create its silhouette.
                var depthRatio = Math.min(1.0, childTier / Math.max(cfg.maxTiers * 0.5, 8));

                if (shapeName === 'spiky') {
                    // SPIKY: Children LOCK onto parent's radial line
                    // Almost no spread — creates 3 narrow rays from roots
                    targetAngle = parentAngle;  // 100% parent angle = pure ray
                    // Tiny jitter only to prevent exact overlap
                    targetAngle += (rng() - 0.5) * 1.5;
                    // Push children further out — elongate the spikes
                    if (rng() < 0.45) childTier += 1;
                    if (rng() < 0.15) childTier += 1; // occasional double skip
                } else if (shapeName === 'explosion') {
                    // EXPLOSION: Tight core → sub-explosions → HOLLOW V-blast
                    if (depthRatio < 0.10) {
                        // CORE: Force all inner nodes to dead center
                        targetAngle = centerAngle;
                        targetAngle += (rng() - 0.5) * 1.5;
                    } else if (depthRatio < 0.35) {
                        // SUB-EXPLOSIONS: cluster nodes into 3 smaller blast points
                        var subCenters = [
                            centerAngle - usableAngle * 0.20,  // Left sub-blast
                            centerAngle + usableAngle * 0.18,  // Right sub-blast
                            centerAngle                         // Center secondary
                        ];
                        var si = Math.floor(rng() * subCenters.length);
                        targetAngle = subCenters[si] + (rng() - 0.5) * usableAngle * 0.12;
                    } else {
                        // MAIN BLAST: Push nodes to sector edges with hollow center
                        var blastProgress = (depthRatio - 0.35) / 0.65; // 0→1
                        var sqrtBlast = Math.sqrt(blastProgress);
                        var innerVoid = sqrtBlast * usableAngle * 0.22;
                        var outerEnv = usableAngle * 0.45 * sqrtBlast;
                        var pushDir = (rng() > 0.5) ? 1 : -1;
                        var ringPos = innerVoid + rng() * Math.max(0, outerEnv - innerVoid);
                        targetAngle = centerAngle + pushDir * ringPos;
                        // 15% flame tendril
                        if (rng() < 0.15) {
                            targetAngle = centerAngle + (rng() - 0.5) * outerEnv * 2;
                        }
                    }
                    // Push children further out for radial blast effect
                    if (depthRatio > 0.1 && rng() < 0.30) childTier += 1;
                } else if (shapeName === 'tree') {
                    // TREE: Trunk → branches → dome canopy curving back down
                    if (depthRatio < 0.30) {
                        // TRUNK: visible thickness
                        targetAngle = centerAngle;
                        targetAngle += (rng() - 0.5) * 4.0;
                    } else if (depthRatio < 0.50) {
                        // BRANCHES: spread children along 4 branch directions
                        var branchT = (depthRatio - 0.30) / 0.20;
                        var branchAngles = [-0.7, -0.3, 0.3, 0.7];
                        var branchSpread = usableAngle * 0.35 * branchT;
                        var bi = Math.floor(rng() * branchAngles.length);
                        targetAngle = centerAngle + branchAngles[bi] * branchSpread;
                        targetAngle += (rng() - 0.5) * 3.0;
                    } else if (depthRatio < 0.72) {
                        // CANOPY: wide dense fill
                        var canopyT = (depthRatio - 0.50) / 0.22;
                        var canopyWidth = usableAngle * (0.30 + canopyT * canopyT * 0.60);
                        targetAngle = centerAngle + (rng() - 0.5) * canopyWidth;
                    } else {
                        // DROOP: canopy curves back toward center
                        var droopT = (depthRatio - 0.72) / 0.28;
                        var maxW = usableAngle * 0.90;
                        var droopWidth = maxW - droopT * droopT * (maxW - usableAngle * 0.30);
                        targetAngle = centerAngle + (rng() - 0.5) * droopWidth;
                    }
                } else if (shapeName === 'mountain') {
                    // MOUNTAIN: Sector-wide base at tier 0-1, VERY narrow peak at outer tiers
                    // Cubic pull toward center with aggressive narrowing
                    var peakPull = depthRatio * depthRatio * depthRatio * 0.98;
                    targetAngle = targetAngle * (1 - peakPull) + centerAngle * peakPull;
                    // At innermost tiers, push nodes to edges of sector for wide base
                    if (depthRatio < 0.35) {
                        var basePush = (0.35 - depthRatio) / 0.35; // 1→0
                        var offsetFromCenter = targetAngle - centerAngle;
                        targetAngle += offsetFromCenter * basePush * 0.7;
                        // Extra wander to fill sector width
                        targetAngle += (rng() - 0.5) * usableAngle * 0.15 * basePush;
                    }
                } else if (shapeName === 'cloud') {
                    // CLOUD: Completely random scatter within sector — no coherent shape
                    // Abandon parent-following, place almost randomly in sector
                    var randomAngle = centerAngle + (rng() - 0.5) * usableAngle * 0.85;
                    targetAngle = targetAngle * 0.3 + randomAngle * 0.7;
                    // Frequent gap jumps for irregular clusters
                    if (rng() < 0.35) {
                        targetAngle += (rng() > 0.5 ? 1 : -1) * usableAngle * 0.25;
                    }
                    // Heavily vary tier placement
                    if (rng() < 0.4) childTier += Math.floor(rng() * 3);
                } else if (shapeName === 'cascade') {
                    // CASCADE: Hard-snap to 5 discrete columns, alternating tier offsets
                    var numColumns = 5;
                    var colWidth = usableAngle / numColumns;
                    var sectorStart = centerAngle - usableAngle / 2;
                    // Strong stagger per tier
                    var staggerOffset = (childTier % 2 === 0 ? 1 : -1) * (colWidth * 0.4);
                    targetAngle += staggerOffset;
                    // HARD snap to nearest column center (85% column, 15% natural)
                    var nearestCol = Math.round((targetAngle - sectorStart) / colWidth);
                    nearestCol = Math.max(0, Math.min(numColumns - 1, nearestCol));
                    var colCenter = sectorStart + nearestCol * colWidth + colWidth / 2;
                    targetAngle = targetAngle * 0.15 + colCenter * 0.85;
                }
                // organic/radial/grid/linear: no override, use natural BFS spread

                // Multi-root: bias target angle toward owning root to keep subtrees in sub-sectors
                if (isMultiRoot && head.rootAngle !== undefined) {
                    var rootBias = 0.3;
                    targetAngle = targetAngle * (1 - rootBias) + head.rootAngle * rootBias;
                }

                // === SHAPE-SPECIFIC SCORING WEIGHTS ===
                // Different shapes need radically different scoring to enforce silhouettes
                var angleDiffWeight = 2;
                var tierDiffWeight = 40;
                var pickTopN = 3;

                if (shapeName === 'spiky') {
                    angleDiffWeight = 15;   // EXTREME: lock to parent's ray angle
                    tierDiffWeight = 5;     // Low: skip tiers freely for elongation
                    pickTopN = 1;           // Always pick absolute best position
                } else if (shapeName === 'swords') {
                    angleDiffWeight = 8;    // High: stay within blade width
                    tierDiffWeight = 8;     // Moderate: advance along blade
                    pickTopN = 2;           // Fairly precise
                } else if (shapeName === 'explosion') {
                    if (depthRatio < 0.2) {
                        angleDiffWeight = 20;  // EXTREME: pack core tightly
                        tierDiffWeight = 15;   // Moderate: some depth in core
                        pickTopN = 1;          // Precise center packing
                    } else {
                        angleDiffWeight = 0.3; // MINIMAL: scatter blast everywhere
                        tierDiffWeight = 10;   // Moderate: advance outward
                        pickTopN = 6;          // High randomness for blast scatter
                    }
                } else if (shapeName === 'portals') {
                    angleDiffWeight = 0.5;  // Low: spread organically
                    tierDiffWeight = 15;    // Moderate: some depth structure
                    pickTopN = 5;           // Randomness for organic feel
                } else if (shapeName === 'tree') {
                    if (depthRatio < 0.30) {
                        angleDiffWeight = 12;  // High: visible trunk
                        tierDiffWeight = 10;   // Advance outward
                        pickTopN = 2;
                    } else if (depthRatio < 0.50) {
                        angleDiffWeight = 10;  // High: snap to branch lines
                        tierDiffWeight = 8;    // Advance through branches
                        pickTopN = 2;
                    } else if (depthRatio < 0.72) {
                        angleDiffWeight = 0.3; // Low: wide canopy fill
                        tierDiffWeight = 20;   // Advance outward
                        pickTopN = 6;
                    } else {
                        angleDiffWeight = 3;   // Moderate: droop back in
                        tierDiffWeight = 15;
                        pickTopN = 3;
                    }
                } else if (shapeName === 'mountain') {
                    angleDiffWeight = 0.8;  // Low: allow wide spread at base
                    tierDiffWeight = 80;    // EXTREME: pack into same/adjacent tiers
                    pickTopN = 4;           // Some randomness for width
                } else if (shapeName === 'cloud') {
                    angleDiffWeight = 0.3;  // MINIMAL: scatter freely in any direction
                    tierDiffWeight = 5;     // MINIMAL: place at any depth
                    pickTopN = 8;           // Maximum randomness for irregular clusters
                } else if (shapeName === 'cascade') {
                    angleDiffWeight = 10;   // High: snap precisely to columns
                    tierDiffWeight = 60;    // High: clear tier separation
                    pickTopN = 2;           // Fairly precise placement
                }

                // === SCORE POSITIONS ===
                var scoredPositions = availablePositions.map(function(pos) {
                    if (usedPositions.has(pos.tier + '_' + pos.slotIndex)) return null;

                    var angleDiff = Math.abs(pos.angle - targetAngle);
                    var tierDiff = Math.abs(pos.tier - childTier);
                    var randomBonus = rng() * 20;

                    var score = angleDiff * angleDiffWeight + tierDiff * tierDiffWeight - randomBonus;

                    if (pos.tier < parentTier && verticalBias > -0.5) {
                        score += 100;
                    }

                    // Multi-root: penalize positions far from owning root's angle
                    if (isMultiRoot && head.rootAngle !== undefined) {
                        var rootAngleDist = Math.abs(pos.angle - head.rootAngle);
                        score += rootAngleDist * 1.5;
                    }

                    // Shape mask preference: very heavily penalize off-shape positions
                    if (!shapeMaskedSet[pos.tier + '_' + pos.slotIndex]) {
                        score += 800;
                    }

                    return { pos: pos, score: score };
                }).filter(function(s) { return s !== null; });

                scoredPositions.sort(function(a, b) { return a.score - b.score; });

                var pickIndex = Math.floor(rng() * Math.min(pickTopN, scoredPositions.length));
                var selected = scoredPositions[pickIndex];

                // === FALLBACK: Search wider with mask priority ===
                if (!selected && scoredPositions.length === 0) {
                    // First try on-mask positions across ALL tiers
                    var allAvailable = validPositions.filter(function(p) {
                        return p.tier >= 1 && !usedPositions.has(p.tier + '_' + p.slotIndex);
                    });

                    // CRITICAL: Try on-mask positions first in fallback too
                    var fallbackOnMask = allAvailable.filter(function(p) {
                        return shapeMaskedSet[p.tier + '_' + p.slotIndex];
                    });
                    if (fallbackOnMask.length > 0) {
                        allAvailable = fallbackOnMask;
                    }

                    if (allAvailable.length > 0) {
                        var fallbackScored = allAvailable.map(function(pos) {
                            var angleDiff = Math.abs(pos.angle - targetAngle);
                            var tierDiff = Math.abs(pos.tier - childTier);
                            var distFromParent = Math.abs(pos.tier - parentTier);

                            // Base score: use shape-specific weights (same as primary, slightly relaxed)
                            var score = angleDiff * angleDiffWeight + tierDiff * Math.max(tierDiffWeight * 0.75, 25);

                            // Growth direction penalties
                            if (verticalBias > 0) {
                                // "Up" mode: penalize going backward or staying same tier
                                if (pos.tier <= parentTier) {
                                    score += 80;
                                }
                            } else if (verticalBias < 0) {
                                // "Dense" mode: reward staying on same/adjacent tier
                                if (distFromParent > 1) {
                                    score += distFromParent * 25;
                                }
                                // Check layer fill - prefer unfilled tiers
                                var tierFill = tierFillCounts[pos.tier] / (tierCapacities[pos.tier] || 1);
                                if (tierFill < layerFillThreshold) {
                                    score -= 20;  // Bonus for filling sparse tiers
                                }
                            }

                            // Penalize going too far from parent
                            score += distFromParent * 15;

                            // Multi-root: penalize positions far from owning root's angle
                            if (isMultiRoot && head.rootAngle !== undefined) {
                                var rootAngleDist = Math.abs(pos.angle - head.rootAngle);
                                score += rootAngleDist * 1.5;
                            }

                            // Shape mask preference — strong even in fallback
                            if (!shapeMaskedSet[pos.tier + '_' + pos.slotIndex]) {
                                score += 500;
                            }

                            return { pos: pos, score: score };
                        });

                        fallbackScored.sort(function(a, b) { return a.score - b.score; });
                        selected = fallbackScored[0];
                        console.log('[LayoutEngine] Fallback position for', childNode.name || childId,
                            'at tier', selected.pos.tier, 'angle', selected.pos.angle.toFixed(1));
                    } else {
                        // INTERPOLATE: Create position between grid points (last resort)
                        var interpRadius = cfg.baseRadius + childTier * cfg.tierSpacing;
                        var interpAngleRad = targetAngle * Math.PI / 180;
                        selected = {
                            pos: {
                                x: Math.cos(interpAngleRad) * interpRadius,
                                y: Math.sin(interpAngleRad) * interpRadius,
                                tier: childTier,
                                angle: targetAngle,
                                radius: interpRadius,
                                slotIndex: 'interp_' + assignedCount,
                                isInterpolated: true
                            },
                            score: 9999
                        };
                        console.log('[LayoutEngine] Interpolated position for', childNode.name || childId);
                    }
                }

                if (selected) {
                    var bestPos = selected.pos;
                    childNode.x = bestPos.x;
                    childNode.y = bestPos.y;
                    childNode.radius = bestPos.radius;
                    childNode.angle = bestPos.angle;
                    childNode._gridTier = bestPos.tier;
                    childNode._fromLayoutEngine = true;
                    childNode._gridSlot = bestPos.tier + '_' + bestPos.slotIndex;
                    childNode._isInterpolated = bestPos.isInterpolated || false;

                    if (!bestPos.isInterpolated) {
                        markPositionUsed(bestPos);
                    } else {
                        usedPositions.add(childNode._gridSlot);  // Mark interpolated without skip
                    }

                    tierFillCounts[bestPos.tier] = (tierFillCounts[bestPos.tier] || 0) + 1;
                    assignedCount++;
                    processedFormIds.add(childId);

                    // Add child as new head if it has children - goes to NEXT level
                    var grandchildren = childNode.children || [];
                    if (grandchildren.length > 0) {
                        nextLevel.push({
                            node: childNode,
                            childIndex: 0,
                            numChildren: grandchildren.length,
                            baseSpread: sliceAngle * spreadFactor / Math.max(grandchildren.length, 1),
                            rootAngle: head.rootAngle
                        });
                    }
                }

                // Re-queue current head if more children remain - stays in CURRENT level
                head.childIndex++;
                if (head.childIndex < childrenIds.length) {
                    currentLevel.push(head);
                }
            }

            // === HANDLE ORPHANS ===
            var orphanNodes = school.nodes.filter(function(n) {
                return !processedFormIds.has(n.formId);
            });

            if (orphanNodes.length > 0) {
                console.log('[LayoutEngine]', schoolName + ':', orphanNodes.length, 'orphan nodes to assign');

                orphanNodes.sort(function(a, b) { return (a.tier || 0) - (b.tier || 0); });

                var remainingPositions = validPositions.filter(function(p) {
                    return !usedPositions.has(p.tier + '_' + p.slotIndex);
                }).sort(function(a, b) {
                    if (a.tier !== b.tier) return a.tier - b.tier;
                    return a.slotIndex - b.slotIndex;
                });

                orphanNodes.forEach(function(node, idx) {
                    if (idx < remainingPositions.length) {
                        var pos = remainingPositions[idx];
                        node.x = pos.x;
                        node.y = pos.y;
                        node.radius = pos.radius;
                        node.angle = pos.angle;
                        node._gridTier = pos.tier;
                        node._fromLayoutEngine = true;
                        node._gridSlot = pos.tier + '_' + pos.slotIndex;
                        node._isOrphan = true;
                        usedPositions.add(node._gridSlot);
                        assignedCount++;
                    } else {
                        // Fallback to all grid positions
                        var fallbackPos = allGridPositions.find(function(p) {
                            return !usedPositions.has(p.tier + '_' + p.slotIndex);
                        });
                        if (fallbackPos) {
                            node.x = fallbackPos.x;
                            node.y = fallbackPos.y;
                            node.radius = fallbackPos.radius;
                            node.angle = fallbackPos.angle;
                            node._gridTier = fallbackPos.tier;
                            node._fromLayoutEngine = true;
                            node._gridSlot = fallbackPos.tier + '_' + fallbackPos.slotIndex;
                            node._isOrphan = true;
                            usedPositions.add(node._gridSlot);
                            assignedCount++;
                        } else {
                            console.warn('[LayoutEngine] No position for orphan:', node.name || node.formId);
                            node.x = 0;
                            node.y = 0;
                            node._fromLayoutEngine = true;
                            node._overflow = true;
                        }
                    }
                });
            }

            // === PER-SCHOOL BARYCENTER REORDERING ===
            // Reorder nodes WITHIN this school only, using existing positions.
            // Nodes stay in their school's sector — just reorganize which node sits where.
            // This pulls connected nodes closer together, reducing edge crossings and sitters.
            (function perSchoolBarycenter() {
                var schoolNodes = school.nodes.filter(function(n) { return n.x !== undefined; });
                if (schoolNodes.length < 3) return;

                // Build tier buckets (non-root only — roots are pinned)
                var tierBuckets = {};
                var schoolNodeById = {};
                var schoolAdj = {};
                var schoolMaxTier = 0;

                schoolNodes.forEach(function(n) {
                    schoolNodeById[n.formId] = n;
                    var t = n._gridTier || 0;
                    if (t > schoolMaxTier) schoolMaxTier = t;

                    if (!n.isRoot) {
                        if (!tierBuckets[t]) tierBuckets[t] = [];
                        tierBuckets[t].push(n);
                    }

                    // Adjacency within this school
                    schoolAdj[n.formId] = [];
                    (n.children || []).forEach(function(cid) {
                        if (nodeByFormId[cid]) schoolAdj[n.formId].push(cid);
                    });
                    (n.prerequisites || []).forEach(function(pid) {
                        if (nodeByFormId[pid]) schoolAdj[n.formId].push(pid);
                    });

                    // Initial order = current angle
                    n._baryOrder = n.angle || 0;
                });

                // 20 barycenter sweeps alternating direction
                for (var iter = 0; iter < 20; iter++) {
                    var forward = (iter % 2 === 0);
                    var start = forward ? 1 : schoolMaxTier;
                    var end = forward ? schoolMaxTier + 1 : 0;
                    var step = forward ? 1 : -1;

                    for (var tier = start; tier !== end; tier += step) {
                        var bucket = tierBuckets[tier];
                        if (!bucket || bucket.length <= 1) continue;

                        // Compute barycenter for each node from its neighbors' order
                        bucket.forEach(function(node) {
                            var neighbors = schoolAdj[node.formId] || [];
                            var sum = 0, cnt = 0;
                            neighbors.forEach(function(nid) {
                                var nb = schoolNodeById[nid];
                                if (!nb || nb.x === undefined) return;
                                var nbTier = nb._gridTier || 0;
                                if (Math.abs(nbTier - tier) <= 1) {
                                    sum += nb._baryOrder;
                                    cnt++;
                                }
                            });
                            node._barycenter = cnt > 0 ? sum / cnt : node._baryOrder;
                        });

                        // Sort by barycenter
                        bucket.sort(function(a, b) { return a._barycenter - b._barycenter; });

                        // Update order indices
                        bucket.forEach(function(node, idx) { node._baryOrder = idx; });
                    }
                }

                // Map new order back to existing positions within each tier
                var totalBarySwaps = 0;
                for (var bt in tierBuckets) {
                    var bNodes = tierBuckets[bt];
                    if (bNodes.length <= 1) continue;

                    // Snapshot current positions sorted by angle
                    var positions = bNodes.map(function(n) {
                        return { x: n.x, y: n.y, angle: n.angle, radius: n.radius, _gridSlot: n._gridSlot, _gridTier: n._gridTier };
                    });
                    positions.sort(function(a, b) { return a.angle - b.angle; });

                    // bNodes already sorted by barycenter. Assign angle-sorted positions to them.
                    bNodes.forEach(function(node, idx) {
                        if (idx < positions.length) {
                            var oldAngle = node.angle;
                            node.x = positions[idx].x;
                            node.y = positions[idx].y;
                            node.angle = positions[idx].angle;
                            node.radius = positions[idx].radius;
                            node._gridSlot = positions[idx]._gridSlot;
                            node._gridTier = positions[idx]._gridTier;
                            if (Math.abs(oldAngle - node.angle) > 0.5) totalBarySwaps++;
                        }
                    });
                }

                _skseLog(schoolName + ': Barycenter reordered ' + totalBarySwaps + ' nodes (within school only)');
            })();

            // === SITTER NUDGE ===
            // If a node sits on an unrelated edge, nudge it perpendicular to that edge.
            // Pick the nudge direction that's away from previously nudged nodes.
            // Single pass, O(nodes × edges) — no trial swaps.
            (function sitterNudge() {
                var nudgeDist = (cfg.arcSpacing || 56) * 0.45;
                var threshold = (cfg.arcSpacing || 56) * 0.4;
                var thresholdSq = threshold * threshold;

                // Build connection lookup
                var connected = new Set();
                school.nodes.forEach(function(n) {
                    (n.children || []).forEach(function(cid) {
                        connected.add(n.formId + '|' + cid);
                        connected.add(cid + '|' + n.formId);
                    });
                    (n.prerequisites || []).forEach(function(pid) {
                        connected.add(n.formId + '|' + pid);
                        connected.add(pid + '|' + n.formId);
                    });
                });

                // Collect edges
                var edges = [];
                var eSet = new Set();
                school.nodes.forEach(function(n) {
                    if (n.x === undefined) return;
                    (n.children || []).forEach(function(cid) {
                        var c = nodeByFormId[cid];
                        if (c && c.x !== undefined) {
                            var k = n.formId + '>' + cid;
                            if (!eSet.has(k)) { eSet.add(k); edges.push({ from: n, to: c }); }
                        }
                    });
                    (n.prerequisites || []).forEach(function(pid) {
                        var p = nodeByFormId[pid];
                        if (p && p.x !== undefined) {
                            var k = pid + '>' + n.formId;
                            if (!eSet.has(k)) { eSet.add(k); edges.push({ from: p, to: n }); }
                        }
                    });
                });

                // Track nudged positions to bias direction
                var nudgedPositions = [];
                var nudgeCount = 0;

                school.nodes.forEach(function(node) {
                    if (node.x === undefined || node.isRoot) return;

                    // Find the closest edge this node sits on
                    var closestEdge = null;
                    var closestDistSq = Infinity;
                    var closestT = 0;

                    for (var ei = 0; ei < edges.length; ei++) {
                        var e = edges[ei];
                        if (e.from === node || e.to === node) continue;
                        if (connected.has(e.from.formId + '|' + node.formId) ||
                            connected.has(e.to.formId + '|' + node.formId)) continue;

                        var dx = e.to.x - e.from.x, dy = e.to.y - e.from.y;
                        var lenSq = dx * dx + dy * dy;
                        if (lenSq < 25) continue;
                        var t = ((node.x - e.from.x) * dx + (node.y - e.from.y) * dy) / lenSq;
                        if (t < 0.05 || t > 0.95) continue;
                        var projX = e.from.x + t * dx, projY = e.from.y + t * dy;
                        var dSq = (node.x - projX) * (node.x - projX) + (node.y - projY) * (node.y - projY);

                        if (dSq < thresholdSq && dSq < closestDistSq) {
                            closestDistSq = dSq;
                            closestEdge = e;
                            closestT = t;
                        }
                    }

                    if (!closestEdge) return;

                    // Perpendicular to edge (two directions)
                    var edx = closestEdge.to.x - closestEdge.from.x;
                    var edy = closestEdge.to.y - closestEdge.from.y;
                    var eLen = Math.sqrt(edx * edx + edy * edy);
                    if (eLen < 1) return;
                    var perpX = -edy / eLen;
                    var perpY = edx / eLen;

                    // Pick direction: away from nearest nudged node
                    var dirSign = 1;
                    if (nudgedPositions.length > 0) {
                        // Find the closest nudged node
                        var nearestDist = Infinity;
                        var nearestX = 0, nearestY = 0;
                        for (var ni = 0; ni < nudgedPositions.length; ni++) {
                            var ndx = nudgedPositions[ni].x - node.x;
                            var ndy = nudgedPositions[ni].y - node.y;
                            var nd = ndx * ndx + ndy * ndy;
                            if (nd < nearestDist) {
                                nearestDist = nd;
                                nearestX = nudgedPositions[ni].x;
                                nearestY = nudgedPositions[ni].y;
                            }
                        }
                        // Which perpendicular direction points away from nearest nudged?
                        var toNearX = nearestX - node.x, toNearY = nearestY - node.y;
                        var dot = perpX * toNearX + perpY * toNearY;
                        dirSign = dot > 0 ? -1 : 1;
                    } else {
                        // First nudge: go away from center (0,0)
                        var dot0 = perpX * node.x + perpY * node.y;
                        dirSign = dot0 > 0 ? 1 : -1;
                    }

                    node.x += perpX * nudgeDist * dirSign;
                    node.y += perpY * nudgeDist * dirSign;
                    nudgedPositions.push({ x: node.x, y: node.y });
                    nudgeCount++;
                });

                if (nudgeCount > 0) {
                    _skseLog(schoolName + ': Nudged ' + nudgeCount + ' sitter nodes off edges');
                }
            })();

            // === SHAPE CONFORMITY PASS ===
            // Force all node angles to conform to the shape silhouette.
            // This is the PRIMARY shape enforcement — overrides BFS grid placement.
            (function shapeConformityPass() {
                var positioned = school.nodes.filter(function(n) {
                    return n.x !== undefined && !n.isRoot;
                });
                if (positioned.length < 2) return;

                var anchorAngle = centerAngle;
                var halfSector = sliceAngle * 0.85 / 2;

                positioned.forEach(function(node) {
                    var nodeAngle = node.angle;
                    if (nodeAngle === undefined) return;
                    var nodeRadius = node.radius || 0;
                    var maxR = cfg.baseRadius + (cfg.maxTiers || 20) * cfg.tierSpacing;
                    var depthNorm = Math.min(1.0, (nodeRadius - cfg.baseRadius) / Math.max(maxR - cfg.baseRadius, 1));
                    // Normalize angle within sector (0 = sector start, 1 = sector end)
                    var angleNorm = halfSector > 0 ? (nodeAngle - (anchorAngle - halfSector)) / (halfSector * 2) : 0.5;
                    // Clamp to 0-1
                    angleNorm = Math.max(0, Math.min(1, angleNorm));

                    var newAngle = nodeAngle;  // default: keep original

                    if (shapeName === 'spiky') {
                        // Snap to nearest of 3 ray centers
                        var rayPositions = [0.0, 0.333, 0.667];
                        var nearestRay = rayPositions[0];
                        var nearestDist = 999;
                        for (var ri = 0; ri < rayPositions.length; ri++) {
                            var d = Math.abs(angleNorm - rayPositions[ri]);
                            if (d < nearestDist) { nearestDist = d; nearestRay = rayPositions[ri]; }
                        }
                        // Also check wrap-around (ray at 1.0 = ray at 0.0)
                        if (Math.abs(angleNorm - 1.0) < nearestDist) nearestRay = 1.0;
                        // Convert back to absolute angle
                        newAngle = (anchorAngle - halfSector) + nearestRay * halfSector * 2;
                        // Add tiny jitter to prevent exact overlap
                        newAngle += (rng() - 0.5) * 1.5;

                    } else if (shapeName === 'swords') {
                        // Swords: Two broad blade wedges with gap in center
                        // Blade 1 centered at angleNorm 0.20 (left side of sector)
                        // Blade 2 centered at angleNorm 0.80 (right side of sector)
                        var blade1Norm = 0.20;
                        var blade2Norm = 0.80;
                        var bladeHalfWidth = 0.15 * (1.0 - depthNorm * 0.5); // Taper at tips
                        var blade1Angle = (anchorAngle - halfSector) + blade1Norm * halfSector * 2;
                        var blade2Angle = (anchorAngle - halfSector) + blade2Norm * halfSector * 2;
                        // Snap to nearest blade center
                        var d1 = Math.abs(angleNorm - blade1Norm);
                        var d2 = Math.abs(angleNorm - blade2Norm);
                        if (d1 <= d2) {
                            newAngle = blade1Angle + (rng() - 0.5) * bladeHalfWidth * halfSector * 2 * 0.8;
                        } else {
                            newAngle = blade2Angle + (rng() - 0.5) * bladeHalfWidth * halfSector * 2 * 0.8;
                        }

                    } else if (shapeName === 'explosion') {
                        // Explosion: tight core → sub-explosions → HOLLOW V-blast
                        var coreEnd = 0.10;
                        var subBlastEnd = 0.35;
                        if (depthNorm < coreEnd) {
                            // CORE: force all to dead center
                            newAngle = anchorAngle + (rng() - 0.5) * 1.2;
                        } else if (depthNorm < subBlastEnd) {
                            // SUB-EXPLOSIONS: snap to one of 3 cluster centers
                            var subCenters = [
                                anchorAngle - halfSector * 0.40,
                                anchorAngle + halfSector * 0.36,
                                anchorAngle
                            ];
                            var offsetFromCenter = nodeAngle - anchorAngle;
                            var nearestSub = subCenters[0], nearestD = 999;
                            for (var si = 0; si < subCenters.length; si++) {
                                var sd = Math.abs(nodeAngle - subCenters[si]);
                                if (sd < nearestD) { nearestD = sd; nearestSub = subCenters[si]; }
                            }
                            newAngle = nearestSub + (rng() - 0.5) * halfSector * 0.20;
                        } else {
                            var t = (depthNorm - subBlastEnd) / (1.0 - subBlastEnd);
                            var sqrtT = Math.sqrt(t);
                            var outerWidth = sqrtT * halfSector * 0.90;
                            var innerVoid = sqrtT * halfSector * 0.50;
                            var offsetFromCenter = nodeAngle - anchorAngle;
                            var absOffset = Math.abs(offsetFromCenter);

                            var hash = (Math.abs(nodeAngle * 7.3 + nodeRadius * 0.13)) % 1;
                            var isTendril = hash < 0.15;

                            if (!isTendril && absOffset < innerVoid) {
                                var pushDir = offsetFromCenter >= 0 ? 1 : -1;
                                if (absOffset < 1.0) pushDir = (rng() > 0.5) ? 1 : -1;
                                var ringSpan = Math.max(1, outerWidth - innerVoid);
                                newAngle = anchorAngle + pushDir * (innerVoid + rng() * ringSpan);
                            }
                            if (Math.abs(newAngle - anchorAngle) > outerWidth) {
                                newAngle = anchorAngle + Math.sign(newAngle - anchorAngle) * outerWidth;
                            }
                        }

                    } else if (shapeName === 'tree') {
                        // Tree: trunk → branches → dome canopy curving back down
                        var trunkEnd = 0.30;
                        var branchEnd = 0.50;
                        var canopyPeak = 0.72;

                        if (depthNorm < trunkEnd) {
                            // TRUNK: visible thickness — allow ±3° from center
                            var trunkHalfWidth = 3.0;
                            var offsetFromCenter = nodeAngle - anchorAngle;
                            if (Math.abs(offsetFromCenter) > trunkHalfWidth) {
                                newAngle = anchorAngle + Math.sign(offsetFromCenter) * trunkHalfWidth;
                            }
                        } else if (depthNorm < branchEnd) {
                            // BRANCHES: snap to one of 4 branch lines spreading from trunk
                            var branchT = (depthNorm - trunkEnd) / (branchEnd - trunkEnd);
                            var branchSpread = halfSector * 0.70 * branchT; // branches spread outward
                            var branchPositions = [-0.7, -0.3, 0.3, 0.7]; // relative to halfSector
                            var offsetFromCenter = nodeAngle - anchorAngle;
                            var nearestBranch = branchPositions[0] * branchSpread;
                            var nearestDist = 999;
                            for (var bi = 0; bi < branchPositions.length; bi++) {
                                var bp = branchPositions[bi] * branchSpread;
                                var bd = Math.abs(offsetFromCenter - bp);
                                if (bd < nearestDist) { nearestDist = bd; nearestBranch = bp; }
                            }
                            // Also allow trunk continuation
                            if (Math.abs(offsetFromCenter) < 2.0) nearestBranch = offsetFromCenter;
                            newAngle = anchorAngle + nearestBranch + (rng() - 0.5) * 2.0;
                        } else if (depthNorm < canopyPeak) {
                            // CANOPY EXPANSION: rapid widening
                            var t = (depthNorm - branchEnd) / (canopyPeak - branchEnd);
                            var allowedWidth = halfSector * (0.30 + t * t * 0.65);
                            var offsetFromCenter = nodeAngle - anchorAngle;
                            if (Math.abs(offsetFromCenter) > allowedWidth) {
                                newAngle = anchorAngle + Math.sign(offsetFromCenter) * allowedWidth;
                            }
                        } else {
                            // CANOPY DROOP: curves back toward center (dome shape)
                            var t = (depthNorm - canopyPeak) / (1.0 - canopyPeak);
                            var maxW = halfSector * 0.95;
                            var droopWidth = maxW - t * t * (maxW - halfSector * 0.30);
                            var offsetFromCenter = nodeAngle - anchorAngle;
                            if (Math.abs(offsetFromCenter) > droopWidth) {
                                newAngle = anchorAngle + Math.sign(offsetFromCenter) * droopWidth;
                            }
                        }

                    } else if (shapeName === 'mountain') {
                        // Aggressive triangular taper: full width at base, 5% at peak
                        // Use quadratic taper for more dramatic narrowing
                        var peakWidth = 0.05;
                        var taper = depthNorm * depthNorm;  // Quadratic: narrows faster
                        var allowedFraction = 1.0 - taper * (1.0 - peakWidth);
                        var maxOffset = halfSector * allowedFraction;
                        var offset = nodeAngle - anchorAngle;
                        // ALWAYS clamp toward center (even if within bounds, pull inward)
                        var pullFactor = Math.min(1.0, depthNorm * 0.4);
                        var targetOffset = offset * (1.0 - pullFactor);
                        if (Math.abs(targetOffset) > maxOffset) {
                            targetOffset = Math.sign(offset) * maxOffset;
                        }
                        newAngle = anchorAngle + targetOffset;

                    } else if (shapeName === 'cascade') {
                        // Snap to nearest of 5 column centers
                        var numCols = 5;
                        var sectorStart = anchorAngle - halfSector;
                        var colWidth = (halfSector * 2) / numCols;
                        var relAngle = nodeAngle - sectorStart;
                        var colIndex = Math.round(relAngle / colWidth - 0.5);
                        colIndex = Math.max(0, Math.min(numCols - 1, colIndex));
                        newAngle = sectorStart + colIndex * colWidth + colWidth / 2;
                        // Tiny jitter within column
                        newAngle += (rng() - 0.5) * colWidth * 0.15;
                    } else if (shapeName === 'portals') {
                        // Portals: push nodes OUT of the doorway arch
                        var doorBottom = 0.08;
                        var doorTop = 0.85;
                        var doorHalfWidth = 0.35;

                        if (depthNorm >= doorBottom && depthNorm <= doorTop) {
                            var doorProgress = (depthNorm - doorBottom) / (doorTop - doorBottom);
                            var archFactor = Math.sqrt(1.0 - doorProgress * doorProgress);
                            var archWidth = doorHalfWidth * archFactor;
                            // angleNorm relative to sector
                            var anNorm = halfSector > 0 ? (nodeAngle - (anchorAngle - halfSector)) / (halfSector * 2) : 0.5;
                            anNorm = Math.max(0, Math.min(1, anNorm));
                            var distFromCenter = Math.abs(anNorm - 0.5);

                            if (distFromCenter < archWidth) {
                                // Node is INSIDE the doorway hole → push to nearest frame edge
                                var pushDir = (anNorm >= 0.5) ? 1 : -1;
                                var frameEdgeNorm = 0.5 + pushDir * (archWidth + 0.02);
                                newAngle = (anchorAngle - halfSector) + frameEdgeNorm * halfSector * 2;
                                newAngle += (rng() - 0.5) * 2.0;
                            }
                        }
                    }
                    // cloud: no conformity needed (scattered is the shape)

                    if (newAngle !== nodeAngle) {
                        node.angle = newAngle;
                        var rad = newAngle * Math.PI / 180;
                        node.x = Math.cos(rad) * nodeRadius;
                        node.y = Math.sin(rad) * nodeRadius;
                    }
                });

                _skseLog(schoolName + ': Shape conformity pass applied for ' + shapeName);
            })();

            // === SHAPE-AWARE DENSITY STRETCH ===
            // Expand tree outward FROM ROOT, but respect shape proportions.
            // Spiky = narrow+tall, mountain = wide base+tapered, organic = balanced.
            (function densityStretch() {
                var positioned = school.nodes.filter(function(n) {
                    return n.x !== undefined && !n.isRoot;
                });
                if (positioned.length < 2) return;

                // Anchor = average root position (stays fixed)
                var anchorAngle = 0, anchorRadius = 0;
                allRootNodes.forEach(function(r) { anchorAngle += r.angle || 0; anchorRadius += r.radius || 0; });
                anchorAngle /= allRootNodes.length;
                anchorRadius /= allRootNodes.length;

                // Measure current extent relative to root
                var maxAngleOffset = 0, maxRadiusOffset = 0;
                positioned.forEach(function(n) {
                    var aOff = Math.abs(n.angle - anchorAngle);
                    var rOff = n.radius - anchorRadius;
                    if (aOff > maxAngleOffset) maxAngleOffset = aOff;
                    if (rOff > maxRadiusOffset) maxRadiusOffset = rOff;
                });

                if (maxAngleOffset < 1 || maxRadiusOffset < 1) return;

                // Available sector bounds
                var sectorHalfAngle = usableAngle / 2;
                var sectorMinAngle = centerAngle - sectorHalfAngle;
                var sectorMaxAngle = centerAngle + sectorHalfAngle;

                // Max radius: furthest tier in grid
                var maxGridRadius = cfg.baseRadius + (cfg.maxTiers - 1) * cfg.tierSpacing;
                var availableRadiusFromRoot = maxGridRadius - anchorRadius;

                // Shape-aware stretch targets:
                // CRITICAL: Some shapes MUST stay narrow/sparse to look distinct.
                // Stretching them to fill the sector erases their visual identity.
                var baseTarget = 0.85;
                var angleTarget, radiusTarget;
                if (shapeName === 'spiky') {
                    // Spiky: NO angle stretch at all — stay as narrow rays
                    angleTarget = 0.0;
                    radiusTarget = 0.95;
                } else if (shapeName === 'swords') {
                    // Swords: moderate angle spread for blade width, stretch outward
                    angleTarget = 0.5;  // Half sector — two blades don't fill whole sector
                    radiusTarget = 0.9;
                } else if (shapeName === 'explosion') {
                    // Explosion: wide blast filling sector, stretching outward
                    angleTarget = 0.85;  // Nearly full sector (blast fills wide)
                    radiusTarget = 0.9;  // Stretch outward for dramatic blast radius
                } else if (shapeName === 'tree') {
                    // Tree: wider spread for thick canopy visibility
                    angleTarget = 0.70;
                    radiusTarget = 0.85;
                } else if (shapeName === 'cloud') {
                    // Cloud: moderate scatter, don't compress or expand
                    angleTarget = 0.65;
                    radiusTarget = 0.7;
                } else if (shapeName === 'cascade') {
                    // Cascade: moderate width for column spread
                    angleTarget = 0.75;
                    radiusTarget = 0.9;
                } else if (shapeName === 'mountain') {
                    // Mountain: wide base, but taper re-applied after stretch
                    angleTarget = 0.9;
                    radiusTarget = 0.6;  // Keep compact (wide base, not tall)
                } else if (shapeName === 'portals') {
                    // Portals: fill most of sector (holes are in the mask, not the stretch)
                    angleTarget = 0.8;
                    radiusTarget = 0.75;
                } else {
                    // Organic and others: fill more of the sector
                    angleTarget = baseTarget * shapSpreadMult;
                    radiusTarget = baseTarget;
                    if (shapTierMult < 0.9) {
                        radiusTarget = baseTarget * (0.5 + shapTierMult * 0.5);
                    }
                }

                var angleStretch = Math.min(3.5, Math.max(1.0, (sectorHalfAngle * angleTarget) / maxAngleOffset));
                var radiusStretch = Math.min(3.0, Math.max(1.0, (availableRadiusFromRoot * radiusTarget) / maxRadiusOffset));

                if (angleStretch <= 1.02 && radiusStretch <= 1.02) return;

                // Apply stretch: scale outward FROM ROOT
                positioned.forEach(function(n) {
                    var newAngle = anchorAngle + (n.angle - anchorAngle) * angleStretch;
                    newAngle = Math.max(sectorMinAngle + 0.5, Math.min(sectorMaxAngle - 0.5, newAngle));

                    var newRadius = anchorRadius + (n.radius - anchorRadius) * radiusStretch;
                    newRadius = Math.max(anchorRadius + cfg.tierSpacing * 0.5, Math.min(maxGridRadius, newRadius));

                    // Re-apply taper AFTER stretch for tapering shapes (mountain)
                    if (shapHasTaper) {
                        var depthRatio = (newRadius - anchorRadius) / Math.max(availableRadiusFromRoot * radiusTarget, 1);
                        var taperRatio = Math.max(shapTaperAmount, 1.0 - depthRatio * (1.0 - shapTaperAmount));
                        newAngle = anchorAngle + (newAngle - anchorAngle) * taperRatio;
                    }

                    n.angle = newAngle;
                    n.radius = newRadius;
                    var rad = newAngle * Math.PI / 180;
                    n.x = Math.cos(rad) * newRadius;
                    n.y = Math.sin(rad) * newRadius;
                });

                _skseLog(schoolName + ': Density stretch (shape=' + shapeName +
                    ', angleTarget=' + (angleTarget * 100).toFixed(0) + '%' +
                    ', radiusTarget=' + (radiusTarget * 100).toFixed(0) + '%' +
                    ', angle x' + angleStretch.toFixed(2) +
                    ', radius x' + radiusStretch.toFixed(2) + ')');
            })();

            console.log('[LayoutEngine]', schoolName + ':', assignedCount + '/' + school.nodes.length,
                'nodes positioned (growth-behavior-aware)');
        });

        return treeData;
    },

    /**
     * Simple string hash for generating school-specific seeds
     */
    _hashString: function(str) {
        var hash = 0;
        for (var i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash & hash;
        }
        return Math.abs(hash);
    }
};

// =============================================================================
// EXPORTS
// =============================================================================

window.LayoutEngine = LayoutEngine;

console.log('[LayoutEngine] Module loaded');
