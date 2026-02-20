// ==UserScript==
// @name         F95 Filter
// @namespace    https://github.com/Dautsuro/userscripts
// @version      1.1
// @description  Filters f95zone.to game listings by quality using statistical rating analysis
// @author       Dautsuro
// @match        https://f95zone.to/sam/latest_alpha/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=f95zone.to
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        window.onurlchange
// ==/UserScript==

// ── Configuration ────────────────────────────────────────────────────────────

const CACHE_DURATION = 3 * 24 * 60 * 60 * 1000; // 3 days

const KEEP_MEAN_THRESHOLD = 4.0;
const MIN_REVIEWS_CONFIDENCE = 30;
const MIN_REVIEWS_BAYESIAN = 20;
const PRIOR_MEAN = 3.8; // C: prior/global average rating
const PRIOR_WEIGHT = 10; // m: equivalent virtual review count
const POSITIVE_RATING_CUTOFF = 4; // rating >= this counts as "positive"
const WILSON_CONFIDENCE = 0.95;
const POSITIVE_PROP_THRESHOLD = 0.6;

// ── DOM selectors ────────────────────────────────────────────────────────────

const selector = {
    tile: '#latest-page_main-wrap .resource-tile',
    tileLink: '.resource-tile_link',
    tileRating: '.resource-tile_info-meta_rating',
    reviewTab: '.tabs .tabs-tab[href*="/br-reviews/"]',
};

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
            (((((_C[0] * q + _C[1]) * q + _C[2]) * q + _C[3]) * q + _C[4]) *
                q +
                _C[5]) /
            ((((_D[0] * q + _D[1]) * q + _D[2]) * q + _D[3]) * q + 1)
        );
    }
    if (p <= 1 - plow) {
        q = p - 0.5;
        const r = q * q;
        return (
            (((((_A[0] * r + _A[1]) * r + _A[2]) * r + _A[3]) * r + _A[4]) *
                r +
                _A[5]) *
                q /
            (((((_B[0] * r + _B[1]) * r + _B[2]) * r + _B[3]) * r + _B[4]) *
                r +
                1)
        );
    }
    q = Math.sqrt(-2 * Math.log(1 - p));
    return (
        -(
            ((((_C[0] * q + _C[1]) * q + _C[2]) * q + _C[3]) * q + _C[4]) *
                q +
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
        console.debug('[F95Filter] invalid rating:', rating);
        return false;
    }

    if (Array.isArray(reviewsOrCount)) {
        const numeric = reviewsOrCount.map(Number).filter(isFinite);
        if (numeric.length === 0) {
            console.debug('[F95Filter] no numeric reviews');
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
            `[F95Filter] array v=${v} R=${R.toFixed(2)} bayes=${bayesianMean.toFixed(2)} -> ${keep} (${rule})`,
        );
        return keep;
    }

    if (typeof reviewsOrCount === 'number' && isFinite(reviewsOrCount)) {
        const v = Math.floor(reviewsOrCount);
        if (v <= 0) {
            console.debug('[F95Filter] invalid count:', reviewsOrCount);
            return false;
        }
        const bayesianMean =
            (v * rating + PRIOR_WEIGHT * PRIOR_MEAN) / (v + PRIOR_WEIGHT);
        const keep =
            bayesianMean >= KEEP_MEAN_THRESHOLD && v >= MIN_REVIEWS_BAYESIAN;
        console.debug(
            `[F95Filter] count v=${v} rating=${rating} bayes=${bayesianMean.toFixed(2)} -> ${keep}`,
        );
        return keep;
    }

    console.debug('[F95Filter] invalid reviewsOrCount:', typeof reviewsOrCount);
    return false;
}

// ── Styles ───────────────────────────────────────────────────────────────────

function injectStyles() {
    const style = document.createElement('style');
    style.id = 'f95f-styles';
    style.textContent = `
        .f95f-tile {
            position: relative !important;
        }

        .f95f-pending {
            outline: 2px solid #e8a838 !important;
            outline-offset: -2px !important;
            animation: f95f-pulse 1.2s ease-in-out infinite !important;
        }

        @keyframes f95f-pulse {
            0%, 100% { outline-color: #e8a838; }
            50%       { outline-color: rgba(232, 168, 56, 0.2); }
        }

        .f95f-kept {
            outline: 3px solid #2ecc71 !important;
            outline-offset: -3px !important;
            box-shadow: 0 0 14px 4px rgba(46, 204, 113, 0.55) !important;
        }

        .f95f-rejected {
            outline: 2px solid #c0392b !important;
            outline-offset: -2px !important;
        }

        .f95f-overlay {
            position: absolute !important;
            inset: 0 !important;
            background: rgba(0, 0, 0, 0.7) !important;
            pointer-events: none !important;
            z-index: 9998 !important;
        }

        .f95f-badge {
            position: absolute !important;
            bottom: 6px !important;
            right: 6px !important;
            padding: 2px 8px !important;
            border-radius: 4px !important;
            font: 700 11px/1.5 system-ui, sans-serif !important;
            letter-spacing: 0.03em !important;
            pointer-events: none !important;
            z-index: 9999 !important;
            white-space: nowrap !important;
        }
        .f95f-badge--kept {
            background: rgba(39, 174, 96, 0.92) !important;
            color: #fff !important;
        }
        .f95f-badge--rejected {
            background: rgba(192, 57, 43, 0.92) !important;
            color: #fff !important;
        }
        .f95f-badge--pending {
            background: rgba(232, 168, 56, 0.92) !important;
            color: #1a1a1a !important;
        }
    `;
    document.head.appendChild(style);
}

// ── DOM helpers ──────────────────────────────────────────────────────────────

function getGameUrl(gameElement) {
    return gameElement.querySelector(selector.tileLink)?.href ?? '';
}

function getGameRating(gameElement) {
    return (
        parseFloat(
            gameElement.querySelector(selector.tileRating)?.textContent,
        ) || 0
    );
}

function getGameElement(gameUrl) {
    for (const el of document.querySelectorAll(selector.tile)) {
        if (getGameUrl(el) === gameUrl) return el;
    }
    return null;
}

function getOrCreateOverlay(gameElement) {
    let overlay = gameElement.querySelector('.f95f-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'f95f-overlay';
        gameElement.appendChild(overlay);
    }
    return overlay;
}

function getOrCreateBadge(gameElement) {
    let badge = gameElement.querySelector('.f95f-badge');
    if (!badge) {
        badge = document.createElement('span');
        badge.className = 'f95f-badge';
        gameElement.appendChild(badge);
    }
    return badge;
}

// ── Core logic ───────────────────────────────────────────────────────────────

async function scanGames() {
    const tiles = document.querySelectorAll(selector.tile);

    if (!tiles.length) {
        setTimeout(scanGames, 500);
        return;
    }

    const fetchQueue = [];

    for (const tile of tiles) {
        const gameUrl = getGameUrl(tile);
        if (!gameUrl) continue;

        const cached = GM_getValue(gameUrl);
        if (cached?.timestamp + CACHE_DURATION > Date.now()) {
            filterGame(tile, cached);
            continue;
        }

        tile.classList.add('f95f-tile', 'f95f-pending');
        const badge = getOrCreateBadge(tile);
        badge.className = 'f95f-badge f95f-badge--pending';
        badge.textContent = '\u2026';
        fetchQueue.push(fetchGameData(gameUrl, getGameRating(tile)));
    }

    const results = await Promise.all(fetchQueue);

    for (const { gameUrl, gameData } of results) {
        GM_setValue(gameUrl, gameData);
        const tile = getGameElement(gameUrl);
        if (tile) filterGame(tile, gameData);
    }
}

async function fetchGameData(gameUrl, rating) {
    const response = await fetch(gameUrl);
    const doc = new DOMParser().parseFromString(
        await response.text(),
        'text/html',
    );

    const reviewCount =
        parseInt(
            doc
                .querySelector(selector.reviewTab)
                ?.textContent?.replace(',', '')
                .match(/\d+/)?.[0],
            10,
        ) || 0;

    return {
        gameUrl,
        gameData: { rating, reviewCount, timestamp: Date.now() },
    };
}

function filterGame(gameElement, gameData) {
    const keep = shouldKeepItem(gameData.rating, gameData.reviewCount);

    gameElement.classList.remove('f95f-pending');
    gameElement.classList.add('f95f-tile', keep ? 'f95f-kept' : 'f95f-rejected');

    if (!keep) getOrCreateOverlay(gameElement);

    const badge = getOrCreateBadge(gameElement);
    badge.className = `f95f-badge ${keep ? 'f95f-badge--kept' : 'f95f-badge--rejected'}`;

    const icon = keep ? '\u2605' : '\u2715';
    const ratingStr = gameData.rating > 0 ? gameData.rating.toFixed(1) : 'N/A';
    const countStr =
        gameData.reviewCount > 0 ? ` (${gameData.reviewCount})` : '';
    badge.textContent = `${icon} ${ratingStr}${countStr}`;
}

// ── Init ─────────────────────────────────────────────────────────────────────

injectStyles();
scanGames();
window.addEventListener('urlchange', () => setTimeout(scanGames, 500));
