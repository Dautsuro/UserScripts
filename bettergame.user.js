// ==UserScript==
// @name         BetterGame
// @version      1.1.0
// @match        file:///C:/Games/*/*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @downloadURL  https://raw.githubusercontent.com/Dautsuro/UserScripts/main/bettergame.user.js
// ==/UserScript==

processVideos();
processImages();

const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
        if (!['autoplay', 'controls', 'loop', 'muted', 'volume'].includes(mutation.attributeName)) {
            processVideos();
            processImages();
        }
    }
});

observer.observe(document.body, { subtree: true, childList: true, attributes: true });

function processVideos() {
    const videos = document.querySelectorAll('video');

    for (const video of videos) {
        if (video.processed) continue;

        video.processed = true;
        video.autoplay = false;
        video.controls = true;
        video.loop = false;
        video.muted = false;
        video.volume = 1.0;
        
        const srcArgs = video.src.split('/');
        const videoId = `${srcArgs[5]}/${srcArgs.splice(7).join('/')}`;
        video.seen = GM_getValue(videoId);

        video.style.outline = video.seen ? '3px solid green' : '3px solid red';
        video.style.outlineOffset = '-3px';

        video.addEventListener('play', () => {
            video.requestFullscreen();
            if (!video.playedOnce) video.currentTime = 0.002;
            video.playedOnce = true;
            video.controls = false;
            video.style.outline = 'unset';
            video.style.cursor = 'none';
        });

        video.addEventListener('pause', () => {
            video.controls = true;
            video.style.outline = video.seen ? '3px solid green' : '3px solid red';
            video.style.cursor = 'unset';
            document.exitFullscreen();
        });

        video.addEventListener('ended', () => {
            video.seen = true;
            GM_setValue(videoId, video.seen);
            video.style.outline = '3px solid green';
        });
    }
}

function processImages() {
    const images = document.querySelectorAll('img:not(a img)');

    for (const image of images) {
        if (image.processed) continue;
        image.processed = true;

        const srcArgs = image.src.split('/');
        const imageId = `${srcArgs[5]}/${srcArgs.splice(7).join('/')}`;
        image.seen = GM_getValue(imageId);

        image.style.outline = image.seen ? '3px solid green' : '3px solid orange';
        image.style.outlineOffset = '-3px';

        image.seen = true;
        GM_setValue(imageId, image.seen);

        image.addEventListener('click', () => {
            if (!image.isFullscreen) {
                image.isFullscreen = true;
                image.requestFullscreen();
                image.style.outline = 'unset';
            } else {
                image.isFullscreen = false;
                document.exitFullscreen();
                image.style.outline = image.seen ? '3px solid green' : '3px solid orange';
            }
        });
    }
}