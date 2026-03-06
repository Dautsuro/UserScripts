# WebNovel Filter

A sophisticated userscript for **WebNovel.com** that uses statistical analysis to filter fanfiction. Instead of relying on raw (and often inflated) star ratings, this script calculates a **Bayesian Average** and a **Lower Confidence Bound (LCB)** to highlight stories that are mathematically likely to be high quality.

## Features

* **Statistical Auditing:** Evaluates stories based on review consistency and volume, not just the raw score.
* **Visual Color-Coding:** Instantly see the status of a story via background highlights:
* 🟩 **Green (Accepted):** High quality with high statistical confidence.
* 🟥 **Red (Refused):** Low rating or insufficient/inconsistent reviews.
* 🟦 **Blue (Processing):** Currently fetching deep review data from the API.
* 🟧 **Orange (Waiting):** Queued for analysis.


* **Smart Caching:** Stores results locally using `GM_setValue` and only refreshes data every 3 days to minimize API calls and stay under the radar.
* **Dynamic Support:** Works seamlessly with WebNovel’s infinite scrolling; new books are analyzed as soon as they appear.

---

## How It Works

WebNovel ratings are often skewed by a small number of 5-star reviews. This script applies two main mathematical concepts to find the "true" quality:

### 1. Bayesian Average

It calculates a weighted average that factors in the global mean of all stories you've encountered. This prevents stories with only 1 or 2 reviews from appearing at the top of the "quality" list.

### 2. Lower Confidence Bound (LCB)

The script calculates the "worst-case scenario" for a book's rating using a 90% confidence interval ($Z = 1.65$).

* If a book has a **4.5** rating but very high variance (many 1-star and 5-star reviews), its LCB will be low, and it will be marked **Red**.
* If a book has a **4.5** rating with very consistent 4 and 5-star reviews, its LCB will be high, and it will be marked **Green**.

---

## Installation

1. Install a userscript manager like [Tampermonkey](https://www.tampermonkey.net/), [Greasemonkey](https://www.greasemonkey.net/), or [Violentmonkey](https://violentmonkey.github.io/).
2. Open the raw file `webnovel-filter.user.js`.
3. Navigate to the WebNovel Fanfic tag page (e.g., `https://www.webnovel.com/tags/*-fanfic`).

## Technical Configuration

Inside the script, you can adjust the following constants to change the strictness of the filter:

| Constant | Default | Description |
| --- | --- | --- |
| `DELAY_BETWEEN_CHECKS` | 3 Days | How long to wait before re-fetching a book's data. |
| `SELECTIVITY` | 0.25 | How many standard deviations above the mean a book needs to be. |
| `Z_SCORE` | 1.65 | The confidence level (1.65 = 90% confidence). |
