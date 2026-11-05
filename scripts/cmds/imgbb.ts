const axios = require('axios');
const FormData = require('form-data');

module.exports = {
    config: {
        name: "imgbb",
        version: "1.2",
        author: "Priyanshi Kaur",
        countDown: 5,
        role: 0,
        longDescription: "Upload images, GIFs, and videos",
        category: "utility",
        guide: {
            en: "${pn} [reply] | ${pn} [url] | ${pn} [expiration] [reply]"
        }
    },
    onStart: async function ({ message, event, args }) {
        const imgbbApiKey = "74a35e5d09c0173084be33cefb1e4fea";
        let targets = [];
        let expiration = null;

        if (args.length > 0 && !isNaN(args[0])) {
            expiration = parseInt(args[0]);
            args.shift();
        }

        if (event.messageReply?.attachments?.length > 0) {
            const validTypes = ["photo", "animated_image", "video"];
            targets = event.messageReply.attachments
                .filter(item => validTypes.includes(item.type))
                .map(item => ({ url: item.url, type: item.type }));
        } else if (args.length > 0 && args[0].match(/^https?:\/\//)) {
            targets.push({ url: args[0], type: 'unknown' });
        }

        if (targets.length === 0) {
            return message.reply('Please reply to media or provide a direct URL.');
        }

        await message.reply(`Uploading ${targets.length} file(s)...`);
        let results = [];

        try {
            for (let i = 0; i < targets.length; i++) {
                const { url, type } = targets[i];
                const response = await axios.get(url, { responseType: 'arraybuffer' });
                const isVideo = type === 'video' || url.match(/\.(mp4|webm|mov|avi)$/i);
                const isGif = type === 'animated_image' || url.match(/\.(gif)$/i);
                const formData = new FormData();

                if (isVideo) {
                    formData.append('reqtype', 'fileupload');
                    formData.append('fileToUpload', Buffer.from(response.data, 'binary'), { filename: `video_${i}.mp4` });
                    const res = await axios.post('https://catbox.moe/user/api.php', formData, {
                        headers: formData.getHeaders()
                    });
                    results.push(`🎥 Video ${i + 1}:\n🔹 URL: ${res.data}`);
                } else {
                    const filename = isGif ? `animated_${i}.gif` : `image_${i}.png`;
                    formData.append('image', Buffer.from(response.data, 'binary'), { filename });
                    const params = { key: imgbbApiKey };
                    if (expiration) params.expiration = expiration;

                    const res = await axios.post('https://api.imgbb.com/1/upload', formData, {
                        headers: formData.getHeaders(),
                        params: params
                    });
                    const data = res.data.data;
                    results.push(`📸 Media ${i + 1}:\n🔹 Direct: ${data.url}\n🔹 Viewer: ${data.url_viewer}\n🗑️ Delete: ${data.delete_url}`);
                }
            }

            let finalReply = results.join('\n\n');
            if (expiration) {
                finalReply += `\n\n⏱️ ImgBB files auto-delete in ${expiration} seconds.`;
            }

            return message.reply(finalReply);
        } catch (error) {
            return message.reply('Failed to upload media. Please try again later.');
        }
    }
};
