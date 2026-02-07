/**
 * Layout Generator Module - Visual-First Tree Building
 * 
 * Three-zone approach:
 * 1. INNER ZONE: First 3 rings (root + 2 more) are full circles, no shape influence
 *    - 2 tier gaps between inner rings for visual clarity
 * 2. SHAPE ZONE: Outer rings use shape masks for visual silhouette
 * 3. STAR ZONE: Optional scattered nodes in outer region
 * 
 * Depends on: TREE_CONFIG, settings, state
 */

// =============================================================================
// CONFIGURATION - Uses unified GRID_CONFIG from config.js
// =============================================================================

var LAYOUT_CONFIG = (function() {
    // Get unified grid config - single source of truth
    var gridCfg = (typeof GRID_CONFIG !== 'undefined') ? GRID_CONFIG.getComputedConfig() : {
        nodeSize: 75,
        baseRadius: 90,
        tierSpacing: 52,
        arcSpacing: 56,
        minNodeSpacing: 52,
        maxTiers: 25,
        schoolPadding: 15
    };
    
    return {
        baseRadius: gridCfg.baseRadius,
        tierSpacing: gridCfg.tierSpacing,
        arcSpacing: gridCfg.arcSpacing,
        gridDensity: 6,
        schoolPadding: gridCfg.schoolPadding,
        maxTiers: 60,  // More tiers for larger spell counts
        minNodeSpacing: gridCfg.minNodeSpacing,
        nodeSize: gridCfg.nodeSize,
        
        // Inner ring zone config - sparse inner rings
        innerRingCount: 3,
        innerRingGap: 2,
        innerRingTiers: [0, 3, 6],        // Tiers 0, 3, 6 get nodes; 1,2,4,5 are gaps
        innerRingMaxNodes: [1, 3, 5],     // Fewer nodes per inner ring for clean spacing
        
        // Star nodes
        starNodeChance: 0.12,
        starMinRadius: 1.5,
        starMaxRadius: 2.5
    };
})();

/**
 * Calculate dynamic spacing based on spell count.
 * For large trees, increase radius to prevent overlap.
 */
function getScaledConfig(spellCount, sectorAngle) {
    // Base config
    var config = {
        baseRadius: LAYOUT_CONFIG.baseRadius,
        tierSpacing: LAYOUT_CONFIG.tierSpacing,
        gridDensity: LAYOUT_CONFIG.gridDensity
    };
    
    // Calculate expected nodes per tier (fixed 5 tiers)
    var nodesPerTier = Math.ceil(spellCount / LAYOUT_CONFIG.maxTiers);
    
    // Calculate arc length at average radius (tier 2) for min spacing
    var avgRadius = config.baseRadius + (config.tierSpacing * 2);
    var arcLength = (sectorAngle / 360) * 2 * Math.PI * avgRadius;
    var requiredArcLength = nodesPerTier * LAYOUT_CONFIG.minNodeSpacing;
    
    // Always scale based on density requirements
    if (arcLength > 0) {
        var scaleFactor = requiredArcLength / arcLength;
        scaleFactor = Math.max(1.0, scaleFactor);  // At least 1x
        scaleFactor = Math.min(scaleFactor, 5.0);  // Cap at 5x
        
        if (scaleFactor > 1.0) {
            config.baseRadius *= scaleFactor;
            config.tierSpacing *= scaleFactor;
            
            console.log('[LayoutGenerator] Scaling for', spellCount, 'spells,', nodesPerTier, 'per tier: factor=', scaleFactor.toFixed(2), 'base_radius=', config.baseRadius.toFixed(0));
        }
    }
    
    return config;
}

// =============================================================================
// SLICE ALLOCATION
// =============================================================================

/**
 * Calculate pie slice angles for each school - EQUAL slices for symmetry.
 * All schools get the same sector angle regardless of spell count.
 */
function calculateSliceAngles(schools) {
    var schoolNames = Object.keys(schools);
    var numSchools = schoolNames.length;
    
    if (numSchools === 0) return {};
    
    // EQUAL SLICES - each school gets same angle
    var totalPadding = numSchools * LAYOUT_CONFIG.schoolPadding;
    var availableAngle = 360 - totalPadding;
    var sectorAngle = availableAngle / numSchools;  // Equal for all
    
    var sliceAngles = {};
    var currentAngle = -90;  // Start at top
    
    schoolNames.forEach(function(name) {
        var spokeAngle = currentAngle + sectorAngle / 2;
        
        sliceAngles[name] = {
            startAngle: currentAngle,
            endAngle: currentAngle + sectorAngle,
            sectorAngle: sectorAngle,
            spokeAngle: spokeAngle,
            weight: 1.0  // Equal weight
        };
        
        currentAngle += sectorAngle + LAYOUT_CONFIG.schoolPadding;
    });
    
    console.log('[LayoutGenerator] EQUAL slice allocation:', sectorAngle.toFixed(1) + '° per school');
    return sliceAngles;
}

// =============================================================================
// PHASE 1: GENERATE FULL GRID
// =============================================================================

/**
 * Generate positions using visual-first approach with inner ring zone.
 * 
 * ZONES:
 * - INNER ZONE (tiers 0, 3, 6): Sparse rings, no shape influence, minimal jitter
 *   - Root (tier 0): EXACTLY 1 node, centered on spoke
 *   - Ring 2 (tier 3): Few nodes, well spaced
 *   - Ring 3 (tier 6): More nodes, still spaced
 * - SHAPE ZONE (tier 7+): Shape masks control node placement
 * 
 * @param {Object} sliceInfo - {startAngle, endAngle, sectorAngle, spokeAngle}
 * @param {number} spellCount - Number of spells to place
 * @param {string} shape - Shape name for outer zone
 * @param {Object} config - Additional config
 * @returns {Array} - Array of position objects
 */
function generateFullGrid(sliceInfo, spellCount, shape, config) {
    var positions = [];
    shape = shape || 'organic';
    config = config || {};
    
    console.log('[LayoutGen] === generateFullGrid ===');
    console.log('[LayoutGen] Shape:', shape, ', SpellCount:', spellCount, ', Sector:', sliceInfo.sectorAngle.toFixed(1) + '°');
    
    // Calculate how many tiers we need
    var numTiers = calculateTiersNeeded(spellCount, sliceInfo.sectorAngle);
    var profile = (window.SHAPE_PROFILES || _LG_SHAPE_PROFILES)[shape] || (window.SHAPE_PROFILES || _LG_SHAPE_PROFILES).organic;
    var shapeMask = (window.SHAPE_MASKS || _LG_SHAPE_MASKS)[shape] || (window.SHAPE_MASKS || _LG_SHAPE_MASKS).radial;
    var rng = seededRandom(sliceInfo.spokeAngle * 1000);
    
    console.log('[LayoutGen] NumTiers:', numTiers, ', Profile:', profile ? 'found' : 'MISSING', ', Mask:', shapeMask ? 'found' : 'MISSING');
    
    // Get scaled config
    var scaledConfig = getScaledConfig(spellCount, sliceInfo.sectorAngle);
    var baseRadius = scaledConfig.baseRadius;
    var tierSpacing = scaledConfig.tierSpacing;
    var nodeSize = LAYOUT_CONFIG.nodeSize;  // FIX: Get nodeSize from config!
    
    // CONTINUOUS APPROACH - No gaps, gradual expansion from root
    // Every tier has nodes, no shape mask removal, just density control
    
    console.log('[LayoutGen] Continuous mode: spellCount=' + spellCount + ', numTiers=' + numTiers + ', nodeSize=' + nodeSize + ', baseRadius=' + baseRadius + ', tierSpacing=' + tierSpacing);
    
    var tierCounts = [];  // Track how many nodes per tier
    
    // Generate positions for each tier
    for (var tier = 0; tier < numTiers; tier++) {
        var radius = baseRadius + tier * tierSpacing;
        var tierProgress = numTiers > 1 ? tier / (numTiers - 1) : 0;
        
        // Tier 0 = single root node at CENTER of slice
        if (tier === 0) {
            var rootRad = sliceInfo.spokeAngle * Math.PI / 180;
            positions.push({
                tier: tier,
                radius: radius,
                angle: sliceInfo.spokeAngle,
                x: Math.cos(rootRad) * radius,
                y: Math.sin(rootRad) * radius,
                isRoot: true,
                gridRadius: radius,
                gridAngle: sliceInfo.spokeAngle
            });
            continue;
        }
        
        // NODE COUNT per tier - grows with radius to fill the arc
        var candidateCount;
        if (tier === 1) {
            candidateCount = 3;  // First ring: 3 nodes
        } else if (tier === 2) {
            candidateCount = 4;  // Second ring: 4 nodes  
        } else if (tier <= 4) {
            candidateCount = tier + 2;  // 5, 6 nodes
        } else {
            // Outer tiers: Scale with arc length, use unified arcSpacing
            var arcLength = (sliceInfo.sectorAngle / 360) * 2 * Math.PI * radius;
            candidateCount = Math.max(4, Math.floor(arcLength / LAYOUT_CONFIG.arcSpacing));
        }
        
        var usableAngle = sliceInfo.sectorAngle * 0.85;
        var startAngle = sliceInfo.spokeAngle - usableAngle / 2;
        var angleStep = candidateCount > 1 ? usableAngle / (candidateCount - 1) : 0;
        
        var addedThisTier = 0;
        for (var i = 0; i < candidateCount; i++) {
            var angleNorm = candidateCount > 1 ? i / (candidateCount - 1) : 0.5;
            var tierProgress = tier / numTiers;
            
            // APPLY SHAPE MASK - Skip nodes that don't fit the shape
            // But always keep some minimum nodes per tier for connectivity
            var minNodesPerTier = Math.max(2, Math.floor(candidateCount * 0.3));
            var passesShapeMask = shapeMask(tierProgress, angleNorm, rng);
            
            // Force include if we haven't met minimum OR if early tiers (for connectivity)
            if (!passesShapeMask && addedThisTier >= minNodesPerTier && tier > 3) {
                continue;  // Skip this position - doesn't fit shape
            }
            
            var baseAngle = candidateCount === 1 ? sliceInfo.spokeAngle : startAngle + i * angleStep;
            var baseRadius2 = radius;
            
            // Light jitter for organic look (but not too much)
            var jitterAmount = (config.jitter || 20) * (profile.jitterMult || 1);
            if (jitterAmount > 0 && shape !== 'grid' && tier > 2) {
                var angleJitter = (rng() - 0.5) * 4 * (jitterAmount / 100);
                var radiusJitter = (rng() - 0.5) * tierSpacing * 0.2 * (jitterAmount / 100);
                baseAngle += angleJitter;
                baseRadius2 += radiusJitter;
            }
            
            var rad = baseAngle * Math.PI / 180;
            positions.push({
                tier: tier,
                radius: baseRadius2,
                angle: baseAngle,
                x: Math.cos(rad) * baseRadius2,
                y: Math.sin(rad) * baseRadius2,
                isRoot: false,
                angleNorm: angleNorm,
                gridRadius: radius,
                gridAngle: baseAngle
            });
            addedThisTier++;
        }
        tierCounts.push(addedThisTier);
    }
    
    // Log tier breakdown
    console.log('[LayoutGen] Tier breakdown: ' + tierCounts.join(', ') + ' = ' + positions.length + ' total');
    
    // NO SPREADING - keep nodes in their grid positions
    var innerNodes = []; // Empty - no spreading needed
    var minSpreadDist = 0;
    var spreadIterations = 0;
    
    for (var iter = 0; iter < spreadIterations; iter++) {
        for (var ni = 0; ni < innerNodes.length; ni++) {
            var node = innerNodes[ni];
            
            // Find the closest neighbor (not self)
            var closestDist = Infinity;
            var closestNode = null;
            for (var nj = 0; nj < innerNodes.length; nj++) {
                if (ni === nj) continue;
                var other = innerNodes[nj];
                var dx = node.x - other.x;
                var dy = node.y - other.y;
                var dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < closestDist) {
                    closestDist = dist;
                    closestNode = other;
                }
            }
            
            // Also check distance to root
            var rootNode = positions.find(function(p) { return p.isRoot; });
            if (rootNode) {
                var dxRoot = node.x - rootNode.x;
                var dyRoot = node.y - rootNode.y;
                var distToRoot = Math.sqrt(dxRoot * dxRoot + dyRoot * dyRoot);
                if (distToRoot < closestDist) {
                    closestDist = distToRoot;
                    closestNode = rootNode;
                }
            }
            
            // If too close to nearest neighbor, push apart
            if (closestNode && closestDist < minSpreadDist) {
                var dx = node.x - closestNode.x;
                var dy = node.y - closestNode.y;
                if (closestDist > 0.1) {
                    // Gradient: closer to center = stronger push (tier 1 = 100%, tier 5 = 40%)
                    var tierGradient = 1.0 - (node.tier - 1) * 0.15;
                    tierGradient = Math.max(0.4, tierGradient);
                    
                    var pushStrength = (minSpreadDist - closestDist) * 0.5 * tierGradient;
                    var nx = dx / closestDist;
                    var ny = dy / closestDist;
                    
                    node.x += nx * pushStrength;
                    node.y += ny * pushStrength;
                    
                    // Update angle and radius from new position
                    node.angle = Math.atan2(node.y, node.x) * 180 / Math.PI;
                    node.radius = Math.sqrt(node.x * node.x + node.y * node.y);
                }
            }
        }
    }
    
    console.log('[LayoutGen] Inner zone spreading applied to', innerNodes.length, 'nodes');
    
    // =========================================================================
    // SECTOR BOUNDARY CLAMPING - Ensure all nodes stay within their pie slice
    // =========================================================================
    
    // Helper to normalize angle difference (handles 360° wrapping)
    function angleDiff(a, b) {
        var d = a - b;
        while (d > 180) d -= 360;
        while (d < -180) d += 360;
        return d;
    }
    
    // Sector bounds for clamping
    var sectorPadding = 8;  // Degrees of padding from edges (increased for safety)
    var spokeAngle = sliceInfo.spokeAngle;
    var halfSector = (sliceInfo.sectorAngle / 2) - sectorPadding;
    
    // Strict clamping function - forces position within sector
    function clampToSector(p) {
        if (p.isRoot) return false;  // Root is already centered
        
        var currentAngle = Math.atan2(p.y, p.x) * 180 / Math.PI;
        var radius = Math.sqrt(p.x * p.x + p.y * p.y);
        var diffFromSpoke = angleDiff(currentAngle, spokeAngle);
        
        if (Math.abs(diffFromSpoke) <= halfSector) {
            return false;  // Already within bounds
        }
        
        // Clamp to nearest boundary
        var clampedAngle = spokeAngle + (diffFromSpoke > 0 ? halfSector : -halfSector);
        var rad = clampedAngle * Math.PI / 180;
        p.x = Math.cos(rad) * radius;
        p.y = Math.sin(rad) * radius;
        p.angle = clampedAngle;
        return true;
    }
    
    // =========================================================================
    // SIMPLE OVERLAP RESOLUTION (matching web harness approach)
    // =========================================================================
    var minDist = LAYOUT_CONFIG.nodeSize * 1.0;  // Reduced from 1.2 to minimize pushing
    var spreadIterations = 3;  // Fewer iterations
    
    for (var iter = 0; iter < spreadIterations; iter++) {
        var moved = false;
        for (var i = 0; i < positions.length; i++) {
            var pi = positions[i];
            if (pi.isRoot) continue;
            
            for (var j = i + 1; j < positions.length; j++) {
                var pj = positions[j];
                var dx = pj.x - pi.x;
                var dy = pj.y - pi.y;
                var dist = Math.sqrt(dx * dx + dy * dy);
                
                if (dist < minDist && dist > 0.01) {
                    // Simple push along connecting line (like web harness)
                    var overlap = minDist - dist;
                    var pushX = (dx / dist) * overlap * 0.4;  // Reduced push factor
                    var pushY = (dy / dist) * overlap * 0.4;
                    
                    if (!pj.isRoot) {
                        pj.x += pushX;
                        pj.y += pushY;
                    }
                    if (!pi.isRoot) {
                        pi.x -= pushX;
                        pi.y -= pushY;
                    }
                    moved = true;
                }
            }
        }
        if (!moved) break;
    }
    
    // =========================================================================
    // FINAL CLAMP PASS - Force ALL positions within sector bounds
    // =========================================================================
    var clampCount = 0;
    positions.forEach(function(p) {
        if (clampToSector(p)) clampCount++;
    });
    
    if (clampCount > 0) {
        console.log('[LayoutGen] Clamped', clampCount, 'positions to sector bounds (spoke:', spokeAngle.toFixed(1) + '°, half:', halfSector.toFixed(1) + '°)')
    }
    
    console.log('[LayoutGenerator] Generated', positions.length, 'candidate positions for', 
                sliceInfo.sectorAngle.toFixed(1) + '° slice, shape:', shape);
    
    return positions;
}

/**
 * Select best positions to match spell count.
 * SIMPLIFIED: Just take positions from inner to outer until we have enough
 */
function selectPositions(positions, spellCount) {
    var targetCount = spellCount;
    
    console.log('[LayoutGenerator] selectPositions: need', targetCount, 'from', positions.length, 'available');
    
    if (positions.length <= targetCount) {
        console.log('[LayoutGenerator] Returning all', positions.length, 'positions (less than target)');
        return positions;  // Already at or below target
    }
    
    // Simple approach: Sort by tier (roots first, then inner to outer), take first targetCount
    var sorted = positions.slice().sort(function(a, b) {
        // Roots first
        if (a.isRoot && !b.isRoot) return -1;
        if (!a.isRoot && b.isRoot) return 1;
        // Then by tier
        return a.tier - b.tier;
    });
    
    var selected = sorted.slice(0, targetCount);
    
    // Count types for logging
    var roots = selected.filter(function(p) { return p.isRoot; }).length;
    var regular = selected.length - roots;
    
    console.log('[LayoutGenerator] Selected', selected.length, 'positions: roots=' + roots + 
                ', regular=' + regular);
    
    return selected;
}

/**
 * Calculate how many tiers we need for a given spell count.
 * Generates MORE tiers than strictly needed so shape masks have candidates to filter.
 */
function calculateTiersNeeded(spellCount, sectorAngle) {
    // Base calculation: estimate nodes per ring based on sector angle
    // With 72° slice and ~6 nodes per tier average, need spellCount/6 tiers
    var avgNodesPerTier = Math.max(4, Math.floor(sectorAngle / 12));
    var neededTiers = Math.ceil(spellCount / avgNodesPerTier) + 3;  // +3 for safety
    console.log('[LayoutGen] Tiers needed for', spellCount, 'spells:', neededTiers, '(avg', avgNodesPerTier, 'per tier)');
    return Math.min(neededTiers, LAYOUT_CONFIG.maxTiers);
}

// =============================================================================
// SHAPE MASKS - Define silhouettes for each shape
// =============================================================================

var _LG_SHAPE_MASKS = {
    // Always include all positions
    radial: function(tierProgress, angleNorm, rng) { return true; },
    
    // Natural organic with some randomness
    organic: function(tierProgress, angleNorm, rng) {
        return rng() > 0.15;
    },
    
    // Spiky rays emanating outward
    spiky: function(tierProgress, angleNorm, rng) {
        var rayCount = 5;
        var rayPhase = angleNorm * rayCount;
        var rayValue = Math.abs(Math.sin(rayPhase * Math.PI));
        var threshold = 0.3 + tierProgress * 0.4;
        return rayValue > threshold || rng() < 0.2;
    },
    
    // Mountain/triangle peak
    mountain: function(tierProgress, angleNorm, rng) {
        var peakWidth = 1.0 - tierProgress * 0.8;
        var distFromCenter = Math.abs(angleNorm - 0.5) * 2;
        return distFromCenter < peakWidth + rng() * 0.1;
    },
    
    // Puffy cloud clusters
    cloud: function(tierProgress, angleNorm, rng) {
        var bumpCount = 3;
        var bumpPhase = angleNorm * bumpCount * Math.PI;
        var bumpValue = Math.sin(bumpPhase) * 0.5 + 0.5;
        var cloudEdge = 0.7 + bumpValue * 0.3;
        return tierProgress < cloudEdge + rng() * 0.2;
    },
    
    // Cascading waterfall tiers
    cascade: function(tierProgress, angleNorm, rng) {
        var tierMod = tierProgress * 4;
        var tierBand = tierMod - Math.floor(tierMod);
        return tierBand > 0.3 || rng() < 0.3;
    },
    
    // Narrow linear beam
    linear: function(tierProgress, angleNorm, rng) {
        var beamWidth = 0.3;
        var distFromCenter = Math.abs(angleNorm - 0.5) * 2;
        return distFromCenter < beamWidth;
    },
    
    // Perfect grid
    grid: function(tierProgress, angleNorm, rng) { return true; },
    
    // Flame/fire shape
    flame: function(tierProgress, angleNorm, rng) {
        var flameWave = Math.sin(angleNorm * Math.PI * 4 + tierProgress * 2) * 0.3;
        var flameEdge = 0.8 - tierProgress * 0.5 + flameWave;
        var dist = Math.abs(angleNorm - 0.5) * 2;
        return dist < flameEdge + rng() * 0.15;
    },
    
    // Explosion/burst
    explosion: function(tierProgress, angleNorm, rng) {
        var burstCount = 8;
        var burstPhase = angleNorm * burstCount * Math.PI;
        var burstValue = Math.abs(Math.sin(burstPhase));
        return burstValue > 0.4 - tierProgress * 0.2 || tierProgress < 0.3;
    },
    
    // Lightning bolt
    lightning: function(tierProgress, angleNorm, rng) {
        var boltCenter = 0.5 + Math.sin(tierProgress * Math.PI * 3) * 0.2;
        var boltWidth = 0.25 - tierProgress * 0.1;
        var dist = Math.abs(angleNorm - boltCenter);
        return dist < boltWidth + rng() * 0.1;
    },
    
    // Castle towers
    castle: function(tierProgress, angleNorm, rng) {
        var towerCount = 3;
        var towerWidth = 0.12;
        var towerPositions = [];
        for (var i = 0; i < towerCount; i++) {
            towerPositions.push((i + 0.5) / towerCount);
        }
        for (var i = 0; i < towerPositions.length; i++) {
            if (Math.abs(angleNorm - towerPositions[i]) < towerWidth) return true;
        }
        return tierProgress < 0.4;
    },
    
    // Galaxy spiral arms
    galaxy: function(tierProgress, angleNorm, rng) {
        var armCount = 2;
        var spiralTwist = tierProgress * 1.5;
        var armPhase = (angleNorm * armCount + spiralTwist) * Math.PI;
        var armValue = Math.sin(armPhase) * 0.5 + 0.5;
        return armValue > 0.4 || rng() < 0.25;
    },
    
    // Tree branching
    tree: function(tierProgress, angleNorm, rng) {
        if (tierProgress < 0.3) {
            return Math.abs(angleNorm - 0.5) < 0.15;
        }
        var branchCount = 2 + Math.floor(tierProgress * 3);
        var branchPhase = angleNorm * branchCount * Math.PI;
        return Math.abs(Math.sin(branchPhase)) > 0.5 || rng() < 0.2;
    },
    
    // Heart shape
    heart: function(tierProgress, angleNorm, rng) {
        var t = (angleNorm - 0.5) * Math.PI;
        var heartX = 16 * Math.pow(Math.sin(t), 3);
        var heartY = 13 * Math.cos(t) - 5 * Math.cos(2*t) - 2 * Math.cos(3*t) - Math.cos(4*t);
        var heartR = Math.sqrt(heartX * heartX + heartY * heartY) / 20;
        return tierProgress < heartR + 0.2;
    },
    
    // Diamond shape
    diamond: function(tierProgress, angleNorm, rng) {
        var dist = Math.abs(angleNorm - 0.5) * 2;
        var diamondEdge = tierProgress < 0.5 ? tierProgress * 2 : 2 - tierProgress * 2;
        return dist < diamondEdge + 0.1;
    },
    
    // Crown
    crown: function(tierProgress, angleNorm, rng) {
        if (tierProgress < 0.3) return true;
        var pointCount = 5;
        var pointPhase = angleNorm * pointCount * Math.PI;
        var pointValue = Math.abs(Math.sin(pointPhase));
        return pointValue > 0.6 || tierProgress < 0.5;
    },
    
    // Wave pattern
    wave: function(tierProgress, angleNorm, rng) {
        var waveOffset = Math.sin(angleNorm * Math.PI * 3) * 0.2;
        var waveEdge = 0.7 + waveOffset;
        return tierProgress < waveEdge;
    },
    
    // Spiral
    spiral: function(tierProgress, angleNorm, rng) {
        var spiralPhase = (angleNorm + tierProgress * 2) % 1;
        var spiralWidth = 0.3;
        return spiralPhase < spiralWidth || spiralPhase > (1 - spiralWidth);
    },
    
    // Crescent moon
    crescent: function(tierProgress, angleNorm, rng) {
        var outerEdge = 0.9;
        var innerOffset = 0.3;
        var dist = Math.abs(angleNorm - 0.5) * 2;
        var inOuter = dist < outerEdge;
        var inInner = (angleNorm > 0.5) && (dist - innerOffset) < outerEdge * 0.6;
        return inOuter && !inInner;
    },
    
    // Star constellation
    star: function(tierProgress, angleNorm, rng) {
        var pointCount = 5;
        var innerRatio = 0.4;
        var pointPhase = angleNorm * pointCount * 2;
        var isPoint = (Math.floor(pointPhase) % 2 === 0);
        var effectiveRadius = isPoint ? 1.0 : innerRatio;
        return tierProgress < effectiveRadius;
    },
    
    // Big star with prominent points
    big_star: function(tierProgress, angleNorm, rng) {
        var pointCount = 5;
        var innerRatio = 0.35;
        var idx = angleNorm * pointCount * 2;
        var segmentProgress = idx - Math.floor(idx);
        var isPointSegment = (Math.floor(idx) % 2 === 0);
        var effectiveRadius;
        if (isPointSegment) {
            effectiveRadius = innerRatio + (1 - innerRatio) * (1 - Math.abs(segmentProgress - 0.5) * 2);
        } else {
            effectiveRadius = innerRatio + (1 - innerRatio) * Math.abs(segmentProgress - 0.5) * 2;
        }
        return tierProgress < effectiveRadius + rng() * 0.1;
    },
    
    // Ocean waves
    waves: function(tierProgress, angleNorm, rng) {
        var waveCount = 4;
        var wavePhase = tierProgress * waveCount * Math.PI;
        var waveAmplitude = 0.15 * (1 - tierProgress * 0.5);
        var waveOffset = Math.sin(wavePhase + angleNorm * Math.PI * 2) * waveAmplitude;
        var baseEdge = 0.2 + tierProgress * 0.6;
        var dist = Math.abs(angleNorm - 0.5) * 2;
        return dist < baseEdge + waveOffset + rng() * 0.05;
    },
    
    // Multiple swords/blades
    swords: function(tierProgress, angleNorm, rng) {
        var swordCount = 3;
        var swordWidth = 0.08;
        var guardTier = 0.25;
        var positions = [];
        for (var i = 0; i < swordCount; i++) {
            positions.push((i + 0.5) / swordCount);
        }
        for (var i = 0; i < positions.length; i++) {
            var dist = Math.abs(angleNorm - positions[i]);
            if (dist < swordWidth) return true;
            if (tierProgress < guardTier && tierProgress > guardTier - 0.1 && dist < swordWidth * 2.5) return true;
        }
        return false;
    }
};

// Shape jitter profiles
var _LG_SHAPE_PROFILES = {
    organic:    { jitterMult: 0.6 },
    radial:     { jitterMult: 0.2 },
    spiky:      { jitterMult: 0.8 },
    mountain:   { jitterMult: 0.4 },
    cloud:      { jitterMult: 0.7 },
    cascade:    { jitterMult: 0.3 },
    linear:     { jitterMult: 0.15 },
    grid:       { jitterMult: 0.0 },
    flame:      { jitterMult: 0.5 },
    explosion:  { jitterMult: 0.7 },
    lightning:  { jitterMult: 0.4 },
    castle:     { jitterMult: 0.2 },
    galaxy:     { jitterMult: 0.5 },
    tree:       { jitterMult: 0.4 },
    heart:      { jitterMult: 0.3 },
    diamond:    { jitterMult: 0.25 },
    crown:      { jitterMult: 0.35 },
    wave:       { jitterMult: 0.5 },
    spiral:     { jitterMult: 0.4 },
    crescent:   { jitterMult: 0.3 },
    star:       { jitterMult: 0.3 },
    big_star:   { jitterMult: 0.3 },
    waves:      { jitterMult: 0.5 },
    swords:     { jitterMult: 0.2 }
};

/**
 * Simple seeded random number generator.
 */
function seededRandom(seed) {
    var state = seed || Date.now();
    return function() {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        return state / 0x7fffffff;
    };
}

// =============================================================================
// MAIN LAYOUT GENERATION
// =============================================================================

/**
 * Generate complete layout for all schools.
 * 
 * @param {Object} schoolsData - Map of school name to {spell_count, spells, config}
 * @param {number} seed - Random seed
 * @returns {Object} - {schools: {name: {positions, sliceInfo}}, sliceAngles}
 */
function generateLayout(schoolsData, seed) {
    console.log('[LayoutGenerator] Generating layout for', Object.keys(schoolsData).length, 'schools');
    
    // Step 1: Calculate slice angles
    var sliceAngles = calculateSliceAngles(schoolsData);
    
    var result = {
        schools: {},
        sliceAngles: sliceAngles
    };
    
    for (var schoolName in schoolsData) {
        var school = schoolsData[schoolName];
        var sliceInfo = sliceAngles[schoolName];
        var config = school.config || {};
        var spellCount = school.spell_count || school.spells?.length || 0;
        var shape = config.shape || 'organic';
        
        // Generate positions using shape-based approach
        var positions = generateFullGrid(sliceInfo, spellCount, shape, config);
        
        // Select best positions to match spell count
        positions = selectPositions(positions, spellCount);
        
        result.schools[schoolName] = {
            positions: positions,
            sliceInfo: sliceInfo,
            config: config,
            spellCount: spellCount
        };
        
        console.log('[LayoutGenerator]', schoolName + ':', 
                    positions.length, 'positions,',
                    'slice:', sliceInfo.sectorAngle.toFixed(1) + '°,',
                    'shape:', shape);
    }
    
    return result;
}

/**
 * Simple string hash for seeding.
 */
function hashString(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}

// =============================================================================
// EXPORTS
// =============================================================================

window.LayoutGenerator = {
    generateLayout: generateLayout,
    calculateSliceAngles: calculateSliceAngles,
    generateFullGrid: generateFullGrid,
    calculateTiersNeeded: calculateTiersNeeded,
    selectPositions: selectPositions,
    SHAPE_MASKS: _LG_SHAPE_MASKS,
    SHAPE_PROFILES: _LG_SHAPE_PROFILES,
    LAYOUT_CONFIG: LAYOUT_CONFIG
};

window.generateLayout = generateLayout;
window.calculateSliceAngles = calculateSliceAngles;
// NOTE: SHAPE_MASKS and SHAPE_PROFILES are defined in shapeProfiles.js
// Do NOT overwrite them here — shapeProfiles.js is the authoritative source
