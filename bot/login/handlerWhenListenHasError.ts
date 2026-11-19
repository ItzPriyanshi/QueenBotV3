const axios = require("axios");

function filterAddress(address: string): string[] {
	return address.split(/[,;\s]/).map(id => id.trim()).filter(id => id);
}

async function handlerWhenListenHasError({ error }: any): Promise<void> {
	const { config, botID } = (global as any).GoatBot;
	const { log } = (global as any).utils;
	const configNotiWhenListenMqttError = config.notiWhenListenMqttError || {};

	if (configNotiWhenListenMqttError.telegram?.enable == true) {
		const TELEBOT_TOKEN = configNotiWhenListenMqttError.telegram.botToken;
		let highlightCode = error;
		if (typeof error == "object" && !error.stack)
			highlightCode = JSON.stringify(error, null, 2);
		else if (error.stack)
			highlightCode = error.stack;

		const ADMIN_IDS_TELEGRAM = filterAddress(configNotiWhenListenMqttError.telegram.chatId);
		for (const ADMIN_ID_TELEGRAM of ADMIN_IDS_TELEGRAM) {
			if (!ADMIN_ID_TELEGRAM)
				continue;
			const MAX_LENGTH_TELEGRAM_MESSAGE = 4096;
			const message = `Has error when listen message in QueenBot v2 id: ${botID}:\n`;
			let messageError = `\`\`\`json\n${highlightCode}\n\`\`\``;

			if (message.length + messageError.length > MAX_LENGTH_TELEGRAM_MESSAGE) {
				const lastString = "\n\n... (Too long to show)```";
				messageError = messageError.slice(0, MAX_LENGTH_TELEGRAM_MESSAGE - message.length - lastString.length) + lastString;
			}

			axios.post(`https://api.telegram.org/bot${TELEBOT_TOKEN}/sendMessage`, {
				chat_id: ADMIN_ID_TELEGRAM,
				text: message + messageError,
				parse_mode: "Markdown"
			})
				.then(() => {})
				.catch((err: any) => log.err("handlerWhenListenHasError", "Can not send message to telegram", err.response?.data));
		}
	}

	if (configNotiWhenListenMqttError.discord?.enable == true) {
		let highlightCode = error;
		if (typeof error == "object" && !error.stack)
			highlightCode = JSON.stringify(error, null, 2);
		else if (error.stack)
			highlightCode = error.stack;

		const jsonHook = {
			content: null,
			embeds: [
				{
					title: `Has error when listen message in QueenBot v2 id: ${botID}:`,
					description: `\`\`\`json\n${highlightCode}\n\`\`\``,
					color: 16711680
				}
			],
			attachments: []
		};

		const webhookUrls = filterAddress(configNotiWhenListenMqttError.discord.webhookUrl);
		for (const WEBHOOK of webhookUrls) {
			if (!WEBHOOK)
				continue;
			axios.post(WEBHOOK, jsonHook)
				.then(() => {})
				.catch((err: any) => log.err("handlerWhenListenHasError", "Can not send message to discord webhook", err.response?.data));
		}
	}
}

module.exports = handlerWhenListenHasError;
