/**
 * SpellLearning UI Helpers Module
 * 
 * Contains utility functions for status updates, presets, dragging, resizing.
 * Depends on: state.js
 */

// =============================================================================
// STATUS UPDATES
// =============================================================================

function updateStatus(message) {
    var statusText = document.getElementById('statusText');
    if (statusText) {
        statusText.textContent = message;
    }
}

function setStatusIcon(icon) {
    var statusIcon = document.getElementById('statusIcon');
    if (statusIcon) {
        statusIcon.textContent = icon;
    }
}

function updateCharCount() {
    var outputArea = document.getElementById('outputArea');
    var charCount = document.getElementById('charCount');
    if (outputArea && charCount) {
        charCount.textContent = outputArea.value.length + ' chars';
    }
}

function setTreeStatus(msg) {
    var el = document.getElementById('tree-status-text');
    if (el) el.textContent = msg;
}

// =============================================================================
// FIELD PRESETS
// =============================================================================

function applyPreset(presetName) {
    var presets = {
        minimal: {
            editorId: false, magickaCost: false, minimumSkill: false,
            castingType: false, delivery: false, chargeTime: false,
            plugin: false, effects: false, effectNames: false, keywords: false
        },
        balanced: {
            editorId: true, magickaCost: true, minimumSkill: false,
            castingType: false, delivery: false, chargeTime: false,
            plugin: false, effects: false, effectNames: false, keywords: false
        },
        full: {
            editorId: true, magickaCost: true, minimumSkill: true,
            castingType: true, delivery: true, chargeTime: true,
            plugin: true, effects: true, effectNames: false, keywords: true
        }
    };
    
    var preset = presets[presetName];
    if (!preset) return;
    
    for (var field in preset) {
        state.fields[field] = preset[field];
        var checkbox = document.getElementById('field_' + field);
        if (checkbox) checkbox.checked = preset[field];
    }
}

// =============================================================================
// DRAGGING
// =============================================================================

function initializeDragging() {
    var header = document.getElementById('panelHeader');
    var panel = document.getElementById('spellPanel');
    
    var offsetX = 0, offsetY = 0;
    
    header.addEventListener('mousedown', function(e) {
        if (e.target.closest('.header-btn')) return;
        
        state.isDragging = true;
        var rect = panel.getBoundingClientRect();
        offsetX = e.clientX - rect.left - rect.width / 2;
        offsetY = e.clientY - rect.top - rect.height / 2;
        panel.style.transition = 'none';
    });
    
    document.addEventListener('mousemove', function(e) {
        if (!state.isDragging) return;
        
        var x = e.clientX - offsetX;
        var y = e.clientY - offsetY;
        
        panel.style.left = x + 'px';
        panel.style.top = y + 'px';
        panel.style.transform = 'translate(-50%, -50%)';
    });
    
    document.addEventListener('mouseup', function() {
        if (state.isDragging) {
            state.isDragging = false;
            panel.style.transition = '';
            
            // Save position
            var rect = panel.getBoundingClientRect();
            settings.windowX = rect.left + rect.width / 2;
            settings.windowY = rect.top + rect.height / 2;
            if (typeof autoSaveSettings === 'function') autoSaveSettings();
        }
    });
}

// =============================================================================
// RESIZING
// =============================================================================

function initializeResizing() {
    var handle = document.getElementById('resizeHandle');
    var panel = document.getElementById('spellPanel');
    
    var startWidth, startHeight, startX, startY;
    
    handle.addEventListener('mousedown', function(e) {
        e.preventDefault();
        state.isResizing = true;
        
        var rect = panel.getBoundingClientRect();
        startWidth = rect.width;
        startHeight = rect.height;
        startX = e.clientX;
        startY = e.clientY;
    });
    
    document.addEventListener('mousemove', function(e) {
        if (!state.isResizing) return;
        
        var newWidth = startWidth + (e.clientX - startX);
        var newHeight = startHeight + (e.clientY - startY);
        
        // Apply constraints
        newWidth = Math.max(500, Math.min(window.innerWidth * 0.95, newWidth));
        newHeight = Math.max(500, Math.min(window.innerHeight * 0.9, newHeight));
        
        panel.style.width = newWidth + 'px';
        panel.style.height = newHeight + 'px';
    });
    
    document.addEventListener('mouseup', function() {
        if (state.isResizing) {
            state.isResizing = false;
            
            // Save size
            var rect = panel.getBoundingClientRect();
            settings.windowWidth = rect.width;
            settings.windowHeight = rect.height;
            if (typeof autoSaveSettings === 'function') autoSaveSettings();
        }
    });
}

// =============================================================================
// MINIMIZE & CLOSE
// =============================================================================

function toggleMinimize() {
    var panel = document.getElementById('spellPanel');
    state.isMinimized = !state.isMinimized;
    panel.classList.toggle('minimized', state.isMinimized);
    
    var btn = document.getElementById('minimizeBtn');
    btn.textContent = state.isMinimized ? '□' : '─';
}

function onCloseClick() {
    // Auto-save settings when closing
    if (typeof autoSaveSettings === 'function') autoSaveSettings();
    
    // Actually close the panel via C++
    if (window.callCpp) {
        window.callCpp('HidePanel', '');
    } else {
        updateStatus('Press F9 to close');
    }
}

// =============================================================================
// XP UTILITIES
// =============================================================================

function getXPForTier(tierName) {
    if (!tierName) return settings.xpNovice;
    
    switch (tierName.toLowerCase()) {
        case 'novice': return settings.xpNovice;
        case 'apprentice': return settings.xpApprentice;
        case 'adept': return settings.xpAdept;
        case 'expert': return settings.xpExpert;
        case 'master': return settings.xpMaster;
        default: return settings.xpNovice;
    }
}
