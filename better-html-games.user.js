// ==UserScript==
// @name         Better HTML Games
// @namespace    https://github.com/Dautsuro/userscripts
// @version      1.1
// @description  Enhances HTML game videos with playback controls, fullscreen, and seen tracking
// @author       Dautsuro
// @match        file:///G:/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=twinery.org
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

const GAME_NAME = window.location.href.split('/')[4];
const observer = new MutationObserver(scanVideos);

// ── Styles ───────────────────────────────────────────────────────────────────

function injectStyles() {
    const style = document.createElement('style');
    style.id = 'bhg-styles';
    style.textContent = `
        .bhg-seen {
            outline: 3px solid #2ecc71;
            outline-offset: -3px;
            box-shadow: 0 0 14px 4px rgba(46, 204, 113, 0.55);
        }
        .bhg-unseen {
            filter: grayscale(1) blur(1rem) brightness(0.6);
        }
        .bhg-playing {
            cursor: none !important;
        }
        .bhg-wrapper {
            position: relative;
            display: inline-block;
        }
        .bhg-click-hint {
            position: absolute;
            inset: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 6px;
            pointer-events: none;
            z-index: 10;
        }
        .bhg-click-hint[hidden] {
            display: none;
        }
        .bhg-click-hint-icon {
            font-size: 2.6rem;
            filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.6));
        }
        .bhg-click-hint-text {
            font: 600 0.95rem/1 system-ui, sans-serif;
            color: rgba(255, 255, 255, 0.88);
            text-shadow: 0 1px 6px rgba(0, 0, 0, 0.8);
            letter-spacing: 0.04em;
            text-transform: uppercase;
        }
    `;
    document.head.appendChild(style);
}

// ── Core logic ───────────────────────────────────────────────────────────────

function scanVideos() {
    for (const video of document.querySelectorAll('video')) {
        if (video.dataset.bhgProcessed) continue;
        video.dataset.bhgProcessed = 'true';

        video.autoplay = false;
        video.controls = true;
        video.muted = false;
        video.loop = false;

        wrapVideo(video);

        const videoId = getVideoId(video);
        let seen = !!GM_getValue(videoId);
        updateIndicator(video, seen);

        video.addEventListener('play', () => {
            if (video.currentTime === 0) video.currentTime = Number.MIN_VALUE;
            video.requestFullscreen?.();
            video.controls = false;
            video.classList.add('bhg-playing');
            clearIndicator(video);
        });

        video.addEventListener('pause', () => {
            if (document.fullscreenElement) document.exitFullscreen();
            video.controls = true;
            video.classList.remove('bhg-playing');
            updateIndicator(video, seen);
        });

        video.addEventListener('ended', () => {
            seen = true;
            GM_setValue(videoId, true);
            updateIndicator(video, true);
        });
    }
}

function wrapVideo(video) {
    const wrapper = document.createElement('div');
    wrapper.className = 'bhg-wrapper';
    video.replaceWith(wrapper);
    wrapper.appendChild(video);

    const hint = document.createElement('div');
    hint.className = 'bhg-click-hint';
    hint.innerHTML = '<span class="bhg-click-hint-icon">\u{1F440}</span>'
        + '<span class="bhg-click-hint-text">Click to see</span>';
    wrapper.appendChild(hint);
}

function getVideoId(video) {
    const src =
        video.getAttribute('src') ??
        video.querySelector('source')?.getAttribute('src') ??
        '';
    return `${GAME_NAME}::${src}`;
}

function updateIndicator(video, seen) {
    video.classList.remove('bhg-seen', 'bhg-unseen');
    video.classList.add(seen ? 'bhg-seen' : 'bhg-unseen');
    const hint = video.parentElement?.querySelector('.bhg-click-hint');
    if (hint) hint.hidden = seen;
}

function clearIndicator(video) {
    video.classList.remove('bhg-seen', 'bhg-unseen');
    const hint = video.parentElement?.querySelector('.bhg-click-hint');
    if (hint) hint.hidden = true;
}

// ── Init ─────────────────────────────────────────────────────────────────────

injectStyles();
scanVideos();
observer.observe(document.body, { childList: true, subtree: true });
