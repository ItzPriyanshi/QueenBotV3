module.exports = {
    config: {
        name: "pin",
        aliases: ["unpin", "pinmessage"],
        version: "2.0.0",
        author: "Priyanshi Kaur",
        role: 0,
        countDown: 5,
        category: "box chat",
        shortDescription: {
            en: "Pin or unpin messages in thread"
        },
        longDescription: {
            en: "Reply to any message with /pin or /unpin to pin/unpin it in the thread"
        },
        guide: {
            en: "Reply to a message with {pn} or {pn} unpin"
        }
    },
    onStart: async function ({ api, args, message, event }) {
        const isUnpin = args[0]?.toLowerCase() === "unpin" || event.body.toLowerCase().startsWith("/unpin");
        const targetMessageID = event.messageReply?.messageID;
        if (!targetMessageID) {
            return message.reply("⚠️ Please reply to the message you want to " + (isUnpin ? "unpin" : "pin") + "!");
        }
        if (isUnpin) {
            if (typeof message.unpin === "function") {
                await message.unpin(targetMessageID, (err) => {
                    if (err)
                        return message.reply("❌ Failed to unpin message: " + (err.message || err));
                    return message.reply("📌 Message unpinned successfully!");
                });
            }
            else {
                return message.reply("Unpin feature is not supported by current FCA.");
            }
        }
        else {
            if (typeof message.pin === "function") {
                await message.pin(targetMessageID, (err) => {
                    if (err)
                        return message.reply("❌ Failed to pin message: " + (err.message || err));
                    return message.reply("📌 Message pinned successfully!");
                });
            }
            else {
                return message.reply("Pin feature is not supported by current FCA.");
            }
        }
    }
};
