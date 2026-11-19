const axios = require("axios");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");

module.exports = {
  config: {
    name: "upload",
    aliases: ["catbox", "upcat"],
    version: "3.0.0",
    author: "Priyanshi Kaur",
    countDown: 5,
    role: 0,
    shortDescription: "Upload images, videos, or attachments to Catbox",
    category: "tools",
    guide: {
      en: "Reply to an attachment with {p}upload or {p}upload all"
    }
  },

  onStart: async function ({ message, event, args }: any) {
    const isAll = args[0] === "all";
    const reply = event.messageReply;

    if (!reply || !reply.attachments || reply.attachments.length === 0) {
      return message.reply("❌ Please reply to an image, video, or attachment.");
    }

    const attachments = reply.attachments;
    const workingAttachments = isAll ? attachments : [attachments[0]];

    const cacheDir = path.join(__dirname, "cache");
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

    const waitMsg = await message.reply(`📤 Uploading ${workingAttachments.length} file(s) to permanent hosting...`);
    const results: string[] = [];

    for (let i = 0; i < workingAttachments.length; i++) {
      const file = workingAttachments[i];
      let ext = ".jpg";
      if (file.type === "video") ext = ".mp4";
      else if (file.type === "animated_image") ext = ".gif";
      else if (file.type === "audio") ext = ".mp3";
      else if (file.url && file.url.includes(".png")) ext = ".png";

      const tempPath = path.join(cacheDir, `upload_${Date.now()}_${i}${ext}`);
      try {
        const downloadRes = await axios.get(file.url, { responseType: "arraybuffer", timeout: 25000 });
        fs.writeFileSync(tempPath, downloadRes.data);

        const form = new FormData();
        form.append("reqtype", "fileupload");
        form.append("fileToUpload", fs.createReadStream(tempPath));

        const uploadRes = await axios.post("https://catbox.moe/user/api.php", form, {
          headers: form.getHeaders(),
          timeout: 30000
        });

        try {
          fs.unlinkSync(tempPath);
        } catch {}

        if (typeof uploadRes.data === "string" && uploadRes.data.includes("https://")) {
          results.push(`✅ File ${i + 1}: ${uploadRes.data.trim()}`);
        } else {
          results.push(`❌ File ${i + 1}: Upload failed`);
        }
      } catch (err: any) {
        try {
          fs.unlinkSync(tempPath);
        } catch {}
        results.push(`❌ File ${i + 1}: ${err.message}`);
      }
    }

    return message.reply(results.join("\n"));
  }
};
