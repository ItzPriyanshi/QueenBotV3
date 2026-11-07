const fs = require("fs");
const path = require("path");
const axios = require("axios");

const PriyaPrefix = ["queen", "ai"];
const historyFile = path.join(__dirname, "ai_history.json");
const schedulesFile = path.join(__dirname, "ai_schedules.json");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || (global as any).config?.geminiApiKey || "YOUR_GEMIN_API_KEY"; // place your api key from https://aistudio.google.com/api-keys
const GEMINI_MODEL = "gemini-2.5-flash"; // choose model according to your billing plans
const MAX_HISTORY_MESSAGES = 20; // max 100 if 100+ it may react differently or buffer 

interface WorkflowStep {
	command: string;
	args: string[];
	delaySecondsBefore?: number;
	repeatCount?: number;
}

interface PersistedSchedule {
	id: string;
	threadID: string;
	authorID: string;
	role: number;
	prefix: string;
	intervalMs: number;
	steps: WorkflowStep[];
	description: string;
	createdAt: number;
	lastRunAt?: number;
	runCount: number;
	maxRuns?: number;
	paused?: boolean;
}

const activeTimers = new Map<string, ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>>();
let savedRuntimeContext: any = null;

function sleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

function ensureFile(file: string, defaultValue: any) {
	if (!fs.existsSync(file)) {
		fs.writeFileSync(file, JSON.stringify(defaultValue, null, 2), "utf8");
	}
}

function readJsonFile(file: string, defaultValue: any) {
	ensureFile(file, defaultValue);
	try {
		const content = fs.readFileSync(file, "utf8");
		return JSON.parse(content || JSON.stringify(defaultValue));
	}
	catch {
		fs.writeFileSync(file, JSON.stringify(defaultValue, null, 2), "utf8");
		return defaultValue;
	}
}

function writeJsonFile(file: string, value: any) {
	fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function loadHistory(uid: string) {
	const all = readJsonFile(historyFile, {});
	if (!Array.isArray(all[uid])) {
		all[uid] = [];
	}
	return all;
}

function saveHistory(uid: string, history: any[]) {
	const all = readJsonFile(historyFile, {});
	all[uid] = history
		.filter(
			item =>
				item &&
				["user", "model"].includes(item.role) &&
				Array.isArray(item.parts) &&
				item.parts.length > 0
		)
		.slice(-MAX_HISTORY_MESSAGES);
	writeJsonFile(historyFile, all);
}

function resetHistory(uid: string) {
	const all = readJsonFile(historyFile, {});
	all[uid] = [];
	writeJsonFile(historyFile, all);
}

function loadSchedules(): PersistedSchedule[] {
	const data = readJsonFile(schedulesFile, []);
	return Array.isArray(data) ? data : [];
}

function saveSchedules(list: PersistedSchedule[]) {
	writeJsonFile(schedulesFile, list);
}

function normalizeCommand(body: string) {
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

function registerReply(messageID: string, author: string) {
	if (
		messageID &&
		(global as any).GoatBot &&
		(global as any).GoatBot.onReply &&
		typeof (global as any).GoatBot.onReply.set === "function"
	) {
		(global as any).GoatBot.onReply.set(messageID, {
			commandName: "ai",
			messageID,
			author: String(author)
		});
	}
}

async function deliverAiResponse(message: any, api: any, thinking: any, text: string): Promise<string | null> {
	if (thinking && thinking.messageID) {
		try {
			if (message && typeof message.edit === "function") {
				await message.edit(text, thinking.messageID);
				return thinking.messageID;
			}
			if (api && typeof api.editMessage === "function") {
				await api.editMessage(text, thinking.messageID);
				return thinking.messageID;
			}
		}
		catch {
		}
	}
	if (message && typeof message.reply === "function") {
		const sent = await message.reply(text);
		return sent && sent.messageID ? sent.messageID : (thinking?.messageID || null);
	}
	return thinking?.messageID || null;
}

function createSyntheticMessage(api: any, threadID: string, replyToMessageID?: string) {
	const utilMsg = (global as any).utils?.message;
	const syntheticEvent = {
		threadID,
		messageID: replyToMessageID || ""
	};
	if (typeof utilMsg === "function") {
		try {
			return utilMsg(api, syntheticEvent);
		}
		catch {
		}
	}
	return {
		send: async (form: any) => {
			if (api && typeof api.sendMessage === "function") {
				return await api.sendMessage(form, threadID);
			}
			return null;
		},
		reply: async (form: any) => {
			if (api && typeof api.sendMessage === "function") {
				return await api.sendMessage(form, threadID, undefined, replyToMessageID);
			}
			return null;
		},
		edit: async (text: string, msgID: string) => {
			if (api && typeof api.editMessage === "function") {
				return await api.editMessage(text, msgID || replyToMessageID);
			}
			return null;
		},
		unsend: async (msgID: string) => {
			if (api && typeof api.unsendMessage === "function") {
				return await api.unsendMessage(msgID);
			}
			return null;
		},
		reaction: async (emoji: string, msgID?: string) => {
			if (api && typeof api.setMessageReaction === "function") {
				return api.setMessageReaction(emoji, msgID || replyToMessageID, () => {}, true);
			}
			return null;
		},
		SyntaxError: async () => null
	};
}

function createGetTextForCommand(cmd: any, prefix: string, langCode: string) {
	const commandType = cmd.config?.countDown ? "command" : "command event";
	const commandName = cmd.config?.name || "unknown";
	const pathCustomLang = `${process.cwd()}/languages/cmds/${langCode}.js`;
	let customLang: any = {};
	if (fs.existsSync(pathCustomLang)) {
		try {
			customLang = require(pathCustomLang)[commandName]?.text || {};
		}
		catch {}
	}
	return function (key: string, ...args: any[]) {
		let lang = cmd.langs?.[langCode]?.[key] || customLang[key] || "";
		for (let i = args.length - 1; i >= 0; i--) {
			lang = lang.replace(new RegExp(`%${i + 1}`, "g"), args[i]);
		}
		return lang || `❌ Can't find text on language "${langCode}" for ${commandType} "${commandName}" with key "${key}"`;
	};
}

function resolveCanonicalCommandName(rawName: string): string | null {
	const clean = String(rawName || "").trim().replace(/^[^a-zA-Z0-9$]+/, "").toLowerCase();
	if (!clean) return null;

	const goatBot = (global as any).GoatBot;
	if (goatBot?.commands?.has(clean)) {
		return clean;
	}
	if (goatBot?.aliases?.has(clean)) {
		const target = goatBot.aliases.get(clean);
		if (target && goatBot.commands?.has(String(target).toLowerCase())) {
			return String(target).toLowerCase();
		}
		return target ? String(target).toLowerCase() : null;
	}

	const synonymMap: Record<string, string> = {
		up2: "uptime2",
		up: "uptime",
		yt: "sing",
		youtube: "sing",
		ytsing: "sing",
		song: "music",
		play: "music",
		pin: "pinterest",
		box: "boxinfo",
		groupinfo: "boxinfo",
		threadinfo: "boxinfo"
	};

	if (synonymMap[clean]) {
		const mapped = synonymMap[clean];
		if (!goatBot?.commands || goatBot.commands.has(mapped)) {
			return mapped;
		}
	}

	return null;
}

function getAvailableCommandsSummary(): string {
	const goatBot = (global as any).GoatBot;
	if (!goatBot?.commands || !(goatBot.commands instanceof Map) || goatBot.commands.size === 0) {
		return "sing, music, ytb, pinterest, uid, uptime, uptime2, weather, boxinfo, admin, getinfo, getlink, help, ping, system, kick, unsend, bin, cmd, event, rank, daily, balance, translate, lyrics, tiktok";
	}
	const summaries: string[] = [];
	for (const [name, cmd] of goatBot.commands.entries()) {
		const aliases = Array.isArray(cmd?.config?.aliases) && cmd.config.aliases.length > 0
			? ` (aliases: ${cmd.config.aliases.slice(0, 3).join(",")})`
			: "";
		const desc = typeof cmd?.config?.shortDescription === "string"
			? cmd.config.shortDescription
			: (cmd?.config?.shortDescription?.en || cmd?.config?.description?.en || "");
		summaries.push(`${name}${aliases}${desc ? `: ${desc.slice(0, 60)}` : ""}`);
	}
	return summaries.slice(0, 80).join("; ");
}

async function extractAttachmentData(event: any): Promise<{ data: string; mimeType: string } | null> {
	let attachment = null;
	if (event.attachments && event.attachments.length > 0) {
		attachment = event.attachments[0];
	}
	else if (event.messageReply && event.messageReply.attachments && event.messageReply.attachments.length > 0) {
		attachment = event.messageReply.attachments[0];
	}
	if (!attachment || !attachment.url) return null;

	try {
		const res = await axios.get(attachment.url, { responseType: "arraybuffer", timeout: 25000 });
		const buffer = Buffer.from(res.data);
		let mimeType = "image/jpeg";
		if (attachment.type === "photo") mimeType = "image/jpeg";
		else if (attachment.type === "animated_image") mimeType = "image/gif";
		else if (attachment.type === "video") mimeType = "video/mp4";
		else if (attachment.type === "audio") mimeType = "audio/mp3";

		return {
			data: buffer.toString("base64"),
			mimeType
		};
	}
	catch {
		return null;
	}
}

async function extractYouTubeContext(text: string): Promise<string | null> {
	const ytMatch = text.match(/(?:https?[:][/][/])?(?:www\.)?(?:youtube\.com[/](?:watch\?v=|shorts[/])|youtu\.be[/])([a-zA-Z0-9_-]{11})/);
	if (!ytMatch) return null;

	try {
		const yts = require("yt-search");
		const videoUrl = ytMatch[0];
		const r = await yts(videoUrl);
		const video = r.videos?.[0] || r;
		if (video && video.title) {
			return `\n\n[YouTube Video Information]:\nTitle: ${video.title}\nAuthor: ${video.author?.name || "Unknown"}\nDuration: ${video.timestamp || "N/A"}\nViews: ${video.views || "N/A"}\nDescription: ${(video.description || "").slice(0, 800)}`;
		}
	}
	catch {}
	return null;
}

async function executeBotCommand(options: {
	commandName: string;
	commandArgs: string[];
	api: any;
	message: any;
	event: any;
	role?: number;
	prefix: string;
	usersData: any;
	threadsData: any;
	threadModel?: any;
	userModel?: any;
	dashBoardModel?: any;
	globalModel?: any;
	dashBoardData?: any;
	globalData?: any;
}): Promise<boolean> {
	const {
		commandName,
		commandArgs,
		api,
		message,
		event,
		role,
		prefix,
		usersData,
		threadsData,
		threadModel,
		userModel,
		dashBoardModel,
		globalModel,
		dashBoardData,
		globalData
	} = options;

	const resolvedName = resolveCanonicalCommandName(commandName) || String(commandName || "").trim().toLowerCase();
	const targetCmd = (global as any).GoatBot?.commands?.get(resolvedName);
	if (!targetCmd || typeof targetCmd.onStart !== "function") {
		return false;
	}

	const requiredRole = typeof targetCmd.config?.role === "number" ? targetCmd.config.role : 0;
	const callerRole = typeof role === "number" ? role : 0;
	if (requiredRole > callerRole) {
		await message.reply(`⚠️ You do not have permission to execute command "${targetCmd.config?.name || resolvedName}".`);
		return true;
	}

	const langCode = (global as any).GoatBot?.config?.language || "en";
	const customGetLang = createGetTextForCommand(targetCmd, prefix, langCode);
	const cleanArgs = Array.isArray(commandArgs) ? commandArgs.map(a => String(a)) : [];
	const syntheticBody = `${prefix || "."}${targetCmd.config?.name || resolvedName}${cleanArgs.length ? " " + cleanArgs.join(" ") : ""}`;
	const commandEvent = {
		...event,
		body: syntheticBody,
		args: cleanArgs
	};

	try {
		await targetCmd.onStart({
			api,
			message,
			event: commandEvent,
			args: cleanArgs,
			role: callerRole,
			usersData,
			threadsData,
			threadModel,
			userModel,
			dashBoardModel,
			globalModel,
			dashBoardData,
			globalData,
			getLang: customGetLang,
			commandName: targetCmd.config?.name || resolvedName,
			prefix
		});
		return true;
	}
	catch (err: any) {
		await message.reply(`❌ Error running command "${resolvedName}": ${err.message}`);
		return true;
	}
}

async function runWorkflowSteps(steps: WorkflowStep[], execContext: {
	api: any;
	message: any;
	event: any;
	role: number;
	prefix: string;
	usersData: any;
	threadsData: any;
	threadModel?: any;
	userModel?: any;
	dashBoardModel?: any;
	globalModel?: any;
	dashBoardData?: any;
	globalData?: any;
}): Promise<number> {
	let executedCount = 0;
	for (const step of steps) {
		if (!step || !step.command) continue;
		const delaySec = Number(step.delaySecondsBefore || 0);
		if (delaySec > 0) {
			await sleep(Math.min(delaySec, 3600) * 1000);
		}
		const repeats = Math.min(Math.max(1, Number(step.repeatCount || 1)), 5);
		for (let r = 0; r < repeats; r++) {
			if (r > 0) {
				await sleep(1000);
			}
			const ok = await executeBotCommand({
				commandName: step.command,
				commandArgs: Array.isArray(step.args) ? step.args : [],
				...execContext
			});
			if (ok) executedCount++;
		}
	}
	return executedCount;
}

function formatDurationHuman(ms: number): string {
	const totalSec = Math.round(ms / 1000);
	if (totalSec % 86400 === 0 && totalSec >= 86400) {
		const days = totalSec / 86400;
		return days === 1 ? "24 hours" : `${days} days`;
	}
	if (totalSec % 3600 === 0 && totalSec >= 3600) {
		const hrs = totalSec / 3600;
		return `${hrs} hour${hrs > 1 ? "s" : ""}`;
	}
	if (totalSec % 60 === 0 && totalSec >= 60) {
		const mins = totalSec / 60;
		return `${mins} minute${mins > 1 ? "s" : ""}`;
	}
	return `${totalSec} second${totalSec !== 1 ? "s" : ""}`;
}

function startScheduleTimer(sched: PersistedSchedule) {
	if (activeTimers.has(sched.id)) {
		clearInterval(activeTimers.get(sched.id) as any);
		activeTimers.delete(sched.id);
	}
	if (sched.paused) return;

	const timer = setInterval(async () => {
		if (!savedRuntimeContext || !savedRuntimeContext.api) return;
		const all = loadSchedules();
		const idx = all.findIndex(s => s.id === sched.id);
		if (idx === -1 || all[idx].paused) {
			clearInterval(timer);
			activeTimers.delete(sched.id);
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
			await runWorkflowSteps(current.steps, {
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
		catch {}

		const updatedList = loadSchedules();
		const uIdx = updatedList.findIndex(s => s.id === sched.id);
		if (uIdx !== -1) {
			updatedList[uIdx].lastRunAt = Date.now();
			updatedList[uIdx].runCount = (updatedList[uIdx].runCount || 0) + 1;
			if (updatedList[uIdx].maxRuns && updatedList[uIdx].runCount >= (updatedList[uIdx].maxRuns as number)) {
				clearInterval(timer);
				activeTimers.delete(sched.id);
				updatedList.splice(uIdx, 1);
			}
			saveSchedules(updatedList);
		}
	}, Math.max(5000, sched.intervalMs));

	if (typeof (timer as any).unref === "function") {
		(timer as any).unref();
	}
	activeTimers.set(sched.id, timer);
}

function registerScheduledWorkflow(params: {
	threadID: string;
	authorID: string;
	role: number;
	prefix: string;
	intervalSeconds: number;
	steps: WorkflowStep[];
	description: string;
	maxRuns?: number;
}): PersistedSchedule {
	const all = loadSchedules();
	const id = `sched_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
	const intervalMs = Math.max(10000, Math.round(Number(params.intervalSeconds) * 1000));
	const newSched: PersistedSchedule = {
		id,
		threadID: String(params.threadID),
		authorID: String(params.authorID),
		role: params.role,
		prefix: params.prefix || ".",
		intervalMs,
		steps: params.steps,
		description: params.description,
		createdAt: Date.now(),
		runCount: 0,
		maxRuns: params.maxRuns
	};
	all.push(newSched);
	saveSchedules(all);
	startScheduleTimer(newSched);
	return newSched;
}

function restoreAllSchedules() {
	const list = loadSchedules();
	for (const sched of list) {
		if (!sched.paused) {
			startScheduleTimer(sched);
		}
	}
}

function parseTimeUnitToSeconds(valueStr: string, unitStr: string): number {
	const val = parseFloat(valueStr);
	if (isNaN(val) || val <= 0) return 0;
	const u = unitStr.toLowerCase();
	if (u.startsWith("d")) return val * 86400;
	if (u.startsWith("h") || u === "hr" || u === "hrs") return val * 3600;
	if (u.startsWith("m") && !u.startsWith("ms")) return val * 60;
	return val;
}

function extractCommandStepFromClause(clause: string): WorkflowStep | null {
	const cleaned = clause.trim();
	if (!cleaned) return null;

	let delaySecondsBefore = 0;
	const delayMatch =
		cleaned.match(/(?:in|after|with|wait(?:ing)?(?:\s+for)?)\s+(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\s*(?:delay\s*)?/i) ||
		cleaned.match(/(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\s+delay/i);

	if (delayMatch) {
		delaySecondsBefore = parseTimeUnitToSeconds(delayMatch[1], delayMatch[2]);
	}

	const withoutDelay = cleaned
		.replace(/(?:after\s+)?every\s+\d+(?:\.\d+)?\s*(?:seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)/gi, " ")
		.replace(/(?:in|after|with|wait(?:ing)?(?:\s+for)?)\s+\d+(?:\.\d+)?\s*(?:seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\s*(?:delay)?/gi, " ")
		.replace(/\d+(?:\.\d+)?\s*(?:seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\s+delay/gi, " ")
		.trim();

	const explicitTriggerMatch = withoutDelay.match(
		/(?:trigger|run|execute|call|use|start|launch|invoke)\s+(?:the\s+)?([a-zA-Z0-9_$-]+)(?:\s+command|\s+cmd)?(?:\s+with\s+args?\s+(.+)|\s+(.+))?$/i
	);

	if (explicitTriggerMatch) {
		const rawCmd = explicitTriggerMatch[1].trim();
		const canonical = resolveCanonicalCommandName(rawCmd) || rawCmd.toLowerCase();
		const rawTail = (explicitTriggerMatch[2] || explicitTriggerMatch[3] || "").trim().replace(/^command\b/i, "").trim();
		const args = rawTail ? rawTail.split(/\s+/) : [];
		return {
			command: canonical,
			args,
			delaySecondsBefore
		};
	}

	const cmdBeforeKeyword = withoutDelay.match(/([a-zA-Z0-9_$-]+)\s+(?:command|cmd)\b/i);
	if (cmdBeforeKeyword) {
		const rawCmd = cmdBeforeKeyword[1].trim();
		const canonical = resolveCanonicalCommandName(rawCmd) || rawCmd.toLowerCase();
		return {
			command: canonical,
			args: [],
			delaySecondsBefore
		};
	}

	const simpleIntent = parseSingleCommandIntent(withoutDelay);
	if (simpleIntent) {
		return {
			command: simpleIntent.command,
			args: simpleIntent.args,
			delaySecondsBefore
		};
	}

	return null;
}

function parseComplexWorkflow(prompt: string): {
	isScheduleManagement?: boolean;
	manageAction?: "list" | "stop" | "clear" | "pause" | "resume";
	targetScheduleId?: string;
	intervalSeconds?: number;
	steps?: WorkflowStep[];
} | null {
	const p = prompt.trim();
	const lower = p.toLowerCase();

	if (/^(?:list|show|view|my|active)\s+(?:all\s+)?(?:schedules?|timers?|tasks?|cron|jobs?)$/i.test(lower)) {
		return { isScheduleManagement: true, manageAction: "list" };
	}
	if (/^(?:clear|stop\s+all|cancel\s+all|delete\s+all|remove\s+all)\s+(?:schedules?|timers?|tasks?|jobs?)$/i.test(lower)) {
		return { isScheduleManagement: true, manageAction: "clear" };
	}
	const stopMatch = p.match(/^(?:stop|cancel|delete|remove|pause|resume)\s+(?:schedule|timer|task|job)\s+([a-zA-Z0-9_-]+)/i);
	if (stopMatch) {
		const verb = stopMatch[0].split(/\s+/)[0].toLowerCase();
		const action = verb === "pause" ? "pause" : verb === "resume" ? "resume" : "stop";
		return {
			isScheduleManagement: true,
			manageAction: action,
			targetScheduleId: stopMatch[1]
		};
	}

	let intervalSeconds = 0;
	const everyMatch = lower.match(/(?:after\s+)?every\s+(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)\b/i);
	if (everyMatch) {
		intervalSeconds = parseTimeUnitToSeconds(everyMatch[1], everyMatch[2]);
	}
	else if (/\b(?:every\s+day|daily)\b/i.test(lower) && /\b(?:trigger|run|execute|command|cmd)\b/i.test(lower)) {
		intervalSeconds = 86400;
	}
	else if (/\b(?:every\s+hour|hourly)\b/i.test(lower) && /\b(?:trigger|run|execute|command|cmd)\b/i.test(lower)) {
		intervalSeconds = 3600;
	}

	const hasMultiStepIndicators =
		intervalSeconds > 0 ||
		/\b(?:and\s+in|and\s+after|and\s+then|then\s+in|then\s+after|then\s+trigger|then\s+run|then\s+execute|delay\s+trigger|delay\s+run|wait\s+\d+)\b/i.test(lower) ||
		/(?:trigger|run|execute)\s+[a-zA-Z0-9_$-]+(?:\s+command)?[\s\S]+(?:trigger|run|execute)\s+[a-zA-Z0-9_$-]+/i.test(lower);

	if (!hasMultiStepIndicators) {
		return null;
	}

	const rawClauses = p
		.split(/\s+(?:and\s+then|then|and(?=\s+(?:in|after|wait|with|\d+|trigger|run|execute|call|use|start)))\s+|[,;]+\s*(?=(?:in|after|wait|then|trigger|run|execute))/i)
		.map(c => c.trim())
		.filter(Boolean);

	const steps: WorkflowStep[] = [];
	for (const clause of rawClauses) {
		const step = extractCommandStepFromClause(clause);
		if (step) {
			steps.push(step);
		}
	}

	if (steps.length === 0) {
		const singleStep = extractCommandStepFromClause(p);
		if (singleStep) {
			steps.push(singleStep);
		}
	}

	if (steps.length === 0) {
		return null;
	}

	return {
		intervalSeconds: intervalSeconds > 0 ? intervalSeconds : undefined,
		steps
	};
}

function isComplexOrMultiClausePrompt(prompt: string): boolean {
	const lower = prompt.trim().toLowerCase();
	if (
		/\b(?:every|schedule|delay|wait|seconds?|secs?|minutes?|mins?|hours?|hrs?|then|after\s+\d+|in\s+\d+|and\s+trigger|and\s+run|and\s+execute|repeat|times)\b/i.test(lower)
	) {
		return true;
	}
	const triggerMatches = lower.match(/\b(?:trigger|run|execute)\b/g);
	if (triggerMatches && triggerMatches.length > 1) {
		return true;
	}
	return false;
}

function parseSingleCommandIntent(prompt: string): { command: string; args: string[] } | null {
	const p = prompt.trim();
	const lower = p.toLowerCase();

	if (isComplexOrMultiClausePrompt(p)) {
		return null;
	}

	const playSongMatch =
		lower.match(/(?:give\s+me\s+song\s+(?:name\s+)?|play\s+(?:song\s+|music\s+|track\s+)?|sing\s+)(.+?)(?:\s+(?:and\s+play\s+it|please))?$/i) ||
		lower.match(/^(?:play|sing)\s+(.+)/i);
	if (playSongMatch && playSongMatch[1]) {
		let song = playSongMatch[1].trim();
		song = song.replace(/^name\s+/i, "").replace(/^shayad\s+by\s+/i, "shayad ").trim();
		return { command: "sing", args: song.split(/\s+/) };
	}

	const pinMatch = lower.match(/(?:pinterest|search\s+(?:images?|pictures?|photos?)\s+(?:of\s+)?|find\s+(?:images?|pictures?)\s+(?:of\s+)?)(.+)/i);
	if (pinMatch && pinMatch[1]) {
		const raw = pinMatch[1].trim();
		let term = raw;
		let count = "6";
		if (raw.includes("-")) {
			const parts = raw.split("-");
			term = parts.slice(0, -1).join("-").trim();
			count = parts[parts.length - 1].trim();
		}
		return { command: "pinterest", args: [term, "-", count] };
	}

	if (/^(?:who\s+(?:is|are)\s+(?:the\s+)?admins?|admin\s+list|list\s+admins?)$/i.test(lower)) {
		return { command: "admin", args: ["list"] };
	}

	if (/^(?:(?:show|trigger|run|check)\s+)?(?:uptime2|up2)(?:\s+command)?$/i.test(lower) || /^(?:bot\s+status|system\s+status|how\s+long\s+have\s+you\s+been\s+running)$/i.test(lower)) {
		return { command: "uptime2", args: [] };
	}

	if (/^(?:(?:show|trigger|run|check)\s+)?uptime(?:\s+command)?$/i.test(lower)) {
		return { command: "uptime", args: [] };
	}

	if (/^(?:(?:check|trigger|run)\s+)?ping(?:\s+command)?$/i.test(lower)) {
		return { command: "ping", args: [] };
	}

	const weatherMatch = lower.match(/^weather(?:\s+in|\s+of|\s+for|\s+at)?\s+([a-zA-Z\s]+)$/i);
	if (weatherMatch && weatherMatch[1]) {
		return { command: "weather", args: weatherMatch[1].trim().split(/\s+/) };
	}

	if (/^(?:group\s+info|box\s+info|thread\s+info|what(?:'s|\s+is)\s+this\s+group)$/i.test(lower)) {
		return { command: "boxinfo", args: [] };
	}

	if (/^(?:system\s+info|hardware\s+specs|server\s+stats)$/i.test(lower)) {
		return { command: "system", args: [] };
	}

	if (/^(?:what\s+can\s+you\s+do|list\s+commands|show\s+commands|commands\s+list)$/i.test(lower)) {
		return { command: "help", args: [] };
	}

	return null;
}

async function callGeminiApi(options: {
	prompt: string;
	attachmentData: { data: string; mimeType: string } | null;
	youtubeContext: string | null;
	history: any[];
}): Promise<{ text: string; functionCalls: any[] }> {
	const { prompt, attachmentData, youtubeContext, history } = options;

	let fullPrompt = prompt;
	if (youtubeContext) {
		fullPrompt += youtubeContext;
	}

	const currentParts: any[] = [{ text: fullPrompt }];
	if (attachmentData) {
		currentParts.push({
			inline_data: {
				mime_type: attachmentData.mimeType,
				data: attachmentData.data
			}
		});
	}

	const contents = [...history, { role: "user", parts: currentParts }];
	const availableCommands = getAvailableCommandsSummary();

	const tools = [
		{
			function_declarations: [
				{
					name: "execute_command",
					description: "Execute a single QueenBot command immediately.",
					parameters: {
						type: "OBJECT",
						properties: {
							command: {
								type: "STRING",
								description: "Command name or alias (e.g. sing, uptime2, ping, pinterest, weather, boxinfo, admin, help, system, bin, ytb, etc.)"
							},
							args: {
								type: "ARRAY",
								items: { type: "STRING" },
								description: "Arguments for the command as an array of strings"
							}
						},
						required: ["command", "args"]
					}
				},
				{
					name: "execute_workflow",
					description: "Execute a multi-step sequence of QueenBot commands with optional delays (in seconds) before each step and optional repeat counts. Use whenever the user asks to run multiple commands, chain actions, or wait/delay between commands.",
					parameters: {
						type: "OBJECT",
						properties: {
							steps: {
								type: "ARRAY",
								description: "Ordered list of command steps to execute sequentially",
								items: {
									type: "OBJECT",
									properties: {
										command: {
											type: "STRING",
											description: "Command name or alias to execute"
										},
										args: {
											type: "ARRAY",
											items: { type: "STRING" },
											description: "Command arguments"
										},
										delaySecondsBefore: {
											type: "NUMBER",
											description: "Seconds to wait before executing this step (0 for immediate)"
										},
										repeatCount: {
											type: "NUMBER",
											description: "Number of times to run this step (default 1)"
										}
									},
									required: ["command", "args"]
								}
							}
						},
						required: ["steps"]
					}
				},
				{
					name: "schedule_workflow",
					description: "Schedule a recurring command or multi-step command workflow to run automatically every N seconds (e.g. every 24 hours = 86400 seconds) and optionally execute the workflow immediately now.",
					parameters: {
						type: "OBJECT",
						properties: {
							intervalSeconds: {
								type: "NUMBER",
								description: "Recurring interval in seconds (e.g. 86400 for 24 hours, 3600 for 1 hour)"
							},
							runImmediately: {
								type: "BOOLEAN",
								description: "Whether to also execute the workflow steps right now (default true)"
							},
							description: {
								type: "STRING",
								description: "Human-readable summary of the scheduled workflow"
							},
							steps: {
								type: "ARRAY",
								description: "Ordered list of command steps to run on each cycle",
								items: {
									type: "OBJECT",
									properties: {
										command: {
											type: "STRING",
											description: "Command name or alias"
										},
										args: {
											type: "ARRAY",
											items: { type: "STRING" },
											description: "Command arguments"
										},
										delaySecondsBefore: {
											type: "NUMBER",
											description: "Seconds to wait before running this step inside the workflow"
										}
									},
									required: ["command", "args"]
								}
							}
						},
						required: ["intervalSeconds", "steps"]
					}
				},
				{
					name: "manage_schedules",
					description: "List, stop/cancel, pause, resume, or clear scheduled recurring workflows.",
					parameters: {
						type: "OBJECT",
						properties: {
							action: {
								type: "STRING",
								description: "One of: list, stop, clear, pause, resume"
							},
							scheduleId: {
								type: "STRING",
								description: "Schedule ID when action is stop, pause, or resume"
							}
						},
						required: ["action"]
					}
				}
			]
		}
	];

	const payload: any = {
		contents,
		system_instruction: {
			parts: [
				{
					text:
						"You are Queen AI, the supreme multimodal assistant and workflow orchestrator for QueenBot v3 created by Priyanshi Kaur. " +
						"You can analyze images, audio, video, YouTube links, answer complex questions, and orchestrate single commands, multi-step delayed command pipelines (execute_workflow), and recurring scheduled workflows (schedule_workflow). " +
						"If a user asks to trigger a command every X hours/minutes AND after a Y-second delay trigger another command (for example: 'trigger uptime2 command after every 24 hours and in 3 second delay trigger ping command'), call schedule_workflow with intervalSeconds=86400, runImmediately=true, and steps=[{command:'uptime2', args:[], delaySecondsBefore:0}, {command:'ping', args:[], delaySecondsBefore:3}]. " +
						`Available bot commands: ${availableCommands}`
				}
			]
		},
		tools,
		generation_config: {
			temperature: 0.4,
			max_output_tokens: 2048
		}
	};

	const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
	const response = await axios.post(url, payload, { timeout: 35000 });
	const candidate = response.data?.candidates?.[0];
	const parts = candidate?.content?.parts || [];

	let textResult = "";
	const functionCalls: any[] = [];

	for (const part of parts) {
		if (part.text) {
			textResult += part.text;
		}
		if (part.functionCall) {
			functionCalls.push(part.functionCall);
		}
	}

	return { text: textResult.trim(), functionCalls };
}

async function handleScheduleManagement(
	action: "list" | "stop" | "clear" | "pause" | "resume",
	targetId: string | undefined,
	threadID: string,
	message: any
) {
	const all = loadSchedules();
	const threadSchedules = all.filter(s => String(s.threadID) === String(threadID));

	if (action === "list") {
		if (threadSchedules.length === 0) {
			return message.reply("📭 No active AI scheduled workflows in this chat.");
		}
		const lines = ["⏰ Active AI Scheduled Workflows:", ""];
		for (const s of threadSchedules) {
			const stepsDesc = s.steps
				.map(st => `${st.delaySecondsBefore ? `(+${st.delaySecondsBefore}s) ` : ""}${st.command}${st.args?.length ? " " + st.args.join(" ") : ""}`)
				.join(" → ");
			lines.push(
				`• ID: ${s.id}\n` +
				`  Interval: every ${formatDurationHuman(s.intervalMs)}\n` +
				`  Pipeline: ${stepsDesc}\n` +
				`  Status: ${s.paused ? "⏸️ Paused" : "🟢 Active"} (Runs: ${s.runCount || 0})`
			);
		}
		lines.push("\n💡 Use `ai stop schedule <ID>` or `ai clear schedules` to manage.");
		return message.reply(lines.join("\n"));
	}

	if (action === "clear") {
		for (const s of threadSchedules) {
			if (activeTimers.has(s.id)) {
				clearInterval(activeTimers.get(s.id) as any);
				activeTimers.delete(s.id);
			}
		}
		const remaining = all.filter(s => String(s.threadID) !== String(threadID));
		saveSchedules(remaining);
		return message.reply(`🗑️ Cleared ${threadSchedules.length} scheduled workflow(s) for this chat.`);
	}

	if (!targetId) {
		return message.reply("⚠️ Please specify the schedule ID (e.g. `ai stop schedule <ID>`).");
	}

	const idx = all.findIndex(s => s.id.toLowerCase() === targetId.toLowerCase() && String(s.threadID) === String(threadID));
	if (idx === -1) {
		return message.reply(`⚠️ Schedule "${targetId}" not found in this chat.`);
	}

	const target = all[idx];
	if (action === "stop") {
		if (activeTimers.has(target.id)) {
			clearInterval(activeTimers.get(target.id) as any);
			activeTimers.delete(target.id);
		}
		all.splice(idx, 1);
		saveSchedules(all);
		return message.reply(`✅ Stopped and removed scheduled workflow "${target.id}".`);
	}

	if (action === "pause") {
		target.paused = true;
		if (activeTimers.has(target.id)) {
			clearInterval(activeTimers.get(target.id) as any);
			activeTimers.delete(target.id);
		}
		saveSchedules(all);
		return message.reply(`⏸️ Paused scheduled workflow "${target.id}".`);
	}

	if (action === "resume") {
		target.paused = false;
		saveSchedules(all);
		startScheduleTimer(target);
		return message.reply(`▶️ Resumed scheduled workflow "${target.id}".`);
	}
}

async function handleAiProcessing(options: {
	prompt: string;
	event: any;
	message: any;
	api: any;
	role: number;
	usersData: any;
	threadsData: any;
	threadModel?: any;
	userModel?: any;
	dashBoardModel?: any;
	globalModel?: any;
	dashBoardData?: any;
	globalData?: any;
	prefix: string;
}) {
	const {
		prompt,
		event,
		message,
		api,
		role,
		usersData,
		threadsData,
		threadModel,
		userModel,
		dashBoardModel,
		globalModel,
		dashBoardData,
		globalData,
		prefix
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

	const uid = String(event.senderID);
	const threadID = String(event.threadID || event.senderID);
	const p = (prompt || "").trim();
	const lower = p.toLowerCase();

	if (lower === "clear") {
		resetHistory(uid);
		return message.reply("🧹 Your Queen AI chat history has been cleared.");
	}

	if (lower === "my details") {
		return message.reply(
			"👑 Queen AI Details:\n" +
				`• Your UID: ${uid}\n` +
				`• AI Model: ${GEMINI_MODEL}\n` +
				`• Capabilities: Vision + YouTube + Multi-Step Delayed Workflows + Recurring Scheduler`
		);
	}

	if (/what(?:'s|\s+is)\s+(?:my\s+)?uid|my\s+uid|who\s+am\s+i|^uid$/i.test(lower)) {
		if (event.mentions && Object.keys(event.mentions).length > 0) {
			let replyMsg = "🆔 User IDs:\n";
			for (const [id, name] of Object.entries(event.mentions)) {
				replyMsg += `• ${name}: ${id}\n`;
			}
			return message.reply(replyMsg.trim());
		}
		const senderName = (await usersData.getName(event.senderID)) || "User";
		return message.reply(`👤 Name: ${senderName}\n🆔 Your UID: ${event.senderID}`);
	}

	if (lower.startsWith("uid of") || lower.startsWith("uid ")) {
		if (event.mentions && Object.keys(event.mentions).length > 0) {
			let replyMsg = "🆔 User IDs:\n";
			for (const [id, name] of Object.entries(event.mentions)) {
				replyMsg += `• ${name}: ${id}\n`;
			}
			return message.reply(replyMsg.trim());
		}
	}

	const execContext = {
		api,
		message,
		event,
		role,
		prefix: prefix || ".",
		usersData,
		threadsData,
		threadModel,
		userModel,
		dashBoardModel,
		globalModel,
		dashBoardData,
		globalData
	};

	const parsedWorkflow = parseComplexWorkflow(p);
	if (parsedWorkflow) {
		if (parsedWorkflow.isScheduleManagement && parsedWorkflow.manageAction) {
			return await handleScheduleManagement(
				parsedWorkflow.manageAction,
				parsedWorkflow.targetScheduleId,
				threadID,
				message
			);
		}

		if (parsedWorkflow.steps && parsedWorkflow.steps.length > 0) {
			if (parsedWorkflow.intervalSeconds && parsedWorkflow.intervalSeconds > 0) {
				const stepsDesc = parsedWorkflow.steps
					.map(st => `${st.delaySecondsBefore ? `(after ${st.delaySecondsBefore}s delay) ` : ""}${st.command}${st.args?.length ? " " + st.args.join(" ") : ""}`)
					.join(" → ");
				const sched = registerScheduledWorkflow({
					threadID,
					authorID: uid,
					role,
					prefix: prefix || ".",
					intervalSeconds: parsedWorkflow.intervalSeconds,
					steps: parsedWorkflow.steps,
					description: stepsDesc
				});
				await message.reply(
					`⏰ Scheduled Workflow Activated!\n` +
					`• ID: ${sched.id}\n` +
					`• Repeat Interval: Every ${formatDurationHuman(sched.intervalMs)}\n` +
					`• Pipeline: ${stepsDesc}\n` +
					`▶️ Running initial cycle now...`
				);
				await runWorkflowSteps(parsedWorkflow.steps, execContext);
				return;
			}

			await runWorkflowSteps(parsedWorkflow.steps, execContext);
			return;
		}
	}

	const matchedSingle = parseSingleCommandIntent(p);
	if (matchedSingle) {
		const executed = await executeBotCommand({
			commandName: matchedSingle.command,
			commandArgs: matchedSingle.args,
			...execContext
		});
		if (executed) return;
	}

	if (!p && (!event.attachments || event.attachments.length === 0) && !event.messageReply) {
		const greetings = [
			"👑 Queen AI here! Ask me anything, send an image to analyze, a YouTube link, or give me multi-step & scheduled command workflows!",
			"🌟 Queen AI ready! Ask away, share a photo, or chain multiple commands with delays and schedules.",
			"✨ Multimodal Queen AI active! What would you like to explore or automate today?"
		];
		return message.reply(greetings[Math.floor(Math.random() * greetings.length)]);
	}

	const thinking = await message.reply("🧠 Analyzing with Gemini AI...");

	try {
		const attachmentData = await extractAttachmentData(event);
		const youtubeContext = await extractYouTubeContext(p);

		const allHistory = loadHistory(uid);
		const userHistory = allHistory[uid] || [];

		const { text, functionCalls } = await callGeminiApi({
			prompt: p || "Please describe and analyze this attachment in detail.",
			attachmentData,
			youtubeContext,
			history: userHistory
		});

		if (functionCalls.length > 0) {
			if (text) {
				await deliverAiResponse(message, api, thinking, `👑 Queen AI:\n${text}`);
			}
			else if (thinking && thinking.messageID) {
				try {
					await api.unsendMessage(thinking.messageID);
				}
				catch {}
			}

			for (const fnCall of functionCalls) {
				const fnName = fnCall.name;
				const fnArgs = fnCall.args || {};

				if (fnName === "execute_command") {
					const targetCmdName = fnArgs.command;
					const targetCmdArgs = Array.isArray(fnArgs.args)
						? fnArgs.args
						: typeof fnArgs.args === "string" && fnArgs.args.trim()
						? fnArgs.args.trim().split(/\s+/)
						: [];
					if (targetCmdName) {
						await executeBotCommand({
							commandName: targetCmdName,
							commandArgs: targetCmdArgs,
							...execContext
						});
					}
				}
				else if (fnName === "execute_workflow") {
					const rawSteps = Array.isArray(fnArgs.steps) ? fnArgs.steps : [];
					const normalizedSteps: WorkflowStep[] = rawSteps.map((s: any) => ({
						command: String(s.command || ""),
						args: Array.isArray(s.args) ? s.args.map(String) : [],
						delaySecondsBefore: Number(s.delaySecondsBefore || 0),
						repeatCount: Number(s.repeatCount || 1)
					}));
					await runWorkflowSteps(normalizedSteps, execContext);
				}
				else if (fnName === "schedule_workflow") {
					const intervalSeconds = Number(fnArgs.intervalSeconds || 86400);
					const runImmediately = fnArgs.runImmediately !== false;
					const rawSteps = Array.isArray(fnArgs.steps) ? fnArgs.steps : [];
					const normalizedSteps: WorkflowStep[] = rawSteps.map((s: any) => ({
						command: String(s.command || ""),
						args: Array.isArray(s.args) ? s.args.map(String) : [],
						delaySecondsBefore: Number(s.delaySecondsBefore || 0)
					}));
					if (normalizedSteps.length > 0) {
						const stepsDesc = normalizedSteps
							.map(st => `${st.delaySecondsBefore ? `(after ${st.delaySecondsBefore}s delay) ` : ""}${st.command}${st.args?.length ? " " + st.args.join(" ") : ""}`)
							.join(" → ");
						const sched = registerScheduledWorkflow({
							threadID,
							authorID: uid,
							role,
							prefix: prefix || ".",
							intervalSeconds,
							steps: normalizedSteps,
							description: fnArgs.description || stepsDesc
						});
						await message.reply(
							`⏰ Scheduled Workflow Activated!\n` +
							`• ID: ${sched.id}\n` +
							`• Repeat Interval: Every ${formatDurationHuman(sched.intervalMs)}\n` +
							`• Pipeline: ${stepsDesc}` +
							(runImmediately ? `\n▶️ Running initial cycle now...` : "")
						);
						if (runImmediately) {
							await runWorkflowSteps(normalizedSteps, execContext);
						}
					}
				}
				else if (fnName === "manage_schedules") {
					const act = String(fnArgs.action || "list").toLowerCase() as any;
					await handleScheduleManagement(act, fnArgs.scheduleId, threadID, message);
				}
			}
			return;
		}

		if (text) {
			const finalMsgId = await deliverAiResponse(message, api, thinking, text);
			if (finalMsgId) {
				registerReply(finalMsgId, uid);
			}

			userHistory.push({ role: "user", parts: [{ text: p || "[Attachment]" }] });
			userHistory.push({ role: "model", parts: [{ text }] });
			saveHistory(uid, userHistory);
		}
		else {
			await deliverAiResponse(message, api, thinking, "✨ Queen AI processed your request.");
		}
	}
	catch (error: any) {
		const errorMsg = error?.response?.data?.error?.message || error?.message || "Unknown error";
		if (errorMsg.includes("API key not valid") || errorMsg.includes("AIzaSy_YOUR_GEMINI_API_KEY_HERE")) {
			await deliverAiResponse(
				message,
				api,
				thinking,
				"🔑 Gemini API Key Notice:\n" +
					"Please paste your Google Gemini API key into `scripts/cmds/ai.ts` (GEMINI_API_KEY) or set the GEMINI_API_KEY environment variable to enable full multimodal AI features."
			);
		}
		else {
			await deliverAiResponse(message, api, thinking, `⚠️ Gemini AI error: ${errorMsg}`);
		}
	}
}

module.exports = {
	config: {
		name: "ai",
		version: "6.0.0",
		author: "Priyanshi Kaur",
		role: 0,
		countDown: 3,
		category: "AI",
		shortDescription: "Multimodal Gemini AI with multi-step delayed workflows and recurring scheduler",
		longDescription: "Advanced Google Gemini 2.5 AI supporting image analysis, YouTube insights, multi-step delayed command pipelines, and persistent recurring scheduled workflows.",
		guide: {
			en:
				"Chat prefixes: ai, queen, .ai\n\n" +
				"Examples:\n" +
				"- {p}ai what's my uid\n" +
				"- {p}ai trigger uptime2 command after every 24 hours and in 3 second delay trigger ping command\n" +
				"- {p}ai run boxinfo then wait 5 seconds and run ping\n" +
				"- {p}ai list schedules\n" +
				"- {p}ai stop schedule <ID>\n" +
				"- {p}ai clear schedules\n" +
				"- {p}ai give me song name shayad by badkrazy and play it\n" +
				"- {p}ai (reply to photo) What is in this picture?\n" +
				"- {p}ai clear (reset conversation history)\n\n" +
				"Reply to any AI message to continue chatting."
		}
	},

	onLoad: async function (context: any) {
		savedRuntimeContext = context;
		restoreAllSchedules();
	},

	onStart: async function (context: any) {
		const { args } = context;
		const prompt = Array.isArray(args) ? args.join(" ").trim() : "";
		await handleAiProcessing({ ...context, prompt });
	},

	onChat: async function (context: any) {
		const { event, isUserCallCommand } = context;
		if (isUserCallCommand) return;
		if (!event || typeof event.body !== "string") return;
		const body = event.body.trim();
		if (!body) return;

		const { usedPrefix, prompt } = normalizeCommand(body);
		if (!usedPrefix) return;

		await handleAiProcessing({ ...context, prompt });
	},

	onReply: async function (context: any) {
		const { event, Reply, args } = context;
		if (!Reply || !event || String(event.senderID) !== String(Reply.author)) {
			return;
		}
		const userText = Array.isArray(args)
			? args.join(" ").trim()
			: typeof event.body === "string"
			? event.body.trim()
			: "";
		if (!userText && (!event.attachments || event.attachments.length === 0)) return;

		await handleAiProcessing({ ...context, prompt: userText });
	}
};