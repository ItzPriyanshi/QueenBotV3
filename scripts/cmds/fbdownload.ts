const axios = require("axios");
const fs = require("fs");
const path = require("path");

async function snapSave(facebookVideoUrl: string): Promise<string | null> {
  try {
    const postData = new URLSearchParams({ url: facebookVideoUrl }).toString();
    const headers = {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "referer": "https://snapsave.app/"
    };
    const res = await axios.post("https://snapsave.app/action.php", postData, { headers, timeout: 10000 });
    const jsEncoded = res.data.match(/javascript">(.*?)<\/script>/)?.[1];
    if (!jsEncoded) return null;
    const decodeUrl = jsEncoded.match(/href=\\"(http.*?)\\"/);
    return decodeUrl ? decodeUrl[1] : null;
  } catch {
    return null;
  }
}

module.exports = {
  config: {
    name: "fbdownload",
    aliases: ["fbvideo", "fbdown"],
    version: "2.0.0",
    author: "Priyanshi Kaur",
    role: 0,
    countDown: 5,
    shortDescription: "Download public Facebook videos",
    category: "media",
    guide: {
      en: "{p}fbdownload <Facebook video URL>"
    }
  },

  onStart: async function ({ api, event, args, message }: any) {
    const url = args[0] || (event.messageReply ? event.messageReply.body : null);
    if (!url || !url.includes("facebook.com")) {
      return message.reply("❌ Please provide a valid Facebook video URL.\nExample: {p}fbdownload https://www.facebook.com/watch?v=12345");
    }

    const waitMsg = await message.reply("⏳ Fetching and processing Facebook video...");

    try {
      const videoUrl = await snapSave(url);
      if (!videoUrl) {
        return message.reply("❌ Unable to fetch the Facebook video. Ensure the video is public and valid.");
      }

      const cacheDir = path.join(__dirname, "cache");
      if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
      const videoPath = path.join(cacheDir, `fb_${Date.now()}.mp4`);

      const resp = await axios({
        url: videoUrl,
        method: "GET",
        responseType: "stream",
        timeout: 25000
      });

      const writeStream = fs.createWriteStream(videoPath);
      resp.data.pipe(writeStream);

      writeStream.on("finish", async () => {
        await api.sendMessage(
          {
            body: "🎥 Facebook Video Downloaded Successfully!",
            attachment: fs.createReadStream(videoPath)
          },
          event.threadID,
          () => {
            try {
              fs.unlinkSync(videoPath);
            } catch {}
          },
          event.messageID
        );
      });

      writeStream.on("error", async () => {
        await message.reply("❌ An error occurred while writing video stream.");
      });
    } catch (err: any) {
      return message.reply(`❌ Failed to download Facebook video: ${err.message}`);
    }
  }
};
