const axios = require('axios');
let isEnabled = true;
let currentLanguage = 'hindi';
let dialoguesCache = {
    hindi: null,
    english: null
};
const PASTEBIN_URLS = {
    hindi: 'https://pastebin.com/raw/7SLEDzNc',
    english: 'https://pastebin.com/raw/9SU7xwaj'
};
async function loadDialogues(language) {
    if (dialoguesCache[language])
        return dialoguesCache[language];
    try {
        const response = await axios.get(PASTEBIN_URLS[language]);
        dialoguesCache[language] = response.data.dialogues;
        return dialoguesCache[language];
    }
    catch (error) {
        console.error(`Failed to load ${language} dialogues:`, error);
        return null;
    }
}
module.exports = {
    config: {
        name: "bot",
        version: "1.0.0",
        author: "Priyansh Kaur",
        countDown: 5,
        role: 0,
        shortDescription: "Random Priyanshi dialogues",
        longDescription: "Sends random Priyanshi dialogues in Hindi or English",
        category: "fun",
    },
    onStart: async function ({ api, event, args }) {
        const command = args[0]?.toLowerCase();
        if (command === "off") {
            isEnabled = false;
            return api.sendMessage("Bot dialogues have been disabled", event.threadID);
        }
        if (command === "on") {
            isEnabled = true;
            return api.sendMessage("Bot dialogues have been enabled", event.threadID);
        }
        if (command === "hindi") {
            currentLanguage = 'hindi';
            return api.sendMessage("Language set to Hindi", event.threadID);
        }
        if (command === "english") {
            currentLanguage = 'english';
            return api.sendMessage("Language set to English", event.threadID);
        }
        if (command === "status") {
            return api.sendMessage(`Bot status: ${isEnabled ? "enabled" : "disabled"}\nCurrent language: ${currentLanguage}`, event.threadID);
        }
    },
    onChat: async function ({ api, event }) {
        if (!isEnabled)
            return;
        const message = event.body?.toLowerCase();
        if (message !== "bot")
            return;
        const dialogues = await loadDialogues(currentLanguage);
        if (!dialogues) {
            return api.sendMessage(`Failed to load ${currentLanguage} dialogues`, event.threadID);
        }
        const randomDialogue = dialogues[Math.floor(Math.random() * dialogues.length)];
        return api.sendMessage(randomDialogue, event.threadID);
    }
};
