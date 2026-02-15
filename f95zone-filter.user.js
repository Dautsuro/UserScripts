// ==UserScript==
// @name        F95zone Game Filter
// @namespace   https://github.com/Dautsuro/userscripts
// @version     1.1
// @description Filters f95zone game listings by rating and review count, color-coding tiles based on quality thresholds
// @icon        https://www.google.com/s2/favicons?sz=64&domain=f95zone.to
// @grant       GM_setValue
// @grant       GM_getValue
// @grant       GM_addStyle
// @author      Dautsuro
// @match       https://f95zone.to/sam/latest_alpha/*
// @updateURL   https://raw.githubusercontent.com/Dautsuro/userscripts/main/f95zone-filter.user.js
// @downloadURL https://raw.githubusercontent.com/Dautsuro/userscripts/main/f95zone-filter.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ── Constants ──────────────────────────────────────────────────────────────

    const CACHE_DURATION = 3 * 24 * 60 * 60 * 1000; // 3 days
    const DEBOUNCE_MS = 300;

    const DEFAULT_THRESHOLDS = [
        { maxReviews: 5,        minRating: Infinity },  // < 5 reviews → always refuse
        { maxReviews: 10,       minRating: 4.5 },
        { maxReviews: 25,       minRating: 4.2 },
        { maxReviews: 100,      minRating: 3.8 },
        { maxReviews: Infinity, minRating: 3.8 },
    ];

    const DEFAULT_SETTINGS = {
        thresholds: DEFAULT_THRESHOLDS,
        hideRefused: false,
    };

    const Status = Object.freeze({
        PENDING: 'pending',
        ACCEPTED: 'accepted',
        REFUSED: 'refused',
    });

    // ── State ──────────────────────────────────────────────────────────────────

    let settings = loadSettings();

    // ── CSS Injection ──────────────────────────────────────────────────────────

    GM_addStyle(`
        /* Status indicators */
        .resource-tile[data-wf-status="${Status.PENDING}"] {
            border: 2px solid #f59e0b !important;
            animation: wf-pulse 1.5s ease-in-out infinite;
            transition: opacity 0.4s, border-color 0.4s;
        }
        .resource-tile[data-wf-status="${Status.ACCEPTED}"] {
            border: 2px solid #22c55e !important;
            transition: opacity 0.4s, border-color 0.4s;
        }
        .resource-tile[data-wf-status="${Status.REFUSED}"] {
            border: 2px solid #ef4444 !important;
            opacity: 0.3;
            transition: opacity 0.4s, border-color 0.4s;
        }
        .resource-tile[data-wf-status="${Status.REFUSED}"] img {
            filter: grayscale(1);
        }
        .resource-tile[data-wf-status="${Status.REFUSED}"].wf-hide {
            display: none !important;
        }

        @keyframes wf-pulse {
            0%, 100% { border-color: #f59e0b; }
            50% { border-color: #fbbf24; }
        }

        /* Rating badge */
        .wf-badge {
            position: absolute;
            top: 6px;
            left: 6px;
            padding: 3px 8px;
            border-radius: 10px;
            font-family: Arial, sans-serif;
            font-size: 11px;
            font-weight: 700;
            color: #fff;
            white-space: nowrap;
            box-shadow: 0 1px 4px rgba(0,0,0,0.4);
            z-index: 10;
            pointer-events: none;
            line-height: 1.4;
        }
        .wf-badge--pending  { background: #f59e0b; }
        .wf-badge--accepted { background: #16a34a; }
        .wf-badge--refused  { background: #dc2626; }

        /* Ensure tile is positioned for badge */
        div.resource-tile {
            position: relative !important;
        }

        /* ── Settings panel ─────────────────────────────────────────────────── */
        #wf-gear-btn {
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 100000;
            width: 44px;
            height: 44px;
            border: none;
            border-radius: 50%;
            background: #1a1a2e;
            color: #fff;
            font-size: 22px;
            cursor: pointer;
            box-shadow: 0 2px 10px rgba(0,0,0,0.35);
            display: flex;
            align-items: center;
            justify-content: center;
            transition: transform 0.2s;
        }
        #wf-gear-btn:hover { transform: rotate(45deg); }

        #wf-settings-panel {
            position: fixed;
            bottom: 76px;
            right: 20px;
            z-index: 99999;
            width: 340px;
            background: #1a1a2e;
            color: #e2e8f0;
            border-radius: 12px;
            box-shadow: 0 8px 30px rgba(0,0,0,0.45);
            padding: 20px;
            font-family: Arial, sans-serif;
            font-size: 14px;
            display: none;
            transform-origin: bottom right;
            animation: wf-slide-up 0.2s ease-out;
        }
        @keyframes wf-slide-up {
            from { opacity: 0; transform: translateY(12px); }
            to   { opacity: 1; transform: translateY(0); }
        }
        #wf-settings-panel.wf-open { display: block; }
        #wf-settings-panel h3 {
            margin: 0 0 14px;
            font-size: 16px;
            font-weight: 700;
            color: #fff;
        }

        .wf-threshold-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 8px;
        }
        .wf-threshold-row label {
            flex: 1;
            font-size: 13px;
            color: #94a3b8;
        }
        .wf-threshold-row input[type="number"] {
            width: 60px;
            padding: 4px 6px;
            border: 1px solid #334155;
            border-radius: 6px;
            background: #0f172a;
            color: #e2e8f0;
            font-size: 13px;
            text-align: center;
        }

        .wf-toggle-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin: 14px 0 16px;
        }
        .wf-toggle-row label { font-size: 13px; color: #94a3b8; }

        .wf-btn-row {
            display: flex;
            gap: 8px;
        }
        .wf-btn-row button {
            flex: 1;
            padding: 7px 0;
            border: none;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.15s;
        }
        #wf-save-btn   { background: #22c55e; color: #fff; }
        #wf-save-btn:hover { background: #16a34a; }
        #wf-reset-btn  { background: #334155; color: #cbd5e1; }
        #wf-reset-btn:hover { background: #475569; }
    `);

    // ── Settings persistence ───────────────────────────────────────────────────

    function loadSettings() {
        const saved = GM_getValue('f95_settings');
        if (!saved) return structuredClone(DEFAULT_SETTINGS);
        for (const t of saved.thresholds) {
            if (t.maxReviews === null || t.maxReviews === 'Infinity') t.maxReviews = Infinity;
            if (t.minRating === null || t.minRating === 'Infinity') t.minRating = Infinity;
        }
        return saved;
    }

    function saveSettings(s) {
        const serializable = structuredClone(s);
        for (const t of serializable.thresholds) {
            if (t.maxReviews === Infinity) t.maxReviews = 'Infinity';
            if (t.minRating === Infinity) t.minRating = 'Infinity';
        }
        GM_setValue('f95_settings', serializable);
        settings = s;
    }

    // ── Settings panel UI ──────────────────────────────────────────────────────

    function buildSettingsPanel() {
        const gear = document.createElement('button');
        gear.id = 'wf-gear-btn';
        gear.textContent = '\u2699';
        gear.title = 'F95zone Game Filter Settings';
        document.body.appendChild(gear);

        const panel = document.createElement('div');
        panel.id = 'wf-settings-panel';

        const thresholdLabels = [
            '< 5 reviews',
            '< 10 reviews',
            '< 25 reviews',
            '< 100 reviews',
            '\u2265 100 reviews',
        ];

        panel.innerHTML = `
            <h3>\u2699 F95zone Game Filter</h3>
            ${settings.thresholds.map((t, i) => `
                <div class="wf-threshold-row">
                    <label>${thresholdLabels[i]}</label>
                    <input type="number" step="0.1" min="0" max="5"
                           data-idx="${i}"
                           value="${t.minRating === Infinity ? '' : t.minRating}"
                           placeholder="refuse all">
                </div>
            `).join('')}
            <div class="wf-toggle-row">
                <label>Hide refused games entirely</label>
                <input type="checkbox" id="wf-hide-toggle" ${settings.hideRefused ? 'checked' : ''}>
            </div>
            <div class="wf-btn-row">
                <button id="wf-save-btn">Save</button>
                <button id="wf-reset-btn">Reset</button>
            </div>
        `;
        document.body.appendChild(panel);

        gear.addEventListener('click', () => panel.classList.toggle('wf-open'));

        document.addEventListener('click', (e) => {
            if (!panel.contains(e.target) && e.target !== gear) {
                panel.classList.remove('wf-open');
            }
        });

        panel.querySelector('#wf-save-btn').addEventListener('click', () => {
            const newSettings = structuredClone(settings);
            panel.querySelectorAll('input[data-idx]').forEach((input) => {
                const idx = parseInt(input.dataset.idx);
                const val = input.value.trim();
                newSettings.thresholds[idx].minRating = val === '' ? Infinity : parseFloat(val);
            });
            newSettings.hideRefused = panel.querySelector('#wf-hide-toggle').checked;
            saveSettings(newSettings);
            refilterAll();
            panel.classList.remove('wf-open');
        });

        panel.querySelector('#wf-reset-btn').addEventListener('click', () => {
            saveSettings(structuredClone(DEFAULT_SETTINGS));
            panel.querySelectorAll('input[data-idx]').forEach((input) => {
                const idx = parseInt(input.dataset.idx);
                const val = DEFAULT_SETTINGS.thresholds[idx].minRating;
                input.value = val === Infinity ? '' : val;
            });
            panel.querySelector('#wf-hide-toggle').checked = DEFAULT_SETTINGS.hideRefused;
            refilterAll();
        });
    }

    // ── Review analysis (extras) ────────────────────────────────────────────────

    function analyzeReviews(reviews) {
        if (reviews.length === 0) return null;

        const now = Date.now();
        const SIX_MONTHS = 180 * 24 * 60 * 60 * 1000;
        const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

        const recentCount = reviews.filter(r => (now - r.dateMs) < SIX_MONTHS).length;
        const recency = recentCount / reviews.length;

        const velocity = reviews.filter(r => (now - r.dateMs) < THIRTY_DAYS).length;

        const mean = reviews.reduce((s, r) => s + r.stars, 0) / reviews.length;
        const variance = reviews.reduce((s, r) => s + (r.stars - mean) ** 2, 0) / reviews.length;
        const stdDev = Math.sqrt(variance);

        return { recency, velocity, stdDev };
    }

    function parseF95Reviews(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const reviews = [];
        const reviewEls = doc.querySelectorAll('.br-review');
        for (const el of reviewEls) {
            const fullStars = el.querySelectorAll('.ratingStars-star--full');
            const stars = fullStars.length;
            if (stars === 0) continue;

            const timeEl = el.querySelector('time[datetime]');
            const dateMs = timeEl ? new Date(timeEl.getAttribute('datetime')).getTime() : Date.now();

            reviews.push({ stars, dateMs });
        }
        return reviews;
    }

    // ── Core logic ─────────────────────────────────────────────────────────────

    function getThreadUrl(tile) {
        const link = tile.querySelector('a.resource-tile_link');
        return link?.href || null;
    }

    function getRatingFromCard(tile) {
        const el = tile.querySelector('.resource-tile_info-meta_rating');
        if (!el) return null;
        const text = el.textContent.trim();
        if (text === '-' || text === '') return null;
        const val = parseFloat(text);
        return isNaN(val) ? null : val;
    }

    function findTileByUrl(threadUrl) {
        const tiles = document.querySelectorAll('div.resource-tile');
        for (const tile of tiles) {
            if (getThreadUrl(tile) === threadUrl) return tile;
        }
        return null;
    }

    function setTileStatus(tile, status) {
        tile.dataset.wfStatus = status;
        if (status === Status.REFUSED && settings.hideRefused) {
            tile.classList.add('wf-hide');
        } else {
            tile.classList.remove('wf-hide');
        }
    }

    function injectBadge(tile, data, status) {
        tile.querySelector('.wf-badge')?.remove();

        const badge = document.createElement('span');
        badge.className = `wf-badge wf-badge--${status}`;

        if (status === Status.PENDING) {
            badge.textContent = '\u2026';
        } else {
            const r = data.rating != null ? data.rating.toFixed(2) : '?';
            const n = data.reviewCount ?? 0;
            let extras = '';
            if (data.analysis) {
                if (data.analysis.stdDev > 1.5) extras += '\u26a1';
                if (data.analysis.velocity >= 5) extras += '\ud83d\udd25';
            }
            badge.textContent = `\u2605 ${r} \u00b7 ${n} reviews${extras ? ' ' + extras : ''}`;
        }
        tile.appendChild(badge);
    }

    function filterTile(tile, data) {
        const { rating, reviewCount, analysis } = data;

        // If no rating data at all, refuse
        if (rating == null) {
            setTileStatus(tile, Status.REFUSED);
            injectBadge(tile, data, Status.REFUSED);
            return;
        }

        for (const tier of settings.thresholds) {
            if (reviewCount < tier.maxReviews) {
                let effectiveMinRating = tier.minRating;

                if (effectiveMinRating !== Infinity && analysis) {
                    if (analysis.recency > 0.7) effectiveMinRating -= 0.1;
                    if (analysis.velocity >= 5) effectiveMinRating -= 0.1;
                    if (analysis.stdDev > 1.5) effectiveMinRating += 0.2;
                    effectiveMinRating = Math.max(3.5, Math.min(tier.minRating + 0.3, effectiveMinRating));
                }

                if (effectiveMinRating === Infinity || rating < effectiveMinRating) {
                    setTileStatus(tile, Status.REFUSED);
                    injectBadge(tile, data, Status.REFUSED);
                    return;
                }
                break;
            }
        }

        setTileStatus(tile, Status.ACCEPTED);
        injectBadge(tile, data, Status.ACCEPTED);
    }

    function refilterAll() {
        const tiles = document.querySelectorAll('div.resource-tile');
        for (const tile of tiles) {
            const status = tile.dataset.wfStatus;
            if (status === Status.ACCEPTED || status === Status.REFUSED) {
                const url = getThreadUrl(tile);
                if (!url) continue;
                const data = GM_getValue(url);
                if (data) filterTile(tile, data);
            }
        }
    }

    // ── Scanning (debounced) ───────────────────────────────────────────────────

    let scanTimer = null;

    function debouncedScan() {
        clearTimeout(scanTimer);
        scanTimer = setTimeout(scanTiles, DEBOUNCE_MS);
    }

    function scanTiles() {
        const tiles = document.querySelectorAll('div.resource-tile');
        const toFetch = []; // { tile, threadUrl }

        for (const tile of tiles) {
            if (tile.dataset.wfStatus) continue;

            const threadUrl = getThreadUrl(tile);
            if (!threadUrl) continue;

            setTileStatus(tile, Status.PENDING);
            injectBadge(tile, null, Status.PENDING);

            const cached = GM_getValue(threadUrl);
            if (cached && cached.timestamp + CACHE_DURATION > Date.now()) {
                filterTile(tile, cached);
                continue;
            }

            toFetch.push({ tile, threadUrl });
        }

        if (toFetch.length > 0) {
            fetchAll(toFetch);
        }
    }

    // ── Sequential fetcher ─────────────────────────────────────────────────────

    const FETCH_DELAY = 1000;
    let fetching = false;
    const fetchQueue = [];

    function fetchAll(items) {
        fetchQueue.push(...items);
        if (!fetching) processFetchQueue();
    }

    async function processFetchQueue() {
        fetching = true;

        while (fetchQueue.length > 0) {
            const { tile, threadUrl } = fetchQueue.shift();

            try {
                const res = await fetch(threadUrl);
                const html = await res.text();

                const rating = getRatingFromCard(tile);

                const reviewMatch = html.match(/Reviews\s*\((\d[\d,]*)\)/i);
                const reviewCount = reviewMatch
                    ? parseInt(reviewMatch[1].replace(/,/g, ''))
                    : 0;

                await delay(FETCH_DELAY);
                const reviewsUrl = threadUrl.replace(/\/?$/, '/') + 'br-reviews/';
                const reviewsRes = await fetch(reviewsUrl);
                const reviewsHtml = await reviewsRes.text();
                const reviews = parseF95Reviews(reviewsHtml);
                const analysis = analyzeReviews(reviews);

                const data = { rating, reviewCount, analysis, timestamp: Date.now() };
                GM_setValue(threadUrl, data);
                filterTile(tile, data);
            } catch (err) {
                console.warn('[F95zone Filter] Fetch error for', threadUrl, err);
            }

            await delay(FETCH_DELAY);
        }

        fetching = false;
    }

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ── Init ───────────────────────────────────────────────────────────────────

    function init() {
        buildSettingsPanel();

        // Observe the grid container for DOM mutations (new tiles loaded)
        const grid = document.querySelector('.resource-wrap-game');
        if (grid) {
            const observer = new MutationObserver(debouncedScan);
            observer.observe(grid, { subtree: true, childList: true });
        }

        // Hash-based navigation triggers new pages
        window.addEventListener('hashchange', debouncedScan);

        // Initial scan
        scanTiles();
    }

    // Wait for grid to exist (SPA may not have it immediately)
    if (document.querySelector('.resource-wrap-game')) {
        init();
    } else {
        const bodyObserver = new MutationObserver(() => {
            if (document.querySelector('.resource-wrap-game')) {
                bodyObserver.disconnect();
                init();
            }
        });
        bodyObserver.observe(document.body, { subtree: true, childList: true });
    }
})();
