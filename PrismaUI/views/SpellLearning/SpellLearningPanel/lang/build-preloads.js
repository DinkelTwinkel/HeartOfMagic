/**
 * build-preloads.js - Generate .js preload files from all .json translations
 *
 * Usage:  node lang/build-preloads.js
 *
 * Scans lang/ for *.json translation files and generates matching *.js preload
 * files that set window._i18nPreload. These are required for in-game use because
 * Ultralight (Skyrim's embedded browser) cannot reliably load JSON via XHR.
 */

var fs = require('fs');
var path = require('path');

var langDir = __dirname;

function flatten(obj, prefix) {
    var result = {};
    for (var key in obj) {
        if (!obj.hasOwnProperty(key)) continue;
        var fullKey = prefix ? prefix + '.' + key : key;
        if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
            var nested = flatten(obj[key], fullKey);
            for (var nk in nested) result[nk] = nested[nk];
        } else {
            result[fullKey] = obj[key];
        }
    }
    return result;
}

var files = fs.readdirSync(langDir).filter(function(f) {
    return f.endsWith('.json') && !f.startsWith('_');
});

if (files.length === 0) {
    console.log('No .json translation files found in ' + langDir);
    process.exit(0);
}

files.forEach(function(jsonFile) {
    var locale = path.basename(jsonFile, '.json');
    var jsonPath = path.join(langDir, jsonFile);
    var jsPath = path.join(langDir, locale + '.js');

    var raw = fs.readFileSync(jsonPath, 'utf8');
    var data = JSON.parse(raw);
    var flat = flatten(data, '');
    var keys = Object.keys(flat);

    var lines = keys.map(function(k) {
        return '    ' + JSON.stringify(k) + ': ' + JSON.stringify(flat[k]);
    });

    var output = '// Auto-generated from ' + jsonFile + ' - do not edit directly\n'
        + 'window._i18nPreload = {\n'
        + lines.join(',\n')
        + '\n};\n';

    fs.writeFileSync(jsPath, output, 'utf8');
    console.log('  ' + locale + '.js  (' + keys.length + ' keys from ' + jsonFile + ')');
});

console.log('Done - ' + files.length + ' preload file(s) generated.');
