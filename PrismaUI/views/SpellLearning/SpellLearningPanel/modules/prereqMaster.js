/**
 * prereqMaster.js - Pre Req Master: NLP-scored lock prerequisites for spell trees
 * 
 * Adds "lock" prerequisites to an existing spell tree using NLP similarity scoring.
 * Locks are hidden edges that only appear when the user clicks on a node.
 * They are visually distinct from normal prerequisites (chain-link edges, LOCK badges).
 * 
 * Flow:
 *   1. User configures settings (global %, tier %, pool, constraints)
 *   2. User clicks "Apply Locks"
 *   3. buildLockRequest() filters eligible spells and builds candidate pools
 *   4. Scoring: Python NLP (preferred) or JS fallback (token matching)
 *   5. applyLocks() assigns top-scoring candidates as lock prereqs
 *   6. Tree re-renders with chain edges for revealed locks
 */

(function() {
    'use strict';

    // Active tab tracking for preview canvas
    var _activeTab = 'locks';

    // Cached offscreen sprite for chain-link rendering (lazy-created)
    var _prmChainSprite = null;

    // =========================================================================
    // SETTINGS - Read from UI controls
    // =========================================================================

    function getSettings() {
        return {
            globalLockPercent: parseInt(document.getElementById('prmGlobalLockSlider')?.value || '30'),
            tierPercents: {
                novice:     parseInt(document.getElementById('prmTierNovice')?.value || '0'),
                apprentice: parseInt(document.getElementById('prmTierApprentice')?.value || '10'),
                adept:      parseInt(document.getElementById('prmTierAdept')?.value || '25'),
                expert:     parseInt(document.getElementById('prmTierExpert')?.value || '40'),
                master:     parseInt(document.getElementById('prmTierMaster')?.value || '50')
            },
            schoolDistribution: document.getElementById('prmSchoolDistribution')?.value || 'proportional',
            poolSource:     document.getElementById('prmPoolSource')?.value || 'same_school',
            distance:       parseInt(document.getElementById('prmDistanceSlider')?.value || '200'),
            proximityBias:  parseInt(document.getElementById('prmProximityBiasSlider')?.value || '50') / 100,
            sameTier:       document.getElementById('prmSameTier')?.checked !== false,
            prevTier:       document.getElementById('prmPrevTier')?.checked !== false,
            higherTier:     document.getElementById('prmHigherTier')?.checked === true,
            allowLockedLock: document.getElementById('prmAllowLockedLock')?.checked === true
        };
    }

    // =========================================================================
    // UTILITY — Proper Fisher-Yates shuffle (unbiased)
    // =========================================================================

    /**
     * Fisher-Yates (Knuth) in-place shuffle. Returns the same array, shuffled.
     * Unlike Array.sort(()=>Math.random()-0.5), this produces a truly uniform
     * random permutation.
     */
    function _fisherYatesShuffle(arr) {
        for (var i = arr.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
        }
        return arr;
    }

    // =========================================================================
    // TIER HELPERS
    // =========================================================================

    var TIER_MAP = {
        'novice': 0, 'apprentice': 1, 'adept': 2, 'expert': 3, 'master': 4,
        '0': 0, '1': 1, '2': 2, '3': 3, '4': 4
    };

    var TIER_NAMES = ['novice', 'apprentice', 'adept', 'expert', 'master'];

    /**
     * Get the SPELL SKILL TIER index (0-4) for a node.
     * IMPORTANT: node.tier is TREE DEPTH (can be 1-22+), NOT the spell tier!
     * We must use node.skillLevel (string like "Expert") or node.spell.skillLevel.
     */
    function getTierIndex(node) {
        // 1. Check skillLevel string first (the actual spell tier: "Novice", "Expert", etc.)
        var skillLevel = node.skillLevel ||
                         (node.spell && node.spell.skillLevel) ||
                         node.level || '';
        if (typeof skillLevel === 'string' && skillLevel.length > 0) {
            var lower = skillLevel.toLowerCase();
            if (TIER_MAP[lower] !== undefined) return TIER_MAP[lower];
        }

        // 2. If node.tier is a small number (0-4), it might be a real spell tier
        //    But if it's > 4, it's tree depth — map to spell tier range
        if (typeof node.tier === 'number') {
            if (node.tier >= 0 && node.tier <= 4) return node.tier;
            // Tree depth > 4: clamp/map to 0-4 range based on relative depth
            // Depths 1-4 → already handled. Depths 5+ → distribute across tiers.
            // Rough mapping: shallower = easier, deeper = harder
            if (node.tier <= 6) return 1;       // apprentice
            if (node.tier <= 9) return 2;       // adept
            if (node.tier <= 14) return 3;      // expert
            return 4;                            // master (depth 15+)
        }

        return 0; // fallback: novice
    }

    function getTierName(node) {
        var idx = getTierIndex(node);
        return TIER_NAMES[idx] || 'novice';
    }

    // =========================================================================
    // DISTANCE CALCULATION
    // =========================================================================

    /**
     * Euclidean distance using LAYOUT positions (pixel space).
     * Falls back to node.x/y if no layout pos available.
     * Returns Infinity if either node has no valid position.
     */
    var _cachedPosMap = null;

    function _getLayoutPosMap() {
        if (_cachedPosMap) return _cachedPosMap;
        if (typeof TreeGrowth !== 'undefined' && TreeGrowth.modes && TreeGrowth.activeMode) {
            var modeModule = TreeGrowth.modes[TreeGrowth.activeMode];
            if (modeModule && typeof modeModule.getPositionMap === 'function') {
                _cachedPosMap = modeModule.getPositionMap();
            }
        }
        return _cachedPosMap;
    }

    function gridDistance(a, b) {
        var posMap = _getLayoutPosMap();
        var aId = a.id || a.formId;
        var bId = b.id || b.formId;
        var ax, ay, bx, by;

        if (posMap && posMap[aId] && posMap[bId]) {
            ax = posMap[aId].x; ay = posMap[aId].y;
            bx = posMap[bId].x; by = posMap[bId].y;
        } else {
            // Fallback to node properties, but only if both have real coords
            ax = a.x; ay = a.y;
            bx = b.x; by = b.y;
            if (ax == null || ay == null || bx == null || by == null) return Infinity;
        }
        return Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));
    }

    // =========================================================================
    // TREE TRAVERSAL - Descendant/Ancestor checks for cycle prevention
    // =========================================================================

    /**
     * Build a set of all descendant formIds for a given node (everything
     * reachable by following 'children' edges). Used to prevent locks
     * from pointing to descendants (which creates deadlocks).
     */
    function _getDescendants(nodeId, allNodes) {
        var descendants = {};
        var queue = [];
        var startNode = allNodes.get(nodeId);
        if (!startNode || !startNode.children) return descendants;

        for (var i = 0; i < startNode.children.length; i++) {
            queue.push(startNode.children[i]);
        }

        while (queue.length > 0) {
            var curId = queue.shift();
            if (descendants[curId]) continue;
            descendants[curId] = true;
            var curNode = allNodes.get(curId);
            if (curNode && curNode.children) {
                for (var j = 0; j < curNode.children.length; j++) {
                    queue.push(curNode.children[j]);
                }
            }
        }
        return descendants;
    }

    /**
     * Check if candidateId is a descendant of spellId (i.e. spellId can reach
     * candidateId through children). If so, locking spellId with candidateId
     * would create a deadlock.
     */
    function _isDescendant(spellId, candidateId, allNodes) {
        var queue = [];
        var startNode = allNodes.get(spellId);
        if (!startNode || !startNode.children) return false;

        for (var i = 0; i < startNode.children.length; i++) {
            queue.push(startNode.children[i]);
        }

        var visited = {};
        while (queue.length > 0) {
            var curId = queue.shift();
            if (curId === candidateId) return true;
            if (visited[curId]) continue;
            visited[curId] = true;
            var curNode = allNodes.get(curId);
            if (curNode && curNode.children) {
                for (var j = 0; j < curNode.children.length; j++) {
                    queue.push(curNode.children[j]);
                }
            }
        }
        return false;
    }

    /**
     * Check if candidateId is an ancestor of spellId (i.e. candidateId must
     * be learned before spellId through the normal prereq chain). Locking
     * with an ancestor is safe but redundant - we allow it but prefer
     * non-ancestor candidates.
     */
    function _isAncestor(spellId, candidateId, allNodes) {
        var queue = [];
        var startNode = allNodes.get(spellId);
        if (!startNode || !startNode.prerequisites) return false;

        for (var i = 0; i < startNode.prerequisites.length; i++) {
            queue.push(startNode.prerequisites[i]);
        }

        var visited = {};
        while (queue.length > 0) {
            var curId = queue.shift();
            if (curId === candidateId) return true;
            if (visited[curId]) continue;
            visited[curId] = true;
            var curNode = allNodes.get(curId);
            if (curNode && curNode.prerequisites) {
                for (var j = 0; j < curNode.prerequisites.length; j++) {
                    queue.push(curNode.prerequisites[j]);
                }
            }
        }
        return false;
    }

    /**
     * After locks are applied, verify all nodes in each school are reachable
     * from the school root. Returns array of unreachable node names.
     */
    function _validateReachability(allNodes) {
        var unreachable = [];
        // Group by school, find roots
        var schools = {};
        allNodes.forEach(function(node, id) {
            var school = node.school || 'Unknown';
            if (!schools[school]) schools[school] = { root: null, nodes: [] };
            schools[school].nodes.push(id);
            if (node.isRoot) schools[school].root = id;
        });

        for (var schoolName in schools) {
            var schoolData = schools[schoolName];
            var rootId = schoolData.root;
            if (!rootId) continue;

            // BFS from root following children
            var reachable = {};
            var queue = [rootId];
            while (queue.length > 0) {
                var curId = queue.shift();
                if (reachable[curId]) continue;
                reachable[curId] = true;
                var curNode = allNodes.get(curId);
                if (curNode && curNode.children) {
                    for (var i = 0; i < curNode.children.length; i++) {
                        queue.push(curNode.children[i]);
                    }
                }
            }

            // Check all school nodes are reachable
            for (var j = 0; j < schoolData.nodes.length; j++) {
                var nid = schoolData.nodes[j];
                if (!reachable[nid]) {
                    var node = allNodes.get(nid);
                    unreachable.push((node ? node.name : nid) + ' (' + schoolName + ')');
                }
            }
        }

        return unreachable;
    }

    /**
     * Check if candidate is reachable from any root WITHOUT going through spellId.
     * If removing spellId from the tree makes candidate unreachable, then locking
     * spellId with candidate would create a deadlock (candidate can't be learned
     * without first progressing through spellId's branch).
     * @param {string} spellId - The spell being locked
     * @param {string} candidateId - The candidate lock target
     * @param {Map} allNodes - All tree nodes
     * @returns {boolean} True if candidate is ONLY reachable through spellId
     */
    function _isOnlyReachableThrough(spellId, candidateId, allNodes) {
        // Find all roots
        var roots = [];
        allNodes.forEach(function(node, id) {
            if (node.isRoot) roots.push(id);
        });
        if (roots.length === 0) return false;

        // BFS from all roots, skipping spellId entirely
        var reachable = {};
        var queue = roots.slice();
        while (queue.length > 0) {
            var curId = queue.shift();
            if (curId === spellId) continue; // Skip the spell being locked
            if (reachable[curId]) continue;
            reachable[curId] = true;
            var curNode = allNodes.get(curId);
            if (curNode && curNode.children) {
                for (var i = 0; i < curNode.children.length; i++) {
                    queue.push(curNode.children[i]);
                }
            }
        }

        // If candidate is NOT reachable without spellId, this lock would deadlock
        return !reachable[candidateId];
    }

    /**
     * Detect cycles in the combined tree prerequisite + lock dependency graph.
     * A "dependency" means: to learn node X you must first learn all its
     * prerequisites (tree edges) AND all its lock targets (hardPrereqs).
     * 
     * Returns an array of { nodeId, lockNodeId } pairs representing locks that
     * participate in cycles and should be removed to break deadlocks.
     * 
     * Uses Kahn's algorithm (topological sort via in-degree counting).
     * Nodes remaining after the sort has exhausted all zero-in-degree nodes
     * are in cycles.
     * 
     * @param {Map} allNodes - All tree nodes
     * @returns {Array} Locks to remove: [{ nodeId, lockNodeId }]
     */
    function _detectAndRemoveLockCycles(allNodes) {
        // Build adjacency list: edge from A->B means "B depends on A" (A must be learned first)
        // Equivalently, B has in-edge from A.
        // We track in-degree for each node and adjacency for forward traversal.
        var inDegree = {};
        var adjList = {};   // adjList[A] = [B, C, ...] means A is a dependency of B, C, ...
        var lockEdges = []; // Track which edges are lock-based (for targeted removal)

        allNodes.forEach(function(node, id) {
            if (!inDegree[id]) inDegree[id] = 0;
            if (!adjList[id]) adjList[id] = [];
        });

        // Add tree prerequisite edges (parent -> child means child depends on parent)
        allNodes.forEach(function(node, id) {
            if (node.prerequisites) {
                for (var i = 0; i < node.prerequisites.length; i++) {
                    var prereqId = node.prerequisites[i];
                    if (!adjList[prereqId]) adjList[prereqId] = [];
                    adjList[prereqId].push(id);
                    inDegree[id] = (inDegree[id] || 0) + 1;
                }
            }
        });

        // Add lock edges (lock target -> locked node means locked node depends on lock target)
        allNodes.forEach(function(node, id) {
            if (node.locks && node.locks.length > 0) {
                for (var i = 0; i < node.locks.length; i++) {
                    var lockTargetId = node.locks[i].nodeId;
                    if (!adjList[lockTargetId]) adjList[lockTargetId] = [];
                    adjList[lockTargetId].push(id);
                    inDegree[id] = (inDegree[id] || 0) + 1;
                    lockEdges.push({ nodeId: id, lockNodeId: lockTargetId });
                }
            }
        });

        // Kahn's algorithm: topological sort
        var queue = [];
        for (var nid in inDegree) {
            if (inDegree[nid] === 0) queue.push(nid);
        }

        var sorted = 0;
        while (queue.length > 0) {
            var cur = queue.shift();
            sorted++;
            if (adjList[cur]) {
                for (var j = 0; j < adjList[cur].length; j++) {
                    var neighbor = adjList[cur][j];
                    inDegree[neighbor]--;
                    if (inDegree[neighbor] === 0) {
                        queue.push(neighbor);
                    }
                }
            }
        }

        // If all nodes were sorted, no cycles
        var totalNodes = 0;
        for (var k in inDegree) totalNodes++;

        if (sorted === totalNodes) {
            return []; // No cycles
        }

        // Nodes still with inDegree > 0 are in cycles
        var inCycle = {};
        for (var cid in inDegree) {
            if (inDegree[cid] > 0) inCycle[cid] = true;
        }

        // Find lock edges where both endpoints are in cycles - these are the offenders
        var toRemove = [];
        for (var li = 0; li < lockEdges.length; li++) {
            var le = lockEdges[li];
            if (inCycle[le.nodeId] || inCycle[le.lockNodeId]) {
                toRemove.push(le);
            }
        }

        return toRemove;
    }

    /**
     * Remove specific lock edges from nodes. Returns count of removed locks.
     * @param {Array} locksToRemove - Array of { nodeId, lockNodeId }
     * @param {Map} allNodes - All tree nodes
     * @returns {number} Number of locks removed
     */
    function _removeLockEdges(locksToRemove, allNodes) {
        var removed = 0;
        for (var i = 0; i < locksToRemove.length; i++) {
            var edge = locksToRemove[i];
            var node = allNodes.get(edge.nodeId);
            if (!node || !node.locks) continue;

            var before = node.locks.length;
            node.locks = node.locks.filter(function(lock) {
                return lock.nodeId !== edge.lockNodeId;
            });
            var delta = before - node.locks.length;
            if (delta > 0) {
                removed += delta;
                _prmLog('REMOVED deadlock lock: ' + (node.name || edge.nodeId) + ' -> ' + edge.lockNodeId);
            }
        }
        return removed;
    }

    // =========================================================================
    // JS FALLBACK SCORER - TF-IDF + Cosine Similarity
    // Ported from prereq_master_scorer.py for consistent results
    // =========================================================================

    function tokenize(text) {
        if (!text) return [];
        return text.toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(function(w) { return w.length > 2; });
    }

    function buildTextBlob(node) {
        var parts = [];
        // Weight name 2x (repeat it) to match Python scorer behavior
        if (node.name) { parts.push(node.name); parts.push(node.name); }
        if (node.desc) parts.push(node.desc);
        if (node.effects && Array.isArray(node.effects)) {
            node.effects.forEach(function(e) {
                if (typeof e === 'string') parts.push(e);
                else if (e && e.name) parts.push(e.name);
            });
        }
        return parts.join(' ');
    }

    /**
     * Compute TF-IDF vectors for a list of token arrays (documents).
     * @param {Array<Array<string>>} documents - Array of tokenized documents
     * @returns {Array<Object>} Array of sparse TF-IDF vectors (token -> weight)
     */
    function computeTfIdf(documents) {
        // Document frequency: how many docs contain each token
        var df = {};
        var nDocs = documents.length;

        documents.forEach(function(doc) {
            var seen = {};
            doc.forEach(function(token) {
                if (!seen[token]) {
                    seen[token] = true;
                    df[token] = (df[token] || 0) + 1;
                }
            });
        });

        // IDF: smoothed inverse document frequency
        var idf = {};
        for (var token in df) {
            idf[token] = Math.log((nDocs + 1) / (df[token] + 1)) + 1;
        }

        // TF-IDF vectors
        var vectors = [];
        documents.forEach(function(doc) {
            var tf = {};
            doc.forEach(function(token) { tf[token] = (tf[token] || 0) + 1; });
            var total = doc.length || 1;
            var vec = {};
            for (var t in tf) {
                vec[t] = (tf[t] / total) * (idf[t] || 1.0);
            }
            vectors.push(vec);
        });

        return vectors;
    }

    /**
     * Compute cosine similarity between two sparse vectors (objects).
     */
    function cosineSimilarity(vecA, vecB) {
        var dot = 0;
        for (var token in vecA) {
            if (vecB[token]) dot += vecA[token] * vecB[token];
        }

        var magA = 0, magB = 0;
        for (var a in vecA) magA += vecA[a] * vecA[a];
        for (var b in vecB) magB += vecB[b] * vecB[b];

        magA = Math.sqrt(magA);
        magB = Math.sqrt(magB);

        if (magA === 0 || magB === 0) return 0;
        return dot / (magA * magB);
    }

    /**
     * JS TF-IDF similarity scorer (fallback when Python unavailable).
     * Builds a per-pair TF-IDF corpus and scores via cosine similarity.
     * Matches the algorithm in prereq_master_scorer.py.
     */
    function jsSimilarityScore(spellNode, candidateNode) {
        var tokensA = tokenize(buildTextBlob(spellNode));
        var tokensB = tokenize(buildTextBlob(candidateNode));
        if (tokensA.length === 0 || tokensB.length === 0) return 0;

        var vectors = computeTfIdf([tokensA, tokensB]);
        return cosineSimilarity(vectors[0], vectors[1]);
    }

    /**
     * Batch-score all candidates for a spell using TF-IDF.
     * Builds a single corpus (spell + all candidates) for better IDF weighting.
     * @param {Object} spellNode - The spell to score against
     * @param {Array} candidates - Array of candidate nodes
     * @returns {Array} [{node, score}] sorted by score descending
     */
    function batchTfIdfScore(spellNode, candidates) {
        if (!candidates || candidates.length === 0) return [];

        var spellTokens = tokenize(buildTextBlob(spellNode));
        if (spellTokens.length === 0) return candidates.map(function(c) { return { node: c, score: 0 }; });

        var allDocs = [spellTokens];
        candidates.forEach(function(cand) {
            allDocs.push(tokenize(buildTextBlob(cand)));
        });

        var vectors = computeTfIdf(allDocs);
        var spellVec = vectors[0];

        var scored = [];
        for (var i = 0; i < candidates.length; i++) {
            scored.push({
                node: candidates[i],
                score: cosineSimilarity(spellVec, vectors[i + 1])
            });
        }

        scored.sort(function(a, b) { return b.score - a.score; });
        return scored;
    }

    // =========================================================================
    // POOL FILTERING
    // =========================================================================

    /**
     * Build the candidate pool for a given spell node.
     * @param {Object} spellNode - The spell to find a lock prereq for
     * @param {Map} allNodes - TreeParser.nodes
     * @param {Object} settings - From getSettings()
     * @returns {Array} Array of candidate nodes
     */
    function buildCandidatePool(spellNode, allNodes, settings) {
        var candidates = [];
        var spellTier = getTierIndex(spellNode);
        var spellId = spellNode.id || spellNode.formId;

        // Pre-compute descendants of this spell (single BFS)
        var spellDescendants = _getDescendants(spellId, allNodes);

        // Pre-compute reachability WITHOUT this spell (single BFS replaces N per-candidate calls)
        var reachableWithoutSpell = {};
        var roots = [];
        allNodes.forEach(function(node, nid) {
            if (node.isRoot) roots.push(nid);
        });
        var bfsQueue = roots.slice();
        while (bfsQueue.length > 0) {
            var curId = bfsQueue.shift();
            if (curId === spellId) continue;
            if (reachableWithoutSpell[curId]) continue;
            reachableWithoutSpell[curId] = true;
            var curNode = allNodes.get(curId);
            if (curNode && curNode.children) {
                for (var ci = 0; ci < curNode.children.length; ci++) {
                    bfsQueue.push(curNode.children[ci]);
                }
            }
        }

        allNodes.forEach(function(candidate, id) {
            // --- Cheap checks first ---
            if (id === spellId) return;
            if (candidate.isRoot) return;

            // Pool source filter (school/distance) — fast rejection
            if (settings.poolSource === 'same_school') {
                if (candidate.school !== spellNode.school) return;
            } else if (settings.poolSource === 'nearby') {
                var dist = gridDistance(spellNode, candidate);
                if (dist > settings.distance) return;
            }

            // Tier constraint filter
            var candTier = getTierIndex(candidate);
            if (candTier === spellTier && !settings.sameTier) return;
            if (candTier < spellTier && !settings.prevTier) return;
            if (candTier > spellTier && !settings.higherTier) return;

            // Don't let locked nodes lock each other (unless toggle is on)
            if (!settings.allowLockedLock) {
                if (candidate.locks && candidate.locks.length > 0) return;
            }

            // Can't pick a node that's already a regular prerequisite (redundant)
            if (spellNode.prerequisites && spellNode.prerequisites.indexOf(id) !== -1) return;
            if (spellNode.hardPrereqs && spellNode.hardPrereqs.indexOf(id) !== -1) return;

            // Can't pick a node that's already a lock
            if (spellNode.locks) {
                var alreadyLocked = false;
                for (var i = 0; i < spellNode.locks.length; i++) {
                    if (spellNode.locks[i].nodeId === id) { alreadyLocked = true; break; }
                }
                if (alreadyLocked) return;
            }

            // --- Pre-computed graph checks (O(1) lookups) ---
            // Can't lock to a descendant (creates deadlock)
            if (spellDescendants[id]) return;
            // Can't lock to a node only reachable through spellId (deadlock)
            if (!reachableWithoutSpell[id]) return;

            candidates.push(candidate);
        });

        // Cap pool size to prevent massive payloads
        var MAX_CANDIDATES = 50;
        if (candidates.length > MAX_CANDIDATES) {
            if (settings.poolSource === 'nearby') {
                // Nearby: keep closest by distance
                candidates.sort(function(a, b) {
                    return gridDistance(spellNode, a) - gridDistance(spellNode, b);
                });
                candidates = candidates.slice(0, MAX_CANDIDATES);
            } else {
                // Same school / any school: random sample
                _fisherYatesShuffle(candidates);
                candidates = candidates.slice(0, MAX_CANDIDATES);
            }
        }

        return candidates;
    }

    // =========================================================================
    // LOCK ASSIGNMENT
    // =========================================================================

    /**
     * Build the lock request: determine which spells get locks and their candidate pools.
     * @returns {Object} { eligible: [{node, candidates}...], settings }
     */
    function _prmLog(msg) {
        var full = '[PreReqMaster] ' + msg;
        console.log(full);
        if (window.callCpp) {
            try { window.callCpp('LogMessage', JSON.stringify({ level: 'info', message: full })); } catch(e) {}
        }
    }

    /**
     * Build a Map of all nodes from the active tree growth mode's _treeData.
     * Returns a Map<formId, node> matching the interface PRM expects.
     * Falls back to TreeParser.nodes if available.
     */
    function _getAllNodes() {
        // Primary: pull from active tree growth mode
        if (typeof TreeGrowth !== 'undefined' && TreeGrowth.modes && TreeGrowth.activeMode) {
            var modeModule = TreeGrowth.modes[TreeGrowth.activeMode];
            if (modeModule && modeModule._treeData && modeModule._treeData.schools) {
                var nodeMap = new Map();
                var schools = modeModule._treeData.schools;
                for (var schoolName in schools) {
                    if (!schools.hasOwnProperty(schoolName)) continue;
                    var src = schools[schoolName];
                    var srcNodes = src.nodes || [];
                    var rootId = src.root || (srcNodes.length > 0 ? srcNodes[0].formId : '');
                    for (var i = 0; i < srcNodes.length; i++) {
                        var sn = srcNodes[i];
                        if (!sn.formId) continue;
                        // Ensure school is set on node
                        if (!sn.school) sn.school = schoolName;
                        // Mark root
                        if (sn.formId === rootId) sn.isRoot = true;
                        // Ensure id alias
                        if (!sn.id) sn.id = sn.formId;
                        nodeMap.set(sn.formId, sn);
                    }
                }
                if (nodeMap.size > 0) {
                    return nodeMap;
                }
            }
        }

        // Fallback: TreeParser (legacy / tree viewer path)
        if (typeof TreeParser !== 'undefined' && TreeParser.nodes && TreeParser.nodes.size > 0) {
            return TreeParser.nodes;
        }

        return null;
    }

    function buildLockRequest() {
        var allNodes = _getAllNodes();
        if (!allNodes || allNodes.size === 0) {
            _prmLog('No tree data available (allNodes=' + (allNodes ? allNodes.size : 'null') + ')');
            return null;
        }

        var settings = getSettings();

        _prmLog('buildLockRequest: nodes=' + allNodes.size + ', globalLock%=' + settings.globalLockPercent +
                ', pool=' + settings.poolSource + ', dist=' + settings.distance);

        // Sample first 3 nodes to check tier values
        var sampleCount = 0;
        allNodes.forEach(function(node) {
            if (sampleCount < 3) {
                _prmLog('  sample node: id=' + (node.id || node.formId) + ', tier=' + node.tier +
                        ', school=' + node.school + ', isRoot=' + node.isRoot);
                sampleCount++;
            }
        });

        // Group nodes by school and tier
        var schoolTierGroups = {}; // { school: { tier: [nodes] } }
        allNodes.forEach(function(node) {
            if (node.isRoot) return; // Skip root nodes
            var school = node.school || 'Unknown';
            var tierName = getTierName(node);
            if (!schoolTierGroups[school]) schoolTierGroups[school] = {};
            if (!schoolTierGroups[school][tierName]) schoolTierGroups[school][tierName] = [];
            schoolTierGroups[school][tierName].push(node);
        });

        // Calculate total spells per school
        var schoolCounts = {};
        var totalSpells = 0;
        for (var school in schoolTierGroups) {
            schoolCounts[school] = 0;
            for (var tier in schoolTierGroups[school]) {
                schoolCounts[school] += schoolTierGroups[school][tier].length;
            }
            totalSpells += schoolCounts[school];
        }

        // How many total locks to assign
        var totalLocks = Math.round(totalSpells * settings.globalLockPercent / 100);

        // Log tier distribution
        var tierDist = {};
        for (var ds in schoolTierGroups) {
            for (var dt in schoolTierGroups[ds]) {
                tierDist[dt] = (tierDist[dt] || 0) + schoolTierGroups[ds][dt].length;
            }
        }
        _prmLog('tierDist=' + JSON.stringify(tierDist) + ', totalSpells=' + totalSpells + ', totalLocks=' + totalLocks);
        _prmLog('tierPercents=' + JSON.stringify(settings.tierPercents));

        // Distribute locks across schools
        var schoolLockBudgets = {};
        var schoolNames = Object.keys(schoolCounts);

        if (settings.schoolDistribution === 'even') {
            var perSchool = Math.floor(totalLocks / schoolNames.length);
            schoolNames.forEach(function(s) { schoolLockBudgets[s] = perSchool; });
        } else if (settings.schoolDistribution === 'proportional') {
            schoolNames.forEach(function(s) {
                schoolLockBudgets[s] = Math.round(totalLocks * schoolCounts[s] / totalSpells);
            });
        } else { // random
            schoolNames.forEach(function(s) { schoolLockBudgets[s] = 0; });
            for (var i = 0; i < totalLocks; i++) {
                var randomSchool = schoolNames[Math.floor(Math.random() * schoolNames.length)];
                schoolLockBudgets[randomSchool]++;
            }
        }

        // For each school, pick eligible spells per tier
        var eligible = [];

        _prmLog('schoolBudgets=' + JSON.stringify(schoolLockBudgets));

        for (var sch in schoolTierGroups) {
            var budget = schoolLockBudgets[sch] || 0;
            if (budget <= 0) continue;

            // Distribute budget across tiers based on tier %
            var tierNodes = schoolTierGroups[sch];
            var tierBudgets = {};
            var allocatedSoFar = 0;

            TIER_NAMES.forEach(function(tierName) {
                var nodesInTier = (tierNodes[tierName] || []).length;
                var tierPct = settings.tierPercents[tierName] || 0;
                var tierCount = Math.min(
                    Math.round(nodesInTier * tierPct / 100),
                    budget - allocatedSoFar
                );
                tierBudgets[tierName] = tierCount;
                allocatedSoFar += tierCount;
            });

            _prmLog('school=' + sch + ' budget=' + budget + ' tierBudgets=' + JSON.stringify(tierBudgets) + ' allocated=' + allocatedSoFar);

            // Fallback: if tier-based allocation gave 0, distribute budget randomly across all non-root nodes
            if (allocatedSoFar === 0 && budget > 0) {
                _prmLog('FALLBACK: tier allocation=0 for ' + sch + ', distributing ' + budget + ' randomly');
                var allSchoolNodes = [];
                for (var ft in tierNodes) {
                    allSchoolNodes = allSchoolNodes.concat(tierNodes[ft]);
                }
                _fisherYatesShuffle(allSchoolNodes);
                var fbPicked = allSchoolNodes.slice(0, Math.min(budget, allSchoolNodes.length));
                fbPicked.forEach(function(node) {
                    var candidates = buildCandidatePool(node, allNodes, settings);
                    if (candidates.length > 0) {
                        eligible.push({ node: node, candidates: candidates });
                    }
                });
                continue; // skip the normal tier-based loop below
            }

            // Pick random spells from each tier to receive locks
            var tierPickedIds = {};  // track which nodes got picked
            TIER_NAMES.forEach(function(tierName) {
                var count = tierBudgets[tierName] || 0;
                var pool = tierNodes[tierName] || [];
                if (count <= 0 || pool.length === 0) return;

                // Shuffle and pick (Fisher-Yates for uniform distribution)
                var shuffled = pool.slice();
                _fisherYatesShuffle(shuffled);
                var picked = shuffled.slice(0, count);

                picked.forEach(function(node) {
                    tierPickedIds[node.id || node.formId] = true;
                    var candidates = buildCandidatePool(node, allNodes, settings);
                    if (candidates.length > 0) {
                        eligible.push({ node: node, candidates: candidates });
                    }
                });
            });

            // Safety net: if tier allocation didn't fill the budget, distribute remaining randomly
            var remaining = budget - allocatedSoFar;
            if (remaining > 0) {
                _prmLog('REMAINDER: ' + remaining + ' unallocated locks for ' + sch + ', distributing randomly');
                var allSchoolNodesR = [];
                for (var rt in tierNodes) {
                    tierNodes[rt].forEach(function(n) {
                        if (!tierPickedIds[n.id || n.formId]) allSchoolNodesR.push(n);
                    });
                }
                _fisherYatesShuffle(allSchoolNodesR);
                var remPicked = allSchoolNodesR.slice(0, Math.min(remaining, allSchoolNodesR.length));
                remPicked.forEach(function(node) {
                    var candidates = buildCandidatePool(node, allNodes, settings);
                    if (candidates.length > 0) {
                        eligible.push({ node: node, candidates: candidates });
                    }
                });
            }
        }

        _prmLog('Result: eligible=' + eligible.length + '/' + totalLocks + ' target locks');
        return { eligible: eligible, settings: settings };
    }

    /**
     * Score candidates and apply locks using JS TF-IDF scorer (fallback).
     * @param {Object} request - From buildLockRequest()
     */
    function applyLocksWithJSScorer(request) {
        if (!request || !request.eligible) return 0;

        var lockCount = 0;

        // Track how many times each node has been used as a lock target.
        // Cap at 2 to prevent one popular node from being everyone's prerequisite.
        var targetUsage = {};  // nodeId -> count
        var MAX_TARGET_USES = 2;

        // Shuffle the eligible list so no school/tier order bias in who gets first pick
        _fisherYatesShuffle(request.eligible);

        request.eligible.forEach(function(item) {
            var spellNode = item.node;
            var candidates = item.candidates;
            var settings = request.settings;

            // Filter out candidates that have already been used as a target too many times
            // Also filter out candidates that gained locks during this batch (chain lock prevention)
            var availableCandidates = candidates.filter(function(c) {
                var cId = c.id || c.formId;
                if ((targetUsage[cId] || 0) >= MAX_TARGET_USES) return false;
                if (!settings.allowLockedLock && c.locks && c.locks.length > 0) return false;
                return true;
            });

            if (availableCandidates.length === 0) {
                _prmLog('SKIP lock for ' + (spellNode.name || spellNode.formId) +
                         ': all ' + candidates.length + ' candidates hit target cap (' + MAX_TARGET_USES + ')');
                return;
            }

            // Batch TF-IDF scoring (builds corpus per spell for proper IDF weighting)
            var scored = batchTfIdfScore(spellNode, availableCandidates);

            // Blend with proximity if nearby mode
            if (settings.poolSource === 'nearby' && settings.proximityBias > 0) {
                var maxDist = settings.distance || 5;
                scored = scored.map(function(s) {
                    var dist = gridDistance(spellNode, s.node);
                    var proxScore = maxDist > 0 ? Math.max(0, 1 - (dist / maxDist)) : 0;
                    return {
                        node: s.node,
                        score: (1 - settings.proximityBias) * s.score + settings.proximityBias * proxScore
                    };
                });
                scored.sort(function(a, b) { return b.score - a.score; });
            }

            // Pick from top candidates (weighted random to avoid always picking #1)
            // Take top 5 candidates, then weighted-random select one (higher score = more likely)
            if (scored.length > 0) {
                var topN = scored.slice(0, Math.min(5, scored.length));

                // Weighted random: score-proportional probability
                var totalScore = 0;
                for (var si = 0; si < topN.length; si++) {
                    totalScore += Math.max(topN[si].score, 0.01); // floor at 0.01 so 0-scored items have a small chance
                }
                var roll = Math.random() * totalScore;
                var cumulative = 0;
                var chosen = topN[0]; // fallback
                for (var ci = 0; ci < topN.length; ci++) {
                    cumulative += Math.max(topN[ci].score, 0.01);
                    if (roll <= cumulative) {
                        chosen = topN[ci];
                        break;
                    }
                }

                var chosenId = chosen.node.id || chosen.node.formId;

                if (!spellNode.locks) spellNode.locks = [];

                spellNode.locks.push({
                    nodeId: chosenId,
                    score: Math.round(chosen.score * 1000) / 1000,
                    revealed: false
                });

                // Track target usage
                targetUsage[chosenId] = (targetUsage[chosenId] || 0) + 1;

                lockCount++;
            }
        });

        _prmLog('Applied ' + lockCount + ' locks (JS TF-IDF scorer)');

        // Post-assignment: detect and remove cycles in the combined tree+lock graph
        var allNodesAfter = _getAllNodes();
        var cycleLocks = _detectAndRemoveLockCycles(allNodesAfter);
        if (cycleLocks.length > 0) {
            _prmLog('CYCLE DETECTION: Found ' + cycleLocks.length + ' lock edges in cycles, removing...');
            var removedCount = _removeLockEdges(cycleLocks, allNodesAfter);
            lockCount -= removedCount;
            if (lockCount < 0) lockCount = 0;
            _prmLog('Removed ' + removedCount + ' deadlock-causing locks, ' + lockCount + ' locks remain');
        } else {
            _prmLog('Cycle detection passed - no deadlocks in combined tree+lock graph');
        }

        // Validate reachability
        var unreachable = _validateReachability(allNodesAfter);
        if (unreachable.length > 0) {
            _prmLog('WARNING: ' + unreachable.length + ' nodes unreachable after locks: ' + unreachable.join(', '));
        } else {
            _prmLog('Reachability check passed - all nodes reachable from root');
        }

        return lockCount;
    }

    /**
     * Build the payload for Python NLP scoring (same format as prereq_master_scorer.py expects).
     */
    function _buildPythonPayload(request) {
        return {
            pairs: request.eligible.map(function(item) {
                return {
                    spellId: item.node.id || item.node.formId,
                    spell: {
                        name: item.node.name || '',
                        desc: item.node.desc || '',
                        effects: (item.node.effects || []).map(function(e) {
                            return typeof e === 'string' ? e : (e.name || '');
                        })
                    },
                    candidates: item.candidates.map(function(c) {
                        return {
                            nodeId: c.id || c.formId,
                            name: c.name || '',
                            desc: c.desc || '',
                            effects: (c.effects || []).map(function(e) {
                                return typeof e === 'string' ? e : (e.name || '');
                            }),
                            distance: gridDistance(item.node, c)
                        };
                    })
                };
            }),
            settings: {
                proximityBias: request.settings.proximityBias,
                poolSource: request.settings.poolSource,
                distance: request.settings.distance
            }
        };
    }

    /**
     * Apply locks using the best available scorer.
     * Tries Python NLP via C++ bridge first, falls back to JS TF-IDF.
     * @returns {number} Lock count (sync), or -1 if async (Python)
     */
    function applyLocksWithScorer(request) {
        if (!request || !request.eligible || request.eligible.length === 0) return 0;

        // Try Python NLP via C++ bridge
        if (window.callCpp) {
            try {
                var payload = _buildPythonPayload(request);
                _prmLog('Sending ' + payload.pairs.length + ' pairs to Python NLP scorer...');
                window.callCpp('PreReqMasterScore', JSON.stringify(payload));
                return -1; // Async - result comes via onPreReqMasterComplete callback
            } catch (e) {
                _prmLog('Python bridge failed, using JS TF-IDF fallback: ' + e.message);
            }
        }

        // Fallback: JS TF-IDF scorer (synchronous)
        return applyLocksWithJSScorer(request);
    }

    /**
     * Callback from Python NLP scoring.
     * @param {string} resultStr - JSON string with scored results
     */
    window.onPreReqMasterComplete = function(resultStr) {
        try {
            // Respect PRM toggle — if user disabled PRM while Python was scoring, bail out
            if (!isEnabled()) {
                _prmLog('PRM disabled during Python scoring — discarding results');
                updateStatus('Prerequisite locks disabled');
                if (typeof BuildProgress !== 'undefined' && BuildProgress.isActive()) {
                    BuildProgress.setStage('finalize');
                    setTimeout(function() { BuildProgress.complete('PRM disabled'); }, 300);
                }
                return;
            }

            var result = typeof resultStr === 'string' ? JSON.parse(resultStr) : resultStr;
            if (!result.success || !result.scores) {
                _prmLog('Python scoring failed: ' + (result.error || 'unknown') + ' - falling back to JS TF-IDF');
                // Fall back to JS TF-IDF scorer
                var request = buildLockRequest();
                if (request) {
                    var count = applyLocksWithJSScorer(request);
                    updateStatus(count + ' locks applied (JS fallback)');
                    onLocksChanged();
                    if (typeof TreeAnimation !== 'undefined' && TreeAnimation.notifyLocksApplied) {
                        TreeAnimation.notifyLocksApplied();
                    }
                } else {
                    updateStatus('No eligible spells for locks');
                }
                return;
            }

            // Apply Python NLP results with cycle validation + weighted random + target cap
            var lockCount = 0;
            var skippedCount = 0;
            var nlpNodes = _getAllNodes();
            var nlpSettings = getSettings();
            var nlpTargetUsage = {};  // nodeId -> count
            var NLP_MAX_TARGET_USES = 2;

            // Shuffle to avoid order bias
            _fisherYatesShuffle(result.scores);

            result.scores.forEach(function(item) {
                var node = nlpNodes ? nlpNodes.get(item.spellId) : null;
                if (!node) return;

                var spellId = node.id || node.formId;

                // Use topCandidates if available (new format), fall back to bestMatch
                var topCandidates = item.topCandidates || [{ nodeId: item.bestMatch, score: item.score }];

                // Filter out candidates that would create deadlocks, hit the target cap, or violate chain lock setting
                var validCandidates = [];
                for (var vi = 0; vi < topCandidates.length; vi++) {
                    var cId = topCandidates[vi].nodeId;
                    if ((nlpTargetUsage[cId] || 0) >= NLP_MAX_TARGET_USES) continue;
                    // Chain lock check: skip candidates that already have locks assigned this batch
                    if (!nlpSettings.allowLockedLock) {
                        var candNode = nlpNodes ? nlpNodes.get(cId) : null;
                        if (candNode && candNode.locks && candNode.locks.length > 0) continue;
                    }
                    if (!_isDescendant(spellId, cId, nlpNodes) && !_isOnlyReachableThrough(spellId, cId, nlpNodes)) {
                        validCandidates.push(topCandidates[vi]);
                    }
                }

                if (validCandidates.length === 0) {
                    _prmLog('REJECTED all candidates for ' + (node.name || spellId) + ' (deadlock/cap)');
                    skippedCount++;
                    return;
                }

                // Weighted random selection from valid candidates
                var totalScore = 0;
                for (var ts = 0; ts < validCandidates.length; ts++) {
                    totalScore += Math.max(validCandidates[ts].score, 0.01);
                }
                var roll = Math.random() * totalScore;
                var cumul = 0;
                var chosen = validCandidates[0];
                for (var wc = 0; wc < validCandidates.length; wc++) {
                    cumul += Math.max(validCandidates[wc].score, 0.01);
                    if (roll <= cumul) {
                        chosen = validCandidates[wc];
                        break;
                    }
                }

                if (!node.locks) node.locks = [];

                node.locks.push({
                    nodeId: chosen.nodeId,
                    score: chosen.score,
                    revealed: false
                });

                // Track target usage
                nlpTargetUsage[chosen.nodeId] = (nlpTargetUsage[chosen.nodeId] || 0) + 1;

                lockCount++;
            });

            if (skippedCount > 0) {
                _prmLog('Rejected ' + skippedCount + ' locks that would create descendant deadlocks');
            }

            // Post-assignment: detect and remove cycles in the combined tree+lock graph
            var cycleLocks = _detectAndRemoveLockCycles(nlpNodes);
            if (cycleLocks.length > 0) {
                _prmLog('CYCLE DETECTION: Found ' + cycleLocks.length + ' lock edges in cycles, removing...');
                var removedCount = _removeLockEdges(cycleLocks, nlpNodes);
                lockCount -= removedCount;
                if (lockCount < 0) lockCount = 0;
                skippedCount += removedCount;
                _prmLog('Removed ' + removedCount + ' deadlock-causing locks, ' + lockCount + ' locks remain');
            } else {
                _prmLog('Cycle detection passed - no deadlocks in combined tree+lock graph');
            }

            // Validate reachability
            var unreachable = _validateReachability(nlpNodes);
            if (unreachable.length > 0) {
                _prmLog('WARNING: ' + unreachable.length + ' nodes unreachable after locks: ' + unreachable.join(', '));
            } else {
                _prmLog('Reachability check passed - all nodes reachable from root');
            }

            _prmLog('Applied ' + lockCount + ' locks (Python NLP, ' + (result.count || lockCount) + ' scored, ' + skippedCount + ' rejected)');
            updateStatus(lockCount + ' locks applied (Python NLP)');
            onLocksChanged();

            // Notify animation to start chain phase
            if (typeof TreeAnimation !== 'undefined' && TreeAnimation.notifyLocksApplied) {
                TreeAnimation.notifyLocksApplied();
            }

            // Advance build progress: prereqs done → finalize → complete
            if (typeof BuildProgress !== 'undefined' && BuildProgress.isActive()) {
                BuildProgress.setDetail(lockCount + ' prerequisite locks applied');
                BuildProgress.setStage('finalize');
                setTimeout(function() {
                    BuildProgress.complete(lockCount + ' locks applied');
                }, 400);
            }
        } catch (e) {
            _prmLog('ERROR processing Python results: ' + e.message + ' - falling back to JS TF-IDF');
            // Fall back to JS scorer on parse error
            var fbRequest = buildLockRequest();
            if (fbRequest) {
                var fbCount = applyLocksWithJSScorer(fbRequest);
                updateStatus(fbCount + ' locks applied (JS fallback)');
                onLocksChanged();
                if (typeof TreeAnimation !== 'undefined' && TreeAnimation.notifyLocksApplied) {
                    TreeAnimation.notifyLocksApplied();
                }

                // Advance build progress after JS fallback
                if (typeof BuildProgress !== 'undefined' && BuildProgress.isActive()) {
                    BuildProgress.setDetail(fbCount + ' locks applied (JS fallback)');
                    BuildProgress.setStage('finalize');
                    setTimeout(function() { BuildProgress.complete(); }, 400);
                }
            }
        }
    };

    // =========================================================================
    // LOCK MANAGEMENT
    // =========================================================================

    /**
     * Clear all locks from every node in the tree.
     */
    function clearLocks() {
        var clrNodes = _getAllNodes();
        if (!clrNodes) return;

        var cleared = 0;
        clrNodes.forEach(function(node) {
            if (node.locks && node.locks.length > 0) {
                cleared += node.locks.length;
                node.locks = [];
            }
        });

        // Invalidate position cache
        _cachedPosMap = null;

        _prmLog('Cleared ' + cleared + ' locks');
        updateStatus('Locks cleared');
        onLocksChanged();
        return cleared;
    }

    /**
     * Reveal locks for a given node (called when user clicks a node).
     * Also reveals locks on OTHER nodes where this node is the lock prereq.
     * @param {string} nodeId - The clicked node's ID
     */
    function revealLocksForNode(nodeId) {
        var revNodes = _getAllNodes();
        if (!revNodes) return;

        var revealed = 0;

        // Reveal locks ON this node
        var node = revNodes.get(nodeId);
        if (node && node.locks) {
            node.locks.forEach(function(lock) {
                if (!lock.revealed) {
                    lock.revealed = true;
                    revealed++;
                }
            });
        }

        // Reveal locks on OTHER nodes where THIS node is the lock prereq
        revNodes.forEach(function(otherNode) {
            if (otherNode.locks) {
                otherNode.locks.forEach(function(lock) {
                    if (lock.nodeId === nodeId && !lock.revealed) {
                        lock.revealed = true;
                        revealed++;
                    }
                });
            }
        });

        if (revealed > 0) {
            _prmLog('Revealed ' + revealed + ' locks for node ' + nodeId);
        }

        return revealed;
    }

    /**
     * Get all lock edges for rendering (only revealed ones).
     * @returns {Array} [{from: nodeId, to: lockNodeId, score: number}]
     */
    function getRevealedLockEdges() {
        var edges = [];
        var revEdgeNodes = _getAllNodes();
        if (!revEdgeNodes) return edges;

        revEdgeNodes.forEach(function(node) {
            if (node.locks) {
                node.locks.forEach(function(lock) {
                    if (lock.revealed) {
                        edges.push({
                            from: lock.nodeId,
                            to: node.id || node.formId,
                            score: lock.score
                        });
                    }
                });
            }
        });

        return edges;
    }

    /**
     * Get locks for a specific node (for detail panel display).
     * @param {string} nodeId
     * @returns {Array} [{nodeId, score, revealed, name}]
     */
    function getLocksForNode(nodeId) {
        var lockNodes = _getAllNodes();
        var node = lockNodes ? lockNodes.get(nodeId) : null;
        if (!node || !node.locks) return [];

        return node.locks.map(function(lock) {
            var lockNode = lockNodes.get(lock.nodeId);
            return {
                nodeId: lock.nodeId,
                score: lock.score,
                revealed: lock.revealed,
                name: lockNode ? lockNode.name : null
            };
        });
    }

    // =========================================================================
    // UI HELPERS
    // =========================================================================

    function updateStatus(msg) {
        var el = document.getElementById('prmStatus');
        if (el) el.textContent = msg;
    }

    function setButtonsEnabled(enabled) {
        var applyBtn = document.getElementById('prmApplyBtn');
        var clearBtn = document.getElementById('prmClearBtn');
        if (applyBtn) applyBtn.disabled = !enabled;
        if (clearBtn) clearBtn.disabled = !enabled;
    }

    function isEnabled() {
        var toggle = document.getElementById('prmEnabled');
        return toggle ? toggle.checked : false;
    }

    function onLocksChanged() {
        // Trigger re-render of the main tree viewer
        if (typeof window.requestTreeRender === 'function') {
            window.requestTreeRender();
        } else if (typeof CanvasRendererV2 !== 'undefined' && CanvasRendererV2.requestRender) {
            CanvasRendererV2.requestRender();
        }

        // Update the PRM preview canvas
        renderPreview();
    }

    // =========================================================================
    // PREVIEW CANVAS
    // =========================================================================

    var _previewCanvas = null;
    var _previewCtx = null;
    var _previewZoom = 1;
    var _previewPanX = 0;
    var _previewPanY = 0;
    var _previewIsPanning = false;
    var _previewPanStartX = 0;
    var _previewPanStartY = 0;
    var _previewNeedsRender = false;
    var _previewRafId = null;
    var _previewWidth = 0;
    var _previewHeight = 0;

    /** School color palette */
    var SCHOOL_COLORS = {
        'Destruction': '#C85050',
        'Restoration': '#E8C850',
        'Alteration': '#50A878',
        'Conjuration': '#7070C8',
        'Illusion': '#A06098',
        'Unknown': '#888888'
    };

    function setupPreviewCanvas() {
        var wrap = document.getElementById('prmPreviewWrap');
        if (!wrap || _previewCanvas) return;

        _previewCanvas = document.createElement('canvas');
        _previewCanvas.className = 'tree-preview-canvas';
        _previewCtx = _previewCanvas.getContext('2d');
        wrap.appendChild(_previewCanvas);

        _setupPreviewEvents();
        _updatePreviewSize();

        // ResizeObserver
        if (typeof ResizeObserver !== 'undefined') {
            var resizeTimeout;
            new ResizeObserver(function() {
                if (resizeTimeout) clearTimeout(resizeTimeout);
                resizeTimeout = setTimeout(function() {
                    _updatePreviewSize();
                    _previewNeedsRender = true;
                }, 50);
            }).observe(wrap);
        }

        // Start render loop
        _startPreviewLoop();
    }

    function _updatePreviewSize() {
        var wrap = document.getElementById('prmPreviewWrap');
        if (!wrap || !_previewCanvas) return;

        var rect = wrap.getBoundingClientRect();
        var w = rect.width || 300;
        var h = rect.height || 400;
        var dpr = window.devicePixelRatio || 1;

        _previewCanvas.width = w * dpr;
        _previewCanvas.height = h * dpr;
        _previewCanvas.style.width = w + 'px';
        _previewCanvas.style.height = h + 'px';

        _previewWidth = w;
        _previewHeight = h;
        _previewNeedsRender = true;
    }

    function _setupPreviewEvents() {
        var canvas = _previewCanvas;

        canvas.addEventListener('mousedown', function(e) {
            if (e.button === 0 || e.button === 2) {
                _previewIsPanning = true;
                _previewPanStartX = e.clientX - _previewPanX;
                _previewPanStartY = e.clientY - _previewPanY;
                canvas.style.cursor = 'grabbing';
            }
        });

        canvas.addEventListener('mousemove', function(e) {
            if (!_previewIsPanning) return;
            _previewPanX = e.clientX - _previewPanStartX;
            _previewPanY = e.clientY - _previewPanStartY;
            _previewNeedsRender = true;
        });

        document.addEventListener('mouseup', function() {
            if (_previewIsPanning) {
                _previewIsPanning = false;
                if (_previewCanvas) _previewCanvas.style.cursor = 'grab';
            }
        });

        canvas.addEventListener('wheel', function(e) {
            e.preventDefault();
            var factor = e.deltaY < 0 ? 1.1 : 0.9;
            var newZoom = Math.max(0.1, Math.min(5, _previewZoom * factor));

            var rect = canvas.getBoundingClientRect();
            var mx = e.clientX - rect.left - rect.width / 2;
            var my = e.clientY - rect.top - rect.height / 2;
            _previewPanX = mx - (mx - _previewPanX) * (newZoom / _previewZoom);
            _previewPanY = my - (my - _previewPanY) * (newZoom / _previewZoom);
            _previewZoom = newZoom;
            _previewNeedsRender = true;
        }, { passive: false });

        canvas.addEventListener('contextmenu', function(e) { e.preventDefault(); });
        canvas.style.cursor = 'grab';
    }

    function _startPreviewLoop() {
        if (_previewRafId) return;
        function loop() {
            if (_previewNeedsRender) {
                _previewNeedsRender = false;
                _renderPreview();
            }
            _previewRafId = requestAnimationFrame(loop);
        }
        loop();
    }

    function renderPreview() {
        _previewNeedsRender = true;
    }

    /** Compute fit scale from node positions to auto-zoom content into view. */
    function _computePreviewFitScale(nodeList, w, h) {
        if (nodeList.length === 0) return 1;

        var contentRadius = 0;
        for (var i = 0; i < nodeList.length; i++) {
            var n = nodeList[i];
            var d = Math.sqrt(n.x * n.x + n.y * n.y);
            if (d > contentRadius) contentRadius = d;
        }
        if (contentRadius <= 0) return 1;
        contentRadius += 30;
        var availableRadius = Math.min(w, h) / 2 - 10;
        return Math.min(1, availableRadius / contentRadius);
    }

    function _renderPreview() {
        if (!_previewCanvas || !_previewCtx) return;

        var ctx = _previewCtx;
        var w = _previewWidth || 300;
        var h = _previewHeight || 400;
        var dpr = window.devicePixelRatio || 1;

        // Full reset
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1.0;

        // Clear
        ctx.fillStyle = '#0a0a0f';
        ctx.fillRect(0, 0, _previewCanvas.width, _previewCanvas.height);

        // Scale for DPR
        ctx.scale(dpr, dpr);

        // Tab-aware rendering
        if (_activeTab === 'core') {
            _renderCorePreview(ctx, w, h);
        } else {
            _renderTreePreview(ctx, w, h);
        }

        // HUD overlay (outside transform)
        ctx.fillStyle = 'rgba(184, 168, 120, 0.4)';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(Math.round(_previewZoom * 100) + '%', w - 8, h - 8);
    }

    /** Render Core tab: Root Base grid + globe overlay */
    function _renderCorePreview(ctx, w, h) {
        // Get Root Base output for grid
        var baseData = null;
        if (typeof TreePreview !== 'undefined' && TreePreview.getOutput) {
            baseData = TreePreview.getOutput();
        }

        // Compute auto-fit from root nodes
        var fitScale = 1;
        if (baseData && baseData.rootNodes && baseData.rootNodes.length > 0) {
            var contentRadius = 0;
            for (var i = 0; i < baseData.rootNodes.length; i++) {
                var n = baseData.rootNodes[i];
                var d = Math.sqrt(n.x * n.x + n.y * n.y);
                if (d > contentRadius) contentRadius = d;
            }
            if (contentRadius > 0) {
                contentRadius += 45;
                var availableRadius = Math.min(w, h) / 2 - 10;
                fitScale = Math.min(1, availableRadius / contentRadius);
            }
        }

        // Apply pan + zoom
        ctx.save();
        ctx.translate(w / 2 + _previewPanX, h / 2 + _previewPanY);
        ctx.scale(_previewZoom * fitScale, _previewZoom * fitScale);
        ctx.translate(-w / 2, -h / 2);

        // Draw Root Base grid
        if (baseData && baseData.renderGrid) {
            ctx.globalAlpha = 0.5;
            baseData.renderGrid(ctx, w, h);
            ctx.globalAlpha = 1.0;
        }

        // Draw globe overlay
        if (typeof TreeCore !== 'undefined' && TreeCore.renderGlobeOverlay) {
            TreeCore.renderGlobeOverlay(ctx, w, h);
        }

        ctx.restore();
    }

    /** Render animated tree build replay frame */
    function _renderAnimationFrame(ctx, w, h) {
        if (typeof TreeAnimation === 'undefined') return;

        var frame = TreeAnimation.getFrameData();
        if (!frame || !frame.nodes || frame.nodes.length === 0) return;

        var cx = w / 2;
        var cy = h / 2;
        var mode = frame.mode;
        var newestIdx = frame.newestIdx;

        // Render edges
        if (frame.edges && frame.edges.length > 0) {
            if (mode === 'tree' && typeof TreeRenderer !== 'undefined') {
                TreeRenderer.renderEdges(ctx, cx, cy, frame.edges, 0.35);
            } else {
                // Classic mode: simple parent-child lines
                ctx.save();
                ctx.lineWidth = 1.5;
                for (var ei = 0; ei < frame.edges.length; ei++) {
                    var edge = frame.edges[ei];
                    ctx.strokeStyle = _animHexToRgba(edge.color || '#888888', 0.3);
                    ctx.beginPath();
                    ctx.moveTo(cx + edge.x1, cy + edge.y1);
                    ctx.lineTo(cx + edge.x2, cy + edge.y2);
                    ctx.stroke();
                }
                ctx.restore();
            }
        }

        // Render nodes
        if (mode === 'tree' && typeof TreeRenderer !== 'undefined') {
            // Tree mode: use TreeRenderer for tier-differentiated rendering
            TreeRenderer.renderNodes(ctx, cx, cy, frame.nodes, 0.35, 5);
        } else {
            // Classic mode: simple ghost nodes
            var opacity = 0.35;
            var nodeR = 5;
            for (var i = 0; i < frame.nodes.length; i++) {
                var p = frame.nodes[i];
                var gx = cx + p.x;
                var gy = cy + p.y;
                var color = p.color || '#888888';

                // Glow
                ctx.beginPath();
                ctx.arc(gx, gy, nodeR + 2, 0, Math.PI * 2);
                ctx.fillStyle = _animHexToRgba(color, opacity * 0.3);
                ctx.fill();

                // Body
                ctx.beginPath();
                ctx.arc(gx, gy, nodeR, 0, Math.PI * 2);
                ctx.fillStyle = _animHexToRgba(color, opacity);
                ctx.fill();

                // Border
                ctx.strokeStyle = 'rgba(255, 255, 255, ' + (opacity * 0.3) + ')';
                ctx.lineWidth = 0.5;
                ctx.stroke();
            }
        }

        // Highlight newest node with a pop effect (only during Phase 1)
        if (frame.phase === 'nodes' && newestIdx >= 0 && newestIdx < frame.nodes.length) {
            var newest = frame.nodes[newestIdx];
            var nx = cx + newest.x;
            var ny = cy + newest.y;
            var nColor = newest.color || '#ffffff';

            // Bright pulse ring
            ctx.beginPath();
            ctx.arc(nx, ny, 10, 0, Math.PI * 2);
            ctx.strokeStyle = _animHexToRgba(nColor, 0.6);
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        // Phase 2: Render animated lock chains growing from prereq to locked node
        if (frame.phase === 'chains' && frame.chains && frame.chains.length > 0) {
            for (var chi = 0; chi < frame.chains.length; chi++) {
                var chain = frame.chains[chi];
                if (chain.progress <= 0) continue;

                var cfx = cx + chain.fromX;
                var cfy = cy + chain.fromY;
                var ctoX = cx + chain.toX;
                var cty = cy + chain.toY;

                var cedx = ctoX - cfx;
                var cedy = cty - cfy;
                var cedist = Math.sqrt(cedx * cedx + cedy * cedy);
                if (cedist < 1) continue;

                // Only draw links up to current progress
                var visibleDist = cedist * chain.progress;

                var lW = 4, lH = 2.6, lThick = 1.2;
                var lSpacing = lW * 1.15;
                var nLinks = Math.max(3, Math.round(cedist / lSpacing));
                var eAngle = Math.atan2(cedy, cedx);

                ctx.globalAlpha = 0.75;

                for (var cli = 0; cli < nLinks; cli++) {
                    var ct = (cli + 0.5) / nLinks;
                    var linkDist = cedist * ct;
                    if (linkDist > visibleDist) break;

                    var clx = cfx + cedx * ct;
                    var cly = cfy + cedy * ct;

                    ctx.save();
                    ctx.translate(clx, cly);
                    ctx.rotate(eAngle);
                    if (cli % 2 !== 0) ctx.rotate(Math.PI / 2);

                    var chw = lW * 0.5, chh = lH * 0.5;
                    var lcr = Math.min(chw, chh) * 0.8;

                    // Outer rounded rect
                    ctx.beginPath();
                    ctx.moveTo(-chw + lcr, -chh);
                    ctx.lineTo(chw - lcr, -chh);
                    ctx.arcTo(chw, -chh, chw, -chh + lcr, lcr);
                    ctx.lineTo(chw, chh - lcr);
                    ctx.arcTo(chw, chh, chw - lcr, chh, lcr);
                    ctx.lineTo(-chw + lcr, chh);
                    ctx.arcTo(-chw, chh, -chw, chh - lcr, lcr);
                    ctx.lineTo(-chw, -chh + lcr);
                    ctx.arcTo(-chw, -chh, -chw + lcr, -chh, lcr);
                    ctx.closePath();

                    ctx.fillStyle = 'rgba(130, 130, 140, 0.6)';
                    ctx.strokeStyle = 'rgba(80, 80, 90, 0.9)';
                    ctx.lineWidth = lThick;
                    ctx.fill();
                    ctx.stroke();

                    // Inner cutout
                    var ihw = chw * 0.4, ihh = chh * 0.3;
                    var ir = Math.min(ihw, ihh) * 0.6;
                    ctx.beginPath();
                    ctx.moveTo(-ihw + ir, -ihh);
                    ctx.lineTo(ihw - ir, -ihh);
                    ctx.arcTo(ihw, -ihh, ihw, -ihh + ir, ir);
                    ctx.lineTo(ihw, ihh - ir);
                    ctx.arcTo(ihw, ihh, ihw - ir, ihh, ir);
                    ctx.lineTo(-ihw + ir, ihh);
                    ctx.arcTo(-ihw, ihh, -ihw, ihh - ir, ir);
                    ctx.lineTo(-ihw, -ihh + ir);
                    ctx.arcTo(-ihw, -ihh, -ihw + ir, -ihh, ir);
                    ctx.closePath();
                    ctx.fillStyle = 'rgba(20, 20, 30, 0.7)';
                    ctx.fill();

                    ctx.restore();
                }
                ctx.globalAlpha = 1.0;
            }

            // Lock badges on nodes where chains have arrived
            if (frame.lockedNodes) {
                for (var li = 0; li < frame.lockedNodes.length; li++) {
                    var ln = frame.lockedNodes[li];
                    if (!frame.chains[ln.chainIdx] || !frame.chains[ln.chainIdx].done) continue;

                    var lnx = cx + ln.x;
                    var lny = cy + ln.y;

                    // Gray lock overlay on the node
                    ctx.beginPath();
                    ctx.arc(lnx, lny, 6, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(82, 82, 92, 0.7)';
                    ctx.fill();
                    ctx.strokeStyle = 'rgba(60, 60, 70, 0.9)';
                    ctx.lineWidth = 1;
                    ctx.stroke();

                    // Lock icon: shackle arc
                    ctx.beginPath();
                    ctx.arc(lnx, lny - 2, 2.5, Math.PI, 0);
                    ctx.strokeStyle = 'rgba(180, 180, 190, 0.8)';
                    ctx.lineWidth = 1.2;
                    ctx.stroke();
                    // Lock icon: body rect
                    ctx.fillStyle = 'rgba(180, 180, 190, 0.8)';
                    ctx.fillRect(lnx - 2, lny - 0.5, 4, 3);
                }
            }
        }
    }

    function _animHexToRgba(hex, alpha) {
        if (!hex || hex.charAt(0) !== '#') return 'rgba(136,136,136,' + alpha + ')';
        var r = parseInt(hex.slice(1, 3), 16);
        var g = parseInt(hex.slice(3, 5), 16);
        var b = parseInt(hex.slice(5, 7), 16);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    }

    /** Render Locks/AltPaths tab: relay tree growth canvas + overlay lock chains */
    function _renderTreePreview(ctx, w, h) {
        // Delegate to tree growth renderer (same content as tree growth canvas)
        if (typeof TreeGrowth !== 'undefined' && TreeGrowth.modes && TreeGrowth.activeMode) {
            var baseData = null;
            if (typeof TreePreview !== 'undefined' && TreePreview.getOutput) {
                baseData = TreePreview.getOutput();
            }

            var fitScale = 1;
            if (typeof TreeGrowth._computeFitScale === 'function') {
                fitScale = TreeGrowth._computeFitScale(baseData, w, h);
            }

            ctx.save();
            ctx.translate(w / 2 + _previewPanX, h / 2 + _previewPanY);
            ctx.scale(_previewZoom * fitScale, _previewZoom * fitScale);
            ctx.translate(-w / 2, -h / 2);

            // Check if tree animation is playing
            var animPlaying = typeof TreeAnimation !== 'undefined' && TreeAnimation.isPlaying();
            var modeModule = TreeGrowth.modes[TreeGrowth.activeMode];

            if (animPlaying) {
                // Animation mode: render base grid + animated subset
                if (baseData && baseData.renderGrid) {
                    baseData.renderGrid(ctx, w, h);
                }
                _renderAnimationFrame(ctx, w, h);
            } else if (modeModule && typeof modeModule.render === 'function') {
                modeModule.render(ctx, w, h, baseData);
            }

            // Check for pending animation capture after render
            // (render may have computed _builtPlacements as a side effect)
            if (typeof TreeAnimation !== 'undefined' && !animPlaying) {
                TreeAnimation.checkPendingCapture();
            }

            // Overlay: Lock chain edges (only on locks tab, skip during animation)
            var allLockEdges = (!animPlaying && _activeTab === 'locks') ? getAllLockEdges() : [];
            if (allLockEdges.length > 0) {
                // Build position lookup from growth mode
                var posMap = null;
                if (modeModule && typeof modeModule.getPositionMap === 'function') {
                    posMap = modeModule.getPositionMap();
                }
                if (posMap) {
                    allLockEdges.forEach(function(edge) {
                        var fromPos = posMap[edge.from];
                        var toPos = posMap[edge.to];
                        if (!fromPos || !toPos) return;

                        // Offset positions by canvas center to match tree renderer
                        // (ClassicRenderer draws nodes at cx+node.x, cy+node.y where cx=w/2, cy=h/2)
                        var fx = w / 2 + fromPos.x;
                        var fy = h / 2 + fromPos.y;
                        var tx = w / 2 + toPos.x;
                        var ty = h / 2 + toPos.y;

                        var edx = tx - fx;
                        var edy = ty - fy;
                        var edist = Math.sqrt(edx * edx + edy * edy);
                        if (edist < 1) return;

                        // Gray chain links along the edge
                        var lW = 4, lH = 2.6, lThick = 1.2;
                        var lSpacing = lW * 1.15;
                        var nLinks = Math.max(3, Math.round(edist / lSpacing));
                        var eAngle = Math.atan2(edy, edx);

                        // Lazy-create chain link sprite for preview
                        if (!_prmChainSprite) {
                            var pad = Math.ceil(lThick) + 1;
                            var sprW = Math.ceil(lW + pad * 2); if (sprW % 2 !== 0) sprW++;
                            var sprH = Math.ceil(lH + pad * 2); if (sprH % 2 !== 0) sprH++;
                            var sc = document.createElement('canvas'); sc.width = sprW; sc.height = sprH;
                            var sctx = sc.getContext('2d');
                            var scx = sprW / 2, scy = sprH / 2;
                            var chw = lW * 0.5, chh = lH * 0.5, cr = Math.min(chw, chh) * 0.8;
                            sctx.beginPath();
                            sctx.moveTo(scx-chw+cr, scy-chh); sctx.lineTo(scx+chw-cr, scy-chh);
                            sctx.arcTo(scx+chw, scy-chh, scx+chw, scy-chh+cr, cr); sctx.lineTo(scx+chw, scy+chh-cr);
                            sctx.arcTo(scx+chw, scy+chh, scx+chw-cr, scy+chh, cr); sctx.lineTo(scx-chw+cr, scy+chh);
                            sctx.arcTo(scx-chw, scy+chh, scx-chw, scy+chh-cr, cr); sctx.lineTo(scx-chw, scy-chh+cr);
                            sctx.arcTo(scx-chw, scy-chh, scx-chw+cr, scy-chh, cr); sctx.closePath();
                            sctx.fillStyle = 'rgba(130, 130, 140, 0.6)';
                            sctx.strokeStyle = 'rgba(80, 80, 90, 0.9)';
                            sctx.lineWidth = lThick; sctx.fill(); sctx.stroke();
                            var ihw = chw * 0.4, ihh = chh * 0.3, ir = Math.min(ihw, ihh) * 0.6;
                            sctx.beginPath();
                            sctx.moveTo(scx-ihw+ir, scy-ihh); sctx.lineTo(scx+ihw-ir, scy-ihh);
                            sctx.arcTo(scx+ihw, scy-ihh, scx+ihw, scy-ihh+ir, ir); sctx.lineTo(scx+ihw, scy+ihh-ir);
                            sctx.arcTo(scx+ihw, scy+ihh, scx+ihw-ir, scy+ihh, ir); sctx.lineTo(scx-ihw+ir, scy+ihh);
                            sctx.arcTo(scx-ihw, scy+ihh, scx-ihw, scy+ihh-ir, ir); sctx.lineTo(scx-ihw, scy-ihh+ir);
                            sctx.arcTo(scx-ihw, scy-ihh, scx-ihw+ir, scy-ihh, ir); sctx.closePath();
                            sctx.fillStyle = 'rgba(20, 20, 30, 0.7)'; sctx.fill();
                            _prmChainSprite = sc;
                        }
                        var pspr = _prmChainSprite;
                        var psprHW = pspr.width / 2, psprHH = pspr.height / 2;

                        ctx.globalAlpha = 0.75;

                        for (var ci = 0; ci < nLinks; ci++) {
                            var ct = (ci + 0.5) / nLinks;
                            var ccx = fx + edx * ct;
                            var ccy = fy + edy * ct;

                            ctx.save();
                            ctx.translate(ccx, ccy);
                            ctx.rotate(eAngle);
                            if (ci % 2 !== 0) ctx.rotate(Math.PI / 2);
                            ctx.drawImage(pspr, -psprHW, -psprHH);
                            ctx.restore();
                        }
                        ctx.globalAlpha = 1.0;
                    });
                }
            }

            ctx.restore();

            // Stats overlay
            var lockCount = (_activeTab === 'locks') ? getAllLockEdges().length : 0;
            ctx.fillStyle = 'rgba(184, 168, 120, 0.4)';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(lockCount + ' locks', 8, h - 8);

            // Animation progress overlay
            if (animPlaying) {
                var progress = TreeAnimation.getProgress();
                var animFrame = TreeAnimation.getFrameData();
                var statusText = '';
                if (animFrame && animFrame.phase === 'chains') {
                    var doneCount = 0;
                    if (animFrame.chains) {
                        for (var dci = 0; dci < animFrame.chains.length; dci++) {
                            if (animFrame.chains[dci].done) doneCount++;
                        }
                    }
                    statusText = 'Locking... ' + doneCount + '/' + (animFrame.chains ? animFrame.chains.length : 0);
                } else if (animFrame) {
                    statusText = 'Building... ' + animFrame.nodes.length + '/' + animFrame.total;
                }
                ctx.fillStyle = 'rgba(184, 168, 120, 0.5)';
                ctx.font = '10px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(statusText, w / 2, h - 8);

                // Progress bar
                ctx.fillStyle = 'rgba(184, 168, 120, 0.15)';
                ctx.fillRect(0, h - 3, w, 3);
                ctx.fillStyle = 'rgba(184, 168, 120, 0.5)';
                ctx.fillRect(0, h - 3, w * progress, 3);

                // Keep render loop alive
                _previewNeedsRender = true;
            }
        } else {
            ctx.fillStyle = 'rgba(184, 168, 120, 0.3)';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Build a tree to see preview', w / 2, h / 2);
        }
    }

    /**
     * Get ALL lock edges (not just revealed) for the preview canvas.
     * @returns {Array} [{from, to, score}]
     */
    function getAllLockEdges() {
        var edges = [];
        var allEdgeNodes = _getAllNodes();
        if (!allEdgeNodes) return edges;

        allEdgeNodes.forEach(function(node) {
            if (node.locks) {
                node.locks.forEach(function(lock) {
                    edges.push({
                        from: lock.nodeId,
                        to: node.id || node.formId,
                        score: lock.score
                    });
                });
            }
        });

        return edges;
    }

    // =========================================================================
    // AUTO-RUN (called from treeGrowth.js after build)
    // =========================================================================

    /**
     * Auto-apply locks after tree build. Clears existing locks first.
     * Called externally when PRM is enabled and tree finishes building.
     */
    function autoApplyLocks() {
        if (!isEnabled()) return;

        _prmLog('Auto-applying locks after tree build...');
        updateStatus('Auto-applying locks...');

        // Invalidate position cache (tree layout may have changed)
        _cachedPosMap = null;

        // Clear any previous locks
        var autoClrNodes = _getAllNodes();
        if (autoClrNodes) {
            autoClrNodes.forEach(function(node) {
                if (node.locks) node.locks = [];
            });
        }

        var request = buildLockRequest();
        if (!request || request.eligible.length === 0) {
            updateStatus('No eligible spells for locks');
            renderPreview();
            // No eligible → skip prereqs, finalize + complete
            if (typeof BuildProgress !== 'undefined' && BuildProgress.isActive()) {
                BuildProgress.setStage('finalize');
                setTimeout(function() { BuildProgress.complete('No eligible spells for locks'); }, 300);
            }
            return;
        }

        var result = applyLocksWithScorer(request);
        if (result === -1) {
            // Async (Python NLP) - callback will handle status + onLocksChanged + BuildProgress
            updateStatus('Scoring with Python NLP...');
        } else {
            updateStatus(result + ' locks auto-applied');
            onLocksChanged();
            // Synchronous (JS fallback) → finalize + complete
            if (typeof BuildProgress !== 'undefined' && BuildProgress.isActive()) {
                BuildProgress.setDetail(result + ' locks applied');
                BuildProgress.setStage('finalize');
                setTimeout(function() { BuildProgress.complete(result + ' locks applied'); }, 400);
            }
        }
    }

    // =========================================================================
    // TAB SWITCHING
    // =========================================================================

    function initTabs() {
        var tabs = document.querySelectorAll('.prm-tab:not(.disabled)');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].addEventListener('click', function() {
                var tabId = this.getAttribute('data-prm-tab');
                switchTab(tabId);
            });
        }
    }

    function switchTab(tabId) {
        _activeTab = tabId;

        // Update tab active states
        var allTabs = document.querySelectorAll('.prm-tab');
        for (var i = 0; i < allTabs.length; i++) {
            var t = allTabs[i].getAttribute('data-prm-tab');
            allTabs[i].classList.toggle('active', t === tabId);
        }

        // Toggle content visibility
        var locksTab = document.getElementById('prmTabLocks');
        var coreTab = document.getElementById('prmTabCore');
        var altTab = document.getElementById('prmTabAltPaths');

        if (locksTab) locksTab.style.display = (tabId === 'locks') ? '' : 'none';
        if (coreTab) coreTab.style.display = (tabId === 'core') ? '' : 'none';
        if (altTab) altTab.style.display = (tabId === 'altpaths') ? '' : 'none';

        // Trigger preview re-render for new tab
        _previewNeedsRender = true;
    }

    // =========================================================================
    // INITIALIZATION
    // =========================================================================

    function initPreReqMaster() {
        // Collapsible header
        var header = document.getElementById('prmToggleHeader');
        var content = document.getElementById('prmContent');
        var collapseIcon = header ? header.querySelector('.prm-collapse-icon') : null;

        if (header && content) {
            header.addEventListener('click', function() {
                content.classList.toggle('collapsed');
                if (collapseIcon) {
                    collapseIcon.textContent = content.classList.contains('collapsed') ? '[+]' : '[-]';
                }
            });
        }

        // Tab switching
        initTabs();

        // Setup preview canvas
        setupPreviewCanvas();

        // Pool source toggle - show/hide nearby controls
        var poolSelect = document.getElementById('prmPoolSource');
        var nearbyControls = document.getElementById('prmNearbyControls');
        if (poolSelect && nearbyControls) {
            poolSelect.addEventListener('change', function() {
                nearbyControls.style.display = poolSelect.value === 'nearby' ? '' : 'none';
            });
        }

        // Slider value displays + fill updates
        var sliderMappings = [
            { slider: 'prmGlobalLockSlider', display: 'prmGlobalLockValue', suffix: '%' },
            { slider: 'prmDistanceSlider', display: 'prmDistanceValue', suffix: '' },
            { slider: 'prmProximityBiasSlider', display: 'prmProximityBiasValue', suffix: '%' }
        ];

        sliderMappings.forEach(function(m) {
            var slider = document.getElementById(m.slider);
            var display = document.getElementById(m.display);
            if (slider) {
                // Initial fill
                if (typeof updateSliderFillGlobal === 'function') updateSliderFillGlobal(slider);
                slider.addEventListener('input', function() {
                    if (display) display.textContent = slider.value + m.suffix;
                    if (typeof updateSliderFillGlobal === 'function') updateSliderFillGlobal(slider);
                });
            }
        });

        // Apply Locks button
        var applyBtn = document.getElementById('prmApplyBtn');
        if (applyBtn) {
            applyBtn.addEventListener('click', function() {
                _prmLog('Apply Locks button clicked');

                // Clear existing locks before reapplying (same as autoApplyLocks)
                var clrNodes = _getAllNodes();
                if (clrNodes) {
                    clrNodes.forEach(function(node) {
                        if (node.locks) node.locks = [];
                    });
                }
                _cachedPosMap = null;

                var request = buildLockRequest();
                if (!request || request.eligible.length === 0) {
                    _prmLog('No eligible spells found - aborting apply');
                    updateStatus('No eligible spells found');
                    return;
                }

                updateStatus('Applying locks...');
                _prmLog('Applying ' + request.eligible.length + ' eligible spell locks...');

                var result = applyLocksWithScorer(request);
                if (result === -1) {
                    // Async (Python NLP) - callback will handle status + onLocksChanged
                    updateStatus('Scoring with Python NLP...');
                } else {
                    _prmLog('Locks applied: ' + result);
                    updateStatus(result + ' locks applied');
                    onLocksChanged();
                }
            });
        }

        // Clear Locks button
        var clearBtn = document.getElementById('prmClearBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', function() {
                _prmLog('Clear Locks button clicked');
                clearLocks();
            });
        }

        // Bidirectional soft prereqs toggle (Alternate Pathways tab)
        var biDirToggle = document.getElementById('altPathsBidirectional');
        if (biDirToggle) {
            biDirToggle.checked = settings.treeGeneration.bidirectionalSoftPrereqs !== false;
            biDirToggle.addEventListener('change', function() {
                settings.treeGeneration.bidirectionalSoftPrereqs = this.checked;
                if (typeof autoSaveSettings === 'function') autoSaveSettings();
            });
        }

        _prmLog('Initialized');
    }

    // =========================================================================
    // EXPOSE GLOBALLY
    // =========================================================================

    window.PreReqMaster = {
        init: initPreReqMaster,
        getSettings: getSettings,
        isEnabled: isEnabled,
        buildLockRequest: buildLockRequest,
        applyLocksWithJSScorer: applyLocksWithJSScorer,
        applyLocksWithScorer: applyLocksWithScorer,
        autoApplyLocks: autoApplyLocks,
        clearLocks: clearLocks,
        revealLocksForNode: revealLocksForNode,
        getRevealedLockEdges: getRevealedLockEdges,
        getAllLockEdges: getAllLockEdges,
        getLocksForNode: getLocksForNode,
        setButtonsEnabled: setButtonsEnabled,
        updateStatus: updateStatus,
        renderPreview: renderPreview,
        updatePreviewSize: _updatePreviewSize
    };

})();
