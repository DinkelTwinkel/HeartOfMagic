/**
 * Shape Profiles Module - Unified shape configuration for tree layout
 *
 * This module defines how different shape profiles affect node placement.
 * Used by both layoutGenerator and wheelRenderer.
 *
 * Depends on: config.js (GRID_CONFIG)
 *
 * Exports (global):
 * - SHAPE_PROFILES: Configuration for each shape type
 * - SHAPE_MASKS: Functions that determine node placement probability
 * - getShapeProfile(shapeName): Get profile by name
 * - getShapeMask(shapeName): Get mask function by name
 */

// =============================================================================
// SHAPE PROFILES
// =============================================================================

/**
 * Shape profiles define visual characteristics for each layout style.
 * These values are used consistently across all layout modules.
 */
var SHAPE_PROFILES = {
    organic: {
        name: 'Organic Flow',
        description: 'Natural, flowing growth pattern with gentle variation',

        // Jitter settings (relative to base values)
        radiusJitter: 0.20,        // 20% radius variation
        angleJitter: 12,           // 12 degrees angle variation

        // Spacing multipliers
        tierSpacingMult: 0.9,      // Slightly compact tiers
        spreadMult: 0.95,          // Almost full sector width

        // Behavior flags
        fillPieSlice: true,
        curveEdges: true,
        clusterNodes: false,

        // Density control
        densityMult: 1.0,          // Normal density
        innerDensityBoost: 1.2,    // Slightly denser near center
        outerDensityFade: 0.8      // Slightly sparser at edges
    },

    spiky: {
        name: 'Spiky Crystals',
        description: 'Dramatic, angular spikes reaching outward',

        radiusJitter: 0.15,        // Moderate - keep spikes straight
        angleJitter: 3,            // Very tight - stay on ray line

        tierSpacingMult: 1.6,      // VERY elongated outward
        spreadMult: 0.3,           // VERY narrow — 3 thin rays

        fillPieSlice: false,       // Let spikes poke out
        curveEdges: false,
        clusterNodes: false,

        densityMult: 0.6,          // Sparse
        innerDensityBoost: 1.0,
        outerDensityFade: 0.4      // Very sparse at tips
    },

    radial: {
        name: 'Radial Fan',
        description: 'Uniform, evenly-spread radial pattern',

        radiusJitter: 0.08,        // Very uniform
        angleJitter: 3,            // Evenly spread

        tierSpacingMult: 0.85,     // Compact tiers
        spreadMult: 1.0,           // Full pie usage

        fillPieSlice: true,
        curveEdges: true,
        clusterNodes: false,

        densityMult: 1.1,          // Slightly denser than organic
        innerDensityBoost: 1.0,
        outerDensityFade: 1.0      // Uniform density
    },

    mountain: {
        name: 'Mountain Peak',
        description: 'Packed base tapering to a peak',

        radiusJitter: 0.15,
        angleJitter: 10,

        tierSpacingMult: 0.55,     // Very compressed tiers (wide packed base)
        spreadMult: 1.1,           // Use MORE than full pie width at base

        fillPieSlice: true,
        curveEdges: true,
        clusterNodes: false,
        taperSpread: true,         // Narrows toward tips
        taperAmount: 0.15,         // Only 15% width at peak (very narrow)
        fillTriangle: true,        // Fill triangular area

        densityMult: 1.5,          // Very dense packing
        innerDensityBoost: 2.0,    // Extremely dense at base
        outerDensityFade: 0.3      // Very sparse at peak
    },

    cloud: {
        name: 'Cloud Clusters',
        description: 'Loose clusters with organic spacing',

        radiusJitter: 0.30,        // Clustered groupings
        angleJitter: 18,           // Irregular

        tierSpacingMult: 1.0,
        spreadMult: 0.85,

        fillPieSlice: true,
        curveEdges: true,
        clusterNodes: true,        // Group related nodes
        clusterSize: 3,            // Nodes per cluster
        clusterSpacing: 1.5,       // Space between clusters

        densityMult: 0.9,
        innerDensityBoost: 1.1,
        outerDensityFade: 0.7
    },

    cascade: {
        name: 'Cascading Waterfall',
        description: 'Clear tier separation with staggered columns',

        radiusJitter: 0.06,
        angleJitter: 4,

        tierSpacingMult: 1.3,      // Clear tier separation
        spreadMult: 1.0,

        fillPieSlice: true,
        curveEdges: false,         // Straight edges for clarity
        clusterNodes: false,

        densityMult: 1.0,
        innerDensityBoost: 1.0,
        outerDensityFade: 1.0
    },

    linear: {
        name: 'Linear Beam',
        description: 'Focused narrow progression',

        radiusJitter: 0.05,
        angleJitter: 2,

        tierSpacingMult: 1.1,
        spreadMult: 0.5,           // Narrow focused beam

        fillPieSlice: false,       // Intentionally narrow
        curveEdges: true,
        clusterNodes: false,

        densityMult: 0.8,          // Linear = fewer nodes per tier
        innerDensityBoost: 1.0,
        outerDensityFade: 1.0
    },

    grid: {
        name: 'Perfect Grid',
        description: 'Uniform grid layout with no variation',

        radiusJitter: 0.0,         // Perfect grid
        angleJitter: 0,

        tierSpacingMult: 0.95,
        spreadMult: 1.0,

        fillPieSlice: true,
        curveEdges: false,
        clusterNodes: false,

        densityMult: 1.0,
        innerDensityBoost: 1.0,
        outerDensityFade: 1.0
    },

    tree: {
        name: 'Natural Tree',
        description: 'Thick visible trunk from root, expanding into wide dense canopy at outer tiers',

        radiusJitter: 0.08,
        angleJitter: 4,            // Moderate — visible trunk width

        tierSpacingMult: 1.1,      // Slightly elongated for trunk visibility
        spreadMult: 1.0,           // Full sector width for wide canopy

        fillPieSlice: true,
        curveEdges: true,
        clusterNodes: false,

        densityMult: 1.0,
        innerDensityBoost: 0.4,    // Moderate trunk density (visible thickness)
        outerDensityFade: 2.0      // Very dense canopy
    },

    swords: {
        name: 'Crossed Swords',
        description: 'Two broad blade wedges with a gap between them, like crossed swords',

        radiusJitter: 0.08,
        angleJitter: 3,

        tierSpacingMult: 1.4,      // Elongated blades reaching outward
        spreadMult: 0.6,           // Moderate width — two blades fill partial sector

        fillPieSlice: false,       // Blades don't fill the whole pie
        curveEdges: false,
        clusterNodes: false,

        densityMult: 0.8,
        innerDensityBoost: 1.5,    // Dense at hilt
        outerDensityFade: 0.5      // Taper at blade tips
    },

    portals: {
        name: 'Portal Doorway',
        description: 'Organic fill with a huge arched doorway hole in the center, like a conjuration portal',

        radiusJitter: 0.15,
        angleJitter: 10,

        tierSpacingMult: 0.85,     // Compact — dense fill with holes
        spreadMult: 0.95,          // Nearly full sector (holes remove density)

        fillPieSlice: true,
        curveEdges: true,
        clusterNodes: false,

        densityMult: 1.2,          // Dense base (holes remove nodes, so start dense)
        innerDensityBoost: 1.0,
        outerDensityFade: 0.9
    },

    explosion: {
        name: 'Fire Explosion',
        description: 'Dense core bursting outward into scattered flames — like a fireball detonating',

        radiusJitter: 0.22,        // High — irregular flame edges
        angleJitter: 12,           // Moderate — flames spread around

        tierSpacingMult: 1.2,      // Slightly elongated — flames reach outward
        spreadMult: 0.3,           // Narrow at core (mask handles the blast expansion)

        fillPieSlice: false,       // Irregular explosion shape
        curveEdges: false,
        clusterNodes: false,

        densityMult: 1.3,          // Dense core
        innerDensityBoost: 2.5,    // VERY dense packed center (fireball core)
        outerDensityFade: 0.35     // Sparse trailing flames/debris at edges
    }
};

// =============================================================================
// SHAPE MASKS
// =============================================================================

/**
 * Shape masks are functions that determine whether a node should be placed
 * at a given position within the layout grid.
 *
 * @param {number} depth - Normalized depth (0 = center, 1 = edge)
 * @param {number} angleNorm - Normalized angle within sector (0-1)
 * @param {function} rng - Seeded random number generator
 * @param {Object} profile - The shape profile being used
 * @returns {boolean} - True if node should be placed here
 */
var SHAPE_MASKS = {
    organic: function(depth, angleNorm, rng, profile) {
        // Organic: Smooth flow with center bias - MORE RESTRICTIVE
        var centerBias = 1 - Math.abs(angleNorm - 0.5) * 0.8;
        var depthFade = Math.max(0.3, 1 - depth * 0.6);
        return rng() < centerBias * depthFade * 0.55;
    },

    spiky: function(depth, angleNorm, rng, profile) {
        // Spiky: 3 narrow rays — DETERMINISTIC (no RNG rejection)
        var rayCount = 3;
        var rayPhase = (angleNorm * rayCount) % 1;
        var rayWidth = 0.10;  // 10% of sector each side = 20% per ray
        var onRay = rayPhase < rayWidth || rayPhase > (1 - rayWidth);
        // Always accept if on ray — maximizes on-mask positions
        return onRay;
    },

    radial: function(depth, angleNorm, rng, profile) {
        // Radial: Even rings with slight tier separation
        var tierRing = (depth * 5) % 1;
        var onRing = tierRing < 0.6;
        return onRing && rng() < 0.5;
    },

    mountain: function(depth, angleNorm, rng, profile) {
        // Mountain: EXTREME triangle — full width at base, pinpoint at peak
        // DETERMINISTIC width check, no RNG rejection
        var peakWidth = 0.05;  // 5% at peak
        var width = 1.0 - depth * (1.0 - peakWidth);  // linear taper from 1.0 to 0.05
        var distFromCenter = Math.abs(angleNorm - 0.5) * 2;
        return distFromCenter < width;  // Pure geometric mask — no randomness
    },

    cloud: function(depth, angleNorm, rng, profile) {
        // Cloud: Scattered clusters with gaps — MOSTLY deterministic
        var clusterCount = 5;
        var clusterPhase = (angleNorm * clusterCount + depth * 3) % 1;
        var inCluster = clusterPhase < 0.35;  // 35% of space has nodes (generous for capacity)
        return inCluster;  // Pure pattern mask — scoring handles the rest
    },

    cascade: function(depth, angleNorm, rng, profile) {
        // Cascade: HARD column structure with tier stagger — DETERMINISTIC
        var numCols = 5;
        var columnPhase = (angleNorm * numCols) % 1;
        // Nodes in column bands (25% of each column width)
        var inColumn = columnPhase < 0.25 || columnPhase > 0.75;
        // Stagger: alternate columns appear/disappear each tier
        var colIndex = Math.floor(angleNorm * numCols);
        var tierParity = Math.floor(depth * 6) % 2;
        var activeColumn = (colIndex + tierParity) % 2 === 0;
        return inColumn && activeColumn;  // Pure pattern — no RNG rejection
    },

    linear: function(depth, angleNorm, rng, profile) {
        // Linear: Narrow beam down the center
        var centerDist = Math.abs(angleNorm - 0.5);
        var inBeam = centerDist < 0.25;  // Central 50%
        return inBeam && rng() < 0.9;
    },

    grid: function(depth, angleNorm, rng, profile) {
        // Grid: Always accept (uniform grid)
        return true;
    },

    tree: function(depth, angleNorm, rng, profile) {
        // Tree: thick trunk → branches spreading → dome canopy curving back down
        // DETERMINISTIC geometric mask
        var distFromCenter = Math.abs(angleNorm - 0.5) * 2; // 0=center, 1=edge

        var trunkWidth = 0.10;
        var trunkEnd = 0.30;
        var branchEnd = 0.50;
        var canopyPeak = 0.72;   // Widest point of canopy
        var canopyMax = 0.95;    // Max width at peak
        var droopEnd = 1.0;      // Canopy narrows back down

        var width;
        if (depth < trunkEnd) {
            // TRUNK: thick center column
            width = trunkWidth;
        } else if (depth < branchEnd) {
            // BRANCHES: 4 distinct branch lines spreading from trunk
            var branchT = (depth - trunkEnd) / (branchEnd - trunkEnd); // 0→1
            var branchWidth = trunkWidth + branchT * 0.30; // Gradually widen
            // 4 branch positions: 0.15, 0.35, 0.65, 0.85 (in angleNorm)
            var branches = [0.15, 0.35, 0.65, 0.85];
            var onBranch = false;
            for (var bi = 0; bi < branches.length; bi++) {
                var bd = Math.abs(angleNorm - branches[bi]);
                var bw = 0.06 + branchT * 0.04; // Branch line width
                if (bd < bw) { onBranch = true; break; }
            }
            // Also allow trunk continuation through branches
            if (distFromCenter < trunkWidth) onBranch = true;
            return onBranch;
        } else if (depth < canopyPeak) {
            // CANOPY EXPANSION: rapid widening to peak
            var t = (depth - branchEnd) / (canopyPeak - branchEnd);
            width = 0.30 + t * t * (canopyMax - 0.30);
        } else {
            // CANOPY DROOP: curves back inward (dome shape)
            var t = (depth - canopyPeak) / (droopEnd - canopyPeak);
            // Parabolic narrowing from canopyMax back to 0.35
            width = canopyMax - t * t * (canopyMax - 0.35);
        }

        return distFromCenter <= width;
    },

    swords: function(depth, angleNorm, rng, profile) {
        // Swords: TWO broad blade wedges separated by a gap
        // DETERMINISTIC geometric mask
        var bladeWidth = 0.15;  // Each blade is 30% of sector
        var tipTaper = 1.0 - depth * 0.5;  // Blades narrow at tips

        var blade1Center = 0.20;
        var blade2Center = 0.80;
        var onBlade1 = Math.abs(angleNorm - blade1Center) < bladeWidth * tipTaper;
        var onBlade2 = Math.abs(angleNorm - blade2Center) < bladeWidth * tipTaper;

        return onBlade1 || onBlade2;
    },

    explosion: function(depth, angleNorm, rng, profile) {
        // Explosion: TIGHT core → sub-explosions near base → HOLLOW V-blast
        // DETERMINISTIC geometric mask
        var distFromCenter = Math.abs(angleNorm - 0.5) * 2; // 0=center, 1=edge

        // Core (depth 0-0.10): very tight packed center
        if (depth < 0.10) {
            return distFromCenter <= 0.12;
        }

        // SUB-EXPLOSIONS near base (depth 0.10-0.35): 3 smaller blast clusters
        // These are circles of acceptance at specific off-center positions
        if (depth >= 0.10 && depth <= 0.40) {
            var subBlasts = [
                {d: 0.18, a: 0.25, r: 0.10},  // Left sub-explosion
                {d: 0.22, a: 0.72, r: 0.09},  // Right sub-explosion
                {d: 0.32, a: 0.50, r: 0.08}   // Center sub-explosion (secondary)
            ];
            for (var si = 0; si < subBlasts.length; si++) {
                var sb = subBlasts[si];
                var dd = depth - sb.d;
                var da = angleNorm - sb.a;
                if (dd * dd + da * da < sb.r * sb.r) {
                    return true;  // Inside a sub-explosion cluster
                }
            }
        }

        // Main blast zone: V-shape with hollow center
        var t = (depth - 0.10) / 0.90; // 0→1
        var sqrtT = Math.sqrt(t);

        // Outer envelope: sqrt expansion (fast initial burst)
        var outerWidth = 0.12 + sqrtT * 0.85;

        // Inner hole: grows with sqrt(depth) — hollow center
        var innerHole = sqrtT * 0.45;

        // 5 flame tendrils penetrate the inner hole
        var armCount = 5;
        var armPhase = (angleNorm * armCount + depth * 0.5) % 1;
        var onArm = armPhase < 0.10 || armPhase > 0.90;

        if (onArm) {
            return distFromCenter <= outerWidth;
        }

        // Normal blast: must be in ring between inner hole and outer envelope
        return distFromCenter >= innerHole && distFromCenter <= outerWidth;
    },

    portals: function(depth, angleNorm, rng, profile) {
        // Portals: Organic fill with ONE MASSIVE doorway arch hole in the center
        // DETERMINISTIC geometric mask

        // The doorway: a HUGE arch spanning most of the sector
        // Creates a clear portal/gateway shape — nodes only around the frame
        var doorBottom = 0.08;
        var doorTop = 0.85;
        var doorHalfWidth = 0.35;  // 70% of sector at base — very wide doorway

        if (depth >= doorBottom && depth <= doorTop) {
            var doorProgress = (depth - doorBottom) / (doorTop - doorBottom); // 0→1
            // Arch curve: semicircular narrowing at top
            var archFactor = Math.sqrt(1.0 - doorProgress * doorProgress);  // Circular arch
            var archWidth = doorHalfWidth * archFactor;
            var distFromCenter = Math.abs(angleNorm - 0.5);

            if (distFromCenter < archWidth) {
                return false;  // Inside the doorway hole — masked out
            }
        }

        // Outside the doorway — accept (organic fill forms the frame)
        return true;
    }
};

// =============================================================================
// SCHOOL DEFAULT SHAPES
// =============================================================================

/**
 * Default shape assignments for each magic school.
 * Can be overridden by user preferences or LLM suggestions.
 */
var SCHOOL_DEFAULT_SHAPES = {
    'Destruction': 'explosion',   // Fireball detonation — dense core exploding outward
    'Restoration': 'tree',       // Living tree, nurturing growth
    'Alteration': 'mountain',    // Building, structured
    'Conjuration': 'portals',    // Portal circles with organic fill
    'Illusion': 'organic'         // Original organic flow
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get a shape profile by name
 * @param {string} shapeName
 * @returns {Object} - Shape profile or organic as default
 */
function getShapeProfile(shapeName) {
    return SHAPE_PROFILES[shapeName] || SHAPE_PROFILES.organic;
}

/**
 * Get a shape mask function by name
 * @param {string} shapeName
 * @returns {function} - Mask function or organic as default
 */
function getShapeMask(shapeName) {
    return SHAPE_MASKS[shapeName] || SHAPE_MASKS.organic;
}

/**
 * Get default shape for a school
 * @param {string} schoolName
 * @returns {string} - Shape name
 */
function getSchoolDefaultShape(schoolName) {
    return SCHOOL_DEFAULT_SHAPES[schoolName] || 'organic';
}

/**
 * Apply shape profile to layout configuration
 * @param {Object} baseConfig - Base layout config (from GRID_CONFIG)
 * @param {string} shapeName - Shape to apply
 * @returns {Object} - Modified config with shape adjustments
 */
function applyShapeToConfig(baseConfig, shapeName) {
    var profile = getShapeProfile(shapeName);

    return {
        nodeSize: baseConfig.nodeSize,
        baseRadius: baseConfig.baseRadius,
        tierSpacing: Math.round(baseConfig.tierSpacing * profile.tierSpacingMult),
        arcSpacing: baseConfig.arcSpacing,
        minNodeSpacing: baseConfig.minNodeSpacing,

        // Shape-specific additions
        radiusJitter: profile.radiusJitter,
        angleJitter: profile.angleJitter,
        spreadMult: profile.spreadMult,
        densityMult: profile.densityMult,

        // Behavior flags
        fillPieSlice: profile.fillPieSlice,
        curveEdges: profile.curveEdges,
        clusterNodes: profile.clusterNodes,
        taperSpread: profile.taperSpread,
        taperAmount: profile.taperAmount
    };
}

/**
 * Check if a position passes the shape mask
 * @param {string} shapeName - Shape to use
 * @param {number} depth - Normalized depth (0-1)
 * @param {number} angleNorm - Normalized angle within sector (0-1)
 * @param {function} rng - Random number generator
 * @returns {boolean}
 */
function passesShapeMask(shapeName, depth, angleNorm, rng) {
    var mask = getShapeMask(shapeName);
    var profile = getShapeProfile(shapeName);
    return mask(depth, angleNorm, rng, profile);
}

// =============================================================================
// EXPORTS
// =============================================================================

window.SHAPE_PROFILES = SHAPE_PROFILES;
window.SHAPE_MASKS = SHAPE_MASKS;
window.SCHOOL_DEFAULT_SHAPES = SCHOOL_DEFAULT_SHAPES;
window.getShapeProfile = getShapeProfile;
window.getShapeMask = getShapeMask;
window.getSchoolDefaultShape = getSchoolDefaultShape;
window.applyShapeToConfig = applyShapeToConfig;
window.passesShapeMask = passesShapeMask;

console.log('[ShapeProfiles] Module loaded with', Object.keys(SHAPE_PROFILES).length, 'shapes');
