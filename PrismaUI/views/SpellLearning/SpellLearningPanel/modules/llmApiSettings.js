/**
 * LLM API Settings Module
 * Handles OpenRouter API configuration UI
 * 
 * Depends on:
 * - modules/state.js (state)
 * - modules/uiHelpers.js (updateStatus)
 * 
 * Exports (global):
 * - initializeLLMSettings()
 * - updateModelDisplayState()
 * - testAPIConnection()
 */

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
    setStatusIcon('X');
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
        setStatusIcon('X');
        // Reload to update masked display
        loadApiSettings();
    } else {
        updateStatus('Failed to save: ' + (result.error || 'Unknown error'));
        setStatusIcon('X');
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
        setStatusIcon('!');
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
        setStatusIcon('!');
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

