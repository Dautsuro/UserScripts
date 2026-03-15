// ==UserScript==
// @name      TranslAI
// @namespace https://github.com/Dautsuro/userscripts
// @version   2.0.3
// @match     https://www.69shuba.com/book/*.htm
// @match     https://www.69shuba.com/txt/*/*
// @grant     GM_xmlhttpRequest
// @grant     GM_getValue
// @grant     GM_setValue
// @grant     GM_deleteValue
// @grant     GM_listValues
// @grant     GM_addStyle
// @grant     GM_openInTab
// @grant     GM_setClipboard
// @top-level-await
// ==/UserScript==

const MODEL = 'gemini-3.1-flash-lite-preview';

const API_KEY = (() => {
    let apiKey = GM_getValue('apiKey');
    if (apiKey) return apiKey;

    while (!apiKey) apiKey = prompt('Enter your Gemini API key')?.trim();
    GM_setValue('apiKey', apiKey);

    return apiKey;
})();

const API_PARAMETERS = {
    title: {
        prompt: 'Role: Professional Chinese-to-English Literary Translator.\nTask: Translate the fanfiction title provided.\nConstraints:\n- Use proper English **Title Case** capitalization.\n- Output ONLY the translated string.\n- Balance literal meaning with genre-appropriate English title conventions.\n- If a verified English name/brand is in the input, do not change it.',
        temperature: 0.3,
        topP: 0.95,
        topK: 40,
    },
    synopsis: {
        prompt: 'Role: Senior Localization Editor for Webnovels.\nExpertise: Soul Land (Douluo Dalu) and Shonen Anime (Naruto, OP, Bleach, JJK).\nTask: Translate the synopsis into a compelling English narrative hook.\nGuidelines:\n- FLOW: Avoid repetitive sentence starters (e.g., "He... He..."). Use narrative transitions.\n- METADATA: Standardize tags (e.g., [OP MC], [Cultivation]).\n- TONE: Mirror the original atmospheric vibe (Dark, Epic, etc.).\n- SYMBOLS: Keep all brackets/symbols (【 】, 「 」) exactly as they are.\n- Output ONLY the synopsis.',
        temperature: 0.5,
        topP: 0.9,
        topK: 40,
    },
    chapter: {
        prompt: 'Role: Master Literary Translator (20 years exp) specializing in Chinese Webnovels.\nTask: High-fidelity translation of the chapter content.\nRules:\n- METRIC CONVERSION: Convert traditional Chinese units (e.g., li, jin, zhang) into their **Metric System** equivalents (meters, km, kg).\n- PROSE: Prioritize active voice. Avoid the "staccato" feel of literal MTL; ensure sentences flow naturally.\n- VERIFIED TERMS: Use the provided glossary when it makes sense to use them in the context.\n- DIALOGUE/SYSTEM: Speech in "", thoughts in \'\'. Preserve 【 】, 「 」, or 『 』 for system blocks.\n- HONORIFICS: Use natural English (e.g., "Senior," "Teacher," "Sect Leader").\n- Output ONLY the translated text, title included.',
        temperature: 0.6,
        topP: 0.9,
        topK: 40,
    },
    names: {
        prompt: 'Persona: Specialized Data Extraction Expert.\nTask: Extract Named Entity pairs (Chinese/English) from the provided "Original" and "Translated" blocks.\nStrict Rules:\n- ONLY extract specific entities: Character names, Sect names, Unique techniques, or Locations.\n- NO COMMON NOUNS: Do not extract generic words like "Teacher," "Brother," or "Disciple" unless they are part of a proper title (e.g., "Sect Leader Zhao").\n- DIRECT MAPPING: Use the exact English name found in the provided translated text.\n- FORMAT: Return a raw JSON array of objects with keys "original" and "translated". No markdown formatting.',
        temperature: 0.0,
        topP: 1.0,
        topK: 1.0,
    },
};

const SELECTORS = {
    TITLE: '.booknav2 > h1:nth-child(1) > a:nth-child(1)',
    SYNOPSIS: '.navtxt > p:nth-child(1)',
    CHAPTER: '.txtnav',
};

const COLORS = {
    local: {
        text: '#ffffff',
        background: '#5e2424',
    },
    checked: {
        text: '#bebdbb',
        background: '#1e3a5f',
    },
    global: {
        text: '#d8f3dc',
        background: '#1b4332',
    },
};

const BOOK_ID = location.href.split('/')[4].replace('.htm', '');
const CHAPTER_ID = location.href.split('/')[5];

const cache = {
    title: GM_getValue(`${BOOK_ID}:title`),
    synopsis: GM_getValue(`${BOOK_ID}:synopsis`),
    chapter: GM_getValue(`${BOOK_ID}:${CHAPTER_ID}`),
    names: {
        local: GM_getValue(`${BOOK_ID}:names`, []),
        global: GM_getValue('names', []),
    },
    fandoms: GM_getValue(`${BOOK_ID}:fandoms`, []),
};

GM_addStyle(`
    .button-container {
        position: fixed;
        bottom: 0;
        display: grid;
        margin: 5px;
    }

    #right-button-container {
        right: 0;
    }

    #left-button-container {
        left: 0;
    }

    .button-container button {
        font-size: x-large;
        margin-top: 5px;
    }

    #import {
        position: fixed;
        z-index: 10000000;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
    }
`);

function request(url, options) {
    const {
        method = 'GET',
        headers = {},
        responseType = 'json',
        data = {},
    } = options;

    return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            url,
            method,
            headers,
            responseType,
            data: JSON.stringify(data),
            onload: response => resolve(response.response),
            onerror: error => reject(error),
        });
    });
}

async function generateContent(input, prompt, temperature, topP, topK, responseMimeType = 'text/plain') {
    try {
        const response = await request(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': API_KEY,
            },
            data: {
                contents: [{ parts: [{ text: input }] }],
                systemInstruction: { parts: [{ text: prompt }] },
                generationConfig: { temperature, topP, topK, responseMimeType },
                safetySettings: [
                    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'OFF' },
                    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'OFF' },
                    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'OFF' },
                    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'OFF' },
                ],
            },
        });

        if (response?.candidates?.[0].content?.parts?.[0].text) {
            return response.candidates[0].content.parts[0].text;
        } else {
            alert('ERROR!');
            console.log(response);
            alert(JSON.stringify(response));
        }
    } catch (error) {
        alert('ERROR!');
        console.error(error);
        alert(JSON.stringify(error));
    }
}

function getContent(selector) {
    const contentElement = document.querySelector(selector);

    for (const node of contentElement.childNodes) {
        if (node.nodeName === '#text' || node.nodeName === 'BR') continue;
        node.remove();
    }

    const element = contentElement.innerHTML
        .replace(/<br>/g, '\n')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length)
        .join('\n\n');

    return element;
}

function setContent(selector, content) {
    const contentElement = document.querySelector(selector);

    contentElement.innerHTML = content
        .replace(/\n/g, '<br>')
        .replace(/’/g, '\'');
}

async function translateContent(content, parameters) {
    console.log(content);
    const { prompt, temperature, topP, topK } = parameters;
    const translatedContent = await generateContent(content, prompt, temperature, topP, topK);
    return translatedContent;
}

async function extractNamesFromContent(originalContent, translatedContent) {
    const { prompt, temperature, topP, topK } = API_PARAMETERS.names;
    const input = `<original_text>${originalContent}</original_text><translated_text>${translatedContent}</translated_text>`;
    const names = await generateContent(input, prompt, temperature, topP, topK, 'application/json');
    return JSON.parse(names);
}

function highlightNamesInContent(content) {
    const names = [...cache.names.global, ...cache.names.local];
    if (!names.length) return content;
    const escapedNames = [];

    for (const item of names) {
        escapedNames.push(item.translated.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    }

    escapedNames.sort((a, b) => b.length - a.length);
    const regexPattern = `\b${escapedNames.join('|')}\b`;
    const regex = new RegExp(regexPattern, 'g');

    content = content.replace(regex, match => {
        const name = names.find(({ translated }) => translated === match);

        let color = COLORS.local;
        if (name.checked) color = COLORS.checked;
        if (isNameGlobal(name)) color = COLORS.global;

        return `<b style="color: ${color.text}; background-color: ${color.background}; user-select: all;" data-original="${name.original}">${name.translated}</b>`;
    });

    return content;
}

function refreshHighlight() {
    const highlightedContent = highlightNamesInContent(cache.chapter);
    setContent(SELECTORS.CHAPTER, highlightedContent);
}

function changeNameInContent(oldName, newName) {
    cache.chapter = cache.chapter.replace(new RegExp(oldName, 'g'), newName);
    GM_setValue(`${BOOK_ID}:${CHAPTER_ID}`, cache.chapter);
    refreshHighlight();
}

function createGlossary(content) {
    const names = [...cache.names.global, ...cache.names.local];
    if (!names.length) return [];
    names.sort((a, b) => b.original.length - a.original.length);
    const regexPattern = names.map(name => name.original).join('|');
    const regex = new RegExp(regexPattern, 'g');
    const matches = content.match(regex);
    return [...new Set(matches.map(match => names.find(({ original }) => original === match)))];
}

function saveNames(names) {
    for (const name of names) {
        if (!name.original || !name.translated) continue;
        if (cache.names.local.find(({ original }) => original === name.original)) continue;
        if (cache.names.global.find(({ original }) => original === name.original)) continue;

        cache.names.local.push(name);
    }

    GM_setValue(`${BOOK_ID}:names`, cache.names.local);
}

function isNameGlobal(name) {
    return !!cache.names.global.find(({ original }) => original === name.original);
}

function getSelectedName() {
    const selection = getSelection();
    const node = selection.anchorNode;
    const original = node?.dataset.original;
    const localName = cache.names.local.find(name => name.original === original);
    const globalName = cache.names.global.find(name => name.original === original);
    
    return globalName || localName;
}

function editName(name, newName) {
    if (!name.original || !name.translated) name = getSelectedName();
    if (!name) return;

    const oldName = name.translated;

    if (!newName) {
        newName = prompt('Enter new name')?.trim();
        if (!newName) return;
    }

    name.translated = newName;
    GM_setValue(`${BOOK_ID}:names`, cache.names.local);
    GM_setValue('names', cache.names.global);
    changeNameInContent(oldName, newName);
}

function toggleGlobalName(name) {
    if (!name.original || !name.translated) name = getSelectedName();
    if (!name) return;

    if (isNameGlobal(name)) {
        cache.names.global = cache.names.global.filter(({ original }) => original !== name.original);
        cache.names.local.push(name);
    } else {
        editName(name);
        cache.names.local = cache.names.local.filter(({ original }) => original !== name.original);
        cache.names.global.push(name);
    }

    GM_setValue(`${BOOK_ID}:names`, cache.names.local);
    GM_setValue('names', cache.names.global);
    refreshHighlight();
}

function toggleCheckName() {
    const name = getSelectedName();
    if (!name) return name;

    if (!name.checked) editName(name);
    name.checked = !name.checked;

    const keys = GM_listValues().filter(key => key.includes(':names'));
    let occurrence = 0;

    for (const key of keys) {
        const tmpNames = GM_getValue(key);
        const tmpName = tmpNames.find(({ original }) => original === name.original);

        if (tmpName && tmpName.translated === name.translated) {
            occurrence++;
        }
    }

    if (occurrence >= 3) {
        toggleGlobalName(name);
        return;
    }

    GM_setValue(`${BOOK_ID}:names`, cache.names.local);
    GM_setValue('names', cache.names.global);
    refreshHighlight();
}

function deleteName() {
    const name = getSelectedName();
    if (!name) return;

    cache.names.local = cache.names.local.filter(({ original }) => original !== name.original);
    cache.names.global = cache.names.global.filter(({ original }) => original !== name.original);

    GM_setValue(`${BOOK_ID}:names`, cache.names.local);
    GM_setValue('names', cache.names.global);
    refreshHighlight();
}

function setFandoms() {
    const fandoms = prompt('Enter fandoms (seperate them by a semicolon)', cache.fandoms.join(';'))?.trim();
    if (!fandoms) return;
    cache.fandoms = fandoms.split(';');
    GM_setValue(`${BOOK_ID}:fandoms`, cache.fandoms);
}

function searchName() {
    const name = getSelectedName();
    if (!name) return;

    let searchQuery = `"${name.original}"`;
    if (cache.fandoms.length) searchQuery += ` (${cache.fandoms.map(fandom => `site:${fandom}.fandom.com`).join(' OR ')})`;
    
    GM_setClipboard(name.original, 'text/plain');
    GM_openInTab(`https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`);
}

function looseSearchName() {
    const name = getSelectedName();
    if (!name) return;

    let searchQuery = name.translated;
    if (cache.fandoms.length) searchQuery += ` (${cache.fandoms.map(fandom => `site:${fandom}.fandom.com`).join(' OR ')})`;
    
    GM_setClipboard(name.translated, 'text/plain');
    GM_openInTab(`https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`);
}

// Should be a correct implementation of the Levenshtein distance
// Source: https://en.wikipedia.org/wiki/Levenshtein_distance
function levenshtein(nameA, nameB) {
    const tmp = [];
    for (let i = 0; i <= nameA.length; i++) tmp[i] = [i];
    for (let j = 0; j <= nameB.length; j++) tmp[0][j] = j;

    for (let i = 1; i <= nameA.length; i++) {
        for (let j = 1; j <= nameB.length; j++) {
            tmp[i][j] = Math.min(
                tmp[i - 1][j] + 1,
                tmp[i][j - 1] + 1,
                tmp[i - 1][j - 1] + (nameA[i - 1] === nameB[j - 1] ? 0 : 1)
            );
        }
    }

    return tmp[nameA.length][nameB.length];
}

function isNamesSimilar(nameA, nameB) {
    const distance = levenshtein(nameA, nameB);
    const longest = Math.max(nameA.length, nameB.length);
    const similarity = (longest - distance) / longest;
    return similarity >= 0.3 || nameA.includes(nameB) || nameB.includes(nameA);
}

function generatePrompt() {
    const name = getSelectedName();
    if (!name) return;

    const names = [...cache.names.local.filter(name => name.checked), ...cache.names.global];

    const formattedNames = names
        .filter(({ original }) => isNamesSimilar(name.original, original))
        .map(name => `${name.original}:${name.translated}:${name.checked ? '1' : '2'}`)
        .join('\n');

    const prompt = `**Role:** Lead Localization Editor for Chinese Webnovels.\n\n**Target Name:** \`${name.original}\`\n**Context:** \`${cache.originalChapter}\`\n\n**Glossary (Original:Translated:Weight):**\n${formattedNames}\n\n**Instructions:**\n\n* Provide 3–5 translation options, ranked with the best option first.\n* **No Word Fusion:** Never combine separate words/concepts into one (e.g., use "Shadow Blade," not "Shadowblade").\n* **Naming Style:** Keep names concise. Do not use "the," "of," or other articles/prepositions unless absolutely necessary for the name's meaning.\n* **Prioritization:** Follow the style of Weight 2 glossary terms.\n\n**Output:**\nReturn **only** a numbered list of the translated names in order of quality. Do not include explanations, logic, or any other text.`;

    GM_setClipboard(prompt, 'text/plain');
}

function deleteCache() {
    const keys = GM_listValues();

    for (const key of keys) {
        if (key === `${BOOK_ID}:names` || key === `${BOOK_ID}:fandoms`) continue;
        if (key.includes(BOOK_ID)) GM_deleteValue(key);
    }

    alert(`Cache deleted for book ${BOOK_ID}`);
}

function addName() {
    const originalName = prompt('Enter original name')?.trim();
    if (!originalName) return;
    const translatedName = prompt('Enter translated name')?.trim();
    if (!translatedName) return;

    const localName = cache.names.local.find(name => name.original === originalName);
    const globalName = cache.names.global.find(name => name.original === originalName);
    const name = localName || globalName;

    if (name) {
        editName(name, translatedName);
        if (!isNameGlobal(name)) toggleGlobalName(name);
    } else {
        cache.names.global.push({ original: originalName, translated: translatedName });
    }

    GM_setValue(`${BOOK_ID}:names`, cache.names.local);
    GM_setValue('names', cache.names.global);
    refreshHighlight();
}

function generateCheckPrompt() {
    const name = getSelectedName();
    if (!name) return;

    const prompt = `Determine if the Chinese name **${name.original}** matches the English name provided below. Consider standard Pinyin, regional transliterations (like Cantonese or Hokkien), and common English equivalents.\n\n**Output format:**\n\n* If they match: ✅\n* If they do not match: ❌ [Short explanation]\n\n**English Name:** `;

    GM_setClipboard(prompt, 'text/plain');
}

async function exportNames() {
    const blob = new Blob([JSON.stringify(cache.names.global)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    
    a.href = url;
    a.download = 'names.json';
    a.click();
    
    URL.revokeObjectURL(url);
}

async function importNames() {
    const input = document.createElement('input');
    input.id = 'import';
    input.type = 'file';
    input.accept = '.json';

    input.onchange = event => {
        const file = event.target.files[0];
        const reader = new FileReader();
        
        reader.onload = readerEvent => {
            const content = readerEvent.target.result;
            const names = JSON.parse(content);
            
            for (const name of names) {
                if (!name.original || !name.translated) continue;
                if (cache.names.global.find(({ original }) => original === name.original)) continue;
                
                const localName = cache.names.local.find(({ original }) => original === name.original);
                if (localName) cache.names.local = cache.names.local.filter(({ original }) => original !== name.original);

                cache.names.global.push({ original: name.original, translated: name.translated });
            }

            GM_setValue(`${BOOK_ID}:names`, cache.names.local);
            GM_setValue('names', cache.names.global);
            refreshHighlight();
            alert('Import Successful!');
            input.remove();
        };
        
        reader.readAsText(file);
    };

    document.body.appendChild(input);
}

function injectButton(label, onClick, position = 'right') {
    let container = document.getElementById(`${position}-button-container`);

    if (!container) {
        container = document.createElement('div');
        container.id = `${position}-button-container`;
        container.className = 'button-container';
        document.body.appendChild(container);
    }

    const button = document.createElement('button');
    button.textContent = label;
    button.addEventListener('click', onClick);
    container.appendChild(button);
}

if (location.href.includes('/book/')) {
    const title = getContent(SELECTORS.TITLE);
    const synopsis = getContent(SELECTORS.SYNOPSIS);

    if (!cache.title || !cache.synopsis) {
        const [translatedTitle, translatedSynopsis] = await Promise.all([
            translateContent(title, API_PARAMETERS.title),
            translateContent(synopsis, API_PARAMETERS.synopsis),
        ]);

        cache.title = translatedTitle;
        cache.synopsis = translatedSynopsis;

        GM_setValue(`${BOOK_ID}:title`, cache.title);
        GM_setValue(`${BOOK_ID}:synopsis`, cache.synopsis);
    }

    setContent(SELECTORS.TITLE, cache.title);
    setContent(SELECTORS.SYNOPSIS, cache.synopsis);

    injectButton('🗑️', deleteCache);
}

if (location.href.includes('/txt/')) {
    document.querySelector('.tools')?.remove();
    const chapter = getContent(SELECTORS.CHAPTER);
    cache.originalChapter = chapter;

    if (!cache.chapter) {
        const glossary = createGlossary(chapter);
        cache.chapter = await translateContent(`<glossary>${JSON.stringify(glossary)}</glossary><chapter>${chapter}</chapter>`, API_PARAMETERS.chapter);
        GM_setValue(`${BOOK_ID}:${CHAPTER_ID}`, cache.chapter);
    }
    
    const names = await extractNamesFromContent(chapter, cache.chapter);
    saveNames(names);
    refreshHighlight();

    
    injectButton('🗑️', deleteName);
    injectButton('➕', addName);
    injectButton('🔮', generateCheckPrompt);
    injectButton('✨', generatePrompt);
    injectButton('✏️', editName);
    injectButton('📌', toggleGlobalName);
    injectButton('✔️', toggleCheckName);
    injectButton('🔎', looseSearchName);
    injectButton('🔍', searchName);

    injectButton('⚙️', setFandoms, 'left');
    injectButton('⬆️', exportNames, 'left');
    injectButton('⬇️', importNames, 'left');
}
