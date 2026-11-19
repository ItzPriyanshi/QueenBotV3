const axios = require("axios");
const fs = require("fs");
const path = require("path");

module.exports = {
  config: {
    name: "animestatus",
    aliases: ["anistatus", "as"],
    version: "2.0.0",
    author: "Priyanshi Kaur",
    countDown: 5,
    role: 0,
    shortDescription: "Get a random anime video status",
    category: "media",
    guide: {
      en: "{p}animestatus"
    }
  },

  onStart: async function ({ api, event, message }: any) {
    const threadID = event.threadID;
    try {
      api.setMessageReaction("🎬", event.messageID, () => {}, true);

      const apiUrl = "https://anistatus.onrender.com/kshitiz";
      const response = await axios.get(apiUrl, { timeout: 15000 });

      if (response.data && response.data.url) {
        const videoPageUrl = response.data.url;
        const turtleApiUrl = `https://kshitiz-tikdl.onrender.com/tiktok?url=${encodeURIComponent(videoPageUrl)}`;
        const turtleResponse = await axios.get(turtleApiUrl, { timeout: 20000 });

        if (turtleResponse.data && turtleResponse.data.videoUrl) {
          const directVideoUrl = turtleResponse.data.videoUrl;
          const cacheDir = path.join(__dirname, "cache");
          if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
          const cacheFilePath = path.join(cacheDir, `anime_${Date.now()}.mp4`);

          const videoStream = await axios({
            method: "GET",
            url: directVideoUrl,
            responseType: "arraybuffer",
            timeout: 25000
          });

          fs.writeFileSync(cacheFilePath, Buffer.from(videoStream.data));

          if (fs.existsSync(cacheFilePath)) {
            await api.sendMessage(
              {
                body: "✨ Random Anime Status Video",
                attachment: fs.createReadStream(cacheFilePath)
              },
              threadID,
              () => {
                try {
                  fs.unlinkSync(cacheFilePath);
                } catch {}
              },
              event.messageID
            );
          } else {
            message.reply("❌ Error downloading anime status video.");
          }
        } else {
          message.reply("❌ Error resolving video stream URL.");
        }
      } else {
        message.reply("❌ Error fetching anime status from server.");
      }
    } catch (err: any) {
      message.reply(`❌ An error occurred: ${err.message}`);
    }
  }
};
