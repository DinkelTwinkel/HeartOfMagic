/**
 * Tree Preview — SUN Mode
 *
 * Root base settings and renderer for the SUN (radial/wheel) layout.
 * Grid rendering is delegated to pluggable grid modules (Naive, Linear,
 * Equal Area, Fibonacci) that register via registerGrid().
 * The root ring sits on a specific tier. School root nodes are placed
 * centered within their arc sections.
 *
 * Self-registers with TreePreview via registerMode().
 *
 * Depends on: treePreviewUtils.js (drag inputs), treePreview.js (registers into it)
 * Grid modules: sunGridLinear.js, sunGridEqualArea.js, sunGridFibonacci.js
 */

var TreePreviewSun = {

    settings: {
        ringTier: 3,
        nodeSize: 8,
        rootsPerSchool: 1,
        gridDensity: 10,
        tierDensity: 5,
        rootClumping: 0,
        rootRandomness: 0,
        gridType: 'naive',
        proportional: false,
        invertGrowth: false
    },

    // Pluggable grid renderers
    _grids: {},
    _gridOrder: ['naive', 'linear', 'equalArea', 'fibonacci', 'square'],

    // Grid point cache (avoids recomputing KNN every frame)
    _gridPointCache: null,
    _gridPointCacheKey: '',

    // Offscreen canvas cache (avoids redrawing thousands of dots every frame)
    _gridCanvas: null,
    _gridCanvasKey: '',
    _gridCanvasW: 0,
    _gridCanvasH: 0,

    registerGrid: function(name, module) {
        this._grids[name] = module;
        console.log('[TreePreviewSun] Registered grid: ' + name);
    },

    // School colors matching CSS variables
    _schoolColors: {
        'Destruction': '#C85050',
        'Restoration': '#C8B850',
        'Alteration': '#50A868',
        'Conjuration': '#9068C8',
        'Illusion': '#5098C8'
    },

    /**
     * Build the settings panel HTML for SUN mode
     */
    buildSettingsHTML: function() {
        var s = this.settings;
        var H = TreePreviewUtils.settingHTML;
        return '' +
            '<div class="tree-preview-settings-title">' + t('preview.sun.title') + '</div>' +

            // --- Toggles at top ---
            '<div class="tree-preview-setting">' +
                '<label class="tree-preview-label">' + t('preview.sun.gridType') + '</label>' +
                '<div class="tree-preview-toggle-row tree-preview-toggle-wrap">' +
                    '<button class="tree-preview-toggle-btn' + (s.gridType === 'naive' ? ' active' : '') + '" ' +
                        'id="tpSunGridNaive" data-grid="naive">' + t('preview.sun.naive') + '</button>' +
                    '<button class="tree-preview-toggle-btn' + (s.gridType === 'linear' ? ' active' : '') + '" ' +
                        'id="tpSunGridLinear" data-grid="linear">' + t('preview.sun.linear') + '</button>' +
                    '<button class="tree-preview-toggle-btn' + (s.gridType === 'equalArea' ? ' active' : '') + '" ' +
                        'id="tpSunGridEqArea" data-grid="equalArea">' + t('preview.sun.equalArea') + '</button>' +
                    '<button class="tree-preview-toggle-btn' + (s.gridType === 'fibonacci' ? ' active' : '') + '" ' +
                        'id="tpSunGridFib" data-grid="fibonacci">' + t('preview.sun.fibonacci') + '</button>' +
                    '<button class="tree-preview-toggle-btn' + (s.gridType === 'square' ? ' active' : '') + '" ' +
                        'id="tpSunGridSquare" data-grid="square">' + t('preview.sun.square') + '</button>' +
                '</div>' +
            '</div>' +

            '<div class="tree-preview-setting">' +
                '<label class="tree-preview-label">' + t('preview.sectionSplit') + '</label>' +
                '<div class="tree-preview-toggle-row">' +
                    '<button class="tree-preview-toggle-btn' + (!s.proportional ? ' active' : '') + '" ' +
                        'id="tpSunSplitEqual">' + t('preview.equal') + '</button>' +
                    '<button class="tree-preview-toggle-btn' + (s.proportional ? ' active' : '') + '" ' +
                        'id="tpSunSplitProp">' + t('preview.proportional') + '</button>' +
                '</div>' +
            '</div>' +

            '<div class="tree-preview-setting">' +
                '<label class="tree-preview-label">' + t('preview.growthDirection') + '</label>' +
                '<div class="tree-preview-toggle-row tree-preview-toggle-wrap">' +
                    '<button class="tree-preview-toggle-btn' + (!s.invertGrowth ? ' active' : '') + '" ' +
                        'id="tpSunGrowNormal">' + t('preview.sun.outward') + '</button>' +
                    '<button class="tree-preview-toggle-btn' + (s.invertGrowth ? ' active' : '') + '" ' +
                        'id="tpSunGrowInvert">' + t('preview.sun.inward') + '</button>' +
                '</div>' +
            '</div>' +

            // --- Numeric inputs in responsive grid ---
            '<div class="tree-preview-settings-grid">' +
                H(t('preview.sun.ringTier'), 'tpSunRingTier', 1, 9999, 1, s.ringTier) +
                H(t('preview.nodeSize'), 'tpSunNodeSize', 1, 9999, 1, s.nodeSize) +
                H(t('preview.rootsPerSchool'), 'tpSunRoots', 1, 9999, 1, s.rootsPerSchool) +
                H(t('preview.sun.spokeDensity'), 'tpSunGrid', 5, 9999, 5, s.gridDensity) +
                H(t('preview.sun.tierDensity'), 'tpSunTiers', 5, 9999, 5, s.tierDensity) +
                H(t('preview.clumping'), 'tpSunClump', 0, 100, 1, s.rootClumping, '%') +
                H(t('preview.randomness'), 'tpSunRand', 0, 100, 1, s.rootRandomness, '%') +
            '</div>';
    },

    /**
     * Bind change events to settings inputs
     */
    bindEvents: function() {
        var self = this;
        var B = TreePreviewUtils.bindInput;
        var dirty = function() { if (typeof TreePreview !== 'undefined') TreePreview._markDirty(); };

        B('tpSunRingTier', function(v) { self.settings.ringTier = v; dirty(); });
        B('tpSunNodeSize', function(v) { self.settings.nodeSize = v; dirty(); });
        B('tpSunRoots', function(v) { self.settings.rootsPerSchool = v; dirty(); });
        B('tpSunGrid', function(v) { self.settings.gridDensity = v; dirty(); });
        B('tpSunTiers', function(v) { self.settings.tierDensity = v; dirty(); });
        B('tpSunClump', function(v) { self.settings.rootClumping = v; dirty(); });
        B('tpSunRand', function(v) { self.settings.rootRandomness = v; dirty(); });

        // Growth direction toggle
        var growBtnIds = ['tpSunGrowNormal', 'tpSunGrowInvert'];
        growBtnIds.forEach(function(btnId) {
            var btn = document.getElementById(btnId);
            if (!btn) return;
            btn.addEventListener('click', function() {
                self.settings.invertGrowth = (btnId === 'tpSunGrowInvert');
                growBtnIds.forEach(function(id) {
                    var b = document.getElementById(id);
                    if (b) b.classList.remove('active');
                });
                this.classList.add('active');
                if (typeof TreePreview !== 'undefined') TreePreview._markDirty();
            });
        });

        // Grid type toggle
        var gridBtnIds = ['tpSunGridNaive', 'tpSunGridLinear', 'tpSunGridEqArea', 'tpSunGridFib', 'tpSunGridSquare'];
        gridBtnIds.forEach(function(btnId) {
            var btn = document.getElementById(btnId);
            if (!btn) return;
            btn.addEventListener('click', function() {
                self.settings.gridType = this.getAttribute('data-grid');
                gridBtnIds.forEach(function(id) {
                    var b = document.getElementById(id);
                    if (b) b.classList.remove('active');
                });
                this.classList.add('active');
                if (typeof TreePreview !== 'undefined') TreePreview._markDirty();
            });
        });

        // Section split toggle
        var btnEqual = document.getElementById('tpSunSplitEqual');
        var btnProp = document.getElementById('tpSunSplitProp');
        if (btnEqual) {
            btnEqual.addEventListener('click', function() {
                self.settings.proportional = false;
                btnEqual.classList.add('active');
                if (btnProp) btnProp.classList.remove('active');
                if (typeof TreePreview !== 'undefined') TreePreview._markDirty();
            });
        }
        if (btnProp) {
            btnProp.addEventListener('click', function() {
                self.settings.proportional = true;
                btnProp.classList.add('active');
                if (btnEqual) btnEqual.classList.remove('active');
                if (typeof TreePreview !== 'undefined') TreePreview._markDirty();
            });
        }
    },

    /**
     * Render the SUN radial grid and root ring onto the canvas.
     * Delegates grid drawing to the active grid module, or uses built-in naive grid.
     */
    render: function(ctx, w, h, schoolData) {
        var s = this.settings;
        var cx = w / 2;
        var cy = h / 2;
        var schools = Object.keys(schoolData || {});
        if (schools.length === 0) schools = Object.keys(this._schoolColors);
        var schoolCount = schools.length;

        var spokes = s.gridDensity;
        var tiers = s.tierDensity;

        // Tier spacing scales to keep things fitting nicely
        var tierSpacing = Math.min(40, 250 / tiers);
        var ringRadius = s.ringTier * tierSpacing;
        var maxExtent = Math.sqrt(w * w + h * h) * 3;

        // --- Calculate school arcs early (needed for grid point coloring) ---
        var totalAngle = Math.PI * 2;
        var arcSizes = [];
        var arcStarts = [];

        if (schoolCount > 0) {
            if (s.proportional && schoolData) {
                var totalSpells = 0;
                for (var si = 0; si < schoolCount; si++) {
                    totalSpells += (schoolData[schools[si]] || 1);
                }
                for (var si2 = 0; si2 < schoolCount; si2++) {
                    arcSizes.push(totalAngle * (schoolData[schools[si2]] || 1) / totalSpells);
                }
            } else {
                var equalArc = totalAngle / schoolCount;
                for (var si3 = 0; si3 < schoolCount; si3++) {
                    arcSizes.push(equalArc);
                }
            }
            // Offset so first school is centered at the top (-π/2)
            var cumAngle = -Math.PI / 2 - arcSizes[0] / 2;
            for (var ai = 0; ai < schoolCount; ai++) {
                arcStarts.push(((cumAngle % totalAngle) + totalAngle) % totalAngle);
                cumAngle += arcSizes[ai];
            }
        }

        // Build school-colored point function for grid modules
        var schoolRgba = [];
        for (var ci = 0; ci < schoolCount; ci++) {
            schoolRgba.push(this._hexToRgba(this._schoolColors[schools[ci]] || '#888888', 0.25));
        }

        var pointColorFn = schoolCount > 0 ? function(angle) {
            var a = ((angle % totalAngle) + totalAngle) % totalAngle;
            for (var pi = 0; pi < schoolCount; pi++) {
                var start = arcStarts[pi];
                var end = start + arcSizes[pi];
                if (end > totalAngle) {
                    // Arc wraps around 2π
                    if (a >= start || a < end - totalAngle) return schoolRgba[pi];
                } else {
                    if (a >= start && a < end) return schoolRgba[pi];
                }
            }
            return schoolRgba[schoolCount - 1];
        } : null;

        // Cache for getGridData()
        this._lastRenderData = {
            schools: schools,
            arcStarts: arcStarts,
            arcSizes: arcSizes,
            tierSpacing: tierSpacing,
            ringRadius: ringRadius,
            spokes: spokes,
            tiers: tiers
        };

        // --- Draw grid (delegate or built-in naive) ---
        // Cap dot count for expensive grids
        var isExpensiveGrid = (s.gridType === 'fibonacci' || s.gridType === 'equalArea');
        var gridOpts = {
            tierSpacing: tierSpacing,
            ringTier: s.ringTier,
            ringRadius: ringRadius,
            spokes: spokes,
            tiers: tiers,
            maxExtent: maxExtent,
            pointColorFn: pointColorFn,
            maxDots: isExpensiveGrid ? 5000 : 20000
        };

        // Render grid directly (batched paths, no offscreen canvas needed)
        var gridModule = this._grids[s.gridType];
        if (gridModule && typeof gridModule.renderGrid === 'function') {
            gridModule.renderGrid(ctx, cx, cy, gridOpts);
        } else {
            this._renderNaiveGrid(ctx, cx, cy, gridOpts);
        }
        // Clean up old offscreen canvas from previous caching approach
        if (this._gridCanvas) { this._gridCanvas = null; this._gridCacheKey = null; }

        // Collect grid point positions for downstream modules (cached)
        var gpCacheKey = s.gridType + '|' + spokes + '|' + tiers + '|' + tierSpacing + '|' +
            schoolCount + '|' + (s.proportional ? 1 : 0) + '|' + (s.invertGrowth ? 1 : 0);
        if (this._gridPointCache && this._gridPointCacheKey === gpCacheKey) {
            this._lastRenderData.gridPoints = this._gridPointCache;
        } else {
            this._lastRenderData.gridPoints = this._collectGridPoints(
                s.gridType, gridOpts, schools, arcStarts, arcSizes
            );
            this._gridPointCache = this._lastRenderData.gridPoints;
            this._gridPointCacheKey = gpCacheKey;
        }

        if (schoolCount === 0) return;

        // --- School divider spokes + root nodes + labels ---
        var arcStart = -Math.PI / 2 - arcSizes[0] / 2;
        var rootNodes = [];

        for (var i = 0; i < schoolCount; i++) {
            var school = schools[i];
            var color = this._schoolColors[school] || '#888888';
            var arcSize = arcSizes[i];

            // School divider spoke (slightly brighter, extends to edge)
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(
                cx + Math.cos(arcStart) * maxExtent,
                cy + Math.sin(arcStart) * maxExtent
            );
            ctx.strokeStyle = 'rgba(184, 168, 120, 0.2)';
            ctx.lineWidth = 1;
            ctx.stroke();

            // Place roots within this school's arc on the ring tier
            var roots = s.rootsPerSchool;
            var clumpF = s.rootClumping / 100;
            var randF = s.rootRandomness / 100;
            for (var j = 0; j < roots; j++) {
                var tEven = (j + 0.5) / roots;
                var t = tEven + (0.5 - tEven) * clumpF;
                if (randF > 0) {
                    var rnd = this._pseudoRandom(i * 17 + j * 31);
                    t = t + (rnd - 0.5) * randF * (1 / Math.max(1, roots));
                }
                t = Math.max(0.02, Math.min(0.98, t));
                var nodeAngle = arcStart + t * arcSize;
                var nx = cx + Math.cos(nodeAngle) * ringRadius;
                var ny = cy + Math.sin(nodeAngle) * ringRadius;

                // Growth direction: outward (default) or inward (inverted)
                var dirAngle = s.invertGrowth ? nodeAngle + Math.PI : nodeAngle;

                rootNodes.push({ x: nx - cx, y: ny - cy, school: school, color: color, dir: dirAngle, rootIndex: j });

                // Node glow
                ctx.beginPath();
                ctx.arc(nx, ny, s.nodeSize + 3, 0, Math.PI * 2);
                ctx.fillStyle = this._hexToRgba(color, 0.15);
                ctx.fill();

                // Node body
                ctx.beginPath();
                ctx.arc(nx, ny, s.nodeSize, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.fill();

                // Node border
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
                ctx.lineWidth = 1;
                ctx.stroke();

                // Growth direction arrow
                this._drawArrow(ctx, nx, ny, dirAngle, s.nodeSize, color);
            }

            // School label at center of arc, just outside the root ring
            var labelAngle = arcStart + arcSize / 2;
            var labelDist = ringRadius + 25;
            var lx = cx + Math.cos(labelAngle) * labelDist;
            var ly = cy + Math.sin(labelAngle) * labelDist;

            ctx.save();
            ctx.translate(lx, ly);
            var textAngle = labelAngle;
            if (textAngle > Math.PI / 2 && textAngle < Math.PI * 1.5) {
                textAngle += Math.PI;
            }
            ctx.rotate(textAngle);
            ctx.font = '10px sans-serif';
            ctx.fillStyle = 'rgba(184, 168, 120, 0.7)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(school, 0, 0);
            ctx.restore();

            arcStart += arcSize;
        }

        this._lastRenderData.rootNodes = rootNodes;
    },

    /**
     * Collect all grid point positions (matching the active grid module's layout).
     * Each point: { x, y, school }  (coords relative to center)
     */
    /**
     * Add K-nearest-neighbor connections to points starting at startIdx.
     * Used for irregular grids (fibonacci, equal area) where structural
     * neighbors can't be pre-computed from ring/spoke indices.
     */
    _addKNNNeighbors: function(points, startIdx, K) {
        var count = points.length - startIdx;
        if (count < 2) return;

        // Bounding box for spatial hash
        var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (var bi = startIdx; bi < points.length; bi++) {
            if (points[bi].x < minX) minX = points[bi].x;
            if (points[bi].x > maxX) maxX = points[bi].x;
            if (points[bi].y < minY) minY = points[bi].y;
            if (points[bi].y > maxY) maxY = points[bi].y;
        }

        // Cell size: ~4 pts per cell on average → 5×5 search gives ~100 candidates
        var area = Math.max(1, (maxX - minX) * (maxY - minY));
        var cellSize = Math.max(1, Math.sqrt(area / count) * 2);

        // Build spatial hash buckets
        var buckets = {};
        for (var gi = startIdx; gi < points.length; gi++) {
            var gcx = Math.floor((points[gi].x - minX) / cellSize);
            var gcy = Math.floor((points[gi].y - minY) / cellSize);
            var gkey = gcx + '_' + gcy;
            if (!buckets[gkey]) buckets[gkey] = [];
            buckets[gkey].push(gi);
        }

        // For each point, find K nearest from nearby cells (5×5 neighborhood)
        var searchRing = 2;
        for (var i = startIdx; i < points.length; i++) {
            var pi = points[i];
            var pcx = Math.floor((pi.x - minX) / cellSize);
            var pcy = Math.floor((pi.y - minY) / cellSize);

            var dists = [];
            for (var dx = -searchRing; dx <= searchRing; dx++) {
                for (var dy = -searchRing; dy <= searchRing; dy++) {
                    var nkey = (pcx + dx) + '_' + (pcy + dy);
                    var bucket = buckets[nkey];
                    if (!bucket) continue;
                    for (var ci = 0; ci < bucket.length; ci++) {
                        var j = bucket[ci];
                        if (i === j) continue;
                        var ddx = pi.x - points[j].x;
                        var ddy = pi.y - points[j].y;
                        dists.push({ idx: j, d: ddx * ddx + ddy * ddy });
                    }
                }
            }

            dists.sort(function(a, b) { return a.d - b.d; });
            var nCount = Math.min(K, dists.length);
            for (var k = 0; k < nCount; k++) {
                pi._neighbors.push(dists[k].idx);
            }
        }
    },

    _collectGridPoints: function(gridType, opts, schools, arcStarts, arcSizes) {
        var points = [];
        var tierSpacing = opts.tierSpacing;
        var spokes = opts.spokes;
        var maxExtent = opts.maxExtent;
        var maxDots = opts.maxDots || 20000;
        var PI2 = Math.PI * 2;
        var schoolCount = schools.length;
        console.log('[TreePreviewSun] _collectGridPoints gridType=' + gridType + ' spokes=' + spokes + ' tierSpacing=' + tierSpacing);

        function getSchool(angle) {
            if (schoolCount === 0) return '';
            var a = ((angle % PI2) + PI2) % PI2;
            for (var i = 0; i < schoolCount; i++) {
                var start = arcStarts[i];
                var end = start + arcSizes[i];
                if (end > PI2) {
                    if (a >= start || a < end - PI2) return schools[i];
                } else {
                    if (a >= start && a < end) return schools[i];
                }
            }
            return schools[schoolCount - 1];
        }

        if (gridType === 'equalArea') {
            var maxRadius = maxExtent;
            var linearDensity = Math.ceil(maxExtent / tierSpacing);
            var totalRings = Math.min(500, linearDensity * 4);
            var ring1R = Math.sqrt(1 / totalRings) * maxRadius;
            var eaBs = (PI2 * ring1R) / Math.max(spokes, 4);
            var ga = Math.PI * (3 - Math.sqrt(5));
            var eaBase = points.length;
            for (var k = 1; k <= totalRings && points.length < maxDots; k++) {
                var eaR = Math.sqrt(k / totalRings) * maxRadius;
                var eaC = PI2 * eaR;
                var eaPc = Math.max(spokes, Math.round(eaC / eaBs));
                var eaAs = PI2 / eaPc;
                var rOff = k * ga;
                for (var ep = 0; ep < eaPc && points.length < maxDots; ep++) {
                    var eaA = ep * eaAs + rOff;
                    points.push({
                        x: Math.cos(eaA) * eaR, y: Math.sin(eaA) * eaR,
                        school: getSchool(eaA),
                        _ptIdx: points.length, _moveDir: eaA, _neighbors: []
                    });
                }
            }
            // KNN neighbors for equal area (irregular structure)
            this._addKNNNeighbors(points, eaBase, 8);
        } else if (gridType === 'fibonacci') {
            var fibGa = Math.PI * (3 - Math.sqrt(5));
            var fibR = maxExtent;
            var fibTiers = Math.ceil(maxExtent / tierSpacing);
            var fibTotal = Math.min(Math.round(0.5 * spokes * fibTiers * fibTiers), maxDots);
            var fibBase = points.length;
            for (var fi = 1; fi <= fibTotal; fi++) {
                var fr = fibR * Math.sqrt(fi / fibTotal);
                var fa = fi * fibGa;
                points.push({
                    x: Math.cos(fa) * fr, y: Math.sin(fa) * fr,
                    school: getSchool(fa),
                    _ptIdx: points.length, _moveDir: fa, _neighbors: []
                });
            }
            // KNN neighbors for fibonacci (spiral, no regular grid)
            this._addKNNNeighbors(points, fibBase, 8);
        } else if (gridType === 'square') {
            // Square grid with 8-connected neighbor pre-computation
            var sqHc = Math.ceil(maxExtent / tierSpacing);
            var sqIdxMap = {}; // "gx,gy" → index
            for (var gx = -sqHc; gx <= sqHc && points.length < maxDots; gx++) {
                for (var gy = -sqHc; gy <= sqHc && points.length < maxDots; gy++) {
                    if (gx === 0 && gy === 0) continue;
                    var sqDx = gx * tierSpacing;
                    var sqDy = gy * tierSpacing;
                    var sqA = Math.atan2(sqDy, sqDx);
                    if (sqA < 0) sqA += PI2;
                    sqIdxMap[gx + ',' + gy] = points.length;
                    points.push({
                        x: sqDx, y: sqDy, school: getSchool(sqA),
                        _ptIdx: points.length, _gx: gx, _gy: gy,
                        _moveDir: sqA, _neighbors: []
                    });
                }
            }
            // 8-connected neighbors
            var sqDirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
            for (var sqi = 0; sqi < points.length; sqi++) {
                var sqPt = points[sqi];
                if (sqPt._gx === undefined) continue;
                for (var sd = 0; sd < sqDirs.length; sd++) {
                    var sqNk = (sqPt._gx + sqDirs[sd][0]) + ',' + (sqPt._gy + sqDirs[sd][1]);
                    if (sqIdxMap[sqNk] !== undefined) {
                        sqPt._neighbors.push(sqIdxMap[sqNk]);
                    }
                }
            }
        } else if (gridType === 'naive') {
            // Naive grid with 8-connected ring/spoke neighbor pre-computation
            console.log('[TreePreviewSun] NAIVE branch: dotsPerRing=' + (spokes * 3));
            var naiveDotsPerRing = spokes * 3;
            var naiveAngleStep = PI2 / naiveDotsPerRing;
            var naiveTotalTiers = Math.ceil(maxExtent / tierSpacing);
            var naiveDotTiers = Math.min(naiveTotalTiers, Math.floor(maxDots / Math.max(1, naiveDotsPerRing)));
            var naiveBase = points.length; // offset for index calculation
            for (var nr = 1; nr <= naiveDotTiers && points.length < maxDots; nr++) {
                var naiveR = nr * tierSpacing;
                for (var ng = 0; ng < naiveDotsPerRing && points.length < maxDots; ng++) {
                    var naiveA = ng * naiveAngleStep;
                    points.push({
                        x: Math.cos(naiveA) * naiveR,
                        y: Math.sin(naiveA) * naiveR,
                        school: getSchool(naiveA),
                        _ptIdx: points.length,
                        _moveDir: naiveA, // radially outward
                        _neighbors: []
                    });
                }
            }
            // Build 8-connected neighbors: ring ±1, spoke ±1
            var dpr = naiveDotsPerRing;
            for (var npi = naiveBase; npi < points.length; npi++) {
                var npt = points[npi];
                var ri = Math.floor((npi - naiveBase) / dpr) + 1; // 1-indexed ring
                var si = (npi - naiveBase) % dpr;
                var prevS = (si - 1 + dpr) % dpr;
                var nextS = (si + 1) % dpr;
                // Same ring: prev/next spoke
                npt._neighbors.push(naiveBase + (ri - 1) * dpr + prevS);
                npt._neighbors.push(naiveBase + (ri - 1) * dpr + nextS);
                // Inner ring (ring - 1)
                if (ri > 1) {
                    npt._neighbors.push(naiveBase + (ri - 2) * dpr + si);
                    npt._neighbors.push(naiveBase + (ri - 2) * dpr + prevS);
                    npt._neighbors.push(naiveBase + (ri - 2) * dpr + nextS);
                }
                // Outer ring (ring + 1)
                if (ri < naiveDotTiers) {
                    npt._neighbors.push(naiveBase + ri * dpr + si);
                    npt._neighbors.push(naiveBase + ri * dpr + prevS);
                    npt._neighbors.push(naiveBase + ri * dpr + nextS);
                }
            }
        } else {
            // Linear (default) — variable dots per ring, with neighbor pre-computation
            var baseSpacing = (PI2 * tierSpacing) / spokes;
            var totalTiers = Math.ceil(maxExtent / tierSpacing);
            var linBase = points.length;
            var linRingStart = []; // ringIndex → start offset in points
            var linRingCount = []; // ringIndex → point count in that ring
            for (var lr = 1; lr <= totalTiers && points.length < maxDots; lr++) {
                var lrR = lr * tierSpacing;
                var lrC = PI2 * lrR;
                var lrPc = Math.max(spokes, Math.round(lrC / baseSpacing));
                var lrAs = PI2 / lrPc;
                linRingStart.push(points.length - linBase);
                linRingCount.push(lrPc);
                for (var lp = 0; lp < lrPc && points.length < maxDots; lp++) {
                    var lrA = lp * lrAs;
                    points.push({
                        x: Math.cos(lrA) * lrR,
                        y: Math.sin(lrA) * lrR,
                        school: getSchool(lrA),
                        _ptIdx: points.length,
                        _moveDir: lrA,
                        _ring: lr - 1, _spoke: lp,
                        _neighbors: []
                    });
                }
            }
            // Neighbors for linear: same ring ±1 spoke, adjacent rings nearest angle
            for (var lni = linBase; lni < points.length; lni++) {
                var lpt = points[lni];
                var lri = lpt._ring;
                var lsi = lpt._spoke;
                var lrc = linRingCount[lri];
                // Same ring neighbors
                lpt._neighbors.push(linBase + linRingStart[lri] + ((lsi - 1 + lrc) % lrc));
                lpt._neighbors.push(linBase + linRingStart[lri] + ((lsi + 1) % lrc));
                // Inner ring: find closest angular match
                if (lri > 0) {
                    var irc = linRingCount[lri - 1];
                    var irBase = linBase + linRingStart[lri - 1];
                    var irMap = Math.round(lsi * irc / lrc);
                    if (irMap >= irc) irMap = irc - 1;
                    lpt._neighbors.push(irBase + irMap);
                    if (irMap > 0) lpt._neighbors.push(irBase + irMap - 1);
                    if (irMap < irc - 1) lpt._neighbors.push(irBase + irMap + 1);
                }
                // Outer ring
                if (lri < linRingCount.length - 1) {
                    var orc = linRingCount[lri + 1];
                    var orBase = linBase + linRingStart[lri + 1];
                    var orMap = Math.round(lsi * orc / lrc);
                    if (orMap >= orc) orMap = orc - 1;
                    lpt._neighbors.push(orBase + orMap);
                    if (orMap > 0) lpt._neighbors.push(orBase + orMap - 1);
                    if (orMap < orc - 1) lpt._neighbors.push(orBase + orMap + 1);
                }
            }
        }

        return points;
    },

    /**
     * Built-in naive grid: fixed angular divisions, same point count per ring
     */
    _renderNaiveGrid: function(ctx, cx, cy, opts) {
        var tierSpacing = opts.tierSpacing;
        var spokes = opts.spokes;
        var maxExtent = opts.maxExtent;
        var ringTier = opts.ringTier;
        var ringRadius = opts.ringRadius;
        var totalTiers = Math.ceil(maxExtent / tierSpacing);
        var angleStep = (Math.PI * 2) / spokes;

        // Concentric tier rings — batch by style
        var innerRings = [];
        var outerRings = [];
        var rootRingR = -1;
        for (var r = 1; r <= totalTiers; r++) {
            var ringR = r * tierSpacing;
            if (r === ringTier) {
                rootRingR = ringR;
            } else if (r < ringTier) {
                innerRings.push(ringR);
            } else {
                outerRings.push(ringR);
            }
        }
        if (outerRings.length > 0) {
            ctx.strokeStyle = 'rgba(184, 168, 120, 0.05)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (var ori = 0; ori < outerRings.length; ori++) { ctx.moveTo(cx + outerRings[ori], cy); ctx.arc(cx, cy, outerRings[ori], 0, Math.PI * 2); }
            ctx.stroke();
        }
        if (innerRings.length > 0) {
            ctx.strokeStyle = 'rgba(184, 168, 120, 0.1)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (var iri = 0; iri < innerRings.length; iri++) { ctx.moveTo(cx + innerRings[iri], cy); ctx.arc(cx, cy, innerRings[iri], 0, Math.PI * 2); }
            ctx.stroke();
        }
        if (rootRingR > 0) {
            ctx.strokeStyle = 'rgba(184, 168, 120, 0.35)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(cx + rootRingR, cy);
            ctx.arc(cx, cy, rootRingR, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Radial spokes — single batched path
        ctx.strokeStyle = 'rgba(184, 168, 120, 0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (var g = 0; g < spokes; g++) {
            var angle = g * angleStep;
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(angle) * maxExtent, cy + Math.sin(angle) * maxExtent);
        }
        ctx.stroke();

        // Grid dots — batch by color for single path per color
        var maxDots = opts.maxDots || 20000;
        var dotsPerRing = spokes * 3;
        var dotAngleStep = (Math.PI * 2) / dotsPerRing;
        var dotTiers = Math.min(totalTiers, Math.floor(maxDots / Math.max(1, dotsPerRing)));
        var naiveBuckets = {};
        for (var g2 = 0; g2 < dotsPerRing; g2++) {
            var dotAngle = g2 * dotAngleStep;
            var cosA = Math.cos(dotAngle);
            var sinA = Math.sin(dotAngle);
            var dotColor = opts.pointColorFn ? opts.pointColorFn(dotAngle) : 'rgba(184, 168, 120, 0.15)';
            if (!naiveBuckets[dotColor]) naiveBuckets[dotColor] = [];
            var nbucket = naiveBuckets[dotColor];
            for (var r2 = 1; r2 <= dotTiers; r2++) {
                var dotR = r2 * tierSpacing;
                nbucket.push(cx + cosA * dotR, cy + sinA * dotR);
            }
        }
        for (var nbColor in naiveBuckets) {
            var nbPts = naiveBuckets[nbColor];
            ctx.fillStyle = nbColor;
            ctx.beginPath();
            for (var nbi = 0; nbi < nbPts.length; nbi += 2) {
                ctx.rect(nbPts[nbi] - 1, nbPts[nbi + 1] - 1, 3, 3);
            }
            ctx.fill();
        }

        // Center dot
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(184, 168, 120, 0.5)';
        ctx.fill();
    },

    /**
     * Draw a direction arrow from node edge outward
     */
    _drawArrow: function(ctx, nx, ny, angle, nodeSize, color) {
        var arrowLen = 16;
        var headLen = 6;
        var headAngle = Math.PI / 6;
        var sx = nx + Math.cos(angle) * (nodeSize + 2);
        var sy = ny + Math.sin(angle) * (nodeSize + 2);
        var ex = sx + Math.cos(angle) * arrowLen;
        var ey = sy + Math.sin(angle) * arrowLen;

        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - Math.cos(angle - headAngle) * headLen, ey - Math.sin(angle - headAngle) * headLen);
        ctx.lineTo(ex - Math.cos(angle + headAngle) * headLen, ey - Math.sin(angle + headAngle) * headLen);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
    },

    /**
     * Deterministic pseudo-random from seed (consistent per frame)
     */
    _pseudoRandom: function(seed) {
        var x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
        return x - Math.floor(x);
    },

    /**
     * Convert hex color to rgba string
     */
    _hexToRgba: function(hex, alpha) { return hexToRgba(hex, alpha); },

    /**
     * Return current settings for external consumption
     */
    getSettings: function() {
        return JSON.parse(JSON.stringify(this.settings));
    },

    /**
     * Return grid data with school assignments for the next build section.
     * Contains school boundaries and grid structure from the last render.
     */
    getGridData: function() {
        var d = this._lastRenderData;
        if (!d) return null;
        var self = this;
        var totalAngle = Math.PI * 2;
        return {
            mode: 'sun',
            gridType: self.settings.gridType,
            gridPoints: d.gridPoints || [],
            grid: {
                spokes: d.spokes,
                tiers: d.tiers,
                tierSpacing: d.tierSpacing,
                ringRadius: d.ringRadius,
                ringTier: self.settings.ringTier
            },
            schools: d.schools.map(function(name, i) {
                var a1 = d.arcStarts[i];
                var a2 = a1 + d.arcSizes[i];
                var r = d.ringRadius;
                return {
                    name: name,
                    color: self._schoolColors[name] || '#888888',
                    arcStart: a1,
                    arcSize: d.arcSizes[i],
                    rootLine: {
                        p1: { x: Math.cos(a1) * r, y: Math.sin(a1) * r },
                        p2: { x: Math.cos(a2) * r, y: Math.sin(a2) * r },
                        angle1: a1,
                        angle2: a2
                    }
                };
            }),
            getSchoolAtAngle: function(angle) {
                var a = ((angle % totalAngle) + totalAngle) % totalAngle;
                for (var i = 0; i < d.schools.length; i++) {
                    var start = d.arcStarts[i];
                    var end = start + d.arcSizes[i];
                    if (end > totalAngle) {
                        if (a >= start || a < end - totalAngle) return d.schools[i];
                    } else {
                        if (a >= start && a < end) return d.schools[i];
                    }
                }
                return d.schools[d.schools.length - 1];
            }
        };
    }
};

// Register grid modules that loaded before us
if (typeof SunGridLinear !== 'undefined') {
    TreePreviewSun.registerGrid('linear', SunGridLinear);
}
if (typeof SunGridEqualArea !== 'undefined') {
    TreePreviewSun.registerGrid('equalArea', SunGridEqualArea);
}
if (typeof SunGridFibonacci !== 'undefined') {
    TreePreviewSun.registerGrid('fibonacci', SunGridFibonacci);
}
if (typeof SunGridSquare !== 'undefined') {
    TreePreviewSun.registerGrid('square', SunGridSquare);
}

// Self-register when TreePreview is available
if (typeof TreePreview !== 'undefined') {
    TreePreview.registerMode('sun', TreePreviewSun);
}
