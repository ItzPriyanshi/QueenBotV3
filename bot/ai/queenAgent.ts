const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const https = require("https");
const toolRegistry = require("./toolRegistry");

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const DATA_DIR = path.join(process.cwd(), "scripts", "cmds");
const HISTORY_FILE = path.join(DATA_DIR, "ai_history.json");
const SCHEDULES_FILE = path.join(DATA_DIR, "ai_schedules.json");
const RESPONSE_RULES_FILE = path.join(DATA_DIR, "ai_response_rules.json");

const activeTimers = new Map();
let savedRuntimeContext = null;

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

function loadHistoryStore() {
	const store = readJsonSafe(HISTORY_FILE, { users: {}, aiMessages: {}, threadSettings: {} });
	if (!store.users || typeof store.users !== "object") store.users = {};
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

function appendUserHistoryTurn(uid, userPrompt, assistantReply) {
	const store = loadHistoryStore();
	const key = String(uid);
	if (!store.users[key] || typeof store.users[key] !== "object" || Array.isArray(store.users[key])) {
		store.users[key] = { turns: [], model: "gemini-auto" };
	}
	if (!Array.isArray(store.users[key].turns)) {
		store.users[key].turns = [];
	}
	store.users[key].turns.push({
		user: String(userPrompt || "").slice(0, 1200),
		assistant: String(assistantReply || "").slice(0, 1600),
		ts: Date.now()
	});
	store.users[key].turns = store.users[key].turns.slice(-12);
	writeJsonSafe(HISTORY_FILE, store);
}

function getRecentHistoryContext(uid, maxTokens = 900) {
	const store = loadHistoryStore();
	const turns = store.users[String(uid)]?.turns;
	if (!Array.isArray(turns) || turns.length === 0) return "";
	const formatted = turns
		.slice(-6)
		.map(t => `User: ${t.user}\nQueen Bot: ${t.assistant}`)
		.join("\n\n");
	return toolRegistry.truncateToTokenBudget(formatted, maxTokens);
}

function clearLocalHistory(uid) {
	const store = loadHistoryStore();
	const key = String(uid);
	if (store.users[key]) {
		store.users[key].turns = [];
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
		``,
		`TEMPORAL & SMART TASK RULES:`,
		...temporalRules.map(r => `• ${r}`),
		``,
		`AGENTIC <QUEEN_ACTION> JSON PROTOCOL:`,
		`When you need to execute a command tool, schedule a one-time delayed task, schedule a recurring task, call an FCA API, search the web, modify a command response, or read/edit/create/reload a script, output a valid JSON object inside <QUEEN_ACTION>...</QUEEN_ACTION>:`,
		`1. Single immediate command: <QUEEN_ACTION>{"action":"run_tool","command":"<name>","args":[...],"modifyResponse":"<optional>"}</QUEEN_ACTION>`,
		`2. One-time delayed task ("after 1 hour", "in 10 minutes" — runs ONCE, never repeats): <QUEEN_ACTION>{"action":"schedule_once","delaySeconds":3600,"description":"...","steps":[{"command":"<name>","args":[...],"fuzzySearch":true}]}</QUEEN_ACTION>`,
		`3. Multi-step sequence (runs once): <QUEEN_ACTION>{"action":"run_workflow","steps":[{"command":"<name>","args":[],"delaySecondsBefore":0}]}</QUEEN_ACTION>`,
		`4. Recurring schedule (ONLY when user says "every X hours/minutes/days"): <QUEEN_ACTION>{"action":"schedule_workflow","intervalSeconds":86400,"runImmediately":true,"description":"...","steps":[...]}</QUEEN_ACTION>`,
		`5. Manage schedules/timers: <QUEEN_ACTION>{"action":"manage_schedules","subAction":"list|stop|pause|resume|clear","scheduleId":"..."}</QUEEN_ACTION>`,
		`6. Independent FCA API call (${fcaMethods}): <QUEEN_ACTION>{"action":"call_fca_api","method":"<methodName>","args":[...]}</QUEEN_ACTION>`,
		`7. Web/YouTube search for fuzzy queries: <QUEEN_ACTION>{"action":"web_search","query":"...","thenRunCommand":"<optional_cmd>","thenArgsPrefix":["-a"]}</QUEEN_ACTION>`,
		`8. Persistent command output modifier: <QUEEN_ACTION>{"action":"set_response_modifier","command":"<name>","mode":"ai_rewrite|replace|append|prepend|reset","instruction":"..."}</QUEEN_ACTION>`,
		`9. Script management (Owner/Admin): <QUEEN_ACTION>{"action":"read_script|modify_script|create_script|reload_script","target":"<scriptName>","instruction":"...","code":"..."}</QUEEN_ACTION>`,
		``,
		`AVAILABLE COMMAND TOOLS:`,
		toolCatalog
	].join("\n");

	return toolRegistry.truncateToTokenBudget(fullSystem, maxSysTokens);
}

async function callMeowGeminiApi({ prompt, uid, model = "gemini-auto", system = "" }) {
	const vault = toolRegistry.loadEncryptedTrainData();
	const endpoint = vault.apiConfig?.fullEndpoint || ["https:", "", "meow-dl.onrender.com", "g"].join("/");
	const timeoutMs = vault.apiConfig?.timeoutMs || 45000;
	const maxPromptTokens = vault.tokenizerConfig?.maxInputTokens || 6000;

	const safePrompt = toolRegistry.truncateToTokenBudget(prompt, maxPromptTokens);
	const payload = {
		prompt: safePrompt,
		model: model || "gemini-auto",
		uid: String(uid || "queenbot_default"),
		...(system ? { system } : {})
	};

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
	catch {
	}

	try {
		const params = new URLSearchParams();
		params.set("prompt", safePrompt);
		params.set("model", model || "gemini-auto");
		if (uid) params.set("uid", String(uid));
		if (system) params.set("system", toolRegistry.truncateToTokenBudget(system, 900));

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
			throw new Error(getRes.data.error);
		}
	}
	catch (err) {
		return {
			ok: false,
			error: err?.response?.data?.error || err?.message || "Failed to reach Queen AI endpoint"
		};
	}

	return {
		ok: false,
		error: "Empty response from Queen AI endpoint"
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
		const preferredMusicTool = toolRegistry.resolveToolName("ytb") || toolRegistry.resolveToolName("sing") || "ytb";
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
		/(?:(?:use|run|trigger|execute|call|start|launch|invoke)(?:\s*,\s*|\s+or\s+|\s+and\s+|\s+))+(?:the\s+)?([a-zA-Z0-9_$-]+)(?:\s+command|\s+cmd)?(?:\s+with\s+args?\s+(.+)|\s+(.+))?$/i
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

	const cmdBeforeWord = stripped.match(/^([a-zA-Z0-9_$-]+)\s+(?:command|cmd)$/i);
	if (cmdBeforeWord) {
		const rawCmd = cmdBeforeWord[1].trim();
		const canonical = toolRegistry.resolveToolName(rawCmd) || rawCmd.toLowerCase();
		return {
			command: canonical,
			args: [],
			delaySecondsBefore
		};
	}

	return null;
}

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

async function deliverAgentMessage(message, api, thinkingMsg, text, attachments = [], authorID = "", threadID = "") {
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
			if (global.GoatBot?.onReply instanceof Map) {
				global.GoatBot.onReply.set(msgId, { commandName: "ai", messageID: msgId, author: String(authorID) });
			}
		}
		return msgId;
	}

	if (thinkingMsg?.messageID) {
		recordAiMessageId(thinkingMsg.messageID, authorID, threadID);
		if (global.GoatBot?.onReply instanceof Map) {
			global.GoatBot.onReply.set(thinkingMsg.messageID, {
				commandName: "ai",
				messageID: thinkingMsg.messageID,
				author: String(authorID)
			});
		}
		try {
			if (message && typeof message.edit === "function") {
				const edited = await message.edit(formattedText, thinkingMsg.messageID);
				const finalId = edited?.messageID || thinkingMsg.messageID;
				recordAiMessageId(finalId, authorID, threadID);
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
			if (global.GoatBot?.onReply instanceof Map) {
				global.GoatBot.onReply.set(finalId, { commandName: "ai", messageID: finalId, author: String(authorID) });
			}
		}
		return finalId;
	}
	return null;
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

	for (const actObj of actions) {
		const actionType = String(actObj.action || "").toLowerCase();

		if (actionType === "run_tool") {
			const cmdName = actObj.command;
			const cmdArgs = Array.isArray(actObj.args) ? actObj.args : [];
			const modifyInstruction = String(actObj.modifyResponse || "").trim();

			const toolResult = await toolRegistry.executeCommandAsTool({
				commandName: cmdName,
				args: cmdArgs,
				...execContext,
				captureOutput: true
			});

			if (!toolResult.ok) {
				await deliverAgentMessage(
					message,
					api,
					thinkingMsg,
					`⚠️ ${honorific}, I could not run "${cmdName}": ${toolResult.error}`,
					[],
					uid,
					threadID
				);
				continue;
			}

			let finalBody = toolResult.capturedText;
			if (modifyInstruction && finalBody) {
				finalBody = await rewriteTextWithQueenAi( toolResult.commandName, finalBody, modifyInstruction, uid );
			}
			else if (finalBody && !toolResult.attachments?.length) {
				const synthPrompt =
					`[TOOL EXECUTION RESULT FOR ${honorific.toUpperCase()}]\n` +
					`Tool "${toolResult.commandName}" returned:\n${finalBody}\n\n` +
					`Present this result naturally as Queen Bot addressing ${honorific}. Keep all metrics, numbers, and links accurate.`;
				const synthRes = await callMeowGeminiApi({
					prompt: synthPrompt,
					uid: `synth_${uid}`,
					model: "gemini-flash"
				});
				if (synthRes.ok && synthRes.response) {
					finalBody = synthRes.response;
				}
			}

			await deliverAgentMessage(
				message,
				api,
				thinkingMsg,
				finalBody || `✅ Executed ${prefix}${toolResult.commandName} for you, ${honorific}.`,
				toolResult.attachments || [],
				uid,
				threadID
			);
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
			if (thinkingMsg?.messageID && message?.unsend) {
				try { await message.unsend(thinkingMsg.messageID); } catch {}
			}
			await executeScheduledSteps(rawSteps, execContext);
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
				const toolRes = await toolRegistry.executeCommandAsTool({
					commandName: actObj.thenRunCommand,
					args: [...prefixArgs, ...searchRes.resolvedQuery.split(/\s+/)],
					...execContext,
					captureOutput: false
				});
				if (thinkingMsg?.messageID && message?.unsend && toolRes.ok) {
					try { await message.unsend(thinkingMsg.messageID); } catch {}
				}
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
		else if (["read_script", "modify_script", "create_script", "reload_script"].includes(actionType)) {
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

	const userIdentity = await toolRegistry.resolveUserIdentity({
		api,
		usersData,
		senderID: uid,
		role
	});
	const honorific = userIdentity.isOwner ? "My Queen" : userIdentity.name;

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
	const recentHistory = getRecentHistoryContext(uid, 700);
	const replyContext = event?.messageReply?.body
		? `\n[Replied Message: "${String(event.messageReply.body).slice(0, 500)}"]`
		: "";

	const compositePrompt = [
		recentHistory ? `[Recent Chat Context]:\n${recentHistory}\n` : "",
		`[User (${honorific}, UID: ${uid})]: ${rawPrompt}${replyContext}`
	]
		.filter(Boolean)
		.join("\n");

	const activeModel = getUserModelPreference(uid);
	const apiRes = await callMeowGeminiApi({
		prompt: compositePrompt,
		uid,
		model: activeModel,
		system: systemInstruction
	});

	if (!apiRes.ok) {
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
		appendUserHistoryTurn(uid, rawPrompt, `[Executed Actions: ${parsedActions.map(a => a.action).join(", ")}]`);
		return;
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
	appendUserHistoryTurn(uid, rawPrompt, cleanReply);
}

const QueenAIGlobalBridge = {
	version: "9.0.0",
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