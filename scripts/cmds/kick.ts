module.exports = {
    config: {
        name: "kick",
        version: "2.0.0",
        author: "Priyanshi Kaur",
        countDown: 5,
        role: 1,
        shortDescription: {
            en: "Kick members or toggle react-to-kick feature"
        },
        longDescription: {
            en: "Kick tagged members from group chat, or enable react-to-kick to remove members by reacting with 👢 or 🚫."
        },
        category: "box chat",
        guide: {
            en: "{pn} @tags: Kick tagged members\n{pn} react [on|off]: Toggle react-to-kick feature"
        }
    },
    langs: {
        en: {
            needAdmin: "⚠️ QueenBot must be a group administrator to perform kick actions.",
            syntaxError: "⚠️ Please tag the members you want to kick, or use: {pn} react on/off",
            reactEnabled: "✅ React-to-kick has been ENABLED for this group. Administrators can now react with 👢 or 🚫 to any message to kick its author.",
            reactDisabled: "❌ React-to-kick has been DISABLED for this group.",
            reactStatus: "ℹ️ React-to-kick is currently %1 in this group.\nUse: {pn} react on/off to change.",
            cannotKickAdmin: "⚠️ Cannot kick group administrator: %1",
            kickSuccess: "👢 Kicked %1 member(s) from the group."
        }
    },
    onStart: async function ({ message, event, args, threadsData, api, getLang, role }) {
        const sub = (args[0] || "").toLowerCase();
        if (sub === "react") {
            const mode = (args[1] || "").toLowerCase();
            const threadData = await threadsData.get(event.threadID);
            const current = threadData?.settings?.reactToKick === true;
            if (!mode) {
                return message.reply(getLang("reactStatus", current ? "ENABLED" : "DISABLED"));
            }
            if (role < 1) {
                return message.reply("⚠️ Only group administrators can toggle the react-to-kick feature.");
            }
            if (mode === "on" || mode === "enable" || mode === "1" || mode === "true") {
                await threadsData.set(event.threadID, true, "settings.reactToKick");
                return message.reply(getLang("reactEnabled"));
            }
            if (mode === "off" || mode === "disable" || mode === "0" || mode === "false") {
                await threadsData.set(event.threadID, false, "settings.reactToKick");
                return message.reply(getLang("reactDisabled"));
            }
            return message.reply(getLang("reactStatus", current ? "ENABLED" : "DISABLED"));
        }
        const threadInfo = await threadsData.get(event.threadID);
        const adminIDs = threadInfo?.adminIDs || [];
        if (!adminIDs.includes(api.getCurrentUserID())) {
            return message.reply(getLang("needAdmin"));
        }
        const mentionIDs = Object.keys(event.mentions || {});
        let targetUIDs: string[] = [];
        if (mentionIDs.length > 0) {
            targetUIDs = mentionIDs;
        } else if (event.messageReply && event.messageReply.senderID) {
            targetUIDs = [event.messageReply.senderID];
        } else {
            targetUIDs = args.filter((arg: string) => !isNaN(Number(arg)) && arg.length > 5);
        }
        if (targetUIDs.length === 0) {
            return message.reply(getLang("syntaxError"));
        }
        let kicked = 0;
        for (const uid of targetUIDs) {
            if (uid === api.getCurrentUserID()) continue;
            if (adminIDs.includes(uid) && !global.GoatBot.config.adminBot.includes(event.senderID)) {
                await message.reply(getLang("cannotKickAdmin", uid));
                continue;
            }
            try {
                await api.removeUserFromGroup(uid, event.threadID);
                kicked++;
            } catch (e: any) {
                await message.reply(`❌ Failed to kick user ${uid}: ${e.message || e}`);
            }
        }
        if (kicked > 0) {
            return message.reply(getLang("kickSuccess", kicked));
        }
    }
};
