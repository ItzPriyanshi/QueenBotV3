const axios = require('axios');
const fs = require('fs');
const path = require('path');
const API_KEY = "YOUR_API_KEY";
module.exports = {
    config: {
        name: "tiktok",
        version: "1.0.0",
        author: "Priyanshi Kaur",
        countDown: 5,
        role: 0,
        shortDescription: "TikTok videos",
        longDescription: "Search your favourite tiktok videos by name or link and watch 😊",
        category: "media",
        guide: {
            en: "{pn} <search query>"
        }
    },
    onStart: async function ({ message, args, api, event }) {
        const query = args.join(" ");
        if (!query) {
            return message.reply("⚠️ Please provide a search query.");
        }
        let searchMessageID;
        try {
            const searchMessage = await message.reply("🔎 Searching for TikTok video...");
            searchMessageID = searchMessage.messageID;
            const searchResult = await searchTikTok(query);
            if (!searchResult) {
                await api.editMessage("❌ No videos found for the given query.", searchMessageID);
                return;
            }
            await api.editMessage("✅ Video found! Downloading...", searchMessageID);
            const videoInfo = await downloadTikTok(searchResult.link);
            if (!videoInfo) {
                await api.editMessage("❌ Failed to download the video.", searchMessageID);
                return;
            }
            const videoBuffer = await axios.get(videoInfo.no_watermark, { responseType: 'arraybuffer' });
            const tempVideoPath = path.join(__dirname, `temp_tiktok_${Date.now()}.mp4`);
            fs.writeFileSync(tempVideoPath, videoBuffer.data);
            await message.reply({
                body: `📹 Here's your TikTok video:\n\nTitle: ${videoInfo.title}\nUser: ${videoInfo.user}`,
                attachment: fs.createReadStream(tempVideoPath)
            });
            fs.unlinkSync(tempVideoPath);
        }
        catch (error) {
            console.error('TikTok search and download failed:', error);
            if (searchMessageID) {
                await api.editMessage("❌ An error occurred while processing your request.", searchMessageID);
            }
            else {
                message.reply("❌ An error occurred while processing your request.");
            }
        }
    }
};
async function searchTikTok(query) {
    const encodedQuery = encodeURIComponent(query);
    const searchUrl = `https://for-devs.onrender.com/api/tiktok/search?query=${encodedQuery}&count=1&apikey=${API_KEY}`;
    try {
        const response = await axios.get(searchUrl);
        return response.data[0];
    }
    catch (error) {
        console.error('TikTok search failed:', error);
        return null;
    }
}
async function downloadTikTok(videoUrl) {
    const encodedUrl = encodeURIComponent(videoUrl);
    const downloadUrl = `https://for-devs.onrender.com/api/tiktok/download?url=${encodedUrl}&apikey=${API_KEY}`;
    try {
        const response = await axios.get(downloadUrl);
        return response.data;
    }
    catch (error) {
        console.error('TikTok download failed:', error);
        return null;
    }
}
