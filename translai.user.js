// ==UserScript==
// @name         TranslAI
// @namespace    https://github.com/Dautsuro
// @version      1.1.0
// @description  -
// @author       Dautsuro
// @match        https://www.69shuba.com/book/*.htm
// @match        https://www.69shuba.com/txt/*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=69shuba.com
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.setClipboard
// ==/UserScript==

const url = location.href;

const Color = {
    GREEN: '#d4edda',
    RED: '#f8d7da',
    GRAY: '#e0e8f0',
    BLUE: '#afcde9'
}

const Position = {
    RIGHT: 'right',
    LEFT: 'left'
}

class Gemini {
    static async init() {
        this.apiKey = await GM.getValue('apiKey');

        if (!this.apiKey) {
            this.apiKey = prompt('Enter your Gemini API key').trim();
            if (!this.apiKey) return;
            GM.setValue('apiKey', this.apiKey);
        }
    }

    static async ask(instruction, input) {
        const payload = {
            systemInstruction: { parts: [{ text: instruction }] },
            contents: [{ parts: [{ text: input }] }]
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.apiKey}`;

        const options = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }

        const response = await fetch(url, options);
        const data = await response.json();
        return data.candidates[0].content.parts[0].text;
    }
}

class Novel {
    constructor(titleElement, synopsisElement) {
        this.titleElement = titleElement;
        this.synopsisElement = synopsisElement;
    }

    static get id() {
        let id = url.split('/')[4];
        if (id.includes('.')) id = id.split('.')[0];
        return id;
    }

    async translate() {
        this.title = this.titleElement.innerText.trim();
        this.synopsis = this.synopsisElement.innerText.trim();

        const names = NameManager.getNames();
        names.sort((a, b) => b.original.length - a.original.length);
        let title = this.title;
        let synopsis = this.synopsis;

        for (const name of names) {
            title = title.replace(new RegExp(RegExp.escape(name.original), 'g'), name.translated);
            synopsis = synopsis.replace(new RegExp(RegExp.escape(name.original), 'g'), name.translated);
        }

        const titleInstruction = 'You are a professional Chinese-to-English translator. Translate the provided Chinese novel title into English. Output only the translated title.';
        this.translatedTitle = await Gemini.ask(titleInstruction, title);
        this.titleElement.innerText = this.translatedTitle;

        const synopsisInstruction = 'You are a professional Chinese-to-English translator. Translate the provided Chinese novel synopsis into English. Output only the translated synopsis.';
        this.translatedSynopsis = await Gemini.ask(synopsisInstruction, synopsis);
        this.synopsisElement.innerText = this.translatedSynopsis;
    }
}

class Chapter {
    constructor(element) {
        this.element = element;
        Chapter.instance = this;
    }

    async translate() {
        this.content = this.element.innerText.trim();
        let content = this.content;
        const names = NameManager.getNames();
        names.sort((a, b) => b.original.length - a.original.length);

        for (const name of names) {
            content = content.replace(new RegExp(RegExp.escape(name.original), 'g'), name.translated);
        }

        const instruction = 'You are a professional Chinese-to-English translator. Translate the provided Chinese novel chapter into English. Output only the translated chapter.';
        this.translatedContent = await Gemini.ask(instruction, content);
        this.refreshDOM();
        this.extractNames();
    }

    async extractNames() {
        const instruction = 'You are a professional JSON extractor. Extract every names (character, place, technique, item, rank, etc.) present in the Chinese chapter and its English translation in the English chapter. Create a JSON array following this format: [{"original":"Chinese name","translated":"English name"}]. Output only the JSON array.';

        const input = `Chinese chapter:
        ${this.content}
        
        English chapter:
        ${this.translatedContent}`;

        const extractedNames = await Gemini.ask(instruction, input);
        const names = JSON.parse(extractedNames.replace(/```json|```/g, ''));
        NameManager.addNames(names);
        this.refreshDOM();
    }

    refreshDOM() {
        let content = this.translatedContent;
        const names = NameManager.getNames();
        names.sort((a, b) => b.translated.length - a.translated.length);

        for (const name of names) {
            content = content.replace(new RegExp(`(?!<span[^>]*>)${name.translated}(?![^<]*</span>)`, 'g'), () => {
                let color = Color.RED;
                if (name.checked) color = Color.BLUE;
                if (NameManager.isGlobal(name)) color = Color.GREEN;
                return `<span style="background-color: ${color}; user-select: all;" data-original="${name.original}">${name.translated}</span>`;
            });
        }

        this.element.innerHTML = content.replace(/\n/g, '<br>');
    }
}

class NameManager {
    static async init() {
        this.localNames = await GM.getValue(`names:${Novel.id}`) || [];
        this.globalNames = await GM.getValue('names') || [];
        this.localBannedNames = await GM.getValue(`bannedNames:${Novel.id}`) || [];
        this.globalBannedNames = await GM.getValue('bannedNames') || [];
    }

    static addNames(names) {
        for (const name of names) {
            if (!this.getName(name.original) && !this.isBanned(name.original)) {
                this.localNames.push(name);
            }
        }

        this.save();
    }

    static getName(originalName) {
        const localName = this.localNames.find(n => n.original === originalName);
        if (localName) return localName;

        const globalName = this.globalNames.find(n => n.original === originalName);
        if (globalName) return globalName;

        return null;
    }

    static getBannedNames() {
        return [...this.localBannedNames, ...this.globalBannedNames];
    }

    static isBanned(originalName) {
        const bannedNames = this.getBannedNames();
        return bannedNames.includes(originalName);
    }

    static save() {
        GM.setValue(`names:${Novel.id}`, this.localNames);
        GM.setValue('names', this.globalNames);
        GM.setValue(`bannedNames:${Novel.id}`, this.localBannedNames);
        GM.setValue('bannedNames', this.globalBannedNames);
    }

    static getNames() {
        return [...this.localNames, ...this.globalNames];
    }

    static isGlobal(name) {
        const globalName = this.globalNames.find(n => n.original === name.original);
        return globalName ? true : false;
    }

    static getSelectedName() {
        const selection = getSelection();
        let originalName;

        if (selection.rangeCount) {
            const range = selection.getRangeAt(0);
            const node = range.startContainer;

            const span = node.nodeType === Node.ELEMENT_NODE
                ? node.closest('span[data-original]')
                : node.parentElement?.closest('span[data-original]');

            if (span) {
                originalName = span.dataset.original;
            }
        }

        return this.getName(originalName);
    }


    static removeName(name) {
        if (!name?.original) name = this.getSelectedName();
        if (!name) return;

        this.localNames = this.localNames.filter(n => n.original !== name.original);
        this.globalNames = this.globalNames.filter(n => n.original !== name.original);
        this.save();
        Chapter.instance?.refreshDOM();
    }

    static addGlobal() {
        const name = this.getSelectedName();
        if (!name || this.isGlobal(name)) return;

        this.removeName(name);
        this.globalNames.push(name);
        this.save();
        this.editName(name);
        Chapter.instance?.refreshDOM();
    }

    static editName(name) {
        if (!name?.original) name = this.getSelectedName();
        if (!name) return;

        const oldName = name.translated;
        const newName = prompt('Enter new name').trim();
        if (!newName) return;

        name.translated = newName;
        this.save();

        const chapter = Chapter.instance;
        if (!chapter) return;

        chapter.translatedContent = chapter.translatedContent.replace(new RegExp(RegExp.escape(oldName), 'g'), newName);
        chapter.refreshDOM();
    }

    static copyName() {
        const name = this.getSelectedName();
        if (!name) return;
        GM.setClipboard(name.original, 'text');
    }

    static checkName() {
        const name = this.getSelectedName();
        if (!name) return;

        name.checked = true;
        this.save();
        Chapter.instance?.refreshDOM();
    }

    static addNewName() {
        const originalName = prompt('Enter original name').trim();
        if (!originalName) return;

        const translatedName = prompt('Enter translated name').trim();
        if (!translatedName) return;

        const name = {
            original: originalName,
            translated: translatedName
        }

        const oldName = this.getName(name.original);
        this.removeName(name);

        if (oldName && Chapter.instance) {
            const chapter = Chapter.instance;
            chapter.translatedContent = chapter.translatedContent.replace(new RegExp(RegExp.escape(oldName.translated), 'g'), name.translated);
        }

        this.globalNames.push(name);
        this.save();
        Chapter.instance?.refreshDOM();
    }

    static deleteName() {
        const name = this.getSelectedName();
        if (!name) return;
        this.removeName(name);
        const isGlobal = confirm('Global delete?');

        if (isGlobal) {
            this.globalBannedNames.push(name.original);
        } else {
            this.localBannedNames.push(name.original);
        }

        this.save();
    }
}

class Button {
    static rightOffset = 0;
    static leftOffset = 0;

    constructor(text, position, callback) {
        const element = document.createElement('button');
        element.textContent = text;
        element.addEventListener('click', callback);

        Object.assign(element.style, {
            position: 'fixed',
            bottom: `${5 + Button[`${position}Offset`]}px`,
            [position]: '5px',
            'z-index': '1000',
            padding: '8px',
            'font-size': '16px',
            'background-color': Color.GRAY
        });

        Button[`${position}Offset`] += 40;
        document.body.appendChild(element);
    }
}

await Gemini.init();
await NameManager.init();

new Button('➕', Position.RIGHT, NameManager.addGlobal.bind(NameManager));
new Button('✅', Position.RIGHT, NameManager.checkName.bind(NameManager));
new Button('🆕', Position.RIGHT, NameManager.addNewName.bind(NameManager));
new Button('📋', Position.RIGHT, NameManager.copyName.bind(NameManager));

new Button('✏️', Position.LEFT, NameManager.editName.bind(NameManager));
new Button('➖', Position.LEFT, NameManager.removeName.bind(NameManager));
new Button('❌', Position.LEFT, NameManager.deleteName.bind(NameManager));

if (url.includes('/book/')) {
    const titleElement = document.querySelector('.booknav2 > h1:nth-child(1) > a:nth-child(1)');
    const synopsisElement = document.querySelector('.navtxt > p:nth-child(1)');
    const novel = new Novel(titleElement, synopsisElement);
    novel.translate();
} else if (url.includes('/txt')) {
    document.querySelector('h1.hide720')?.remove();
    document.querySelector('.txtinfo')?.remove();
    document.querySelector('.tools')?.remove();

    const chapterElement = document.querySelector('.txtnav');
    const chapter = new Chapter(chapterElement);
    chapter.translate();
}