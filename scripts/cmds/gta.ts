const axios = require('axios');
const fs = require('fs');
const path = require('path');
module.exports.config = {
    name: "gta",
    version: "1.0.0",
    author: "Priyanshi Kaur",
    countDown: 8,
    role: 0,
    shortDescription: "Turn images into GTA style",
    longDescription: "Transform photos into GTA character style using AI",
    category: "image",
    guide: {
        en: "{pn} [Reply to image(s) or provide imgur link]"
    }
};
async function getGTAFilter(imageUrl) {
    try {
        const part1 = "http://api-samirxz.onrender";
        const part2 = ".com";
        const endpoint = "/gta";
        const fullUrl = `https://${part1}${part2}${endpoint}?url=${encodeURIComponent(imageUrl)}`;
        const response = await axios({
            method: 'get',
            url: fullUrl,
            responseType: 'arraybuffer',
            headers: {
                'accept': 'image/*',
                'accept-language': 'en-US,en;q=0.9'
            }
        });
        return Buffer.from(response.data);
    }
    catch (error) {
        throw new Error(`Failed to process image: ${error.message}`);
    }
}
module.exports.onStart = async function ({ api, event, message, args }) {
    const { messageReply, threadID } = event;
    let imageUrls = [];
    let processingMessage;
    try {
        if (args[0] && args[0].match(/https?:\/\/[^\s]+/)) {
            imageUrls = [args[0]];
        }
        else if (messageReply && messageReply.attachments && messageReply.attachments.length > 0) {
            imageUrls = messageReply.attachments
                .filter(att => att.type === "photo")
                .map(att => att.url);
        }
        if (imageUrls.length === 0) {
            return message.reply("🎮 Reply to a photo or provide an image link to transform into GTA style character.");
        }
        processingMessage = await message.reply(`🎮 Converting ${imageUrls.length} image(s) into GTA style...\n\nWelcome to Los Santos! 🌆`);
        const tempDir = path.join(__dirname, "temp");
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir);
        }
        const gtaQuotes = [
            "Welcome to Los Santos! 🌆",
            "Grove Street, home! 🏠",
            "All you had to do was follow the damn train! 🚂",
            "Ah shit, here we go again! 😎",
            "Respect+ 👊",
            "Mission Passed! ✨",
            "Wasted! ☠️",
            "Grove Street for life! 🌳"
        ];
        for (let i = 0; i < imageUrls.length; i++) {
            const tempFilePath = path.join(tempDir, `gta_${Date.now()}_${i}.png`);
            const gtaBuffer = await getGTAFilter(imageUrls[i]);
            fs.writeFileSync(tempFilePath, gtaBuffer);
            const randomQuote = gtaQuotes[Math.floor(Math.random() * gtaQuotes.length)];
            await api.sendMessage({
                body: `${randomQuote}\n\n${i + 1}/${imageUrls.length} Transformation Complete! 🎮`,
                attachment: fs.createReadStream(tempFilePath)
            }, threadID, async () => {
                fs.unlinkSync(tempFilePath);
            });
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        if (processingMessage) {
            await api.unsendMessage(processingMessage.messageID);
        }
        await message.reply({
            body: `✨ Mission Passed! Respect+\n${imageUrls.length} photo(s) transformed into GTA style!\n\n🎮 Use .gta again to transform more images`,
        });
    }
    catch (error) {
        if (processingMessage) {
            await api.unsendMessage(processingMessage.messageID);
        }
        console.error(error);
        return message.reply(`❌ Mission Failed!\nError: ${error.message}`);
    }
};
module.exports.onReply = async function ({ api, event, message }) {
    if (event.messageReply && event.messageReply.attachments && event.messageReply.attachments.length > 0) {
        const gtaCommand = global.GoatBot.commands.get("gta");
        if (gtaCommand) {
            await gtaCommand.onStart({ api, event, message });
        }
    }
};
