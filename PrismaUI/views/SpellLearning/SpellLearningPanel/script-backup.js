/**
 * Spell Learning Panel - PrismaUI Interface
 * Handles spell scanning, output display, prompt editing, tree viewing, and C++ communication
 */

// =============================================================================
// DEFAULT PROMPT - User-editable tree creation rules
// =============================================================================

var DEFAULT_TREE_RULES = `You are a Skyrim spell tree architect. Create a logical learning progression tree for each school of magic.

## CRITICAL RULES (MUST FOLLOW)

### 1. SCHOOL SEPARATION (MOST IMPORTANT!)
- **NEVER mix spells between schools!**
- Each spell has a "school" field - ONLY place spells in their OWN school's tree
- Example: Clairvoyance has "school": "Illusion" → it goes in Illusion tree, NOT Alteration
- VALIDATE every spell belongs to the correct school before adding

### 2. INCLUDE ALL SPELLS
- Every spell from the input MUST appear in the output
- Count spells per school and verify your output matches

### 3. MAXIMUM 3 BRANCHES PER NODE
- Each spell can have AT MOST 3 children
- If more connections needed, create intermediate nodes or chains
- This keeps the tree visually clean and navigable

### 4. SAME-TIER BRANCHING ALLOWED
- Novice spells CAN branch to other Novice spells
- Progression does NOT require increasing skill level
- Group by THEME/EFFECT, not just skill tier
- Example: Flames (Novice) → Frostbite (Novice) → Sparks (Novice) is VALID if thematically grouped

### 5. PREFER VANILLA FORMIDS FOR ROOTS
- FormIDs starting with 0x00 are vanilla (preferred for roots)
- 0x02 = Dawnguard, 0x04 = Dragonborn, 0xFE+ = mods
- Recommended vanilla roots:
  - Destruction: Flames (0x00012FCD)
  - Restoration: Healing (0x00012FCC)
  - Alteration: Oakflesh (0x0005AD5C) or Candlelight (0x00043324)
  - Conjuration: Conjure Familiar (0x000640B6)
  - Illusion: Clairvoyance (0x00021143) or Courage (0x0004DEE8)

## Tree Structure Rules

1. **One Root Per School**: Each school has exactly ONE root spell - a Novice-level spell FROM THAT SCHOOL.

2. **Branching Logic** (max 3 children per node):
   - Destruction: Branch by element (Fire, Frost, Shock)
   - Conjuration: Branch by summon type (Atronachs, Undead, Daedra) and bound weapons
   - Illusion: Branch by effect type (Fear, Calm, Frenzy, Invisibility, Muffle)
   - Alteration: Branch by effect (Armor, Paralysis, Light, Transmute, Detect)
   - Restoration: Branch by effect (Healing, Turn Undead, Wards)

3. **Tier Progression**: 
   - Branching within same tier is encouraged (Novice→Novice for variety)
   - Higher tier spells should generally require SOME lower tier prereqs
   - Master spells need Expert prereqs, Expert needs Adept, etc.

4. **Prerequisites**: Only from same school, thematically sensible.

## BEFORE OUTPUT - VALIDATE:
- [ ] Every node's school matches the tree it's in
- [ ] All input spells appear in output
- [ ] Each school has exactly one root
- [ ] No node has more than 3 children
- [ ] No duplicate formIds across trees

## Custom Rules (add your own below)

- 
`;

// =============================================================================
// TREE VIEWER CONFIGURATION
// =============================================================================

var TREE_CONFIG = {
    wheel: {
        baseRadius: 120,
        tierSpacing: 100,
        nodeWidth: 85,
        nodeHeight: 32,
        minArcSpacing: 25,
        schoolPadding: 15
    },
    // Tier-based node sizing (novice=0, apprentice=1, adept=2, expert=3, master=4)
    tierScaling: {
        enabled: true,
        baseWidth: 70,
        baseHeight: 26,
        widthIncrement: 12,   // Each tier adds this much width
        heightIncrement: 5    // Each tier adds this much height
    },
    zoom: {
        min: 0.1,  // 2x more zoom out capability (was 0.2)
        max: 3,
        step: 0.2,
        wheelFactor: 0.001
    },
    animation: {
        rotateDuration: 400
    },
    schools: ['Destruction', 'Restoration', 'Alteration', 'Conjuration', 'Illusion'],
    // schoolColors now comes from settings.schoolColors - use getSchoolColor() function
    getSchoolColor: function(school) {
        return settings.schoolColors[school] || getOrAssignSchoolColor(school);
    },
    // Layout styles for spell trees - each fits within a pie slice from center
    layoutStyles: {
        radial: {
            name: 'Radial Fan',
            description: 'Nodes spread outward in a fan pattern. Best for balanced trees with many branches at each tier.',
            idealFor: 'Trees with 2-3 children per node, balanced branching'
        },
        focused: {
            name: 'Focused Beam',
            description: 'Nodes stay close to the center spoke line. Best for linear progressions with few branches.',
            idealFor: 'Linear spell chains, single-path progressions'
        },
        clustered: {
            name: 'Clustered Groups',
            description: 'Related spells cluster together in distinct groups. Best for trees with clear thematic divisions.',
            idealFor: 'Elemental branches (Fire/Frost/Shock), distinct spell families'
        },
        cascading: {
            name: 'Cascading Waterfall',
            description: 'Nodes cascade downward in staggered columns. Best for deep trees with consistent width.',
            idealFor: 'Many tiers, steady progression paths'
        },
        organic: {
            name: 'Organic Flow',
            description: 'Slightly randomized positions for a natural feel. Best for varied, unpredictable spell collections.',
            idealFor: 'Mixed spell types, modded spell packs'
        }
    },
    // Get style info for LLM context
    getStyleDescriptions: function() {
        var desc = 'AVAILABLE LAYOUT STYLES (choose one that fits your tree structure):\n';
        for (var key in this.layoutStyles) {
            var style = this.layoutStyles[key];
            desc += '- ' + key + ': ' + style.description + ' Ideal for: ' + style.idealFor + '\n';
        }
        return desc;
    }
};

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
    
    // Generate a default recipe for a school
    getDefaultRecipe: function(schoolName) {
        return {
            volume: {
                type: 'wedge',
                radius: 350,
                angle: 72  // 360/5 schools
            },
            growth: {
                style: 'radial',
                tightness: 0.6,
                branchingAngle: 30,
                depthBias: 'center',
                symmetry: 'radial',
                randomness: 0.15
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
        
        doc += '\n### Modifiers\n';
        for (var mKey in this.modifiers) {
            var m = this.modifiers[mKey];
            doc += '- **' + mKey + '**: ' + m.description + ' (params: ' + m.params.join(', ') + ')\n';
        }
        
        doc += '\n### Constraints\n';
        for (var cKey in this.constraints) {
            var c = this.constraints[cKey];
            doc += '- **' + cKey + '**: ' + c.description + ' (params: ' + c.params.join(', ') + ')\n';
        }
        
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
            visual: { nodeShape: 'pill', edgeStyle: 'curved', tierSpacing: 'linear', colorGradient: true },
            modifiers: [{ type: 'spiral', tightness: 0.3, direction: 1 }],
            constraints: [{ type: 'minSpacing', distance: 25 }],
            rationale: 'Brief explanation of design choices'
        }, null, 2);
        prompt += '\n```\n\n';
        
        prompt += '## Guidelines\n';
        prompt += '- Choose volume/modifiers that reflect the school\'s personality\n';
        prompt += '- Use 1-3 modifiers maximum for clarity\n';
        prompt += '- Always include minSpacing constraint (20-35 range)\n';
        prompt += '- Include a brief rationale explaining your choices\n';
        prompt += '- Be creative but keep it readable!\n';
        
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
            onGenerateGrowthStyles();
        });
    }
    
    // Apply to tree button
    if (applyBtn) {
        applyBtn.addEventListener('click', function() {
            onApplyGrowthStyles();
        });
    }
    
    console.log('[GrowthDSL] UI initialized');
}

function onGenerateGrowthStyles() {
    var statusEl = document.getElementById('growthStatus');
    var applyBtn = document.getElementById('applyStylesBtn');
    var container = document.getElementById('schoolStylesContainer');
    
    // Check if we have scanned spells
    if (!state.treeData || !state.treeData.rawData || !state.treeData.rawData.schools) {
        if (statusEl) {
            statusEl.textContent = 'Scan spells first, then generate styles.';
            statusEl.className = 'growth-status error';
        }
        return;
    }
    
    // Get schools from tree data
    var schools = Object.keys(state.treeData.rawData.schools);
    if (schools.length === 0) {
        if (statusEl) {
            statusEl.textContent = 'No schools found in tree data.';
            statusEl.className = 'growth-status error';
        }
        return;
    }
    
    // Update status
    if (statusEl) {
        statusEl.textContent = 'Generating styles for ' + schools.length + ' schools...';
        statusEl.className = 'growth-status processing';
    }
    
    // Clear container
    if (container) {
        container.innerHTML = '<div class="growth-loading">Generating...</div>';
    }
    
    // Prepare school data
    var schoolData = schools.map(function(name) {
        var school = state.treeData.rawData.schools[name];
        return {
            name: name,
            spells: school ? (school.spells || []) : []
        };
    });
    
    // Generate via LLM
    generateGrowthRecipesViaLLM(schoolData, function(result) {
        generatedGrowthRecipes = result.recipes || {};
        
        if (statusEl) {
            if (result.success) {
                statusEl.textContent = 'Generated styles for all schools!';
                statusEl.className = 'growth-status success';
            } else if (result.failed && result.failed.length > 0) {
                statusEl.textContent = 'Generated styles (' + result.failed.length + ' used defaults)';
                statusEl.className = 'growth-status';
            } else {
                statusEl.textContent = 'Using default styles (no API key)';
                statusEl.className = 'growth-status';
            }
        }
        
        // Enable apply button
        if (applyBtn) {
            applyBtn.disabled = false;
        }
        
        // Display school style cards
        displaySchoolStyleCards(generatedGrowthRecipes);
    });
}

function displaySchoolStyleCards(recipes) {
    var container = document.getElementById('schoolStylesContainer');
    if (!container) return;
    
    container.innerHTML = '';
    
    var schoolNames = Object.keys(recipes);
    schoolNames.forEach(function(schoolName) {
        var recipe = recipes[schoolName];
        
        var card = document.createElement('div');
        card.className = 'school-style-card';
        card.dataset.school = schoolName;
        
        var header = document.createElement('div');
        header.className = 'school-style-header';
        
        var name = document.createElement('span');
        name.className = 'school-style-name ' + schoolName;
        name.textContent = schoolName;
        
        var actions = document.createElement('div');
        actions.className = 'school-style-actions';
        
        var detailsBtn = document.createElement('button');
        detailsBtn.className = 'btn-icon';
        detailsBtn.title = 'Show/hide details';
        detailsBtn.textContent = '📋';
        detailsBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            card.classList.toggle('expanded');
        });
        
        var regenerateBtn = document.createElement('button');
        regenerateBtn.className = 'btn-icon';
        regenerateBtn.title = 'Regenerate this school';
        regenerateBtn.textContent = '🔄';
        regenerateBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            regenerateSchoolStyle(schoolName);
        });
        
        actions.appendChild(detailsBtn);
        actions.appendChild(regenerateBtn);
        
        header.appendChild(name);
        header.appendChild(actions);
        
        var rationale = document.createElement('div');
        rationale.className = 'school-style-rationale';
        rationale.textContent = recipe.rationale || 'Default style';
        
        var details = document.createElement('div');
        details.className = 'school-style-details';
        details.textContent = JSON.stringify({
            volume: recipe.volume,
            growth: recipe.growth,
            modifiers: recipe.modifiers
        }, null, 1);
        
        card.appendChild(header);
        card.appendChild(rationale);
        card.appendChild(details);
        
        container.appendChild(card);
    });
}

function regenerateSchoolStyle(schoolName) {
    var statusEl = document.getElementById('growthStatus');
    if (statusEl) {
        statusEl.textContent = 'Regenerating style for ' + schoolName + '...';
        statusEl.className = 'growth-status processing';
    }
    
    // Get school data
    var spells = [];
    if (state.treeData && state.treeData.rawData && state.treeData.rawData.schools[schoolName]) {
        spells = state.treeData.rawData.schools[schoolName].spells || [];
    }
    
    generateGrowthRecipesViaLLM([{ name: schoolName, spells: spells }], function(result) {
        if (result.recipes && result.recipes[schoolName]) {
            generatedGrowthRecipes[schoolName] = result.recipes[schoolName];
            
            if (statusEl) {
                statusEl.textContent = 'Regenerated style for ' + schoolName;
                statusEl.className = 'growth-status success';
            }
            
            // Refresh display
            displaySchoolStyleCards(generatedGrowthRecipes);
        } else {
            if (statusEl) {
                statusEl.textContent = 'Failed to regenerate - using default';
                statusEl.className = 'growth-status error';
            }
        }
    });
}

function onApplyGrowthStyles() {
    if (!generatedGrowthRecipes || Object.keys(generatedGrowthRecipes).length === 0) {
        console.warn('[GrowthDSL] No recipes to apply');
        return;
    }
    
    // Apply recipes to WheelRenderer
    var applied = 0;
    for (var schoolName in generatedGrowthRecipes) {
        if (WheelRenderer.applyGrowthRecipe(schoolName, generatedGrowthRecipes[schoolName])) {
            applied++;
        }
    }
    
    console.log('[GrowthDSL] Applied ' + applied + ' growth recipes');
    
    // Re-render tree to apply new styles
    if (state.treeData && WheelRenderer.nodes.length > 0) {
        WheelRenderer.render();
        setTreeStatus('Applied visual styles to tree');
    }
    
    // Update status
    var statusEl = document.getElementById('growthStatus');
    if (statusEl) {
        statusEl.textContent = 'Applied ' + applied + ' styles to tree!';
        statusEl.className = 'growth-status success';
    }
    
    // Switch to tree tab
    switchTab('spellTree');
}

// Generate growth recipes for all schools via LLM
function generateGrowthRecipesViaLLM(schools, callback) {
    if (!schools || schools.length === 0) {
        console.warn('[GrowthDSL] No schools provided');
        if (callback) callback({ success: false, error: 'No schools' });
        return;
    }
    
    var results = {};
    var pending = schools.length;
    var failed = [];
    
    schools.forEach(function(school) {
        var schoolName = typeof school === 'string' ? school : school.name;
        var spellList = typeof school === 'object' && school.spells ? school.spells : [];
        
        var prompt = GROWTH_DSL.generateLLMPrompt(schoolName, spellList);
        
        // Call OpenRouter API
        if (state.llmConfig.apiKey) {
            callOpenRouterAPI(prompt, function(response) {
                if (response && response.success) {
                    // Try to parse the response as JSON
                    try {
                        var jsonMatch = response.content.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            var recipe = JSON.parse(jsonMatch[0]);
                            results[schoolName] = recipe;
                            console.log('[GrowthDSL] Generated recipe for ' + schoolName);
                        } else {
                            throw new Error('No JSON found in response');
                        }
                    } catch (e) {
                        console.warn('[GrowthDSL] Failed to parse recipe for ' + schoolName + ': ' + e.message);
                        failed.push(schoolName);
                        results[schoolName] = GROWTH_DSL.getDefaultRecipe(schoolName);
                    }
                } else {
                    console.warn('[GrowthDSL] LLM call failed for ' + schoolName);
                    failed.push(schoolName);
                    results[schoolName] = GROWTH_DSL.getDefaultRecipe(schoolName);
                }
                
                pending--;
                if (pending === 0) {
                    if (callback) callback({
                        success: failed.length === 0,
                        recipes: results,
                        failed: failed
                    });
                }
            });
        } else {
            // No API key - use defaults
            console.log('[GrowthDSL] No API key - using default recipe for ' + schoolName);
            results[schoolName] = GROWTH_DSL.getDefaultRecipe(schoolName);
            pending--;
            if (pending === 0) {
                if (callback) callback({
                    success: true,
                    recipes: results,
                    failed: []
                });
            }
        }
    });
}

// =============================================================================
// DIFFICULTY PROFILES
// =============================================================================

var DIFFICULTY_PROFILES = {
    easy: {
        name: 'Easy',
        description: 'Relaxed progression for casual play',
        settings: {
            xpGlobalMultiplier: 2,
            xpMultiplierDirect: 150,
            xpMultiplierSchool: 75,
            xpMultiplierAny: 25,
            xpNovice: 50,
            xpApprentice: 100,
            xpAdept: 200,
            xpExpert: 400,
            xpMaster: 800,
            revealName: 5,
            revealEffects: 15,
            revealDescription: 30,
            // Early spell learning - spells granted at threshold but nerfed until mastery
            earlySpellLearning: {
                enabled: true,
                unlockThreshold: 20,       // % progress to unlock spell
                minEffectiveness: 30,      // % effectiveness at unlock (easier)
                maxEffectiveness: 80,      // % effectiveness just before mastery
                selfCastRequiredAt: 60,    // After this %, must cast spell itself
                selfCastXPMultiplier: 200, // XP multiplier when casting learning target
                binaryEffectThreshold: 70  // Binary effects need this % to work
            }
        }
    },
    normal: {
        name: 'Normal',
        description: 'Balanced progression (default)',
        settings: {
            xpGlobalMultiplier: 1,
            xpMultiplierDirect: 100,
            xpMultiplierSchool: 50,
            xpMultiplierAny: 10,
            xpNovice: 100,
            xpApprentice: 200,
            xpAdept: 400,
            xpExpert: 800,
            xpMaster: 1500,
            revealName: 10,
            revealEffects: 25,
            revealDescription: 50,
            earlySpellLearning: {
                enabled: true,
                unlockThreshold: 25,
                minEffectiveness: 20,
                maxEffectiveness: 70,
                selfCastRequiredAt: 75,
                selfCastXPMultiplier: 150,
                binaryEffectThreshold: 80
            }
        }
    },
    hard: {
        name: 'Hard',
        description: 'Challenging progression for experienced players',
        settings: {
            xpGlobalMultiplier: 0.75,
            xpMultiplierDirect: 75,
            xpMultiplierSchool: 35,
            xpMultiplierAny: 5,
            xpNovice: 150,
            xpApprentice: 350,
            xpAdept: 700,
            xpExpert: 1200,
            xpMaster: 2500,
            revealName: 15,
            revealEffects: 35,
            revealDescription: 60,
            earlySpellLearning: {
                enabled: true,
                unlockThreshold: 30,
                minEffectiveness: 15,
                maxEffectiveness: 60,
                selfCastRequiredAt: 70,
                selfCastXPMultiplier: 125,
                binaryEffectThreshold: 85
            }
        }
    },
    brutal: {
        name: 'Brutal',
        description: 'Serious grind for dedicated mages. Discovery mode enabled.',
        settings: {
            xpGlobalMultiplier: 0.5,
            xpMultiplierDirect: 50,
            xpMultiplierSchool: 25,
            xpMultiplierAny: 3,
            xpNovice: 250,
            xpApprentice: 500,
            xpAdept: 1000,
            xpExpert: 2000,
            xpMaster: 4000,
            revealName: 20,
            revealEffects: 40,
            revealDescription: 70,
            discoveryMode: true,
            earlySpellLearning: {
                enabled: true,
                unlockThreshold: 35,
                minEffectiveness: 10,
                maxEffectiveness: 50,
                selfCastRequiredAt: 65,
                selfCastXPMultiplier: 100,
                binaryEffectThreshold: 90
            }
        }
    },
    trueMaster: {
        name: 'True Master',
        description: 'Only the most dedicated will master magic. Discovery mode enabled.',
        settings: {
            xpGlobalMultiplier: 0.3,
            xpMultiplierDirect: 40,
            xpMultiplierSchool: 15,
            xpMultiplierAny: 2,
            xpNovice: 400,
            xpApprentice: 800,
            xpAdept: 1600,
            xpExpert: 3200,
            xpMaster: 6000,
            revealName: 25,
            revealEffects: 50,
            revealDescription: 80,
            discoveryMode: true,
            earlySpellLearning: {
                enabled: true,
                unlockThreshold: 40,
                minEffectiveness: 10,
                maxEffectiveness: 45,
                selfCastRequiredAt: 60,
                selfCastXPMultiplier: 100,
                binaryEffectThreshold: 90
            }
        }
    },
    legendary: {
        name: 'Legendary',
        description: 'Nightmare difficulty - not for the faint of heart. Discovery mode enabled.',
        settings: {
            xpGlobalMultiplier: 0.15,
            xpMultiplierDirect: 25,
            xpMultiplierSchool: 10,
            xpMultiplierAny: 1,
            xpNovice: 600,
            xpApprentice: 1200,
            xpAdept: 2500,
            xpExpert: 5000,
            xpMaster: 10000,
            revealName: 30,
            revealEffects: 60,
            revealDescription: 90,
            discoveryMode: true,
            earlySpellLearning: {
                enabled: true,
                unlockThreshold: 50,
                minEffectiveness: 5,
                maxEffectiveness: 40,
                selfCastRequiredAt: 55,
                selfCastXPMultiplier: 75,
                binaryEffectThreshold: 95
            }
        }
    }
};

// =============================================================================
// SETTINGS
// =============================================================================

var settings = {
    hotkey: 'F9',
    hotkeyCode: 67,  // DirectInput scancode for F9
    cheatMode: false,
    nodeSizeScaling: true,
    showNodeNames: true,
    showSchoolDividers: true,
    dividerFade: 50,      // 0-100, percentage of line length to fade out (0=no fade, 100=full fade)
    dividerSpacing: 3,    // pixels between parallel divider lines
    dividerColorMode: 'school',  // 'school' (match school colors) or 'custom' (use dividerCustomColor)
    dividerCustomColor: '#ffffff', // custom color when dividerColorMode is 'custom'
    preserveMultiPrereqs: true,   // if true, preserve multi-prerequisite nodes; if false, aggressive cycle fixing
    verboseLogging: false,
    // Progression settings
    learningMode: 'perSchool',  // 'perSchool' or 'single'
    xpGlobalMultiplier: 1,      // 1-1000, overall XP multiplier
    xpMultiplierDirect: 100,    // 0-100, XP from casting direct prerequisite
    xpMultiplierSchool: 50,     // 0-100, XP from casting same school spell
    xpMultiplierAny: 10,        // 0-100, XP from casting any spell
    // Tier XP requirements
    xpNovice: 100,
    xpApprentice: 200,
    xpAdept: 400,
    xpExpert: 800,
    xpMaster: 1500,
    // Progressive reveal thresholds (%)
    revealName: 10,
    revealEffects: 25,
    revealDescription: 50,
    // Window position and size (null means use default/center)
    windowX: null,
    windowY: null,
    windowWidth: null,
    windowHeight: null,
    // School colors (dynamically grows with detected schools)
    schoolColors: {
        'Destruction': '#ef4444',
        'Restoration': '#facc15',
        'Alteration': '#22c55e',
        'Conjuration': '#a855f7',
        'Illusion': '#38bdf8'
    },
    // Auto-request LLM color suggestions for new schools
    autoLLMColors: false,
    // ISL-DESTified mod integration
    islEnabled: true,
    islXpPerHour: 50,
    islTomeBonus: 25,    // percentage
    islDetected: false,  // set by C++ on game load
    // Difficulty profile system
    activeProfile: 'normal',
    profileModified: false,  // true if settings differ from selected profile
    // Discovery mode - hide locked nodes until they become available
    discoveryMode: false,
    // Early spell learning - grant spells early but with reduced effectiveness
    earlySpellLearning: {
        enabled: true,
        unlockThreshold: 25,       // % progress to unlock spell
        minEffectiveness: 20,      // % effectiveness at unlock
        maxEffectiveness: 70,      // % effectiveness just before mastery
        selfCastRequiredAt: 75,    // After this %, must cast spell itself for XP
        selfCastXPMultiplier: 150, // % XP multiplier when casting learning target
        binaryEffectThreshold: 80  // Binary effects (paralyze, etc.) need this % to work
    }
};

// Custom difficulty profiles (user-created)
var customProfiles = {};

// Per-node XP requirement overrides (formId -> requiredXP)
var xpOverrides = {};

// =============================================================================
// DYNAMIC SCHOOL COLOR MANAGEMENT
// =============================================================================

// Default palette for auto-assigning colors to new schools
var DEFAULT_COLOR_PALETTE = [
    '#ef4444', // Red
    '#facc15', // Gold
    '#22c55e', // Green
    '#a855f7', // Purple
    '#38bdf8', // Cyan
    '#f97316', // Orange
    '#ec4899', // Pink
    '#14b8a6', // Teal
    '#8b5cf6', // Violet
    '#84cc16', // Lime
    '#06b6d4', // Sky
    '#f43f5e', // Rose
    '#6366f1', // Indigo
    '#eab308', // Yellow
    '#10b981', // Emerald
    '#d946ef', // Fuchsia
    '#0ea5e9', // Light Blue
    '#22d3ee', // Cyan Light
    '#fbbf24', // Amber
    '#a3e635'  // Lime Light
];

// Get or assign a color for a school
function getOrAssignSchoolColor(school) {
    if (settings.schoolColors[school]) {
        return settings.schoolColors[school];
    }
    
    // Assign a new color from the palette
    var usedColors = Object.values(settings.schoolColors);
    var newColor = DEFAULT_COLOR_PALETTE.find(function(c) {
        return usedColors.indexOf(c) === -1;
    }) || generateRandomColor();
    
    settings.schoolColors[school] = newColor;
    console.log('[SpellLearning] Auto-assigned color', newColor, 'to new school:', school);
    
    // Update CSS variables and save
    applySchoolColorsToCSS();
    autoSaveSettings();
    
    return newColor;
}

// Generate a random color if palette is exhausted
function generateRandomColor() {
    var h = Math.floor(Math.random() * 360);
    return 'hsl(' + h + ', 70%, 55%)';
}

// Apply school colors as CSS variables and generate dynamic CSS rules
function applySchoolColorsToCSS() {
    var root = document.documentElement;
    
    // Apply CSS variables
    for (var school in settings.schoolColors) {
        var color = settings.schoolColors[school];
        var varName = '--' + school.toLowerCase().replace(/\s+/g, '-');
        var fillColor = hexToRgbaFill(color);
        
        root.style.setProperty(varName, color);
        root.style.setProperty(varName + '-fill', fillColor);
    }
    
    // Generate dynamic CSS rules for all schools
    generateDynamicSchoolCSS();
    
    console.log('[SpellLearning] Applied', Object.keys(settings.schoolColors).length, 'school colors to CSS');
}

// Generate dynamic CSS rules for school-specific styling
function generateDynamicSchoolCSS() {
    // Remove existing dynamic CSS
    var existing = document.getElementById('dynamic-school-css');
    if (existing) existing.remove();
    
    var css = '';
    
    for (var school in settings.schoolColors) {
        var color = settings.schoolColors[school];
        var fill = hexToRgbaFill(color);
        var mutedColor = hexToRgba(color, 0.4);
        
        // Locked state - muted outline
        css += '.spell-node.locked[data-school="' + school + '"] .node-bg { stroke: ' + mutedColor + '; }\n';
        
        // Available state - full outline
        css += '.spell-node.available[data-school="' + school + '"] .node-bg { stroke: ' + color + '; }\n';
        
        // Unlocked state - filled
        css += '.spell-node.unlocked[data-school="' + school + '"] .node-bg { fill: ' + fill + ' !important; stroke: ' + color + '; }\n';
        css += '.spell-node.unlocked:hover[data-school="' + school + '"] .node-bg { fill: ' + fill + ' !important; }\n';
        
        // Selected unlocked
        css += '.spell-node.selected.unlocked[data-school="' + school + '"] .node-bg { fill: ' + fill + ' !important; }\n';
        
        // Unlocked path edges
        css += '.edge.unlocked-path[data-school="' + school + '"] { stroke: ' + color + ' !important; }\n';
        
        // School badge
        css += '.school-badge.' + school.toLowerCase().replace(/\s+/g, '-') + ' { background: ' + hexToRgba(color, 0.2) + '; color: ' + color + '; }\n';
    }
    
    // Create and append style element
    var style = document.createElement('style');
    style.id = 'dynamic-school-css';
    style.textContent = css;
    document.head.appendChild(style);
}

// Convert hex to rgba with specified alpha
function hexToRgba(hex, alpha) {
    var r, g, b;
    
    if (hex.startsWith('hsl')) {
        return hex.replace('hsl(', 'hsla(').replace(')', ', ' + alpha + ')');
    }
    
    hex = hex.replace('#', '');
    if (hex.length === 3) {
        r = parseInt(hex[0] + hex[0], 16);
        g = parseInt(hex[1] + hex[1], 16);
        b = parseInt(hex[2] + hex[2], 16);
    } else {
        r = parseInt(hex.substr(0, 2), 16);
        g = parseInt(hex.substr(2, 2), 16);
        b = parseInt(hex.substr(4, 2), 16);
    }
    
    return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
}

// Convert hex to rgba fill color (more opaque for unlocked fills)
function hexToRgbaFill(hex) {
    var r, g, b;
    
    if (hex.startsWith('hsl')) {
        // For HSL colors, just add alpha
        return hex.replace('hsl(', 'hsla(').replace(')', ', 0.9)');
    }
    
    // Parse hex
    hex = hex.replace('#', '');
    if (hex.length === 3) {
        r = parseInt(hex[0] + hex[0], 16);
        g = parseInt(hex[1] + hex[1], 16);
        b = parseInt(hex[2] + hex[2], 16);
    } else {
        r = parseInt(hex.substr(0, 2), 16);
        g = parseInt(hex.substr(2, 2), 16);
        b = parseInt(hex.substr(4, 2), 16);
    }
    
    // Darken slightly for fill (multiply by 0.7)
    r = Math.round(r * 0.7);
    g = Math.round(g * 0.7);
    b = Math.round(b * 0.7);
    
    return 'rgba(' + r + ', ' + g + ', ' + b + ', 0.9)';
}

// Detect all schools from spell data
function detectAllSchools(spells) {
    var schools = {};
    var newSchools = [];
    var HEDGE_WIZARD = 'Hedge Wizard';
    
    spells.forEach(function(spell) {
        var school = spell.school;
        
        // Handle null/undefined/empty schools -> Hedge Wizard
        if (!school || school === '' || school === 'null' || school === 'undefined' || school === 'None') {
            school = HEDGE_WIZARD;
        }
        
        if (!schools[school]) {
            schools[school] = true;
            
            // Check if this is a new school we haven't seen before
            if (!settings.schoolColors[school]) {
                newSchools.push(school);
                
                // Assign default color for Hedge Wizard
                if (school === HEDGE_WIZARD) {
                    settings.schoolColors[HEDGE_WIZARD] = '#9ca3af';  // Gray
                }
            }
            
            // Ensure color is assigned (temporary from palette)
            getOrAssignSchoolColor(school);
        }
    });
    
    var schoolList = Object.keys(schools);
    console.log('[SpellLearning] Detected', schoolList.length, 'schools:', schoolList.join(', '));
    
    // Update TREE_CONFIG.schools
    TREE_CONFIG.schools = schoolList;
    
    // If new schools were detected and auto-LLM is enabled, suggest colors
    if (newSchools.length > 0 && settings.autoLLMColors && state.llmConfig.apiKey) {
        console.log('[SpellLearning] New schools detected:', newSchools.join(', '), '- requesting LLM colors');
        setTimeout(function() {
            suggestSchoolColorsWithLLM();
        }, 500);  // Small delay to let UI settle
    } else if (newSchools.length > 0) {
        console.log('[SpellLearning] New schools detected:', newSchools.join(', '), '- using palette colors (enable Auto LLM Colors in settings for AI suggestions)');
    }
    
    return schoolList;
}

// Update school color picker UI
function updateSchoolColorPickerUI() {
    var container = document.getElementById('schoolColorsContainer');
    if (!container) return;
    
    container.innerHTML = '';
    
    var schools = Object.keys(settings.schoolColors).sort();
    
    schools.forEach(function(school) {
        var color = settings.schoolColors[school];
        
        var item = document.createElement('div');
        item.className = 'school-color-item';
        
        var label = document.createElement('span');
        label.className = 'school-color-label';
        label.textContent = school;
        
        var picker = document.createElement('input');
        picker.type = 'color';
        picker.className = 'school-color-picker';
        picker.value = color.startsWith('#') ? color : rgbToHex(color);
        picker.dataset.school = school;
        
        picker.addEventListener('change', function(e) {
            var schoolName = e.target.dataset.school;
            settings.schoolColors[schoolName] = e.target.value;
            applySchoolColorsToCSS();
            autoSaveSettings();
            
            // Re-render tree if visible
            if (WheelRenderer.nodes && WheelRenderer.nodes.length > 0) {
                WheelRenderer.render();
            }
        });
        
        item.appendChild(label);
        item.appendChild(picker);
        container.appendChild(item);
    });
    
    // Show message if no schools yet
    if (schools.length === 0) {
        container.innerHTML = '<span class="setting-desc">Scan spells to detect schools</span>';
    }
}

// Convert RGB/RGBA to hex
function rgbToHex(rgb) {
    if (rgb.startsWith('#')) return rgb;
    
    var match = rgb.match(/\d+/g);
    if (!match || match.length < 3) return '#888888';
    
    var r = parseInt(match[0]).toString(16).padStart(2, '0');
    var g = parseInt(match[1]).toString(16).padStart(2, '0');
    var b = parseInt(match[2]).toString(16).padStart(2, '0');
    
    return '#' + r + g + b;
}

// LLM color suggestion for schools
// Optional callback for Full Auto mode integration
function suggestSchoolColorsWithLLM(onComplete) {
    var schools = Object.keys(settings.schoolColors);
    
    if (schools.length === 0) {
        console.log('[SpellLearning] No schools to suggest colors for');
        if (onComplete) onComplete();
        return;
    }
    
    if (!state.llmConfig.apiKey || state.llmConfig.apiKey.length < 10) {
        updateStatus('Configure API key to use LLM color suggestions');
        if (onComplete) onComplete();
        return;
    }
    
    if (!state.fullAutoMode) {
        updateStatus('Asking LLM for color suggestions...');
    }
    
    var prompt = `You are helping configure colors for a Skyrim spell learning mod UI.

I have the following spell schools that need distinct, visually appealing colors:
${schools.map(function(s, i) { return (i + 1) + '. ' + s; }).join('\n')}

Please suggest a hex color for EACH school that:
1. Is thematically appropriate (e.g., Destruction = fiery red/orange, Restoration = golden/healing colors, Blood Magic = dark crimson, Nature = forest green, etc.)
2. Is visually distinct from other schools - no two schools should have similar colors
3. Works well on a dark UI background (#0a0a0f)
4. Has good contrast and visibility
5. Feels magical and fits the fantasy theme

Respond with ONLY a JSON object mapping school names to hex colors, like:
{"Destruction": "#ef4444", "Restoration": "#facc15", ...}

Include ALL ${schools.length} schools. No explanation, just the JSON.`;

    callLLMForColors(prompt, function(result) {
        try {
            // Parse JSON from response
            var jsonMatch = result.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('No JSON found in response');
            
            var colors = JSON.parse(jsonMatch[0]);
            
            // Validate and apply
            var applied = 0;
            for (var school in colors) {
                if (settings.schoolColors.hasOwnProperty(school)) {
                    var color = colors[school];
                    if (/^#[0-9A-Fa-f]{6}$/.test(color)) {
                        settings.schoolColors[school] = color;
                        applied++;
                    }
                }
            }
            
            if (applied > 0) {
                applySchoolColorsToCSS();
                updateSchoolColorPickerUI();
                autoSaveSettings();
                
                if (WheelRenderer.nodes && WheelRenderer.nodes.length > 0) {
                    WheelRenderer.render();
                }
                
                if (!state.fullAutoMode) {
                    updateStatus('Applied LLM color suggestions for ' + applied + ' schools');
                }
                console.log('[SpellLearning] LLM suggested colors:', colors);
            } else {
                if (!state.fullAutoMode) {
                    updateStatus('LLM response did not contain valid colors');
                }
            }
        } catch (e) {
            console.error('[SpellLearning] Failed to parse LLM color suggestion:', e);
            if (!state.fullAutoMode) {
                updateStatus('Failed to parse LLM color suggestion');
            }
        }
        
        // Call completion callback if provided
        if (onComplete) onComplete();
    });
}

// Call LLM API for color suggestions
function callLLMForColors(prompt, callback) {
    var apiKey = state.llmConfig.apiKey;
    var provider = state.llmConfig.provider || 'openai';
    var model = state.llmConfig.model || 'gpt-4o-mini';
    
    var endpoint, headers, body;
    
    if (provider === 'openai') {
        endpoint = 'https://api.openai.com/v1/chat/completions';
        headers = {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey
        };
        body = JSON.stringify({
            model: model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 500,
            temperature: 0.7
        });
    } else if (provider === 'anthropic') {
        endpoint = 'https://api.anthropic.com/v1/messages';
        headers = {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
        };
        body = JSON.stringify({
            model: model,
            max_tokens: 500,
            messages: [{ role: 'user', content: prompt }]
        });
    } else {
        callback('Unsupported provider');
        return;
    }
    
    fetch(endpoint, {
        method: 'POST',
        headers: headers,
        body: body
    })
    .then(function(response) { return response.json(); })
    .then(function(data) {
        var content;
        if (provider === 'openai') {
            content = data.choices && data.choices[0] && data.choices[0].message.content;
        } else if (provider === 'anthropic') {
            content = data.content && data.content[0] && data.content[0].text;
        }
        callback(content || 'No response');
    })
    .catch(function(error) {
        console.error('[SpellLearning] LLM API error:', error);
        callback('API error: ' + error.message);
    });
}

// Key name to DirectInput scancode mapping
var KEY_CODES = {
    'F1': 59, 'F2': 60, 'F3': 61, 'F4': 62, 'F5': 63, 'F6': 64,
    'F7': 65, 'F8': 66, 'F9': 67, 'F10': 68, 'F11': 87, 'F12': 88,
    'Escape': 1, 'Tab': 15, 'CapsLock': 58, 'Backspace': 14,
    'Enter': 28, 'Space': 57,
    '1': 2, '2': 3, '3': 4, '4': 5, '5': 6, '6': 7, '7': 8, '8': 9, '9': 10, '0': 11,
    'Q': 16, 'W': 17, 'E': 18, 'R': 19, 'T': 20, 'Y': 21, 'U': 22, 'I': 23, 'O': 24, 'P': 25,
    'A': 30, 'S': 31, 'D': 32, 'F': 33, 'G': 34, 'H': 35, 'J': 36, 'K': 37, 'L': 38,
    'Z': 44, 'X': 45, 'C': 46, 'V': 47, 'B': 48, 'N': 49, 'M': 50
};

// =============================================================================
// STATE
// =============================================================================

// Global helper to update slider fill (must be defined before initialization code)
function updateSliderFillGlobal(slider) {
    if (!slider) return;
    var percent = (slider.value - slider.min) / (slider.max - slider.min) * 100;
    slider.style.setProperty('--slider-fill', percent + '%');
}

var state = {
    isMinimized: false,
    isDragging: false,
    isResizing: false,
    isSettingsOpen: false,
    currentTab: 'spellScan',
    lastSpellData: null,
    promptModified: false,
    originalPrompt: DEFAULT_TREE_RULES,
    // Field output settings
    fields: {
        editorId: true,
        magickaCost: true,
        minimumSkill: false,
        castingType: false,
        delivery: false,
        chargeTime: false,
        plugin: false,
        effects: false,
        effectNames: false,
        keywords: false
    },
    // Tree viewer state
    treeData: null,
    treeInitialized: false,
    clearTreePending: false,
    // LLM API config
    llmConfig: {
        apiKey: '',
        model: 'anthropic/claude-sonnet-4',
        maxTokens: 4096
    },
    // Clipboard paste target
    pasteTarget: null,
    // Full Auto mode flag
    fullAutoMode: false,
    // SkyrimNet integration
    skyrimNetAvailable: false,
    skyrimNetGenerating: false,
    skyrimNetQueue: [],  // Queue of schools to process
    skyrimNetCurrentSchool: null,
    skyrimNetPollInterval: null,
    skyrimNetStats: {
        totalSpells: 0,
        processedSpells: 0,
        failedSchools: []
    },
    // Progression tracking
    learningTargets: {},  // school -> formId
    spellProgress: {},    // formId -> {xp, required, unlocked, ready}
    selectedNode: null,   // Currently selected node in details panel
    playerKnownSpells: new Set()  // Set of FormIDs the player already knows
};

// =============================================================================
// SPELL CACHE (for Tree Viewer)
// =============================================================================

var SpellCache = {
    _cache: new Map(),
    _pending: new Set(),
    _callbacks: new Map(),

    get: function(formId) {
        return this._cache.get(formId);
    },

    set: function(formId, data) {
        this._cache.set(formId, data);
        this._pending.delete(formId);
        
        var callbacks = this._callbacks.get(formId) || [];
        callbacks.forEach(function(cb) { cb(data); });
        this._callbacks.delete(formId);
    },

    has: function(formId) {
        return this._cache.has(formId);
    },

    isPending: function(formId) {
        return this._pending.has(formId);
    },

    request: function(formId, callback) {
        var self = this;
        if (this.has(formId)) {
            if (callback) callback(this.get(formId));
            return;
        }

        if (callback) {
            if (!this._callbacks.has(formId)) {
                this._callbacks.set(formId, []);
            }
            this._callbacks.get(formId).push(callback);
        }

        if (!this._pending.has(formId)) {
            this._pending.add(formId);
            if (window.callCpp) {
                window.callCpp('GetSpellInfo', formId);
            } else {
                setTimeout(function() {
                    self.set(formId, self._generateMockSpell(formId));
                }, 100);
            }
        }
    },

    requestBatch: function(formIds, callback) {
        var self = this;
        var needed = formIds.filter(function(id) { 
            return !self.has(id) && !self.isPending(id); 
        });
        
        if (needed.length === 0) {
            if (callback) callback();
            return;
        }

        // Mark all as pending
        needed.forEach(function(id) { self._pending.add(id); });
        
        // Store batch callback
        if (callback) {
            this._batchCallback = callback;
        }

        // Request batch from C++ (much more efficient than individual calls)
        if (window.callCpp) {
            console.log('[SpellCache] Requesting batch of ' + needed.length + ' spells');
            window.callCpp('GetSpellInfoBatch', JSON.stringify(needed));
        } else {
            // Fallback: generate mock data
            var remaining = needed.length;
            needed.forEach(function(formId) {
                setTimeout(function() {
                    self.set(formId, self._generateMockSpell(formId));
                    remaining--;
                    if (remaining === 0 && callback) callback();
                }, 100);
            });
        }
    },
    
    onBatchComplete: function() {
        if (this._batchCallback) {
            this._batchCallback();
            this._batchCallback = null;
        }
    },

    _generateMockSpell: function(formId) {
        var schools = ['Destruction', 'Restoration', 'Alteration', 'Conjuration', 'Illusion'];
        var levels = ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master'];
        var hash = formId.split('').reduce(function(a, c) { return a + c.charCodeAt(0); }, 0);
        
        return {
            formId: formId,
            name: 'Spell ' + formId.slice(-4),
            editorId: 'Spell' + formId.slice(-4),
            school: schools[hash % 5],
            level: levels[hash % 5],
            cost: 20 + (hash % 200),
            type: 'Spell',
            effects: ['Magic Effect'],
            description: 'A magical spell.'
        };
    },

    clear: function() {
        this._cache.clear();
        this._pending.clear();
        this._callbacks.clear();
    }
};

// =============================================================================
// TREE PARSER
// =============================================================================

// Helper to log messages both to console and C++ log
function logTreeParser(message, isWarning) {
    var prefix = '[TreeParser] ';
    var fullMsg = prefix + message;
    
    if (isWarning) {
        console.warn(fullMsg);
    } else {
        console.log(fullMsg);
    }
    
    // Send to C++ for SKSE log
    if (window.callCpp) {
        window.callCpp('LogMessage', JSON.stringify({
            level: isWarning ? 'warn' : 'info',
            message: fullMsg
        }));
    }
}

var TreeParser = {
    nodes: new Map(),
    edges: [],
    schools: {},

    parse: function(data) {
        this.nodes.clear();
        this.edges = [];
        this.schools = {};

        if (typeof data === 'string') {
            try { data = JSON.parse(data); }
            catch (e) { return { success: false, error: e.message }; }
        }

        if (!data.schools) return { success: false, error: 'Missing schools' };

        var allFormIds = [];
        var self = this;

        for (var schoolName in data.schools) {
            var schoolData = data.schools[schoolName];
            if (!schoolData.root || !schoolData.nodes) continue;
            
            // Extract layoutStyle from LLM response (default to 'radial' if not provided)
            var layoutStyle = schoolData.layoutStyle || 'radial';
            if (!TREE_CONFIG.layoutStyles[layoutStyle]) {
                logTreeParser('Unknown layout style "' + layoutStyle + '" for ' + schoolName + ', using radial', true);
                layoutStyle = 'radial';
            }
            logTreeParser(schoolName + ' using layout style: ' + layoutStyle);
            
            this.schools[schoolName] = { 
                root: schoolData.root, 
                nodeIds: [], 
                maxDepth: 0, 
                maxWidth: 0,
                layoutStyle: layoutStyle 
            };

            schoolData.nodes.forEach(function(nd) {
                var id = nd.formId || nd.spellId;
                if (!id) return;

                allFormIds.push(id);
                
                self.nodes.set(id, {
                    id: id,
                    formId: id,
                    name: null,
                    school: schoolName,
                    level: null,
                    cost: null,
                    type: null,
                    effects: [],
                    desc: null,
                    children: nd.children || [],
                    prerequisites: nd.prerequisites || [],
                    tier: nd.tier || 0,
                    state: 'locked',
                    depth: 0,
                    x: 0, y: 0,
                    angle: 0, radius: 0
                });
                self.schools[schoolName].nodeIds.push(id);
            });
        }

        // Build edges from children
        this.nodes.forEach(function(node) {
            node.children.forEach(function(childId) {
                var child = self.nodes.get(childId);
                if (child) {
                    self.edges.push({ from: node.id, to: childId });
                    if (child.prerequisites.indexOf(node.id) === -1) {
                        child.prerequisites.push(node.id);
                    }
                }
            });
        });

        // Also build edges from prerequisites (handles LLM inconsistencies)
        // If a node has prerequisites but parent doesn't list it as child, still create edge
        this.nodes.forEach(function(node) {
            node.prerequisites.forEach(function(prereqId) {
                var parent = self.nodes.get(prereqId);
                if (parent) {
                    // Check if edge already exists
                    var edgeExists = self.edges.some(function(e) {
                        return e.from === prereqId && e.to === node.id;
                    });
                    if (!edgeExists) {
                        logTreeParser('Adding missing edge: ' + prereqId + ' -> ' + node.id);
                        self.edges.push({ from: prereqId, to: node.id });
                        // Also add to parent's children if missing
                        if (parent.children.indexOf(node.id) === -1) {
                            parent.children.push(node.id);
                        }
                    }
                }
            });
        });

        // VALIDATION: Detect and fix prerequisite cycles per school
        for (var schoolName in this.schools) {
            var schoolData = this.schools[schoolName];
            var cyclesFixed = this.detectAndFixCycles(schoolName, schoolData.root);
            if (cyclesFixed > 0) {
                logTreeParser('Fixed ' + cyclesFixed + ' prerequisite cycles in ' + schoolName, true);
            }
        }

        // Calculate depths
        for (var sName in this.schools) {
            var sData = this.schools[sName];
            var root = this.nodes.get(sData.root);
            if (!root) continue;

            var queue = [{ node: root, depth: 0 }];
            var visited = new Set();
            var depthCounts = {};
            
            while (queue.length) {
                var item = queue.shift();
                var node = item.node;
                var depth = item.depth;
                if (visited.has(node.id)) continue;
                visited.add(node.id);
                node.depth = depth;
                sData.maxDepth = Math.max(sData.maxDepth, depth);
                depthCounts[depth] = (depthCounts[depth] || 0) + 1;
                
                node.children.forEach(function(cid) {
                    var c = self.nodes.get(cid);
                    if (c) queue.push({ node: c, depth: depth + 1 });
                });
            }

            sData.maxWidth = Math.max.apply(null, Object.values(depthCounts).concat([1]));

            // VALIDATION: Find and fix orphaned nodes (not reachable from root)
            var orphanedNodes = [];
            sData.nodeIds.forEach(function(nodeId) {
                if (!visited.has(nodeId)) {
                    orphanedNodes.push(nodeId);
                }
            });
            
            if (orphanedNodes.length > 0) {
                logTreeParser('Found ' + orphanedNodes.length + ' orphaned nodes in ' + sName + ' - attempting to fix', true);
                
                // Fix orphaned nodes by connecting them to appropriate parents
                orphanedNodes.forEach(function(orphanId) {
                    var orphan = self.nodes.get(orphanId);
                    if (!orphan) return;
                    
                    // Find a suitable parent based on tier (connect to a node of tier-1, or root if tier 0-1)
                    var orphanTier = orphan.tier || 0;
                    var potentialParents = [];
                    
                    // Look for nodes of lower tier that are already connected
                    visited.forEach(function(connectedId) {
                        var connected = self.nodes.get(connectedId);
                        if (connected && connected.school === sName) {
                            var connectedTier = connected.tier || 0;
                            // Parent should be same tier or one tier lower
                            if (connectedTier <= orphanTier && connectedTier >= orphanTier - 1) {
                                // Prefer parents with fewer children
                                var childCount = connected.children.length;
                                potentialParents.push({ node: connected, childCount: childCount, tierDiff: orphanTier - connectedTier });
                            }
                        }
                    });
                    
                    // Sort by: 1) tier difference (prefer same tier or 1 lower), 2) fewer children
                    potentialParents.sort(function(a, b) {
                        if (a.tierDiff !== b.tierDiff) return a.tierDiff - b.tierDiff;
                        return a.childCount - b.childCount;
                    });
                    
                    var bestParent = potentialParents.length > 0 ? potentialParents[0].node : root;
                    
                    logTreeParser('Connecting orphan ' + orphanId + ' (tier ' + orphanTier + ') to ' + bestParent.id);
                    
                    // Add connection
                    if (bestParent.children.indexOf(orphanId) === -1) {
                        bestParent.children.push(orphanId);
                    }
                    if (orphan.prerequisites.indexOf(bestParent.id) === -1) {
                        orphan.prerequisites.push(bestParent.id);
                    }
                    self.edges.push({ from: bestParent.id, to: orphanId });
                    
                    // Set depth
                    orphan.depth = bestParent.depth + 1;
                    sData.maxDepth = Math.max(sData.maxDepth, orphan.depth);
                    
                    // Mark as visited so its children can be processed
                    visited.add(orphanId);
                });
                
                // Re-process children of newly connected nodes
                orphanedNodes.forEach(function(orphanId) {
                    var orphan = self.nodes.get(orphanId);
                    if (!orphan) return;
                    
                    var childQueue = [{ node: orphan, depth: orphan.depth }];
                    while (childQueue.length > 0) {
                        var item = childQueue.shift();
                        item.node.children.forEach(function(cid) {
                            var child = self.nodes.get(cid);
                            if (child && !visited.has(cid)) {
                                visited.add(cid);
                                child.depth = item.depth + 1;
                                sData.maxDepth = Math.max(sData.maxDepth, child.depth);
                                childQueue.push({ node: child, depth: child.depth });
                            }
                        });
                    }
                });
                
                logTreeParser('Fixed ' + orphanedNodes.length + ' orphaned nodes in ' + sName);
            }

            root.state = 'unlocked';
            root.children.forEach(function(cid) {
                var c = self.nodes.get(cid);
                if (c) c.state = 'available';
            });
        }

        return {
            success: true,
            nodes: Array.from(this.nodes.values()),
            edges: this.edges,
            schools: this.schools,
            allFormIds: allFormIds
        };
    },

    // Simulate unlock process to find unobtainable spells
    // A spell can only be unlocked if ALL its prerequisites are already unlocked
    // Returns number of fixes made
    detectAndFixCycles: function(schoolName, rootId) {
        var self = this;
        var fixesMade = 0;
        
        var rootNode = this.nodes.get(rootId);
        if (!rootNode) return 0;
        
        var schoolNodeIds = this.schools[schoolName].nodeIds;
        var totalNodes = schoolNodeIds.length;
        
        // Simulate unlock process - keep unlocking until no more progress
        function simulateUnlocks() {
            var unlocked = new Set();
            unlocked.add(rootId); // Root is always unlocked
            
            var changed = true;
            var iterations = 0;
            var maxIterations = totalNodes + 10; // Safety limit
            
            while (changed && iterations < maxIterations) {
                changed = false;
                iterations++;
                
                schoolNodeIds.forEach(function(nodeId) {
                    if (unlocked.has(nodeId)) return;
                    
                    var node = self.nodes.get(nodeId);
                    if (!node) return;
                    
                    // Check if ALL prerequisites are unlocked
                    var prereqs = node.prerequisites;
                    if (prereqs.length === 0) {
                        // No prerequisites but not root - this is an orphan, skip for now
                        return;
                    }
                    
                    var allPrereqsUnlocked = prereqs.every(function(prereqId) {
                        return unlocked.has(prereqId);
                    });
                    
                    if (allPrereqsUnlocked) {
                        unlocked.add(nodeId);
                        changed = true;
                    }
                });
            }
            
            return unlocked;
        }
        
        // Run initial simulation
        var unlockable = simulateUnlocks();
        
        // Find nodes that couldn't be unlocked
        var unobtainable = [];
        schoolNodeIds.forEach(function(nodeId) {
            if (!unlockable.has(nodeId)) {
                unobtainable.push(nodeId);
            }
        });
        
        if (unobtainable.length === 0) {
            logTreeParser(schoolName + ': All ' + totalNodes + ' spells are obtainable');
            return 0;
        }
        
        logTreeParser(schoolName + ': Found ' + unobtainable.length + ' unobtainable spells - analyzing prerequisites', true);
        
        // For each unobtainable node, find which prerequisite is blocking it
        unobtainable.forEach(function(nodeId) {
            var node = self.nodes.get(nodeId);
            if (!node) return;
            
            // Find which prerequisites are themselves unobtainable
            var blockingPrereqs = node.prerequisites.filter(function(prereqId) {
                return !unlockable.has(prereqId);
            });
            
            if (blockingPrereqs.length > 0) {
                logTreeParser('  ' + nodeId + ' blocked by unobtainable prereqs: ' + blockingPrereqs.join(', '), true);
            } else {
                // All prereqs are obtainable but this node isn't - shouldn't happen
                logTreeParser('  ' + nodeId + ' has obtainable prereqs but still blocked (bug?)', true);
            }
        });
        
        // Fix strategy: For each unobtainable node, if it has ANY obtainable prerequisite,
        // remove the unobtainable ones. If ALL prereqs are unobtainable, connect to root.
        var fixedThisPass = true;
        var passCount = 0;
        var maxPasses = 10;
        
        while (fixedThisPass && passCount < maxPasses) {
            fixedThisPass = false;
            passCount++;
            
            // Re-simulate to get current state
            unlockable = simulateUnlocks();
            
            schoolNodeIds.forEach(function(nodeId) {
                if (unlockable.has(nodeId)) return;
                
                var node = self.nodes.get(nodeId);
                if (!node) return;
                
                var prereqs = node.prerequisites.slice(); // Copy
                var obtainablePrereqs = prereqs.filter(function(pid) { return unlockable.has(pid); });
                var unobtainablePrereqs = prereqs.filter(function(pid) { return !unlockable.has(pid); });
                
                if (obtainablePrereqs.length > 0 && unobtainablePrereqs.length > 0) {
                    // Has some obtainable prereqs AND some unobtainable ones
                    // This is a multi-prerequisite node
                    
                    if (settings.preserveMultiPrereqs) {
                        // PRESERVE mode: Keep multi-prerequisites, only log a warning
                        // The node will become available once ALL its prereqs are eventually obtainable
                        // (they might be in a chain, not necessarily a cycle)
                        logTreeParser('Node ' + nodeId + ' has multi-prereqs (' + obtainablePrereqs.length + ' obtainable, ' + 
                                      unobtainablePrereqs.length + ' pending) - preserving structure');
                        // Don't fix, don't mark as fixed - let the unlock simulation handle chains naturally
                    } else {
                        // AGGRESSIVE mode: Remove the blocking prereqs
                        unobtainablePrereqs.forEach(function(badPrereqId) {
                            var idx = node.prerequisites.indexOf(badPrereqId);
                            if (idx !== -1) {
                                node.prerequisites.splice(idx, 1);
                                logTreeParser('Removed blocking prereq ' + badPrereqId + ' from ' + nodeId + ' (has ' + obtainablePrereqs.length + ' valid prereqs)');
                                fixesMade++;
                                fixedThisPass = true;
                                
                                // Remove from parent's children
                                var badParent = self.nodes.get(badPrereqId);
                                if (badParent) {
                                    var childIdx = badParent.children.indexOf(nodeId);
                                    if (childIdx !== -1) badParent.children.splice(childIdx, 1);
                                }
                                
                                // Remove edge
                                self.edges = self.edges.filter(function(e) {
                                    return !(e.from === badPrereqId && e.to === nodeId);
                                });
                            }
                        });
                    }
                } else if (obtainablePrereqs.length === 0 && unobtainablePrereqs.length > 0) {
                    // ALL prereqs are unobtainable - this is part of a cycle
                    // Connect to a suitable obtainable parent instead
                    var nodeTier = node.tier || 0;
                    var bestParent = null;
                    var bestScore = -Infinity;
                    
                    unlockable.forEach(function(unlockableId) {
                        var candidate = self.nodes.get(unlockableId);
                        if (!candidate || candidate.school !== schoolName) return;
                        
                        var candidateTier = candidate.tier || 0;
                        if (candidateTier <= nodeTier) {
                            // Score: prefer same/close tier, fewer children
                            var tierDiff = nodeTier - candidateTier;
                            var score = (tierDiff === 0 ? 20 : tierDiff === 1 ? 10 : 5) - candidate.children.length;
                            if (score > bestScore) {
                                bestScore = score;
                                bestParent = candidate;
                            }
                        }
                    });
                    
                    if (!bestParent) bestParent = rootNode;
                    
                    // Clear old prereqs
                    unobtainablePrereqs.forEach(function(badPrereqId) {
                        var idx = node.prerequisites.indexOf(badPrereqId);
                        if (idx !== -1) node.prerequisites.splice(idx, 1);
                        
                        var badParent = self.nodes.get(badPrereqId);
                        if (badParent) {
                            var childIdx = badParent.children.indexOf(nodeId);
                            if (childIdx !== -1) badParent.children.splice(childIdx, 1);
                        }
                        
                        self.edges = self.edges.filter(function(e) {
                            return !(e.from === badPrereqId && e.to === nodeId);
                        });
                    });
                    
                    // Add new connection
                    if (bestParent.children.indexOf(nodeId) === -1) {
                        bestParent.children.push(nodeId);
                    }
                    node.prerequisites.push(bestParent.id);
                    self.edges.push({ from: bestParent.id, to: nodeId });
                    
                    logTreeParser('Reconnected ' + nodeId + ' from cycle to ' + bestParent.id + ' (tier ' + (bestParent.tier || 0) + ')', true);
                    fixesMade++;
                    fixedThisPass = true;
                }
            });
        }
        
        // Final verification
        unlockable = simulateUnlocks();
        var stillUnobtainable = schoolNodeIds.filter(function(nid) { return !unlockable.has(nid); });
        
        if (stillUnobtainable.length > 0) {
            logTreeParser(schoolName + ': WARNING - Still have ' + stillUnobtainable.length + ' unobtainable spells after fixes!', true);
            // Force-connect remaining to root
            stillUnobtainable.forEach(function(nodeId) {
                var node = self.nodes.get(nodeId);
                if (!node) return;
                
                // Clear all prereqs
                node.prerequisites.forEach(function(pid) {
                    var parent = self.nodes.get(pid);
                    if (parent) {
                        var idx = parent.children.indexOf(nodeId);
                        if (idx !== -1) parent.children.splice(idx, 1);
                    }
                });
                node.prerequisites = [];
                self.edges = self.edges.filter(function(e) { return e.to !== nodeId; });
                
                // Connect to root
                rootNode.children.push(nodeId);
                node.prerequisites.push(rootId);
                self.edges.push({ from: rootId, to: nodeId });
                
                logTreeParser('FORCE: Connected ' + nodeId + ' directly to root', true);
                fixesMade++;
            });
        } else {
            logTreeParser(schoolName + ': All spells now obtainable after ' + fixesMade + ' fixes');
        }
        
        return fixesMade;
    },

    updateNodeFromCache: function(node) {
        var spellData = SpellCache.get(node.formId);
        if (spellData) {
            node.name = spellData.name || spellData.editorId || node.formId;
            node.level = spellData.level || spellData.skillLevel || 'Unknown';
            node.cost = spellData.cost || spellData.magickaCost || 0;
            node.type = spellData.type || spellData.castingType || 'Spell';
            node.effects = spellData.effects || spellData.effectNames || [];
            node.desc = spellData.description || '';
            if (spellData.school) node.school = spellData.school;
        }
    }
};

// =============================================================================
// WHEEL RENDERER
// =============================================================================

var WheelRenderer = {
    svg: null,
    wheelGroup: null,
    spokesLayer: null,
    edgesLayer: null,
    nodesLayer: null,
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
    _edgePathCache: {},          // Cache computed edge paths
    _viewportUpdatePending: false,
    _lastViewportUpdate: 0,
    _lodLevel: 'full',           // 'full', 'simple', 'minimal'
    _visibleNodes: new Set(),    // Track which nodes are in viewport
    _layoutCalculated: false,    // Prevent recalculating layout on pan/zoom

    init: function(svgElement) {
        this.svg = svgElement;
        this.wheelGroup = svgElement.querySelector('#wheel-group');
        this.spokesLayer = svgElement.querySelector('#spokes-layer');
        this.edgesLayer = svgElement.querySelector('#edges-layer');
        this.nodesLayer = svgElement.querySelector('#nodes-layer');
        this.centerHub = svgElement.querySelector('#center-hub');
        this._edgePathCache = {};
        this.setupEvents();
    },
    
    // Get current Level of Detail based on zoom
    getLOD: function() {
        if (this.zoom > 0.8) return 'full';
        if (this.zoom > 0.4) return 'simple';
        return 'minimal';
    },
    
    // Get viewport bounds in world coordinates
    getViewportBounds: function() {
        if (!this.svg) return null;
        var rect = this.svg.getBoundingClientRect();
        var cx = rect.width / 2;
        var cy = rect.height / 2;
        
        // Transform viewport corners to world coordinates
        var invZoom = 1 / this.zoom;
        var halfW = (rect.width / 2) * invZoom;
        var halfH = (rect.height / 2) * invZoom;
        
        // Account for pan offset
        var worldCenterX = -this.panX * invZoom;
        var worldCenterY = -this.panY * invZoom;
        
        return {
            left: worldCenterX - halfW,
            right: worldCenterX + halfW,
            top: worldCenterY - halfH,
            bottom: worldCenterY + halfH,
            // Add padding for nodes near edge
            paddedLeft: worldCenterX - halfW - 100,
            paddedRight: worldCenterX + halfW + 100,
            paddedTop: worldCenterY - halfH - 100,
            paddedBottom: worldCenterY + halfH + 100
        };
    },
    
    // Check if a node is in the viewport
    isNodeInViewport: function(node, bounds) {
        if (!bounds) return true; // No bounds = show all
        return node.x >= bounds.paddedLeft && 
               node.x <= bounds.paddedRight &&
               node.y >= bounds.paddedTop && 
               node.y <= bounds.paddedBottom;
    },

    setupEvents: function() {
        var self = this;
        this.svg.addEventListener('contextmenu', function(e) { e.preventDefault(); });
        this.svg.addEventListener('mousedown', function(e) { self.onMouseDown(e); });
        this.svg.addEventListener('mousemove', function(e) { self.onMouseMove(e); });
        this.svg.addEventListener('mouseup', function(e) { self.onMouseUp(e); });
        this.svg.addEventListener('mouseleave', function(e) { self.onMouseUp(e); });
        this.svg.addEventListener('wheel', function(e) { self.onWheel(e); }, { passive: false });
    },

    setData: function(nodes, edges, schools) {
        this.nodes = nodes;
        this.edges = edges;
        this.schools = schools;
        
        // Clear caches when data changes
        this._edgePathCache = {};
        this._layoutCalculated = false;
        this._visibleNodes.clear();
        
        // Detect and assign colors to all schools (including custom mod schools)
        detectAllSchools(nodes);
        
        // Update school color picker UI
        updateSchoolColorPickerUI();
        
        // Calculate layout once (expensive operation)
        this.layoutRadial();
        this._layoutCalculated = true;
        
        // Pre-calculate render positions (won't change on pan/zoom)
        var self = this;
        this.nodes.forEach(function(node) {
            node._renderX = node.x;
            node._renderY = node.y;
        });
        
        this.render();
        this.centerView();
    },

    layoutRadial: function() {
        var cfg = TREE_CONFIG.wheel;
        var schoolNames = Object.keys(this.schools);
        var numSchools = schoolNames.length;
        
        if (numSchools === 0) return;

        var totalPadding = numSchools * cfg.schoolPadding;
        var availableAngle = 360 - totalPadding;
        var anglePerSchool = availableAngle / numSchools;

        var currentAngle = -90;
        var self = this;
        
        schoolNames.forEach(function(schoolName, i) {
            var school = self.schools[schoolName];
            var spokeAngle = currentAngle + anglePerSchool / 2;
            
            school.startAngle = currentAngle;
            school.endAngle = currentAngle + anglePerSchool;
            school.spokeAngle = spokeAngle;
            
            self.layoutSchoolNodes(schoolName, school, spokeAngle, anglePerSchool);
            
            currentAngle += anglePerSchool + cfg.schoolPadding;
        });
    },

    layoutSchoolNodes: function(schoolName, school, spokeAngle, sectorAngle) {
        var cfg = TREE_CONFIG.wheel;
        var self = this;
        var schoolNodes = this.nodes.filter(function(n) { return n.school === schoolName; });
        
        var depthGroups = {};
        schoolNodes.forEach(function(n) {
            if (!depthGroups[n.depth]) depthGroups[n.depth] = [];
            depthGroups[n.depth].push(n);
        });

        // Calculate dynamic radius for each tier based on node count
        // Nodes need enough arc length to not overlap
        var nodeArcLength = cfg.nodeWidth + cfg.minArcSpacing;
        
        // Use up to 95% of sector angle for spreading (more aggressive)
        var maxSectorUsage = 0.95;
        var maxSectorRad = (sectorAngle * maxSectorUsage) * Math.PI / 180;
        
        // First pass: Calculate minimum radius needed for each tier to prevent overlap
        var tierRadii = [];
        var cumulativeRadius = cfg.baseRadius;
        
        for (var d = 0; d <= school.maxDepth; d++) {
            var tier = depthGroups[d] || [];
            var nodeCount = tier.length;
            
            if (nodeCount <= 1) {
                // Single node or empty tier - use base spacing
                tierRadii[d] = cumulativeRadius;
                cumulativeRadius += cfg.tierSpacing;
            } else {
                // Calculate minimum radius so nodes don't overlap
                // Arc length = radius * angle, so radius = arc_length / angle
                // Add extra padding for larger tiers to ensure clear separation
                var paddingMultiplier = 1 + (nodeCount > 5 ? 0.15 : 0); // Extra 15% for crowded tiers
                var totalArcNeeded = nodeCount * nodeArcLength * paddingMultiplier;
                var minRadiusForSpread = totalArcNeeded / maxSectorRad;
                
                // Use whichever is larger: cumulative or calculated minimum
                var actualRadius = Math.max(cumulativeRadius, minRadiusForSpread);
                tierRadii[d] = actualRadius;
                
                // Next tier should be at least tierSpacing away
                cumulativeRadius = actualRadius + cfg.tierSpacing;
            }
        }
        
        // Second pass: CRITICAL - Ensure each tier is always further from center than previous
        // This prevents "backwards" nodes where a tier could end up closer to center
        for (var d = 1; d <= school.maxDepth; d++) {
            var minRequired = tierRadii[d - 1] + cfg.tierSpacing;
            if (tierRadii[d] < minRequired) {
                tierRadii[d] = minRequired;
            }
        }
        
        // Store max radius for spoke rendering
        school.maxRadius = tierRadii[school.maxDepth] || cumulativeRadius;

        // Now layout nodes using calculated radii
        for (var d = 0; d <= school.maxDepth; d++) {
            var tier = depthGroups[d] || [];
            var radius = tierRadii[d];
            
            // Special handling for root tier (depth 0)
            if (d === 0) {
                // Root node ALWAYS at fixed baseRadius and centered exactly at spokeAngle
                tier.forEach(function(node, j) {
                    var angleOffset = 0;
                    // Only offset if multiple roots (rare)
                    if (tier.length > 1) {
                        var rootSpread = Math.min(sectorAngle * 0.3, 30); // Limit root spread
                        angleOffset = (j - (tier.length - 1) / 2) * (rootSpread / Math.max(tier.length - 1, 1));
                    }
                    
                    var nodeAngle = spokeAngle + angleOffset;
                    node.angle = nodeAngle;
                    node.radius = cfg.baseRadius; // Fixed distance for root
                    node.spokeAngle = spokeAngle;
                    node.isRoot = true; // Mark as root for special rendering
                    
                    var rad = nodeAngle * Math.PI / 180;
                    node.x = Math.cos(rad) * cfg.baseRadius;
                    node.y = Math.sin(rad) * cfg.baseRadius;
                });
            } else {
                // Non-root tiers - spread nodes across available arc
                // Calculate optimal spread based on arc length available at this radius
                var availableArcLength = radius * maxSectorRad;
                var neededArcLength = tier.length * nodeArcLength;
                
                // Use full sector if we need more space, otherwise calculate optimal spread
                var spreadAngle;
                if (tier.length === 1) {
                    spreadAngle = 0;
                } else if (neededArcLength >= availableArcLength) {
                    // Use maximum available spread - nodes will be tightly packed
                    spreadAngle = sectorAngle * maxSectorUsage;
                } else {
                    // Calculate spread that gives good spacing without going edge-to-edge
                    // Use at least 60% of sector for decent visual spread
                    var minSpreadPercent = Math.min(0.6 + (tier.length * 0.05), maxSectorUsage);
                    var calculatedSpread = (neededArcLength / availableArcLength) * sectorAngle;
                    spreadAngle = Math.max(calculatedSpread, sectorAngle * minSpreadPercent);
                    spreadAngle = Math.min(spreadAngle, sectorAngle * maxSectorUsage);
                }
                
                tier.forEach(function(node, j) {
                    var angleOffset = 0;
                    
                    if (tier.length > 1) {
                        // Distribute evenly across the spread angle
                        angleOffset = (j - (tier.length - 1) / 2) * (spreadAngle / (tier.length - 1));
                    }
                    
                    var nodeAngle = spokeAngle + angleOffset;
                    node.angle = nodeAngle;
                    node.radius = radius;
                    node.spokeAngle = spokeAngle;
                    
                    var rad = nodeAngle * Math.PI / 180;
                    node.x = Math.cos(rad) * radius;
                    node.y = Math.sin(rad) * radius;
                });
            }
        }
        
        // Log layout info for debugging
        console.log('[Layout] ' + schoolName + ': ' + schoolNodes.length + ' nodes, maxDepth=' + school.maxDepth + ', maxRadius=' + Math.round(school.maxRadius));
        
        // Post-layout collision resolution - push overlapping nodes apart
        this.resolveCollisions(schoolNodes, spokeAngle, sectorAngle * maxSectorUsage);
    },
    
    // Push overlapping nodes apart within their sector
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
                        // Nodes are overlapping - push apart
                        var overlap = minDistance - dist;
                        var pushX = (dx / dist) * overlap * pushStrength;
                        var pushY = (dy / dist) * overlap * pushStrength;
                        
                        // Push both nodes (but keep within sector bounds)
                        var newAx = a.x - pushX;
                        var newAy = a.y - pushY;
                        var newBx = b.x + pushX;
                        var newBy = b.y + pushY;
                        
                        // Convert to polar and check bounds
                        var aAngle = Math.atan2(newAy, newAx) * 180 / Math.PI;
                        var bAngle = Math.atan2(newBy, newBx) * 180 / Math.PI;
                        
                        // Only apply if still within sector
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
            
            if (!moved) break; // No more collisions
        }
    },

    render: function() {
        var startTime = performance.now();
        
        // Debug discovery mode state
        this.debugDiscoveryMode();
        
        this.spokesLayer.innerHTML = '';
        this.edgesLayer.innerHTML = '';
        this.nodesLayer.innerHTML = '';
        this.centerHub.innerHTML = '';
        this.nodeElements.clear();
        this.edgeElements.clear();
        this._visibleNodes.clear();

        // Update LOD based on current zoom
        this._lodLevel = this.getLOD();

        this.renderCenterHub();
        this.renderSpokes();
        this.renderOriginLines();
        
        // Use DocumentFragment for batched DOM updates
        var edgeFragment = document.createDocumentFragment();
        var nodeFragment = document.createDocumentFragment();
        
        var self = this;
        var viewport = this.getViewportBounds();
        
        // Render edges - use cached paths when possible
        this.edges.forEach(function(edge) {
            var edgeEl = self.createEdgeElement(edge);
            if (edgeEl) {
                edgeFragment.appendChild(edgeEl);
            }
        });
        
        // Render all nodes (viewport culling disabled for now - causes issues with pan/zoom)
        var nodeCount = this.nodes.length;
        
        this.nodes.forEach(function(node) {
            var nodeEl = self.createNodeElement(node);
            if (nodeEl) {
                nodeFragment.appendChild(nodeEl);
                self._visibleNodes.add(node.id);
            }
        });
        
        // Single DOM update for all edges and nodes
        this.edgesLayer.appendChild(edgeFragment);
        this.nodesLayer.appendChild(nodeFragment);

        this.updateTransform();
        
        var elapsed = performance.now() - startTime;
        if (elapsed > 50) {
            console.log('[WheelRenderer] Render took ' + Math.round(elapsed) + 'ms (' + 
                        this._visibleNodes.size + '/' + nodeCount + ' nodes visible, LOD: ' + this._lodLevel + ')');
        }
    },
    
    // Create edge element (separated for batching)
    createEdgeElement: function(edge) {
        var fromNode = this.nodes.find(function(n) { return n.id === edge.from; });
        var toNode = this.nodes.find(function(n) { return n.id === edge.to; });
        
        if (!fromNode || !toNode) return null;
        
        // In discovery mode, hide edges to/from hidden nodes
        if (!this.isNodeVisible(fromNode) || !this.isNodeVisible(toNode)) {
            return null;
        }
        
        // Get cached path or calculate new one
        var cacheKey = edge.from + '-' + edge.to;
        var pathData = this._edgePathCache[cacheKey];
        
        if (!pathData) {
            // Calculate path (expensive)
            pathData = this.calculateEdgePath(fromNode, toNode);
            this._edgePathCache[cacheKey] = pathData;
        }
        
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathData.d);
        path.classList.add('edge');
        path.setAttribute('data-from', edge.from);
        path.setAttribute('data-to', edge.to);
        
        // Check if edge leads to a mystery node
        var toMystery = this.isPreviewNode(toNode);
        
        // Simplified rendering for LOD
        if (this._lodLevel === 'minimal') {
            path.setAttribute('stroke', '#444');
            path.setAttribute('stroke-width', 1);
        } else {
            var color = TREE_CONFIG.getSchoolColor(fromNode.school);
            
            if (toMystery) {
                // Dimmed line for mystery nodes (no dashes)
                path.setAttribute('stroke', this.dimColor(color, 0.4));
                path.setAttribute('stroke-width', 1);
                path.setAttribute('stroke-opacity', 0.5);
            } else {
                path.setAttribute('stroke', color);
                path.setAttribute('stroke-width', this._lodLevel === 'simple' ? 1.5 : 2);
                path.setAttribute('stroke-opacity', toNode.state === 'locked' ? 0.2 : 0.6);
            }
        }
        
        this.edgeElements.set(cacheKey, path);
        return path;
    },
    
    // Calculate edge path (cacheable) - always use straight lines for clarity
    calculateEdgePath: function(fromNode, toNode) {
        return {
            d: 'M ' + fromNode.x + ' ' + fromNode.y + ' L ' + toNode.x + ' ' + toNode.y
        };
    },
    
    // Check if node should be visible (discovery mode hides locked nodes)
    isNodeVisible: function(node) {
        // Cheat mode shows everything
        if (settings.cheatMode) return true;
        
        // Not in discovery mode - show everything
        if (!settings.discoveryMode) return true;
        
        // === DISCOVERY MODE ===
        // ALWAYS show: unlocked (learned), available (learnable), learning (in progress)
        if (node.state === 'unlocked' || node.state === 'available' || node.state === 'learning') {
            return true;
        }
        
        // Show preview "???" nodes: locked nodes that are children of unlocked/available
        if (this.isPreviewNode(node)) {
            return true;
        }
        
        // Hide everything else
        return false;
    },
    
    // Debug function to log discovery mode state
    debugDiscoveryMode: function() {
        if (!this.nodes) {
            logTreeParser('Discovery Debug - NO NODES!', true);
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
        
        logTreeParser('Discovery Debug - discoveryMode=' + settings.discoveryMode + 
            ', cheatMode=' + settings.cheatMode +
            ', totalNodes=' + this.nodes.length +
            ', visible=' + visibleCount +
            ', preview=' + previewCount +
            ', states: unlocked=' + stateCount.unlocked + 
            ', available=' + stateCount.available + 
            ', learning=' + stateCount.learning + 
            ', locked=' + stateCount.locked);
    },
    
    // Calculate what percentage of the tree is unlocked
    getTreeUnlockPercent: function() {
        if (!this.nodes || this.nodes.length === 0) return 0;
        var unlockedCount = 0;
        for (var i = 0; i < this.nodes.length; i++) {
            if (this.nodes[i].state === 'unlocked') unlockedCount++;
        }
        return Math.floor((unlockedCount / this.nodes.length) * 100);
    },
    
    // Check if node should be shown as a mystery "???" preview
    // Preview = locked node that is a direct child of a node with >= 20% XP progress
    isPreviewNode: function(node) {
        // Only applies in discovery mode
        if (!settings.discoveryMode || settings.cheatMode) return false;
        
        // Only locked nodes can be previews (unlocked/available show fully)
        if (node.state === 'unlocked' || node.state === 'available' || node.state === 'learning') {
            return false;
        }
        
        // Check if ANY parent node has >= 20% XP progress
        if (!this.nodes) return false;
        
        for (var i = 0; i < this.nodes.length; i++) {
            var parent = this.nodes[i];
            // Parent must be visible (unlocked/available/learning)
            if (parent.state !== 'unlocked' && parent.state !== 'available' && parent.state !== 'learning') {
                continue;
            }
            // Check if this node is in parent's children
            if (parent.children && parent.children.indexOf(node.id) !== -1) {
                // Parent has this as child - check parent's XP progress
                var parentProgress = this.getNodeXPProgress(parent);
                if (parentProgress >= 20) {
                    return true;
                }
            }
        }
        return false;
    },
    
    // Get XP progress percentage for a node (0-100)
    getNodeXPProgress: function(node) {
        if (node.state === 'unlocked') return 100;
        if (!state.spellProgress || !state.spellProgress[node.formId]) return 0;
        var progress = state.spellProgress[node.formId];
        var currentXP = progress.xp || 0;
        var requiredXP = getXPForTier(node.level) || 100;
        return Math.min(100, Math.floor((currentXP / requiredXP) * 100));
    },
    
    // Create node element (separated for batching)
    createNodeElement: function(node) {
        // Check visibility (handles discovery mode filtering)
        if (!this.isNodeVisible(node)) {
            return null;
        }
        
        // In discovery mode, render preview nodes as mystery "???" nodes
        if (this.isPreviewNode(node)) {
            return this.createMysteryNode(node);
        }
        
        // Full detail rendering for unlocked/available/learning nodes
        return this.createFullNode(node);
    },
    
    // Create mystery "???" node for discovery mode preview
    createMysteryNode: function(node) {
        var cfg = TREE_CONFIG.wheel;
        var self = this;
        
        // Use smaller size for mystery nodes
        var nodeWidth = cfg.nodeWidth * 0.8;
        var nodeHeight = cfg.nodeHeight * 0.7;
        
        var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'node mystery-node');
        g.setAttribute('data-id', node.id);
        
        // Apply same rotation as full nodes (angle + 90 to align with radial layout)
        var rotationAngle = node.angle + 90;
        g.setAttribute('transform', 'translate(' + node.x + ',' + node.y + ') rotate(' + rotationAngle + ')');
        
        // Get school color (dimmed)
        var schoolColor = TREE_CONFIG.getSchoolColor(node.school);
        var dimmedColor = this.dimColor(schoolColor, 0.4);
        
        // Background rect - darker/more mysterious
        var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', -nodeWidth / 2);
        rect.setAttribute('y', -nodeHeight / 2);
        rect.setAttribute('width', nodeWidth);
        rect.setAttribute('height', nodeHeight);
        rect.setAttribute('rx', 4);
        rect.setAttribute('fill', 'rgba(20, 20, 30, 0.9)');
        rect.setAttribute('stroke', dimmedColor);
        rect.setAttribute('stroke-width', '1');
        g.appendChild(rect);
        
        // Mystery text "???"
        var text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'middle');
        text.setAttribute('fill', dimmedColor);
        text.setAttribute('font-size', '12px');
        text.setAttribute('font-style', 'italic');
        text.textContent = '???';
        g.appendChild(text);
        
        // Hover shows hint
        g.addEventListener('mouseenter', function() {
            rect.setAttribute('stroke-width', '2');
            rect.setAttribute('fill', 'rgba(30, 30, 45, 0.95)');
        });
        
        g.addEventListener('mouseleave', function() {
            rect.setAttribute('stroke-width', '1');
            rect.setAttribute('fill', 'rgba(20, 20, 30, 0.9)');
        });
        
        // Click does nothing meaningful but could show "Locked" tooltip
        g.addEventListener('click', function(e) {
            e.stopPropagation();
            // Could show a message like "Unlock prerequisites to reveal"
        });
        
        this.nodeElements.set(node.id, g);
        return g;
    },
    
    // Dim a color by a factor (0-1)
    dimColor: function(color, factor) {
        // Handle hex colors
        if (color.startsWith('#')) {
            var r = parseInt(color.slice(1, 3), 16);
            var g = parseInt(color.slice(3, 5), 16);
            var b = parseInt(color.slice(5, 7), 16);
            r = Math.round(r * factor);
            g = Math.round(g * factor);
            b = Math.round(b * factor);
            return 'rgb(' + r + ',' + g + ',' + b + ')';
        }
        // Handle rgb/rgba
        var match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
            var r = Math.round(parseInt(match[1]) * factor);
            var g = Math.round(parseInt(match[2]) * factor);
            var b = Math.round(parseInt(match[3]) * factor);
            return 'rgb(' + r + ',' + g + ',' + b + ')';
        }
        return color;
    },
    
    // Minimal LOD: just a colored circle
    createMinimalNode: function(node) {
        var color = node.state === 'unlocked' ? TREE_CONFIG.getSchoolColor(node.school) : '#333';
        var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', node.x);
        circle.setAttribute('cy', node.y);
        circle.setAttribute('r', 6);
        circle.setAttribute('fill', color);
        circle.classList.add('spell-node', 'minimal', node.state);
        circle.setAttribute('data-id', node.id);
        
        var self = this;
        circle.addEventListener('click', function(e) {
            e.stopPropagation();
            self.onNodeClick(node);
        });
        
        this.nodeElements.set(node.id, circle);
        return circle;
    },
    
    // Simple LOD: circle with abbreviated name
    createSimpleNode: function(node) {
        var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.classList.add('spell-node', 'simple', node.state);
        g.setAttribute('data-id', node.id);
        g.setAttribute('transform', 'translate(' + node.x + ', ' + node.y + ')');
        
        var color = TREE_CONFIG.getSchoolColor(node.school);
        var bgColor = node.state === 'unlocked' ? color : '#1a1a2e';
        
        var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', 0);
        circle.setAttribute('cy', 0);
        circle.setAttribute('r', 12);
        circle.setAttribute('fill', bgColor);
        circle.setAttribute('stroke', color);
        circle.setAttribute('stroke-width', node.state === 'unlocked' ? 2 : 1);
        circle.setAttribute('stroke-opacity', node.state === 'locked' ? 0.3 : 0.8);
        g.appendChild(circle);
        
        // Abbreviated name (3 chars)
        if (settings.showNodeNames && node.name) {
            var abbrev = node.name.slice(0, 3).toUpperCase();
            var text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', 0);
            text.setAttribute('y', 3);
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('fill', node.state === 'unlocked' ? '#000' : '#888');
            text.setAttribute('font-size', '8px');
            text.textContent = abbrev;
            g.appendChild(text);
        }
        
        var self = this;
        g.addEventListener('click', function(e) {
            e.stopPropagation();
            self.onNodeClick(node);
        });
        
        this.nodeElements.set(node.id, g);
        return g;
    },
    
    // Full detail node (original renderNode code)
    createFullNode: function(node) {
        var cfg = TREE_CONFIG.wheel;
        var tierScale = TREE_CONFIG.tierScaling;
        var self = this;
        
        // Calculate tier-based node size
        // Use getTierFromLevel first, only fall back to node.tier if level is missing
        var tier = node.level ? this.getTierFromLevel(node.level) : (node.tier || 0);
        // Clamp tier to valid range (0-4 for novice-master)
        tier = Math.min(4, Math.max(0, tier));
        var nodeWidth, nodeHeight;
        
        if (settings.nodeSizeScaling && tierScale.enabled) {
            nodeWidth = tierScale.baseWidth + (tier * tierScale.widthIncrement);
            nodeHeight = tierScale.baseHeight + (tier * tierScale.heightIncrement);
        } else {
            nodeWidth = cfg.nodeWidth;
            nodeHeight = cfg.nodeHeight;
        }
        
        node._renderWidth = nodeWidth;
        node._renderHeight = nodeHeight;
        
        var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.classList.add('spell-node', node.state);
        g.setAttribute('data-id', node.id);
        g.setAttribute('data-school', node.school);
        g.setAttribute('data-tier', tier);
        
        var rotationAngle = node.angle + 90;
        g.setAttribute('transform', 'translate(' + node.x + ', ' + node.y + ') rotate(' + rotationAngle + ')');

        var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.classList.add('node-bg');
        rect.setAttribute('x', -nodeWidth / 2);
        rect.setAttribute('y', -nodeHeight / 2);
        rect.setAttribute('width', nodeWidth);
        rect.setAttribute('height', nodeHeight);
        rect.setAttribute('rx', 5 + tier);
        g.appendChild(rect);

        var color = TREE_CONFIG.getSchoolColor(node.school);
        var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.classList.add('node-school-indicator');
        dot.setAttribute('cx', -nodeWidth / 2 + 10);
        dot.setAttribute('cy', 0);
        dot.setAttribute('r', 3 + tier * 0.5);
        if (node.state === 'unlocked') {
            dot.setAttribute('fill', color);
        } else {
            dot.setAttribute('fill', '#333');
            dot.setAttribute('stroke', color);
            dot.setAttribute('stroke-width', '1');
            dot.setAttribute('stroke-opacity', node.state === 'available' ? '0.6' : '0.3');
        }
        g.appendChild(dot);

        var displayName = this.getNodeDisplayName(node, nodeWidth);
        
        var text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.classList.add('node-text');
        text.setAttribute('x', 0);
        text.setAttribute('y', node.state === 'locked' || !node.level ? 0 : -3);
        text.setAttribute('text-anchor', 'middle');
        text.textContent = displayName;
        g.appendChild(text);

        if (node.state !== 'locked' && node.level) {
            var levelText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            levelText.classList.add('node-level');
            levelText.setAttribute('x', 0);
            levelText.setAttribute('y', 8);
            levelText.setAttribute('text-anchor', 'middle');
            levelText.textContent = node.level;
            g.appendChild(levelText);
        }

        g.addEventListener('click', function(e) {
            e.stopPropagation();
            self.onNodeClick(node);
        });
        g.addEventListener('mouseenter', function(e) {
            self.showTooltip(node, e);
        });
        g.addEventListener('mouseleave', function() {
            self.hideTooltip();
        });

        this.nodeElements.set(node.id, g);
        return g;
    },
    
    // Helper to get display name for node
    getNodeDisplayName: function(node, nodeWidth) {
        if (settings.cheatMode) {
            var name = node.name || 'Unknown';
            return name.length > 10 ? name.slice(0, 9) + '…' : name;
        } else if (node.state === 'locked' && !settings.showNodeNames) {
            return '???';
        }
        
        // In discovery mode, use XP-based name reveal (respects revealName setting)
        if (settings.discoveryMode && node.state === 'available') {
            var nodeProgress = this.getNodeXPProgress(node);
            if (nodeProgress < settings.revealName) {
                return '???';
            }
        }
        
        if (node.name) {
            var maxLen = Math.floor(nodeWidth / 7);
            return node.name.length > maxLen ? node.name.slice(0, maxLen - 1) + '…' : node.name;
        } else if (SpellCache.isPending(node.formId)) {
            return '...';
        } else {
            return node.formId.replace('0x', '').slice(-6);
        }
    },
    
    // Render lines from center hub to unlocked root nodes
    renderOriginLines: function() {
        var self = this;
        var hubRadius = 45; // Match center hub radius
        
        this.nodes.forEach(function(node) {
            // Only for root nodes that are unlocked
            if (node.isRoot && node.state === 'unlocked') {
                var color = TREE_CONFIG.getSchoolColor(node.school);
                
                // Calculate start point (edge of hub) and end point (node position)
                var rad = node.angle * Math.PI / 180;
                var startX = Math.cos(rad) * hubRadius;
                var startY = Math.sin(rad) * hubRadius;
                
                // Create path from hub to root
                var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                var d = 'M ' + startX + ' ' + startY + ' L ' + node.x + ' ' + node.y;
                path.setAttribute('d', d);
                path.setAttribute('stroke', color);
                path.setAttribute('stroke-width', 2);
                path.setAttribute('fill', 'none');
                path.setAttribute('opacity', 0.6);
                path.classList.add('origin-line');
                path.classList.add('unlocked-path');
                path.setAttribute('data-school', node.school);
                
                self.edgesLayer.appendChild(path);
            }
        });
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
        var schoolNames = Object.keys(this.schools);
        var numSchools = schoolNames.length;
        
        // Calculate max radius across all schools for divider lines
        var globalMaxRadius = 0;
        for (var schoolName in this.schools) {
            var school = this.schools[schoolName];
            var schoolMaxRadius = (school.maxRadius || cfg.baseRadius + (school.maxDepth + 0.5) * cfg.tierSpacing) + 30;
            if (schoolMaxRadius > globalMaxRadius) {
                globalMaxRadius = schoolMaxRadius;
            }
        }
        
        // Render school divider lines at boundaries (between schools) - if enabled
        if (settings.showSchoolDividers) {
            // Create defs for gradients if needed
            var defs = self.svg.querySelector('defs') || document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            if (!self.svg.querySelector('defs')) {
                self.svg.insertBefore(defs, self.svg.firstChild);
            }
            
            // Clear any existing divider gradients to prevent ID conflicts on re-render
            var oldGradients = defs.querySelectorAll('[id^="divider-grad-"]');
            oldGradients.forEach(function(grad) { grad.remove(); });
            
            schoolNames.forEach(function(schoolName, i) {
                var school = self.schools[schoolName];
                var nextSchoolName = schoolNames[(i + 1) % numSchools];
                var nextSchool = self.schools[nextSchoolName];
                
                // Get colors based on dividerColorMode setting
                var color, nextColor;
                if (settings.dividerColorMode === 'custom' && settings.dividerCustomColor) {
                    color = settings.dividerCustomColor;
                    nextColor = settings.dividerCustomColor;
                } else {
                    // Default to school colors
                    color = TREE_CONFIG.getSchoolColor(schoolName) || '#888888';
                    nextColor = TREE_CONFIG.getSchoolColor(nextSchoolName) || '#888888';
                }
                
                // The boundary is at the end of this school's sector
                var boundaryAngle = school.endAngle + (cfg.schoolPadding / 2);
                var rad = boundaryAngle * Math.PI / 180;
                
                // Calculate direction vector (pointing outward from center)
                var dirX = Math.cos(rad);
                var dirY = Math.sin(rad);
                
                // Perpendicular offset for parallel lines (rotate 90 degrees)
                var perpX = -dirY;
                var perpY = dirX;
                var lineSpacing = settings.dividerSpacing || 3; // pixels between lines
                
                // Get fade amount from settings (0 = no fade, 100 = full fade)
                var fadePercent = settings.dividerFade !== undefined ? settings.dividerFade : 50;
                var fadeStart = 100 - fadePercent; // e.g., 50% fade means gradient starts at 50%
                
                // Start and end points along the boundary angle
                var startRadius = 50;
                var endRadius = globalMaxRadius;
                
                // Line 1 - current school color (offset perpendicular to left)
                var x1Start = dirX * startRadius + perpX * lineSpacing;
                var y1Start = dirY * startRadius + perpY * lineSpacing;
                var x1End = dirX * endRadius + perpX * lineSpacing;
                var y1End = dirY * endRadius + perpY * lineSpacing;
                
                // Line 2 - next school color (offset perpendicular to right)
                var x2Start = dirX * startRadius - perpX * lineSpacing;
                var y2Start = dirY * startRadius - perpY * lineSpacing;
                var x2End = dirX * endRadius - perpX * lineSpacing;
                var y2End = dirY * endRadius - perpY * lineSpacing;
                
                // Create gradient for line 1 - use userSpaceOnUse with actual coordinates
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
                
                // Create gradient for line 2
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
        
        // Render school labels
        for (var schoolName in this.schools) {
            var school = this.schools[schoolName];
            var color = TREE_CONFIG.getSchoolColor(schoolName);
            var angle = school.spokeAngle * Math.PI / 180;
            var maxRadius = (school.maxRadius || cfg.baseRadius + (school.maxDepth + 0.5) * cfg.tierSpacing) + 30;

            var labelRadius = maxRadius + 25;
            var label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            label.classList.add('school-label');
            label.setAttribute('x', Math.cos(angle) * labelRadius);
            label.setAttribute('y', Math.sin(angle) * labelRadius);
            label.setAttribute('fill', color);
            label.setAttribute('text-anchor', 'middle');
            label.setAttribute('dominant-baseline', 'middle');
            var labelRotation = school.spokeAngle > 90 && school.spokeAngle < 270 ? school.spokeAngle + 180 : school.spokeAngle;
            label.setAttribute('transform', 'rotate(' + labelRotation + ', ' + (Math.cos(angle) * labelRadius) + ', ' + (Math.sin(angle) * labelRadius) + ')');
            label.textContent = schoolName.toUpperCase();
            this.spokesLayer.appendChild(label);
        }
    },

    // Convert spell level name to tier number
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
    
    // Handle node click
    onNodeClick: function(node) {
        this.selectNode(node);
        this.rotateSchoolToTop(node.school);
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

        // Highlight path to root (prerequisites) - always show this
        var visited = new Set();
        var queue = [node.id];
        while (queue.length) {
            var id = queue.shift();
            if (visited.has(id)) continue;
            visited.add(id);
            var n = this.nodes.find(function(x) { return x.id === id; });
            if (!n) continue;
            n.prerequisites.forEach(function(prereq) {
                var ek = prereq + '-' + id;
                var edge = self.edgeElements.get(ek);
                if (edge) edge.classList.add('path-highlight');
                queue.push(prereq);
            });
        }

        // Only highlight children edges if the node is UNLOCKED
        // (shows what spells this unlocks only after you've learned it)
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
        // Cheat mode shows all info even for locked nodes
        var showInfo = node.state !== 'locked' || settings.cheatMode;
        var nameText = showInfo ? (node.name || node.formId) : '???';
        var infoText = showInfo 
            ? node.school + ' • ' + (node.level || '?') + ' • ' + (node.cost || '?') + ' magicka'
            : 'Unlock prerequisites first';
        
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
        
        // Schedule viewport-based updates for large trees
        this.scheduleViewportUpdate();
    },
    
    // Debounced viewport update - re-renders only when zoom/pan settles
    scheduleViewportUpdate: function() {
        if (this._viewportUpdatePending) return;
        if (this.nodes.length < 50) return; // No culling needed for small trees
        
        var self = this;
        this._viewportUpdatePending = true;
        
        // Wait for pan/zoom to settle, then check if we need to re-render
        setTimeout(function() {
            self._viewportUpdatePending = false;
            
            // Check if LOD changed
            var newLOD = self.getLOD();
            if (newLOD !== self._lodLevel) {
                console.log('[WheelRenderer] LOD changed to ' + newLOD + ', re-rendering');
                self.render();
            }
        }, 150);
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
        
        // Immediately re-render if LOD threshold crossed
        var newLOD = this.getLOD();
        if (newLOD !== oldLOD && this.nodes.length > 0) {
            console.log('[WheelRenderer] LOD changed: ' + oldLOD + ' -> ' + newLOD);
            this.render();
        }
        this.updateTransform();
        document.getElementById('zoom-level').textContent = Math.round(this.zoom * 100) + '%';
    },

    // =========================================================================
    // GROWTH DSL - Recipe Interpreter
    // =========================================================================
    
    // Store growth recipes per school
    growthRecipes: {},
    
    // Apply a growth recipe to a school
    applyGrowthRecipe: function(schoolName, recipe) {
        console.log('[WheelRenderer] Applying growth recipe to ' + schoolName);
        
        // Parse and validate recipe
        var parsed = GROWTH_DSL.parseRecipe(recipe);
        if (!parsed.valid) {
            console.warn('[WheelRenderer] Invalid recipe: ' + parsed.error);
            return false;
        }
        
        this.growthRecipes[schoolName] = parsed.recipe;
        return true;
    },
    
    // Create a bounding volume test function
    createBoundingVolume: function(volumeSpec, centerX, centerY) {
        var self = this;
        var type = volumeSpec.type;
        
        switch (type) {
            case 'cone':
                return function(x, y) {
                    // Cone: wider at base, narrower at top
                    var baseR = volumeSpec.baseRadius || 200;
                    var topR = volumeSpec.topRadius || 50;
                    var h = volumeSpec.height || 400;
                    var distFromCenter = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2));
                    var depth = Math.abs(y - centerY);  // Treat y as depth
                    var maxR = baseR - (baseR - topR) * (depth / h);
                    return distFromCenter <= maxR;
                };
                
            case 'cube':
                return function(x, y) {
                    var w = volumeSpec.width || 300;
                    var h = volumeSpec.height || 400;
                    return Math.abs(x - centerX) <= w/2 && Math.abs(y - centerY) <= h/2;
                };
                
            case 'sphere':
                return function(x, y) {
                    var r = volumeSpec.radius || 250;
                    return Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2)) <= r;
                };
                
            case 'cylinder':
                return function(x, y) {
                    var r = volumeSpec.radius || 150;
                    return Math.sqrt(Math.pow(x - centerX, 2)) <= r;  // Only check x distance
                };
                
            case 'wedge':
            default:
                return function(x, y) {
                    var r = volumeSpec.radius || 350;
                    return Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2)) <= r;
                };
        }
    },
    
    // Apply modifiers to node positions
    applyModifiers: function(nodes, modifiers, centerX, centerY) {
        var self = this;
        
        modifiers.forEach(function(mod) {
            switch (mod.type) {
                case 'spiral':
                    var tightness = mod.tightness || 0.5;
                    var direction = mod.direction || 1;
                    nodes.forEach(function(node, i) {
                        var depth = node.tier || 0;
                        var angle = depth * tightness * direction * Math.PI / 4;
                        var dx = node.x - centerX;
                        var dy = node.y - centerY;
                        node.x = centerX + dx * Math.cos(angle) - dy * Math.sin(angle);
                        node.y = centerY + dx * Math.sin(angle) + dy * Math.cos(angle);
                    });
                    break;
                    
                case 'gravity':
                    var strength = mod.strength || 0.3;
                    var dir = mod.direction || 'down';
                    nodes.forEach(function(node) {
                        var depth = node.tier || 0;
                        var pull = strength * depth * 20;
                        if (dir === 'down') node.y += pull;
                        else if (dir === 'up') node.y -= pull;
                        else if (dir === 'left') node.x -= pull;
                        else if (dir === 'right') node.x += pull;
                    });
                    break;
                    
                case 'attractTo':
                    var ax = centerX + (mod.x || 0);
                    var ay = centerY + (mod.y || 0);
                    var aStrength = mod.strength || 0.2;
                    nodes.forEach(function(node) {
                        var dx = ax - node.x;
                        var dy = ay - node.y;
                        node.x += dx * aStrength;
                        node.y += dy * aStrength;
                    });
                    break;
                    
                case 'repelFrom':
                    var rx = centerX + (mod.x || 0);
                    var ry = centerY + (mod.y || 0);
                    var rStrength = mod.strength || 0.2;
                    nodes.forEach(function(node) {
                        var dx = node.x - rx;
                        var dy = node.y - ry;
                        var dist = Math.sqrt(dx*dx + dy*dy) || 1;
                        node.x += (dx / dist) * rStrength * 50;
                        node.y += (dy / dist) * rStrength * 50;
                    });
                    break;
                    
                case 'taper':
                    var startScale = mod.startScale || 1.0;
                    var endScale = mod.endScale || 0.3;
                    var maxDepth = Math.max.apply(null, nodes.map(function(n) { return n.tier || 0; })) || 1;
                    nodes.forEach(function(node) {
                        var t = (node.tier || 0) / maxDepth;
                        var scale = startScale + t * (endScale - startScale);
                        node.x = centerX + (node.x - centerX) * scale;
                        node.y = centerY + (node.y - centerY) * scale;
                    });
                    break;
                    
                case 'wind':
                    var windAngle = (mod.angle || 45) * Math.PI / 180;
                    var windIntensity = mod.intensity || 0.3;
                    nodes.forEach(function(node) {
                        var depth = node.tier || 0;
                        node.x += Math.cos(windAngle) * windIntensity * depth * 15;
                        node.y += Math.sin(windAngle) * windIntensity * depth * 15;
                    });
                    break;
            }
        });
        
        return nodes;
    },
    
    // Apply constraints to filter/adjust nodes
    applyConstraints: function(nodes, constraints, volumeTest) {
        var self = this;
        
        constraints.forEach(function(con) {
            switch (con.type) {
                case 'constrainToVolume':
                    // Move nodes inside volume if outside
                    nodes.forEach(function(node) {
                        if (volumeTest && !volumeTest(node.x, node.y)) {
                            // Push toward center
                            var dx = 0 - node.x;
                            var dy = 0 - node.y;
                            var dist = Math.sqrt(dx*dx + dy*dy) || 1;
                            node.x += dx * 0.3;
                            node.y += dy * 0.3;
                        }
                    });
                    break;
                    
                case 'minSpacing':
                    var minDist = con.distance || 30;
                    // Simple collision resolution
                    for (var iter = 0; iter < 5; iter++) {
                        for (var i = 0; i < nodes.length; i++) {
                            for (var j = i + 1; j < nodes.length; j++) {
                                var dx = nodes[j].x - nodes[i].x;
                                var dy = nodes[j].y - nodes[i].y;
                                var dist = Math.sqrt(dx*dx + dy*dy) || 1;
                                if (dist < minDist) {
                                    var overlap = (minDist - dist) / 2;
                                    var nx = dx / dist;
                                    var ny = dy / dist;
                                    nodes[i].x -= nx * overlap;
                                    nodes[i].y -= ny * overlap;
                                    nodes[j].x += nx * overlap;
                                    nodes[j].y += ny * overlap;
                                }
                            }
                        }
                    }
                    break;
                    
                case 'forceSymmetry':
                    var axis = con.axis || 'vertical';
                    if (axis === 'vertical') {
                        nodes.forEach(function(node) {
                            node.x = Math.abs(node.x) * Math.sign(node.x || 1);
                        });
                    }
                    break;
                    
                case 'clampHeight':
                    var maxH = con.maxHeight || 400;
                    nodes.forEach(function(node) {
                        node.y = Math.max(-maxH, Math.min(maxH, node.y));
                    });
                    break;
            }
        });
        
        return nodes;
    },
    
    // Get applied recipe for a school (or default)
    getRecipeForSchool: function(schoolName) {
        return this.growthRecipes[schoolName] || GROWTH_DSL.getDefaultRecipe(schoolName);
    },
    
    // Clear stored recipes
    clearRecipes: function() {
        this.growthRecipes = {};
    },

    clear: function() {
        // Clear all rendered elements
        this.nodes = [];
        this.edges = [];
        this.schools = {};
        this.nodeElements.clear();
        this.edgeElements.clear();
        this.selectedNode = null;
        this.clearRecipes();
        
        // Clear SVG layers
        if (this.spokesLayer) this.spokesLayer.innerHTML = '';
        if (this.edgesLayer) this.edgesLayer.innerHTML = '';
        if (this.nodesLayer) this.nodesLayer.innerHTML = '';
        
        // Reset view
        this.centerView();
        
        console.log('[SpellLearning] WheelRenderer cleared');
    },

    onMouseDown: function(e) {
        if (e.target.closest('.spell-node')) return;
        if (e.button === 0 || e.button === 2) {
            this.isPanning = true;
            this.panStartX = e.clientX - this.panX;
            this.panStartY = e.clientY - this.panY;
            this.svg.classList.add('dragging');
        }
    },

    onMouseMove: function(e) {
        if (this.isPanning) {
            this.panX = e.clientX - this.panStartX;
            this.panY = e.clientY - this.panStartY;
            this.updateTransform();
        }
    },

    onMouseUp: function() {
        this.isPanning = false;
        this.svg.classList.remove('dragging');
    },

    onWheel: function(e) {
        e.preventDefault();
        var delta = -e.deltaY * TREE_CONFIG.zoom.wheelFactor * this.zoom;
        this.setZoom(this.zoom + delta);
    },

    // Update node visual states (learning progress, etc)
    updateNodeStates: function() {
        var self = this;
        if (!this.nodes) return;
        
        // First, clear all learning path classes
        this.nodes.forEach(function(node) {
            var el = self.nodeElements.get(node.id);
            if (el) {
                el.classList.remove('learning');
                el.classList.remove('on-learning-path');
            }
        });
        
        // Clear learning path from edges
        if (this.edgeElements) {
            this.edgeElements.forEach(function(edgeEl) {
                edgeEl.classList.remove('learning-path');
            });
        }
        
        // Find all learning targets and trace their paths back to center
        var learningPathNodes = {};  // nodeId -> true
        var learningPathEdges = {};  // "fromId-toId" -> true
        
        for (var school in state.learningTargets) {
            var targetFormId = state.learningTargets[school];
            if (!targetFormId) continue;
            
            // Find the target node
            var targetNode = this.nodes.find(function(n) { return n.formId === targetFormId; });
            if (!targetNode || targetNode.state === 'unlocked') continue;
            
            // Trace path back to center/root
            self.tracePathToCenter(targetNode, learningPathNodes, learningPathEdges);
        }
        
        // Apply visual states
        this.nodes.forEach(function(node) {
            var el = self.nodeElements.get(node.id);
            if (!el) return;
            
            // Update state classes (locked/available/unlocked)
            el.classList.remove('locked', 'available', 'unlocked');
            el.classList.add(node.state || 'locked');
            
            // Also update the node-bg fill for unlocked nodes
            var nodeBg = el.querySelector('.node-bg');
            if (nodeBg && node.state === 'unlocked') {
                // Ensure the node reflects unlocked state visually
                nodeBg.classList.add('unlocked-bg');
            } else if (nodeBg) {
                nodeBg.classList.remove('unlocked-bg');
            }
            
            // Check if this is a learning target
            var isLearningTarget = state.learningTargets[node.school] === node.formId;
            var progress = state.spellProgress[node.formId];
            
            // Update learning indicator - main target gets special glow
            if (isLearningTarget && node.state !== 'unlocked') {
                el.classList.add('learning');
            } else if (learningPathNodes[node.id]) {
                // On the path to a learning target
                el.classList.add('on-learning-path');
            }
            
            // Update progress bar on node (if exists)
            var progressEl = el.querySelector('.node-progress');
            if (progress && node.state === 'available' && !progress.unlocked) {
                // Calculate tier-based node dimensions (same as renderNode)
                var tier = self.getTierFromLevel(node.level);
                var tierScale = 1;
                if (settings.nodeSizeScaling) {
                    tierScale = 1 + ((tier - 1) * (TREE_CONFIG.tierScaling.maxScale - 1) / 4);
                }
                var nodeWidth = TREE_CONFIG.wheel.nodeWidth * tierScale;
                var nodeHeight = TREE_CONFIG.wheel.nodeHeight * tierScale;
                
                if (!progressEl) {
                    // Create progress bar
                    progressEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                    progressEl.classList.add('node-progress');
                    progressEl.setAttribute('height', 3);
                    progressEl.setAttribute('rx', 1.5);
                    el.appendChild(progressEl);
                }
                // Position and size progress bar based on node dimensions
                progressEl.setAttribute('x', -nodeWidth / 2);
                progressEl.setAttribute('y', nodeHeight / 2 + 2);
                var percent = progress.required > 0 ? (progress.xp / progress.required) : 0;
                progressEl.setAttribute('width', (nodeWidth * Math.min(percent, 1)));
                progressEl.classList.toggle('ready', progress.ready || percent >= 1);
            } else if (progressEl) {
                progressEl.remove();
            }
        });
        
        // Apply learning path class to edges
        if (this.edgeElements) {
            this.edgeElements.forEach(function(edgeEl, edgeKey) {
                // Clear previous classes
                edgeEl.classList.remove('unlocked-path');
                edgeEl.removeAttribute('data-school');
                
                if (learningPathEdges[edgeKey]) {
                    edgeEl.classList.add('learning-path');
                }
            });
        }
        
        // Apply unlocked-path class to edges between unlocked nodes
        // This shows a permanent colored connection for unlocked spell chains
        if (this.edgeElements && this.nodes) {
            var nodeMap = {};
            self.nodes.forEach(function(n) { nodeMap[n.id] = n; });
            
            this.edgeElements.forEach(function(edgeEl, edgeKey) {
                // Don't override learning-path (cyan takes priority)
                if (edgeEl.classList.contains('learning-path')) return;
                
                var parts = edgeKey.split('-');
                var fromId = parts[0];
                var toId = parts[1];
                var fromNode = nodeMap[fromId];
                var toNode = nodeMap[toId];
                
                // If both nodes are unlocked, show the unlocked path in school color
                if (fromNode && toNode && fromNode.state === 'unlocked' && toNode.state === 'unlocked') {
                    edgeEl.classList.add('unlocked-path');
                    // Store school for CSS styling
                    edgeEl.setAttribute('data-school', toNode.school || fromNode.school);
                }
            });
        }
    },
    
    // Trace path from a node back to the center/root
    tracePathToCenter: function(node, pathNodes, pathEdges) {
        if (!node || !node.prerequisites) return;
        
        var self = this;
        var nodeMap = {};
        this.nodes.forEach(function(n) { nodeMap[n.id] = n; });
        
        // BFS/DFS to trace back through prerequisites
        var visited = {};
        var queue = [node];
        
        while (queue.length > 0) {
            var current = queue.shift();
            if (visited[current.id]) continue;
            visited[current.id] = true;
            
            // Don't mark the main learning target as "on-learning-path" (it has its own style)
            if (current.id !== node.id) {
                pathNodes[current.id] = true;
            }
            
            // Find prerequisites (nodes this one depends on)
            if (current.prerequisites && current.prerequisites.length > 0) {
                current.prerequisites.forEach(function(prereqId) {
                    var prereqNode = nodeMap[prereqId];
                    if (prereqNode && !visited[prereqId]) {
                        queue.push(prereqNode);
                        // Mark the edge
                        pathEdges[prereqId + '-' + current.id] = true;
                    }
                });
            }
        }
    }
};

// =============================================================================
// INITIALIZATION
// =============================================================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('[SpellLearning] Panel initializing...');
    
    initializePanel();
    initializeTabs();
    initializePromptEditor();
    initializeDragging();
    initializeResizing();
    initializeTreeViewer();
    initializeSettings();
    initializeTextareaEnterKey();
    
    console.log('[SpellLearning] Panel initialized');
});

// Fix Enter key in textareas - allow new lines
function initializeTextareaEnterKey() {
    var textareas = document.querySelectorAll('textarea');
    textareas.forEach(function(textarea) {
        textarea.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
                // Allow default behavior (insert newline)
                e.stopPropagation();
                // Don't prevent default - we want the newline
            }
        });
        
        // Also handle keypress for better compatibility
        textarea.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.stopPropagation();
            }
        });
    });
    console.log('[SpellLearning] Textarea Enter key handling initialized for', textareas.length, 'textareas');
}

function initializePanel() {
    // Button event listeners
    document.getElementById('scanBtn').addEventListener('click', onScanClick);
    document.getElementById('fullAutoBtn').addEventListener('click', onFullAutoClick);
    document.getElementById('saveBtn').addEventListener('click', onSaveClick);
    document.getElementById('saveBySchoolBtn').addEventListener('click', onSaveBySchoolClick);
    document.getElementById('copyBtn').addEventListener('click', onCopyClick);
    document.getElementById('pasteBtn').addEventListener('click', onPasteClick);
    document.getElementById('minimizeBtn').addEventListener('click', toggleMinimize);
    document.getElementById('closeBtn').addEventListener('click', onCloseClick);
    document.getElementById('settingsBtn').addEventListener('click', toggleSettings);
    
    // Growth Style Generator
    initializeGrowthStyleGenerator();
    
    // Tree import buttons in Spell Scan tab
    var importTreeScanBtn = document.getElementById('import-tree-scan-btn');
    var loadSavedScanBtn = document.getElementById('load-saved-scan-btn');
    if (importTreeScanBtn) {
        importTreeScanBtn.addEventListener('click', function() {
            showImportModal();
        });
    }
    if (loadSavedScanBtn) {
        loadSavedScanBtn.addEventListener('click', function() {
            loadSavedTree();
            // Switch to tree tab after loading
            switchTab('spellTree');
        });
    }
    
    // API Settings handlers
    document.getElementById('saveApiKeyBtn').addEventListener('click', onSaveApiSettings);
    document.getElementById('toggleApiKeyBtn').addEventListener('click', toggleApiKeyVisibility);
    document.getElementById('pasteApiKeyBtn').addEventListener('click', onPasteApiKey);
    document.getElementById('modelSelect').addEventListener('change', onModelChange);
    
    // Custom model handlers
    document.getElementById('pasteModelBtn').addEventListener('click', onPasteCustomModel);
    document.getElementById('clearModelBtn').addEventListener('click', onClearCustomModel);
    document.getElementById('customModelInput').addEventListener('input', onCustomModelInput);
    
    // Max tokens handler
    var maxTokensInput = document.getElementById('maxTokensInput');
    if (maxTokensInput) {
        maxTokensInput.value = state.llmConfig.maxTokens || 4096;
        maxTokensInput.addEventListener('change', function() {
            var val = parseInt(this.value) || 4096;
            val = Math.max(1000, Math.min(32000, val));
            this.value = val;
            state.llmConfig.maxTokens = val;
            console.log('[SpellLearning] Max tokens set to:', val);
            onSaveApiSettings();
        });
    }
    
    // Load API settings on init
    loadApiSettings();
    
    // Preset buttons
    document.getElementById('presetMinimal').addEventListener('click', function() { applyPreset('minimal'); });
    document.getElementById('presetBalanced').addEventListener('click', function() { applyPreset('balanced'); });
    document.getElementById('presetFull').addEventListener('click', function() { applyPreset('full'); });
    
    // Field checkbox listeners
    var fieldIds = ['editorId', 'magickaCost', 'minimumSkill', 'castingType', 'delivery', 
                    'chargeTime', 'plugin', 'effects', 'effectNames', 'keywords'];
    fieldIds.forEach(function(fieldId) {
        var checkbox = document.getElementById('field_' + fieldId);
        if (checkbox) {
            checkbox.checked = state.fields[fieldId];
            checkbox.addEventListener('change', function(e) {
                state.fields[fieldId] = e.target.checked;
                if (fieldId === 'effects' && e.target.checked) {
                    state.fields.effectNames = false;
                    document.getElementById('field_effectNames').checked = false;
                }
                if (fieldId === 'effectNames' && e.target.checked) {
                    state.fields.effects = false;
                    document.getElementById('field_effects').checked = false;
                }
            });
        }
    });
    
    document.getElementById('outputArea').addEventListener('input', updateCharCount);
    updateCharCount();
}

// =============================================================================
// TAB NAVIGATION
// =============================================================================

function initializeTabs() {
    var tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
            var tabId = this.getAttribute('data-tab');
            switchTab(tabId);
        });
    });
}

function switchTab(tabId) {
    // Auto-save settings when leaving settings tab
    if (state.currentTab === 'settings' && tabId !== 'settings') {
        autoSaveSettings();
    }
    
    state.currentTab = tabId;
    
    document.querySelectorAll('.tab-btn').forEach(function(btn) {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
    });
    
    document.querySelectorAll('.tab-content').forEach(function(content) {
        content.classList.remove('active');
    });
    
    if (tabId === 'spellScan') {
        document.getElementById('contentSpellScan').classList.add('active');
    } else if (tabId === 'treeRules') {
        document.getElementById('contentTreeRules').classList.add('active');
    } else if (tabId === 'spellTree') {
        document.getElementById('contentSpellTree').classList.add('active');
        // Initialize tree viewer if not done yet
        if (!state.treeInitialized) {
            initializeTreeViewer();
        }
        // Update transform on tab switch
        if (WheelRenderer.svg) {
            setTimeout(function() { WheelRenderer.updateTransform(); }, 50);
        }
    } else if (tabId === 'settings') {
        document.getElementById('contentSettings').classList.add('active');
    }
}

// =============================================================================
// SETTINGS PANEL
// =============================================================================

function initializeSettings() {
    // Load saved settings
    loadSettings();
    
    // Verbose logging toggle
    var verboseToggle = document.getElementById('verboseLogToggle');
    if (verboseToggle) {
        verboseToggle.checked = settings.verboseLogging;
        verboseToggle.addEventListener('change', function() {
            settings.verboseLogging = this.checked;
        });
    }
    
    // Cheat mode toggle - includes all debug features
    var cheatToggle = document.getElementById('cheatModeToggle');
    var cheatInfo = document.getElementById('cheatModeInfo');
    if (cheatToggle) {
        cheatToggle.checked = settings.cheatMode;
        if (cheatInfo) cheatInfo.classList.toggle('hidden', !settings.cheatMode);
        
        cheatToggle.addEventListener('change', function() {
            settings.cheatMode = this.checked;
            console.log('[SpellLearning] Cheat mode:', settings.cheatMode);
            if (cheatInfo) cheatInfo.classList.toggle('hidden', !settings.cheatMode);
            // Re-render tree to show/hide all spell names
            if (state.treeData) {
                WheelRenderer.render();
            }
            // Update button visibility if node is selected
            if (state.selectedNode) {
                showSpellDetails(state.selectedNode);
                updateDetailsProgression(state.selectedNode);
            }
            // Show/hide tree action buttons based on cheat mode
            updateTreeActionsVisibility();
        });
    }
    
    // Node size scaling toggle
    var nodeSizeToggle = document.getElementById('nodeSizeScalingToggle');
    if (nodeSizeToggle) {
        nodeSizeToggle.checked = settings.nodeSizeScaling;
        nodeSizeToggle.addEventListener('change', function() {
            settings.nodeSizeScaling = this.checked;
            console.log('[SpellLearning] Node size scaling:', settings.nodeSizeScaling);
            // Re-render tree with new sizing
            if (state.treeData) {
                WheelRenderer.render();
            }
        });
    }
    
    // Show node names toggle
    var showNamesToggle = document.getElementById('showNodeNamesToggle');
    if (showNamesToggle) {
        showNamesToggle.checked = settings.showNodeNames;
        showNamesToggle.addEventListener('change', function() {
            settings.showNodeNames = this.checked;
            console.log('[SpellLearning] Show node names:', settings.showNodeNames);
            // Re-render tree
            if (state.treeData) {
                WheelRenderer.render();
            }
        });
    }
    
    // Show school dividers toggle
    var showDividersToggle = document.getElementById('showSchoolDividersToggle');
    if (showDividersToggle) {
        showDividersToggle.checked = settings.showSchoolDividers;
        showDividersToggle.addEventListener('change', function() {
            settings.showSchoolDividers = this.checked;
            console.log('[SpellLearning] Show school dividers:', settings.showSchoolDividers);
            // Show/hide related settings
            updateDividerSettingsVisibility();
            // Re-render tree
            if (state.treeData) {
                WheelRenderer.render();
            }
        });
    }
    
    // Discovery mode toggle
    var discoveryModeToggle = document.getElementById('discoveryModeToggle');
    if (discoveryModeToggle) {
        discoveryModeToggle.checked = settings.discoveryMode;
        discoveryModeToggle.addEventListener('change', function() {
            settings.discoveryMode = this.checked;
            console.log('[SpellLearning] Discovery mode:', settings.discoveryMode);
            // Re-render tree to show/hide locked nodes
            if (state.treeData) {
                WheelRenderer.render();
            }
            onProgressionSettingChanged();
        });
    }
    
    // Preserve multi-prerequisites toggle
    var preserveMultiPrereqsToggle = document.getElementById('preserveMultiPrereqsToggle');
    if (preserveMultiPrereqsToggle) {
        preserveMultiPrereqsToggle.checked = settings.preserveMultiPrereqs;
        preserveMultiPrereqsToggle.addEventListener('change', function() {
            settings.preserveMultiPrereqs = this.checked;
            console.log('[SpellLearning] Preserve multi-prerequisites:', settings.preserveMultiPrereqs);
            // Note: This affects tree parsing, so user would need to re-scan to see changes
        });
    }
    
    // Divider fade slider
    var dividerFadeSlider = document.getElementById('dividerFadeSlider');
    var dividerFadeValue = document.getElementById('dividerFadeValue');
    if (dividerFadeSlider) {
        dividerFadeSlider.value = settings.dividerFade;
        if (dividerFadeValue) dividerFadeValue.textContent = settings.dividerFade + '%';
        updateSliderFillGlobal(dividerFadeSlider);
        dividerFadeSlider.addEventListener('input', function() {
            settings.dividerFade = parseInt(this.value);
            if (dividerFadeValue) dividerFadeValue.textContent = settings.dividerFade + '%';
            updateSliderFillGlobal(this);
            // Re-render tree
            if (state.treeData) {
                WheelRenderer.render();
            }
        });
    }
    
    // Divider spacing slider
    var dividerSpacingSlider = document.getElementById('dividerSpacingSlider');
    var dividerSpacingValue = document.getElementById('dividerSpacingValue');
    if (dividerSpacingSlider) {
        dividerSpacingSlider.value = settings.dividerSpacing;
        if (dividerSpacingValue) dividerSpacingValue.textContent = settings.dividerSpacing + 'px';
        updateSliderFillGlobal(dividerSpacingSlider);
        dividerSpacingSlider.addEventListener('input', function() {
            settings.dividerSpacing = parseInt(this.value);
            if (dividerSpacingValue) dividerSpacingValue.textContent = settings.dividerSpacing + 'px';
            updateSliderFillGlobal(this);
            // Re-render tree
            if (state.treeData) {
                WheelRenderer.render();
            }
        });
    }
    
    // Divider color mode select
    var dividerColorModeSelect = document.getElementById('dividerColorModeSelect');
    if (dividerColorModeSelect) {
        dividerColorModeSelect.value = settings.dividerColorMode;
        dividerColorModeSelect.addEventListener('change', function() {
            settings.dividerColorMode = this.value;
            updateDividerColorRowVisibility();
            // Re-render tree
            if (state.treeData) {
                WheelRenderer.render();
            }
        });
    }
    
    // Divider custom color picker
    var dividerCustomColorPicker = document.getElementById('dividerCustomColorPicker');
    if (dividerCustomColorPicker) {
        dividerCustomColorPicker.value = settings.dividerCustomColor;
        dividerCustomColorPicker.addEventListener('input', function() {
            settings.dividerCustomColor = this.value;
            // Re-render tree
            if (state.treeData) {
                WheelRenderer.render();
            }
        });
    }
    
    // Initial visibility of divider settings
    updateDividerSettingsVisibility();
    updateDividerColorRowVisibility();
    
    // ISL-DESTified Integration Settings
    initializeISLSettings();
    
    // Early Spell Learning Settings
    initializeEarlyLearningSettings();
    
    // Difficulty Profile System
    initializeDifficultyProfiles();
    
    // Hotkey configuration
    var hotkeyInput = document.getElementById('hotkeyInput');
    var changeHotkeyBtn = document.getElementById('changeHotkeyBtn');
    var resetHotkeyBtn = document.getElementById('resetHotkeyBtn');
    
    if (hotkeyInput && changeHotkeyBtn) {
        hotkeyInput.value = settings.hotkey;
        
        changeHotkeyBtn.addEventListener('click', function() {
            hotkeyInput.classList.add('listening');
            hotkeyInput.value = 'Press a key...';
            
            function onKeyDown(e) {
                e.preventDefault();
                var keyName = e.key.toUpperCase();
                
                // Check if it's a valid key we support
                if (KEY_CODES[keyName] || KEY_CODES[e.key]) {
                    settings.hotkey = keyName;
                    settings.hotkeyCode = KEY_CODES[keyName] || KEY_CODES[e.key];
                    hotkeyInput.value = keyName;
                    console.log('[SpellLearning] Hotkey changed to:', keyName, '(code:', settings.hotkeyCode, ')');
                } else {
                    hotkeyInput.value = settings.hotkey;
                    console.log('[SpellLearning] Unsupported key:', e.key);
                }
                
                hotkeyInput.classList.remove('listening');
                document.removeEventListener('keydown', onKeyDown);
            }
            
            document.addEventListener('keydown', onKeyDown);
        });
        
        resetHotkeyBtn.addEventListener('click', function() {
            settings.hotkey = 'F9';
            settings.hotkeyCode = 67;
            hotkeyInput.value = 'F9';
            hotkeyInput.classList.remove('listening');
        });
    }
    
    // Progression settings - Learning Mode
    var learningModeSelect = document.getElementById('learningModeSelect');
    if (learningModeSelect) {
        learningModeSelect.value = settings.learningMode;
        learningModeSelect.addEventListener('change', function() {
            settings.learningMode = this.value;
            console.log('[SpellLearning] Learning mode:', settings.learningMode);
            autoSaveSettings();
        });
    }
    
    // Progression settings - XP Multiplier Sliders
    function updateSliderFill(slider) {
        var percent = (slider.value - slider.min) / (slider.max - slider.min) * 100;
        slider.style.setProperty('--slider-fill', percent + '%');
    }
    
    function setupSlider(sliderId, valueId, settingKey) {
        var slider = document.getElementById(sliderId);
        var valueDisplay = document.getElementById(valueId);
        
        if (slider && valueDisplay) {
            slider.value = settings[settingKey];
            valueDisplay.textContent = settings[settingKey] + '%';
            updateSliderFill(slider);
            
            slider.addEventListener('input', function() {
                settings[settingKey] = parseInt(this.value);
                valueDisplay.textContent = this.value + '%';
                updateSliderFill(this);
            });
            
            // Save on change (when user releases slider)
            slider.addEventListener('change', function() {
                console.log('[SpellLearning] ' + settingKey + ':', settings[settingKey]);
                onProgressionSettingChanged();
                autoSaveSettings();
            });
        }
    }
    
    // Global XP multiplier slider (shows "x1" format instead of "%")
    var globalMultSlider = document.getElementById('xpGlobalMultiplierSlider');
    var globalMultValue = document.getElementById('xpGlobalMultiplierValue');
    if (globalMultSlider && globalMultValue) {
        globalMultSlider.value = settings.xpGlobalMultiplier;
        globalMultValue.textContent = 'x' + settings.xpGlobalMultiplier;
        updateSliderFill(globalMultSlider);
        
        globalMultSlider.addEventListener('input', function() {
            settings.xpGlobalMultiplier = parseInt(this.value);
            globalMultValue.textContent = 'x' + this.value;
            updateSliderFill(this);
        });
        
        globalMultSlider.addEventListener('change', function() {
            console.log('[SpellLearning] Global XP multiplier:', settings.xpGlobalMultiplier);
            onProgressionSettingChanged();
            autoSaveSettings();
        });
    }
    
    setupSlider('xpDirectSlider', 'xpDirectValue', 'xpMultiplierDirect');
    setupSlider('xpSchoolSlider', 'xpSchoolValue', 'xpMultiplierSchool');
    setupSlider('xpAnySlider', 'xpAnyValue', 'xpMultiplierAny');
    
    // Tier XP requirement inputs
    function setupXPInput(inputId, settingKey) {
        var input = document.getElementById(inputId);
        
        if (input) {
            input.value = settings[settingKey];
            
            input.addEventListener('change', function() {
                var val = parseInt(this.value) || 1;
                val = Math.max(1, Math.min(99999, val));  // Clamp to valid range
                this.value = val;
                settings[settingKey] = val;
                console.log('[SpellLearning] ' + settingKey + ':', settings[settingKey]);
                onProgressionSettingChanged();
                autoSaveSettings();
            });
            
            // Also save on blur
            input.addEventListener('blur', function() {
                var val = parseInt(this.value) || 1;
                val = Math.max(1, Math.min(99999, val));
                this.value = val;
                settings[settingKey] = val;
                onProgressionSettingChanged();
            });
        }
    }
    
    setupXPInput('xpNoviceInput', 'xpNovice');
    setupXPInput('xpApprenticeInput', 'xpApprentice');
    setupXPInput('xpAdeptInput', 'xpAdept');
    setupXPInput('xpExpertInput', 'xpExpert');
    setupXPInput('xpMasterInput', 'xpMaster');
    
    // Progressive reveal threshold sliders
    setupSlider('revealNameSlider', 'revealNameValue', 'revealName');
    setupSlider('revealEffectsSlider', 'revealEffectsValue', 'revealEffects');
    setupSlider('revealDescSlider', 'revealDescValue', 'revealDescription');
    
    // Save settings button
    var saveSettingsBtn = document.getElementById('saveSettingsBtn');
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', function() {
            saveSettings();
            console.log('[SpellLearning] Settings saved');
        });
    }
    
    // Reset settings button
    var resetSettingsBtn = document.getElementById('resetSettingsBtn');
    if (resetSettingsBtn) {
        resetSettingsBtn.addEventListener('click', function() {
            resetSettings();
        });
    }
    
    // Auto LLM Colors toggle
    var autoLLMToggle = document.getElementById('autoLLMColorsToggle');
    if (autoLLMToggle) {
        autoLLMToggle.checked = settings.autoLLMColors;
        autoLLMToggle.addEventListener('change', function() {
            settings.autoLLMColors = this.checked;
            console.log('[SpellLearning] Auto LLM Colors:', settings.autoLLMColors);
        });
    }
    
    // School color buttons
    var suggestColorsBtn = document.getElementById('suggestColorsBtn');
    if (suggestColorsBtn) {
        suggestColorsBtn.addEventListener('click', function() {
            suggestSchoolColorsWithLLM();
        });
    }
    
    var resetColorsBtn = document.getElementById('resetColorsBtn');
    if (resetColorsBtn) {
        resetColorsBtn.addEventListener('click', function() {
            // Reset to default colors
            settings.schoolColors = {
                'Destruction': '#ef4444',
                'Restoration': '#facc15',
                'Alteration': '#22c55e',
                'Conjuration': '#a855f7',
                'Illusion': '#38bdf8'
            };
            applySchoolColorsToCSS();
            updateSchoolColorPickerUI();
            autoSaveSettings();
            
            // Re-render tree if visible
            if (WheelRenderer.nodes && WheelRenderer.nodes.length > 0) {
                WheelRenderer.render();
            }
            
            updateStatus('School colors reset to defaults');
        });
    }
    
    // Initialize school color picker UI
    updateSchoolColorPickerUI();
    
    // Apply saved school colors to CSS
    applySchoolColorsToCSS();
}

function loadSettings() {
    // Load unified config from C++ (all settings in one file)
    if (window.callCpp) {
        window.callCpp('LoadUnifiedConfig', '');
    }
}

function saveSettings() {
    // Save unified config to C++ (all settings in one file)
    saveUnifiedConfig();
}

// Auto-save settings (debounced to avoid excessive saves)
var autoSaveTimer = null;
function autoSaveSettings() {
    // Clear any pending save
    if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
    }
    // Save after a brief delay
    autoSaveTimer = setTimeout(function() {
        saveUnifiedConfig();
        console.log('[SpellLearning] Settings auto-saved');
        autoSaveTimer = null;
    }, 500);
}

function saveUnifiedConfig() {
    if (!window.callCpp) return;
    
    var unifiedConfig = {
        // Panel settings
        hotkey: settings.hotkey,
        hotkeyCode: settings.hotkeyCode,
        cheatMode: settings.cheatMode,
        nodeSizeScaling: settings.nodeSizeScaling,
        showNodeNames: settings.showNodeNames,
        showSchoolDividers: settings.showSchoolDividers,
        dividerFade: settings.dividerFade,
        dividerSpacing: settings.dividerSpacing,
        dividerColorMode: settings.dividerColorMode,
        dividerCustomColor: settings.dividerCustomColor,
        preserveMultiPrereqs: settings.preserveMultiPrereqs,
        verboseLogging: settings.verboseLogging,
        
        // Progression settings
        learningMode: settings.learningMode,
        xpGlobalMultiplier: settings.xpGlobalMultiplier,
        xpMultiplierDirect: settings.xpMultiplierDirect,
        xpMultiplierSchool: settings.xpMultiplierSchool,
        xpMultiplierAny: settings.xpMultiplierAny,
        // Tier XP requirements
        xpNovice: settings.xpNovice,
        xpApprentice: settings.xpApprentice,
        xpAdept: settings.xpAdept,
        xpExpert: settings.xpExpert,
        xpMaster: settings.xpMaster,
        // Progressive reveal thresholds
        revealName: settings.revealName,
        revealEffects: settings.revealEffects,
        revealDescription: settings.revealDescription,
        
        // LLM API settings
        llm: {
            apiKey: state.llmConfig.apiKey,
            model: state.llmConfig.model,
            customModel: state.llmConfig.customModel || '',
            maxTokens: state.llmConfig.maxTokens
        },
        
        // Field output settings for spell scan
        fields: state.fields,
        
        // Scan mode
        scanModeTomes: document.getElementById('scanModeTomes') ? 
            document.getElementById('scanModeTomes').checked : true,
        
        // Per-node XP overrides
        xpOverrides: xpOverrides,
        
        // Window position and size
        windowX: settings.windowX,
        windowY: settings.windowY,
        windowWidth: settings.windowWidth,
        windowHeight: settings.windowHeight,
        
        // School colors
        schoolColors: settings.schoolColors,
        autoLLMColors: settings.autoLLMColors,
        
        // ISL-DESTified integration
        islEnabled: settings.islEnabled,
        islXpPerHour: settings.islXpPerHour,
        islTomeBonus: settings.islTomeBonus,
        
        // Difficulty profiles
        activeProfile: settings.activeProfile,
        customProfiles: customProfiles,
        
        // Discovery mode
        discoveryMode: settings.discoveryMode,
        
        // Early spell learning
        earlySpellLearning: settings.earlySpellLearning
    };
    
    console.log('[SpellLearning] Saving unified config');
    window.callCpp('SaveUnifiedConfig', JSON.stringify(unifiedConfig));
}

function resetSettings() {
    settings.hotkey = 'F9';
    settings.hotkeyCode = 67;
    settings.cheatMode = false;
    settings.nodeSizeScaling = true;
    settings.showNodeNames = true;
    settings.showSchoolDividers = true;
    settings.verboseLogging = false;
    settings.learningMode = 'perSchool';
    settings.xpGlobalMultiplier = 1;
    settings.xpMultiplierDirect = 100;
    settings.xpMultiplierSchool = 50;
    settings.xpMultiplierAny = 10;
    settings.xpNovice = 100;
    settings.xpApprentice = 200;
    settings.xpAdept = 400;
    settings.xpExpert = 800;
    settings.xpMaster = 1500;
    settings.revealName = 10;
    settings.revealEffects = 25;
    settings.revealDescription = 50;
    
    // Clear XP overrides
    xpOverrides = {};
    
    // Update UI
    var cheatToggle = document.getElementById('cheatModeToggle');
    var nodeSizeToggle = document.getElementById('nodeSizeScalingToggle');
    var showNamesToggle = document.getElementById('showNodeNamesToggle');
    var verboseToggle = document.getElementById('verboseLogToggle');
    var hotkeyInput = document.getElementById('hotkeyInput');
    var cheatInfo = document.getElementById('cheatModeInfo');
    
    if (cheatToggle) cheatToggle.checked = false;
    if (nodeSizeToggle) nodeSizeToggle.checked = true;
    if (showNamesToggle) showNamesToggle.checked = true;
    var showDividersToggle = document.getElementById('showSchoolDividersToggle');
    if (showDividersToggle) showDividersToggle.checked = true;
    if (verboseToggle) verboseToggle.checked = false;
    if (hotkeyInput) hotkeyInput.value = 'F9';
    if (cheatInfo) cheatInfo.classList.add('hidden');
    
    // Update progression settings UI
    var learningModeSelect = document.getElementById('learningModeSelect');
    var xpDirectSlider = document.getElementById('xpDirectSlider');
    var xpSchoolSlider = document.getElementById('xpSchoolSlider');
    var xpAnySlider = document.getElementById('xpAnySlider');
    var globalMultSlider = document.getElementById('xpGlobalMultiplierSlider');
    
    // Helper to update slider fill visual
    function updateSliderFillReset(slider) {
        if (!slider) return;
        var percent = (slider.value - slider.min) / (slider.max - slider.min) * 100;
        slider.style.setProperty('--slider-fill', percent + '%');
    }
    
    if (learningModeSelect) learningModeSelect.value = 'perSchool';
    
    // Global multiplier
    if (globalMultSlider) {
        globalMultSlider.value = 1;
        updateSliderFillReset(globalMultSlider);
        var globalMultValue = document.getElementById('xpGlobalMultiplierValue');
        if (globalMultValue) globalMultValue.textContent = 'x1';
    }
    
    if (xpDirectSlider) {
        xpDirectSlider.value = 100;
        updateSliderFillReset(xpDirectSlider);
        var xpDirectValue = document.getElementById('xpDirectValue');
        if (xpDirectValue) xpDirectValue.textContent = '100%';
    }
    if (xpSchoolSlider) {
        xpSchoolSlider.value = 50;
        updateSliderFillReset(xpSchoolSlider);
        var xpSchoolValue = document.getElementById('xpSchoolValue');
        if (xpSchoolValue) xpSchoolValue.textContent = '50%';
    }
    if (xpAnySlider) {
        xpAnySlider.value = 10;
        updateSliderFillReset(xpAnySlider);
        var xpAnyValue = document.getElementById('xpAnyValue');
        if (xpAnyValue) xpAnyValue.textContent = '10%';
    }
    
    // Reset tier XP inputs
    var tierInputDefaults = {
        'xpNoviceInput': 100,
        'xpApprenticeInput': 200,
        'xpAdeptInput': 400,
        'xpExpertInput': 800,
        'xpMasterInput': 1500
    };
    for (var inputId in tierInputDefaults) {
        var input = document.getElementById(inputId);
        if (input) input.value = tierInputDefaults[inputId];
    }
    
    // Reset reveal sliders
    var revealSliderDefaults = [
        { id: 'revealNameSlider', valueId: 'revealNameValue', val: 10 },
        { id: 'revealEffectsSlider', valueId: 'revealEffectsValue', val: 25 },
        { id: 'revealDescSlider', valueId: 'revealDescValue', val: 50 }
    ];
    revealSliderDefaults.forEach(function(cfg) {
        var slider = document.getElementById(cfg.id);
        var valueEl = document.getElementById(cfg.valueId);
        if (slider) {
            slider.value = cfg.val;
            updateSliderFillReset(slider);
            if (valueEl) valueEl.textContent = cfg.val + '%';
        }
    });
    
    // Re-render tree
    if (state.treeData) {
        WheelRenderer.render();
    }
    
    console.log('[SpellLearning] Settings reset to defaults');
}

// C++ callback for loading unified config
window.onUnifiedConfigLoaded = function(dataStr) {
    console.log('[SpellLearning] Unified config received');
    try {
        var data = typeof dataStr === 'string' ? JSON.parse(dataStr) : dataStr;
        if (!data) return;
        
        // === Panel Settings ===
        settings.hotkey = data.hotkey || 'F9';
        settings.hotkeyCode = data.hotkeyCode || 67;
        settings.cheatMode = data.cheatMode || false;
        settings.nodeSizeScaling = data.nodeSizeScaling !== false;  // default true
        settings.showNodeNames = data.showNodeNames !== false;  // default true
        settings.showSchoolDividers = data.showSchoolDividers !== false;  // default true
        settings.dividerFade = data.dividerFade !== undefined ? data.dividerFade : 50;
        settings.dividerSpacing = data.dividerSpacing !== undefined ? data.dividerSpacing : 3;
        settings.dividerColorMode = data.dividerColorMode || 'school';
        settings.dividerCustomColor = data.dividerCustomColor || '#ffffff';
        settings.preserveMultiPrereqs = data.preserveMultiPrereqs !== false;  // default true
        settings.verboseLogging = data.verboseLogging || false;
        
        // === Progression Settings ===
        settings.learningMode = data.learningMode || 'perSchool';
        settings.xpGlobalMultiplier = data.xpGlobalMultiplier !== undefined ? data.xpGlobalMultiplier : 1;
        settings.xpMultiplierDirect = data.xpMultiplierDirect !== undefined ? data.xpMultiplierDirect : 100;
        settings.xpMultiplierSchool = data.xpMultiplierSchool !== undefined ? data.xpMultiplierSchool : 50;
        settings.xpMultiplierAny = data.xpMultiplierAny !== undefined ? data.xpMultiplierAny : 10;
        // Tier XP requirements
        settings.xpNovice = data.xpNovice !== undefined ? data.xpNovice : 100;
        settings.xpApprentice = data.xpApprentice !== undefined ? data.xpApprentice : 200;
        settings.xpAdept = data.xpAdept !== undefined ? data.xpAdept : 400;
        settings.xpExpert = data.xpExpert !== undefined ? data.xpExpert : 800;
        settings.xpMaster = data.xpMaster !== undefined ? data.xpMaster : 1500;
        // Progressive reveal thresholds
        settings.revealName = data.revealName !== undefined ? data.revealName : 10;
        settings.revealEffects = data.revealEffects !== undefined ? data.revealEffects : 25;
        settings.revealDescription = data.revealDescription !== undefined ? data.revealDescription : 50;
        
        // Per-node XP overrides
        if (data.xpOverrides && typeof data.xpOverrides === 'object') {
            xpOverrides = data.xpOverrides;
            console.log('[SpellLearning] Loaded XP overrides for', Object.keys(xpOverrides).length, 'spells');
        } else {
            xpOverrides = {};
        }
        
        // Window position and size
        settings.windowX = data.windowX !== undefined ? data.windowX : null;
        settings.windowY = data.windowY !== undefined ? data.windowY : null;
        settings.windowWidth = data.windowWidth !== undefined ? data.windowWidth : null;
        settings.windowHeight = data.windowHeight !== undefined ? data.windowHeight : null;
        
        // Apply window position and size if saved
        applyWindowPositionAndSize();
        
        // School colors
        if (data.schoolColors && typeof data.schoolColors === 'object') {
            // Merge with defaults (keep any new schools that might have been added)
            for (var school in data.schoolColors) {
                settings.schoolColors[school] = data.schoolColors[school];
            }
            console.log('[SpellLearning] Loaded colors for', Object.keys(settings.schoolColors).length, 'schools');
        }
        
        // Auto LLM colors setting
        settings.autoLLMColors = data.autoLLMColors !== undefined ? data.autoLLMColors : false;
        
        // ISL-DESTified integration settings
        settings.islEnabled = data.islEnabled !== undefined ? data.islEnabled : true;
        settings.islXpPerHour = data.islXpPerHour !== undefined ? data.islXpPerHour : 50;
        settings.islTomeBonus = data.islTomeBonus !== undefined ? data.islTomeBonus : 25;
        
        // Difficulty profiles
        settings.activeProfile = data.activeProfile || 'normal';
        if (data.customProfiles && typeof data.customProfiles === 'object') {
            customProfiles = data.customProfiles;
            console.log('[SpellLearning] Loaded', Object.keys(customProfiles).length, 'custom profiles');
        } else {
            customProfiles = {};
        }
        
        // Discovery mode
        settings.discoveryMode = data.discoveryMode !== undefined ? data.discoveryMode : false;
        var discoveryModeToggle = document.getElementById('discoveryModeToggle');
        if (discoveryModeToggle) discoveryModeToggle.checked = settings.discoveryMode;
        
        // Preserve multi-prerequisites
        var preserveMultiPrereqsToggle = document.getElementById('preserveMultiPrereqsToggle');
        if (preserveMultiPrereqsToggle) preserveMultiPrereqsToggle.checked = settings.preserveMultiPrereqs;
        
        // Apply school colors to CSS
        applySchoolColorsToCSS();
        updateSchoolColorPickerUI();
        
        // Update Auto LLM toggle
        var autoLLMToggle = document.getElementById('autoLLMColorsToggle');
        if (autoLLMToggle) autoLLMToggle.checked = settings.autoLLMColors;
        
        // Update UI toggles
        var cheatToggle = document.getElementById('cheatModeToggle');
        var nodeSizeToggle = document.getElementById('nodeSizeScalingToggle');
        var showNamesToggle = document.getElementById('showNodeNamesToggle');
        var verboseToggle = document.getElementById('verboseLogToggle');
        var hotkeyInput = document.getElementById('hotkeyInput');
        var cheatInfo = document.getElementById('cheatModeInfo');
        
        if (cheatToggle) cheatToggle.checked = settings.cheatMode;
        if (nodeSizeToggle) nodeSizeToggle.checked = settings.nodeSizeScaling;
        if (showNamesToggle) showNamesToggle.checked = settings.showNodeNames;
        var showDividersToggle = document.getElementById('showSchoolDividersToggle');
        if (showDividersToggle) showDividersToggle.checked = settings.showSchoolDividers;
        
        // Update divider settings
        var dividerFadeSlider = document.getElementById('dividerFadeSlider');
        var dividerFadeValue = document.getElementById('dividerFadeValue');
        if (dividerFadeSlider) {
            dividerFadeSlider.value = settings.dividerFade;
            if (dividerFadeValue) dividerFadeValue.textContent = settings.dividerFade + '%';
            updateSliderFillGlobal(dividerFadeSlider);
        }
        var dividerSpacingSlider = document.getElementById('dividerSpacingSlider');
        var dividerSpacingValue = document.getElementById('dividerSpacingValue');
        if (dividerSpacingSlider) {
            dividerSpacingSlider.value = settings.dividerSpacing;
            if (dividerSpacingValue) dividerSpacingValue.textContent = settings.dividerSpacing + 'px';
            updateSliderFillGlobal(dividerSpacingSlider);
        }
        
        // Update divider color settings
        var dividerColorModeSelect = document.getElementById('dividerColorModeSelect');
        if (dividerColorModeSelect) {
            dividerColorModeSelect.value = settings.dividerColorMode;
        }
        var dividerCustomColorPicker = document.getElementById('dividerCustomColorPicker');
        if (dividerCustomColorPicker) {
            dividerCustomColorPicker.value = settings.dividerCustomColor;
        }
        
        updateDividerSettingsVisibility();
        
        // Update ISL settings UI
        var islEnabledToggle = document.getElementById('islEnabledToggle');
        var islXpPerHourInput = document.getElementById('islXpPerHourInput');
        var islTomeBonusSlider = document.getElementById('islTomeBonusSlider');
        var islTomeBonusValue = document.getElementById('islTomeBonusValue');
        if (islTomeBonusSlider) {
            updateSliderFillGlobal(islTomeBonusSlider);
        }
        
        if (islEnabledToggle) islEnabledToggle.checked = settings.islEnabled;
        if (islXpPerHourInput) islXpPerHourInput.value = settings.islXpPerHour;
        if (islTomeBonusSlider) {
            islTomeBonusSlider.value = settings.islTomeBonus;
            if (islTomeBonusValue) islTomeBonusValue.textContent = settings.islTomeBonus + '%';
        }
        
        // Early spell learning settings
        if (data.earlySpellLearning && typeof data.earlySpellLearning === 'object') {
            var el = data.earlySpellLearning;
            settings.earlySpellLearning.enabled = el.enabled !== undefined ? el.enabled : true;
            settings.earlySpellLearning.unlockThreshold = el.unlockThreshold !== undefined ? el.unlockThreshold : 25;
            settings.earlySpellLearning.minEffectiveness = el.minEffectiveness !== undefined ? el.minEffectiveness : 20;
            settings.earlySpellLearning.maxEffectiveness = el.maxEffectiveness !== undefined ? el.maxEffectiveness : 70;
            settings.earlySpellLearning.selfCastRequiredAt = el.selfCastRequiredAt !== undefined ? el.selfCastRequiredAt : 75;
            settings.earlySpellLearning.selfCastXPMultiplier = el.selfCastXPMultiplier !== undefined ? el.selfCastXPMultiplier : 150;
            settings.earlySpellLearning.binaryEffectThreshold = el.binaryEffectThreshold !== undefined ? el.binaryEffectThreshold : 80;
        }
        updateEarlyLearningUI();
        
        // Update difficulty profile UI
        var profileSelect = document.getElementById('difficultyProfileSelect');
        if (profileSelect) {
            updateProfileDropdown();
            profileSelect.value = settings.activeProfile;
        }
        updateProfileDescription();
        updateProfileModifiedBadge();
        updateCustomProfilesUI();
        
        if (verboseToggle) verboseToggle.checked = settings.verboseLogging;
        if (hotkeyInput) hotkeyInput.value = settings.hotkey;
        if (cheatInfo) cheatInfo.classList.toggle('hidden', !settings.cheatMode);
        
        // Update progression settings UI
        var learningModeSelect = document.getElementById('learningModeSelect');
        var xpDirectSlider = document.getElementById('xpDirectSlider');
        var xpSchoolSlider = document.getElementById('xpSchoolSlider');
        var xpAnySlider = document.getElementById('xpAnySlider');
        
        // Helper to update slider fill visual
        function updateSliderFillVisual(slider) {
            if (!slider) return;
            var percent = (slider.value - slider.min) / (slider.max - slider.min) * 100;
            slider.style.setProperty('--slider-fill', percent + '%');
        }
        
        if (learningModeSelect) learningModeSelect.value = settings.learningMode;
        
        // Global multiplier slider
        var globalMultSlider = document.getElementById('xpGlobalMultiplierSlider');
        var globalMultValue = document.getElementById('xpGlobalMultiplierValue');
        if (globalMultSlider) {
            globalMultSlider.value = settings.xpGlobalMultiplier;
            updateSliderFillVisual(globalMultSlider);
            if (globalMultValue) globalMultValue.textContent = 'x' + settings.xpGlobalMultiplier;
        }
        
        if (xpDirectSlider) {
            xpDirectSlider.value = settings.xpMultiplierDirect;
            updateSliderFillVisual(xpDirectSlider);
            var xpDirectValue = document.getElementById('xpDirectValue');
            if (xpDirectValue) xpDirectValue.textContent = settings.xpMultiplierDirect + '%';
        }
        if (xpSchoolSlider) {
            xpSchoolSlider.value = settings.xpMultiplierSchool;
            updateSliderFillVisual(xpSchoolSlider);
            var xpSchoolValue = document.getElementById('xpSchoolValue');
            if (xpSchoolValue) xpSchoolValue.textContent = settings.xpMultiplierSchool + '%';
        }
        if (xpAnySlider) {
            xpAnySlider.value = settings.xpMultiplierAny;
            updateSliderFillVisual(xpAnySlider);
            var xpAnyValue = document.getElementById('xpAnyValue');
            if (xpAnyValue) xpAnyValue.textContent = settings.xpMultiplierAny + '%';
        }
        
        // Update tier XP inputs
        var tierInputs = [
            { id: 'xpNoviceInput', key: 'xpNovice' },
            { id: 'xpApprenticeInput', key: 'xpApprentice' },
            { id: 'xpAdeptInput', key: 'xpAdept' },
            { id: 'xpExpertInput', key: 'xpExpert' },
            { id: 'xpMasterInput', key: 'xpMaster' }
        ];
        
        tierInputs.forEach(function(cfg) {
            var input = document.getElementById(cfg.id);
            if (input) {
                input.value = settings[cfg.key];
            }
        });
        
        // Update reveal threshold sliders
        var revealSliders = [
            { id: 'revealNameSlider', valueId: 'revealNameValue', key: 'revealName', suffix: '%' },
            { id: 'revealEffectsSlider', valueId: 'revealEffectsValue', key: 'revealEffects', suffix: '%' },
            { id: 'revealDescSlider', valueId: 'revealDescValue', key: 'revealDescription', suffix: '%' }
        ];
        
        revealSliders.forEach(function(cfg) {
            var slider = document.getElementById(cfg.id);
            var valueEl = document.getElementById(cfg.valueId);
            if (slider) {
                slider.value = settings[cfg.key];
                updateSliderFillVisual(slider);
                if (valueEl) valueEl.textContent = settings[cfg.key] + cfg.suffix;
            }
        });
        
        // === LLM Settings ===
        if (data.llm) {
            state.llmConfig.apiKey = data.llm.apiKey || '';
            state.llmConfig.model = data.llm.model || 'anthropic/claude-sonnet-4';
            state.llmConfig.customModel = data.llm.customModel || '';
            state.llmConfig.maxTokens = data.llm.maxTokens || 4096;
            
            // Update LLM UI
            var apiKeyInput = document.getElementById('apiKeyInput');
            var modelSelect = document.getElementById('modelSelect');
            var customModelInput = document.getElementById('customModelInput');
            
            if (apiKeyInput && state.llmConfig.apiKey) {
                // Mask the key for display
                var key = state.llmConfig.apiKey;
                apiKeyInput.value = key.length > 10 ? 
                    key.substring(0, 6) + '...' + key.substring(key.length - 4) : 
                    key;
            }
            
            // Set model dropdown - try to match, but if custom model is set, it takes priority
            if (modelSelect) {
                // If custom model looks like a known dropdown value, select it
                var knownModels = ['anthropic/claude-sonnet-4', 'anthropic/claude-3.5-sonnet', 
                    'openai/gpt-4o', 'openai/gpt-4o-mini', 'google/gemini-2.0-flash-001', 
                    'meta-llama/llama-3.3-70b-instruct'];
                if (knownModels.indexOf(state.llmConfig.model) !== -1) {
                    modelSelect.value = state.llmConfig.model;
                }
            }
            
            // Set custom model input
            if (customModelInput) {
                customModelInput.value = state.llmConfig.customModel || '';
                updateModelDisplayState();
            }
            
            // Set max tokens input
            var maxTokensInput = document.getElementById('maxTokensInput');
            if (maxTokensInput) {
                maxTokensInput.value = state.llmConfig.maxTokens || 4096;
            }
            
            // Update API status
            var apiStatus = document.getElementById('apiStatus');
            if (apiStatus && state.llmConfig.apiKey) {
                apiStatus.textContent = 'API key loaded (' + state.llmConfig.apiKey.length + ' chars)';
                apiStatus.style.color = '#4ade80';
            }
        }
        
        // === Field Settings ===
        if (data.fields) {
            state.fields = data.fields;
            
            // Update field checkboxes
            for (var fieldName in data.fields) {
                var checkbox = document.getElementById('field_' + fieldName);
                if (checkbox) {
                    checkbox.checked = data.fields[fieldName];
                }
            }
        }
        
        // === Scan Mode ===
        if (data.scanModeTomes !== undefined) {
            var scanModeCheckbox = document.getElementById('scanModeTomes');
            if (scanModeCheckbox) {
                scanModeCheckbox.checked = data.scanModeTomes;
            }
        }
        
        console.log('[SpellLearning] Unified config loaded:', {
            settings: settings,
            llmModel: state.llmConfig.model,
            hasApiKey: !!state.llmConfig.apiKey,
            fields: state.fields
        });
        
    } catch (e) {
        console.error('[SpellLearning] Failed to parse unified config:', e);
    }
};

// Legacy callback for backwards compatibility
window.onSettingsLoaded = window.onUnifiedConfigLoaded;
window.onLLMConfigLoaded = function(dataStr) {
    // This is now handled by onUnifiedConfigLoaded
    // But keep for backwards compatibility with any existing code
    try {
        var data = typeof dataStr === 'string' ? JSON.parse(dataStr) : dataStr;
        if (data && data.apiKey) {
            state.llmConfig.apiKey = data.apiKey;
            state.llmConfig.model = data.model || state.llmConfig.model;
            state.llmConfig.maxTokens = data.maxTokens || state.llmConfig.maxTokens;
        }
    } catch (e) { }
};

// =============================================================================
// TREE VIEWER
// =============================================================================

function initializeTreeViewer() {
    var svg = document.getElementById('tree-svg');
    if (!svg) return;
    
    WheelRenderer.init(svg);
    state.treeInitialized = true;
    
    // Zoom controls
    document.getElementById('zoom-in').addEventListener('click', function() {
        WheelRenderer.setZoom(WheelRenderer.zoom + TREE_CONFIG.zoom.step);
    });
    document.getElementById('zoom-out').addEventListener('click', function() {
        WheelRenderer.setZoom(WheelRenderer.zoom - TREE_CONFIG.zoom.step);
    });
    
    // Import buttons
    var importTreeBtn = document.getElementById('import-tree-btn');
    var loadSavedBtn = document.getElementById('load-saved-btn');
    var importBtn = document.getElementById('import-btn');
    var skyrimNetAutoBtn = document.getElementById('skyrimnet-auto-btn');
    var skyrimNetToolbarBtn = document.getElementById('skyrimnet-toolbar-btn');
    
    if (importTreeBtn) importTreeBtn.addEventListener('click', showImportModal);
    if (loadSavedBtn) loadSavedBtn.addEventListener('click', loadSavedTree);
    if (importBtn) importBtn.addEventListener('click', showImportModal);
    if (skyrimNetAutoBtn) skyrimNetAutoBtn.addEventListener('click', startSkyrimNetAutoGenerate);
    if (skyrimNetToolbarBtn) skyrimNetToolbarBtn.addEventListener('click', startSkyrimNetAutoGenerate);
    
    // Save/Reload/Clear tree buttons (cheat mode only)
    var clearTreeBtn = document.getElementById('clear-tree-btn');
    var saveTreeBtn = document.getElementById('save-tree-btn');
    var reloadTreeBtn = document.getElementById('reload-tree-btn');
    
    if (clearTreeBtn) {
        clearTreeBtn.addEventListener('click', function() {
            // Double-click protection: require two clicks within 2 seconds
            if (!state.clearTreePending) {
                state.clearTreePending = true;
                clearTreeBtn.innerHTML = '<span class="btn-icon">⚠️</span> Click Again to Confirm';
                clearTreeBtn.classList.add('btn-warning');
                setTimeout(function() {
                    state.clearTreePending = false;
                    clearTreeBtn.innerHTML = '<span class="btn-icon">🗑️</span> Clear Tree';
                    clearTreeBtn.classList.remove('btn-warning');
                }, 2000);
            } else {
                state.clearTreePending = false;
                clearTreeBtn.innerHTML = '<span class="btn-icon">🗑️</span> Clear Tree';
                clearTreeBtn.classList.remove('btn-warning');
                clearTree();
            }
        });
    }
    
    if (saveTreeBtn) {
        saveTreeBtn.addEventListener('click', function() {
            if (saveTreeToFile()) {
                setTreeStatus('Tree saved to file');
            } else {
                setTreeStatus('No tree data to save');
            }
        });
    }
    
    if (reloadTreeBtn) {
        reloadTreeBtn.addEventListener('click', function() {
            loadSavedTree();
        });
    }
    
    // Check if SkyrimNet is available on init
    checkSkyrimNetAvailability();
    
    // Modal controls
    var modalCloseBtn = document.getElementById('modal-close-btn');
    var importCancel = document.getElementById('import-cancel');
    var importConfirm = document.getElementById('import-confirm');
    var pasteTreeBtn = document.getElementById('paste-tree-btn');
    var modalBackdrop = document.querySelector('.modal-backdrop');
    
    if (modalCloseBtn) modalCloseBtn.addEventListener('click', hideImportModal);
    if (importCancel) importCancel.addEventListener('click', hideImportModal);
    if (pasteTreeBtn) pasteTreeBtn.addEventListener('click', onPasteTreeClick);
    if (importConfirm) importConfirm.addEventListener('click', function() { importTreeFromModal(false); });
    if (modalBackdrop) modalBackdrop.addEventListener('click', hideImportModal);
    
    var importMerge = document.getElementById('import-merge');
    if (importMerge) importMerge.addEventListener('click', function() { importTreeFromModal(true); });
    
    // Details panel
    window.addEventListener('nodeSelected', function(e) { showSpellDetails(e.detail); });
    
    var closeDetails = document.getElementById('close-details');
    if (closeDetails) closeDetails.addEventListener('click', function() {
        document.getElementById('details-panel').classList.add('hidden');
    });
    
    // How-to-Learn panel
    initializeHowToPanel();
    
    // Learn button - set learning target
    var learnBtn = document.getElementById('learn-btn');
    if (learnBtn) learnBtn.addEventListener('click', onLearnClick);
    
    // Unlock button - unlock spell when XP is ready
    var unlockBtn = document.getElementById('unlock-btn');
    if (unlockBtn) unlockBtn.addEventListener('click', onUnlockClick);
    
    // Clickable prereqs/unlocks
    var prereqList = document.getElementById('spell-prereqs');
    var unlocksList = document.getElementById('spell-unlocks');
    
    if (prereqList) prereqList.addEventListener('click', function(e) {
        if (e.target.tagName === 'LI') selectNodeById(e.target.dataset.id);
    });
    if (unlocksList) unlocksList.addEventListener('click', function(e) {
        if (e.target.tagName === 'LI') selectNodeById(e.target.dataset.id);
    });
}

function showImportModal() {
    var modal = document.getElementById('import-modal');
    if (modal) modal.classList.remove('hidden');
    var errorBox = document.getElementById('import-error');
    if (errorBox) errorBox.classList.add('hidden');
}

function hideImportModal() {
    var modal = document.getElementById('import-modal');
    if (modal) modal.classList.add('hidden');
}

function loadSavedTree() {
    if (window.callCpp) {
        window.callCpp('LoadSpellTree', '');
        setTreeStatus('Loading saved tree...');
    } else {
        setTreeStatus('No saved tree available');
    }
}

function importTreeFromModal(mergeMode) {
    var textarea = document.getElementById('import-textarea');
    var text = textarea ? textarea.value.trim() : '';
    if (!text) {
        showImportError('Please paste JSON');
        return;
    }
    try {
        var data = JSON.parse(text);
        
        if (mergeMode && state.treeData && state.treeData.success) {
            // Merge with existing tree
            data = mergeTreeData(state.treeData.rawData, data);
            loadTreeData(data);
            hideImportModal();
            setTreeStatus('Tree merged - added new spells');
        } else {
            // Replace mode
            loadTreeData(data);
            hideImportModal();
            setTreeStatus('Tree imported');
        }
        
        // Save merged/imported tree to file
        if (window.callCpp) {
            window.callCpp('SaveSpellTree', JSON.stringify(data));
        }
    } catch (e) {
        showImportError('Invalid JSON: ' + e.message);
    }
}

function mergeTreeData(existing, newData) {
    // Create a deep copy of existing data
    var merged = JSON.parse(JSON.stringify(existing));
    
    if (!merged.schools) merged.schools = {};
    
    // Merge each school from new data
    for (var schoolName in newData.schools) {
        var newSchool = newData.schools[schoolName];
        
        if (!merged.schools[schoolName]) {
            // School doesn't exist, add it entirely
            merged.schools[schoolName] = newSchool;
            console.log('[Merge] Added new school: ' + schoolName + ' (layout: ' + (newSchool.layoutStyle || 'radial') + ')');
        } else {
            // School exists, merge nodes
            var existingSchool = merged.schools[schoolName];
            
            // Update layoutStyle if new data provides one
            if (newSchool.layoutStyle && !existingSchool.layoutStyle) {
                existingSchool.layoutStyle = newSchool.layoutStyle;
                console.log('[Merge] Updated ' + schoolName + ' layout style: ' + newSchool.layoutStyle);
            }
            var existingNodeIds = new Set(existingSchool.nodes.map(function(n) { return n.formId || n.spellId; }));
            
            var addedCount = 0;
            newSchool.nodes.forEach(function(newNode) {
                var nodeId = newNode.formId || newNode.spellId;
                if (!existingNodeIds.has(nodeId)) {
                    existingSchool.nodes.push(newNode);
                    addedCount++;
                } else {
                    // Node exists - update children/prerequisites if new ones exist
                    var existingNode = existingSchool.nodes.find(function(n) { 
                        return (n.formId || n.spellId) === nodeId; 
                    });
                    if (existingNode && newNode.children) {
                        newNode.children.forEach(function(childId) {
                            if (!existingNode.children) existingNode.children = [];
                            if (existingNode.children.indexOf(childId) === -1) {
                                existingNode.children.push(childId);
                            }
                        });
                    }
                    if (existingNode && newNode.prerequisites) {
                        newNode.prerequisites.forEach(function(prereqId) {
                            if (!existingNode.prerequisites) existingNode.prerequisites = [];
                            if (existingNode.prerequisites.indexOf(prereqId) === -1) {
                                existingNode.prerequisites.push(prereqId);
                            }
                        });
                    }
                }
            });
            console.log('[Merge] ' + schoolName + ': added ' + addedCount + ' new nodes');
        }
    }
    
    // Update timestamp
    merged.generatedAt = new Date().toISOString();
    merged.version = merged.version || '1.0';
    
    return merged;
}

function showImportError(msg) {
    var errorBox = document.getElementById('import-error');
    if (errorBox) {
        errorBox.textContent = msg;
        errorBox.classList.remove('hidden');
    }
}

function loadTreeData(jsonData, switchToTreeTab) {
    var result = TreeParser.parse(jsonData);
    if (!result.success) {
        showImportError(result.error);
        return;
    }

    // Store raw data for future merges
    result.rawData = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
    state.treeData = result;
    
    // Clean up self-references in prerequisites (LLM sometimes generates these incorrectly)
    var selfRefCount = 0;
    result.nodes.forEach(function(node) {
        if (node.prerequisites && node.prerequisites.length > 0) {
            var originalLen = node.prerequisites.length;
            node.prerequisites = node.prerequisites.filter(function(prereqId) {
                // Remove if prereq is this node itself
                return prereqId !== node.id && prereqId !== node.formId;
            });
            if (node.prerequisites.length < originalLen) {
                selfRefCount++;
                console.warn('[SpellLearning] Removed self-reference prerequisite from ' + (node.name || node.id));
            }
        }
    });
    if (selfRefCount > 0) {
        console.log('[SpellLearning] Fixed ' + selfRefCount + ' nodes with self-referencing prerequisites');
    }
    
    // IMPORTANT: Reset all node states to locked/available on load
    // Don't use saved states from file - those are stale
    // States will be updated after player loads into a save game
    
    // Get root nodes for each school
    var rootIds = new Set();
    for (var schoolName in result.schools) {
        var schoolData = result.schools[schoolName];
        if (schoolData.root) {
            rootIds.add(schoolData.root);
        }
    }
    
    result.nodes.forEach(function(node) {
        // Root nodes are always unlocked (they're the starting points)
        if (rootIds.has(node.id) || rootIds.has(node.formId)) {
            node.state = 'unlocked';
            console.log('[SpellLearning] Root node marked unlocked: ' + (node.name || node.id));
        }
        // Nodes with no prerequisites are available
        else if (!node.prerequisites || node.prerequisites.length === 0) {
            node.state = 'available';
        }
        // Everything else starts locked
        else {
            node.state = 'locked';
        }
    });
    
    // Mark children of root nodes as available
    result.nodes.forEach(function(node) {
        if (node.state === 'unlocked' && node.children) {
            node.children.forEach(function(childId) {
                var childNode = result.nodes.find(function(n) { return n.id === childId || n.formId === childId; });
                if (childNode && childNode.state === 'locked') {
                    childNode.state = 'available';
                }
            });
        }
    });
    
    var stateCount = { unlocked: 0, available: 0, locked: 0 };
    result.nodes.forEach(function(n) { stateCount[n.state] = (stateCount[n.state] || 0) + 1; });
    console.log('[SpellLearning] Tree loaded - states: unlocked=' + stateCount.unlocked + 
                ', available=' + stateCount.available + ', locked=' + stateCount.locked);
    
    // Request spell data for all formIds
    SpellCache.requestBatch(result.allFormIds, function() {
        result.nodes.forEach(function(node) {
            TreeParser.updateNodeFromCache(node);
        });
        WheelRenderer.setData(result.nodes, result.edges, result.schools);
        setTreeStatus('Loaded ' + result.nodes.length + ' spells');
    });

    // Initial render
    WheelRenderer.setData(result.nodes, result.edges, result.schools);
    
    var emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.classList.add('hidden');
    
    // Show tree action buttons if cheat mode is on
    updateTreeActionsVisibility();
    
    document.getElementById('total-count').textContent = result.nodes.length;
    document.getElementById('unlocked-count').textContent = '0';  // Always 0 on load - will be updated after save loads
    
    // Switch to Spell Tree tab if requested (e.g., on startup with saved tree)
    if (switchToTreeTab !== false) {
        switchTab('spellTree');
        console.log('[SpellLearning] Tree loaded - switched to Spell Tree tab');
    }
    
    // After tree is loaded, sync with player's known spells and progression data
    if (window.callCpp) {
        console.log('[SpellLearning] Tree loaded - syncing progress and player known spells...');
        window.callCpp('GetProgress', '');  // Reload progress data
        window.callCpp('GetPlayerKnownSpells', '');  // Sync known spells
    }
}

function showSpellDetails(node) {
    var panel = document.getElementById('details-panel');
    if (!panel) return;
    panel.classList.remove('hidden');

    // Get progress data for progressive reveal
    var progress = state.spellProgress[node.formId] || { xp: 0, required: 100, progress: 0 };
    var progressPercent = (progress.progress || 0) * 100;  // progress is 0.0-1.0
    
    // Calculate XP required based on tier
    var tierXP = getXPForTier(node.level);
    
    // Determine what to show based on state and progress
    // Cheat mode shows ALL info (includes former debug mode features)
    var showFullInfo = node.state === 'unlocked' || settings.cheatMode;
    var showName = showFullInfo || progressPercent >= settings.revealName;
    var showEffects = showFullInfo || progressPercent >= settings.revealEffects;
    var showDescription = showFullInfo || progressPercent >= settings.revealDescription;
    var showLevelAndCost = node.state !== 'locked' || settings.cheatMode;  // Always show for available
    
    // School badge always visible
    document.getElementById('spell-school').textContent = node.school;
    document.getElementById('spell-school').className = 'school-badge ' + node.school.toLowerCase();

    // Name - progressive reveal (cheat mode shows all)
    if (showName) {
        var nameDisplay = node.name || node.formId;
        if (settings.cheatMode && node.state === 'locked') {
            nameDisplay = (node.name || 'Unknown') + ' [LOCKED]';
        }
        document.getElementById('spell-name').textContent = nameDisplay;
    } else {
        document.getElementById('spell-name').textContent = '???';
    }
    
    // Level and cost - show for available (learning) and unlocked
    if (showLevelAndCost) {
        document.getElementById('spell-level').textContent = node.level || '?';
        document.getElementById('spell-cost').textContent = node.cost || '?';
        document.getElementById('spell-type').textContent = node.type || '?';
    } else {
        document.getElementById('spell-level').textContent = '???';
        document.getElementById('spell-cost').textContent = '???';
        document.getElementById('spell-type').textContent = '???';
    }
    
    // Effects - progressive reveal
    var effectsList = document.getElementById('spell-effects');
    effectsList.innerHTML = '';
    if (showEffects) {
        var effects = Array.isArray(node.effects) ? node.effects : [];
        if (effects.length === 0) {
            effectsList.innerHTML = '<li>No effects</li>';
        } else {
            effects.forEach(function(e) {
                var li = document.createElement('li');
                li.textContent = typeof e === 'string' ? e : (e.name || JSON.stringify(e));
                effectsList.appendChild(li);
            });
        }
    } else {
        effectsList.innerHTML = '<li class="hidden-info">??? (' + settings.revealEffects + '% to reveal)</li>';
    }
    
    // Description - progressive reveal
    if (showDescription) {
        document.getElementById('spell-description').textContent = node.desc || 'No description.';
    } else if (node.state === 'locked') {
        document.getElementById('spell-description').textContent = 'Unlock prerequisites to reveal.';
    } else {
        document.getElementById('spell-description').textContent = 'Progress to ' + settings.revealDescription + '% to reveal description...';
    }

    var prereqList = document.getElementById('spell-prereqs');
    prereqList.innerHTML = '';
    node.prerequisites.forEach(function(id) {
        var n = state.treeData ? state.treeData.nodes.find(function(x) { return x.id === id; }) : null;
        var li = document.createElement('li');
        // Cheat mode shows all names
        var showPrereqName = settings.cheatMode || (n && n.state !== 'locked');
        li.textContent = showPrereqName ? (n ? (n.name || n.formId) : id) : '???';
        li.dataset.id = id;
        prereqList.appendChild(li);
    });

    var unlocksList = document.getElementById('spell-unlocks');
    unlocksList.innerHTML = '';
    node.children.forEach(function(id) {
        var n = state.treeData ? state.treeData.nodes.find(function(x) { return x.id === id; }) : null;
        var li = document.createElement('li');
        // Cheat mode shows all names
        var showChildName = settings.cheatMode || (n && n.state !== 'locked');
        li.textContent = showChildName ? (n ? (n.name || n.formId) : id) : '???';
        li.dataset.id = id;
        unlocksList.appendChild(li);
    });

    var stateBadge = document.getElementById('spell-state');
    stateBadge.textContent = node.state.charAt(0).toUpperCase() + node.state.slice(1);
    stateBadge.className = 'state-badge ' + node.state;

    // Store selected node for button handlers
    state.selectedNode = node;
    
    // Update progression UI
    updateDetailsProgression(node);
}

function updateDetailsProgression(node) {
    var progressSection = document.getElementById('progress-section');
    var learnBtn = document.getElementById('learn-btn');
    var unlockBtn = document.getElementById('unlock-btn');
    var progressBar = document.getElementById('progress-bar');
    var progressText = document.getElementById('progress-text');
    var progressEdit = document.getElementById('progress-edit');
    var xpCurrentInput = document.getElementById('xp-current-input');
    var xpRequiredInput = document.getElementById('xp-required-input');
    
    // Get progress data for this spell
    var progress = state.spellProgress[node.formId] || { xp: 0, required: 100, unlocked: false, ready: false };
    var isLearningTarget = state.learningTargets[node.school] === node.formId;
    
    // Update learning status badge
    updateLearningStatusBadge(node, progress);
    
    // Calculate required XP - use override if exists, otherwise tier-based
    var tierXP = getXPForTier(node.level);
    var requiredXP = xpOverrides[node.formId] !== undefined ? xpOverrides[node.formId] : tierXP;
    progress.required = requiredXP;
    
    // Hide all buttons by default
    learnBtn.classList.add('hidden');
    unlockBtn.classList.add('hidden');
    progressSection.classList.add('hidden');
    progressText.classList.remove('hidden');
    if (progressEdit) progressEdit.classList.add('hidden');
    
    // CHEAT MODE: Allow unlocking/relocking any node + editable XP
    if (settings.cheatMode) {
        progressSection.classList.remove('hidden');
        unlockBtn.classList.remove('hidden');
        unlockBtn.disabled = false;
        
        // Show editable XP inputs instead of text
        progressText.classList.add('hidden');
        if (progressEdit) {
            progressEdit.classList.remove('hidden');
            if (xpCurrentInput) {
                xpCurrentInput.value = Math.floor(progress.xp || 0);
                // Remove old listeners to avoid duplicates
                xpCurrentInput.onchange = function() {
                    var newXP = Math.max(0, parseInt(this.value) || 0);
                    this.value = newXP;
                    progress.xp = newXP;
                    state.spellProgress[node.formId] = progress;
                    // Update progress bar
                    var percent = requiredXP > 0 ? (newXP / requiredXP) * 100 : 0;
                    progressBar.style.width = Math.min(percent, 100) + '%';
                    progressBar.classList.toggle('ready', newXP >= requiredXP);
                    // Tell C++ about the XP change
                    if (window.callCpp) {
                        window.callCpp('SetSpellXP', JSON.stringify({ formId: node.formId, xp: newXP }));
                    }
                };
            }
            if (xpRequiredInput) {
                xpRequiredInput.value = Math.floor(requiredXP);
                // Show if this is an override
                var hasOverride = xpOverrides[node.formId] !== undefined;
                xpRequiredInput.classList.toggle('has-override', hasOverride);
                xpRequiredInput.title = hasOverride ? 'Custom override (tier default: ' + tierXP + ')' : 'Tier default';
                
                xpRequiredInput.onchange = function() {
                    var newRequired = Math.max(1, parseInt(this.value) || tierXP);
                    this.value = newRequired;
                    // Store as override
                    xpOverrides[node.formId] = newRequired;
                    this.classList.add('has-override');
                    this.title = 'Custom override (tier default: ' + tierXP + ')';
                    progress.required = newRequired;
                    // Update progress bar
                    var percent = newRequired > 0 ? (progress.xp / newRequired) * 100 : 0;
                    progressBar.style.width = Math.min(percent, 100) + '%';
                    progressBar.classList.toggle('ready', progress.xp >= newRequired);
                    // Save overrides
                    autoSaveSettings();
                };
            }
        }
        
        // Update progress bar
        var cheatPercent = requiredXP > 0 ? (progress.xp / requiredXP) * 100 : 0;
        progressBar.style.width = Math.min(cheatPercent, 100) + '%';
        
        if (node.state === 'unlocked' || progress.unlocked) {
            // Already unlocked - show relock option
            unlockBtn.textContent = 'Relock Spell';
            unlockBtn.style.background = '#ef4444';  // Red for relock
            progressBar.classList.add('ready');
        } else {
            // Not unlocked - show unlock option
            unlockBtn.textContent = 'Unlock (Cheat)';
            unlockBtn.style.background = '';  // Default color
            progressBar.classList.toggle('ready', progress.xp >= requiredXP);
        }
        return;
    }
    
    // NORMAL MODE
    if (node.state === 'locked') {
        // Locked - can't do anything
        return;
    }
    
    if (node.state === 'unlocked' || progress.unlocked) {
        // Already unlocked - nothing to show
        return;
    }
    
    // Node is available - show progression options
    progressSection.classList.remove('hidden');
    
    // Update progress bar
    var percent = progress.required > 0 ? (progress.xp / progress.required) * 100 : 0;
    progressBar.style.width = Math.min(percent, 100) + '%';
    progressText.textContent = Math.floor(progress.xp) + ' / ' + Math.floor(progress.required) + ' XP';
    
    if (progress.ready || progress.xp >= progress.required) {
        // Ready to unlock - show unlock button
        progressBar.classList.add('ready');
        unlockBtn.classList.remove('hidden');
        unlockBtn.disabled = false;
        unlockBtn.textContent = 'Unlock Spell';
        unlockBtn.style.background = '';  // Default color
        learnBtn.classList.add('hidden');
    } else {
        // Not ready - show learn button
        progressBar.classList.remove('ready');
        learnBtn.classList.remove('hidden');
        
        if (isLearningTarget) {
            learnBtn.textContent = 'Learning...';
            learnBtn.classList.add('active');
        } else {
            learnBtn.textContent = 'Learn This';
            learnBtn.classList.remove('active');
        }
    }
}

function selectNodeById(id) {
    if (!state.treeData) return;
    var node = state.treeData.nodes.find(function(n) { return n.id === id; });
    if (node) {
        WheelRenderer.selectNode(node);
        WheelRenderer.rotateSchoolToTop(node.school);
    }
}

// =============================================================================
// HOW-TO-LEARN PANEL
// =============================================================================

function initializeHowToPanel() {
    var panel = document.getElementById('howto-panel');
    var tab = document.getElementById('howto-tab');
    var closeBtn = document.getElementById('close-howto');
    
    if (!panel || !tab) return;
    
    // Panel starts hidden - it's inside contentSpellTree which is already shown/hidden by tab switching
    // Only remove hidden when user is on the tree tab (which they are if this runs from initializeTreeViewer)
    // The panel will be visible via its parent container
    panel.classList.remove('hidden');
    panel.classList.remove('open'); // Make sure it starts collapsed (only tab showing)
    
    // Toggle panel on tab click
    tab.addEventListener('click', function() {
        panel.classList.toggle('open');
        if (panel.classList.contains('open')) {
            updateHowToContent();
        }
    });
    
    // Close button
    if (closeBtn) {
        closeBtn.addEventListener('click', function() {
            panel.classList.remove('open');
        });
    }
    
    // Initial content update
    updateHowToContent();
}

function updateHowToContent() {
    var settingsList = document.getElementById('howto-settings-list');
    var xpList = document.getElementById('howto-xp-list');
    var tipsList = document.getElementById('howto-tips-list');
    
    // Settings list - reflects current earlySpellLearning settings
    if (settingsList) {
        var el = settings.earlySpellLearning;
        var settingsItems = [];
        
        if (el.enabled) {
            settingsItems.push('Spells unlock at ' + el.unlockThreshold + '% progress');
            settingsItems.push('Start at ' + el.minEffectiveness + '% power');
            settingsItems.push('Scale up to ' + el.maxEffectiveness + '% before mastery');
            settingsItems.push('At 100% mastery: full power unlocked!');
            settingsItems.push('After ' + el.selfCastRequiredAt + '%, must cast spell itself');
        } else {
            settingsItems.push('Early spell learning is disabled');
            settingsItems.push('Spells unlock at 100% XP');
            settingsItems.push('Click "Unlock Spell" when ready');
        }
        
        settingsList.innerHTML = '';
        settingsItems.forEach(function(text) {
            var li = document.createElement('li');
            li.textContent = text;
            settingsList.appendChild(li);
        });
    }
    
    // XP sources list - reflects multiplier settings
    if (xpList) {
        var xpItems = [];
        
        xpItems.push('Direct prerequisite: ' + settings.xpMultiplierDirect + '% XP');
        xpItems.push('Same school spell: ' + settings.xpMultiplierSchool + '% XP');
        xpItems.push('Any spell: ' + settings.xpMultiplierAny + '% XP');
        
        if (settings.islEnabled && settings.islDetected) {
            xpItems.push({
                text: 'ISL study: ' + settings.islXpPerHour + ' XP/hour',
                className: 'isl-active'
            });
            if (settings.islTomeBonus > 0) {
                xpItems.push({
                    text: 'Own spell tome: +' + settings.islTomeBonus + '% bonus',
                    className: 'isl-active'
                });
            }
        }
        
        xpList.innerHTML = '';
        xpItems.forEach(function(item) {
            var li = document.createElement('li');
            if (typeof item === 'string') {
                li.textContent = item;
            } else {
                li.textContent = item.text;
                if (item.className) li.classList.add(item.className);
            }
            xpList.appendChild(li);
        });
    }
    
    // Tips list - always same
    if (tipsList) {
        var tipsItems = [
            'Set learning targets (one per school)',
            'Combat usage grants more XP than practice',
            'Higher tier spells take longer to master'
        ];
        
        if (settings.earlySpellLearning.enabled) {
            tipsItems.push('Practice with weakened spells to gain XP');
            tipsItems.push('The jump from ' + settings.earlySpellLearning.maxEffectiveness + '% to 100% feels amazing!');
        }
        
        tipsList.innerHTML = '';
        tipsItems.forEach(function(text) {
            var li = document.createElement('li');
            li.textContent = text;
            tipsList.appendChild(li);
        });
    }
}

// =============================================================================
// LEARNING STATUS BADGE
// =============================================================================

function updateLearningStatusBadge(node, progress) {
    var badge = document.getElementById('learning-status-badge');
    var effectiveness = document.getElementById('learning-effectiveness');
    var hint = document.getElementById('learning-status-hint');
    
    if (!badge) return;
    
    var el = settings.earlySpellLearning;
    var progressPercent = (progress.progress || 0) * 100;  // progress.progress is 0.0-1.0
    
    // Determine learning stage
    var stage, hintText, effectivenessPercent, effectivenessClass;
    
    if (node.state === 'unlocked' || progress.unlocked || progressPercent >= 100) {
        // MASTERED - 100% complete
        stage = 'mastered';
        hintText = 'Full mastery achieved! Spell at 100% power.';
        effectivenessPercent = 100;
        effectivenessClass = 'full';
    } else if (node.state === 'locked') {
        // LOCKED - Prerequisites not met
        stage = 'locked';
        hintText = 'Complete prerequisites first to begin learning.';
        effectivenessPercent = null;
        effectivenessClass = '';
    } else if (!el.enabled) {
        // Early learning disabled - simple available/locked display
        if (progressPercent > 0) {
            stage = 'studying';
            hintText = 'Cast prerequisite spells to gain XP.';
            effectivenessPercent = null;
            effectivenessClass = '';
        } else {
            stage = 'locked';
            hintText = 'Set as learning target to begin.';
            effectivenessPercent = null;
            effectivenessClass = '';
        }
    } else if (progressPercent < el.unlockThreshold) {
        // STUDYING - 0% to unlock threshold
        stage = 'studying';
        hintText = 'Cast prerequisite spells to unlock this spell at ' + el.unlockThreshold + '%.';
        effectivenessPercent = null;
        effectivenessClass = '';
    } else if (progressPercent < el.selfCastRequiredAt) {
        // WEAKENED - unlock threshold to selfCastRequiredAt
        stage = 'weakened';
        effectivenessPercent = calculateCurrentEffectiveness(progressPercent, el);
        effectivenessClass = 'weak';
        hintText = 'Spell obtained! ' + Math.round(effectivenessPercent) + '% power. Cast prerequisites to improve.';
    } else if (progressPercent < 100) {
        // PRACTICING - selfCastRequiredAt to 99%
        stage = 'practicing';
        effectivenessPercent = calculateCurrentEffectiveness(progressPercent, el);
        effectivenessClass = 'medium';
        hintText = 'Cast this spell directly to reach mastery! At 100%: full power jump!';
    } else {
        // Should not reach here, but fallback
        stage = 'studying';
        hintText = '';
        effectivenessPercent = null;
        effectivenessClass = '';
    }
    
    // Update badge
    badge.textContent = stage.toUpperCase();
    badge.className = 'learning-status-badge ' + stage;
    
    // Update effectiveness display
    if (effectiveness) {
        if (effectivenessPercent !== null) {
            effectiveness.textContent = Math.round(effectivenessPercent) + '% Power';
            effectiveness.className = 'learning-effectiveness ' + effectivenessClass;
        } else {
            effectiveness.textContent = '';
            effectiveness.className = 'learning-effectiveness';
        }
    }
    
    // Update hint
    if (hint) {
        hint.textContent = hintText;
    }
}

function calculateCurrentEffectiveness(progressPercent, el) {
    // Formula: min + (progress - unlock) / (100 - unlock) * (max - min)
    var unlockThreshold = el.unlockThreshold;
    var minEff = el.minEffectiveness;
    var maxEff = el.maxEffectiveness;
    
    if (progressPercent >= 100) {
        return 100;  // Mastered = full power
    }
    
    if (progressPercent <= unlockThreshold) {
        return minEff;
    }
    
    var range = 100 - unlockThreshold;
    var progressInRange = progressPercent - unlockThreshold;
    var t = progressInRange / range;
    
    // Clamp t
    t = Math.max(0, Math.min(1, t));
    
    return minEff + t * (maxEff - minEff);
}

// Get XP required for a spell tier
function getXPForTier(level) {
    if (!level) return settings.xpNovice;
    var levelLower = level.toLowerCase();
    switch (levelLower) {
        case 'novice': return settings.xpNovice;
        case 'apprentice': return settings.xpApprentice;
        case 'adept': return settings.xpAdept;
        case 'expert': return settings.xpExpert;
        case 'master': return settings.xpMaster;
        default: return settings.xpNovice;
    }
}

function setTreeStatus(msg) {
    var el = document.getElementById('tree-status-text');
    if (el) el.textContent = msg;
}

// =============================================================================
// PROGRESSION SYSTEM
// =============================================================================

function onLearnClick() {
    if (!state.selectedNode) return;
    
    var node = state.selectedNode;
    var isCurrentTarget = state.learningTargets[node.school] === node.formId;
    
    if (isCurrentTarget) {
        // Clear the target
        if (window.callCpp) {
            window.callCpp('ClearLearningTarget', JSON.stringify({ school: node.school }));
        }
        delete state.learningTargets[node.school];
        setTreeStatus('Stopped learning ' + (node.name || node.formId));
    } else {
        // In "single" mode, clear ALL other learning targets first
        if (settings.learningMode === 'single') {
            for (var school in state.learningTargets) {
                if (state.learningTargets[school]) {
                    if (window.callCpp) {
                        window.callCpp('ClearLearningTarget', JSON.stringify({ school: school }));
                    }
                    console.log('[SpellLearning] Single mode: cleared learning target in ' + school);
                }
            }
            // Clear all local targets
            state.learningTargets = {};
        }
        
        // Set as learning target
        if (window.callCpp) {
            window.callCpp('SetLearningTarget', JSON.stringify({ 
                school: node.school, 
                formId: node.formId 
            }));
        }
        state.learningTargets[node.school] = node.formId;
        setTreeStatus('Now learning: ' + (node.name || node.formId));
    }
    
    updateDetailsProgression(node);
    WheelRenderer.updateNodeStates();
}

function onUnlockClick() {
    if (!state.selectedNode) return;
    
    var node = state.selectedNode;
    var progress = state.spellProgress[node.formId] || { xp: 0, required: 100, unlocked: false };
    
    // CHEAT MODE: Allow unlocking/relocking any node
    if (settings.cheatMode) {
        if (node.state === 'unlocked' || progress.unlocked) {
            // Relock the spell (remove from player)
            if (window.callCpp) {
                window.callCpp('RelockSpell', JSON.stringify({ formId: node.formId }));
                setTreeStatus('Relocking ' + (node.name || node.formId) + '...');
            }
            
            // Update local state immediately for responsiveness
            if (state.spellProgress[node.formId]) {
                state.spellProgress[node.formId].unlocked = false;
                state.spellProgress[node.formId].xp = 0;
            }
            node.state = 'available';
            
            // Update UI
            WheelRenderer.updateNodeStates();
            updateDetailsProgression(node);
            
            // Update the state badge
            var stateBadge = document.getElementById('spell-state');
            if (stateBadge) {
                stateBadge.textContent = 'Available';
                stateBadge.className = 'state-badge available';
            }
        } else {
            // Unlock the spell (cheat - bypass XP)
            if (window.callCpp) {
                window.callCpp('CheatUnlockSpell', JSON.stringify({ formId: node.formId }));
                setTreeStatus('Cheat unlocking ' + (node.name || node.formId) + '...');
            }
            
            // Update local state immediately for responsiveness
            state.spellProgress[node.formId] = {
                xp: 100,
                required: 100,
                unlocked: true,
                ready: true
            };
            node.state = 'unlocked';
            
            // Update UI
            WheelRenderer.updateNodeStates();
            updateDetailsProgression(node);
            
            // Update the state badge
            var stateBadge = document.getElementById('spell-state');
            if (stateBadge) {
                stateBadge.textContent = 'Unlocked';
                stateBadge.className = 'state-badge unlocked';
            }
        }
        
        // Update unlocked count
        if (state.treeData) {
            document.getElementById('unlocked-count').textContent = 
                state.treeData.nodes.filter(function(n) { return n.state === 'unlocked'; }).length;
        }
        return;
    }
    
    // NORMAL MODE: Require XP
    if (!progress || progress.xp < progress.required) {
        setTreeStatus('Not enough XP to unlock');
        return;
    }
    
    if (window.callCpp) {
        window.callCpp('UnlockSpell', JSON.stringify({ formId: node.formId }));
        setTreeStatus('Unlocking ' + (node.name || node.formId) + '...');
    }
}

// C++ Callbacks for progression
window.onProgressUpdate = function(dataStr) {
    console.log('[SpellLearning] Progress update received:', dataStr);
    try {
        var data = typeof dataStr === 'string' ? JSON.parse(dataStr) : dataStr;
        console.log('[SpellLearning] Parsed progress data:', JSON.stringify(data));
        
        // Store progress data
        state.spellProgress[data.formId] = {
            xp: data.currentXP,
            required: data.requiredXP,
            unlocked: false,
            ready: data.ready
        };
        console.log('[SpellLearning] Stored progress for ' + data.formId + ': XP=' + data.currentXP + '/' + data.requiredXP);
        
        // Update details panel if this is the selected node
        if (state.selectedNode && state.selectedNode.formId === data.formId) {
            console.log('[SpellLearning] Updating details panel for selected node');
            updateDetailsProgression(state.selectedNode);
        }
        
        // Update node visual if visible
        if (state.treeData) {
            console.log('[SpellLearning] Updating node states in tree');
            WheelRenderer.updateNodeStates();
        }
        
    } catch (e) {
        console.error('[SpellLearning] Failed to parse progress update:', e);
    }
};

window.onSpellReady = function(dataStr) {
    console.log('[SpellLearning] Spell ready to unlock:', dataStr);
    try {
        var data = typeof dataStr === 'string' ? JSON.parse(dataStr) : dataStr;
        if (state.spellProgress[data.formId]) {
            state.spellProgress[data.formId].ready = true;
        }
        
        // Get spell name
        var node = state.treeData ? state.treeData.nodes.find(function(n) { return n.formId === data.formId; }) : null;
        var name = node ? (node.name || node.formId) : data.formId;
        
        setTreeStatus(name + ' is ready to unlock!');
        
        // Update details panel
        if (state.selectedNode && state.selectedNode.formId === data.formId) {
            updateDetailsProgression(state.selectedNode);
        }
        
    } catch (e) {
        console.error('[SpellLearning] Failed to parse spell ready:', e);
    }
};

window.onSpellUnlocked = function(dataStr) {
    console.log('[SpellLearning] Spell unlocked:', dataStr);
    try {
        var data = typeof dataStr === 'string' ? JSON.parse(dataStr) : dataStr;
        
        if (data.success) {
            if (state.spellProgress[data.formId]) {
                state.spellProgress[data.formId].unlocked = true;
            }
            
            // Update node state in tree data
            if (state.treeData) {
                var node = state.treeData.nodes.find(function(n) { return n.formId === data.formId; });
                if (node) {
                    node.state = 'unlocked';
                    setTreeStatus('Learned: ' + (node.name || node.formId) + '!');
                    
                    // Recalculate availability - children of unlocked nodes become available
                    recalculateNodeAvailability();
                }
            }
            
            // Clear learning target
            for (var school in state.learningTargets) {
                if (state.learningTargets[school] === data.formId) {
                    delete state.learningTargets[school];
                    break;
                }
            }
            
            // Refresh display - full re-render needed in discovery mode to show new nodes
            if (settings.discoveryMode) {
                // Full re-render to show newly visible nodes and hide old mystery nodes
                WheelRenderer.render();
            } else {
                WheelRenderer.updateNodeStates();
            }
            
            if (state.selectedNode && state.selectedNode.formId === data.formId) {
                state.selectedNode.state = 'unlocked';
                showSpellDetails(state.selectedNode);
            }
            
            // Update unlocked count
            document.getElementById('unlocked-count').textContent = 
                state.treeData.nodes.filter(function(n) { return n.state === 'unlocked'; }).length;
        } else {
            setTreeStatus('Failed to unlock spell');
        }
        
    } catch (e) {
        console.error('[SpellLearning] Failed to parse unlock result:', e);
    }
};

window.onLearningTargetSet = function(dataStr) {
    console.log('[SpellLearning] Learning target set:', dataStr);
    try {
        var data = typeof dataStr === 'string' ? JSON.parse(dataStr) : dataStr;
        if (data.success) {
            state.learningTargets[data.school] = data.formId;
        }
    } catch (e) {
        console.error('[SpellLearning] Failed to parse learning target:', e);
    }
};

window.onProgressData = function(dataStr) {
    console.log('[SpellLearning] Progress data received:', dataStr);
    try {
        var data = typeof dataStr === 'string' ? JSON.parse(dataStr) : dataStr;
        
        // Load learning targets
        if (data.learningTargets) {
            state.learningTargets = data.learningTargets;
            console.log('[SpellLearning] Loaded learning targets:', JSON.stringify(state.learningTargets));
        }
        
        // Load spell progress
        if (data.spellProgress) {
            state.spellProgress = data.spellProgress;
            var count = Object.keys(state.spellProgress).length;
            console.log('[SpellLearning] Loaded progress for ' + count + ' spells');
            
            // Log a few examples
            var keys = Object.keys(state.spellProgress).slice(0, 3);
            keys.forEach(function(k) {
                var p = state.spellProgress[k];
                console.log('[SpellLearning]   ' + k + ': ' + p.xp + '/' + p.required + ' XP');
            });
        }
        
        // Update display
        if (state.treeData) {
            WheelRenderer.updateNodeStates();
        }
        
        // Update details panel if a node is selected
        if (state.selectedNode) {
            updateDetailsProgression(state.selectedNode);
        }
        
    } catch (e) {
        console.error('[SpellLearning] Failed to parse progress data:', e);
    }
};

// =============================================================================
// PROMPT EDITOR
// =============================================================================

function initializePromptEditor() {
    var promptArea = document.getElementById('promptArea');
    var resetBtn = document.getElementById('resetPromptBtn');
    var saveBtn = document.getElementById('savePromptBtn');
    
    promptArea.value = DEFAULT_TREE_RULES;
    
    if (window.callCpp) {
        window.callCpp('LoadPrompt', '');
    }
    
    promptArea.addEventListener('input', function() {
        state.promptModified = (promptArea.value !== state.originalPrompt);
        updatePromptStatus();
    });
    
    resetBtn.addEventListener('click', function() {
        if (confirm('Reset tree rules to default? Your changes will be lost.')) {
            promptArea.value = DEFAULT_TREE_RULES;
            state.promptModified = true;
            updatePromptStatus();
        }
    });
    
    saveBtn.addEventListener('click', onSavePromptClick);
}

function onSavePromptClick() {
    var content = document.getElementById('promptArea').value;
    
    if (window.callCpp) {
        window.callCpp('SavePrompt', content);
    } else {
        console.warn('[SpellLearning] C++ bridge not ready');
        setPromptStatus('Cannot save', 'error');
    }
}

function updatePromptStatus() {
    if (state.promptModified) {
        setPromptStatus('Modified', 'modified');
    } else {
        setPromptStatus('Saved', '');
    }
}

function setPromptStatus(text, className) {
    var statusEl = document.getElementById('promptStatus');
    statusEl.textContent = text;
    statusEl.className = 'prompt-status';
    if (className) {
        statusEl.classList.add(className);
    }
}

function getTreeRulesPrompt() {
    return document.getElementById('promptArea').value;
}

// =============================================================================
// SETTINGS
// =============================================================================

function toggleSettings() {
    state.isSettingsOpen = !state.isSettingsOpen;
    var panel = document.getElementById('settingsPanel');
    panel.classList.toggle('hidden', !state.isSettingsOpen);
    
    var btn = document.getElementById('settingsBtn');
    btn.classList.toggle('active', state.isSettingsOpen);
}

// =============================================================================
// LLM API SETTINGS
// =============================================================================

function loadApiSettings() {
    // Now handled by unified config loading
    console.log('[SpellLearning] API settings are loaded via unified config');
}

// Keep for backwards compatibility, but now handled by onUnifiedConfigLoaded
window.onLLMConfigLoaded = function(configStr) {
    console.log('[SpellLearning] LLM config loaded (legacy):', configStr);
    
    var config;
    try {
        config = typeof configStr === 'string' ? JSON.parse(configStr) : configStr;
    } catch (e) {
        console.error('[SpellLearning] Failed to parse LLM config:', e);
        return;
    }
    
    // Store in state
    state.llmConfig = config;
    
    // Update UI
    var apiKeyInput = document.getElementById('apiKeyInput');
    var modelSelect = document.getElementById('modelSelect');
    
    if (apiKeyInput && config.apiKey) {
        // Show masked version (first 8 + last 4 chars)
        var key = config.apiKey;
        if (key.length > 12) {
            apiKeyInput.value = key.substring(0, 8) + '...' + key.substring(key.length - 4);
            apiKeyInput.dataset.hasKey = 'true';
        } else {
            apiKeyInput.value = '';
            apiKeyInput.dataset.hasKey = 'false';
        }
    }
    
    if (modelSelect && config.model) {
        modelSelect.value = config.model;
    }
    
    console.log('[SpellLearning] API settings loaded, hasKey:', config.apiKey ? 'yes' : 'no');
};

function onSaveApiSettings() {
    var apiKeyInput = document.getElementById('apiKeyInput');
    var modelSelect = document.getElementById('modelSelect');
    var customModelInput = document.getElementById('customModelInput');
    
    var apiKey = apiKeyInput.value.trim();
    var dropdownModel = modelSelect.value;
    var customModel = customModelInput ? customModelInput.value.trim() : '';
    
    // Effective model: custom takes priority
    var effectiveModel = customModel || dropdownModel;
    
    // If the key looks masked (contains ...), don't overwrite unless it's a new key
    if (apiKey.includes('...') && apiKeyInput.dataset.hasKey === 'true') {
        // Just save model change, keep existing key
        apiKey = state.llmConfig.apiKey;  // Use existing key from state
    }
    
    // Update state
    if (apiKey && !apiKey.includes('...')) {
        state.llmConfig.apiKey = apiKey;
    }
    state.llmConfig.model = effectiveModel;
    state.llmConfig.customModel = customModel;  // Store separately for UI
    
    console.log('[SpellLearning] Saving API settings, model:', effectiveModel, 'customModel:', customModel, 'keyLength:', apiKey.length);
    
    // Save via unified config (which also saves to legacy LLM config for compatibility)
    saveUnifiedConfig();
    
    // Also call legacy save for backwards compatibility
    if (window.callCpp) {
        window.callCpp('SaveLLMConfig', JSON.stringify({
            apiKey: apiKey,
            model: effectiveModel,
            updateKeyOnly: apiKey.length > 0
        }));
    }
    
    // Show feedback
    updateStatus('API settings saved');
    setStatusIcon('✓');
}

window.onLLMConfigSaved = function(resultStr) {
    var result;
    try {
        result = typeof resultStr === 'string' ? JSON.parse(resultStr) : resultStr;
    } catch (e) {
        console.error('[SpellLearning] Failed to parse save result:', e);
        return;
    }
    
    if (result.success) {
        updateStatus('API settings saved successfully');
        setStatusIcon('✓');
        // Reload to update masked display
        loadApiSettings();
    } else {
        updateStatus('Failed to save: ' + (result.error || 'Unknown error'));
        setStatusIcon('❌');
    }
};

function toggleApiKeyVisibility() {
    var input = document.getElementById('apiKeyInput');
    if (input.type === 'password') {
        input.type = 'text';
    } else {
        input.type = 'password';
    }
}

function onPasteApiKey() {
    // Use C++ clipboard bridge (navigator.clipboard not available in Ultralight)
    if (window.callCpp) {
        state.pasteTarget = 'apiKeyInput';
        window.callCpp('GetClipboard', '');
        updateStatus('Reading clipboard...');
    } else {
        updateStatus('Clipboard not available');
        setStatusIcon('⚠');
    }
}

function onModelChange() {
    // Clear custom model when dropdown is changed
    var customInput = document.getElementById('customModelInput');
    if (customInput && customInput.value) {
        // User is selecting from dropdown, keep custom model but update visual
        updateModelDisplayState();
    }
    // Auto-save when model changes
    onSaveApiSettings();
}

function onPasteCustomModel() {
    // Use C++ clipboard bridge
    if (window.callCpp) {
        state.pasteTarget = 'customModelInput';
        window.callCpp('GetClipboard', '');
        updateStatus('Reading clipboard...');
    } else {
        updateStatus('Clipboard not available');
        setStatusIcon('⚠');
    }
}

function onClearCustomModel() {
    var customInput = document.getElementById('customModelInput');
    if (customInput) {
        customInput.value = '';
        updateModelDisplayState();
        onSaveApiSettings();
        updateStatus('Custom model cleared - using dropdown selection');
    }
}

function onCustomModelInput() {
    updateModelDisplayState();
    // Debounce save
    clearTimeout(state.customModelSaveTimeout);
    state.customModelSaveTimeout = setTimeout(function() {
        onSaveApiSettings();
    }, 500);
}

function updateModelDisplayState() {
    var customInput = document.getElementById('customModelInput');
    var modelSelect = document.getElementById('modelSelect');
    
    if (customInput && modelSelect) {
        if (customInput.value.trim()) {
            // Custom model is set - dim the dropdown
            modelSelect.style.opacity = '0.5';
            customInput.style.borderColor = 'rgba(129, 140, 248, 0.5)';  // Purple highlight
        } else {
            // No custom model - dropdown is active
            modelSelect.style.opacity = '1';
            customInput.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        }
    }
}

function getEffectiveModel() {
    var customInput = document.getElementById('customModelInput');
    var modelSelect = document.getElementById('modelSelect');
    
    // Custom model takes priority if set
    if (customInput && customInput.value.trim()) {
        return customInput.value.trim();
    }
    
    // Fall back to dropdown
    return modelSelect ? modelSelect.value : 'anthropic/claude-sonnet-4';
}

function applyPreset(preset) {
    if (preset === 'minimal') {
        state.fields = {
            editorId: true, magickaCost: false, minimumSkill: false, castingType: false,
            delivery: false, chargeTime: false, plugin: false, effects: false,
            effectNames: true, keywords: false
        };
    } else if (preset === 'balanced') {
        state.fields = {
            editorId: true, magickaCost: true, minimumSkill: false, castingType: false,
            delivery: false, chargeTime: false, plugin: false, effects: false,
            effectNames: true, keywords: false
        };
    } else if (preset === 'full') {
        state.fields = {
            editorId: true, magickaCost: true, minimumSkill: true, castingType: true,
            delivery: true, chargeTime: true, plugin: true, effects: true,
            effectNames: false, keywords: true
        };
    }
    
    for (var key in state.fields) {
        var checkbox = document.getElementById('field_' + key);
        if (checkbox) checkbox.checked = state.fields[key];
    }
}

// =============================================================================
// DRAGGING & RESIZING
// =============================================================================

function applyWindowPositionAndSize() {
    var panel = document.getElementById('spellPanel');
    if (!panel) return;
    
    // Apply saved size
    if (settings.windowWidth && settings.windowHeight) {
        panel.style.width = settings.windowWidth + 'px';
        panel.style.height = settings.windowHeight + 'px';
        console.log('[SpellLearning] Applied window size:', settings.windowWidth, 'x', settings.windowHeight);
    }
    
    // Apply saved position
    if (settings.windowX !== null && settings.windowY !== null) {
        panel.style.transform = 'none';
        panel.style.left = settings.windowX + 'px';
        panel.style.top = settings.windowY + 'px';
        console.log('[SpellLearning] Applied window position:', settings.windowX, settings.windowY);
    }
}

function initializeDragging() {
    var panel = document.getElementById('spellPanel');
    var header = document.getElementById('panelHeader');
    
    var startX, startY, initialX, initialY;
    
    header.addEventListener('mousedown', function(e) {
        if (e.target.closest('.header-btn')) return;
        
        state.isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        
        var rect = panel.getBoundingClientRect();
        initialX = rect.left;
        initialY = rect.top;
        
        panel.style.transform = 'none';
        panel.style.left = initialX + 'px';
        panel.style.top = initialY + 'px';
        
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', onDragEnd);
    });
    
    function onDrag(e) {
        if (!state.isDragging) return;
        var dx = e.clientX - startX;
        var dy = e.clientY - startY;
        panel.style.left = (initialX + dx) + 'px';
        panel.style.top = (initialY + dy) + 'px';
    }
    
    function onDragEnd() {
        state.isDragging = false;
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup', onDragEnd);
        
        // Save window position
        var rect = panel.getBoundingClientRect();
        settings.windowX = Math.round(rect.left);
        settings.windowY = Math.round(rect.top);
        console.log('[SpellLearning] Window position saved:', settings.windowX, settings.windowY);
        autoSaveSettings();
    }
}

function initializeResizing() {
    var panel = document.getElementById('spellPanel');
    var handle = document.getElementById('resizeHandle');
    
    var startX, startY, startWidth, startHeight;
    
    handle.addEventListener('mousedown', function(e) {
        state.isResizing = true;
        startX = e.clientX;
        startY = e.clientY;
        startWidth = panel.offsetWidth;
        startHeight = panel.offsetHeight;
        
        document.addEventListener('mousemove', onResize);
        document.addEventListener('mouseup', onResizeEnd);
        e.preventDefault();
    });
    
    function onResize(e) {
        if (!state.isResizing) return;
        var newWidth = Math.max(500, startWidth + (e.clientX - startX));
        var newHeight = Math.max(400, startHeight + (e.clientY - startY));
        panel.style.width = newWidth + 'px';
        panel.style.height = newHeight + 'px';
    }
    
    function onResizeEnd() {
        state.isResizing = false;
        document.removeEventListener('mousemove', onResize);
        document.removeEventListener('mouseup', onResizeEnd);
        
        // Save window size
        settings.windowWidth = panel.offsetWidth;
        settings.windowHeight = panel.offsetHeight;
        console.log('[SpellLearning] Window size saved:', settings.windowWidth, 'x', settings.windowHeight);
        autoSaveSettings();
    }
}

// =============================================================================
// BUTTON HANDLERS
// =============================================================================

function onScanClick() {
    console.log('[SpellLearning] Scan button clicked');
    startScan(false);
}

function onFullAutoClick() {
    console.log('[SpellLearning] Full Auto button clicked');
    
    // Check if API key is configured
    if (!state.llmConfig.apiKey || state.llmConfig.apiKey.length < 10) {
        updateStatus('Configure API key in Settings first!');
        setStatusIcon('❌');
        // Flash the settings button
        var settingsBtn = document.getElementById('settingsBtn');
        settingsBtn.style.animation = 'pulse 0.5s ease-in-out 3';
        setTimeout(function() { settingsBtn.style.animation = ''; }, 1500);
        return;
    }
    
    // Disable both buttons during full auto
    var scanBtn = document.getElementById('scanBtn');
    var fullAutoBtn = document.getElementById('fullAutoBtn');
    scanBtn.disabled = true;
    fullAutoBtn.disabled = true;
    fullAutoBtn.innerHTML = '<span class="btn-icon">⏳</span> Working...';
    
    // Start scan with auto-generate flag
    startScan(true);
}

function startScan(autoGenerate) {
    state.fullAutoMode = autoGenerate;
    
    // Check scan mode
    var useTomeMode = document.getElementById('scanModeTomes').checked;
    var statusMsg = useTomeMode ? 'Scanning spell tomes...' : 'Scanning all spells...';
    if (autoGenerate) {
        statusMsg = 'Step 1/3: ' + statusMsg;
    }
    
    updateStatus(statusMsg);
    setStatusIcon('⏳');
    
    var scanBtn = document.getElementById('scanBtn');
    scanBtn.disabled = true;
    scanBtn.textContent = 'Scanning...';
    
    var scanConfig = {
        fields: state.fields,
        treeRulesPrompt: getTreeRulesPrompt(),
        scanMode: useTomeMode ? 'tomes' : 'all'
    };
    
    if (window.callCpp) {
        window.callCpp('ScanSpells', JSON.stringify(scanConfig));
    } else {
        console.warn('[SpellLearning] C++ bridge not ready, using mock data');
        setTimeout(function() {
            var mockData = {
                scanTimestamp: new Date().toISOString(),
                scanMode: useTomeMode ? 'spell_tomes' : 'all_spells',
                spellCount: 3,
                treeRulesPrompt: getTreeRulesPrompt(),
                spells: [
                    { formId: '0x00012FCD', name: 'Flames', school: 'Destruction', skillLevel: 'Novice' },
                    { formId: '0x00012FCE', name: 'Healing', school: 'Restoration', skillLevel: 'Novice' },
                    { formId: '0x00012FCF', name: 'Oakflesh', school: 'Alteration', skillLevel: 'Novice' }
                ]
            };
            updateSpellData(JSON.stringify(mockData));
        }, 500);
    }
}

function onSaveClick() {
    var content = document.getElementById('outputArea').value;
    
    if (!content || content.trim().length === 0) {
        updateStatus('Nothing to save - scan spells first');
        setStatusIcon('⚠️');
        return;
    }
    
    if (window.callCpp) {
        window.callCpp('SaveOutput', content);
            } else {
        updateStatus('Cannot save - C++ bridge not ready');
        setStatusIcon('❌');
    }
}

function onSaveBySchoolClick() {
    var content = document.getElementById('outputArea').value;
    
    if (!content || content.trim().length === 0) {
        updateStatus('Nothing to save - scan spells first');
        setStatusIcon('⚠️');
        return;
    }
    
    try {
        // Parse the JSON to extract spell data
        var data = JSON.parse(content);
        
        if (!data.spells || !Array.isArray(data.spells)) {
            updateStatus('Invalid spell data format');
            setStatusIcon('❌');
            return;
        }
        
        // Get the prompt/rules from the data
        var basePrompt = data.llmPrompt || '';
        
        // Group spells by school
        var schoolSpells = {
            'Alteration': [],
            'Conjuration': [],
            'Destruction': [],
            'Illusion': [],
            'Restoration': []
        };
        
        data.spells.forEach(function(spell) {
            if (spell.school && schoolSpells[spell.school]) {
                schoolSpells[spell.school].push(spell);
            }
        });
        
        // Create output for each school
        var schools = Object.keys(schoolSpells);
        var schoolOutputs = {};
        
        schools.forEach(function(school) {
            var spells = schoolSpells[school];
            if (spells.length === 0) return;
            
            // Create school-specific prompt
            var schoolPrompt = basePrompt + '\n\n';
            schoolPrompt += '## SCHOOL: ' + school.toUpperCase() + ' ONLY\n';
            schoolPrompt += 'You are creating the tree for ' + school + ' school ONLY.\n';
            schoolPrompt += 'Total ' + school + ' spells: ' + spells.length + '\n\n';
            schoolPrompt += 'Return JSON with ONLY the ' + school + ' school:\n';
            schoolPrompt += '{\n  "version": "1.0",\n  "schools": {\n    "' + school + '": {\n      "root": "0xFORMID",\n      "nodes": [...]\n    }\n  }\n}\n\n';
            
            var schoolOutput = {
                llmPrompt: schoolPrompt,
                scanTimestamp: data.scanTimestamp,
                school: school,
                spellCount: spells.length,
                spells: spells
            };
            
            schoolOutputs[school] = JSON.stringify(schoolOutput, null, 2);
        });
        
        // Send to C++ to save all school files
        if (window.callCpp) {
            window.callCpp('SaveOutputBySchool', JSON.stringify(schoolOutputs));
            updateStatus('Saving ' + schools.length + ' school files...');
            setStatusIcon('💾');
        } else {
            updateStatus('Cannot save - C++ bridge not ready');
            setStatusIcon('❌');
        }
        
    } catch (e) {
        console.error('[SpellLearning] Failed to parse spell data:', e);
        updateStatus('Failed to parse spell data');
        setStatusIcon('❌');
    }
}

function onCopyClick() {
    var outputArea = document.getElementById('outputArea');
    var content = outputArea.value;
    
    if (!content || content.trim().length === 0) {
        updateStatus('Nothing to copy - scan spells first');
        setStatusIcon('⚠️');
        return;
    }
    
    // Use C++ to copy to Windows clipboard
    if (window.callCpp) {
        window.callCpp('CopyToClipboard', content);
        updateStatus('Copied to Windows clipboard!');
        setStatusIcon('✓');
    } else {
        // Fallback for browser testing
        try {
            outputArea.select();
            document.execCommand('copy');
            updateStatus('Copied to clipboard!');
            setStatusIcon('✓');
            setTimeout(function() { outputArea.setSelectionRange(0, 0); }, 100);
        } catch (e) {
            console.error('[SpellLearning] Copy failed:', e);
            updateStatus('Copy failed');
            setStatusIcon('❌');
        }
    }
}

function onPasteClick() {
    // Request clipboard content from C++
    if (window.callCpp) {
        state.pasteTarget = 'outputArea';
        window.callCpp('GetClipboard', '');
        updateStatus('Reading clipboard...');
    } else {
        updateStatus('Paste not available - C++ bridge required');
        setStatusIcon('⚠️');
    }
}

function onPasteTreeClick() {
    // Request clipboard content from C++ for tree import
    if (window.callCpp) {
        state.pasteTarget = 'import-textarea';
        window.callCpp('GetClipboard', '');
    } else {
        showImportError('Paste not available - C++ bridge required');
    }
}

function onCloseClick() {
    // Auto-save settings when close is requested
    autoSaveSettings();
    
    // Actually close the panel via C++
    if (window.callCpp) {
        window.callCpp('HidePanel', '');
    } else {
        updateStatus('Press F9 to close');
    }
}

// Called when panel is about to be hidden (from C++)
window.onPanelHiding = function() {
    // Auto-save settings when panel is closed
    autoSaveSettings();
};

function toggleMinimize() {
    var panel = document.getElementById('spellPanel');
    state.isMinimized = !state.isMinimized;
    panel.classList.toggle('minimized', state.isMinimized);
    
    var btn = document.getElementById('minimizeBtn');
    btn.textContent = state.isMinimized ? '□' : '─';
}

// =============================================================================
// C++ CALLBACKS
// =============================================================================

window.updateSpellData = function(jsonStr) {
    console.log('[SpellLearning] Received spell data, length:', jsonStr.length);
    
    var scanSuccess = false;
    try {
        var data = JSON.parse(jsonStr);
        state.lastSpellData = data;
        
        var formatted = JSON.stringify(data, null, 2);
        document.getElementById('outputArea').value = formatted;
        
        if (state.fullAutoMode) {
            updateStatus('Step 2/3: Generating trees for ' + data.spellCount + ' spells...');
        } else {
            updateStatus('Scanned ' + data.spellCount + ' spells');
        }
        setStatusIcon('✓');
        updateCharCount();
        scanSuccess = true;
        
    } catch (e) {
        console.error('[SpellLearning] Failed to parse spell data:', e);
        document.getElementById('outputArea').value = jsonStr;
        updateStatus('Received data (parse error)');
        setStatusIcon('⚠');
        state.fullAutoMode = false;
    }
    
    var scanBtn = document.getElementById('scanBtn');
    scanBtn.disabled = false;
    scanBtn.innerHTML = '<span class="btn-icon">🔍</span>Scan All Spells';
    
    // Continue to auto-generation if in full auto mode
    if (state.fullAutoMode && scanSuccess) {
        console.log('[SpellLearning] Full Auto: Starting tree generation...');
        setTimeout(function() {
            startFullAutoGenerate();
        }, 500);
    } else {
        // Reset full auto button if not continuing
        var fullAutoBtn = document.getElementById('fullAutoBtn');
        if (fullAutoBtn) {
            fullAutoBtn.disabled = false;
            fullAutoBtn.innerHTML = '<span class="btn-icon">🚀</span> Full Auto';
        }
    }
};

window.updateStatus = function(message) {
    var msg = message;
    if (msg.startsWith('"') && msg.endsWith('"')) {
        try { msg = JSON.parse(msg); } catch (e) {}
    }
    document.getElementById('statusText').textContent = msg;
};

window.updatePrompt = function(promptContent) {
    console.log('[SpellLearning] Received prompt, length:', promptContent.length);
    
    if (promptContent && promptContent.length > 0) {
        document.getElementById('promptArea').value = promptContent;
        state.originalPrompt = promptContent;
        state.promptModified = false;
        setPromptStatus('Loaded', '');
    }
};

window.onPromptSaved = function(success) {
    if (success === 'true' || success === true) {
        state.originalPrompt = document.getElementById('promptArea').value;
        state.promptModified = false;
        setPromptStatus('Saved', '');
    } else {
        setPromptStatus('Save failed', 'error');
    }
};

/**
 * Called by C++ with clipboard content
 */
window.onClipboardContent = function(content) {
    console.log('[SpellLearning] Received clipboard content, length:', content ? content.length : 0);
    
    if (!content || content.length === 0) {
        updateStatus('Clipboard is empty');
        setStatusIcon('⚠');
        state.pasteTarget = null;
        return;
    }
    
    // Paste to the target element
    var targetId = state.pasteTarget || 'outputArea';
    var targetEl = document.getElementById(targetId);
    
    if (targetEl) {
        targetEl.value = content.trim();
        
        if (targetId === 'outputArea') {
            updateStatus('Pasted from clipboard (' + content.length + ' chars)');
            setStatusIcon('✓');
            updateCharCount();
        } else if (targetId === 'import-textarea') {
            // Clear any previous error
            var errorBox = document.getElementById('import-error');
            if (errorBox) errorBox.classList.add('hidden');
        } else if (targetId === 'apiKeyInput') {
            // API key pasted
            targetEl.dataset.hasKey = 'false';
            updateStatus('API key pasted from clipboard');
            setStatusIcon('✓');
            
            // Temporarily show the key so user can see it was pasted
            if (targetEl.type === 'password') {
                targetEl.type = 'text';
                setTimeout(function() {
                    targetEl.type = 'password';
                }, 2000);
            }
            targetEl.focus();
        } else if (targetId === 'customModelInput') {
            // Custom model ID pasted
            updateStatus('Custom model ID pasted: ' + content.trim());
            setStatusIcon('✓');
            updateModelDisplayState();
            onSaveApiSettings();
            targetEl.focus();
        }
    }
    
    state.pasteTarget = null;
};

/**
 * Called by C++ when copy succeeds
 */
window.onCopyComplete = function(success) {
    if (success === 'true' || success === true) {
        updateStatus('Copied to Windows clipboard!');
        setStatusIcon('✓');
    } else {
        updateStatus('Copy failed');
        setStatusIcon('❌');
    }
};

// Tree viewer callbacks
window.updateTreeData = function(json) {
    console.log('[SpellLearning] Received tree data');
    try {
        var data = typeof json === 'string' ? JSON.parse(json) : json;
        
        // Check if we actually have tree data
        if (!data || !data.schools || Object.keys(data.schools).length === 0) {
            console.log('[SpellLearning] No valid tree data in response');
            return;
        }
        
        console.log('[SpellLearning] Loading tree with ' + Object.keys(data.schools).length + ' schools');
        loadTreeData(data);
        
        // Force hide empty state after loading
        var emptyState = document.getElementById('empty-state');
        if (emptyState && state.treeData && state.treeData.nodes && state.treeData.nodes.length > 0) {
            emptyState.classList.add('hidden');
            console.log('[SpellLearning] Force-hid empty state');
        }
    } catch (e) {
        console.error('[SpellLearning] Failed to parse tree data:', e);
    }
};

window.updateSpellInfo = function(json) {
    var data = typeof json === 'string' ? JSON.parse(json) : json;
    if (data.formId) {
        SpellCache.set(data.formId, data);
        
        if (state.treeData) {
            var node = state.treeData.nodes.find(function(n) { return n.formId === data.formId; });
            if (node) {
                TreeParser.updateNodeFromCache(node);
                WheelRenderer.render();
            }
        }
    }
};

window.updateSpellInfoBatch = function(json) {
    console.log('[SpellLearning] Received spell info batch');
    var dataArray = typeof json === 'string' ? JSON.parse(json) : json;
    if (!Array.isArray(dataArray)) {
        console.warn('[SpellLearning] Batch response is not an array');
        return;
    }
    
    var foundCount = 0;
    var notFoundCount = 0;
    
    dataArray.forEach(function(data) {
        if (data.formId) {
            if (data.notFound) {
                notFoundCount++;
                console.warn('[SpellLearning] Spell not found: ' + data.formId);
            } else {
                foundCount++;
                SpellCache.set(data.formId, data);
            }
        }
    });
    
    console.log('[SpellLearning] Batch: ' + foundCount + ' found, ' + notFoundCount + ' not found');
    
    // Signal batch complete
    SpellCache.onBatchComplete();
    
    if (state.treeData) {
        state.treeData.nodes.forEach(function(node) {
            TreeParser.updateNodeFromCache(node);
        });
        WheelRenderer.render();
        
        var statusMsg = 'Loaded ' + foundCount + ' spells';
        if (notFoundCount > 0) {
            statusMsg += ' (' + notFoundCount + ' not found)';
        }
        setTreeStatus(statusMsg);
    }
};

window.updateSpellState = function(formId, newState) {
    if (state.treeData) {
        var node = state.treeData.nodes.find(function(n) { return n.formId === formId || n.id === formId; });
        if (node) {
            node.state = newState;
            WheelRenderer.render();
            
            document.getElementById('unlocked-count').textContent = 
                state.treeData.nodes.filter(function(n) { return n.state === 'unlocked'; }).length;
        }
    }
};

// Reset all tree nodes to their default state (locked/available based on prerequisites)
// Called on game launch to main menu - BEFORE any save is loaded
window.onResetTreeStates = function() {
    console.log('[SpellLearning] Resetting all tree states (main menu load)');
    
    // Clear all progress data
    state.spellProgress = {};
    state.learningTargets = {};
    state.playerKnownSpells = new Set();
    
    if (state.treeData && state.treeData.nodes) {
        // Reset all nodes to locked first
        state.treeData.nodes.forEach(function(node) {
            node.state = 'locked';
        });
        
        // Then mark tier 1 nodes (no prerequisites) as available
        state.treeData.nodes.forEach(function(node) {
            if (!node.prerequisites || node.prerequisites.length === 0) {
                node.state = 'available';
            }
        });
        
        console.log('[SpellLearning] Reset complete - all nodes locked/available');
        
        // Re-render tree
        WheelRenderer.render();
        
        document.getElementById('unlocked-count').textContent = '0';
    }
};

// Called when player loads into a save game (after kPostLoadGame)
// This refreshes progress and checks which spells the player knows
window.onSaveGameLoaded = function() {
    console.log('[SpellLearning] Save game loaded - refreshing player data');
    
    // First reset tree to clean state
    window.onResetTreeStates();
    
    // Then request fresh data from C++
    if (window.callCpp) {
        // Get progression data from co-save
        window.callCpp('GetProgress', '');
        
        // Get player's known spells
        window.callCpp('GetPlayerKnownSpells', '');
    }
};

// Helper function to recalculate node availability based on prerequisites
function recalculateNodeAvailability() {
    if (!state.treeData || !state.treeData.nodes) return;
    
    // Build a map for quick lookup
    var nodeMap = {};
    state.treeData.nodes.forEach(function(node) {
        nodeMap[node.id] = node;
    });
    
    // For each node, check if all prerequisites are unlocked
    var changedCount = 0;
    state.treeData.nodes.forEach(function(node) {
        // Skip if already unlocked
        if (node.state === 'unlocked') return;
        
        // Check prerequisites (filter out self-references - LLM sometimes generates these incorrectly)
        var prereqs = (node.prerequisites || []).filter(function(prereqId) {
            // Skip if prereq is this node itself (circular dependency)
            if (prereqId === node.id || prereqId === node.formId) {
                console.warn('[SpellLearning] Skipping self-reference prereq for ' + (node.name || node.id));
                return false;
            }
            return true;
        });
        
        if (prereqs.length === 0) {
            // No prerequisites (or only self-references) - should be available
            if (node.state !== 'available') {
                node.state = 'available';
                changedCount++;
            }
        } else {
            // Has prerequisites - check if ALL are unlocked
            var allPrereqsUnlocked = prereqs.every(function(prereqId) {
                var prereqNode = nodeMap[prereqId];
                return prereqNode && prereqNode.state === 'unlocked';
            });
            
            if (allPrereqsUnlocked) {
                if (node.state !== 'available') {
                    node.state = 'available';
                    changedCount++;
                    console.log('[SpellLearning] Node ' + (node.name || node.id) + ' now available (prereqs met)');
                }
            } else {
                // Prerequisites not met - should be locked
                if (node.state !== 'locked') {
                    node.state = 'locked';
                    changedCount++;
                }
            }
        }
    });
    
    return changedCount;
}

// Callback when we receive the list of player's known spells
window.onPlayerKnownSpells = function(dataStr) {
    console.log('[SpellLearning] Received player known spells');
    try {
        var data = typeof dataStr === 'string' ? JSON.parse(dataStr) : dataStr;
        var knownSpells = data.knownSpells || [];
        
        console.log('[SpellLearning] Player knows ' + knownSpells.length + ' spells');
        
        // Store in state for reference
        state.playerKnownSpells = new Set(knownSpells);
        
        // Update tree node states if tree is loaded
        if (state.treeData && state.treeData.nodes) {
            var updatedCount = 0;
            
            // First pass: Mark all known spells as unlocked
            state.treeData.nodes.forEach(function(node) {
                // Check if player knows this spell
                if (state.playerKnownSpells.has(node.formId)) {
                    if (node.state !== 'unlocked') {
                        node.state = 'unlocked';
                        // Also mark in spell progress
                        if (!state.spellProgress[node.formId]) {
                            state.spellProgress[node.formId] = { xp: 100, required: 100, unlocked: true, ready: true };
                        } else {
                            state.spellProgress[node.formId].unlocked = true;
                        }
                        updatedCount++;
                        console.log('[SpellLearning] Marked ' + (node.name || node.formId) + ' as unlocked');
                    }
                }
            });
            
            // Second pass: Recalculate availability for all nodes
            // This makes children of unlocked nodes become "available"
            var availableCount = recalculateNodeAvailability();
            
            console.log('[SpellLearning] Unlocked: ' + updatedCount + ', Availability updated: ' + availableCount);
            
            // Re-render tree and update counts
            WheelRenderer.render();
            WheelRenderer.updateNodeStates();
            
            document.getElementById('unlocked-count').textContent = 
                state.treeData.nodes.filter(function(n) { return n.state === 'unlocked'; }).length;
        }
    } catch (e) {
        console.error('[SpellLearning] Failed to parse player known spells:', e);
    }
};

window.onPrismaReady = function() {
    console.log('[SpellLearning] Prisma connection established');
    updateStatus('Ready to scan spells...');
    setStatusIcon('⚡');
    
    if (window.callCpp) {
        // Load unified config (all settings, API key, field settings in one file)
        console.log('[SpellLearning] Loading unified config...');
        window.callCpp('LoadUnifiedConfig', '');
        
        // Load tree rules prompt
        window.callCpp('LoadPrompt', '');
        
        // Check API availability (uses settings from unified config)
        checkSkyrimNetAvailability();
        
        // Load progression data
        window.callCpp('GetProgress', '');
        
        // Auto-load saved spell tree (if exists)
        console.log('[SpellLearning] Auto-loading saved spell tree...');
        window.callCpp('LoadSpellTree', '');
        
        // Get player's known spells to sync with tree
        console.log('[SpellLearning] Getting player known spells...');
        window.callCpp('GetPlayerKnownSpells', '');
    }
};

// =============================================================================
// SKYRIMNET INTEGRATION
// =============================================================================

function checkSkyrimNetAvailability() {
    console.log('[SpellLearning] Checking SkyrimNet availability...');
    if (window.callCpp) {
        window.callCpp('CheckSkyrimNet', '');
    } else {
        console.log('[SpellLearning] window.callCpp not available yet');
        // Retry after a short delay
        setTimeout(checkSkyrimNetAvailability, 500);
    }
}

window.onSkyrimNetStatus = function(statusStr) {
    console.log('[SpellLearning] SkyrimNet status raw:', statusStr);
    
    var status;
    try {
        status = typeof statusStr === 'string' ? JSON.parse(statusStr) : statusStr;
    } catch (e) {
        console.error('[SpellLearning] Failed to parse SkyrimNet status:', e);
        return;
    }
    
    console.log('[SpellLearning] SkyrimNet status parsed:', status);
    state.skyrimNetAvailable = status.available;
    
    console.log('[SpellLearning] API status updated, available:', status.available);
};

// Full Auto: Called after scan completes to start tree generation
function startFullAutoGenerate() {
    if (!state.lastSpellData) {
        updateStatus('No spell data - scan failed');
        setStatusIcon('❌');
        resetFullAutoButton();
        return;
    }
    
    var spellData = state.lastSpellData;
    
    if (!spellData || !spellData.spells || !Array.isArray(spellData.spells)) {
        updateStatus('No spells found in scan data');
        setStatusIcon('❌');
        resetFullAutoButton();
        return;
    }
    
    console.log('[SpellLearning] Full Auto: Processing ' + spellData.spells.length + ' spells');
    
    // Group spells by school - dynamically handle ALL schools found in data
    var schoolSpells = {};
    var HEDGE_WIZARD = 'Hedge Wizard';  // Catch-all for spells without a school
    
    spellData.spells.forEach(function(spell) {
        var school = spell.school;
        
        // Handle null/undefined/empty schools -> Hedge Wizard
        if (!school || school === '' || school === 'null' || school === 'undefined' || school === 'None') {
            school = HEDGE_WIZARD;
            spell.school = HEDGE_WIZARD;  // Update the spell's school for tree generation
        }
        
        // Dynamically create school group if it doesn't exist
        if (!schoolSpells[school]) {
            schoolSpells[school] = [];
        }
        schoolSpells[school].push(spell);
    });
    
    // Log Hedge Wizard spells
    if (schoolSpells[HEDGE_WIZARD] && schoolSpells[HEDGE_WIZARD].length > 0) {
        console.log('[SpellLearning] ' + schoolSpells[HEDGE_WIZARD].length + ' miscellaneous spells assigned to Hedge Wizard:', 
            schoolSpells[HEDGE_WIZARD].slice(0, 5).map(function(s) { return s.name || s.formId; }).join(', ') + 
            (schoolSpells[HEDGE_WIZARD].length > 5 ? '...' : ''));
        
        // Ensure Hedge Wizard has a color
        if (!settings.schoolColors[HEDGE_WIZARD]) {
            settings.schoolColors[HEDGE_WIZARD] = '#9ca3af';  // Gray - for miscellaneous
            applySchoolColorsToCSS();
        }
    }
    
    // Build queue
    state.skyrimNetQueue = [];
    state.skyrimNetStats = {
        totalSpells: 0,
        processedSpells: 0,
        failedSchools: [],
        successSchools: []
    };
    
    var schoolCount = 0;
    for (var school in schoolSpells) {
        if (schoolSpells[school].length > 0) {
            state.skyrimNetQueue.push({
                school: school,
                spells: schoolSpells[school]
            });
            state.skyrimNetStats.totalSpells += schoolSpells[school].length;
            schoolCount++;
        }
    }
    
    console.log('[SpellLearning] Found ' + schoolCount + ' schools:', Object.keys(schoolSpells).join(', '));
    
    if (state.skyrimNetQueue.length === 0) {
        updateStatus('No spells to process');
        setStatusIcon('⚠');
        resetFullAutoButton();
        return;
    }
    
    console.log('[SpellLearning] Full Auto: Queued ' + schoolCount + ' schools');
    state.skyrimNetGenerating = true;
    
    // Process first school
    processNextSkyrimNetSchool();
}

function resetFullAutoButton() {
    state.fullAutoMode = false;
    var fullAutoBtn = document.getElementById('fullAutoBtn');
    if (fullAutoBtn) {
        // Show retry option if there were failures
        if (state.lastFailedSchools && state.lastFailedSchools.length > 0) {
            fullAutoBtn.disabled = false;
            fullAutoBtn.innerHTML = '<span class="btn-icon">🔄</span> Retry Failed (' + state.lastFailedSchools.length + ')';
            fullAutoBtn.onclick = retryFailedSchools;
        } else {
            fullAutoBtn.disabled = false;
            fullAutoBtn.innerHTML = '<span class="btn-icon">🚀</span> Full Auto';
            fullAutoBtn.onclick = onFullAutoClick;
        }
    }
}

function retryFailedSchools() {
    if (!state.lastFailedSchools || state.lastFailedSchools.length === 0) {
        updateStatus('No failed schools to retry');
        return;
    }
    
    if (!state.lastSpellData || !state.lastSpellData.spells) {
        updateStatus('No spell data - run Full Auto first');
        return;
    }
    
    console.log('[SpellLearning] Retrying failed schools:', state.lastFailedSchools.join(', '));
    
    // Disable button during retry
    var fullAutoBtn = document.getElementById('fullAutoBtn');
    if (fullAutoBtn) {
        fullAutoBtn.disabled = true;
        fullAutoBtn.innerHTML = '<span class="btn-icon">⏳</span> Retrying...';
    }
    
    // Build queue from failed schools
    state.skyrimNetQueue = [];
    state.skyrimNetStats = {
        totalSpells: 0,
        processedSpells: 0,
        failedSchools: [],
        successSchools: state.skyrimNetStats.successSchools || []  // Keep previous successes
    };
    
    state.lastFailedSchools.forEach(function(school) {
        var spells = state.lastSpellData.spells.filter(function(s) { return s.school === school; });
        if (spells.length > 0) {
            state.skyrimNetQueue.push({ school: school, spells: spells });
            state.skyrimNetStats.totalSpells += spells.length;
        }
    });
    
    if (state.skyrimNetQueue.length === 0) {
        updateStatus('No spells found for failed schools');
        resetFullAutoButton();
        return;
    }
    
    state.lastFailedSchools = [];  // Clear the retry list
    state.skyrimNetGenerating = true;
    state.fullAutoMode = true;
    
    updateStatus('Retrying ' + state.skyrimNetQueue.length + ' failed school(s)...');
    
    // Start processing
    processNextSkyrimNetSchool();
}

function startSkyrimNetAutoGenerate() {
    // First, check if we have spell data
    if (!state.lastSpellData) {
        setTreeStatus('Scan spells first (Spell Scan tab)');
        return;
    }
    
    console.log('[SpellLearning] Starting SkyrimNet auto-generation');
    
    // state.lastSpellData is already a parsed object (set in updateSpellData)
    var spellData = state.lastSpellData;
    
    if (!spellData || !spellData.spells || !Array.isArray(spellData.spells)) {
        setTreeStatus('No spells found - rescan spells');
        return;
    }
    
    console.log('[SpellLearning] Found ' + spellData.spells.length + ' spells to process');
    
    // Group spells by school - dynamically handle ALL schools
    var schoolSpells = {};
    var HEDGE_WIZARD = 'Hedge Wizard';
    
    spellData.spells.forEach(function(spell) {
        var school = spell.school;
        
        // Handle null/undefined/empty schools -> Hedge Wizard
        if (!school || school === '' || school === 'null' || school === 'undefined' || school === 'None') {
            school = HEDGE_WIZARD;
            spell.school = HEDGE_WIZARD;
        }
        
        if (!schoolSpells[school]) {
            schoolSpells[school] = [];
        }
        schoolSpells[school].push(spell);
    });
    
    // Ensure Hedge Wizard has a color
    if (schoolSpells[HEDGE_WIZARD] && schoolSpells[HEDGE_WIZARD].length > 0) {
        if (!settings.schoolColors[HEDGE_WIZARD]) {
            settings.schoolColors[HEDGE_WIZARD] = '#9ca3af';
            applySchoolColorsToCSS();
        }
    }
    
    // Build queue of schools with spells
    state.skyrimNetQueue = [];
    state.skyrimNetStats = {
        totalSpells: 0,
        processedSpells: 0,
        failedSchools: [],
        successSchools: []
    };
    
    for (var school in schoolSpells) {
        if (schoolSpells[school].length > 0) {
            state.skyrimNetQueue.push({
                school: school,
                spells: schoolSpells[school]
            });
            state.skyrimNetStats.totalSpells += schoolSpells[school].length;
        }
    }
    
    if (state.skyrimNetQueue.length === 0) {
        setTreeStatus('No spells to process');
        return;
    }
    
    console.log('[SpellLearning] Queued ' + state.skyrimNetQueue.length + ' schools: ' + 
                Object.keys(schoolSpells).join(', ') + ' (' + state.skyrimNetStats.totalSpells + ' total spells)');
    
    state.skyrimNetGenerating = true;
    
    // Disable the button during generation
    var btn = document.getElementById('skyrimnet-auto-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="btn-icon">⏳</span> Generating...';
    }
    
    // Start processing first school
    processNextSkyrimNetSchool();
}

function processNextSkyrimNetSchool() {
    if (state.skyrimNetQueue.length === 0) {
        // All done
        finishSkyrimNetGeneration();
        return;
    }
    
    var schoolData = state.skyrimNetQueue.shift();
    state.skyrimNetCurrentSchool = schoolData.school;
    
    var progressMsg = 'Generating ' + schoolData.school + ' (' + schoolData.spells.length + ' spells)...';
    var remaining = state.skyrimNetQueue.length;
    
    // Update both status areas
    setTreeStatus(progressMsg);
    if (state.fullAutoMode) {
        var step = state.skyrimNetStats.successSchools.length + state.skyrimNetStats.failedSchools.length + 1;
        var total = step + remaining;
        updateStatus('Step 2/3: ' + schoolData.school + ' (' + step + '/' + total + ' schools)');
    }
    
    console.log('[SpellLearning] Processing ' + schoolData.school + ' with ' + schoolData.spells.length + ' spells');
    
    // Get prompt rules
    var promptRules = getTreeRulesPrompt();
    
    // Prepare request with all LLM settings
    var request = {
        school: schoolData.school,
        spellData: JSON.stringify(schoolData.spells),
        promptRules: promptRules,
        model: getEffectiveModel(),
        maxTokens: state.llmConfig.maxTokens || 4096,
        apiKey: state.llmConfig.apiKey
    };
    
    console.log('[SpellLearning] Generating ' + schoolData.school + ' with model:', request.model, 'maxTokens:', request.maxTokens);
    
    if (window.callCpp) {
        window.callCpp('SkyrimNetGenerate', JSON.stringify(request));
    }
}

window.onSkyrimNetQueued = function(responseStr) {
    console.log('[SpellLearning] SkyrimNet request queued raw:', responseStr);
    
    var response;
    try {
        response = typeof responseStr === 'string' ? JSON.parse(responseStr) : responseStr;
    } catch (e) {
        console.error('[SpellLearning] Failed to parse queued response:', e);
        setTreeStatus('Error parsing response');
        return;
    }
    
    console.log('[SpellLearning] SkyrimNet request queued parsed:', response);
    setTreeStatus(response.school + ': ' + response.message);
    
    // Start polling for response
    if (state.skyrimNetPollInterval) {
        clearInterval(state.skyrimNetPollInterval);
    }
    
    state.skyrimNetPollInterval = setInterval(function() {
        if (window.callCpp) {
            window.callCpp('PollSkyrimNetResponse', '');
        }
    }, 2000); // Poll every 2 seconds
};

window.onSkyrimNetPollResult = function(resultStr) {
    var result;
    try {
        result = typeof resultStr === 'string' ? JSON.parse(resultStr) : resultStr;
    } catch (e) {
        console.error('[SpellLearning] Failed to parse poll result:', e);
        return;
    }
    
    if (!result.hasResponse) {
        return; // Keep waiting
    }
    
    // Stop polling
    if (state.skyrimNetPollInterval) {
        clearInterval(state.skyrimNetPollInterval);
        state.skyrimNetPollInterval = null;
    }
    
    console.log('[SpellLearning] Got SkyrimNet response, success=' + result.success);
    
    if (result.success === 1 && result.response) {
        // Try to parse and import the tree
        try {
            var treeData = JSON.parse(result.response);
            
            // Count spells in response and log layout style
            var spellCount = 0;
            var layoutStyle = 'radial';
            if (treeData.schools) {
                for (var school in treeData.schools) {
                    if (treeData.schools[school].nodes) {
                        spellCount += treeData.schools[school].nodes.length;
                    }
                    if (treeData.schools[school].layoutStyle) {
                        layoutStyle = treeData.schools[school].layoutStyle;
                    }
                }
            }
            
            state.skyrimNetStats.processedSpells += spellCount;
            state.skyrimNetStats.successSchools.push(state.skyrimNetCurrentSchool);
            
            console.log('[SpellLearning] ' + state.skyrimNetCurrentSchool + ': ' + spellCount + ' spells, layout: ' + layoutStyle);
            
            // Merge with existing tree
            if (state.treeData && state.treeData.success && state.treeData.rawData) {
                treeData = mergeTreeData(state.treeData.rawData, treeData);
            }
            
            loadTreeData(treeData);
            setTreeStatus(state.skyrimNetCurrentSchool + ' imported (' + spellCount + ' spells)');
            state.skyrimNetRetryCount = 0;  // Reset retry counter on success
            
        } catch (e) {
            console.error('[SpellLearning] Failed to parse tree response for ' + state.skyrimNetCurrentSchool + ':', e);
            console.error('[SpellLearning] Raw response (first 500 chars):', result.response ? result.response.substring(0, 500) : 'empty');
            
            // Retry logic
            state.skyrimNetRetryCount = (state.skyrimNetRetryCount || 0) + 1;
            if (state.skyrimNetRetryCount < 2) {
                console.log('[SpellLearning] Retrying ' + state.skyrimNetCurrentSchool + ' (attempt ' + (state.skyrimNetRetryCount + 1) + ')...');
                setTreeStatus(state.skyrimNetCurrentSchool + ' failed to parse, retrying...');
                
                // Re-queue this school at the front
                var retrySchool = state.skyrimNetCurrentSchool;
                var retrySpells = state.lastSpellData.spells.filter(function(s) { return s.school === retrySchool; });
                state.skyrimNetQueue.unshift({ school: retrySchool, spells: retrySpells });
                
                // Longer delay before retry
                setTimeout(processNextSkyrimNetSchool, 3000);
                return;
            }
            
            state.skyrimNetStats.failedSchools.push(state.skyrimNetCurrentSchool);
            setTreeStatus(state.skyrimNetCurrentSchool + ' failed: invalid JSON after ' + state.skyrimNetRetryCount + ' attempts');
            state.skyrimNetRetryCount = 0;
        }
    } else {
        console.error('[SpellLearning] ' + state.skyrimNetCurrentSchool + ' request failed:', result.response || 'unknown error');
        
        // Retry logic for failed requests
        state.skyrimNetRetryCount = (state.skyrimNetRetryCount || 0) + 1;
        if (state.skyrimNetRetryCount < 2) {
            console.log('[SpellLearning] Retrying ' + state.skyrimNetCurrentSchool + ' (attempt ' + (state.skyrimNetRetryCount + 1) + ')...');
            setTreeStatus(state.skyrimNetCurrentSchool + ' failed, retrying...');
            
            // Re-queue this school at the front
            var retrySchool = state.skyrimNetCurrentSchool;
            var retrySpells = state.lastSpellData.spells.filter(function(s) { return s.school === retrySchool; });
            state.skyrimNetQueue.unshift({ school: retrySchool, spells: retrySpells });
            
            // Longer delay before retry
            setTimeout(processNextSkyrimNetSchool, 3000);
            return;
        }
        
        state.skyrimNetStats.failedSchools.push(state.skyrimNetCurrentSchool);
        setTreeStatus(state.skyrimNetCurrentSchool + ' failed: ' + (result.response || 'unknown error'));
        state.skyrimNetRetryCount = 0;
    }
    
    // Process next school after a short delay
    setTimeout(processNextSkyrimNetSchool, 1000);
}

function finishSkyrimNetGeneration() {
    state.skyrimNetGenerating = false;
    state.skyrimNetCurrentSchool = null;
    state.skyrimNetRetryCount = 0;
    
    // Show summary
    var stats = state.skyrimNetStats;
    var statusMsg = 'Complete! ' + stats.successSchools.length + ' schools, ' + stats.processedSpells + ' spells';
    
    if (stats.failedSchools.length > 0) {
        statusMsg += ' | Failed: ' + stats.failedSchools.join(', ');
        // Store failed schools for potential retry
        state.lastFailedSchools = stats.failedSchools.slice();
    } else {
        state.lastFailedSchools = [];
    }
    
    // Update appropriate UI based on mode
    if (state.fullAutoMode) {
        // Full Auto always runs LLM color suggestion for all detected schools
        var detectedSchools = Object.keys(settings.schoolColors);
        
        updateStatus('Step 3/4: Suggesting colors for ' + detectedSchools.length + ' schools...');
        console.log('[SpellLearning] Full Auto: Running LLM color suggestion for schools:', detectedSchools.join(', '));
        
        suggestSchoolColorsWithLLM(function() {
            // After colors are done, finish up
            updateStatus('Complete! ' + statusMsg);
            setStatusIcon(stats.failedSchools.length > 0 ? '⚠' : '✓');
            resetFullAutoButton();
            
            // Save tree again to ensure it's persisted
            console.log('[SpellLearning] Full Auto complete - final save');
            saveTreeToFile();
            
            // Switch to tree tab to show results
            setTimeout(function() {
                var treeTab = document.getElementById('tabSpellTree');
                if (treeTab) treeTab.click();
            }, 500);
        });
    } else {
        setTreeStatus(statusMsg);
    }
    
    console.log('[SpellLearning] Generation complete:', stats);
    
    // Save the combined tree immediately after generation
    saveTreeToFile();
}

// Helper function to save tree - can be called anytime
function saveTreeToFile() {
    if (!state.treeData || !state.treeData.rawData) {
        console.warn('[SpellLearning] No tree data to save');
        return false;
    }
    
    if (!window.callCpp) {
        console.warn('[SpellLearning] Cannot save - callCpp not available');
        return false;
    }
    
    var treeJson = JSON.stringify(state.treeData.rawData);
    console.log('[SpellLearning] Saving tree to file, size:', treeJson.length, 'chars,', 
                Object.keys(state.treeData.rawData.schools || {}).length, 'schools');
    
    window.callCpp('SaveSpellTree', treeJson);
    return true;
}

// Helper function to show/hide divider settings based on toggle state
function updateDividerSettingsVisibility() {
    var fadeRow = document.getElementById('dividerFadeRow');
    var spacingRow = document.getElementById('dividerSpacingRow');
    var colorModeRow = document.getElementById('dividerColorModeRow');
    var isVisible = settings.showSchoolDividers;
    
    if (fadeRow) fadeRow.style.display = isVisible ? '' : 'none';
    if (spacingRow) spacingRow.style.display = isVisible ? '' : 'none';
    if (colorModeRow) colorModeRow.style.display = isVisible ? '' : 'none';
    
    // Also update custom color row visibility
    updateDividerColorRowVisibility();
}

// Helper function to show/hide custom color picker based on color mode
function updateDividerColorRowVisibility() {
    var customColorRow = document.getElementById('dividerCustomColorRow');
    var isVisible = settings.showSchoolDividers && settings.dividerColorMode === 'custom';
    
    if (customColorRow) customColorRow.style.display = isVisible ? '' : 'none';
}

// Initialize ISL-DESTified integration settings
function initializeISLSettings() {
    // Update detection badge
    updateISLDetectionStatus();
    
    // Enable toggle
    var islEnabledToggle = document.getElementById('islEnabledToggle');
    if (islEnabledToggle) {
        islEnabledToggle.checked = settings.islEnabled;
        islEnabledToggle.addEventListener('change', function() {
            settings.islEnabled = this.checked;
            console.log('[SpellLearning] ISL integration enabled:', settings.islEnabled);
            scheduleAutoSave();
        });
    }
    
    // XP per hour input
    var islXpPerHourInput = document.getElementById('islXpPerHourInput');
    if (islXpPerHourInput) {
        islXpPerHourInput.value = settings.islXpPerHour;
        islXpPerHourInput.addEventListener('change', function() {
            var value = parseInt(this.value);
            if (value >= 10 && value <= 200) {
                settings.islXpPerHour = value;
                console.log('[SpellLearning] ISL XP per hour:', settings.islXpPerHour);
                scheduleAutoSave();
            } else {
                this.value = settings.islXpPerHour;
            }
        });
    }
    
    // Tome bonus slider
    var islTomeBonusSlider = document.getElementById('islTomeBonusSlider');
    var islTomeBonusValue = document.getElementById('islTomeBonusValue');
    if (islTomeBonusSlider) {
        islTomeBonusSlider.value = settings.islTomeBonus;
        if (islTomeBonusValue) islTomeBonusValue.textContent = settings.islTomeBonus + '%';
        updateSliderFillGlobal(islTomeBonusSlider);
        
        islTomeBonusSlider.addEventListener('input', function() {
            settings.islTomeBonus = parseInt(this.value);
            if (islTomeBonusValue) islTomeBonusValue.textContent = settings.islTomeBonus + '%';
            updateSliderFillGlobal(this);
            scheduleAutoSave();
        });
    }
}

// Update ISL detection badge in UI
function updateISLDetectionStatus() {
    var badge = document.getElementById('islDetectionStatus');
    if (!badge) return;
    
    if (settings.islDetected) {
        badge.textContent = 'Detected';
        badge.classList.remove('not-detected');
        badge.classList.add('detected');
    } else {
        badge.textContent = 'Not Detected';
        badge.classList.remove('detected');
        badge.classList.add('not-detected');
    }
}

// Called from C++ when ISL detection status changes
window.onISLDetectionUpdate = function(detected) {
    settings.islDetected = detected;
    updateISLDetectionStatus();
    console.log('[SpellLearning] ISL detection status:', detected ? 'Detected' : 'Not Detected');
};

// =============================================================================
// EARLY SPELL LEARNING SETTINGS
// =============================================================================

function initializeEarlyLearningSettings() {
    // Enable toggle
    var enabledToggle = document.getElementById('earlyLearningEnabledToggle');
    if (enabledToggle) {
        enabledToggle.checked = settings.earlySpellLearning.enabled;
        enabledToggle.addEventListener('change', function() {
            settings.earlySpellLearning.enabled = this.checked;
            updateEarlyLearningSettingsVisibility();
            console.log('[SpellLearning] Early learning enabled:', settings.earlySpellLearning.enabled);
            onProgressionSettingChanged();
        });
    }
    
    // Unlock threshold slider
    setupEarlyLearningSlider('unlockThreshold', 'unlockThreshold', '%');
    
    // Min effectiveness slider
    setupEarlyLearningSlider('minEffectiveness', 'minEffectiveness', '%');
    
    // Max effectiveness slider
    setupEarlyLearningSlider('maxEffectiveness', 'maxEffectiveness', '%');
    
    // Self-cast required slider
    setupEarlyLearningSlider('selfCastRequired', 'selfCastRequiredAt', '%');
    
    // Self-cast multiplier slider
    setupEarlyLearningSlider('selfCastMultiplier', 'selfCastXPMultiplier', '%');
    
    // Binary threshold slider
    setupEarlyLearningSlider('binaryThreshold', 'binaryEffectThreshold', '%');
    
    // Initial visibility
    updateEarlyLearningSettingsVisibility();
}

function setupEarlyLearningSlider(elementBaseName, settingName, suffix) {
    var slider = document.getElementById(elementBaseName + 'Slider');
    var valueEl = document.getElementById(elementBaseName + 'Value');
    
    if (slider) {
        slider.value = settings.earlySpellLearning[settingName];
        if (valueEl) valueEl.textContent = settings.earlySpellLearning[settingName] + suffix;
        
        slider.addEventListener('input', function() {
            var value = parseInt(this.value);
            settings.earlySpellLearning[settingName] = value;
            if (valueEl) valueEl.textContent = value + suffix;
            onProgressionSettingChanged();
        });
    }
}

function updateEarlyLearningSettingsVisibility() {
    var rows = [
        'unlockThresholdRow',
        'minEffectivenessRow', 
        'maxEffectivenessRow',
        'selfCastRequiredRow',
        'selfCastMultiplierRow',
        'binaryThresholdRow'
    ];
    
    var isEnabled = settings.earlySpellLearning.enabled;
    
    rows.forEach(function(rowId) {
        var row = document.getElementById(rowId);
        if (row) {
            row.style.opacity = isEnabled ? '1' : '0.5';
            row.style.pointerEvents = isEnabled ? '' : 'none';
        }
    });
}

function updateEarlyLearningUI() {
    // Update toggle
    var enabledToggle = document.getElementById('earlyLearningEnabledToggle');
    if (enabledToggle) enabledToggle.checked = settings.earlySpellLearning.enabled;
    
    // Update sliders
    var sliderMappings = [
        { element: 'unlockThreshold', setting: 'unlockThreshold' },
        { element: 'minEffectiveness', setting: 'minEffectiveness' },
        { element: 'maxEffectiveness', setting: 'maxEffectiveness' },
        { element: 'selfCastRequired', setting: 'selfCastRequiredAt' },
        { element: 'selfCastMultiplier', setting: 'selfCastXPMultiplier' },
        { element: 'binaryThreshold', setting: 'binaryEffectThreshold' }
    ];
    
    sliderMappings.forEach(function(mapping) {
        var slider = document.getElementById(mapping.element + 'Slider');
        var valueEl = document.getElementById(mapping.element + 'Value');
        if (slider && settings.earlySpellLearning[mapping.setting] !== undefined) {
            slider.value = settings.earlySpellLearning[mapping.setting];
            if (valueEl) valueEl.textContent = settings.earlySpellLearning[mapping.setting] + '%';
        }
    });
    
    // Update visibility
    updateEarlyLearningSettingsVisibility();
}

// =============================================================================
// DIFFICULTY PROFILE SYSTEM
// =============================================================================

function initializeDifficultyProfiles() {
    var profileSelect = document.getElementById('difficultyProfileSelect');
    var saveCustomBtn = document.getElementById('saveCustomProfileBtn');
    var resetBtn = document.getElementById('resetToProfileBtn');
    
    if (profileSelect) {
        // Add custom profiles to dropdown
        updateProfileDropdown();
        
        // Set initial value
        profileSelect.value = settings.activeProfile;
        updateProfileDescription();
        
        profileSelect.addEventListener('change', function() {
            applyProfile(this.value);
        });
    }
    
    if (saveCustomBtn) {
        saveCustomBtn.addEventListener('click', function() {
            promptSaveCustomProfile();
        });
    }
    
    if (resetBtn) {
        resetBtn.addEventListener('click', function() {
            resetToProfile();
        });
    }
    
    // Update modified badge based on current state
    updateProfileModifiedBadge();
    updateCustomProfilesUI();
}

function applyProfile(profileId) {
    var profile = DIFFICULTY_PROFILES[profileId] || customProfiles[profileId];
    if (!profile) {
        console.warn('[SpellLearning] Profile not found:', profileId);
        return;
    }
    
    console.log('[SpellLearning] Applying profile:', profile.name);
    
    // Copy profile settings to our settings object
    var ps = profile.settings;
    settings.xpGlobalMultiplier = ps.xpGlobalMultiplier;
    settings.xpMultiplierDirect = ps.xpMultiplierDirect;
    settings.xpMultiplierSchool = ps.xpMultiplierSchool;
    settings.xpMultiplierAny = ps.xpMultiplierAny;
    settings.xpNovice = ps.xpNovice;
    settings.xpApprentice = ps.xpApprentice;
    settings.xpAdept = ps.xpAdept;
    settings.xpExpert = ps.xpExpert;
    settings.xpMaster = ps.xpMaster;
    settings.revealName = ps.revealName;
    settings.revealEffects = ps.revealEffects;
    settings.revealDescription = ps.revealDescription;
    
    // Apply discovery mode if set in profile (default false for easy/normal/hard)
    if (ps.discoveryMode !== undefined) {
        settings.discoveryMode = ps.discoveryMode;
        var discoveryModeToggle = document.getElementById('discoveryModeToggle');
        if (discoveryModeToggle) discoveryModeToggle.checked = settings.discoveryMode;
    }
    
    // Apply early spell learning settings
    if (ps.earlySpellLearning) {
        settings.earlySpellLearning = Object.assign({}, ps.earlySpellLearning);
        updateEarlyLearningUI();
    }
    
    settings.activeProfile = profileId;
    settings.profileModified = false;
    
    // Update all UI controls
    updateProgressionSettingsUI();
    updateProfileDescription();
    updateProfileModifiedBadge();
    updateCustomProfilesUI();
    
    // Re-render tree if discovery mode changed
    if (state.treeData) {
        WheelRenderer.render();
    }
    
    // Save settings
    scheduleAutoSave();
}

function resetToProfile() {
    applyProfile(settings.activeProfile);
}

function promptSaveCustomProfile() {
    var name = prompt('Enter a name for your custom profile:');
    if (!name || name.trim() === '') return;
    
    name = name.trim();
    
    // Check for duplicate names
    if (customProfiles[name]) {
        if (!confirm('A profile with this name already exists. Overwrite it?')) {
            return;
        }
    }
    
    saveCustomProfile(name);
}

function saveCustomProfile(name) {
    customProfiles[name] = {
        name: name,
        description: 'Custom profile',
        settings: {
            xpGlobalMultiplier: settings.xpGlobalMultiplier,
            xpMultiplierDirect: settings.xpMultiplierDirect,
            xpMultiplierSchool: settings.xpMultiplierSchool,
            xpMultiplierAny: settings.xpMultiplierAny,
            xpNovice: settings.xpNovice,
            xpApprentice: settings.xpApprentice,
            xpAdept: settings.xpAdept,
            xpExpert: settings.xpExpert,
            xpMaster: settings.xpMaster,
            revealName: settings.revealName,
            revealEffects: settings.revealEffects,
            revealDescription: settings.revealDescription
        }
    };
    
    settings.activeProfile = name;
    settings.profileModified = false;
    
    updateProfileDropdown();
    updateProfileDescription();
    updateProfileModifiedBadge();
    updateCustomProfilesUI();
    
    // Update select to show new profile
    var profileSelect = document.getElementById('difficultyProfileSelect');
    if (profileSelect) profileSelect.value = name;
    
    scheduleAutoSave();
    console.log('[SpellLearning] Custom profile saved:', name);
}

function deleteCustomProfile(name) {
    if (!customProfiles[name]) return;
    
    if (!confirm('Delete custom profile "' + name + '"?')) return;
    
    delete customProfiles[name];
    
    // If the deleted profile was active, switch to Normal
    if (settings.activeProfile === name) {
        settings.activeProfile = 'normal';
        applyProfile('normal');
    }
    
    updateProfileDropdown();
    updateCustomProfilesUI();
    scheduleAutoSave();
    console.log('[SpellLearning] Custom profile deleted:', name);
}

function updateProfileDropdown() {
    var profileSelect = document.getElementById('difficultyProfileSelect');
    if (!profileSelect) return;
    
    // Remove existing custom profile options
    var options = profileSelect.querySelectorAll('option[data-custom="true"]');
    options.forEach(function(opt) { opt.remove(); });
    
    // Add custom profiles
    var customKeys = Object.keys(customProfiles);
    if (customKeys.length > 0) {
        // Add separator
        var separator = document.createElement('option');
        separator.disabled = true;
        separator.textContent = '───────────';
        separator.setAttribute('data-custom', 'true');
        profileSelect.appendChild(separator);
        
        // Add custom profiles
        customKeys.forEach(function(key) {
            var opt = document.createElement('option');
            opt.value = key;
            opt.textContent = customProfiles[key].name;
            opt.setAttribute('data-custom', 'true');
            profileSelect.appendChild(opt);
        });
    }
}

function updateProfileDescription() {
    var descEl = document.getElementById('profileDescription');
    if (!descEl) return;
    
    var profile = DIFFICULTY_PROFILES[settings.activeProfile] || customProfiles[settings.activeProfile];
    if (profile) {
        descEl.textContent = profile.description;
    } else {
        descEl.textContent = '';
    }
}

function updateProfileModifiedBadge() {
    var badge = document.getElementById('profileModifiedBadge');
    if (!badge) return;
    
    var isModified = checkProfileModified();
    settings.profileModified = isModified;
    badge.classList.toggle('hidden', !isModified);
}

function checkProfileModified() {
    var profile = DIFFICULTY_PROFILES[settings.activeProfile] || customProfiles[settings.activeProfile];
    if (!profile) return false;
    
    var ps = profile.settings;
    
    // Check basic settings
    var basicModified = (
        settings.xpGlobalMultiplier !== ps.xpGlobalMultiplier ||
        settings.xpMultiplierDirect !== ps.xpMultiplierDirect ||
        settings.xpMultiplierSchool !== ps.xpMultiplierSchool ||
        settings.xpMultiplierAny !== ps.xpMultiplierAny ||
        settings.xpNovice !== ps.xpNovice ||
        settings.xpApprentice !== ps.xpApprentice ||
        settings.xpAdept !== ps.xpAdept ||
        settings.xpExpert !== ps.xpExpert ||
        settings.xpMaster !== ps.xpMaster ||
        settings.revealName !== ps.revealName ||
        settings.revealEffects !== ps.revealEffects ||
        settings.revealDescription !== ps.revealDescription
    );
    
    if (basicModified) return true;
    
    // Check early spell learning settings
    if (ps.earlySpellLearning && settings.earlySpellLearning) {
        var el = settings.earlySpellLearning;
        var pel = ps.earlySpellLearning;
        if (el.enabled !== pel.enabled ||
            el.unlockThreshold !== pel.unlockThreshold ||
            el.minEffectiveness !== pel.minEffectiveness ||
            el.maxEffectiveness !== pel.maxEffectiveness ||
            el.selfCastRequiredAt !== pel.selfCastRequiredAt ||
            el.selfCastXPMultiplier !== pel.selfCastXPMultiplier ||
            el.binaryEffectThreshold !== pel.binaryEffectThreshold) {
            return true;
        }
    }
    
    return false;
}

function updateCustomProfilesUI() {
    var section = document.getElementById('customProfilesSection');
    var list = document.getElementById('customProfilesList');
    if (!section || !list) return;
    
    var customKeys = Object.keys(customProfiles);
    if (customKeys.length === 0) {
        section.classList.add('hidden');
        return;
    }
    
    section.classList.remove('hidden');
    list.innerHTML = '';
    
    customKeys.forEach(function(key) {
        var chip = document.createElement('div');
        chip.className = 'custom-profile-chip';
        if (settings.activeProfile === key) {
            chip.classList.add('active');
        }
        
        var nameSpan = document.createElement('span');
        nameSpan.textContent = customProfiles[key].name;
        nameSpan.addEventListener('click', function() {
            var profileSelect = document.getElementById('difficultyProfileSelect');
            if (profileSelect) profileSelect.value = key;
            applyProfile(key);
        });
        
        var deleteBtn = document.createElement('span');
        deleteBtn.className = 'custom-profile-delete';
        deleteBtn.textContent = '×';
        deleteBtn.title = 'Delete this profile';
        deleteBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            deleteCustomProfile(key);
        });
        
        chip.appendChild(nameSpan);
        chip.appendChild(deleteBtn);
        list.appendChild(chip);
    });
}

function updateProgressionSettingsUI() {
    // Helper to update slider fill visual
    function updateSliderFill(slider) {
        if (!slider) return;
        var percent = (slider.value - slider.min) / (slider.max - slider.min) * 100;
        slider.style.setProperty('--slider-fill', percent + '%');
    }
    
    // Global multiplier
    var globalMultSlider = document.getElementById('xpGlobalMultiplierSlider');
    var globalMultValue = document.getElementById('xpGlobalMultiplierValue');
    if (globalMultSlider) {
        globalMultSlider.value = settings.xpGlobalMultiplier;
        updateSliderFill(globalMultSlider);
        if (globalMultValue) globalMultValue.textContent = 'x' + settings.xpGlobalMultiplier;
    }
    
    // XP multipliers
    var xpDirectSlider = document.getElementById('xpDirectSlider');
    var xpDirectValue = document.getElementById('xpDirectValue');
    if (xpDirectSlider) {
        xpDirectSlider.value = settings.xpMultiplierDirect;
        updateSliderFill(xpDirectSlider);
        if (xpDirectValue) xpDirectValue.textContent = settings.xpMultiplierDirect + '%';
    }
    
    var xpSchoolSlider = document.getElementById('xpSchoolSlider');
    var xpSchoolValue = document.getElementById('xpSchoolValue');
    if (xpSchoolSlider) {
        xpSchoolSlider.value = settings.xpMultiplierSchool;
        updateSliderFill(xpSchoolSlider);
        if (xpSchoolValue) xpSchoolValue.textContent = settings.xpMultiplierSchool + '%';
    }
    
    var xpAnySlider = document.getElementById('xpAnySlider');
    var xpAnyValue = document.getElementById('xpAnyValue');
    if (xpAnySlider) {
        xpAnySlider.value = settings.xpMultiplierAny;
        updateSliderFill(xpAnySlider);
        if (xpAnyValue) xpAnyValue.textContent = settings.xpMultiplierAny + '%';
    }
    
    // Tier XP inputs
    var tierInputs = {
        'xpNoviceInput': settings.xpNovice,
        'xpApprenticeInput': settings.xpApprentice,
        'xpAdeptInput': settings.xpAdept,
        'xpExpertInput': settings.xpExpert,
        'xpMasterInput': settings.xpMaster
    };
    for (var inputId in tierInputs) {
        var input = document.getElementById(inputId);
        if (input) input.value = tierInputs[inputId];
    }
    
    // Reveal sliders
    var revealSliders = [
        { sliderId: 'revealNameSlider', valueId: 'revealNameValue', setting: settings.revealName },
        { sliderId: 'revealEffectsSlider', valueId: 'revealEffectsValue', setting: settings.revealEffects },
        { sliderId: 'revealDescSlider', valueId: 'revealDescValue', setting: settings.revealDescription }
    ];
    revealSliders.forEach(function(cfg) {
        var slider = document.getElementById(cfg.sliderId);
        var valueEl = document.getElementById(cfg.valueId);
        if (slider) {
            slider.value = cfg.setting;
            updateSliderFill(slider);
            if (valueEl) valueEl.textContent = cfg.setting + '%';
        }
    });
}

// Mark profile as modified when settings change
function onProgressionSettingChanged() {
    updateProfileModifiedBadge();
}

// Helper function to show/hide tree action buttons based on cheat mode and tree state
function updateTreeActionsVisibility() {
    var treeActions = document.getElementById('tree-actions');
    if (!treeActions) return;
    
    // Only show if cheat mode is on AND tree is loaded
    var shouldShow = settings.cheatMode && state.treeData && state.treeData.success;
    treeActions.classList.toggle('hidden', !shouldShow);
}

// Clear tree data for a fresh start
function clearTree() {
    console.log('[SpellLearning] Clearing tree data');
    
    // Clear state
    state.treeData = null;
    state.selectedNode = null;
    state.spellInfoCache = {};
    
    // Clear the renderer
    WheelRenderer.clear();
    
    // Show empty state
    var emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.classList.remove('hidden');
    
    // Hide tree actions
    var treeActions = document.getElementById('tree-actions');
    if (treeActions) treeActions.classList.add('hidden');
    
    // Hide details panel
    var detailsPanel = document.getElementById('details-panel');
    if (detailsPanel) detailsPanel.classList.add('hidden');
    
    // Reset counts
    document.getElementById('total-count').textContent = '0';
    document.getElementById('unlocked-count').textContent = '0';
    
    setTreeStatus('Tree cleared - ready for new generation');
}

// =============================================================================
// UI HELPERS
// =============================================================================

function setStatusIcon(icon) {
    document.getElementById('statusIcon').textContent = icon;
}

function updateCharCount() {
    var content = document.getElementById('outputArea').value;
    var count = content.length;
    
    var countText;
    if (count >= 1000000) {
        countText = (count / 1000000).toFixed(1) + 'M chars';
    } else if (count >= 1000) {
        countText = (count / 1000).toFixed(1) + 'K chars';
    } else {
        countText = count + ' chars';
    }
    
    document.getElementById('charCount').textContent = countText;
}

console.log('[SpellLearning] Script loaded');
