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
            '<div class="tree-preview-settings-title">Root Line Settings</div>' +

            // --- Toggles at top ---
            '<div class="tree-preview-setting">' +
                '<label class="tree-preview-label">Direction</label>' +
                '<div class="tree-preview-toggle-row">' +
                    '<button class="tree-preview-toggle-btn' + (isHoriz ? ' active' : '') + '" ' +
                        'id="tpFlatDirH" data-dir="horizontal">Horizontal</button>' +
                    '<button class="tree-preview-toggle-btn' + (!isHoriz ? ' active' : '') + '" ' +
                        'id="tpFlatDirV" data-dir="vertical">Vertical</button>' +
                '</div>' +
            '</div>' +

            '<div class="tree-preview-setting">' +
                '<label class="tree-preview-label">Section Split</label>' +
                '<div class="tree-preview-toggle-row">' +
                    '<button class="tree-preview-toggle-btn' + (!s.proportional ? ' active' : '') + '" ' +
                        'id="tpFlatSplitEqual">Equal</button>' +
                    '<button class="tree-preview-toggle-btn' + (s.proportional ? ' active' : '') + '" ' +
                        'id="tpFlatSplitProp">Proportional</button>' +
                '</div>' +
            '</div>' +

            '<div class="tree-preview-setting">' +
                '<label class="tree-preview-label">Growth Direction</label>' +
                '<div class="tree-preview-toggle-row tree-preview-toggle-wrap">' +
                    '<button class="tree-preview-toggle-btn' + (!s.invertGrowth ? ' active' : '') + '" ' +
                        'id="tpFlatGrowNormal">Normal</button>' +
                    '<button class="tree-preview-toggle-btn' + (s.invertGrowth ? ' active' : '') + '" ' +
                        'id="tpFlatGrowInvert">Invert</button>' +
                '</div>' +
            '</div>' +

            // --- Numeric inputs in responsive grid ---
            '<div class="tree-preview-settings-grid">' +
                H('Line Length', 'tpFlatLength', 5, 9999, 5, s.linePoints) +
                H('Node Size', 'tpFlatNodeSize', 1, 9999, 1, s.nodeSize) +
                H('Roots / School', 'tpFlatRoots', 1, 9999, 1, s.rootsPerSchool) +
                H('Clumping', 'tpFlatClump', 0, 100, 1, s.rootClumping, '%') +
                H('Randomness', 'tpFlatRand', 0, 100, 1, s.rootRandomness, '%') +
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

        // Grid fills the entire visible area (square cells)
        var maxExtent = Math.max(w, h) * 3;
        var gridCountAlong = Math.ceil(maxExtent / gridSpacing);
        var gridCountCross = Math.ceil(maxExtent / gridSpacing);

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

        // --- Draw square grid ---

        // Lines along the root direction (fills canvas)
        for (var g = -gridCountAlong; g <= gridCountAlong; g++) {
            var pos = g * gridSpacing;
            var isOnLine = (pos >= -halfLen - 0.5 && pos <= halfLen + 0.5);
            ctx.beginPath();
            if (isHoriz) {
                ctx.moveTo(cx + pos, cy - maxExtent);
                ctx.lineTo(cx + pos, cy + maxExtent);
            } else {
                ctx.moveTo(cx - maxExtent, cy + pos);
                ctx.lineTo(cx + maxExtent, cy + pos);
            }
            ctx.strokeStyle = isOnLine
                ? 'rgba(184, 168, 120, 0.06)'
                : 'rgba(184, 168, 120, 0.03)';
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // Cross lines (perpendicular, same spacing = square cells, fills canvas)
        for (var c = -gridCountCross; c <= gridCountCross; c++) {
            var cPos = c * gridSpacing;
            var isCenterLine = (c === 0);
            ctx.beginPath();
            if (isHoriz) {
                ctx.moveTo(cx - maxExtent, cy + cPos);
                ctx.lineTo(cx + maxExtent, cy + cPos);
            } else {
                ctx.moveTo(cx + cPos, cy - maxExtent);
                ctx.lineTo(cx + cPos, cy + maxExtent);
            }
            ctx.strokeStyle = isCenterLine
                ? 'rgba(184, 168, 120, 0.15)'
                : 'rgba(184, 168, 120, 0.04)';
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // Grid dots extending endlessly, colored by school (batched by column)
        var maxDots = 20000;
        var dotPerAxis = Math.floor((Math.sqrt(maxDots) - 1) / 2);
        for (var da = -dotPerAxis; da <= dotPerAxis; da++) {
            var alongPos = da * gridSpacing;

            // One fillStyle per column — school color if within line, neutral otherwise
            var colColor = 'rgba(184, 168, 120, 0.08)';
            if (schoolCount > 0 && alongPos >= -halfLen - 0.5 && alongPos <= halfLen + 0.5) {
                for (var dsi = 0; dsi < schoolCount; dsi++) {
                    if (alongPos < segStarts[dsi] + segmentSizes[dsi] + 0.5) {
                        colColor = schoolRgba[dsi];
                        break;
                    }
                }
            }
            ctx.fillStyle = colColor;

            for (var dc = -dotPerAxis; dc <= dotPerAxis; dc++) {
                var crossPos = dc * gridSpacing;
                var dx = isHoriz ? cx + alongPos : cx + crossPos;
                var dy = isHoriz ? cy + crossPos : cy + alongPos;
                ctx.fillRect(dx - 1, dy - 1, 3, 3);
            }
        }

        // Collect grid point positions for downstream modules
        this._lastRenderData.gridPoints = this._collectFlatGridPoints(
            gridSpacing, dotPerAxis, isHoriz, schools, segStarts, segmentSizes, halfLen
        );

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
