/**
 * i18n - Internationalization / Translation Engine for Heart of Magic
 * 
 * Provides:
 *   t(key, params)      - Look up a translated string with optional {{param}} interpolation
 *   initI18n(locale)     - Load a language JSON file (synchronous, call before other scripts use t())
 *   applyI18nToDOM()     - Scan the DOM for data-i18n attributes and apply translations
 *   getLocale()          - Returns the currently loaded locale code
 *   getLoadedKeys()      - Returns array of all loaded translation keys (for debugging)
 * 
 * Usage in HTML:
 *   <span data-i18n="settings.devDebug.title">Developer & Debug</span>
 *   <input data-i18n-placeholder="search.placeholder" placeholder="Search spells...">
 *   <button data-i18n-title="buttons.scanTooltip" title="Scan your spell list">
 * 
 * Usage in JS:
 *   t('progression.stage', { number: 3 })  =>  "Stage 3"
 *   t('status.mastered')                   =>  "Mastered (fixed)"
 * 
 * Fallback: If a key is missing, t() returns the key itself so gaps are obvious.
 *           English text left in HTML acts as a visual fallback if JSON fails to load.
 */

(function() {
    'use strict';

    var _translations = {};
    var _locale = 'en';
    var _loaded = false;

    /**
     * Load a translation JSON file synchronously.
     * @param {string} [locale='en'] - Locale code (matches filename in lang/ folder)
     */
    function initI18n(locale) {
        locale = locale || 'en';
        _locale = locale;

        // Prefer preloaded data from <script src="lang/en.js"> (avoids sync XHR issues in Ultralight/USVFS)
        // Only use preload if the locale matches (prevents loading English when another locale is requested)
        if (window._i18nPreload && typeof window._i18nPreload === 'object') {
            var preloadLocale = window._i18nPreload['_meta.locale'] || 'en';
            if (preloadLocale === locale) {
                _translations = window._i18nPreload;
                _loaded = true;
                console.log('[i18n] Loaded locale "' + locale + '" from preload (' + Object.keys(_translations).length + ' keys)');
                return;
            } else {
                console.log('[i18n] Preload is "' + preloadLocale + '" but requested "' + locale + '", loading via XHR');
            }
        }

        // Fallback: sync XHR (works in browsers, may truncate in Ultralight file://)
        var basePath = _detectBasePath();
        var url = basePath + 'lang/' + locale + '.json';

        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, false); // synchronous
            xhr.send(null);

            if (xhr.status === 200 || xhr.status === 0) { // status 0 for file:// protocol
                var text = xhr.responseText;
                if (!text || text.length < 2) {
                    console.warn('[i18n] Empty response for "' + locale + '" (length=' + (text ? text.length : 0) + '). Using HTML fallback text.');
                } else {
                    var data = JSON.parse(text);
                    _translations = data;
                    _loaded = true;
                    console.log('[i18n] Loaded locale "' + locale + '" via XHR (' + Object.keys(data).length + ' keys)');
                }
            } else if (locale !== 'en') {
                console.warn('[i18n] Locale "' + locale + '" not found (HTTP ' + xhr.status + '), falling back to "en"');
                initI18n('en');
                return;
            } else {
                console.warn('[i18n] Could not load en.json (HTTP ' + xhr.status + '). Using HTML fallback text.');
            }
        } catch (e) {
            if (locale !== 'en') {
                console.warn('[i18n] Error loading "' + locale + '": ' + e.message + '. Falling back to "en".');
                initI18n('en');
                return;
            }
            console.warn('[i18n] Error loading en.json: ' + e.message + '. Using HTML fallback text.');
        }
    }

    /**
     * Detect the base path to the SpellLearningPanel folder.
     * Works whether loaded from file:// or via CEF/HTTP.
     */
    function _detectBasePath() {
        // Find the script tag that loaded this file
        var scripts = document.getElementsByTagName('script');
        for (var i = 0; i < scripts.length; i++) {
            var src = scripts[i].src || '';
            var idx = src.indexOf('modules/i18n.js');
            if (idx !== -1) {
                return src.substring(0, idx);
            }
        }
        // Fallback: assume relative to current page
        return '';
    }

    /**
     * Look up a translation key with optional interpolation.
     * @param {string} key - Dot-notation key (e.g. "settings.devDebug.title")
     * @param {Object} [params] - Key-value pairs for {{variable}} replacement
     * @returns {string} Translated string, or the key itself if not found
     */
    function t(key, params) {
        var str = _translations[key];

        if (str === undefined || str === null) {
            // Key not found - return key itself so missing translations are visible
            return key;
        }

        // Interpolate {{variable}} placeholders
        if (params) {
            for (var name in params) {
                if (params.hasOwnProperty(name)) {
                    str = str.replace(new RegExp('\\{\\{' + name + '\\}\\}', 'g'), params[name]);
                }
            }
        }

        return str;
    }

    /**
     * Scan the DOM and apply translations to elements with data-i18n attributes.
     * Call this after DOMContentLoaded or after dynamically adding translated elements.
     * 
     * Supports:
     *   data-i18n="key"              -> sets textContent
     *   data-i18n-placeholder="key"  -> sets placeholder attribute
     *   data-i18n-title="key"        -> sets title attribute
     *   data-i18n-html="key"         -> sets innerHTML (use sparingly, for rich text)
     * 
     * @param {Element} [root=document] - Optional root element to scan within
     */
    function applyI18nToDOM(root) {
        if (!_loaded) return;

        root = root || document;

        // textContent
        var elements = root.querySelectorAll('[data-i18n]');
        for (var i = 0; i < elements.length; i++) {
            var key = elements[i].getAttribute('data-i18n');
            if (key && _translations[key] !== undefined) {
                elements[i].textContent = _translations[key];
            }
        }

        // placeholder
        var placeholders = root.querySelectorAll('[data-i18n-placeholder]');
        for (var j = 0; j < placeholders.length; j++) {
            var pKey = placeholders[j].getAttribute('data-i18n-placeholder');
            if (pKey && _translations[pKey] !== undefined) {
                placeholders[j].placeholder = _translations[pKey];
            }
        }

        // title / tooltip
        var titles = root.querySelectorAll('[data-i18n-title]');
        for (var k = 0; k < titles.length; k++) {
            var tKey = titles[k].getAttribute('data-i18n-title');
            if (tKey && _translations[tKey] !== undefined) {
                titles[k].title = _translations[tKey];
            }
        }

        // innerHTML (for rich text like cheat mode info)
        var htmlElements = root.querySelectorAll('[data-i18n-html]');
        for (var h = 0; h < htmlElements.length; h++) {
            var hKey = htmlElements[h].getAttribute('data-i18n-html');
            if (hKey && _translations[hKey] !== undefined) {
                htmlElements[h].innerHTML = _translations[hKey];
            }
        }
    }

    /**
     * Get the currently loaded locale code.
     * @returns {string}
     */
    function getLocale() {
        return _locale;
    }

    /**
     * Get all loaded translation keys (useful for debugging/tooling).
     * @returns {string[]}
     */
    function getLoadedKeys() {
        return Object.keys(_translations);
    }

    // Expose globally
    window.t = t;
    window.initI18n = initI18n;
    window.applyI18nToDOM = applyI18nToDOM;
    window.getLocale = getLocale;
    window.getLoadedKeys = getLoadedKeys;

})();
