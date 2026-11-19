module.exports = {
    config: {
        name: "musicsticker",
        aliases: ["soundmoji", "audioemoji"],
        version: "2.0.0",
        author: "Priyanshi Kaur",
        role: 0,
        countDown: 5,
        category: "box chat",
        shortDescription: {
            en: "Send music sticker / soundmoji"
        },
        longDescription: {
            en: "Send a soundmoji or music sticker by sticker ID"
        },
        guide: {
            en: "{pn} <stickerID>\nExample: {pn} 369239263222822"
        }
    },
    onStart: async function ({ api, args, message, event }) {
        const stickerID = args[0];
        if (!stickerID) {
            return message.reply("⚠️ Please provide a sticker / soundmoji ID!\nExample: musicsticker 369239263222822");
        }
        if (typeof message.sendMusicSticker === "function") {
            await message.sendMusicSticker(stickerID, (err) => {
                if (err)
                    return message.reply("❌ Failed to send music sticker: " + (err.message || err));
            });
        }
        else {
            api.sendMessage({ sticker: String(stickerID) }, event.threadID, (err) => {
                if (err)
                    return message.reply("❌ Error: " + (err.message || err));
            });
        }
    }
};
