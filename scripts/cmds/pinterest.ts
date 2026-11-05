const axios = require("axios");
const fs = require("fs");
const path = require("path");

async function fetchPinterestImages(query: string, count: number): Promise<string[]> {
  try {
    const resToken = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query + " pinterest")}`);
    const text = await resToken.text();
    const vqdMatch = text.match(/vqd=([0-9-]+)/);
    if (!vqdMatch) return [];
    const vqd = vqdMatch[1];
    const imgRes = await fetch(`https://duckduckgo.com/i.js?l=wt-wt&o=json&q=${encodeURIComponent(query + " pinterest")}&vqd=${vqd}`);
    const data = await imgRes.json();
    const urls = (data.results || []).map((r: any) => r.image).filter(Boolean);
    return urls.slice(0, count);
  } catch {
    return [];
  }
}

module.exports = {
  config: {
    name: "pinterest",
    aliases: ["pinter", "pint"],
    version: "2.0.0",
    author: "Priyanshi Kaur",
    role: 0,
    countDown: 5,
    shortDescription: "Search and send images from Pinterest",
    category: "image",
    guide: {
      en: "{p}pinterest <search query> [-count]\nExample: {p}pinterest madara uchiha - 3"
    }
  },

  onStart: async function ({ api, event, args, message }: any) {
    const rawInput = args.join(" ").trim();
    if (!rawInput) {
      return message.reply("⚠️ Please enter a search query.\nExample: {p}pinterest madara uchiha - 3");
    }

    let searchTerm = rawInput;
    let count = 6;

    if (rawInput.includes("-")) {
      const parts = rawInput.split("-");
      const parsedCount = parseInt(parts[parts.length - 1].trim());
      if (!isNaN(parsedCount) && parsedCount > 0) {
        count = Math.min(parsedCount, 9);
        searchTerm = parts.slice(0, -1).join("-").trim();
      }
    }

    const waitMsg = await message.reply(`🔍 Searching Pinterest for "${searchTerm}" (${count} images)...`);

    try {
      const imageUrls = await fetchPinterestImages(searchTerm, count);
      if (!imageUrls || imageUrls.length === 0) {
        return message.reply(`❌ No Pinterest images found for "${searchTerm}". Try another search term.`);
      }

      const cacheDir = path.join(__dirname, "cache");
      if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

      const streams: any[] = [];
      const filePaths: string[] = [];

      for (let i = 0; i < imageUrls.length; i++) {
        const url = imageUrls[i];
        const filePath = path.join(cacheDir, `pin_${Date.now()}_${i}.jpg`);
        try {
          const resp = await axios.get(url, { responseType: "arraybuffer", timeout: 15000 });
          fs.writeFileSync(filePath, Buffer.from(resp.data));
          streams.push(fs.createReadStream(filePath));
          filePaths.push(filePath);
        } catch {}
      }

      if (streams.length === 0) {
        return message.reply("❌ Failed to download Pinterest images. Please try again.");
      }

      await api.sendMessage(
        {
          body: `📌 Pinterest Results: "${searchTerm}" (${streams.length} images)`,
          attachment: streams
        },
        event.threadID,
        () => {
          for (const fp of filePaths) {
            try {
              fs.unlinkSync(fp);
            } catch {}
          }
        },
        event.messageID
      );
    } catch (err: any) {
      return message.reply(`❌ Error fetching Pinterest images: ${err.message}`);
    }
  }
};
