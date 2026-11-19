const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");
module.exports = {
    config: {
        name: "meme",
        aliases: ["funny"],
        version: "1.5.0",
        author: "Priyanshi Kaur",
        countDown: 5,
        role: 0,
        shortDescription: {
            en: "Get random memes or memes from specific subreddits"
        },
        longDescription: {
            en: "Fetch and send random memes from various subreddits or specify a subreddit to get memes from."
        },
        category: "fun",
        guide: {
            en: "{prefix}meme [subreddit]\n\nExamples:\n{prefix}meme : for a random meme\n{prefix}meme dankmemes : for a meme from r/dankmemes"
        }
    },
    onStart: async function ({ api, event, args }) {
        const memeApi = "https://meme-api.com/gimme";
        let apiUrl = memeApi;
        if (args[0]) {
            apiUrl += `/${args[0]}`;
        }
        api.setMessageReaction("⏳", event.messageID, (err) => { }, true);
        try {
            const response = await axios.get(apiUrl);
            const memeData = response.data;
            if (memeData.nsfw && !event.isGroup) {
                api.setMessageReaction("🔞", event.messageID, (err) => { }, true);
                return api.sendMessage("This meme is NSFW and can't be sent in private messages.", event.threadID, event.messageID);
            }
            const imageName = 'meme.jpg';
            const imagePath = path.join(__dirname, 'cache', imageName);
            const imageResponse = await axios.get(memeData.url, { responseType: 'arraybuffer' });
            await fs.outputFile(imagePath, imageResponse.data);
            api.setMessageReaction("🖼️", event.messageID, (err) => { }, true);
            await api.sendMessage({
                attachment: fs.createReadStream(imagePath),
                body: `Title: ${memeData.title}\nSubreddit: r/${memeData.subreddit}`
            }, event.threadID, (err, info) => {
                if (err) {
                    console.error(`Error sending meme:`, err);
                    api.setMessageReaction("❌", event.messageID, (err) => { }, true);
                }
                else {
                    api.setMessageReaction("😂", event.messageID, (err) => { }, true);
                }
            });
            await fs.remove(imagePath);
        }
        catch (error) {
            console.error(`Error in meme command:`, error);
            api.sendMessage("Sorry, I couldn't fetch a meme right now. Please try again later.", event.threadID, event.messageID);
            api.setMessageReaction("❌", event.messageID, (err) => { }, true);
        }
    }
};
