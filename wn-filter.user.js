// ==UserScript==
// @name         WN Filter
// @namespace    https://github.com/Dautsuro/userscripts
// @version      1.1
// @description  Filters webnovel.com book listings by quality using statistical rating analysis
// @author       Dautsuro
// @match        https://www.webnovel.com/tags/*
// @match        https://www.webnovel.com/search?keywords=*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=webnovel.com
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

// ── Configuration ────────────────────────────────────────────────────────────

const CACHE_DURATION = 3 * 24 * 60 * 60 * 1000; // 3 days
const RATE_LIMIT_DELAY_MS = 500;

const KEEP_MEAN_THRESHOLD = 4.0;
const MIN_REVIEWS_CONFIDENCE = 30;
const MIN_REVIEWS_BAYESIAN = 20;
const PRIOR_MEAN = 3.8; // C: prior/global average rating
const PRIOR_WEIGHT = 10; // m: equivalent virtual review count
const POSITIVE_RATING_CUTOFF = 4; // rating >= this counts as "positive"
const WILSON_CONFIDENCE = 0.95;
const POSITIVE_PROP_THRESHOLD = 0.6;

// ── DOM selectors ────────────────────────────────────────────────────────────

const isSearchPage = window.location.href.includes('/search?keywords=');

const selector = {
    booksContainer: isSearchPage ? '.j_list_container' : '.j_bookList',
    book: isSearchPage ? '.j_list_container li' : '.j_bookList .g_book_item',
    bookUrl: 'a[href*="/book/"]',
    bookRating: '._score strong',
    bookReviewCount: '._score small',
};

// ── State ────────────────────────────────────────────────────────────────────

let processing = false;
const processQueue = [];
const processQueueSet = new Set();
const processedBooks = new Set();
let scanTimer = null;
const observer = new MutationObserver(debounceScan);
let tagSettings = GM_getValue('wnf-tag-settings') ?? { include: [], exclude: [] };
let hideRejected = GM_getValue('wnf-hide-rejected', false);

// ── Inverse normal CDF coefficients (Acklam approximation) ──────────────────

const _A = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269,
    -30.66479806614716, 2.506628277459239,
];
const _B = [
    -54.47609879822406, 161.5858368580409, -155.6989798598866,
    66.80131188771972, -13.28068155288572,
];
const _C = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
];
const _D = [
    0.007784695709041462, 0.3224671290700398, 2.445134137142996,
    3.754408661907416,
];

// t-distribution 0.975 quantile lookup (df 1–30)
const _T95 = {
    1: 12.706,
    2: 4.303,
    3: 3.182,
    4: 2.776,
    5: 2.571,
    6: 2.447,
    7: 2.365,
    8: 2.306,
    9: 2.262,
    10: 2.228,
    11: 2.201,
    12: 2.179,
    13: 2.16,
    14: 2.145,
    15: 2.131,
    16: 2.12,
    17: 2.11,
    18: 2.101,
    19: 2.093,
    20: 2.086,
    21: 2.08,
    22: 2.074,
    23: 2.069,
    24: 2.064,
    25: 2.06,
    26: 2.056,
    27: 2.052,
    28: 2.048,
    29: 2.045,
    30: 2.042,
};

// ── Statistics helpers ───────────────────────────────────────────────────────

function mean(arr) {
    return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function sampleStdDev(arr) {
    if (arr.length < 2) return NaN;
    const mu = mean(arr);
    const ss = arr.reduce((acc, x) => {
        const d = x - mu;
        return acc + d * d;
    }, 0);
    return Math.sqrt(ss / (arr.length - 1));
}

function inverseNormalCDF(p) {
    if (p <= 0 || p >= 1) return NaN;
    const plow = 0.02425;
    let q;
    if (p < plow) {
        q = Math.sqrt(-2 * Math.log(p));
        return (
            (((((_C[0] * q + _C[1]) * q + _C[2]) * q + _C[3]) * q + _C[4]) * q +
                _C[5]) /
            ((((_D[0] * q + _D[1]) * q + _D[2]) * q + _D[3]) * q + 1)
        );
    }
    if (p <= 1 - plow) {
        q = p - 0.5;
        const r = q * q;
        return (
            ((((((_A[0] * r + _A[1]) * r + _A[2]) * r + _A[3]) * r + _A[4]) *
                r +
                _A[5]) *
                q) /
            (((((_B[0] * r + _B[1]) * r + _B[2]) * r + _B[3]) * r + _B[4]) * r +
                1)
        );
    }
    q = Math.sqrt(-2 * Math.log(1 - p));
    return (
        -(
            ((((_C[0] * q + _C[1]) * q + _C[2]) * q + _C[3]) * q + _C[4]) * q +
            _C[5]
        ) /
        ((((_D[0] * q + _D[1]) * q + _D[2]) * q + _D[3]) * q + 1)
    );
}

/**
 * t inverse for 95% (two-sided, 0.975 quantile):
 * - lookup for df <= 30
 * - Cornish-Fisher expansion for 31..100
 * - normal approx for df > 100
 */
function tInverse95(df) {
    if (!isFinite(df) || df <= 0) return NaN;
    if (df <= 30) return _T95[Math.floor(df)] ?? 2.042;
    if (df > 100) return 1.959963984540054;
    const z = inverseNormalCDF(0.975);
    const z2 = z * z,
        z3 = z2 * z;
    return (
        z +
        (z3 + z) / (4 * df) +
        (5 * z3 * z * z + 16 * z3 + 3 * z) / (96 * df * df)
    );
}

function wilsonLowerBound(positives, n, confidence) {
    if (n <= 0) return NaN;
    const phat = positives / n;
    const z = inverseNormalCDF(1 - (1 - confidence) / 2);
    const z2 = z * z;
    const center = phat + z2 / (2 * n);
    const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * n)) / n);
    return Math.max(0, (center - margin) / (1 + z2 / n));
}

// ── Filter decision ──────────────────────────────────────────────────────────

/**
 * Decide whether to keep an item.
 * @param {number} rating - The reported average rating (e.g. 4.2).
 * @param {number|number[]} reviewsOrCount - Array of individual review ratings, or total review count.
 * @returns {boolean} true if the item should be kept, false if it should be eliminated.
 */
function shouldKeepItem(rating, reviewsOrCount) {
    if (typeof rating !== 'number' || !isFinite(rating)) {
        console.debug('[WNFilter] invalid rating:', rating);
        return false;
    }

    if (Array.isArray(reviewsOrCount)) {
        const numeric = reviewsOrCount.map(Number).filter(isFinite);
        if (numeric.length === 0) {
            console.debug('[WNFilter] no numeric reviews');
            return false;
        }

        const v = numeric.length;
        const R = mean(numeric);
        const s = sampleStdDev(numeric);
        const bayesianMean =
            (v * R + PRIOR_WEIGHT * PRIOR_MEAN) / (v + PRIOR_WEIGHT);

        const lowerMean95 =
            v >= 2 && isFinite(s)
                ? R - (tInverse95(v - 1) * s) / Math.sqrt(v)
                : NaN;

        const positives = numeric.filter(
            (x) => x >= POSITIVE_RATING_CUTOFF,
        ).length;
        const wilson =
            v >= 2 ? wilsonLowerBound(positives, v, WILSON_CONFIDENCE) : NaN;

        let keep = false,
            rule = '';

        if (v >= MIN_REVIEWS_CONFIDENCE) {
            if (isFinite(lowerMean95) && lowerMean95 >= KEEP_MEAN_THRESHOLD) {
                keep = true;
                rule = 'lowerMean95';
            } else if (
                bayesianMean >= KEEP_MEAN_THRESHOLD &&
                v >= MIN_REVIEWS_CONFIDENCE / 2
            ) {
                keep = true;
                rule = 'bayesian_high_v';
            } else if (isFinite(wilson) && wilson >= POSITIVE_PROP_THRESHOLD) {
                keep = true;
                rule = 'wilson';
            } else {
                rule = 'no_rule_met';
            }
        } else {
            if (
                bayesianMean >= KEEP_MEAN_THRESHOLD &&
                v >= MIN_REVIEWS_CONFIDENCE / 4
            ) {
                keep = true;
                rule = 'bayesian_low_v';
            } else if (isFinite(wilson) && wilson >= POSITIVE_PROP_THRESHOLD) {
                keep = true;
                rule = 'wilson_low_v';
            } else {
                rule = 'low_v_no_rule';
            }
        }

        console.debug(
            `[WNFilter] array v=${v} R=${R.toFixed(2)} bayes=${bayesianMean.toFixed(2)} -> ${keep} (${rule})`,
        );
        return keep;
    }

    if (typeof reviewsOrCount === 'number' && isFinite(reviewsOrCount)) {
        const v = Math.floor(reviewsOrCount);
        if (v <= 0) {
            console.debug('[WNFilter] invalid count:', reviewsOrCount);
            return false;
        }
        const bayesianMean =
            (v * rating + PRIOR_WEIGHT * PRIOR_MEAN) / (v + PRIOR_WEIGHT);
        const keep =
            bayesianMean >= KEEP_MEAN_THRESHOLD && v >= MIN_REVIEWS_BAYESIAN;
        console.debug(
            `[WNFilter] count v=${v} rating=${rating} bayes=${bayesianMean.toFixed(2)} -> ${keep}`,
        );
        return keep;
    }

    console.debug('[WNFilter] invalid reviewsOrCount:', typeof reviewsOrCount);
    return false;
}

// ── Styles ───────────────────────────────────────────────────────────────────

function injectStyles() {
    const style = document.createElement('style');
    style.id = 'wnf-styles';
    style.textContent = `
        .wnf-book {
            position: relative;
            transition: opacity 0.3s ease;
        }

        .wnf-pending {
            outline: 2px solid #e8a838;
            outline-offset: -2px;
            animation: wnf-pulse 1.2s ease-in-out infinite;
        }

        @keyframes wnf-pulse {
            0%, 100% { outline-color: #e8a838; }
            50%       { outline-color: rgba(232, 168, 56, 0.2); }
        }

        .wnf-kept {
            outline: 3px solid #2ecc71;
            outline-offset: -3px;
            box-shadow: 0 0 14px 4px rgba(46, 204, 113, 0.55);
        }

        .wnf-rejected {
            outline: 2px solid #c0392b;
            outline-offset: -2px;
        }
        .wnf-rejected::before {
            content: "";
            position: absolute;
            inset: 0;
            background: rgba(0, 0, 0, 0.7);
            pointer-events: none;
            z-index: 5;
        }

        .wnf-badge {
            position: absolute;
            bottom: 6px;
            right: 6px;
            padding: 2px 8px;
            border-radius: 4px;
            font: 700 11px/1.5 system-ui, sans-serif;
            letter-spacing: 0.03em;
            pointer-events: none;
            z-index: 10;
            white-space: nowrap;
        }
        .wnf-kept .wnf-badge {
            background: rgba(39, 174, 96, 0.92);
            color: #fff;
        }
        .wnf-rejected .wnf-badge {
            background: rgba(192, 57, 43, 0.92);
            color: #fff;
        }
        .wnf-pending .wnf-badge {
            background: rgba(232, 168, 56, 0.92);
            color: #1a1a1a;
        }

        body.wnf-hide-rejected .wnf-rejected { display: none !important; }

        .wnf-settings-btn {
            position: fixed;
            bottom: 18px;
            left: 18px;
            z-index: 9999;
            width: 40px;
            height: 40px;
            border: none;
            border-radius: 50%;
            background: #2c3e50;
            color: #ecf0f1;
            font-size: 20px;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            transition: background 0.2s;
            line-height: 40px;
            text-align: center;
            padding: 0;
        }
        .wnf-settings-btn:hover { background: #34495e; }

        .wnf-toggle-rejected-btn {
            position: fixed;
            bottom: 18px;
            left: 66px;
            z-index: 9999;
            width: 40px;
            height: 40px;
            border: none;
            border-radius: 50%;
            background: #2c3e50;
            color: #ecf0f1;
            font-size: 14px;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            transition: background 0.2s;
            line-height: 40px;
            text-align: center;
            padding: 0;
        }
        .wnf-toggle-rejected-btn:hover { background: #34495e; }

        .wnf-settings-backdrop {
            position: fixed;
            inset: 0;
            z-index: 10000;
            background: rgba(0,0,0,0.5);
            display: none;
        }
        .wnf-settings-backdrop.wnf-open { display: flex; align-items: center; justify-content: center; }

        .wnf-settings-panel {
            background: #1e1e2e;
            color: #cdd6f4;
            border-radius: 12px;
            padding: 24px;
            width: 420px;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 8px 32px rgba(0,0,0,0.5);
            font: 14px/1.5 system-ui, sans-serif;
        }
        .wnf-settings-panel h2 {
            margin: 0 0 16px;
            font-size: 16px;
            color: #cba6f7;
        }
        .wnf-settings-panel h3 {
            margin: 12px 0 6px;
            font-size: 13px;
            color: #a6adc8;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .wnf-tag-input-row {
            display: flex;
            gap: 6px;
            margin-bottom: 8px;
        }
        .wnf-tag-input-row input {
            flex: 1;
            padding: 6px 10px;
            border: 1px solid #45475a;
            border-radius: 6px;
            background: #313244;
            color: #cdd6f4;
            font-size: 13px;
            outline: none;
        }
        .wnf-tag-input-row input:focus { border-color: #cba6f7; }

        .wnf-tag-chips {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            min-height: 28px;
            margin-bottom: 8px;
        }
        .wnf-tag-chip {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 3px 8px;
            border-radius: 12px;
            font-size: 12px;
            cursor: default;
        }
        .wnf-tag-chip-include {
            background: rgba(46, 204, 113, 0.2);
            color: #2ecc71;
            border: 1px solid rgba(46, 204, 113, 0.4);
        }
        .wnf-tag-chip-exclude {
            background: rgba(192, 57, 43, 0.2);
            color: #e74c3c;
            border: 1px solid rgba(192, 57, 43, 0.4);
        }
        .wnf-tag-chip button {
            background: none;
            border: none;
            color: inherit;
            cursor: pointer;
            font-size: 14px;
            padding: 0;
            line-height: 1;
            opacity: 0.7;
        }
        .wnf-tag-chip button:hover { opacity: 1; }

        .wnf-settings-actions {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            margin-top: 16px;
        }
        .wnf-settings-actions button {
            padding: 6px 16px;
            border: none;
            border-radius: 6px;
            font-size: 13px;
            cursor: pointer;
        }
        .wnf-btn-save {
            background: #cba6f7;
            color: #1e1e2e;
            font-weight: 600;
        }
        .wnf-btn-save:hover { background: #b4befe; }
        .wnf-btn-close {
            background: #45475a;
            color: #cdd6f4;
        }
        .wnf-btn-close:hover { background: #585b70; }
    `;
    document.head.appendChild(style);
}

// ── Settings UI ─────────────────────────────────────────────────────────────

function createSettingsUI() {
    const btn = document.createElement('button');
    btn.className = 'wnf-settings-btn';
    btn.textContent = '\u2699';
    btn.title = 'WN Filter — Tag Settings';

    const backdrop = document.createElement('div');
    backdrop.className = 'wnf-settings-backdrop';
    backdrop.innerHTML = `
        <div class="wnf-settings-panel">
            <h2>WN Filter \u2014 Tag Settings</h2>
            <h3>Include tags (keep only books with all of these)</h3>
            <div class="wnf-tag-input-row">
                <input class="wnf-input-include" placeholder="Type a tag and press Enter">
            </div>
            <div class="wnf-tag-chips wnf-chips-include"></div>
            <h3>Exclude tags (reject books with any of these)</h3>
            <div class="wnf-tag-input-row">
                <input class="wnf-input-exclude" placeholder="Type a tag and press Enter">
            </div>
            <div class="wnf-tag-chips wnf-chips-exclude"></div>
            <div class="wnf-settings-actions">
                <button class="wnf-btn-close">Close</button>
                <button class="wnf-btn-save">Save</button>
            </div>
        </div>
    `;

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'wnf-toggle-rejected-btn';
    toggleBtn.setAttribute('aria-label', hideRejected ? 'Show rejected' : 'Hide rejected');
    function updateToggleLabel() {
        toggleBtn.textContent = hideRejected ? 'S' : 'H';
        toggleBtn.title = hideRejected ? 'Show rejected' : 'Hide rejected';
        toggleBtn.setAttribute('aria-label', hideRejected ? 'Show rejected' : 'Hide rejected');
    }
    updateToggleLabel();
    toggleBtn.addEventListener('click', () => {
        hideRejected = !hideRejected;
        if (hideRejected) document.body.classList.add('wnf-hide-rejected');
        else document.body.classList.remove('wnf-hide-rejected');
        GM_setValue('wnf-hide-rejected', hideRejected);
        updateToggleLabel();
    });

    document.body.append(btn, toggleBtn, backdrop);

    // Working copies so we can discard on close
    let draft = { include: [...tagSettings.include], exclude: [...tagSettings.exclude] };

    function renderChips(type) {
        const container = backdrop.querySelector(`.wnf-chips-${type}`);
        container.innerHTML = '';
        for (const tag of draft[type]) {
            const chip = document.createElement('span');
            chip.className = `wnf-tag-chip wnf-tag-chip-${type}`;
            chip.innerHTML = `${tag} <button data-tag="${tag}">\u2715</button>`;
            chip.querySelector('button').addEventListener('click', () => {
                draft[type] = draft[type].filter(t => t !== tag);
                renderChips(type);
            });
            container.appendChild(chip);
        }
    }

    function openPanel() {
        draft = { include: [...tagSettings.include], exclude: [...tagSettings.exclude] };
        renderChips('include');
        renderChips('exclude');
        backdrop.classList.add('wnf-open');
    }

    function closePanel() {
        backdrop.classList.remove('wnf-open');
    }

    btn.addEventListener('click', openPanel);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closePanel(); });
    backdrop.querySelector('.wnf-btn-close').addEventListener('click', closePanel);

    for (const type of ['include', 'exclude']) {
        backdrop.querySelector(`.wnf-input-${type}`).addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            const val = e.target.value.trim().toLowerCase();
            if (val && !draft[type].includes(val)) {
                draft[type].push(val);
                renderChips(type);
            }
            e.target.value = '';
        });
    }

    backdrop.querySelector('.wnf-btn-save').addEventListener('click', () => {
        tagSettings = { include: [...draft.include], exclude: [...draft.exclude] };
        GM_setValue('wnf-tag-settings', tagSettings);
        closePanel();
        // Re-scan all books with new tag rules
        processedBooks.clear();
        scanBooks();
    });
}

// ── DOM helpers ──────────────────────────────────────────────────────────────

function getBookUrl(bookElement) {
    return bookElement.querySelector(selector.bookUrl)?.href ?? '';
}

function getBookElement(bookUrl) {
    for (const el of document.querySelectorAll(selector.book)) {
        if (getBookUrl(el) === bookUrl) return el;
    }
    return null;
}

function getOrCreateBadge(bookElement) {
    let badge = bookElement.querySelector('.wnf-badge');
    if (!badge) {
        badge = document.createElement('span');
        badge.className = 'wnf-badge';
        bookElement.appendChild(badge);
    }
    return badge;
}

// ── Core logic ───────────────────────────────────────────────────────────────

function debounceScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanBooks, 500);
}

function scanBooks() {
    for (const bookElement of document.querySelectorAll(selector.book)) {
        const bookUrl = getBookUrl(bookElement);
        if (!bookUrl || processedBooks.has(bookUrl)) continue;

        const bookData = GM_getValue(bookUrl);
        if (bookData?.timestamp + CACHE_DURATION > Date.now() && Array.isArray(bookData.tags)) {
            filterBook(bookUrl, bookData);
            continue;
        }

        if (!processQueueSet.has(bookUrl)) {
            processQueueSet.add(bookUrl);
            processQueue.push(bookUrl);
            bookElement.classList.add('wnf-book', 'wnf-pending');
            getOrCreateBadge(bookElement).textContent = '\u2026';
        }
        if (!processing) processBooks();
    }
}

async function processBooks() {
    processing = true;

    while (processQueue.length) {
        const bookUrl = processQueue.shift();
        processQueueSet.delete(bookUrl);
        const bookData = await fetchBookData(bookUrl);
        GM_setValue(bookUrl, bookData);
        filterBook(bookUrl, bookData);
        await sleep(RATE_LIMIT_DELAY_MS);
    }

    processing = false;
}

async function fetchBookData(bookUrl) {
    const response = await fetch(bookUrl);
    const doc = new DOMParser().parseFromString(
        await response.text(),
        'text/html',
    );

    const rating =
        parseFloat(doc.querySelector(selector.bookRating)?.textContent) || 0;
    const reviewCount =
        parseInt(
            doc
                .querySelector(selector.bookReviewCount)
                ?.textContent?.match(/\d+/)?.[0],
            10,
        ) || 0;

    const tags = [...doc.querySelectorAll('.m-tags .m-tag')]
        .map(el => el.textContent.trim().replace(/^#\s*/, '').toLowerCase());

    return { rating, reviewCount, tags, timestamp: Date.now() };
}

function filterBook(bookUrl, bookData) {
    processedBooks.add(bookUrl);
    const bookElement = getBookElement(bookUrl);
    if (!bookElement) return;

    let keep = shouldKeepItem(bookData.rating, bookData.reviewCount);
    let tagRejected = false;
    const bookTags = (bookData.tags ?? []).map(t => t.replace(/^#\s*/, ''));

    if (keep && tagSettings.include.length > 0) {
        if (!tagSettings.include.every(inc => bookTags.some(t => t === inc))) {
            keep = false;
            tagRejected = true;
        }
    }
    if (keep && tagSettings.exclude.length > 0) {
        if (bookTags.some(t => tagSettings.exclude.some(exc => exc === t))) {
            keep = false;
            tagRejected = true;
        }
    }

    bookElement.classList.remove('wnf-pending', 'wnf-kept', 'wnf-rejected');
    bookElement.classList.add('wnf-book', keep ? 'wnf-kept' : 'wnf-rejected');

    const icon = keep ? '\u2605' : '\u2715';
    const ratingStr = bookData.rating > 0 ? bookData.rating.toFixed(1) : 'N/A';
    const countStr =
        bookData.reviewCount > 0 ? ` (${bookData.reviewCount})` : '';
    const tagIndicator = tagRejected ? ' \uD83C\uDFF7' : '';
    getOrCreateBadge(bookElement).textContent =
        `${icon} ${ratingStr}${countStr}${tagIndicator}`;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Init ─────────────────────────────────────────────────────────────────────

injectStyles();
createSettingsUI();
if (hideRejected) document.body.classList.add('wnf-hide-rejected');
else document.body.classList.remove('wnf-hide-rejected');
scanBooks();
observer.observe(document.querySelector(selector.booksContainer), {
    childList: true,
    subtree: true,
});
window.addEventListener('urlchange', () => window.location.reload());
