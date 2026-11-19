const axios = require('axios');
const { getStreamFromURL } = global.utils;
module.exports = {
    config: {
        name: "hot",
        version: "1.0",
        author: "Priyanshi Kaur",
        countDown: 5,
        role: 0,
        shortDescription: "Random videos",
        longDescription: "Get random videos",
        category: "media",
        guide: "{p}shuffle"
    },
    onStart: async function ({ message }) {
        try {
            const response = await axios.get('https://www.hungdev.id.vn/random/videogai?&apikey=YOUR_API_KEY');
            const stream = await getStreamFromURL(response.data.data);
            message.reply({
                body: "Ｃｒｅａｔｏｒ: 𝑃𝑟𝑖𝑦𝑎𝑛𝑠ℎ𝑖 𝐾𝑎𝑢𝑟 ♕︎",
                attachment: stream
            });
        }
        catch (error) {
            message.reply("Failed to get video. Please try again later.");
        }
    }
};
