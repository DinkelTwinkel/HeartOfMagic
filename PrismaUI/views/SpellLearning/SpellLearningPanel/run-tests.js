/**
 * Node.js Test Runner for Unification Tests
 *
 * Run with: node run-tests.js
 */

// Mock browser globals
global.window = global;
global.document = {
    getElementById: function() { return null; },
    querySelector: function() { return null; },
    createElementNS: function() { return { setAttribute: function() {} }; }
};
global.console = console;

// Mock settings
global.settings = {
    schoolColors: {},
    schoolVisibility: {},
    schoolConfigs: {},
    treeGeneration: { llm: { enabled: false } }
};

// Mock callCpp
global.callCpp = function(method, data) {
    return null;
};

// Track loaded modules
var loadedModules = [];

function loadModule(name, path) {
    try {
        require(path);
        loadedModules.push(name);
        console.log('✓ Loaded: ' + name);
    } catch (e) {
        console.log('✗ Failed to load ' + name + ': ' + e.message);
    }
}

console.log('');
console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║     SpellLearning Module Loader                            ║');
console.log('╚════════════════════════════════════════════════════════════╝');
console.log('');

// Load modules in order
loadModule('constants', './modules/constants.js');
loadModule('state', './modules/state.js');
loadModule('config', './modules/config.js');
loadModule('edgeScoring', './modules/edgeScoring.js');
loadModule('shapeProfiles', './modules/shapeProfiles.js');
loadModule('layoutEngine', './modules/layoutEngine.js');
loadModule('growthBehaviors', './modules/growthBehaviors.js');
loadModule('growthDSL', './modules/growthDSL.js');
loadModule('settingsAwareTreeBuilder', './modules/settingsAwareTreeBuilder.js');

// Mock WheelRenderer minimally
global.WheelRenderer = {
    schoolConfigs: {},
    shapeVisualModifiers: {
        organic: { radiusJitter: 0.2, angleJitter: 12, tierSpacingMult: 0.9, spreadMult: 0.95 },
        spiky: { radiusJitter: 0.35, angleJitter: 20, tierSpacingMult: 1.4, spreadMult: 0.6 }
    },
    getSchoolVisualModifier: function(schoolName) {
        var cfg = this.schoolConfigs[schoolName];
        var shape = cfg ? cfg.shape : 'organic';

        var modifier;
        if (typeof getShapeProfile === 'function') {
            modifier = getShapeProfile(shape);
        } else {
            modifier = this.shapeVisualModifiers[shape] || this.shapeVisualModifiers.organic;
        }

        var density = cfg ? (cfg.density || 0.6) : 0.6;
        var symmetry = cfg ? (cfg.symmetry || 0.3) : 0.3;
        var densityFactor = 1.5 - density;
        var symmetryFactor = 1 - symmetry * 0.8;

        return {
            radiusJitter: modifier.radiusJitter * densityFactor * symmetryFactor,
            angleJitter: modifier.angleJitter * densityFactor * symmetryFactor,
            tierSpacingMult: modifier.tierSpacingMult * (0.6 + density * 0.8),
            spreadMult: modifier.spreadMult * (0.5 + density * 0.7),
            curveEdges: modifier.curveEdges,
            taperSpread: modifier.taperSpread || false,
            shape: shape
        };
    }
};

console.log('');
console.log('Loaded ' + loadedModules.length + ' modules');
console.log('');

// Load and run tests
loadModule('unificationTest', './modules/unificationTest.js');

console.log('');
console.log('Running tests...');
console.log('');

if (typeof UnificationTest !== 'undefined') {
    var results = UnificationTest.runAll();

    // Exit with appropriate code
    process.exit(results.failed > 0 ? 1 : 0);
} else {
    console.log('ERROR: UnificationTest not loaded');
    process.exit(1);
}
