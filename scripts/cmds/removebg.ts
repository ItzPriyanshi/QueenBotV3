const axios = require('axios');
const fs = require('fs');
const path = require('path');
module.exports.config = {
    name: "rbg",
    version: "1.5.0",
    author: "Priyanshi Kaur",
    countDown: 5,
    role: 0,
    shortDescription: "Remove image background",
    longDescription: "Remove the background from an image",
    category: "image",
    guide: {
        en: "{pn} [Reply to an image]"
    }
};
module.exports.onStart = async function ({ api, event, message }) {
    const { messageReply, threadID, messageID } = event;
    if (!messageReply || !messageReply.attachments || !messageReply.attachments[0]) {
        return message.reply("Please reply to an image to remove its background.");
    }
    const attachment = messageReply.attachments[0];
    if (attachment.type !== "photo") {
        return message.reply("The replied content must be an image.");
    }
    try {
        const apiKey = "YOUR_API_KEY";
        message.reply("⌛ Removing background from your image...");
        const response = await axios({
            method: 'get',
            url: `https://for-devs.onrender.com/api/rbg`,
            params: {
                imageUrl: attachment.url,
                apikey: apiKey
            },
            responseType: 'arraybuffer'
        });
        const tempFilePath = path.join(__dirname, "temp", `nobg_${Date.now()}.png`);
        if (!fs.existsSync(path.join(__dirname, "temp"))) {
            fs.mkdirSync(path.join(__dirname, "temp"));
        }
        fs.writeFileSync(tempFilePath, Buffer.from(response.data));
        await api.sendMessage({
            attachment: fs.createReadStream(tempFilePath),
            body: "✨ Here's your image with background removed!"
        }, threadID, () => fs.unlinkSync(tempFilePath));
    }
    catch (error) {
        console.error(error);
        return message.reply("❌ An error occurred while processing your image. Please try again later.");
    }
};
