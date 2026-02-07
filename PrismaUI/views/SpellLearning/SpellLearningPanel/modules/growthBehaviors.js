/**
 * Growth Behavior System
 * 
 * Defines how each school's tree grows organically.
 * Each behavior profile controls the "personality" of tree growth.
 */

// ============================================================
// GROWTH BEHAVIOR PARAMETERS
// ============================================================

/**
 * @typedef {Object} GrowthBehavior
 * 
 * @property {string} name - Display name for this behavior
 * @property {string} description - What this growth pattern looks like
 * 
 * === VERTICAL CONTROL ===
 * @property {number} verticalBias - Preference for growing up vs filling low
 *   -1.0 = Always fill lowest tier first (mountain/pile)
 *    0.0 = Balanced growth
 *   +1.0 = Always reach for maximum height (reaching/tree)
 * 
 * @property {number} layerFillThreshold - How full a tier must be before moving up (0-1)
 *   0.0 = Never wait, always expand outward
 *   0.5 = Fill tier 50% before creating nodes in next tier
 *   1.0 = Completely fill each tier before moving up
 * 
 * === HORIZONTAL CONTROL ===
 * @property {number} spreadFactor - How wide to spread at each tier (0-1)
 *   0.0 = Tight clustering, minimal spread
 *   0.5 = Moderate spread
 *   1.0 = Maximum spread across available sector
 * 
 * @property {number} angularWander - How much angle can change between parent/child
 *   0 = Children directly outward from parent
 *   30 = Children can be up to 30 degrees off from parent's angle
 * 
 * === BRANCHING PATTERNS ===
 * @property {number} branchingFactor - Target children per non-terminal node (1-5)
 * @property {number} branchingVariance - Randomness in branching (0-1)
 * 
 * @property {string} branchStyle - How branches form
 *   'linear' = Single chain (1 child each)
 *   'binary' = Split into 2
 *   'radial' = Fan out in multiple directions
 *   'clustered' = Create tight groups then branch
 * 
 * === BRANCH ENERGY SYSTEM ===
 * @property {number} branchChance - Base probability of creating a new branch (0-1)
 * @property {number} branchEnergyGain - Energy gained per node that doesn't branch (0.05-0.3)
 * @property {number} branchEnergyThreshold - Force branch when energy reaches this (1-3)
 * @property {boolean} branchSubdividePool - When branching, do fresh fuzzy check on branch's spell pool
 * 
 * === HUB BEHAVIOR ===
 * @property {number} hubProbability - Chance a node becomes a hub (0-1)
 * @property {number} hubMinSpacing - Minimum nodes between hubs
 * @property {number} hubBranchCount - How many branches from a hub (3-8)
 * 
 * === TERMINAL/FRUIT BEHAVIOR ===
 * @property {boolean} createTerminalClusters - Whether to create "fruit" clusters at ends
 * @property {number} terminalClusterSize - Size of end clusters (2-8)
 * @property {number} terminalClusterChance - Probability of cluster vs single terminal
 * 
 * === WAVE/OSCILLATION ===
 * @property {number} waveAmplitude - How much the growth "waves" side to side (0-30 degrees)
 * @property {number} waveFrequency - How often it oscillates (0.5-3.0)
 * 
 * === CROSS-CONNECTIONS ===
 * @property {number} crossConnectionDensity - Extra connections between branches (0-1)
 * @property {number} crossConnectionMaxDist - Maximum distance for cross-connections
 * @property {boolean} webPattern - Whether to create spider-web like connections
 * 
 * === PHASE CHANGES ===
 * @property {Array<PhaseChange>} phases - Behavior changes at different progress points
 */

/**
 * @typedef {Object} PhaseChange
 * @property {number} at - Progress point (0-1) where this phase starts
 * @property {Object} changes - Parameter overrides for this phase
 */

// ============================================================
// PREDEFINED BEHAVIOR PROFILES
// ============================================================

var GROWTH_BEHAVIORS = {
    
    // --- DESTRUCTION: Aggressive, explosive, reaching upward ---
    fire_explosion: {
        name: 'Fire Explosion',
        description: 'Bursts outward aggressively, then reaches for the sky',
        
        outwardGrowth: 0.85,  // Very aggressive outward expansion
        verticalBias: 0.6,
        layerFillThreshold: 0.2,
        spreadFactor: 0.8,
        angularWander: 25,
        
        branchingFactor: 3,
        branchingVariance: 0.4,
        branchStyle: 'radial',
        
        branchChance: 0.35,
        branchEnergyGain: 0.15,
        branchEnergyThreshold: 1.5,
        branchSubdividePool: true,
        
        hubProbability: 0.15,
        hubMinSpacing: 8,
        hubBranchCount: 5,
        
        createTerminalClusters: true,
        terminalClusterSize: 3,
        terminalClusterChance: 0.3,
        
        waveAmplitude: 5,
        waveFrequency: 2.0,
        
        crossConnectionDensity: 0.1,
        crossConnectionMaxDist: 2.0,
        webPattern: false,
        
        phases: [
            { at: 0.0, changes: { spreadFactor: 0.9, verticalBias: 0.3 } },
            { at: 0.4, changes: { spreadFactor: 0.6, verticalBias: 0.8 } },
            { at: 0.8, changes: { terminalClusterChance: 0.6 } }
        ]
    },
    
    // --- RESTORATION: Gentle, nurturing, fills completely before growing ---
    gentle_bloom: {
        name: 'Gentle Bloom',
        description: 'Fills each layer lovingly before reaching upward, like petals opening',
        
        outwardGrowth: 0.4,   // Moderate, fills first before expanding
        verticalBias: -0.4,
        layerFillThreshold: 0.7,
        spreadFactor: 0.6,
        angularWander: 15,
        
        branchingFactor: 2,
        branchingVariance: 0.2,
        branchStyle: 'binary',
        
        branchChance: 0.2,
        branchEnergyGain: 0.1,
        branchEnergyThreshold: 2.0,
        branchSubdividePool: true,
        
        hubProbability: 0.08,
        hubMinSpacing: 12,
        hubBranchCount: 4,
        
        createTerminalClusters: true,
        terminalClusterSize: 4,
        terminalClusterChance: 0.4,
        
        waveAmplitude: 8,
        waveFrequency: 0.8,
        
        crossConnectionDensity: 0.2,
        crossConnectionMaxDist: 1.5,
        webPattern: false,
        
        phases: [
            { at: 0.0, changes: { layerFillThreshold: 0.8 } },
            { at: 0.5, changes: { layerFillThreshold: 0.5, terminalClusterChance: 0.5 } },
            { at: 0.85, changes: { createTerminalClusters: true, terminalClusterSize: 5 } }
        ]
    },
    
    // --- ALTERATION: Structured, geometric, mountain-like ---
    mountain_builder: {
        name: 'Mountain Builder',
        description: 'Builds up in structured layers, creating a solid foundation',
        
        outwardGrowth: 0.3,   // Compact, builds foundation first
        verticalBias: -0.7,
        layerFillThreshold: 0.85,
        spreadFactor: 0.4,
        angularWander: 10,
        
        branchingFactor: 2,
        branchingVariance: 0.1,
        branchStyle: 'clustered',
        
        branchChance: 0.15,
        branchEnergyGain: 0.08,
        branchEnergyThreshold: 2.5,
        branchSubdividePool: true,
        
        hubProbability: 0.25,
        hubMinSpacing: 6,
        hubBranchCount: 3,
        
        createTerminalClusters: false,
        terminalClusterSize: 2,
        terminalClusterChance: 0.1,
        
        waveAmplitude: 0,
        waveFrequency: 0,
        
        crossConnectionDensity: 0.3,
        crossConnectionMaxDist: 1.2,
        webPattern: false,
        
        phases: [
            { at: 0.0, changes: { spreadFactor: 0.5, hubProbability: 0.3 } },
            { at: 0.6, changes: { spreadFactor: 0.3, verticalBias: -0.5 } },
            { at: 0.9, changes: { layerFillThreshold: 0.5 } }
        ]
    },
    
    // --- CONJURATION: Chaotic, portal-like hubs, distant clusters ---
    portal_network: {
        name: 'Portal Network',
        description: 'Creates hub portals that spawn distant connected clusters',
        
        outwardGrowth: 0.95,  // Maximum outward reach for distant portals
        verticalBias: 0.2,
        layerFillThreshold: 0.3,
        spreadFactor: 0.9,
        angularWander: 35,
        
        branchingFactor: 4,
        branchingVariance: 0.6,
        branchStyle: 'radial',
        
        branchChance: 0.4,
        branchEnergyGain: 0.2,
        branchEnergyThreshold: 1.2,
        branchSubdividePool: true,
        
        hubProbability: 0.35,
        hubMinSpacing: 5,
        hubBranchCount: 6,
        
        createTerminalClusters: true,
        terminalClusterSize: 5,
        terminalClusterChance: 0.5,
        
        waveAmplitude: 12,
        waveFrequency: 1.5,
        
        crossConnectionDensity: 0.15,
        crossConnectionMaxDist: 3.0,
        webPattern: false,
        
        phases: [
            { at: 0.0, changes: { hubProbability: 0.4, spreadFactor: 0.7 } },
            { at: 0.3, changes: { spreadFactor: 1.0, branchingFactor: 5 } },
            { at: 0.7, changes: { terminalClusterChance: 0.7, terminalClusterSize: 6 } }
        ]
    },
    
    // --- ILLUSION: Mysterious, web-like, deceptive paths ---
    spider_web: {
        name: 'Spider Web',
        description: 'Weaves an intricate web of interconnected paths',
        
        outwardGrowth: 0.6,   // Balanced web expansion
        verticalBias: 0.0,
        layerFillThreshold: 0.5,
        spreadFactor: 0.75,
        angularWander: 20,
        
        branchingFactor: 3,
        branchingVariance: 0.3,
        branchStyle: 'radial',
        
        branchChance: 0.3,
        branchEnergyGain: 0.12,
        branchEnergyThreshold: 1.8,
        branchSubdividePool: true,
        
        hubProbability: 0.2,
        hubMinSpacing: 7,
        hubBranchCount: 5,
        
        createTerminalClusters: false,
        terminalClusterSize: 3,
        terminalClusterChance: 0.2,
        
        waveAmplitude: 15,
        waveFrequency: 1.2,
        
        crossConnectionDensity: 0.5,
        crossConnectionMaxDist: 2.5,
        webPattern: true,
        
        phases: [
            { at: 0.0, changes: { webPattern: true, crossConnectionDensity: 0.3 } },
            { at: 0.4, changes: { crossConnectionDensity: 0.6, waveAmplitude: 20 } },
            { at: 0.75, changes: { crossConnectionDensity: 0.4, spreadFactor: 0.6 } }
        ]
    },
    
    // --- Additional behaviors for variety ---
    
    ocean_wave: {
        name: 'Ocean Wave',
        description: 'Flows like waves, building up then crashing outward',
        
        outwardGrowth: 0.7,   // Waves push outward
        verticalBias: 0.1,
        layerFillThreshold: 0.4,
        spreadFactor: 0.7,
        angularWander: 30,
        
        branchingFactor: 2,
        branchingVariance: 0.3,
        branchStyle: 'binary',
        
        branchChance: 0.25,
        branchEnergyGain: 0.15,
        branchEnergyThreshold: 1.6,
        branchSubdividePool: true,
        
        hubProbability: 0.1,
        hubMinSpacing: 10,
        hubBranchCount: 4,
        
        createTerminalClusters: true,
        terminalClusterSize: 3,
        terminalClusterChance: 0.25,
        
        waveAmplitude: 25,
        waveFrequency: 0.6,
        
        crossConnectionDensity: 0.15,
        crossConnectionMaxDist: 2.0,
        webPattern: false,
        
        phases: [
            { at: 0.0, changes: { waveAmplitude: 15, verticalBias: -0.2 } },
            { at: 0.33, changes: { waveAmplitude: 30, verticalBias: 0.4 } },
            { at: 0.66, changes: { waveAmplitude: 20, spreadFactor: 0.9 } }
        ]
    },
    
    ancient_tree: {
        name: 'Ancient Tree',
        description: 'Grows like an old tree - thick trunk, spreading branches, leaf clusters',
        
        outwardGrowth: 0.55,  // Moderate, trunk then canopy
        verticalBias: 0.5,
        layerFillThreshold: 0.6,
        spreadFactor: 0.5,
        angularWander: 15,
        
        branchingFactor: 2,
        branchingVariance: 0.2,
        branchStyle: 'binary',
        
        branchChance: 0.25,
        branchEnergyGain: 0.1,
        branchEnergyThreshold: 2.0,
        branchSubdividePool: true,
        
        hubProbability: 0.2,
        hubMinSpacing: 8,
        hubBranchCount: 4,
        
        createTerminalClusters: true,
        terminalClusterSize: 5,
        terminalClusterChance: 0.6,
        
        waveAmplitude: 5,
        waveFrequency: 1.0,
        
        crossConnectionDensity: 0.05,
        crossConnectionMaxDist: 1.5,
        webPattern: false,
        
        phases: [
            { at: 0.0, changes: { spreadFactor: 0.2, branchingFactor: 1 } }, // trunk
            { at: 0.3, changes: { spreadFactor: 0.6, branchingFactor: 3 } }, // branches
            { at: 0.7, changes: { terminalClusterChance: 0.8, spreadFactor: 0.8 } } // canopy
        ]
    },
    
    crystal_growth: {
        name: 'Crystal Growth',
        description: 'Geometric, angular growth like crystal formation',
        
        outwardGrowth: 0.5,   // Balanced geometric expansion
        verticalBias: 0.3,
        layerFillThreshold: 0.5,
        spreadFactor: 0.6,
        angularWander: 8,
        
        branchingFactor: 3,
        branchingVariance: 0.1,
        branchStyle: 'linear',
        
        branchChance: 0.35,
        branchEnergyGain: 0.08,
        branchEnergyThreshold: 2.2,
        branchSubdividePool: false,
        
        hubProbability: 0.3,
        hubMinSpacing: 5,
        hubBranchCount: 6,
        
        createTerminalClusters: false,
        terminalClusterSize: 2,
        terminalClusterChance: 0.1,
        
        waveAmplitude: 0,
        waveFrequency: 0,
        
        crossConnectionDensity: 0.4,
        crossConnectionMaxDist: 1.8,
        webPattern: false,
        
        phases: [
            { at: 0.0, changes: { hubProbability: 0.4 } },
            { at: 0.5, changes: { branchingFactor: 4, angularWander: 12 } },
            { at: 0.8, changes: { crossConnectionDensity: 0.5 } }
        ]
    },
    
    vine_crawl: {
        name: 'Vine Crawl',
        description: 'Crawls along surfaces, occasionally shooting up new vines',
        
        outwardGrowth: 0.75,  // Vines reach far outward
        verticalBias: -0.3,
        layerFillThreshold: 0.3,
        spreadFactor: 0.9,
        angularWander: 40,
        
        branchingFactor: 1.5,
        branchingVariance: 0.5,
        branchStyle: 'linear',
        
        branchChance: 0.18,
        branchEnergyGain: 0.2,
        branchEnergyThreshold: 1.3,
        branchSubdividePool: true,
        
        hubProbability: 0.1,
        hubMinSpacing: 15,
        hubBranchCount: 3,
        
        createTerminalClusters: true,
        terminalClusterSize: 2,
        terminalClusterChance: 0.3,
        
        waveAmplitude: 20,
        waveFrequency: 2.5,
        
        crossConnectionDensity: 0.25,
        crossConnectionMaxDist: 2.0,
        webPattern: false,
        
        phases: [
            { at: 0.0, changes: { verticalBias: 0.2, spreadFactor: 0.5 } },
            { at: 0.4, changes: { verticalBias: -0.5, spreadFactor: 1.0 } },
            { at: 0.8, changes: { verticalBias: 0.0, terminalClusterChance: 0.5 } }
        ]
    },
    
    nebula_burst: {
        name: 'Nebula Burst',
        description: 'Starts tight, then explodes outward in all directions',
        
        outwardGrowth: 1.0,   // Maximum outward explosion
        verticalBias: 0.0,
        layerFillThreshold: 0.1,
        spreadFactor: 0.3,
        angularWander: 45,
        
        branchingFactor: 4,
        branchingVariance: 0.7,
        branchStyle: 'radial',
        
        branchChance: 0.45,
        branchEnergyGain: 0.25,
        branchEnergyThreshold: 1.0,
        branchSubdividePool: true,
        
        hubProbability: 0.05,
        hubMinSpacing: 20,
        hubBranchCount: 8,
        
        createTerminalClusters: true,
        terminalClusterSize: 4,
        terminalClusterChance: 0.4,
        
        waveAmplitude: 10,
        waveFrequency: 3.0,
        
        crossConnectionDensity: 0.08,
        crossConnectionMaxDist: 3.5,
        webPattern: false,
        
        phases: [
            { at: 0.0, changes: { spreadFactor: 0.2, branchingFactor: 2 } },
            { at: 0.2, changes: { spreadFactor: 0.5, branchingFactor: 4 } },
            { at: 0.5, changes: { spreadFactor: 1.0, branchingFactor: 5, verticalBias: 0.4 } }
        ]
    }
};

// ============================================================
// SCHOOL DEFAULT BEHAVIOR MAPPING
// ============================================================

var SCHOOL_DEFAULT_BEHAVIORS = {
    'Destruction': 'fire_explosion',
    'Restoration': 'gentle_bloom',
    'Alteration': 'mountain_builder',
    'Conjuration': 'portal_network',
    'Illusion': 'spider_web'
};

// ============================================================
// BEHAVIOR ENGINE
// ============================================================

/**
 * Get the active behavior parameters at a given progress point
 * @param {GrowthBehavior} behavior - The base behavior profile
 * @param {number} progress - Current progress (0-1)
 * @returns {Object} - Merged parameters with phase overrides
 */
function getActiveParameters(behavior, progress) {
    // Start with base parameters
    var params = {};
    for (var key in behavior) {
        if (key !== 'phases' && key !== 'name' && key !== 'description') {
            params[key] = behavior[key];
        }
    }
    
    // Apply phase overrides
    if (behavior.phases && behavior.phases.length > 0) {
        // Find the active phase (last one where progress >= at)
        var activePhase = null;
        for (var i = 0; i < behavior.phases.length; i++) {
            if (progress >= behavior.phases[i].at) {
                activePhase = behavior.phases[i];
            }
        }
        
        // Merge phase changes
        if (activePhase && activePhase.changes) {
            for (var changeKey in activePhase.changes) {
                params[changeKey] = activePhase.changes[changeKey];
            }
        }
    }
    
    return params;
}

/**
 * Calculate the preferred position for a new node based on behavior
 * @param {Object} parent - Parent node
 * @param {Object} params - Active behavior parameters
 * @param {number} tierNodesPlaced - How many nodes in current tier
 * @param {number} tierCapacity - Estimated capacity of current tier
 * @param {Object} sliceInfo - Sector angle info
 * @param {Function} rng - Random number generator
 * @returns {Object} - Preferred {angle, radiusStep} with ADDITIVE radius step
 */
function calculatePreferredDirection(parent, params, tierNodesPlaced, tierCapacity, sliceInfo, rng) {
    var baseAngle = parent.angle;
    var nodeSize = 75; // Standard node size
    
    // Vertical bias affects whether we go up (further out) or stay in current tier
    var tierFillRatio = tierCapacity > 0 ? tierNodesPlaced / tierCapacity : 0;
    var shouldAdvanceTier = tierFillRatio >= params.layerFillThreshold || params.verticalBias > 0.5;
    
    // Use ADDITIVE radius step (not multiplicative) to prevent explosion
    var radiusStep;
    if (shouldAdvanceTier) {
        // Advance outward - step size based on vertical bias
        // verticalBias -1 to +1 maps to 0.6 to 1.2 node sizes
        radiusStep = nodeSize * (0.8 + params.verticalBias * 0.4);
    } else {
        // Stay roughly same distance, tiny variation
        radiusStep = nodeSize * (0.1 + rng() * 0.25);
    }
    
    // Angular wander
    var wander = (rng() - 0.5) * 2 * params.angularWander;
    
    // Wave effect
    if (params.waveAmplitude > 0) {
        var wavePhase = (parent.tier || 0) * params.waveFrequency;
        wander += Math.sin(wavePhase) * params.waveAmplitude;
    }
    
    // Spread factor affects how far from parent's angle we can go
    var spreadRange = sliceInfo.sectorAngle * 0.4 * params.spreadFactor;
    wander = Math.max(-spreadRange, Math.min(spreadRange, wander));
    
    var newAngle = baseAngle + wander;
    
    // Clamp to sector
    newAngle = Math.max(sliceInfo.startAngle + 3, Math.min(sliceInfo.endAngle - 3, newAngle));
    
    return {
        angle: newAngle,
        radiusStep: radiusStep  // ADDITIVE step, not multiplier
    };
}

/**
 * Determine how many children a node should have based on behavior
 * @param {Object} node - The node
 * @param {Object} params - Active behavior parameters
 * @param {Function} rng - Random number generator
 * @returns {number} - Number of children
 */
function calculateBranchCount(node, params, rng) {
    if (node.isHub) {
        return params.hubBranchCount;
    }
    
    var base = params.branchingFactor;
    var variance = params.branchingVariance;
    
    // Add randomness
    var result = base + (rng() - 0.5) * 2 * base * variance;
    
    // Branch style affects count
    switch (params.branchStyle) {
        case 'linear':
            result = Math.min(result, 1.5);
            break;
        case 'binary':
            result = Math.round(result / 2) * 2; // Even numbers
            result = Math.max(2, Math.min(4, result));
            break;
        case 'clustered':
            // Clustered creates groups, so varies more
            result = rng() < 0.3 ? 1 : Math.ceil(result);
            break;
        case 'radial':
            // Radial tends to have more
            result = Math.ceil(result * 1.2);
            break;
    }
    
    return Math.max(1, Math.round(result));
}

/**
 * Determine if a node should become a hub
 * @param {Object} node - The node
 * @param {Object} params - Active behavior parameters
 * @param {number} nodesSinceLastHub - Nodes placed since last hub
 * @param {Function} rng - Random number generator
 * @returns {boolean}
 */
function shouldBeHub(node, params, nodesSinceLastHub, rng) {
    if (node.tier < 2) return false; // No hubs too close to root
    if (nodesSinceLastHub < params.hubMinSpacing) return false;
    
    return rng() < params.hubProbability;
}

/**
 * Determine if this node should create a new branch (fork in the tree).
 * Uses energy accumulation - energy builds when NOT branching, forcing eventual branch.
 * 
 * @param {Object} params - Active behavior parameters
 * @param {number} currentEnergy - Current accumulated branch energy
 * @param {Function} rng - Random number generator
 * @returns {Object} - { shouldBranch: boolean, newEnergy: number, branchCount: number }
 */
function shouldBranch(params, currentEnergy, rng) {
    var branchChance = params.branchChance || 0.25;
    var energyGain = params.branchEnergyGain || 0.12;
    var energyThreshold = params.branchEnergyThreshold || 1.5;
    
    // Add energy bonus to chance
    var effectiveChance = branchChance + (currentEnergy * 0.3);
    
    // Force branch if energy threshold reached
    var forceBranch = currentEnergy >= energyThreshold;
    var shouldBranch = forceBranch || (rng() < effectiveChance);
    
    if (shouldBranch) {
        // Calculate how many branches based on branchingFactor
        var baseBranches = params.branchingFactor || 2;
        var variance = params.branchingVariance || 0.3;
        var branchCount = Math.max(2, Math.round(baseBranches + (rng() - 0.5) * baseBranches * variance));
        
        // Adjust based on branch style
        if (params.branchStyle === 'linear') branchCount = Math.min(2, branchCount);
        if (params.branchStyle === 'binary') branchCount = 2;
        
        return {
            shouldBranch: true,
            newEnergy: 0, // Reset energy after branching
            branchCount: branchCount,
            forced: forceBranch
        };
    }
    
    // No branch - accumulate energy
    return {
        shouldBranch: false,
        newEnergy: currentEnergy + energyGain,
        branchCount: 0,
        forced: false
    };
}

/**
 * Subdivide a spell pool into fuzzy sub-groups for branch assignment.
 * Each branch gets spells that are thematically similar.
 * 
 * @param {Array} spellPool - Pool of spells to subdivide
 * @param {number} branchCount - Number of branches to create
 * @param {Function} rng - Random number generator
 * @returns {Array<Array>} - Array of spell arrays, one per branch
 */
function subdivideSpellPool(spellPool, branchCount, rng) {
    if (spellPool.length === 0) return [];
    if (branchCount <= 1) return [spellPool];
    
    // Simple keyword-based grouping
    var keywords = {};
    var spellKeywords = [];
    
    // Extract keywords from spell names
    spellPool.forEach(function(spell, idx) {
        var name = (spell.name || '').toLowerCase();
        var words = name.split(/[\s\-_]+/).filter(function(w) { return w.length > 2; });
        spellKeywords[idx] = words;
        
        words.forEach(function(word) {
            if (!keywords[word]) keywords[word] = [];
            keywords[word].push(idx);
        });
    });
    
    // Find most distinctive keywords (appear in some but not all spells)
    var keywordScores = [];
    var totalSpells = spellPool.length;
    Object.keys(keywords).forEach(function(word) {
        var count = keywords[word].length;
        // Score: high when keyword appears in moderate % of spells
        var ratio = count / totalSpells;
        var score = ratio * (1 - ratio) * 4; // Max at 50%
        if (score > 0.1) {
            keywordScores.push({ word: word, score: score, indices: keywords[word] });
        }
    });
    
    keywordScores.sort(function(a, b) { return b.score - a.score; });
    
    // Use top keywords to create initial groups
    var branches = [];
    for (var b = 0; b < branchCount; b++) {
        branches.push([]);
    }
    
    var assigned = {};
    
    // Assign spells based on keyword matching
    keywordScores.slice(0, branchCount * 2).forEach(function(kw, kwIdx) {
        var targetBranch = kwIdx % branchCount;
        kw.indices.forEach(function(spellIdx) {
            if (!assigned[spellIdx]) {
                assigned[spellIdx] = true;
                branches[targetBranch].push(spellPool[spellIdx]);
            }
        });
    });
    
    // Distribute unassigned spells randomly
    spellPool.forEach(function(spell, idx) {
        if (!assigned[idx]) {
            var targetBranch = Math.floor(rng() * branchCount);
            branches[targetBranch].push(spell);
        }
    });
    
    // Ensure no empty branches - redistribute if needed
    var nonEmpty = branches.filter(function(b) { return b.length > 0; });
    if (nonEmpty.length < branchCount && nonEmpty.length > 0) {
        // Some branches are empty, redistribute
        var allSpells = [];
        branches.forEach(function(b) { allSpells = allSpells.concat(b); });
        
        var perBranch = Math.ceil(allSpells.length / branchCount);
        branches = [];
        for (var i = 0; i < branchCount; i++) {
            branches.push(allSpells.slice(i * perBranch, (i + 1) * perBranch));
        }
    }
    
    return branches.filter(function(b) { return b.length > 0; });
}

/**
 * Determine if we should create a terminal cluster
 * @param {Object} node - The node
 * @param {Object} params - Active behavior parameters
 * @param {number} remainingSpells - How many spells left to place
 * @param {Function} rng - Random number generator
 * @returns {Object|null} - Cluster info or null
 */
function shouldCreateTerminalCluster(node, params, remainingSpells, rng) {
    if (!params.createTerminalClusters) return null;
    if (remainingSpells < params.terminalClusterSize) return null;
    if (rng() > params.terminalClusterChance) return null;
    
    var size = Math.min(params.terminalClusterSize, remainingSpells);
    
    return {
        size: size,
        pattern: 'circular' // Could be 'linear', 'arc', 'circular'
    };
}

/**
 * Get cross-connection candidates based on behavior
 * @param {Array} nodes - All placed nodes
 * @param {Object} params - Active behavior parameters
 * @param {Function} rng - Random number generator
 * @returns {Array} - Array of {from, to} pairs
 */
function getCrossConnections(nodes, params, rng) {
    var connections = [];
    if (params.crossConnectionDensity <= 0) return connections;
    
    var maxConnections = Math.floor(nodes.length * params.crossConnectionDensity);
    var nodeSize = 75; // Could be passed in
    var maxDist = nodeSize * params.crossConnectionMaxDist;
    
    // For web pattern, create concentric ring connections
    if (params.webPattern) {
        // Group nodes by tier
        var byTier = {};
        nodes.forEach(function(n) {
            var t = n.tier || 0;
            if (!byTier[t]) byTier[t] = [];
            byTier[t].push(n);
        });
        
        // Connect adjacent nodes within same tier
        for (var tier in byTier) {
            var tierNodes = byTier[tier];
            tierNodes.sort(function(a, b) { return a.angle - b.angle; });
            
            for (var i = 0; i < tierNodes.length - 1 && connections.length < maxConnections; i++) {
                var dist = Math.sqrt(
                    Math.pow(tierNodes[i].x - tierNodes[i+1].x, 2) +
                    Math.pow(tierNodes[i].y - tierNodes[i+1].y, 2)
                );
                if (dist < maxDist * 1.5) {
                    connections.push({ from: tierNodes[i], to: tierNodes[i+1], type: 'web' });
                }
            }
        }
    } else {
        // Random cross-connections between nearby nodes
        for (var i = 0; i < nodes.length && connections.length < maxConnections; i++) {
            for (var j = i + 2; j < nodes.length && connections.length < maxConnections; j++) {
                var dx = nodes[i].x - nodes[j].x;
                var dy = nodes[i].y - nodes[j].y;
                var dist = Math.sqrt(dx * dx + dy * dy);
                
                if (dist < maxDist && rng() < params.crossConnectionDensity * 0.5) {
                    // Skip if already connected through tree
                    connections.push({ from: nodes[i], to: nodes[j], type: 'cross' });
                }
            }
        }
    }
    
    return connections;
}

// ============================================================
// EXPORTS
// ============================================================

if (typeof window !== 'undefined') {
    window.GROWTH_BEHAVIORS = GROWTH_BEHAVIORS;
    window.SCHOOL_DEFAULT_BEHAVIORS = SCHOOL_DEFAULT_BEHAVIORS;
    window.getActiveParameters = getActiveParameters;
    window.calculatePreferredDirection = calculatePreferredDirection;
    window.calculateBranchCount = calculateBranchCount;
    window.shouldBeHub = shouldBeHub;
    window.shouldBranch = shouldBranch;
    window.subdivideSpellPool = subdivideSpellPool;
    window.shouldCreateTerminalCluster = shouldCreateTerminalCluster;
    window.getCrossConnections = getCrossConnections;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        GROWTH_BEHAVIORS: GROWTH_BEHAVIORS,
        SCHOOL_DEFAULT_BEHAVIORS: SCHOOL_DEFAULT_BEHAVIORS,
        getActiveParameters: getActiveParameters,
        calculatePreferredDirection: calculatePreferredDirection,
        calculateBranchCount: calculateBranchCount,
        shouldBeHub: shouldBeHub,
        shouldBranch: shouldBranch,
        subdivideSpellPool: subdivideSpellPool,
        shouldCreateTerminalCluster: shouldCreateTerminalCluster,
        getCrossConnections: getCrossConnections
    };
}
