const axios = require("axios");

module.exports = {
  config: {
    name: "boxinfo",
    aliases: ["groupinfo", "ginfo"],
    version: "2.5.0",
    author: "Priyanshi Kaur",
    role: 0,
    countDown: 5,
    category: "box",
    shortDescription: "Get complete group information including member stats and icon",
    guide: {
      en: "{p}boxinfo"
    }
  },

  onStart: async function ({ api, event, message }: any) {
    try {
      const threadID = event.threadID;
      const info = await api.getThreadInfo(threadID);

      const threadName = info.threadName || "Unnamed Group";
      const messageCount = info.messageCount || "N/A";
      const memberCount = Array.isArray(info.participantIDs) ? info.participantIDs.length : 0;
      const adminCount = Array.isArray(info.adminIDs) ? info.adminIDs.length : 0;
      const approvalMode = info.approvalMode ? "✅ Enabled" : "❌ Disabled";
      const emoji = info.emoji || "Default";
      const color = info.color || "Default";

      let nicknames: string[] = [];
      if (info.nicknames) {
        for (const uid in info.nicknames) {
          nicknames.push(`${uid}: ${info.nicknames[uid]}`);
        }
      }

      let male = 0;
      let female = 0;
      let other = 0;
      if (Array.isArray(info.userInfo)) {
        for (const user of info.userInfo) {
          if (user.gender === "MALE") male++;
          else if (user.gender === "FEMALE") female++;
          else other++;
        }
      }

      let groupImage = null;
      if (info.imageSrc) {
        try {
          const imgRes = await axios.get(info.imageSrc, { responseType: "stream" });
          groupImage = imgRes.data;
        } catch {}
      }

      let output = `📌 GROUP INFORMATION\n━━━━━━━━━━━━━━━━━━━━━\n`;
      output += `👑 Name: ${threadName}\n`;
      output += `🆔 ID: ${threadID}\n`;
      output += `📩 Messages: ${messageCount}\n`;
      output += `👥 Members: ${memberCount} (👨 ${male} | 👩 ${female} | ⚧️ ${other})\n`;
      output += `🛡️ Admins: ${adminCount}\n`;
      output += `🎨 Color: ${color}\n`;
      output += `😀 Emoji: ${emoji}\n`;
      output += `📝 Approval Mode: ${approvalMode}\n`;

      if (nicknames.length > 0) {
        output += `\n📛 Nicknames (${nicknames.length}):\n${nicknames.slice(0, 10).join("\n")}${nicknames.length > 10 ? `\n...and ${nicknames.length - 10} more` : ""}`;
      }

      return message.reply({
        body: output.trim(),
        attachment: groupImage || undefined
      });
    } catch (err: any) {
      return message.reply(`❌ Failed to retrieve group info: ${err.message}`);
    }
  }
};
