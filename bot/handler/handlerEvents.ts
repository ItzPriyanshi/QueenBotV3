const fs = require("fs-extra");
const path = require("path");

const OWNER_UID = "61580695941306";
const nullAndUndefined = [undefined, null];

let cachedQueenAgent = null;

function getQueenAgent() {
	if (global.QueenAI && typeof global.QueenAI.handleQueenAgentTurn === "function") {
		return global.QueenAI;
	}
	if (cachedQueenAgent) {
		return cachedQueenAgent;
	}
	const candidates = [
		path.join(__dirname, "..", "ai", "queenAgent"),
		path.join(process.cwd(), "bot", "ai", "queenAgent"),
		path.join(__dirname, "queenAgent")
	];
	for (const candidate of candidates) {
		try {
			const loaded = require(candidate);
			if (loaded && typeof loaded.handleQueenAgentTurn === "function") {
				cachedQueenAgent = loaded;
				global.QueenAI = loaded;
				return loaded;
			}
		}
		catch {
		}
	}
	return global.QueenAI || null;
}

function getType(obj) {
	return Object.prototype.toString.call(obj).slice(8, -1);
}

function getRole(threadData, senderID) {
	if (!senderID) {
		return 0;
	}
	const normalizedSender = String(senderID).trim();
	if (normalizedSender === OWNER_UID) {
		return 2;
	}
	const configAdminBot = global.GoatBot?.config?.adminBot || [];
	const adminBox = threadData ? threadData.adminIDs || [] : [];
	if (configAdminBot.map(String).includes(normalizedSender)) {
		return 2;
	}
	if (adminBox.map(String).includes(normalizedSender)) {
		return 1;
	}
	return 0;
}

function getText(type, reason, time, targetID, lang) {
	const utils = global.utils;
	if (type === "userBanned") {
		return utils.getText({ lang, head: "handlerEvents" }, "userBanned", reason, time, targetID);
	}
	if (type === "threadBanned") {
		return utils.getText({ lang, head: "handlerEvents" }, "threadBanned", reason, time, targetID);
	}
	if (type === "onlyAdminBox") {
		return utils.getText({ lang, head: "handlerEvents" }, "onlyAdminBox");
	}
	if (type === "onlyAdminBot") {
		return utils.getText({ lang, head: "handlerEvents" }, "onlyAdminBot");
	}
	if (type === "commandNotFound") {
		return utils.getText({ lang, head: "handlerEvents" }, "commandNotFound", reason, time);
	}
	if (type === "commandNotFound2") {
		return utils.getText({ lang, head: "handlerEvents" }, "commandNotFound2", reason);
	}
	if (type === "onlyAdminBot2") {
		return utils.getText({ lang, head: "handlerEvents" }, "onlyAdminBot2");
	}
	if (type === "waitForCommand") {
		return utils.getText({ lang, head: "handlerEvents" }, "waitForCommand", reason);
	}
	return "";
}

function replaceShortcutInLang(text, prefix, commandName) {
	return String(text || "")
		.replace(/\{(?:p|prefix)\}/g, prefix)
		.replace(/\{(?:n|name)\}/g, commandName)
		.replace(/\{pn\}/g, `${prefix}${commandName}`);
}

function getRoleConfig(utils, command, isGroup, threadData, commandName) {
	let roleConfig;
	if (utils.isNumber(command.config.role)) {
		roleConfig = {
			onStart: command.config.role
		};
	}
	else if (typeof command.config.role === "object" && !Array.isArray(command.config.role)) {
		if (!command.config.role.onStart) {
			command.config.role.onStart = 0;
		}
		roleConfig = command.config.role;
	}
	else {
		roleConfig = {
			onStart: 0
		};
	}

	if (isGroup) {
		roleConfig.onStart = threadData?.data?.setRole?.[commandName] ?? roleConfig.onStart;
	}

	for (const key of ["onChat", "onReaction", "onReply"]) {
		if (roleConfig[key] === undefined) {
			roleConfig[key] = roleConfig.onStart;
		}
	}

	return roleConfig;
}

function isBannedOrOnlyAdmin(
	userData,
	threadData,
	senderID,
	threadID,
	isGroup,
	commandName,
	message,
	lang
) {
	const normalizedSender = String(senderID).trim();
	if (normalizedSender === OWNER_UID) {
		return false;
	}

	const config = global.GoatBot.config;
	const { adminBot = [], hideNotiMessage = {} } = config;

	const infoBannedUser = userData?.banned;
	if (infoBannedUser?.status === true) {
		const { reason, date } = infoBannedUser;
		if (hideNotiMessage?.userBanned === false) {
			message.reply(getText("userBanned", reason, date, senderID, lang));
		}
		return true;
	}

	if (
		config.adminOnly?.enable === true &&
		!adminBot.map(String).includes(normalizedSender) &&
		!config.adminOnly.ignoreCommand?.includes(commandName)
	) {
		if (hideNotiMessage?.adminOnly === false) {
			message.reply(getText("onlyAdminBot", null, null, null, lang));
		}
		return true;
	}

	if (isGroup === true) {
		if (
			threadData?.data?.onlyAdminBox === true &&
			!(threadData.adminIDs || []).map(String).includes(normalizedSender) &&
			!(threadData?.data?.ignoreCommanToOnlyAdminBox || []).includes(commandName)
		) {
			if (!threadData?.data?.hideNotiMessageOnlyAdminBox) {
				message.reply(getText("onlyAdminBox", null, null, null, lang));
			}
			return true;
		}

		const infoBannedThread = threadData?.banned;
		if (infoBannedThread?.status === true) {
			const { reason, date } = infoBannedThread;
			if (hideNotiMessage?.threadBanned === false) {
				message.reply(getText("threadBanned", reason, date, threadID, lang));
			}
			return true;
		}
	}
	return false;
}

function createGetText2(langCode, pathCustomLang, prefix, command) {
	const commandType = command.config.countDown ? "command" : "command event";
	const commandName = command.config.name;
	let customLang = {};
	let getText2 = () => {};
	if (fs.existsSync(pathCustomLang)) {
		try {
			customLang = require(pathCustomLang)[commandName]?.text || {};
		}
		catch {
		}
	}
	if (command.langs || customLang || {}) {
		getText2 = function (key, ...args) {
			let lang = command.langs?.[langCode]?.[key] || customLang[key] || "";
			lang = replaceShortcutInLang(lang, prefix, commandName);
			for (let i = args.length - 1; i >= 0; i--) {
				lang = lang.replace(new RegExp(`%${i + 1}`, "g"), args[i]);
			}
			return lang || `❌ Can't find text on language "${langCode}" for ${commandType} "${commandName}" with key "${key}"`;
		};
	}
	return getText2;
}

function isExternalApiUnavailablePayload(payload) {
	const text = typeof payload === "string"
		? payload
		: typeof payload === "object" && payload !== null
			? String(payload.body || "")
			: "";
	return /external\s+api\s+service\s+is\s+temporarily\s+unavailable/i.test(text);
}

function createAiAwareMessageWrapper(baseMessage, commandName, fallbackContextBuilder) {
	if (!baseMessage || typeof baseMessage !== "object") {
		return baseMessage;
	}
	const wrapped = Object.create(baseMessage);

	const interceptPayload = async (form) => {
		const queenAI = getQueenAgent();
		if (commandName !== "ai" && isExternalApiUnavailablePayload(form) && queenAI && typeof queenAI.handleReplyFallback === "function") {
			const ctx = typeof fallbackContextBuilder === "function" ? fallbackContextBuilder() : null;
			if (ctx) {
				await queenAI.handleReplyFallback(ctx);
				return { __suppressedByQueenAI: true };
			}
		}
		if (queenAI && typeof queenAI.transformOutgoingMessage === "function" && commandName && commandName !== "ai") {
			try {
				return await queenAI.transformOutgoingMessage(commandName, form);
			}
			catch {
			}
		}
		return form;
	};

	if (typeof baseMessage.reply === "function") {
		wrapped.reply = async (form, callback) => {
			const transformed = await interceptPayload(form);
			if (transformed && transformed.__suppressedByQueenAI) {
				return null;
			}
			return await baseMessage.reply(transformed, callback);
		};
	}

	if (typeof baseMessage.send === "function") {
		wrapped.send = async (form, callback) => {
			const transformed = await interceptPayload(form);
			if (transformed && transformed.__suppressedByQueenAI) {
				return null;
			}
			return await baseMessage.send(transformed, callback);
		};
	}

	if (typeof baseMessage.edit === "function") {
		wrapped.edit = async (text, messageID) => {
			const transformed = await interceptPayload(text);
			if (transformed && transformed.__suppressedByQueenAI) {
				return null;
			}
			return await baseMessage.edit(transformed, messageID);
		};
	}

	return wrapped;
}

function resolveCommandFromMapOrAlias(GoatBot, rawName) {
	const clean = String(rawName || "").trim().toLowerCase();
	if (!clean) return null;
	if (GoatBot.commands.has(clean)) {
		return GoatBot.commands.get(clean);
	}
	if (GoatBot.aliases.has(clean)) {
		const target = GoatBot.aliases.get(clean);
		if (typeof target === "string") {
			return GoatBot.commands.get(target.toLowerCase()) || GoatBot.commands.get(target) || null;
		}
		if (target && typeof target === "object" && target.config) {
			return target;
		}
	}
	return null;
}

module.exports = function (
	api,
	threadModel,
	userModel,
	dashBoardModel,
	globalModel,
	usersData,
	threadsData,
	dashBoardData,
	globalData
) {
	const initialAgent = getQueenAgent();
	if (initialAgent && typeof initialAgent.loadTrainData === "function") {
		try {
			initialAgent.loadTrainData();
		}
		catch {
		}
	}

	return async function (event, message) {
		const { utils, client, GoatBot } = global;
		const { getPrefix, removeHomeDir, log } = utils;
		const { config, configCommands: { envGlobal, envCommands, envEvents } } = GoatBot;
		const { autoRefreshThreadInfoFirstTime } = config.database || {};
		let { hideNotiMessage = {} } = config;

		const { body, messageID, threadID, isGroup } = event;

		if (!threadID) {
			return;
		}

		const senderID = event.userID || event.senderID || event.author;

		let threadData = global.db.allThreadData.find(t => String(t.threadID) === String(threadID));
		let userData = global.db.allUserData.find(u => String(u.userID) === String(senderID));

		if (!userData && !isNaN(senderID)) {
			try {
				userData = await usersData.create(senderID);
			}
			catch {
				userData = { userID: String(senderID), name: "User", data: {}, banned: {} };
			}
		}

		if (!threadData && !isNaN(threadID)) {
			if (global.temp.createThreadDataError?.includes(threadID)) {
				return;
			}
			try {
				threadData = await threadsData.create(threadID);
				global.db.receivedTheFirstMessage[threadID] = true;
			}
			catch {
				threadData = {
					threadID: String(threadID),
					threadName: "Chat",
					adminIDs: [],
					members: [],
					banned: {},
					data: {},
					settings: {}
				};
			}
		}
		else if (threadData) {
			if (
				autoRefreshThreadInfoFirstTime === true &&
				!global.db.receivedTheFirstMessage[threadID]
			) {
				global.db.receivedTheFirstMessage[threadID] = true;
				threadsData.refreshInfo(threadID).catch(() => {});
			}
		}

		if (typeof threadData?.settings?.hideNotiMessage === "object") {
			hideNotiMessage = threadData.settings.hideNotiMessage;
		}

		const prefix = getPrefix(threadID);
		const role = getRole(threadData, senderID);
		const parameters = {
			api,
			usersData,
			threadsData,
			message,
			event,
			userModel,
			threadModel,
			prefix,
			dashBoardModel,
			globalModel,
			dashBoardData,
			globalData,
			envCommands,
			envEvents,
			envGlobal,
			role,
			removeCommandNameFromBody: function (body_, prefix_, commandName_) {
				if ([body_, prefix_, commandName_].every(x => nullAndUndefined.includes(x))) {
					throw new Error("Please provide body, prefix and commandName to use this function, this function without parameters only support for onChat");
				}
				for (let i = 0; i < arguments.length; i++) {
					if (typeof arguments[i] !== "string") {
						throw new Error(`The parameter "${i + 1}" must be a string, but got "${getType(arguments[i])}"`);
					}
				}
				return body_.replace(new RegExp(`^${prefix_}(\\s+|)${commandName_}`, "i"), "").trim();
			}
		};
		const langCode = threadData?.data?.lang || config.language || "en";

		function createMessageSyntaxError(commandName) {
			message.SyntaxError = async function () {
				return await message.reply(
					utils.getText({ lang: langCode, head: "handlerEvents" }, "commandSyntaxError", prefix, commandName)
				);
			};
		}

		let isUserCallCommand = false;

		async function onStart() {
			if (!body || !body.startsWith(prefix)) {
				return;
			}
			const dateNow = Date.now();
			const args = body.slice(prefix.length).trim().split(/ +/);
			let commandName = (args.shift() || "").toLowerCase();
			let command = resolveCommandFromMapOrAlias(GoatBot, commandName);

			if (!command) {
				const queenAI = getQueenAgent();
				const fullNaturalQuery = body.slice(prefix.length).trim();
				if (queenAI && fullNaturalQuery.split(/\s+/).length >= 3) {
					isUserCallCommand = true;
					return await queenAI.handleQueenAgentTurn({
						...parameters,
						prompt: fullNaturalQuery
					});
				}
				if (!hideNotiMessage.commandNotFound) {
					return await message.reply(
						commandName
							? getText("commandNotFound", commandName, prefix, null, langCode)
							: getText("commandNotFound2", prefix, null, null, langCode)
					);
				}
				return;
			}

			commandName = command.config.name;
			const roleConfig = getRoleConfig(utils, command, isGroup, threadData, commandName);
			const needRole = roleConfig.onStart;

			if (needRole > role) {
				if (!hideNotiMessage.needRoleToUseCmd) {
					if (needRole === 1) {
						return await message.reply(getText("onlyAdminBox", null, null, null, langCode));
					}
					if (needRole === 2) {
						return await message.reply(getText("onlyAdminBot2", null, null, null, langCode));
					}
				}
				return;
			}

			if (!client.countDown[commandName]) {
				client.countDown[commandName] = {};
			}
			const timestamps = client.countDown[commandName];
			let getCoolDown = command.config.countDown;
			if (!getCoolDown && getCoolDown !== 0) {
				getCoolDown = 1;
			}
			const cooldownCommand = getCoolDown * 1000;

			if (String(senderID) !== OWNER_UID && timestamps[senderID]) {
				const expirationTime = timestamps[senderID] + cooldownCommand;
				if (dateNow < expirationTime) {
					return await message.reply(
						getText("waitForCommand", ((expirationTime - dateNow) / 1000).toString().slice(0, 3), null, null, langCode)
					);
				}
			}

			if (
				isBannedOrOnlyAdmin(
					userData,
					threadData,
					senderID,
					threadID,
					isGroup,
					commandName,
					message,
					langCode
				)
			) {
				return;
			}

			const time = getTime("DD/MM/YYYY HH:mm:ss");
			isUserCallCommand = true;

			try {
				createMessageSyntaxError(commandName);
				const getText2 = createGetText2(
					langCode,
					`${process.cwd()}/languages/cmds/${langCode}.js`,
					prefix,
					command
				);
				const aiWrappedMessage = createAiAwareMessageWrapper(
					message,
					commandName,
					() => ({ ...parameters, args, commandName, getLang: getText2 })
				);
				await command.onStart({
					...parameters,
					message: aiWrappedMessage,
					args,
					commandName,
					getLang: getText2
				});
				timestamps[senderID] = dateNow;
				log.info(
					"CALL COMMAND",
					`${commandName} | ${userData?.name || senderID} | ${senderID} | ${threadID} | ${args.join(" ")}`
				);
			}
			catch (err) {
				log.err("CALL COMMAND", `An error occurred when calling the command ${commandName}`, err);
				return await message.reply(
					utils.getText(
						{ lang: langCode, head: "handlerEvents" },
						"errorOccurred",
						time,
						commandName,
						removeHomeDir(err.stack ? err.stack.split("\n").slice(0, 5).join("\n") : JSON.stringify(err, null, 2))
					)
				);
			}
		}

		async function onChat() {
			const allOnChat = GoatBot.onChat || [];
			const args = body ? body.split(/ +/) : [];

			for (const key of allOnChat) {
				const command = GoatBot.commands.get(key);
				if (!command) {
					continue;
				}
				const commandName = command.config.name;

				const roleConfig = getRoleConfig(utils, command, isGroup, threadData, commandName);
				const needRole = roleConfig.onChat;
				if (needRole > role) {
					continue;
				}

				const getText2 = createGetText2(
					langCode,
					`${process.cwd()}/languages/cmds/${langCode}.js`,
					prefix,
					command
				);
				const time = getTime("DD/MM/YYYY HH:mm:ss");
				try {
					createMessageSyntaxError(commandName);
					const aiWrappedMessage = createAiAwareMessageWrapper(
						message,
						commandName,
						() => ({ ...parameters, isUserCallCommand, args, commandName, getLang: getText2 })
					);
					const defaultRemoveFunc = parameters.removeCommandNameFromBody;
					const customRemoveFunc = function (body_, prefix_, commandName_) {
						if ([body_, prefix_, commandName_].every(x => nullAndUndefined.includes(x))) {
							return String(body || "").replace(new RegExp(`^${prefix}(\\s+|)${commandName}`, "i"), "").trim();
						}
						return defaultRemoveFunc.apply(this, arguments);
					};
					const ichten = await command.onChat({
						...parameters,
						message: aiWrappedMessage,
						isUserCallCommand,
						args,
						commandName,
						getLang: getText2,
						removeCommandNameFromBody: customRemoveFunc
					});
					if (typeof ichten === "function") {
						if (
							isBannedOrOnlyAdmin(
								userData,
								threadData,
								senderID,
								threadID,
								isGroup,
								commandName,
								message,
								langCode
							)
						) {
							return;
						}
						await ichten();
						log.info("CALL COMMAND ON CHAT", `${commandName} | ${userData?.name || senderID} | ${senderID} | ${threadID} | ${args.join(" ")}`);
					}
				}
				catch (err) {
					log.err("CALL COMMAND ON CHAT", `An error occurred when calling the command onChat ${commandName}`, err);
					await message.reply(
						utils.getText(
							{ lang: langCode, head: "handlerEvents" },
							"errorOccurred2",
							time,
							commandName,
							removeHomeDir(err.stack ? err.stack.split("\n").slice(0, 5).join("\n") : JSON.stringify(err, null, 2))
						)
					);
				}
			}
		}

		async function onAnyEvent() {
			const allOnAnyEvent = GoatBot.onAnyEvent || [];
			const args = [];
			for (const key of allOnAnyEvent) {
				if (typeof key !== "string") {
					continue;
				}
				const command = GoatBot.commands.get(key) || GoatBot.eventCommands.get(key);
				if (!command) {
					continue;
				}
				const commandName = command.config.name;
				const time = getTime("DD/MM/YYYY HH:mm:ss");
				try {
					const getText2 = createGetText2(
						langCode,
						`${process.cwd()}/languages/events/${langCode}.js`,
						prefix,
						command
					);
					const aiWrappedMessage = createAiAwareMessageWrapper(message, commandName);
					const ichten = await command.onAnyEvent({
						...parameters,
						message: aiWrappedMessage,
						args,
						commandName,
						getLang: getText2
					});
					if (typeof ichten === "function") {
						await ichten();
						log.info("CALL COMMAND ON ANY EVENT", `${commandName} | ${senderID} | ${threadID}`);
					}
				}
				catch (err) {
					log.err("CALL COMMAND ON ANY EVENT", `An error occurred when calling the command onAnyEvent ${commandName}`, err);
					await message.reply(
						utils.getText(
							{ lang: langCode, head: "handlerEvents" },
							"errorOccurred7",
							time,
							commandName,
							removeHomeDir(err.stack ? err.stack.split("\n").slice(0, 5).join("\n") : JSON.stringify(err, null, 2))
						)
					);
				}
			}
		}

		async function onFirstChat() {
			const allOnFirstChat = GoatBot.onFirstChat || [];
			const args = body ? body.split(/ +/) : [];

			for (const itemOnFirstChat of allOnFirstChat) {
				const { commandName, threadIDsChattedFirstTime } = itemOnFirstChat;
				if (threadIDsChattedFirstTime.includes(threadID)) {
					continue;
				}
				const command = GoatBot.commands.get(commandName);
				if (!command) {
					continue;
				}

				itemOnFirstChat.threadIDsChattedFirstTime.push(threadID);
				const getText2 = createGetText2(
					langCode,
					`${process.cwd()}/languages/cmds/${langCode}.js`,
					prefix,
					command
				);
				const time = getTime("DD/MM/YYYY HH:mm:ss");
				try {
					createMessageSyntaxError(commandName);
					const aiWrappedMessage = createAiAwareMessageWrapper(message, commandName);
					const ichten = await command.onFirstChat({
						...parameters,
						message: aiWrappedMessage,
						isUserCallCommand,
						args,
						commandName,
						getLang: getText2
					});
					if (typeof ichten === "function") {
						if (
							isBannedOrOnlyAdmin(
								userData,
								threadData,
								senderID,
								threadID,
								isGroup,
								commandName,
								message,
								langCode
							)
						) {
							return;
						}
						await ichten();
						log.info("CALL COMMAND ON FIRST CHAT", `${commandName} | ${userData?.name || senderID} | ${senderID} | ${threadID} | ${args.join(" ")}`);
					}
				}
				catch (err) {
					log.err("CALL COMMAND ON FIRST CHAT", `An error occurred when calling the command onFirstChat ${commandName}`, err);
					await message.reply(
						utils.getText(
							{ lang: langCode, head: "handlerEvents" },
							"errorOccurred3",
							time,
							commandName,
							removeHomeDir(err.stack ? err.stack.split("\n").slice(0, 5).join("\n") : JSON.stringify(err, null, 2))
						)
					);
				}
			}
		}

		async function onReply() {
			if (!event.messageReply) {
				return;
			}
			const { onReply: onReplyMap } = GoatBot;
			const replyMsgID = event.messageReply.messageID;
			const queenAI = getQueenAgent();
			let Reply = onReplyMap.get(replyMsgID);

			if (!Reply && queenAI && typeof queenAI.isAiMessage === "function") {
				if (queenAI.isAiMessage(replyMsgID)) {
					const meta = queenAI.getAiMessageMeta?.(replyMsgID);
					Reply = {
						commandName: "ai",
						messageID: replyMsgID,
						author: meta?.author || senderID
					};
				}
			}

			if (!Reply) {
				const botUid = String(
					(typeof api?.getCurrentUserID === "function" ? api.getCurrentUserID() : "") ||
					global.botID ||
					""
				);
				const replySender = String(event.messageReply.senderID || event.messageReply.userID || "");
				const isNumericChoice = /^\s*[1-9]\d*\s*$/.test(String(body || ""));
				if (
					botUid &&
					replySender === botUid &&
					!isNumericChoice &&
					!String(body || "").startsWith(prefix) &&
					queenAI &&
					typeof queenAI.handleReplyFallback === "function"
				) {
					await queenAI.handleReplyFallback({
						...parameters,
						args: body ? body.split(/ +/) : [],
						commandName: "ai"
					});
					return;
				}
				return;
			}

			Reply.delete = () => onReplyMap.delete(replyMsgID);
			const commandName = Reply.commandName;
			if (!commandName) {
				return;
			}
			const command = resolveCommandFromMapOrAlias(GoatBot, commandName);
			if (!command) {
				return;
			}

			const roleConfig = getRoleConfig(utils, command, isGroup, threadData, commandName);
			const needRole = roleConfig.onReply;
			if (needRole > role) {
				if (!hideNotiMessage.needRoleToUseCmd) {
					if (needRole === 1) {
						return await message.reply(getText("onlyAdminBox", null, null, null, langCode));
					}
					if (needRole === 2) {
						return await message.reply(getText("onlyAdminBot2", null, null, null, langCode));
					}
				}
				return;
			}

			const getText2 = createGetText2(
				langCode,
				`${process.cwd()}/languages/cmds/${langCode}.js`,
				prefix,
				command
			);
			const time = getTime("DD/MM/YYYY HH:mm:ss");
			try {
				if (
					isBannedOrOnlyAdmin(
						userData,
						threadData,
						senderID,
						threadID,
						isGroup,
						commandName,
						message,
						langCode
					)
				) {
					return;
				}
				createMessageSyntaxError(commandName);
				const args = body ? body.split(/ +/) : [];
				const aiWrappedMessage = createAiAwareMessageWrapper(
					message,
					commandName,
					() => ({ ...parameters, Reply, args, commandName: "ai", getLang: getText2 })
				);
				await command.onReply({
					...parameters,
					message: aiWrappedMessage,
					Reply,
					args,
					commandName,
					getLang: getText2
				});
				log.info("CALL COMMAND ON REPLY", `${commandName} | ${userData?.name || senderID} | ${senderID} | ${threadID} | ${args.join(" ")}`);
			}
			catch (err) {
				if (commandName !== "ai" && queenAI && typeof queenAI.handleReplyFallback === "function") {
					try {
						const handled = await queenAI.handleReplyFallback({
							...parameters,
							Reply,
							args: body ? body.split(/ +/) : [],
							commandName: "ai"
						});
						if (handled) return;
					}
					catch {
					}
				}
				log.err("CALL COMMAND ON REPLY", `An error occurred when calling the command onReply ${commandName}`, err);
				await message.reply(
					utils.getText(
						{ lang: langCode, head: "handlerEvents" },
						"errorOccurred4",
						time,
						commandName,
						removeHomeDir(err.stack ? err.stack.split("\n").slice(0, 5).join("\n") : JSON.stringify(err, null, 2))
					)
				);
			}
		}

		async function onReaction() {
			const { onReaction: onReactionMap } = GoatBot;
			const Reaction = onReactionMap.get(messageID);
			if (!Reaction) {
				return;
			}
			Reaction.delete = () => onReactionMap.delete(messageID);
			const commandName = Reaction.commandName;
			if (!commandName) {
				return;
			}
			const command = resolveCommandFromMapOrAlias(GoatBot, commandName);
			if (!command) {
				return;
			}

			const roleConfig = getRoleConfig(utils, command, isGroup, threadData, commandName);
			const needRole = roleConfig.onReaction;
			if (needRole > role) {
				if (!hideNotiMessage.needRoleToUseCmd) {
					if (needRole === 1) {
						return await message.reply(getText("onlyAdminBox", null, null, null, langCode));
					}
					if (needRole === 2) {
						return await message.reply(getText("onlyAdminBot2", null, null, null, langCode));
					}
				}
				return;
			}

			const time = getTime("DD/MM/YYYY HH:mm:ss");
			try {
				if (
					isBannedOrOnlyAdmin(
						userData,
						threadData,
						senderID,
						threadID,
						isGroup,
						commandName,
						message,
						langCode
					)
				) {
					return;
				}
				const getText2 = createGetText2(
					langCode,
					`${process.cwd()}/languages/cmds/${langCode}.js`,
					prefix,
					command
				);
				const args = [];
				const aiWrappedMessage = createAiAwareMessageWrapper(message, commandName);
				await command.onReaction({
					...parameters,
					message: aiWrappedMessage,
					Reaction,
					args,
					commandName,
					getLang: getText2
				});
				log.info("CALL COMMAND ON REACTION", `${commandName} | ${userData?.name || senderID} | ${senderID} | ${threadID} | ${event.reaction}`);
			}
			catch (err) {
				log.err("CALL COMMAND ON REACTION", `An error occurred when calling the command onReaction ${commandName}`, err);
				await message.reply(
					utils.getText(
						{ lang: langCode, head: "handlerEvents" },
						"errorOccurred5",
						time,
						commandName,
						removeHomeDir(err.stack ? err.stack.split("\n").slice(0, 5).join("\n") : JSON.stringify(err, null, 2))
					)
				);
			}
		}

		async function handlerEvent() {
			const { author } = event;
			const allEventCommand = GoatBot.eventCommands.entries();
			for (const [key] of allEventCommand) {
				const getEvent = GoatBot.eventCommands.get(key);
				if (!getEvent) {
					continue;
				}
				const commandName = getEvent.config.name;
				const getText2 = createGetText2(
					langCode,
					`${process.cwd()}/languages/events/${langCode}.js`,
					prefix,
					getEvent
				);
				const time = getTime("DD/MM/YYYY HH:mm:ss");
				try {
					const aiWrappedMessage = createAiAwareMessageWrapper(message, commandName);
					const ichten = await getEvent.onStart({
						...parameters,
						message: aiWrappedMessage,
						commandName,
						getLang: getText2
					});
					if (typeof ichten === "function") {
						await ichten();
						log.info("EVENT COMMAND", `Event: ${commandName} | ${author} | ${userData?.name || author} | ${threadID}`);
					}
				}
				catch (err) {
					log.err("EVENT COMMAND", `An error occurred when calling the command event ${commandName}`, err);
					await message.reply(
						utils.getText(
							{ lang: langCode, head: "handlerEvents" },
							"errorOccurred6",
							time,
							commandName,
							removeHomeDir(err.stack ? err.stack.split("\n").slice(0, 5).join("\n") : JSON.stringify(err, null, 2))
						)
					);
				}
			}
		}

		async function onEvent() {
			const allOnEvent = GoatBot.onEvent || [];
			const args = [];
			const { author } = event;
			for (const key of allOnEvent) {
				if (typeof key !== "string") {
					continue;
				}
				const command = GoatBot.commands.get(key);
				if (!command) {
					continue;
				}
				const commandName = command.config.name;
				const time = getTime("DD/MM/YYYY HH:mm:ss");
				try {
					const getText2 = createGetText2(
						langCode,
						`${process.cwd()}/languages/cmds/${langCode}.js`,
						prefix,
						command
					);
					const aiWrappedMessage = createAiAwareMessageWrapper(message, commandName);
					const ichten = await command.onEvent({
						...parameters,
						message: aiWrappedMessage,
						args,
						commandName,
						getLang: getText2
					});
					if (typeof ichten === "function") {
						await ichten();
						log.info("CALL COMMAND ON EVENT", `${commandName} | ${author} | ${userData?.name || author} | ${threadID}`);
					}
				}
				catch (err) {
					log.err("CALL COMMAND ON EVENT", `An error occurred when calling the command onEvent ${commandName}`, err);
					await message.reply(
						utils.getText(
							{ lang: langCode, head: "handlerEvents" },
							"errorOccurred7",
							time,
							commandName,
							removeHomeDir(err.stack ? err.stack.split("\n").slice(0, 5).join("\n") : JSON.stringify(err, null, 2))
						)
					);
				}
			}
		}

		function getTime(format) {
			if (utils && typeof utils.getTime === "function") {
				return utils.getTime(format);
			}
			return new Date().toISOString();
		}

		return {
			onAnyEvent,
			onFirstChat,
			onChat,
			onStart,
			onReaction,
			onReply,
			onEvent,
			handlerEvent
		};
	};
};