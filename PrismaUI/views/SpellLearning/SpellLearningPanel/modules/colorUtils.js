/**
 * SpellLearning Color Utilities Module
 * 
 * Handles dynamic school color management, CSS generation, and color conversions.
 * Depends on: state.js (settings), constants.js (DEFAULT_COLOR_PALETTE)
 */

// =============================================================================
// SCHOOL COLOR MANAGEMENT
// =============================================================================

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
    if (typeof autoSaveSettings === 'function') autoSaveSettings();
    
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

// =============================================================================
// COLOR CONVERSION UTILITIES
// =============================================================================

// Cache for hexToRgba results — keyed by hex + '_' + alpha
var _rgbaCache = {};

// Convert hex to rgba with specified alpha (cached)
function hexToRgba(hex, alpha) {
    var cacheKey = hex + '_' + alpha;
    if (_rgbaCache[cacheKey]) {
        return _rgbaCache[cacheKey];
    }

    var r, g, b;
    var result;

    if (hex.startsWith('hsl')) {
        result = hex.replace('hsl(', 'hsla(').replace(')', ', ' + alpha + ')');
        _rgbaCache[cacheKey] = result;
        return result;
    }

    var cleanHex = hex.replace('#', '');
    if (cleanHex.length === 3) {
        r = parseInt(cleanHex[0] + cleanHex[0], 16);
        g = parseInt(cleanHex[1] + cleanHex[1], 16);
        b = parseInt(cleanHex[2] + cleanHex[2], 16);
    } else {
        r = parseInt(cleanHex.substr(0, 2), 16);
        g = parseInt(cleanHex.substr(2, 2), 16);
        b = parseInt(cleanHex.substr(4, 2), 16);
    }

    result = 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
    _rgbaCache[cacheKey] = result;
    return result;
}

// Convert hex to rgba fill color (more opaque for unlocked fills)
function hexToRgbaFill(hex) {
    var r, g, b;
    
    if (hex.startsWith('hsl')) {
        return hex.replace('hsl(', 'hsla(').replace(')', ', 0.9)');
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
    
    // Darken slightly for fill
    r = Math.round(r * 0.7);
    g = Math.round(g * 0.7);
    b = Math.round(b * 0.7);
    
    return 'rgba(' + r + ', ' + g + ', ' + b + ', 0.9)';
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

// =============================================================================
// SCHOOL DETECTION
// =============================================================================

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
                    settings.schoolColors[HEDGE_WIZARD] = '#9ca3af';
                }
            }
            
            // Ensure color is assigned
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
            if (typeof suggestSchoolColorsWithLLM === 'function') {
                suggestSchoolColorsWithLLM();
            }
        }, 500);
    } else if (newSchools.length > 0) {
        console.log('[SpellLearning] New schools detected:', newSchools.join(', '), '- using palette colors');
    }
    
    return schoolList;
}

// Update school color picker UI with visibility toggles
function updateSchoolColorPickerUI() {
    var container = document.getElementById('schoolColorsContainer');
    if (!container) return;
    
    container.innerHTML = '';
    
    var schools = Object.keys(settings.schoolColors).sort();
    
    // Ensure visibility settings exist for all schools
    if (!settings.schoolVisibility) settings.schoolVisibility = {};
    schools.forEach(function(s) {
        if (settings.schoolVisibility[s] === undefined) {
            settings.schoolVisibility[s] = true;  // Visible by default
        }
    });
    
    schools.forEach(function(school) {
        var color = settings.schoolColors[school];
        var isVisible = settings.schoolVisibility[school] !== false;
        
        var item = document.createElement('div');
        item.className = 'school-color-item' + (isVisible ? '' : ' hidden-school');
        
        // Visibility toggle
        var toggleLabel = document.createElement('label');
        toggleLabel.className = 'school-visibility-toggle';
        toggleLabel.title = 'Show/hide ' + school + ' on tree';
        
        var toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.checked = isVisible;
        toggle.dataset.school = school;
        toggle.addEventListener('change', function(e) {
            var schoolName = e.target.dataset.school;
            var isNowVisible = e.target.checked;
            
            console.log('[SpellLearning] School visibility toggle:', schoolName, '=', isNowVisible);
            
            settings.schoolVisibility[schoolName] = isNowVisible;
            e.target.parentElement.parentElement.classList.toggle('hidden-school', !isNowVisible);
            
            // Immediately update tree (don't wait for auto-save)
            if (typeof WheelRenderer !== 'undefined' && WheelRenderer.nodes && WheelRenderer.nodes.length > 0) {
                console.log('[SpellLearning] Re-laying out tree for visibility change');
                try {
                    WheelRenderer.layout();
                    WheelRenderer.render();
                } catch (err) {
                    console.error('[SpellLearning] Error updating tree:', err);
                }
            } else {
                console.log('[SpellLearning] No tree data to update');
            }
            
            // Save after visual update
            if (typeof autoSaveSettings === 'function') autoSaveSettings();
        });
        toggleLabel.appendChild(toggle);
        
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
            if (typeof autoSaveSettings === 'function') autoSaveSettings();
            
            // Re-render tree if visible
            if (typeof WheelRenderer !== 'undefined' && WheelRenderer.nodes && WheelRenderer.nodes.length > 0) {
                WheelRenderer.render();
            }
        });
        
        item.appendChild(toggleLabel);
        item.appendChild(label);
        item.appendChild(picker);
        container.appendChild(item);
    });
    
    // Show message if no schools yet
    if (schools.length === 0) {
        container.innerHTML = '<span class="setting-desc">Scan spells to detect schools</span>';
    }
}
