/**
 * SpellLearning Growth DSL Module
 * 
 * LLM-Driven Procedural Tree Generation system.
 * Defines volumes, modifiers, and constraints for tree layout.
 */

// =============================================================================
// GROWTH DSL - LLM-Driven Procedural Tree Generation
// =============================================================================

var GROWTH_DSL = {
    // Volume types for bounding shapes
    volumes: {
        cone: {
            name: 'Cone',
            description: 'Conical shape - wide at base, narrow at top',
            params: ['height', 'baseRadius', 'topRadius'],
            defaults: { height: 400, baseRadius: 200, topRadius: 50 }
        },
        cube: {
            name: 'Cube',
            description: 'Rectangular box shape',
            params: ['width', 'height', 'depth'],
            defaults: { width: 300, height: 400, depth: 300 }
        },
        sphere: {
            name: 'Sphere',
            description: 'Spherical shape - uniform in all directions',
            params: ['radius'],
            defaults: { radius: 250 }
        },
        cylinder: {
            name: 'Cylinder',
            description: 'Cylindrical shape - constant width',
            params: ['radius', 'height'],
            defaults: { radius: 150, height: 400 }
        },
        wedge: {
            name: 'Wedge',
            description: 'Pie slice shape - fits within a sector',
            params: ['radius', 'angle'],
            defaults: { radius: 350, angle: 72 }
        }
    },
    
    // Growth style modifiers
    modifiers: {
        spiral: {
            name: 'Spiral',
            description: 'Add rotational twist as depth increases',
            params: ['tightness', 'direction'],
            defaults: { tightness: 0.5, direction: 1 }
        },
        gravity: {
            name: 'Gravity',
            description: 'Pull nodes toward a direction',
            params: ['direction', 'strength'],
            defaults: { direction: 'down', strength: 0.3 }
        },
        attractTo: {
            name: 'Attract To Point',
            description: 'Pull nodes toward a specific point',
            params: ['x', 'y', 'strength'],
            defaults: { x: 0, y: 0, strength: 0.2 }
        },
        repelFrom: {
            name: 'Repel From Point',
            description: 'Push nodes away from a point',
            params: ['x', 'y', 'strength'],
            defaults: { x: 0, y: 0, strength: 0.2 }
        },
        wind: {
            name: 'Wind',
            description: 'Directional displacement',
            params: ['angle', 'intensity'],
            defaults: { angle: 45, intensity: 0.3 }
        },
        taper: {
            name: 'Taper',
            description: 'Reduce spacing as depth increases',
            params: ['startScale', 'endScale'],
            defaults: { startScale: 1.0, endScale: 0.3 }
        }
    },
    
    // Constraint types
    constraints: {
        clampHeight: {
            name: 'Clamp Height',
            description: 'Limit vertical extent',
            params: ['maxHeight'],
            defaults: { maxHeight: 400 }
        },
        constrainToVolume: {
            name: 'Constrain To Volume',
            description: 'Kill branches outside bounding shape',
            params: ['volumeType'],
            defaults: { volumeType: 'cone' }
        },
        forceSymmetry: {
            name: 'Force Symmetry',
            description: 'Mirror nodes across axis',
            params: ['axis'],
            defaults: { axis: 'vertical' }
        },
        minSpacing: {
            name: 'Minimum Spacing',
            description: 'Prevent node overlap',
            params: ['distance'],
            defaults: { distance: 30 }
        }
    },
    
    // Visual options
    visualOptions: {
        nodeShapes: ['circle', 'hexagon', 'diamond', 'pill', 'rectangle'],
        edgeStyles: ['straight', 'curved', 'organic', 'stepped'],
        tierSpacings: ['linear', 'exponential', 'logarithmic', 'fibonacci']
    },
    
    // Branching structure rules (affects tree topology, not just visuals)
    branchingRules: {
        maxChildrenPerNode: {
            name: 'Max Children Per Node',
            description: 'Maximum branches from any single spell',
            range: [1, 5],
            default: 3
        },
        allowCrossTierConnections: {
            name: 'Cross-Tier Connections',
            description: 'Allow spells to connect to non-adjacent tiers',
            default: false
        },
        allowBackwardBranches: {
            name: 'Backward Branches',
            description: 'Higher tier spells can unlock lower tier spells',
            default: false
        },
        clusterSimilarSpells: {
            name: 'Cluster Similar',
            description: 'Group related spell variants together',
            default: true
        },
        fillEmptySpaces: {
            name: 'Fill Empty Spaces',
            description: 'Position nodes to minimize gaps in layout',
            default: true
        },
        preferWideOverDeep: {
            name: 'Wide vs Deep',
            description: 'Favor wide shallow trees over narrow deep ones',
            default: true
        }
    },
    
    // Generate a default recipe for a school
    getDefaultRecipe: function(schoolName) {
        return {
            volume: {
                type: 'wedge',
                radius: 350,
                angle: 72
            },
            growth: {
                style: 'radial',
                tightness: 0.6,
                branchingAngle: 30,
                depthBias: 'center',
                symmetry: 'radial',
                randomness: 0.15
            },
            branching: {
                maxChildrenPerNode: 3,
                allowCrossTierConnections: false,
                allowBackwardBranches: false,
                clusterSimilarSpells: true,
                fillEmptySpaces: true,
                preferWideOverDeep: true
            },
            visual: {
                nodeShape: 'pill',
                edgeStyle: 'curved',
                tierSpacing: 'linear',
                colorGradient: true
            },
            modifiers: [],
            constraints: [
                { type: 'minSpacing', distance: 25 }
            ],
            rationale: 'Default balanced layout'
        };
    },
    
    // Get API documentation for LLM prompt
    getAPIDocumentation: function() {
        var doc = '## Growth Recipe API\n\n';
        
        doc += '### Bounding Volumes\n';
        for (var vKey in this.volumes) {
            var v = this.volumes[vKey];
            doc += '- **' + vKey + '**: ' + v.description + ' (params: ' + v.params.join(', ') + ')\n';
        }
        
        doc += '\n### Modifiers (Position Effects)\n';
        for (var mKey in this.modifiers) {
            var m = this.modifiers[mKey];
            doc += '- **' + mKey + '**: ' + m.description + ' (params: ' + m.params.join(', ') + ')\n';
        }
        
        doc += '\n### Constraints\n';
        for (var cKey in this.constraints) {
            var c = this.constraints[cKey];
            doc += '- **' + cKey + '**: ' + c.description + ' (params: ' + c.params.join(', ') + ')\n';
        }
        
        doc += '\n### Branching Rules (IMPORTANT - Controls Tree Structure)\n';
        doc += '- **maxChildrenPerNode**: How many spells can branch from one parent (1-5, affects tree width)\n';
        doc += '- **allowCrossTierConnections**: If true, Adept spell can unlock Novice spell (non-linear trees)\n';
        doc += '- **allowBackwardBranches**: Higher tier spells can be prerequisites for lower tier (loops)\n';
        doc += '- **clusterSimilarSpells**: Group spell variants (Fire I, II, III) under common parent\n';
        doc += '- **fillEmptySpaces**: Position nodes to minimize visual gaps (organic layout)\n';
        doc += '- **preferWideOverDeep**: Favor broad trees (many tier-2 nodes) over deep chains\n';
        
        doc += '\n### Visual Options\n';
        doc += '- Node shapes: ' + this.visualOptions.nodeShapes.join(', ') + '\n';
        doc += '- Edge styles: ' + this.visualOptions.edgeStyles.join(', ') + '\n';
        doc += '- Tier spacing: ' + this.visualOptions.tierSpacings.join(', ') + '\n';
        
        return doc;
    },
    
    // Parse and validate a growth recipe
    parseRecipe: function(recipeJson) {
        try {
            var recipe = typeof recipeJson === 'string' ? JSON.parse(recipeJson) : recipeJson;
            
            // Validate required fields
            if (!recipe.volume || !recipe.volume.type) {
                return { valid: false, error: 'Missing volume type' };
            }
            
            if (!this.volumes[recipe.volume.type]) {
                return { valid: false, error: 'Unknown volume type: ' + recipe.volume.type };
            }
            
            // Apply defaults for missing fields
            var defaults = this.getDefaultRecipe('');
            recipe.growth = Object.assign({}, defaults.growth, recipe.growth || {});
            recipe.branching = Object.assign({}, defaults.branching, recipe.branching || {});
            recipe.visual = Object.assign({}, defaults.visual, recipe.visual || {});
            recipe.modifiers = recipe.modifiers || [];
            recipe.constraints = recipe.constraints || [];
            
            return { valid: true, recipe: recipe };
        } catch (e) {
            return { valid: false, error: 'JSON parse error: ' + e.message };
        }
    },
    
    // Generate LLM prompt for tree visualization
    generateLLMPrompt: function(schoolName, spellList) {
        var prompt = '# Tree Visualization Request\n\n';
        prompt += 'Create a Growth Recipe for the ' + schoolName + ' magic school tree.\n\n';
        
        prompt += '## School Context\n';
        prompt += '- School: ' + schoolName + '\n';
        prompt += '- Total Spells: ' + spellList.length + '\n';
        
        // Add tier breakdown
        var tierCounts = {};
        spellList.forEach(function(spell) {
            var tier = spell.level || 'Unknown';
            tierCounts[tier] = (tierCounts[tier] || 0) + 1;
        });
        prompt += '- Tier distribution: ' + JSON.stringify(tierCounts) + '\n\n';
        
        prompt += '## School Themes\n';
        prompt += 'Consider the thematic nature of ' + schoolName + ' magic:\n';
        var themes = {
            'Destruction': 'Aggressive, explosive, chaotic. Fire/frost/shock elements. Think expanding flames, crackling lightning.',
            'Restoration': 'Nurturing, protective, radiant. Healing and wards. Think gentle light, growing warmth.',
            'Alteration': 'Transformative, structural, earth-bound. Armor and transmutation. Think solid foundations, layered protection.',
            'Conjuration': 'Otherworldly, summoning, ethereal. Daedra and bound weapons. Think portals, swirling energies.',
            'Illusion': 'Subtle, mind-affecting, shadowy. Invisibility and fear. Think wisps, fading shadows.'
        };
        prompt += themes[schoolName] || 'Unique magical nature.' + '\n\n';
        
        prompt += this.getAPIDocumentation() + '\n';
        
        prompt += '## Output Format\n';
        prompt += 'Return ONLY a JSON object with this structure (no markdown, no explanation):\n';
        prompt += '```json\n';
        prompt += JSON.stringify({
            schoolName: schoolName,
            volume: { type: 'cone', height: 400, baseRadius: 200, topRadius: 50 },
            growth: { style: 'radial', tightness: 0.6, branchingAngle: 30, randomness: 0.15 },
            branching: {
                maxChildrenPerNode: 3,
                allowCrossTierConnections: false,
                allowBackwardBranches: false,
                clusterSimilarSpells: true,
                fillEmptySpaces: true,
                preferWideOverDeep: true
            },
            visual: { nodeShape: 'pill', edgeStyle: 'curved', tierSpacing: 'linear', colorGradient: true },
            modifiers: [{ type: 'spiral', tightness: 0.3, direction: 1 }],
            constraints: [{ type: 'minSpacing', distance: 25 }],
            rationale: 'Brief explanation of design choices including WHY these branching rules fit the school'
        }, null, 2);
        prompt += '\n```\n\n';
        
        prompt += '## Guidelines\n';
        prompt += '- **BRANCHING is key**: Choose branching rules that match the school\'s nature:\n';
        prompt += '  - Destruction: High maxChildren (explosive branching), maybe allowCrossTier for chaotic feel\n';
        prompt += '  - Restoration: Moderate branching, clustered healing variants, structured/symmetrical\n';
        prompt += '  - Illusion: Allow backward branches (mind tricks), organic non-linear progression\n';
        prompt += '  - Conjuration: Cross-tier (summon anything from anywhere), wide trees\n';
        prompt += '  - Alteration: Deep linear chains (building mastery), low maxChildren\n';
        prompt += '- Use fillEmptySpaces=true to avoid large gaps in the visual layout\n';
        prompt += '- Choose volume/modifiers that reflect the school\'s personality\n';
        prompt += '- Use 1-3 modifiers maximum for clarity\n';
        prompt += '- Always include minSpacing constraint (20-35 range)\n';
        prompt += '- Include a rationale explaining your branching and visual choices\n';
        
        return prompt;
    }
};

// =============================================================================
// GROWTH STYLE GENERATOR UI
// =============================================================================

// Store generated recipes
var generatedGrowthRecipes = {};

function initializeGrowthStyleGenerator() {
    var header = document.getElementById('growthStyleHeader');
    var content = document.getElementById('growthStyleContent');
    var generateBtn = document.getElementById('generateStylesBtn');
    var applyBtn = document.getElementById('applyStylesBtn');
    
    if (!header || !content) {
        console.log('[GrowthDSL] UI elements not found');
        return;
    }
    
    // Collapsible header
    header.addEventListener('click', function() {
        header.classList.toggle('collapsed');
    });
    
    // Generate styles button
    if (generateBtn) {
        generateBtn.addEventListener('click', function() {
            if (typeof onGenerateGrowthStyles === 'function') {
                onGenerateGrowthStyles();
            }
        });
    }
    
    // Apply to tree button
    if (applyBtn) {
        applyBtn.addEventListener('click', function() {
            if (typeof onApplyGrowthStyles === 'function') {
                onApplyGrowthStyles();
            }
        });
    }
    
    console.log('[GrowthDSL] UI initialized');
}

// =============================================================================
// RECIPE TO TREE SETTINGS CONVERTER
// =============================================================================

/**
 * Convert a GROWTH_DSL recipe to tree generation settings.
 * This bridges the gap between LLM-generated recipes and the tree builder.
 *
 * @param {Object} recipe - A validated GROWTH_DSL recipe
 * @returns {Object} - Tree generation settings compatible with SettingsAwareBuilder
 */
function recipeToTreeSettings(recipe) {
    if (!recipe || !recipe.branching) {
        return {};
    }

    var branching = recipe.branching;
    var growth = recipe.growth || {};

    return {
        // Branching rules from recipe
        maxChildrenPerNode: branching.maxChildrenPerNode || 3,
        allowCrossTierLinks: branching.allowCrossTierConnections || false,
        strictTierOrdering: !branching.allowBackwardBranches,
        allowSameTierLinks: branching.allowCrossTierConnections || false,

        // Growth style affects convergence
        convergenceEnabled: branching.clusterSimilarSpells || growth.style === 'clustered',
        convergenceChance: branching.clusterSimilarSpells ? 50 : 30,

        // Visual settings that affect layout
        fillEmptySpaces: branching.fillEmptySpaces !== false,
        preferWideOverDeep: branching.preferWideOverDeep !== false,

        // Source recipe for reference
        _sourceRecipe: recipe.rationale || 'GROWTH_DSL recipe'
    };
}

/**
 * Merge recipe settings with existing tree generation settings.
 * Recipe settings override defaults but user settings take precedence.
 *
 * @param {Object} baseSettings - Base tree generation settings
 * @param {Object} recipe - GROWTH_DSL recipe
 * @param {boolean} recipeOverrides - If true, recipe overrides base (default: false)
 * @returns {Object} - Merged settings
 */
function mergeRecipeSettings(baseSettings, recipe, recipeOverrides) {
    var recipeSettings = recipeToTreeSettings(recipe);

    if (recipeOverrides) {
        // Recipe takes precedence
        return Object.assign({}, baseSettings, recipeSettings);
    } else {
        // Base settings take precedence, recipe fills gaps
        return Object.assign({}, recipeSettings, baseSettings);
    }
}

/**
 * Apply a stored recipe to the active tree configuration.
 * This function is called when "Apply to Tree" button is clicked.
 *
 * @param {string} schoolName - School to apply recipe to
 * @param {Object} recipe - The recipe to apply
 */
function applyRecipeToSchool(schoolName, recipe) {
    if (!recipe) {
        console.warn('[GrowthDSL] No recipe to apply for', schoolName);
        return;
    }

    // Store recipe for the tree builder to pick up
    generatedGrowthRecipes[schoolName] = recipe;

    // If there's a global settings object, update school config
    if (typeof settings !== 'undefined' && settings.schoolConfigs) {
        if (!settings.schoolConfigs[schoolName]) {
            settings.schoolConfigs[schoolName] = {};
        }

        // Apply branching settings
        var treeSettings = recipeToTreeSettings(recipe);
        Object.assign(settings.schoolConfigs[schoolName], {
            dslRecipe: recipe,
            maxChildrenPerNode: treeSettings.maxChildrenPerNode
        });

        console.log('[GrowthDSL] Applied recipe to', schoolName, ':', treeSettings);
    }
}

/**
 * Get stored recipe for a school (if any)
 * @param {string} schoolName
 * @returns {Object|null}
 */
function getSchoolRecipe(schoolName) {
    return generatedGrowthRecipes[schoolName] || null;
}

// =============================================================================
// EXPORTS
// =============================================================================

window.GROWTH_DSL = GROWTH_DSL;
window.generatedGrowthRecipes = generatedGrowthRecipes;
window.initializeGrowthStyleGenerator = initializeGrowthStyleGenerator;
window.recipeToTreeSettings = recipeToTreeSettings;
window.mergeRecipeSettings = mergeRecipeSettings;
window.applyRecipeToSchool = applyRecipeToSchool;
window.getSchoolRecipe = getSchoolRecipe;

console.log('[GrowthDSL] Module loaded');
