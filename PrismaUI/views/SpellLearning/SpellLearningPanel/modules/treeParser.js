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
// PROCEDURAL PREREQUISITE INJECTION
// =============================================================================

/**
 * Programmatically inject additional prerequisites into the tree
 * This creates more interesting unlock paths by requiring multiple spells
 * Only adds prereqs that are SAFE (already unlockable, no cycles)
 * 
 * Uses settings.proceduralInjection for configuration:
 * - chance: % chance per eligible node (0-100)
 * - maxPrereqs: maximum total prerequisites per node
 * - minTier: minimum tier where injection applies
 * - sameTierPreference: prefer same-tier prereqs for convergence
 */
function injectProceduralPrerequisites() {
    if (!state.treeData || !state.treeData.nodes) {
        console.log('[TreeParser] No tree data for prereq injection');
        return;
    }
    
    // Get settings with defaults
    var config = settings.proceduralInjection || {};
    var chance = config.chance !== undefined ? config.chance : 50;
    var maxPrereqs = config.maxPrereqs !== undefined ? config.maxPrereqs : 3;
    var minTier = config.minTier !== undefined ? config.minTier : 3;
    var sameTierPref = config.sameTierPreference !== false;
    
    console.log('[TreeParser] Injection config: chance=' + chance + '%, maxPrereqs=' + maxPrereqs + ', minTier=' + minTier + ', sameTierPref=' + sameTierPref);
    
    var nodes = state.treeData.nodes;
    var injectedCount = 0;
    
    // Build lookup maps
    var nodeById = {};
    var nodesBySchool = {};
    var nodesByDepth = {};
    
    nodes.forEach(function(node) {
        nodeById[node.id] = node;
        
        var school = node.school || 'Unknown';
        if (!nodesBySchool[school]) nodesBySchool[school] = [];
        nodesBySchool[school].push(node);
        
        var depth = node.depth || 0;
        if (!nodesByDepth[depth]) nodesByDepth[depth] = [];
        nodesByDepth[depth].push(node);
    });
    
    // For each non-root node, try to add extra prereqs
    nodes.forEach(function(node) {
        // Skip roots
        if (!node.prerequisites || node.prerequisites.length === 0) return;
        
        // Skip if already at max prereqs
        if (node.prerequisites.length >= maxPrereqs) return;
        
        // Skip nodes below minimum tier
        var depth = node.depth || 0;
        if (depth < minTier) return;
        
        // Random chance check
        if (Math.random() * 100 >= chance) return;
        
        // Find candidate prereqs from same school, lower or same tier
        var school = node.school || 'Unknown';
        var schoolNodes = nodesBySchool[school] || [];
        
        // Filter to valid candidates
        var candidates = schoolNodes.filter(function(candidate) {
            // Not self
            if (candidate.id === node.id) return false;
            // Not already a prereq
            if (node.prerequisites.indexOf(candidate.id) !== -1) return false;
            // Not a descendant (would create cycle)
            if (isDescendantOf(candidate, node.id, nodeById)) return false;
            // Must be lower or same tier
            var candDepth = candidate.depth || 0;
            if (candDepth >= depth) return false;
            // Must be unlockable (has path to root)
            if (!hasPathToRoot(candidate, nodeById)) return false;
            
            return true;
        });
        
        if (candidates.length === 0) return;
        
        // Apply same-tier preference if enabled
        var pool = candidates;
        if (sameTierPref) {
            // Prefer adjacent tier (depth - 1)
            var adjacentTierCandidates = candidates.filter(function(c) {
                return (c.depth || 0) === depth - 1;
            });
            if (adjacentTierCandidates.length > 0) {
                pool = adjacentTierCandidates;
            }
        }
        
        var selected = pool[Math.floor(Math.random() * pool.length)];
        
        // Add the prerequisite
        node.prerequisites.push(selected.id);
        
        // Add to children of selected node
        if (!selected.children) selected.children = [];
        if (selected.children.indexOf(node.id) === -1) {
            selected.children.push(node.id);
        }
        
        // Add edge
        TreeParser.edges.push({ from: selected.id, to: node.id });
        
        injectedCount++;
        console.log('[TreeParser] Injected prereq: ' + (node.name || node.id) + ' now requires ' + (selected.name || selected.id));
    });
    
    console.log('[TreeParser] Procedural injection complete: ' + injectedCount + ' additional prerequisites added');
    
    // Re-render tree if visible
    if (WheelRenderer.nodes && WheelRenderer.nodes.length > 0) {
        WheelRenderer.render();
    }
    
    // Save the modified tree
    if (window.callCpp && state.treeData.rawData) {
        // Update rawData with new prerequisites
        updateRawDataPrerequisites();
        var treeJson = JSON.stringify(state.treeData.rawData);
        window.callCpp('SaveSpellTree', treeJson);
    }
}

/**
 * Clear injected prerequisites and reroll with current settings
 * This reloads the original tree data and re-applies injection
 */
function rerollProceduralPrerequisites() {
    console.log('[TreeParser] Rerolling procedural prerequisites...');
    
    if (!state.treeData || !state.treeData.rawData) {
        console.log('[TreeParser] No tree data to reroll');
        return;
    }
    
    // Reload the tree from rawData (clears injected prereqs)
    var rawData = state.treeData.rawData;
    
    // Re-parse the tree (this resets to original structure)
    if (typeof loadTreeData === 'function') {
        loadTreeData(rawData);
    } else {
        // Fallback: re-parse manually
        var result = TreeParser.parse(rawData);
        if (result.success) {
            state.treeData = result;
            state.treeData.rawData = rawData;
        }
    }
    
    // Now apply injection with current settings
    if (settings.proceduralPrereqInjection) {
        setTimeout(function() {
            injectProceduralPrerequisites();
        }, 100);
    } else {
        // Just re-render
        if (WheelRenderer.nodes && WheelRenderer.nodes.length > 0) {
            WheelRenderer.render();
        }
    }
}

/**
 * Check if candidate is a descendant of targetId (would create cycle)
 */
function isDescendantOf(candidate, targetId, nodeById) {
    var visited = {};
    var queue = candidate.children ? candidate.children.slice() : [];
    
    while (queue.length > 0) {
        var childId = queue.shift();
        if (childId === targetId) return true;
        if (visited[childId]) continue;
        visited[childId] = true;
        
        var childNode = nodeById[childId];
        if (childNode && childNode.children) {
            queue = queue.concat(childNode.children);
        }
    }
    
    return false;
}

/**
 * Check if node has a valid path to root
 */
function hasPathToRoot(node, nodeById) {
    var visited = {};
    var current = node;
    var maxIterations = 100;
    var iterations = 0;
    
    while (current && iterations < maxIterations) {
        iterations++;
        if (visited[current.id]) return false; // Cycle
        visited[current.id] = true;
        
        if (!current.prerequisites || current.prerequisites.length === 0) {
            return true; // Found root
        }
        
        // Follow first prereq (if any prereq leads to root, it's valid)
        current = nodeById[current.prerequisites[0]];
    }
    
    return false;
}

/**
 * Update the raw tree data with injected prerequisites
 */
function updateRawDataPrerequisites() {
    if (!state.treeData || !state.treeData.rawData || !state.treeData.nodes) return;
    
    var rawData = state.treeData.rawData;
    
    // Build a map of node id to updated prerequisites
    var prereqMap = {};
    state.treeData.nodes.forEach(function(node) {
        prereqMap[node.id] = node.prerequisites || [];
    });
    
    // Update each school's nodes in rawData
    for (var schoolName in rawData.schools) {
        var school = rawData.schools[schoolName];
        if (!school.nodes) continue;
        
        school.nodes.forEach(function(rawNode) {
            var nodeId = rawNode.formId || rawNode.id;
            if (prereqMap[nodeId]) {
                rawNode.prerequisites = prereqMap[nodeId];
            }
        });
    }
}
