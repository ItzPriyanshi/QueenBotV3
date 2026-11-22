const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

const SETTINGS_PATH = path.join(__dirname, "autolink_settings.json");
const CACHE_DIR = path.join(__dirname, "cache");
const BASE_MEOW_API = "https://meow-dl.onrender.com";
const INSTA_ENDPOINT = "/instav2";
const PIN_ENDPOINT = "/pin";
const BASE_GLOBAL_API = "https://nayan-video-downloader.vercel.app/alldown";

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const getSettings = () => {
  if (!fs.existsSync(SETTINGS_PATH)) fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ enabled: true }));
  return JSON.parse(fs.readFileSync(SETTINGS_PATH));
};

const saveSettings = (settings) => {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings));
};

const fetchInstagramMedia = async (targetUrl) => {
  try {
    const { data } = await axios.get(`${BASE_MEOW_API}${INSTA_ENDPOINT}?url=${encodeURIComponent(targetUrl)}`);
    if (data?.status !== "success") {
      const error = new Error("API_ERR_101: Unsuccessful response status from Instagram API.");
      error.code = "API_ERR_101";
      throw error;
    }
    if (!data?.media || !data.media.length) {
      const error = new Error("API_ERR_102: No media array found in Instagram API payload.");
      error.code = "API_ERR_102";
      throw error;
    }
    const videoMedia = data.media.find((m) => m.type === "video") || data.media[0];
    if (!videoMedia || !videoMedia.url) {
      const error = new Error("API_ERR_103: Video URL missing from the extracted media object.");
      error.code = "API_ERR_103";
      throw error;
    }
    return {
      url: videoMedia.url,
      title: data.title || "Instagram Content",
      ext: videoMedia.type === "image" ? "jpg" : "mp4"
    };
  } catch (err) {
    if (!err.code) {
      err.code = "NET_ERR_100";
      err.message = `Network or parse error on Instagram API: ${err.message}`;
    }
    throw err;
  }
};

const fetchPinterestMedia = async (targetUrl) => {
  try {
    const { data } = await axios.get(`${BASE_MEOW_API}${PIN_ENDPOINT}?url=${encodeURIComponent(targetUrl)}`);
    if (data?.status !== "success") {
      const error = new Error("API_ERR_301: Unsuccessful response status from Pinterest API.");
      error.code = "API_ERR_301";
      throw error;
    }
    if (!data?.media || !data.media.length) {
      const error = new Error("API_ERR_302: No media array found in Pinterest API payload.");
      error.code = "API_ERR_302";
      throw error;
    }
    const mediaItem = data.media.find((m) => m.type === "video") || data.media[0];
    if (!mediaItem || !mediaItem.url) {
      const error = new Error("API_ERR_303: Media URL missing from the extracted Pinterest object.");
      error.code = "API_ERR_303";
      throw error;
    }

    let mediaUrl = mediaItem.url;
    let fallbackUrl = data.thumbnail || null;
    let ext = "mp4";

    if (mediaItem.type === "video") {
      if (mediaUrl.includes("/hls/") && mediaUrl.endsWith(".m3u8")) {
        mediaUrl = mediaUrl.replace(/\/(?:iht\/)?hls\/(?:v\d+\/)?/, "/720p/").replace(".m3u8", ".mp4");
      }
    } else if (mediaItem.type === "gif" || mediaUrl.endsWith(".gif")) {
      ext = "gif";
    } else {
      ext = mediaUrl.endsWith(".png") ? "png" : "jpg";
    }

    return {
      url: mediaUrl,
      fallbackUrl,
      title: data.title || "Pinterest Media",
      ext
    };
  } catch (err) {
    if (!err.code) {
      err.code = "NET_ERR_300";
      err.message = `Network or parse error on Pinterest API: ${err.message}`;
    }
    throw err;
  }
};

const fetchGlobalMedia = async (targetUrl) => {
  try {
    const { data } = await axios.get(`${BASE_GLOBAL_API}?url=${encodeURIComponent(targetUrl)}`);
    const payload = data?.data?.status !== undefined ? data.data : data;

    if (!payload?.status) {
      const error = new Error("API_ERR_201: Unsuccessful response status from Global API.");
      error.code = "API_ERR_201";
      throw error;
    }

    const mediaInfo = payload.data || payload;
    const downloadUrl = mediaInfo.high || mediaInfo.low;

    if (!downloadUrl) {
      const error = new Error("API_ERR_202: High-quality media URL missing in Global API payload.");
      error.code = "API_ERR_202";
      throw error;
    }

    return {
      url: downloadUrl,
      title: mediaInfo.title || "Video Content",
      ext: "mp4"
    };
  } catch (err) {
    if (!err.code) {
      err.code = "NET_ERR_200";
      err.message = `Network or parse error on Global API: ${err.message}`;
    }
    throw err;
  }
};

module.exports = {
  config: {
    name: "autolink",
    version: "2.4.0",
    author: "Priyanshi Kaur",
    countDown: 2,
    role: 0,
    description: {
      en: "Automatically download videos from Instagram, Facebook, TikTok, YouTube, YouTube Shorts, Pinterest, and X (Twitter)."
    },
    category: "MEDIA",
    guide: {
      en: "{prefix}autolink on/off"
    }
  },
  onStart: async function ({ api, args, event }) {
    const settings = getSettings();
    if (args[0] === "on") {
      settings.enabled = true;
      saveSettings(settings);
      return api.sendMessage("✅ Auto-download is now ON.", event.threadID, event.messageID);
    } else if (args[0] === "off") {
      settings.enabled = false;
      saveSettings(settings);
      return api.sendMessage("❌ Auto-download is now OFF.", event.threadID, event.messageID);
    } else {
      return api.sendMessage(`⚙️ Current status: ${settings.enabled ? "ON ✅" : "OFF ❌"}`, event.threadID, event.messageID);
    }
  },
  onChat: async function ({ api, event }) {
    const settings = getSettings();
    if (!settings.enabled || !event.body) return;

    const linkRegex = /(https?:\/\/(?:www\.|m\.|music\.)?(?:instagram\.com|facebook\.com|fb\.watch|tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com|pinterest\.com|pin\.it|x\.com|twitter\.com|youtube\.com|youtu\.be)\/[^\s]+)/g;
    const matches = event.body.match(linkRegex);
    if (!matches) return;

    const targetUrl = matches[0];
    const isInstagram = targetUrl.includes("instagram.com");
    const isPinterest = targetUrl.includes("pinterest.com") || targetUrl.includes("pin.it");

    api.setMessageReaction("⏳", event.messageID, () => {}, true);
    const startTime = Date.now();

    try {
      let mediaData;
      if (isInstagram) {
        mediaData = await fetchInstagramMedia(targetUrl);
      } else if (isPinterest) {
        mediaData = await fetchPinterestMedia(targetUrl);
      } else {
        mediaData = await fetchGlobalMedia(targetUrl);
      }

      const responseTime = (Date.now() - startTime).toFixed(2);
      let mediaBuffer;
      let finalExt = mediaData.ext || "mp4";

      try {
        const resp = await axios.get(mediaData.url, {
          responseType: "arraybuffer",
          headers: { "User-Agent": "Mozilla/5.0" }
        });
        mediaBuffer = Buffer.from(resp.data);
      } catch (dlErr) {
        if (mediaData.fallbackUrl) {
          const fallbackResp = await axios.get(mediaData.fallbackUrl, {
            responseType: "arraybuffer",
            headers: { "User-Agent": "Mozilla/5.0" }
          });
          mediaBuffer = Buffer.from(fallbackResp.data);
          finalExt = mediaData.fallbackUrl.endsWith(".png") ? "png" : "jpg";
        } else {
          throw dlErr;
        }
      }

      const filePath = path.join(CACHE_DIR, `media_${Date.now()}.${finalExt}`);
      fs.writeFileSync(filePath, mediaBuffer);

      const fileSize = (fs.statSync(filePath).size / (1024 * 1024)).toFixed(2);
      api.setMessageReaction("✅", event.messageID, () => {}, true);
      api.sendMessage(
        {
          body: `🎬 Media Downloaded Successfully!\n\n📌 Title: ${mediaData.title}\n🌐 Platform: ${new URL(targetUrl).hostname}\n⏱️ API Response Time: ${responseTime}ms\n💾 File Size: ${fileSize} MB`,
          attachment: fs.createReadStream(filePath)
        },
        event.threadID,
        () => {
          try {
            fs.unlinkSync(filePath);
          } catch {}
        },
        event.messageID
      );
    } catch (error) {
      api.setMessageReaction("❌", event.messageID, () => {}, true);
      const errorCode = error.code || "SYS_ERR_000";
      const errorMessage = error.message || "An unexpected system error occurred.";
      api.sendMessage(`🚫 Download failed.\n💬 Error [${errorCode}]: ${errorMessage}`, event.threadID, event.messageID);
    }
  }
};