const axios = require("axios");

module.exports = {
  config: {
    name: "gemini",
    aliases: ["gem", "googleai"],
    version: "2.5.0",
    author: "Priyanshi Kaur",
    countDown: 3,
    role: 0,
    shortDescription: "Generate responses using Google Gemini AI",
    category: "AI",
    guide: {
      en: "{p}gemini <your query>"
    }
  },

  onStart: async function ({ message, args, event }: any) {
    const query = args.join(" ").trim();
    if (!query) {
      return message.reply("❓ Please provide a prompt or question for Gemini AI.\nExample: {p}gemini Explain gravity in simple terms");
    }

    const thinking = await message.reply("✨ Consulting Gemini AI...");
    const apiKey = process.env.GEMINI_API_KEY || (global as any).config?.geminiApiKey;

    if (apiKey) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        const response = await axios.post(url, {
          contents: [{ parts: [{ text: query }] }]
        });
        const answer = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (answer) {
          return message.reply(answer.trim(), thinking.messageID);
        }
      } catch {}
    }

    try {
      const res = await fetch("https://text.pollinations.ai/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content: "You are Google Gemini assistant operating inside QueenBot v3 by Priyanshi Kaur. Answer thoughtfully, concisely, and helpfully."
            },
            { role: "user", content: query }
          ]
        })
      });
      const text = await res.text();
      if (text && text.trim()) {
        return message.reply(text.trim(), thinking.messageID);
      }
    } catch (e: any) {
      return message.reply(`❌ Failed to get a response: ${e.message}`, thinking.messageID);
    }
  }
};
