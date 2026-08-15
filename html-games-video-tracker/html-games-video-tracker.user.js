// ==UserScript==
// @name         HTML Games Video Tracker
// @namespace    https://github.com/Dautsuro/userscripts
// @version      1.0.0
// @description  Tracks videos in HTML games.
// @author       Dautsuro
// @match        file:///C:/Games/*/*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=twinery.org
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/Dautsuro/userscripts/main/html-games-video-tracker/html-games-video-tracker.user.js
// @updateURL    https://raw.githubusercontent.com/Dautsuro/userscripts/main/html-games-video-tracker/html-games-video-tracker.user.js
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const CSS_PREFIX = 'hgvt';
    const GAME_NAME = window.location.href.split('/').slice(-3, -2)[0];

    GM_addStyle(`
        video:not(.${CSS_PREFIX}-ended) {
            object-fit: contain;
            object-position: 9999px 9999px;
            overflow: hidden;
            background: red;
        }

        video.${CSS_PREFIX}-playing {
            object-position: 50% 50%;
            background: black;
            cursor: none;
        }
    `);

    function getVideoId(video) {
        let src = video.getAttribute('src');

        if (!src) {
            const srcEl = video.querySelector('source');
            src = srcEl.getAttribute('src');
        }

        return `${GAME_NAME}:${src}`;
    }

    function trackVideos() {
        const videos = document.querySelectorAll('video');

        videos.forEach(video => {
            const videoId = getVideoId(video);
            let hasEnded = GM_getValue(videoId, false);

            video.classList.toggle(`${CSS_PREFIX}-ended`, hasEnded);

            video.autoplay = hasEnded ? true : false;
            video.controls = hasEnded ? false : true;
            video.loop = hasEnded ? true : false;
            video.muted = hasEnded ? true : false;

            video.addEventListener('play', () => {
                if (hasEnded) return;
                if (video.currentTime === 0) video.currentTime = Number.MIN_VALUE;
                video.volume = 1;
                video.classList.toggle(`${CSS_PREFIX}-playing`, true);
                video.controls = false;
                video.requestFullscreen();
            });

            video.addEventListener('pause', () => {
                if (hasEnded) return;
                video.classList.toggle(`${CSS_PREFIX}-playing`, false);
                video.controls = true;
                document.exitFullscreen();
            });

            video.addEventListener('ended', () => {
                if (hasEnded) return;
                hasEnded = true;
                GM_setValue(videoId, true);
                video.classList.toggle(`${CSS_PREFIX}-ended`, true);
                video.controls = false;
                video.loop = true;
                video.muted = true;
                video.play();
            });
        });
    }

    const bodyObserver = new MutationObserver(trackVideos);
    bodyObserver.observe(document.body, { childList: true, subtree: true });
    trackVideos();
})();
