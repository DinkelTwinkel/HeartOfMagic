/**
 * Build Progress Modal
 * Shows a staged progress popup when building the spell tree + generating prerequisites.
 *
 * Stages:
 *   1. "python"    – Starting/connecting to Python server (skipped if already ready)
 *   2. "tree"      – Python NLP spell tree analysis & building
 *   3. "prereqs"   – Pre Req Master Python NLP scoring (if PRM enabled)
 *   4. "finalize"  – Layout finalization & render
 *
 * Usage:
 *   BuildProgress.start(hasPRM, pythonReady)  – open modal, set stages
 *   BuildProgress.setStage(name)              – advance to named stage
 *   BuildProgress.setDetail(text)             – update sub-detail for current stage
 *   BuildProgress.complete()                  – mark all done, show Done button
 *   BuildProgress.fail(error)                 – mark current stage as failed
 *   BuildProgress.close()                     – hide modal
 *   BuildProgress.getCurrentStage()           – get current stage name
 *
 * Depends on: prereqMaster.js (PreReqMaster.isEnabled)
 */

var BuildProgress = (function() {

    var _active = false;
    var _hasPRM = false;
    var _currentStage = null;
    var _stages = ['python', 'tree', 'prereqs', 'finalize'];
    var _stageStartTime = 0;
    var _totalStartTime = 0;

    // Icons: pending ○, active ◎ (animated), done ✓, failed ✗
    var ICON_PENDING  = '\u25CB';  // ○
    var ICON_ACTIVE   = '\u25CE';  // ◎
    var ICON_DONE     = '\u2713';  // ✓
    var ICON_FAILED   = '\u2717';  // ✗
    var ICON_SKIPPED  = '\u2014';  // —

    function _getEl(id) {
        return document.getElementById(id);
    }

    /**
     * Start the build progress modal.
     * @param {boolean} hasPRM - Whether Pre Req Master stage is expected
     * @param {boolean} [pythonReady] - If true, skip the python startup stage
     */
    function start(hasPRM, pythonReady) {
        _active = true;
        _hasPRM = hasPRM;
        _currentStage = null;
        _totalStartTime = Date.now();

        var modal = _getEl('build-progress-modal');
        if (modal) modal.classList.remove('hidden');

        // Reset all stages
        _stages.forEach(function(stage) {
            _setStageIcon(stage, ICON_PENDING);
            _setStageState(stage, 'pending');
            _setStageDetail(stage, '');
        });

        // If python already ready, mark python stage as skipped
        if (pythonReady) {
            _setStageIcon('python', ICON_DONE);
            _setStageState('python', 'done');
            _setStageDetail('python', t('buildProgress.pythonServerReady'));
        }

        // If PRM not enabled, mark prereqs as skipped
        if (!hasPRM) {
            _setStageIcon('prereqs', ICON_SKIPPED);
            _setStageState('prereqs', 'skipped');
            _setStageDetail('prereqs', t('buildProgress.prmDisabled'));
        }

        // Hide done button, reset progress bar
        var doneBtn = _getEl('build-progress-done-btn');
        if (doneBtn) doneBtn.classList.add('hidden');

        _setProgressBar(0);
        _setStatus(t('modals.buildProgress.preparing'));

        // Start at python stage or tree if python already ready
        setStage(pythonReady ? 'tree' : 'python');
    }

    /**
     * Advance to a named stage.
     */
    function setStage(stageName) {
        if (!_active) return;

        // Mark previous stage as done (if any)
        if (_currentStage && _currentStage !== stageName) {
            _setStageIcon(_currentStage, ICON_DONE);
            _setStageState(_currentStage, 'done');
            var elapsed = ((Date.now() - _stageStartTime) / 1000).toFixed(1);
            _setStageDetail(_currentStage, elapsed + 's');
        }

        _currentStage = stageName;
        _stageStartTime = Date.now();

        // Skip prereqs if PRM not enabled
        if (stageName === 'prereqs' && !_hasPRM) {
            setStage('finalize');
            return;
        }

        _setStageIcon(stageName, ICON_ACTIVE);
        _setStageState(stageName, 'active');

        // Update progress bar based on stage
        var stageLabels = {
            python: t('buildProgress.startingPythonServer'),
            tree: t('buildProgress.analyzingSpellRelationships'),
            prereqs: t('buildProgress.scoringPrereqCandidates'),
            finalize: t('buildProgress.finalizingLayout')
        };
        _setStatus(stageLabels[stageName] || stageName);

        var progressMap = { python: 5, tree: 20, prereqs: 55, finalize: 85 };
        _setProgressBar(progressMap[stageName] || 0);

        // Start a timer to animate progress within the stage
        _animateStageProgress(stageName, progressMap[stageName] || 0);
    }

    /**
     * Update sub-detail text for the current stage (e.g. "142 pairs scored")
     */
    function setDetail(text) {
        if (_currentStage) {
            _setStageDetail(_currentStage, text);
        }
        _setStatus(text);
    }

    /**
     * Mark build as complete.
     */
    function complete(summary) {
        if (!_active) return;

        // Finish current stage
        if (_currentStage) {
            _setStageIcon(_currentStage, ICON_DONE);
            _setStageState(_currentStage, 'done');
            var elapsed = ((Date.now() - _stageStartTime) / 1000).toFixed(1);
            _setStageDetail(_currentStage, elapsed + 's');
        }

        // Mark all remaining pending stages as done
        _stages.forEach(function(stage) {
            var iconEl = _getEl('build-stage-' + stage + '-icon');
            if (iconEl && iconEl.textContent === ICON_PENDING) {
                _setStageIcon(stage, ICON_DONE);
                _setStageState(stage, 'done');
            }
        });

        _setProgressBar(100);

        var totalElapsed = ((Date.now() - _totalStartTime) / 1000).toFixed(1);
        _setStatus(summary || t('buildProgress.completeIn', {time: totalElapsed}));

        // Show done button
        var doneBtn = _getEl('build-progress-done-btn');
        if (doneBtn) doneBtn.classList.remove('hidden');

        _currentStage = null;

        // Auto-close after 2.5s
        setTimeout(function() {
            if (_active) close();
        }, 2500);
    }

    /**
     * Mark current stage as failed.
     */
    function fail(errorMsg, retryCallback) {
        if (!_active) return;

        if (_currentStage) {
            _setStageIcon(_currentStage, ICON_FAILED);
            _setStageState(_currentStage, 'failed');
            _setStageDetail(_currentStage, t('buildProgress.failed'));
        }

        _setProgressBar(-1); // Error state
        _setStatus(errorMsg || t('buildProgress.buildFailed'));

        // Show done button to close
        var doneBtn = _getEl('build-progress-done-btn');
        if (doneBtn) {
            doneBtn.textContent = t('buildProgress.close');
            doneBtn.classList.remove('hidden');
        }

        // Show retry-with-fallback button if callback provided
        var retryBtn = _getEl('build-progress-retry-btn');
        if (retryBtn) retryBtn.remove();
        if (retryCallback && doneBtn && doneBtn.parentNode) {
            retryBtn = document.createElement('button');
            retryBtn.id = 'build-progress-retry-btn';
            retryBtn.className = doneBtn.className;
            retryBtn.textContent = 'Retry with Fallback';
            retryBtn.style.marginLeft = '8px';
            retryBtn.onclick = function() {
                retryBtn.remove();
                close();
                retryCallback();
            };
            doneBtn.parentNode.appendChild(retryBtn);
        }
    }

    /**
     * Close the modal.
     */
    function close() {
        _active = false;
        _currentStage = null;
        var modal = _getEl('build-progress-modal');
        if (modal) modal.classList.add('hidden');
    }

    /**
     * Check if the modal is currently active.
     */
    function isActive() {
        return _active;
    }

    /**
     * Get the current stage name.
     */
    function getCurrentStage() {
        return _currentStage;
    }

    // =========================================================================
    // INTERNAL HELPERS
    // =========================================================================

    function _setStageIcon(stage, icon) {
        var el = _getEl('build-stage-' + stage + '-icon');
        if (el) el.textContent = icon;
    }

    function _setStageState(stage, stateClass) {
        var el = _getEl('build-stage-' + stage);
        if (!el) return;
        el.className = 'build-stage ' + stateClass;
    }

    function _setStageDetail(stage, text) {
        var el = _getEl('build-stage-' + stage + '-detail');
        if (el) el.textContent = text;
    }

    function _setProgressBar(percent) {
        var fill = _getEl('build-progress-fill');
        if (!fill) return;

        if (percent < 0) {
            fill.style.width = '100%';
            fill.classList.add('error');
        } else {
            fill.classList.remove('error');
            fill.style.width = percent + '%';
        }
    }

    function _setStatus(text) {
        var el = _getEl('build-progress-status');
        if (el) el.textContent = text;
    }

    var _animTimer = null;
    function _animateStageProgress(stageName, startPercent) {
        if (_animTimer) clearInterval(_animTimer);

        var nextStagePercent = { python: 15, tree: 50, prereqs: 80, finalize: 95 };
        var target = nextStagePercent[stageName] || 95;
        var current = startPercent;

        _animTimer = setInterval(function() {
            if (!_active || _currentStage !== stageName) {
                clearInterval(_animTimer);
                return;
            }
            // Slow asymptotic approach to target
            current += (target - current) * 0.03;
            _setProgressBar(Math.round(current));
        }, 300);
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================

    return {
        start: start,
        setStage: setStage,
        setDetail: setDetail,
        complete: complete,
        fail: fail,
        close: close,
        isActive: isActive,
        getCurrentStage: getCurrentStage
    };

})();

window.BuildProgress = BuildProgress;
