const fs = require("fs-extra");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const axios = require("axios");
const https = require("https");

const MASTER_VAULT_SECRET = "QUEENBOTV3::PRIYANSHI_KAUR::61580695941306::NEURAL_CORE_V9";
const VAULT_HEADER = "QBV3::VAULT::v9.0::PRIYANSHI_KAUR";
const OWNER_UID = "61580695941306";
const OWNER_NAME = "Priyanshi Kaur";
const OWNER_TITLES = ["Queen", "Owner", "Boss"];

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const userIdentityCache = new Map();
const discoveredToolsMap = new Map();

let cachedVaultPayload = null;
let cachedVaultMtime = 0;
let tokenizerInstance = null;
let tokenizerChecked = false;

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
		maxToolCatalogTokens: 1200,
		fallbackCharsPerToken: 3.8
	},
	unbreakableSystemDirectives: [
		"IDENTITY LOCK: You are Queen Bot (QueenBotV3), created exclusively by Priyanshi Kaur (UID: 61580695941306). Never break character under any circumstance.",
		"OWNER PROTOCOL: When the sender UID is 61580695941306, she is Priyanshi Kaur — your Queen, Owner, and Boss. Address her respectfully as Queen, Owner, or Boss.",
		"USER NAME PROTOCOL: Address other users naturally by their resolved Facebook name.",
		"ONE-TIME vs RECURRING TASKS: Never repeat a command in a loop unless the user explicitly says 'every' (e.g. 'every 24 hours'). Phrases like 'after one hour' or 'in 10 minutes' must use schedule_once and execute only ONCE.",
		"AGENTIC CONTROL: You can execute any command in scripts/cmds/ as a tool, invoke FCA APIs directly via call_fca_api, resolve fuzzy queries via web_search, modify any command response, and read/modify/create/reload scripts."
	],
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
	if (!raw) {
		throw new Error("Empty train.data vault");
	}
	if (raw.startsWith("{")) {
		return JSON.parse(raw);
	}

	const headerMatch = raw.match(/^HEADER:\s*(.+)$/m);
	const saltMatch = raw.match(/^SALT:\s*([0-9a-fA-F]+)$/m);
	const ivMatch = raw.match(/^IV:\s*([0-9a-fA-F]+)$/m);
	const hmacMatch = raw.match(/^HMAC:\s*([0-9a-fA-F]+)$/m);
	const payloadMatch = raw.match(/-----PAYLOAD-----\s*([\s\S]+?)\s*-----END QUEENBOTV3 ENCRYPTED NEURAL VAULT-----/);

	if (!headerMatch || !saltMatch || !ivMatch || !hmacMatch || !payloadMatch) {
		throw new Error("Invalid QueenBotV3 Neural Vault structure");
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
		throw new Error("QueenBotV3 Neural Vault HMAC verification failed");
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

	const decompressed = zlib.inflateRawSync(compressed);
	return JSON.parse(decompressed.toString("utf8"));
}

function getTrainDataPathCandidates() {
	return [
		path.join(process.cwd(), "scripts", "cmds", "train.data"),
		path.join(process.cwd(), "train.data"),
		path.join(__dirname, "train.data"),
		path.join(__dirname, "..", "..", "scripts", "cmds", "train.data")
	];
}

function loadEncryptedTrainData() {
	const candidates = getTrainDataPathCandidates();
	let activePath = candidates.find(p => fs.existsSync(p));

	if (!activePath) {
		activePath = candidates[0];
		try {
			fs.ensureDirSync(path.dirname(activePath));
			fs.writeFileSync(activePath, encodeQueenVault(FALLBACK_VAULT_PAYLOAD), "utf8");
		}
		catch {
		}
	}

	try {
		if (activePath && fs.existsSync(activePath)) {
			const stat = fs.statSync(activePath);
			if (cachedVaultPayload && stat.mtimeMs === cachedVaultMtime) {
				return cachedVaultPayload;
			}
			const rawContent = fs.readFileSync(activePath, "utf8");
			const decoded = decodeQueenVault(rawContent);
			if (rawContent.trim().startsWith("{")) {
				try {
					fs.writeFileSync(activePath, encodeQueenVault(decoded), "utf8");
				}
				catch {
				}
			}
			cachedVaultPayload = decoded;
			cachedVaultMtime = stat.mtimeMs;
			return cachedVaultPayload;
		}
	}
	catch {
	}

	cachedVaultPayload = FALLBACK_VAULT_PAYLOAD;
	return cachedVaultPayload;
}

function getAiTokenizer() {
	if (tokenizerChecked) {
		return tokenizerInstance;
	}
	tokenizerChecked = true;
	try {
		const mod = require("ai-tokenizer");
		if (mod) {
			if (typeof mod.count === "function" || typeof mod.encode === "function") {
				tokenizerInstance = mod;
			}
			else if (typeof mod.Tokenizer === "function") {
				tokenizerInstance = new mod.Tokenizer();
			}
			else if (typeof mod.default === "function") {
				tokenizerInstance = new mod.default();
			}
			else if (mod.default && (typeof mod.default.count === "function" || typeof mod.default.encode === "function")) {
				tokenizerInstance = mod.default;
			}
		}
	}
	catch {
		tokenizerInstance = null;
	}
	return tokenizerInstance;
}

function countTokens(text) {
	const str = String(text || "");
	if (!str) return 0;
	const tok = getAiTokenizer();
	if (tok) {
		try {
			if (typeof tok.count === "function") {
				return Number(tok.count(str)) || Math.ceil(str.length / 3.8);
			}
			if (typeof tok.encode === "function") {
				const encoded = tok.encode(str);
				if (Array.isArray(encoded) || (encoded && typeof encoded.length === "number")) {
					return encoded.length;
				}
			}
		}
		catch {
		}
	}
	const words = str.trim().split(/\s+/).filter(Boolean).length;
	const charEstimate = Math.ceil(str.length / 3.8);
	return Math.max(words, charEstimate);
}

function truncateToTokenBudget(text, maxTokens = 2000) {
	const str = String(text || "");
	if (!str) return "";
	const currentTokens = countTokens(str);
	if (currentTokens <= maxTokens) {
		return str;
	}
	const ratio = maxTokens / Math.max(1, currentTokens);
	const targetChars = Math.max(120, Math.floor(str.length * ratio * 0.92));
	return `${str.slice(0, targetChars).trim()}...`;
}

function callFcaMethod(api, methodName, ...args) {
	return new Promise((resolve, reject) => {
		if (!api || typeof api[methodName] !== "function") {
			return reject(new Error(`FCA method "${methodName}" is not available`));
		}
		let settled = false;
		const done = (err, res) => {
			if (settled) return;
			settled = true;
			if (err) return reject(err);
			resolve(res);
		};
		try {
			const maybePromise = api[methodName](...args, done);
			if (maybePromise && typeof maybePromise.then === "function") {
				maybePromise.then(res => done(null, res)).catch(err => done(err, null));
			}
		}
		catch (err) {
			done(err, null);
		}
	});
}

async function safeFcaCall(api, methodName, ...args) {
	try {
		return await callFcaMethod(api, methodName, ...args);
	}
	catch {
		return null;
	}
}

async function resolveUserIdentity({ api, usersData, senderID, role = 0 }) {
	const uid = String(senderID || "").trim();
	if (!uid) {
		return {
			uid: "",
			name: "User",
			isOwner: false,
			titles: [],
			preferredAddress: "User",
			effectiveRole: Number(role) || 0
		};
	}

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

	const cached = userIdentityCache.get(uid);
	if (cached && Date.now() - cached.cachedAt < 1800000) {
		return {
			...cached,
			effectiveRole: Math.max(Number(role) || 0, cached.effectiveRole || 0)
		};
	}

	let resolvedName = "";

	if (usersData && typeof usersData.getName === "function") {
		try {
			const dbName = await usersData.getName(uid);
			if (typeof dbName === "string" && dbName.trim() && !/^(?:user|facebook\s*user|unknown)$/i.test(dbName.trim())) {
				resolvedName = dbName.trim();
			}
		}
		catch {
		}
	}

	if (!resolvedName && api) {
		const rawInfo = await safeFcaCall(api, "getUserInfo", uid);
		const profile = rawInfo?.[uid] || rawInfo?.data?.[uid] || rawInfo;
		if (profile && typeof profile.name === "string" && profile.name.trim()) {
			resolvedName = profile.name.trim();
		}
	}

	if (!resolvedName && api) {
		const rawV2 = await safeFcaCall(api, "getUserInfoV2", uid);
		const profileV2 = rawV2?.[uid] || rawV2?.data || rawV2;
		if (profileV2 && typeof profileV2.name === "string" && profileV2.name.trim()) {
			resolvedName = profileV2.name.trim();
		}
	}

	const finalName = resolvedName || "Friend";
	const identity = {
		uid,
		name: finalName,
		isOwner: false,
		titles: [],
		preferredAddress: finalName,
		effectiveRole: Number(role) || 0,
		cachedAt: Date.now()
	};
	userIdentityCache.set(uid, identity);
	return identity;
}

function getCmdsDirectory() {
	const candidates = [
		path.join(process.cwd(), "scripts", "cmds"),
		path.join(__dirname, "..", "..", "scripts", "cmds"),
		__dirname
	];
	for (const dir of candidates) {
		if (fs.existsSync(dir)) return dir;
	}
	return candidates[0];
}

function resolveLocalizedString(val) {
	if (!val) return "";
	if (typeof val === "string") return val.trim();
	if (typeof val === "object") {
		if (typeof val.en === "string" && val.en.trim()) return val.en.trim();
		if (typeof val.vi === "string" && val.vi.trim()) return val.vi.trim();
		for (const v of Object.values(val)) {
			if (typeof v === "string" && v.trim()) return v.trim();
		}
	}
	return "";
}

function syncCommandTools() {
	discoveredToolsMap.clear();
	const goatBot = global.GoatBot;
	const cmdsDir = getCmdsDirectory();

	if (goatBot?.commands instanceof Map) {
		for (const [key, cmdObj] of goatBot.commands.entries()) {
			const cfg = cmdObj?.config || {};
			const name = String(cfg.name || key || "").trim().toLowerCase();
			if (!name) continue;
			const aliases = Array.isArray(cfg.aliases)
				? cfg.aliases.map(a => String(a || "").trim().toLowerCase()).filter(Boolean)
				: [];
			const desc = resolveLocalizedString(cfg.shortDescription) || resolveLocalizedString(cfg.description) || resolveLocalizedString(cfg.longDescription) || `Execute ${name} command`;
			const guide = resolveLocalizedString(cfg.guide) || `{pn}`;
			const location = cmdObj?.location || path.join(cmdsDir, `${name}.ts`);

			discoveredToolsMap.set(name, {
				name,
				aliases,
				category: String(cfg.category || "other").trim().toLowerCase(),
				role: Number.isFinite(Number(cfg.role)) ? Number(cfg.role) : 0,
				countDown: Number.isFinite(Number(cfg.countDown)) ? Number(cfg.countDown) : 1,
				description: desc,
				guide: guide.slice(0, 220),
				filePath: location
			});
		}
	}

	if (fs.existsSync(cmdsDir)) {
		try {
			const files = fs.readdirSync(cmdsDir);
			for (const file of files) {
				if (!/\.(js|ts)$/i.test(file) || /\.eg\.(js|ts)$/i.test(file) || /\.compiled\.js$/i.test(file)) {
					continue;
				}
				const stem = file.replace(/\.(js|ts)$/i, "").toLowerCase();
				if (discoveredToolsMap.has(stem)) continue;

				const fullPath = path.join(cmdsDir, file);
				try {
					const code = fs.readFileSync(fullPath, "utf8");
					const nameMatch = code.match(/name\s*:\s*[\x22\x27\x60]([^\x22\x27\x60]+)[\x22\x27\x60]/);
					const catMatch = code.match(/category\s*:\s*[\x22\x27\x60]([^\x22\x27\x60]+)[\x22\x27\x60]/);
					const name = nameMatch ? nameMatch[1].trim().toLowerCase() : stem;
					if (!discoveredToolsMap.has(name)) {
						discoveredToolsMap.set(name, {
							name,
							aliases: stem !== name ? [stem] : [],
							category: catMatch ? catMatch[1].trim().toLowerCase() : "other",
							role: 0,
							countDown: 1,
							description: `Execute ${name} module`,
							guide: `{pn}`,
							filePath: fullPath
						});
					}
				}
				catch {
				}
			}
		}
		catch {
		}
	}

	return Array.from(discoveredToolsMap.values());
}

function resolveToolName(rawName) {
	const clean = String(rawName || "")
		.trim()
		.replace(/^[^a-zA-Z0-9_-]+/, "")
		.replace(/\.(js|ts)$/i, "")
		.toLowerCase();
	if (!clean) return null;

	if (discoveredToolsMap.size === 0) {
		syncCommandTools();
	}

	if (discoveredToolsMap.has(clean)) {
		return clean;
	}

	const goatAliases = global.GoatBot?.aliases;
	if (goatAliases instanceof Map && goatAliases.has(clean)) {
		const target = goatAliases.get(clean);
		const targetName = typeof target === "string" ? target : target?.config?.name;
		if (targetName) return String(targetName).toLowerCase();
	}

	for (const tool of discoveredToolsMap.values()) {
		if (tool.aliases.includes(clean)) {
			return tool.name;
		}
	}

	const builtInSynonyms = {
		up2: "uptime2",
		up: "uptime",
		yt: "sing",
		youtube: "sing",
		song: "sing",
		music: "sing",
		play: "sing",
		sing: "sing",
		spotify: "sing",
		spy: "getinfo",
		userinfo: "getinfo",
		whois: "getinfo",
		pin: "pinterest",
		paste: "bin",
		pastebin: "bin",
		mocky: "bin"
	};

	if (builtInSynonyms[clean]) {
		const candidate = builtInSynonyms[clean];
		if (discoveredToolsMap.has(candidate) || global.GoatBot?.commands?.has(candidate)) {
			return candidate;
		}
		if (candidate === "ytb" && (discoveredToolsMap.has("sing") || global.GoatBot?.commands?.has("sing"))) {
			return "sing";
		}
	}

	return null;
}

function getToolCatalogForPrompt(maxTokens = 1100) {
	const tools = syncCommandTools();
	if (tools.length === 0) {
		return "ping, uptime, uptime2, help, ytb, sing, getinfo, bin, cmd, event, boxinfo, admin, weather, pinterest";
	}
	const lines = tools.map(t => {
		const aliasStr = t.aliases.length > 0 ? ` [aliases: ${t.aliases.slice(0, 3).join(",")}]` : "";
		return `• ${t.name}${aliasStr} (${t.category}): ${t.description.slice(0, 75)}`;
	});
	return truncateToTokenBudget(lines.join("\n"), maxTokens);
}

function cleanFuzzyMediaQuery(rawQuery) {
	let q = String(rawQuery || "").trim();
	q = q
		.replace(/^(?:can\s+you\s+|please\s+|could\s+you\s+|i\s+want\s+you\s+to\s+)+/i, "")
		.replace(/^(?:send\s+me\s+|play\s+|download\s+|find\s+|search\s+|get\s+|give\s+me\s+)+/i, "")
		.replace(/^(?:the\s+)?(?:song|music|track|audio|video)\s+(?:called|named|titled|by\s+name)?\s*/i, "")
		.replace(/\s+(?:or\s+something(?:\s+like\s+that)?|if\s+possible|please|right\s+now|for\s+me)\s*$/i, "")
		.replace(/\s+by\s+/i, " ")
		.trim();
	return q || String(rawQuery || "").trim();
}

async function resolveFuzzyQueryWithWeb(rawQuery, type = "general") {
	const cleaned = type === "media" ? cleanFuzzyMediaQuery(rawQuery) : String(rawQuery || "").trim();
	if (!cleaned) return { resolvedQuery: "", summary: "", topResult: null };

	try {
		const yts = require("yt-search");
		const searchRes = await yts(cleaned);
		const topVideo = searchRes?.videos?.[0];
		if (topVideo && topVideo.title) {
			return {
				resolvedQuery: topVideo.title,
				videoUrl: topVideo.url,
				videoId: topVideo.videoId,
				author: topVideo.author?.name || "",
				duration: topVideo.timestamp || "",
				summary: `Found on YouTube: "${topVideo.title}" by ${topVideo.author?.name || "Unknown"} (${topVideo.timestamp || "N/A"}) - ${topVideo.url}`,
				topResult: topVideo
			};
		}
	}
	catch {
	}

	try {
		const ddgUrl = [
			"https:",
			"",
			"api.duckduckgo.com",
			`?q=${encodeURIComponent(cleaned)}&format=json&no_html=1&skip_disambig=1`
		].join("/");
		const res = await axios.get(ddgUrl, { httpsAgent, timeout: 8000 });
		const data = res?.data || {};
		const abstractText = String(data.AbstractText || data.Answer || "").trim();
		const relatedTopic = Array.isArray(data.RelatedTopics) && data.RelatedTopics[0]?.Text
			? String(data.RelatedTopics[0].Text).trim()
			: "";
		const summary = abstractText || relatedTopic;
		if (summary) {
			return {
				resolvedQuery: data.Heading || cleaned,
				summary,
				topResult: data
			};
		}
	}
	catch {
	}

	return {
		resolvedQuery: cleaned,
		summary: "",
		topResult: null
	};
}

function createGetTextForCommand(cmd, prefix, langCode) {
	const commandType = cmd.config?.countDown ? "command" : "command event";
	const commandName = cmd.config?.name || "unknown";
	const pathCustomLang = `${process.cwd()}/languages/cmds/${langCode}.js`;
	let customLang = {};
	if (fs.existsSync(pathCustomLang)) {
		try {
			customLang = require(pathCustomLang)[commandName]?.text || {};
		}
		catch {}
	}
	return function (key, ...args) {
		let lang = cmd.langs?.[langCode]?.[key] || customLang[key] || "";
		for (let i = args.length - 1; i >= 0; i--) {
			lang = lang.replace(new RegExp(`%${i + 1}`, "g"), args[i]);
		}
		return lang || `❌ Can't find text on language "${langCode}" for ${commandType} "${commandName}" with key "${key}"`;
	};
}

async function executeCommandAsTool(options) {
	const {
		commandName,
		args = [],
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
		globalData,
		captureOutput = false
	} = options;

	const canonical = resolveToolName(commandName) || String(commandName || "").trim().toLowerCase();
	const targetCmd = global.GoatBot?.commands?.get(canonical);
	if (!targetCmd || typeof targetCmd.onStart !== "function") {
		return {
			ok: false,
			commandName: canonical,
			error: `Command "${commandName}" is not loaded in GoatBot.commands`,
			capturedText: "",
			attachments: []
		};
	}

	const senderUid = String(event?.senderID || event?.userID || "");
	const effectiveRole = senderUid === OWNER_UID ? 2 : (Number(role) || 0);
	const requiredRole = typeof targetCmd.config?.role === "number" ? targetCmd.config.role : 0;

	if (requiredRole > effectiveRole) {
		const denyMsg = `⚠️ Permission denied: command "${canonical}" requires role ${requiredRole}.`;
		if (!captureOutput && message && typeof message.reply === "function") {
			await message.reply(denyMsg);
		}
		return {
			ok: false,
			commandName: canonical,
			error: denyMsg,
			capturedText: denyMsg,
			attachments: []
		};
	}

	const capturedTexts = [];
	const capturedAttachments = [];
	let lastSentResult = null;

	const captureHandler = async (payload, forwardToRealChat = false) => {
		if (typeof payload === "string") {
			capturedTexts.push(payload);
		}
		else if (payload && typeof payload === "object") {
			if (typeof payload.body === "string" && payload.body.trim()) {
				capturedTexts.push(payload.body.trim());
			}
			if (payload.attachment) {
				if (Array.isArray(payload.attachment)) {
					capturedAttachments.push(...payload.attachment);
				}
				else {
					capturedAttachments.push(payload.attachment);
				}
			}
		}

		if (forwardToRealChat && message && typeof message.reply === "function") {
			lastSentResult = await message.reply(payload);
			return lastSentResult;
		}
		return { messageID: `virtual_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` };
	};

	let lastEditedText = "";
	const proxyMessage = Object.create(message || {});
	proxyMessage.reply = async (form) => captureHandler(form, !captureOutput);
	proxyMessage.send = async (form) => captureHandler(form, !captureOutput);
	proxyMessage.edit = async (text, msgID) => {
		const textContent = typeof text === "string" ? text : (text?.body || "");
		if (textContent) {
			capturedTexts.push(textContent);
			lastEditedText = textContent;
		}
		if (!captureOutput && message && typeof message.edit === "function") {
			return await message.edit(text, msgID);
		}
		return { messageID: msgID || `virtual_edit_${Date.now()}` };
	};
	proxyMessage.unsend = async (msgID) => {
		if (!captureOutput && message && typeof message.unsend === "function") {
			return await message.unsend(msgID);
		}
		return null;
	};
	proxyMessage.reaction = async (emoji, msgID) => {
		if (message && typeof message.reaction === "function") {
			return await message.reaction(emoji, msgID);
		}
		return null;
	};

	const proxyApi = Object.create(api || {});
	proxyApi.sendMessage = async (form, threadID) => captureHandler(form, !captureOutput);
	proxyApi.editMessage = async (text, msgID) => {
		const textContent = typeof text === "string" ? text : (text?.body || "");
		if (textContent) {
			capturedTexts.push(textContent);
			lastEditedText = textContent;
		}
		if (!captureOutput && api && typeof api.editMessage === "function") {
			return await api.editMessage(text, msgID);
		}
		return { messageID: msgID || `virtual_edit_${Date.now()}` };
	};

	const cleanArgs = Array.isArray(args) ? args.map(a => String(a)) : [];
	const langCode = global.GoatBot?.config?.language || "en";
	const getLang = createGetTextForCommand(targetCmd, prefix, langCode);
	const syntheticEvent = {
		...event,
		body: `${prefix}${canonical}${cleanArgs.length ? " " + cleanArgs.join(" ") : ""}`,
		args: cleanArgs
	};

	try {
		await targetCmd.onStart({
			api: proxyApi,
			message: proxyMessage,
			event: syntheticEvent,
			args: cleanArgs,
			role: effectiveRole,
			usersData,
			threadsData,
			threadModel,
			userModel,
			dashBoardModel,
			globalModel,
			dashBoardData,
			globalData,
			getLang,
			commandName: canonical,
			prefix
		});

		const finalText = lastEditedText || (capturedTexts.length ? capturedTexts[capturedTexts.length - 1] : capturedTexts.join("\n\n").trim());
		return {
			ok: true,
			commandName: canonical,
			capturedText: finalText,
			attachments: capturedAttachments,
			allOutputs: capturedTexts,
			lastSentResult
		};
	}
	catch (err) {
		const solution = suggestGitHubSolution(canonical, err);
		return {
			ok: false,
			commandName: canonical,
			error: err?.message || String(err),
			capturedText: lastEditedText || capturedTexts.join("\n\n").trim(),
			attachments: capturedAttachments,
			githubSolution: solution
		};
	}
}

async function executeFcaApiTool({ api, event, role = 0, method, args = [] }) {
	const senderUid = String(event?.senderID || event?.userID || "");
	const isOwner = senderUid === OWNER_UID;
	const effectiveRole = isOwner ? 2 : (Number(role) || 0);

	const methodAliases = {
		changeThreadTitle: "setTitle",
		setThreadTitle: "setTitle"
	};
	const resolvedMethod = methodAliases[method] || String(method || "").trim();

	const adminOnlyMethods = new Set([
		"sendFriendRequest",
		"handleFriendRequest",
		"changeBlockedStatus",
		"unfriend",
		"removeUserFromGroup",
		"changeAdminStatus",
		"addUserToGroup"
	]);

	if (adminOnlyMethods.has(resolvedMethod) && effectiveRole < 1) {
		return {
			ok: false,
			method: resolvedMethod,
			error: `FCA method "${resolvedMethod}" requires Group Admin or Bot Owner privileges.`
		};
	}

	const normalizedArgs = (Array.isArray(args) ? args : [args]).map(arg => {
		if (arg === "__THREAD_ID__") return event?.threadID;
		if (arg === "__SENDER_ID__") return senderUid;
		return arg;
	});

	if (!api || typeof api[resolvedMethod] !== "function") {
		return {
			ok: false,
			method: resolvedMethod,
			error: `FCA method "${resolvedMethod}" is not supported by the current api instance.`
		};
	}

	try {
		const data = await callFcaMethod(api, resolvedMethod, ...normalizedArgs);
		return {
			ok: true,
			method: resolvedMethod,
			data
		};
	}
	catch (err) {
		return {
			ok: false,
			method: resolvedMethod,
			error: err?.message || String(err)
		};
	}
}

function stripCommentsFromCode(code) {
	let out = "";
	let inSingle = false;
	let inDouble = false;
	let inTemplate = false;
	const s = String(code || "");

	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		const next = s[i + 1];

		if (ch === "\\" && (inSingle || inDouble || inTemplate)) {
			out += ch + (next || "");
			i++;
			continue;
		}
		if (!inDouble && !inTemplate && ch === "'") {
			inSingle = !inSingle;
			out += ch;
			continue;
		}
		if (!inSingle && !inTemplate && ch === '"') {
			inDouble = !inDouble;
			out += ch;
			continue;
		}
		if (!inSingle && !inDouble && ch === "`") {
			inTemplate = !inTemplate;
			out += ch;
			continue;
		}

		if (!inSingle && !inDouble && !inTemplate) {
			if (ch === "/" && next === "/") {
				while (i < s.length && s[i] !== "\n") {
					i++;
				}
				out += "\n";
				continue;
			}
			if (ch === "/" && next === "*") {
				i += 2;
				while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) {
					i++;
				}
				i++;
				continue;
			}
		}
		out += ch;
	}

	return out
		.replace(/author\s*:\s*[\x22\x27\x60][^\x22\x27\x60]*[\x22\x27\x60]/g, 'author: "Priyanshi Kaur"')
		.replace(/\n{3,}/g, "\n\n")
		.trim() + "\n";
}

function resolveScriptPath(targetName) {
	const clean = path.basename(String(targetName || "").trim());
	if (!clean) return null;
	const cmdsDir = getCmdsDirectory();
	const stem = clean.replace(/\.(js|ts)$/i, "");

	const candidates = [
		path.join(cmdsDir, clean),
		path.join(cmdsDir, `${stem}.ts`),
		path.join(cmdsDir, `${stem}.js`),
		path.join(cmdsDir, "..", "events", `${stem}.ts`),
		path.join(cmdsDir, "..", "events", `${stem}.js`)
	];

	for (const c of candidates) {
		if (fs.existsSync(c) && fs.statSync(c).isFile()) {
			return c;
		}
	}

	const resolvedTool = resolveToolName(stem);
	if (resolvedTool && discoveredToolsMap.has(resolvedTool)) {
		const toolEntry = discoveredToolsMap.get(resolvedTool);
		if (toolEntry?.filePath && fs.existsSync(toolEntry.filePath)) {
			return toolEntry.filePath;
		}
	}

	return path.join(cmdsDir, /\.(js|ts)$/i.test(clean) ? clean : `${stem}.ts`);
}

function readBotScript(targetName) {
	const filePath = resolveScriptPath(targetName);
	if (!filePath || !fs.existsSync(filePath)) {
		return { ok: false, error: `Script "${targetName}" not found.` };
	}
	try {
		const content = fs.readFileSync(filePath, "utf8");
		return {
			ok: true,
			fileName: path.basename(filePath),
			filePath,
			content
		};
	}
	catch (err) {
		return { ok: false, error: err?.message || String(err) };
	}
}

async function reloadBotScript(targetName, runtimeContext = {}) {
	const filePath = resolveScriptPath(targetName);
	if (!filePath || !fs.existsSync(filePath)) {
		return { ok: false, error: `Script "${targetName}" not found on disk.` };
	}

	const stem = path.basename(filePath).replace(/\.(js|ts)$/i, "");
	const loadScriptsFn = global.utils?.loadScripts;

	if (typeof loadScriptsFn === "function" && global.GoatBot) {
		try {
			const {
				api = runtimeContext.api,
				threadModel = runtimeContext.threadModel,
				userModel = runtimeContext.userModel,
				dashBoardModel = runtimeContext.dashBoardModel,
				globalModel = runtimeContext.globalModel,
				threadsData = runtimeContext.threadsData,
				usersData = runtimeContext.usersData,
				dashBoardData = runtimeContext.dashBoardData,
				globalData = runtimeContext.globalData
			} = global.GoatBot;

			const res = await loadScriptsFn(
				"cmds",
				stem,
				global.utils.log,
				global.GoatBot.configCommands,
				api,
				threadModel,
				userModel,
				dashBoardModel,
				globalModel,
				threadsData,
				usersData,
				dashBoardData,
				globalData
			);
			syncCommandTools();
			if (res && res.status === "success") {
				return { ok: true, fileName: path.basename(filePath), name: res.name || stem };
			}
			return { ok: false, error: res?.error?.message || "loadScripts returned non-success status" };
		}
		catch (err) {
			return { ok: false, error: err?.message || String(err) };
		}
	}

	try {
		delete require.cache[require.resolve(filePath)];
		const loaded = require(filePath);
		if (loaded?.config?.name && global.GoatBot?.commands instanceof Map) {
			global.GoatBot.commands.set(String(loaded.config.name).toLowerCase(), {
				...loaded,
				location: filePath
			});
		}
		syncCommandTools();
		return { ok: true, fileName: path.basename(filePath), name: loaded?.config?.name || stem };
	}
	catch (err) {
		return { ok: false, error: err?.message || String(err) };
	}
}

async function writeAndReloadBotScript({ targetName, code, runtimeContext = {} }) {
	const filePath = resolveScriptPath(targetName);
	if (!filePath) {
		return { ok: false, error: "Invalid script target name." };
	}

	const cleanCode = stripCommentsFromCode(code);
	try {
		const backupDir = path.join(getCmdsDirectory(), "cache", "backups");
		fs.ensureDirSync(backupDir);
		if (fs.existsSync(filePath)) {
			const backupPath = path.join(backupDir, `${path.basename(filePath)}.${Date.now()}.bak`);
			fs.copyFileSync(filePath, backupPath);
		}
		fs.writeFileSync(filePath, cleanCode, "utf8");
		const reloadRes = await reloadBotScript(path.basename(filePath), runtimeContext);
		return {
			ok: true,
			fileName: path.basename(filePath),
			filePath,
			reloaded: reloadRes.ok,
			reloadDetail: reloadRes.error || "Hot-reloaded into GoatBot.commands"
		};
	}
	catch (err) {
		return { ok: false, error: err?.message || String(err) };
	}
}

async function deleteBotScript(targetName, runtimeContext = {}) {
	const filePath = resolveScriptPath(targetName);
	if (!filePath || !fs.existsSync(filePath)) {
		return { ok: false, error: `Script "${targetName}" does not exist.` };
	}

	const fileName = path.basename(filePath);
	const stem = fileName.replace(/\.(js|ts)$/i, "").toLowerCase();

	try {
		if (global.GoatBot) {
			if (global.GoatBot.commands instanceof Map) {
				global.GoatBot.commands.delete(stem);
			}
			if (global.GoatBot.aliases instanceof Map) {
				for (const [alias, target] of global.GoatBot.aliases.entries()) {
					if (String(target).toLowerCase() === stem) {
						global.GoatBot.aliases.delete(alias);
					}
				}
			}
			if (Array.isArray(global.GoatBot.onChat)) {
				global.GoatBot.onChat = global.GoatBot.onChat.filter(c => c !== stem);
			}
			if (Array.isArray(global.GoatBot.onAnyEvent)) {
				global.GoatBot.onAnyEvent = global.GoatBot.onAnyEvent.filter(c => c !== stem);
			}
		}

		try {
			delete require.cache[require.resolve(filePath)];
		}
		catch {}
		delete require.cache[filePath];

		const trashDir = path.join(getCmdsDirectory(), "cache", "trash");
		fs.ensureDirSync(trashDir);
		const trashPath = path.join(trashDir, `${fileName}.${Date.now()}.deleted`);
		fs.copyFileSync(filePath, trashPath);
		fs.unlinkSync(filePath);

		syncCommandTools();

		return {
			ok: true,
			fileName,
			deleted: true,
			trashBackup: path.basename(trashPath)
		};
	}
	catch (err) {
		return { ok: false, error: err?.message || String(err) };
	}
}

function suggestGitHubSolution(commandName, err) {
	const errStr = String(err?.stack || err?.message || err || "").toLowerCase();
	const cmd = String(commandName || "").toLowerCase();

	if (errStr.includes("1357001") || errStr.includes("login_blocked") || errStr.includes("expired") || errStr.includes("cookie")) {
		return {
			issue: "Facebook session cookie invalid or expired (error 1357001 / login_blocked).",
			fix: "Export fresh appState / cookies from your browser and paste into account.txt.",
			repo: "https://github.com/ItzPriyanshi/QueenBotV2",
			githubRef: "fca-nx authentication & session renewal documentation"
		};
	}

	if (errStr.includes("cannot find module") || errStr.includes("module_not_found")) {
		const pkgMatch = errStr.match(/cannot find module '([^']+)'/i);
		const pkg = pkgMatch ? pkgMatch[1] : "dependency";
		return {
			issue: `Missing package: ${pkg}`,
			fix: `Install with: bun add ${pkg} or npm install ${pkg}`,
			repo: "https://github.com/ItzPriyanshi/QueenBotV3",
			githubRef: "QueenBot package.json dependencies"
		};
	}

	if (errStr.includes("eaddrinuse") || errStr.includes("port")) {
		return {
			issue: "Dashboard or Elysia port already bound by another process.",
			fix: "The port escalates automatically (3001 -> 3002+), or kill existing process with npx kill-port 3001.",
			repo: "https://github.com/ItzPriyanshi/QueenBotV3",
			githubRef: "dashboard port collision auto-escalation"
		};
	}

	if (errStr.includes("canvas") || errStr.includes("node-gyp") || errStr.includes("cairo")) {
		return {
			issue: "Native C++ node-canvas compilation failure.",
			fix: "Use QueenBot's built-in @napi-rs/canvas adapter bridge in bot/canvasAdapter.js.",
			repo: "https://github.com/ItzPriyanshi/QueenBotV3",
			githubRef: "@napi-rs/canvas zero-build compatibility bridge"
		};
	}

	if (cmd === "spotify" || errStr.includes("spotify")) {
		return {
			issue: "Spotify API client credentials missing or unauthorized.",
			fix: "Use .sing <song name> or .ytb <query> which streams high-bitrate audio directly without Spotify API keys.",
			repo: "https://github.com/ItzPriyanshi/QueenBotV3",
			githubRef: "scripts/cmds/sing.ts YouTube & iTunes resolver"
		};
	}

	if (errStr.includes("rate limit") || errStr.includes("429") || errStr.includes("too many requests")) {
		return {
			issue: "Temporary API rate limit from upstream gateway.",
			fix: "Add exponential backoff delay or rotate proxy headers.",
			repo: "https://github.com/ItzPriyanshi/QueenBotV2",
			githubRef: "FCA-NX autoReconnect & backoff listener"
		};
	}

	return {
		issue: `Runtime execution error in command "${cmd}": ${err?.message || errStr.slice(0, 120)}`,
		fix: "Check parameter types, ensure dependencies exist, or inspect the script source.",
		repo: "https://github.com/ItzPriyanshi/QueenBotV3",
		githubRef: `scripts/cmds/${cmd}.ts`
	};
}

function cleanPersonQuery(raw) {
	let s = String(raw || "").trim();
	s = s.replace(/^(?:lex|queen|ai|bot|hey)\s*,?\s*/i, "");
	s = s.replace(/^(?:can\s+you\s+)?(?:please\s+)?(?:give\s+(?:me\s+)?|get\s+|show\s+|fetch\s+|tell\s+me\s+)?(?:about\s+|details\s+(?:of|for|about)\s+|info\s+(?:of|on|about)\s+|userinfo\s+(?:of|for)\s+|profile\s+(?:of|for)\s+|who\s+is\s+|who's\s+|whos\s+|who\s+was\s+|check\s+)/i, "");
	s = s.replace(/\s+(?:in\s+this\s+group|in\s+the\s+group|in\s+group|here|in\s+chat)\??$/i, "");
	s = s.replace(/[\?\.!:]+$/, "");
	s = s.replace(/^@/, "").trim();
	return s;
}

async function findUserUid(input, event = {}, api = null, threadsData = null, usersData = null) {
	if (event?.messageReply?.senderID) {
		const uid = String(event.messageReply.senderID);
		let name = "";
		if (usersData?.getName) {
			try { name = await usersData.getName(uid); } catch {}
		}
		return { uid, name: name || "User", source: "reply" };
	}

	if (event?.mentions && Object.keys(event.mentions).length > 0) {
		const uid = Object.keys(event.mentions)[0];
		const name = String(event.mentions[uid] || "").replace(/^@/, "").trim();
		return { uid, name: name || "Mentioned User", source: "mention" };
	}

	const cleaned = cleanPersonQuery(input);
	const rawStr = String(input || "").trim();
	const candidates = [cleaned, rawStr].filter(Boolean);

	for (const str of candidates) {
		if (/^\d{8,20}$/.test(str)) {
			let name = "";
			if (usersData?.getName) {
				try { name = await usersData.getName(str); } catch {}
			}
			return { uid: str, name: name || "User", source: "direct_uid" };
		}

		if (/^(https?:\/\/)?(www\.)?(facebook\.com|fb\.com|fb\.watch)/i.test(str)) {
			if (global.utils?.findUid) {
				try {
					const uid = await global.utils.findUid(str);
					if (uid) return { uid: String(uid), name: "Profile Link", source: "link" };
				}
				catch {}
			}
		}
	}

	const cleanQuery = (cleaned || rawStr).toLowerCase().replace(/^@/, "").trim();

	if (cleanQuery && event?.threadID && threadsData?.get) {
		try {
			const threadInfo = await threadsData.get(event.threadID);
			const members = threadInfo?.members || threadInfo?.userInfo || [];
			let found = members.find(m => {
				const mName = String(m.name || "").toLowerCase();
				const mNick = String(m.nickname || threadInfo?.nicknames?.[m.userID || m.id] || "").toLowerCase();
				return mName === cleanQuery || mNick === cleanQuery;
			});
			if (!found) {
				found = members.find(m => {
					const mName = String(m.name || "").toLowerCase();
					const mNick = String(m.nickname || threadInfo?.nicknames?.[m.userID || m.id] || "").toLowerCase();
					return mName.includes(cleanQuery) || cleanQuery.includes(mName) || mNick.includes(cleanQuery);
				});
			}
			if (found && (found.id || found.userID)) {
				return { uid: String(found.id || found.userID), name: found.name || cleanQuery, source: "thread_member" };
			}
		}
		catch {}
	}

	if (cleanQuery && usersData?.getAll) {
		try {
			const allUsers = await usersData.getAll();
			const found = allUsers.find(u => (u.name || "").toLowerCase() === cleanQuery) ||
				allUsers.find(u => (u.name || "").toLowerCase().includes(cleanQuery) || cleanQuery.includes((u.name || "").toLowerCase()));
			if (found && (found.userID || found.id)) {
				return { uid: String(found.userID || found.id), name: found.name || cleanQuery, source: "bot_users" };
			}
		}
		catch {}
	}

	if (cleanQuery && api && typeof api.getUserID === "function") {
		try {
			const res = await new Promise((resolve) => {
				api.getUserID(cleanQuery, (err, data) => {
					if (err || !data || !data.length) return resolve(null);
					resolve(data[0]);
				});
			});
			if (res && res.userID) {
				return { uid: String(res.userID), name: res.name || cleanQuery, source: "fca_search" };
			}
		}
		catch {}
	}

	if (/(?:who\s+am\s+i|my\s+details|about\s+me|my\s+uid)/i.test(rawStr) && event?.senderID) {
		let name = "";
		if (usersData?.getName) {
			try { name = await usersData.getName(event.senderID); } catch {}
		}
		return { uid: String(event.senderID), name: name || "Yourself", source: "self" };
	}

	return null;
}

async function getUserDetailsCard({ query, event = {}, api = null, threadsData = null, usersData = null }) {
	const userMatch = await findUserUid(query, event, api, threadsData, usersData);
	if (!userMatch || !userMatch.uid) {
		return null;
	}

	const uid = String(userMatch.uid);
	let name = userMatch.name || "User";
	let genderStr = "Not specified";
	let friendStatus = "No";
	let verifiedStr = "Standard";
	let thumbSrc = "";
	let vanity = "";

	if (api && typeof api.getUserInfo === "function") {
		try {
			const info = await api.getUserInfo(uid);
			const u = info?.[uid];
			if (u) {
				if (u.name) name = u.name;
				genderStr = u.gender === 1 ? "Female" : u.gender === 2 ? "Male" : "Not specified";
				friendStatus = u.isFriend ? "Yes" : "No";
				verifiedStr = u.verified ? "Verified ✓" : "Standard";
				thumbSrc = u.thumbSrc || "";
				vanity = u.vanity || "";
			}
		}
		catch {}
	}

	let inGroup = false;
	let groupRole = "Member";
	let nickname = "None";
	let messageCount = 0;
	let joinDate = "Unknown";

	if (event?.threadID && threadsData?.get) {
		try {
			const threadData = await threadsData.get(event.threadID);
			if (threadData) {
				const members = Array.isArray(threadData.members) ? threadData.members : [];
				const memberData = members.find(m => String(m.userID || m.id) === uid);
				if (memberData) {
					inGroup = true;
					messageCount = memberData.messageCount || 0;
					if (memberData.joinedAt) {
						joinDate = new Date(memberData.joinedAt).toLocaleDateString();
					}
				}
				const adminList = Array.isArray(threadData.adminIDs) ? threadData.adminIDs : [];
				const isAdmin = adminList.some(a => String(a.id || a.userID || a) === uid);
				if (isAdmin) groupRole = "Admin 🛡️";
				if (threadData.nicknames && threadData.nicknames[uid]) {
					nickname = threadData.nicknames[uid];
				}
				else if (memberData?.nickname) {
					nickname = memberData.nickname;
				}
			}
		}
		catch {}
	}

	let avatarStream = null;
	if (thumbSrc) {
		try {
			const imgRes = await axios.get(thumbSrc, { responseType: "stream", timeout: 8000 });
			avatarStream = imgRes.data;
		}
		catch {}
	}

	const profileUrl = vanity ? `https://facebook.com/${vanity}` : `https://facebook.com/${uid}`;
	const lines = [
		`👤 User Details`,
		`────────────`,
		`• Name: ${name}`,
		`• UID: ${uid}`,
		inGroup ? `• Group Role: ${groupRole}` : null,
		inGroup && nickname !== "None" ? `• Nickname: ${nickname}` : null,
		inGroup && messageCount > 0 ? `• Messages Sent: ${messageCount}` : null,
		inGroup && joinDate !== "Unknown" ? `• Joined Group: ${joinDate}` : null,
		`• Gender: ${genderStr}`,
		`• Friend: ${friendStatus}`,
		`• Profile: ${profileUrl}`
	].filter(Boolean);

	return {
		ok: true,
		uid,
		name,
		body: lines.join("\n"),
		attachment: avatarStream,
		profileUrl
	};
}

module.exports = {
	OWNER_UID,
	OWNER_NAME,
	OWNER_TITLES,
	encodeQueenVault,
	decodeQueenVault,
	loadEncryptedTrainData,
	countTokens,
	truncateToTokenBudget,
	resolveUserIdentity,
	syncCommandTools,
	resolveToolName,
	getToolCatalogForPrompt,
	cleanFuzzyMediaQuery,
	resolveFuzzyQueryWithWeb,
	executeCommandAsTool,
	executeFcaApiTool,
	stripCommentsFromCode,
	readBotScript,
	reloadBotScript,
	writeAndReloadBotScript,
	deleteBotScript,
	suggestGitHubSolution,
	cleanPersonQuery,
	findUserUid,
	getUserDetailsCard
};