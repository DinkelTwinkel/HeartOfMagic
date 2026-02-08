/**
 * ClassicLayout — Grid-aware layout for Classic Growth mode.
 *
 * Positions NLP tree nodes ON actual grid dot positions from the Root Base
 * preview. Consumes gridPoints[] from TreePreview.getOutput() which contains
 * every rendered grid dot tagged with its school name.
 *
 * Algorithm:
 *   1. Filter gridPoints to this school's dots
 *   2. Build adjacency graph (8 nearest neighbors within distance threshold)
 *   3. Snap root to nearest grid dot to physical root position
 *   4. BFS: children placed at adjacent unoccupied grid dots, preferring
 *      the growth direction (outward/inward per root node's dir)
 *
 * Usage:
 *   var result = ClassicLayout.layoutAllSchools(treeData, baseData);
 *   // result.schools["Destruction"] => { nodes: [...], color: "#C85050" }
 *
 * Depends on: state.js (state.lastSpellData for spell lookups)
 */
var ClassicLayout = {

    _seed: 0,

    // ---- PUBLIC API ---------------------------------------------------------

    layoutAllSchools: function (treeData, baseData, layoutSettings) {
        var result = { schools: {} };
        if (!treeData || !treeData.schools || !baseData) return result;

        var ls = layoutSettings || {};
        var spread = ls.spread !== undefined ? ls.spread : 50;
        var radialBias = ls.radialBias !== undefined ? ls.radialBias : 50;

        // Spread → hard cap on how many occupied neighbors a candidate can have.
        // 0 = no limit (8), 100 = very strict (max 1 occupied neighbor)
        this._maxOccupiedNeighbors = Math.max(1, Math.round(8 - spread * 0.07));

        // Radial Bias → weight of radial outward bonus in scoring.
        // 0 = no radial preference, 100 = radial dominates direction score (~3x)
        // Direction score is ±1.0, so radialWeight of 3.0 at max fully overrides it.
        this._radialWeight = radialBias * 0.03;

        var mode = baseData.mode || 'sun';
        var grid = baseData.grid;
        var baseSchools = baseData.schools || [];
        var rootNodes = baseData.rootNodes || [];
        var allGridPoints = baseData.gridPoints || [];
        var tierSpacing = grid.tierSpacing || 30;

        // Tier zone config for two-pass layout
        var tierZones = ls.tierZones || null;
        var estimatedMaxDepth = 0;
        if (tierZones) {
            estimatedMaxDepth = this._estimateMaxDepth(treeData);
        }
        this._tierZones = tierZones;
        this._estimatedMaxDepth = estimatedMaxDepth;
        this._centerMask = ls.centerMask !== undefined ? ls.centerMask : 0;

        // Globe offset for mask — read from CORE panel (independent of loaded tree)
        var globeOff = (typeof TreeCore !== 'undefined' && TreeCore.getOutput)
            ? TreeCore.getOutput() : { x: 0, y: 0 };
        this._globeX = globeOff.x;
        this._globeY = globeOff.y;

        console.log('[ClassicLayout] mode=' + mode + ' baseSchools=' + baseSchools.length +
            ' rootNodes=' + rootNodes.length + ' gridPoints=' + allGridPoints.length +
            ' maxOccNeighbors=' + this._maxOccupiedNeighbors + ' radialW=' + this._radialWeight.toFixed(2) +
            ' tierZones=' + (tierZones ? 'yes' : 'no') + ' estMaxDepth=' + estimatedMaxDepth);
        if (tierZones) {
            for (var tzKey in tierZones) {
                if (tierZones.hasOwnProperty(tzKey)) {
                    console.log('[ClassicLayout]   ' + tzKey + ': ' + tierZones[tzKey].min + '%-' + tierZones[tzKey].max + '%');
                }
            }
        }

        // Debug: show grid point distribution per ring (first school)
        if (allGridPoints.length > 0) {
            var ringCounts = {};
            for (var dbi = 0; dbi < Math.min(allGridPoints.length, 5000); dbi++) {
                var dbp = allGridPoints[dbi];
                var dbr = Math.round(Math.sqrt(dbp.x * dbp.x + dbp.y * dbp.y));
                ringCounts[dbr] = (ringCounts[dbr] || 0) + 1;
            }
            var ringKeys = Object.keys(ringCounts).sort(function(a, b) { return Number(a) - Number(b); });
            var sample = ringKeys.slice(0, 8).map(function(k) { return 'r' + k + ':' + ringCounts[k]; });
            console.log('[ClassicLayout] Grid points per ring (first 8): ' + sample.join(', '));
        }

        var ringRadius = grid.ringRadius || ((grid.ringTier || 3) * tierSpacing);

        // ---- Pre-compute per-school data (grid points, info, roots) ----
        var schoolDataList = [];
        for (var schoolName in treeData.schools) {
            if (!treeData.schools.hasOwnProperty(schoolName)) continue;

            var schoolTree = treeData.schools[schoolName];
            var schoolInfo = null;
            for (var si = 0; si < baseSchools.length; si++) {
                if (baseSchools[si].name === schoolName) { schoolInfo = baseSchools[si]; break; }
            }
            if (!schoolInfo) {
                console.warn('[ClassicLayout] No baseSchool match for "' + schoolName + '"');
                continue;
            }

            var schoolRoots = [];
            for (var ri = 0; ri < rootNodes.length; ri++) {
                if (rootNodes[ri].school === schoolName) schoolRoots.push(rootNodes[ri]);
            }
            if (schoolRoots.length === 0) {
                console.warn('[ClassicLayout] No rootNodes for "' + schoolName + '"');
                continue;
            }

            // Filter grid points belonging to this school
            var schoolGridPts = [];
            if (mode === 'flat') {
                for (var gpi = 0; gpi < allGridPoints.length; gpi++) {
                    if (allGridPoints[gpi].school === schoolName) {
                        schoolGridPts.push(allGridPoints[gpi]);
                    }
                }
            } else {
                var growsOutward = this._isOutward(schoolRoots[0]);
                var minLayoutR, maxLayoutR;
                if (growsOutward) {
                    minLayoutR = ringRadius - tierSpacing;
                    maxLayoutR = ringRadius + tierSpacing * 25;
                } else {
                    minLayoutR = tierSpacing;
                    maxLayoutR = ringRadius + tierSpacing;
                }
                for (var gpi2 = 0; gpi2 < allGridPoints.length; gpi2++) {
                    var gp = allGridPoints[gpi2];
                    if (gp.school !== schoolName) continue;
                    var gpR = Math.sqrt(gp.x * gp.x + gp.y * gp.y);
                    if (gpR >= minLayoutR && gpR <= maxLayoutR) {
                        schoolGridPts.push(gp);
                    }
                }
            }

            schoolDataList.push({
                name: schoolName,
                tree: schoolTree,
                info: schoolInfo,
                roots: schoolRoots,
                gridPts: schoolGridPts
            });
        }

        // ---- Pass 1: Layout WITHOUT tier zones to measure per-school tree height ----
        var schoolHeights = {}; // schoolName -> max radius of placed nodes
        if (tierZones) {
            this._tierZones = null; // disable tier zones for pass 1
            this._simulatedMaxRadius = 0;
            for (var p1i = 0; p1i < schoolDataList.length; p1i++) {
                var sd1 = schoolDataList[p1i];
                this._seed = this._hashString(sd1.name);
                var pass1Nodes = this._layoutOnGrid(
                    sd1.tree, sd1.info, sd1.roots, grid, sd1.gridPts, mode
                );
                var schoolMaxR = 0;
                for (var p1n = 0; p1n < pass1Nodes.length; p1n++) {
                    var p1r = Math.sqrt(pass1Nodes[p1n].x * pass1Nodes[p1n].x +
                                        pass1Nodes[p1n].y * pass1Nodes[p1n].y);
                    if (p1r > schoolMaxR) schoolMaxR = p1r;
                }
                schoolHeights[sd1.name] = schoolMaxR;
                console.log('[ClassicLayout] Pass 1: ' + sd1.name + ' tree height radius = ' + schoolMaxR.toFixed(1));
            }
            this._tierZones = tierZones; // re-enable for pass 2
        }

        // ---- Pass 2 (or only pass): Layout with tier zones using per-school height ----
        var globalMaxGridR = 0;
        for (var p2i = 0; p2i < schoolDataList.length; p2i++) {
            var sd2 = schoolDataList[p2i];
            // Set per-school simulated max radius for tier zone scoring
            this._simulatedMaxRadius = schoolHeights[sd2.name] || 0;
            this._seed = this._hashString(sd2.name);
            var positioned = this._layoutOnGrid(
                sd2.tree, sd2.info, sd2.roots, grid, sd2.gridPts, mode
            );
            result.schools[sd2.name] = {
                nodes: positioned,
                color: sd2.info.color || '#888888',
                treeMaxRadius: schoolHeights[sd2.name] || this._maxGridRadius
            };
            if (this._maxGridRadius > globalMaxGridR) globalMaxGridR = this._maxGridRadius;
            console.log('[ClassicLayout] ' + sd2.name + ': ' + positioned.length +
                ' nodes on ' + sd2.gridPts.length + ' grid points');
        }

        // Store zone info for visual debug rendering
        result.zoneInfo = {
            ringRadius: ringRadius,
            maxGridRadius: globalMaxGridR
        };

        return result;
    },

    // ---- GRID-AWARE LAYOUT --------------------------------------------------

    /**
     * Place tree nodes on actual grid dot positions using adjacency BFS.
     * Works for both SUN and FLAT modes since gridPoints are already in
     * world-space coordinates relative to center.
     */
    _layoutOnGrid: function (schoolTree, schoolInfo, schoolRoots, grid, schoolGridPts, mode) {
        // Use appropriate spacing for adjacency: tierSpacing for SUN, grid.spacing for FLAT
        var tierSpacing = grid.tierSpacing || grid.spacing || 30;
        var ringRadius = grid.ringRadius || ((grid.ringTier || 3) * tierSpacing);
        var isFlat = (mode === 'flat');

        // Center mask: non-root nodes cannot be placed inside this radius
        var centerMaskR = (this._centerMask || 0) * tierSpacing;
        var centerMaskR2 = centerMaskR * centerMaskR;

        if (!schoolGridPts || schoolGridPts.length === 0) {
            console.warn('[ClassicLayout] No grid points for school');
            return [];
        }

        // Count tree nodes to check if grid has enough capacity
        var nodeCount = schoolTree.nodes ? schoolTree.nodes.length : 0;
        if (nodeCount > schoolGridPts.length) {
            var deficit = nodeCount - schoolGridPts.length;
            console.log('[ClassicLayout] Grid deficit: ' + nodeCount + ' nodes vs ' +
                schoolGridPts.length + ' points, densifying by ' + deficit);
            schoolGridPts = this._densifyGrid(schoolGridPts, deficit, tierSpacing);
        }

        // Compute max grid radius for radius-based tier zone scoring
        this._ringRadius = ringRadius;
        var schoolMaxR = 0;
        for (var mri = 0; mri < schoolGridPts.length; mri++) {
            var mrp = schoolGridPts[mri];
            var mrr = Math.sqrt(mrp.x * mrp.x + mrp.y * mrp.y);
            if (mrr > schoolMaxR) schoolMaxR = mrr;
        }
        this._maxGridRadius = schoolMaxR;

        // 1. Build adjacency graph from the actual grid points
        var gridGraph = this._buildGridGraph(schoolGridPts, tierSpacing);

        var nodeLookup = this._buildNodeLookup(schoolTree.nodes);
        var rootFormId = schoolTree.root;
        if (!nodeLookup[rootFormId]) return [];

        var rootNode = nodeLookup[rootFormId];
        var rootChildren = rootNode.children || [];
        var groups = this._buildGroups(rootFormId, rootChildren, schoolRoots, nodeLookup);

        var positioned = [];
        var placed = {};    // formId -> true (tree nodes already positioned)
        var occupied = {};  // grid point index -> true
        var queued = {};    // formId -> true (in BFS queue, prevents double-assign)
        var spells = this._getSpellData();
        var deferredNodes = []; // shared across phases 1-3

        // ==== Phase 1: Seed ALL physical roots before any BFS ====
        // Pre-queue seeds across all groups so no group steals another's seeds.
        // Seeds whose tier zone doesn't include root depth (0%) are deferred.
        var groupQueues = [];
        var groupDirs = [];
        var groupMinR2s = [];

        for (var gi = 0; gi < groups.length; gi++) {
            var group = groups[gi];
            var physRoot = group.physicalRoot;
            var growDirX = Math.cos(physRoot.dir || 0);
            var growDirY = Math.sin(physRoot.dir || 0);

            var minR2 = 0;
            if (!isFlat && this._isOutward(physRoot)) {
                var minR = ringRadius - tierSpacing * 0.5;
                minR2 = minR * minR;
            }

            groupDirs.push({ x: growDirX, y: growDirY });
            groupMinR2s.push(minR2);

            // Skip empty groups (more physical roots than children)
            if (group.seedIds.length === 0) {
                groupQueues.push([]);
                continue;
            }

            var rootIdx = this._snapToNearest(gridGraph.points, physRoot.x, physRoot.y);
            if (rootIdx < 0) {
                groupQueues.push([]);
                continue;
            }

            // Filter seeds: non-root seeds whose tier zone doesn't include
            // this position are deferred. Uses simulated max radius from pass 1.
            var groupRootId = group.seedIds[0];
            var validSeeds = [groupRootId]; // first seed always placed (group root)

            // Compute seed position's radial % using pass 1 simulated height
            var seedR = Math.sqrt(physRoot.x * physRoot.x + physRoot.y * physRoot.y);
            var sfRingR = this._ringRadius || 0;
            var sfSimMax = this._simulatedMaxRadius || this._maxGridRadius || 1;
            var sfGrowR = sfSimMax - sfRingR;
            var seedPct = sfGrowR > 1 ? ((seedR - sfRingR) / sfGrowR) * 100 : 0;
            if (seedPct < 0) seedPct = 0;

            for (var sf = 1; sf < group.seedIds.length; sf++) {
                var sfId = group.seedIds[sf];
                var sfSpell = this._findSpell(sfId, spells);
                var sfLevel = sfSpell ? sfSpell.skillLevel : '';
                var sfZone = this._tierZones ? this._tierZones[sfLevel] : null;
                if (sfZone && (seedPct < sfZone.min - 5 || seedPct > sfZone.max + 5)) {
                    // Seed position outside this tier's zone — defer
                    deferredNodes.push({
                        formId: sfId,
                        originalParent: groupRootId,
                        skillLevel: sfLevel,
                        groupIdx: gi
                    });
                    queued[sfId] = true;
                } else {
                    validSeeds.push(sfId);
                }
            }

            // Reserve grid positions for valid seeds only
            var seedPositions = [rootIdx];
            occupied[rootIdx] = true;
            if (validSeeds.length > 1) {
                var extraSlots = this._findSlots(
                    gridGraph, occupied, rootIdx,
                    validSeeds.length - 1, growDirX, growDirY, minR2
                );
                for (var es = 0; es < extraSlots.length; es++) {
                    seedPositions.push(extraSlots[es]);
                    occupied[extraSlots[es]] = true;
                }
            }

            // Queue valid seeds — first seed is independent root,
            // additional seeds parent to the group's first seed.
            var gQueue = [];
            for (var si = 0; si < validSeeds.length; si++) {
                var sid = validSeeds[si];
                if (placed[sid] || queued[sid]) continue;
                if (si >= seedPositions.length) break;

                var seedX, seedY;
                if (si === 0) {
                    seedX = physRoot.x;
                    seedY = physRoot.y;
                } else {
                    var seedPt = gridGraph.points[seedPositions[si]];
                    seedX = seedPt.x;
                    seedY = seedPt.y;
                }
                queued[sid] = true;
                gQueue.push({
                    formId: sid,
                    parentFormId: si === 0 ? null : groupRootId,
                    gridIdx: seedPositions[si],
                    x: seedX,
                    y: seedY,
                    depth: si === 0 ? 0 : 1
                });
            }
            groupQueues.push(gQueue);
        }

        console.log('[ClassicLayout] Phase 1 complete: ' + groupQueues.length +
            ' root groups, seeds queued: ' + Object.keys(queued).length);

        // ==== Phase 2: Wave-based fair BFS across all roots ====
        // Each wave: collect ALL frontier nodes from ALL groups, shuffle
        // randomly, process each one. Children spawned this wave form the
        // NEXT wave. This ensures every root tree grows at the same rate.

        // Build first wave from all group seed queues
        var currentWave = [];
        for (var gi2 = 0; gi2 < groupQueues.length; gi2++) {
            var gq = groupQueues[gi2];
            for (var qi = 0; qi < gq.length; qi++) {
                gq[qi].groupIdx = gi2;
                currentWave.push(gq[qi]);
            }
        }

        var waveNum = 0;
        while (currentWave.length > 0) {
            // Shuffle this wave so no group consistently goes first
            this._shuffleArray(currentWave);

            var nextWave = [];
            for (var wi = 0; wi < currentWave.length; wi++) {
                var cur = currentWave[wi];
                if (placed[cur.formId]) continue;
                placed[cur.formId] = true;

                var curNode = nodeLookup[cur.formId];
                if (!curNode) continue;

                var spellInfo = this._findSpell(cur.formId, spells);
                positioned.push({
                    formId: cur.formId,
                    x: cur.x,
                    y: cur.y,
                    parentFormId: cur.parentFormId,
                    tier: curNode.tier || 0,
                    skillLevel: spellInfo ? spellInfo.skillLevel : '',
                    name: spellInfo ? spellInfo.name : cur.formId,
                    isRoot: cur.parentFormId === null,
                    gridIdx: cur.gridIdx
                });

                // Collect children for NEXT wave (not current)
                var children = curNode.children || [];
                if (children.length === 0) continue;

                // Sort children by tier: Novice first → Master last
                if (children.length > 1 && this._tierZones) {
                    var tierOrd = { 'Novice': 0, 'Apprentice': 1, 'Adept': 2, 'Expert': 3, 'Master': 4 };
                    var sortSelf = this;
                    children = children.slice();
                    children.sort(function (a, b) {
                        var sa = sortSelf._findSpell(a, spells);
                        var sb = sortSelf._findSpell(b, spells);
                        var ta = sa ? (tierOrd[sa.skillLevel] || 0) : 0;
                        var tb = sb ? (tierOrd[sb.skillLevel] || 0) : 0;
                        return ta - tb;
                    });
                }

                var curGI = cur.groupIdx;
                var gDir = groupDirs[curGI];
                var gMinR2 = groupMinR2s[curGI];
                var childMinR2 = Math.max(gMinR2, centerMaskR2);

                // Compute parent's radial position for deferral check
                var curR = Math.sqrt(cur.x * cur.x + cur.y * cur.y);
                var dRingR = this._ringRadius || 0;
                var dSimMax = this._simulatedMaxRadius || this._maxGridRadius || 1;
                var dGrowR = dSimMax - dRingR;
                var curPct = dGrowR > 1 ? ((curR - dRingR) / dGrowR) * 100 : 50;

                for (var ci2 = 0; ci2 < children.length; ci2++) {
                    var childId = children[ci2];
                    if (placed[childId] || queued[childId]) continue;

                    var childSpell = this._findSpell(childId, spells);
                    var childLevel = childSpell ? childSpell.skillLevel : '';

                    // Defer children whose tier zone starts well beyond parent's radius
                    var childZone = this._tierZones ? this._tierZones[childLevel] : null;
                    if (childZone && curPct < childZone.min - 10) {
                        deferredNodes.push({
                            formId: childId,
                            originalParent: cur.formId,
                            skillLevel: childLevel,
                            groupIdx: curGI
                        });
                        queued[childId] = true;
                        continue;
                    }

                    var childSlots = this._findSlots(
                        gridGraph, occupied, cur.gridIdx,
                        1, gDir.x, gDir.y, childMinR2,
                        childLevel, cur.depth + 1
                    );
                    if (childSlots.length === 0) {
                        // Defer instead of silently dropping
                        deferredNodes.push({
                            formId: childId,
                            originalParent: cur.formId,
                            skillLevel: childLevel,
                            groupIdx: curGI
                        });
                        queued[childId] = true;
                        continue;
                    }

                    var gIdx = childSlots[0];
                    occupied[gIdx] = true;
                    queued[childId] = true;

                    var slotPt = gridGraph.points[gIdx];
                    nextWave.push({
                        formId: childId,
                        parentFormId: cur.formId,
                        gridIdx: gIdx,
                        x: slotPt.x,
                        y: slotPt.y,
                        depth: cur.depth + 1,
                        groupIdx: curGI
                    });
                }
            }

            waveNum++;
            currentWave = nextWave;
        }

        console.log('[ClassicLayout] Phase 2 complete: ' + waveNum + ' waves, ' +
            positioned.length + ' nodes placed');

        // ==== Phase 3: Place deferred nodes ====
        // Nodes deferred from Phase 2: tier zone mismatch OR no adjacent slots.
        // Try to attach to placed nodes, preferring tier zone radius when available.
        if (deferredNodes.length > 0) {
            console.log('[ClassicLayout] Deferred nodes: ' + deferredNodes.length);

            var dfRingR = this._ringRadius || 0;
            var dfSimMax = this._simulatedMaxRadius || this._maxGridRadius || 1;
            var dfGrowR = dfSimMax - dfRingR;

            var dfQueue = deferredNodes;
            var maxPasses = 30;
            for (var dfPass = 0; dfPass < maxPasses && dfQueue.length > 0; dfPass++) {
                var dfRemaining = [];
                var dfPlaced = 0;

                var dfTierOrd = { 'Novice': 0, 'Apprentice': 1, 'Adept': 2, 'Expert': 3, 'Master': 4 };
                dfQueue.sort(function (a, b) {
                    return (dfTierOrd[a.skillLevel] || 0) - (dfTierOrd[b.skillLevel] || 0);
                });

                for (var di = 0; di < dfQueue.length; di++) {
                    var def = dfQueue[di];
                    if (placed[def.formId]) continue;

                    var defZone = this._tierZones ? this._tierZones[def.skillLevel] : null;

                    // Find best attach point among placed nodes
                    var bestAttachGridIdx = -1;
                    var bestAttachFormId = null;
                    var bestScore = -Infinity;

                    for (var pi = 0; pi < positioned.length; pi++) {
                        var pn = positioned[pi];
                        if (pn.gridIdx === undefined) continue;

                        var pAdj = gridGraph.adj[pn.gridIdx] || [];
                        var hasOpen = false;
                        for (var ai = 0; ai < pAdj.length; ai++) {
                            if (!occupied[pAdj[ai]]) { hasOpen = true; break; }
                        }
                        if (!hasOpen) continue;

                        var dfScore = 0;

                        // Prefer original parent if placed
                        if (pn.formId === def.originalParent) {
                            dfScore += 200;
                        }

                        // Tier zone preference (soft, not hard filter)
                        if (defZone) {
                            var pnR = Math.sqrt(pn.x * pn.x + pn.y * pn.y);
                            var pnPct = dfGrowR > 1 ? ((pnR - dfRingR) / dfGrowR) * 100 : 50;
                            if (pnPct >= defZone.min - 15 && pnPct <= defZone.max + 15) {
                                var dfZoneMid = (defZone.min + defZone.max) / 2;
                                dfScore += 50 - Math.abs(pnPct - dfZoneMid) * 0.5;
                            }
                        }

                        if (dfScore > bestScore) {
                            bestScore = dfScore;
                            bestAttachGridIdx = pn.gridIdx;
                            bestAttachFormId = pn.formId;
                        }
                    }

                    if (bestAttachGridIdx < 0) { dfRemaining.push(def); continue; }

                    var dfDir = groupDirs[def.groupIdx] || groupDirs[0];
                    var dfMinR2 = groupMinR2s[def.groupIdx] || 0;
                    var dfChildMinR2 = Math.max(dfMinR2, centerMaskR2);

                    var dfSlots = this._findSlots(
                        gridGraph, occupied, bestAttachGridIdx,
                        1, dfDir.x, dfDir.y, dfChildMinR2,
                        def.skillLevel, 0
                    );
                    if (dfSlots.length === 0) { dfRemaining.push(def); continue; }

                    var dfIdx = dfSlots[0];
                    occupied[dfIdx] = true;
                    placed[def.formId] = true;
                    dfPlaced++;

                    var dfPt = gridGraph.points[dfIdx];
                    var dfSpell = this._findSpell(def.formId, spells);
                    positioned.push({
                        formId: def.formId,
                        x: dfPt.x,
                        y: dfPt.y,
                        parentFormId: bestAttachFormId,
                        tier: 0,
                        skillLevel: dfSpell ? dfSpell.skillLevel : def.skillLevel,
                        name: dfSpell ? dfSpell.name : def.formId,
                        isRoot: false,
                        gridIdx: dfIdx
                    });

                    // Enqueue children
                    var dfNode = nodeLookup[def.formId];
                    if (dfNode && dfNode.children) {
                        for (var dci = 0; dci < dfNode.children.length; dci++) {
                            var dcId = dfNode.children[dci];
                            if (placed[dcId] || queued[dcId]) continue;
                            var dcSpell = this._findSpell(dcId, spells);
                            var dcLevel = dcSpell ? dcSpell.skillLevel : '';
                            dfRemaining.push({
                                formId: dcId,
                                originalParent: def.formId,
                                skillLevel: dcLevel,
                                groupIdx: def.groupIdx
                            });
                            queued[dcId] = true;
                        }
                    }
                }

                dfQueue = dfRemaining;
                if (dfPlaced === 0) break;
            }

            console.log('[ClassicLayout] Deferred placement done, remaining: ' + dfQueue.length);
        }

        // ==== Phase 4: Force-place any remaining unplaced nodes ====
        // Find ALL tree nodes not yet placed and put them at nearest open grid point.
        var allNodeIds = Object.keys(nodeLookup);
        var unplacedIds = [];
        for (var ui = 0; ui < allNodeIds.length; ui++) {
            if (!placed[allNodeIds[ui]]) {
                unplacedIds.push(allNodeIds[ui]);
            }
        }

        if (unplacedIds.length > 0) {
            console.log('[ClassicLayout] Phase 4: force-placing ' + unplacedIds.length + ' remaining nodes');

            // Build list of open grid point indices
            var openGridPts = [];
            for (var ogi = 0; ogi < gridGraph.points.length; ogi++) {
                if (!occupied[ogi]) openGridPts.push(ogi);
            }

            // Sort unplaced by tier (Novice first)
            var p4TierOrd = { 'Novice': 0, 'Apprentice': 1, 'Adept': 2, 'Expert': 3, 'Master': 4 };
            unplacedIds.sort(function (a, b) {
                var sa = nodeLookup[a], sb = nodeLookup[b];
                var la = sa ? (p4TierOrd[sa.skillLevel] || 3) : 3;
                var lb = sb ? (p4TierOrd[sb.skillLevel] || 3) : 3;
                return la - lb;
            });

            // For each unplaced node, find nearest open grid point to any placed neighbor
            for (var fp = 0; fp < unplacedIds.length && openGridPts.length > 0; fp++) {
                var fpId = unplacedIds[fp];
                if (placed[fpId]) continue;

                // Find a placed node to attach near (prefer original parent in tree)
                var fpNode = nodeLookup[fpId];
                var fpParentId = fpNode && fpNode.prerequisites ? fpNode.prerequisites[0] : null;
                var nearGridIdx = -1;

                // If parent is placed, try adjacent to it first
                if (fpParentId && placed[fpParentId]) {
                    for (var ppi = 0; ppi < positioned.length; ppi++) {
                        if (positioned[ppi].formId === fpParentId) {
                            var ppAdj = gridGraph.adj[positioned[ppi].gridIdx] || [];
                            for (var ppai = 0; ppai < ppAdj.length; ppai++) {
                                if (!occupied[ppAdj[ppai]]) {
                                    nearGridIdx = ppAdj[ppai];
                                    break;
                                }
                            }
                            break;
                        }
                    }
                }

                // Fallback: nearest open point to any placed node
                if (nearGridIdx < 0) {
                    // Use first available open point adjacent to ANY placed node
                    for (var rpi = positioned.length - 1; rpi >= 0 && nearGridIdx < 0; rpi--) {
                        var rpn = positioned[rpi];
                        if (rpn.gridIdx === undefined) continue;
                        var rpAdj = gridGraph.adj[rpn.gridIdx] || [];
                        for (var rpai = 0; rpai < rpAdj.length; rpai++) {
                            if (!occupied[rpAdj[rpai]]) {
                                nearGridIdx = rpAdj[rpai];
                                fpParentId = rpn.formId;
                                break;
                            }
                        }
                    }
                }

                // Last resort: any open grid point
                if (nearGridIdx < 0 && openGridPts.length > 0) {
                    nearGridIdx = openGridPts[0];
                }

                if (nearGridIdx < 0) break; // no more grid space

                occupied[nearGridIdx] = true;
                placed[fpId] = true;
                // Remove from open list
                var openIdx = openGridPts.indexOf(nearGridIdx);
                if (openIdx >= 0) openGridPts.splice(openIdx, 1);

                var fpPt = gridGraph.points[nearGridIdx];
                var fpSpell = this._findSpell(fpId, spells);
                positioned.push({
                    formId: fpId,
                    x: fpPt.x,
                    y: fpPt.y,
                    parentFormId: fpParentId,
                    tier: fpNode ? fpNode.tier : 0,
                    skillLevel: fpSpell ? fpSpell.skillLevel : '',
                    name: fpSpell ? fpSpell.name : fpId,
                    isRoot: false,
                    gridIdx: nearGridIdx
                });
            }

            var stillUnplaced = 0;
            for (var sui = 0; sui < allNodeIds.length; sui++) {
                if (!placed[allNodeIds[sui]]) stillUnplaced++;
            }
            console.log('[ClassicLayout] Phase 4 done: ' + (unplacedIds.length - stillUnplaced) +
                ' force-placed, ' + stillUnplaced + ' could not fit (grid full)');
        }

        return positioned;
    },

    // ---- TREE DEPTH ESTIMATION (pass 1 for tier zones) --------------------

    /**
     * Estimate max BFS depth across all schools by traversing the tree
     * structure without grid placement. Used for tier zone percentage calc.
     *
     * @param {Object} treeData - { schools: { name: { root, nodes[] } } }
     * @returns {number} max BFS depth across all schools
     */
    _estimateMaxDepth: function (treeData) {
        var maxDepth = 0;
        for (var schoolName in treeData.schools) {
            if (!treeData.schools.hasOwnProperty(schoolName)) continue;
            var school = treeData.schools[schoolName];
            var lookup = this._buildNodeLookup(school.nodes);
            var rootId = school.root;
            if (!lookup[rootId]) continue;

            // BFS the tree structure
            var queue = [{ formId: rootId, depth: 0 }];
            var visited = {};
            visited[rootId] = true;
            while (queue.length > 0) {
                var cur = queue.shift();
                if (cur.depth > maxDepth) maxDepth = cur.depth;
                var node = lookup[cur.formId];
                if (!node || !node.children) continue;
                for (var ci = 0; ci < node.children.length; ci++) {
                    var childId = node.children[ci];
                    if (!visited[childId]) {
                        visited[childId] = true;
                        queue.push({ formId: childId, depth: cur.depth + 1 });
                    }
                }
            }
        }
        return maxDepth;
    },

    // ---- GRID GRAPH CONSTRUCTION -------------------------------------------

    /**
     * Build an adjacency graph from grid points.
     * Each point gets up to 8 nearest neighbors within distance threshold.
     * Works for all grid types (naive, linear, equalArea, fibonacci, square).
     *
     * @param {Array} points - [{x, y, school}]
     * @param {number} tierSpacing - Grid tier spacing (used for distance threshold)
     * @returns {{ points: Array, adj: Object }}
     */
    _buildGridGraph: function (points, tierSpacing) {
        // Distance threshold: covers diagonal neighbors on any grid type
        var maxDist = tierSpacing * 2.0;
        var maxDist2 = maxDist * maxDist;
        var maxNeighbors = 8;
        var adj = {};

        for (var i = 0; i < points.length; i++) {
            var pi = points[i];
            var candidates = [];
            for (var j = 0; j < points.length; j++) {
                if (i === j) continue;
                var dx = points[j].x - pi.x;
                var dy = points[j].y - pi.y;
                var d2 = dx * dx + dy * dy;
                if (d2 <= maxDist2) {
                    candidates.push({ idx: j, dist: d2 });
                }
            }
            candidates.sort(function (a, b) { return a.dist - b.dist; });
            adj[i] = [];
            for (var k = 0; k < Math.min(maxNeighbors, candidates.length); k++) {
                adj[i].push(candidates[k].idx);
            }
        }

        return { points: points, adj: adj };
    },

    // ---- PLACEMENT SEARCH --------------------------------------------------

    /**
     * BFS from parentIdx to find 'count' unoccupied grid positions.
     * Scoring combines:
     *   - Growth direction alignment (cosine similarity with dir vector)
     *   - Radial outward bonus (prefer increasing distance from center)
     *   - Density penalty (penalize candidates surrounded by occupied points)
     *   - Hard radius floor (block placement inside root ring for outward growth)
     *
     * @param {{ points, adj }} gridGraph
     * @param {Object} occupied - grid index -> true
     * @param {number} parentIdx - starting grid point index
     * @param {number} count - how many slots to find
     * @param {number} growDirX - growth direction cos
     * @param {number} growDirY - growth direction sin
     * @param {number} minR2 - minimum squared radius (0 = no limit)
     * @param {string} [skillLevel] - skill level for tier zone scoring
     * @param {number} [bfsDepth] - current BFS depth for tier zone scoring
     * @returns {number[]} array of grid point indices
     */
    _findSlots: function (gridGraph, occupied, parentIdx, count, growDirX, growDirY, minR2, skillLevel, bfsDepth) {
        if (count <= 0 || parentIdx < 0) return [];
        minR2 = minR2 || 0;

        // More hops to allow deep trees to spread across grid
        var MAX_HOPS = this._tierZones ? 12 : 8;
        var points = gridGraph.points;
        var adj = gridGraph.adj;
        var parent = points[parentIdx];
        if (!parent) return [];

        var parentR = Math.sqrt(parent.x * parent.x + parent.y * parent.y);
        var result = [];
        var visited = {};
        visited[parentIdx] = true;

        // Depth-limited BFS: each entry is { idx, depth }
        var queue = [{ idx: parentIdx, depth: 0 }];

        while (queue.length > 0 && result.length < count) {
            var cur = queue.shift();
            var curIdx = cur.idx;
            var curDepth = cur.depth;

            // Don't expand beyond max hops
            if (curDepth >= MAX_HOPS) continue;

            var neighbors = adj[curIdx] || [];

            // Score neighbors with direction + density + radial awareness
            var scored = [];
            for (var i = 0; i < neighbors.length; i++) {
                var nIdx = neighbors[i];
                if (visited[nIdx]) continue;
                visited[nIdx] = true;

                var n = points[nIdx];

                // Hard filter: enforce minimum radius from globe (no growth inside mask)
                var gdx = n.x - (this._globeX || 0);
                var gdy = n.y - (this._globeY || 0);
                var nR2 = gdx * gdx + gdy * gdy;
                if (minR2 > 0 && nR2 < minR2) {
                    // Still traverse through for BFS connectivity but don't place here
                    queue.push({ idx: nIdx, depth: curDepth + 1 });
                    continue;
                }

                // Skip occupied — traverse through them but don't select
                if (occupied[nIdx]) {
                    queue.push({ idx: nIdx, depth: curDepth + 1 });
                    continue;
                }

                // Hard density filter: count occupied neighbors, reject if too crowded
                var occupiedNearby = 0;
                var nAdj = adj[nIdx] || [];
                for (var oi = 0; oi < nAdj.length; oi++) {
                    if (occupied[nAdj[oi]]) occupiedNearby++;
                }
                var maxOcc = this._maxOccupiedNeighbors || 8;
                if (occupiedNearby > maxOcc) {
                    // Too dense — skip placement but keep traversing
                    queue.push({ idx: nIdx, depth: curDepth + 1 });
                    continue;
                }

                // Direction score: alignment with growth direction from parent
                var dx = n.x - parent.x;
                var dy = n.y - parent.y;
                var dist = Math.sqrt(dx * dx + dy * dy);
                var dirScore = dist > 0.001 ? (dx * growDirX + dy * growDirY) / dist : 0;

                // Radial outward bonus: prefer moving away from center
                // At radialBias=100, this is ±3.0 which dominates dirScore (±1.0)
                var nR = Math.sqrt(nR2);
                var rw = this._radialWeight || 0;
                var radialBonus = (nR > parentR) ? rw : -rw;

                // Prefer closer hops (depth penalty)
                var depthPenalty = curDepth * 0.3;

                var finalScore = dirScore + radialBonus - depthPenalty;

                // Tier zone scoring: bias placement toward correct RADIAL zone
                // Uses physical radius from center so candidates at different rings
                // get different scores, even at the same BFS depth.
                var tz = this._tierZones;
                if (tz && skillLevel) {
                    var tzZone = tz[skillLevel];
                    if (tzZone) {
                        var nRadius = Math.sqrt(nR2);
                        var ringR = this._ringRadius || 0;
                        var maxGR = this._simulatedMaxRadius || this._maxGridRadius || 1;
                        var growRange = maxGR - ringR;
                        var radiusPct = growRange > 1 ? ((nRadius - ringR) / growRange) * 100 : 50;
                        if (radiusPct < 0) radiusPct = 0;
                        if (radiusPct > 100) radiusPct = 100;

                        if (radiusPct < tzZone.min) {
                            var belowDist = (tzZone.min - radiusPct) / 100;
                            finalScore -= 5.0 + belowDist * 10.0;
                        } else if (radiusPct > tzZone.max) {
                            var aboveDist = (radiusPct - tzZone.max) / 100;
                            finalScore -= 5.0 + aboveDist * 10.0;
                        } else {
                            var zoneMid = (tzZone.min + tzZone.max) / 2;
                            var zoneHalf = (tzZone.max - tzZone.min) / 2;
                            var centeredness = zoneHalf > 0 ? 1.0 - Math.abs(radiusPct - zoneMid) / zoneHalf : 1.0;
                            finalScore += 3.0 * centeredness;
                        }
                    }
                }

                scored.push({ idx: nIdx, score: finalScore, depth: curDepth + 1 });
            }

            // Sort: highest score first (growth direction + sparse areas preferred)
            scored.sort(function (a, b) { return b.score - a.score; });

            for (var j = 0; j < scored.length; j++) {
                var s = scored[j];
                result.push(s.idx);
                queue.push({ idx: s.idx, depth: s.depth });
                if (result.length >= count) break;
            }
        }

        return result;
    },

    /**
     * Find the grid point nearest to (x, y).
     * @returns {number} index into points array, or -1 if empty
     */
    _snapToNearest: function (points, x, y) {
        var bestIdx = -1;
        var bestDist = Infinity;
        for (var i = 0; i < points.length; i++) {
            var dx = points[i].x - x;
            var dy = points[i].y - y;
            var d2 = dx * dx + dy * dy;
            if (d2 < bestDist) {
                bestDist = d2;
                bestIdx = i;
            }
        }
        return bestIdx;
    },

    // ---- GROUP BUILDING (balanced for multiple physical roots) ---------------

    /**
     * Builds groups mapping tree seeds to physical root positions.
     *
     * Single root: one group, seed = [rootFormId]
     * Multi root:  rootFormId is virtual (not placed). First-level children
     *   are distributed across physical roots balanced by subtree size.
     *   Uses greedy scheduling: always assign next-largest subtree to the
     *   group with the smallest total so far.
     */
    _buildGroups: function (rootFormId, rootChildren, physicalRoots, nodeLookup) {
        var physCount = physicalRoots.length;

        if (physCount <= 1) {
            return [{ physicalRoot: physicalRoots[0], seedIds: [rootFormId] }];
        }

        // Count subtree sizes for each first-level child
        var childSizes = [];
        for (var i = 0; i < rootChildren.length; i++) {
            var visited = {};
            visited[rootFormId] = true; // don't traverse back through root
            var size = this._countSubtree(rootChildren[i], nodeLookup, visited);
            childSizes.push({ formId: rootChildren[i], size: size });
        }

        // Sort by subtree size descending (assign largest subtrees first)
        childSizes.sort(function (a, b) { return b.size - a.size; });

        // Greedy balanced assignment: each child goes to the group with
        // the smallest total subtree size so far
        var groups = [];
        var groupTotals = [];
        for (var pi = 0; pi < physCount; pi++) {
            groups.push({ physicalRoot: physicalRoots[pi], seedIds: [] });
            groupTotals.push(0);
        }

        for (var ci = 0; ci < childSizes.length; ci++) {
            var minIdx = 0;
            for (var gi = 1; gi < physCount; gi++) {
                if (groupTotals[gi] < groupTotals[minIdx]) minIdx = gi;
            }
            groups[minIdx].seedIds.push(childSizes[ci].formId);
            groupTotals[minIdx] += childSizes[ci].size;
        }

        console.log('[ClassicLayout] Group distribution: ' +
            groups.map(function (g, i) {
                return 'G' + i + '=' + g.seedIds.length + ' seeds (' + groupTotals[i] + ' nodes)';
            }).join(', '));

        return groups;
    },

    /**
     * Count total nodes in a subtree (recursive).
     * @param {string} formId - Root of subtree
     * @param {Object} nodeLookup - formId -> node
     * @param {Object} visited - already-counted formIds (prevents cycles)
     * @returns {number} total node count including this node
     */
    _countSubtree: function (formId, nodeLookup, visited) {
        if (visited[formId]) return 0;
        visited[formId] = true;
        var node = nodeLookup[formId];
        if (!node) return 0;
        var count = 1;
        var children = node.children || [];
        for (var i = 0; i < children.length; i++) {
            count += this._countSubtree(children[i], nodeLookup, visited);
        }
        return count;
    },

    // ---- HELPERS ------------------------------------------------------------

    _isOutward: function (rootNode) {
        var posAngle = Math.atan2(rootNode.y, rootNode.x);
        var diff = Math.abs((rootNode.dir || 0) - posAngle);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        return diff < Math.PI / 2;
    },

    _buildNodeLookup: function (nodes) {
        var lookup = {};
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].formId != null) lookup[nodes[i].formId] = nodes[i];
        }
        return lookup;
    },

    _getSpellData: function () {
        if (typeof state !== 'undefined' && state.lastSpellData && state.lastSpellData.spells) {
            return state.lastSpellData.spells;
        }
        return null;
    },

    _findSpell: function (formId, spells) {
        if (!spells || !formId) return null;
        for (var i = 0; i < spells.length; i++) {
            if (spells[i].formId === formId) return spells[i];
        }
        return null;
    },

    _shuffleArray: function (arr) {
        for (var i = arr.length - 1; i > 0; i--) {
            var j = Math.floor(this._seededRandom() * (i + 1));
            var tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
        }
    },

    _seededRandom: function () {
        this._seed = (this._seed * 1664525 + 1013904223) & 0xFFFFFFFF;
        return (this._seed >>> 0) / 4294967296;
    },

    /**
     * Densify a school's grid by adding midpoints between existing grid points.
     * Called when a school has more tree nodes than grid points.
     * Adds points at midpoints of the outermost ring edges first (most space),
     * then progressively inward. Preserves the school tag from neighbors.
     */
    _densifyGrid: function (pts, needed, tierSpacing) {
        var result = pts.slice(); // copy original
        var added = 0;
        var existingSet = {};
        for (var ei = 0; ei < result.length; ei++) {
            var ek = Math.round(result[ei].x) + ',' + Math.round(result[ei].y);
            existingSet[ek] = true;
        }
        var school = pts.length > 0 ? pts[0].school : '';
        var maxDist = tierSpacing * 2.2;
        var maxDist2 = maxDist * maxDist;

        // Build pairs sorted by radius (outermost first, most room to add)
        var pairs = [];
        for (var i = 0; i < pts.length && added < needed; i++) {
            for (var j = i + 1; j < pts.length; j++) {
                var dx = pts[j].x - pts[i].x;
                var dy = pts[j].y - pts[i].y;
                var d2 = dx * dx + dy * dy;
                if (d2 <= maxDist2 && d2 > 1) {
                    var avgR = (Math.sqrt(pts[i].x * pts[i].x + pts[i].y * pts[i].y) +
                                Math.sqrt(pts[j].x * pts[j].x + pts[j].y * pts[j].y)) / 2;
                    pairs.push({ i: i, j: j, avgR: avgR });
                }
            }
        }
        pairs.sort(function (a, b) { return b.avgR - a.avgR; });

        for (var pi = 0; pi < pairs.length && added < needed; pi++) {
            var p = pairs[pi];
            var mx = (pts[p.i].x + pts[p.j].x) / 2;
            var my = (pts[p.i].y + pts[p.j].y) / 2;
            var mk = Math.round(mx) + ',' + Math.round(my);
            if (existingSet[mk]) continue;
            existingSet[mk] = true;
            result.push({ x: mx, y: my, school: school });
            added++;
        }

        if (added < needed) {
            // Still short: add points extending outward from outermost ring
            var outerPts = result.slice().sort(function (a, b) {
                var ra = a.x * a.x + a.y * a.y;
                var rb = b.x * b.x + b.y * b.y;
                return rb - ra;
            });
            for (var oi = 0; oi < outerPts.length && added < needed; oi++) {
                var op = outerPts[oi];
                var oR = Math.sqrt(op.x * op.x + op.y * op.y);
                if (oR < 1) continue;
                var nx = op.x * (1 + tierSpacing / oR);
                var ny = op.y * (1 + tierSpacing / oR);
                var nk = Math.round(nx) + ',' + Math.round(ny);
                if (existingSet[nk]) continue;
                existingSet[nk] = true;
                result.push({ x: nx, y: ny, school: school });
                added++;
            }
        }

        console.log('[ClassicLayout] Densified grid: ' + pts.length + ' -> ' + result.length +
            ' points (added ' + added + '/' + needed + ')');
        return result;
    },

    _hashString: function (str) {
        var hash = 0;
        for (var i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash | 0;
        }
        return hash;
    }
};
