// ==UserScript==
// @name        WebNovel Filter
// @namespace   https://github.com/Dautsuro/userscripts
// @version     2.0
// @description Filters webnovel.com fanfic listings by rating and review count, color-coding books based on quality thresholds
// @icon        https://www.google.com/s2/favicons?sz=64&domain=webnovel.com
// @grant       GM_setValue
// @grant       GM_getValue
// @grant       GM_addStyle
// @author      Dautsuro
// @match       https://www.webnovel.com/tags/*-fanfic
// @match       https://www.webnovel.com/search?keywords=*&type=fanfic
// @updateURL   https://raw.githubusercontent.com/Dautsuro/userscripts/main/webnovel-filter.user.js
// @downloadURL https://raw.githubusercontent.com/Dautsuro/userscripts/main/webnovel-filter.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ── Constants ──────────────────────────────────────────────────────────────

    const CACHE_DURATION = 3 * 24 * 60 * 60 * 1000; // 3 days
    const FETCH_DELAY = 1000;
    const DEBOUNCE_MS = 300;

    const DEFAULT_THRESHOLDS = [
        { maxReviews: 10, minRating: Infinity },  // < 10 reviews → always refuse
        { maxReviews: 20, minRating: 4.5 },
        { maxReviews: 50, minRating: 4.2 },
        { maxReviews: 200, minRating: 3.8 },
        { maxReviews: Infinity, minRating: 3.5 },
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

    const isTagPage = window.location.href.includes('/tags/');

    const Selector = Object.freeze({
        OBSERVER: isTagPage ? '.j_bookList' : '.j_list_container',
        BOOKS: isTagPage ? '.j_bookList .g_book_item' : '.j_result_wrap li',
    });

    // ── State ──────────────────────────────────────────────────────────────────

    const processQueue = [];          // array of bookUrl strings
    let processing = false;
    let settings = loadSettings();

    // ── CSS Injection ──────────────────────────────────────────────────────────

    GM_addStyle(`
        /* Status indicators */
        [data-wf-status="${Status.PENDING}"] {
            border-left: 4px solid #f59e0b !important;
            background-color: rgba(245, 158, 11, 0.06) !important;
            animation: wf-pulse 1.5s ease-in-out infinite;
            transition: opacity 0.4s, border-color 0.4s, background-color 0.4s;
        }
        [data-wf-status="${Status.ACCEPTED}"] {
            border-left: 4px solid #22c55e !important;
            background-color: rgba(34, 197, 94, 0.06) !important;
            transition: opacity 0.4s, border-color 0.4s, background-color 0.4s;
        }
        [data-wf-status="${Status.REFUSED}"] {
            border-left: 4px solid #ef4444 !important;
            background-color: rgba(239, 68, 68, 0.06) !important;
            opacity: 0.3;
            transition: opacity 0.4s, border-color 0.4s, background-color 0.4s;
        }
        [data-wf-status="${Status.REFUSED}"] img {
            filter: grayscale(1);
        }
        [data-wf-status="${Status.REFUSED}"].wf-hide {
            display: none !important;
        }

        @keyframes wf-pulse {
            0%, 100% { border-left-color: #f59e0b; }
            50% { border-left-color: #fbbf24; }
        }

        /* Rating badge */
        .wf-badge {
            position: absolute;
            top: 6px;
            right: 6px;
            padding: 3px 8px;
            border-radius: 10px;
            font-family: Archivo, Arial, sans-serif;
            font-size: 12px;
            font-weight: 700;
            color: #fff;
            white-space: nowrap;
            box-shadow: 0 1px 4px rgba(0,0,0,0.25);
            z-index: 10;
            pointer-events: none;
            line-height: 1.4;
        }
        .wf-badge--pending  { background: #f59e0b; }
        .wf-badge--accepted { background: #16a34a; }
        .wf-badge--refused  { background: #dc2626; }

        /* Ensure parent is positioned for badge */
        ${Selector.BOOKS} {
            position: relative !important;
        }

        /* ── Settings panel ─────────────────────────────────────────────────── */
        /* Auto-scroll button */
        #wf-scroll-btn {
            position: fixed;
            bottom: 72px;
            right: 20px;
            z-index: 100000;
            width: 44px;
            height: 44px;
            border: none;
            border-radius: 50%;
            background: #1a1a2e;
            color: #fff;
            font-size: 20px;
            cursor: pointer;
            box-shadow: 0 2px 10px rgba(0,0,0,0.35);
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.2s;
        }
        #wf-scroll-btn:hover { background: #2d2d4e; }
        #wf-scroll-btn.wf-scrolling {
            background: #ef4444;
            animation: wf-pulse-scroll 1s ease-in-out infinite;
        }
        @keyframes wf-pulse-scroll {
            0%, 100% { box-shadow: 0 2px 10px rgba(239,68,68,0.35); }
            50% { box-shadow: 0 2px 18px rgba(239,68,68,0.7); }
        }

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
            bottom: 128px;
            right: 20px;
            z-index: 99999;
            width: 340px;
            background: #1a1a2e;
            color: #e2e8f0;
            border-radius: 12px;
            box-shadow: 0 8px 30px rgba(0,0,0,0.45);
            padding: 20px;
            font-family: Archivo, Arial, sans-serif;
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
        const saved = GM_getValue('wf_settings');
        if (!saved) return structuredClone(DEFAULT_SETTINGS);
        // Restore Infinity values (JSON can't store them)
        for (const t of saved.thresholds) {
            if (t.maxReviews === null || t.maxReviews === 'Infinity') t.maxReviews = Infinity;
            if (t.minRating === null || t.minRating === 'Infinity') t.minRating = Infinity;
        }
        return saved;
    }

    function saveSettings(s) {
        // Serialize Infinity as string for JSON storage
        const serializable = structuredClone(s);
        for (const t of serializable.thresholds) {
            if (t.maxReviews === Infinity) t.maxReviews = 'Infinity';
            if (t.minRating === Infinity) t.minRating = 'Infinity';
        }
        GM_setValue('wf_settings', serializable);
        settings = s;
    }

    // ── Settings panel UI ──────────────────────────────────────────────────────

    // ── Auto-scroll ──────────────────────────────────────────────────────────

    const SCROLL_INTERVAL = 800;
    const SCROLL_STALE_LIMIT = 5; // stop after this many scrolls with no new books
    let autoScrollActive = false;

    function buildAutoScrollButton() {
        const btn = document.createElement('button');
        btn.id = 'wf-scroll-btn';
        btn.textContent = '\u21e9';
        btn.title = 'Auto-scroll to load all books';
        document.body.appendChild(btn);

        btn.addEventListener('click', () => {
            if (autoScrollActive) {
                stopAutoScroll(btn);
            } else {
                startAutoScroll(btn);
            }
        });

        return btn;
    }

    function startAutoScroll(btn) {
        autoScrollActive = true;
        btn.classList.add('wf-scrolling');
        btn.textContent = '\u25A0'; // stop icon

        let lastBookCount = document.querySelectorAll(Selector.BOOKS).length;
        let staleRounds = 0;

        const scrollLoop = setInterval(() => {
            if (!autoScrollActive) {
                clearInterval(scrollLoop);
                return;
            }

            window.scrollTo(0, document.body.scrollHeight);

            const currentCount = document.querySelectorAll(Selector.BOOKS).length;
            if (currentCount > lastBookCount) {
                lastBookCount = currentCount;
                staleRounds = 0;
            } else {
                staleRounds++;
            }

            if (staleRounds >= SCROLL_STALE_LIMIT) {
                stopAutoScroll(btn);
                clearInterval(scrollLoop);
            }
        }, SCROLL_INTERVAL);
    }

    function stopAutoScroll(btn) {
        autoScrollActive = false;
        btn.classList.remove('wf-scrolling');
        btn.textContent = '\u21e9';
    }

    // ── Settings panel UI ──────────────────────────────────────────────────────

    function buildSettingsPanel() {
        // Gear button
        const gear = document.createElement('button');
        gear.id = 'wf-gear-btn';
        gear.textContent = '\u2699';
        gear.title = 'WebNovel Filter Settings';
        document.body.appendChild(gear);

        // Panel
        const panel = document.createElement('div');
        panel.id = 'wf-settings-panel';

        const thresholdLabels = ['< 10 reviews', '< 20 reviews', '< 50 reviews', '< 200 reviews', '\u2265 200 reviews'];

        panel.innerHTML = `
            <h3>\u2699 WebNovel Filter Settings</h3>
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
                <label>Hide refused books entirely</label>
                <input type="checkbox" id="wf-hide-toggle" ${settings.hideRefused ? 'checked' : ''}>
            </div>
            <div class="wf-btn-row">
                <button id="wf-save-btn">Save</button>
                <button id="wf-reset-btn">Reset</button>
            </div>
        `;
        document.body.appendChild(panel);

        // Toggle panel
        gear.addEventListener('click', () => panel.classList.toggle('wf-open'));

        // Close on outside click
        document.addEventListener('click', (e) => {
            if (!panel.contains(e.target) && e.target !== gear) {
                panel.classList.remove('wf-open');
            }
        });

        // Save
        panel.querySelector('#wf-save-btn').addEventListener('click', () => {
            const newSettings = structuredClone(settings);
            panel.querySelectorAll('input[type="number"]').forEach((input) => {
                const idx = parseInt(input.dataset.idx);
                const val = input.value.trim();
                newSettings.thresholds[idx].minRating = val === '' ? Infinity : parseFloat(val);
            });
            newSettings.hideRefused = panel.querySelector('#wf-hide-toggle').checked;
            saveSettings(newSettings);
            refilterAll();
            panel.classList.remove('wf-open');
        });

        // Reset
        panel.querySelector('#wf-reset-btn').addEventListener('click', () => {
            saveSettings(structuredClone(DEFAULT_SETTINGS));
            // Update UI inputs
            panel.querySelectorAll('input[type="number"]').forEach((input) => {
                const idx = parseInt(input.dataset.idx);
                const val = DEFAULT_SETTINGS.thresholds[idx].minRating;
                input.value = val === Infinity ? '' : val;
            });
            panel.querySelector('#wf-hide-toggle').checked = DEFAULT_SETTINGS.hideRefused;
            refilterAll();
        });
    }

    // ── Core logic ─────────────────────────────────────────────────────────────

    function getBookUrl(bookEl) {
        return bookEl?.querySelector('a[href*="/book/"]')?.href || null;
    }

    function findBookElement(bookUrl) {
        const books = document.querySelectorAll(Selector.BOOKS);
        for (const book of books) {
            if (getBookUrl(book) === bookUrl) return book;
        }
        return null;
    }

    function setBookStatus(bookEl, status) {
        bookEl.dataset.wfStatus = status;
        bookEl.style.backgroundColor = ''; // clear v1 inline styles
        // Toggle hide class for refused
        if (status === Status.REFUSED && settings.hideRefused) {
            bookEl.classList.add('wf-hide');
        } else {
            bookEl.classList.remove('wf-hide');
        }
    }

    function injectBadge(bookEl, bookData, status) {
        // Remove existing badge
        bookEl.querySelector('.wf-badge')?.remove();

        const badge = document.createElement('span');
        badge.className = `wf-badge wf-badge--${status}`;

        if (status === Status.PENDING) {
            badge.textContent = '\u2026';
        } else {
            const r = bookData.rating.toFixed(2);
            const n = bookData.reviewCount;
            badge.textContent = `\u2605 ${r} \u00b7 ${n} reviews`;
        }
        bookEl.appendChild(badge);
    }

    function filterBook(bookEl, bookData) {
        const { rating, reviewCount } = bookData;
        const thresholds = settings.thresholds;

        for (const tier of thresholds) {
            if (reviewCount < tier.maxReviews) {
                if (tier.minRating === Infinity || rating < tier.minRating) {
                    setBookStatus(bookEl, Status.REFUSED);
                    injectBadge(bookEl, bookData, Status.REFUSED);
                    return;
                }
                break;
            }
        }

        setBookStatus(bookEl, Status.ACCEPTED);
        injectBadge(bookEl, bookData, Status.ACCEPTED);
    }

    function refilterAll() {
        const books = document.querySelectorAll(Selector.BOOKS);
        for (const book of books) {
            const status = book.dataset.wfStatus;
            if (status === Status.ACCEPTED || status === Status.REFUSED) {
                const url = getBookUrl(book);
                if (!url) continue;
                const bookData = GM_getValue(url);
                if (bookData) filterBook(book, bookData);
            }
        }
    }

    // ── Scanning (debounced) ───────────────────────────────────────────────────

    let scanTimer = null;

    function debouncedScan() {
        clearTimeout(scanTimer);
        scanTimer = setTimeout(scanBooks, DEBOUNCE_MS);
    }

    function scanBooks() {
        const books = document.querySelectorAll(Selector.BOOKS);

        for (const book of books) {
            // Skip already-processed books
            if (book.dataset.wfStatus) continue;

            const bookUrl = getBookUrl(book);
            if (!bookUrl) continue;

            setBookStatus(book, Status.PENDING);
            injectBadge(book, null, Status.PENDING);

            const bookData = GM_getValue(bookUrl);
            if (bookData && bookData.timestamp + CACHE_DURATION > Date.now()) {
                filterBook(book, bookData);
                continue;
            }

            // Queue URL string (not DOM node) for fetching
            if (!processQueue.includes(bookUrl)) {
                processQueue.push(bookUrl);
            }
        }

        if (!processing && processQueue.length > 0) {
            processBooks();
        }
    }

    // ── Queue processor (async/await) ──────────────────────────────────────────

    async function processBooks() {
        processing = true;

        while (processQueue.length > 0) {
            const bookUrl = processQueue.shift();
            const bookEl = findBookElement(bookUrl);

            // Stale DOM — element removed; skip
            if (!bookEl) continue;

            try {
                const response = await fetch(bookUrl);
                const bookPage = await response.text();

                const parser = new DOMParser();
                const doc = parser.parseFromString(bookPage, 'text/html');
                const scoreEl = doc.querySelector('._score');

                const bookRating = parseFloat(scoreEl?.querySelector('strong')?.textContent) || 0;
                const reviewText = scoreEl?.querySelector('small')?.textContent || '';
                const bookReviewCount = parseInt(reviewText.match(/\d+/)?.[0]) || 0;

                const bookData = {
                    rating: bookRating,
                    reviewCount: bookReviewCount,
                    timestamp: Date.now(),
                };

                GM_setValue(bookUrl, bookData);
                filterBook(bookEl, bookData);
            } catch (err) {
                console.warn('[WebNovel Filter] Fetch error for', bookUrl, err);
                // Leave as pending — will retry on next scan
            }

            await delay(FETCH_DELAY);
        }

        processing = false;
    }

    function delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    // ── Init ───────────────────────────────────────────────────────────────────

    const observerTarget = document.querySelector(Selector.OBSERVER);
    if (observerTarget) {
        const observer = new MutationObserver(debouncedScan);
        observer.observe(observerTarget, { subtree: true, childList: true });
    }

    buildSettingsPanel();
    buildAutoScrollButton();
    scanBooks();
})();
