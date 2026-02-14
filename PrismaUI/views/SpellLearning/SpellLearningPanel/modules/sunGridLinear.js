/**
 * SUN Grid Distribution — Linear
 *
 * Points per ring scale linearly with radius. Each ring k has a point
 * count proportional to its circumference, derived from the base spoke
 * count on ring 1. Produces evenly spaced concentric rings with
 * increasing point density outward.
 *
 * Self-contained module, no imports required.
 */

var SunGridLinear = {
    name: 'Linear',

    /**
     * Render a linear-distribution radial grid.
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} cx - Center X
     * @param {number} cy - Center Y
     * @param {object} opts - tierSpacing, ringTier, ringRadius, spokes, tiers, maxExtent
     */
    renderGrid: function(ctx, cx, cy, opts) {
        var tierSpacing = opts.tierSpacing;
        var ringTier = opts.ringTier;
        var ringRadius = opts.ringRadius;
        var spokes = opts.spokes;
        var maxExtent = opts.maxExtent;
        var totalTiers = Math.ceil(maxExtent / tierSpacing);

        // Base spacing: circumference of ring 1 divided by spoke count
        var baseSpacing = (2 * Math.PI * tierSpacing) / spokes;

        // --- Concentric tier rings — batch by style ---
        var linInner = [], linOuter = [], linRootR = -1;
        for (var r = 1; r <= totalTiers; r++) {
            var radius = r * tierSpacing;
            if (r === ringTier) { linRootR = radius; }
            else if (r < ringTier) { linInner.push(radius); }
            else { linOuter.push(radius); }
        }
        if (linOuter.length > 0) {
            ctx.strokeStyle = 'rgba(184, 168, 120, 0.05)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (var loi = 0; loi < linOuter.length; loi++) { ctx.moveTo(cx + linOuter[loi], cy); ctx.arc(cx, cy, linOuter[loi], 0, Math.PI * 2); }
            ctx.stroke();
        }
        if (linInner.length > 0) {
            ctx.strokeStyle = 'rgba(184, 168, 120, 0.1)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (var lii = 0; lii < linInner.length; lii++) { ctx.moveTo(cx + linInner[lii], cy); ctx.arc(cx, cy, linInner[lii], 0, Math.PI * 2); }
            ctx.stroke();
        }
        if (linRootR > 0) {
            ctx.strokeStyle = 'rgba(184, 168, 120, 0.35)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(cx + linRootR, cy); ctx.arc(cx, cy, linRootR, 0, Math.PI * 2);
            ctx.stroke();
        }

        // --- Grid dots per ring — batch by color for single path per color ---
        var maxDots = opts.maxDots || 20000;
        var dotCount = 0;
        var linBuckets = {};
        for (var r2 = 1; r2 <= totalTiers; r2++) {
            if (dotCount >= maxDots) break;
            var ringR = r2 * tierSpacing;
            var circumference = 2 * Math.PI * ringR;
            var pointCount = Math.max(spokes, Math.round(circumference / baseSpacing));
            var angleStep = (Math.PI * 2) / pointCount;

            for (var p = 0; p < pointCount; p++) {
                if (dotCount >= maxDots) break;
                var angle = p * angleStep;
                var color = opts.pointColorFn ? opts.pointColorFn(angle) : 'rgba(184, 168, 120, 0.15)';
                if (!linBuckets[color]) linBuckets[color] = [];
                linBuckets[color].push(cx + Math.cos(angle) * ringR, cy + Math.sin(angle) * ringR);
                dotCount++;
            }
        }
        for (var lbColor in linBuckets) {
            var lbPts = linBuckets[lbColor];
            ctx.fillStyle = lbColor;
            ctx.beginPath();
            for (var lbi = 0; lbi < lbPts.length; lbi += 2) {
                ctx.rect(lbPts[lbi] - 1, lbPts[lbi + 1] - 1, 3, 3);
            }
            ctx.fill();
        }

        // --- Base spokes — single batched path ---
        var baseAngleStep = (Math.PI * 2) / spokes;
        ctx.strokeStyle = 'rgba(184, 168, 120, 0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (var s = 0; s < spokes; s++) {
            var spokeAngle = s * baseAngleStep;
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(spokeAngle) * maxExtent, cy + Math.sin(spokeAngle) * maxExtent);
        }
        ctx.stroke();

        // --- Center dot ---
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(184, 168, 120, 0.5)';
        ctx.fill();
    }
};
