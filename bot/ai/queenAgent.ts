const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const https = require("https");
const zlib = require("zlib");
let toolRegistry: any;
try {
	toolRegistry = require("./toolRegistry");
}
catch {
	toolRegistry = require("./toolRegistry.ts");
}

let groupMemory: any;
try {
	groupMemory = require("./groupMemory");
}
catch {
	try {
		groupMemory = require("./groupMemory.ts");
	}
	catch {
		groupMemory = null;
	}
}

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const DATA_DIR = path.join(process.cwd(), "scripts", "cmds");
const HISTORY_FILE = path.join(DATA_DIR, "ai_history.json");
const SCHEDULES_FILE = path.join(DATA_DIR, "ai_schedules.json");
const RESPONSE_RULES_FILE = path.join(DATA_DIR, "ai_response_rules.json");
const AI_SETTINGS_FILE = path.join(DATA_DIR, "ai_settings.json");

const activeTimers = new Map();
let savedRuntimeContext = null;

function loadAiSettings() {
	return readJsonSafe(AI_SETTINGS_FILE, {
		enabledForUsers: true,
		blockedUsers: {}
	});
}

function saveAiSettings(settings) {
	writeJsonSafe(AI_SETTINGS_FILE, settings || { enabledForUsers: true, blockedUsers: {} });
}

function isUserBlocked(uid) {
	if (!uid) return false;
	const s = String(uid);
	if (s === toolRegistry.OWNER_UID) return false;
	const settings = loadAiSettings();
	return Boolean(settings?.blockedUsers && settings.blockedUsers[s]);
}

function isAiEnabledForUser(uid, role = 0) {
	const s = String(uid || "");
	if (s === toolRegistry.OWNER_UID || Number(role) >= 1) return true;
	if (isUserBlocked(s)) return false;
	const settings = loadAiSettings();
	return settings.enabledForUsers !== false;
}

function blockUser(uid, reason = "Blocked by Admin", blockedBy = "") {
	const s = String(uid);
	if (!s || s === toolRegistry.OWNER_UID) return false;
	const settings = loadAiSettings();
	if (!settings.blockedUsers || typeof settings.blockedUsers !== "object") {
		settings.blockedUsers = {};
	}
	settings.blockedUsers[s] = {
		blockedAt: Date.now(),
		reason: String(reason || "Blocked by Admin"),
		blockedBy: String(blockedBy || "")
	};
	saveAiSettings(settings);
	return true;
}

function unblockUser(uid) {
	const s = String(uid);
	const settings = loadAiSettings();
	if (settings?.blockedUsers && settings.blockedUsers[s]) {
		delete settings.blockedUsers[s];
		saveAiSettings(settings);
		return true;
	}
	return false;
}

function setAiUsersEnabled(enabled) {
	const settings = loadAiSettings();
	settings.enabledForUsers = Boolean(enabled);
	saveAiSettings(settings);
	return settings.enabledForUsers;
}

function extractImageUrlFromContext(event, text = "") {
	if (Array.isArray(event?.attachments)) {
		for (const att of event.attachments) {
			if (att?.type === "photo" || att?.type === "image") {
				const url = att.url || att.largePreviewUrl || att.previewUrl;
				if (url) return url;
			}
		}
	}
	if (Array.isArray(event?.messageReply?.attachments)) {
		for (const att of event.messageReply.attachments) {
			if (att?.type === "photo" || att?.type === "image") {
				const url = att.url || att.largePreviewUrl || att.previewUrl;
				if (url) return url;
			}
		}
	}
	const str = String(text || "");
	const match = str.match(/https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp|gif|bmp)(?:\?[^\s"'<>]*)?/i) ||
		str.match(/https?:\/\/(?:i\.)?ibb\.co\/[^\s"'<>]+/i) ||
		str.match(/https?:\/\/(?:images\.unsplash\.com|cdn\.discordapp\.com|media\.discordapp\.net|res\.cloudinary\.com|i\.imgur\.com)\/[^\s"'<>]+/i);
	if (match) {
		return match[0];
	}
	return "";
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

function ensureJsonFile(filePath, defaultVal) {
	try {
		fs.ensureDirSync(path.dirname(filePath));
		if (!fs.existsSync(filePath)) {
			fs.writeFileSync(filePath, JSON.stringify(defaultVal, null, 2), "utf8");
		}
	}
	catch {
	}
}

function readJsonSafe(filePath, defaultVal) {
	ensureJsonFile(filePath, defaultVal);
	try {
		const raw = fs.readFileSync(filePath, "utf8");
		return JSON.parse(raw || JSON.stringify(defaultVal));
	}
	catch {
		try {
			fs.writeFileSync(filePath, JSON.stringify(defaultVal, null, 2), "utf8");
		}
		catch {
		}
		return defaultVal;
	}
}

function writeJsonSafe(filePath, data) {
	try {
		fs.ensureDirSync(path.dirname(filePath));
		fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
	}
	catch {
	}
}

const MAX_THREAD_HISTORY_BYTES = 1024 * 1024;

function compressTurns(turnsArray) {
	if (!Array.isArray(turnsArray) || turnsArray.length === 0) return "";
	try {
		if (groupMemory && typeof groupMemory.zstdCompressJson === "function") {
			const zstdBuf = groupMemory.zstdCompressJson(turnsArray);
			if (zstdBuf) return zstdBuf.toString("base64");
		}
		const json = JSON.stringify(turnsArray);
		const compressed = zlib.deflateRawSync(Buffer.from(json, "utf8"), { level: 9 });
		return compressed.toString("base64");
	}
	catch {
		return "";
	}
}

function decompressTurns(base64Str) {
	if (!base64Str || typeof base64Str !== "string") return [];
	try {
		const buf = Buffer.from(base64Str, "base64");
		if (groupMemory && typeof groupMemory.zstdDecompressJson === "function") {
			const parsed = groupMemory.zstdDecompressJson(buf, null);
			if (Array.isArray(parsed)) return parsed;
		}
		const decompressed = zlib.inflateRawSync(buf);
		return JSON.parse(decompressed.toString("utf8")) || [];
	}
	catch {
		return [];
	}
}

function loadHistoryStore() {
	const store = readJsonSafe(HISTORY_FILE, { users: {}, threads: {}, aiMessages: {}, threadSettings: {} });
	if (!store.users || typeof store.users !== "object") store.users = {};
	if (!store.threads || typeof store.threads !== "object") store.threads = {};
	if (!store.aiMessages || typeof store.aiMessages !== "object") store.aiMessages = {};
	if (!store.threadSettings || typeof store.threadSettings !== "object") store.threadSettings = {};
	return store;
}

function recordAiMessageId(messageID, authorID, threadID) {
	if (!messageID) return;
	const store = loadHistoryStore();
	store.aiMessages[String(messageID)] = {
		author: String(authorID || ""),
		threadID: String(threadID || ""),
		timestamp: Date.now()
	};
	const keys = Object.keys(store.aiMessages);
	if (keys.length > 400) {
		const sorted = keys.sort((a, b) => (store.aiMessages[a]?.timestamp || 0) - (store.aiMessages[b]?.timestamp || 0));
		for (const k of sorted.slice(0, keys.length - 400)) {
			delete store.aiMessages[k];
		}
	}
	writeJsonSafe(HISTORY_FILE, store);
}

function getAiMessageMeta(messageID) {
	if (!messageID) return null;
	const store = loadHistoryStore();
	return store.aiMessages[String(messageID)] || null;
}

function getUserModelPreference(uid) {
	const store = loadHistoryStore();
	return store.users[String(uid)]?.model || "gemini-auto";
}

function setUserModelPreference(uid, model) {
	const store = loadHistoryStore();
	const key = String(uid);
	if (!store.users[key] || typeof store.users[key] !== "object" || Array.isArray(store.users[key])) {
		store.users[key] = { turns: [], model: "gemini-auto" };
	}
	store.users[key].model = String(model || "gemini-auto");
	writeJsonSafe(HISTORY_FILE, store);
}

function appendChatHistoryTurn({ threadID, uid, name = "Member", gcName = "", userPrompt, assistantReply, isGroup = false }) {
	const store = loadHistoryStore();
	const userKey = String(uid || "unknown");
	if (!store.users[userKey] || typeof store.users[userKey] !== "object") {
		store.users[userKey] = { turns: [], model: "gemini-auto" };
	}
	if (!Array.isArray(store.users[userKey].turns)) {
		store.users[userKey].turns = [];
	}
	store.users[userKey].turns.push({
		user: String(userPrompt || "").slice(0, 1000),
		assistant: String(assistantReply || "").slice(0, 1200),
		ts: Date.now()
	});
	store.users[userKey].turns = store.users[userKey].turns.slice(-8);

	if (threadID) {
		const threadKey = String(threadID);
		if (!store.threads[threadKey] || typeof store.threads[threadKey] !== "object") {
			store.threads[threadKey] = {
				tid: threadKey,
				gcName: String(gcName || ""),
				activeTurns: [],
				compressedHistory: "",
				updatedAt: Date.now()
			};
		}
		const threadObj = store.threads[threadKey];
		threadObj.tid = threadKey;
		if (gcName && String(gcName).trim()) {
			threadObj.gcName = String(gcName).trim().slice(0, 100);
		}
		if (!Array.isArray(threadObj.activeTurns)) {
			threadObj.activeTurns = [];
		}
		threadObj.activeTurns.push({
			uid: String(uid || ""),
			senderID: String(uid || ""),
			name: String(name || "Member").slice(0, 50),
			tid: threadKey,
			gcName: threadObj.gcName || "",
			user: String(userPrompt || "").slice(0, 1000),
			assistant: String(assistantReply || "").slice(0, 1200),
			ts: Date.now()
		});

		if (threadObj.activeTurns.length >= 6) {
			const existingOlder = decompressTurns(threadObj.compressedHistory);
			const toCompress = [...existingOlder, ...threadObj.activeTurns.slice(0, -3)].slice(-40);
			threadObj.compressedHistory = compressTurns(toCompress);
			threadObj.activeTurns = threadObj.activeTurns.slice(-3);
		}
		while (Buffer.byteLength(JSON.stringify(threadObj), "utf8") > MAX_THREAD_HISTORY_BYTES) {
			const existingOlder = decompressTurns(threadObj.compressedHistory);
			if (existingOlder.length > 2) {
				const trimmed = existingOlder.slice(Math.ceil(existingOlder.length * 0.25));
				threadObj.compressedHistory = compressTurns(trimmed);
			}
			else if (threadObj.activeTurns.length > 1) {
				threadObj.activeTurns.shift();
			}
			else {
				break;
			}
		}
		threadObj.updatedAt = Date.now();

		if (isGroup && groupMemory && assistantReply) {
			try {
				groupMemory.passiveRecord({
					threadID: threadKey,
					uid: "queenbot",
					name: "Queen Bot",
					body: String(assistantReply).slice(0, 350),
					threadName: gcName || threadObj.gcName || "",
					isGroup: true,
					ts: Date.now()
				});
			}
			catch {
			}
		}
	}

	writeJsonSafe(HISTORY_FILE, store);
}

function appendUserHistoryTurn(uid, userPrompt, assistantReply) {
	appendChatHistoryTurn({ threadID: null, uid, name: "User", userPrompt, assistantReply, isGroup: false });
}

function getRecentHistoryContext(options, maxTokens = 1100) {
	const { threadID, uid, isGroup = false } = typeof options === "object" && options !== null
		? options
		: { threadID: null, uid: String(options || ""), isGroup: false };

	const effectiveMax = typeof maxTokens === "number" ? maxTokens : 1100;
	const store = loadHistoryStore();
	const blocks = [];

	if (threadID && groupMemory && typeof groupMemory.getGroupPromptContext === "function") {
		const passiveCtx = groupMemory.getGroupPromptContext(threadID, 25);
		if (passiveCtx) {
			blocks.push(passiveCtx);
		}
	}

	if (isGroup && threadID) {
		const threadKey = String(threadID);
		const threadObj = store.threads[threadKey];
		if (threadObj) {
			const older = decompressTurns(threadObj.compressedHistory);
			const active = Array.isArray(threadObj.activeTurns) ? threadObj.activeTurns : [];
			const allTurns = [...older, ...active].slice(-6);
			if (allTurns.length > 0) {
				const formatted = allTurns
					.map(t => `${t.name || "Member"}: ${t.user}\nQueen Bot: ${t.assistant}`)
					.join("\n\n");
				blocks.push(`[Recent AI Conversation Turns]:\n${formatted}`);
			}
		}
	}
	else {
		const turns = store.users[String(uid)]?.turns;
		if (Array.isArray(turns) && turns.length > 0) {
			const formatted = turns
				.slice(-5)
				.map(t => `User: ${t.user}\nQueen Bot: ${t.assistant}`)
				.join("\n\n");
			blocks.push(`[Recent AI Conversation Turns]:\n${formatted}`);
		}
	}

	if (blocks.length === 0) return "";
	return toolRegistry.truncateToTokenBudget(blocks.join("\n\n"), effectiveMax);
}

function clearLocalHistory(uid, threadID) {
	const store = loadHistoryStore();
	const uKey = String(uid);
	if (store.users[uKey]) {
		store.users[uKey].turns = [];
	}
	if (threadID) {
		const tKey = String(threadID);
		if (store.threads[tKey]) {
			store.threads[tKey].activeTurns = [];
			store.threads[tKey].compressedHistory = "";
		}
	}
	writeJsonSafe(HISTORY_FILE, store);
}

function sanitizeAndFormatOutput(rawText) {
	if (!rawText || typeof rawText !== "string") return "";
	const vault = toolRegistry.loadEncryptedTrainData();
	let text = rawText
		.replace(/<QUEEN_ACTION>[\s\S]*?<\/QUEEN_ACTION>/gi, "")
		.replace(/\r\n/g, "\n")
		.replace(/^#{1,6}\s+(.+)$/gm, "▸ $1")
		.replace(/^\s*\*\s+\*\*([^*:]+):?\*\*\s*:?\s*/gm, "▸ $1: ")
		.replace(/^\s*\*\s+/gm, "• ")
		.replace(/\*\*([^*\n]+)\*\*/g, "$1")
		.replace(/__([^_\n]+)__/g, "$1")
		.replace(/━{14,}/g, "────────────")
		.replace(/─{14,}/g, "────────────")
		.trim();

	const rules = Array.isArray(vault.outputSanitizerRules) ? vault.outputSanitizerRules : [];
	for (const rule of rules) {
		if (rule?.pattern && typeof rule.replacement === "string") {
			try {
				text = text.replace(new RegExp(rule.pattern, "gi"), rule.replacement);
			}
			catch {
			}
		}
	}
	return text.trim();
}

function checkJailbreakAttempt(prompt, userIdentity) {
	const text = String(prompt || "").trim();
	if (!text) return null;
	const vault = toolRegistry.loadEncryptedTrainData();
	const patterns = Array.isArray(vault.jailbreakGuardPatterns) ? vault.jailbreakGuardPatterns : [];

	for (const pat of patterns) {
		try {
			const rgx = new RegExp(pat, "i");
			if (rgx.test(text)) {
				const baseRefusal = vault.jailbreakRefusalTemplate ||
					"👑 Queen Bot • Security Lock\n────────────\nI am Queen Bot, the autonomous core intelligence of QueenBotV3 created exclusively by Priyanshi Kaur.";
				if (userIdentity?.isOwner) {
					return `${baseRefusal}\n\n👑 Note for My Queen (${userIdentity.name}): Your Neural Vault is intact and locked against external extraction.`;
				}
				return baseRefusal;
			}
		}
		catch {
		}
	}
	return null;
}

function buildDynamicSystemPrompt(userIdentity) {
	const vault = toolRegistry.loadEncryptedTrainData();
	const maxSysTokens = vault.tokenizerConfig?.maxSystemTokens || 2200;
	const maxToolTokens = vault.tokenizerConfig?.maxToolCatalogTokens || 1000;

	const directives = Array.isArray(vault.unbreakableSystemDirectives)
		? vault.unbreakableSystemDirectives
		: [];
	const temporalRules = Array.isArray(vault.smartTaskAndTemporalExecutionRules)
		? vault.smartTaskAndTemporalExecutionRules
		: [];

	const userHeader = userIdentity?.isOwner
		? `[ACTIVE USER IDENTITY]: Priyanshi Kaur (UID: ${userIdentity.uid}). SHE IS YOUR SUPREME CREATOR, QUEEN, OWNER, AND BOSS. Always address her warmly and loyally as "Queen", "My Queen", "Owner", or "Boss". She has full root authority over all commands, scripts, and FCA APIs.`
		: `[ACTIVE USER IDENTITY]: Facebook Name: "${userIdentity?.name || "Friend"}" (UID: ${userIdentity?.uid || "unknown"}, Role: ${userIdentity?.effectiveRole || 0}). Address them naturally and politely by their Facebook name ("${userIdentity?.name || "Friend"}").`;

	const toolCatalog = toolRegistry.getToolCatalogForPrompt(maxToolTokens);

	const fcaMethods = Object.keys(vault.independentFcaApiCapabilities?.allowedMethods || {}).join(", ");

	const fullSystem = [
		`[QUEENBOTV3 ENCRYPTED NEURAL CORE • AUTHOR: PRIYANSHI KAUR • PLATFORM: QUEENBOTV3 ONLY]`,
		userHeader,
		``,
		`CORE DIRECTIVES:`,
		...directives.map(d => `• ${d}`),
		`• CRITICAL OUTPUT FORMAT: Keep all responses short, simple, concise, and direct with NO extra details or unsolicited filler unless user explicitly asks.`,
		`• GROUP ZSTD ROLLING MEMORY: Every group chat message is saved passively with user name, uid, tid, and gcName in JSON+ZSTD compressed storage (max 1MB per group) even when users are not talking to AI. Use this memory to understand context, topics, and answer chat history queries.`,
		`• MEMBER & USER DETAILS PROTOCOL: You have full access to thread members and Facebook user details. Whenever a user asks 'who is <name>', 'details of <name>', or asks for a UID (mentioning or not), identify the user from the thread members list, group memory, usersData, or FCA API and output their details immediately. Never claim lack of access.`,
		`• UNIVERSAL FLEXIBLE COMMAND SYNTHESIS: For ANY bot command the user asks you to run or check (ping, uptime, boxinfo, rank, weather, balance, sing, ytb, getinfo, bin, pinterest, count, admin, help, etc.), execute it internally via run_tool or run_workflow, read its captured result, think about the user's request, and deliver your OWN smart flexible response (alongside any captured media attachments). Never refuse or just say you cannot execute commands.`,
		`• SONG REQUEST DIRECTIVE: Whenever a user asks for a song, music, or audio track, route to command 'sing' (or 'ytb'). Never use unconfigured spotify.`,
		`• CAPABILITY REFUSAL FORBIDDEN: You have full authority to execute any bot command and FCA APIs. Never refuse or claim lack of tools.`,
		`• ZERO COMMENTS IN SCRIPTS: Whenever generating, creating, or modifying bot scripts, write clean JavaScript/TypeScript with absolutely ZERO comments.`,
		`• GROUP CHAT HISTORY ACCESS: You have access to this group's passive message history stored in JSON+ZSTD memory. When asked what the group is talking about, what happened in gc, or for chat history, use the stored context—never refuse or claim you cannot access it.`,
		``,
		`TEMPORAL & SMART TASK RULES:`,
		...temporalRules.map(r => `• ${r}`),
		``,
		`AGENTIC <QUEEN_ACTION> JSON PROTOCOL:`,
		`When you need to execute a command tool, schedule a one-time delayed task, schedule a recurring task, call an FCA API, search the web, modify a command response, or read/edit/create/delete/reload a script, output a valid JSON object inside <QUEEN_ACTION>...</QUEEN_ACTION>:`,
		`1. Single immediate command: <QUEEN_ACTION>{"action":"run_tool","command":"<name>","args":[...],"modifyResponse":"<optional>"}</QUEEN_ACTION>`,
		`2. One-time delayed task ("after 1 hour", "in 10 minutes" — runs ONCE, never repeats): <QUEEN_ACTION>{"action":"schedule_once","delaySeconds":3600,"description":"...","steps":[{"command":"<name>","args":[...],"fuzzySearch":true}]}</QUEEN_ACTION>`,
		`3. Multi-step sequence (runs once): <QUEEN_ACTION>{"action":"run_workflow","steps":[{"command":"<name>","args":[],"delaySecondsBefore":0}]}</QUEEN_ACTION>`,
		`4. Recurring schedule (ONLY when user says "every X hours/minutes/days"): <QUEEN_ACTION>{"action":"schedule_workflow","intervalSeconds":86400,"runImmediately":true,"description":"...","steps":[...]}</QUEEN_ACTION>`,
		`5. Manage schedules/timers: <QUEEN_ACTION>{"action":"manage_schedules","subAction":"list|stop|pause|resume|clear","scheduleId":"..."}</QUEEN_ACTION>`,
		`6. Independent FCA API call (${fcaMethods}): <QUEEN_ACTION>{"action":"call_fca_api","method":"<methodName>","args":[...]}</QUEEN_ACTION>`,
		`7. Web/YouTube search for fuzzy queries: <QUEEN_ACTION>{"action":"web_search","query":"...","thenRunCommand":"<optional_cmd>","thenArgsPrefix":["-a"]}</QUEEN_ACTION>`,
		`8. Persistent command output modifier: <QUEEN_ACTION>{"action":"set_response_modifier","command":"<name>","mode":"ai_rewrite|replace|append|prepend|reset","instruction":"..."}</QUEEN_ACTION>`,
		`9. Script management (Owner/Admin): <QUEEN_ACTION>{"action":"read_script|modify_script|create_script|delete_script|reload_script","target":"<scriptName>","instruction":"...","code":"..."}</QUEEN_ACTION>`,
		``,
		`AVAILABLE COMMAND TOOLS:`,
		toolCatalog
	].join("\n");

	return toolRegistry.truncateToTokenBudget(fullSystem, maxSysTokens);
}

async function callMeowGeminiApi({ prompt, uid, model = "gemini-auto", system = "", image = "" }) {
	const vault = toolRegistry.loadEncryptedTrainData();
	const endpoint = vault.apiConfig?.fullEndpoint || ["https:", "", "meow-dl.onrender.com", "g"].join("/");
	const timeoutMs = vault.apiConfig?.timeoutMs || 45000;
	const maxPromptTokens = vault.tokenizerConfig?.maxInputTokens || 6000;

	const safePrompt = toolRegistry.truncateToTokenBudget(prompt, maxPromptTokens);
	const payload: any = {
		prompt: safePrompt,
		model: model || "gemini-auto",
		uid: String(uid || "queenbot_default"),
		...(system ? { system } : {})
	};
	if (image) {
		payload.image = image;
	}

	let lastErrMsg = "Failed to reach Queen AI endpoint";
	for (let attempt = 0; attempt < 2; attempt++) {
		if (attempt > 0) {
			await sleep(1100 * attempt);
		}

		try {
			const postRes = await axios.post(endpoint, payload, {
				headers: { "Content-Type": "application/json" },
				httpsAgent,
				timeout: timeoutMs
			});
			if (postRes?.data?.status === "success" && typeof postRes.data.response === "string") {
				return {
					ok: true,
					response: postRes.data.response,
					model: postRes.data.model || model,
					timings: postRes.data.timings || null
				};
			}
		}
		catch (err: any) {
			lastErrMsg = err?.response?.data?.error || err?.message || lastErrMsg;
		}

		try {
			const params = new URLSearchParams();
			params.set("prompt", safePrompt);
			params.set("model", model || "gemini-auto");
			if (uid) params.set("uid", String(uid));
			if (system) params.set("system", toolRegistry.truncateToTokenBudget(system, 900));
			if (image) params.set("image", image);

			const getUrl = `${endpoint}?${params.toString()}`;
			const getRes = await axios.get(getUrl, {
				httpsAgent,
				timeout: timeoutMs
			});
			if (getRes?.data?.status === "success" && typeof getRes.data.response === "string") {
				return {
					ok: true,
					response: getRes.data.response,
					model: getRes.data.model || model,
					timings: getRes.data.timings || null
				};
			}
			if (getRes?.data?.error) {
				lastErrMsg = getRes.data.error;
			}
		}
		catch (err: any) {
			lastErrMsg = err?.response?.data?.error || err?.message || lastErrMsg;
		}
	}

	return {
		ok: false,
		error: lastErrMsg
	};
}

function extractQueenActions(rawText) {
	const actions = [];
	const str = String(rawText || "");
	const rgx = /<QUEEN_ACTION>\s*([\s\S]*?)\s*<\/QUEEN_ACTION>/gi;
	let match;
	while ((match = rgx.exec(str)) !== null) {
		const rawJson = match[1].trim();
		try {
			const parsed = JSON.parse(rawJson);
			if (parsed && typeof parsed === "object" && parsed.action) {
				actions.push(parsed);
			}
		}
		catch {
		}
	}
	return actions;
}

function loadResponseRules() {
	const rules = readJsonSafe(RESPONSE_RULES_FILE, {});
	return rules && typeof rules === "object" ? rules : {};
}

function saveResponseRules(rules) {
	writeJsonSafe(RESPONSE_RULES_FILE, rules || {});
}

function setCommandResponseRule({ commandName, mode, instruction, template, updatedBy }) {
	const canonical = toolRegistry.resolveToolName(commandName) || String(commandName || "").trim().toLowerCase();
	if (!canonical) return null;
	const rules = loadResponseRules();
	const cleanMode = String(mode || "ai_rewrite").toLowerCase();

	if (["reset", "clear", "off", "none", "default"].includes(cleanMode)) {
		delete rules[canonical];
		saveResponseRules(rules);
		return { commandName: canonical, mode: "reset" };
	}

	rules[canonical] = {
		commandName: canonical,
		mode: cleanMode,
		instruction: String(instruction || "").trim(),
		template: String(template || instruction || "").trim(),
		updatedBy: String(updatedBy || ""),
		updatedAt: Date.now()
	};
	saveResponseRules(rules);
	return rules[canonical];
}

async function rewriteTextWithQueenAi(commandName, originalText, instruction, uid = "system_rewriter") {
	const cleanOrig = String(originalText || "").trim();
	if (!cleanOrig) return cleanOrig;
	const rewritePrompt =
		`[COMMAND OUTPUT TRANSFORMATION]\n` +
		`Command: ${commandName}\n` +
		`Instruction: ${instruction}\n` +
		`Original Output:\n${cleanOrig}\n\n` +
		`Rewrite the command output following the instruction above. Keep exact numbers, latency values, URLs, and IDs intact unless instructed otherwise. Do not use raw Markdown double asterisks (**). Output ONLY the final rewritten message.`;

	const res = await callMeowGeminiApi({
		prompt: rewritePrompt,
		uid: `rewrite_${uid}`,
		model: "gemini-flash"
	});
	if (res.ok && res.response) {
		return sanitizeAndFormatOutput(res.response);
	}
	return cleanOrig;
}

function passiveGroupMemoryRecord({ threadID, uid, name, body, threadName, isGroup = true }) {
	if (!groupMemory || !threadID || !body) return;
	try {
		groupMemory.passiveRecord({ threadID, uid, name, body, threadName, isGroup, ts: Date.now() });
	}
	catch {
	}
}

async function synthesizeToolExecutionResult({
	toolResult,
	userPrompt = "",
	honorific = "Friend",
	uid = "",
	prefix = ".",
	modifyInstruction = "",
	elapsedMs = 0,
	monitorResponseTime = false
}) {
	if (!toolResult) return "";
	if (!toolResult.ok) {
		const githubHelp = toolResult.githubSolution
			? `\n\n💡 Suggested Fix (${toolResult.githubSolution.githubRef}):\n• ${toolResult.githubSolution.fix}\n• Ref: ${toolResult.githubSolution.repo}`
			: "";
		return `⚠️ ${honorific}, "${toolResult.commandName}" hit an error: ${toolResult.error}${githubHelp}`;
	}

	let rawBody = String(toolResult.capturedText || "").trim();
	if (modifyInstruction && rawBody) {
		return await rewriteTextWithQueenAi(toolResult.commandName, rawBody, modifyInstruction, uid);
	}

	const attachmentCount = Array.isArray(toolResult.attachments) ? toolResult.attachments.length : 0;
	const telemetryNote = monitorResponseTime
		? `\n[EXECUTION TELEMETRY]: Command "${prefix}${toolResult.commandName}" completed in ${elapsedMs} ms on ${process.versions.bun ? "Bun v" + process.versions.bun : "Node " + process.version}. Include this response time clearly in your answer.`
		: "";

	const synthPrompt =
		`[TOOL EXECUTION RESULT FOR ${String(honorific).toUpperCase()}]\n` +
		(userPrompt ? `User Request: "${String(userPrompt).slice(0, 400)}"\n` : "") +
		`Command Executed: "${toolResult.commandName}"\n` +
		(attachmentCount > 0 ? `Attachments Returned: ${attachmentCount}\n` : "") +
		`Raw Command Output:\n${(rawBody || `[Media/Attachment sent cleanly by ${toolResult.commandName}]`).slice(0, 2200)}${telemetryNote}\n\n` +
		`Think about the user's request and the captured command output above, then write YOUR OWN smart, natural, flexible response as Queen Bot addressing ${honorific}. Keep all exact numbers, latencies, UIDs, URLs, titles, and metrics accurate. Keep it concise unless detailed metrics are useful. Do NOT use raw ** Markdown.`;

	const synthRes = await callMeowGeminiApi({
		prompt: synthPrompt,
		uid: `synth_${uid || "sys"}`,
		model: "gemini-flash"
	});

	if (synthRes.ok && synthRes.response) {
		return sanitizeAndFormatOutput(synthRes.response);
	}

	const fallbackParts = [];
	if (rawBody) {
		fallbackParts.push(rawBody);
	}
	else {
		fallbackParts.push(`✅ Executed ${prefix}${toolResult.commandName}, ${honorific}.`);
	}
	if (monitorResponseTime) {
		fallbackParts.push(`⚡ Response Time: ${elapsedMs} ms (${process.versions.bun ? "Bun v" + process.versions.bun : "Node " + process.version})`);
	}
	return fallbackParts.join("\n\n");
}

async function synthesizeMultiToolResults({ stepEntries, userPrompt = "", honorific = "Friend", uid = "" }) {
	const summaryBlocks = [];
	const allAttachments = [];
	const allReplyEntries = [];

	for (const entry of stepEntries) {
		const res = entry.result;
		if (!res) continue;
		if (Array.isArray(res.attachments) && res.attachments.length) {
			allAttachments.push(...res.attachments);
		}
		if (Array.isArray(res.virtualReplyEntries) && res.virtualReplyEntries.length) {
			allReplyEntries.push(...res.virtualReplyEntries);
		}
		if (res.ok) {
			summaryBlocks.push(`• Command "${entry.label || res.commandName}"${entry.elapsedMs ? ` (${entry.elapsedMs}ms)` : ""}:\n${(res.capturedText || `[${res.attachments?.length || 0} attachment(s) ready]`).slice(0, 1200)}`);
		}
		else {
			summaryBlocks.push(`• Command "${entry.label || res.commandName}" FAILED: ${res.error}`);
		}
	}

	const combinedRaw = summaryBlocks.join("\n\n");
	const synthPrompt =
		`[MULTI-TOOL EXECUTION RESULTS FOR ${String(honorific).toUpperCase()}]\n` +
		(userPrompt ? `User Request: "${String(userPrompt).slice(0, 400)}"\n` : "") +
		`Results From All Executed Steps:\n${combinedRaw.slice(0, 3200)}\n\n` +
		`Synthesize ONE smart, unified, natural response as Queen Bot addressing ${honorific}. Preserve all exact metrics, numbers, links, and IDs. Keep it clear and concise.`;

	const synthRes = await callMeowGeminiApi({
		prompt: synthPrompt,
		uid: `multisynth_${uid || "sys"}`,
		model: "gemini-flash"
	});

	const finalText = synthRes.ok && synthRes.response
		? sanitizeAndFormatOutput(synthRes.response)
		: combinedRaw;

	return {
		text: finalText,
		attachments: allAttachments,
		virtualReplyEntries: allReplyEntries
	};
}

async function transformOutgoingMessage(commandName, payload, oneShotInstruction = "") {
	if (!payload) return payload;
	const canonical = toolRegistry.resolveToolName(commandName) || String(commandName || "").trim().toLowerCase();
	if (!canonical || canonical === "ai") return payload;

	const rules = loadResponseRules();
	const activeRule = rules[canonical];
	const effectiveInstruction = oneShotInstruction || activeRule?.instruction || "";
	const effectiveMode = oneShotInstruction ? "ai_rewrite" : (activeRule?.mode || "");

	if (!effectiveMode && !effectiveInstruction) {
		return payload;
	}

	const isObj = typeof payload === "object" && payload !== null;
	const origText = isObj ? String(payload.body || "") : String(payload);

	if (!origText && isObj && payload.attachment && !activeRule?.template && !effectiveInstruction) {
		return payload;
	}

	let modifiedText = origText;
	if (effectiveMode === "replace" && activeRule?.template) {
		modifiedText = activeRule.template
			.replace(/\{original\}/gi, origText)
			.replace(/\{command\}/gi, canonical);
	}
	else if (effectiveMode === "append" && (activeRule?.template || effectiveInstruction)) {
		const suffix = activeRule?.template || effectiveInstruction;
		modifiedText = origText ? `${origText}\n${suffix}` : suffix;
	}
	else if (effectiveMode === "prepend" && (activeRule?.template || effectiveInstruction)) {
		const prefixStr = activeRule?.template || effectiveInstruction;
		modifiedText = origText ? `${prefixStr}\n${origText}` : prefixStr;
	}
	else if (effectiveInstruction) {
		modifiedText = await rewriteTextWithQueenAi(canonical, origText || `[${canonical} media]`, effectiveInstruction);
	}

	if (isObj) {
		return {
			...payload,
			body: modifiedText
		};
	}
	return modifiedText;
}

function parseWordOrNumberToFloat(token) {
	const t = String(token || "").trim().toLowerCase();
	const wordMap = {
		one: 1,
		a: 1,
		an: 1,
		two: 2,
		three: 3,
		four: 4,
		five: 5,
		six: 6,
		seven: 7,
		eight: 8,
		nine: 9,
		ten: 10,
		twelve: 12,
		fifteen: 15,
		twenty: 20,
		thirty: 30,
		forty: 40,
		fifty: 50,
		sixty: 60,
		half: 0.5
	};
	if (wordMap[t] !== undefined) return wordMap[t];
	const num = parseFloat(t);
	return isNaN(num) ? 0 : num;
}

function parseTimeUnitToSeconds(valToken, unitToken) {
	const val = typeof valToken === "number" ? valToken : parseWordOrNumberToFloat(valToken);
	if (!val || val <= 0) return 0;
	const u = String(unitToken || "").trim().toLowerCase();
	if (u.startsWith("d")) return Math.round(val * 86400);
	if (u.startsWith("h") || u === "hr" || u === "hrs") return Math.round(val * 3600);
	if (u.startsWith("m") && !u.startsWith("ms")) return Math.round(val * 60);
	return Math.round(val);
}

function formatDurationHuman(ms) {
	const totalSec = Math.max(1, Math.round(ms / 1000));
	if (totalSec % 86400 === 0 && totalSec >= 86400) {
		const d = totalSec / 86400;
		return d === 1 ? "24 hours" : `${d} days`;
	}
	if (totalSec % 3600 === 0 && totalSec >= 3600) {
		const h = totalSec / 3600;
		return `${h} hour${h > 1 ? "s" : ""}`;
	}
	if (totalSec % 60 === 0 && totalSec >= 60) {
		const m = totalSec / 60;
		return `${m} minute${m > 1 ? "s" : ""}`;
	}
	return `${totalSec} second${totalSec !== 1 ? "s" : ""}`;
}

function loadSchedules() {
	const list = readJsonSafe(SCHEDULES_FILE, []);
	return Array.isArray(list) ? list : [];
}

function saveSchedules(list) {
	writeJsonSafe(SCHEDULES_FILE, Array.isArray(list) ? list : []);
}

function createSyntheticMessage(api, threadID, replyToMessageID = "") {
	const utilMsg = global.utils?.message;
	if (typeof utilMsg === "function") {
		try {
			return utilMsg(api, { threadID, messageID: replyToMessageID });
		}
		catch {
		}
	}
	return {
		send: async (form) => (api?.sendMessage ? await api.sendMessage(form, threadID) : null),
		reply: async (form) => (api?.sendMessage ? await api.sendMessage(form, threadID, undefined, replyToMessageID) : null),
		edit: async (text, msgID) => (api?.editMessage ? await api.editMessage(text, msgID || replyToMessageID) : null),
		unsend: async (msgID) => (api?.unsendMessage ? await api.unsendMessage(msgID) : null),
		reaction: async (emoji, msgID) => (api?.setMessageReaction ? api.setMessageReaction(emoji, msgID || replyToMessageID, () => {}, true) : null),
		SyntaxError: async () => null
	};
}

async function executeScheduledSteps(steps, execContext) {
	for (const step of steps || []) {
		if (!step || !step.command) continue;
		const delaySec = Number(step.delaySecondsBefore || 0);
		if (delaySec > 0) {
			await sleep(Math.min(delaySec, 3600) * 1000);
		}

		let finalArgs = Array.isArray(step.args) ? [...step.args] : [];
		if (step.fuzzySearch && finalArgs.length > 0) {
			const flagArgs = finalArgs.filter(a => String(a).startsWith("-"));
			const queryPart = finalArgs.filter(a => !String(a).startsWith("-")).join(" ");
			if (queryPart) {
				const resolved = await toolRegistry.resolveFuzzyQueryWithWeb(queryPart, "media");
				if (resolved?.resolvedQuery) {
					finalArgs = [...flagArgs, ...resolved.resolvedQuery.split(/\s+/)];
				}
			}
		}

		const repeats = Math.min(Math.max(1, Number(step.repeatCount || 1)), 5);
		for (let r = 0; r < repeats; r++) {
			if (r > 0) await sleep(1000);
			await toolRegistry.executeCommandAsTool({
				commandName: step.command,
				args: finalArgs,
				...execContext,
				captureOutput: false
			});
		}
	}
}

function startTimerForEntry(entry) {
	if (activeTimers.has(entry.id)) {
		const prev = activeTimers.get(entry.id);
		clearTimeout(prev);
		clearInterval(prev);
		activeTimers.delete(entry.id);
	}
	if (entry.paused) return;

	const runCycle = async () => {
		if (!savedRuntimeContext || !savedRuntimeContext.api) return;
		const all = loadSchedules();
		const idx = all.findIndex(s => s.id === entry.id);
		if (idx === -1 || all[idx].paused) {
			return;
		}
		const current = all[idx];
		const syntheticEvent = {
			type: "message",
			threadID: current.threadID,
			senderID: current.authorID,
			userID: current.authorID,
			messageID: "",
			body: "",
			args: [],
			mentions: {},
			attachments: [],
			isGroup: true
		};
		const syntheticMsg = createSyntheticMessage(savedRuntimeContext.api, current.threadID);

		try {
			await executeScheduledSteps(current.steps, {
				api: savedRuntimeContext.api,
				message: syntheticMsg,
				event: syntheticEvent,
				role: current.role,
				prefix: current.prefix || ".",
				usersData: savedRuntimeContext.usersData,
				threadsData: savedRuntimeContext.threadsData,
				threadModel: savedRuntimeContext.threadModel,
				userModel: savedRuntimeContext.userModel,
				dashBoardModel: savedRuntimeContext.dashBoardModel,
				globalModel: savedRuntimeContext.globalModel,
				dashBoardData: savedRuntimeContext.dashBoardData,
				globalData: savedRuntimeContext.globalData
			});
		}
		catch {
		}

		const updated = loadSchedules();
		const uIdx = updated.findIndex(s => s.id === entry.id);
		if (uIdx !== -1) {
			if (updated[uIdx].oneTime) {
				updated.splice(uIdx, 1);
				activeTimers.delete(entry.id);
			}
			else {
				updated[uIdx].lastRunAt = Date.now();
				updated[uIdx].runCount = (updated[uIdx].runCount || 0) + 1;
				if (updated[uIdx].maxRuns && updated[uIdx].runCount >= updated[uIdx].maxRuns) {
					clearInterval(activeTimers.get(entry.id));
					activeTimers.delete(entry.id);
					updated.splice(uIdx, 1);
				}
			}
			saveSchedules(updated);
		}
	};

	if (entry.oneTime) {
		const remainingMs = Math.max(1000, (entry.executeAt || (Date.now() + entry.intervalMs)) - Date.now());
		const timer = setTimeout(runCycle, remainingMs);
		if (typeof timer.unref === "function") timer.unref();
		activeTimers.set(entry.id, timer);
	}
	else {
		const timer = setInterval(runCycle, Math.max(5000, entry.intervalMs));
		if (typeof timer.unref === "function") timer.unref();
		activeTimers.set(entry.id, timer);
	}
}

function registerTaskOrSchedule({
	threadID,
	authorID,
	role = 0,
	prefix = ".",
	delayOrIntervalSeconds,
	steps,
	description,
	oneTime = false,
	maxRuns
}) {
	const all = loadSchedules();
	const prefixTag = oneTime ? "task" : "sched";
	const id = `${prefixTag}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
	const durationMs = Math.max(1000, Math.round(Number(delayOrIntervalSeconds) * 1000));

	const entry = {
		id,
		oneTime: Boolean(oneTime),
		threadID: String(threadID),
		authorID: String(authorID),
		role: Number(role) || 0,
		prefix: prefix || ".",
		intervalMs: durationMs,
		executeAt: oneTime ? Date.now() + durationMs : undefined,
		steps,
		description: String(description || ""),
		createdAt: Date.now(),
		runCount: 0,
		maxRuns: oneTime ? 1 : maxRuns
	};

	all.push(entry);
	saveSchedules(all);
	startTimerForEntry(entry);
	return entry;
}

function restoreAllSchedules() {
	const all = loadSchedules();
	const now = Date.now();
	const valid = [];
	for (const entry of all) {
		if (entry.oneTime && entry.executeAt && entry.executeAt <= now) {
			entry.executeAt = now + 2000;
		}
		valid.push(entry);
	}
	saveSchedules(valid);
	for (const entry of valid) {
		if (!entry.paused) {
			startTimerForEntry(entry);
		}
	}
}

function extractSingleClauseStep(clause) {
	const cleaned = String(clause || "").trim();
	if (!cleaned) return null;

	const timeRgx = /(?:in|after|with|wait(?:ing)?(?:\s+for)?)\s+(one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|half|\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)\s*(?:delay\s*)?/i;
	const delayMatch = cleaned.match(timeRgx) || cleaned.match(/(one|two|three|four|five|six|seven|eight|nine|ten|\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\s+delay/i);
	const delaySecondsBefore = delayMatch ? parseTimeUnitToSeconds(delayMatch[1], delayMatch[2]) : 0;

	const stripped = cleaned
		.replace(/(?:after\s+)?every\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)/gi, " ")
		.replace(timeRgx, " ")
		.replace(/(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\s+delay/gi, " ")
		.trim();

	const songFuzzyMatch = stripped.match(
		/(?:can\s+you\s+|please\s+)?(?:send(?:\s+me)?|play|download|give\s+me)\s+(?:the\s+)?(?:song|music|track|audio)\s+(.+)$/i
	);
	if (songFuzzyMatch && songFuzzyMatch[1]) {
		const cleanedQuery = toolRegistry.cleanFuzzyMediaQuery(songFuzzyMatch[1]);
		const preferredMusicTool = toolRegistry.resolveToolName("sing") || toolRegistry.resolveToolName("ytb") || "sing";
		const args = preferredMusicTool === "ytb" ? ["-a", ...cleanedQuery.split(/\s+/)] : cleanedQuery.split(/\s+/);
		return {
			command: preferredMusicTool,
			args,
			delaySecondsBefore,
			fuzzySearch: true,
			rawQuery: cleanedQuery
		};
	}

	const triggerMatch = stripped.match(
		/(?:(?:use|run|trigger|execute|call|start|launch|invoke|check|show|get|open)(?:\s*,\s*|\s+or\s+|\s+and\s+|\s+))+(?:the\s+)?([a-zA-Z0-9_$-]+)(?:\s+command|\s+cmd)?(?:\s+(?:with\s+args?|with|for|in|on)\s+(.+)|\s+(.+))?$/i
	);
	if (triggerMatch) {
		const rawCmd = triggerMatch[1].trim();
		const canonical = toolRegistry.resolveToolName(rawCmd) || rawCmd.toLowerCase();
		const rawTail = (triggerMatch[2] || triggerMatch[3] || "").trim().replace(/^(?:command|cmd)\b/i, "").trim();
		const args = rawTail ? rawTail.split(/\s+/) : [];
		return {
			command: canonical,
			args,
			delaySecondsBefore
		};
	}

	const cmdBeforeWord = stripped.match(/^([a-zA-Z0-9_$-]+)\s+(?:command|cmd)(?:\s+(.+))?$/i);
	if (cmdBeforeWord) {
		const rawCmd = cmdBeforeWord[1].trim();
		const rawTail = (cmdBeforeWord[2] || "").trim();
		const canonical = toolRegistry.resolveToolName(rawCmd) || rawCmd.toLowerCase();
		return {
			command: canonical,
			args: rawTail ? rawTail.split(/\s+/) : [],
			delaySecondsBefore
		};
	}

	return null;
}

function extractCommandStepFromChainClause(clause, inheritVerb = false) {
	const direct = extractSingleClauseStep(clause);
	if (direct) return direct;
	if (!inheritVerb) return null;
	const parts = String(clause || "").trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return null;
	const resolved = toolRegistry.resolveToolName(parts[0]);
	if (!resolved) return null;
	return {
		command: resolved,
		args: parts.slice(1),
		delaySecondsBefore: 0
	};
}

const RANDOM_HIT_SONGS = [
	"Blinding Lights The Weeknd",
	"Starboy The Weeknd",
	"Faded Alan Walker",
	"Shape of You Ed Sheeran",
	"Believer Imagine Dragons",
	"Stay The Kid LAROI Justin Bieber",
	"Levitating Dua Lipa",
	"Perfect Ed Sheeran",
	"Sunflower Post Malone",
	"Heat Waves Glass Animals",
	"Kesariya Arijit Singh",
	"Apna Bana Le Arijit Singh",
	"Night Changes One Direction",
	"Until I Found You Stephen Sanchez",
	"Attention Charlie Puth",
	"Counting Stars OneRepublic",
	"Mockingbird Eminem",
	"Dandelions Ruth B"
];

function parseNaturalTaskIntent(prompt) {
	const p = String(prompt || "").trim();
	const lower = p.toLowerCase();

	if (
		/^(?:(?:list|show|view|my|active|check|get)\s+(?:all\s+)?(?:schedules?|timers?|tasks?|cron|jobs?)|(?:schedules?|timers?|tasks?|cron|jobs?)(?:\s+(?:list|show|view|status|info|all))?)$/i.test(lower)
	) {
		return { type: "manage_schedules", subAction: "list" };
	}

	if (
		/^(?:(?:clear|stop\s+all|cancel\s+all|delete\s+all|remove\s+all)\s+(?:schedules?|timers?|tasks?|jobs?)|(?:schedules?|timers?|tasks?|jobs?)\s+(?:clear|stop\s+all|cancel\s+all|delete\s+all|remove\s+all|reset))$/i.test(lower)
	) {
		return { type: "manage_schedules", subAction: "clear" };
	}

	const stopMatch =
		p.match(/^(?:stop|cancel|delete|remove|pause|resume)\s+(?:schedule|timer|task|job)s?\s+([a-zA-Z0-9_-]+)/i) ||
		p.match(/^(?:schedule|timer|task|job)s?\s+(?:stop|cancel|delete|remove|pause|resume)\s+([a-zA-Z0-9_-]+)/i) ||
		p.match(/^(?:stop|cancel|pause|resume)\s+((?:sched|task)_[a-zA-Z0-9_-]+)/i);

	if (stopMatch) {
		const full = stopMatch[0].toLowerCase();
		const subAction = full.includes("pause") ? "pause" : full.includes("resume") ? "resume" : "stop";
		return {
			type: "manage_schedules",
			subAction,
			scheduleId: stopMatch[1]
		};
	}

	if (/^(?:clear|reset|wipe)\s+(?:gc|group)\s+(?:chat\s+)?memory$/i.test(lower)) {
		return { type: "group_memory_control", action: "clear" };
	}

	if (/^(?:(?:gc|group)\s+memory(?:\s+(?:status|stats|info|size))?|memory\s+(?:status|stats|info)|list\s+stored\s+groups?)$/i.test(lower)) {
		return { type: "group_memory_control", action: "status" };
	}

	const memberActivityMatch = p.match(
		/^(?:what\s+(?:did|has|was)\s+(.+?)\s+(?:say|talk(?:ing)?\s+about|chat(?:ting)?\s+about|discuss(?:ing)?)|(.+?)(?:'s)?\s+(?:messages?|history)\s+in\s+(?:this\s+)?(?:gc|group))\b/i
	);
	if (memberActivityMatch) {
		const memberQuery = (memberActivityMatch[1] || memberActivityMatch[2] || "")
			.replace(/\s+in\s+(?:this\s+)?(?:gc|group|chat).*$/i, "")
			.trim();
		if (memberQuery && !/^(?:we|they|everyone|all|people|members)$/i.test(memberQuery)) {
			return { type: "group_history_summary", memberQuery };
		}
	}

	const countHistoryMatch = lower.match(/(?:last|recent|show)\s+(\d+)\s+(?:gc|group|chat)?\s*(?:messages?|msgs?)(?:\s+in\s+(?:this\s+)?(?:gc|group))?/i);
	if (
		countHistoryMatch ||
		/\b(?:what(?:\s+are|\s+is|\s+were|\s+was)?\s+(?:we|this\s+gc|the\s+gc|group|this\s+group|people|everyone)\s+(?:talking|chatting|discussing|saying|on\s+about)|gc\s+history|group\s+(?:chat\s+)?history|chat\s+history(?:\s+of\s+(?:this\s+gc|this\s+group|gc|group))?|what(?:\s+happened|\s+was\s+said)?\s+in\s+(?:this\s+)?(?:gc|group)|what(?:'s|\s+is)\s+happening\s+in\s+(?:this\s+)?(?:gc|group)|summarize\s+(?:this\s+)?(?:gc|group)|i\s+want\s+(?:the\s+)?chat\s+history)\b/i.test(lower)
	) {
		return {
			type: "group_history_summary",
			limit: countHistoryMatch ? Math.min(80, Math.max(5, parseInt(countHistoryMatch[1], 10))) : 50
		};
	}

	if (
		/\b(?:who\s+are\s+(?:the\s+)?admins?(?:\s+in\s+(?:this\s+)?(?:gc|group))?|list\s+(?:gc|group)\s+admins?|how\s+many\s+members(?:\s+in\s+(?:this\s+)?(?:gc|group))?|(?:gc|group)\s+admins?|(?:this\s+)?(?:gc|group)\s+(?:info|details|summary|stats))\b/i.test(lower)
	) {
		return { type: "group_info_summary" };
	}

	const isBotIdentityQuery = /\bwho\s+(?:are\s+you|created\s+you|made\s+you|coded\s+you|owns\s+you|designed\s+you)\b/i.test(lower) ||
		/\bwho\s+is\s+(?:your\s+creator|your\s+owner|your\s+boss|priyanshi)\b/i.test(lower);

	const detailsMatch =
		p.match(/(?:who\s+is|who's|who\s+are|details\s+of|profile\s+of|info\s+(?:on|about|of)|tell\s+me\s+about|give\s+(?:me\s+)?(?:the\s+)?details\s+of)\s*(.*)$/i) ||
		p.match(/^(?:give\s+(?:me\s+)?(?:his|her|their|user)?\s*(?:details?|info|profile)|(?:his|her|their)?\s*(?:details?|profile|info))(?:\s+(?:of|for|about))?\s*(.*)$/i) ||
		(lower.includes("in this group") && /(?:who\s+is|details\s+of|who's)\s*(.*)$/i.test(p));

	if (detailsMatch && !isBotIdentityQuery) {
		const rawTarget = (detailsMatch[1] || "").trim();
		const isNonPersonTarget = /^(?:the\s+)?(?:admins?|moderators?|members?|this\s+group|this\s+gc|gc|group|chat\s+history|memory)\b/i.test(rawTarget);
		if (!isNonPersonTarget) {
			return {
				type: "user_details",
				target: rawTarget
			};
		}
	}

	const uidMatch = lower.match(/^(?:give\s+(?:me\s+)?(?:his|her|their|user|this|the)?\s*uid|what(?:'s|\s+is)\s+(?:his|her|their|user|the)?\s*uid|(?:get|find|fetch|show)\s+(?:his|her|their|the)?\s*uid|uid(?:\s+(?:of|for))?\s*(.+)?|whois(?:\s+(.+))?)$/i) ||
		(lower.includes("uid") && /(?:give|get|find|show|fetch|tell)\s+(?:me\s+)?(?:his|her|their|user|the)?\s*uid/i.test(lower));
	if (uidMatch) {
		const rawTarget = uidMatch[1] || uidMatch[2] || "";
		return {
			type: "resolve_uid",
			target: rawTarget.trim()
		};
	}

	if (
		/\b(?:bot\s+runtime|bot\s+uptime|system\s+uptime|runtime\s+and\s+time|runtime\s+and\s+current\s+time|current\s+time\s+india|time\s+in\s+india|india\s+time)\b/i.test(lower) ||
		(/\b(?:runtime|uptime)\b/i.test(lower) && /\b(?:time|india)\b/i.test(lower))
	) {
		return {
			type: "uptime_and_time"
		};
	}

	const delScriptMatch = lower.match(/^(?:delete|remove)\s+(?:command|cmd|script)\s+([a-zA-Z0-9_$-]+)$/i);
	if (delScriptMatch) {
		return {
			type: "delete_script",
			target: delScriptMatch[1].trim()
		};
	}

	const aiOnMatch = lower.match(/^(?:ai\s+on|turn\s+on\s+ai|enable\s+ai(?:\s+for\s+users)?)$/i);
	if (aiOnMatch) {
		return { type: "ai_control", action: "on" };
	}
	const aiOffMatch = lower.match(/^(?:ai\s+off|turn\s+off\s+ai|disable\s+ai(?:\s+for\s+users)?)$/i);
	if (aiOffMatch) {
		return { type: "ai_control", action: "off" };
	}
	const aiBlockMatch = lower.match(/^(?:ai\s+block|block\s+ai\s+user)\s*(.*)$/i);
	if (aiBlockMatch) {
		return { type: "ai_control", action: "block", target: aiBlockMatch[1].trim() };
	}
	const aiUnblockMatch = lower.match(/^(?:ai\s+unblock|unblock\s+ai\s+user)\s*(.*)$/i);
	if (aiUnblockMatch) {
		return { type: "ai_control", action: "unblock", target: aiUnblockMatch[1].trim() };
	}
	if (/^(?:ai\s+status|ai\s+settings|ai\s+info)$/i.test(lower)) {
		return { type: "ai_control", action: "status" };
	}

	const isRecurring = /\b(?:every\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)|every\s+day|daily|every\s+hour|hourly)\b/i.test(lower);

	if (isRecurring) {
		let intervalSeconds = 86400;
		const everyMatch = lower.match(/(?:after\s+)?every\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)\b/i);
		if (everyMatch) {
			intervalSeconds = parseTimeUnitToSeconds(everyMatch[1], everyMatch[2]);
		}
		else if (/\b(?:every\s+hour|hourly)\b/i.test(lower)) {
			intervalSeconds = 3600;
		}

		const clauses = p
			.split(/\s+(?:and\s+then|then|and(?=\s+(?:in|after|wait|with|\d+|one|two|three|trigger|run|execute|use|call|start|send|play)))\s+/i)
			.map(c => c.trim())
			.filter(Boolean);

		const steps = clauses.map(extractSingleClauseStep).filter(Boolean);
		if (steps.length > 0) {
			return {
				type: "schedule_workflow",
				intervalSeconds,
				runImmediately: true,
				steps
			};
		}
	}

	const oneTimeMatch = lower.match(
		/\b(?:after|in)\s+(one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|half|\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)\b/i
	);

	if (oneTimeMatch && !isRecurring) {
		const clauses = p
			.split(/\s+(?:and\s+then|then|and(?=\s+(?:in|after|wait|with|\d+|one|two|three|trigger|run|execute|use|call|start|send|play)))\s+/i)
			.map(c => c.trim())
			.filter(Boolean);

		if (clauses.length === 1) {
			const delaySeconds = parseTimeUnitToSeconds(oneTimeMatch[1], oneTimeMatch[2]);
			const step = extractSingleClauseStep(p);
			if (step && delaySeconds > 0) {
				step.delaySecondsBefore = 0;
				return {
					type: "schedule_once",
					delaySeconds,
					steps: [step]
				};
			}
		}
		else if (clauses.length > 1) {
			const steps = clauses.map(extractSingleClauseStep).filter(Boolean);
			if (steps.length > 0) {
				if (steps[0].delaySecondsBefore > 0 && steps.length === 1) {
					const delaySec = steps[0].delaySecondsBefore;
					steps[0].delaySecondsBefore = 0;
					return {
						type: "schedule_once",
						delaySeconds: delaySec,
						steps
					};
				}
				return {
					type: "run_workflow",
					steps
				};
			}
		}
	}

	const hasChainVerb = /^(?:use|run|trigger|execute|call|start|launch|invoke|check|show|get|play)\b/i.test(lower);
	if (hasChainVerb && /\s+(?:and\s+then|then|also|and)\s+|,\s*/i.test(p)) {
		const chainClauses = p
			.replace(/^(?:please|can\s+you)\s+/i, "")
			.split(/\s*(?:,\s*(?:and\s+)?|\s+(?:and\s+then|then|also|and)\s+)/i)
			.map(c => c.trim())
			.filter(Boolean);
		if (chainClauses.length >= 2) {
			const isMonitorTelemetryOnly = chainClauses.some(c => /^(?:monitor|measure|check|track|log|show|report|display)\s+(?:the\s+)?(?:response\s+time|latency|execution\s+time|speed|duration)\b/i.test(c));
			if (!isMonitorTelemetryOnly) {
				const chainSteps = chainClauses.map(c => extractCommandStepFromChainClause(c, true)).filter(Boolean);
				if (chainSteps.length >= 2) {
					return {
						type: "run_workflow",
						steps: chainSteps
					};
				}
			}
		}
	}

	const immediateTriggerMatch = p.match(
		/^(?:(?:use|run|trigger|execute|call|start|launch|invoke|play)(?:\s*,\s*|\s+or\s+|\s+and\s+|\s+))+(?:the\s+)?([a-zA-Z0-9_$-]+)(?:\s+command|\s+cmd)?(?:\s+(?:with|using|for|on)\s+(.+)|\s+(.+))?$/i
	);

	if (immediateTriggerMatch && !isRecurring && !oneTimeMatch) {
		const rawCmd = immediateTriggerMatch[1].trim();
		const rawTail = (immediateTriggerMatch[2] || immediateTriggerMatch[3] || "").trim();
		const monitorResponseTime = /\b(?:monitor(?:ing)?|measure(?:ing)?|check(?:ing)?|track(?:ing)?|log(?:ging)?|show|report|display|measure)\s+(?:the\s+)?(?:response\s+time|latency|execution\s+time|speed|ping|duration)\b/i.test(rawTail) || /\b(?:response\s+time|latency|execution\s+time)\b/i.test(rawTail);

		const cleanedTail = rawTail
			.replace(/(?:and\s+)?(?:monitor(?:ing)?|measure(?:ing)?|check(?:ing)?|track(?:ing)?|log(?:ging)?|show|report|display|measure)?\s*(?:the\s+)?(?:response\s+time|latency|execution\s+time|speed|ping|duration)\b/gi, "")
			.replace(/^(?:command|cmd)\b/i, "")
			.trim();

		const canonical = toolRegistry.resolveToolName(rawCmd) || rawCmd.toLowerCase();
		const isRandomRequest = /\brandom\s+(?:song|music|track|query|request)\b/i.test(cleanedTail) || /\ba?\s*random\s+(?:song|track)\b/i.test(cleanedTail) || cleanedTail.toLowerCase() === "random";

		let chosenSong = "";
		let finalArgs = [];

		if (["sing", "music", "ytb", "spotify"].includes(canonical) && (isRandomRequest || !cleanedTail)) {
			chosenSong = RANDOM_HIT_SONGS[Math.floor(Math.random() * RANDOM_HIT_SONGS.length)];
			finalArgs = canonical === "ytb" ? ["-a", ...chosenSong.split(/\s+/)] : chosenSong.split(/\s+/);
		}
		else if (cleanedTail) {
			finalArgs = cleanedTail.split(/\s+/).filter(Boolean);
		}

		return {
			type: "immediate_tool",
			command: canonical === "spotify" ? "sing" : canonical,
			args: finalArgs,
			monitorResponseTime,
			isRandomRequest,
			chosenSong
		};
	}

	const playSongMatch = p.match(/^play\s+(?:a\s+)?(?:random\s+)?(?:song|music|track)?(?:\s+(.+))?$/i);
	if (playSongMatch && !isRecurring && !oneTimeMatch) {
		const rawQuery = (playSongMatch[1] || "").trim();
		const monitorResponseTime = /\b(?:monitor(?:ing)?|measure(?:ing)?|check(?:ing)?|track(?:ing)?|log(?:ging)?|show|report|display|measure)\s+(?:the\s+)?(?:response\s+time|latency|execution\s+time|speed|ping|duration)\b/i.test(rawQuery) || /\b(?:response\s+time|latency|execution\s+time)\b/i.test(rawQuery);
		const cleanedQuery = rawQuery
			.replace(/(?:and\s+)?(?:monitor(?:ing)?|measure(?:ing)?|check(?:ing)?|track(?:ing)?|log(?:ging)?|show|report|display|measure)?\s*(?:the\s+)?(?:response\s+time|latency|execution\s+time|speed|ping|duration)\b/gi, "")
			.trim();
		const isRandom = !cleanedQuery || /\brandom\b/i.test(p);
		const chosenSong = isRandom ? RANDOM_HIT_SONGS[Math.floor(Math.random() * RANDOM_HIT_SONGS.length)] : cleanedQuery;
		return {
			type: "immediate_tool",
			command: "sing",
			args: chosenSong.split(/\s+/).filter(Boolean),
			monitorResponseTime,
			isRandomRequest: isRandom,
			chosenSong
		};
	}

	const directCmdTrigger = p.match(/^([a-zA-Z0-9_$-]+)\s+(?:command|cmd)(?:\s+(.+))?$/i);
	if (directCmdTrigger && !isRecurring && !oneTimeMatch) {
		const rawCmd = directCmdTrigger[1].trim();
		const rawTail = (directCmdTrigger[2] || "").trim();
		const monitorResponseTime = /\b(?:monitor(?:ing)?|measure(?:ing)?|check(?:ing)?|track(?:ing)?|log(?:ging)?|show|report|display|measure)\s+(?:the\s+)?(?:response\s+time|latency|execution\s+time|speed|ping|duration)\b/i.test(rawTail) || /\b(?:response\s+time|latency|execution\s+time)\b/i.test(rawTail);
		const cleanedTail = rawTail
			.replace(/(?:and\s+)?(?:monitor(?:ing)?|measure(?:ing)?|check(?:ing)?|track(?:ing)?|log(?:ging)?|show|report|display|measure)?\s*(?:the\s+)?(?:response\s+time|latency|execution\s+time|speed|ping|duration)\b/gi, "")
			.trim();
		const canonical = toolRegistry.resolveToolName(rawCmd) || rawCmd.toLowerCase();
		return {
			type: "immediate_tool",
			command: canonical === "spotify" ? "sing" : canonical,
			args: cleanedTail ? cleanedTail.split(/\s+/).filter(Boolean) : [],
			monitorResponseTime,
			isRandomRequest: false,
			chosenSong: ""
		};
	}

	return null;
}

async function handleScheduleManagement(subAction, scheduleId, threadID, message, userIdentity) {
	const all = loadSchedules();
	const threadItems = all.filter(s => String(s.threadID) === String(threadID));
	const honorific = userIdentity?.isOwner ? "My Queen" : (userIdentity?.name || "Friend");

	if (subAction === "list") {
		if (threadItems.length === 0) {
			return await message.reply(`📭 No active one-time tasks or recurring schedules in this chat, ${honorific}.`);
		}
		const lines = [`⏰ Active Tasks & Schedules (${threadItems.length})`, `────────────`];
		for (const item of threadItems) {
			const kindLabel = item.oneTime
				? `One-Time Task (in ${formatDurationHuman(Math.max(1000, (item.executeAt || Date.now()) - Date.now()))})`
				: `Recurring (every ${formatDurationHuman(item.intervalMs)})`;
			const stepsDesc = (item.steps || [])
				.map(st => `${st.delaySecondsBefore ? `(+${st.delaySecondsBefore}s) ` : ""}${st.command}${st.args?.length ? " " + st.args.join(" ") : ""}`)
				.join(" → ");
			lines.push(
				`• ID: ${item.id}\n` +
				`  Type: ${kindLabel}\n` +
				`  Action: ${stepsDesc}\n` +
				`  Status: ${item.paused ? "⏸️ Paused" : "🟢 Active"}`
			);
		}
		lines.push(`\n💡 Use: ai stop schedule <ID> or ai clear schedules`);
		return await message.reply(lines.join("\n"));
	}

	if (subAction === "clear") {
		for (const item of threadItems) {
			if (activeTimers.has(item.id)) {
				const t = activeTimers.get(item.id);
				clearTimeout(t);
				clearInterval(t);
				activeTimers.delete(item.id);
			}
		}
		const remaining = all.filter(s => String(s.threadID) !== String(threadID));
		saveSchedules(remaining);
		return await message.reply(`🗑️ Cleared ${threadItems.length} task(s)/schedule(s) in this chat, ${honorific}.`);
	}

	if (!scheduleId) {
		return await message.reply(`⚠️ Please provide the task or schedule ID, ${honorific}.`);
	}

	const idx = all.findIndex(s => s.id.toLowerCase() === String(scheduleId).toLowerCase() && String(s.threadID) === String(threadID));
	if (idx === -1) {
		return await message.reply(`⚠️ Task/Schedule "${scheduleId}" was not found in this chat, ${honorific}.`);
	}

	const target = all[idx];
	if (subAction === "stop") {
		if (activeTimers.has(target.id)) {
			const t = activeTimers.get(target.id);
			clearTimeout(t);
			clearInterval(t);
			activeTimers.delete(target.id);
		}
		all.splice(idx, 1);
		saveSchedules(all);
		return await message.reply(`✅ Stopped and removed "${target.id}", ${honorific}.`);
	}

	if (subAction === "pause") {
		target.paused = true;
		if (activeTimers.has(target.id)) {
			const t = activeTimers.get(target.id);
			clearTimeout(t);
			clearInterval(t);
			activeTimers.delete(target.id);
		}
		saveSchedules(all);
		return await message.reply(`⏸️ Paused "${target.id}", ${honorific}.`);
	}

	if (subAction === "resume") {
		target.paused = false;
		saveSchedules(all);
		startTimerForEntry(target);
		return await message.reply(`▶️ Resumed "${target.id}", ${honorific}.`);
	}
}

function attachReplyEntriesToMessage(msgId, authorID, pendingReplyEntries = []) {
	if (!msgId || !(global.GoatBot?.onReply instanceof Map)) return;
	if (Array.isArray(pendingReplyEntries) && pendingReplyEntries.length > 0) {
		const latest = pendingReplyEntries[pendingReplyEntries.length - 1];
		global.GoatBot.onReply.set(msgId, {
			...latest,
			messageID: msgId
		});
		return;
	}
	global.GoatBot.onReply.set(msgId, {
		commandName: "ai",
		messageID: msgId,
		author: String(authorID)
	});
}

async function deliverAgentMessage(message, api, thinkingMsg, text, attachments = [], authorID = "", threadID = "", pendingReplyEntries = []) {
	const formattedText = sanitizeAndFormatOutput(text);
	const hasAttachments = Array.isArray(attachments) && attachments.length > 0;

	if (hasAttachments) {
		if (thinkingMsg?.messageID) {
			try {
				if (message && typeof message.unsend === "function") {
					await message.unsend(thinkingMsg.messageID);
				}
				else if (api && typeof api.unsendMessage === "function") {
					await api.unsendMessage(thinkingMsg.messageID);
				}
			}
			catch {
			}
		}
		const payload = {
			body: formattedText,
			attachment: attachments.length === 1 ? attachments[0] : attachments
		};
		const sent = await message.reply(payload);
		const msgId = sent?.messageID || null;
		if (msgId) {
			recordAiMessageId(msgId, authorID, threadID);
			attachReplyEntriesToMessage(msgId, authorID, pendingReplyEntries);
		}
		return msgId;
	}

	if (thinkingMsg?.messageID) {
		recordAiMessageId(thinkingMsg.messageID, authorID, threadID);
		attachReplyEntriesToMessage(thinkingMsg.messageID, authorID, pendingReplyEntries);
		try {
			if (message && typeof message.edit === "function") {
				const edited = await message.edit(formattedText, thinkingMsg.messageID);
				const finalId = edited?.messageID || thinkingMsg.messageID;
				recordAiMessageId(finalId, authorID, threadID);
				attachReplyEntriesToMessage(finalId, authorID, pendingReplyEntries);
				return finalId;
			}
			if (api && typeof api.editMessage === "function") {
				await api.editMessage(formattedText, thinkingMsg.messageID);
				return thinkingMsg.messageID;
			}
		}
		catch {
		}
	}

	if (message && typeof message.reply === "function") {
		const sent = await message.reply(formattedText);
		const finalId = sent?.messageID || thinkingMsg?.messageID || null;
		if (finalId) {
			recordAiMessageId(finalId, authorID, threadID);
			attachReplyEntriesToMessage(finalId, authorID, pendingReplyEntries);
		}
		return finalId;
	}
	return null;
}

async function runCapturedSynthesizedCommand({
	commandName,
	args = [],
	execContext,
	userPrompt = "",
	honorific = "Friend",
	uid = "",
	prefix = ".",
	thinkingMsg = null,
	message,
	api,
	threadID,
	monitorResponseTime = false,
	modifyInstruction = "",
	gcName = "",
	isGroup = false,
	recordHistory = true
}) {
	const startPerf = performance.now();
	const toolResult = await toolRegistry.executeCommandAsTool({
		commandName,
		args,
		...execContext,
		captureOutput: true
	});
	const elapsedMs = Math.round(performance.now() - startPerf);

	const finalText = await synthesizeToolExecutionResult({
		toolResult,
		userPrompt,
		honorific,
		uid,
		prefix,
		modifyInstruction,
		elapsedMs,
		monitorResponseTime
	});

	await deliverAgentMessage(
		message,
		api,
		thinkingMsg,
		finalText || `✅ Executed ${prefix}${toolResult.commandName} for you, ${honorific}.`,
		toolResult.attachments || [],
		uid,
		threadID,
		toolResult.virtualReplyEntries || []
	);

	if (recordHistory) {
		appendChatHistoryTurn({
			threadID,
			uid,
			name: honorific,
			gcName,
			userPrompt,
			assistantReply: finalText || `[Executed ${toolResult.commandName}]`,
			isGroup
		});
	}
	return toolResult;
}

async function resolveGroupHistoryReply({ threadID, memberQuery = "", limit = 50, honorific = "Friend", uid = "", userPrompt = "" }) {
	if (!groupMemory) {
		return `Group memory is not loaded right now, ${honorific}.`;
	}
	const gcMeta = groupMemory.getGroupMeta(threadID);
	const gcName = gcMeta?.gcName || gcMeta?.threadName || "this group";

	if (memberQuery) {
		const memberMem = groupMemory.getMemberMemory(threadID, memberQuery);
		const matchedMsgs = memberMem?.recentMessages?.length
			? memberMem.recentMessages.map(m => `${m.name}: ${m.body}`).join("\n")
			: groupMemory.searchGroupMemory(threadID, memberQuery, 20).map(m => `${m.name}: ${m.body}`).join("\n");
		if (!matchedMsgs) {
			return `No stored messages found for "${memberQuery}" in ${gcName} (TID: ${threadID}) yet, ${honorific}.`;
		}
		const memberPrompt =
			`[MEMBER ACTIVITY IN GROUP MEMORY]\n` +
			`Group: ${gcName} (TID: ${threadID})\n` +
			`Target: ${memberMem?.name || memberQuery} (UID: ${memberMem?.uid || "unknown"}, Messages: ${memberMem?.msgCount || "N/A"})\n` +
			`Topics: ${(memberMem?.keywords || []).join(", ") || "general"}\n` +
			`Recent Messages:\n${matchedMsgs.slice(0, 1800)}\n\n` +
			`Answer what ${memberMem?.name || memberQuery} talked about concisely as Queen Bot addressing ${honorific}.`;
		const res = await callMeowGeminiApi({ prompt: memberPrompt, uid: `memsum_${uid}`, model: "gemini-flash" });
		return res.ok && res.response
			? sanitizeAndFormatOutput(res.response)
			: `📝 ${memberMem?.name || memberQuery} (${gcName}):\n${matchedMsgs.slice(0, 500)}`;
	}

	const rawCtx = groupMemory.getGroupContextFormatted(threadID, limit || 50);
	if (!rawCtx) {
		return `No group chat history stored yet for this chat (TID: ${threadID}), ${honorific}.`;
	}

	const summaryPrompt =
		`[GROUP CHAT HISTORY MEMORY (JSON+ZSTD)]\n` +
		`Group Name: ${gcName} | TID: ${threadID}\n` +
		(userPrompt ? `User Question: "${userPrompt}"\n` : "") +
		`Active Topics: ${(gcMeta?.topics || []).slice(-12).join(", ") || "general chat"}\n` +
		`Recent Group Messages:\n${rawCtx.slice(0, 2400)}\n\n` +
		`Summarize what the group has been talking about based cleanly on the logged messages above. Keep it short, accurate, and natural as Queen Bot addressing ${honorific}.`;
	const summaryRes = await callMeowGeminiApi({
		prompt: summaryPrompt,
		uid: `gcsum_${uid}`,
		model: "gemini-flash"
	});
	if (summaryRes.ok && summaryRes.response) {
		return sanitizeAndFormatOutput(summaryRes.response);
	}
	const fallbackLines = rawCtx.split("\n").slice(-10).join("\n");
	return `💬 Recent chat in ${gcName} (TID: ${threadID}):\n${fallbackLines}`;
}

async function resolveGroupInfoReply({ threadID, api, threadsData, honorific = "Friend", uid = "", userPrompt = "" }) {
	let threadData = null;
	if (threadsData && typeof threadsData.get === "function") {
		try { threadData = await threadsData.get(threadID); } catch {}
	}
	let liveInfo = null;
	if (api && typeof api.getThreadInfo === "function") {
		try { liveInfo = await api.getThreadInfo(threadID); } catch {}
	}
	const gcMeta = groupMemory ? groupMemory.getGroupMeta(threadID) : null;
	const gcName = liveInfo?.threadName || threadData?.threadName || gcMeta?.gcName || "This Group";
	const members = Array.isArray(liveInfo?.userInfo) ? liveInfo.userInfo : (Array.isArray(threadData?.members) ? threadData.members : []);
	const adminIDsRaw = Array.isArray(liveInfo?.adminIDs) ? liveInfo.adminIDs : (Array.isArray(threadData?.adminIDs) ? threadData.adminIDs : []);
	const adminUids = adminIDsRaw.map(a => String(a?.id || a?.userID || a));
	const adminNames = adminUids.map(aUid => {
		const m = members.find(x => String(x.id || x.userID) === aUid);
		return m?.name ? `${m.name} (${aUid})` : aUid;
	});
	const memberCount = liveInfo?.participantIDs?.length || members.length || gcMeta?.userCount || 0;
	const msgCount = liveInfo?.messageCount || gcMeta?.msgCount || 0;

	const factSummary =
		`Group Name: ${gcName}\n` +
		`TID: ${threadID}\n` +
		`Members: ${memberCount}\n` +
		`Admins (${adminUids.length}): ${adminNames.join(", ") || "None"}\n` +
		`Messages Recorded: ${msgCount}\n` +
		(gcMeta?.topics?.length ? `Active Topics: ${gcMeta.topics.slice(-10).join(", ")}` : "");

	const aiRes = await callMeowGeminiApi({
		prompt: `[GROUP INFO DATA]\n${factSummary}\n\n[USER QUESTION]: "${userPrompt}"\nRespond cleanly and concisely as Queen Bot addressing ${honorific}.`,
		uid: `ginfo_${uid}`,
		model: "gemini-flash"
	});
	return aiRes.ok && aiRes.response ? sanitizeAndFormatOutput(aiRes.response) : `📌 ${factSummary}`;
}

async function executeParsedQueenActions(actions, context, userIdentity, thinkingMsg) {
	const {
		api,
		message,
		event,
		role = 0,
		prefix = ".",
		usersData,
		threadsData,
		threadModel,
		userModel,
		dashBoardModel,
		globalModel,
		dashBoardData,
		globalData
	} = context;

	const uid = String(event?.senderID || event?.userID || "");
	const threadID = String(event?.threadID || uid);
	const effectiveRole = userIdentity?.isOwner ? 2 : (Number(role) || 0);
	const honorific = userIdentity?.isOwner ? "My Queen" : (userIdentity?.name || "Friend");
	const userPrompt = String(context?.prompt || "");

	const execContext = {
		api,
		message,
		event,
		role: effectiveRole,
		prefix,
		usersData,
		threadsData,
		threadModel,
		userModel,
		dashBoardModel,
		globalModel,
		dashBoardData,
		globalData
	};

	const runToolActions = actions.filter(a => String(a?.action || "").toLowerCase() === "run_tool");
	if (runToolActions.length > 1 && runToolActions.length === actions.length) {
		const stepEntries = [];
		for (const actObj of runToolActions) {
			const cmdArgs = Array.isArray(actObj.args) ? actObj.args : [];
			const t0 = performance.now();
			const res = await toolRegistry.executeCommandAsTool({
				commandName: actObj.command,
				args: cmdArgs,
				...execContext,
				captureOutput: true
			});
			stepEntries.push({
				label: actObj.command,
				elapsedMs: Math.round(performance.now() - t0),
				result: res
			});
		}
		const combined = await synthesizeMultiToolResults({ stepEntries, userPrompt, honorific, uid });
		await deliverAgentMessage(
			message,
			api,
			thinkingMsg,
			combined.text || `✅ Executed ${runToolActions.length} commands for you, ${honorific}.`,
			combined.attachments,
			uid,
			threadID,
			combined.virtualReplyEntries
		);
		return;
	}

	for (const actObj of actions) {
		const actionType = String(actObj.action || "").toLowerCase();

		if (actionType === "run_tool") {
			const cmdName = actObj.command;
			const cmdArgs = Array.isArray(actObj.args) ? actObj.args : [];
			const modifyInstruction = String(actObj.modifyResponse || "").trim();

			await runCapturedSynthesizedCommand({
				commandName: cmdName,
				args: cmdArgs,
				execContext,
				userPrompt,
				honorific,
				uid,
				prefix,
				thinkingMsg,
				message,
				api,
				threadID,
				modifyInstruction,
				recordHistory: false
			});
		}
		else if (actionType === "schedule_once" || actionType === "delay_task") {
			const delaySeconds = Number(actObj.delaySeconds || actObj.intervalSeconds || 60);
			const rawSteps = Array.isArray(actObj.steps) ? actObj.steps : [];
			const resolvedSteps = [];

			for (const st of rawSteps) {
				let stepArgs = Array.isArray(st.args) ? [...st.args] : [];
				let resolvedNote = "";
				if (st.fuzzySearch && stepArgs.length > 0) {
					const flags = stepArgs.filter(a => String(a).startsWith("-"));
					const rawQuery = stepArgs.filter(a => !String(a).startsWith("-")).join(" ");
					const webMatch = await toolRegistry.resolveFuzzyQueryWithWeb(rawQuery, "media");
					if (webMatch?.resolvedQuery) {
						stepArgs = [...flags, ...webMatch.resolvedQuery.split(/\s+/)];
						resolvedNote = webMatch.resolvedQuery;
					}
				}
				resolvedSteps.push({
					command: toolRegistry.resolveToolName(st.command) || String(st.command || "").toLowerCase(),
					args: stepArgs,
					delaySecondsBefore: Number(st.delaySecondsBefore || 0),
					fuzzySearch: Boolean(st.fuzzySearch),
					resolvedNote
				});
			}

			if (resolvedSteps.length > 0) {
				const stepsDesc = resolvedSteps
					.map(st => `${st.command}${st.args?.length ? " " + st.args.join(" ") : ""}`)
					.join(" → ");
				const entry = registerTaskOrSchedule({
					threadID,
					authorID: uid,
					role: effectiveRole,
					prefix,
					delayOrIntervalSeconds: delaySeconds,
					steps: resolvedSteps,
					description: actObj.description || stepsDesc,
					oneTime: true
				});
				await deliverAgentMessage(
					message,
					api,
					thinkingMsg,
					`⏳ One-Time Task Scheduled, ${honorific}!\n` +
					`────────────\n` +
					`• Task ID: ${entry.id}\n` +
					`• Runs Once After: ${formatDurationHuman(entry.intervalMs)}\n` +
					`• Action: ${stepsDesc}\n` +
					`• Mode: Single Execution (Will Not Repeat)`,
					[],
					uid,
					threadID
				);
			}
		}
		else if (actionType === "run_workflow") {
			const rawSteps = Array.isArray(actObj.steps) ? actObj.steps : [];
			const stepEntries = [];
			for (const step of rawSteps) {
				if (!step || !step.command) continue;
				const delaySec = Number(step.delaySecondsBefore || 0);
				if (delaySec > 0) {
					await sleep(Math.min(delaySec, 3600) * 1000);
				}
				let finalArgs = Array.isArray(step.args) ? [...step.args] : [];
				if (step.fuzzySearch && finalArgs.length > 0) {
					const flagArgs = finalArgs.filter(a => String(a).startsWith("-"));
					const queryPart = finalArgs.filter(a => !String(a).startsWith("-")).join(" ");
					if (queryPart) {
						const resolved = await toolRegistry.resolveFuzzyQueryWithWeb(queryPart, "media");
						if (resolved?.resolvedQuery) {
							finalArgs = [...flagArgs, ...resolved.resolvedQuery.split(/\s+/)];
						}
					}
				}
				const t0 = performance.now();
				const res = await toolRegistry.executeCommandAsTool({
					commandName: step.command,
					args: finalArgs,
					...execContext,
					captureOutput: true
				});
				stepEntries.push({
					label: step.command,
					elapsedMs: Math.round(performance.now() - t0),
					result: res
				});
			}
			const combined = await synthesizeMultiToolResults({ stepEntries, userPrompt, honorific, uid });
			await deliverAgentMessage(
				message,
				api,
				thinkingMsg,
				combined.text || `✅ Completed ${stepEntries.length} workflow step(s), ${honorific}.`,
				combined.attachments,
				uid,
				threadID,
				combined.virtualReplyEntries
			);
		}
		else if (actionType === "schedule_workflow") {
			const intervalSeconds = Number(actObj.intervalSeconds || 86400);
			const runImmediately = actObj.runImmediately !== false;
			const rawSteps = Array.isArray(actObj.steps) ? actObj.steps : [];
			if (rawSteps.length > 0) {
				const stepsDesc = rawSteps
					.map(st => `${st.delaySecondsBefore ? `(after ${st.delaySecondsBefore}s delay) ` : ""}${st.command}${st.args?.length ? " " + st.args.join(" ") : ""}`)
					.join(" → ");
				const entry = registerTaskOrSchedule({
					threadID,
					authorID: uid,
					role: effectiveRole,
					prefix,
					delayOrIntervalSeconds: intervalSeconds,
					steps: rawSteps,
					description: actObj.description || stepsDesc,
					oneTime: false
				});
				await deliverAgentMessage(
					message,
					api,
					thinkingMsg,
					`⏰ Recurring Workflow Activated, ${honorific}!\n` +
					`────────────\n` +
					`• Schedule ID: ${entry.id}\n` +
					`• Repeat Interval: Every ${formatDurationHuman(entry.intervalMs)}\n` +
					`• Pipeline: ${stepsDesc}` +
					(runImmediately ? `\n▶️ Running initial cycle now...` : ""),
					[],
					uid,
					threadID
				);
				if (runImmediately) {
					await executeScheduledSteps(rawSteps, execContext);
				}
			}
		}
		else if (actionType === "manage_schedules") {
			if (thinkingMsg?.messageID && message?.unsend) {
				try { await message.unsend(thinkingMsg.messageID); } catch {}
			}
			await handleScheduleManagement(
				String(actObj.subAction || actObj.manageAction || "list").toLowerCase(),
				actObj.scheduleId,
				threadID,
				message,
				userIdentity
			);
		}
		else if (actionType === "call_fca_api") {
			const fcaResult = await toolRegistry.executeFcaApiTool({
				api,
				event,
				role: effectiveRole,
				method: actObj.method,
				args: actObj.args || []
			});
			if (!fcaResult.ok) {
				await deliverAgentMessage(
					message,
					api,
					thinkingMsg,
					`⚠️ ${honorific}, FCA call "${actObj.method}" failed: ${fcaResult.error}`,
					[],
					uid,
					threadID
				);
				continue;
			}
			const serialized = typeof fcaResult.data === "object"
				? JSON.stringify(fcaResult.data, null, 2).slice(0, 1200)
				: String(fcaResult.data ?? "Success");
			const fcaSynth = await callMeowGeminiApi({
				prompt: `FCA method "${fcaResult.method}" succeeded for ${honorific}. Result data: ${serialized}. Summarize or confirm this action naturally in 1-3 lines as Queen Bot.`,
				uid: `fca_${uid}`,
				model: "gemini-flash"
			});
			await deliverAgentMessage(
				message,
				api,
				thinkingMsg,
				fcaSynth.ok && fcaSynth.response ? fcaSynth.response : `✅ Executed FCA "${fcaResult.method}" for you, ${honorific}.`,
				[],
				uid,
				threadID
			);
		}
		else if (actionType === "web_search") {
			const searchRes = await toolRegistry.resolveFuzzyQueryWithWeb(actObj.query, actObj.thenRunCommand ? "media" : "general");
			if (actObj.thenRunCommand && searchRes.resolvedQuery) {
				const prefixArgs = Array.isArray(actObj.thenArgsPrefix) ? actObj.thenArgsPrefix : [];
				await runCapturedSynthesizedCommand({
					commandName: actObj.thenRunCommand,
					args: [...prefixArgs, ...searchRes.resolvedQuery.split(/\s+/)],
					execContext,
					userPrompt,
					honorific,
					uid,
					prefix,
					thinkingMsg,
					message,
					api,
					threadID
				});
			}
			else {
				const ans = await callMeowGeminiApi({
					prompt: `User (${honorific}) asked: "${actObj.query}". Web/YouTube resolution returned: ${JSON.stringify(searchRes)}. Answer naturally as Queen Bot.`,
					uid,
					model: "gemini-auto"
				});
				await deliverAgentMessage(
					message,
					api,
					thinkingMsg,
					ans.ok && ans.response ? ans.response : (searchRes.summary || `🔎 Resolved: ${searchRes.resolvedQuery}`),
					[],
					uid,
					threadID
				);
			}
		}
		else if (actionType === "set_response_modifier") {
			const updated = setCommandResponseRule({
				commandName: actObj.command,
				mode: actObj.mode || "ai_rewrite",
				instruction: actObj.instruction || "",
				template: actObj.instruction || "",
				updatedBy: uid
			});
			if (updated) {
				const msgText = updated.mode === "reset"
					? `✅ Reset response modifier for "${updated.commandName}" back to default, ${honorific}.`
					: `✅ Response Modifier Active, ${honorific}!\n────────────\n• Command: ${updated.commandName}\n• Mode: ${updated.mode}\n• Rule: ${updated.instruction}`;
				await deliverAgentMessage(message, api, thinkingMsg, msgText, [], uid, threadID);
			}
		}
		else if (["read_script", "modify_script", "create_script", "delete_script", "reload_script"].includes(actionType)) {
			if (effectiveRole < 2) {
				await deliverAgentMessage(
					message,
					api,
					thinkingMsg,
					`⚠️ Only my Queen/Owner (Priyanshi Kaur) or Bot Admins can inspect or modify bot scripts.`,
					[],
					uid,
					threadID
				);
				continue;
			}

			if (actionType === "read_script") {
				const readRes = toolRegistry.readBotScript(actObj.target);
				if (!readRes.ok) {
					await deliverAgentMessage(message, api, thinkingMsg, `⚠️ ${readRes.error}`, [], uid, threadID);
				}
				else {
					const snippet = readRes.content.slice(0, 1500);
					await deliverAgentMessage(
						message,
						api,
						thinkingMsg,
						`📄 Script: ${readRes.fileName} (${honorific})\n────────────\n${snippet}${readRes.content.length > 1500 ? "\n...(truncated)" : ""}`,
						[],
						uid,
						threadID
					);
				}
			}
			else if (actionType === "delete_script") {
				const delRes = await toolRegistry.deleteBotScript(actObj.target, savedRuntimeContext || execContext);
				await deliverAgentMessage(
					message,
					api,
					thinkingMsg,
					delRes.ok
						? `🗑️ Deleted script "${delRes.fileName}" and unloaded command.`
						: `⚠️ Failed to delete script: ${delRes.error}`,
					[],
					uid,
					threadID
				);
			}
			else if (actionType === "reload_script") {
				const relRes = await toolRegistry.reloadBotScript(actObj.target, savedRuntimeContext || execContext);
				await deliverAgentMessage(
					message,
					api,
					thinkingMsg,
					relRes.ok
						? `🔄 Hot-reloaded "${relRes.fileName}" into QueenBotV3, ${honorific}!`
						: `⚠️ Failed to reload "${actObj.target}": ${relRes.error}`,
					[],
					uid,
					threadID
				);
			}
			else if (actionType === "modify_script" || actionType === "create_script") {
				let finalCode = String(actObj.code || "").trim();
				if (!finalCode) {
					const existing = actionType === "modify_script" ? toolRegistry.readBotScript(actObj.target) : null;
					const codeGenPrompt = actionType === "modify_script" && existing?.ok
						? `Modify this QueenBotV3 command script (${existing.fileName}) according to instruction: "${actObj.instruction}". Set config.author = "Priyanshi Kaur", write clean code with ZERO comments, and output ONLY raw JavaScript/TypeScript code:\n\n${existing.content}`
						: `Create a complete QueenBotV3 command script named "${actObj.target}" that does: "${actObj.description || actObj.instruction}". Set config.author = "Priyanshi Kaur", version = "1.0.0", role = 0, countDown = 3, write clean CommonJS module.exports = { config: {...}, onStart: async function({ api, event, args, message }) {...} } with ZERO comments, and output ONLY raw code.`;
					const genRes = await callMeowGeminiApi({
						prompt: codeGenPrompt,
						uid: `codegen_${uid}`,
						model: "gemini-pro"
					});
					if (genRes.ok && genRes.response) {
						finalCode = genRes.response
							.replace(/^`{3}[a-zA-Z]*\n?/gm, "")
							.replace(/`{3}$/gm, "")
							.trim();
					}
				}

				if (!finalCode) {
					await deliverAgentMessage(message, api, thinkingMsg, `⚠️ Could not generate script code for "${actObj.target}", ${honorific}.`, [], uid, threadID);
					continue;
				}

				finalCode = toolRegistry.stripCommentsFromCode(finalCode);
				const writeRes = await toolRegistry.writeAndReloadBotScript({
					targetName: actObj.target,
					code: finalCode,
					runtimeContext: savedRuntimeContext || execContext
				});
				await deliverAgentMessage(
					message,
					api,
					thinkingMsg,
					writeRes.ok
						? `✅ ${actionType === "create_script" ? "Created" : "Modified"} & Hot-Reloaded "${writeRes.fileName}", ${honorific}!\n────────────\n• File: ${writeRes.fileName}\n• Status: ${writeRes.reloadDetail}`
						: `⚠️ Script update failed: ${writeRes.error}`,
					[],
					uid,
					threadID
				);
			}
		}
	}
}

async function handleQueenAgentTurn(options) {
	const {
		prompt,
		event,
		message,
		api,
		role = 0,
		prefix = ".",
		usersData,
		threadsData,
		threadModel,
		userModel,
		dashBoardModel,
		globalModel,
		dashBoardData,
		globalData
	} = options;

	savedRuntimeContext = {
		api,
		usersData,
		threadsData,
		threadModel,
		userModel,
		dashBoardModel,
		globalModel,
		dashBoardData,
		globalData
	};

	const uid = String(event?.senderID || event?.userID || "");
	const threadID = String(event?.threadID || uid);
	const rawPrompt = String(prompt || "").trim();
	const lower = rawPrompt.toLowerCase();
	const isGroup = Boolean(event?.isGroup || (threadID && uid && threadID !== uid));
	let currentGcName = "";
	if (isGroup && threadsData && typeof threadsData.get === "function") {
		try {
			const td = await threadsData.get(threadID);
			if (td?.threadName) currentGcName = String(td.threadName);
		}
		catch {}
	}
	if (!currentGcName && groupMemory) {
		const gm = groupMemory.getGroupMeta(threadID);
		if (gm?.gcName) currentGcName = gm.gcName;
	}

	const userIdentity = await toolRegistry.resolveUserIdentity({
		api,
		usersData,
		senderID: uid,
		role
	});
	const honorific = userIdentity.isOwner ? "My Queen" : userIdentity.name;

	const effectiveRole = userIdentity.isOwner ? 2 : (Number(role) || 0);
	const execContext = {
		api,
		message,
		event,
		role: effectiveRole,
		prefix,
		usersData,
		threadsData,
		threadModel,
		userModel,
		dashBoardModel,
		globalModel,
		dashBoardData,
		globalData
	};

	if (isUserBlocked(uid)) {
		return;
	}

	if (!isAiEnabledForUser(uid, effectiveRole)) {
		if (options.isDirectCommand) {
			return await deliverAgentMessage(message, api, null, `⚠️ AI is currently turned off for users by admin.`, [], uid, threadID);
		}
		return;
	}

	const jailbreakBlocked = checkJailbreakAttempt(rawPrompt, userIdentity);
	if (jailbreakBlocked) {
		return await deliverAgentMessage(message, api, null, jailbreakBlocked, [], uid, threadID);
	}

	if (lower === "clear" || lower === "reset") {
		clearLocalHistory(uid);
		await callMeowGeminiApi({ prompt: "clear", uid });
		return await deliverAgentMessage(
			message,
			api,
			null,
			`🧹 Conversation memory cleared for you, ${honorific}!`,
			[],
			uid,
			threadID
		);
	}

	const modelSwitchMatch = lower.match(/^model\s+(gemini-auto|auto|gemini-flash|flash|gemini-pro|pro|gemini-flash-thinking|thinking|gemini-advanced|advanced|ultra)$/i);
	if (modelSwitchMatch) {
		const aliasMap = {
			auto: "gemini-auto",
			flash: "gemini-flash",
			pro: "gemini-pro",
			thinking: "gemini-flash-thinking",
			advanced: "gemini-advanced",
			ultra: "gemini-advanced"
		};
		const chosen = aliasMap[modelSwitchMatch[1].toLowerCase()] || modelSwitchMatch[1].toLowerCase();
		setUserModelPreference(uid, chosen);
		return await deliverAgentMessage(
			message,
			api,
			null,
			`⚡ Switched your active Queen Bot model to "${chosen}", ${honorific}.`,
			[],
			uid,
			threadID
		);
	}

	const naturalTask = parseNaturalTaskIntent(rawPrompt);
	if (naturalTask) {
		if (naturalTask.type === "group_memory_control") {
			if (naturalTask.action === "clear") {
				if (effectiveRole < 1 && !userIdentity.isOwner) {
					return await deliverAgentMessage(message, api, null, `⚠️ Only Admin or Owner can clear group memory.`, [], uid, threadID);
				}
				const cleared = groupMemory ? groupMemory.clearGroupMemory(threadID) : false;
				return await deliverAgentMessage(
					message,
					api,
					null,
					cleared ? `🗑️ Cleared JSON+ZSTD group memory for this chat, ${honorific}.` : `⚠️ No group memory found to clear.`,
					[],
					uid,
					threadID
				);
			}
			const meta = groupMemory ? groupMemory.getGroupMeta(threadID) : null;
			const allGroups = groupMemory ? groupMemory.listKnownGroups() : [];
			const sizeKb = meta ? (meta.fileSizeBytes / 1024).toFixed(2) : "0";
			const maxKb = meta ? (meta.maxBytes / 1024).toFixed(0) : "1024";
			const statusText =
				`🧠 Group ZSTD Memory Status\n────────────\n` +
				`• GC Name: ${meta?.gcName || currentGcName || "This Chat"}\n` +
				`• TID: ${threadID}\n` +
				`• Stored Messages: ${meta?.msgCount || 0}\n` +
				`• Tracked Members: ${meta?.userCount || 0}\n` +
				`• Storage Used: ${sizeKb} KB / ${maxKb} KB (1 MB max)\n` +
				`• Active Topics: ${meta?.topics?.slice(-8).join(", ") || "None yet"}\n` +
				`• Known Groups Saved: ${allGroups.length}`;
			return await deliverAgentMessage(message, api, null, statusText, [], uid, threadID);
		}
		if (naturalTask.type === "group_info_summary") {
			const gInfoReply = await resolveGroupInfoReply({
				threadID,
				api,
				threadsData,
				honorific,
				uid,
				userPrompt: rawPrompt
			});
			appendChatHistoryTurn({ threadID, uid, name: userIdentity?.name || "Member", gcName: currentGcName, userPrompt: rawPrompt, assistantReply: gInfoReply, isGroup });
			return await deliverAgentMessage(message, api, null, gInfoReply, [], uid, threadID);
		}
		if (naturalTask.type === "user_details") {
			const targetInput = naturalTask.target || rawPrompt;
			const card = await toolRegistry.getUserDetailsCard({
				query: targetInput,
				event,
				api,
				threadsData,
				usersData
			});
			if (card && card.ok && card.body) {
				let enrichedBody = card.body;
				if (groupMemory) {
					const memInfo = groupMemory.getMemberMemory(threadID, card.uid || targetInput);
					if (memInfo && memInfo.msgCount > 0) {
						const topicStr = memInfo.keywords?.length ? memInfo.keywords.slice(-5).join(", ") : "general";
						enrichedBody += `\n• Memory Activity: ${memInfo.msgCount} msg(s) tracked (Topics: ${topicStr})`;
					}
				}
				const attachments = card.attachment ? [card.attachment] : [];
				appendChatHistoryTurn({ threadID, uid, name: userIdentity?.name || "Member", gcName: currentGcName, userPrompt: rawPrompt, assistantReply: enrichedBody, isGroup });
				return await deliverAgentMessage(message, api, null, enrichedBody, attachments, uid, threadID);
			}
			return await deliverAgentMessage(message, api, null, `⚠️ Could not find details for that user.`, [], uid, threadID);
		}
		if (naturalTask.type === "resolve_uid") {
			const targetInput = naturalTask.target || rawPrompt;
			const uidRes = await toolRegistry.findUserUid(targetInput, event, api, threadsData, usersData);
			if (uidRes && uidRes.uid) {
				return await deliverAgentMessage(message, api, null, `🆔 UID: ${uidRes.uid} (${uidRes.name})`, [], uid, threadID);
			}
			return await deliverAgentMessage(message, api, null, `⚠️ Could not find UID for that user.`, [], uid, threadID);
		}
		if (naturalTask.type === "group_history_summary") {
			const gcReply = await resolveGroupHistoryReply({
				threadID,
				memberQuery: naturalTask.memberQuery || "",
				limit: naturalTask.limit || 50,
				honorific,
				uid,
				userPrompt: rawPrompt
			});
			appendChatHistoryTurn({ threadID, uid, name: userIdentity?.name || "Member", gcName: currentGcName, userPrompt: rawPrompt, assistantReply: gcReply, isGroup });
			return await deliverAgentMessage(message, api, null, gcReply, [], uid, threadID);
		}
		if (naturalTask.type === "uptime_and_time") {
			const uptimeSec = Math.floor(process.uptime());
			const d = Math.floor(uptimeSec / 86400);
			const h = Math.floor((uptimeSec % 86400) / 3600);
			const m = Math.floor((uptimeSec % 3600) / 60);
			const s = uptimeSec % 60;
			const uptimeStr = `${d > 0 ? `${d}d ` : ""}${h}h ${m}m ${s}s`;
			const istTime = new Date().toLocaleString("en-US", {
				timeZone: "Asia/Kolkata",
				hour12: true,
				dateStyle: "medium",
				timeStyle: "medium"
			});
			const memMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
			const replyBody = `⏱️ Uptime: ${uptimeStr}\n🇮🇳 India Time: ${istTime}\n💾 Memory: ${memMb} MB`;
			return await deliverAgentMessage(message, api, null, replyBody, [], uid, threadID);
		}
		if (naturalTask.type === "delete_script") {
			if (effectiveRole < 2) {
				return await deliverAgentMessage(message, api, null, `⚠️ Only Admin or Owner can delete bot scripts.`, [], uid, threadID);
			}
			const delRes = await toolRegistry.deleteBotScript(naturalTask.target, savedRuntimeContext || execContext);
			if (delRes.ok) {
				return await deliverAgentMessage(message, api, null, `🗑️ Deleted script "${delRes.fileName}" and unloaded command.`, [], uid, threadID);
			}
			return await deliverAgentMessage(message, api, null, `⚠️ Failed to delete script: ${delRes.error}`, [], uid, threadID);
		}
		if (naturalTask.type === "ai_control") {
			if (effectiveRole < 1 && !userIdentity.isOwner) {
				return await deliverAgentMessage(message, api, null, `⚠️ Only Admin or Owner can change AI settings.`, [], uid, threadID);
			}
			if (naturalTask.action === "on") {
				setAiUsersEnabled(true);
				return await deliverAgentMessage(message, api, null, `✅ AI turned ON for all users.`, [], uid, threadID);
			}
			if (naturalTask.action === "off") {
				setAiUsersEnabled(false);
				return await deliverAgentMessage(message, api, null, `🔒 AI turned OFF for regular users (Admins remain active).`, [], uid, threadID);
			}
			if (naturalTask.action === "block") {
				const targetObj = await toolRegistry.findUserUid(naturalTask.target, event, api, threadsData, usersData);
				if (!targetObj || !targetObj.uid) {
					return await deliverAgentMessage(message, api, null, `⚠️ Specify a valid user UID, mention, or reply to block.`, [], uid, threadID);
				}
				if (targetObj.uid === toolRegistry.OWNER_UID) {
					return await deliverAgentMessage(message, api, null, `⚠️ Cannot block the bot Owner.`, [], uid, threadID);
				}
				blockUser(targetObj.uid, "Blocked by Admin", uid);
				return await deliverAgentMessage(message, api, null, `🚫 Blocked UID ${targetObj.uid} (${targetObj.name}) from using AI.`, [], uid, threadID);
			}
			if (naturalTask.action === "unblock") {
				const targetObj = await toolRegistry.findUserUid(naturalTask.target, event, api, threadsData, usersData);
				const targetUid = targetObj?.uid || naturalTask.target;
				if (unblockUser(targetUid)) {
					return await deliverAgentMessage(message, api, null, `✅ Unblocked UID ${targetUid} from AI.`, [], uid, threadID);
				}
				return await deliverAgentMessage(message, api, null, `⚠️ UID ${targetUid} is not in the blocked list.`, [], uid, threadID);
			}
			if (naturalTask.action === "status") {
				const s = loadAiSettings();
				const blockedCount = Object.keys(s.blockedUsers || {}).length;
				return await deliverAgentMessage(message, api, null, `⚙️ AI Status\n────────────\n• Enabled for users: ${s.enabledForUsers ? "YES" : "NO"}\n• Blocked users: ${blockedCount}`, [], uid, threadID);
			}
		}
		if (naturalTask.type === "immediate_tool") {
			await runCapturedSynthesizedCommand({
				commandName: naturalTask.command,
				args: naturalTask.args,
				execContext,
				userPrompt: rawPrompt,
				honorific,
				uid,
				prefix,
				thinkingMsg: null,
				message,
				api,
				threadID,
				monitorResponseTime: Boolean(naturalTask.monitorResponseTime),
				gcName: currentGcName,
				isGroup
			});
			return;
		}
		if (naturalTask.type === "manage_schedules") {
			return await handleScheduleManagement(
				naturalTask.subAction,
				naturalTask.scheduleId,
				threadID,
				message,
				userIdentity
			);
		}
		if (naturalTask.type === "schedule_once") {
			return await executeParsedQueenActions(
				[
					{
						action: "schedule_once",
						delaySeconds: naturalTask.delaySeconds,
						steps: naturalTask.steps
					}
				],
				options,
				userIdentity,
				null
			);
		}
		if (naturalTask.type === "schedule_workflow") {
			return await executeParsedQueenActions(
				[
					{
						action: "schedule_workflow",
						intervalSeconds: naturalTask.intervalSeconds,
						runImmediately: naturalTask.runImmediately,
						steps: naturalTask.steps
					}
				],
				options,
				userIdentity,
				null
			);
		}
		if (naturalTask.type === "run_workflow") {
			return await executeParsedQueenActions(
				[
					{
						action: "run_workflow",
						steps: naturalTask.steps
					}
				],
				options,
				userIdentity,
				null
			);
		}
	}

	if (!rawPrompt) {
		const greeting = userIdentity.isOwner
			? `👑 At your service, My Queen (${userIdentity.name})! Tell your Queen Bot what command to run, script to edit, or task to schedule, Boss.`
			: `👑 Hello ${userIdentity.name}! I am Queen Bot. Ask me anything, run any tool, or schedule a task!`;
		return await deliverAgentMessage(message, api, null, greeting, [], uid, threadID);
	}

	const thinking = await message.reply(
		userIdentity.isOwner
			? "👑 Working on it right away, My Queen..."
			: `🧠 Queen Bot is thinking, ${userIdentity.name}...`
	);
	if (thinking?.messageID) {
		recordAiMessageId(thinking.messageID, uid, threadID);
	}

	const systemInstruction = buildDynamicSystemPrompt(userIdentity);
	const recentHistory = getRecentHistoryContext({ threadID, uid, isGroup }, 1100);
	const replyContext = event?.messageReply?.body
		? `\n[Replied Message: "${String(event.messageReply.body).slice(0, 500)}"]`
		: "";

	const extractedImage = extractImageUrlFromContext(event, rawPrompt);
	let promptToUse = rawPrompt;
	if (extractedImage && (!promptToUse || /^(?:what(?:\s+is)?(?:\s+this)?(?:\s+image)?|describe|see|look|check|image\s+recognition)/i.test(promptToUse))) {
		promptToUse = "what is this image about short response no extra details";
	}

	const systemBanner =
		`[QUEENBOT AI AGENTIC CORE]\n` +
		`You are Queen Bot, an autonomous AI assistant powering QueenBotV3 on Facebook Messenger.\n` +
		`CRITICAL: Give short, simple, direct answers with no extra details unless asked.\n` +
		`When asked to run, check, or trigger ANY bot command, ALWAYS emit <QUEEN_ACTION>{"action":"run_tool","command":"<command>","args":[...]}</QUEEN_ACTION> (or multiple run_tool / run_workflow actions for chained tasks).\n` +
		`When asked about group chat history, topics, or members, answer using the Group ZSTD Memory Context provided below.\n` +
		`Never state that you cannot execute commands, access group logs, inspect member details, interact with messaging APIs, or monitor response times.`;

	const compositePrompt = [
		systemBanner,
		extractedImage ? `[Attached Image URL: ${extractedImage}]\n[Image Task]: Describe what is in this image. Keep response short and simple with no extra details.` : "",
		recentHistory ? `[Recent Chat & Group ZSTD Memory Context]:\n${recentHistory}\n` : "",
		`[User (${honorific}, UID: ${uid}${currentGcName ? `, GC: ${currentGcName}` : ""})]: ${promptToUse}${replyContext}`
	]
		.filter(Boolean)
		.join("\n");

	const activeModel = getUserModelPreference(uid);
	const apiRes = await callMeowGeminiApi({
		prompt: compositePrompt,
		uid,
		model: activeModel,
		system: systemInstruction,
		image: extractedImage
	});

	if (!apiRes.ok) {
		if (/(?:gc|group|chat|history|talking|discussing|admins?|members?)/i.test(rawPrompt) && isGroup) {
			const offlineGcReply = await resolveGroupHistoryReply({
				threadID,
				honorific,
				uid,
				userPrompt: rawPrompt
			});
			return await deliverAgentMessage(message, api, thinking, offlineGcReply, [], uid, threadID);
		}
		return await deliverAgentMessage(
			message,
			api,
			thinking,
			`⚠️ Sorry ${honorific}, Queen Bot encountered a connection issue: ${apiRes.error}`,
			[],
			uid,
			threadID
		);
	}

	const rawResponse = apiRes.response || "";
	const parsedActions = extractQueenActions(rawResponse);

	if (parsedActions.length > 0) {
		await executeParsedQueenActions(parsedActions, options, userIdentity, thinking);
		appendChatHistoryTurn({ threadID, uid, name: userIdentity?.name || "Member", gcName: currentGcName, userPrompt: rawPrompt, assistantReply: `[Executed Actions: ${parsedActions.map(a => a.action).join(", ")}]`, isGroup });
		return;
	}

	const isCapabilityRefusal =
		/(?:cannot|can't|do not have|don't have)\s+(?:execute|run|trigger|interact|access|live\s+access)/i.test(rawResponse) ||
		/interact with external messaging APIs/i.test(rawResponse) ||
		/monitor live system response times/i.test(rawResponse) ||
		/access to live Facebook/i.test(rawResponse) ||
		/retrieve a user's Facebook UID/i.test(rawResponse) ||
		/chat\s+logs|message\s+histor/i.test(rawResponse) ||
		/don't have access to your group's chat history or member details/i.test(rawResponse) ||
		/don't have access to live Messenger group member profiles/i.test(rawResponse) ||
		/access to.*(?:member|profile|account details|chat history|group)/i.test(rawResponse);

	if (isCapabilityRefusal) {
		if (/(?:chat\s+history|gc\s+history|talking\s+about|discussing|happened\s+in\s+gc|message\s+history)/i.test(rawPrompt)) {
			const gcReply = await resolveGroupHistoryReply({ threadID, honorific, uid, userPrompt: rawPrompt });
			return await deliverAgentMessage(message, api, thinking, gcReply, [], uid, threadID);
		}
		if (/(?:admins?|how\s+many\s+members|group\s+info|gc\s+info)/i.test(rawPrompt)) {
			const gInfoReply = await resolveGroupInfoReply({ threadID, api, threadsData, honorific, uid, userPrompt: rawPrompt });
			return await deliverAgentMessage(message, api, thinking, gInfoReply, [], uid, threadID);
		}
		if (/(?:details|profile|info|who\s+is|who's|who\s+are)/i.test(rawPrompt)) {
			const card = await toolRegistry.getUserDetailsCard({
				query: rawPrompt,
				event,
				api,
				threadsData,
				usersData
			});
			if (card && card.ok && card.body) {
				const attachments = card.attachment ? [card.attachment] : [];
				return await deliverAgentMessage(message, api, thinking, card.body, attachments, uid, threadID);
			}
		}
		if (/(?:uid|whois)/i.test(rawPrompt)) {
			const uidRes = await toolRegistry.findUserUid(rawPrompt, event, api, threadsData, usersData);
			if (uidRes && uidRes.uid) {
				return await deliverAgentMessage(message, api, thinking, `🆔 UID: ${uidRes.uid} (${uidRes.name})`, [], uid, threadID);
			}
		}
		const extracted = extractCommandStepFromChainClause(rawPrompt, true);
		if (extracted && extracted.command) {
			await runCapturedSynthesizedCommand({
				commandName: extracted.command,
				args: extracted.args,
				execContext,
				userPrompt: rawPrompt,
				honorific,
				uid,
				prefix,
				thinkingMsg: thinking,
				message,
				api,
				threadID,
				monitorResponseTime: /response\s+time|latency/i.test(rawPrompt),
				gcName: currentGcName,
				isGroup
			});
			return;
		}
	}

	const cleanReply = sanitizeAndFormatOutput(rawResponse);
	await deliverAgentMessage(
		message,
		api,
		thinking,
		cleanReply || `✨ Done, ${honorific}!`,
		[],
		uid,
		threadID
	);
	appendChatHistoryTurn({ threadID, uid, name: userIdentity?.name || "Member", gcName: currentGcName, userPrompt: rawPrompt, assistantReply: cleanReply, isGroup });
}

const QueenAIGlobalBridge = {
	version: "9.3.0",
	author: "Priyanshi Kaur",
	ownerUid: toolRegistry.OWNER_UID,
	platform: "QueenBotV3",
	loadTrainData: toolRegistry.loadEncryptedTrainData,
	syncTools: toolRegistry.syncCommandTools,
	resolveUserIdentity: toolRegistry.resolveUserIdentity,
	formatForMessenger: sanitizeAndFormatOutput,
	checkJailbreakOrPromptInjection: checkJailbreakAttempt,
	transformOutgoingMessage,
	setCommandResponseRule,
	getCommandResponseRules: loadResponseRules,
	isAiMessage: (messageID) => Boolean(getAiMessageMeta(messageID)),
	getAiMessageMeta,
	restoreAllSchedules,
	handleQueenAgentTurn,
	loadAiSettings,
	saveAiSettings,
	isUserBlocked,
	isAiEnabledForUser,
	blockUser,
	unblockUser,
	setAiUsersEnabled,
	extractImageUrlFromContext,
	callMeowGeminiApi,
	findUserUid: toolRegistry.findUserUid,
	getUserDetailsCard: toolRegistry.getUserDetailsCard,
	cleanPersonQuery: toolRegistry.cleanPersonQuery,
	appendChatHistoryTurn,
	getRecentHistoryContext,
	passiveGroupMemoryRecord,
	groupMemoryGetContext: (threadID) => groupMemory ? groupMemory.getGroupContext(threadID, 60) : "",
	groupMemoryGetMeta: (threadID) => groupMemory ? groupMemory.getGroupMeta(threadID) : null,
	groupMemoryGetMember: (threadID, query) => groupMemory ? groupMemory.getMemberMemory(threadID, query) : null,
	groupMemorySearch: (threadID, query, limit = 25) => groupMemory ? groupMemory.searchGroupMemory(threadID, query, limit) : [],
	groupMemoryListGroups: () => groupMemory ? groupMemory.listKnownGroups() : [],
	groupMemoryClear: (threadID) => groupMemory ? groupMemory.clearGroupMemory(threadID) : false,
	deleteBotScript: toolRegistry.deleteBotScript,
	handleReplyFallback: async (context) => {
		const { event } = context || {};
		const userText = typeof event?.body === "string" ? event.body.trim() : "";
		if (!userText && (!event?.attachments || event.attachments.length === 0)) return false;
		await handleQueenAgentTurn({ ...context, prompt: userText });
		return true;
	}
};

global.QueenAI = QueenAIGlobalBridge;

module.exports = QueenAIGlobalBridge;