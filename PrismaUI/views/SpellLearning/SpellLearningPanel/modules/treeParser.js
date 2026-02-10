/**
 * SpellLearning Tree Parser Module
 * 
 * Parses spell tree JSON data, detects cycles, fixes orphaned nodes.
 * Depends on: config.js (TREE_CONFIG), spellCache.js (SpellCache), state.js (settings)
 */

// =============================================================================
// LOGGING HELPER
// =============================================================================

function logTreeParser(message, isWarning) {
    var prefix = '[TreeParser] ';
    var fullMsg = prefix + message;
    
    if (isWarning) {
        console.warn(fullMsg);
    } else {
        console.log(fullMsg);
    }
    
    // Send to C++ for SKSE log
    if (window.callCpp) {
        window.callCpp('LogMessage', JSON.stringify({
            level: isWarning ? 'warn' : 'info',
            message: fullMsg
        }));
    }
}

// =============================================================================
// TREE PARSER
// =============================================================================

var TreeParser = {
    nodes: new Map(),
    edges: [],
    schools: {},

    parse: function(data) {
        this.nodes.clear();
        this.edges = [];
        this.schools = {};

        if (typeof data === 'string') {
            try { data = JSON.parse(data); }
            catch (e) { return { success: false, error: e.message }; }
        }

        if (!data.schools) return { success: false, error: 'Missing schools' };

        var allFormIds = [];
        var self = this;
        this._maxChildrenPerNode = (data.settings && data.settings.maxChildrenPerNode) || 5;
        var trustPrereqs = data.trustPrereqs || false; // Skip prereq mutations if source is authoritative

        for (var schoolName in data.schools) {
            var schoolData = data.schools[schoolName];
            if (!schoolData.root || !schoolData.nodes) continue;
            
            // Extract layoutStyle from LLM response
            var layoutStyle = schoolData.layoutStyle || 'radial';
            if (!TREE_CONFIG.layoutStyles[layoutStyle]) {
                logTreeParser('Unknown layout style "' + layoutStyle + '" for ' + schoolName + ', using radial', true);
                layoutStyle = 'radial';
            }
            logTreeParser(schoolName + ' using layout style: ' + layoutStyle);
            
            this.schools[schoolName] = {
                root: schoolData.root,
                nodeIds: [],
                maxDepth: 0,
                maxWidth: 0,
                layoutStyle: layoutStyle,
                // Pass through sliceInfo for wheelRenderer to use exact sector angles
                sliceInfo: schoolData.sliceInfo,
                config: schoolData.config_used,
                // Pass through pre-baked sector angles from TreeGrowth
                spokeAngle: schoolData.spokeAngle,
                startAngle: schoolData.startAngle,
                endAngle: schoolData.endAngle,
                angleSpan: schoolData.arcSize !== undefined ? (schoolData.arcSize * 180 / Math.PI) : undefined,
                color: schoolData.color
            };

            // DIAGNOSTIC: Check first node's children in input
            if (schoolData.nodes.length > 0) {
                var firstInput = schoolData.nodes[0];
                logTreeParser('DIAGNOSTIC ' + schoolName + ' input: first node children=' +
                    (firstInput.children ? firstInput.children.length : 'undefined') +
                    ', prereqs=' + (firstInput.prerequisites ? firstInput.prerequisites.length : 'undefined'));
            }

            schoolData.nodes.forEach(function(nd) {
                var id = nd.formId || nd.spellId;
                if (!id) return;

                allFormIds.push(id);
                
                // Preserve pre-computed positions from visual-first builder or Tree Growth
                var hasPrecomputed = nd._fromVisualFirst || nd._fromLayoutEngine ||
                    (nd.x !== undefined && nd.y !== undefined && !(nd.x === 0 && nd.y === 0));
                // trustPrereqs data has authoritative positions — flag for renderer
                var fromEngine = nd._fromLayoutEngine || (trustPrereqs && hasPrecomputed);

                self.nodes.set(id, {
                    id: id,
                    formId: id,
                    name: null,
                    school: schoolName,
                    level: null,
                    cost: null,
                    type: null,
                    effects: [],
                    desc: null,
                    children: nd.children || [],
                    prerequisites: nd.prerequisites || [],
                    tier: nd.tier || 0,
                    state: 'locked',
                    depth: nd.tier || nd.depth || 0,  // Use tier as initial depth, BFS will recalculate if tree structure is valid
                    // Preserve positions if pre-computed, otherwise default to 0
                    x: hasPrecomputed ? nd.x : 0,
                    y: hasPrecomputed ? nd.y : 0,
                    angle: nd.angle || 0,
                    radius: nd.radius || 0,
                    // Preserve visual-first flags
                    _fromVisualFirst: nd._fromVisualFirst || false,
                    _fromLayoutEngine: fromEngine,
                    isRoot: nd.isRoot || false,  // CRITICAL: Preserve root flag for origin lines
                    // Preserve hard/soft prerequisite data
                    hardPrereqs: nd.hardPrereqs || [],
                    softPrereqs: nd.softPrereqs || [],
                    softNeeded: nd.softNeeded || 0,
                    // Lock prerequisites (Pre Req Master)
                    locks: nd.locks || []
                });
                self.schools[schoolName].nodeIds.push(id);
            });
        }

        if (trustPrereqs) {
            // Authoritative data: build edges only, no prereq mutations
            this.nodes.forEach(function(node) {
                if (node.isRoot) {
                    node.prerequisites = [];
                    node.hardPrereqs = [];
                }
                node.children.forEach(function(childId) {
                    var child = self.nodes.get(childId);
                    if (child) {
                        self.edges.push({ from: node.id, to: childId });
                    }
                });
            });
        } else {
            // Multi-root cleanup: root nodes are independent starting points
            // Remove other root formIds from root children, and clear root prerequisites
            this.nodes.forEach(function(node) {
                if (node.isRoot) {
                    node.prerequisites = [];
                    node.children = node.children.filter(function(cid) {
                        var child = self.nodes.get(cid);
                        return !child || !child.isRoot;
                    });
                }
            });

            // Build edges from children
            this.nodes.forEach(function(node) {
                node.children.forEach(function(childId) {
                    var child = self.nodes.get(childId);
                    if (child) {
                        self.edges.push({ from: node.id, to: childId });
                        // Never add prerequisites to root nodes - they are independent starting points
                        if (!child.isRoot && child.prerequisites.indexOf(node.id) === -1) {
                            child.prerequisites.push(node.id);
                        }
                    }
                });
            });

            // Also build edges from prerequisites (handles LLM inconsistencies)
            this.nodes.forEach(function(node) {
                node.prerequisites.forEach(function(prereqId) {
                    var parent = self.nodes.get(prereqId);
                    if (parent) {
                        var edgeExists = self.edges.some(function(e) {
                            return e.from === prereqId && e.to === node.id;
                        });
                        if (!edgeExists) {
                            logTreeParser('Adding missing edge: ' + prereqId + ' -> ' + node.id);
                            self.edges.push({ from: prereqId, to: node.id });
                            if (parent.children.indexOf(node.id) === -1) {
                                parent.children.push(node.id);
                            }
                        }
                    }
                });
            });
        }

        // Detect unobtainable spells per school (no auto-fix - user must regenerate)
        for (var schoolName in this.schools) {
            var schoolData = this.schools[schoolName];
            var unobtainableCount = this.detectAndFixCycles(schoolName, schoolData.root);
            if (unobtainableCount > 0) {
                logTreeParser(schoolName + ' has ' + unobtainableCount + ' unobtainable spells - regenerate tree', true);
            }
        }

        // Calculate depths via BFS from root
        for (var sName in this.schools) {
            var sData = this.schools[sName];
            var root = this.nodes.get(sData.root);
            if (!root) {
                logTreeParser('WARNING: Root not found for ' + sName + ' (root=' + sData.root + '), using tier-based depths', true);
                continue;
            }
            logTreeParser('BFS traversal for ' + sName + ' starting from root: ' + root.id +
                         ', root has ' + (root.children ? root.children.length : 0) + ' children');

            var queue = [{ node: root, depth: 0 }];
            var visited = new Set();
            var depthCounts = {};
            
            while (queue.length) {
                var item = queue.shift();
                var node = item.node;
                var depth = item.depth;
                if (visited.has(node.id)) continue;
                visited.add(node.id);
                node.depth = depth;
                sData.maxDepth = Math.max(sData.maxDepth, depth);
                depthCounts[depth] = (depthCounts[depth] || 0) + 1;
                
                node.children.forEach(function(cid) {
                    var c = self.nodes.get(cid);
                    if (c) queue.push({ node: c, depth: depth + 1 });
                });
            }

            sData.maxWidth = Math.max.apply(null, Object.values(depthCounts).concat([1]));

            logTreeParser(sName + ' BFS complete: ' + visited.size + '/' + sData.nodeIds.length + ' nodes reached, maxDepth=' + sData.maxDepth);

            // Find additional roots (element roots in multi-root mode) and BFS from them
            var additionalRoots = [];
            sData.nodeIds.forEach(function(nodeId) {
                if (!visited.has(nodeId)) {
                    var node = self.nodes.get(nodeId);
                    if (node && node.isRoot) {
                        additionalRoots.push(node);
                    }
                }
            });

            // BFS from each additional root
            if (additionalRoots.length > 0) {
                logTreeParser('Processing ' + additionalRoots.length + ' additional element roots');
                additionalRoots.forEach(function(addRoot) {
                    logTreeParser('BFS from element root: ' + addRoot.id + ' (' + (addRoot.name || 'unnamed') + ')');
                    visited.add(addRoot.id);
                    addRoot.depth = 0;
                    addRoot.state = 'available';

                    var addQueue = [{ node: addRoot, depth: 0 }];
                    while (addQueue.length) {
                        var item = addQueue.shift();
                        var node = item.node;
                        var depth = item.depth;
                        if (node !== addRoot && visited.has(node.id)) continue;
                        if (node !== addRoot) visited.add(node.id);
                        node.depth = depth;
                        sData.maxDepth = Math.max(sData.maxDepth, depth);
                        depthCounts[depth] = (depthCounts[depth] || 0) + 1;

                        node.children.forEach(function(cid) {
                            var c = self.nodes.get(cid);
                            if (c && !visited.has(cid)) {
                                addQueue.push({ node: c, depth: depth + 1 });
                            }
                        });
                    }
                });
                logTreeParser(sName + ' after element roots: ' + visited.size + '/' + sData.nodeIds.length + ' nodes reached');
            }

            // Find and fix truly orphaned nodes (not element roots)
            // Skip for trustPrereqs data — source is authoritative
            if (!trustPrereqs) {
                var orphanedNodes = [];
                sData.nodeIds.forEach(function(nodeId) {
                    if (!visited.has(nodeId)) {
                        orphanedNodes.push(nodeId);
                    }
                });

                if (orphanedNodes.length > 0) {
                    logTreeParser('Found ' + orphanedNodes.length + ' orphaned nodes in ' + sName + ' - attempting to fix', true);
                    this._fixOrphanedNodes(orphanedNodes, sName, sData, root, visited);
                }
            }

            // Root nodes are AVAILABLE (learnable starting points), not auto-unlocked
            // Children stay locked until root is actually learned
            root.state = 'available';
        }

        return {
            success: true,
            nodes: Array.from(this.nodes.values()),
            edges: this.edges,
            schools: this.schools,
            allFormIds: allFormIds
        };
    },

    _fixOrphanedNodes: function(orphanedNodes, schoolName, schoolData, root, visited) {
        var self = this;

        orphanedNodes.forEach(function(orphanId) {
            var orphan = self.nodes.get(orphanId);
            if (!orphan) return;

            // Safety check: Never connect nodes marked as roots - they are intentional roots
            if (orphan.isRoot) {
                logTreeParser('SKIP orphan fix for root node: ' + orphanId + ' (' + (orphan.name || 'unnamed') + ')');
                visited.add(orphanId);
                orphan.depth = 0;
                orphan.state = 'available';
                return;
            }

            var orphanTier = orphan.tier || 0;
            var potentialParents = [];
            
            visited.forEach(function(connectedId) {
                var connected = self.nodes.get(connectedId);
                if (connected && connected.school === schoolName) {
                    var connectedTier = connected.tier || 0;
                    if (connectedTier <= orphanTier && connectedTier >= orphanTier - 1) {
                        var childCount = connected.children.length;
                        potentialParents.push({ node: connected, childCount: childCount, tierDiff: orphanTier - connectedTier });
                    }
                }
            });
            
            // Respect maxChildren limit
            var maxCh = self._maxChildrenPerNode || 5;
            var withRoom = potentialParents.filter(function(p) { return p.childCount < maxCh; });
            if (withRoom.length === 0) withRoom = potentialParents; // fallback if all full

            withRoom.sort(function(a, b) {
                if (a.tierDiff !== b.tierDiff) return a.tierDiff - b.tierDiff;
                return a.childCount - b.childCount;
            });

            var bestParent = withRoom.length > 0 ? withRoom[0].node : root;
            
            logTreeParser('Connecting orphan ' + orphanId + ' (tier ' + orphanTier + ') to ' + bestParent.id);
            
            if (bestParent.children.indexOf(orphanId) === -1) {
                bestParent.children.push(orphanId);
            }
            if (orphan.prerequisites.indexOf(bestParent.id) === -1) {
                orphan.prerequisites.push(bestParent.id);
            }
            self.edges.push({ from: bestParent.id, to: orphanId });
            
            orphan.depth = bestParent.depth + 1;
            schoolData.maxDepth = Math.max(schoolData.maxDepth, orphan.depth);
            visited.add(orphanId);
        });
        
        // Re-process children of newly connected nodes
        orphanedNodes.forEach(function(orphanId) {
            var orphan = self.nodes.get(orphanId);
            if (!orphan) return;
            
            var childQueue = [{ node: orphan, depth: orphan.depth }];
            while (childQueue.length > 0) {
                var item = childQueue.shift();
                item.node.children.forEach(function(cid) {
                    var child = self.nodes.get(cid);
                    if (child && !visited.has(cid)) {
                        visited.add(cid);
                        child.depth = item.depth + 1;
                        schoolData.maxDepth = Math.max(schoolData.maxDepth, child.depth);
                        childQueue.push({ node: child, depth: child.depth });
                    }
                });
            }
        });
        
        logTreeParser('Fixed ' + orphanedNodes.length + ' orphaned nodes in ' + schoolName);
    },

    detectAndFixCycles: function(schoolName, rootId) {
        var self = this;
        var fixesMade = 0;
        
        var rootNode = this.nodes.get(rootId);
        if (!rootNode) return 0;
        
        var schoolNodeIds = this.schools[schoolName].nodeIds;
        var totalNodes = schoolNodeIds.length;
        
        function simulateUnlocks() {
            var unlocked = new Set();
            unlocked.add(rootId);
            
            var changed = true;
            var iterations = 0;
            var maxIterations = totalNodes + 10;
            
            while (changed && iterations < maxIterations) {
                changed = false;
                iterations++;
                
                schoolNodeIds.forEach(function(nodeId) {
                    if (unlocked.has(nodeId)) return;
                    
                    var node = self.nodes.get(nodeId);
                    if (!node) return;
                    
                    var prereqs = node.prerequisites;
                    if (prereqs.length === 0) {
                        // Nodes with no prerequisites are inherently unlockable
                        // This includes additional root nodes in multi-root trees
                        unlocked.add(nodeId);
                        changed = true;
                        return;
                    }

                    var allPrereqsUnlocked = prereqs.every(function(prereqId) {
                        return unlocked.has(prereqId);
                    });

                    if (allPrereqsUnlocked) {
                        unlocked.add(nodeId);
                        changed = true;
                    }
                });
            }

            return unlocked;
        }

        var unlockable = simulateUnlocks();

        var unobtainable = [];
        schoolNodeIds.forEach(function(nodeId) {
            if (!unlockable.has(nodeId)) {
                unobtainable.push(nodeId);
            }
        });
        
        if (unobtainable.length === 0) {
            logTreeParser(schoolName + ': All ' + totalNodes + ' spells are obtainable');
            return 0;
        }
        
        // DISABLED: Gentle fix was causing more problems than it solved
        // Just log warning about unobtainable spells - user should regenerate tree
        logTreeParser(schoolName + ': ERROR - Found ' + unobtainable.length + ' unobtainable spells!', true);
        logTreeParser(schoolName + ': Tree has broken prerequisite chains. Please regenerate the tree.', true);

        // Log first few blocking prereqs for debugging
        var logged = 0;
        unobtainable.forEach(function(nodeId) {
            if (logged >= 5) return; // Only log first 5

            var node = self.nodes.get(nodeId);
            if (!node) return;

            var blockingPrereqs = node.prerequisites.filter(function(prereqId) {
                return !unlockable.has(prereqId);
            });

            if (blockingPrereqs.length > 0) {
                logTreeParser('  ' + (node.name || nodeId) + ' blocked by: ' + blockingPrereqs.slice(0, 3).join(', '), true);
                logged++;
            }
        });

        if (unobtainable.length > 5) {
            logTreeParser('  ... and ' + (unobtainable.length - 5) + ' more unobtainable spells', true);
        }

        // Return the count of problems (no fixes attempted)
        return unobtainable.length;
    },
    
    /**
     * Analyze a school's tree and return info about unreachable nodes
     * Used for LLM self-correction
     */
    getUnreachableNodesInfo: function(schoolName, rootId) {
        var self = this;
        var rootNode = this.nodes.get(rootId);
        if (!rootNode) return { valid: true, unreachable: [] };
        
        var schoolNodeIds = this.schools[schoolName].nodeIds;
        var totalNodes = schoolNodeIds.length;
        
        // Simulate unlocks
        function simulateUnlocks() {
            var unlocked = new Set();
            unlocked.add(rootId);
            
            var changed = true;
            var iterations = 0;
            
            while (changed && iterations < totalNodes + 10) {
                changed = false;
                iterations++;
                
                schoolNodeIds.forEach(function(nodeId) {
                    if (unlocked.has(nodeId)) return;
                    
                    var node = self.nodes.get(nodeId);
                    if (!node) return;
                    
                    var prereqs = node.prerequisites;
                    if (prereqs.length === 0) {
                        // Nodes with no prerequisites are inherently unlockable
                        unlocked.add(nodeId);
                        changed = true;
                        return;
                    }

                    var allPrereqsUnlocked = prereqs.every(function(prereqId) {
                        return unlocked.has(prereqId);
                    });

                    if (allPrereqsUnlocked) {
                        unlocked.add(nodeId);
                        changed = true;
                    }
                });
            }

            return unlocked;
        }

        var unlockable = simulateUnlocks();
        var unreachableInfo = [];
        
        schoolNodeIds.forEach(function(nodeId) {
            if (unlockable.has(nodeId)) return;
            
            var node = self.nodes.get(nodeId);
            if (!node) return;
            
            var blockingPrereqs = node.prerequisites.filter(function(prereqId) {
                return !unlockable.has(prereqId);
            });
            
            unreachableInfo.push({
                formId: nodeId,
                name: node.name || nodeId,
                tier: node.tier || 0,
                currentPrereqs: node.prerequisites.slice(),
                blockingPrereqs: blockingPrereqs
            });
        });
        
        return {
            valid: unreachableInfo.length === 0,
            total: totalNodes,
            reachable: unlockable.size,
            unreachable: unreachableInfo
        };
    },

    updateNodeFromCache: function(node) {
        var spellData = SpellCache.get(node.formId);
        if (spellData) {
            node.name = spellData.name || spellData.editorId || node.formId;
            node.level = spellData.level || spellData.skillLevel || 'Unknown';
            node.cost = spellData.cost || spellData.magickaCost || 0;
            node.type = spellData.type || spellData.castingType || 'Spell';
            node.effects = spellData.effects || spellData.effectNames || [];
            node.desc = spellData.description || '';
            if (spellData.school) node.school = spellData.school;
        }
    }
};

// =============================================================================
// ORPHAN ANALYSIS & REPAIR
// Works on state.treeData directly (fast path compatible — no TreeParser needed)
// =============================================================================

/**
 * Last orphan analysis result. Updated by analyzeOrphans().
 * UI reads this to show/hide the orphan repair button.
 */
var lastOrphanStats = null;

/**
 * Analyze the currently loaded tree for orphans and missing prerequisite refs.
 * Read-only — does NOT modify the tree.
 *
 * Returns { totalOrphans, totalMissingPrereqs, totalNodes, schools: { ... } }
 */
function analyzeOrphans() {
    if (!state.treeData || !state.treeData.nodes) {
        lastOrphanStats = { totalOrphans: 0, totalMissingPrereqs: 0, totalNodes: 0, schools: {} };
        return lastOrphanStats;
    }

    var nodes = state.treeData.nodes;
    var schools = state.treeData.schools;

    // Build lookup
    var nodeById = {};
    nodes.forEach(function(n) { nodeById[n.id] = n; });

    var stats = { totalOrphans: 0, totalMissingPrereqs: 0, totalNodes: nodes.length, schools: {} };

    for (var schoolName in schools) {
        var sData = schools[schoolName];
        var rootId = sData.root;
        if (!nodeById[rootId]) continue;

        var schoolNodes = nodes.filter(function(n) { return n.school === schoolName; });
        var schoolIds = schoolNodes.map(function(n) { return n.id; });
        var schoolIdSet = {};
        schoolIds.forEach(function(id) { schoolIdSet[id] = true; });

        var schoolStats = { orphans: 0, missingPrereqs: 0, missingPrereqIds: [], subtrees: [] };
        var missingIdSet = {};

        // Count missing prereq references
        schoolNodes.forEach(function(node) {
            (node.prerequisites || []).forEach(function(prereqId) {
                if (!nodeById[prereqId]) {
                    schoolStats.missingPrereqs++;
                    stats.totalMissingPrereqs++;
                    if (!missingIdSet[prereqId]) {
                        missingIdSet[prereqId] = true;
                        schoolStats.missingPrereqIds.push(prereqId);
                    }
                }
            });
        });

        // BFS from root(s) to find reachable nodes
        var reachable = {};
        var queue = [rootId];
        reachable[rootId] = true;

        while (queue.length > 0) {
            var cId = queue.shift();
            var cNode = nodeById[cId];
            if (!cNode) continue;
            (cNode.children || []).forEach(function(childId) {
                if (!reachable[childId] && nodeById[childId]) {
                    reachable[childId] = true;
                    queue.push(childId);
                }
            });
        }

        // Additional element roots
        schoolNodes.forEach(function(node) {
            if (!reachable[node.id] && node.isRoot) {
                reachable[node.id] = true;
                var q = [node.id];
                while (q.length > 0) {
                    var id = q.shift();
                    var n = nodeById[id];
                    if (!n) continue;
                    (n.children || []).forEach(function(childId) {
                        if (!reachable[childId] && nodeById[childId]) {
                            reachable[childId] = true;
                            q.push(childId);
                        }
                    });
                }
            }
        });

        // Count orphans
        var orphanIds = schoolIds.filter(function(id) { return !reachable[id]; });
        schoolStats.orphans = orphanIds.length;
        stats.totalOrphans += orphanIds.length;

        // Group orphans into connected subtrees
        var visited = {};
        orphanIds.forEach(function(orphanId) {
            if (visited[orphanId]) return;
            var component = [];
            var compQ = [orphanId];
            visited[orphanId] = true;
            while (compQ.length > 0) {
                var id = compQ.shift();
                component.push(id);
                var node = nodeById[id];
                if (!node) continue;
                (node.children || []).forEach(function(childId) {
                    if (!visited[childId] && !reachable[childId] && schoolIdSet[childId]) {
                        visited[childId] = true;
                        compQ.push(childId);
                    }
                });
                // Reverse: find orphans whose children include this id
                orphanIds.forEach(function(otherId) {
                    if (visited[otherId]) return;
                    var otherNode = nodeById[otherId];
                    if (otherNode && (otherNode.children || []).indexOf(id) !== -1) {
                        visited[otherId] = true;
                        compQ.push(otherId);
                    }
                });
            }
            schoolStats.subtrees.push({ size: component.length });
        });

        stats.schools[schoolName] = schoolStats;
    }

    lastOrphanStats = stats;
    return stats;
}

/**
 * Repair orphans in the currently loaded tree (state.treeData).
 * 1. Strip prerequisite references to non-existent nodes
 * 2. Strip non-existent children references
 * 3. Identify orphan subtrees per school
 * 4. Reconnect each subtree root to an appropriate same-school parent
 * 5. Recalculate depths
 * 6. Sync changes to rawData and save
 *
 * Returns { removedPrereqs, reconnectedSubtrees, nodesRecovered }
 */
function repairOrphans() {
    if (!state.treeData || !state.treeData.nodes) {
        console.log('[OrphanRepair] No tree data');
        return { removedPrereqs: 0, reconnectedSubtrees: 0, nodesRecovered: 0 };
    }

    var nodes = state.treeData.nodes;
    var edges = state.treeData.edges || [];
    var schools = state.treeData.schools;
    var repairStats = { removedPrereqs: 0, reconnectedSubtrees: 0, nodesRecovered: 0 };

    // Build lookup
    var nodeById = {};
    nodes.forEach(function(n) { nodeById[n.id] = n; });

    // Step 1: Strip non-existent prereqs and children from ALL nodes
    nodes.forEach(function(node) {
        var origPrereqLen = (node.prerequisites || []).length;
        node.prerequisites = (node.prerequisites || []).filter(function(pid) {
            return !!nodeById[pid];
        });
        var removed = origPrereqLen - node.prerequisites.length;
        if (removed > 0) {
            repairStats.removedPrereqs += removed;
            console.log('[OrphanRepair] Stripped ' + removed + ' missing prereqs from ' + (node.name || node.id));
        }

        node.children = (node.children || []).filter(function(cid) {
            return !!nodeById[cid];
        });

        // Also strip non-existent locks
        if (node.locks) {
            node.locks = node.locks.filter(function(lid) {
                return !!nodeById[lid];
            });
        }
        if (node.hardPrereqs) {
            node.hardPrereqs = node.hardPrereqs.filter(function(pid) {
                return !!nodeById[pid];
            });
        }
        if (node.softPrereqs) {
            node.softPrereqs = node.softPrereqs.filter(function(pid) {
                return !!nodeById[pid];
            });
        }
    });

    // Clean edges too
    state.treeData.edges = edges.filter(function(e) {
        return nodeById[e.from] && nodeById[e.to];
    });
    edges = state.treeData.edges;

    // Step 2: Per-school orphan subtree repair
    for (var schoolName in schools) {
        var sData = schools[schoolName];
        var rootId = sData.root;
        var rootNode = nodeById[rootId];
        if (!rootNode) continue;

        var schoolNodes = nodes.filter(function(n) { return n.school === schoolName; });
        var schoolIds = schoolNodes.map(function(n) { return n.id; });
        var schoolIdSet = {};
        schoolIds.forEach(function(id) { schoolIdSet[id] = true; });

        // BFS from root(s)
        var reachable = {};
        var depthMap = {};
        var queue = [{ id: rootId, depth: 0 }];
        reachable[rootId] = true;
        depthMap[rootId] = 0;

        while (queue.length > 0) {
            var item = queue.shift();
            var cNode = nodeById[item.id];
            if (!cNode) continue;
            (cNode.children || []).forEach(function(childId) {
                if (!reachable[childId] && nodeById[childId]) {
                    reachable[childId] = true;
                    depthMap[childId] = item.depth + 1;
                    queue.push({ id: childId, depth: item.depth + 1 });
                }
            });
        }

        // Additional element roots
        schoolNodes.forEach(function(node) {
            if (!reachable[node.id] && node.isRoot) {
                reachable[node.id] = true;
                depthMap[node.id] = 0;
                var q = [{ id: node.id, depth: 0 }];
                while (q.length > 0) {
                    var it = q.shift();
                    var n = nodeById[it.id];
                    if (!n) continue;
                    (n.children || []).forEach(function(childId) {
                        if (!reachable[childId] && nodeById[childId]) {
                            reachable[childId] = true;
                            depthMap[childId] = it.depth + 1;
                            q.push({ id: childId, depth: it.depth + 1 });
                        }
                    });
                }
            }
        });

        // Find orphans
        var orphanIds = schoolIds.filter(function(id) { return !reachable[id]; });
        if (orphanIds.length === 0) continue;

        // Group into connected subtrees
        var visited = {};
        var subtrees = [];

        orphanIds.forEach(function(orphanId) {
            if (visited[orphanId]) return;
            var component = [];
            var compQ = [orphanId];
            visited[orphanId] = true;
            while (compQ.length > 0) {
                var id = compQ.shift();
                component.push(id);
                var node = nodeById[id];
                if (!node) continue;
                (node.children || []).forEach(function(childId) {
                    if (!visited[childId] && !reachable[childId] && schoolIdSet[childId]) {
                        visited[childId] = true;
                        compQ.push(childId);
                    }
                });
                orphanIds.forEach(function(otherId) {
                    if (visited[otherId]) return;
                    var otherNode = nodeById[otherId];
                    if (otherNode && (otherNode.children || []).indexOf(id) !== -1) {
                        visited[otherId] = true;
                        compQ.push(otherId);
                    }
                });
            }

            // Find subtree root: node with no parent in this component, lowest tier
            var stRoot = null;
            var lowestTier = Infinity;
            component.forEach(function(cId) {
                var cNode = nodeById[cId];
                if (!cNode) return;
                var hasParent = component.some(function(otherId) {
                    if (otherId === cId) return false;
                    var oNode = nodeById[otherId];
                    return oNode && (oNode.children || []).indexOf(cId) !== -1;
                });
                if (!hasParent && (cNode.tier || 0) < lowestTier) {
                    lowestTier = cNode.tier || 0;
                    stRoot = cId;
                }
            });
            if (!stRoot) stRoot = component[0];
            subtrees.push({ root: stRoot, members: component });
        });

        // Reconnect each subtree
        var maxCh = 5;
        subtrees.forEach(function(subtree) {
            var stRootNode = nodeById[subtree.root];
            if (!stRootNode) return;
            var stTier = stRootNode.tier || 0;

            // Find best parent in reachable set
            var candidates = [];
            for (var connId in reachable) {
                var conn = nodeById[connId];
                if (!conn || conn.school !== schoolName) continue;
                var connTier = conn.tier || 0;
                if (connTier > stTier) continue;
                if (connTier < stTier - 1) continue;
                candidates.push({ node: conn, childCount: (conn.children || []).length, tierDiff: stTier - connTier });
            }

            var withRoom = candidates.filter(function(c) { return c.childCount < maxCh; });
            if (withRoom.length === 0) withRoom = candidates;
            if (withRoom.length === 0) withRoom = [{ node: rootNode, childCount: (rootNode.children || []).length, tierDiff: stTier }];

            withRoom.sort(function(a, b) {
                if (a.tierDiff !== b.tierDiff) return a.tierDiff - b.tierDiff;
                return a.childCount - b.childCount;
            });

            var bestParent = withRoom[0].node;
            console.log('[OrphanRepair] Reconnecting subtree (' + subtree.members.length + ' nodes) ' +
                (stRootNode.name || subtree.root) + ' (tier ' + stTier + ') -> ' +
                (bestParent.name || bestParent.id) + ' (tier ' + (bestParent.tier || 0) + ')');

            // Link
            if (!bestParent.children) bestParent.children = [];
            if (bestParent.children.indexOf(subtree.root) === -1) {
                bestParent.children.push(subtree.root);
            }
            if (!stRootNode.prerequisites) stRootNode.prerequisites = [];
            if (stRootNode.prerequisites.indexOf(bestParent.id) === -1) {
                stRootNode.prerequisites.push(bestParent.id);
            }
            edges.push({ from: bestParent.id, to: subtree.root });

            // BFS to recover subtree depths
            var parentDepth = depthMap[bestParent.id] || bestParent.depth || 0;
            reachable[subtree.root] = true;
            depthMap[subtree.root] = parentDepth + 1;
            stRootNode.depth = parentDepth + 1;

            var recQ = [{ id: subtree.root, depth: parentDepth + 1 }];
            var recovered = 0;
            while (recQ.length > 0) {
                var rItem = recQ.shift();
                var rNode = nodeById[rItem.id];
                if (!rNode) continue;
                recovered++;
                (rNode.children || []).forEach(function(childId) {
                    if (!reachable[childId] && nodeById[childId]) {
                        reachable[childId] = true;
                        var cd = rItem.depth + 1;
                        depthMap[childId] = cd;
                        nodeById[childId].depth = cd;
                        recQ.push({ id: childId, depth: cd });
                    }
                });
            }
            repairStats.reconnectedSubtrees++;
            repairStats.nodesRecovered += recovered;
        });

        // Update school maxDepth
        var maxDepth = 0;
        schoolNodes.forEach(function(n) { maxDepth = Math.max(maxDepth, n.depth || 0); });
        sData.maxDepth = maxDepth;
    }

    console.log('[OrphanRepair] Complete: removed ' + repairStats.removedPrereqs +
        ' missing prereqs, reconnected ' + repairStats.reconnectedSubtrees +
        ' subtrees, recovered ' + repairStats.nodesRecovered + ' nodes');

    // Sync to rawData for persistence
    if (state.treeData.rawData && state.treeData.rawData.schools) {
        nodes.forEach(function(node) {
            var rawSchool = state.treeData.rawData.schools[node.school];
            if (!rawSchool || !rawSchool.nodes) return;
            for (var i = 0; i < rawSchool.nodes.length; i++) {
                var rawNode = rawSchool.nodes[i];
                if ((rawNode.formId || rawNode.spellId) === node.id) {
                    rawNode.prerequisites = (node.prerequisites || []).slice();
                    rawNode.children = (node.children || []).slice();
                    rawNode.depth = node.depth;
                    if (node.hardPrereqs) rawNode.hardPrereqs = node.hardPrereqs.slice();
                    if (node.softPrereqs) rawNode.softPrereqs = node.softPrereqs.slice();
                    if (node.locks) rawNode.locks = node.locks.slice();
                    break;
                }
            }
        });
    }

    // Save repaired tree
    if (window.callCpp && state.treeData.rawData) {
        var treeJson = JSON.stringify(state.treeData.rawData);
        window.callCpp('SaveSpellTree', treeJson);
        console.log('[OrphanRepair] Saved repaired tree');
    }

    // Re-analyze
    analyzeOrphans();

    // Re-render
    if (typeof WheelRenderer !== 'undefined' && WheelRenderer.nodes && WheelRenderer.nodes.length > 0) {
        WheelRenderer.render();
    }

    return repairStats;
}

/**
 * Update the orphan repair button visibility and text.
 * Called after tree loads and after repair.
 */
function updateOrphanRepairButton() {
    var btn = document.getElementById('orphanRepairBtn');
    if (!btn) return;

    var stats = lastOrphanStats || analyzeOrphans();
    if (stats.totalOrphans > 0 || stats.totalMissingPrereqs > 0) {
        var total = stats.totalOrphans + stats.totalMissingPrereqs;
        btn.textContent = total + ' orphan' + (total !== 1 ? 's' : '') + ' - repair';
        btn.style.display = '';
        btn.title = stats.totalOrphans + ' unreachable nodes, ' + stats.totalMissingPrereqs + ' missing prereq refs';
    } else {
        btn.style.display = 'none';
    }
}
