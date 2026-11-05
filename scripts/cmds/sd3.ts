const axios = require('axios');
const fs = require('fs');
const path = require('path');
module.exports = {
    config: {
        name: "StableDiffusion",
        aliases: ["sd3"],
        author: "Priyanshi Kaur",
        version: "1.0",
        cooldowns: 5,
        role: 0,
        shortDescription: "Generate image using Stable Diffusion",
        longDescription: "Generate an image from text using Stable Diffusion 3",
        category: "image",
        guide: {
            en: "{p}StableDiffusion <prompt>"
        }
    },
    onStart: async function ({ api, event, args }) {
        const prompt = args.join(" ");
        if (!prompt) {
            return api.sendMessage("Please provide a prompt for the image generation.", event.threadID, event.messageID);
        }
        api.sendMessage("⏳ Generating image, please wait...", event.threadID, event.messageID);
        try {
            const apiUrl = `https://priyansh-ai.onrender.com/SD3?prompt=${encodeURIComponent(prompt)}&apikey=NEED_AUTHOR_PERMISSION`;
            const response = await axios.get(apiUrl);
            const imageUrl = response.data.imageUrl;
            const imagePath = path.join(__dirname, `temp_${Date.now()}.jpg`);
            const writer = fs.createWriteStream(imagePath);
            const imageResponse = await axios({
                url: imageUrl,
                method: 'GET',
                responseType: 'stream'
            });
            imageResponse.data.pipe(writer);
            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });
            await api.sendMessage({
                body: "Here's your generated image:",
                attachment: fs.createReadStream(imagePath)
            }, event.threadID, event.messageID);
            fs.unlinkSync(imagePath);
        }
        catch (error) {
            console.error(error);
            api.sendMessage("An error occurred while generating the image. Please try again later.", event.threadID, event.messageID);
        }
    }
};
