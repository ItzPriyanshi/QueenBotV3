const axios = require("axios");

function calculateAccountAge(timestamp: number | string | undefined): string {
  if (!timestamp) return "Unknown";
  const createdDate = new Date(Number(timestamp) * 1000);
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - createdDate.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  const years = Math.floor(diffDays / 365);
  const months = Math.floor((diffDays % 365) / 30);
  const days = Math.floor((diffDays % 365) % 30);
  return `${years} years, ${months} months, ${days} days`;
}

module.exports = {
  config: {
    name: "getinfo",
    aliases: ["spy", "userinfo", "whois"],
    version: "2.1.0",
    author: "Priyanshi Kaur",
    countDown: 5,
    role: 0,
    shortDescription: "Get detailed user information and statistics",
    category: "info",
    guide: {
      en: "{p}getinfo [@mention / reply / UID]"
    }
  },

  onStart: async function ({ api, args, message, event, threadsData, usersData }: any) {
    const { threadID, mentions, messageReply } = event;
    let targetUsers: string[] = [];

    if (mentions && Object.keys(mentions).length > 0) {
      targetUsers = Object.keys(mentions);
    } else if (messageReply && messageReply.senderID) {
      targetUsers = [messageReply.senderID];
    } else if (args[0] && /^\d+$/.test(args[0])) {
      targetUsers = [args[0]];
    } else {
      targetUsers = [event.senderID];
    }

    try {
      for (const userID of targetUsers) {
        const userInfo = await api.getUserInfo(userID);
        const user = userInfo[userID] || {};

        let threadData = null;
        let memberData = null;
        try {
          threadData = await threadsData.get(threadID);
          if (threadData && Array.isArray(threadData.members)) {
            memberData = threadData.members.find((m: any) => m.userID === userID);
          }
        } catch {}

        const joinDate = memberData && memberData.joinedAt ? new Date(memberData.joinedAt).toLocaleDateString() : "Unknown";
        const messageCount = memberData ? memberData.messageCount || 0 : 0;
        const gender = user.gender === 1 ? "Female" : user.gender === 2 ? "Male" : "Not specified";

        let responseMsg =
          `🔍 USER PROFILE INFORMATION\n━━━━━━━━━━━━━━━━━━━━━\n` +
          `👤 Name: ${user.name || "Unknown"}\n` +
          `🆔 UserID: ${userID}\n` +
          `⚧️ Gender: ${gender}\n` +
          `🔗 Profile: facebook.com/${userID}\n\n` +
          `📊 Account Status\n` +
          `• Friend Status: ${user.isFriend ? "Yes" : "No"}\n` +
          `• Verified: ${user.verified ? "Verified ✓" : "Standard"}\n` +
          `• Account Age: ${calculateAccountAge(user.createdTime)}\n\n` +
          `💬 Group Activity\n` +
          `• Messages Sent: ${messageCount}\n` +
          `• Joined Group: ${joinDate}`;

        let avatarStream = null;
        if (user.thumbSrc) {
          try {
            const imgRes = await axios.get(user.thumbSrc, { responseType: "stream" });
            avatarStream = imgRes.data;
          } catch {}
        }

        await message.reply({
          body: responseMsg.trim(),
          attachment: avatarStream || undefined
        });
      }
    } catch (err: any) {
      return message.reply(`❌ Error retrieving user info: ${err.message}`);
    }
  }
};
