/**
 * Easy Mode Module
 *
 * Simplified scanner UI: big preset chips + relay buttons to Complex page.
 * Build/Apply/Clear buttons trigger the same Complex page functions.
 * Status is mirrored from the Complex page's tgStatus.
 *
 * Depends on:
 * - state.js (scannerPresets)
 * - scannerPresets.js (applyScannerPreset, updateScannerPresetsUI)
 * - treeGrowth.js (TreeGrowth — Build/Apply/Clear handlers)
 */

// =============================================================================
// MODULE STATE
// =============================================================================

var _easySelectedPreset = '';

// =============================================================================
// INITIALIZATION
// =============================================================================

function initializeEasyMode() {
    // Mode toggle buttons
    var modeBtns = document.querySelectorAll('.scanner-mode-btn');
    for (var i = 0; i < modeBtns.length; i++) {
        modeBtns[i].addEventListener('click', function() {
            var mode = this.getAttribute('data-scanner-mode');
            if (mode) switchScannerMode(mode);
        });
    }

    // Direct action buttons — call TreeGrowth API directly (no Complex tab relay)
    var buildBtn = document.getElementById('easyBuildBtn');
    if (buildBtn) {
        buildBtn.addEventListener('click', function() {
            // Apply selected preset first
            if (_easySelectedPreset && scannerPresets[_easySelectedPreset]) {
                if (typeof applyScannerPreset === 'function') {
                    applyScannerPreset(_easySelectedPreset);
                }
            }
            // Call TreeGrowth directly
            if (typeof TreeGrowth !== 'undefined') {
                var mod = TreeGrowth.modes[TreeGrowth.activeMode];
                if (mod && mod.buildTree) mod.buildTree();
            }
        });
    }

    var applyBtn = document.getElementById('easyApplyBtn');
    if (applyBtn) {
        applyBtn.addEventListener('click', function() {
            if (typeof TreeGrowth !== 'undefined') {
                var mod = TreeGrowth.modes[TreeGrowth.activeMode];
                if (mod && mod.applyTree) mod.applyTree();
            }
        });
    }

    var clearBtn = document.getElementById('easyClearBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', function() {
            if (typeof TreeGrowth !== 'undefined') {
                var mod = TreeGrowth.modes[TreeGrowth.activeMode];
                if (mod && mod.clearTree) mod.clearTree();
            }
        });
    }

    // Mirror TreeGrowth state to Easy buttons + status
    _startEasyMirror();

    // Init Easy selection from persisted active scanner preset
    if (typeof _activeScannerPreset !== 'undefined' && _activeScannerPreset) {
        _easySelectedPreset = _activeScannerPreset;
    }

    // Initial preset chip render
    updateEasyPresetChips();

    console.log('[EasyMode] Initialized');
}

// =============================================================================
// MODE SWITCHING
// =============================================================================

function switchScannerMode(mode) {
    var easyContent = document.getElementById('scannerEasyContent');
    var complexContent = document.getElementById('scannerComplexContent');

    if (easyContent) easyContent.style.display = (mode === 'easy') ? '' : 'none';
    if (complexContent) complexContent.style.display = (mode === 'complex') ? '' : 'none';

    // Update button active states
    var btns = document.querySelectorAll('.scanner-mode-btn');
    for (var i = 0; i < btns.length; i++) {
        var btnMode = btns[i].getAttribute('data-scanner-mode');
        if (btnMode === mode) {
            btns[i].classList.add('active');
        } else {
            btns[i].classList.remove('active');
        }
    }

    // Move PRM preview canvas between Easy and Complex containers
    _movePrmPreview(mode);

    // Refresh easy chips + mirror state when switching to easy
    if (mode === 'easy') {
        updateEasyPresetChips();
        _syncEasyButtonStates();
        _syncEasyStatus();
    }
}

// =============================================================================
// PRESET CHIPS (big, select-only)
// =============================================================================

function updateEasyPresetChips() {
    var container = document.getElementById('easyPresetChips');
    if (!container) return;

    container.innerHTML = '';

    var presetKeys = [];
    for (var key in scannerPresets) {
        if (scannerPresets.hasOwnProperty(key)) {
            presetKeys.push(key);
        }
    }

    if (presetKeys.length === 0) {
        var msg = document.createElement('div');
        msg.className = 'easy-no-presets';
        msg.textContent = 'No presets yet. Build will use current settings.';
        container.appendChild(msg);
        return;
    }

    // Sort: builtIn first (by creation date), then user presets
    presetKeys.sort(function(a, b) {
        var pa = scannerPresets[a];
        var pb = scannerPresets[b];
        var aBuiltIn = pa && pa.builtIn ? 0 : 1;
        var bBuiltIn = pb && pb.builtIn ? 0 : 1;
        if (aBuiltIn !== bBuiltIn) return aBuiltIn - bBuiltIn;
        var aTime = pa && pa.created ? pa.created : 0;
        var bTime = pb && pb.created ? pb.created : 0;
        return aTime - bTime;
    });

    for (var i = 0; i < presetKeys.length; i++) {
        var name = presetKeys[i];
        var chip = document.createElement('div');
        chip.className = 'easy-preset-chip';
        if (name === _easySelectedPreset) {
            chip.classList.add('selected');
        }
        chip.textContent = name;
        chip.setAttribute('data-preset', name);
        chip.addEventListener('click', function() {
            var presetName = this.getAttribute('data-preset');
            _selectEasyPreset(presetName);
        });
        container.appendChild(chip);
    }
}

function _selectEasyPreset(name) {
    _easySelectedPreset = name;

    // Update chip visuals
    var chips = document.querySelectorAll('.easy-preset-chip');
    for (var i = 0; i < chips.length; i++) {
        var chipName = chips[i].getAttribute('data-preset');
        if (chipName === name) {
            chips[i].classList.add('selected');
        } else {
            chips[i].classList.remove('selected');
        }
    }
}

// =============================================================================
// MIRROR COMPLEX PAGE STATE
// =============================================================================

/**
 * Watch the Complex page's tgBuildBtn, tgApplyBtn, tgClearBtn disabled states
 * and tgStatus text, mirror them to Easy mode equivalents.
 */
function _startEasyMirror() {
    // Pairs: [complexId, easyId]
    var buttonPairs = [
        ['tgBuildBtn', 'easyBuildBtn'],
        ['tgApplyBtn', 'easyApplyBtn'],
        ['tgClearBtn', 'easyClearBtn']
    ];

    // Use MutationObserver to watch disabled attribute changes
    for (var i = 0; i < buttonPairs.length; i++) {
        (function(complexId, easyId) {
            var complexBtn = document.getElementById(complexId);
            var easyBtn = document.getElementById(easyId);
            if (!complexBtn || !easyBtn) return;

            // Initial sync
            easyBtn.disabled = complexBtn.disabled;

            var observer = new MutationObserver(function() {
                easyBtn.disabled = complexBtn.disabled;
            });
            observer.observe(complexBtn, { attributes: true, attributeFilter: ['disabled'] });
        })(buttonPairs[i][0], buttonPairs[i][1]);
    }

    // Mirror tgStatus text → easyStatus
    var tgStatus = document.getElementById('tgStatus');
    var easyStatus = document.getElementById('easyStatus');
    if (tgStatus && easyStatus) {
        // Initial sync
        easyStatus.textContent = tgStatus.textContent;
        easyStatus.style.color = tgStatus.style.color;

        var statusObserver = new MutationObserver(function() {
            easyStatus.textContent = tgStatus.textContent;
            easyStatus.style.color = tgStatus.style.color;
        });
        statusObserver.observe(tgStatus, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    }
}

/** Manual sync for when switching to Easy mode */
function _syncEasyButtonStates() {
    var pairs = [
        ['tgBuildBtn', 'easyBuildBtn'],
        ['tgApplyBtn', 'easyApplyBtn'],
        ['tgClearBtn', 'easyClearBtn']
    ];
    for (var i = 0; i < pairs.length; i++) {
        var src = document.getElementById(pairs[i][0]);
        var dst = document.getElementById(pairs[i][1]);
        if (src && dst) dst.disabled = src.disabled;
    }
}

function _syncEasyStatus() {
    var tgStatus = document.getElementById('tgStatus');
    var easyStatus = document.getElementById('easyStatus');
    if (tgStatus && easyStatus) {
        easyStatus.textContent = tgStatus.textContent;
        easyStatus.style.color = tgStatus.style.color;
    }
}

// =============================================================================
// PRM PREVIEW RELAY
// =============================================================================

var _prmOriginalParent = null;

/**
 * Move #prmPreviewWrap between Easy and Complex containers.
 * The ResizeObserver already attached by prereqMaster.js will handle re-sizing.
 */
function _movePrmPreview(mode) {
    var prmWrap = document.getElementById('prmPreviewWrap');
    if (!prmWrap) return;

    // Remember original parent on first call
    if (!_prmOriginalParent) {
        _prmOriginalParent = prmWrap.parentNode;
    }

    if (mode === 'easy') {
        var placeholder = document.getElementById('easyPreviewPlaceholder');
        if (placeholder && prmWrap.parentNode !== placeholder) {
            placeholder.appendChild(prmWrap);
        }
    } else {
        // Move back to Complex (original parent)
        if (_prmOriginalParent && prmWrap.parentNode !== _prmOriginalParent) {
            _prmOriginalParent.appendChild(prmWrap);
        }
    }

    // Trigger a re-render after the DOM settles
    setTimeout(function() {
        if (typeof PreReqMaster !== 'undefined' && PreReqMaster.renderPreview) {
            PreReqMaster.renderPreview();
        }
    }, 100);
}
