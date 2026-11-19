module.exports = {
    config: {
        name: "clear",
        aliases: ["cl"],
        author: "Priyanshi Kaur",
        version: "3.0",
        cooldowns: 4,
        role: 0,
        shortDescription: {
            en: ""
        },
        longDescription: {
            en: "Unsend messages sent by bot"
        },
        category: "boxchat",
        guide: {
            en: "{p}{n} [number]"
        }
    },
    onStart: async function ({ api, event, args }) {
        const threadID = event.threadID;
        const numMessages = args[0] ? parseInt(args[0]) : 50;
        const unsendBotMessages = async () => {
            try {
                const botMessages = await api.getThreadHistory(threadID, numMessages);
                const botSentMessages = botMessages.filter(message => message.senderID === api.getCurrentUserID());
                for (const message of botSentMessages) {
                    if (Date.now() - message.timestamp < 120000)
                        await api.unsendMessage(message.messageID);
                }
            }
            catch (error) {
                console.error("Error occurred while unsending messages:", error);
            }
        };
        await unsendBotMessages();
    }
};
