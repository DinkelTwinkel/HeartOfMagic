/**
 * Spell Tree Viewer - Radial Wheel Layout v0.6
 * 
 * - Uses formId for spell identification
 * - Fetches spell details from C++ via PrismaUI bridge
 * - Left-drag to pan, scroll to zoom, click node to focus school
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
    wheel: {
        baseRadius: 120,
        tierSpacing: 100,
        nodeWidth: 85,
        nodeHeight: 32,
        minArcSpacing: 25,
        schoolPadding: 15
    },
    zoom: {
        min: 0.2,
        max: 3,
        step: 0.2,
        wheelFactor: 0.001
    },
    animation: {
        rotateDuration: 400
    },
    schools: ['Destruction', 'Restoration', 'Alteration', 'Conjuration', 'Illusion'],
    schoolColors: {
        Destruction: '#ef4444',
        Restoration: '#facc15',
        Alteration: '#22c55e',
        Conjuration: '#a855f7',
        Illusion: '#38bdf8'
    }
};

// =============================================================================
// SPELL DATA CACHE
// Stores spell info fetched from the game (keyed by formId)
// =============================================================================

const SpellCache = {
    _cache: new Map(),
    _pending: new Set(),
    _callbacks: new Map(),

    get(formId) {
        return this._cache.get(formId);
    },

    set(formId, data) {
        this._cache.set(formId, data);
        this._pending.delete(formId);
        
        // Fire any pending callbacks
        const callbacks = this._callbacks.get(formId) || [];
        callbacks.forEach(cb => cb(data));
        this._callbacks.delete(formId);
    },

    has(formId) {
        return this._cache.has(formId);
    },

    isPending(formId) {
        return this._pending.has(formId);
    },

    request(formId, callback) {
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
            // Request spell data from C++
            if (window.callCpp) {
                window.callCpp('GetSpellInfo', formId);
            } else {
                // Mock data for testing without C++
                setTimeout(() => {
                    this.set(formId, this._generateMockSpell(formId));
                }, 100);
            }
        }
    },

    requestBatch(formIds, callback) {
        const needed = formIds.filter(id => !this.has(id) && !this.isPending(id));
        
        if (needed.length === 0) {
            if (callback) callback();
            return;
        }

        let remaining = needed.length;
        const onComplete = () => {
            remaining--;
            if (remaining === 0 && callback) callback();
        };

        needed.forEach(formId => this.request(formId, onComplete));
    },

    _generateMockSpell(formId) {
        // Mock spell for browser testing
        const schools = ['Destruction', 'Restoration', 'Alteration', 'Conjuration', 'Illusion'];
        const levels = ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master'];
        const hash = formId.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
        
        return {
            formId: formId,
            name: `Spell ${formId.slice(-4)}`,
            editorId: `Spell${formId.slice(-4)}`,
            school: schools[hash % 5],
            level: levels[hash % 5],
            cost: 20 + (hash % 200),
            type: 'Spell',
            effects: ['Magic Effect'],
            description: 'A magical spell.'
        };
    },

    clear() {
        this._cache.clear();
        this._pending.clear();
        this._callbacks.clear();
    }
};

// =============================================================================
// TREE PARSER (FormId-based)
// =============================================================================

class TreeParser {
    constructor() {
        this.nodes = new Map();
        this.edges = [];
        this.schools = {};
    }

    parse(data) {
        this.nodes.clear();
        this.edges = [];
        this.schools = {};

        if (typeof data === 'string') {
            try { data = JSON.parse(data); }
            catch (e) { return { success: false, error: e.message }; }
        }

        if (!data.schools) return { success: false, error: 'Missing schools' };

        // Collect all formIds we need
        const allFormIds = [];

        for (const [schoolName, schoolData] of Object.entries(data.schools)) {
            if (!schoolData.root || !schoolData.nodes) continue;
            this.schools[schoolName] = { root: schoolData.root, nodeIds: [], maxDepth: 0, maxWidth: 0 };

            for (const nd of schoolData.nodes) {
                // Support both formId and spellId formats
                const id = nd.formId || nd.spellId;
                if (!id) continue;

                allFormIds.push(id);
                
                // Create node with formId as identifier
                this.nodes.set(id, {
                    id: id,
                    formId: id,
                    name: null,       // Will be filled from cache
                    school: schoolName,
                    level: null,
                    cost: null,
                    type: null,
                    effects: [],
                    desc: null,
                    children: nd.children || [],
                    prerequisites: nd.prerequisites || [],
                    tier: nd.tier || 0,
                    state: 'locked',
                    depth: 0,
                    x: 0, y: 0,
                    angle: 0, radius: 0
                });
                this.schools[schoolName].nodeIds.push(id);
            }
        }

        // Build edges from children relationships
        for (const node of this.nodes.values()) {
            for (const childId of node.children) {
                const child = this.nodes.get(childId);
                if (child) {
                    this.edges.push({ from: node.id, to: childId });
                    // Add to prerequisites if not already present
                    if (!child.prerequisites.includes(node.id)) {
                        child.prerequisites.push(node.id);
                    }
                }
            }
        }

        // Calculate depths via BFS from root
        for (const [schoolName, schoolData] of Object.entries(this.schools)) {
            const root = this.nodes.get(schoolData.root);
            if (!root) continue;

            const queue = [{ node: root, depth: 0 }];
            const visited = new Set();
            const depthCounts = {};
            
            while (queue.length) {
                const { node, depth } = queue.shift();
                if (visited.has(node.id)) continue;
                visited.add(node.id);
                node.depth = depth;
                schoolData.maxDepth = Math.max(schoolData.maxDepth, depth);
                depthCounts[depth] = (depthCounts[depth] || 0) + 1;
                
                for (const cid of node.children) {
                    const c = this.nodes.get(cid);
                    if (c) queue.push({ node: c, depth: depth + 1 });
                }
            }

            schoolData.maxWidth = Math.max(...Object.values(depthCounts), 1);

            // Set initial states: root is unlocked, its children are available
            root.state = 'unlocked';
            for (const cid of root.children) {
                const c = this.nodes.get(cid);
                if (c) c.state = 'available';
            }
        }

        return {
            success: true,
            nodes: Array.from(this.nodes.values()),
            edges: this.edges,
            schools: this.schools,
            allFormIds: allFormIds
        };
    }

    // Update node data from spell cache
    updateNodeFromCache(node) {
        const spellData = SpellCache.get(node.formId);
        if (spellData) {
            node.name = spellData.name || spellData.editorId || node.formId;
            node.level = spellData.level || spellData.skillLevel || 'Unknown';
            node.cost = spellData.cost || spellData.magickaCost || 0;
            node.type = spellData.type || spellData.castingType || 'Spell';
            node.effects = spellData.effects || spellData.effectNames || [];
            node.desc = spellData.description || '';
            // School comes from tree structure, but can be verified/overridden
            if (spellData.school) node.school = spellData.school;
        }
    }
}

// =============================================================================
// RADIAL WHEEL RENDERER
// =============================================================================

class WheelRenderer {
    constructor(svgElement) {
        this.svg = svgElement;
        this.wheelGroup = svgElement.querySelector('#wheel-group');
        this.spokesLayer = svgElement.querySelector('#spokes-layer');
        this.edgesLayer = svgElement.querySelector('#edges-layer');
        this.nodesLayer = svgElement.querySelector('#nodes-layer');
        this.centerHub = svgElement.querySelector('#center-hub');

        this.nodes = [];
        this.edges = [];
        this.schools = {};
        this.nodeElements = new Map();
        this.edgeElements = new Map();

        this.rotation = 0;
        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;
        this.isAnimating = false;
        this.isPanning = false;
        this.panStartX = 0;
        this.panStartY = 0;
        this.selectedNode = null;

        this.setupEvents();
    }

    setupEvents() {
        this.svg.addEventListener('contextmenu', e => e.preventDefault());
        this.svg.addEventListener('mousedown', e => this.onMouseDown(e));
        this.svg.addEventListener('mousemove', e => this.onMouseMove(e));
        this.svg.addEventListener('mouseup', e => this.onMouseUp(e));
        this.svg.addEventListener('mouseleave', e => this.onMouseUp(e));
        this.svg.addEventListener('wheel', e => this.onWheel(e), { passive: false });
    }

    setData(nodes, edges, schools) {
        this.nodes = nodes;
        this.edges = edges;
        this.schools = schools;
        this.layoutRadial();
        this.render();
        this.centerView();
    }

    layoutRadial() {
        const { baseRadius, tierSpacing, schoolPadding } = CONFIG.wheel;
        const schoolNames = Object.keys(this.schools);
        const numSchools = schoolNames.length;
        
        if (numSchools === 0) return;

        const totalPadding = numSchools * schoolPadding;
        const availableAngle = 360 - totalPadding;
        const anglePerSchool = availableAngle / numSchools;

        let currentAngle = -90;
        
        for (let i = 0; i < schoolNames.length; i++) {
            const schoolName = schoolNames[i];
            const school = this.schools[schoolName];
            const spokeAngle = currentAngle + anglePerSchool / 2;
            
            school.startAngle = currentAngle;
            school.endAngle = currentAngle + anglePerSchool;
            school.spokeAngle = spokeAngle;
            
            this.layoutSchoolNodes(schoolName, school, spokeAngle, anglePerSchool);
            
            currentAngle += anglePerSchool + schoolPadding;
        }
    }

    layoutSchoolNodes(schoolName, school, spokeAngle, sectorAngle) {
        const { baseRadius, tierSpacing, nodeWidth, minArcSpacing } = CONFIG.wheel;
        const schoolNodes = this.nodes.filter(n => n.school === schoolName);
        
        const depthGroups = {};
        for (const n of schoolNodes) {
            if (!depthGroups[n.depth]) depthGroups[n.depth] = [];
            depthGroups[n.depth].push(n);
        }

        for (let d = 0; d <= school.maxDepth; d++) {
            const tier = depthGroups[d] || [];
            const radius = baseRadius + d * tierSpacing;
            const nodeArcLength = nodeWidth + minArcSpacing;
            const usedSpread = Math.min(sectorAngle * 0.85, (tier.length * nodeArcLength / (2 * Math.PI * radius)) * 360);
            
            for (let j = 0; j < tier.length; j++) {
                const node = tier[j];
                let angleOffset = 0;
                
                if (tier.length > 1) {
                    angleOffset = (j - (tier.length - 1) / 2) * (usedSpread / Math.max(tier.length - 1, 1));
                }
                
                const nodeAngle = spokeAngle + angleOffset;
                node.angle = nodeAngle;
                node.radius = radius;
                node.spokeAngle = spokeAngle;
                
                const rad = nodeAngle * Math.PI / 180;
                node.x = Math.cos(rad) * radius;
                node.y = Math.sin(rad) * radius;
            }
        }
    }

    render() {
        this.spokesLayer.innerHTML = '';
        this.edgesLayer.innerHTML = '';
        this.nodesLayer.innerHTML = '';
        this.centerHub.innerHTML = '';
        this.nodeElements.clear();
        this.edgeElements.clear();

        this.renderCenterHub();
        this.renderSpokes();
        
        for (const edge of this.edges) {
            this.renderEdge(edge);
        }
        
        for (const node of this.nodes) {
            this.renderNode(node);
        }

        this.updateTransform();
    }

    renderCenterHub() {
        const hub = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        hub.classList.add('center-hub-bg');
        hub.setAttribute('cx', 0);
        hub.setAttribute('cy', 0);
        hub.setAttribute('r', 45);
        this.centerHub.appendChild(hub);

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.classList.add('center-hub-text');
        text.setAttribute('x', 0);
        text.setAttribute('y', 0);
        text.textContent = 'MAGIC';
        this.centerHub.appendChild(text);
    }

    renderSpokes() {
        const { baseRadius, tierSpacing } = CONFIG.wheel;
        
        for (const [schoolName, school] of Object.entries(this.schools)) {
            const color = CONFIG.schoolColors[schoolName] || '#888';
            const angle = school.spokeAngle * Math.PI / 180;
            const maxRadius = baseRadius + (school.maxDepth + 0.5) * tierSpacing;
            
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', Math.cos(angle) * 50);
            line.setAttribute('y1', Math.sin(angle) * 50);
            line.setAttribute('x2', Math.cos(angle) * maxRadius);
            line.setAttribute('y2', Math.sin(angle) * maxRadius);
            line.setAttribute('stroke', color);
            line.setAttribute('stroke-width', 1.5);
            line.setAttribute('opacity', 0.25);
            this.spokesLayer.appendChild(line);

            const labelRadius = maxRadius + 25;
            const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            label.classList.add('school-label');
            label.setAttribute('x', Math.cos(angle) * labelRadius);
            label.setAttribute('y', Math.sin(angle) * labelRadius);
            label.setAttribute('fill', color);
            label.setAttribute('text-anchor', 'middle');
            label.setAttribute('dominant-baseline', 'middle');
            const labelRotation = school.spokeAngle > 90 && school.spokeAngle < 270 ? school.spokeAngle + 180 : school.spokeAngle;
            label.setAttribute('transform', `rotate(${labelRotation}, ${Math.cos(angle) * labelRadius}, ${Math.sin(angle) * labelRadius})`);
            label.textContent = schoolName.toUpperCase();
            this.spokesLayer.appendChild(label);
        }
    }

    renderNode(node) {
        const { nodeWidth, nodeHeight } = CONFIG.wheel;
        
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.classList.add('spell-node', node.state);
        g.setAttribute('data-id', node.id);
        g.setAttribute('data-school', node.school);
        
        const rotationAngle = node.angle + 90;
        g.setAttribute('transform', `translate(${node.x}, ${node.y}) rotate(${rotationAngle})`);

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.classList.add('node-bg');
        rect.setAttribute('x', -nodeWidth / 2);
        rect.setAttribute('y', -nodeHeight / 2);
        rect.setAttribute('width', nodeWidth);
        rect.setAttribute('height', nodeHeight);
        rect.setAttribute('rx', 5);
        g.appendChild(rect);

        const color = CONFIG.schoolColors[node.school] || '#888';
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.classList.add('node-school-indicator');
        dot.setAttribute('cx', -nodeWidth / 2 + 10);
        dot.setAttribute('cy', 0);
        dot.setAttribute('r', 3);
        dot.setAttribute('fill', node.state === 'locked' ? '#333' : color);
        g.appendChild(dot);

        // Display name (or ??? if locked, or formId if not loaded yet)
        let displayName;
        if (node.state === 'locked') {
            displayName = '???';
        } else if (node.name) {
            displayName = node.name;
        } else {
            displayName = node.formId.slice(-6); // Show last 6 chars of formId
        }
        
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.classList.add('node-text');
        text.setAttribute('x', 0);
        text.setAttribute('y', node.state === 'locked' || !node.level ? 0 : -3);
        text.setAttribute('text-anchor', 'middle');
        text.textContent = displayName;
        g.appendChild(text);

        if (node.state !== 'locked' && node.level) {
            const level = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            level.classList.add('node-level');
            level.setAttribute('x', 0);
            level.setAttribute('y', 9);
            level.setAttribute('text-anchor', 'middle');
            level.textContent = node.level;
            g.appendChild(level);
        }

        g.addEventListener('click', e => {
            e.stopPropagation();
            this.selectNode(node);
            this.rotateSchoolToTop(node.school);
        });
        
        g.addEventListener('mouseenter', e => this.showTooltip(node, e));
        g.addEventListener('mouseleave', () => this.hideTooltip());

        this.nodesLayer.appendChild(g);
        this.nodeElements.set(node.id, g);
    }

    renderEdge(edge) {
        const from = this.nodes.find(n => n.id === edge.from);
        const to = this.nodes.find(n => n.id === edge.to);
        if (!from || !to) return;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.classList.add('edge');
        path.setAttribute('data-from', edge.from);
        path.setAttribute('data-to', edge.to);
        path.setAttribute('d', `M ${from.x} ${from.y} L ${to.x} ${to.y}`);

        this.edgesLayer.appendChild(path);
        this.edgeElements.set(`${edge.from}-${edge.to}`, path);
    }

    rotateSchoolToTop(schoolName) {
        const school = this.schools[schoolName];
        if (!school) return;
        
        const targetRotation = -90 - school.spokeAngle;
        let delta = targetRotation - this.rotation;
        while (delta > 180) delta -= 360;
        while (delta < -180) delta += 360;
        
        this.animateRotation(this.rotation + delta);
    }

    animateRotation(target) {
        if (this.isAnimating) return;
        
        const start = this.rotation;
        const startTime = performance.now();
        const duration = CONFIG.animation.rotateDuration;
        
        this.isAnimating = true;
        
        const animate = (time) => {
            const elapsed = time - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            
            this.rotation = start + (target - start) * eased;
            this.updateTransform();
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                this.rotation = target;
                this.isAnimating = false;
                this.updateTransform();
            }
        };
        
        requestAnimationFrame(animate);
    }

    selectNode(node) {
        if (this.selectedNode) {
            const prev = this.nodeElements.get(this.selectedNode.id);
            if (prev) prev.classList.remove('selected');
        }
        for (const e of this.edgeElements.values()) {
            e.classList.remove('highlighted', 'path-highlight');
        }

        this.selectedNode = node;
        const el = this.nodeElements.get(node.id);
        if (el) el.classList.add('selected');

        // Highlight path to root
        const visited = new Set();
        const queue = [node.id];
        while (queue.length) {
            const id = queue.shift();
            if (visited.has(id)) continue;
            visited.add(id);
            const n = this.nodes.find(x => x.id === id);
            if (!n) continue;
            for (const prereq of n.prerequisites) {
                const ek = `${prereq}-${id}`;
                const edge = this.edgeElements.get(ek);
                if (edge) edge.classList.add('path-highlight');
                queue.push(prereq);
            }
        }

        for (const cid of node.children) {
            const ek = `${node.id}-${cid}`;
            const edge = this.edgeElements.get(ek);
            if (edge) edge.classList.add('highlighted');
        }

        window.dispatchEvent(new CustomEvent('nodeSelected', { detail: node }));
    }

    showTooltip(node, event) {
        const tooltip = document.getElementById('tooltip');
        const nameText = node.state === 'locked' ? '???' : (node.name || node.formId);
        const infoText = node.state === 'locked' 
            ? 'Unlock prerequisites first' 
            : `${node.school} • ${node.level || '?'} • ${node.cost || '?'} magicka`;
        
        tooltip.querySelector('.tooltip-name').textContent = nameText;
        tooltip.querySelector('.tooltip-info').textContent = infoText;
        
        const state = tooltip.querySelector('.tooltip-state');
        state.textContent = node.state;
        state.className = 'tooltip-state ' + node.state;
        
        tooltip.classList.remove('hidden');
        tooltip.style.left = (event.clientX + 15) + 'px';
        tooltip.style.top = (event.clientY + 15) + 'px';
    }

    hideTooltip() {
        document.getElementById('tooltip').classList.add('hidden');
    }

    updateTransform() {
        const rect = this.svg.getBoundingClientRect();
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        
        const tx = cx + this.panX;
        const ty = cy + this.panY;
        
        const wheelTransform = `translate(${tx}, ${ty}) rotate(${this.rotation}) scale(${this.zoom})`;
        this.wheelGroup.setAttribute('transform', wheelTransform);
        
        const hubTransform = `translate(${tx}, ${ty}) scale(${this.zoom})`;
        this.centerHub.setAttribute('transform', hubTransform);
    }

    centerView() {
        this.rotation = 0;
        this.panX = 0;
        this.panY = 0;
        this.zoom = 0.75;
        this.updateTransform();
        document.getElementById('zoom-level').textContent = Math.round(this.zoom * 100) + '%';
    }

    setZoom(z) {
        this.zoom = Math.max(CONFIG.zoom.min, Math.min(CONFIG.zoom.max, z));
        this.updateTransform();
        document.getElementById('zoom-level').textContent = Math.round(this.zoom * 100) + '%';
    }

    onMouseDown(e) {
        if (e.target.closest('.spell-node')) return;
        if (e.button === 0 || e.button === 2) {
            this.isPanning = true;
            this.panStartX = e.clientX - this.panX;
            this.panStartY = e.clientY - this.panY;
            this.svg.classList.add('dragging');
        }
    }

    onMouseMove(e) {
        if (this.isPanning) {
            this.panX = e.clientX - this.panStartX;
            this.panY = e.clientY - this.panStartY;
            this.updateTransform();
        }
    }

    onMouseUp() {
        this.isPanning = false;
        this.svg.classList.remove('dragging');
    }

    onWheel(e) {
        e.preventDefault();
        const delta = -e.deltaY * CONFIG.zoom.wheelFactor * this.zoom;
        this.setZoom(this.zoom + delta);
    }
}

// =============================================================================
// APPLICATION
// =============================================================================

class SpellTreeApp {
    constructor() {
        this.parser = new TreeParser();
        this.renderer = new WheelRenderer(document.getElementById('tree-svg'));
        this.data = null;
        this.setupUI();
    }

    setupUI() {
        document.getElementById('zoom-in').addEventListener('click', () => {
            this.renderer.setZoom(this.renderer.zoom + CONFIG.zoom.step);
        });
        document.getElementById('zoom-out').addEventListener('click', () => {
            this.renderer.setZoom(this.renderer.zoom - CONFIG.zoom.step);
        });
        document.getElementById('reset-btn').addEventListener('click', () => {
            this.renderer.centerView();
        });

        document.getElementById('import-btn')?.addEventListener('click', () => this.showModal());
        document.getElementById('import-empty-btn')?.addEventListener('click', () => this.showModal());
        document.getElementById('load-demo-btn')?.addEventListener('click', () => this.loadDemo());
        document.getElementById('import-cancel')?.addEventListener('click', () => this.hideModal());
        document.querySelector('.modal-close')?.addEventListener('click', () => this.hideModal());
        document.querySelector('.modal-backdrop')?.addEventListener('click', () => this.hideModal());
        document.getElementById('import-confirm')?.addEventListener('click', () => this.importTree());
        document.getElementById('load-demo')?.addEventListener('click', () => this.loadDemo());

        window.addEventListener('nodeSelected', e => this.showDetails(e.detail));
        document.getElementById('close-details')?.addEventListener('click', () => {
            document.getElementById('details-panel').classList.add('hidden');
        });

        document.getElementById('spell-prereqs')?.addEventListener('click', e => {
            if (e.target.tagName === 'LI') this.selectById(e.target.dataset.id);
        });
        document.getElementById('spell-unlocks')?.addEventListener('click', e => {
            if (e.target.tagName === 'LI') this.selectById(e.target.dataset.id);
        });

        window.addEventListener('resize', () => {
            if (this.data) this.renderer.updateTransform();
        });
    }

    showModal() {
        document.getElementById('import-modal')?.classList.remove('hidden');
        document.getElementById('import-error')?.classList.add('hidden');
    }

    hideModal() {
        document.getElementById('import-modal')?.classList.add('hidden');
    }

    loadDemo() {
        // Request demo/saved tree from C++
        if (window.callCpp) {
            window.callCpp('LoadSpellTree', '');
        } else {
            // Browser test: use mock formId tree
            this.loadTree(DEMO_FORMID_TREE);
        }
        this.hideModal();
        this.setStatus('Loading tree...');
    }

    importTree() {
        const text = document.getElementById('import-textarea')?.value.trim();
        if (!text) {
            this.showError('Please paste JSON');
            return;
        }
        try {
            const data = JSON.parse(text);
            this.loadTree(data);
            this.hideModal();
            this.setStatus('Tree imported');
        } catch (e) {
            this.showError('Invalid JSON: ' + e.message);
        }
    }

    loadTree(jsonData) {
        const result = this.parser.parse(jsonData);
        if (!result.success) {
            this.showError(result.error);
            return;
        }

        this.data = result;
        
        // Request spell data for all formIds
        SpellCache.requestBatch(result.allFormIds, () => {
            // Update all nodes with cached spell data
            for (const node of result.nodes) {
                this.parser.updateNodeFromCache(node);
            }
            // Re-render with updated data
            this.renderer.setData(result.nodes, result.edges, result.schools);
            this.setStatus(`Loaded ${result.nodes.length} spells`);
        });

        // Initial render (may show formIds until spell data loads)
        this.renderer.setData(result.nodes, result.edges, result.schools);
        
        document.getElementById('empty-state')?.classList.add('hidden');
        document.getElementById('total-count').textContent = result.nodes.length;
        document.getElementById('unlocked-count').textContent = 
            result.nodes.filter(n => n.state === 'unlocked').length;
    }

    showError(msg) {
        const el = document.getElementById('import-error');
        if (el) {
            el.textContent = msg;
            el.classList.remove('hidden');
        }
        console.error('[SpellTree]', msg);
    }

    showDetails(node) {
        const panel = document.getElementById('details-panel');
        if (!panel) return;
        panel.classList.remove('hidden');

        if (node.state === 'locked') {
            document.getElementById('spell-name').textContent = '???';
            document.getElementById('spell-school').textContent = node.school;
            document.getElementById('spell-school').className = 'school-badge ' + node.school.toLowerCase();
            document.getElementById('spell-level').textContent = '???';
            document.getElementById('spell-cost').textContent = '???';
            document.getElementById('spell-type').textContent = '???';
            document.getElementById('spell-description').textContent = 'Unlock prerequisites to reveal.';
            document.getElementById('spell-effects').innerHTML = '<li>???</li>';
        } else {
            document.getElementById('spell-name').textContent = node.name || node.formId;
            document.getElementById('spell-school').textContent = node.school;
            document.getElementById('spell-school').className = 'school-badge ' + node.school.toLowerCase();
            document.getElementById('spell-level').textContent = node.level || '?';
            document.getElementById('spell-cost').textContent = node.cost || '?';
            document.getElementById('spell-type').textContent = node.type || '?';
            document.getElementById('spell-description').textContent = node.desc || 'No description.';

            const effectsList = document.getElementById('spell-effects');
            effectsList.innerHTML = '';
            const effects = Array.isArray(node.effects) ? node.effects : [];
            if (effects.length === 0) {
                effectsList.innerHTML = '<li>No effects</li>';
            } else {
                effects.forEach(e => {
                    const li = document.createElement('li');
                    li.textContent = typeof e === 'string' ? e : (e.name || JSON.stringify(e));
                    effectsList.appendChild(li);
                });
            }
        }

        const prereqList = document.getElementById('spell-prereqs');
        prereqList.innerHTML = '';
        node.prerequisites.forEach(id => {
            const n = this.data.nodes.find(x => x.id === id);
            const li = document.createElement('li');
            li.textContent = n && n.state !== 'locked' ? (n.name || n.formId) : '???';
            li.dataset.id = id;
            prereqList.appendChild(li);
        });

        const unlocksList = document.getElementById('spell-unlocks');
        unlocksList.innerHTML = '';
        node.children.forEach(id => {
            const n = this.data.nodes.find(x => x.id === id);
            const li = document.createElement('li');
            li.textContent = n && n.state !== 'locked' ? (n.name || n.formId) : '???';
            li.dataset.id = id;
            unlocksList.appendChild(li);
        });

        const stateBadge = document.getElementById('spell-state');
        stateBadge.textContent = node.state.charAt(0).toUpperCase() + node.state.slice(1);
        stateBadge.className = 'state-badge ' + node.state;

        document.getElementById('unlock-btn').disabled = node.state !== 'available';
    }

    selectById(id) {
        const node = this.data?.nodes.find(n => n.id === id);
        if (node) {
            this.renderer.selectNode(node);
            this.renderer.rotateSchoolToTop(node.school);
        }
    }

    setStatus(msg) {
        const el = document.getElementById('status-text');
        if (el) el.textContent = msg;
    }
}

// =============================================================================
// DEMO TREE (FormId-based for testing)
// =============================================================================

const DEMO_FORMID_TREE = {
    "version": "1.0",
    "schools": {
        "Alteration": {
            "root": "0x000DA746",
            "nodes": [
                { "formId": "0x000DA746", "children": ["0x00109111", "0x000C1E99", "0x000CB12D"], "tier": 1 },
                { "formId": "0x00109111", "children": ["0x000CDB70"], "tier": 2 },
                { "formId": "0x000C1E99", "children": ["0x000CD086"], "tier": 2 },
                { "formId": "0x000CD086", "children": ["0x000B62E6"], "tier": 3 },
                { "formId": "0x000B62E6", "children": [], "tier": 4 },
                { "formId": "0x000CDB70", "children": [], "tier": 3 },
                { "formId": "0x000CB12D", "children": [], "tier": 2 }
            ]
        },
        "Destruction": {
            "root": "0x000C969A",
            "nodes": [
                { "formId": "0x000C969A", "children": ["0x000C969B", "0x000C969D", "0x000C96A1"], "tier": 1 },
                { "formId": "0x000C969B", "children": ["0x0010815C"], "tier": 2 },
                { "formId": "0x000C969D", "children": ["0x000C969C"], "tier": 2 },
                { "formId": "0x000C96A1", "children": ["0x000C96A2"], "tier": 2 },
                { "formId": "0x0010815C", "children": ["0x0010F7ED"], "tier": 3 },
                { "formId": "0x000C969C", "children": ["0x000A1992"], "tier": 3 },
                { "formId": "0x000C96A2", "children": ["0x000BB96B"], "tier": 3 },
                { "formId": "0x0010F7ED", "children": [], "tier": 4 },
                { "formId": "0x000A1992", "children": [], "tier": 4 },
                { "formId": "0x000BB96B", "children": [], "tier": 4 }
            ]
        },
        "Restoration": {
            "root": "0x00012FCC",
            "nodes": [
                { "formId": "0x00012FCC", "children": ["0x000B62EF", "0x00101067", "0x000E8449"], "tier": 1 },
                { "formId": "0x000B62EF", "children": ["0x000B62EE"], "tier": 2 },
                { "formId": "0x00101067", "children": ["0x00101066"], "tier": 2 },
                { "formId": "0x000E8449", "children": ["0x000E0CD1"], "tier": 2 },
                { "formId": "0x000B62EE", "children": [], "tier": 3 },
                { "formId": "0x00101066", "children": [], "tier": 3 },
                { "formId": "0x000E0CD1", "children": [], "tier": 3 }
            ]
        },
        "Conjuration": {
            "root": "0x0010E38C",
            "nodes": [
                { "formId": "0x0010E38C", "children": ["0x00100E75", "0x000C96A0", "0x000C969E"], "tier": 1 },
                { "formId": "0x00100E75", "children": ["0x00100E76"], "tier": 2 },
                { "formId": "0x000C96A0", "children": ["0x000F9615"], "tier": 2 },
                { "formId": "0x000C969E", "children": ["0x0010105F"], "tier": 2 },
                { "formId": "0x00100E76", "children": [], "tier": 3 },
                { "formId": "0x000F9615", "children": [], "tier": 3 },
                { "formId": "0x0010105F", "children": [], "tier": 3 }
            ]
        },
        "Illusion": {
            "root": "0x00021143",
            "nodes": [
                { "formId": "0x00021143", "children": ["0x001092A2", "0x000E482F", "0x000B323E"], "tier": 1 },
                { "formId": "0x001092A2", "children": ["0x000B8341"], "tier": 2 },
                { "formId": "0x000E482F", "children": [], "tier": 2 },
                { "formId": "0x000B323E", "children": [], "tier": 2 },
                { "formId": "0x000B8341", "children": [], "tier": 3 }
            ]
        }
    }
};

// =============================================================================
// C++ BRIDGE FUNCTIONS
// =============================================================================

/**
 * Called by C++ to provide tree data
 */
window.updateTreeData = function(json) {
    console.log('[SpellTree] Received tree data');
    if (window.app) {
        window.app.loadTree(typeof json === 'string' ? JSON.parse(json) : json);
    }
};

/**
 * Called by C++ to provide spell info for a formId
 * Expected format: { formId, name, school, level, cost, type, effects, description }
 */
window.updateSpellInfo = function(json) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    if (data.formId) {
        SpellCache.set(data.formId, data);
        
        // If app is loaded, update any node with this formId and re-render
        if (window.app?.data) {
            const node = window.app.data.nodes.find(n => n.formId === data.formId);
            if (node) {
                window.app.parser.updateNodeFromCache(node);
                window.app.renderer.render();
            }
        }
    }
};

/**
 * Called by C++ to provide batch spell info
 * Expected format: array of spell info objects
 */
window.updateSpellInfoBatch = function(json) {
    const dataArray = typeof json === 'string' ? JSON.parse(json) : json;
    if (!Array.isArray(dataArray)) return;
    
    for (const data of dataArray) {
        if (data.formId) {
            SpellCache.set(data.formId, data);
        }
    }
    
    // Update all nodes and re-render
    if (window.app?.data) {
        for (const node of window.app.data.nodes) {
            window.app.parser.updateNodeFromCache(node);
        }
        window.app.renderer.render();
        window.app.setStatus(`Loaded ${window.app.data.nodes.length} spells`);
    }
};

/**
 * Called by C++ to update a spell's unlock state
 */
window.updateSpellState = function(formId, state) {
    if (window.app?.data) {
        const node = window.app.data.nodes.find(n => n.formId === formId || n.id === formId);
        if (node) {
            node.state = state;
            window.app.renderer.render();
            
            // Update counts
            document.getElementById('unlocked-count').textContent = 
                window.app.data.nodes.filter(n => n.state === 'unlocked').length;
        }
    }
};

/**
 * Called by C++ when Prisma is ready
 */
window.onPrismaReady = function() {
    console.log('[SpellTree] Prisma connection established');
    window.app?.setStatus('Ready - Load a spell tree');
    
    // Optionally auto-load saved tree
    if (window.callCpp) {
        window.callCpp('LoadSpellTree', '');
    }
};

// =============================================================================
// INITIALIZATION
// =============================================================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('[SpellTree] Initializing...');
    window.app = new SpellTreeApp();
});
