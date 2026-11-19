module.exports = {
    config: {
        name: "getsticker",
        aliases: ["stickerid", "soundmojiid"],
        version: "2.0.0",
        author: "Priyanshi Kaur",
        role: 0,
        countDown: 5,
        category: "box chat",
        shortDescription: {
            en: "Get sticker or Soundmoji ID"
        },
        longDescription: {
            en: "Reply to any sticker or Soundmoji to extract its numeric ID"
        },
        guide: {
            en: "Reply to a sticker with {pn}"
        }
    },
    onStart: async function ({ message, event }) {
        if (!event.messageReply) {
            return message.reply("⚠️ Please reply to a message containing a sticker or soundmoji!");
        }
        const attachments = event.messageReply.attachments || [];
        const stickerAttachment = attachments.find(a => a.type === "sticker" || a.stickerID);
        if (stickerAttachment) {
            const id = stickerAttachment.ID || stickerAttachment.stickerID;
            return message.reply(`🎟️ Sticker / Soundmoji ID: ${id}\n\n👉 Send it with: /musicsticker ${id}`);
        }
        if (event.messageReply.stickerID) {
            return message.reply(`🎟️ Sticker ID: ${event.messageReply.stickerID}\n\n👉 Send it with: /musicsticker ${event.messageReply.stickerID}`);
        }
        return message.reply("❌ No sticker or Soundmoji detected in that message.");
    }
};
