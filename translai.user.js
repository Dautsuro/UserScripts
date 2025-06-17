// ==UserScript==
// @name         TranslAI
// @namespace    https://github.com/Dautsuro
// @version      1.1.1
// @description  TranslAI is a userscript that auto-translates Chinese web novels on 69shuba.com into English using Google's Gemini API. It translates titles, synopses, and chapters, highlights character names with contextual coloring, and allows custom name editing, saving, and management for consistent translation across chapters.
// @author       Dautsuro
// @match        https://www.69shuba.com/book/*.htm
// @match        https://www.69shuba.com/txt/*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=69shuba.com
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.listValues
// ==/UserScript==

const Color = {
    RED: '#a35c5c',
    GREEN: '#5c9c7c',
    BLUE: '#5c7c9c',
    ORANGE: '#a3754c',
};

const Position = {
    LEFT: 'left',
    RIGHT: 'right',
};

class Gemini {
    static async init() {
        this.apiKey = await GM.getValue('apiKey');

        while (!this.apiKey) {
            this.apiKey = prompt('Enter your Gemini API key')?.trim();
            if (this.apiKey) GM.setValue('apiKey', this.apiKey);
        }
    }

    static async request(instruction, input) {
        const payload = {
            systemInstruction: { parts: [{ text: instruction }] },
            contents: [{ parts: [{ text: input }] }],
        };

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.apiKey}`;

        const options = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        };

        try {
            while (true) {
                const response = await fetch(url, options);

                if (!response.ok) {
                    if (response.status === 503) {
                        log('⚠️ Gemini is busy, retry in 5 seconds.');
                        await new Promise(res => setTimeout(res, 5000));
                        continue;
                    }

                    throw new Error(`Response status: ${response.status}`);
                }

                const data = await response.json();

                if (
                    !data.candidates ||
                    !data.candidates[0] ||
                    !data.candidates[0].content ||
                    !data.candidates[0].content.parts ||
                    !data.candidates[0].content.parts[0] ||
                    !data.candidates[0].content.parts[0].text
                ) {
                    throw new Error(`Error in data: ${JSON.stringify(data)}`);
                }

                return data.candidates[0].content.parts[0].text;
            }
        } catch (err) {
            throw err;
        }
    }
}

class Novel {
    constructor(titleElement, synopsisElement) {
        this.titleElement = titleElement;
        this.synopsisElement = synopsisElement;
    }

    static get id() {
        const url = location.href;
        return url.split('/')[4].match(/\d+/d)[0];
    }

    translate() {
        const title = this.titleElement.innerText;
        const synopsis = this.synopsisElement.innerText;

        const titleInstruction = 'Translate the provided Chinese novel title into English. Respond only with the translated title.';
        const synopsisInstruction = 'Translate the provided Chinese novel synopsis into English. Respond only with the translated synopsis.';

        Gemini.request(titleInstruction, title)
            .then(translatedTitle => this.titleElement.innerText = translatedTitle)
            .catch(err => handleError('Error while translating novel title', err));

        Gemini.request(synopsisInstruction, synopsis)
            .then(translatedSynopsis => this.synopsisElement.innerText = translatedSynopsis)
            .catch(err => handleError('Error while translating novel synopsis', err));
    }
}

class Chapter {
    constructor(element) {
        this.element = element;
        Chapter.instance = this;
    }

    async translate() {
        this.element.querySelector('.txtinfo').remove();

        const titleElement = this.element.querySelector('h1.hide720');
        const title = titleElement.innerText;
        titleElement.remove();

        this.content = this.element.innerText;
        const lines = this.content.split('\n');

        if (!lines[0].includes(title.trim()) && !title.includes(lines[0].trim())) {
            this.content = [title, ...lines].join('\n');
        }

        const instruction = 'Translate the provided Chinese novel chapter into English. Respond only with the translated chapter.';
        let content = this.content;
        const names = NameManager.getNames();
        names.sort((a, b) => b.original.length - a.original.length);

        for (const name of names) {
            content = content.replace(new RegExp(RegExp.escape(name.original), 'g'), name.translated);
        }

        try {
            this.translatedContent = await Gemini.request(instruction, content);
            log('✅ Chapter is translated');
            this.extractNames();
        } catch (err) {
            handleError('Error while translating novel chapter', err);
        }
    }

    async extractNames() {
        const instruction = 'Extract all proper nouns from the Chinese chapter and find their translation in the English chapter. Create a JSON array in this format: [{"original":"Chinese name","translated":"English name"}]. Respond only with the JSON array.';

        const input = `Chinese chapter:
        ${this.content}
        
        English chapter:
        ${this.translatedContent}`;

        try {
            const rawNames = await Gemini.request(instruction, input);
            let names = rawNames;

            if (rawNames.includes('```json')) {
                names = rawNames.replace(/```json|```/g, '');
            }

            if (!isParsable(names)) {
                throw new Error(`Error in names: ${rawNames}`);
            }

            names = JSON.parse(names);
            log('✅ Names are extracted');
            NameManager.addNames(names);
            this.refreshDOM();
            NameManager.checkCommons();
        } catch (err) {
            handleError('Error while extracting names', err);
        }
    }

    refreshDOM() {
        let content = this.translatedContent;
        const names = NameManager.getNames();
        names.sort((a, b) => b.translated.length - a.translated.length);

        for (const name of names) {
            content = content.replace(new RegExp(`(?!<span[^>]*>)${RegExp.escape(name.translated)}(?![^<]*<\/span>)`, 'g'), () => {
                let color = Color.RED;

                if (NameManager.isSub(name)) {
                    color = Color.ORANGE;
                }

                if (name.checked) {
                    color = Color.BLUE;
                }

                if (NameManager.isGlobal(name)) {
                    color = Color.GREEN;
                }

                return `<span style="color: ${color}; user-select: all;" data-original="${name.original}">${name.translated}</span>`;
            });
        }

        this.element.innerHTML = content.replace(/\n/g, '<br>');
    }

    static refreshDOM() {
        if (!this.instance) return;
        this.instance.refreshDOM();
    }
}

class NameManager {
    static async init() {
        this.localNames = await GM.getValue(`names:${Novel.id}`, []);
        this.globalNames = await GM.getValue('names', []);
        this.setting = await GM.getValue(`setting:${Novel.id}`, '*');
    }

    static addNames(names) {
        for (const name of names) {
            if (!name.original || !name.translated) continue;
            if (this.getName(name.original)) continue;

            this.localNames.push({
                original: name.original,
                translated: name.translated,
            });

            log(`✅ Added name: ${name.original} (${name.translated})`);
        }

        this.save();
    }

    static getName(originalName) {
        const names = this.getNames();
        return names.find(n => n.original === originalName);
    }

    static getNames() {
        return [...this.localNames, ...this.globalNames.filter(n => n.setting === this.setting)];
    }

    static save() {
        GM.setValue(`names:${Novel.id}`, this.localNames);
        GM.setValue('names', this.globalNames);
    }

    static setSetting() {
        const oldSetting = this.setting;
        this.setting = prompt('Enter the story setting', this.setting)?.trim();
        if (!this.setting) return this.setting = oldSetting;
        log(`✅ Story setting set to ${this.setting}`);
        GM.setValue(`setting:${Novel.id}`, this.setting);
    }

    static addGlobal(name) {
        if (!name.original) name = this.getSelectedName();
        if (!name || this.isGlobal(name)) return;

        this.localNames = this.localNames.filter(n => n.original !== name.original);
        name.setting = this.setting;
        delete name.checked;
        delete name.parentName;
        this.globalNames.push(name);
        log(`✅ Global name added: ${name.original} (${name.translated})`);
        this.save();
        Chapter.refreshDOM();
        this.editName(name);
    }

    static getSelectedName() {
        const selection = getSelection();

        if (!selection) {
            return;
        }

        const node = selection.anchorNode;
        return this.getName(node.dataset.original);
    }

    static isGlobal(name) {
        const globalNames = this.getGlobalNames();
        return globalNames.find(n => n.original === name.original) ? true : false;
    }

    static editName(name) {
        let fill = false;

        if (!name.original) {
            fill = true;
            name = this.getSelectedName();
        }

        if (!name) return;

        const oldName = name.translated;
        const newName = prompt('Enter new name', fill ? oldName : '')?.trim();
        if (!newName || newName === oldName) return;
        name.translated = newName;
        this.save();
        log(`✅ Name edited: ${oldName} => ${newName}`);
        const chapter = Chapter.instance;

        if (chapter) {
            chapter.translatedContent = chapter.translatedContent.replace(new RegExp(RegExp.escape(oldName), 'g'), newName);
            chapter.refreshDOM();
        }
    }

    static checkName() {
        const name = this.getSelectedName();
        if (!name) return;
        name.checked = true;
        name.setting = this.setting;
        this.save();
        log(`✅ Name checked: ${name.original} (${name.translated})`);
        this.editName(name);
        Chapter.refreshDOM();
    }

    static copyName() {
        const name = this.getSelectedName();
        if (!name) return;

        if (name.parentName) {
            if (confirm('Formatted copy?')) {
                navigator.clipboard.writeText(`${name.parentName.original}: ${name.parentName.translated}\n${name.original}`);
                return;
            }
        }

        navigator.clipboard.writeText(name.original);
    }

    static removeName(name) {
        if (!name.original) name = this.getSelectedName();
        if (!name) return;
        const localLength = this.localNames.length;
        const globalLength = this.globalNames.length;
        this.localNames = this.localNames.filter(n => n.original !== name.original);
        this.globalNames = this.globalNames.filter(n => !(n.original === name.original && n.setting === this.setting));
        this.save();
        if (localLength === this.localNames.length && globalLength === this.globalNames.length) return;
        log(`✅ Name removed: ${name.original} (${name.translated})`);
        Chapter.refreshDOM();
    }

    static newName() {
        const name = {};
        name.original = prompt('Enter the original name')?.trim();
        if (!name.original) return;
        name.translated = prompt('Enter the translated name')?.trim();
        if (!name.translated) return;
        if (this.isGlobal(name)) return;
        const oldName = this.getName(name.original);

        if (oldName) {
            const chapter = Chapter.instance;

            if (chapter) {
                chapter.translatedContent = chapter.translatedContent.replace(new RegExp(RegExp.escape(oldName.translated), 'g'), name.translated);
                chapter.refreshDOM();
            }
        }

        this.removeName(name);
        name.setting = this.setting;
        this.globalNames.push(name);
        this.save();
        log(`✅ Name added: ${name.original} (${name.translated})`);
        Chapter.refreshDOM();
    }

    static isSub(name) {
        if (!name || !this.getName(name.original)) return false;
        if (this.isGlobal(name) || name.checked) return false;
        const globalNames = this.getGlobalNames();
        let partialName;

        for (const globalName of globalNames) {
            if (globalName.original.includes(name.original)) {
                if (globalName.translated.includes(name.translated)) {
                    name.parentName = {
                        original: globalName.original,
                        translated: globalName.translated,
                    };

                    return true;
                }
                
                partialName = globalName;
            }
        }

        if (partialName) {
            name.parentName = {
                original: partialName.original,
                translated: partialName.translated,
            };

            return true;
        }

        return false;
    }

    static getGlobalNames() {
        return [...this.globalNames.filter(n => n.setting === this.setting)];
    }

    static async checkCommons() {
        let keys = await GM.listValues();
        keys = keys.filter(k => k.startsWith('names:'));
        let namesList = keys.map(k => GM.getValue(k));
        namesList = await Promise.all(namesList);
        const namesData = {};

        for (let names of namesList) {
            names = names.filter(n => n.setting);

            for (const name of names) {
                if (!namesData[name.original]) namesData[name.original] = { obj: name, counter: 0 };
                namesData[name.original].counter++;
            }
        }

        for (const name in namesData) {
            if (namesData[name].counter >= 3) {
                this.addGlobal(namesData[name].obj);
            }
        }

        this.save();
    }
}

class Button {
    static leftOffset = 0;
    static rightOffset = 0;

    constructor(text, position, onClick) {
        const element = document.createElement('button');
        element.innerText = text;
        element.addEventListener('click', onClick);

        Object.assign(element.style, {
            position: 'fixed',
            bottom: `${5 + Button[`${position}Offset`]}px`,
            [position]: '5px',
            'z-index': 1000,
            'background-color': '#181a1b',
            padding: '5px',
        });

        document.body.appendChild(element);
        Button[`${position}Offset`] += 5 + element.getBoundingClientRect().height;
    }
}

function handleError(reason, err) {
    const error = {
        reason,
        message: err.message,
    };

    document.body.innerHTML = `<pre style="background-color: black; color: white;">${JSON.stringify(error, null, 4)}</pre>`;
}

function isParsable(string) {
    try {
        JSON.parse(string);
        return true;
    } catch (err) {
        return false;
    }
}

function log(message) {
    let container = document.getElementById('toast-container');

    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';

        Object.assign(container.style, {
            position: 'fixed',
            top: '1rem',
            right: '1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            zIndex: 1000,
        });

        document.body.appendChild(container);
    }

    const toast = document.createElement('div');

    Object.assign(toast.style, {
        background: '#333',
        color: '#fff',
        padding: '1rem',
        borderRadius: '5px',
        opacity: 0.9,
        minWidth: '200px',
        boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
        transition: 'opacity 0.5s, transform 0.5s',
    });

    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-20px)';
    }, 2500);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}

await Gemini.init();
await NameManager.init();

new Button('⚙️', Position.LEFT, NameManager.setSetting.bind(NameManager));
new Button('✏️', Position.LEFT, NameManager.editName.bind(NameManager));
new Button('➖', Position.LEFT, NameManager.removeName.bind(NameManager));

new Button('➕', Position.RIGHT, NameManager.addGlobal.bind(NameManager));
new Button('✅', Position.RIGHT, NameManager.checkName.bind(NameManager));
new Button('🆕', Position.RIGHT, NameManager.newName.bind(NameManager));
new Button('📋', Position.RIGHT, NameManager.copyName.bind(NameManager));

const url = location.href;

if (url.includes('/book/')) {
    const titleElement = document.querySelector('.booknav2 > h1:nth-child(1) > a:nth-child(1)');
    const synopsisElement = document.querySelector('.navtxt > p:nth-child(1)');

    const novel = new Novel(titleElement, synopsisElement);
    novel.translate();
} else if (url.includes('/txt/')) {
    document.querySelector('.tools').remove();
    const chapterElement = document.querySelector('.txtnav');

    const chapter = new Chapter(chapterElement);
    chapter.translate();
}
