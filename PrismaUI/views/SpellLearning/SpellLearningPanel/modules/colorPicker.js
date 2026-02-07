/**
 * Simple HSV Color Picker for Ultralight/PrismaUI
 * Canvas-based, no external dependencies
 */

var ColorPicker = {
    _popup: null,
    _hueCanvas: null,
    _svCanvas: null,
    _preview: null,
    _hexInput: null,
    _currentCallback: null,
    _hsv: [0, 100, 100],  // [hue, saturation, value]
    
    /**
     * Initialize the color picker popup (call once on page load)
     */
    init: function() {
        if (this._popup) return;
        
        // Create popup container
        this._popup = document.createElement('div');
        this._popup.className = 'color-picker-popup';
        this._popup.style.cssText = 'display:none; position:fixed; z-index:9999; background:rgba(10,10,20,0.98); border:1px solid #b8a878; padding:10px; box-shadow:0 4px 20px rgba(0,0,0,0.8);';
        
        // Header
        var header = document.createElement('div');
        header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; padding-bottom:8px; border-bottom:1px solid #333;';
        header.innerHTML = '<span style="color:#b8a878; font-size:12px;">Color Picker</span>';
        
        var closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.style.cssText = 'background:none; border:none; color:#888; font-size:18px; cursor:pointer; padding:0 4px;';
        closeBtn.onclick = function() { ColorPicker.hide(); };
        header.appendChild(closeBtn);
        this._popup.appendChild(header);
        
        // Main content area
        var content = document.createElement('div');
        content.style.cssText = 'display:flex; gap:10px;';
        
        // SV (Saturation/Value) square
        this._svCanvas = document.createElement('canvas');
        this._svCanvas.width = 150;
        this._svCanvas.height = 150;
        this._svCanvas.style.cssText = 'cursor:crosshair; border:1px solid #333;';
        content.appendChild(this._svCanvas);
        
        // Hue bar
        this._hueCanvas = document.createElement('canvas');
        this._hueCanvas.width = 20;
        this._hueCanvas.height = 150;
        this._hueCanvas.style.cssText = 'cursor:pointer; border:1px solid #333;';
        content.appendChild(this._hueCanvas);
        
        this._popup.appendChild(content);
        
        // Preview and hex input row
        var previewRow = document.createElement('div');
        previewRow.style.cssText = 'display:flex; align-items:center; gap:8px; margin-top:10px;';
        
        this._preview = document.createElement('div');
        this._preview.style.cssText = 'width:30px; height:30px; border:1px solid #555; background:#ff0000;';
        previewRow.appendChild(this._preview);
        
        this._hexInput = document.createElement('input');
        this._hexInput.type = 'text';
        this._hexInput.maxLength = 7;
        this._hexInput.style.cssText = 'flex:1; background:#1a1a2e; border:1px solid #333; color:#fff; padding:6px 8px; font-family:monospace; font-size:12px;';
        this._hexInput.placeholder = '#ffffff';
        previewRow.appendChild(this._hexInput);
        
        var applyBtn = document.createElement('button');
        applyBtn.textContent = 'Apply';
        applyBtn.style.cssText = 'background:#b8a878; border:none; color:#000; padding:6px 12px; cursor:pointer; font-size:11px;';
        applyBtn.onclick = function() { ColorPicker._applyAndClose(); };
        previewRow.appendChild(applyBtn);
        
        this._popup.appendChild(previewRow);
        
        document.body.appendChild(this._popup);
        
        // Event handlers
        this._setupEvents();
        
        console.log('[ColorPicker] Initialized');
    },
    
    _setupEvents: function() {
        var self = this;
        var svDragging = false;
        var hueDragging = false;
        
        // SV canvas events
        this._svCanvas.addEventListener('mousedown', function(e) {
            svDragging = true;
            self._updateSV(e);
        });
        
        document.addEventListener('mousemove', function(e) {
            if (svDragging) self._updateSV(e);
            if (hueDragging) self._updateHue(e);
        });
        
        document.addEventListener('mouseup', function() {
            svDragging = false;
            hueDragging = false;
        });
        
        // Hue canvas events
        this._hueCanvas.addEventListener('mousedown', function(e) {
            hueDragging = true;
            self._updateHue(e);
        });
        
        // Hex input
        this._hexInput.addEventListener('change', function() {
            var hex = self._hexInput.value;
            if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
                self._hsv = self._hexToHsv(hex);
                self._renderSV();
                self._updatePreview();
            }
        });
        
        // Close on click outside
        document.addEventListener('click', function(e) {
            if (self._popup.style.display !== 'none' && !self._popup.contains(e.target)) {
                // Check if click was on the element that opened us
                if (!e.target.classList.contains('color-picker-trigger')) {
                    self.hide();
                }
            }
        });
    },
    
    _updateSV: function(e) {
        var rect = this._svCanvas.getBoundingClientRect();
        var x = Math.max(0, Math.min(149, e.clientX - rect.left));
        var y = Math.max(0, Math.min(149, e.clientY - rect.top));
        
        this._hsv[1] = (x / 149) * 100;  // Saturation
        this._hsv[2] = (1 - y / 149) * 100;  // Value
        
        this._renderSV();
        this._updatePreview();
    },
    
    _updateHue: function(e) {
        var rect = this._hueCanvas.getBoundingClientRect();
        var y = Math.max(0, Math.min(149, e.clientY - rect.top));
        
        this._hsv[0] = (y / 149) * 360;  // Hue
        
        this._renderHue();
        this._renderSV();
        this._updatePreview();
    },
    
    _renderHue: function() {
        var ctx = this._hueCanvas.getContext('2d');
        var w = 20, h = 150;
        
        for (var y = 0; y < h; y++) {
            var hue = (y / h) * 360;
            ctx.fillStyle = 'hsl(' + hue + ', 100%, 50%)';
            ctx.fillRect(0, y, w, 1);
        }
        
        // Draw indicator
        var indicatorY = (this._hsv[0] / 360) * h;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, indicatorY);
        ctx.lineTo(w, indicatorY);
        ctx.stroke();
    },
    
    _renderSV: function() {
        var ctx = this._svCanvas.getContext('2d');
        var w = 150, h = 150;
        var hue = this._hsv[0];
        
        // Base hue color
        ctx.fillStyle = 'hsl(' + hue + ', 100%, 50%)';
        ctx.fillRect(0, 0, w, h);
        
        // White gradient (left to right for saturation)
        var gradWhite = ctx.createLinearGradient(0, 0, w, 0);
        gradWhite.addColorStop(0, 'rgba(255,255,255,1)');
        gradWhite.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gradWhite;
        ctx.fillRect(0, 0, w, h);
        
        // Black gradient (top to bottom for value)
        var gradBlack = ctx.createLinearGradient(0, 0, 0, h);
        gradBlack.addColorStop(0, 'rgba(0,0,0,0)');
        gradBlack.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = gradBlack;
        ctx.fillRect(0, 0, w, h);
        
        // Draw indicator circle
        var x = (this._hsv[1] / 100) * w;
        var y = (1 - this._hsv[2] / 100) * h;
        
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.stroke();
    },
    
    _updatePreview: function() {
        var hex = this._hsvToHex(this._hsv);
        this._preview.style.background = hex;
        this._hexInput.value = hex;
    },
    
    _applyAndClose: function() {
        if (this._currentCallback) {
            var hex = this._hsvToHex(this._hsv);
            this._currentCallback(hex);
        }
        this.hide();
    },
    
    /**
     * Show the color picker
     * @param {HTMLElement} anchor - Element to position near
     * @param {string} initialColor - Initial hex color (#rrggbb)
     * @param {function} callback - Called with new hex color when applied
     */
    show: function(anchor, initialColor, callback) {
        this.init();
        
        this._currentCallback = callback;
        
        // Parse initial color
        if (initialColor && /^#[0-9A-Fa-f]{6}$/.test(initialColor)) {
            this._hsv = this._hexToHsv(initialColor);
        } else {
            this._hsv = [0, 100, 100];
        }
        
        // Show popup to measure its dimensions
        this._popup.style.visibility = 'hidden';
        this._popup.style.display = 'block';
        
        // Position popup, checking viewport bounds
        var rect = anchor.getBoundingClientRect();
        var popupRect = this._popup.getBoundingClientRect();
        var viewportWidth = window.innerWidth;
        var viewportHeight = window.innerHeight;
        
        var popupHeight = popupRect.height || 260;  // Estimated height
        var popupWidth = popupRect.width || 200;   // Estimated width
        
        // Vertical positioning: prefer below anchor, but go above if not enough space
        var top = rect.bottom + 5;
        if (top + popupHeight > viewportHeight - 10) {
            // Not enough space below, try above
            top = rect.top - popupHeight - 5;
            if (top < 10) {
                // Not enough space above either, position at top of viewport
                top = 10;
            }
        }
        
        // Horizontal positioning: start at anchor left, but shift left if overflowing
        var left = rect.left;
        if (left + popupWidth > viewportWidth - 10) {
            left = viewportWidth - popupWidth - 10;
        }
        if (left < 10) {
            left = 10;
        }
        
        this._popup.style.left = left + 'px';
        this._popup.style.top = top + 'px';
        this._popup.style.visibility = 'visible';
        
        // Render
        this._renderHue();
        this._renderSV();
        this._updatePreview();
    },
    
    hide: function() {
        if (this._popup) {
            this._popup.style.display = 'none';
        }
    },
    
    // ===== Color conversion utilities =====
    
    _hsvToHex: function(hsv) {
        var rgb = this._hsvToRgb(hsv[0], hsv[1], hsv[2]);
        return '#' + 
            ('0' + Math.round(rgb[0]).toString(16)).slice(-2) +
            ('0' + Math.round(rgb[1]).toString(16)).slice(-2) +
            ('0' + Math.round(rgb[2]).toString(16)).slice(-2);
    },
    
    _hexToHsv: function(hex) {
        var r = parseInt(hex.slice(1, 3), 16);
        var g = parseInt(hex.slice(3, 5), 16);
        var b = parseInt(hex.slice(5, 7), 16);
        return this._rgbToHsv(r, g, b);
    },
    
    _hsvToRgb: function(h, s, v) {
        h = h / 360;
        s = s / 100;
        v = v / 100;
        
        var r, g, b;
        var i = Math.floor(h * 6);
        var f = h * 6 - i;
        var p = v * (1 - s);
        var q = v * (1 - f * s);
        var t = v * (1 - (1 - f) * s);
        
        switch (i % 6) {
            case 0: r = v; g = t; b = p; break;
            case 1: r = q; g = v; b = p; break;
            case 2: r = p; g = v; b = t; break;
            case 3: r = p; g = q; b = v; break;
            case 4: r = t; g = p; b = v; break;
            case 5: r = v; g = p; b = q; break;
        }
        
        return [r * 255, g * 255, b * 255];
    },
    
    _rgbToHsv: function(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        
        var max = Math.max(r, g, b);
        var min = Math.min(r, g, b);
        var h, s, v = max;
        var d = max - min;
        
        s = max === 0 ? 0 : d / max;
        
        if (max === min) {
            h = 0;
        } else {
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }
        
        return [h * 360, s * 100, v * 100];
    }
};

// Auto-initialize on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { ColorPicker.init(); });
} else {
    ColorPicker.init();
}

window.ColorPicker = ColorPicker;
