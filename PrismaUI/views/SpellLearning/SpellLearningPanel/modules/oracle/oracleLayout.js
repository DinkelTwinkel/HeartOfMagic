/**
 * OracleLayout - Parallel lane layout for Oracle Growth mode.
 *
 * Positions NLP tree nodes in parallel lanes where each thematic chain
 * runs as a separate lane, side by side. Visually distinct from classic's
 * web, tree's trunks, and graph's arborescence - think parallel railroad
 * tracks, each chain being a track with spells as stations.
 *
 * Algorithm:
 *   SUN mode:
 *     1. For each school, get the school's angular wedge from baseData
 *     2. Group the school's nodes by their `chain` property
 *     3. Divide the school's angular wedge into equal sub-arcs (one per chain)
 *     4. Within each chain's sub-arc, lay out spells sequentially outward
 *     5. Connect school root -> chain roots with short links
 *
 *   FLAT mode:
 *     1. Divide the school's width into parallel columns
 *     2. Each chain gets one column
 *     3. Spells laid out top-to-bottom within each column
 *
 * Usage:
 *   var result = OracleLayout.layoutAllSchools(treeData, baseData, settings);
 *   // result.schools["Destruction"] => { nodes: [...], color: "#C85050" }
 *
 * Depends on: state.js (state.lastSpellData for spell lookups)
 */

var OracleLayout = {

    _seed: 0,

    // ---- PUBLIC API ---------------------------------------------------------

    /**
     * Layout all schools with parallel chain lanes.
     *
     * @param {Object} treeData - { schools: { name: { root, nodes[], chains[] } } }
     * @param {Object} baseData - Output from TreePreview.getOutput()
     * @param {Object} settings - Oracle settings (chaos, chainStyle, etc.)
     * @returns {{ schools: Object }} Same format as ClassicLayout
     */
    layoutAllSchools: function (treeData, baseData, settings) {
        var result = { schools: {} };
        if (!treeData || !treeData.schools || !baseData) return result;

        var ls = settings || {};
        var mode = baseData.mode || 'sun';
        var grid = baseData.grid;
        var baseSchools = baseData.schools || [];
        var rootNodes = baseData.rootNodes || [];
        var tierSpacing = grid ? (grid.tierSpacing || grid.spacing || 30) : 30;
        var ringRadius = grid ? (grid.ringRadius || ((grid.ringTier || 3) * tierSpacing)) : 90;

        // Count total schools for angular wedge calculation
        var schoolNames = [];
        for (var sn in treeData.schools) {
            if (treeData.schools.hasOwnProperty(sn)) schoolNames.push(sn);
        }
        var numSchools = schoolNames.length;
        var sliceAngle = numSchools > 0 ? (Math.PI * 2) / numSchools : Math.PI / 3;

        console.log('[OracleLayout] mode=' + mode + ' schools=' + numSchools +
            ' tierSpacing=' + tierSpacing + ' ringRadius=' + ringRadius);

        for (var si = 0; si < schoolNames.length; si++) {
            var schoolName = schoolNames[si];
            var schoolTree = treeData.schools[schoolName];
            if (!schoolTree || !schoolTree.nodes || schoolTree.nodes.length === 0) continue;

            // Find school info from baseData
            var schoolInfo = null;
            for (var bi = 0; bi < baseSchools.length; bi++) {
                if (baseSchools[bi].name === schoolName) { schoolInfo = baseSchools[bi]; break; }
            }
            if (!schoolInfo) {
                console.warn('[OracleLayout] No baseSchool match for "' + schoolName + '"');
                continue;
            }

            // Find root nodes for this school
            var schoolRoots = [];
            for (var ri = 0; ri < rootNodes.length; ri++) {
                if (rootNodes[ri].school === schoolName) schoolRoots.push(rootNodes[ri]);
            }
            if (schoolRoots.length === 0) {
                console.warn('[OracleLayout] No rootNodes for "' + schoolName + '"');
                continue;
            }

            // Get growth direction from first root
            var growDir = schoolRoots[0].dir || 0;

            // Layout the school
            var positioned;
            if (mode === 'flat') {
                positioned = this._layoutFlat(schoolTree, schoolInfo, schoolRoots, tierSpacing, ringRadius, ls);
            } else {
                positioned = this._layoutSun(schoolTree, schoolInfo, schoolRoots, tierSpacing, ringRadius, growDir, sliceAngle, ls);
            }

            result.schools[schoolName] = {
                nodes: positioned,
                color: schoolInfo.color || '#888888'
            };

            console.log('[OracleLayout] ' + schoolName + ': ' + positioned.length +
                ' nodes in ' + this._countChains(schoolTree) + ' chains');
        }

        return result;
    },

    // ---- SUN MODE LAYOUT ----------------------------------------------------

    /**
     * Radial parallel-lane layout for SUN mode.
     * Divides the school's angular wedge into sub-arcs per chain,
     * places spells sequentially outward from center along each sub-arc.
     */
    _layoutSun: function (schoolTree, schoolInfo, schoolRoots, tierSpacing, ringRadius, growDir, sliceAngle, settings) {
        var positioned = [];
        var spells = this._getSpellData();
        var spellMap = this._buildSpellMap(spells);
        var nodeLookup = this._buildNodeLookup(schoolTree.nodes);

        // Group nodes by chain
        var chainGroups = this._groupByChain(schoolTree.nodes);
        var chainNames = Object.keys(chainGroups);
        var numChains = chainNames.length;

        if (numChains === 0) return positioned;

        // Place school root at the root position
        var rootFormId = schoolTree.root;
        var rootNode = nodeLookup[rootFormId];
        var schoolRootX = schoolRoots[0].x;
        var schoolRootY = schoolRoots[0].y;

        if (rootNode) {
            var rootSpell = spellMap[rootFormId] || null;
            positioned.push({
                formId: rootFormId,
                name: rootSpell ? rootSpell.name : rootFormId,
                x: schoolRootX,
                y: schoolRootY,
                schoolColor: schoolInfo.color || '#888888',
                skillLevel: rootSpell ? rootSpell.skillLevel : '',
                tier: rootNode.tier || 0,
                theme: rootNode.theme || '',
                chain: rootNode.chain || '',
                children: rootNode.children || [],
                parentId: null,
                parentFormId: null,
                isRoot: true
            });
        }

        // Compute angular sub-arcs for each chain
        var halfSlice = sliceAngle * 0.40; // use 80% of the wedge to leave gaps
        var arcStart = growDir - halfSlice;
        var arcStep = numChains > 1 ? (halfSlice * 2) / (numChains - 1) : 0;

        for (var ci = 0; ci < chainNames.length; ci++) {
            var chainName = chainNames[ci];
            var chainNodes = chainGroups[chainName];
            var chainAngle = numChains > 1 ? arcStart + arcStep * ci : growDir;

            // Sort chain nodes by tier/depth for sequential placement
            chainNodes.sort(function (a, b) {
                return (a.tier || 0) - (b.tier || 0);
            });

            // Place chain root (first node in chain) near the school root
            var chainDirX = Math.cos(chainAngle);
            var chainDirY = Math.sin(chainAngle);

            // Starting distance: just outside the ring
            var startDist = ringRadius + tierSpacing * 0.5;

            for (var ni = 0; ni < chainNodes.length; ni++) {
                var node = chainNodes[ni];
                if (node.formId === rootFormId) continue; // already placed

                var dist = startDist + ni * tierSpacing;
                var nx = chainDirX * dist;
                var ny = chainDirY * dist;

                var nSpell = spellMap[node.formId] || null;

                // Determine parent: previous node in chain, or school root for first
                var parentFormId;
                if (ni === 0) {
                    parentFormId = rootFormId;
                } else {
                    parentFormId = chainNodes[ni - 1].formId;
                    // Skip if previous was the school root
                    if (parentFormId === rootFormId && ni > 0) {
                        parentFormId = chainNodes[ni - 1].formId;
                    }
                }

                positioned.push({
                    formId: node.formId,
                    name: nSpell ? nSpell.name : node.formId,
                    x: nx,
                    y: ny,
                    schoolColor: schoolInfo.color || '#888888',
                    skillLevel: nSpell ? nSpell.skillLevel : '',
                    tier: node.tier || 0,
                    theme: node.theme || '',
                    chain: chainName,
                    children: node.children || [],
                    parentId: parentFormId,
                    parentFormId: parentFormId,
                    isRoot: false
                });
            }
        }

        return positioned;
    },

    // ---- FLAT MODE LAYOUT ---------------------------------------------------

    /**
     * Parallel column layout for FLAT mode.
     * Divides the school's horizontal width into columns, one per chain.
     * Spells are laid out top-to-bottom within each column.
     */
    _layoutFlat: function (schoolTree, schoolInfo, schoolRoots, tierSpacing, ringRadius, settings) {
        var positioned = [];
        var spells = this._getSpellData();
        var spellMap = this._buildSpellMap(spells);
        var nodeLookup = this._buildNodeLookup(schoolTree.nodes);

        // Group nodes by chain
        var chainGroups = this._groupByChain(schoolTree.nodes);
        var chainNames = Object.keys(chainGroups);
        var numChains = chainNames.length;

        if (numChains === 0) return positioned;

        // Place school root
        var rootFormId = schoolTree.root;
        var rootNode = nodeLookup[rootFormId];
        var schoolRootX = schoolRoots[0].x;
        var schoolRootY = schoolRoots[0].y;

        if (rootNode) {
            var rootSpell = spellMap[rootFormId] || null;
            positioned.push({
                formId: rootFormId,
                name: rootSpell ? rootSpell.name : rootFormId,
                x: schoolRootX,
                y: schoolRootY,
                schoolColor: schoolInfo.color || '#888888',
                skillLevel: rootSpell ? rootSpell.skillLevel : '',
                tier: rootNode.tier || 0,
                theme: rootNode.theme || '',
                chain: rootNode.chain || '',
                children: rootNode.children || [],
                parentId: null,
                parentFormId: null,
                isRoot: true
            });
        }

        // Determine column layout: spread chains across school's horizontal space
        var columnSpacing = tierSpacing * 1.5;
        var totalWidth = (numChains - 1) * columnSpacing;
        var startX = schoolRootX - totalWidth / 2;

        for (var ci = 0; ci < chainNames.length; ci++) {
            var chainName = chainNames[ci];
            var chainNodes = chainGroups[chainName];

            // Sort chain nodes by tier for sequential placement
            chainNodes.sort(function (a, b) {
                return (a.tier || 0) - (b.tier || 0);
            });

            var colX = startX + ci * columnSpacing;
            var startY = schoolRootY + tierSpacing;

            for (var ni = 0; ni < chainNodes.length; ni++) {
                var node = chainNodes[ni];
                if (node.formId === rootFormId) continue;

                var nx = colX;
                var ny = startY + ni * tierSpacing;

                var nSpell = spellMap[node.formId] || null;

                var parentFormId;
                if (ni === 0) {
                    parentFormId = rootFormId;
                } else {
                    parentFormId = chainNodes[ni - 1].formId;
                }

                positioned.push({
                    formId: node.formId,
                    name: nSpell ? nSpell.name : node.formId,
                    x: nx,
                    y: ny,
                    schoolColor: schoolInfo.color || '#888888',
                    skillLevel: nSpell ? nSpell.skillLevel : '',
                    tier: node.tier || 0,
                    theme: node.theme || '',
                    chain: chainName,
                    children: node.children || [],
                    parentId: parentFormId,
                    parentFormId: parentFormId,
                    isRoot: false
                });
            }
        }

        return positioned;
    },

    // ---- HELPERS -------------------------------------------------------------

    /**
     * Group school nodes by their `chain` property.
     * Nodes without a chain property are assigned to '_default'.
     *
     * @param {Array} nodes - Array of tree nodes
     * @returns {Object} chainName -> [nodes]
     */
    _groupByChain: function (nodes) {
        var groups = {};
        for (var i = 0; i < nodes.length; i++) {
            var chainName = nodes[i].chain || '_default';
            if (!groups[chainName]) groups[chainName] = [];
            groups[chainName].push(nodes[i]);
        }
        return groups;
    },

    /**
     * Count the number of distinct chains in a school tree.
     *
     * @param {Object} schoolTree - { nodes[], chains[], root }
     * @returns {number}
     */
    _countChains: function (schoolTree) {
        if (schoolTree.chains) return schoolTree.chains.length;
        var seen = {};
        var count = 0;
        var nodes = schoolTree.nodes || [];
        for (var i = 0; i < nodes.length; i++) {
            var c = nodes[i].chain || '_default';
            if (!seen[c]) { seen[c] = true; count++; }
        }
        return count;
    },

    /**
     * Build a lane position array from layout data for a school.
     * Used by OracleRenderer.renderChainLanes.
     *
     * @param {Array} positioned - Positioned nodes for one school
     * @returns {Array} Array of { startX, startY, endX, endY, width, chainName }
     */
    buildLanePositions: function (positioned) {
        if (!positioned || positioned.length === 0) return [];

        // Group by chain
        var chainNodes = {};
        for (var i = 0; i < positioned.length; i++) {
            var n = positioned[i];
            var chain = n.chain || '_default';
            if (!chainNodes[chain]) chainNodes[chain] = [];
            chainNodes[chain].push(n);
        }

        var lanes = [];
        for (var chainName in chainNodes) {
            if (!chainNodes.hasOwnProperty(chainName)) continue;
            var nodes = chainNodes[chainName];
            if (nodes.length < 2) continue;

            // Find the bounding extent of the chain
            var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (var ni = 0; ni < nodes.length; ni++) {
                if (nodes[ni].x < minX) minX = nodes[ni].x;
                if (nodes[ni].x > maxX) maxX = nodes[ni].x;
                if (nodes[ni].y < minY) minY = nodes[ni].y;
                if (nodes[ni].y > maxY) maxY = nodes[ni].y;
            }

            // Extend slightly past the endpoints for visual padding
            var dx = maxX - minX;
            var dy = maxY - minY;
            var len = Math.sqrt(dx * dx + dy * dy);
            var pad = len > 0 ? 8 : 0;
            var dirX = len > 0 ? dx / len : 0;
            var dirY = len > 0 ? dy / len : 1;

            lanes.push({
                startX: minX - dirX * pad,
                startY: minY - dirY * pad,
                endX: maxX + dirX * pad,
                endY: maxY + dirY * pad,
                width: 14,
                chainName: chainName
            });
        }

        return lanes;
    },

    /**
     * Build a chain metadata array from tree data for a school.
     * Used by OracleRenderer for lane rendering and narrative labels.
     *
     * @param {Object} schoolTree - { nodes[], chains[], root }
     * @param {string} schoolColor - Base school hex color
     * @returns {Array} Array of { name, narrative, nodes[], color }
     */
    buildChainMeta: function (schoolTree, schoolColor) {
        if (!schoolTree) return [];

        // If the Python output includes explicit chains metadata, use it
        if (schoolTree.chains && schoolTree.chains.length > 0) {
            var meta = [];
            for (var i = 0; i < schoolTree.chains.length; i++) {
                var c = schoolTree.chains[i];
                meta.push({
                    name: c.name || ('Chain ' + (i + 1)),
                    narrative: c.narrative || '',
                    nodes: c.nodes || [],
                    color: this._varyColor(schoolColor, i, schoolTree.chains.length)
                });
            }
            return meta;
        }

        // Fallback: derive chains from node chain properties
        var groups = this._groupByChain(schoolTree.nodes || []);
        var chainNames = Object.keys(groups);
        var result = [];
        for (var ci = 0; ci < chainNames.length; ci++) {
            var name = chainNames[ci];
            result.push({
                name: name === '_default' ? 'Main' : name,
                narrative: '',
                nodes: groups[name],
                color: this._varyColor(schoolColor, ci, chainNames.length)
            });
        }
        return result;
    },

    /**
     * Produce a slightly varied hue from a base school color for each chain.
     *
     * @param {string} hexColor - Base "#RRGGBB" color
     * @param {number} index - Chain index
     * @param {number} total - Total number of chains
     * @returns {string} Varied hex color
     */
    _varyColor: function (hexColor, index, total) {
        if (!hexColor || total <= 1) return hexColor || '#888888';

        // Parse hex
        var hex = hexColor.replace('#', '');
        if (hex.length === 3) {
            hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        }
        var r = parseInt(hex.substring(0, 2), 16);
        var g = parseInt(hex.substring(2, 4), 16);
        var b = parseInt(hex.substring(4, 6), 16);

        // Shift hue slightly per chain index
        var shift = ((index / total) - 0.5) * 40; // +/- 20 in RGB space
        r = Math.max(0, Math.min(255, Math.round(r + shift)));
        g = Math.max(0, Math.min(255, Math.round(g - shift * 0.5)));
        b = Math.max(0, Math.min(255, Math.round(b + shift * 0.3)));

        var toHex = function (v) {
            var h = v.toString(16);
            return h.length < 2 ? '0' + h : h;
        };
        return '#' + toHex(r) + toHex(g) + toHex(b);
    },

    _buildNodeLookup: function (nodes) {
        var lookup = {};
        if (!nodes) return lookup;
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

    _buildSpellMap: function (spells) {
        var map = {};
        if (!spells) return map;
        for (var i = 0; i < spells.length; i++) {
            if (spells[i].formId) map[spells[i].formId] = spells[i];
        }
        return map;
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

console.log('[OracleLayout] Loaded');
