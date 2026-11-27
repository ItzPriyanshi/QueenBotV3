const fs = require("fs-extra");
const path = require("path");
const zlib = require("zlib");

const MAX_THREAD_BYTES = 1024 * 1024;
const PRUNE_RATIO = 0.2;
const MAX_CACHE_GROUPS = 30;
const MEMORY_DIR = path.join(process.cwd(), "scripts", "cmds", "group_memory");

const memoryCache = new Map();

const STOP_WORDS = new Set([
	"the", "and", "for", "that", "this", "with", "you", "your", "are", "was", "were",
	"have", "has", "had", "not", "but", "what", "when", "where", "who", "why", "how",
	"can", "will", "just", "like", "from", "they", "them", "their", "about", "into",
	"out", "all", "get", "got", "one", "two", "yes", "nah", "yeah", "okay", "bro",
	"sis", "lol", "lmao", "hai", "kya", "nhi", "nahi", "haan", "achha", "theek"
]);

function ensureDir() {
	try {
		fs.ensureDirSync(MEMORY_DIR);
	}
	catch {
	}
}

function memFilePath(threadID) {
	return path.join(MEMORY_DIR, `${String(threadID).replace(/[^a-zA-Z0-9_-]/g, "_")}.qmem`);
}

function hasZstdMagic(buf) {
	return Buffer.isBuffer(buf) && buf.length >= 4 && buf[0] === 0x28 && buf[1] === 0xb5 && buf[2] === 0x2f && buf[3] === 0xfd;
}

function hasGzipMagic(buf) {
	return Buffer.isBuffer(buf) && buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

function compressZstd(buf) {
	if (typeof globalThis.Bun !== "undefined" && typeof globalThis.Bun.zstdCompressSync === "function") {
		return Buffer.from(globalThis.Bun.zstdCompressSync(buf));
	}
	if (typeof zlib.zstdCompressSync === "function") {
		return Buffer.from(zlib.zstdCompressSync(buf));
	}
	return zlib.gzipSync(buf, { level: 9 });
}

function decompressZstd(buf) {
	if (!buf || !buf.length) return null;
	if (hasZstdMagic(buf)) {
		if (typeof globalThis.Bun !== "undefined" && typeof globalThis.Bun.zstdDecompressSync === "function") {
			return Buffer.from(globalThis.Bun.zstdDecompressSync(buf));
		}
		if (typeof zlib.zstdDecompressSync === "function") {
			return Buffer.from(zlib.zstdDecompressSync(buf));
		}
	}
	if (hasGzipMagic(buf)) {
		return zlib.gunzipSync(buf);
	}
	try {
		if (typeof globalThis.Bun !== "undefined" && typeof globalThis.Bun.zstdDecompressSync === "function") {
			return Buffer.from(globalThis.Bun.zstdDecompressSync(buf));
		}
	}
	catch {
	}
	try {
		return zlib.gunzipSync(buf);
	}
	catch {
	}
	try {
		return zlib.inflateRawSync(buf);
	}
	catch {
		return buf;
	}
}

function zstdCompressJson(data) {
	try {
		const json = JSON.stringify(data);
		return compressZstd(Buffer.from(json, "utf8"));
	}
	catch {
		return null;
	}
}

function zstdDecompressJson(buf, fallback = null) {
	try {
		const raw = decompressZstd(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
		if (!raw) return fallback;
		return JSON.parse(raw.toString("utf8")) || fallback;
	}
	catch {
		return fallback;
	}
}

function createEmptyGroupStore(threadID, gcName = "", isGroup = true) {
	return {
		tid: String(threadID || ""),
		gcName: String(gcName || ""),
		isGroup: Boolean(isGroup),
		updatedAt: Date.now(),
		members: {},
		topics: [],
		messages: []
	};
}

function normalizeStore(raw, threadID) {
	if (Array.isArray(raw)) {
		const migrated = createEmptyGroupStore(threadID, "", true);
		for (const item of raw) {
			if (!item || !item.body) continue;
			if (item.threadName) migrated.gcName = String(item.threadName).slice(0, 100);
			const uid = String(item.uid || "unknown");
			const name = String(item.name || "Member").slice(0, 60);
			migrated.messages.push({
				uid,
				name,
				body: String(item.body).slice(0, 800),
				ts: Number(item.ts || Date.now())
			});
			if (!migrated.members[uid]) {
				migrated.members[uid] = {
					uid,
					name,
					msgCount: 0,
					lastSeen: Number(item.ts || Date.now()),
					keywords: [],
					lastMessage: ""
				};
			}
			migrated.members[uid].msgCount += 1;
			migrated.members[uid].name = name || migrated.members[uid].name;
			migrated.members[uid].lastMessage = String(item.body).slice(0, 160);
		}
		return migrated;
	}
	if (!raw || typeof raw !== "object") {
		return createEmptyGroupStore(threadID);
	}
	if (!raw.tid) raw.tid = String(threadID || "");
	if (typeof raw.gcName !== "string") raw.gcName = "";
	if (!raw.members || typeof raw.members !== "object") raw.members = {};
	if (!Array.isArray(raw.topics)) raw.topics = [];
	if (!Array.isArray(raw.messages)) raw.messages = [];
	return raw;
}

function extractKeywords(text) {
	const words = String(text || "")
		.toLowerCase()
		.replace(/https?:\/\/\S+/g, " ")
		.replace(/[^a-z0-9_\u0900-\u097f\s-]/g, " ")
		.split(/\s+/)
		.filter(w => w.length >= 3 && w.length <= 24 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
	return words.slice(0, 8);
}

function setCache(tid, store) {
	if (memoryCache.has(tid)) {
		memoryCache.delete(tid);
	}
	else if (memoryCache.size >= MAX_CACHE_GROUPS) {
		const oldestKey = memoryCache.keys().next().value;
		if (oldestKey) memoryCache.delete(oldestKey);
	}
	memoryCache.set(tid, store);
}

function readGroupStore(threadID) {
	const tid = String(threadID || "");
	if (!tid) return createEmptyGroupStore("");
	if (memoryCache.has(tid)) {
		return memoryCache.get(tid);
	}
	ensureDir();
	const fp = memFilePath(tid);
	try {
		if (!fs.existsSync(fp)) {
			const fresh = createEmptyGroupStore(tid);
			setCache(tid, fresh);
			return fresh;
		}
		const buf = fs.readFileSync(fp);
		if (!buf || buf.length === 0) {
			const fresh = createEmptyGroupStore(tid);
			setCache(tid, fresh);
			return fresh;
		}
		const decoded = zstdDecompressJson(buf, null);
		const store = normalizeStore(decoded, tid);
		setCache(tid, store);
		return store;
	}
	catch {
		const fresh = createEmptyGroupStore(tid);
		setCache(tid, fresh);
		return fresh;
	}
}

function pruneStoreTo1Mb(store) {
	let jsonStr = JSON.stringify(store);
	let rawBytes = Buffer.byteLength(jsonStr, "utf8");
	let compressed = compressZstd(Buffer.from(jsonStr, "utf8"));

	let guard = 0;
	while ((rawBytes > MAX_THREAD_BYTES || compressed.length > MAX_THREAD_BYTES) && store.messages.length > 1 && guard < 20) {
		const dropCount = Math.max(1, Math.ceil(store.messages.length * PRUNE_RATIO));
		store.messages = store.messages.slice(dropCount);
		jsonStr = JSON.stringify(store);
		rawBytes = Buffer.byteLength(jsonStr, "utf8");
		compressed = compressZstd(Buffer.from(jsonStr, "utf8"));
		guard += 1;
	}

	if (compressed.length > MAX_THREAD_BYTES) {
		const memberKeys = Object.keys(store.members || {});
		if (memberKeys.length > 120) {
			const sortedKeys = memberKeys.sort((a, b) => (store.members[a]?.lastSeen || 0) - (store.members[b]?.lastSeen || 0));
			for (const k of sortedKeys.slice(0, memberKeys.length - 120)) {
				delete store.members[k];
			}
		}
		jsonStr = JSON.stringify(store);
		compressed = compressZstd(Buffer.from(jsonStr, "utf8"));
	}

	return compressed;
}

function writeGroupStore(threadID, store) {
	const tid = String(threadID || "");
	if (!tid) return 0;
	ensureDir();
	const fp = memFilePath(tid);
	try {
		const compressed = pruneStoreTo1Mb(store);
		fs.writeFileSync(fp, compressed);
		setCache(tid, store);
		return compressed.length;
	}
	catch {
		return 0;
	}
}

function passiveRecord({ threadID, uid, name, body, threadName, isGroup = true, ts }) {
	if (!threadID || !body) return;
	const cleanBody = String(body || "").trim().slice(0, 800);
	if (!cleanBody) return;

	const tid = String(threadID);
	const cleanUid = String(uid || "unknown");
	const cleanName = String(name || "").trim().slice(0, 60) || `User_${cleanUid.slice(-4)}`;
	const nowTs = Number(ts || Date.now());

	const store = readGroupStore(tid);
	store.tid = tid;
	store.isGroup = Boolean(isGroup);
	if (threadName && String(threadName).trim() && String(threadName).trim().toLowerCase() !== "chat") {
		store.gcName = String(threadName).trim().slice(0, 100);
	}
	store.updatedAt = nowTs;

	store.messages.push({
		uid: cleanUid,
		name: cleanName,
		body: cleanBody,
		ts: nowTs
	});

	if (!store.members[cleanUid]) {
		store.members[cleanUid] = {
			uid: cleanUid,
			name: cleanName,
			msgCount: 0,
			lastSeen: nowTs,
			keywords: [],
			lastMessage: ""
		};
	}
	const member = store.members[cleanUid];
	if (name && !/^user$/i.test(String(name).trim())) {
		member.name = cleanName;
	}
	member.msgCount = (member.msgCount || 0) + 1;
	member.lastSeen = nowTs;
	member.lastMessage = cleanBody.slice(0, 180);

	const msgKeywords = extractKeywords(cleanBody);
	if (msgKeywords.length > 0) {
		const mergedMemberKw = Array.from(new Set([...(member.keywords || []), ...msgKeywords])).slice(-15);
		member.keywords = mergedMemberKw;
		const mergedGroupTopics = Array.from(new Set([...(store.topics || []), ...msgKeywords])).slice(-25);
		store.topics = mergedGroupTopics;
	}

	writeGroupStore(tid, store);
}

function getGroupContext(threadID, limit = 60) {
	const store = readGroupStore(threadID);
	if (!store.messages || store.messages.length === 0) return "";
	const recent = store.messages.slice(-Math.max(1, limit));
	return recent.map(e => `${e.name} (UID:${e.uid}): ${e.body}`).join("\n");
}

function getGroupContextFormatted(threadID, limit = 40) {
	const store = readGroupStore(threadID);
	if (!store.messages || store.messages.length === 0) return "";
	const recent = store.messages.slice(-Math.max(1, limit));
	return recent.map(e => {
		const time = e.ts
			? new Date(e.ts).toLocaleString("en-US", { timeZone: "Asia/Kolkata", hour12: true, hour: "numeric", minute: "2-digit" })
			: "";
		return `[${time}] ${e.name}: ${e.body}`;
	}).join("\n");
}

function getGroupPromptContext(threadID, limit = 25) {
	const store = readGroupStore(threadID);
	const hasMessages = Array.isArray(store.messages) && store.messages.length > 0;
	const memberList = Object.values(store.members || {});
	if (!hasMessages && memberList.length === 0) return "";

	const parts = [];
	parts.push(`[GROUP MEMORY (JSON+ZSTD) • GC: "${store.gcName || "Group Chat"}" • TID: ${store.tid} • Stored Messages: ${store.messages.length}]`);

	if (memberList.length > 0) {
		const topMembers = memberList
			.sort((a: any, b: any) => (b.lastSeen || 0) - (a.lastSeen || 0))
			.slice(0, 15)
			.map((m: any) => `${m.name} (UID: ${m.uid}, msgs: ${m.msgCount}${m.keywords?.length ? `, topics: ${m.keywords.slice(0, 4).join("/")}` : ""})`)
			.join("; ");
		parts.push(`[Active Members Directory]: ${topMembers}`);
	}

	if (store.topics && store.topics.length > 0) {
		parts.push(`[Learned Group Topics]: ${store.topics.slice(-15).join(", ")}`);
	}

	if (hasMessages) {
		const recentLines = store.messages
			.slice(-Math.max(1, limit))
			.map(e => `${e.name} (${e.uid}): ${e.body}`);
		parts.push(`[Recent Passive Group Messages]:\n${recentLines.join("\n")}`);
	}

	return parts.join("\n");
}

function getMemberMemory(threadID, uidOrNameQuery) {
	const store = readGroupStore(threadID);
	const q = String(uidOrNameQuery || "").trim().toLowerCase().replace(/^@/, "");
	if (!q) return null;

	const members = Object.values(store.members || {});
	let matched: any = members.find((m: any) => String(m.uid) === q || String(m.name || "").toLowerCase() === q);
	if (!matched) {
		matched = members.find((m: any) => String(m.name || "").toLowerCase().includes(q) || q.includes(String(m.name || "").toLowerCase()));
	}
	if (!matched) return null;

	const recentMessages = store.messages
		.filter(m => String(m.uid) === String(matched.uid))
		.slice(-10);

	return {
		tid: store.tid,
		gcName: store.gcName || "this group",
		uid: matched.uid,
		name: matched.name,
		msgCount: matched.msgCount || 0,
		lastSeen: matched.lastSeen || 0,
		keywords: matched.keywords || [],
		lastMessage: matched.lastMessage || "",
		recentMessages
	};
}

function searchGroupMemory(threadID, query, limit = 25) {
	const store = readGroupStore(threadID);
	const q = String(query || "").trim().toLowerCase();
	if (!q || !store.messages.length) return [];
	return store.messages
		.filter(m =>
			String(m.body || "").toLowerCase().includes(q) ||
			String(m.name || "").toLowerCase().includes(q) ||
			String(m.uid || "") === q
		)
		.slice(-limit);
}

function getGroupMeta(threadID) {
	const store = readGroupStore(threadID);
	const fp = memFilePath(threadID);
	let fileSizeBytes = 0;
	try {
		if (fs.existsSync(fp)) fileSizeBytes = fs.statSync(fp).size;
	}
	catch {
	}
	if (!store.messages.length && !Object.keys(store.members || {}).length) {
		return null;
	}
	return {
		tid: store.tid,
		threadName: store.gcName || "",
		gcName: store.gcName || "",
		isGroup: store.isGroup,
		userCount: Object.keys(store.members || {}).length,
		msgCount: store.messages.length,
		topics: store.topics || [],
		lastTs: store.updatedAt || (store.messages[store.messages.length - 1]?.ts || 0),
		fileSizeBytes,
		maxBytes: MAX_THREAD_BYTES
	};
}

function listKnownGroups() {
	ensureDir();
	try {
		const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith(".qmem"));
		const groups = [];
		for (const file of files) {
			const fp = path.join(MEMORY_DIR, file);
			const buf = fs.readFileSync(fp);
			const decoded = zstdDecompressJson(buf, null);
			if (decoded) {
				const store = normalizeStore(decoded, file.replace(/\.qmem$/, ""));
				groups.push({
					tid: store.tid,
					gcName: store.gcName || "Unknown Group",
					msgCount: store.messages.length,
					userCount: Object.keys(store.members || {}).length,
					fileSizeBytes: buf.length,
					updatedAt: store.updatedAt || 0
				});
			}
		}
		return groups.sort((a, b) => b.updatedAt - a.updatedAt);
	}
	catch {
		return [];
	}
}

function readEntries(threadID) {
	return readGroupStore(threadID).messages || [];
}

function clearGroupMemory(threadID) {
	ensureDir();
	const tid = String(threadID || "");
	memoryCache.delete(tid);
	try {
		const fp = memFilePath(tid);
		if (fs.existsSync(fp)) fs.unlinkSync(fp);
		return true;
	}
	catch {
		return false;
	}
}

module.exports = {
	MAX_THREAD_BYTES,
	zstdCompressJson,
	zstdDecompressJson,
	passiveRecord,
	getGroupContext,
	getGroupContextFormatted,
	getGroupPromptContext,
	getMemberMemory,
	searchGroupMemory,
	getGroupMeta,
	listKnownGroups,
	clearGroupMemory,
	readEntries,
	readGroupStore,
	memFilePath
};
