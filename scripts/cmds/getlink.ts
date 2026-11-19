module.exports = {
  config: {
    name: "getlink",
    aliases: ["link", "attachmentlink"],
    version: "2.0.0",
    author: "Priyanshi Kaur",
    countDown: 3,
    role: 0,
    shortDescription: "Get direct URLs of images, videos, audio, and attachments",
    category: "media",
    guide: {
      en: "Reply to an attachment message with {p}getlink"
    }
  },

  onStart: async function ({ message, event }: any) {
    const { messageReply } = event;

    if (!messageReply || !messageReply.attachments || messageReply.attachments.length === 0) {
      return message.reply("❌ Please reply to a message containing images, videos, audio, or files.");
    }

    let response = "🔗 ATTACHMENT DIRECT LINKS\n━━━━━━━━━━━━━━━━━━━━━\n";

    for (let i = 0; i < messageReply.attachments.length; i++) {
      const att = messageReply.attachments[i];
      let typeLabel = "📁 File";

      if (att.type === "photo") typeLabel = "🖼️ Image";
      else if (att.type === "video") typeLabel = "🎥 Video";
      else if (att.type === "audio") typeLabel = "🎵 Audio";
      else if (att.type === "animated_image") typeLabel = "🎞️ GIF";
      else if (att.type === "sticker") typeLabel = "🏷️ Sticker";

      response += `\n${typeLabel} #${i + 1}:\n${att.url || att.previewUrl || "N/A"}\n`;
    }

    return message.reply(response.trim());
  }
};
