const handlerCheckDB = require("./handlerCheckData");

function handlerAction(api: any, threadModel: any, userModel: any, dashboardModel: any, globalModel: any, usersData: any, threadsData: any, dashBoardData: any, globalData: any) {
	const handlerEvents = require("./handlerEvents")(api, threadModel, userModel, dashboardModel, globalModel, usersData, threadsData, dashBoardData, globalData);

	return async function (event: any) {
		if (!event)
			return;

		if (
			(global as any).GoatBot.config.antiInbox == true &&
			(event.senderID == event.threadID || event.userID == event.senderID || event.isGroup == false) &&
			(event.senderID || event.userID || event.isGroup == false)
		)
			return;

		if (event.messageID && (event.type === "message" || event.type === "message_reply")) {
			if (!(global as any).temp) (global as any).temp = {};
			if (!(global as any).temp.messageStore) (global as any).temp.messageStore = new Map();
			(global as any).temp.messageStore.set(event.messageID, {
				senderID: String(event.senderID || event.author || ""),
				body: event.body,
				timestamp: event.timestamp || Date.now()
			});
			if ((global as any).temp.messageStore.size > 3000) {
				const oldestKey = (global as any).temp.messageStore.keys().next().value;
				(global as any).temp.messageStore.delete(oldestKey);
			}
		}

		const message = (global as any).utils?.message?.(api, event);

		await handlerCheckDB(usersData, threadsData, event);
		const handlerChat = await handlerEvents(event, message);
		if (!handlerChat)
			return;

		const {
			onAnyEvent, onFirstChat, onStart, onChat,
			onReply, onEvent, handlerEvent, onReaction,
			typ, presence, read_receipt
		} = handlerChat;

		if (typeof onAnyEvent === "function") onAnyEvent();
		switch (event.type) {
			case "message":
			case "message_reply":
				if (typeof onFirstChat === "function") onFirstChat();
				if (typeof onStart === "function") await onStart();
				if (typeof onChat === "function") onChat();
				if (typeof onReply === "function") onReply();
				break;
			case "message_unsend":
				break;
			case "event":
				if (typeof handlerEvent === "function") handlerEvent();
				if (typeof onEvent === "function") onEvent();
				break;
			case "message_reaction":
				if (event.messageID && event.reaction) {
					try {
						const threadData = global.db.allThreadData.find((t: any) => t.threadID == event.threadID) || await threadsData.get(event.threadID);
						const reactorID = String(event.userID || event.senderID || "");
						const botID = String(api.getCurrentUserID() || "");

						if (["😈", "🗑️"].includes(event.reaction)) {
							if ((global as any).GoatBot?.onReaction?.has(event.messageID)) {
								(global as any).GoatBot.onReaction.delete(event.messageID);
							}
							const allowUnsend = threadData?.settings?.reactToUnsend !== false;
							const storedMsg = (global as any).temp?.messageStore?.get(event.messageID);
							if (allowUnsend && (!storedMsg || !storedMsg.senderID || storedMsg.senderID === botID)) {
								api.unsendMessage(event.messageID, () => {});
							}
							return;
						}

						if (["💀", "🚫"].includes(event.reaction) && event.threadID) {
							const allowKick = threadData?.settings?.reactToKick === true;
							const adminIDs = (threadData?.adminIDs || []).map((id: any) => String(id));
							const adminBot = ((global as any).GoatBot.config.adminBot || []).map((id: any) => String(id));
							const isBotAdmin = adminBot.includes(reactorID);
							const isGroupAdmin = adminIDs.includes(reactorID) || isBotAdmin;
							const botHasGroupAdmin = adminIDs.includes(botID);

							if (allowKick && isGroupAdmin && botHasGroupAdmin) {
								const storedMsg = (global as any).temp?.messageStore?.get(event.messageID);
								const targetUID = String(event.messageAuthor || storedMsg?.senderID || "");
								if (targetUID && targetUID !== botID && !adminIDs.includes(targetUID) && !adminBot.includes(targetUID)) {
									await api.removeUserFromGroup(targetUID, event.threadID);
									try {
										const targetName = await usersData.getName(targetUID);
										api.sendMessage(`👢 [Auto-Kick] Removed member ${targetName} (${targetUID}) via administrator reaction.`, event.threadID);
									} catch (_) {}
								}
							}
						}
					} catch (_) {}
				}
				if (typeof onReaction === "function") onReaction();
				break;
			case "typ":
				if (typeof typ === "function") typ();
				break;
			case "presence":
				if (typeof presence === "function") presence();
				break;
			case "read_receipt":
				if (typeof read_receipt === "function") read_receipt();
				break;
			default:
				break;
		}
	};
}

module.exports = handlerAction;