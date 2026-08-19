// ==UserScript==
// @name         WTR-LAB Simple Copy
// @namespace    https://github.com/Dautsuro/userscripts
// @version      1.1.1
// @description  Simple copy script for WTR-LAB.
// @author       Dautsuro
// @match        https://wtr-lab.com/en/novel/*/*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=wtr-lab.com
// @grant        GM_addStyle
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/Dautsuro/userscripts/main/wtr-lab-simple-copy/wtr-lab-simple-copy.user.js
// @updateURL    https://raw.githubusercontent.com/Dautsuro/userscripts/main/wtr-lab-simple-copy/wtr-lab-simple-copy.user.js
// @noframes
// ==/UserScript==

(function main() {
    'use strict';

    async function copyName() {
        const chineseName = document.querySelector('input[name="from"]').value.trim();
        const translatedName = document.querySelector('input[name="to"]').value.trim();
        const translatedNames = Array.from(document.querySelectorAll('.self-start span.px-1\\.5')).map((span) => span.textContent.trim());
        await navigator.clipboard.writeText(`${chineseName}|${translatedNames.join(';')}|Douluo Dalu`);
    }

    const closeButton = document.querySelector('button.border-transparent:nth-child(3)');

    if (!closeButton) {
        setTimeout(main, 1000);
        return;
    }

    if (!closeButton.parentElement.querySelector('[data-copy-name-button]')) {
        const copyButton = closeButton.cloneNode(true);
        copyButton.dataset.copyNameButton = 'true';
        copyButton.type = 'button';
        copyButton.textContent = 'Copy';
        copyButton.addEventListener('click', () => copyName());
        closeButton.after(copyButton);
    }

    setTimeout(main, 1000);
})();
