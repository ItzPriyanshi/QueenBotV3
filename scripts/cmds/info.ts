const axios = require('axios');
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
module.exports = {
    config: {
        name: "info",
        version: "2.0.0",
        author: "Priyanshi Kaur",
        countDown: 5,
        role: 0,
        shortDescription: {
            en: "Display bot owner information"
        },
        longDescription: {
            en: "Display detailed information about the bot owner,"
        },
        category: "info",
        guide: {
            en: "{prefix}ownerinfo"
        }
    },
    onStart: async function ({ api, event }) {
        try {
            api.setMessageReaction("⏳", event.messageID, (err) => {
                if (err)
                    console.error(`Error setting reaction: ${err.message}`);
            }, true);
            const ownerInfo = {
                botName: "QueenBotV2",
                ownerName: "Priyanshi Kaur",
                age: "24",
                location: "India",
                facebook: "https://www.facebook.com/PriyanshiKaurJi",
                telegram: "@priyanshikaurji",
                discord: "https://discord.gg/wBYsueQU"
            };
            const currentTime = moment().tz("Asia/Kolkata").format("MMMM Do YYYY, h:mm:ss A");
            const quoteResponse = await axios.get('https://dummyjson.com/quotes/random');
            const randomQuote = quoteResponse.data.quote;
            const imageUrl = 'https://i.imgur.com/JRPaKw7.png';
            const imagePath = path.join(__dirname, 'owner_image.png');
            const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            fs.writeFileSync(imagePath, Buffer.from(imageResponse.data));
            const message = `
🤖 Bot Name: ${ownerInfo.botName}
👤 Owner Name: ${ownerInfo.ownerName}
🎂 Age: ${ownerInfo.age}
📍 Location: ${ownerInfo.location}
📱 Social Media:
   📘 Facebook: ${ownerInfo.facebook}
   📞 Telegram: ${ownerInfo.telegram}
   🎮 Discord: ${ownerInfo.discord}

🕰️ Current Time India: ${currentTime}

🎨 Quote: "${randomQuote}"

Thanks for using our bot! 😊
      `.trim();
            api.sendMessage({ body: message, attachment: fs.createReadStream(imagePath) }, event.threadID, (err) => {
                if (err) {
                    console.error(`Error sending message: ${err.message}`);
                    api.setMessageReaction("❌", event.messageID, (err) => {
                        if (err)
                            console.error(`Error setting error reaction: ${err.message}`);
                    }, true);
                }
                else {
                    api.setMessageReaction("✅", event.messageID, (err) => {
                        if (err)
                            console.error(`Error setting success reaction: ${err.message}`);
                    }, true);
                }
                fs.unlinkSync(imagePath);
            });
        }
        catch (error) {
            console.error('An error occurred:', error.message);
            if (error.response) {
                console.error(`Status Code: ${error.response.status}`);
                console.error(`Response Data: ${JSON.stringify(error.response.data)}`);
            }
            else if (error.request) {
                console.error('No response received:', error.request);
            }
            else {
                console.error('Error Message:', error.message);
            }
            api.setMessageReaction("❌", event.messageID, (err) => {
                if (err)
                    console.error(`Error setting error reaction: ${err.message}`);
            }, true);
            api.sendMessage(`An error occurred while fetching owner information: ${error.message}\nPlease try again later.`, event.threadID);
        }
    }
};
