/**
 * SUN Grid Distribution — Square
 *
 * Overlays a Cartesian (square) grid centered on the canvas.
 * Lines and dots at regular tierSpacing intervals. A dashed reference
 * circle marks the root ring position. Points near the root ring
 * are highlighted. School coloring uses angle from center.
 *
 * Self-contained module, no imports required.
 */

var SunGridSquare = {
    name: 'Square',

    /**
     * Render a square/Cartesian grid.
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} cx - Center X
     * @param {number} cy - Center Y
     * @param {object} opts - tierSpacing, ringTier, ringRadius, spokes, tiers, maxExtent
     */
    renderGrid: function(ctx, cx, cy, opts) {
        var ringRadius = opts.ringRadius;
        var maxExtent = opts.maxExtent;
        var tierSpacing = opts.tierSpacing;
        var maxDots = opts.maxDots || 20000;
        var halfCount = Math.ceil(maxExtent / tierSpacing);

        // --- Vertical grid lines (batched) ---
        ctx.beginPath();
        for (var vx = -halfCount; vx <= halfCount; vx++) {
            if (vx === 0) continue;
            var x = cx + vx * tierSpacing;
            ctx.moveTo(x, cy - maxExtent);
            ctx.lineTo(x, cy + maxExtent);
        }
        ctx.strokeStyle = 'rgba(184, 168, 120, 0.06)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // --- Horizontal grid lines (batched) ---
        ctx.beginPath();
        for (var hy = -halfCount; hy <= halfCount; hy++) {
            if (hy === 0) continue;
            var y = cy + hy * tierSpacing;
            ctx.moveTo(cx - maxExtent, y);
            ctx.lineTo(cx + maxExtent, y);
        }
        ctx.strokeStyle = 'rgba(184, 168, 120, 0.06)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // --- Center crosshair (slightly brighter) ---
        ctx.beginPath();
        ctx.moveTo(cx, cy - maxExtent);
        ctx.lineTo(cx, cy + maxExtent);
        ctx.moveTo(cx - maxExtent, cy);
        ctx.lineTo(cx + maxExtent, cy);
        ctx.strokeStyle = 'rgba(184, 168, 120, 0.15)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // --- Dashed reference circle at ringRadius ---
        ctx.beginPath();
        ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(184, 168, 120, 0.35)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // --- Grid dots at intersections — batch by color for single path per color ---
        var dotCount = 0;
        var ringTol = tierSpacing * 0.6;
        var sqBuckets = {};

        for (var gx = -halfCount; gx <= halfCount; gx++) {
            var dx = gx * tierSpacing;
            for (var gy = -halfCount; gy <= halfCount; gy++) {
                if (dotCount >= maxDots) break;
                if (gx === 0 && gy === 0) continue;
                var dy = gy * tierSpacing;

                var angle = Math.atan2(dy, dx);
                if (angle < 0) angle += Math.PI * 2;

                var color;
                if (opts.pointColorFn) {
                    color = opts.pointColorFn(angle);
                } else {
                    var dist = Math.sqrt(dx * dx + dy * dy);
                    color = Math.abs(dist - ringRadius) < ringTol
                        ? 'rgba(184, 168, 120, 0.35)'
                        : 'rgba(184, 168, 120, 0.15)';
                }
                if (!sqBuckets[color]) sqBuckets[color] = [];
                sqBuckets[color].push(cx + dx, cy + dy);
                dotCount++;
            }
            if (dotCount >= maxDots) break;
        }
        for (var sqColor in sqBuckets) {
            var sqPts = sqBuckets[sqColor];
            ctx.fillStyle = sqColor;
            ctx.beginPath();
            for (var sqi = 0; sqi < sqPts.length; sqi += 2) {
                ctx.rect(sqPts[sqi] - 1, sqPts[sqi + 1] - 1, 3, 3);
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
