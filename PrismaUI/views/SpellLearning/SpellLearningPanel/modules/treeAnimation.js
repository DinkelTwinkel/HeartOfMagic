/**
 * Tree Animation — Two-phase build replay
 *
 * Phase 1 (nodes): Nodes + edges appear one-by-one, showing how the tree
 *                  was constructed.
 * Phase 2 (chains): After all nodes are placed, prerequisite lock chains
 *                   animate in — each chain extends from the prereq node
 *                   to the locked node, and the locked node transforms
 *                   with a lock badge when the chain arrives.
 *
 * API:
 *   TreeAnimation.capture()      — snapshot current build data
 *   TreeAnimation.play(speed)    — start/restart replay (both phases)
 *   TreeAnimation.stop()         — stop and show all nodes
 *   TreeAnimation.isPlaying()    — true while animating (either phase)
 *   TreeAnimation.getFrameData() — { nodes[], edges[], chains[], phase, ... }
 */

var TreeAnimation = {

    // Snapshot of placement data
    _nodes: null,        // [{x, y, color, ...}]
    _edges: null,        // [{x1, y1, x2, y2, color}] or null
    _mode: '',           // 'classic' or 'tree'

    // Phase tracking
    _phase: 'idle',      // 'idle' | 'nodes' | 'waiting_chains' | 'chains' | 'done'

    // Phase 1: Node playback state
    _currentIdx: 0,
    _intervalId: null,
    _speed: 30,
    _playing: false,
    _newestAge: 0,

    // Phase 2: Chain animation state
    _chains: null,       // [{fromX, fromY, toX, toY, progress, done}]
    _chainIntervalId: null,
    _chainSpeed: 20,     // ms per tick
    _chainGrowRate: 0.03, // progress per tick (0..1)
    _lockedNodes: null,  // [{x, y, color}] — nodes that got lock badges

    // Deferred capture
    _pendingCapture: false,
    _retryCount: 0,
    _retryTimerId: null,
    _chainWaitTimer: null,

    // =========================================================================
    // CAPTURE
    // =========================================================================

    capture: function() {
        this.stop();
        this._nodes = null;
        this._edges = null;
        this._chains = null;
        this._lockedNodes = null;
        this._mode = '';
        this._phase = 'idle';

        if (typeof TreeGrowth === 'undefined') {
            console.log('[TreeAnimation] capture: TreeGrowth not defined');
            return false;
        }

        // Try the active mode first, then fall back to others
        var activeMode = TreeGrowth.activeMode || 'classic';
        var captured = false;
        var activeMod = TreeGrowth.modes[activeMode];

        if (activeMod) {
            // _builtPlacements format (tree mode)
            if (activeMod._builtPlacements) {
                captured = this._captureTree(activeMode);
            }
            // _layoutData format (classic, graph, oracle, thematic)
            if (!captured && activeMod._layoutData) {
                captured = this._captureClassic(activeMode);
            }
        }

        // Fallback: try tree then classic
        if (!captured) captured = this._captureTree('tree');
        if (!captured) captured = this._captureClassic('classic');

        if (captured) {
            this._pendingCapture = false;
            this._retryCount = 0;
            // Also capture lock chains for phase 2
            this._captureChains();
            console.log('[TreeAnimation] Captured ' + this._nodes.length + ' nodes' +
                (this._edges ? ', ' + this._edges.length + ' edges' : '') +
                (this._chains ? ', ' + this._chains.length + ' chains' : '') +
                ' (mode=' + this._mode + ')');
        } else {
            console.log('[TreeAnimation] capture: no data found' +
                ' (activeMode=' + activeMode +
                ', activeMod has _builtPlacements=' + !!(activeMod && activeMod._builtPlacements) +
                ', activeMod has _layoutData=' + !!(activeMod && activeMod._layoutData) + ')');
        }

        return captured;
    },

    _captureTree: function(modeName) {
        var treeModule = TreeGrowth.modes[modeName || 'tree'];
        if (!treeModule) return false;

        var layout = treeModule._builtPlacements;
        if (!layout || !layout.nodes || layout.nodes.length === 0) return false;

        this._nodes = [];
        for (var ni = 0; ni < layout.nodes.length; ni++) {
            var n = layout.nodes[ni];
            this._nodes.push({ x: n.x, y: n.y, color: n.color, skillLevel: n.skillLevel || '' });
        }

        if (layout.edges && layout.edges.length > 0) {
            this._edges = [];
            for (var ei = 0; ei < layout.edges.length; ei++) {
                var e = layout.edges[ei];
                this._edges.push({ x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, color: e.color || '' });
            }
        } else {
            this._edges = null;
        }
        this._mode = modeName || 'tree';
        return true;
    },

    _captureClassic: function(modeName) {
        var classicModule = TreeGrowth.modes[modeName || 'classic'];
        if (!classicModule) return false;

        var layoutData = classicModule._layoutData;
        if (!layoutData || !layoutData.schools) return false;

        var allNodes = [];
        var allEdges = [];
        var schools = layoutData.schools;

        for (var schoolName in schools) {
            if (!schools.hasOwnProperty(schoolName)) continue;
            var school = schools[schoolName];
            var nodes = school.nodes;
            if (!nodes || nodes.length === 0) continue;

            var schoolColor = school.color || '#888888';

            var lookup = {};
            for (var i = 0; i < nodes.length; i++) {
                if (nodes[i].formId) lookup[nodes[i].formId] = nodes[i];
            }

            var roots = [];
            var rest = [];
            for (var j = 0; j < nodes.length; j++) {
                var n = nodes[j];
                var entry = { x: n.x, y: n.y, color: schoolColor };
                if (n.isRoot) {
                    roots.push(entry);
                } else {
                    rest.push(entry);
                }

                if (n.parentFormId && lookup[n.parentFormId]) {
                    var parent = lookup[n.parentFormId];
                    allEdges.push({
                        x1: parent.x, y1: parent.y,
                        x2: n.x, y2: n.y,
                        color: schoolColor
                    });
                }
            }

            for (var ri = 0; ri < roots.length; ri++) allNodes.push(roots[ri]);
            for (var ci = 0; ci < rest.length; ci++) allNodes.push(rest[ci]);
        }

        if (allNodes.length === 0) return false;

        this._nodes = allNodes;
        this._edges = allEdges.length > 0 ? allEdges : null;
        this._mode = modeName || 'classic';
        return true;
    },

    /**
     * Capture lock chain data from PreReqMaster for Phase 2.
     * Resolves lock edges to {fromX, fromY, toX, toY} using position maps.
     */
    _captureChains: function() {
        this._chains = null;
        this._lockedNodes = null;

        if (typeof PreReqMaster === 'undefined' || !PreReqMaster.getAllLockEdges) return;

        var lockEdges = PreReqMaster.getAllLockEdges();
        if (!lockEdges || lockEdges.length === 0) return;

        // Get position map from the mode that has data
        var posMap = null;
        var modeModule = TreeGrowth.modes[this._mode];
        if (modeModule && typeof modeModule.getPositionMap === 'function') {
            posMap = modeModule.getPositionMap();
        }
        if (!posMap) return;

        var chains = [];
        var lockedNodes = [];

        for (var i = 0; i < lockEdges.length; i++) {
            var le = lockEdges[i];
            var fromPos = posMap[le.from];
            var toPos = posMap[le.to];
            if (!fromPos || !toPos) continue;

            chains.push({
                fromX: fromPos.x,
                fromY: fromPos.y,
                toX: toPos.x,
                toY: toPos.y,
                progress: 0,
                done: false
            });

            // Track the locked node position for lock badge
            lockedNodes.push({
                x: toPos.x,
                y: toPos.y,
                color: '#82828c',
                chainIdx: chains.length - 1
            });
        }

        if (chains.length > 0) {
            this._chains = chains;
            this._lockedNodes = lockedNodes;
            console.log('[TreeAnimation] Captured ' + chains.length + ' lock chains');
        }
    },

    requestCapture: function() {
        this._pendingCapture = true;
        this._retryCount = 0;
        this._scheduleRetry();
    },

    _scheduleRetry: function() {
        if (this._retryTimerId) {
            clearTimeout(this._retryTimerId);
            this._retryTimerId = null;
        }

        var self = this;
        var delays = [200, 500, 1000, 2000];
        if (this._retryCount >= delays.length) {
            console.log('[TreeAnimation] requestCapture: giving up after ' + this._retryCount + ' retries');
            this._pendingCapture = false;
            return;
        }

        var delay = delays[this._retryCount];
        this._retryTimerId = setTimeout(function() {
            self._retryTimerId = null;
            if (!self._pendingCapture) return;

            self._ensureLayouts();

            if (self.capture()) {
                self.play();
            } else {
                self._retryCount++;
                self._scheduleRetry();
            }
        }, delay);
    },

    checkPendingCapture: function() {
        if (!this._pendingCapture || this._playing) return;

        this._ensureLayouts();

        if (this.capture()) {
            this.play();
        }
    },

    _ensureLayouts: function() {
        if (typeof TreeGrowth === 'undefined') return;

        var baseData = null;
        if (typeof TreePreview !== 'undefined' && TreePreview.getOutput) {
            baseData = TreePreview.getOutput();
        }
        if (!baseData) return;

        // Ensure the active mode's layout first
        var activeMode = TreeGrowth.activeMode;
        var activeMod = TreeGrowth.modes[activeMode];
        if (activeMod && activeMod._treeData) {
            // _builtPlacements format (tree mode)
            if (!activeMod._builtPlacements && typeof activeMod._computeBuiltLayout === 'function') {
                if (typeof activeMod._getOrCompute === 'function') {
                    activeMod._getOrCompute(baseData, 800, 800);
                }
                activeMod._builtPlacements = activeMod._computeBuiltLayout(baseData);
                if (activeMod._builtPlacements) {
                    console.log('[TreeAnimation] Forced ' + activeMode + ' builtPlacements: ' +
                        activeMod._builtPlacements.totalPlaced + ' nodes');
                }
            }
        }

        // Fallback: also ensure tree mode
        var treeModule = TreeGrowth.modes['tree'];
        if (treeModule && treeModule !== activeMod && treeModule._treeData && !treeModule._builtPlacements) {
            if (typeof treeModule._getOrCompute === 'function') {
                treeModule._getOrCompute(baseData, 800, 800);
            }
            if (typeof treeModule._computeBuiltLayout === 'function') {
                treeModule._builtPlacements = treeModule._computeBuiltLayout(baseData);
                if (treeModule._builtPlacements) {
                    console.log('[TreeAnimation] Forced tree layout: ' +
                        treeModule._builtPlacements.totalPlaced + ' nodes');
                }
            }
        }

        // Fallback: also ensure classic mode
        var classicModule = TreeGrowth.modes['classic'];
        if (classicModule && classicModule !== activeMod && classicModule._treeData &&
            (!classicModule._layoutData || !classicModule._layoutData.schools)) {
            if (typeof ClassicLayout !== 'undefined' && ClassicLayout.layoutAllSchools) {
                classicModule._layoutData = ClassicLayout.layoutAllSchools(
                    classicModule._treeData, baseData, classicModule.settings);
                if (classicModule._layoutData) {
                    console.log('[TreeAnimation] Forced classic layout');
                }
            }
        }
    },

    // =========================================================================
    // PLAYBACK
    // =========================================================================

    play: function(speed) {
        this.stop();

        if (!this._nodes || this._nodes.length === 0) return;

        this._speed = speed || 30;
        this._currentIdx = 0;
        this._newestAge = 0;
        this._playing = true;
        this._phase = 'nodes';

        // Reset chain progress
        if (this._chains) {
            for (var i = 0; i < this._chains.length; i++) {
                this._chains[i].progress = 0;
                this._chains[i].done = false;
            }
        }

        var self = this;
        var batchSize = 1;
        if (this._nodes.length > 500) batchSize = 3;
        else if (this._nodes.length > 200) batchSize = 2;

        this._intervalId = setInterval(function() {
            self._currentIdx += batchSize;
            self._newestAge = 0;

            if (self._currentIdx >= self._nodes.length) {
                self._currentIdx = self._nodes.length;
                clearInterval(self._intervalId);
                self._intervalId = null;
                console.log('[TreeAnimation] Phase 1 (nodes) complete');

                // Transition to Phase 2: chains
                // Re-capture chains in case PRM finished while Phase 1 was playing
                if (!self._chains || self._chains.length === 0) {
                    self._captureChains();
                }
                if (self._chains && self._chains.length > 0) {
                    self._startChainPhase();
                } else {
                    // PRM may still be processing — wait for it (timeout after 30s)
                    self._phase = 'waiting_chains';
                    self._playing = false;
                    console.log('[TreeAnimation] Phase 1 done, waiting for PRM locks...');
                    self._chainWaitTimer = setTimeout(function() {
                        if (self._phase === 'waiting_chains') {
                            self._phase = 'done';
                            console.log('[TreeAnimation] Chain wait timed out, finishing');
                            if (typeof PreReqMaster !== 'undefined' && PreReqMaster.renderPreview) {
                                PreReqMaster.renderPreview();
                            }
                        }
                    }, 30000);
                }
            }

            if (typeof PreReqMaster !== 'undefined' && PreReqMaster.renderPreview) {
                PreReqMaster.renderPreview();
            }
        }, this._speed);

        if (typeof PreReqMaster !== 'undefined' && PreReqMaster.renderPreview) {
            PreReqMaster.renderPreview();
        }

        console.log('[TreeAnimation] Playing ' + this._nodes.length + ' nodes at ' + this._speed + 'ms/node');
    },

    /**
     * Start Phase 2: animate lock chains growing from prereq to locked node.
     * All chains grow simultaneously.
     */
    _startChainPhase: function() {
        this._phase = 'chains';
        console.log('[TreeAnimation] Phase 2: animating ' + this._chains.length + ' chains');

        var self = this;
        this._chainIntervalId = setInterval(function() {
            var allDone = true;

            for (var i = 0; i < self._chains.length; i++) {
                var chain = self._chains[i];
                if (chain.done) continue;

                chain.progress += self._chainGrowRate;
                if (chain.progress >= 1) {
                    chain.progress = 1;
                    chain.done = true;
                } else {
                    allDone = false;
                }
            }

            if (allDone) {
                clearInterval(self._chainIntervalId);
                self._chainIntervalId = null;
                self._playing = false;
                self._phase = 'done';
                console.log('[TreeAnimation] Phase 2 (chains) complete');
            }

            if (typeof PreReqMaster !== 'undefined' && PreReqMaster.renderPreview) {
                PreReqMaster.renderPreview();
            }
        }, this._chainSpeed);
    },

    stop: function() {
        if (this._intervalId) {
            clearInterval(this._intervalId);
            this._intervalId = null;
        }
        if (this._chainIntervalId) {
            clearInterval(this._chainIntervalId);
            this._chainIntervalId = null;
        }
        if (this._retryTimerId) {
            clearTimeout(this._retryTimerId);
            this._retryTimerId = null;
        }
        if (this._chainWaitTimer) {
            clearTimeout(this._chainWaitTimer);
            this._chainWaitTimer = null;
        }
        this._playing = false;
        this._phase = 'idle';
        if (this._nodes) {
            this._currentIdx = this._nodes.length;
        }
        // Mark all chains as done
        if (this._chains) {
            for (var i = 0; i < this._chains.length; i++) {
                this._chains[i].progress = 1;
                this._chains[i].done = true;
            }
        }
    },

    isPlaying: function() {
        return this._playing || this._phase === 'waiting_chains';
    },

    hasData: function() {
        return this._nodes && this._nodes.length > 0;
    },

    /**
     * Called by PreReqMaster after locks have been applied.
     * If we're waiting for chains, capture and start Phase 2.
     */
    notifyLocksApplied: function() {
        if (this._phase !== 'waiting_chains') return;

        if (this._chainWaitTimer) {
            clearTimeout(this._chainWaitTimer);
            this._chainWaitTimer = null;
        }

        this._captureChains();
        if (this._chains && this._chains.length > 0) {
            console.log('[TreeAnimation] Locks arrived, starting Phase 2 with ' + this._chains.length + ' chains');
            this._playing = true;
            this._startChainPhase();
        } else {
            this._playing = false;
            this._phase = 'done';
            console.log('[TreeAnimation] Locks applied but no chain edges to animate');
        }
    },

    // =========================================================================
    // FRAME DATA (for renderers)
    // =========================================================================

    getFrameData: function() {
        if (!this._nodes) return null;

        var visibleCount = Math.min(this._currentIdx, this._nodes.length);
        var result = {
            nodes: this._nodes.slice(0, visibleCount),
            edges: null,
            newestIdx: visibleCount - 1,
            mode: this._mode,
            total: this._nodes.length,
            done: visibleCount >= this._nodes.length,
            phase: this._phase,
            chains: this._chains,
            lockedNodes: this._lockedNodes
        };

        if (this._edges) {
            var edgeCount = Math.max(0, visibleCount - 1);
            edgeCount = Math.min(edgeCount, this._edges.length);
            result.edges = this._edges.slice(0, edgeCount);
        }

        return result;
    },

    getProgress: function() {
        if (!this._nodes || this._nodes.length === 0) return 1;

        var nodeProgress = Math.min(this._currentIdx, this._nodes.length) / this._nodes.length;

        if (this._phase === 'nodes') {
            // Phase 1 is 0..0.7 of total progress
            return nodeProgress * 0.7;
        } else if (this._phase === 'chains' && this._chains) {
            // Phase 2 is 0.7..1.0
            var chainTotal = 0;
            for (var i = 0; i < this._chains.length; i++) {
                chainTotal += this._chains[i].progress;
            }
            var chainProgress = chainTotal / this._chains.length;
            return 0.7 + chainProgress * 0.3;
        }

        return 1;
    }
};
