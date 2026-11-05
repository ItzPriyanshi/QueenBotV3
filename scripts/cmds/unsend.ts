module.exports = {
    config: {
        name: "unsend",
        aliases: ["uns", "gỡ"],
        version: "2.0.0",
        author: "Priyanshi Kaur",
        countDown: 2,
        role: 0,
        shortDescription: {
            en: "Unsend bot messages or toggle react-to-unsend"
        },
        longDescription: {
            en: "Reply to any bot message with .unsend to remove it, or use .unsend react on/off to toggle auto-unsend on reaction (❌ or 🗑️)."
        },
        category: "box chat",
        guide: {
            en: "{pn} (reply to bot message)\n{pn} react [on|off]"
        }
    },
    langs: {
        en: {
            syntaxError: "⚠️ Please reply to the bot's message you wish to unsend.",
            notBotMsg: "❌ You can only unsend messages sent by QueenBot.",
            reactEnabled: "✅ React-to-unsend has been ENABLED for this chat. React with ❌ or 🗑️ to delete any bot message.",
            reactDisabled: "❌ React-to-unsend has been DISABLED for this chat.",
            reactStatus: "ℹ️ React-to-unsend is currently %1 in this chat.\nUse: {pn} react on/off to change.",
            needAdmin: "⚠️ Only group administrators or bot admins can toggle this setting."
        }
    },
    onStart: async function ({ message, event, args, api, threadsData, getLang, role }) {
        const sub = (args[0] || "").toLowerCase();
        if (sub === "react") {
            const mode = (args[1] || "").toLowerCase();
            const threadData = await threadsData.get(event.threadID);
            const current = threadData?.settings?.reactToUnsend !== false;
            if (!mode) {
                return message.reply(getLang("reactStatus", current ? "ENABLED" : "DISABLED"));
            }
            if (role < 1) {
                return message.reply(getLang("needAdmin"));
            }
            if (mode === "on" || mode === "enable" || mode === "1" || mode === "true") {
                await threadsData.set(event.threadID, true, "settings.reactToUnsend");
                return message.reply(getLang("reactEnabled"));
            }
            if (mode === "off" || mode === "disable" || mode === "0" || mode === "false") {
                await threadsData.set(event.threadID, false, "settings.reactToUnsend");
                return message.reply(getLang("reactDisabled"));
            }
            return message.reply(getLang("reactStatus", current ? "ENABLED" : "DISABLED"));
        }
        if (!event.messageReply) {
            return message.reply(getLang("syntaxError"));
        }
        if (event.messageReply.senderID !== api.getCurrentUserID()) {
            return message.reply(getLang("notBotMsg"));
        }
        try {
            await api.unsendMessage(event.messageReply.messageID);
        } catch (err: any) {
            return message.reply(`❌ Failed to unsend: ${err.message || err}`);
        }
    }
};
