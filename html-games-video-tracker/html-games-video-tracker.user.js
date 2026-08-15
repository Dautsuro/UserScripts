// ==UserScript==
// @name         HTML Games Video Tracker
// @namespace    https://github.com/Dautsuro/userscripts
// @version      1.1.0
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
    const trackedVideos = new WeakSet();

    GM_addStyle(`
        video.${CSS_PREFIX}-tracked:not(.${CSS_PREFIX}-ended) {
            object-fit: contain;
            object-position: 9999px 9999px;
            overflow: hidden;
            background: red;
        }

        video.${CSS_PREFIX}-tracked.${CSS_PREFIX}-playing {
            object-position: 50% 50%;
            background: black;
            cursor: none;
        }
    `);

    function getVideoId(video) {
        const src = video.getAttribute('src')
            ?? video.querySelector('source')?.getAttribute('src');

        return src ? `${GAME_NAME}:${src}` : null;
    }

    function trackVideo(video) {
        if (trackedVideos.has(video)) return;

        const videoId = getVideoId(video);
        if (!videoId) return;

        trackedVideos.add(video);
        let hasEnded = GM_getValue(videoId, false);

        video.classList.add(`${CSS_PREFIX}-tracked`);
        video.classList.toggle(`${CSS_PREFIX}-ended`, hasEnded);

        video.autoplay = hasEnded;
        video.controls = !hasEnded;
        video.loop = hasEnded;
        video.muted = hasEnded;

        video.addEventListener('play', () => {
            if (hasEnded) return;
            if (video.currentTime === 0) video.currentTime = Number.MIN_VALUE;
            video.volume = 1;
            video.classList.add(`${CSS_PREFIX}-playing`);
            video.controls = false;
            void video.requestFullscreen().catch(() => {});
        });

        video.addEventListener('pause', () => {
            if (hasEnded) return;
            video.classList.remove(`${CSS_PREFIX}-playing`);
            video.controls = true;
            void document.exitFullscreen().catch(() => {});
        });

        video.addEventListener('ended', () => {
            if (hasEnded) return;
            hasEnded = true;
            GM_setValue(videoId, true);
            video.classList.toggle(`${CSS_PREFIX}-ended`, true);
            video.controls = false;
            video.loop = true;
            video.muted = true;
            void video.play().catch(() => {});
        });
    }

    function trackVideos(root = document) {
        if (root instanceof HTMLVideoElement) {
            trackVideo(root);
            return;
        }

        if (root instanceof HTMLSourceElement) {
            const video = root.closest('video');
            if (video) trackVideo(video);
            return;
        }

        root.querySelectorAll('video').forEach(trackVideo);
    }

    const bodyObserver = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE) trackVideos(node);
            });
        });
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });
    trackVideos();
})();
