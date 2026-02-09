/**
 * Dev Harness - Toolbar Wiring
 * Connects harness toolbar buttons to panel functionality.
 * Loaded AFTER all modules and script.js.
 */

(function() {
    console.log('[DevHarness] Toolbar initializing...');

    // ========================================================================
    // TOOLBAR BUTTONS
    // ========================================================================

    var btnTogglePanel = document.getElementById('btn-toggle-panel');
    var btnScanMock = document.getElementById('btn-scan-mock');
    var btnLoadTestData = document.getElementById('btn-load-test-data');
    var btnBuildTree = document.getElementById('btn-build-tree');
    var btnToggleLog = document.getElementById('btn-toggle-log');
    var btnClearLog = document.getElementById('btn-clear-log');
    var btnClearLogInner = document.getElementById('btn-clear-log-inner');
    var cppLogPanel = document.getElementById('cpp-log');

    // Toggle panel visibility
    if (btnTogglePanel) {
        btnTogglePanel.addEventListener('click', function() {
            var panel = document.getElementById('spellPanel');
            if (panel) {
                var visible = panel.style.display !== 'none';
                panel.style.display = visible ? 'none' : '';
                btnTogglePanel.classList.toggle('active', !visible);
            }
        });
    }

    // Mock scan - trigger ScanSpells via bridge
    if (btnScanMock) {
        btnScanMock.addEventListener('click', function() {
            var config = {
                scanMode: 'all',
                fields: {
                    editorId: true,
                    magickaCost: true,
                    minimumSkill: true,
                    castingType: true,
                    delivery: true,
                    chargeTime: false,
                    plugin: true,
                    effects: true,
                    effectNames: false,
                    keywords: false
                }
            };
            window.callCpp('ScanSpells', JSON.stringify(config));
        });
    }

    // Load test data directly (no scan simulation)
    if (btnLoadTestData) {
        btnLoadTestData.addEventListener('click', function() {
            btnLoadTestData.textContent = 'Loading...';
            btnLoadTestData.disabled = true;

            var schools = ['Alteration', 'Conjuration', 'Destruction', 'Illusion', 'Restoration'];
            var allSpells = [];
            var loaded = 0;

            schools.forEach(function(school) {
                fetch('test-data/' + school + '_spells.json')
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        var spells = data.spells || (Array.isArray(data) ? data : []);
                        spells.forEach(function(s) {
                            s.school = s.school || school;
                            allSpells.push(s);
                        });
                    })
                    .catch(function(err) {
                        console.error('[Harness] Failed to load ' + school + ':', err);
                    })
                    .finally(function() {
                        loaded++;
                        if (loaded === schools.length) {
                            window._mockSpellData = allSpells;
                            logCppCall('in', 'updateSpellData', allSpells.length + ' spells loaded');

                            if (typeof window.updateSpellData === 'function') {
                                window.updateSpellData(JSON.stringify(allSpells));
                            }

                            updateHarnessStatus();
                            btnLoadTestData.textContent = 'Load Test Data';
                            btnLoadTestData.disabled = false;
                        }
                    });
            });
        });
    }

    // Build tree from loaded spell data
    if (btnBuildTree) {
        btnBuildTree.addEventListener('click', function() {
            if (!window._mockSpellData || window._mockSpellData.length === 0) {
                alert('Load test data first!');
                return;
            }

            btnBuildTree.textContent = 'Building...';
            btnBuildTree.disabled = true;

            setTimeout(function() {
                try {
                    var buildSettings = {
                        rootCount: 3,
                        elementIsolation: true,
                        elementIsolationStrict: true,
                        strictTierOrdering: false,
                        allowSameTierLinks: true,
                        convergenceEnabled: true,
                        convergenceChance: 40,
                        convergenceMinTier: 3,
                        maxChildrenPerNode: 5,
                        linkStrategy: 'thematic'
                    };

                    var treeData;
                    if (typeof buildAllTreesSettingsAware === 'function') {
                        treeData = buildAllTreesSettingsAware(window._mockSpellData, null, buildSettings);
                    } else if (typeof buildAllTreesProcedural === 'function') {
                        treeData = buildAllTreesProcedural(window._mockSpellData);
                    }

                    if (treeData && treeData.schools) {
                        var schoolNames = Object.keys(treeData.schools);
                        var totalNodes = 0;
                        schoolNames.forEach(function(s) { totalNodes += treeData.schools[s].nodes.length; });
                        console.log('[Harness] Built tree: ' + schoolNames.length + ' schools, ' + totalNodes + ' nodes');

                        // Parse and render
                        var parsed = TreeParser.parse(treeData);
                        if (parsed.success) {
                            // Switch to tree tab
                            if (typeof switchTab === 'function') {
                                switchTab('spellTree');
                            }

                            // Init wheel renderer if needed
                            var svgEl = document.getElementById('tree-svg');
                            if (svgEl && !WheelRenderer.svg) {
                                WheelRenderer.init(svgEl);
                            }

                            WheelRenderer.setData(parsed.nodes, parsed.edges, parsed.schools);
                            if (typeof WheelRenderer.layout === 'function') WheelRenderer.layout();
                            WheelRenderer.render();

                            // Hide empty state
                            var emptyState = document.getElementById('empty-state');
                            if (emptyState) emptyState.style.display = 'none';

                            // Notify TreeGrowth that tree was built
                            if (typeof TreeGrowth !== 'undefined') {
                                TreeGrowth.setTreeBuilt(true, totalNodes, totalNodes);
                            }

                            // Enable PRM buttons and trigger preview
                            if (typeof PreReqMaster !== 'undefined') {
                                if (PreReqMaster.setButtonsEnabled) PreReqMaster.setButtonsEnabled(true);
                                if (PreReqMaster.updateStatus) PreReqMaster.updateStatus('Tree built - ready');
                                if (PreReqMaster.renderPreview) PreReqMaster.renderPreview();
                            }
                        } else {
                            console.error('[Harness] TreeParser failed:', parsed);
                        }
                    } else {
                        console.error('[Harness] Build returned no data');
                    }
                } catch(e) {
                    console.error('[Harness] Build failed:', e);
                    alert('Build failed: ' + e.message);
                } finally {
                    btnBuildTree.textContent = 'Build Tree';
                    btnBuildTree.disabled = false;
                }
            }, 100);
        });
    }

    // Toggle C++ log panel
    if (btnToggleLog) {
        btnToggleLog.addEventListener('click', function() {
            cppLogPanel.classList.toggle('visible');
            btnToggleLog.classList.toggle('active', cppLogPanel.classList.contains('visible'));
        });
    }

    // Clear log
    function clearLog() {
        window._cppLog = [];
        var logBody = document.getElementById('cpp-log-body');
        if (logBody) logBody.innerHTML = '';
    }
    if (btnClearLog) btnClearLog.addEventListener('click', clearLog);
    if (btnClearLogInner) btnClearLogInner.addEventListener('click', clearLog);

    // ========================================================================
    // OVERRIDE CLOSE BEHAVIOR
    // ========================================================================

    // In dev harness, closing the panel should just hide it (not call C++)
    var originalCloseClick = window.onCloseClick;
    window.onCloseClick = function() {
        var panel = document.getElementById('spellPanel');
        if (panel) panel.style.display = 'none';
        if (btnTogglePanel) btnTogglePanel.classList.remove('active');
        console.log('[DevHarness] Panel hidden (use Panel button to show again)');
    };

    // ========================================================================
    // AUTO-INIT
    // ========================================================================

    // Ensure panel is visible on load
    var panel = document.getElementById('spellPanel');
    if (panel) {
        panel.style.display = '';
        // In dev harness, fill viewport below toolbar (36px) and above status bar (28px)
        panel.style.width = '100%';
        panel.style.height = 'calc(100vh - 64px)';
        panel.style.left = '0';
        panel.style.top = '36px';
        panel.style.transform = 'none';
        panel.style.borderRadius = '0';
    }

    console.log('[DevHarness] Toolbar ready. Load test data > Build tree to test.');
})();
