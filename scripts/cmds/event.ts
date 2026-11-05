const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");

function getDomain(url: string) {
	const regex = /^(?:https?[:][/][/])?(?:[^@\n]+@)?(?:www\.)?([^:/\n]+)/im;
	const match = url.match(regex);
	return match ? match[1] : null;
}

function isValidScriptFileName(name: string) {
	return typeof name === "string" && /\.(js|ts)$/i.test(name.trim());
}

module.exports = {
	config: {
		name: "event",
		version: "2.0",
		author: "Priyanshi Kaur",
		countDown: 5,
		role: 2,
		description: {
			vi: "Quản lý các tệp lệnh event của bạn",
			en: "Manage your event command files"
		},
		category: "owner",
		guide: {
			vi: "{pn} load <tên file lệnh>"
				+ "\n{pn} loadAll"
				+ "\n{pn} install <url> <tên file lệnh>: Tải về và load command event, url là đường dẫn tới file lệnh (raw)"
				+ "\n{pn} install <code> <tên file lệnh>: Tải về và load command event, code là mã của file lệnh (raw)",
			en: "{pn} load <command file name>"
				+ "\n{pn} loadAll"
				+ "\n{pn} install <url> <command file name>: Download and load event command, url is the path to the command file (raw)"
				+ "\n{pn} install <code> <command file name>: Download and load event command, code is the code of the command file (raw)"
		}
	},
	langs: {
		vi: {
			missingFileName: "⚠️ | Vui lòng nhập vào tên lệnh bạn muốn reload",
			loaded: "✅ | Đã load event command \"%1\" thành công",
			loadedError: "❌ | Load event command \"%1\" thất bại với lỗi\n%2: %3",
			loadedSuccess: "✅ | Đã load thành công \"%1\" event command",
			loadedFail: "❌ | Load thất bại event command \"%1\"\n%2",
			missingCommandNameUnload: "⚠️ | Vui lòng nhập vào tên lệnh bạn muốn unload",
			unloaded: "✅ | Đã unload event command \"%1\" thành công",
			unloadedError: "❌ | Unload event command \"%1\" thất bại với lỗi\n%2: %3",
			missingUrlCodeOrFileName: "⚠️ | Vui lòng nhập vào url hoặc code và tên file lệnh bạn muốn cài đặt",
			missingUrlOrCode: "⚠️ | Vui lòng nhập vào url hoặc code của tệp lệnh bạn muốn cài đặt",
			missingFileNameInstall: "⚠️ | Vui lòng nhập vào tên file để lưu lệnh (đuôi .js hoặc .ts)",
			invalidUrl: "⚠️ | Địa chỉ url không hợp lệ",
			invalidUrlOrCode: "⚠️ | Không thể lấy được mã lệnh",
			alreadExist: "⚠️ | File lệnh đã tồn tại, bạn có chắc chắn muốn ghi đè lên file lệnh cũ không?\nThả cảm xúc bất kì vào tin nhắn này để tiếp tục",
			installed: "✅ | Đã cài đặt event command \"%1\" thành công, file lệnh được lưu tại %2",
			installedError: "❌ | Cài đặt event command \"%1\" thất bại với lỗi\n%2: %3",
			missingFile: "⚠️ | Không tìm thấy tệp lệnh \"%1\"",
			invalidFileName: "⚠️ | Tên tệp lệnh không hợp lệ",
			unloadedFile: "✅ | Đã unload lệnh \"%1\""
		},
		en: {
			missingFileName: "⚠️ | Please enter the command name you want to reload",
			loaded: "✅ | Loaded event command \"%1\" successfully",
			loadedError: "❌ | Loaded event command \"%1\" failed with error\n%2: %3",
			loadedSuccess: "✅ | Loaded \"%1\" event command successfully",
			loadedFail: "❌ | Loaded event command \"%1\" failed\n%2",
			missingCommandNameUnload: "⚠️ | Please enter the command name you want to unload",
			unloaded: "✅ | Unloaded event command \"%1\" successfully",
			unloadedError: "❌ | Unloaded event command \"%1\" failed with error\n%2: %3",
			missingUrlCodeOrFileName: "⚠️ | Please enter the url or code and command file name you want to install",
			missingUrlOrCode: "⚠️ | Please enter the url or code of the command file you want to install",
			missingFileNameInstall: "⚠️ | Please enter the file name to save the command (with .js or .ts extension)",
			invalidUrl: "⚠️ | Invalid url",
			invalidUrlOrCode: "⚠️ | Unable to get command code",
			alreadExist: "⚠️ | The command file already exists, are you sure you want to overwrite the old command file?\nReact to this message to continue",
			installed: "✅ | Installed event command \"%1\" successfully, the command file is saved at %2",
			installedError: "❌ | Installed event command \"%1\" failed with error\n%2: %3",
			missingFile: "⚠️ | File \"%1\" not found",
			invalidFileName: "⚠️ | Invalid file name",
			unloadedFile: "✅ | Unloaded command \"%1\""
		}
	},
	onStart: async ({ args, message, api, threadModel, userModel, dashBoardModel, globalModel, threadsData, usersData, dashBoardData, globalData, commandName, event, getLang }: any) => {
		const { configCommands } = (global as any).GoatBot;
		const { log, loadScripts } = (global as any).utils;
		const subCommand = (args[0] || "").toLowerCase();

		if (subCommand == "load" && args.length == 2) {
			if (!args[1])
				return message.reply(getLang("missingFileName"));
			const infoLoad = await loadScripts("events", args[1], log, configCommands, api, threadModel, userModel, dashBoardModel, globalModel, threadsData, usersData, dashBoardData, globalData, getLang);
			if (infoLoad.status == "success")
				return message.reply(getLang("loaded", infoLoad.name));
			else
				return message.reply(getLang("loadedError", infoLoad.name, infoLoad.error?.name || "Error", infoLoad.error?.message || String(infoLoad.error)));
		}
		else if (subCommand == "loadall" || (subCommand == "load" && args.length > 2)) {
			const allFile = subCommand == "loadall" ?
				fs.readdirSync(path.join(__dirname, "..", "events"))
					.filter((file: string) =>
						(file.endsWith(".js") || file.endsWith(".ts")) &&
						!file.match(/(eg)\.(js|ts)$/g) &&
						(process.env.NODE_ENV == "development" ? true : !file.match(/(dev)\.(js|ts)$/g)) &&
						!configCommands.commandEventUnload?.includes(file)
					)
					.map((item: string) => item.replace(/\.(js|ts)$/i, "")) :
				args.slice(1);
			const arraySucces: string[] = [];
			const arrayFail: string[] = [];
			for (const fileName of allFile) {
				const infoLoad = await loadScripts("events", fileName, log, configCommands, api, threadModel, userModel, dashBoardModel, globalModel, threadsData, usersData, dashBoardData, globalData, getLang);
				infoLoad.status == "success" ?
					arraySucces.push(fileName) :
					arrayFail.push(`${fileName} => ${infoLoad.error?.name || "Error"}: ${infoLoad.error?.message || String(infoLoad.error)}`);
			}
			let msg = "";
			if (arraySucces.length > 0)
				msg += getLang("loadedSuccess", arraySucces.length) + "\n";
			if (arrayFail.length > 0)
				msg += (msg ? "\n" : "") + getLang("loadedFail", arrayFail.length, "❗" + arrayFail.join("\n❗ "));
			return message.reply(msg || getLang("loadedSuccess", 0));
		}
		else if (subCommand == "unload") {
			if (!args[1])
				return message.reply(getLang("missingCommandNameUnload"));
			const infoUnload = await (global as any).utils.unloadScripts("events", args[1], configCommands, getLang);
			infoUnload.status == "success" ?
				message.reply(getLang("unloaded", infoUnload.name)) :
				message.reply(getLang("unloadedError", infoUnload.name, infoUnload.error?.name || "Error", infoUnload.error?.message || String(infoUnload.error)));
		}
		else if (subCommand == "install") {
			let url = args[1];
			let fileName = args[2];
			let rawCode = "";

			if (!url)
				return message.reply(getLang("missingUrlCodeOrFileName"));

			if (isValidScriptFileName(url) && fileName && /^https?[:][/][/]/i.test(fileName)) {
				const tmp = fileName;
				fileName = url;
				url = tmp;
			}

			if (/^https?[:][/][/]/i.test(url)) {
				if (!fileName) {
					return message.reply(getLang("missingFileNameInstall"));
				}
				if (!isValidScriptFileName(fileName)) {
					fileName = `${fileName}.ts`;
				}
				const domain = getDomain(url);
				if (!domain)
					return message.reply(getLang("invalidUrl"));
				if (domain == "pastebin.com") {
					const regex = /https[:][/][/]pastebin\.com[/](?!raw[/])(.*)/;
					if (url.match(regex))
						url = url.replace(regex, "https://pastebin.com/raw/$1");
					if (url.endsWith("/"))
						url = url.slice(0, -1);
				}
				else if (domain == "github.com") {
					const regex = /https[:][/][/]github\.com[/](.*)[/]blob[/](.*)/;
					if (url.match(regex))
						url = url.replace(regex, "https://raw.githubusercontent.com/$1/$2");
				}
				const response = await axios.get(url, { responseType: "text" });
				rawCode = typeof response.data === "string" ? response.data : JSON.stringify(response.data, null, 2);
				if (domain == "savetext.net") {
					const $ = cheerio.load(rawCode);
					rawCode = $("#content").text();
				}
			}
			else {
				const bodyText = String(event.body || "");
				const installMatch = bodyText.match(/install\s+/i);
				const afterInstall = installMatch ? bodyText.slice((installMatch.index || 0) + installMatch[0].length) : "";

				if (args.length >= 2 && isValidScriptFileName(args[args.length - 1])) {
					fileName = args[args.length - 1];
					const lastIdx = afterInstall.lastIndexOf(fileName);
					rawCode = lastIdx > 0 ? afterInstall.slice(0, lastIdx).trim() : "";
				}
				else if (isValidScriptFileName(args[1])) {
					fileName = args[1];
					const firstIdx = afterInstall.indexOf(fileName);
					rawCode = firstIdx !== -1 ? afterInstall.slice(firstIdx + fileName.length).trim() : "";
				}
				else {
					return message.reply(getLang("missingFileNameInstall"));
				}
			}

			if (!rawCode || !rawCode.trim())
				return message.reply(getLang("invalidUrlOrCode"));

			const targetEventPath = path.join(__dirname, "..", "events", fileName);
			if (fs.existsSync(targetEventPath)) {
				const info = await message.reply(getLang("alreadExist"));
				if (info && info.messageID) {
					(global as any).GoatBot.onReaction.set(info.messageID, {
						commandName,
						messageID: info.messageID,
						type: "install",
						author: event.senderID,
						data: {
							fileName,
							rawCode
						}
					});
				}
				return;
			}
			else {
				const infoLoad = await loadScripts("events", fileName, log, configCommands, api, threadModel, userModel, dashBoardModel, globalModel, threadsData, usersData, dashBoardData, globalData, getLang, rawCode);
				infoLoad.status == "success" ?
					message.reply(getLang("installed", infoLoad.name, targetEventPath.replace(process.cwd(), ""))) :
					message.reply(getLang("installedError", infoLoad.name, infoLoad.error?.name || "Error", infoLoad.error?.message || String(infoLoad.error)));
			}
		}
		else
			message.SyntaxError();
	},
	onReaction: async function ({ Reaction, message, event, api, threadModel, userModel, dashBoardModel, globalModel, threadsData, usersData, dashBoardData, globalData, getLang }: any) {
		const { author, messageID, data: { fileName, rawCode } } = Reaction;
		if (event.userID != author)
			return;
		const { configCommands } = (global as any).GoatBot;
		const { log, loadScripts } = (global as any).utils;
		const infoLoad = await loadScripts("events", fileName, log, configCommands, api, threadModel, userModel, dashBoardModel, globalModel, threadsData, usersData, dashBoardData, globalData, getLang, rawCode);
		const targetEventPath = path.join(__dirname, "..", "events", fileName).replace(process.cwd(), "");
		if (infoLoad.status == "success") {
			await message.reply(getLang("installed", infoLoad.name, targetEventPath));
		}
		else {
			await message.reply(getLang("installedError", infoLoad.name, infoLoad.error?.name || "Error", infoLoad.error?.message || String(infoLoad.error)));
		}
		if (messageID) {
			try {
				await message.unsend(messageID);
			}
			catch (e) {
			}
		}
	}
};