const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");
module.exports = {
    config: {
        name: "pinterest2",
        aliases: ["pin2"],
        version: "1.0.2",
        author: "Priyanshi Kaur",
        role: 0,
        countDown: 30,
        shortDescription: {
            en: "Search for images on Pinterest"
        },
        longDescription: {
            en: "Search and send images from Pinterest based on a query."
        },
        category: "image",
        guide: {
            en: "{prefix}pinterest <search query> -<number of images>"
        }
    },
    onStart: async function ({ api, event, args, usersData }) {
        try {
            const userID = event.senderID;
            const keySearch = args.join(" ");
            if (!keySearch.includes("-")) {
                return api.sendMessage(`Please use the correct format: ${this.config.guide.en}`, event.threadID, event.messageID);
            }
            const keySearchs = keySearch.substr(0, keySearch.indexOf('-')).trim();
            const numberSearch = parseInt(keySearch.split("-").pop().trim()) || 6;
            const res = await axios.get(`https://for-devs.onrender.com/api/pin?search=${encodeURIComponent(keySearchs)}&apikey=YOUR_API_KEY`);
            const data = res.data.data;
            if (!data || !Array.isArray(data) || data.length === 0) {
                return api.sendMessage(`No images found for "${keySearchs}". Please try another query.`, event.threadID, event.messageID);
            }
            const imgData = [];
            const cacheDir = path.join(__dirname, 'cache');
            if (!fs.existsSync(cacheDir))
                fs.mkdirSync(cacheDir);
            for (let i = 0; i < Math.min(numberSearch, data.length); i++) {
                const imageUrl = data[i];
                try {
                    const imgResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
                    const imgPath = path.join(cacheDir, `${i + 1}.jpg`);
                    await fs.outputFile(imgPath, imgResponse.data);
                    imgData.push(fs.createReadStream(imgPath));
                }
                catch (error) {
                    console.error(error);
                }
            }
            await api.sendMessage({
                attachment: imgData,
                body: `Here are the top ${imgData.length} image results for "${keySearchs}":`
            }, event.threadID, event.messageID);
            await fs.remove(cacheDir);
        }
        catch (error) {
            console.error(error);
            return api.sendMessage(`An error occurred. Please try again later.`, event.threadID, event.messageID);
        }
    }
};
