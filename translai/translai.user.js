// ==UserScript==
// @name      TranslAI
// @namespace https://github.com/Dautsuro/userscripts
// @version   1.4.3
// @match     https://www.69shuba.com/book/*.htm
// @match     https://www.69shuba.com/txt/*/*
// @grant     GM_xmlhttpRequest
// @grant     GM_getValue
// @grant     GM_setValue
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
        prompt: 'Role: Master Literary Translator (20 years exp) specializing in Chinese Webnovels.\nTask: High-fidelity translation of the chapter content.\nRules:\n- METRIC CONVERSION: Convert traditional Chinese units (e.g., li, jin, zhang) into their **Metric System** equivalents (meters, km, kg).\n- PROSE: Prioritize active voice. Avoid the "staccato" feel of literal MTL; ensure sentences flow naturally.\n- VERIFIED TERMS: Keep Latin-script names/terms exactly as they are.\n- DIALOGUE/SYSTEM: Speech in "", thoughts in \'\'. Preserve 【 】, 「 」, or 『 』 for system blocks.\n- HONORIFICS: Use natural English (e.g., "Senior," "Teacher," "Sect Leader").\n- Output ONLY the translated text.',
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
    #button-container {
        position: fixed;
        bottom: 0;
        right: 0;
        display: grid;
        margin: 5px;
    }

    #button-container button {
        font-size: x-large;
        margin-top: 5px;
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
    names.sort((a, b) => b.translated.length - a.translated.length);
    const regexPattern = `(${names.map(name => name.translated).join('|')})(?!<\/b>)`;
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

function replaceNamesInContent(content) {
    const names = [...cache.names.global, ...cache.names.local];
    names.sort((a, b) => b.original.length - a.original.length);
    const regexPattern = names.map(name => name.original).join('|');
    const regex = new RegExp(regexPattern, 'g');

    content = content.replace(regex, match => {
        const name = names.find(({ original }) => original === match);
        return name.translated;
    });

    return content;
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

function editName(name) {
    if (!name.original || !name.translated) name = getSelectedName();
    if (!name) return;
    
    const oldName = name.translated;
    const newName = prompt('Enter new name')?.trim();
    if (!newName) return;

    name.translated = newName;
    GM_setValue(`${BOOK_ID}:names`, cache.names.local);
    GM_setValue('names', cache.names.global);
    changeNameInContent(oldName, newName);
}

function toggleGlobalName() {
    const name = getSelectedName();
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

function generatePrompt() {
    const name = getSelectedName();
    if (!name) return;

    const names = [...cache.names.local.filter(name => name.checked), ...cache.names.global];
    const formattedNames = names.map(name => `${name.original}:${name.translated}:${name.checked ? '1' : '2'}`).join('\n');

    const prompt = `**Role:** Lead Localization Editor for Chinese Webnovels. \n\n**Target Name:** \`${name.original}\`\n**Context:** \`${cache.originalChapter}\`\n\n**Glossary (Format -> Original:Translated:Weight):**\n* Weight 2 = Official wiki translation (Mandatory style matching).\n* Weight 1 = Unofficial translation (Use as flexible inspiration).\n\`\`\`\n${formattedNames}\n\`\`\`\n\n**Task:** Provide 3-5 ranked English translation options for the Target Name based on the Context. You must prioritize styling the name after Weight 2 glossary terms.\n\n**Output per option:**\n* **Translation:** * **Logic & Context:** Brief explanation of the linguistic translation and chapter fit.\n* **Glossary Alignment:** How it matches the approved glossary's style.\n\n**Ranking:** 1. Glossary Consistency (Weight 2 > Weight 1), 2. Narrative Impact, 3. English Clarity. Keep it concise and flavor-focused.`;

    GM_setClipboard(prompt, 'text/plain');
}

function injectButton(label, onClick) {
    let container = document.getElementById('button-container');

    if (!container) {
        container = document.createElement('div');
        container.id = 'button-container';
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
}

if (location.href.includes('/txt/')) {
    document.querySelector('.tools')?.remove();
    const chapter = getContent(SELECTORS.CHAPTER);
    cache.originalChapter = chapter;

    if (!cache.chapter) {
        const formattedChapter = replaceNamesInContent(chapter);
        cache.chapter = await translateContent(formattedChapter, API_PARAMETERS.chapter);
        GM_setValue(`${BOOK_ID}:${CHAPTER_ID}`, cache.chapter);
    }
    
    const names = await extractNamesFromContent(chapter, cache.chapter);
    saveNames(names);
    refreshHighlight();

    injectButton('⚙️', setFandoms);
    injectButton('🗑️', deleteName);
    injectButton('✨', generatePrompt);
    injectButton('✏️', editName);
    injectButton('📌', toggleGlobalName);
    injectButton('✔️', toggleCheckName);
    injectButton('🔎', looseSearchName);
    injectButton('🔍', searchName);
}
