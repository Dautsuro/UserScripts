// ==UserScript==
// @name         WN Filter
// @namespace    https://github.com/Dautsuro/userscripts
// @version      1.0
// @description  Filters webnovel.com book listings by quality using statistical rating analysis
// @author       Dautsuro
// @match        https://www.webnovel.com/tags/*
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
    `;
    document.head.appendChild(style);
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
        if (bookData?.timestamp + CACHE_DURATION > Date.now()) {
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

    return { rating, reviewCount, timestamp: Date.now() };
}

function filterBook(bookUrl, bookData) {
    processedBooks.add(bookUrl);
    const bookElement = getBookElement(bookUrl);
    if (!bookElement) return;

    const keep = shouldKeepItem(bookData.rating, bookData.reviewCount);

    bookElement.classList.remove('wnf-pending');
    bookElement.classList.add('wnf-book', keep ? 'wnf-kept' : 'wnf-rejected');

    const icon = keep ? '\u2605' : '\u2715';
    const ratingStr = bookData.rating > 0 ? bookData.rating.toFixed(1) : 'N/A';
    const countStr =
        bookData.reviewCount > 0 ? ` (${bookData.reviewCount})` : '';
    getOrCreateBadge(bookElement).textContent =
        `${icon} ${ratingStr}${countStr}`;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Init ─────────────────────────────────────────────────────────────────────

injectStyles();
scanBooks();
observer.observe(document.querySelector(selector.booksContainer), {
    childList: true,
    subtree: true,
});
window.addEventListener('urlchange', () => window.location.reload());
