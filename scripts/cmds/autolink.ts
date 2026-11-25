const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

const DATA_PATH = path.join(__dirname, "autolink_data.json");
const CACHE_DIR = path.join(__dirname, "cache");
const BASE_MEOW_API = "https://meow-dl.onrender.com";
const INSTA_ENDPOINT = "/instav2";
const PIN_ENDPOINT = "/pin";
const BASE_GLOBAL_API = "https://nayan-video-downloader.vercel.app/alldown";

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const readData = () => {
  if (!fs.existsSync(DATA_PATH)) {
    fs.writeFileSync(DATA_PATH, JSON.stringify({ threads: {} }, null, 2));
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
    if (!parsed.threads || typeof parsed.threads !== "object") {
      return { threads: {} };
    }
    return parsed;
  } catch {
    return { threads: {} };
  }
};

const writeData = (data) => {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
};

const getThreadData = (threadID) => {
  const data = readData();
  const tid = String(threadID);
  if (!data.threads[tid]) {
    data.threads[tid] = {
      enabled: true,
      blacklist: [],
      history: []
    };
    writeData(data);
  }
  if (!Array.isArray(data.threads[tid].blacklist)) data.threads[tid].blacklist = [];
  if (!Array.isArray(data.threads[tid].history)) data.threads[tid].history = [];
  if (typeof data.threads[tid].enabled !== "boolean") data.threads[tid].enabled = true;
  return data.threads[tid];
};

const updateThreadData = (threadID, updater) => {
  const data = readData();
  const tid = String(threadID);
  if (!data.threads[tid]) {
    data.threads[tid] = {
      enabled: true,
      blacklist: [],
      history: []
    };
  }
  updater(data.threads[tid]);
  writeData(data);
  return data.threads[tid];
};

const extractTargetUID = (event, args) => {
  if (event.messageReply && event.messageReply.senderID) {
    return String(event.messageReply.senderID);
  }
  if (event.mentions && Object.keys(event.mentions).length > 0) {
    return String(Object.keys(event.mentions)[0]);
  }
  const uidArg = args.slice(1).find((a) => /^\d+$/.test(a.trim()));
  if (uidArg) {
    return String(uidArg.trim());
  }
  return null;
};

const detectExtensionFromUrl = (url, fallbackExt) => {
  const cleanPath = url.split("?")[0].toLowerCase();
  if (cleanPath.endsWith(".mp4")) return "mp4";
  if (cleanPath.endsWith(".gif")) return "gif";
  if (cleanPath.endsWith(".png")) return "png";
  if (cleanPath.endsWith(".webp")) return "webp";
  if (cleanPath.endsWith(".jpg") || cleanPath.endsWith(".jpeg")) return "jpg";
  return fallbackExt;
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
    const selectedMedia = data.media.find((m) => m.type === "video") || data.media[0];
    if (!selectedMedia || !selectedMedia.url) {
      const error = new Error("API_ERR_103: Media URL missing from the extracted media object.");
      error.code = "API_ERR_103";
      throw error;
    }
    const defaultExt = selectedMedia.type === "video" ? "mp4" : selectedMedia.type === "gif" ? "gif" : "jpg";
    return {
      url: selectedMedia.url,
      title: (data.title || "Instagram Content").trim(),
      ext: detectExtensionFromUrl(selectedMedia.url, defaultExt),
      mediaType: selectedMedia.type || "media"
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
    const mediaItem =
      data.media.find((m) => m.type === "video" && m.url) ||
      data.media.find((m) => m.type === "gif" && m.url) ||
      data.media.find((m) => (m.type === "photo" || m.type === "image") && m.url) ||
      data.media[0];

    if (!mediaItem || !mediaItem.url) {
      const error = new Error("API_ERR_303: Original media URL missing from the extracted Pinterest object.");
      error.code = "API_ERR_303";
      throw error;
    }

    let mediaUrl = mediaItem.url;
    let ext = "jpg";

    if (mediaItem.type === "video") {
      ext = "mp4";
      if (mediaUrl.includes("/hls/") && mediaUrl.endsWith(".m3u8")) {
        mediaUrl = mediaUrl.replace(/\/(?:iht\/)?hls\/(?:v\d+\/)?/, "/720p/").replace(".m3u8", ".mp4");
      }
    } else if (mediaItem.type === "gif" || mediaUrl.split("?")[0].toLowerCase().endsWith(".gif")) {
      ext = "gif";
    } else {
      ext = detectExtensionFromUrl(mediaUrl, "jpg");
    }

    const cleanTitle = (data.title || "").trim() || (data.description || "").trim() || (data.author ? `Pin by ${data.author}` : "Pinterest Media");

    return {
      url: mediaUrl,
      title: cleanTitle,
      ext,
      mediaType: mediaItem.type || "photo"
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
      title: (mediaInfo.title || "Video Content").trim(),
      ext: "mp4",
      mediaType: "video"
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
    version: "3.1.0",
    author: "Priyanshi Kaur",
    countDown: 2,
    role: 0,
    description: {
      en: "Automatically download videos, photos, and GIFs per thread with history and user blacklisting."
    },
    category: "MEDIA",
    guide: {
      en: "{prefix}autolink on/off\n{prefix}autolink -b @mention/uid/reply\n{prefix}autolink -u @mention/uid/reply\n{prefix}autolink -bl\n{prefix}autolink -h [clear]"
    }
  },
  onStart: async function ({ api, args, event, role }) {
    const threadID = String(event.threadID);
    const subCmd = (args[0] || "").toLowerCase();
    const isBotAdmin = typeof role === "number" ? role >= 2 : (global.GoatBot?.config?.adminBot || []).includes(String(event.senderID));

    if (subCmd === "on") {
      updateThreadData(threadID, (t) => {
        t.enabled = true;
      });
      return api.sendMessage("✅ Auto-download is now ON for this thread.", threadID, event.messageID);
    }

    if (subCmd === "off") {
      updateThreadData(threadID, (t) => {
        t.enabled = false;
      });
      return api.sendMessage("❌ Auto-download is now OFF for this thread.", threadID, event.messageID);
    }

    if (subCmd === "-b" || subCmd === "ban" || subCmd === "block") {
      if (!isBotAdmin) {
        return api.sendMessage("⛔ Only bot admins can blacklist users from autolink.", threadID, event.messageID);
      }
      const targetUID = extractTargetUID(event, args);
      if (!targetUID) {
        return api.sendMessage("⚠️ Please mention a user, provide a UID, or reply to a message.", threadID, event.messageID);
      }
      const threadData = getThreadData(threadID);
      if (threadData.blacklist.includes(targetUID)) {
        return api.sendMessage(`ℹ️ User (${targetUID}) is already blacklisted in this thread.`, threadID, event.messageID);
      }
      updateThreadData(threadID, (t) => {
        t.blacklist.push(targetUID);
      });
      const mentionName = event.mentions?.[targetUID] || targetUID;
      return api.sendMessage(`🚫 Blocked ${mentionName} (${targetUID}) from autolink in this thread.`, threadID, event.messageID);
    }

    if (subCmd === "-u" || subCmd === "unban" || subCmd === "unblock") {
      if (!isBotAdmin) {
        return api.sendMessage("⛔ Only bot admins can unblacklist users from autolink.", threadID, event.messageID);
      }
      const targetUID = extractTargetUID(event, args);
      if (!targetUID) {
        return api.sendMessage("⚠️ Please mention a user, provide a UID, or reply to a message.", threadID, event.messageID);
      }
      const threadData = getThreadData(threadID);
      if (!threadData.blacklist.includes(targetUID)) {
        return api.sendMessage(`ℹ️ User (${targetUID}) is not in this thread's blacklist.`, threadID, event.messageID);
      }
      updateThreadData(threadID, (t) => {
        t.blacklist = t.blacklist.filter((id) => id !== targetUID);
      });
      const mentionName = event.mentions?.[targetUID] || targetUID;
      return api.sendMessage(`✅ Unblocked ${mentionName} (${targetUID}) from autolink in this thread.`, threadID, event.messageID);
    }

    if (subCmd === "-bl" || subCmd === "blacklist") {
      const threadData = getThreadData(threadID);
      if (!threadData.blacklist.length) {
        return api.sendMessage("📋 No users are blacklisted from autolink in this thread.", threadID, event.messageID);
      }
      const list = threadData.blacklist.map((uid, idx) => `${idx + 1}. ${uid}`).join("\n");
      return api.sendMessage(`🚫 Autolink Blacklist (This Thread):\n\n${list}`, threadID, event.messageID);
    }

    if (subCmd === "-h" || subCmd === "history") {
      if (args[1] && args[1].toLowerCase() === "clear") {
        if (!isBotAdmin) {
          return api.sendMessage("⛔ Only bot admins can clear thread autolink history.", threadID, event.messageID);
        }
        updateThreadData(threadID, (t) => {
          t.history = [];
        });
        return api.sendMessage("🗑️ Cleared autolink history for this thread.", threadID, event.messageID);
      }
      const threadData = getThreadData(threadID);
      if (!threadData.history.length) {
        return api.sendMessage("📜 No autolink download history recorded in this thread yet.", threadID, event.messageID);
      }
      const recent = threadData.history.slice(-15).reverse();
      const formatted = recent
        .map((item, idx) => {
          const dateStr = new Date(item.timestamp).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
          return `${idx + 1}. 📌 ${item.title}\n   🌐 ${item.platform} | 👤 ${item.senderID}\n   🔗 ${item.url}\n   🕒 ${dateStr}`;
        })
        .join("\n\n");
      return api.sendMessage(`📜 Thread Autolink History (Last ${recent.length}):\n\n${formatted}`, threadID, event.messageID);
    }

    const threadData = getThreadData(threadID);
    return api.sendMessage(
      `⚙️ Thread Autolink Status: ${threadData.enabled ? "ON ✅" : "OFF ❌"}\n🚫 Blacklisted Users: ${threadData.blacklist.length}\n📜 History Entries: ${threadData.history.length}`,
      threadID,
      event.messageID
    );
  },
  onChat: async function ({ api, event }) {
    if (!event.body || !event.threadID || !event.senderID) return;

    const threadID = String(event.threadID);
    const senderID = String(event.senderID);
    const threadData = getThreadData(threadID);

    if (!threadData.enabled) return;
    if (threadData.blacklist.includes(senderID)) return;

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
      const resp = await axios.get(mediaData.url, {
        responseType: "arraybuffer",
        headers: { "User-Agent": "Mozilla/5.0" }
      });

      const finalExt = mediaData.ext || "mp4";
      const filePath = path.join(CACHE_DIR, `media_${Date.now()}.${finalExt}`);
      fs.writeFileSync(filePath, Buffer.from(resp.data));

      const fileSize = (fs.statSync(filePath).size / (1024 * 1024)).toFixed(2);
      const platform = new URL(targetUrl).hostname;

      updateThreadData(threadID, (t) => {
        t.history.push({
          senderID,
          url: targetUrl,
          title: mediaData.title,
          platform,
          fileSize: `${fileSize} MB`,
          timestamp: Date.now()
        });
        if (t.history.length > 100) {
          t.history = t.history.slice(-100);
        }
      });

      api.setMessageReaction("✅", event.messageID, () => {}, true);
      api.sendMessage(
        {
          body: `🎬 Media Downloaded Successfully!\n\n📌 Title: ${mediaData.title}\n🌐 Platform: ${platform}\n⏱️ API Response Time: ${responseTime}ms\n💾 File Size: ${fileSize} MB`,
          attachment: fs.createReadStream(filePath)
        },
        threadID,
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
      api.sendMessage(`🚫 Download failed.\n💬 Error [${errorCode}]: ${errorMessage}`, threadID, event.messageID);
    }
  }
};
