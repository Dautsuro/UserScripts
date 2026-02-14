// ==UserScript==
// @name        SugarCube Variable Editor
// @namespace   https://github.com/Dautsuro/userscripts
// @version     1.0
// @description Floating panel to inspect, edit, pin, and freeze SugarCube game variables
// @grant       GM_addStyle
// @grant       GM_getValue
// @grant       GM_setValue
// @author      Dautsuro
// @match       file:///G:/*
// @updateURL   https://raw.githubusercontent.com/Dautsuro/userscripts/main/sugarcube-variable-editor.user.js
// @downloadURL https://raw.githubusercontent.com/Dautsuro/userscripts/main/sugarcube-variable-editor.user.js
// ==/UserScript==

(function () {
    'use strict';

    // --- Constants ---
    const TICK_MS = 100;
    const REFRESH_EVERY = 5; // refresh UI every 5th tick (500ms)
    const POLL_INTERVAL = 200;
    const POLL_TIMEOUT = 15000;

    // --- Game name ---
    function getGameName() {
        const path = decodeURIComponent(location.pathname);
        const match = path.match(/^\/G:\/([^/]+)/);
        return match ? match[1] : '';
    }

    const gameName = getGameName();

    // --- Persistence ---
    function loadPinned() {
        return GM_getValue('sve_pinned', []);
    }
    function savePinned(arr) {
        GM_setValue('sve_pinned', arr);
    }
    function loadRecurrent() {
        return GM_getValue('sve_recurrent', {});
    }
    function saveRecurrent(obj) {
        GM_setValue('sve_recurrent', obj);
    }
    function loadFrozen() {
        return GM_getValue('sve_frozen::' + gameName, {});
    }
    function saveFrozen(obj) {
        GM_setValue('sve_frozen::' + gameName, obj);
    }

    // --- Recurrent detection ---
    function updateRecurrentRegistry(varNames) {
        const rec = loadRecurrent();
        const pinned = loadPinned();
        let pinChanged = false;

        for (const name of varNames) {
            if (!rec[name]) rec[name] = [];
            if (!rec[name].includes(gameName)) {
                rec[name].push(gameName);
            }
            if (rec[name].length >= 2 && !pinned.includes(name)) {
                pinned.push(name);
                pinChanged = true;
            }
        }

        saveRecurrent(rec);
        if (pinChanged) savePinned(pinned);
    }

    // --- SVG Icons ---
    const ICON_PIN = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 11V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v7"/><path d="M5 11h14l-1.5 6h-11z"/></svg>`;
    const ICON_FREEZE = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"/><path d="M2 12h20"/><path d="m4.93 4.93 14.14 14.14"/><path d="m19.07 4.93-14.14 14.14"/></svg>`;
    const ICON_COLLAPSE = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>`;
    const ICON_EXPAND = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;

    // --- CSS ---
    GM_addStyle(`
        #sve-toggle-btn {
            position: fixed;
            right: 0;
            top: 50%;
            transform: translateY(-50%);
            z-index: 99999;
            background: #1a1a2e;
            color: #e2e8f0;
            border: 1px solid #334155;
            border-right: none;
            border-radius: 6px 0 0 6px;
            padding: 8px 6px;
            cursor: pointer;
            font-size: 11px;
            writing-mode: vertical-rl;
            text-orientation: mixed;
            letter-spacing: 1px;
            font-family: monospace;
            transition: background 0.2s;
        }
        #sve-toggle-btn:hover { background: #334155; }

        #sve-panel {
            position: fixed;
            top: 60px;
            right: -400px;
            width: 380px;
            max-height: 85vh;
            z-index: 99998;
            background: #1a1a2e;
            border: 1px solid #334155;
            border-radius: 8px;
            font-family: 'Segoe UI', system-ui, sans-serif;
            font-size: 12px;
            color: #e2e8f0;
            display: flex;
            flex-direction: column;
            box-shadow: 0 8px 32px rgba(0,0,0,0.5);
            transition: right 0.3s ease;
        }
        #sve-panel.sve-open { right: 12px; }

        #sve-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            background: #0f172a;
            border-radius: 8px 8px 0 0;
            cursor: grab;
            user-select: none;
            border-bottom: 1px solid #334155;
        }
        #sve-header:active { cursor: grabbing; }
        #sve-header-title {
            font-weight: 600;
            font-size: 13px;
            flex: 1;
        }
        #sve-collapse-btn {
            background: none;
            border: none;
            color: #e2e8f0;
            cursor: pointer;
            padding: 2px;
            display: flex;
            align-items: center;
        }

        #sve-search {
            margin: 8px 12px;
            padding: 6px 10px;
            background: #0f172a;
            border: 1px solid #334155;
            border-radius: 4px;
            color: #e2e8f0;
            font-size: 12px;
            outline: none;
        }
        #sve-search::placeholder { color: #64748b; }
        #sve-search:focus { border-color: #3b82f6; }

        #sve-var-list {
            overflow-y: auto;
            max-height: 60vh;
            padding: 0 8px 8px;
        }
        #sve-var-list::-webkit-scrollbar { width: 6px; }
        #sve-var-list::-webkit-scrollbar-track { background: transparent; }
        #sve-var-list::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
        #sve-var-list::-webkit-scrollbar-thumb:hover { background: #475569; }

        .sve-section-label {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: #64748b;
            padding: 8px 4px 4px;
            font-weight: 600;
        }

        .sve-var-row {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 6px;
            border-radius: 4px;
            border-left: 3px solid transparent;
            margin-bottom: 2px;
            transition: background 0.15s;
        }
        .sve-var-row:hover { background: rgba(255,255,255,0.03); }
        .sve-var-row.sve-pinned { border-left-color: #22c55e; }
        .sve-var-row.sve-frozen { border-left-color: #3b82f6; }
        .sve-var-row.sve-pinned.sve-frozen { border-left-color: #a855f7; }

        .sve-var-name {
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-family: monospace;
            font-size: 11px;
        }
        .sve-recurrent-badge {
            display: inline-block;
            background: #7c3aed;
            color: #fff;
            font-size: 9px;
            padding: 1px 5px;
            border-radius: 8px;
            margin-left: 4px;
            vertical-align: middle;
            white-space: nowrap;
        }

        .sve-var-value {
            flex: 0 0 100px;
        }
        .sve-var-row:has(.sve-obj-tree) .sve-var-value {
            flex: 1 1 auto;
        }
        .sve-var-row:has(.sve-obj-tree) {
            flex-wrap: wrap;
        }
        .sve-var-row:has(.sve-obj-tree) .sve-var-value {
            flex-basis: 100%;
            padding-left: 8px;
        }
        .sve-var-value input[type="text"],
        .sve-var-value input[type="number"] {
            width: 100%;
            padding: 3px 6px;
            background: #0f172a;
            border: 1px solid #334155;
            border-radius: 3px;
            color: #e2e8f0;
            font-size: 11px;
            font-family: monospace;
            outline: none;
            box-sizing: border-box;
        }
        .sve-var-value input:focus { border-color: #3b82f6; }
        .sve-var-value input[type="checkbox"] {
            accent-color: #3b82f6;
            width: 16px;
            height: 16px;
            cursor: pointer;
        }
        .sve-var-value .sve-readonly {
            font-family: monospace;
            font-size: 10px;
            color: #94a3b8;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: 100px;
            display: inline-block;
            cursor: default;
        }

        .sve-obj-toggle {
            background: none;
            border: none;
            color: #64748b;
            cursor: pointer;
            font-family: monospace;
            font-size: 11px;
            padding: 2px 4px;
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }
        .sve-obj-toggle:hover { color: #e2e8f0; }
        .sve-obj-toggle .sve-obj-preview {
            color: #64748b;
            font-size: 10px;
            max-width: 60px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            display: inline-block;
            vertical-align: middle;
        }

        .sve-obj-tree {
            padding: 2px 0 2px 12px;
            border-left: 1px dashed #334155;
            margin-left: 6px;
            margin-top: 2px;
        }
        .sve-obj-prop {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 2px 0;
            font-size: 11px;
        }
        .sve-obj-prop-name {
            color: #94a3b8;
            font-family: monospace;
            font-size: 10px;
            min-width: 50px;
            flex-shrink: 0;
        }
        .sve-obj-prop input[type="text"],
        .sve-obj-prop input[type="number"] {
            flex: 1;
            min-width: 0;
            padding: 2px 6px;
            background: #0f172a;
            border: 1px solid #334155;
            border-radius: 3px;
            color: #e2e8f0;
            font-size: 11px;
            font-family: monospace;
            outline: none;
            box-sizing: border-box;
        }
        .sve-obj-prop input:focus { border-color: #3b82f6; }
        .sve-obj-prop input[type="checkbox"] {
            accent-color: #3b82f6;
            width: 14px;
            height: 14px;
            cursor: pointer;
        }

        .sve-var-actions {
            display: flex;
            gap: 2px;
            flex-shrink: 0;
        }
        .sve-var-actions button {
            background: none;
            border: 1px solid transparent;
            color: #64748b;
            cursor: pointer;
            padding: 2px 4px;
            border-radius: 3px;
            display: flex;
            align-items: center;
            transition: color 0.15s, border-color 0.15s;
        }
        .sve-var-actions button:hover { color: #e2e8f0; border-color: #334155; }
        .sve-var-actions button.sve-active-pin { color: #22c55e; }
        .sve-var-actions button.sve-active-freeze { color: #3b82f6; }
    `);

    // --- State ---
    let scVars = null; // reference to SugarCube.State.active.variables
    let panelOpen = false;
    let collapsed = false;
    let searchFilter = '';
    /** Tracks which roots were already auto-expanded for the current search */
    const searchExpandedRoots = new Set();
    let frozenCache = {};
    let tickCount = 0;

    /** @type {Map<string, HTMLElement>} */
    const rowMap = new Map();

    // --- Panel construction ---
    function buildToggleButton() {
        const btn = document.createElement('div');
        btn.id = 'sve-toggle-btn';
        btn.textContent = 'VAR EDITOR';
        btn.addEventListener('click', () => {
            panelOpen = !panelOpen;
            panel.classList.toggle('sve-open', panelOpen);
        });
        document.body.appendChild(btn);
        return btn;
    }

    function buildPanel() {
        const el = document.createElement('div');
        el.id = 'sve-panel';
        el.innerHTML = `
            <div id="sve-header">
                <span id="sve-header-title">SugarCube Vars</span>
                <button id="sve-collapse-btn" title="Collapse">${ICON_COLLAPSE}</button>
            </div>
            <input id="sve-search" type="text" placeholder="Filter variables..." />
            <div id="sve-var-list"></div>
        `;
        document.body.appendChild(el);

        el.querySelector('#sve-collapse-btn').addEventListener('click', () => {
            collapsed = !collapsed;
            el.querySelector('#sve-search').style.display = collapsed ? 'none' : '';
            el.querySelector('#sve-var-list').style.display = collapsed ? 'none' : '';
            el.querySelector('#sve-collapse-btn').innerHTML = collapsed ? ICON_EXPAND : ICON_COLLAPSE;
        });

        el.querySelector('#sve-search').addEventListener('input', (e) => {
            searchFilter = e.target.value.toLowerCase();
            searchExpandedRoots.clear();
            renderPanel();
        });

        initDrag(el);
        return el;
    }

    function initDrag(panel) {
        const header = panel.querySelector('#sve-header');
        let dragging = false, offsetX = 0, offsetY = 0;

        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('button')) return;
            dragging = true;
            const rect = panel.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            panel.style.transition = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            panel.style.left = (e.clientX - offsetX) + 'px';
            panel.style.top = (e.clientY - offsetY) + 'px';
            panel.style.right = 'auto';
        });

        document.addEventListener('mouseup', () => {
            if (dragging) {
                dragging = false;
                panel.style.transition = '';
            }
        });
    }

    // --- Rendering ---
    function getVarType(val) {
        if (val === null || val === undefined) return 'string';
        if (typeof val === 'boolean') return 'boolean';
        if (typeof val === 'number') return 'number';
        if (typeof val === 'object') return 'object';
        return 'string';
    }

    /** @type {Set<string>} — tracks which object vars are currently expanded */
    const expandedObjects = new Set();

    function createPropInput(obj, key, onCommit) {
        const val = obj[key];
        const type = getVarType(val);

        if (type === 'boolean') {
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = val;
            cb.addEventListener('change', () => { obj[key] = cb.checked; onCommit(); });
            return cb;
        }
        if (type === 'object') {
            // Nested object — show read-only summary (one level of expansion is enough for most cases)
            const span = document.createElement('span');
            span.className = 'sve-readonly';
            const json = JSON.stringify(val);
            span.textContent = json.length > 30 ? json.slice(0, 27) + '...' : json;
            span.title = json;
            return span;
        }
        const inp = document.createElement('input');
        inp.type = type === 'number' ? 'number' : 'text';
        inp.value = val ?? '';
        if (type === 'number') inp.step = 'any';
        const commit = () => {
            if (type === 'number') {
                const n = Number(inp.value);
                if (!isNaN(n)) { obj[key] = n; onCommit(); }
            } else {
                obj[key] = inp.value;
                onCommit();
            }
        };
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit(); inp.blur(); } });
        inp.addEventListener('blur', commit);
        return inp;
    }

    function buildObjectTree(varName, obj, onCommit) {
        const tree = document.createElement('div');
        tree.className = 'sve-obj-tree';
        if (obj == null) return tree;
        const keys = Object.keys(obj).sort();
        for (const key of keys) {
            const val = obj[key];
            const nestedType = getVarType(val);
            const dotPath = varName + '.' + key;

            if (nestedType === 'object' && val !== null) {
                // Nested expandable
                const row = document.createElement('div');
                row.className = 'sve-obj-prop';
                const toggle = document.createElement('button');
                toggle.className = 'sve-obj-toggle';
                const arrow = expandedObjects.has(dotPath) ? '\u25BC' : '\u25B6';
                const preview = JSON.stringify(val);
                toggle.innerHTML = arrow + ' <span class="sve-obj-prop-name">' + key + '</span> <span class="sve-obj-preview">' + (preview.length > 20 ? preview.slice(0, 17) + '...' : preview) + '</span>';
                toggle.addEventListener('click', () => {
                    if (expandedObjects.has(dotPath)) expandedObjects.delete(dotPath);
                    else expandedObjects.add(dotPath);
                    renderPanel();
                });
                row.appendChild(toggle);
                tree.appendChild(row);
                if (expandedObjects.has(dotPath)) {
                    tree.appendChild(buildObjectTree(dotPath, val, onCommit));
                }
            } else {
                const pinnedSet = new Set(loadPinned());
                const isPinnedProp = pinnedSet.has(dotPath);
                const isFrozenProp = dotPath in frozenCache;
                const row = document.createElement('div');
                row.className = 'sve-obj-prop';
                if (isPinnedProp && isFrozenProp) row.style.borderLeft = '2px solid #a855f7';
                else if (isFrozenProp) row.style.borderLeft = '2px solid #3b82f6';
                else if (isPinnedProp) row.style.borderLeft = '2px solid #22c55e';

                const nameSpan = document.createElement('span');
                nameSpan.className = 'sve-obj-prop-name';
                nameSpan.textContent = key;
                row.appendChild(nameSpan);
                row.appendChild(createPropInput(obj, key, onCommit));

                const btnStyle = 'background:none;border:1px solid transparent;cursor:pointer;padding:2px 4px;border-radius:3px;display:flex;align-items:center;flex-shrink:0;';

                const pinBtn = document.createElement('button');
                pinBtn.innerHTML = ICON_PIN;
                pinBtn.title = isPinnedProp ? 'Unpin' : 'Pin';
                pinBtn.style.cssText = btnStyle + 'color:' + (isPinnedProp ? '#22c55e' : '#64748b') + ';';
                pinBtn.addEventListener('click', () => toggleDeepPin(dotPath));
                row.appendChild(pinBtn);

                const freezeBtn = document.createElement('button');
                freezeBtn.innerHTML = ICON_FREEZE;
                freezeBtn.title = isFrozenProp ? 'Unfreeze' : 'Freeze';
                freezeBtn.style.cssText = btnStyle + 'color:' + (isFrozenProp ? '#3b82f6' : '#64748b') + ';';
                freezeBtn.addEventListener('click', () => toggleDeepFreeze(dotPath, obj, key));
                row.appendChild(freezeBtn);

                tree.appendChild(row);
            }
        }
        return tree;
    }

    function createInput(varName, value, type) {
        if (type === 'boolean') {
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = value;
            cb.addEventListener('change', () => commitEdit(varName, cb.checked));
            return cb;
        }
        if (type === 'object') {
            const wrapper = document.createElement('div');
            const toggle = document.createElement('button');
            toggle.className = 'sve-obj-toggle';
            const expanded = expandedObjects.has(varName);
            const preview = JSON.stringify(value);
            toggle.innerHTML = (expanded ? '\u25BC' : '\u25B6') + ' <span class="sve-obj-preview">' + (preview.length > 20 ? preview.slice(0, 17) + '...' : preview) + '</span>';
            toggle.addEventListener('click', () => {
                if (expandedObjects.has(varName)) expandedObjects.delete(varName);
                else expandedObjects.add(varName);
                renderPanel();
            });
            wrapper.appendChild(toggle);
            if (expanded) {
                const onCommit = () => {
                    // Object is edited in-place; sync freeze cache if frozen
                    if (varName in frozenCache) {
                        frozenCache[varName] = scVars[varName];
                        const frozen = loadFrozen();
                        frozen[varName] = scVars[varName];
                        saveFrozen(frozen);
                    }
                };
                wrapper.appendChild(buildObjectTree(varName, value, onCommit));
            }
            return wrapper;
        }
        const inp = document.createElement('input');
        inp.type = type === 'number' ? 'number' : 'text';
        inp.value = value ?? '';
        if (type === 'number') inp.step = 'any';
        inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                commitEdit(varName, inp.value);
                inp.blur();
            }
        });
        inp.addEventListener('blur', () => commitEdit(varName, inp.value));
        return inp;
    }

    function buildVarRow(varName, value, isPinned, isFrozen, recCount) {
        const row = document.createElement('div');
        row.className = 'sve-var-row';
        if (isPinned) row.classList.add('sve-pinned');
        if (isFrozen) row.classList.add('sve-frozen');

        const nameEl = document.createElement('span');
        nameEl.className = 'sve-var-name';
        nameEl.textContent = varName;
        if (recCount >= 2) {
            const badge = document.createElement('span');
            badge.className = 'sve-recurrent-badge';
            badge.textContent = recCount + ' games';
            nameEl.appendChild(badge);
        }
        nameEl.title = varName;

        const valEl = document.createElement('span');
        valEl.className = 'sve-var-value';
        const type = getVarType(value);
        valEl.appendChild(createInput(varName, value, type));

        const actEl = document.createElement('span');
        actEl.className = 'sve-var-actions';

        const pinBtn = document.createElement('button');
        pinBtn.innerHTML = ICON_PIN;
        pinBtn.title = isPinned ? 'Unpin' : 'Pin';
        if (isPinned) pinBtn.classList.add('sve-active-pin');
        pinBtn.addEventListener('click', () => togglePin(varName));

        const freezeBtn = document.createElement('button');
        freezeBtn.innerHTML = ICON_FREEZE;
        freezeBtn.title = isFrozen ? 'Unfreeze' : 'Freeze';
        if (isFrozen) freezeBtn.classList.add('sve-active-freeze');
        freezeBtn.addEventListener('click', () => toggleFreeze(varName));

        actEl.appendChild(pinBtn);
        actEl.appendChild(freezeBtn);

        row.appendChild(nameEl);
        row.appendChild(valEl);
        row.appendChild(actEl);
        return row;
    }

    function updateRowValue(row, varName, value) {
        const valEl = row.querySelector('.sve-var-value');
        if (!valEl) return;

        const type = getVarType(value);
        const hasTree = !!valEl.querySelector('.sve-obj-tree');
        const isExpanded = expandedObjects.has(varName);

        // Expansion state changed or expanded tree needs refresh — rebuild
        if (type === 'object' && (hasTree !== isExpanded)) {
            if (valEl.contains(document.activeElement)) return;
            valEl.innerHTML = '';
            valEl.appendChild(createInput(varName, value, type));
            return;
        }

        // Expanded object — skip if user is editing inside
        if (type === 'object' && isExpanded) {
            if (valEl.contains(document.activeElement)) return;
            valEl.innerHTML = '';
            valEl.appendChild(createInput(varName, value, type));
            return;
        }

        const existing = valEl.querySelector('input, .sve-readonly, .sve-obj-toggle');
        if (!existing) return;

        // Skip if user is actively editing
        if (existing === document.activeElement) return;

        if (type === 'boolean' && existing.type === 'checkbox') {
            existing.checked = value;
        } else if (type === 'object') {
            // Collapsed object — update preview
            const preview = JSON.stringify(value);
            const previewSpan = valEl.querySelector('.sve-obj-preview');
            if (previewSpan) {
                previewSpan.textContent = preview.length > 20 ? preview.slice(0, 17) + '...' : preview;
            }
        } else if (existing.tagName === 'INPUT') {
            existing.value = value ?? '';
        } else {
            // Type changed, rebuild input
            valEl.innerHTML = '';
            valEl.appendChild(createInput(varName, value, type));
        }
    }

    function objectHasMatchingKey(obj, filter, depth) {
        if (!obj || typeof obj !== 'object' || (depth || 0) > 5) return false;
        for (const key of Object.keys(obj)) {
            if (key.toLowerCase().includes(filter)) return true;
            if (obj[key] && typeof obj[key] === 'object') {
                if (objectHasMatchingKey(obj[key], filter, (depth || 0) + 1)) return true;
            }
        }
        return false;
    }

    function renderPanel() {
        if (!scVars || collapsed) return;

        const list = document.getElementById('sve-var-list');
        if (!list) return;

        // Skip full rebuild if user is editing an input (not buttons)
        const focused = document.activeElement;
        if (focused && list.contains(focused) && focused.tagName === 'INPUT') return;

        const pinned = new Set(loadPinned());
        const frozen = loadFrozen();
        const recurrent = loadRecurrent();

        const allNames = Object.keys(scVars);
        const filtered = searchFilter
            ? allNames.filter(n => {
                if (n.toLowerCase().includes(searchFilter)) return true;
                // Also match nested object keys
                const val = scVars[n];
                if (val && typeof val === 'object') {
                    if (objectHasMatchingKey(val, searchFilter)) {
                        // Auto-expand only once per search, user can collapse after
                        if (!searchExpandedRoots.has(n)) {
                            searchExpandedRoots.add(n);
                            expandedObjects.add(n);
                        }
                        return true;
                    }
                }
                return false;
            })
            : allNames;

        // Build sets of top-level vars that have deep pinned/frozen properties
        const hasDeepPin = new Set();
        const hasDeepFreeze = new Set();
        for (const p of pinned) {
            if (p.includes('.')) hasDeepPin.add(p.split('.')[0]);
        }
        for (const f of Object.keys(frozen)) {
            if (f.includes('.')) hasDeepFreeze.add(f.split('.')[0]);
        }

        // Sort: pinned/frozen first, then alphabetical
        const pinnedOrFrozen = [];
        const rest = [];
        for (const name of filtered) {
            if (pinned.has(name) || name in frozen || hasDeepPin.has(name) || hasDeepFreeze.has(name)) {
                pinnedOrFrozen.push(name);
            } else {
                rest.push(name);
            }
        }
        pinnedOrFrozen.sort();
        rest.sort();

        const ordered = [...pinnedOrFrozen, ...rest];

        // Track which rows are still present
        const seen = new Set();

        // Rebuild sections
        let html = '';
        const fragment = document.createDocumentFragment();

        if (pinnedOrFrozen.length > 0) {
            const label = document.createElement('div');
            label.className = 'sve-section-label';
            label.textContent = 'Pinned & Frozen';
            fragment.appendChild(label);

            for (const name of pinnedOrFrozen) {
                seen.add(name);
                const existingRow = rowMap.get(name);
                if (existingRow) {
                    updateRowValue(existingRow, name, scVars[name]);
                    // Update classes
                    existingRow.classList.toggle('sve-pinned', pinned.has(name));
                    existingRow.classList.toggle('sve-frozen', name in frozen);
                    fragment.appendChild(existingRow);
                } else {
                    const row = buildVarRow(name, scVars[name], pinned.has(name), name in frozen, recurrent[name]?.length || 0);
                    rowMap.set(name, row);
                    fragment.appendChild(row);
                }
            }
        }

        if (rest.length > 0) {
            const label = document.createElement('div');
            label.className = 'sve-section-label';
            label.textContent = 'All Variables';
            fragment.appendChild(label);

            for (const name of rest) {
                seen.add(name);
                const existingRow = rowMap.get(name);
                if (existingRow) {
                    updateRowValue(existingRow, name, scVars[name]);
                    existingRow.classList.toggle('sve-pinned', pinned.has(name));
                    existingRow.classList.toggle('sve-frozen', name in frozen);
                    fragment.appendChild(existingRow);
                } else {
                    const row = buildVarRow(name, scVars[name], false, false, recurrent[name]?.length || 0);
                    rowMap.set(name, row);
                    fragment.appendChild(row);
                }
            }
        }

        // Remove stale rows
        for (const [name] of rowMap) {
            if (!seen.has(name)) rowMap.delete(name);
        }

        list.innerHTML = '';
        list.appendChild(fragment);
    }

    // --- User actions ---
    function commitEdit(varName, rawValue) {
        if (!scVars) return;
        const current = scVars[varName];
        const type = getVarType(current);

        let parsed;
        if (type === 'boolean') {
            parsed = !!rawValue;
        } else if (type === 'number') {
            parsed = Number(rawValue);
            if (isNaN(parsed)) return;
        } else {
            parsed = String(rawValue);
        }

        scVars[varName] = parsed;

        // If frozen, update lock value too
        if (varName in frozenCache) {
            frozenCache[varName] = parsed;
            const frozen = loadFrozen();
            frozen[varName] = parsed;
            saveFrozen(frozen);
        }
    }

    function togglePin(varName) {
        const pinned = loadPinned();
        const idx = pinned.indexOf(varName);
        if (idx >= 0) {
            pinned.splice(idx, 1);
        } else {
            pinned.push(varName);
        }
        savePinned(pinned);
        renderPanel();
    }

    function toggleFreeze(varName) {
        const frozen = loadFrozen();
        if (varName in frozen) {
            delete frozen[varName];
            delete frozenCache[varName];
        } else {
            const val = scVars ? scVars[varName] : null;
            frozen[varName] = val;
            frozenCache[varName] = val;
        }
        saveFrozen(frozen);
        renderPanel();
    }

    function toggleDeepPin(dotPath) {
        const pinned = loadPinned();
        const idx = pinned.indexOf(dotPath);
        if (idx >= 0) {
            pinned.splice(idx, 1);
        } else {
            pinned.push(dotPath);
            // Auto-expand parent so the pinned property is visible
            expandedObjects.add(dotPath.split('.')[0]);
        }
        savePinned(pinned);
        renderPanel();
    }

    function toggleDeepFreeze(dotPath, obj, key) {
        const frozen = loadFrozen();
        if (dotPath in frozen) {
            delete frozen[dotPath];
            delete frozenCache[dotPath];
        } else {
            const val = obj[key];
            frozen[dotPath] = val;
            frozenCache[dotPath] = val;
            // Auto-expand parent so the frozen property is visible
            expandedObjects.add(dotPath.split('.')[0]);
        }
        saveFrozen(frozen);
        renderPanel();
    }

    /** Resolve a dot-path like "charPc.name" to { target: charPcObj, key: "name" } */
    function resolvePath(path) {
        const parts = path.split('.');
        const rootName = parts[0];
        let target = scVars;
        for (let i = 0; i < parts.length - 1; i++) {
            target = i === 0 ? scVars[parts[0]] : target[parts[i]];
            if (target == null || typeof target !== 'object') return null;
        }
        return { target: parts.length === 1 ? scVars : target, key: parts[parts.length - 1] };
    }

    /** Re-fetch the live variables reference (SugarCube replaces State.active on navigation) */
    function refreshVarsRef() {
        const live = pageWindow.SugarCube?.State?.active?.variables;
        if (live) scVars = live;
    }

    // --- Freeze engine ---
    function applyFreezes() {
        refreshVarsRef();
        if (!scVars) return;
        for (const [path, val] of Object.entries(frozenCache)) {
            if (!path.includes('.')) {
                // Top-level variable
                if (scVars[path] !== val) {
                    scVars[path] = val;
                }
            } else {
                // Dot-path property freeze
                const resolved = resolvePath(path);
                if (resolved && resolved.target[resolved.key] !== val) {
                    resolved.target[resolved.key] = val;
                }
            }
        }
    }

    // --- Main tick ---
    function startEngine() {
        frozenCache = loadFrozen();

        setInterval(() => {
            tickCount++;
            applyFreezes();
            if (panelOpen && !collapsed && tickCount % REFRESH_EVERY === 0) {
                renderPanel();
            }
        }, TICK_MS);
    }

    // --- Init ---
    let panel;

    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    function init() {
        scVars = pageWindow.SugarCube.State.active.variables;

        buildToggleButton();
        panel = buildPanel();

        const varNames = Object.keys(scVars);
        updateRecurrentRegistry(varNames);

        // Listen for passage changes
        const $ = pageWindow.jQuery || pageWindow.$;
        if ($) {
            $(document).on(':passageend', () => {
                updateRecurrentRegistry(Object.keys(scVars));
            });
        }

        startEngine();
    }

    function waitForSugarCube() {
        const start = Date.now();
        const timer = setInterval(() => {
            if (pageWindow.SugarCube?.State?.active?.variables) {
                clearInterval(timer);
                init();
            } else if (Date.now() - start > POLL_TIMEOUT) {
                clearInterval(timer);
            }
        }, POLL_INTERVAL);
    }

    waitForSugarCube();
})();
