/**
 * Tree Preview — FLAT Mode
 *
 * Root base settings and renderer for the FLAT (linear) layout.
 * Uses a square grid with equal cell sizes. Line Length controls how
 * many grid points the root line spans. Grid extends beyond the line.
 * School root nodes are placed centered within their sections.
 *
 * Self-registers with TreePreview via registerMode().
 *
 * Depends on: treePreviewUtils.js (drag inputs), treePreview.js (registers into it)
 */

var TreePreviewFlat = {

    settings: {
        linePoints: 20,
        nodeSize: 8,
        rootsPerSchool: 1,
        direction: 'horizontal',
        rootClumping: 0,
        rootRandomness: 0,
        proportional: false,
        invertGrowth: false
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
     * Build the settings panel HTML for FLAT mode
     */
    buildSettingsHTML: function() {
        var s = this.settings;
        var isHoriz = s.direction === 'horizontal';
        var H = TreePreviewUtils.settingHTML;
        return '' +
            '<div class="tree-preview-settings-title">' + t('preview.flat.title') + '</div>' +

            // --- Toggles at top ---
            '<div class="tree-preview-setting">' +
                '<label class="tree-preview-label">' + t('preview.flat.direction') + '</label>' +
                '<div class="tree-preview-toggle-row">' +
                    '<button class="tree-preview-toggle-btn' + (isHoriz ? ' active' : '') + '" ' +
                        'id="tpFlatDirH" data-dir="horizontal">' + t('preview.flat.horizontal') + '</button>' +
                    '<button class="tree-preview-toggle-btn' + (!isHoriz ? ' active' : '') + '" ' +
                        'id="tpFlatDirV" data-dir="vertical">' + t('preview.flat.vertical') + '</button>' +
                '</div>' +
            '</div>' +

            '<div class="tree-preview-setting">' +
                '<label class="tree-preview-label">' + t('preview.sectionSplit') + '</label>' +
                '<div class="tree-preview-toggle-row">' +
                    '<button class="tree-preview-toggle-btn' + (!s.proportional ? ' active' : '') + '" ' +
                        'id="tpFlatSplitEqual">' + t('preview.equal') + '</button>' +
                    '<button class="tree-preview-toggle-btn' + (s.proportional ? ' active' : '') + '" ' +
                        'id="tpFlatSplitProp">' + t('preview.proportional') + '</button>' +
                '</div>' +
            '</div>' +

            '<div class="tree-preview-setting">' +
                '<label class="tree-preview-label">' + t('preview.growthDirection') + '</label>' +
                '<div class="tree-preview-toggle-row tree-preview-toggle-wrap">' +
                    '<button class="tree-preview-toggle-btn' + (!s.invertGrowth ? ' active' : '') + '" ' +
                        'id="tpFlatGrowNormal">' + t('preview.flat.normal') + '</button>' +
                    '<button class="tree-preview-toggle-btn' + (s.invertGrowth ? ' active' : '') + '" ' +
                        'id="tpFlatGrowInvert">' + t('preview.flat.invert') + '</button>' +
                '</div>' +
            '</div>' +

            // --- Numeric inputs in responsive grid ---
            '<div class="tree-preview-settings-grid">' +
                H(t('preview.flat.lineLength'), 'tpFlatLength', 5, 9999, 5, s.linePoints) +
                H(t('preview.nodeSize'), 'tpFlatNodeSize', 1, 9999, 1, s.nodeSize) +
                H(t('preview.rootsPerSchool'), 'tpFlatRoots', 1, 9999, 1, s.rootsPerSchool) +
                H(t('preview.clumping'), 'tpFlatClump', 0, 100, 1, s.rootClumping, '%') +
                H(t('preview.randomness'), 'tpFlatRand', 0, 100, 1, s.rootRandomness, '%') +
            '</div>';
    },

    /**
     * Bind change events to settings controls
     */
    bindEvents: function() {
        var self = this;
        var B = TreePreviewUtils.bindInput;
        var dirty = function() { if (typeof TreePreview !== 'undefined') TreePreview._markDirty(); };

        B('tpFlatLength', function(v) { self.settings.linePoints = v; dirty(); });
        B('tpFlatNodeSize', function(v) { self.settings.nodeSize = v; dirty(); });
        B('tpFlatRoots', function(v) { self.settings.rootsPerSchool = v; dirty(); });
        B('tpFlatClump', function(v) { self.settings.rootClumping = v; dirty(); });
        B('tpFlatRand', function(v) { self.settings.rootRandomness = v; dirty(); });

        // Growth direction toggle
        var growBtnIds = ['tpFlatGrowNormal', 'tpFlatGrowInvert'];
        growBtnIds.forEach(function(btnId) {
            var btn = document.getElementById(btnId);
            if (!btn) return;
            btn.addEventListener('click', function() {
                self.settings.invertGrowth = (btnId === 'tpFlatGrowInvert');
                growBtnIds.forEach(function(id) {
                    var b = document.getElementById(id);
                    if (b) b.classList.remove('active');
                });
                this.classList.add('active');
                if (typeof TreePreview !== 'undefined') TreePreview._markDirty();
            });
        });

        // Direction toggle buttons
        var btnH = document.getElementById('tpFlatDirH');
        var btnV = document.getElementById('tpFlatDirV');
        if (btnH) {
            btnH.addEventListener('click', function() {
                self.settings.direction = 'horizontal';
                btnH.classList.add('active');
                if (btnV) btnV.classList.remove('active');
                if (typeof TreePreview !== 'undefined') TreePreview._markDirty();
            });
        }
        if (btnV) {
            btnV.addEventListener('click', function() {
                self.settings.direction = 'vertical';
                btnV.classList.add('active');
                if (btnH) btnH.classList.remove('active');
                if (typeof TreePreview !== 'undefined') TreePreview._markDirty();
            });
        }

        // Section split toggle
        var btnEqual = document.getElementById('tpFlatSplitEqual');
        var btnProp = document.getElementById('tpFlatSplitProp');
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
     * Render the FLAT square grid and root line onto the canvas.
     * Line Length = number of grid points the line spans.
     * Grid has square cells and extends beyond the root line.
     * Nodes are centered within their school's section.
     */
    render: function(ctx, w, h, schoolData) {
        var s = this.settings;
        var cx = w / 2;
        var cy = h / 2;
        var schools = Object.keys(schoolData || {});
        if (schools.length === 0) schools = Object.keys(this._schoolColors);
        var schoolCount = schools.length;
        var isHoriz = s.direction === 'horizontal';

        // Fixed cell size; line length derived from grid points
        var gridSpacing = 30;
        var lineLength = s.linePoints * gridSpacing;
        var halfLen = lineLength / 2;


        // --- Calculate school segments early (needed for grid point coloring) ---
        var segmentSizes = [];
        var segStarts = [];

        if (schoolCount > 0) {
            if (s.proportional && schoolData) {
                var totalSpells = 0;
                for (var si = 0; si < schoolCount; si++) {
                    totalSpells += (schoolData[schools[si]] || 1);
                }
                for (var si2 = 0; si2 < schoolCount; si2++) {
                    segmentSizes.push(lineLength * (schoolData[schools[si2]] || 1) / totalSpells);
                }
            } else {
                var equalSeg = lineLength / schoolCount;
                for (var si3 = 0; si3 < schoolCount; si3++) {
                    segmentSizes.push(equalSeg);
                }
            }
            var cumLen = -halfLen;
            for (var sgi = 0; sgi < schoolCount; sgi++) {
                segStarts.push(cumLen);
                cumLen += segmentSizes[sgi];
            }
        }

        // Build school color lookup for grid points
        var schoolRgba = [];
        for (var ci = 0; ci < schoolCount; ci++) {
            schoolRgba.push(this._hexToRgba(this._schoolColors[schools[ci]] || '#888888', 0.2));
        }

        // Free any leftover offscreen canvas from previous caching approach
        if (this._gridCanvas) { this._gridCanvas = null; this._gridCacheKey = null; }

        // Rendering dots: reduced for performance (~4K dots vs 20K)
        var renderDotsPerAxis = Math.min(32, Math.ceil(Math.max(w, h) / gridSpacing));
        // Layout dots: full extent for classic layout placement
        var layoutDotsPerAxis = Math.floor((Math.sqrt(20000) - 1) / 2);

        // Cache for getGridData()
        this._lastRenderData = {
            schools: schools,
            segStarts: segStarts,
            segmentSizes: segmentSizes,
            gridSpacing: gridSpacing,
            lineLength: lineLength,
            linePoints: s.linePoints,
            direction: s.direction
        };

        // --- Draw square grid directly (lightweight, no massive offscreen canvas) ---
        // Grid lines: limit to visible area + margin
        var renderExtent = Math.max(w, h) * 1.5;
        var renderGridCount = Math.ceil(renderExtent / gridSpacing);

        // Grid lines: batch by style into single paths
        var alongOn = { b: true };  // "along" lines on the school line
        var alongOff = { b: true }; // "along" lines off the school line
        for (var g = -renderGridCount; g <= renderGridCount; g++) {
            var pos = g * gridSpacing;
            var target = (pos >= -halfLen - 0.5 && pos <= halfLen + 0.5) ? alongOn : alongOff;
            if (!target.p) { target.p = []; }
            if (isHoriz) {
                target.p.push(cx + pos, cy - renderExtent, cx + pos, cy + renderExtent);
            } else {
                target.p.push(cx - renderExtent, cy + pos, cx + renderExtent, cy + pos);
            }
        }
        ctx.lineWidth = 1;
        if (alongOn.p) {
            ctx.strokeStyle = 'rgba(184, 168, 120, 0.06)';
            ctx.beginPath();
            for (var ai = 0; ai < alongOn.p.length; ai += 4) { ctx.moveTo(alongOn.p[ai], alongOn.p[ai+1]); ctx.lineTo(alongOn.p[ai+2], alongOn.p[ai+3]); }
            ctx.stroke();
        }
        if (alongOff.p) {
            ctx.strokeStyle = 'rgba(184, 168, 120, 0.03)';
            ctx.beginPath();
            for (var ao = 0; ao < alongOff.p.length; ao += 4) { ctx.moveTo(alongOff.p[ao], alongOff.p[ao+1]); ctx.lineTo(alongOff.p[ao+2], alongOff.p[ao+3]); }
            ctx.stroke();
        }

        var crossCenter = [];
        var crossOther = [];
        for (var c = -renderGridCount; c <= renderGridCount; c++) {
            var cPos = c * gridSpacing;
            var cTarget = (c === 0) ? crossCenter : crossOther;
            if (isHoriz) {
                cTarget.push(cx - renderExtent, cy + cPos, cx + renderExtent, cy + cPos);
            } else {
                cTarget.push(cx + cPos, cy - renderExtent, cx + cPos, cy + renderExtent);
            }
        }
        if (crossCenter.length > 0) {
            ctx.strokeStyle = 'rgba(184, 168, 120, 0.15)';
            ctx.beginPath();
            for (var ci = 0; ci < crossCenter.length; ci += 4) { ctx.moveTo(crossCenter[ci], crossCenter[ci+1]); ctx.lineTo(crossCenter[ci+2], crossCenter[ci+3]); }
            ctx.stroke();
        }
        if (crossOther.length > 0) {
            ctx.strokeStyle = 'rgba(184, 168, 120, 0.04)';
            ctx.beginPath();
            for (var co = 0; co < crossOther.length; co += 4) { ctx.moveTo(crossOther[co], crossOther[co+1]); ctx.lineTo(crossOther[co+2], crossOther[co+3]); }
            ctx.stroke();
        }

        // Grid dots: batch by color — single path per color instead of individual fillRect
        var dotBuckets = {};
        for (var da = -renderDotsPerAxis; da <= renderDotsPerAxis; da++) {
            var alongPos = da * gridSpacing;
            var colColor = 'rgba(184, 168, 120, 0.08)';
            if (schoolCount > 0 && alongPos >= -halfLen - 0.5 && alongPos <= halfLen + 0.5) {
                for (var dsi = 0; dsi < schoolCount; dsi++) {
                    if (alongPos < segStarts[dsi] + segmentSizes[dsi] + 0.5) {
                        colColor = schoolRgba[dsi];
                        break;
                    }
                }
            }
            if (!dotBuckets[colColor]) dotBuckets[colColor] = [];
            var bucket = dotBuckets[colColor];
            for (var dc = -renderDotsPerAxis; dc <= renderDotsPerAxis; dc++) {
                var crossPos = dc * gridSpacing;
                bucket.push(
                    isHoriz ? cx + alongPos : cx + crossPos,
                    isHoriz ? cy + crossPos : cy + alongPos
                );
            }
        }
        for (var bColor in dotBuckets) {
            var bPts = dotBuckets[bColor];
            ctx.fillStyle = bColor;
            ctx.beginPath();
            for (var bi = 0; bi < bPts.length; bi += 2) {
                ctx.rect(bPts[bi] - 1, bPts[bi + 1] - 1, 3, 3);
            }
            ctx.fill();
        }

        // Collect grid point positions (cached — full extent for layout, not rendering)
        var gpCacheKey = s.linePoints + '|' + s.direction + '|' + schoolCount + '|' +
            (s.proportional ? 1 : 0) + '|' + schools.join(',');
        if (this._gridPointCache && this._gridPointCacheKey === gpCacheKey) {
            this._lastRenderData.gridPoints = this._gridPointCache;
        } else {
            this._lastRenderData.gridPoints = this._collectFlatGridPoints(
                gridSpacing, layoutDotsPerAxis, isHoriz, schools, segStarts, segmentSizes, halfLen
            );
            this._gridPointCache = this._lastRenderData.gridPoints;
            this._gridPointCacheKey = gpCacheKey;
        }

        // --- Draw the root line (on top of grid) ---
        ctx.beginPath();
        if (isHoriz) {
            ctx.moveTo(cx - halfLen, cy);
            ctx.lineTo(cx + halfLen, cy);
        } else {
            ctx.moveTo(cx, cy - halfLen);
            ctx.lineTo(cx, cy + halfLen);
        }
        ctx.strokeStyle = 'rgba(184, 168, 120, 0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Endpoint markers
        ctx.beginPath();
        if (isHoriz) {
            ctx.arc(cx - halfLen, cy, 3, 0, Math.PI * 2);
            ctx.moveTo(cx + halfLen + 3, cy);
            ctx.arc(cx + halfLen, cy, 3, 0, Math.PI * 2);
        } else {
            ctx.arc(cx, cy - halfLen, 3, 0, Math.PI * 2);
            ctx.moveTo(cx + 3, cy + halfLen);
            ctx.arc(cx, cy + halfLen, 3, 0, Math.PI * 2);
        }
        ctx.fillStyle = 'rgba(184, 168, 120, 0.6)';
        ctx.fill();

        if (schoolCount === 0) return;

        // --- Place school root nodes centered in segments ---
        var segStart = -halfLen;
        var rootNodes = [];

        for (var i = 0; i < schoolCount; i++) {
            var school = schools[i];
            var color = this._schoolColors[school] || '#888888';
            var segSize = segmentSizes[i];

            // School segment divider
            if (i > 0) {
                ctx.beginPath();
                if (isHoriz) {
                    ctx.moveTo(cx + segStart, cy - 10);
                    ctx.lineTo(cx + segStart, cy + 10);
                } else {
                    ctx.moveTo(cx - 10, cy + segStart);
                    ctx.lineTo(cx + 10, cy + segStart);
                }
                ctx.strokeStyle = 'rgba(184, 168, 120, 0.3)';
                ctx.lineWidth = 1;
                ctx.stroke();
            }

            // Place roots within this school's segment
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
                var nodePos = segStart + t * segSize;
                var nx = isHoriz ? cx + nodePos : cx;
                var ny = isHoriz ? cy : cy + nodePos;

                // Growth direction: perpendicular to line (default) or inverted
                var dirAngle;
                if (isHoriz) {
                    dirAngle = s.invertGrowth ? Math.PI / 2 : -Math.PI / 2; // up / down
                } else {
                    dirAngle = s.invertGrowth ? Math.PI : 0; // right / left
                }

                rootNodes.push({ x: nx - cx, y: ny - cy, school: school, color: color, dir: dirAngle });

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

            // School label at center of segment
            var labelPos = segStart + segSize / 2;
            ctx.save();
            ctx.font = '10px sans-serif';
            ctx.fillStyle = 'rgba(184, 168, 120, 0.7)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            if (isHoriz) {
                ctx.fillText(school, cx + labelPos, cy - 20);
            } else {
                ctx.translate(cx - 20, cy + labelPos);
                ctx.rotate(-Math.PI / 2);
                ctx.fillText(school, 0, 0);
            }
            ctx.restore();

            segStart += segSize;
        }

        this._lastRenderData.rootNodes = rootNodes;
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
     * Collect all grid point positions for downstream modules.
     * Matches the Cartesian grid dots drawn in render().
     * Each point: { x, y, school } (coords relative to center)
     */
    _collectFlatGridPoints: function(gridSpacing, dotPerAxis, isHoriz, schools, segStarts, segmentSizes, halfLen) {
        var points = [];
        var schoolCount = schools.length;
        var idxMap = {}; // "da,dc" → index for neighbor lookup
        var side = dotPerAxis * 2 + 1;

        for (var da = -dotPerAxis; da <= dotPerAxis; da++) {
            var alongPos = da * gridSpacing;

            // Determine school for this column/row
            var school = '';
            if (schoolCount > 0 && alongPos >= -halfLen - 0.5 && alongPos <= halfLen + 0.5) {
                for (var si = 0; si < schoolCount; si++) {
                    if (alongPos < segStarts[si] + segmentSizes[si] + 0.5) {
                        school = schools[si];
                        break;
                    }
                }
            }

            for (var dc = -dotPerAxis; dc <= dotPerAxis; dc++) {
                var crossPos = dc * gridSpacing;
                var px = isHoriz ? alongPos : crossPos;
                var py = isHoriz ? crossPos : alongPos;
                // Growth direction: perpendicular to baseline (away from root line)
                var mdir = isHoriz ? (dc >= 0 ? Math.PI / 2 : -Math.PI / 2)
                                   : (dc >= 0 ? 0 : Math.PI);
                idxMap[da + ',' + dc] = points.length;
                points.push({
                    x: px, y: py, school: school,
                    _ptIdx: points.length, _moveDir: mdir,
                    _da: da, _dc: dc, _neighbors: []
                });
            }
        }

        // 8-connected neighbors for cartesian flat grid
        var dirs8 = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
        for (var fi = 0; fi < points.length; fi++) {
            var fp = points[fi];
            if (fp._da === undefined) continue;
            for (var d = 0; d < dirs8.length; d++) {
                var nk = (fp._da + dirs8[d][0]) + ',' + (fp._dc + dirs8[d][1]);
                if (idxMap[nk] !== undefined) {
                    fp._neighbors.push(idxMap[nk]);
                }
            }
        }

        return points;
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
        return {
            mode: 'flat',
            gridPoints: d.gridPoints || [],
            grid: {
                spacing: d.gridSpacing,
                lineLength: d.lineLength,
                linePoints: d.linePoints,
                direction: d.direction
            },
            schools: d.schools.map(function(name, i) {
                var isHoriz = d.direction === 'horizontal';
                var s1 = d.segStarts[i];
                var s2 = s1 + d.segmentSizes[i];
                return {
                    name: name,
                    color: self._schoolColors[name] || '#888888',
                    segStart: d.segStarts[i],
                    segSize: d.segmentSizes[i],
                    rootLine: {
                        p1: isHoriz ? { x: s1, y: 0 } : { x: 0, y: s1 },
                        p2: isHoriz ? { x: s2, y: 0 } : { x: 0, y: s2 }
                    }
                };
            }),
            getSchoolAtPosition: function(pos) {
                for (var i = 0; i < d.schools.length; i++) {
                    if (pos < d.segStarts[i] + d.segmentSizes[i]) return d.schools[i];
                }
                return d.schools[d.schools.length - 1];
            }
        };
    }
};

// Self-register when TreePreview is available
if (typeof TreePreview !== 'undefined') {
    TreePreview.registerMode('flat', TreePreviewFlat);
}
