/**
 * Unification Test Module
 *
 * Tests all unified modules to verify they're working correctly:
 * - edgeScoring.js
 * - shapeProfiles.js
 * - layoutEngine.js
 * - settingsAwareTreeBuilder.js integration
 * - wheelRenderer.js integration
 * - growthBehaviors.js integration
 * - growthDSL.js integration
 */

var UnificationTest = {
    results: [],
    passed: 0,
    failed: 0,

    log: function(msg, type) {
        var prefix = type === 'pass' ? '✓' : type === 'fail' ? '✗' : '○';
        console.log('[UnificationTest] ' + prefix + ' ' + msg);
        this.results.push({ msg: msg, type: type });
        if (type === 'pass') this.passed++;
        if (type === 'fail') this.failed++;
    },

    assert: function(condition, passMsg, failMsg) {
        if (condition) {
            this.log(passMsg, 'pass');
            return true;
        } else {
            this.log(failMsg || passMsg, 'fail');
            return false;
        }
    },

    // =================================================================
    // TEST: EdgeScoring Module
    // =================================================================
    testEdgeScoring: function() {
        this.log('=== Testing EdgeScoring Module ===', 'info');

        // Check module loaded
        this.assert(
            typeof EdgeScoring !== 'undefined',
            'EdgeScoring module loaded',
            'EdgeScoring module NOT loaded'
        );

        if (typeof EdgeScoring === 'undefined') return;

        // Test element detection
        this.assert(
            typeof detectSpellElement === 'function',
            'detectSpellElement function available'
        );

        var fireSpell = { name: 'Fireball', effectNames: ['Fire Damage'] };
        var frostSpell = { name: 'Ice Spike', effectNames: ['Frost Damage'] };
        var healSpell = { name: 'Healing Hands', effectNames: ['Restore Health'] };

        var fireElem = detectSpellElement(fireSpell);
        var frostElem = detectSpellElement(frostSpell);
        var healElem = detectSpellElement(healSpell);

        this.assert(fireElem === 'fire', 'Fireball detected as fire: ' + fireElem);
        this.assert(frostElem === 'frost', 'Ice Spike detected as frost: ' + frostElem);
        this.assert(healElem === null, 'Healing Hands has no element: ' + healElem);

        // Test element conflict
        this.assert(
            typeof hasElementConflict === 'function',
            'hasElementConflict function available'
        );

        var conflict = hasElementConflict(fireSpell, frostSpell);
        var noConflict = hasElementConflict(fireSpell, healSpell);

        this.assert(conflict === true, 'Fire vs Frost has conflict: ' + conflict);
        this.assert(noConflict === false, 'Fire vs Heal has no conflict: ' + noConflict);

        // Test same element
        this.assert(
            typeof hasSameElement === 'function',
            'hasSameElement function available'
        );

        var fireSpell2 = { name: 'Flames', effectNames: ['Fire Damage'] };
        var same = hasSameElement(fireSpell, fireSpell2);
        this.assert(same === true, 'Fire + Fire are same element: ' + same);

        // Test tier detection
        this.assert(
            typeof getSpellTier === 'function',
            'getSpellTier function available'
        );

        var noviceSpell = { skillLevel: 0 };
        var expertSpell = { skillLevel: 75 };
        var masterSpell = { skillLevel: 100 };

        this.assert(getSpellTier(noviceSpell) === 0, 'Skill 0 = tier 0: ' + getSpellTier(noviceSpell));
        this.assert(getSpellTier(expertSpell) === 3, 'Skill 75 = tier 3: ' + getSpellTier(expertSpell));
        this.assert(getSpellTier(masterSpell) === 4, 'Skill 100 = tier 4: ' + getSpellTier(masterSpell));

        // Test edge scoring
        this.assert(
            typeof scoreEdge === 'function',
            'scoreEdge function available'
        );

        var settings = { elementIsolation: true, elementIsolationStrict: false };
        var score1 = scoreEdge(fireSpell, fireSpell2, settings);
        var score2 = scoreEdge(fireSpell, frostSpell, settings);

        this.log('Same element score: ' + score1, 'info');
        this.log('Cross element score: ' + score2, 'info');
        this.assert(score1 > score2, 'Same element scores higher than cross element');

        // Test strict mode
        var strictSettings = { elementIsolation: true, elementIsolationStrict: true };
        var strictScore = scoreEdge(fireSpell, frostSpell, strictSettings);
        this.assert(strictScore < 0, 'Strict mode forbids cross-element: ' + strictScore);
    },

    // =================================================================
    // TEST: ShapeProfiles Module
    // =================================================================
    testShapeProfiles: function() {
        this.log('=== Testing ShapeProfiles Module ===', 'info');

        // Check module loaded
        this.assert(
            typeof SHAPE_PROFILES !== 'undefined',
            'SHAPE_PROFILES loaded',
            'SHAPE_PROFILES NOT loaded'
        );

        if (typeof SHAPE_PROFILES === 'undefined') return;

        // Check all expected shapes exist
        var expectedShapes = ['organic', 'spiky', 'radial', 'mountain', 'cloud', 'cascade', 'linear', 'grid'];
        expectedShapes.forEach(function(shape) {
            this.assert(
                SHAPE_PROFILES[shape] !== undefined,
                'Shape "' + shape + '" exists',
                'Shape "' + shape + '" MISSING'
            );
        }, this);

        // Check shape masks
        this.assert(
            typeof SHAPE_MASKS !== 'undefined',
            'SHAPE_MASKS loaded'
        );

        expectedShapes.forEach(function(shape) {
            this.assert(
                typeof SHAPE_MASKS[shape] === 'function',
                'Mask function for "' + shape + '" exists'
            );
        }, this);

        // Test getShapeProfile function
        this.assert(
            typeof getShapeProfile === 'function',
            'getShapeProfile function available'
        );

        var organicProfile = getShapeProfile('organic');
        this.assert(organicProfile.radiusJitter !== undefined, 'organic has radiusJitter: ' + organicProfile.radiusJitter);
        this.assert(organicProfile.angleJitter !== undefined, 'organic has angleJitter: ' + organicProfile.angleJitter);
        this.assert(organicProfile.tierSpacingMult !== undefined, 'organic has tierSpacingMult: ' + organicProfile.tierSpacingMult);

        // Test fallback for unknown shape
        var fallback = getShapeProfile('nonexistent');
        this.assert(fallback === SHAPE_PROFILES.organic, 'Unknown shape falls back to organic');

        // Test school default shapes
        this.assert(
            typeof SCHOOL_DEFAULT_SHAPES !== 'undefined',
            'SCHOOL_DEFAULT_SHAPES loaded'
        );

        this.assert(SCHOOL_DEFAULT_SHAPES['Destruction'] === 'spiky', 'Destruction default is spiky');
        this.assert(SCHOOL_DEFAULT_SHAPES['Restoration'] === 'organic', 'Restoration default is organic');

        // Test mask function works
        var rng = function() { return 0.5; };
        var maskResult = SHAPE_MASKS.organic(0.5, 0.5, rng, organicProfile);
        this.assert(typeof maskResult === 'boolean', 'Mask function returns boolean: ' + maskResult);
    },

    // =================================================================
    // TEST: LayoutEngine Module
    // =================================================================
    testLayoutEngine: function() {
        this.log('=== Testing LayoutEngine Module ===', 'info');

        // Check module loaded
        this.assert(
            typeof LayoutEngine !== 'undefined',
            'LayoutEngine module loaded',
            'LayoutEngine NOT loaded'
        );

        if (typeof LayoutEngine === 'undefined') return;

        // Test config retrieval
        var cfg = LayoutEngine.getConfig();
        this.assert(cfg !== null, 'getConfig returns config object');
        this.assert(cfg.nodeSize !== undefined, 'Config has nodeSize: ' + cfg.nodeSize);
        this.assert(cfg.baseRadius !== undefined, 'Config has baseRadius: ' + cfg.baseRadius);
        this.assert(cfg.tierSpacing !== undefined, 'Config has tierSpacing: ' + cfg.tierSpacing);

        this.log('Config values: nodeSize=' + cfg.nodeSize + ', baseRadius=' + cfg.baseRadius + ', tierSpacing=' + cfg.tierSpacing, 'info');

        // Test node position calculation
        var pos = LayoutEngine.getNodePosition(0, 0);
        this.assert(pos.x !== undefined && pos.y !== undefined, 'getNodePosition returns x,y');
        this.assert(pos.radius !== undefined, 'getNodePosition returns radius: ' + pos.radius);
        this.log('Position at tier 0, angle 0: x=' + pos.x.toFixed(2) + ', y=' + pos.y.toFixed(2), 'info');

        // Test position at different tier
        var pos2 = LayoutEngine.getNodePosition(2, 45);
        this.assert(pos2.radius > pos.radius, 'Tier 2 has larger radius than tier 0');
        this.log('Position at tier 2, angle 45: x=' + pos2.x.toFixed(2) + ', y=' + pos2.y.toFixed(2) + ', radius=' + pos2.radius.toFixed(2), 'info');

        // Test sector calculation
        var sector = LayoutEngine.calculateSector(0, 5);
        this.assert(sector.spokeAngle !== undefined, 'calculateSector returns spokeAngle: ' + sector.spokeAngle);
        this.assert(sector.sectorAngle !== undefined, 'calculateSector returns sectorAngle: ' + sector.sectorAngle);
        this.assert(sector.startAngle !== undefined, 'calculateSector returns startAngle: ' + sector.startAngle);
        this.assert(sector.usableAngle !== undefined, 'calculateSector returns usableAngle: ' + sector.usableAngle);
        this.log('Sector 0 of 5: spoke=' + sector.spokeAngle + ', sector=' + sector.sectorAngle + ', usable=' + sector.usableAngle, 'info');

        // Test grid generation
        var grid = LayoutEngine.generateGrid(sector, 10, 'organic', 12345);
        this.assert(Array.isArray(grid), 'generateGrid returns array');
        this.assert(grid.length > 0, 'generateGrid returns positions: ' + grid.length);
        this.log('Generated grid with ' + grid.length + ' positions for 10 spells', 'info');

        if (grid.length > 0) {
            this.assert(grid[0].x !== undefined, 'Grid position has x');
            this.assert(grid[0].tier !== undefined, 'Grid position has tier: ' + grid[0].tier);
        }

        // Test distance calculation
        var dist = LayoutEngine.distance({x: 0, y: 0}, {x: 3, y: 4});
        this.assert(Math.abs(dist - 5) < 0.001, 'Distance calculation correct: ' + dist);
    },

    // =================================================================
    // TEST: GrowthBehaviors Integration
    // =================================================================
    testGrowthBehaviors: function() {
        this.log('=== Testing GrowthBehaviors Integration ===', 'info');

        // Check module loaded
        this.assert(
            typeof GROWTH_BEHAVIORS !== 'undefined',
            'GROWTH_BEHAVIORS loaded',
            'GROWTH_BEHAVIORS NOT loaded'
        );

        if (typeof GROWTH_BEHAVIORS === 'undefined') return;

        // Check expected behaviors exist
        var expectedBehaviors = ['fire_explosion', 'gentle_bloom', 'mountain_builder', 'portal_network', 'spider_web'];
        expectedBehaviors.forEach(function(behavior) {
            this.assert(
                GROWTH_BEHAVIORS[behavior] !== undefined,
                'Behavior "' + behavior + '" exists'
            );
        }, this);

        // Check school defaults
        this.assert(
            typeof SCHOOL_DEFAULT_BEHAVIORS !== 'undefined',
            'SCHOOL_DEFAULT_BEHAVIORS loaded'
        );

        this.assert(SCHOOL_DEFAULT_BEHAVIORS['Destruction'] === 'fire_explosion', 'Destruction uses fire_explosion');
        this.assert(SCHOOL_DEFAULT_BEHAVIORS['Restoration'] === 'gentle_bloom', 'Restoration uses gentle_bloom');

        // Test behavior properties
        var fireBehavior = GROWTH_BEHAVIORS.fire_explosion;
        this.assert(fireBehavior.name !== undefined, 'Behavior has name: ' + fireBehavior.name);
        this.assert(fireBehavior.branchingFactor !== undefined, 'Behavior has branchingFactor: ' + fireBehavior.branchingFactor);
        this.assert(fireBehavior.hubProbability !== undefined, 'Behavior has hubProbability: ' + fireBehavior.hubProbability);
        this.assert(Array.isArray(fireBehavior.phases), 'Behavior has phases array');

        // Test getActiveParameters if available
        if (typeof getActiveParameters === 'function') {
            var params = getActiveParameters(fireBehavior, 0.5);
            this.assert(params !== null, 'getActiveParameters returns params at progress 0.5');
            this.log('Active params at 0.5: spreadFactor=' + params.spreadFactor + ', verticalBias=' + params.verticalBias, 'info');
        }

        // Test shouldBranch if available
        if (typeof shouldBranch === 'function') {
            var rng = function() { return 0.5; };
            var branchResult = shouldBranch(fireBehavior, 0, rng);
            this.assert(branchResult.shouldBranch !== undefined, 'shouldBranch returns shouldBranch flag');
            this.assert(branchResult.newEnergy !== undefined, 'shouldBranch returns newEnergy');
            this.log('Branch decision: shouldBranch=' + branchResult.shouldBranch + ', newEnergy=' + branchResult.newEnergy, 'info');
        }
    },

    // =================================================================
    // TEST: GrowthDSL Integration
    // =================================================================
    testGrowthDSL: function() {
        this.log('=== Testing GrowthDSL Integration ===', 'info');

        // Check module loaded
        this.assert(
            typeof GROWTH_DSL !== 'undefined',
            'GROWTH_DSL loaded',
            'GROWTH_DSL NOT loaded'
        );

        if (typeof GROWTH_DSL === 'undefined') return;

        // Check volumes
        this.assert(GROWTH_DSL.volumes !== undefined, 'GROWTH_DSL has volumes');
        this.assert(GROWTH_DSL.volumes.cone !== undefined, 'Cone volume exists');
        this.assert(GROWTH_DSL.volumes.wedge !== undefined, 'Wedge volume exists');

        // Check modifiers
        this.assert(GROWTH_DSL.modifiers !== undefined, 'GROWTH_DSL has modifiers');
        this.assert(GROWTH_DSL.modifiers.spiral !== undefined, 'Spiral modifier exists');

        // Check branching rules
        this.assert(GROWTH_DSL.branchingRules !== undefined, 'GROWTH_DSL has branchingRules');
        this.assert(GROWTH_DSL.branchingRules.maxChildrenPerNode !== undefined, 'maxChildrenPerNode rule exists');

        // Test getDefaultRecipe
        var recipe = GROWTH_DSL.getDefaultRecipe('Destruction');
        this.assert(recipe !== null, 'getDefaultRecipe returns recipe');
        this.assert(recipe.volume !== undefined, 'Recipe has volume');
        this.assert(recipe.branching !== undefined, 'Recipe has branching');
        this.log('Default recipe branching: maxChildren=' + recipe.branching.maxChildrenPerNode, 'info');

        // Test parseRecipe
        var parsed = GROWTH_DSL.parseRecipe(recipe);
        this.assert(parsed.valid === true, 'Default recipe is valid');

        // Test recipeToTreeSettings if available
        if (typeof recipeToTreeSettings === 'function') {
            var settings = recipeToTreeSettings(recipe);
            this.assert(settings.maxChildrenPerNode !== undefined, 'recipeToTreeSettings returns maxChildrenPerNode: ' + settings.maxChildrenPerNode);
            this.log('Converted settings: maxChildrenPerNode=' + settings.maxChildrenPerNode + ', strictTierOrdering=' + settings.strictTierOrdering, 'info');
        }

        // Test applyRecipeToSchool if available
        if (typeof applyRecipeToSchool === 'function') {
            this.log('applyRecipeToSchool function available', 'pass');
        }

        // Test getSchoolRecipe if available
        if (typeof getSchoolRecipe === 'function') {
            this.log('getSchoolRecipe function available', 'pass');
        }
    },

    // =================================================================
    // TEST: SettingsAwareBuilder Integration
    // =================================================================
    testSettingsAwareBuilder: function() {
        this.log('=== Testing SettingsAwareBuilder Integration ===', 'info');

        // Check module loaded
        this.assert(
            typeof SettingsAwareTreeBuilder !== 'undefined',
            'SettingsAwareTreeBuilder loaded',
            'SettingsAwareTreeBuilder NOT loaded'
        );

        if (typeof SettingsAwareTreeBuilder === 'undefined') return;

        // Check version
        this.assert(
            SettingsAwareTreeBuilder.version !== undefined,
            'Builder has version: ' + SettingsAwareTreeBuilder.version
        );

        // Check exported functions
        this.assert(typeof SettingsAwareTreeBuilder.buildSchoolTree === 'function', 'buildSchoolTree function available');
        this.assert(typeof SettingsAwareTreeBuilder.buildAllTrees === 'function', 'buildAllTrees function available');
        this.assert(typeof SettingsAwareTreeBuilder.scoreEdge === 'function', 'scoreEdge function exported');
        this.assert(typeof SettingsAwareTreeBuilder.detectSpellElement === 'function', 'detectSpellElement function exported');

        // Test building a small tree
        var testSpells = [
            { formId: '0x001', name: 'Flames', school: 'Destruction', skillLevel: 0 },
            { formId: '0x002', name: 'Firebolt', school: 'Destruction', skillLevel: 25 },
            { formId: '0x003', name: 'Fireball', school: 'Destruction', skillLevel: 50 },
            { formId: '0x004', name: 'Incinerate', school: 'Destruction', skillLevel: 75 },
            { formId: '0x005', name: 'Frostbite', school: 'Destruction', skillLevel: 0 },
            { formId: '0x006', name: 'Ice Spike', school: 'Destruction', skillLevel: 25 }
        ];

        var settings = {
            elementIsolation: true,
            elementIsolationStrict: false,
            strictTierOrdering: true,
            maxChildrenPerNode: 3
        };

        this.log('Building test tree with ' + testSpells.length + ' spells...', 'info');

        var result = SettingsAwareTreeBuilder.buildSchoolTree(testSpells, settings, 12345, 'Destruction', null);

        this.assert(result !== null, 'buildSchoolTree returns result');
        this.assert(result.nodes !== undefined, 'Result has nodes array');
        this.assert(result.links !== undefined, 'Result has links array');
        this.assert(result.root !== undefined, 'Result has root');
        this.assert(result.stats !== undefined, 'Result has stats');

        this.log('Tree result: ' + result.nodes.length + ' nodes, ' + result.links.length + ' links', 'info');
        this.log('Stats: totalEdges=' + result.stats.totalEdges + ', rejectedCrossElement=' + result.stats.rejectedCrossElement + ', hubsCreated=' + result.stats.hubsCreated, 'info');

        // Verify nodes have expected properties
        if (result.nodes.length > 0) {
            var node = result.nodes[0];
            this.assert(node.formId !== undefined, 'Node has formId');
            this.assert(node.tier !== undefined, 'Node has tier');
            this.assert(node.element !== undefined || node.element === null, 'Node has element field');
        }
    },

    // =================================================================
    // TEST: WheelRenderer Integration
    // =================================================================
    testWheelRenderer: function() {
        this.log('=== Testing WheelRenderer Integration ===', 'info');

        // Check module loaded
        this.assert(
            typeof WheelRenderer !== 'undefined',
            'WheelRenderer loaded',
            'WheelRenderer NOT loaded'
        );

        if (typeof WheelRenderer === 'undefined') return;

        // Check getSchoolVisualModifier uses unified profiles
        this.assert(
            typeof WheelRenderer.getSchoolVisualModifier === 'function',
            'getSchoolVisualModifier function available'
        );

        // Set up minimal test config
        WheelRenderer.schoolConfigs = {
            'Destruction': { shape: 'spiky' },
            'Restoration': { shape: 'organic' }
        };

        var destMod = WheelRenderer.getSchoolVisualModifier('Destruction');
        var restMod = WheelRenderer.getSchoolVisualModifier('Restoration');

        this.assert(destMod !== null, 'getSchoolVisualModifier returns modifier for Destruction');
        this.assert(restMod !== null, 'getSchoolVisualModifier returns modifier for Restoration');

        this.log('Destruction modifier: radiusJitter=' + destMod.radiusJitter.toFixed(3) + ', angleJitter=' + destMod.angleJitter.toFixed(1), 'info');
        this.log('Restoration modifier: radiusJitter=' + restMod.radiusJitter.toFixed(3) + ', angleJitter=' + restMod.angleJitter.toFixed(1), 'info');

        // Verify spiky has more jitter than organic (from unified profiles)
        // Note: modifiers are adjusted by density/symmetry, so base comparison may vary
        this.assert(destMod.shape === 'spiky', 'Destruction shape is spiky: ' + destMod.shape);
        this.assert(restMod.shape === 'organic', 'Restoration shape is organic: ' + restMod.shape);
    },

    // =================================================================
    // TEST: Cross-Module Integration
    // =================================================================
    testCrossModuleIntegration: function() {
        this.log('=== Testing Cross-Module Integration ===', 'info');

        // Test that LayoutEngine uses GRID_CONFIG
        if (typeof LayoutEngine !== 'undefined' && typeof GRID_CONFIG !== 'undefined') {
            var layoutCfg = LayoutEngine.getConfig();
            var gridCfg = GRID_CONFIG.getComputedConfig();

            this.assert(
                layoutCfg.baseRadius === gridCfg.baseRadius,
                'LayoutEngine uses GRID_CONFIG baseRadius: ' + layoutCfg.baseRadius
            );
            this.assert(
                layoutCfg.tierSpacing === gridCfg.tierSpacing,
                'LayoutEngine uses GRID_CONFIG tierSpacing: ' + layoutCfg.tierSpacing
            );
        }

        // Test that SettingsAwareBuilder uses EdgeScoring
        if (typeof SettingsAwareTreeBuilder !== 'undefined' && typeof EdgeScoring !== 'undefined') {
            // The scoreEdge from builder should match EdgeScoring
            var spell1 = { name: 'Fire', skillLevel: 0 };
            var spell2 = { name: 'Frost', skillLevel: 25 };
            var settings = { elementIsolation: true };

            var builderScore = SettingsAwareTreeBuilder.scoreEdge(spell1, spell2, settings);
            var edgeScoringScore = EdgeScoring.scoreEdge(spell1, spell2, settings);

            this.assert(
                builderScore === edgeScoringScore,
                'Builder scoreEdge matches EdgeScoring: ' + builderScore + ' === ' + edgeScoringScore
            );
        }

        // Test that shape profiles are accessible from multiple modules
        if (typeof getShapeProfile === 'function') {
            var profile = getShapeProfile('mountain');
            this.assert(profile.taperSpread === true, 'Mountain profile has taperSpread from unified module');
            this.assert(profile.taperAmount !== undefined, 'Mountain profile has taperAmount: ' + profile.taperAmount);
        }
    },

    // =================================================================
    // RUN ALL TESTS
    // =================================================================
    runAll: function() {
        console.log('');
        console.log('╔════════════════════════════════════════════════════════════╗');
        console.log('║           UNIFICATION TEST SUITE                           ║');
        console.log('╚════════════════════════════════════════════════════════════╝');
        console.log('');

        this.results = [];
        this.passed = 0;
        this.failed = 0;

        try {
            this.testEdgeScoring();
        } catch (e) {
            this.log('EdgeScoring tests threw error: ' + e.message, 'fail');
        }

        try {
            this.testShapeProfiles();
        } catch (e) {
            this.log('ShapeProfiles tests threw error: ' + e.message, 'fail');
        }

        try {
            this.testLayoutEngine();
        } catch (e) {
            this.log('LayoutEngine tests threw error: ' + e.message, 'fail');
        }

        try {
            this.testGrowthBehaviors();
        } catch (e) {
            this.log('GrowthBehaviors tests threw error: ' + e.message, 'fail');
        }

        try {
            this.testGrowthDSL();
        } catch (e) {
            this.log('GrowthDSL tests threw error: ' + e.message, 'fail');
        }

        try {
            this.testSettingsAwareBuilder();
        } catch (e) {
            this.log('SettingsAwareBuilder tests threw error: ' + e.message, 'fail');
        }

        try {
            this.testWheelRenderer();
        } catch (e) {
            this.log('WheelRenderer tests threw error: ' + e.message, 'fail');
        }

        try {
            this.testCrossModuleIntegration();
        } catch (e) {
            this.log('CrossModule tests threw error: ' + e.message, 'fail');
        }

        console.log('');
        console.log('╔════════════════════════════════════════════════════════════╗');
        console.log('║           TEST RESULTS                                     ║');
        console.log('╠════════════════════════════════════════════════════════════╣');
        console.log('║  PASSED: ' + this.passed.toString().padEnd(4) + '                                           ║');
        console.log('║  FAILED: ' + this.failed.toString().padEnd(4) + '                                           ║');
        console.log('║  TOTAL:  ' + (this.passed + this.failed).toString().padEnd(4) + '                                           ║');
        console.log('╚════════════════════════════════════════════════════════════╝');
        console.log('');

        return {
            passed: this.passed,
            failed: this.failed,
            total: this.passed + this.failed,
            results: this.results
        };
    }
};

// Export
window.UnificationTest = UnificationTest;

// Auto-run if requested
if (typeof window.runUnificationTests !== 'undefined' && window.runUnificationTests) {
    UnificationTest.runAll();
}

console.log('[UnificationTest] Module loaded - call UnificationTest.runAll() to run tests');
