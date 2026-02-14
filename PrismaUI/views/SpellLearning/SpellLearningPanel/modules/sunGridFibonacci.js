/**
 * SUN Grid Distribution — Fibonacci / Golden Angle
 *
 * Places points in a phyllotactic spiral using the golden angle (~137.508 deg).
 * Each point: radius = maxRadius * sqrt(i / totalPoints),
 *             angle  = i * goldenAngle.
 * No concentric ring structure; a dashed reference circle marks the
 * root ring position. Points near the root ring are highlighted.
 *
 * Self-contained module, no imports required.
 */

var SunGridFibonacci = {
    name: 'Fibonacci',

    /**
     * Render a Fibonacci/golden-angle spiral grid.
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} cx - Center X
     * @param {number} cy - Center Y
     * @param {object} opts - tierSpacing, ringTier, ringRadius, spokes, tiers, maxExtent
     */
    renderGrid: function(ctx, cx, cy, opts) {
        var ringRadius = opts.ringRadius;
        var spokes = opts.spokes;
        var tiers = opts.tiers;
        var maxExtent = opts.maxExtent;
        var tierSpacing = opts.tierSpacing;

        var goldenAngle = Math.PI * (3 - Math.sqrt(5)); // ~2.39996 rad (~137.508 deg)
        var maxDots = opts.maxDots || 20000;
        var maxRadius = maxExtent;

        // Area-aware point count: Fibonacci distributes uniformly by area
        // (each point owns equal area), so we need totalPoints proportional
        // to area (totalRings²) to match the visible density of ring-based grids.
        var totalRings = Math.ceil(maxExtent / tierSpacing);
        var totalPoints = Math.min(Math.round(0.5 * spokes * totalRings * totalRings), maxDots);

        // Tolerance for "near root ring" highlighting
        var ringTolerance = tierSpacing * 0.6;

        // --- Dashed reference circle at ringRadius ---
        ctx.beginPath();
        ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(184, 168, 120, 0.35)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // --- Spiral dots — batch by color for single path per color ---
        var fibBuckets = {};
        for (var i = 1; i <= totalPoints; i++) {
            var r = maxRadius * Math.sqrt(i / totalPoints);
            var a = i * goldenAngle;
            var color;
            if (opts.pointColorFn) {
                color = opts.pointColorFn(a);
            } else {
                color = Math.abs(r - ringRadius) < ringTolerance
                    ? 'rgba(184, 168, 120, 0.35)'
                    : 'rgba(184, 168, 120, 0.15)';
            }
            if (!fibBuckets[color]) fibBuckets[color] = [];
            fibBuckets[color].push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
        for (var fbColor in fibBuckets) {
            var fbPts = fibBuckets[fbColor];
            ctx.fillStyle = fbColor;
            ctx.beginPath();
            for (var fbi = 0; fbi < fbPts.length; fbi += 2) {
                ctx.rect(fbPts[fbi] - 1, fbPts[fbi + 1] - 1, 3, 3);
            }
            ctx.fill();
        }

        // --- Center dot ---
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(184, 168, 120, 0.5)';
        ctx.fill();
    }
};
