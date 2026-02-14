// ==UserScript==
// @name        WebNovel Filter
// @namespace   https://github.com/Dautsuro/userscripts
// @version     1.0
// @description Filters webnovel.com fanfic listings by rating and review count, color-coding books based on quality thresholds
// @icon        https://www.google.com/s2/favicons?sz=64&domain=webnovel.com
// @grant       GM_setValue
// @grant       GM_getValue
// @author      Dautsuro
// @match       https://www.webnovel.com/tags/*-fanfic
// @match       https://www.webnovel.com/search?keywords=*&type=fanfic
// @updateURL   https://raw.githubusercontent.com/Dautsuro/userscripts/main/webnovel-filter.user.js
// @downloadURL https://raw.githubusercontent.com/Dautsuro/userscripts/main/webnovel-filter.user.js
// ==/UserScript==

const CACHE_DURATION = 3 * 24 * 60 * 60 * 1000; // 3 days
const processQueue = new Set();
let processing = false;
const flag = window.location.href.includes('/tags/');

const Selector = Object.freeze({
    OBSERVER: flag ? '.j_bookList' : '.j_list_container',
    BOOKS: flag ? '.j_bookList .g_book_item' : '.j_result_wrap li'
});

const Status = Object.freeze({
    PENDING: 0,
    ACCEPTED: 1,
    REFUSED: 2
});

const observer = new MutationObserver(scanBooks);
observer.observe(document.querySelector(Selector.OBSERVER), { subtree: true, childList: true });
scanBooks();

function scanBooks() {
    const books = document.querySelectorAll(Selector.BOOKS);

    for (const book of books) {
        setBookStatus(book, Status.PENDING);
        const bookUrl = book.querySelector('a[href*="/book/"]').href;
        const bookData = GM_getValue(bookUrl);

        if (!bookData || bookData.timestamp + CACHE_DURATION < Date.now()) {
            processQueue.add(book);
            continue;
        }

        filterBook(book, bookData);
    }

    if (!processing) {
        processBooks();
    }
}

function processBooks() {
    processing = true;
    const books = Array.from(processQueue);
    const book = books[0];
    
    if (!book) {
        processing = false;
        return;
    }

    const bookUrl = book.querySelector('a[href*="/book/"]').href;

    fetch(bookUrl)
        .then((response) => response.text())
        .then((bookPage) => {
            const parser = new DOMParser();
            const bookDocument = parser.parseFromString(bookPage, 'text/html');
            const bookScore = bookDocument.querySelector('._score');
            const bookRating = parseFloat(bookScore.querySelector('strong').textContent) || 0;
            const bookReviewCount = parseInt(bookScore.querySelector('small').textContent.match(/\d+/)?.[0]) || 0;

            const bookData = {
                rating: bookRating,
                reviewCount: bookReviewCount,
                timestamp: Date.now()
            }

            GM_setValue(bookUrl, bookData);
            processQueue.delete(book);
            filterBook(book, bookData);
            setTimeout(processBooks, 1000);
        });
}

function setBookStatus(book, status) {    
    switch (status) {
        case Status.PENDING:
            book.style.backgroundColor = 'orange';
            break;
        case Status.ACCEPTED:
            book.style.backgroundColor = 'green';
            break;
        case Status.REFUSED:
            book.style.backgroundColor = 'red';
            break;
    }
}

function filterBook(book, bookData) {
    if (bookData.reviewCount < 10) {
        return setBookStatus(book, Status.REFUSED);
    } else if (bookData.reviewCount < 20) {
        if (bookData.rating < 4.5) return setBookStatus(book, Status.REFUSED);
    } else if (bookData.reviewCount < 50) {
        if (bookData.rating < 4.2) return setBookStatus(book, Status.REFUSED);
    } else if (bookData.reviewCount < 200) {
        if (bookData.rating < 3.8) return setBookStatus(book, Status.REFUSED);
    } else {
        if (bookData.rating < 3.5) return setBookStatus(book, Status.REFUSED);
    }

    setBookStatus(book, Status.ACCEPTED);
}
