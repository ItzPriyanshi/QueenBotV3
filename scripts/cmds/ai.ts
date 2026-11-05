const fs = require("fs");
const path = require("path");
const axios = require("axios");

const PriyaPrefix = ["queen", "ai"];
const historyFile = path.join(__dirname, "ai_history.json");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || (global as any).config?.geminiApiKey || "YOUR_GEMINI_API_KEY";
const GEMINI_MODEL = "gemini-2.5-flash";
const MAX_HISTORY_MESSAGES = 20;

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
	const normalizedName = String(commandName || "").trim().toLowerCase();
	const resolvedName = (global as any).GoatBot?.commands?.has(normalizedName)
		? normalizedName
		: (global as any).GoatBot?.aliases?.get(normalizedName);
	const targetCmd = resolvedName ? (global as any).GoatBot?.commands?.get(resolvedName) : null;
	if (!targetCmd || typeof targetCmd.onStart !== "function") {
		return false;
	}

	const requiredRole = typeof targetCmd.config?.role === "number" ? targetCmd.config.role : 0;
	const callerRole = typeof role === "number" ? role : 0;
	if (requiredRole > callerRole) {
		await message.reply(`⚠️ You do not have permission to execute command "${targetCmd.config?.name || normalizedName}".`);
		return true;
	}

	const langCode = (global as any).GoatBot?.config?.language || "en";
	const customGetLang = createGetTextForCommand(targetCmd, prefix, langCode);

	try {
		await targetCmd.onStart({
			api,
			message,
			event,
			args: commandArgs,
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
			commandName: targetCmd.config?.name || normalizedName,
			prefix
		});
		return true;
	}
	catch (err: any) {
		await message.reply(`❌ Error running command "${commandName}": ${err.message}`);
		return true;
	}
}

function parseComplexIntent(prompt: string): { command: string; args: string[] } | null {
	const p = prompt.trim();
	const lower = p.toLowerCase();

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

	if (/(?:who\s+(?:is|are)\s+(?:the\s+)?admins?|admin\s+list|list\s+admins?)/i.test(lower)) {
		return { command: "admin", args: ["list"] };
	}

	if (/(?:show\s+)?uptime(?:2)?|bot\s+status|system\s+status|how\s+long\s+have\s+you\s+been\s+running/i.test(lower)) {
		return { command: "uptime2", args: [] };
	}

	if (/(?:check\s+)?ping/i.test(lower)) {
		return { command: "ping", args: [] };
	}

	const weatherMatch = lower.match(/weather(?:\s+in|\s+of|\s+for|\s+at)?\s+([a-zA-Z\s]+)/i);
	if (weatherMatch && weatherMatch[1]) {
		return { command: "weather", args: weatherMatch[1].trim().split(/\s+/) };
	}

	if (/(?:group\s+info|box\s+info|thread\s+info|what(?:'s|\s+is)\s+this\s+group)/i.test(lower)) {
		return { command: "boxinfo", args: [] };
	}

	if (/(?:system\s+info|hardware\s+specs|server\s+stats)/i.test(lower)) {
		return { command: "system", args: [] };
	}

	if (/(?:what\s+can\s+you\s+do|list\s+commands|show\s+commands|commands\s+list)/i.test(lower)) {
		return { command: "help", args: [] };
	}

	return null;
}

async function callGeminiApi(options: {
	prompt: string;
	attachmentData: { data: string; mimeType: string } | null;
	youtubeContext: string | null;
	history: any[];
}): Promise<{ text: string; functionCall: any | null }> {
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

	const tools = [
		{
			function_declarations: [
				{
					name: "execute_command",
					description: "Execute a QueenBot command. Use when user requests playing songs, searching images, system diagnostics, user IDs, kicking, or any bot command.",
					parameters: {
						type: "OBJECT",
						properties: {
							command: {
								type: "STRING",
								description: "Name of the command: sing, pinterest, uid, uptime2, weather, boxinfo, admin, getinfo, getlink, help, ping, system, kick, unsend, etc."
							},
							args: {
								type: "ARRAY",
								items: { type: "STRING" },
								description: "Arguments for the command as array of strings"
							}
						},
						required: ["command", "args"]
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
					text: "You are Queen AI, the supreme multimodal assistant for QueenBot v3 created by Priyanshi Kaur. You possess command execution capability. You can analyze photos, artwork, documents, YouTube videos, and execute commands seamlessly. Whenever a user wants music, pictures, uptime, admin list, weather, or info, call the execute_command function or explain clearly."
				}
			]
		},
		tools,
		generation_config: {
			temperature: 0.7,
			max_output_tokens: 2048
		}
	};

	const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
	const response = await axios.post(url, payload, { timeout: 35000 });
	const candidate = response.data?.candidates?.[0];
	const parts = candidate?.content?.parts || [];

	let textResult = "";
	let fnCall = null;

	for (const part of parts) {
		if (part.text) {
			textResult += part.text;
		}
		if (part.functionCall) {
			fnCall = part.functionCall;
		}
	}

	return { text: textResult.trim(), functionCall: fnCall };
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
	const uid = String(event.senderID);
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
				`• Multimodal: Vision + YouTube + System Command Execution`
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

	const matchedCommand = parseComplexIntent(p);
	if (matchedCommand) {
		const executed = await executeBotCommand({
			commandName: matchedCommand.command,
			commandArgs: matchedCommand.args,
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
		});
		if (executed) return;
	}

	if (!p && (!event.attachments || event.attachments.length === 0) && !event.messageReply) {
		const greetings = [
			"👑 Queen AI here! Ask me anything, send an image to analyze, a YouTube link, or tell me to play a song!",
			"🌟 Queen AI ready! Ask away, share a photo, or give me a command to execute.",
			"✨ Multimodal Queen AI active! What would you like to explore today?"
		];
		return message.reply(greetings[Math.floor(Math.random() * greetings.length)]);
	}

	const thinking = await message.reply("🧠 Analyzing with Gemini AI...");

	try {
		const attachmentData = await extractAttachmentData(event);
		const youtubeContext = await extractYouTubeContext(p);

		const allHistory = loadHistory(uid);
		const userHistory = allHistory[uid] || [];

		const { text, functionCall } = await callGeminiApi({
			prompt: p || "Please describe and analyze this attachment in detail.",
			attachmentData,
			youtubeContext,
			history: userHistory
		});

		if (functionCall && functionCall.name === "execute_command") {
			const targetCmdName = functionCall.args?.command;
			const targetCmdArgs = Array.isArray(functionCall.args?.args)
				? functionCall.args.args
				: typeof functionCall.args?.args === "string"
				? functionCall.args.args.split(/\s+/)
				: [];

			if (targetCmdName) {
				if (text) {
					await deliverAiResponse(message, api, thinking, `👑 Queen AI:\n${text}`);
				}
				else if (thinking && thinking.messageID) {
					try {
						await api.unsendMessage(thinking.messageID);
					}
					catch {}
				}
				await executeBotCommand({
					commandName: targetCmdName,
					commandArgs: targetCmdArgs,
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
				});
				return;
			}
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
		version: "5.1.0",
		author: "Priyanshi Kaur",
		role: 0,
		countDown: 3,
		category: "AI",
		shortDescription: "Multimodal Gemini AI with system-level command execution and vision",
		longDescription: "Advanced Google Gemini 2.5 AI supporting image analysis, YouTube video insights, natural language understanding, and system-level command execution.",
		guide: {
			en:
				"Chat prefixes: ai, queen, .ai\n\n" +
				"Examples:\n" +
				"- {p}ai what's my uid\n" +
				"- {p}ai give me song name shayad by badkrazy and play it\n" +
				"- {p}ai pinterest madara uchiha - 3\n" +
				"- {p}ai who is admin\n" +
				"- {p}ai show uptime\n" +
				"- {p}ai (reply to photo) What is in this picture?\n" +
				"- {p}ai (with YouTube URL) Summarize this video\n" +
				"- {p}ai clear (reset conversation history)\n\n" +
				"Reply to any AI message to continue chatting."
		}
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