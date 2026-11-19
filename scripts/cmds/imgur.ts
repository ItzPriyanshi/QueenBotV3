const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const IMGUR_CLIENT_ID = "YOUR_CILENT_ID";
module.exports = {
    config: {
        name: "imgur",
        version: "1.1",
        author: "Priyanshi Kaur",
        countDown: 1,
        role: 0,
        longDescription: "Upload image to Imgur and get the link",
        category: "utility",
        guide: {
            en: "${pn} reply to an image"
        }
    },
    onStart: async function ({ message, api, event }) {
        const imageUrl = event.messageReply?.attachments[0]?.url;
        if (!imageUrl) {
            return message.reply('⚠️ Please reply to an image to upload it to Imgur.');
        }
        api.setMessageReaction("⏳", event.messageID, (err) => { }, true);
        try {
            const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            const tempImagePath = path.join(__dirname, 'temp_image.jpg');
            fs.writeFileSync(tempImagePath, imageResponse.data);
            const formData = new FormData();
            formData.append('image', fs.createReadStream(tempImagePath));
            const imgurResponse = await axios.post('https://api.imgur.com/3/upload', formData, {
                headers: {
                    ...formData.getHeaders(),
                    Authorization: `Client-ID ${IMGUR_CLIENT_ID}`
                }
            });
            const imgurLink = imgurResponse.data.data.link;
            fs.unlinkSync(tempImagePath);
            api.sendMessage('✅ Successfully Uploaded.:\n' + imgurLink, event.threadID, async () => {
                await api.setMessageReaction("✅", event.messageID, (err) => { }, true);
            });
        }
        catch (error) {
            console.error('Imgur upload failed:', error);
            await message.reply('❌ Oops! Something went wrong while uploading the image.');
            api.setMessageReaction("❌", event.messageID, (err) => { }, true);
        }
    }
};
