// ==UserScript==
// @name      TranslAI
// @namespace https://github.com/Dautsuro/userscripts
// @version   1.2.1
// @match     https://www.69shuba.com/book/*.htm
// @match     https://www.69shuba.com/txt/*/*
// @grant     GM_xmlhttpRequest
// @grant     GM_getValue
// @grant     GM_setValue
// @grant     GM_openInTab
// @grant     GM_setClipboard
// @top-level-await
// ==/UserScript==

const MODEL = 'gemini-3.1-flash-lite-preview';

const API_KEY = (() => {
    let apiKey = GM_getValue('apiKey');
    if (apiKey) return apiKey;

    while (!apiKey) {
        apiKey = prompt('Enter your Gemini API key');
    }

    GM_setValue('apiKey', apiKey);
    return apiKey;
})();

const apiParameters = {
    title: {
        prompt: 'Role: Professional Chinese-to-English Literary Translator.\nTask: Translate the fanfiction title provided in the user message.\nConstraints:\n- Output ONLY the translated string. No explanations.\n- Balance literal meaning with genre-appropriate English title conventions.\n- If a verified English name is in the input, do not change it.',
        temperature: 0.1,
        topP: 0.95,
        topK: 40,
    },
    synopsis: {
        prompt: 'Role: Senior Localization Editor for Webnovels.\nExpertise: Soul Land (Douluo Dalu) lore and Shonen Anime (Naruto, OP, Bleach, JJK).\nTask: Translate the synopsis while maintaining the original tone and format.\nGuidelines:\n- Keep all brackets/symbols (e.g., 【 】, 「 」) exactly as they are.\n- Standardize metadata tags for English readers (e.g., [Overpowered MC] instead of literal translations).\n- Mirror the original atmospheric tone (Comedic, Dark, Epic).\n- Do not add "Here is the translation." Output ONLY the synopsis.',
        temperature: 0.4,
        topP: 0.95,
        topK: 40,
    },
    chapter: {
        prompt: 'Role: Master Literary Translator (20 years exp) specializing in Chinese Webnovels.\nTask: Translate the chapter content with high-fidelity prose.\nRules:\n- VERIFIED TERMS: Keep any Latin-script (English) names or terms in the input exactly as they are. Do not re-translate them.\n- DIALOGUE: Use "" for speech and \'\' for thoughts. Follow the original tone for each.\n- SYSTEM BLOCKS: Preserve 【 】, 「 」, or 『 』 for system messages or special dialogue.\n- FLOW: Use descriptive English; avoid the "staccato" feel of literal MTL.\n- HONORIFICS: Translate into natural English equivalents (e.g., "Senior," "Teacher").\n- Output ONLY the translated chapter text.',
        temperature: 0.6,
        topP: 1.0,
        topK: 40,
    },
    names: {
        prompt: '**Persona:** You are a specialized Data Extraction and Linguistic Alignment Expert. Your task is to identify and pair corresponding Named Entities from two parallel texts.\n**Goal:** Extract every character name, sect name, or unique entity that appears in both the [Original Chinese Chapter] and the [Translated English Chapter].\n**Output Format:**\nReturn a JSON array of objects. Each object must contain exactly two keys:\n1. `"original"`: The name exactly as it appears in the Chinese text.\n2. `"translated"`: The exact English translation used for that name in the English text.\n\n\n**Strict Extraction Rules:**\n* **Existence Constraint:** ONLY extract names that are physically present in the provided chapter text.\n* **Direct Mapping:** Do not provide "better" translations. Provide the specific translation used in the provided input.\n* **Uniqueness:** Each unique name pair should appear only once in the array.\n* **JSON Only:** Output the raw JSON array only. Do not include markdown formatting (like ```json), commentary, or headers.\n\n\n**Input Structure:** The user will provide two blocks of text clearly labeled "Original:" and "Translated:".\n**Example Output Structure:**\n[{"original": "唐三", "translated": "Tang San"}, {"original": "武魂殿", "translated": "Spirit Hall"}]',
        temperature: 0.0,
        topP: 1.0,
        topK: 1.0,
    }
};

let isChapterFromCache = false;

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

async function generateContent(input, prompt, temperature, topP, topK) {
    const response = await request(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': API_KEY,
        },
        data: {
            contents: [{ parts: [{ text: input }] }],
            systemInstruction: { parts: [{ text: prompt }] },
            generationConfig: { temperature, topP, topK },
            safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'OFF' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'OFF' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'OFF' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'OFF' },
            ],
        },
    });

    return response.candidates[0].content.parts[0].text;
}

function getBookId() {
    return location.href.split('/')[4].replace('.htm', '');
}

function getChapterId() {
    return location.href.split('/')[5];
}

function getTitle() {
    const titleElement = document.querySelector('.booknav2 h1:nth-child(1) a:nth-child(1)');
    return titleElement.textContent;
}

function setTitle(title) {
    const titleElement = document.querySelector('.booknav2 h1:nth-child(1) a:nth-child(1)');
    titleElement.textContent = title;
}

function getSynopsis() {
    const synopsisElement = document.querySelector('.navtxt p:nth-child(1)');
    return synopsisElement.innerHTML.replace(/<br>/g, '\n');
}

function setSynopsis(synopsis) {
    const synopsisElement = document.querySelector('.navtxt p:nth-child(1)');
    synopsisElement.innerHTML = sanitizeContent(synopsis).replace(/\n/g, '<br>');
}

function getChapter() {
    const chapterElement = document.querySelector('.txtnav');

    for (const node of chapterElement.childNodes) {
        if (node.nodeName === '#text' || node.nodeName === 'BR') continue;
        node.remove();
    }

    return chapterElement.innerHTML
        .replace(/<br>/g, '\n')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length)
        .join('\n\n');
}

function setChapter(chapter) {
    const chapterElement = document.querySelector('.txtnav');
    chapterElement.innerHTML = sanitizeContent(chapter).replace(/\n/g, '<br>');
}

function editChapter(oldText, newText) {
    const bookId = getBookId();
    const chapterId = getChapterId();
    const cachedChapter = GM_getValue(`${bookId}:${chapterId}`);
    if (!cachedChapter) return;
    cachedChapter.translated = cachedChapter.translated.replace(new RegExp(oldText, 'g'), newText);
    GM_setValue(`${bookId}:${chapterId}`, cachedChapter);
    highlightNames(cachedChapter.translated);
}

function sanitizeContent(content) {
    return content.replace(/’/g, '\'');
}

async function translateTitle(title) {
    const bookId = getBookId();
    const cachedTitle = GM_getValue(`${bookId}:title`);
    if (cachedTitle) return cachedTitle;
    const { prompt, temperature, topP, topK } = apiParameters.title;
    const translatedTitle = await generateContent(title, prompt, temperature, topP, topK);
    GM_setValue(`${bookId}:title`, translatedTitle);
    return translatedTitle;
}

async function translateSynopsis(synopsis) {
    const bookId = getBookId();
    const cachedSynopsis = GM_getValue(`${bookId}:synopsis`);
    if (cachedSynopsis) return cachedSynopsis;
    const { prompt, temperature, topP, topK } = apiParameters.synopsis;
    const translatedSynopsis = await generateContent(synopsis, prompt, temperature, topP, topK);
    GM_setValue(`${bookId}:synopsis`, translatedSynopsis);
    return translatedSynopsis;
}

async function translateChapter(chapter) {
    const bookId = getBookId();
    const chapterId = getChapterId();
    const cachedChapter = GM_getValue(`${bookId}:${chapterId}`, {});

    if (cachedChapter.translated) {
        isChapterFromCache = true;
        return cachedChapter.translated;
    }

    const { prompt, temperature, topP, topK } = apiParameters.chapter;
    const names = getNames();

    if (names.length) {
        names.sort((a, b) => b.original.length - a.original.length);
        const regex = new RegExp(names.map(name => name.original).join('|'), 'g');

        chapter = chapter.replace(regex, original => {
            const name = getNameByOriginal(original);
            return name.translated;
        });
    }
    
    const translatedChapter = await generateContent(chapter, prompt, temperature, topP, topK);
    GM_setValue(`${bookId}:${chapterId}`, { original: chapter, translated: translatedChapter });
    return translatedChapter;
}

async function extractNames(original, translated) {
    if (isChapterFromCache) return [];
    const { prompt, temperature, topP, topK } = apiParameters.names;
    const names = await generateContent(`<original_text>\n${original}\n</original_text>\n<translated_text>\n${translated}\n</translated_text>`, prompt, temperature, topP, topK);
    return JSON.parse(names);
}

function saveNames(names) {
    const bookId = getBookId();
    const localNames = GM_getValue(`${bookId}:names`, []);
    const globalNames = GM_getValue('names', []);

    for (const name of names) {
        if (!name.original || !name.translated) continue;
        if (localNames.find(({ original }) => original === name.original)) continue;
        if (globalNames.find(({ original }) => original === name.original)) continue;
        localNames.push(name);
    }

    GM_setValue(`${bookId}:names`, localNames);
}

function getNames() {
    const bookId = getBookId();
    const localNames = GM_getValue(`${bookId}:names`, []);
    const globalNames = GM_getValue('names', []);

    return [...localNames, ...globalNames];
}

function getNameByOriginal(original) {
    const names = getNames();
    return names.find(name => name.original === original);
}

function getNameByTranslated(translated) {
    const names = getNames();
    return names.find(name => name.translated === translated);
}

function getVerifiedNames() {
    const bookId = getBookId();
    const localNames = GM_getValue(`${bookId}:names`, []);
    const globalNames = GM_getValue('names', []);

    return [...localNames.filter(name => name.checked), ...globalNames];
}

function isNameGlobal(name) {
    const globalNames = GM_getValue('names', []);
    return !!globalNames.find(({original}) => original === name.original);
}

function getSelectedName() {
    const selection = getSelection();
    const node = selection.anchorNode;
    return node?.dataset.original;
}

function editName() {
    const original = getSelectedName();
    if (!original) return;
    const bookId = getBookId();
    const localNames = GM_getValue(`${bookId}:names`, []);
    const globalNames = GM_getValue('names', []);
    const localName = localNames.find(name => name.original === original);
    const globalName = globalNames.find(name => name.original === original);
    const name = localName || globalName;
    if (!name) return;
    const oldName = name.translated;
    const newName = prompt('Enter new name')?.trim();
    if (!newName) return;
    name.translated = newName;
    GM_setValue(`${bookId}:names`, localNames);
    GM_setValue('names', globalNames);
    editChapter(oldName, newName);
}

function setNameToGlobal() {
    const original = getSelectedName();
    if (!original) return;
    const bookId = getBookId();
    let localNames = GM_getValue(`${bookId}:names`, []);
    let globalNames = GM_getValue('names', []);
    const localName = localNames.find(name => name.original === original);
    const globalName = globalNames.find(name => name.original === original);
    const name = localName || globalName;
    if (!name) return;
    localNames = localNames.filter(({original}) => original !== name.original);
    globalNames = globalNames.filter(({original}) => original !== name.original);
    globalNames.push(name);
    GM_setValue(`${bookId}:names`, localNames);
    GM_setValue('names', globalNames);
    highlightNames();
}

function checkName() {
    const original = getSelectedName();
    if (!original) return;
    const bookId = getBookId();
    const localNames = GM_getValue(`${bookId}:names`, []);
    const globalNames = GM_getValue('names', []);
    const localName = localNames.find(name => name.original === original);
    const globalName = globalNames.find(name => name.original === original);
    const name = localName || globalName;
    if (!name) return;
    name.checked = true;
    GM_setValue(`${bookId}:names`, localNames);
    GM_setValue('names', globalNames);
    highlightNames();
}

function deleteName() {
    const original = getSelectedName();
    if (!original) return;
    const bookId = getBookId();
    let localNames = GM_getValue(`${bookId}:names`, []);
    let globalNames = GM_getValue('names', []);
    const localName = localNames.find(name => name.original === original);
    const globalName = globalNames.find(name => name.original === original);
    const name = localName || globalName;
    if (!name) return;
    localNames = localNames.filter(({original}) => original !== name.original);
    globalNames = globalNames.filter(({original}) => original !== name.original);
    GM_setValue(`${bookId}:names`, localNames);
    GM_setValue('names', globalNames);
    highlightNames();
}

function setFandom() {
    const bookId = getBookId();
    let fandom = GM_getValue(`${bookId}:fandom`);
    fandom = prompt('Enter the fandom, seperate by a semicolon (;) if there is multiple.', fandom)?.trim();
    if (!fandom) return;
    GM_setValue(`${bookId}:fandom`, fandom);
}

function searchOriginalName() {
    const original = getSelectedName();
    if (!original) return;
    const bookId = getBookId();
    const fandom = GM_getValue(`${bookId}:fandom`);
    let searchQuery = `"${original}" (${fandom.split(';').map(url => `site:${url}`).join(' OR ')})`;
    GM_setClipboard(original, 'text/plain');
    GM_openInTab(`https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`, { active: true });
}

function searchTranslatedName() {
    const original = getSelectedName();
    if (!original) return;
    const bookId = getBookId();
    let localNames = GM_getValue(`${bookId}:names`, []);
    let globalNames = GM_getValue('names', []);
    const localName = localNames.find(name => name.original === original);
    const globalName = globalNames.find(name => name.original === original);
    const name = localName || globalName;
    if (!name) return;
    const fandom = GM_getValue(`${bookId}:fandom`);
    let searchQuery = `${name.translated} (${fandom.split(';').map(url => `site:${url}`).join(' OR ')})`;
    GM_setClipboard(name.translated, 'text/plain');
    GM_openInTab(`https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`, { active: true });
}

function copyNamePrompt() {
    const original = getSelectedName();
    if (!original) return;
    const bookId = getBookId();
    const chapterId = getChapterId();
    const cachedChapter = GM_getValue(`${bookId}:${chapterId}`);
    const verifiedNames = JSON.stringify(getVerifiedNames()).replaceAll(',"checked":true', '');
    const prompt = `**Role:** You are a Lead Localization Editor for high-end Chinese Webnovel translations. Your goal is to find the perfect English name for a specific character/entity based on cultural nuance and existing series consistency.\n**1. The Target Name:** \`${original}\`\n**2. The Context (Original Chapter):** \`${cachedChapter.original}\`\n**3. Approved Glossary (Existing Translations):**\n\`${verifiedNames}\`\n**Task:** Analyze the **Target Name** in the context of the **Chapter** provided. Use the **Approved Glossary** to ensure the style and terminology remain consistent with the rest of the work.\n**Output Requirements:**\nProvide a ranked list of 3-5 translation options. For each option, include:\n* **The Translation:** (e.g., "Silver-Winged Eagle")\n* **Linguistic Logic:** Why these characters translate this way.\n* **Contextual Fit:** Why this fits the character's role or actions in this specific chapter.\n* **Glossary Alignment:** How it fits the naming convention of the approved list.\n\n\n**Ranking Priority:** Rank based on (1) Narrative Impact, (2) Consistency with the Glossary, and (3) Clarity for an English reader.\n**Constraint:** Be concise. Focus on the "flavor" of the name.`;
    GM_setClipboard(prompt, 'text/plain');
}

function highlightNames(chapter) {
    if (!chapter) {
        const bookId = getBookId();
        const chapterId = getChapterId();
        const cachedChapter = GM_getValue(`${bookId}:${chapterId}`);
        if (!cachedChapter) return;
        chapter = cachedChapter.translated;
    }

    const names = getNames();
    names.sort((a, b) => b.translated.length - a.translated.length);
    const regex = new RegExp(names.map(name => name.translated).join('|'), 'g');

    chapter = chapter.replace(regex, translated => {
        const name = getNameByTranslated(translated);
        let textColor = '#ffffff';
        let color = '#5e2424';

        if (name.checked) {
            textColor = '#bebdbb';
            color = '#1e3a5f';
        }

        if (isNameGlobal(name)) {
            textColor = '#d8f3dc'
            color = '#1b4332';
        }

        return `<b style="color: ${textColor}; background-color: ${color}; user-select: all;" data-original="${name.original}">${name.translated}</b>`;
    });

    setChapter(chapter);
}

function injectButton(label, onClick) {
    let container = document.getElementById('button-container');
    
    if (!container) {
        container = document.createElement('div');
        container.id = 'button-container';
        container.style.position = 'fixed';
        container.style.bottom = '0';
        container.style.right = '0';
        container.style.display = 'grid';
        document.body.appendChild(container);
    }

    const button = document.createElement('button');
    button.textContent = label;
    button.style.margin = '5px';
    button.style.fontSize = '20px';
    button.addEventListener('click', onClick);
    container.appendChild(button);
}

if (location.href.includes('/book/')) {
    const title = getTitle();
    const translatedTitle = await translateTitle(title);
    setTitle(translatedTitle);

    const synopsis = getSynopsis();
    const translatedSynopsis = await translateSynopsis(synopsis);
    setSynopsis(translatedSynopsis);
}

if (location.href.includes('/txt/')) {
    document.querySelector('.tools')?.remove();
    const chapter = getChapter();
    const translatedChapter = await translateChapter(chapter);
    setChapter(translatedChapter);
    const names = await extractNames(chapter, translatedChapter);
    saveNames(names);
    highlightNames(translatedChapter);

    injectButton('⚙️', setFandom);
    injectButton('🗑️', deleteName);
    injectButton('✨', copyNamePrompt);
    injectButton('✏️', editName);
    injectButton('📌', setNameToGlobal);
    injectButton('✔️', checkName);
    injectButton('🔎', searchTranslatedName);
    injectButton('🔍', searchOriginalName);
}
