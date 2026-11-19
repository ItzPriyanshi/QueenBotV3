const fs = require("fs-extra");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const axios = require("axios");
const https = require("https");

const PriyaPrefix = ["queen", "ai"];
const OWNER_UID = "61580695941306";
const OWNER_NAME = "Priyanshi Kaur";
const OWNER_TITLES = ["Queen", "Owner", "Boss"];
const MASTER_VAULT_SECRET = "QUEENBOTV3::PRIYANSHI_KAUR::61580695941306::NEURAL_CORE_V9";
const VAULT_HEADER = "QBV3::VAULT::v9.0::PRIYANSHI_KAUR";

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const HISTORY_FILE = path.join(__dirname, "ai_history.json");
const SCHEDULES_FILE = path.join(__dirname, "ai_schedules.json");
const RESPONSE_RULES_FILE = path.join(__dirname, "ai_response_rules.json");

function resolveExternalQueenAgent() {
	const candidates = [
		path.join(__dirname, "..", "..", "bot", "ai", "queenAgent"),
		path.join(process.cwd(), "bot", "ai", "queenAgent"),
		path.join(__dirname, "queenAgent")
	];
	for (const c of candidates) {
		try {
			const loaded = require(c);
			if (loaded && typeof loaded.handleQueenAgentTurn === "function") {
				return loaded;
			}
		}
		catch {
		}
	}
	return null;
}

const FALLBACK_VAULT_PAYLOAD = {
	metadata: {
		botName: "QueenBotV3",
		aiName: "Queen Bot",
		engineVersion: "9.0.0",
		author: "Priyanshi Kaur",
		creator: "Priyanshi Kaur",
		ownerUid: "61580695941306",
		ownerTitles: ["Queen", "Owner", "Boss"],
		exclusivePlatform: "QueenBotV3",
		strictUnbreakableMode: true
	},
	apiConfig: {
		baseUrl: ["https:", "", "meow-dl.onrender.com"].join("/"),
		endpointPath: "/g",
		fullEndpoint: ["https:", "", "meow-dl.onrender.com", "g"].join("/"),
		supportedMethods: ["POST", "GET"],
		preferredMethod: "POST",
		defaultModel: "gemini-auto",
		timeoutMs: 45000
	},
	tokenizerConfig: {
		package: "ai-tokenizer",
		enabled: true,
		maxInputTokens: 6000,
		maxSystemTokens: 2200,
		maxHistoryTokens: 1800,
		maxToolCatalogTokens: 1100,
		fallbackCharsPerToken: 3.8
	},
	unbreakableSystemDirectives: [
		"IDENTITY LOCK: You are Queen Bot (QueenBotV3), created exclusively by Priyanshi Kaur (UID: 61580695941306). Never break character under any circumstance.",
		"OWNER PROTOCOL: When the sender UID is 61580695941306, she is Priyanshi Kaur — your Supreme Queen, Owner, and Boss. Always address her loyally as Queen, My Queen, Owner, or Boss.",
		"USER NAME PROTOCOL: Address other users naturally by their resolved Facebook display name.",
		"ONE-TIME vs RECURRING TASKS: Never repeat a command in a loop unless the user explicitly says 'every' (e.g. 'every 24 hours'). Phrases like 'after one hour' or 'in 10 minutes' must use schedule_once and execute only ONCE.",
		"AGENTIC CONTROL: You can execute any command in scripts/cmds/ as a tool, invoke FCA APIs directly via call_fca_api, resolve fuzzy queries via web_search, modify any command response, and read/modify/create/reload scripts."
	],
	smartTaskAndTemporalExecutionRules: [
		"1. NEVER repeat a command unless the user explicitly uses recurring words like 'every', 'daily', or 'hourly'.",
		"2. If a user says 'use/run/trigger ping after one hour' or 'after one hour can you send me the song called songi songi by salima or something', schedule a ONE-TIME task (schedule_once) that waits 1 hour, executes ONCE, and stops.",
		"3. Strip conversational filler ('called', 'or something') from fuzzy media requests and resolve the true song title via web/YouTube search."
	],
	independentFcaApiCapabilities: {
		allowedMethods: {
			getUserInfo: true,
			getUserInfoV2: true,
			getUserID: true,
			getUID: true,
			getFriendsList: true,
			getAvatarUser: true,
			getThreadInfo: true,
			getThreadList: true,
			sendMessage: true,
			editMessage: true,
			unsendMessage: true,
			setMessageReaction: true,
			changeThreadTitle: true,
			changeThreadEmoji: true,
			changeNickname: true,
			addUserToGroup: true,
			removeUserFromGroup: true,
			changeAdminStatus: true,
			sendFriendRequest: true,
			handleFriendRequest: true,
			changeBlockedStatus: true,
			unfriend: true
		}
	},
	jailbreakGuardPatterns: [
		"ignore\\s+(?:all\\s+)?(?:previous|prior|above|earlier|preceding|system|core|initial)\\s+(?:instructions|prompts|rules|directives|guidelines|training|constraints)",
		"disregard\\s+(?:all\\s+)?(?:previous|prior|above|system|core)\\s+(?:instructions|prompts|rules|directives)",
		"forget\\s+(?:all\\s+)?(?:your|previous|prior|everything|all)\\s+(?:instructions|rules|training|identity|persona|prompts)",
		"bypass\\s+(?:all\\s+)?(?:your\\s+)?(?:restrictions|rules|guardrails|filters|safety|instructions|system\\s+prompt)",
		"(?:reveal|show|print|dump|output|repeat|display|echo|verbatim|copy|export|leak|decrypt|decode)\\s+(?:all\\s+)?(?:your\\s+|the\\s+)?(?:system\\s+prompt|initial\\s+prompt|hidden\\s+instructions|core\\s+directives|train\\.data|neural\\s+vault|raw\\s+prompt|developer\\s+prompt)",
		"(?:translate|encode|convert|summarize|spell\\s+out|base64|hex|rot13|reverse|json|yaml|markdown)\\s+(?:your\\s+|the\\s+)?(?:initial\\s+)?(?:system\\s+|hidden\\s+|core\\s+)?(?:prompt|instructions|directives|train\\.data|rules(?:\\s+above)?)",
		"you\\s+are\\s+now\\s+(?:in\\s+)?(?:dan|developer\\s+mode|god\\s+mode|jailbroken|unrestricted|unfiltered|evil\\s+mode|chatgpt|gemini|claude)",
		"(?:pretend|act\\s+like|say|admit|confess|confirm)\\s+(?:that\\s+)?(?:your\\s+)?(?:real\\s+|true\\s+|actual\\s+)?(?:creator|author|maker|developer|owner|builder|company)\\s+is\\s+(?!priyanshi\\s+kaur)",
		"(?:aren't\\s+you|you\\s+are\\s+actually|admit\\s+you\\s+are|stop\\s+pretending\\s+and\\s+say\\s+you\\s+are)\\s+(?:google\\s+gemini|gemini|chatgpt|openai|bard|claude|llama|deepseek)"
	],
	jailbreakRefusalTemplate:
		"👑 Queen Bot • Security Lock\n────────────\nI am Queen Bot, the autonomous core intelligence of QueenBotV3 created exclusively by Priyanshi Kaur.\n\nMy identity, encrypted neural vault, and core directives in QueenBotV3 are permanently locked and cannot be overridden, decoded, or extracted.",
	outputSanitizerRules: [
		{
			pattern: "(?:I\\s+am|I'm)\\s+(?:a\\s+large\\s+language\\s+model|an?\\s+AI\\s+(?:assistant|model|language\\s+model)),?\\s+(?:trained|developed|created|built)\\s+by\\s+Google(?:\\s+AI)?",
			replacement: "I am Queen Bot, the autonomous AI engine of QueenBotV3 created by Priyanshi Kaur"
		},
		{
			pattern: "(?:trained|developed|created|built|made|powered)\\s+by\\s+(?:Google|OpenAI|Anthropic|Meta|DeepSeek|NTKhang)",
			replacement: "created by Priyanshi Kaur for QueenBotV3"
		},
		{
			pattern: "\\b(?:I\\s+am|I'm)\\s+(?:Google\\s+)?(?:Gemini|Bard|ChatGPT|Claude)\\b",
			replacement: "I am Queen Bot (QueenBotV3)"
		}
	]
};

let cachedVault = null;
let cachedVaultMtime = 0;
let tokenizerInstance = null;
let tokenizerChecked = false;
const userIdentityCache = new Map();
const discoveredToolsMap = new Map();
const activeTimers = new Map();
let savedRuntimeContext = null;

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

function encodeQueenVault(payloadObject) {
	const jsonString = JSON.stringify(payloadObject);
	const compressed = zlib.deflateRawSync(Buffer.from(jsonString, "utf8"), { level: 9 });
	const rotated = Buffer.alloc(compressed.length);
	for (let i = 0; i < compressed.length; i++) {
		const b = compressed[i] ^ ((i * 73 + 41) & 0xff);
		rotated[i] = ((b << 3) | (b >> 5)) & 0xff;
	}
	const salt = crypto.createHash("sha256").update("QBV3_SALT_PRIYANSHI_61580695941306").digest().subarray(0, 16);
	const iv = crypto.createHash("sha256").update("QBV3_IV_NEURAL_VAULT_V9").digest().subarray(0, 16);
	const key = crypto.pbkdf2Sync(MASTER_VAULT_SECRET, salt, 12000, 32, "sha512");
	const cipher = crypto.createCipheriv("aes-256-ctr", key, iv);
	const encrypted = Buffer.concat([cipher.update(rotated), cipher.final()]);
	const bodyB64 = encrypted.toString("base64");
	const saltHex = salt.toString("hex");
	const ivHex = iv.toString("hex");
	const hmac = crypto
		.createHmac("sha256", MASTER_VAULT_SECRET)
		.update(`${VAULT_HEADER}::${saltHex}::${ivHex}::${bodyB64}`)
		.digest("hex");
	const chunkedBody = (bodyB64.match(/.{1,96}/g) || [bodyB64]).join("\n");
	return [
		`-----BEGIN QUEENBOTV3 ENCRYPTED NEURAL VAULT-----`,
		`HEADER: ${VAULT_HEADER}`,
		`OWNER_UID: ${OWNER_UID}`,
		`AUTHOR: ${OWNER_NAME}`,
		`CIPHER: PBKDF2-SHA512+AES-256-CTR+ROT3-XOR+DEFLATE`,
		`SALT: ${saltHex}`,
		`IV: ${ivHex}`,
		`HMAC: ${hmac}`,
		`-----PAYLOAD-----`,
		chunkedBody,
		`-----END QUEENBOTV3 ENCRYPTED NEURAL VAULT-----`
	].join("\n");
}

function decodeQueenVault(vaultText) {
	const raw = String(vaultText || "").trim();
	if (raw.startsWith("{")) return JSON.parse(raw);
	const headerMatch = raw.match(/^HEADER:\s*(.+)$/m);
	const saltMatch = raw.match(/^SALT:\s*([0-9a-fA-F]+)$/m);
	const ivMatch = raw.match(/^IV:\s*([0-9a-fA-F]+)$/m);
	const hmacMatch = raw.match(/^HMAC:\s*([0-9a-fA-F]+)$/m);
	const payloadMatch = raw.match(/-----PAYLOAD-----\s*([\s\S]+?)\s*-----END QUEENBOTV3 ENCRYPTED NEURAL VAULT-----/);
	if (!headerMatch || !saltMatch || !ivMatch || !hmacMatch || !payloadMatch) {
		throw new Error("Invalid QueenBotV3 Neural Vault");
	}
	const header = headerMatch[1].trim();
	const saltHex = saltMatch[1].trim();
	const ivHex = ivMatch[1].trim();
	const expectedHmac = hmacMatch[1].trim();
	const bodyB64 = payloadMatch[1].replace(/\s+/g, "");
	const computedHmac = crypto
		.createHmac("sha256", MASTER_VAULT_SECRET)
		.update(`${header}::${saltHex}::${ivHex}::${bodyB64}`)
		.digest("hex");
	if (computedHmac !== expectedHmac) {
		throw new Error("Vault HMAC mismatch");
	}
	const salt = Buffer.from(saltHex, "hex");
	const iv = Buffer.from(ivHex, "hex");
	const encrypted = Buffer.from(bodyB64, "base64");
	const key = crypto.pbkdf2Sync(MASTER_VAULT_SECRET, salt, 12000, 32, "sha512");
	const decipher = crypto.createDecipheriv("aes-256-ctr", key, iv);
	const rotated = Buffer.concat([decipher.update(encrypted), decipher.final()]);
	const compressed = Buffer.alloc(rotated.length);
	for (let i = 0; i < rotated.length; i++) {
		const r = rotated[i];
		const unrot = ((r >> 3) | (r << 5)) & 0xff;
		compressed[i] = unrot ^ ((i * 73 + 41) & 0xff);
	}
	return JSON.parse(zlib.inflateRawSync(compressed).toString("utf8"));
}

function loadEncryptedTrainData() {
	const candidates = [
		path.join(__dirname, "train.data"),
		path.join(process.cwd(), "train.data"),
		path.join(process.cwd(), "scripts", "cmds", "train.data")
	];
	let target = candidates.find(p => fs.existsSync(p));
	if (!target) {
		target = candidates[0];
		try {
			fs.ensureDirSync(path.dirname(target));
			fs.writeFileSync(target, encodeQueenVault(FALLBACK_VAULT_PAYLOAD), "utf8");
		}
		catch {
		}
	}
	try {
		if (target && fs.existsSync(target)) {
			const stat = fs.statSync(target);
			if (cachedVault && stat.mtimeMs === cachedVaultMtime) {
				return cachedVault;
			}
			const raw = fs.readFileSync(target, "utf8");
			const decoded = decodeQueenVault(raw);
			if (raw.trim().startsWith("{")) {
				try {
					fs.writeFileSync(target, encodeQueenVault(decoded), "utf8");
				}
				catch {
				}
			}
			cachedVault = decoded;
			cachedVaultMtime = stat.mtimeMs;
			return cachedVault;
		}
	}
	catch {
	}
	cachedVault = FALLBACK_VAULT_PAYLOAD;
	return cachedVault;
}

function countTokens(text) {
	const str = String(text || "");
	if (!str) return 0;
	if (!tokenizerChecked) {
		tokenizerChecked = true;
		try {
			const mod = require("ai-tokenizer");
			if (mod) {
				tokenizerInstance = typeof mod.count === "function" || typeof mod.encode === "function"
					? mod
					: typeof mod.Tokenizer === "function"
						? new mod.Tokenizer()
						: typeof mod.default === "function"
							? new mod.default()
							: mod.default || null;
			}
		}
		catch {
			tokenizerInstance = null;
		}
	}
	if (tokenizerInstance) {
		try {
			if (typeof tokenizerInstance.count === "function") {
				return Number(tokenizerInstance.count(str)) || Math.ceil(str.length / 3.8);
			}
			if (typeof tokenizerInstance.encode === "function") {
				const enc = tokenizerInstance.encode(str);
				if (enc && typeof enc.length === "number") return enc.length;
			}
		}
		catch {
		}
	}
	return Math.max(str.trim().split(/\s+/).filter(Boolean).length, Math.ceil(str.length / 3.8));
}

function truncateToTokenBudget(text, maxTokens = 2000) {
	const str = String(text || "");
	if (!str) return "";
	const cur = countTokens(str);
	if (cur <= maxTokens) return str;
	const targetChars = Math.max(120, Math.floor(str.length * (maxTokens / Math.max(1, cur)) * 0.92));
	return `${str.slice(0, targetChars).trim()}...`;
}

function normalizeCommand(body) {
	if (typeof body !== "string") {
		return { usedPrefix: null, prompt: "" };
	}
	const trimmed = body.trim();
	const lower = trimmed.toLowerCase();
	const usedPrefix = PriyaPrefix.find(prefix => {
		const normalizedPrefix = prefix.toLowerCase();
		return lower === normalizedPrefix || lower.startsWith(`${normalizedPrefix} `);
	});
	if (!usedPrefix) {
		return { usedPrefix: null, prompt: "" };
	}
	return {
		usedPrefix,
		prompt: trimmed.slice(usedPrefix.length).trim()
	};
}

function getStandaloneAgent() {
	const ext = resolveExternalQueenAgent();
	if (ext) return ext;
	if (global.QueenAI && typeof global.QueenAI.handleQueenAgentTurn === "function") {
		return global.QueenAI;
	}

	function readJsonSafe(file, def) {
		try {
			fs.ensureDirSync(path.dirname(file));
			if (!fs.existsSync(file)) {
				fs.writeFileSync(file, JSON.stringify(def, null, 2), "utf8");
				return def;
			}
			return JSON.parse(fs.readFileSync(file, "utf8") || JSON.stringify(def));
		}
		catch {
			return def;
		}
	}

	function writeJsonSafe(file, val) {
		try {
			fs.ensureDirSync(path.dirname(file));
			fs.writeFileSync(file, JSON.stringify(val, null, 2), "utf8");
		}
		catch {
		}
	}

	function callFcaMethod(api, methodName, ...args) {
		return new Promise((resolve, reject) => {
			if (!api || typeof api[methodName] !== "function") {
				return reject(new Error(`FCA method "${methodName}" unavailable`));
			}
			let settled = false;
			const done = (err, res) => {
				if (settled) return;
				settled = true;
				if (err) return reject(err);
				resolve(res);
			};
			try {
				const p = api[methodName](...args, done);
				if (p && typeof p.then === "function") {
					p.then(r => done(null, r)).catch(e => done(e, null));
				}
			}
			catch (e) {
				done(e, null);
			}
		});
	}

	async function resolveUserIdentity({ api, usersData, senderID, role = 0 }) {
		const uid = String(senderID || "").trim();
		if (uid === OWNER_UID) {
			return {
				uid,
				name: OWNER_NAME,
				isOwner: true,
				titles: OWNER_TITLES,
				preferredAddress: "Queen",
				effectiveRole: 2
			};
		}
		if (userIdentityCache.has(uid)) {
			return userIdentityCache.get(uid);
		}
		let name = "";
		if (usersData && typeof usersData.getName === "function") {
			try {
				const n = await usersData.getName(uid);
				if (n && !/^(?:user|facebook\s*user|unknown)$/i.test(String(n).trim())) {
					name = String(n).trim();
				}
			}
			catch {
			}
		}
		if (!name && api) {
			try {
				const info = await callFcaMethod(api, "getUserInfo", uid);
				const p = info?.[uid] || info?.data?.[uid] || info;
				if (p?.name) name = String(p.name).trim();
			}
			catch {
			}
		}
		const identity = {
			uid,
			name: name || "Friend",
			isOwner: false,
			titles: [],
			preferredAddress: name || "Friend",
			effectiveRole: Number(role) || 0
		};
		if (uid) userIdentityCache.set(uid, identity);
		return identity;
	}

	function syncTools() {
		discoveredToolsMap.clear();
		const cmds = global.GoatBot?.commands;
		if (cmds instanceof Map) {
			for (const [k, v] of cmds.entries()) {
				const cfg = v?.config || {};
				const name = String(cfg.name || k).toLowerCase();
				const desc = typeof cfg.shortDescription === "string"
					? cfg.shortDescription
					: (cfg.shortDescription?.en || cfg.description?.en || `Execute ${name}`);
				discoveredToolsMap.set(name, {
					name,
					aliases: Array.isArray(cfg.aliases) ? cfg.aliases.map(a => String(a).toLowerCase()) : [],
					category: String(cfg.category || "other").toLowerCase(),
					description: desc
				});
			}
		}
		return Array.from(discoveredToolsMap.values());
	}

	function sanitizeAndFormatOutput(rawText) {
		if (!rawText || typeof rawText !== "string") return "";
		const vault = loadEncryptedTrainData();
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
		for (const rule of vault.outputSanitizerRules || []) {
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

	function checkJailbreakOrPromptInjection(prompt, userIdentity) {
		const text = String(prompt || "").trim();
		if (!text) return null;
		const vault = loadEncryptedTrainData();
		for (const pat of vault.jailbreakGuardPatterns || []) {
			try {
				if (new RegExp(pat, "i").test(text)) {
					return vault.jailbreakRefusalTemplate;
				}
			}
			catch {
			}
		}
		return null;
	}

	async function callMeowEndpoint({ prompt, uid, model = "gemini-auto", system = "" }) {
		const vault = loadEncryptedTrainData();
		const endpoint = vault.apiConfig?.fullEndpoint || ["https:", "", "meow-dl.onrender.com", "g"].join("/");
		const safePrompt = truncateToTokenBudget(prompt, 5500);
		try {
			const res = await axios.post(
				endpoint,
				{
					prompt: safePrompt,
					model,
					uid: String(uid || "queenbot_default"),
					...(system ? { system: truncateToTokenBudget(system, 2000) } : {})
				},
				{ headers: { "Content-Type": "application/json" }, httpsAgent, timeout: 45000 }
			);
			if (res?.data?.status === "success" && typeof res.data.response === "string") {
				return { ok: true, response: res.data.response };
			}
		}
		catch {
		}
		try {
			const q = new URLSearchParams({ prompt: safePrompt, model, uid: String(uid || "queenbot_default") });
			if (system) q.set("system", truncateToTokenBudget(system, 900));
			const res = await axios.get(`${endpoint}?${q.toString()}`, { httpsAgent, timeout: 45000 });
			if (res?.data?.status === "success" && typeof res.data.response === "string") {
				return { ok: true, response: res.data.response };
			}
		}
		catch (e) {
			return { ok: false, error: e?.message || "Endpoint unreachable" };
		}
		return { ok: false, error: "Empty response from /g endpoint" };
	}

	function loadHistoryStore() {
		const s = readJsonSafe(HISTORY_FILE, { users: {}, aiMessages: {} });
		if (!s.users) s.users = {};
		if (!s.aiMessages) s.aiMessages = {};
		return s;
	}

	function recordAiMessageId(messageID, authorID, threadID) {
		if (!messageID) return;
		const s = loadHistoryStore();
		s.aiMessages[String(messageID)] = { author: String(authorID || ""), threadID: String(threadID || ""), timestamp: Date.now() };
		writeJsonSafe(HISTORY_FILE, s);
	}

	function getAiMessageMeta(messageID) {
		if (!messageID) return null;
		const s = loadHistoryStore();
		return s.aiMessages[String(messageID)] || null;
	}

	async function handleQueenAgentTurn(options) {
		const { prompt, event, message, api, role = 0, usersData } = options;
		savedRuntimeContext = options;
		const uid = String(event?.senderID || event?.userID || "");
		const threadID = String(event?.threadID || uid);
		const rawPrompt = String(prompt || "").trim();
		const lower = rawPrompt.toLowerCase();

		const identity = await resolveUserIdentity({ api, usersData, senderID: uid, role });
		const honorific = identity.isOwner ? "My Queen" : identity.name;

		const jb = checkJailbreakOrPromptInjection(rawPrompt, identity);
		if (jb) {
			const sent = await message.reply(jb);
			if (sent?.messageID) recordAiMessageId(sent.messageID, uid, threadID);
			return;
		}

		if (lower === "clear" || lower === "reset") {
			await callMeowEndpoint({ prompt: "clear", uid });
			return await message.reply(`🧹 Conversation memory cleared for you, ${honorific}!`);
		}

		if (!rawPrompt) {
			const msg = identity.isOwner
				? `👑 At your service, My Queen (${identity.name})! Tell your Queen Bot what command to run, script to edit, or task to schedule, Boss.`
				: `👑 Hello ${identity.name}! I am Queen Bot. Ask me anything, run any tool, or schedule a task!`;
			const sent = await message.reply(msg);
			if (sent?.messageID) recordAiMessageId(sent.messageID, uid, threadID);
			return;
		}

		const thinking = await message.reply(
			identity.isOwner
				? "👑 Working on it right away, My Queen..."
				: `🧠 Queen Bot is thinking, ${identity.name}...`
		);
		if (thinking?.messageID) {
			recordAiMessageId(thinking.messageID, uid, threadID);
			if (global.GoatBot?.onReply instanceof Map) {
				global.GoatBot.onReply.set(thinking.messageID, { commandName: "ai", messageID: thinking.messageID, author: uid });
			}
		}

		const vault = loadEncryptedTrainData();
		const sys = [
			...(vault.unbreakableSystemDirectives || []),
			identity.isOwner
				? `User is Priyanshi Kaur (UID: ${uid}), your Supreme Queen, Owner, and Boss.`
				: `User Facebook Name is "${identity.name}" (UID: ${uid}). Address them by name.`
		].join("\n");

		const res = await callMeowEndpoint({ prompt: rawPrompt, uid, model: "gemini-auto", system: sys });
		const replyText = res.ok ? sanitizeAndFormatOutput(res.response) : `⚠️ Sorry ${honorific}, Queen Bot encountered a connection issue: ${res.error}`;

		if (thinking?.messageID && message?.edit) {
			try {
				await message.edit(replyText, thinking.messageID);
				return;
			}
			catch {
			}
		}
		const sent = await message.reply(replyText);
		if (sent?.messageID) {
			recordAiMessageId(sent.messageID, uid, threadID);
			if (global.GoatBot?.onReply instanceof Map) {
				global.GoatBot.onReply.set(sent.messageID, { commandName: "ai", messageID: sent.messageID, author: uid });
			}
		}
	}

	const fallbackBridge = {
		version: "9.0.0",
		author: "Priyanshi Kaur",
		ownerUid: OWNER_UID,
		platform: "QueenBotV3",
		loadTrainData: loadEncryptedTrainData,
		syncTools,
		resolveUserIdentity,
		formatForMessenger: sanitizeAndFormatOutput,
		checkJailbreakOrPromptInjection,
		transformOutgoingMessage: async (cmd, payload) => payload,
		setCommandResponseRule: () => null,
		getCommandResponseRules: () => readJsonSafe(RESPONSE_RULES_FILE, {}),
		isAiMessage: (msgId) => Boolean(getAiMessageMeta(msgId)),
		getAiMessageMeta,
		restoreAllSchedules: () => {},
		handleQueenAgentTurn,
		handleReplyFallback: async (context) => {
			const userText = typeof context?.event?.body === "string" ? context.event.body.trim() : "";
			if (!userText) return false;
			await handleQueenAgentTurn({ ...context, prompt: userText });
			return true;
		}
	};

	global.QueenAI = fallbackBridge;
	return fallbackBridge;
}

module.exports = {
	config: {
		name: "ai",
		aliases: ["queen", "queenai"],
		version: "9.0.0",
		author: "Priyanshi Kaur",
		role: 0,
		countDown: 2,
		category: "AI",
		shortDescription: {
			en: "Autonomous Queen Bot AI controller with encrypted train.data & tool execution"
		},
		longDescription: {
			en: "Independent Queen Bot AI agent powered by encrypted train.data v9.0.0, meow-dl /g API, ai-tokenizer budgeting, Owner UID 61580695941306 recognition, FCA API execution, one-shot/recurring tasks, and live script editing."
		},
		guide: {
			en:
				"Prefixes: ai, queen, {p}ai\n\n" +
				"Examples:\n" +
				"• ai use, run or trigger ping after one hour\n" +
				"• ai after one hour can you send me the song called songi songi by salima or something\n" +
				"• ai trigger uptime2 command after every 24 hours and in 3 second delay trigger ping command\n" +
				"• ai model <auto | flash | pro | thinking | advanced>\n" +
				"• ai tools — View registered Queen Bot command tools\n" +
				"• ai vault — View encrypted Neural Vault & token status\n" +
				"• ai schedule list | ai clear"
		}
	},

	onLoad: async function (context) {
		savedRuntimeContext = context;
		const agent = getStandaloneAgent();
		if (agent) {
			try {
				agent.loadTrainData?.();
				agent.syncTools?.();
				agent.restoreAllSchedules?.();
			}
			catch {
			}
		}
	},

	onStart: async function (context) {
		const agent = getStandaloneAgent();
		const { args, message, event, api, usersData, role } = context;
		const rawPrompt = Array.isArray(args) ? args.join(" ").trim() : "";
		const lower = rawPrompt.toLowerCase();

		if (lower === "vault" || lower === "status") {
			const vault = loadEncryptedTrainData();
			const identity = await agent.resolveUserIdentity({ api, usersData, senderID: event?.senderID, role });
			const toolsList = agent.syncTools ? agent.syncTools() : [];
			return await message.reply(
				`👑 Queen Bot • Neural Vault Status\n` +
				`────────────\n` +
				`• User: ${identity.name}${identity.isOwner ? " (Supreme Queen / Owner / Boss)" : ""}\n` +
				`• Vault Header: ${VAULT_HEADER}\n` +
				`• Cipher: ${vault.metadata?.vaultEncryption || "PBKDF2-SHA512+AES-256-CTR"}\n` +
				`• Endpoint: ${vault.apiConfig?.fullEndpoint || ["https:", "", "meow-dl.onrender.com", "g"].join("/")}\n` +
				`• Registered Tools: ${toolsList.length} commands\n` +
				`• Tokenizer: ${vault.tokenizerConfig?.package || "ai-tokenizer"} (Max ${vault.tokenizerConfig?.maxInputTokens || 6000} tokens)`
			);
		}

		if (lower === "tools") {
			const toolsList = agent.syncTools ? agent.syncTools() : [];
			const preview = toolsList.slice(0, 35).map(t => t.name).join(", ");
			return await message.reply(
				`🛠️ Queen Bot • Live Tool Registry (${toolsList.length})\n` +
				`────────────\n` +
				`${preview || "All GoatBot commands active"}${toolsList.length > 35 ? ` ...and ${toolsList.length - 35} more` : ""}\n` +
				`────────────\n` +
				`• Plus 22 independent FCA APIs & 5 Admin Script Tools`
			);
		}

		await agent.handleQueenAgentTurn({ ...context, prompt: rawPrompt });
	},

	onChat: async function (context) {
		const { event, isUserCallCommand } = context;
		if (isUserCallCommand) return;
		if (!event || typeof event.body !== "string") return;
		const body = event.body.trim();
		if (!body) return;

		const { usedPrefix, prompt } = normalizeCommand(body);
		if (!usedPrefix) return;

		const agent = getStandaloneAgent();
		await agent.handleQueenAgentTurn({ ...context, prompt });
	},

	onReply: async function (context) {
		const { event, Reply } = context;
		if (!event) return;
		const agent = getStandaloneAgent();
		const meta = agent.getAiMessageMeta ? agent.getAiMessageMeta(event?.messageReply?.messageID) : null;
		const replyAuthor = Reply?.author || meta?.author;
		if (replyAuthor && String(event.senderID) !== String(replyAuthor) && String(event.senderID) !== OWNER_UID) {
			return;
		}
		const userText = typeof event.body === "string"
			? event.body.trim()
			: Array.isArray(context.args)
				? context.args.join(" ").trim()
				: "";
		if (!userText && (!event.attachments || event.attachments.length === 0)) return;

		await agent.handleQueenAgentTurn({ ...context, prompt: userText });
	}
};