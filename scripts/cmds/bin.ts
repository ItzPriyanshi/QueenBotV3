const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const https = require("https");
const path = require("path");

const PASTEBIN_API_KEY = process.env.PASTEBIN_API_KEY || "a5NjYtjOENDQlZur3XCF4-H4vLcxkjeh";
const PASTEBIN_API_URL = "https://pastebin.com/api/api_post.php";
const MOCKY_BASE_URL = process.env.MOCKY_BASE_URL || "https://unofficial-mocky.onrender.com";
const MOCKY_API_URL = `${MOCKY_BASE_URL}/api/mock`;
const MOCKY_SECRET = process.env.MOCKY_SECRET || "uY8qN3mXv5B9zW4kP7rT2jE1sQ6cK9hA4fD8gV2bN7mX3pL1zW5kQ8rT0jE2sC9h";

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const EXPIRATION_LABELS: Record<string, string> = {
	N: "Never",
	"10M": "10 Minutes",
	"1H": "1 Hour",
	"1D": "1 Day",
	"1W": "1 Week",
	"2W": "2 Weeks",
	"1M": "1 Month",
	"6M": "6 Months",
	"1Y": "1 Year"
};

const MOCKY_EXPIRATION_MAP: Record<string, string> = {
	N: "1year",
	"10M": "10min",
	"1H": "1hour",
	"1D": "1day",
	"1W": "1week",
	"2W": "1month",
	"1M": "1month",
	"6M": "1year",
	"1Y": "1year"
};

const PRIVACY_LABELS: Record<string, string> = {
	"0": "Public",
	"1": "Unlisted",
	"2": "Private"
};

interface CommandEntry {
	name: string;
	displayName: string;
	filePath: string;
	aliases: string[];
}

async function createPastebinPaste(text: string, title: string, expiration: string, privacy: string) {
	try {
		const formData = new FormData();
		formData.append("api_dev_key", PASTEBIN_API_KEY);
		formData.append("api_option", "paste");
		formData.append("api_paste_code", String(text));
		formData.append("api_paste_private", String(privacy));
		formData.append("api_paste_name", String(title));
		formData.append("api_paste_expire_date", String(expiration));

		const response = await axios.post(PASTEBIN_API_URL, formData, {
			headers: formData.getHeaders(),
			httpsAgent,
			timeout: 30000
		});
		const url = String(response.data || "").trim();
		if (!url.startsWith("http")) {
			throw new Error(url || "Invalid response from Pastebin");
		}
		return {
			url,
			raw: url.replace("pastebin.com/", "pastebin.com/raw/")
		};
	}
	catch (error: any) {
		throw new Error(`Pastebin Error: ${error.message}`);
	}
}

async function createMockyPaste(content: string, expirationKey = "1Y") {
	try {
		const mockyExpiration = MOCKY_EXPIRATION_MAP[expirationKey] || "1year";
		const response = await axios.post(
			MOCKY_API_URL,
			{
				status: 200,
				content: String(content),
				content_type: "text/plain",
				charset: "UTF-8",
				secret: MOCKY_SECRET,
				expiration: mockyExpiration
			},
			{
				headers: { "Content-Type": "application/json" },
				httpsAgent,
				timeout: 90000
			}
		);
		const { id, link } = response.data || {};
		const mockId = id || (link ? String(link).split("/v3/")[1] : null);
		if (!mockId) {
			throw new Error("No link or ID returned from Mocky server");
		}
		return {
			url: `${MOCKY_BASE_URL}/view/${mockId}`,
			raw: `${MOCKY_BASE_URL}/v3/${mockId}`
		};
	}
	catch (error: any) {
		const detail = error.response?.data?.message || error.response?.data || error.message;
		throw new Error(`Mocky Error: ${typeof detail === "object" ? JSON.stringify(detail) : detail}`);
	}
}

function extractFileMetadata(filePath: string): { name: string; aliases: string[] } {
	const fallbackName = path.basename(filePath).replace(/\.(js|ts)$/i, "").toLowerCase();
	const aliases: string[] = [];
	try {
		const content = fs.readFileSync(filePath, "utf8");
		const nameMatch = content.match(/name\s*:\s*[\x22\x27\x60]([^\x22\x27\x60]+)[\x22\x27\x60]/);
		const parsedName = nameMatch ? nameMatch[1].trim().toLowerCase() : fallbackName;
		const aliasBlockMatch = content.match(/aliases\s*:\s*\[([\s\S]*?)\]/);
		if (aliasBlockMatch && aliasBlockMatch[1]) {
			const itemRegex = /[\x22\x27\x60]([^\x22\x27\x60]+)[\x22\x27\x60]/g;
			let match: RegExpExecArray | null;
			while ((match = itemRegex.exec(aliasBlockMatch[1])) !== null) {
				const a = match[1].trim().toLowerCase();
				if (a && !aliases.includes(a)) {
					aliases.push(a);
				}
			}
		}
		return { name: parsedName, aliases };
	}
	catch {
		return { name: fallbackName, aliases };
	}
}

function buildCommandCatalog(): CommandEntry[] {
	const catalogMap = new Map<string, CommandEntry>();

	const addOrUpdateEntry = (filePath: string, nameHint?: string, extraAliases?: string[]) => {
		if (!filePath || !fs.existsSync(filePath)) return;
		const normalizedPath = path.resolve(filePath);
		const displayName = path.basename(normalizedPath);
		const stem = displayName.replace(/\.(js|ts)$/i, "").toLowerCase();
		const meta = extractFileMetadata(normalizedPath);
		const primaryName = (nameHint || meta.name || stem).toLowerCase();

		const existing = catalogMap.get(normalizedPath) || {
			name: primaryName,
			displayName,
			filePath: normalizedPath,
			aliases: []
		};

		const mergedAliases = new Set<string>(existing.aliases);
		if (stem !== existing.name) mergedAliases.add(stem);
		if (meta.name && meta.name !== existing.name) mergedAliases.add(meta.name);
		for (const a of meta.aliases) {
			if (a && a !== existing.name) mergedAliases.add(a);
		}
		if (Array.isArray(extraAliases)) {
			for (const a of extraAliases) {
				const cleanA = String(a || "").trim().toLowerCase();
				if (cleanA && cleanA !== existing.name) mergedAliases.add(cleanA);
			}
		}
		existing.aliases = Array.from(mergedAliases);
		catalogMap.set(normalizedPath, existing);
	};

	const dirsToScan = [
		__dirname,
		path.join(__dirname, "..", "events")
	];

	for (const dir of dirsToScan) {
		if (!fs.existsSync(dir)) continue;
		try {
			const files = fs.readdirSync(dir);
			for (const file of files) {
				if (!/\.(js|ts)$/i.test(file) || /\.eg\.(js|ts)$/i.test(file) || /\.compiled\.js$/i.test(file)) {
					continue;
				}
				const fullPath = path.join(dir, file);
				if (fs.statSync(fullPath).isFile()) {
					addOrUpdateEntry(fullPath);
				}
			}
		}
		catch {
		}
	}

	const goatBot = (global as any).GoatBot;
	if (goatBot) {
		if (goatBot.commands instanceof Map) {
			for (const [cmdName, cmdObj] of goatBot.commands.entries()) {
				const loc = cmdObj?.location || path.join(__dirname, `${cmdName}.ts`);
				const cfgAliases = Array.isArray(cmdObj?.config?.aliases) ? cmdObj.config.aliases : [];
				addOrUpdateEntry(loc, String(cmdName).toLowerCase(), cfgAliases);
			}
		}
		if (goatBot.eventCommands instanceof Map) {
			for (const [evName, evObj] of goatBot.eventCommands.entries()) {
				const loc = evObj?.location || path.join(__dirname, "..", "events", `${evName}.ts`);
				const cfgAliases = Array.isArray(evObj?.config?.aliases) ? evObj.config.aliases : [];
				addOrUpdateEntry(loc, String(evName).toLowerCase(), cfgAliases);
			}
		}
		if (goatBot.aliases instanceof Map) {
			for (const [alias, targetName] of goatBot.aliases.entries()) {
				const lowerTarget = String(targetName || "").toLowerCase();
				const lowerAlias = String(alias || "").toLowerCase();
				for (const entry of catalogMap.values()) {
					if (entry.name === lowerTarget || entry.displayName.replace(/\.(js|ts)$/i, "").toLowerCase() === lowerTarget) {
						if (lowerAlias && lowerAlias !== entry.name && !entry.aliases.includes(lowerAlias)) {
							entry.aliases.push(lowerAlias);
						}
					}
				}
			}
		}
	}

	return Array.from(catalogMap.values());
}

function levenshteinDistance(a: string, b: string): number {
	const m = a.length;
	const n = b.length;
	if (m === 0) return n;
	if (n === 0) return m;

	const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
	for (let i = 0; i <= m; i++) dp[i][0] = i;
	for (let j = 0; j <= n; j++) dp[0][j] = j;

	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			dp[i][j] = Math.min(
				dp[i - 1][j] + 1,
				dp[i][j - 1] + 1,
				dp[i - 1][j - 1] + cost
			);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
				dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
			}
		}
	}
	return dp[m][n];
}

function isSubsequence(shortStr: string, longStr: string): boolean {
	let i = 0;
	let j = 0;
	while (i < shortStr.length && j < longStr.length) {
		if (shortStr[i] === longStr[j]) i++;
		j++;
	}
	return i === shortStr.length;
}

function computeStringSimilarity(query: string, target: string): number {
	const q = query.toLowerCase().trim();
	const t = target.toLowerCase().trim();
	if (!q || !t) return 0;
	if (q === t) return 1;

	const maxLen = Math.max(q.length, t.length);
	const dist = levenshteinDistance(q, t);
	const editScore = 1 - dist / maxLen;

	let bonus = 0;
	if (t.startsWith(q) || q.startsWith(t)) {
		bonus += 0.35;
	}
	else if (t.includes(q) || q.includes(t)) {
		bonus += 0.25;
	}
	else if (q.length >= 2 && isSubsequence(q, t)) {
		bonus += 0.2;
	}

	if (q[0] === t[0]) {
		bonus += 0.08;
	}

	return Math.min(0.99, editScore + bonus);
}

function resolveCommandFile(rawInput: string): CommandEntry | null {
	const baseInput = path.basename(String(rawInput || "").trim());
	if (!baseInput) return null;

	const cleanName = baseInput.replace(/\.(js|ts)$/i, "").toLowerCase();
	const catalog = buildCommandCatalog();

	for (const entry of catalog) {
		if (
			entry.displayName.toLowerCase() === baseInput.toLowerCase() ||
			entry.name.toLowerCase() === cleanName ||
			entry.displayName.replace(/\.(js|ts)$/i, "").toLowerCase() === cleanName
		) {
			return entry;
		}
	}

	for (const entry of catalog) {
		if (entry.aliases.some(alias => alias.toLowerCase() === cleanName)) {
			return entry;
		}
	}

	return null;
}

function findTopSimilarCommands(rawInput: string, limit = 3): { entry: CommandEntry; matchedKey: string; score: number }[] {
	const cleanQuery = path.basename(String(rawInput || "").trim()).replace(/\.(js|ts)$/i, "").toLowerCase();
	if (!cleanQuery) return [];

	const catalog = buildCommandCatalog();
	const scored: { entry: CommandEntry; matchedKey: string; score: number }[] = [];

	for (const entry of catalog) {
		const stem = entry.displayName.replace(/\.(js|ts)$/i, "").toLowerCase();
		const keysToCheck = Array.from(new Set([entry.name, stem, ...entry.aliases]));
		let bestScore = 0;
		let bestKey = entry.name;

		for (const key of keysToCheck) {
			const s = computeStringSimilarity(cleanQuery, key);
			if (s > bestScore) {
				bestScore = s;
				bestKey = key;
			}
		}

		if (bestScore > 0.15) {
			scored.push({
				entry,
				matchedKey: bestKey,
				score: bestScore
			});
		}
	}

	scored.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));
	return scored.slice(0, limit);
}

function detectInvokedService(commandName: string, eventBody: string): "pastebin" | "mocky" {
	if (String(commandName || "").toLowerCase() === "mocky") {
		return "mocky";
	}
	const body = String(eventBody || "").trim();
	const firstToken = body.split(/\s+/)[0] || "";
	const strippedPrefix = firstToken.replace(/^[^a-zA-Z0-9]+/, "").toLowerCase();
	if (strippedPrefix === "mocky") {
		return "mocky";
	}
	return "pastebin";
}

function parseArgs(args: string[], commandName = "", eventBody = "") {
	const options = {
		title: "Untitled Paste",
		expiration: "1W",
		privacy: "0",
		service: detectInvokedService(commandName, eventBody),
		content: "",
		fileName: ""
	};

	const validServices = ["pastebin", "mocky"];
	const contentParts: string[] = [];

	for (const arg of args || []) {
		if (arg.startsWith("-t:")) {
			options.title = arg.slice(3) || "Untitled Paste";
		}
		else if (arg.startsWith("-e:") && EXPIRATION_LABELS[arg.slice(3).toUpperCase()]) {
			options.expiration = arg.slice(3).toUpperCase();
		}
		else if (arg.startsWith("-p:") && PRIVACY_LABELS[arg.slice(3)]) {
			options.privacy = arg.slice(3);
		}
		else if (arg.startsWith("-s:") && validServices.includes(arg.slice(3).toLowerCase())) {
			options.service = arg.slice(3).toLowerCase() as "pastebin" | "mocky";
		}
		else if (arg.startsWith("-f:")) {
			options.fileName = path.basename(arg.slice(3));
		}
		else {
			contentParts.push(arg);
		}
	}

	options.content = contentParts.join(" ").trim();
	return options;
}

function buildSuccessMessage(options: any, result: { url: string; raw: string }) {
	const lines = [
		"📋 Paste created successfully!",
		"",
		`🔗 URL: ${result.url}`,
		`📝 Raw URL: ${result.raw}`,
		`📑 Title: ${options.title}`,
		`🔧 Service: ${options.service}`,
		`⏳ Expires: ${EXPIRATION_LABELS[options.expiration] || "1 Year"}`
	];
	if (options.service === "pastebin") {
		lines.push(`🔒 Privacy: ${PRIVACY_LABELS[options.privacy]}`);
	}
	return lines.join("\n");
}

async function uploadWithServiceFallback(textToPaste: string, options: any) {
	if (options.service === "mocky") {
		try {
			return await createMockyPaste(textToPaste, options.expiration);
		}
		catch {
			const res = await createPastebinPaste(textToPaste, options.title, options.expiration, options.privacy);
			options.service = "pastebin";
			return res;
		}
	}
	else {
		try {
			return await createPastebinPaste(textToPaste, options.title, options.expiration, options.privacy);
		}
		catch {
			const res = await createMockyPaste(textToPaste, options.expiration);
			options.service = "mocky";
			return res;
		}
	}
}

async function deliverResultMessage(api: any, message: any, processingMessage: any, text: string): Promise<string | null> {
	if (processingMessage && processingMessage.messageID) {
		try {
			if (message && typeof message.edit === "function") {
				await message.edit(text, processingMessage.messageID);
				return processingMessage.messageID;
			}
			if (api && typeof api.editMessage === "function") {
				await api.editMessage(text, processingMessage.messageID);
				return processingMessage.messageID;
			}
		}
		catch {
		}
	}
	if (message && typeof message.reply === "function") {
		const sent = await message.reply(text);
		return sent && sent.messageID ? sent.messageID : (processingMessage?.messageID || null);
	}
	return processingMessage?.messageID || null;
}

function buildSuggestionMessage(rawQuery: string, suggestions: { entry: CommandEntry; matchedKey: string; score: number }[]) {
	const cleanQuery = rawQuery.replace(/\.(js|ts)$/i, "");
	const lines = [
		`⚠️ Command or file "${cleanQuery}" not found.`,
		"Did you mean one of these?",
		""
	];

	suggestions.forEach((item, idx) => {
		const aliasText = item.entry.aliases.length > 0
			? ` (aliases: ${item.entry.aliases.slice(0, 4).join(", ")})`
			: "";
		lines.push(`${idx + 1}. ${item.entry.name} [${item.entry.displayName}]${aliasText}`);
	});

	lines.push("");
	lines.push("💡 Reply with 1, 2, or 3 to upload the matching command.");
	return lines.join("\n");
}

module.exports = {
	config: {
		name: "paste",
		aliases: ["pastebin", "mocky", "bin"],
		version: "2.4.0",
		author: "Priyanshi Kaur",
		countDown: 5,
		role: 0,
		shortDescription: "Create pastes on various services",
		longDescription: "Upload text or code to Pastebin or Mocky with alias lookup and smart command suggestions",
		category: "utility",
		guide: {
			en:
				"Usage:\n" +
				"1. Direct text: {p}paste [options] <content>\n" +
				"2. Reply to message: {p}paste [options]\n" +
				"3. Upload command by name or alias: {p}paste -f:commandOrAlias\n\n" +
				"Options:\n" +
				"-t:<title> : Set paste title\n" +
				"-e:<expiration> : Set expiration (N, 10M, 1H, 1D, 1W, 2W, 1M, 6M, 1Y)\n" +
				"-p:<privacy> : Set privacy (0=public, 1=unlisted, 2=private)\n" +
				"-s:<service> : Select service (pastebin, mocky)\n" +
				"-f:<filename|alias> : Upload command file (.ts, .js, or command alias)\n\n" +
				"Examples:\n" +
				"{p}paste -t:MyCode -e:1D Some code here\n" +
				"{p}paste -s:mocky -f:help\n" +
				"{p}bin -f:ai\n" +
				"{p}bin -f:yt\n" +
				"Reply with: {p}paste -t:SavedText"
		}
	},

	onStart: async function ({ api, event, args, message, commandName }: any) {
		let processingMessage: any = null;
		try {
			const options = parseArgs(args, commandName, event?.body);
			processingMessage = await message.reply("📤 Processing your request...");

			let textToPaste = "";

			if (options.fileName) {
				const resolved = resolveCommandFile(options.fileName);
				if (!resolved) {
					const suggestions = findTopSimilarCommands(options.fileName, 3);
					if (suggestions.length > 0) {
						const suggestText = buildSuggestionMessage(options.fileName, suggestions);
						const promptMsgId = await deliverResultMessage(api, message, processingMessage, suggestText);
						if (promptMsgId && (global as any).GoatBot?.onReply) {
							(global as any).GoatBot.onReply.set(promptMsgId, {
								commandName: commandName || "paste",
								messageID: promptMsgId,
								author: event.senderID,
								suggestions: suggestions.map(s => s.entry),
								options
							});
						}
						return;
					}
					const cleanName = options.fileName.replace(/\.(js|ts)$/i, "");
					throw new Error(`File or command not found: ${cleanName}`);
				}
				textToPaste = fs.readFileSync(resolved.filePath, "utf8");
				if (options.title === "Untitled Paste") {
					options.title = `Command: ${resolved.displayName}`;
				}
			}
			else if (event?.messageReply || event?.type === "message_reply") {
				const replyObj = event.messageReply || {};
				textToPaste = replyObj.body || "";
				const attachments = Array.isArray(replyObj.attachments) ? replyObj.attachments : [];
				if (attachments.length > 0) {
					const attachmentInfo = attachments
						.map((att: any) => `[Attachment: ${att.type}${att.url ? ` - ${att.url}` : ""}]`)
						.join("\n");
					textToPaste = textToPaste
						? `${textToPaste}\n\nAttachments:\n${attachmentInfo}`
						: `Attachments:\n${attachmentInfo}`;
				}
				if (options.title === "Untitled Paste") {
					options.title = "Saved Reply";
				}
			}
			else if (options.content) {
				if (args.length === 1) {
					const singleFileResolved = resolveCommandFile(options.content);
					if (singleFileResolved) {
						textToPaste = fs.readFileSync(singleFileResolved.filePath, "utf8");
						if (options.title === "Untitled Paste") {
							options.title = `Command: ${singleFileResolved.displayName}`;
						}
					}
					else {
						textToPaste = options.content;
					}
				}
				else {
					textToPaste = options.content;
				}
			}
			else {
				throw new Error("Please provide content to paste, reply to a message, or specify a command file.");
			}

			if (!textToPaste) {
				throw new Error("The selected content or file is empty.");
			}

			const result = await uploadWithServiceFallback(textToPaste, options);

			await deliverResultMessage(api, message, processingMessage, buildSuccessMessage(options, result));
			if (api && typeof api.setMessageReaction === "function") {
				api.setMessageReaction("✅", event.messageID, () => {}, true);
			}
		}
		catch (error: any) {
			const errorMessage = `❌ Error: ${error.message}`;
			await deliverResultMessage(api, message, processingMessage, errorMessage);
			if (api && typeof api.setMessageReaction === "function") {
				api.setMessageReaction("❌", event.messageID, () => {}, true);
			}
		}
	},

	onReply: async function ({ api, event, message, Reply }: any) {
		const { author, messageID, suggestions, options } = Reply || {};
		if (author && String(event.senderID) !== String(author)) {
			return;
		}
		if (!Array.isArray(suggestions) || suggestions.length === 0) {
			return;
		}

		const choice = parseInt(String(event.body || "").trim(), 10);
		if (isNaN(choice) || choice < 1 || choice > suggestions.length) {
			return;
		}

		if ((global as any).GoatBot?.onReply && messageID) {
			(global as any).GoatBot.onReply.delete(messageID);
		}

		const selected: CommandEntry = suggestions[choice - 1];
		const replyOptions = { ...(options || {}) };
		let processingMessage: any = messageID ? { messageID } : null;

		try {
			await deliverResultMessage(api, message, processingMessage, `📤 Uploading ${selected.displayName}...`);
			const textToPaste = fs.readFileSync(selected.filePath, "utf8");
			if (!replyOptions.title || replyOptions.title === "Untitled Paste") {
				replyOptions.title = `Command: ${selected.displayName}`;
			}
			const result = await uploadWithServiceFallback(textToPaste, replyOptions);
			await deliverResultMessage(api, message, processingMessage, buildSuccessMessage(replyOptions, result));
			if (api && typeof api.setMessageReaction === "function") {
				api.setMessageReaction("✅", event.messageID, () => {}, true);
			}
		}
		catch (error: any) {
			await deliverResultMessage(api, message, processingMessage, `❌ Error: ${error.message}`);
			if (api && typeof api.setMessageReaction === "function") {
				api.setMessageReaction("❌", event.messageID, () => {}, true);
			}
		}
	}
};