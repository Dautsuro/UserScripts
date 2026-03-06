// ==UserScript==
// @name         WebNovel Filter
// @namespace    https://github.com/Dautsuro/UserScripts
// @version      1.1.2
// @description  A smart filter for WebNovel fanfics that identifies high-quality stories by analyzing review consistency and statistical significance.
// @match        https://www.webnovel.com/tags/*-fanfic
// @match        https://www.webnovel.com/search?keywords=*&type=fanfic
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// ==/UserScript==

(function () {
    'use strict';

    const isSearchPage = location.href.includes('/search');

    const SELECTORS = {
        ITEM: isSearchPage ? '.j_result_wrap .pr' : '.g_book_item',
        ITEMS_CONTAINER: isSearchPage ? '.j_result_wrap' : '.j_bookList',
    };

    const DELAY_BETWEEN_CHECKS = 3 * 24 * 60 * 60 * 1000;
    const waitingList = [];
    
    let isFiltering = false;

    GM_addStyle(`
        [data-du-state="accepted"] {
            background-color: green;
        }

        [data-du-state="refused"] {
            background-color: red;
        }

        [data-du-state="processing"] {
            background-color: blue;
        }

        [data-du-state="waiting"] {
            background-color: orange;
        }
    `);

    function mean(values) {
        if (!values || !values.length) return 0;
        return values.reduce((sum, value) => sum + value, 0) / values.length;
    }

    function std(values) {
        if (!values || values.length < 2) return 0;
        const avg = mean(values);
        return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1));
    }

    function median(values) {
        if (!values || !values.length) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    function isItemAccepted(item, items = []) {
        const SCALE_MIN = 1;
        const SCALE_MAX = 5;
        // Z-score of 1.65 corresponds to a 90% one-sided confidence interval
        const Z_SCORE = 1.65;
        // Tuning factor: determines how many standard deviations above the mean an item needs to be
        const SELECTIVITY = 0.25;

        const targetRating = item.rating || 0;
        const targetRatingCount = item.ratingCount || 0;

        let globalMean = (SCALE_MIN + SCALE_MAX) / 2;
        let priorWeight = 10;
        let threshold = globalMean;

        if (items && items.length > 0) {
            const ratings = [];
            const ratingCounts = [];

            for (const i of items) {
                ratings.push(i.rating || 0);
                ratingCounts.push(i.ratingCount || 0);
            }

            globalMean = mean(ratings);
            // Uses the median number of votes across the catalog as the "prior weight" (C)
            // This prevents items with very few votes from having extreme Bayesian averages
            priorWeight = Math.max(1, median(ratingCounts));

            const bayesianAverages = items.map(i => {
                const rCount = i.ratingCount || 0;
                const r = i.rating || 0;
                // Bayesian average formula: (v*R + C*m) / (v+C)
                return (rCount * r + priorWeight * globalMean) / (rCount + priorWeight);
            });

            threshold = globalMean + SELECTIVITY * std(bayesianAverages);
        }

        const bayesianAvg = (targetRatingCount * targetRating + priorWeight * globalMean) / (targetRatingCount + priorWeight);
        
        const hasIndividualRatings = item.ratings && item.ratings.length >= 2;

        // Standard deviation estimation
        // If we lack individual ratings, we estimate worst-case variance for a bounded distribution 
        // using the property that variance is maxed out when values are at the extremes
        const sigma = hasIndividualRatings
            ? std(item.ratings)
            : Math.sqrt(Math.max((targetRating - SCALE_MIN) * (SCALE_MAX - targetRating), 0));

        const effectiveN = targetRatingCount + priorWeight;
        const standardError = sigma / Math.sqrt(effectiveN);

        // Calculates the Lower Confidence Bound (LCB)
        // This penalizes items with high uncertainty (few votes or high variance)
        const lowerBound = bayesianAvg - Z_SCORE * standardError;

        return lowerBound >= threshold;
    }

    function sleep(delay) {
        return new Promise((resolve) => setTimeout(resolve, delay));
    }

    function getItemId(itemElement) {
        if (itemElement.dataset.reportDid) return itemElement.dataset.reportDid;
        const titleElement = getTitleElement(itemElement);
        return titleElement.dataset.bookid;
    }

    function getTitleElement(itemElement) {
        return itemElement.querySelector('a[href*="/book/"]');
    }

    async function filterItems(itemElements) {
        isFiltering = true;
        if (!itemElements) itemElements = document.querySelectorAll(SELECTORS.ITEM);
        console.log(itemElements);
        itemElements.forEach(element => element.dataset.duState = 'waiting');
        const items = GM_getValue('items', []);

        for (const itemElement of itemElements) {
            const titleElement = getTitleElement(itemElement);
            const ratingElement = itemElement.querySelector('.g_star_num small');
            if (!titleElement) continue;

            itemElement.dataset.duState = 'processing';
            const itemId = getItemId(itemElement);
            let item = items.find(i => i.id === itemId);

            if (!item) {
                item = {
                    id: itemId,
                    title: titleElement.title,
                    url: titleElement.href,
                    rating: ratingElement ? parseFloat(ratingElement.textContent) : 0,
                };
            }

            if (item.rating > 0 && (!item.updatedAt || item.updatedAt + DELAY_BETWEEN_CHECKS < Date.now())) {
                // Item URL must be fetched for the API request to pass through
                // Also it guarantees that we can at least have the ratingCount
                const response = await fetch(item.url);
                const rawDoc = await response.text();
                const parser = new DOMParser();
                const doc = parser.parseFromString(rawDoc, 'text/html');

                const ratingCountElement = doc.querySelector('small.fs16');
                item.updatedAt = Date.now();
                item.ratingCount = parseInt(ratingCountElement
                    .textContent
                    .replace(',', '')
                    .match(/\d+/)?.[0] || 0);

                await sleep(500);
                item.ratings = await getRatings(item);
                await sleep(500);
            }

            if (!items.find(i => i.id === item.id)) items.push(item);
        }

        GM_setValue('items', items);
        refreshItemsState();
        if (waitingList.length) return setTimeout(filterItems, 100, waitingList.splice(0, 20));
        isFiltering = false;
    }

    function refreshItemsState() {
        const items = GM_getValue('items', []);

        for (const item of items) {
            let itemElement = isSearchPage
                ? document.querySelector(`${SELECTORS.ITEM} [data-bookid="${item.id}"]`)
                : document.querySelector(`${SELECTORS.ITEM}[data-report-did="${item.id}"]`);

            if (!itemElement) continue;
            if (isSearchPage) itemElement = itemElement.closest(SELECTORS.ITEM);
            itemElement.dataset.duState = isItemAccepted(item, items) ? 'accepted' : 'refused';
        }
    }

    async function getRatings(item) {
        const ratings = [];
        let ratingCount = item.ratingCount;
        let pageIndex = 1;

        while (ratingCount > 0) {
            const token = document.cookie.match(/_csrfToken=(.+?);/)[1];
            const url = `https://www.webnovel.com/go/pcm/bookReview/get-reviews?_csrfToken=${token}&bookId=${item.id}&pageIndex=${pageIndex}&pageSize=${ratingCount > 100 ? 100 : ratingCount}&orderBy=1&novelType=0&needSummary=1`;
            ratingCount = ratingCount - 100;
            pageIndex++;

            const options = {
                credentials: 'include',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:148.0) Gecko/20100101 Firefox/148.0',
                    'Accept': 'application/json, text/javascript, */*; q=0.01',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Sec-Fetch-Dest': 'empty',
                    'Sec-Fetch-Mode': 'cors',
                    'Sec-Fetch-Site': 'same-origin',
                    'Priority': 'u=4',
                },
                referrer: item.url,
                method: 'GET',
                mode: 'cors',
            };

            const response = await fetch(url, options);
            const data = await response.json();
            ratings.push(...data.data.bookReviewInfos.map(review => review.totalScore));
            sleep(500);
        }

        console.log(ratings);
        return ratings;
    }

    const itemsObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) waitingList.push(isSearchPage ? node : node.querySelector(SELECTORS.ITEM));
            }
        }

        if (!isFiltering && waitingList.length) filterItems(waitingList.splice(0, 20));
    });

    itemsObserver.observe(document.querySelector(SELECTORS.ITEMS_CONTAINER), { subtree: true, childList: true });
    filterItems();
})();
