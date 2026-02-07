/**
 * Python Setup Module
 * Handles in-game Python auto-installation for Complex Build mode.
 *
 * Depends on:
 * - modules/state.js (state)
 * - modules/cppCallbacks.js (onPythonAddonStatus)
 *
 * Exports (global):
 * - window.startPythonSetup
 * - window.cancelPythonSetup
 * - window.onPythonSetupProgress
 * - window.onPythonSetupComplete
 */

// =============================================================================
// SETUP BUTTON HANDLER
// =============================================================================

window.startPythonSetup = function() {
    if (state.pythonSetupInProgress) return;

    state.pythonSetupInProgress = true;

    // Show the progress modal
    var modal = document.getElementById('python-setup-modal');
    if (modal) {
        modal.classList.remove('hidden');
    }

    // Reset modal state
    updateSetupModal(0, 'Preparing...', '');
    showSetupModalButtons('installing');

    // Tell C++ to start the install
    if (window.callCpp) {
        window.callCpp('SetupPython', '');
    }
};

// =============================================================================
// CANCEL HANDLER
// =============================================================================

window.cancelPythonSetup = function() {
    if (!state.pythonSetupInProgress) {
        hideSetupModal();
        return;
    }

    // Tell C++ to cancel
    if (window.callCpp) {
        window.callCpp('CancelPythonSetup', '');
    }
};

// =============================================================================
// PROGRESS CALLBACK (from C++)
// =============================================================================

window.onPythonSetupProgress = function(jsonStr) {
    try {
        var data = JSON.parse(jsonStr);
        var stageLabel = getStageLabel(data.stage);
        updateSetupModal(data.percent, stageLabel, data.message);
    } catch (e) {
        console.error('[PythonSetup] Failed to parse progress:', e);
    }
};

// =============================================================================
// COMPLETION CALLBACK (from C++)
// =============================================================================

window.onPythonSetupComplete = function(jsonStr) {
    try {
        var data = JSON.parse(jsonStr);
        state.pythonSetupInProgress = false;

        if (data.success) {
            // Success!
            updateSetupModal(100, 'Setup Complete!', 'Python and all packages have been installed.');
            showSetupModalButtons('success');

            // Update state
            state.pythonAddonInstalled = true;

            // Update the Complex Build button status
            var buildTreeBtn = document.getElementById('visualFirstBtn');
            if (buildTreeBtn) {
                buildTreeBtn.title = 'Generate spell trees using the grid-based growth system';
                // Don't enable yet - needs spells scanned first
            }

            // Update status text
            var genModeRow = buildTreeBtn ? buildTreeBtn.closest('.gen-mode-row') : null;
            if (genModeRow) {
                var consSpan = genModeRow.querySelector('.gen-mode-cons');
                if (consSpan) {
                    consSpan.textContent = 'Python ready (embedded)';
                    consSpan.style.color = '#22c55e';
                }
            }

            // Hide the setup button
            var setupBtn = document.getElementById('setupPythonBtn');
            if (setupBtn) {
                setupBtn.classList.add('hidden');
            }
        } else {
            // Failure
            var errorMsg = data.error || 'Unknown error occurred';
            updateSetupModal(-1, 'Setup Failed', errorMsg);
            showSetupModalButtons('error');
        }
    } catch (e) {
        console.error('[PythonSetup] Failed to parse complete:', e);
        state.pythonSetupInProgress = false;
    }
};

// =============================================================================
// MODAL HELPERS
// =============================================================================

function updateSetupModal(percent, stageLabel, detailMessage) {
    var progressBar = document.getElementById('setup-progress-fill');
    var stageLabelEl = document.getElementById('setup-stage-label');
    var detailEl = document.getElementById('setup-detail');

    if (progressBar) {
        if (percent >= 0) {
            progressBar.style.width = percent + '%';
            progressBar.classList.remove('error');
        } else {
            progressBar.style.width = '100%';
            progressBar.classList.add('error');
        }
    }
    if (stageLabelEl) {
        stageLabelEl.textContent = stageLabel;
    }
    if (detailEl) {
        detailEl.textContent = detailMessage || '';
    }
}

function showSetupModalButtons(mode) {
    var cancelBtn = document.getElementById('setup-cancel-btn');
    var doneBtn = document.getElementById('setup-done-btn');
    var retryBtn = document.getElementById('setup-retry-btn');
    var manualBtn = document.getElementById('setup-manual-btn');

    // Hide all first
    if (cancelBtn) cancelBtn.classList.add('hidden');
    if (doneBtn) doneBtn.classList.add('hidden');
    if (retryBtn) retryBtn.classList.add('hidden');
    if (manualBtn) manualBtn.classList.add('hidden');

    if (mode === 'installing') {
        if (cancelBtn) cancelBtn.classList.remove('hidden');
    } else if (mode === 'success') {
        if (doneBtn) doneBtn.classList.remove('hidden');
    } else if (mode === 'error') {
        if (retryBtn) retryBtn.classList.remove('hidden');
        if (manualBtn) manualBtn.classList.remove('hidden');
    }
}

function hideSetupModal() {
    var modal = document.getElementById('python-setup-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

function getStageLabel(stage) {
    var labels = {
        'DownloadingPython': 'Downloading Python',
        'ExtractingPython': 'Extracting Python',
        'Configuring': 'Configuring',
        'DownloadingGetPip': 'Downloading pip',
        'InstallingPip': 'Installing pip',
        'InstallingPackages': 'Installing packages',
        'Verifying': 'Verifying installation',
        'Complete': 'Complete'
    };
    return labels[stage] || stage;
}

// =============================================================================
// MANUAL INSTRUCTIONS
// =============================================================================

window.showManualPythonInstructions = function() {
    var detailEl = document.getElementById('setup-detail');
    if (detailEl) {
        detailEl.innerHTML =
            'Manual setup instructions:<br><br>' +
            '1. Download Python 3.12 from python.org<br>' +
            '2. Extract to: Data/SKSE/Plugins/SpellLearning/SpellTreeBuilder/python/<br>' +
            '3. Open command prompt in the python folder<br>' +
            '4. Run: python -m ensurepip<br>' +
            '5. Run: python -m pip install -r ../requirements.txt<br><br>' +
            'Or download the "-Python" variant from Nexus which includes everything.';
    }

    // Show cancel/close button
    showSetupModalButtons('installing');
    var cancelBtn = document.getElementById('setup-cancel-btn');
    if (cancelBtn) {
        cancelBtn.textContent = 'Close';
    }
};

// =============================================================================
// DONE BUTTON HANDLER
// =============================================================================

window.onSetupDone = function() {
    hideSetupModal();

    // Re-check Python status from C++
    if (window.callCpp) {
        window.callCpp('CheckPythonStatus', '');
    }
};
