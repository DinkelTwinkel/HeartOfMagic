/**
 * ClassicThemeEngine — JS-side dynamic theme discovery for Smart spell matching.
 *
 * Analyzes spell names, effect names, and keywords to discover meaningful theme
 * groups within each school. Produces cleaner themes than basic TF-IDF by
 * merging duplicates (cold/frost), splitting overly generic themes (conjure),
 * and fixing root node assignments.
 *
 * Usage:
 *   var refined = ClassicThemeEngine.discoverAndAssign(schoolTree.nodes, spells);
 *   // refined = { "0x00012FCD": "fire", "0x0001C789": "frost", ... }
 *
 * Called by classicLayout.js when spellMatching === 'smart'.
 */
var ClassicThemeEngine = {

    _stopWords: null,

    // =========================================================================
    // PUBLIC API
    // =========================================================================

    /**
     * Discover themes for a school's spells and return theme assignments.
     *
     * @param {Array} treeNodes - nodes from schoolTree (formId, name, theme, children)
     * @param {Array} spells - state.lastSpellData.spells (effectNames, keywords)
     * @returns {Object} formId -> refined theme string
     */
    discoverAndAssign: function (treeNodes, spells) {
        if (!treeNodes || treeNodes.length === 0) return {};

        // 1. Build tokenized text per spell
        var spellTexts = this._buildSpellText(treeNodes, spells);
        var totalSpells = Object.keys(spellTexts).length;
        if (totalSpells === 0) return {};

        // 2. Extract distinctive keywords
        var keywords = this._extractKeywords(spellTexts, 12);
        if (keywords.length === 0) return {};

        // 3. Assign each spell to its best keyword
        var assignments = this._assignThemes(spellTexts, keywords);

        // 4. Merge near-duplicate themes
        assignments = this._mergeThemes(assignments, spellTexts);

        // 5. Split overly dominant themes
        assignments = this._splitLargeThemes(assignments, spellTexts, totalSpells);

        // 6. Fix root nodes
        this._fixRoots(assignments, treeNodes);

        // Log summary
        var themeCounts = {};
        for (var fid in assignments) {
            if (assignments.hasOwnProperty(fid)) {
                var t = assignments[fid];
                themeCounts[t] = (themeCounts[t] || 0) + 1;
            }
        }
        var themeList = Object.keys(themeCounts).sort(function (a, b) {
            return themeCounts[b] - themeCounts[a];
        });
        console.log('[ThemeEngine] Discovered ' + themeList.length + ' themes (' + totalSpells + ' spells): ' +
            themeList.slice(0, 8).map(function (t) { return t + ':' + themeCounts[t]; }).join(', '));

        return assignments;
    },

    // =========================================================================
    // TEXT EXTRACTION
    // =========================================================================

    /**
     * Build tokenized text corpus for each spell.
     * @returns {Object} formId -> { name, tokens: string[], allText: string }
     */
    _buildSpellText: function (treeNodes, spells) {
        var spellLookup = {};
        if (spells) {
            for (var si = 0; si < spells.length; si++) {
                if (spells[si].formId) spellLookup[spells[si].formId] = spells[si];
            }
        }

        var stops = this._getStopWords();
        var result = {};

        for (var i = 0; i < treeNodes.length; i++) {
            var node = treeNodes[i];
            var spell = spellLookup[node.formId];
            var parts = [];

            // Spell name (primary source)
            var name = (spell && spell.name) || node.name || '';
            if (name) parts.push(name);

            // Effect names
            if (spell && spell.effectNames) {
                for (var ei = 0; ei < spell.effectNames.length; ei++) {
                    parts.push(spell.effectNames[ei]);
                }
            }

            // Keywords (strip "Magic" prefix)
            if (spell && spell.keywords) {
                for (var ki = 0; ki < spell.keywords.length; ki++) {
                    var kw = spell.keywords[ki].replace(/^Magic/i, '');
                    if (kw.length > 0) parts.push(kw);
                }
            }

            var allText = parts.join(' ').toLowerCase();
            var tokens = this._tokenize(allText, stops);

            result[node.formId] = {
                name: name,
                tokens: tokens,
                allText: allText
            };
        }

        return result;
    },

    /**
     * Tokenize text: split on non-alpha, filter short words and stop words.
     */
    _tokenize: function (text, stops) {
        var words = text.match(/[a-z]{3,}/g) || [];
        var result = [];
        for (var i = 0; i < words.length; i++) {
            if (!stops[words[i]]) {
                result.push(words[i]);
            }
        }
        return result;
    },

    // =========================================================================
    // KEYWORD EXTRACTION
    // =========================================================================

    /**
     * Extract the most distinctive keywords from the spell corpus.
     * Uses document frequency scoring: peaks at moderate frequency.
     */
    _extractKeywords: function (spellTexts, topN) {
        var formIds = Object.keys(spellTexts);
        var total = formIds.length;
        if (total === 0) return [];

        // Count document frequency (how many spells contain each word)
        var docFreq = {};
        for (var i = 0; i < formIds.length; i++) {
            var tokens = spellTexts[formIds[i]].tokens;
            var seen = {};
            for (var j = 0; j < tokens.length; j++) {
                if (!seen[tokens[j]]) {
                    seen[tokens[j]] = true;
                    docFreq[tokens[j]] = (docFreq[tokens[j]] || 0) + 1;
                }
            }
        }

        // Score: count * (1 - count/total) — peaks at moderate frequency
        // Filter: remove >60% (too common) and <2 occurrences (too rare)
        var maxDF = Math.ceil(total * 0.6);
        var scored = [];
        for (var word in docFreq) {
            if (!docFreq.hasOwnProperty(word)) continue;
            var df = docFreq[word];
            if (df < 2 || df > maxDF) continue;
            var score = df * (1 - df / total);
            scored.push({ word: word, score: score, count: df });
        }

        scored.sort(function (a, b) { return b.score - a.score; });

        var result = [];
        for (var k = 0; k < Math.min(topN, scored.length); k++) {
            result.push(scored[k].word);
        }
        return result;
    },

    // =========================================================================
    // THEME ASSIGNMENT
    // =========================================================================

    /**
     * Assign each spell to its best-matching keyword theme.
     */
    _assignThemes: function (spellTexts, keywords) {
        var assignments = {};

        for (var fid in spellTexts) {
            if (!spellTexts.hasOwnProperty(fid)) continue;
            var tokens = spellTexts[fid].tokens;

            var bestKw = null;
            var bestIdx = keywords.length; // lower index = higher score keyword

            for (var ti = 0; ti < tokens.length; ti++) {
                var kwIdx = keywords.indexOf(tokens[ti]);
                if (kwIdx >= 0 && kwIdx < bestIdx) {
                    bestIdx = kwIdx;
                    bestKw = tokens[ti];
                }
            }

            // Fallback: check if any keyword is a substring of any token
            if (!bestKw) {
                for (var ki = 0; ki < keywords.length; ki++) {
                    var kw = keywords[ki];
                    for (var ti2 = 0; ti2 < tokens.length; ti2++) {
                        if (tokens[ti2].indexOf(kw) >= 0 || kw.indexOf(tokens[ti2]) >= 0) {
                            if (ki < bestIdx) {
                                bestIdx = ki;
                                bestKw = kw;
                            }
                        }
                    }
                    if (bestKw) break;
                }
            }

            assignments[fid] = bestKw || '_misc';
        }

        return assignments;
    },

    // =========================================================================
    // THEME MERGING
    // =========================================================================

    /**
     * Merge near-duplicate themes:
     * - One theme is substring of another (heal/healing → heal)
     * - High spell overlap between themes (>70% of smaller theme's spells
     *   also match the larger theme's keyword)
     */
    _mergeThemes: function (assignments, spellTexts) {
        // Build theme -> [formIds]
        var themeMembers = {};
        for (var fid in assignments) {
            if (!assignments.hasOwnProperty(fid)) continue;
            var theme = assignments[fid];
            if (!themeMembers[theme]) themeMembers[theme] = [];
            themeMembers[theme].push(fid);
        }

        var themes = Object.keys(themeMembers);
        var mergeMap = {}; // oldTheme -> newTheme

        for (var i = 0; i < themes.length; i++) {
            for (var j = i + 1; j < themes.length; j++) {
                var a = themes[i], b = themes[j];
                if (mergeMap[a] || mergeMap[b]) continue;
                if (a === '_misc' || b === '_misc') continue;

                var shouldMerge = false;
                var mergeInto = null;

                // Substring check
                if (a.indexOf(b) >= 0) {
                    shouldMerge = true;
                    mergeInto = b; // shorter is canonical
                } else if (b.indexOf(a) >= 0) {
                    shouldMerge = true;
                    mergeInto = a;
                }

                // Overlap check: do most of smaller theme's spells contain the larger's keyword?
                if (!shouldMerge) {
                    var smaller = themeMembers[a].length <= themeMembers[b].length ? a : b;
                    var larger = smaller === a ? b : a;
                    var overlapCount = 0;
                    var smallMembers = themeMembers[smaller];
                    for (var oi = 0; oi < smallMembers.length; oi++) {
                        var st = spellTexts[smallMembers[oi]];
                        if (st && st.tokens.indexOf(larger) >= 0) {
                            overlapCount++;
                        }
                    }
                    if (smallMembers.length > 0 && overlapCount / smallMembers.length > 0.7) {
                        shouldMerge = true;
                        mergeInto = larger; // merge into the larger theme
                    }
                }

                if (shouldMerge && mergeInto) {
                    var mergeFrom = (mergeInto === a) ? b : a;
                    mergeMap[mergeFrom] = mergeInto;
                }
            }
        }

        // Apply merges
        if (Object.keys(mergeMap).length > 0) {
            var mergeLog = [];
            for (var fid2 in assignments) {
                if (!assignments.hasOwnProperty(fid2)) continue;
                var mapped = mergeMap[assignments[fid2]];
                if (mapped) {
                    assignments[fid2] = mapped;
                }
            }
            for (var mf in mergeMap) {
                if (mergeMap.hasOwnProperty(mf)) {
                    mergeLog.push(mf + '→' + mergeMap[mf]);
                }
            }
            if (mergeLog.length > 0) {
                console.log('[ThemeEngine] Merged themes: ' + mergeLog.join(', '));
            }
        }

        return assignments;
    },

    // =========================================================================
    // THEME SPLITTING
    // =========================================================================

    /**
     * Split themes that contain >40% of total spells by finding a secondary
     * keyword among those spells.
     */
    _splitLargeThemes: function (assignments, spellTexts, totalSpells) {
        var threshold = Math.ceil(totalSpells * 0.4);

        // Build theme -> [formIds]
        var themeMembers = {};
        for (var fid in assignments) {
            if (!assignments.hasOwnProperty(fid)) continue;
            var theme = assignments[fid];
            if (!themeMembers[theme]) themeMembers[theme] = [];
            themeMembers[theme].push(fid);
        }

        for (var theme2 in themeMembers) {
            if (!themeMembers.hasOwnProperty(theme2)) continue;
            if (theme2 === '_misc') continue;
            var members = themeMembers[theme2];
            if (members.length <= threshold) continue;

            // Find secondary keyword among these spells (not the theme keyword itself)
            var wordFreq = {};
            for (var mi = 0; mi < members.length; mi++) {
                var st = spellTexts[members[mi]];
                if (!st) continue;
                var seen = {};
                for (var ti = 0; ti < st.tokens.length; ti++) {
                    var w = st.tokens[ti];
                    if (w === theme2) continue; // skip the dominant keyword
                    if (!seen[w]) {
                        seen[w] = true;
                        wordFreq[w] = (wordFreq[w] || 0) + 1;
                    }
                }
            }

            // Find best splitter: peaks at moderate count (not too common/rare)
            var bestWord = null;
            var bestScore = 0;
            for (var w2 in wordFreq) {
                if (!wordFreq.hasOwnProperty(w2)) continue;
                var wc = wordFreq[w2];
                if (wc < 3) continue; // too rare to split on
                var splitScore = wc * (1 - wc / members.length);
                if (splitScore > bestScore) {
                    bestScore = splitScore;
                    bestWord = w2;
                }
            }

            if (bestWord) {
                var splitCount = 0;
                for (var si = 0; si < members.length; si++) {
                    var st2 = spellTexts[members[si]];
                    if (st2 && st2.tokens.indexOf(bestWord) >= 0) {
                        assignments[members[si]] = bestWord;
                        splitCount++;
                    }
                }
                console.log('[ThemeEngine] Split "' + theme2 + '": ' + splitCount +
                    ' spells → "' + bestWord + '" (' + (members.length - splitCount) + ' remain)');
            }
        }

        return assignments;
    },

    // =========================================================================
    // ROOT FIXING
    // =========================================================================

    /**
     * Fix root nodes: set theme to the most common theme among direct children.
     */
    _fixRoots: function (assignments, treeNodes) {
        // Build formId -> node lookup
        var lookup = {};
        for (var i = 0; i < treeNodes.length; i++) {
            lookup[treeNodes[i].formId] = treeNodes[i];
        }

        for (var j = 0; j < treeNodes.length; j++) {
            var node = treeNodes[j];
            if (!node.children || node.children.length === 0) continue;

            // Check if this is a root (no prerequisites or empty prerequisites)
            var isRoot = !node.prerequisites || node.prerequisites.length === 0;
            if (!isRoot) continue;

            // Count child themes
            var childThemeCounts = {};
            for (var ci = 0; ci < node.children.length; ci++) {
                var childTheme = assignments[node.children[ci]];
                if (childTheme && childTheme !== '_misc') {
                    childThemeCounts[childTheme] = (childThemeCounts[childTheme] || 0) + 1;
                }
            }

            // Find dominant child theme
            var bestTheme = null;
            var bestCount = 0;
            for (var ct in childThemeCounts) {
                if (childThemeCounts.hasOwnProperty(ct) && childThemeCounts[ct] > bestCount) {
                    bestCount = childThemeCounts[ct];
                    bestTheme = ct;
                }
            }

            if (bestTheme && assignments[node.formId] !== bestTheme) {
                var oldTheme = assignments[node.formId] || 'none';
                assignments[node.formId] = bestTheme;
                console.log('[ThemeEngine] Root "' + (node.name || node.formId) +
                    '": ' + oldTheme + ' → ' + bestTheme);
            }
        }
    },

    // =========================================================================
    // STOP WORDS
    // =========================================================================

    _getStopWords: function () {
        if (this._stopWords) return this._stopWords;
        var words = [
            // English
            'the', 'and', 'for', 'from', 'with', 'that', 'this', 'are', 'was', 'has', 'have',
            'not', 'but', 'all', 'can', 'her', 'his', 'its', 'our', 'you', 'per', 'into',
            // Skyrim spell generic
            'spell', 'magic', 'magicka', 'target', 'caster', 'self', 'points', 'seconds',
            'damage', 'effect', 'effects', 'level', 'increases', 'decreases', 'duration',
            'concentration', 'once', 'area', 'nearby', 'enemies', 'health', 'cost',
            'casting', 'range', 'touch', 'aimed',
            // School names
            'alteration', 'conjuration', 'destruction', 'illusion', 'restoration',
            // Skill levels
            'novice', 'apprentice', 'adept', 'expert', 'master',
            // Overly generic
            'greater', 'lesser', 'mass', 'grand', 'minor', 'major'
        ];
        this._stopWords = {};
        for (var i = 0; i < words.length; i++) {
            this._stopWords[words[i]] = true;
        }
        return this._stopWords;
    }
};

console.log('[ClassicThemeEngine] Loaded');
