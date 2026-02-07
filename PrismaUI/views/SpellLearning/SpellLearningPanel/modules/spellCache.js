/**
 * SpellLearning Spell Cache Module
 * 
 * Manages caching of spell data from C++ backend.
 * Handles batch requests and mock data for testing.
 */

var SpellCache = {
    _cache: new Map(),
    _pending: new Set(),
    _callbacks: new Map(),
    _batchCallback: null,

    get: function(formId) {
        return this._cache.get(formId);
    },

    set: function(formId, data) {
        this._cache.set(formId, data);
        this._pending.delete(formId);
        
        var callbacks = this._callbacks.get(formId) || [];
        callbacks.forEach(function(cb) { cb(data); });
        this._callbacks.delete(formId);
    },

    has: function(formId) {
        return this._cache.has(formId);
    },

    isPending: function(formId) {
        return this._pending.has(formId);
    },

    request: function(formId, callback) {
        var self = this;
        if (this.has(formId)) {
            if (callback) callback(this.get(formId));
            return;
        }

        if (callback) {
            if (!this._callbacks.has(formId)) {
                this._callbacks.set(formId, []);
            }
            this._callbacks.get(formId).push(callback);
        }

        if (!this._pending.has(formId)) {
            this._pending.add(formId);
            if (window.callCpp) {
                window.callCpp('GetSpellInfo', formId);
            } else {
                setTimeout(function() {
                    self.set(formId, self._generateMockSpell(formId));
                }, 100);
            }
        }
    },

    requestBatch: function(formIds, callback) {
        var self = this;
        var needed = formIds.filter(function(id) { 
            return !self.has(id) && !self.isPending(id); 
        });
        
        if (needed.length === 0) {
            if (callback) callback();
            return;
        }

        // Mark all as pending
        needed.forEach(function(id) { self._pending.add(id); });
        
        // Store batch callback
        if (callback) {
            this._batchCallback = callback;
        }

        // Request batch from C++
        if (window.callCpp) {
            console.log('[SpellCache] Requesting batch of ' + needed.length + ' spells');
            window.callCpp('GetSpellInfoBatch', JSON.stringify(needed));
        } else {
            // Fallback: generate mock data
            var remaining = needed.length;
            needed.forEach(function(formId) {
                setTimeout(function() {
                    self.set(formId, self._generateMockSpell(formId));
                    remaining--;
                    if (remaining === 0 && callback) callback();
                }, 100);
            });
        }
    },
    
    onBatchComplete: function() {
        if (this._batchCallback) {
            this._batchCallback();
            this._batchCallback = null;
        }
    },

    _generateMockSpell: function(formId) {
        var schools = ['Destruction', 'Restoration', 'Alteration', 'Conjuration', 'Illusion'];
        var levels = ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master'];
        var hash = formId.split('').reduce(function(a, c) { return a + c.charCodeAt(0); }, 0);
        
        return {
            formId: formId,
            name: 'Spell ' + formId.slice(-4),
            editorId: 'Spell' + formId.slice(-4),
            school: schools[hash % 5],
            level: levels[hash % 5],
            cost: 20 + (hash % 200),
            type: 'Spell',
            effects: ['Magic Effect'],
            description: 'A magical spell.'
        };
    },

    clear: function() {
        this._cache.clear();
        this._pending.clear();
        this._callbacks.clear();
    }
};
