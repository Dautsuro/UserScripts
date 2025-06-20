// ==UserScript==
// @name         FanCopy
// @namespace    https://github.com/Dautsuro
// @version      1.2.0
// @description  Copy all infobox data into a formatted message ready for use.
// @author       Dautsuro
// @match        https://*.fandom.com/wiki/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=fandom.com
// @grant        none
// ==/UserScript==

const WANTED_LABELS = [
    'name',
    'aliases',
    'title(s)',
    'also known as',
];

const buttonElement = document.createElement('button');
buttonElement.innerText = '📋';

buttonElement.addEventListener('click', () => {
    const infoboxElement = document.querySelector('section.pi-group');
    const itemElements = infoboxElement.querySelectorAll('.pi-item');
    const titleElement = document.querySelector('.pi-title') || document.querySelector('.mw-page-title-main');
    const title = titleElement.innerText.trim();
    let englishNames = [title];

    for (const itemElement of itemElements) {
        const labelElement = itemElement.querySelector('.pi-data-label');
        const valueElement = itemElement.querySelector('.pi-data-value');
        if (!labelElement || !valueElement) continue;

        const label = labelElement.innerText.trim();
        const value = valueElement.innerText.trim();
        if (!WANTED_LABELS.includes(label.toLowerCase())) continue;

        const names = value.split('\n')
            .filter(n => n.length > 0)
            .map(name => name.replace(/\(.*?\)/g, '').trim())
            .map(name => name.replace(/[\u4e00-\u9fff]/g, '').trim());

        englishNames.push(...names);
    }

    englishNames = Array.from(new Set(englishNames));
    navigator.clipboard.writeText(englishNames.join('\n'));
});

Object.assign(buttonElement.style, {
    position: 'fixed',
    bottom: '5px',
    right: '5px',
    'z-index': 1000,
    'background-color': '#181a1b',
    padding: '5px',
});

document.body.appendChild(buttonElement);
