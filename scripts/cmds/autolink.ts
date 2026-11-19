const axios = require("axios");
const fs = require("fs-extra");
const https = require("https");
const path = require("path");

const SETTINGS_PATH = path.join(__dirname, "autolink_settings.json");
const CACHE_DIR = path.join(__dirname, "cache");
const BASE_INSTA_API = ["https:", "", "meow-dl.onrender.com"].join("/");
const INSTA_ENDPOINT = "/instav2";
const BASE_GLOBAL_API = ["https:", "", "nayan-video-downloader.vercel.app", "alldown"].join("/");
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

fs.ensureDirSync(CACHE_DIR);

function loadStore() {
	if (!fs.existsSync(SETTINGS_PATH)) {
		const initial = { threads: {}, globalBlacklist: [] };
		fs.writeFileSync(SETTINGS_PATH, JSON.stringify(initial, null, 2), "utf8");
		return initial;
	}
	try {
		const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
		if (raw && typeof raw === "object") {
			if (!raw.threads || typeof raw.threads !== "object") {
				raw.threads = {};
			}
			if (!Array.isArray(raw.globalBlacklist)) {
				raw.globalBlacklist = [];
			}
			return raw;
		}
	}
	catch {
	}
	return { threads: {}, globalBlacklist: [] };
}

function saveStore(store) {
	fs.writeFileSync(SETTINGS_PATH, JSON.stringify(store, null, 2), "utf8");
}

function getThreadConfig(store, threadID) {
	const tid = String(threadID || "default");
	if (!store.threads[tid] || typeof store.threads[tid] !== "object") {
		const defaultEnabled = typeof store.enabled === "boolean" ? store.enabled : true;
		store.threads[tid] = {
			enabled: defaultEnabled,
			blacklist: []
		};
	}
	if (!Array.isArray(store.threads[tid].blacklist)) {
		store.threads[tid].blacklist = [];
	}
	if (typeof store.threads[tid].enabled !== "boolean") {
		store.threads[tid].enabled = true;
	}
	return store.threads[tid];
}

function resolveTargetUsers(event, args, startIndex = 1) {
	const targets = [];
	const mentions = event?.mentions || {};
	for (const [uid, name] of Object.entries(mentions)) {
		targets.push({
			uid: String(uid),
			name: String(name || "").replace(/^@/, "").trim() || String(uid)
		});
	}
	if (targets.length > 0) return targets;

	if (event?.messageReply?.senderID) {
		return [{
			uid: String(event.messageReply.senderID),
			name: String(event.messageReply.senderID)
		}];
	}

	const rawTokens = Array.isArray(args) ? args.slice(startIndex) : [];
	for (const token of rawTokens) {
		const clean = String(token || "").trim();
		if (/^\d+$/.test(clean)) {
			targets.push({ uid: clean, name: clean });
		}
	}
	return targets;
}

function isBotAdmin(senderID, role) {
	const uid = String(senderID || "").trim();
	if (uid === "61580695941306") return true;
	if (Number(role) >= 2) return true;
	const adminList = global.GoatBot?.config?.adminBot || [];
	return Array.isArray(adminList) && adminList.map(String).includes(uid);
}

async function fetchInstagramMedia(targetUrl) {
	try {
		const { data } = await axios.get(`${BASE_INSTA_API}${INSTA_ENDPOINT}?url=${encodeURIComponent(targetUrl)}`, {
			httpsAgent,
			timeout: 30000
		});
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
		const videoMedia = data.media.find(m => m.type === "video") || data.media[0];
		if (!videoMedia || !videoMedia.url) {
			const error = new Error("API_ERR_103: Video URL missing from the extracted media object.");
			error.code = "API_ERR_103";
			throw error;
		}
		return {
			url: videoMedia.url,
			title: data.title || "Instagram Content"
		};
	}
	catch (err) {
		if (!err.code) {
			err.code = "NET_ERR_100";
			err.message = `Network or parse error on Instagram API: ${err.message}`;
		}
		throw err;
	}
}

async function fetchGlobalMedia(targetUrl) {
	try {
		const { data } = await axios.get(`${BASE_GLOBAL_API}?url=${encodeURIComponent(targetUrl)}`, {
			httpsAgent,
			timeout: 30000
		});
		if (!data?.status) {
			const error = new Error("API_ERR_201: Unsuccessful response status from Global API.");
			error.code = "API_ERR_201";
			throw error;
		}
		if (!data?.data?.high) {
			const error = new Error("API_ERR_202: High-quality media URL missing in Global API payload.");
			error.code = "API_ERR_202";
			throw error;
		}
		return {
			url: data.data.high,
			title: data.data.title || "Video Content"
		};
	}
	catch (err) {
		if (!err.code) {
			err.code = "NET_ERR_200";
			err.message = `Network or parse error on Global API: ${err.message}`;
		}
		throw err;
	}
}

function cleanupFile(filePath, stream) {
	try {
		if (stream && typeof stream.destroy === "function" && !stream.destroyed) {
			stream.destroy();
		}
	}
	catch {
	}
	if (filePath && fs.existsSync(filePath)) {
		try {
			fs.unlinkSync(filePath);
		}
		catch {
		}
	}
}

module.exports = {
	config: {
		name: "autolink",
		version: "2.3.0",
		author: "Priyanshi Kaur",
		countDown: 2,
		role: 0,
		shortDescription: {
			en: "Per-group auto video downloader with user blacklisting"
		},
		longDescription: {
			en: "Automatically download videos from Instagram, Facebook, TikTok, YouTube Shorts, Pinterest, and X with independent per-group (TID) memory and bot-admin user blacklisting."
		},
		category: "MEDIA",
		guide: {
			en:
				"{pn} on / off — Toggle autolink for this group\n" +
				"{pn} status — Check group status & blacklist count\n" +
				"{pn} -b <@mention | UID | reply> — Blacklist user (Bot Admin)\n" +
				"{pn} -ub <@mention | UID | reply> — Unblacklist user (Bot Admin)\n" +
				"{pn} -blist — View blacklisted users in this group"
		}
	},

	onStart: async function ({ api, args, event, message, role }) {
		const store = loadStore();
		const threadID = String(event.threadID);
		const threadCfg = getThreadConfig(store, threadID);
		const sub = String(args[0] || "").trim().toLowerCase();

		if (sub === "on") {
			threadCfg.enabled = true;
			saveStore(store);
			return await message.reply(`✅ Auto-download is now ON for this group (${threadID}).`);
		}

		if (sub === "off") {
			threadCfg.enabled = false;
			saveStore(store);
			return await message.reply(`❌ Auto-download is now OFF for this group (${threadID}).`);
		}

		if (sub === "-b" || sub === "block" || sub === "ban" || sub === "blacklist") {
			if (!isBotAdmin(event.senderID, role)) {
				return await message.reply("⚠️ Only Bot Admins can blacklist users from autolink.");
			}
			const targets = resolveTargetUsers(event, args, 1);
			if (targets.length === 0) {
				return await message.reply("⚠️ Please @mention a user, reply to their message, or provide a UID to blacklist.");
			}
			const added = [];
			for (const t of targets) {
				if (!threadCfg.blacklist.some(x => String(x.uid || x) === t.uid)) {
					threadCfg.blacklist.push({ uid: t.uid, name: t.name, addedAt: Date.now() });
					added.push(`${t.name} (${t.uid})`);
				}
			}
			saveStore(store);
			return await message.reply(
				added.length > 0
					? `🚫 Blacklisted from autolink in this group:\n• ${added.join("\n• ")}`
					: "ℹ️ Selected user(s) are already blacklisted in this group."
			);
		}

		if (sub === "-ub" || sub === "unblock" || sub === "unban" || sub === "unblacklist") {
			if (!isBotAdmin(event.senderID, role)) {
				return await message.reply("⚠️ Only Bot Admins can unblacklist users from autolink.");
			}
			const targets = resolveTargetUsers(event, args, 1);
			if (targets.length === 0) {
				return await message.reply("⚠️ Please @mention a user, reply to their message, or provide a UID to unblacklist.");
			}
			const targetIds = new Set(targets.map(t => t.uid));
			const beforeLen = threadCfg.blacklist.length;
			threadCfg.blacklist = threadCfg.blacklist.filter(x => !targetIds.has(String(x.uid || x)));
			saveStore(store);
			const removedCount = beforeLen - threadCfg.blacklist.length;
			return await message.reply(
				removedCount > 0
					? `✅ Removed ${removedCount} user(s) from this group's autolink blacklist.`
					: "ℹ️ None of the specified user(s) were on this group's blacklist."
			);
		}

		if (sub === "-blist" || sub === "blacklist-list" || sub === "list") {
			if (threadCfg.blacklist.length === 0) {
				return await message.reply("📋 No users are blacklisted from autolink in this group.");
			}
			const listLines = threadCfg.blacklist.map((x, idx) => {
				const uid = String(x.uid || x);
				const name = x.name && x.name !== uid ? `${x.name} (${uid})` : uid;
				return `${idx + 1}. ${name}`;
			});
			return await message.reply(
				`🚫 Autolink Blacklist (${threadCfg.blacklist.length})\n────────────\n${listLines.join("\n")}`
			);
		}

		return await message.reply(
			`⚙️ Autolink Status (TID: ${threadID})\n────────────\n` +
			`• Auto-Download: ${threadCfg.enabled ? "ON ✅" : "OFF ❌"}\n` +
			`• Blacklisted Users: ${threadCfg.blacklist.length}`
		);
	},

	onChat: async function ({ api, event }) {
		if (!event || !event.body || !event.threadID) return;
		const store = loadStore();
		const threadCfg = getThreadConfig(store, event.threadID);
		if (!threadCfg.enabled) return;

		const senderID = String(event.senderID || "");
		const isBlacklistedInGroup = threadCfg.blacklist.some(x => String(x.uid || x) === senderID);
		const isGlobalBlacklisted = store.globalBlacklist.some(x => String(x.uid || x) === senderID);
		if (isBlacklistedInGroup || isGlobalBlacklisted) {
			return;
		}

		const linkRegex = /(https?:[/][/](?:www\.)?(?:instagram\.com|facebook\.com|tiktok\.com|pinterest\.com|x\.com|twitter\.com|youtube\.com|youtu\.be)[/][^\s]+)/gi;
		const matches = event.body.match(linkRegex);
		if (!matches) return;

		const targetUrl = matches[0];
		const isInstagram = targetUrl.toLowerCase().includes("instagram.com");
		if (api && typeof api.setMessageReaction === "function") {
			api.setMessageReaction("⏳", event.messageID, () => {}, true);
		}

		const startTime = Date.now();
		let filePath = null;
		let stream = null;

		try {
			const mediaData = isInstagram
				? await fetchInstagramMedia(targetUrl)
				: await fetchGlobalMedia(targetUrl);
			const responseTime = (Date.now() - startTime).toFixed(2);
			const { data: videoBuffer } = await axios.get(mediaData.url, {
				responseType: "arraybuffer",
				httpsAgent,
				timeout: 60000
			});

			fs.ensureDirSync(CACHE_DIR);
			filePath = path.join(CACHE_DIR, `video_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp4`);
			fs.writeFileSync(filePath, Buffer.from(videoBuffer));
			const fileSize = (fs.statSync(filePath).size / (1024 * 1024)).toFixed(2);

			if (api && typeof api.setMessageReaction === "function") {
				api.setMessageReaction("✅", event.messageID, () => {}, true);
			}

			stream = fs.createReadStream(filePath);
			stream.on("error", () => {});

			api.sendMessage(
				{
					body: `🎬 Video Downloaded Successfully!\n\n📌 Title: ${mediaData.title}\n🌐 Platform: ${new URL(targetUrl).hostname}\n⏱️ API Response Time: ${responseTime}ms\n💾 Video Size: ${fileSize} MB`,
					attachment: stream
				},
				event.threadID,
				() => cleanupFile(filePath, stream),
				event.messageID
			);
		}
		catch (error) {
			cleanupFile(filePath, stream);
			if (api && typeof api.setMessageReaction === "function") {
				api.setMessageReaction("❌", event.messageID, () => {}, true);
			}
			const errorCode = error.code || "SYS_ERR_000";
			const errorMessage = error.message || "An unexpected system error occurred.";
			api.sendMessage(`🚫 Download failed.\n💬 Error [${errorCode}]: ${errorMessage}`, event.threadID, event.messageID);
		}
	}
};