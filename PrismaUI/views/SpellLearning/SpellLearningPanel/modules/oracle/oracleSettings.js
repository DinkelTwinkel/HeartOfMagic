/**
 * OracleSettings Module - Settings panel for Oracle Growth mode
 *
 * Builds the Oracle Growth settings panel HTML (LLM config, sliders, toggles)
 * and binds event handlers for user interaction. Oracle mode produces parallel
 * lane trees where each thematic chain runs as a separate lane side by side.
 *
 * LLM Configuration:
 *   Provider toggle (OpenRouter / Ollama), model text input, API key input,
 *   optional URL override. Persists to settings.treeGeneration.llm_api via
 *   saveUnifiedConfig().
 *
 * Usage:
 *   var html = OracleSettings.buildHTML(settings);
 *   OracleSettings.bindEvents({ onSettingChanged });
 *   OracleSettings.updatePythonStatus(installed, hasScript, hasPython);
 *   OracleSettings.updateScanStatus(hasSpells);
 *   OracleSettings.setTreeBuilt(built, nodeCount, totalPool);
 *   OracleSettings.setStatusText(text, color);
 *
 * Depends on: treePreviewUtils.js (settingHTML, bindInput)
 */

var OracleSettings = {

    // Internal state tracking
    _pythonInstalled: false,
    _hasSpells: false,
    _treeBuilt: false,
    _nodeCount: 0,
    _saveTimer: null,

    // =========================================================================
    // BUILD HTML
    // =========================================================================

    /**
     * Build the settings panel HTML string.
     *
     * @param {Object} settings - Current settings values
     * @param {number} settings.ghostOpacity - Ghost node opacity (0-100)
     * @param {number} settings.nodeRadius - Node radius in pixels
     * @param {number} settings.chaos - Cross-school connection factor (0-100)
     * @param {number} settings.batchSize - Spells per LLM call (5-50)
     * @param {string} settings.chainStyle - 'linear' or 'branching'
     * @param {boolean} settings.showNarrative - Show chain name/narrative labels
     * @returns {string} HTML string for the settings panel
     */
    buildHTML: function (settings) {
        var s = settings || {};
        var opacity = s.ghostOpacity !== undefined ? s.ghostOpacity : 35;
        var nodeSize = s.nodeRadius !== undefined ? s.nodeRadius : 5;
        var chaos = s.chaos !== undefined ? s.chaos : 0;
        var batchSize = s.batchSize !== undefined ? s.batchSize : 20;
        var chainStyle = s.chainStyle || 'linear';
        var showNarrative = !!s.showNarrative;
        var H = TreePreviewUtils.settingHTML;

        // Read saved LLM config
        var llmApi = this._getLlmApi();
        var provider = llmApi.provider || 'openrouter';
        var model = llmApi.model || '';
        var apiKey = llmApi.api_key || '';
        var url = llmApi.url || '';
        var isOllama = (provider === 'ollama');

        // Status dot
        var llmConnected = isOllama || !!(apiKey);
        var statusDotColor = llmConnected ? '#22c55e' : '#f59e0b';
        var statusLabel = llmConnected
            ? (isOllama ? 'Ollama (Local)' : 'OpenRouter')
            : 'Fallback Mode';

        // Mask API key for display
        var maskedKey = '';
        if (apiKey && apiKey.length > 12) {
            maskedKey = apiKey.substring(0, 8) + '...' + apiKey.substring(apiKey.length - 4);
        } else if (apiKey) {
            maskedKey = apiKey;
        }

        // Toggle button styles
        var btnBase = 'display:inline-block; padding:3px 10px; font-size:10px; cursor:pointer; border:1px solid rgba(184,168,120,0.3); transition:background 0.15s;';
        var btnAct = 'background:rgba(184,168,120,0.25); color:rgba(184,168,120,0.9);';
        var btnOff = 'background:transparent; color:rgba(184,168,120,0.4);';

        // Shared input style
        var inputStyle = 'width:100%; padding:3px 6px; font-size:10px; background:rgba(0,0,0,0.3); border:1px solid rgba(184,168,120,0.2); border-radius:3px; color:rgba(184,168,120,0.85); outline:none;';
        var labelStyle = 'font-size:10px; color:rgba(184,168,120,0.5); white-space:nowrap;';
        var pasteBtn = 'padding:2px 6px; font-size:9px; cursor:pointer; background:rgba(184,168,120,0.1); border:1px solid rgba(184,168,120,0.2); border-radius:3px; color:rgba(184,168,120,0.5);';

        return '' +
            '<div class="tree-preview-settings-title">Oracle Growth</div>' +

            // --- LLM Configuration Section ---
            '<div style="margin-bottom:8px; padding:6px 8px; border:1px solid rgba(184,168,120,0.15); border-radius:4px; background:rgba(184,168,120,0.03);">' +

                // Provider toggle
                '<div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">' +
                    '<span style="' + labelStyle + '">Provider</span>' +
                    '<div style="display:flex;">' +
                        '<div id="tgOracleProviderOpenRouter" title="OpenRouter cloud API (requires API key)" style="' + btnBase + ' border-radius:3px 0 0 3px; ' + (!isOllama ? btnAct : btnOff) + '">OpenRouter</div>' +
                        '<div id="tgOracleProviderOllama" title="Ollama local server (no API key needed)" style="' + btnBase + ' border-radius:0 3px 3px 0; border-left:none; ' + (isOllama ? btnAct : btnOff) + '">Ollama</div>' +
                    '</div>' +
                '</div>' +

                // Model input
                '<div style="display:flex; align-items:center; gap:4px; margin-bottom:5px;">' +
                    '<span style="' + labelStyle + ' min-width:38px;">Model</span>' +
                    '<input type="text" id="tgOracleModel" value="' + (model || '').replace(/"/g, '&quot;') + '" placeholder="' + (isOllama ? 'llama3, mistral...' : 'openai/gpt-4o-mini') + '" style="' + inputStyle + ' flex:1;">' +
                    '<button id="tgOracleModelPaste" title="Paste from clipboard" style="' + pasteBtn + '">Paste</button>' +
                '</div>' +

                // API Key input (hidden for Ollama)
                '<div id="tgOracleApiKeyRow" style="display:' + (isOllama ? 'none' : 'flex') + '; align-items:center; gap:4px; margin-bottom:5px;">' +
                    '<span style="' + labelStyle + ' min-width:38px;">Key</span>' +
                    '<input type="password" id="tgOracleApiKey" value="' + maskedKey.replace(/"/g, '&quot;') + '" placeholder="sk-or-..." style="' + inputStyle + ' flex:1;" data-has-key="' + (apiKey ? 'true' : 'false') + '">' +
                    '<button id="tgOracleKeyToggle" title="Show/hide key" style="' + pasteBtn + '">Show</button>' +
                    '<button id="tgOracleKeyPaste" title="Paste from clipboard" style="' + pasteBtn + '">Paste</button>' +
                '</div>' +

                // URL input
                '<div style="display:flex; align-items:center; gap:4px; margin-bottom:4px;">' +
                    '<span style="' + labelStyle + ' min-width:38px;">URL</span>' +
                    '<input type="text" id="tgOracleUrl" value="' + (url || '').replace(/"/g, '&quot;') + '" placeholder="' + (isOllama ? 'http://localhost:11434/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions') + '" style="' + inputStyle + ' flex:1; font-size:9px;">' +
                '</div>' +

                // Status dot
                '<div style="display:flex; align-items:center; gap:6px; margin-top:4px;">' +
                    '<span id="tgOracleLlmDot" style="display:inline-block; width:8px; height:8px; border-radius:50%; background:' + statusDotColor + '; flex-shrink:0;"></span>' +
                    '<span id="tgOracleLlmStatus" style="font-size:10px; color:' + statusDotColor + ';">' + statusLabel + '</span>' +
                '</div>' +
            '</div>' +

            // --- Chain Style 2-way toggle ---
            '<div style="display:flex; align-items:center; gap:8px; margin-bottom:6px; padding:0 4px;">' +
                '<span style="font-size:10px; color:rgba(184,168,120,0.6); white-space:nowrap;">Chain Style</span>' +
                '<div style="display:flex;">' +
                    '<div id="tgOracleChainLinear" title="Strict sequential chains \u2014 each spell leads to exactly one next spell." style="' + btnBase + ' border-radius:3px 0 0 3px; ' + (chainStyle === 'linear' ? btnAct : btnOff) + '">Linear</div>' +
                    '<div id="tgOracleChainBranching" title="LLM can suggest branch points within chains." style="' + btnBase + ' border-radius:0 3px 3px 0; border-left:none; ' + (chainStyle === 'branching' ? btnAct : btnOff) + '">Branching</div>' +
                '</div>' +
            '</div>' +

            // --- Slider grid ---
            '<div class="tree-preview-settings-grid">' +
                H('Chaos', 'tgOracleChaosSlider', 0, 100, 5, chaos, '',
                    'Controls cross-school connections. Low = strict school boundaries, High = spells freely associate across schools.') +
                H('Batch Size', 'tgOracleBatchSize', 5, 50, 5, batchSize, '',
                    'Spells per LLM call. Larger batches give better context but cost more tokens.') +
                H('Ghost Opacity', 'tgOracleOpacity', 0, 100, 5, opacity, '%') +
                H('Node Size', 'tgOracleNodeSize', 1, 20, 1, nodeSize) +
            '</div>' +

            // --- Show Narrative checkbox ---
            '<div style="display:flex; align-items:center; gap:8px; margin:4px 4px 6px; font-size:10px;">' +
                '<label style="display:flex; align-items:center; gap:5px; cursor:pointer; color:rgba(184,168,120,0.6);">' +
                    '<input type="checkbox" id="tgOracleShowNarrative"' + (showNarrative ? ' checked' : '') + '>' +
                    'Show Narrative' +
                '</label>' +
                '<span style="color:rgba(184,168,120,0.3); font-size:9px;" title="Display chain names and LLM narratives as labels along chain spines.">(?)</span>' +
            '</div>';
    },

    // =========================================================================
    // BIND EVENTS
    // =========================================================================

    /**
     * Bind click handlers on buttons and change handlers on sliders.
     *
     * @param {Object} callbacks
     * @param {function} callbacks.onSettingChanged - Called with (key, value)
     */
    bindEvents: function (callbacks) {
        var cb = callbacks || {};
        var self = this;

        // Slider bindings
        var onChanged = cb.onSettingChanged || function () {};

        TreePreviewUtils.bindInput('tgOracleOpacity', function (v) {
            onChanged('ghostOpacity', v);
        });

        TreePreviewUtils.bindInput('tgOracleNodeSize', function (v) {
            onChanged('nodeRadius', v);
        });

        TreePreviewUtils.bindInput('tgOracleChaosSlider', function (v) {
            onChanged('chaos', v);
        });

        TreePreviewUtils.bindInput('tgOracleBatchSize', function (v) {
            onChanged('batchSize', v);
        });

        // Chain Style 2-way toggle
        var chainBtns = {
            linear: document.getElementById('tgOracleChainLinear'),
            branching: document.getElementById('tgOracleChainBranching')
        };
        var actBg = 'background:rgba(184,168,120,0.25)';
        var actCol = 'color:rgba(184,168,120,0.9)';
        var offBg = 'background:transparent';
        var offCol = 'color:rgba(184,168,120,0.4)';
        var setChainActive = function (mode) {
            for (var mk in chainBtns) {
                if (!chainBtns.hasOwnProperty(mk) || !chainBtns[mk]) continue;
                var isAct = (mk === mode);
                chainBtns[mk].style.cssText = chainBtns[mk].style.cssText
                    .replace(/background:[^;]+/, isAct ? actBg : offBg)
                    .replace(/color:[^;]+/, isAct ? actCol : offCol);
            }
        };
        var chainModes = ['linear', 'branching'];
        for (var mi = 0; mi < chainModes.length; mi++) {
            (function (mode) {
                if (chainBtns[mode]) {
                    chainBtns[mode].addEventListener('click', function () {
                        setChainActive(mode);
                        onChanged('chainStyle', mode);
                    });
                }
            })(chainModes[mi]);
        }

        // Show Narrative checkbox
        var narrativeCheck = document.getElementById('tgOracleShowNarrative');
        if (narrativeCheck) {
            narrativeCheck.addEventListener('change', function () {
                onChanged('showNarrative', this.checked);
            });
        }

        // =====================================================================
        // LLM Configuration bindings
        // =====================================================================

        var providerOR = document.getElementById('tgOracleProviderOpenRouter');
        var providerOL = document.getElementById('tgOracleProviderOllama');
        var modelInput = document.getElementById('tgOracleModel');
        var apiKeyInput = document.getElementById('tgOracleApiKey');
        var urlInput = document.getElementById('tgOracleUrl');
        var apiKeyRow = document.getElementById('tgOracleApiKeyRow');
        var keyToggle = document.getElementById('tgOracleKeyToggle');
        var keyPaste = document.getElementById('tgOracleKeyPaste');
        var modelPaste = document.getElementById('tgOracleModelPaste');

        // Toggle button style helpers
        var btnBase = 'display:inline-block; padding:3px 10px; font-size:10px; cursor:pointer; border:1px solid rgba(184,168,120,0.3); transition:background 0.15s;';
        var btnAct = 'background:rgba(184,168,120,0.25); color:rgba(184,168,120,0.9);';
        var btnOff = 'background:transparent; color:rgba(184,168,120,0.4);';

        function setProviderActive(provider) {
            if (providerOR) providerOR.style.cssText = btnBase + ' border-radius:3px 0 0 3px; ' + (provider === 'openrouter' ? btnAct : btnOff);
            if (providerOL) providerOL.style.cssText = btnBase + ' border-radius:0 3px 3px 0; border-left:none; ' + (provider === 'ollama' ? btnAct : btnOff);
        }

        // Provider toggle
        if (providerOR) {
            providerOR.addEventListener('click', function () {
                setProviderActive('openrouter');
                if (apiKeyRow) apiKeyRow.style.display = 'flex';
                // Update URL placeholder
                if (urlInput && !urlInput.value) {
                    urlInput.placeholder = 'https://openrouter.ai/api/v1/chat/completions';
                }
                if (modelInput) modelInput.placeholder = 'openai/gpt-4o-mini';
                self._saveLlmConfig('openrouter');
            });
        }
        if (providerOL) {
            providerOL.addEventListener('click', function () {
                setProviderActive('ollama');
                if (apiKeyRow) apiKeyRow.style.display = 'none';
                // Update URL placeholder
                if (urlInput && !urlInput.value) {
                    urlInput.placeholder = 'http://localhost:11434/v1/chat/completions';
                }
                if (modelInput) modelInput.placeholder = 'llama3, mistral...';
                self._saveLlmConfig('ollama');
            });
        }

        // Model input — debounced save
        if (modelInput) {
            modelInput.addEventListener('input', function () {
                self._debounceSaveLlmConfig();
            });
        }

        // API Key input — debounced save
        if (apiKeyInput) {
            apiKeyInput.addEventListener('input', function () {
                // If user is typing over the masked value, clear it first
                if (this.dataset.hasKey === 'true' && this.value.indexOf('...') !== -1) {
                    this.value = '';
                    this.dataset.hasKey = 'false';
                }
                self._debounceSaveLlmConfig();
            });
            apiKeyInput.addEventListener('focus', function () {
                // Clear masked value on focus so user can type fresh
                if (this.dataset.hasKey === 'true' && this.value.indexOf('...') !== -1) {
                    this.value = '';
                    this.type = 'text';
                }
            });
        }

        // URL input — debounced save
        if (urlInput) {
            urlInput.addEventListener('input', function () {
                self._debounceSaveLlmConfig();
            });
        }

        // API Key show/hide toggle
        if (keyToggle && apiKeyInput) {
            keyToggle.addEventListener('click', function () {
                if (apiKeyInput.type === 'password') {
                    apiKeyInput.type = 'text';
                    keyToggle.textContent = 'Hide';
                } else {
                    apiKeyInput.type = 'password';
                    keyToggle.textContent = 'Show';
                }
            });
        }

        // Paste buttons (use Ultralight clipboard bridge)
        if (keyPaste) {
            keyPaste.addEventListener('click', function () {
                if (typeof state !== 'undefined' && window.callCpp) {
                    state.pasteTarget = 'tgOracleApiKey';
                    window.callCpp('GetClipboard', '');
                }
            });
        }
        if (modelPaste) {
            modelPaste.addEventListener('click', function () {
                if (typeof state !== 'undefined' && window.callCpp) {
                    state.pasteTarget = 'tgOracleModel';
                    window.callCpp('GetClipboard', '');
                }
            });
        }

        // Watch for clipboard pastes landing on our inputs (poll briefly after paste)
        if (apiKeyInput) {
            var origKeyPaste = apiKeyInput.value;
            setInterval(function () {
                if (apiKeyInput.value !== origKeyPaste) {
                    origKeyPaste = apiKeyInput.value;
                    self._debounceSaveLlmConfig();
                }
            }, 300);
        }
    },

    // =========================================================================
    // LLM CONFIG HELPERS
    // =========================================================================

    /** Read current llm_api from settings, returns object. @private */
    _getLlmApi: function () {
        if (typeof settings !== 'undefined' && settings.treeGeneration &&
            settings.treeGeneration.llm_api) {
            return settings.treeGeneration.llm_api;
        }
        return {};
    },

    /** Determine current provider from DOM or saved config. @private */
    _getCurrentProvider: function () {
        var providerOL = document.getElementById('tgOracleProviderOllama');
        if (providerOL) {
            // Check if Ollama button is active by looking at background
            var style = providerOL.style.cssText || '';
            if (style.indexOf('rgba(184,168,120,0.25)') !== -1) {
                return 'ollama';
            }
        }
        return 'openrouter';
    },

    /** Save LLM config from current DOM inputs. @private */
    _saveLlmConfig: function (providerOverride) {
        var provider = providerOverride || this._getCurrentProvider();
        var modelInput = document.getElementById('tgOracleModel');
        var apiKeyInput = document.getElementById('tgOracleApiKey');
        var urlInput = document.getElementById('tgOracleUrl');

        var model = modelInput ? modelInput.value.trim() : '';
        var url = urlInput ? urlInput.value.trim() : '';

        // Resolve API key: don't overwrite with masked value
        var apiKey = '';
        if (apiKeyInput) {
            var rawVal = apiKeyInput.value.trim();
            if (rawVal && rawVal.indexOf('...') === -1) {
                apiKey = rawVal;
            } else if (apiKeyInput.dataset.hasKey === 'true') {
                // Keep existing key from saved config
                var existing = this._getLlmApi();
                apiKey = existing.api_key || '';
            }
        }

        // Default URLs by provider
        if (!url) {
            if (provider === 'ollama') {
                url = 'http://localhost:11434/v1/chat/completions';
            } else {
                url = 'https://openrouter.ai/api/v1/chat/completions';
            }
        }

        // Determine if LLM is effectively enabled
        var enabled = (provider === 'ollama') || !!(apiKey);

        var llmApi = {
            enabled: enabled,
            provider: provider,
            api_key: apiKey,
            model: model,
            url: url
        };

        // Write to settings
        if (typeof settings !== 'undefined' && settings.treeGeneration) {
            settings.treeGeneration.llm_api = llmApi;
        }

        // Persist via unified config
        if (typeof saveUnifiedConfig === 'function') {
            saveUnifiedConfig();
        }

        // Update status dot
        this._updateLlmStatusDot(enabled, provider);

        console.log('[OracleSettings] LLM config saved: provider=' + provider +
            ', model=' + model + ', hasKey=' + (apiKey ? 'yes' : 'no') +
            ', url=' + url);
    },

    /** Debounced save (500ms). @private */
    _debounceSaveLlmConfig: function () {
        var self = this;
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(function () {
            self._saveLlmConfig();
        }, 500);
    },

    /** Update the status dot + label in the DOM. @private */
    _updateLlmStatusDot: function (connected, provider) {
        var dot = document.getElementById('tgOracleLlmDot');
        var label = document.getElementById('tgOracleLlmStatus');
        if (!dot || !label) return;

        var color = connected ? '#22c55e' : '#f59e0b';
        var text = connected
            ? (provider === 'ollama' ? 'Ollama (Local)' : 'OpenRouter')
            : 'Fallback Mode';

        dot.style.background = color;
        label.textContent = text;
        label.style.color = color;
    },

    // =========================================================================
    // PYTHON STATUS
    // =========================================================================

    updatePythonStatus: function (installed, hasScript, hasPython) {
        if (typeof TreeGrowth !== 'undefined') TreeGrowth.updatePythonStatus(installed, hasScript, hasPython);
    },

    onPythonStatusChanged: function (installed, hasScript, hasPython) {
        this._pythonInstalled = installed;
        this.updatePythonStatus(installed, hasScript, hasPython);
    },

    // =========================================================================
    // SCAN STATUS
    // =========================================================================

    updateScanStatus: function (hasSpells) {
        if (typeof TreeGrowth !== 'undefined') TreeGrowth.updateScanStatus(hasSpells);
    },

    // =========================================================================
    // TREE BUILT STATE
    // =========================================================================

    setTreeBuilt: function (built, nodeCount, totalPool) {
        if (typeof TreeGrowth !== 'undefined') TreeGrowth.setTreeBuilt(built, nodeCount, totalPool);
    },

    // =========================================================================
    // STATUS TEXT
    // =========================================================================

    setStatusText: function (text, color) {
        if (typeof TreeGrowth !== 'undefined') TreeGrowth.setStatusText(text, color);
    },

    // =========================================================================
    // INTERNAL HELPERS
    // =========================================================================

    _updateBuildButton: function () {
        if (typeof TreeGrowth !== 'undefined') TreeGrowth.updateBuildButton();
    }
};

console.log('[OracleSettings] Loaded');
