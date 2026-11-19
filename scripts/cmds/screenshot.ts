const axios = require("axios");
const fs = require("fs");
const path = require("path");

module.exports = {
  config: {
    name: "screenshot",
    aliases: ["ss", "webss"],
    version: "2.0.0",
    author: "Priyanshi Kaur",
    countDown: 5,
    role: 0,
    shortDescription: "Capture full screenshot of a webpage",
    category: "utility",
    guide: {
      en: "{p}screenshot <website URL>"
    }
  },

  onStart: async function ({ api, event, args, message }: any) {
    if (!args[0]) {
      return message.reply("⚠️ Please provide a website URL.\nExample: {p}screenshot https://google.com");
    }

    let url = args[0];
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
    }

    const waitMsg = await message.reply("📸 Capturing webpage screenshot...");
    const screenshotUrl = `https://image.thum.io/get/width/1280/crop/800/noanimate/${encodeURIComponent(url)}`;
    const tempPath = path.join(__dirname, `screenshot_${Date.now()}.jpg`);

    try {
      const response = await axios.get(screenshotUrl, { responseType: "arraybuffer", timeout: 20000 });
      fs.writeFileSync(tempPath, Buffer.from(response.data));

      await api.sendMessage(
        {
          body: `📸 Screenshot of: ${url}`,
          attachment: fs.createReadStream(tempPath)
        },
        event.threadID,
        () => {
          try {
            fs.unlinkSync(tempPath);
          } catch {}
        },
        event.messageID
      );
    } catch (error: any) {
      return message.reply(`⚠️ Failed to capture screenshot: ${error.message}`);
    }
  }
};
