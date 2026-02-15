// ==UserScript==
// @name        Local Video Controls
// @namespace   https://github.com/Dautsuro/userscripts
// @version     1.1
// @description Sets video defaults and toggles fullscreen/controls on play/pause for local HTML files
// @grant       GM_addStyle
// @grant       GM_getValue
// @grant       GM_setValue
// @author      Dautsuro
// @match       file:///G:/*
// @updateURL   https://raw.githubusercontent.com/Dautsuro/userscripts/main/local-video-controls.user.js
// @downloadURL https://raw.githubusercontent.com/Dautsuro/userscripts/main/local-video-controls.user.js
// ==/UserScript==

(function () {
    'use strict';

    // --- Cache helpers ---

    function getGameName() {
        const path = decodeURIComponent(location.pathname); // e.g. /G:/Love & Vice/R16/Love & Vice.html
        const match = path.match(/^\/G:\/([^/]+)/);
        return match ? match[1] : '';
    }

    function getVideoSrc(video) {
        // src can be on the <video> itself or on a <source> child
        return video.getAttribute('src')
            || video.querySelector('source')?.getAttribute('src')
            || '';
    }

    function getVideoKey(video) {
        const gameName = getGameName();
        const pagePath = decodeURIComponent(location.pathname);
        // Strip everything up to and including the version folder (second folder after G:/)
        // e.g. /G:/Love & Vice/R16/Love & Vice.html → base is /G:/Love & Vice/R16/
        const baseMatch = pagePath.match(/^(\/G:\/[^/]+\/[^/]+\/)/);
        const base = baseMatch ? baseMatch[1] : '';
        // Resolve video src relative to page base
        const rawSrc = getVideoSrc(video);
        let videoPath = rawSrc;
        if (base) {
            const fullBase = 'file:///' + base.replace(/^\//, '');
            const resolved = decodeURIComponent(new URL(rawSrc, location.href).href).replace(/\\/g, '/');
            if (resolved.startsWith(fullBase)) {
                videoPath = resolved.slice(fullBase.length);
            }
        }
        return gameName + '::' + videoPath;
    }

    function loadSeen() {
        return GM_getValue('lvc_seen', {});
    }

    function markSeen(key) {
        const seen = loadSeen();
        seen[key] = Date.now();
        GM_setValue('lvc_seen', seen);
    }

    // --- Styles ---

    GM_addStyle(`
        .lvc-hide-cursor,
        .lvc-hide-cursor video {
            cursor: none !important;
        }

        .lvc-video-wrap {
            position: relative;
            display: inline-block;
        }

        .lvc-unseen {
            filter: blur(20px) brightness(0.4);
            transition: filter 0.4s ease;
        }

        .lvc-spoiler-overlay {
            position: absolute;
            inset: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            z-index: 10;
            background: rgba(0, 0, 0, 0.3);
            border: 2px solid #00bcd4;
            border-radius: 4px;
            color: #e0e0e0;
            font-family: sans-serif;
            user-select: none;
        }

        .lvc-spoiler-overlay svg {
            width: 48px;
            height: 48px;
            fill: #00bcd4;
            margin-bottom: 8px;
        }

        .lvc-spoiler-overlay span {
            font-size: 14px;
            color: #b0bec5;
        }

        .lvc-seen-badge {
            position: absolute;
            top: 6px;
            right: 6px;
            width: 24px;
            height: 24px;
            background: #4caf50;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10;
            pointer-events: none;
            box-shadow: 0 1px 3px rgba(0,0,0,0.4);
        }

        .lvc-seen-badge svg {
            width: 14px;
            height: 14px;
            fill: #fff;
        }

        .lvc-seen {
            border-left: 3px solid #4caf50;
        }
    `);

    // --- SVG icons ---

    const eyeSlashSVG = `<svg viewBox="0 0 24 24"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C11.74 7.13 12.5 7 12 7zM2 4.27l2.28 2.28.46.46A11.8 11.8 0 001 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>`;

    const checkSVG = `<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>`;

    // --- Video setup ---

    function setupVideo(video) {
        if (video.dataset.lvcSetup) return;
        video.dataset.lvcSetup = '1';

        video.autoplay = false;
        video.loop = false;
        video.muted = false;
        video.controls = true;

        // Wrap in container for overlay positioning
        const wrap = document.createElement('div');
        wrap.className = 'lvc-video-wrap';
        video.parentNode.insertBefore(wrap, video);
        wrap.appendChild(video);

        const key = getVideoKey(video);
        const seen = loadSeen();
        const isSeen = key in seen;

        if (isSeen) {
            applySeenState(video, wrap);
        } else {
            applyUnseenState(video, wrap);
        }

        video.addEventListener('play', () => {
            if (video.currentTime === 0) video.currentTime = Number.MIN_VALUE;
            video.controls = false;
            document.documentElement.classList.add('lvc-hide-cursor');
            if (!document.fullscreenElement) {
                video.requestFullscreen().catch(() => {});
            }
        });

        video.addEventListener('pause', () => {
            video.controls = true;
            document.documentElement.classList.remove('lvc-hide-cursor');
            if (document.fullscreenElement) {
                document.exitFullscreen().catch(() => {});
            }
        });

        video.addEventListener('ended', () => {
            video.controls = true;
            document.documentElement.classList.remove('lvc-hide-cursor');
            if (document.fullscreenElement) {
                document.exitFullscreen().catch(() => {});
            }
            // Mark as seen and swap visuals
            if (!(key in loadSeen())) {
                markSeen(key);
                removeUnseenState(video, wrap);
                applySeenState(video, wrap);
            }
        });
    }

    function applySeenState(video, wrap) {
        video.classList.add('lvc-seen');
        const badge = document.createElement('div');
        badge.className = 'lvc-seen-badge';
        badge.innerHTML = checkSVG;
        wrap.appendChild(badge);
    }

    function applyUnseenState(video, wrap) {
        video.classList.add('lvc-unseen');
        video.controls = false;

        const overlay = document.createElement('div');
        overlay.className = 'lvc-spoiler-overlay';
        overlay.innerHTML = eyeSlashSVG + '<span>Click to reveal</span>';
        wrap.appendChild(overlay);

        overlay.addEventListener('click', (e) => {
            e.stopPropagation();
            removeUnseenState(video, wrap);
            video.controls = true;
            video.play().catch(() => {});
        });
    }

    function removeUnseenState(video, wrap) {
        video.classList.remove('lvc-unseen');
        const overlay = wrap.querySelector('.lvc-spoiler-overlay');
        if (overlay) overlay.remove();
    }

    // Process existing videos
    document.querySelectorAll('video').forEach(setupVideo);

    // Watch for new videos
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;
                if (node.tagName === 'VIDEO') setupVideo(node);
                node.querySelectorAll?.('video').forEach(setupVideo);
            }
        }
    });
    observer.observe(document.body, { subtree: true, childList: true });
})();
