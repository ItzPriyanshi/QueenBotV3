const axios = require("axios");
const { execSync } = require("child_process");
const fs = require("fs-extra");
const path = require("path");
const cheerio = require("cheerio");

function invokeSendMessage(api, form, threadID, userCallback, replyToMessage) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled)
                return;
            settled = true;
            if (typeof userCallback === "function") {
                try {
                    userCallback(null, {});
                }
                catch (e) {}
            }
            resolve({});
        }, 15000);

        const finish = (err, info) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            if (typeof userCallback === "function") {
                try {
                    userCallback(err, info);
                }
                catch (e) {}
            }
            if (err)
                reject(err);
            else
                resolve(info);
        };

        try {
            const ret = api.sendMessage(form, threadID, (err, info) => {
                finish(err, info);
            }, replyToMessage);
            if (ret && typeof ret.then === "function") {
                ret.then((info) => finish(null, info)).catch((err) => finish(err));
            }
        }
        catch (err) {
            finish(err);
        }
    });
}

if (global.utils && typeof global.utils.message === "function" && !global.utils.__safeMessagePatched) {
    const origMessageFactory = global.utils.message;
    const threadQueues = new Map();
    const enqueueSafe = (threadID, task) => {
        const key = String(threadID || "default");
        const prev = threadQueues.get(key) || Promise.resolve();
        const runPromise = prev.catch(() => {}).then(() => new Promise((resolve, reject) => {
            setTimeout(() => {
                Promise.resolve().then(task).then(resolve).catch(reject);
            }, 300);
        }));
        threadQueues.set(key, runPromise.catch(() => {}));
        return runPromise;
    };
    global.utils.message = function (api, event) {
        const base = origMessageFactory(api, event);
        return {
            ...base,
            send: async (form, callback) => {
                return await enqueueSafe(event.threadID, async () => {
                    global.statusAccountBot = "good";
                    return await invokeSendMessage(api, form, event.threadID, typeof callback === "function" ? callback : undefined, undefined);
                });
            },
            reply: async (form, callback) => {
                return await enqueueSafe(event.threadID, async () => {
                    global.statusAccountBot = "good";
                    return await invokeSendMessage(api, form, event.threadID, typeof callback === "function" ? callback : undefined, event.messageID);
                });
            }
        };
    };
    global.utils.__safeMessagePatched = true;
}

function getDomain(url) {
    try {
        return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    }
    catch (e) {
        return null;
    }
}

function isURL(str) {
    if (!str || typeof str !== "string")
        return false;
    try {
        const parsed = new URL(str.trim());
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    }
    catch (e) {
        return false;
    }
}

function normalizeFileName(name, folder = "cmds") {
    if (!name || typeof name !== "string")
        return "";
    let clean = path.basename(name.trim());
    if (!clean)
        return "";
    if (!clean.endsWith(".ts") && !clean.endsWith(".js")) {
        const dir = path.normalize(`${process.cwd()}/scripts/${folder}`);
        if (fs.existsSync(path.join(dir, `${clean}.js`)) && !fs.existsSync(path.join(dir, `${clean}.ts`))) {
            clean += ".js";
        }
        else {
            clean += ".ts";
        }
    }
    return clean;
}

function resolveScriptPath(folder, fileName) {
    if (!fileName || typeof fileName !== "string")
        return null;
    const cleanName = path.basename(fileName.trim());
    const baseName = cleanName.replace(/\.(ts|js)$/i, "");
    const dir = path.normalize(`${process.cwd()}/scripts/${folder}`);
    if (process.env.NODE_ENV === "development") {
        const devTs = path.join(dir, `${baseName}.dev.ts`);
        if (fs.existsSync(devTs))
            return { fullPath: devTs, fileName: `${baseName}.dev.ts`, baseName };
        const devJs = path.join(dir, `${baseName}.dev.js`);
        if (fs.existsSync(devJs))
            return { fullPath: devJs, fileName: `${baseName}.dev.js`, baseName };
    }
    if (cleanName.endsWith(".ts") || cleanName.endsWith(".js")) {
        const direct = path.join(dir, cleanName);
        if (fs.existsSync(direct))
            return { fullPath: direct, fileName: cleanName, baseName };
    }
    const tsPath = path.join(dir, `${baseName}.ts`);
    if (fs.existsSync(tsPath))
        return { fullPath: tsPath, fileName: `${baseName}.ts`, baseName };
    const jsPath = path.join(dir, `${baseName}.js`);
    if (fs.existsSync(jsPath))
        return { fullPath: jsPath, fileName: `${baseName}.js`, baseName };
    return null;
}

function stripComments(code) {
    if (typeof code !== "string")
        return "";
    return code.replace(/\/\*[\s\S]*?\*\/|(?<!:)\/\/.*$/gm, "");
}

function isPackageInstalled(packageName) {
    try {
        if (require("module").isBuiltin(packageName))
            return true;
    }
    catch (e) {}
    try {
        require.resolve(packageName, { paths: [process.cwd(), __dirname] });
        return true;
    }
    catch (e) {
        return fs.existsSync(path.join(process.cwd(), "node_modules", packageName));
    }
}

function normalizeRawUrl(rawUrl) {
    let url = rawUrl.trim();
    const domain = getDomain(url);
    if (!domain)
        return null;
    if (domain === "pastebin.com") {
        const regex = /^https?:\/\/(?:www\.)?pastebin\.com\/(?!raw\/)([a-zA-Z0-9]+)/i;
        if (regex.test(url))
            url = url.replace(regex, "https://pastebin.com/raw/$1");
        if (url.endsWith("/"))
            url = url.slice(0, -1);
    }
    else if (domain === "github.com") {
        const regex = /^https?:\/\/(?:www\.)?github\.com\/([^/]+\/[^/]+)\/blob\/(.+)/i;
        if (regex.test(url))
            url = url.replace(regex, "https://raw.githubusercontent.com/$1/$2");
    }
    else if (domain === "gist.github.com") {
        if (!url.endsWith("/raw") && !url.includes("/raw/"))
            url = url.replace(/\/$/, "") + "/raw";
    }
    return { url, domain };
}

function extractUrlFromText(text) {
    if (!text || typeof text !== "string")
        return null;
    const match = text.match(/https?:\/\/[^\s"'<>]+/i);
    return match ? match[0] : null;
}

module.exports = {
    config: {
        name: "cmd",
        version: "2.5.0",
        author: "Priyanshi Kaur",
        countDown: 5,
        role: 2,
        description: {
            vi: "Quản lý các tệp lệnh của bạn",
            en: "Manage your command files"
        },
        category: "owner",
        guide: {
            vi: "   {pn} load <tên file lệnh>"
                + "\n   {pn} loadAll"
                + "\n   {pn} unload <tên file lệnh>"
                + "\n   {pn} install <url> <tên file lệnh>"
                + "\n   {pn} install <tên file lệnh> <url>"
                + "\n   {pn} install <tên file lệnh> <code>",
            en: "   {pn} load <command file name>"
                + "\n   {pn} loadAll"
                + "\n   {pn} unload <command file name>"
                + "\n   {pn} install <url> <command file name>"
                + "\n   {pn} install <command file name> <url>"
                + "\n   {pn} install <command file name> <code>"
        }
    },
    langs: {
        vi: {
            missingFileName: "⚠️ | Vui lòng nhập vào tên lệnh bạn muốn reload",
            loaded: "✅ | Đã load command \"%1\" thành công",
            loadedError: "❌ | Load command \"%1\" thất bại với lỗi\n%2: %3",
            loadedSuccess: "✅ | Đã load thành công (%1) command",
            loadedFail: "❌ | Load thất bại (%1) command\n%2",
            openConsoleToSeeError: "👀 | Hãy mở console để xem chi tiết lỗi",
            missingCommandNameUnload: "⚠️ | Vui lòng nhập vào tên lệnh bạn muốn unload",
            unloaded: "✅ | Đã unload command \"%1\" thành công",
            unloadedError: "❌ | Unload command \"%1\" thất bại với lỗi\n%2: %3",
            missingUrlCodeOrFileName: "⚠️ | Vui lòng nhập vào url hoặc code và tên file lệnh bạn muốn cài đặt",
            missingUrlOrCode: "⚠️ | Vui lòng nhập vào url hoặc code của tệp lệnh bạn muốn cài đặt",
            missingFileNameInstall: "⚠️ | Vui lòng nhập vào tên file hợp lệ (.ts hoặc .js)",
            invalidUrl: "⚠️ | Vui lòng nhập vào url hợp lệ",
            invalidUrlOrCode: "⚠️ | Không thể lấy được mã lệnh",
            alreadExist: "⚠️ | File lệnh đã tồn tại, bạn có chắc chắn muốn ghi đè lên file lệnh cũ không?\nThả cảm xúc bất kì vào tin nhắn này để tiếp tục",
            installed: "✅ | Đã cài đặt command \"%1\" thành công, file lệnh được lưu tại %2",
            installedError: "❌ | Cài đặt command \"%1\" thất bại với lỗi\n%2: %3",
            missingFile: "⚠️ | Không tìm thấy tệp lệnh \"%1\"",
            invalidFileName: "⚠️ | Tên tệp lệnh không hợp lệ",
            unloadedFile: "✅ | Đã unload lệnh \"%1\""
        },
        en: {
            missingFileName: "⚠️ | Please enter the command name you want to reload",
            loaded: "✅ | Loaded command \"%1\" successfully",
            loadedError: "❌ | Failed to load command \"%1\" with error\n%2: %3",
            loadedSuccess: "✅ | Loaded successfully (%1) command",
            loadedFail: "❌ | Failed to load (%1) command\n%2",
            openConsoleToSeeError: "👀 | Open console to see error details",
            missingCommandNameUnload: "⚠️ | Please enter the command name you want to unload",
            unloaded: "✅ | Unloaded command \"%1\" successfully",
            unloadedError: "❌ | Failed to unload command \"%1\" with error\n%2: %3",
            missingUrlCodeOrFileName: "⚠️ | Please enter the url or code and command file name you want to install",
            missingUrlOrCode: "⚠️ | Please enter the url or code of the command file you want to install",
            missingFileNameInstall: "⚠️ | Please enter a valid file name (.ts or .js)",
            invalidUrl: "⚠️ | Please enter a valid url",
            invalidUrlOrCode: "⚠️ | Unable to get command code",
            alreadExist: "⚠️ | The command file already exists, are you sure you want to overwrite the old command file?\nReact to this message to continue",
            installed: "✅ | Installed command \"%1\" successfully, the command file is saved at %2",
            installedError: "❌ | Failed to install command \"%1\" with error\n%2: %3",
            missingFile: "⚠️ | Command file \"%1\" not found",
            invalidFileName: "⚠️ | Invalid command file name",
            unloadedFile: "✅ | Unloaded command \"%1\""
        }
    },
    onStart: async ({ args, message, api, threadModel, userModel, dashBoardModel, globalModel, threadsData, usersData, dashBoardData, globalData, event, commandName, getLang }) => {
        const { configCommands } = global.GoatBot;
        const { log } = global.utils;
        const action = (args[0] || "").toLowerCase();

        if (action === "load" && args.length === 2) {
            if (!args[1])
                return message.reply(getLang("missingFileName"));
            const infoLoad = loadScripts("cmds", args[1], log, configCommands, api, threadModel, userModel, dashBoardModel, globalModel, threadsData, usersData, dashBoardData, globalData, getLang);
            if (infoLoad.status === "success")
                return message.reply(getLang("loaded", infoLoad.name));
            console.log(infoLoad.errorWithThoutRemoveHomeDir || infoLoad.error);
            return message.reply(
                getLang("loadedError", infoLoad.name, infoLoad.error.name, infoLoad.error.message)
                + (infoLoad.error.stack ? "\n" + infoLoad.error.stack : "")
            );
        }
        else if (action === "loadall" || (action === "load" && args.length > 2)) {
            const fileNeedToLoad = action === "loadall" ?
                fs.readdirSync(__dirname)
                    .filter(file =>
                        (file.endsWith(".ts") || file.endsWith(".js")) &&
                        !file.match(/(eg)\.(ts|js)$/i) &&
                        (process.env.NODE_ENV === "development" ? true : !file.match(/(dev)\.(ts|js)$/i)) &&
                        !configCommands.commandUnload?.includes(file) &&
                        !configCommands.commandUnload?.includes(file.replace(/\.(ts|js)$/i, ""))
                    )
                    .map(item => item.replace(/\.(ts|js)$/i, "")) :
                args.slice(1);
            const arraySucces = [];
            const arrayFail = [];
            for (const fileName of fileNeedToLoad) {
                const infoLoad = loadScripts("cmds", fileName, log, configCommands, api, threadModel, userModel, dashBoardModel, globalModel, threadsData, usersData, dashBoardData, globalData, getLang);
                if (infoLoad.status === "success")
                    arraySucces.push(fileName);
                else
                    arrayFail.push(` ❗ ${fileName} => ${infoLoad.error.name}: ${infoLoad.error.message}`);
            }
            let msg = "";
            if (arraySucces.length > 0)
                msg += getLang("loadedSuccess", arraySucces.length);
            if (arrayFail.length > 0) {
                msg += (msg ? "\n" : "") + getLang("loadedFail", arrayFail.length, arrayFail.join("\n"));
                msg += "\n" + getLang("openConsoleToSeeError");
            }
            return message.reply(msg || getLang("loadedSuccess", 0));
        }
        else if (action === "unload") {
            if (!args[1])
                return message.reply(getLang("missingCommandNameUnload"));
            const infoUnload = unloadScripts("cmds", args[1], configCommands, getLang);
            return infoUnload.status === "success" ?
                message.reply(getLang("unloaded", infoUnload.name)) :
                message.reply(getLang("unloadedError", infoUnload.name, infoUnload.error.name, infoUnload.error.message));
        }
        else if (action === "install") {
            let url = "";
            let fileName = "";
            let rawCode = "";

            if (!args[1])
                return message.reply(getLang("missingUrlCodeOrFileName"));

            const forceOverwrite = args.includes("-f") || args.includes("--force");
            const cleanArgs = args.filter(a => a !== "-f" && a !== "--force");

            if (isURL(cleanArgs[1])) {
                url = cleanArgs[1];
                fileName = normalizeFileName(cleanArgs[2], "cmds");
            }
            else if (cleanArgs[2] && isURL(cleanArgs[2])) {
                url = cleanArgs[2];
                fileName = normalizeFileName(cleanArgs[1], "cmds");
            }
            else if (cleanArgs.length === 2 && event.messageReply?.body) {
                fileName = normalizeFileName(cleanArgs[1], "cmds");
                const replyText = String(event.messageReply.body).trim();
                if (isURL(replyText)) {
                    url = replyText;
                }
                else {
                    const detectedUrl = extractUrlFromText(replyText);
                    if (detectedUrl && replyText.split(/\s+/).length <= 2)
                        url = detectedUrl;
                    else
                        rawCode = replyText;
                }
            }
            else if (cleanArgs[cleanArgs.length - 1] && (cleanArgs[cleanArgs.length - 1].endsWith(".ts") || cleanArgs[cleanArgs.length - 1].endsWith(".js"))) {
                const lastArg = cleanArgs[cleanArgs.length - 1];
                fileName = normalizeFileName(lastArg, "cmds");
                const installIdx = event.body.search(/install/i);
                const lastIdx = event.body.lastIndexOf(lastArg);
                if (installIdx !== -1 && lastIdx > installIdx) {
                    rawCode = event.body.slice(installIdx + 7, lastIdx).trim();
                }
            }
            else if (cleanArgs[1] && (cleanArgs[1].endsWith(".ts") || cleanArgs[1].endsWith(".js") || (!cleanArgs[1].includes("\n") && !cleanArgs[1].includes(" ") && !cleanArgs[1].includes("{") && !cleanArgs[1].includes(";")))) {
                fileName = normalizeFileName(cleanArgs[1], "cmds");
                const firstArgIdx = event.body.indexOf(cleanArgs[1], event.body.search(/install/i));
                if (firstArgIdx !== -1) {
                    rawCode = event.body.slice(firstArgIdx + cleanArgs[1].length).trim();
                }
                if (isURL(rawCode)) {
                    url = rawCode;
                    rawCode = "";
                }
            }
            else {
                return message.reply(getLang("missingFileNameInstall"));
            }

            if (!fileName)
                return message.reply(getLang("missingFileNameInstall"));

            if (url) {
                const normalizedUrlInfo = normalizeRawUrl(url);
                if (!normalizedUrlInfo)
                    return message.reply(getLang("invalidUrl"));
                url = normalizedUrlInfo.url;
                const domain = normalizedUrlInfo.domain;
                let res;
                try {
                    res = await axios.get(url, {
                        responseType: "text",
                        timeout: 15000,
                        headers: {
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                            "Accept": "text/plain,text/html,*/*"
                        }
                    });
                }
                catch (error) {
                    return message.reply(`❌ | Failed to download the file: ${error.message}`);
                }
                rawCode = typeof res.data === "string" ? res.data : JSON.stringify(res.data, null, 2);
                if (domain === "savetext.net") {
                    const $ = cheerio.load(rawCode);
                    rawCode = $("#content").text();
                }
            }

            if (!rawCode || !rawCode.trim())
                return message.reply(getLang("invalidUrlOrCode"));

            const existingResolved = resolveScriptPath("cmds", fileName);
            const targetFilePath = existingResolved ? existingResolved.fullPath : path.join(__dirname, fileName);
            const finalFileName = existingResolved ? existingResolved.fileName : fileName;

            if (!forceOverwrite && fs.existsSync(targetFilePath)) {
                const registerReaction = (msgID) => {
                    if (!msgID)
                        return;
                    global.GoatBot.onReaction.set(msgID, {
                        commandName,
                        messageID: msgID,
                        type: "install",
                        author: String(event.senderID || event.userID),
                        data: {
                            fileName: finalFileName,
                            rawCode
                        }
                    });
                };
                const sentInfo = await message.reply(getLang("alreadExist"), (err, info) => {
                    if (info?.messageID)
                        registerReaction(info.messageID);
                });
                if (sentInfo?.messageID)
                    registerReaction(sentInfo.messageID);
                return;
            }

            const infoLoad = loadScripts("cmds", finalFileName, log, configCommands, api, threadModel, userModel, dashBoardModel, globalModel, threadsData, usersData, dashBoardData, globalData, getLang, rawCode);
            return infoLoad.status === "success" ?
                message.reply(getLang("installed", infoLoad.name, path.join("scripts", "cmds", finalFileName))) :
                message.reply(getLang("installedError", infoLoad.name, infoLoad.error.name, infoLoad.error.message));
        }
        else {
            return message.SyntaxError();
        }
    },
    onReaction: async function ({ Reaction, message, event, api, threadModel, userModel, dashBoardModel, globalModel, threadsData, usersData, dashBoardData, globalData, getLang }) {
        const { author, messageID, data: { fileName, rawCode } } = Reaction;
        const reactorID = String(event.userID || event.senderID);
        if (reactorID !== String(author))
            return;
        if (["❌", "🗑️", "🗑"].includes(event.reaction)) {
            if (typeof Reaction.delete === "function")
                Reaction.delete();
            else
                global.GoatBot.onReaction.delete(messageID);
            return;
        }
        if (typeof Reaction.delete === "function")
            Reaction.delete();
        else
            global.GoatBot.onReaction.delete(messageID);
        const { configCommands } = global.GoatBot;
        const { log } = global.utils;
        const infoLoad = loadScripts("cmds", fileName, log, configCommands, api, threadModel, userModel, dashBoardModel, globalModel, threadsData, usersData, dashBoardData, globalData, getLang, rawCode);
        if (messageID && api && typeof api.unsendMessage === "function") {
            try {
                api.unsendMessage(messageID, () => {});
            }
            catch (e) {}
        }
        return infoLoad.status === "success" ?
            message.reply(getLang("installed", infoLoad.name, path.join("scripts", "cmds", fileName))) :
            message.reply(getLang("installedError", infoLoad.name, infoLoad.error.name, infoLoad.error.message));
    }
};

const packageAlready = [];

function loadScripts(folder, fileName, log, configCommands, api, threadModel, userModel, dashBoardModel, globalModel, threadsData, usersData, dashBoardData, globalData, getLang, rawCode) {
    const storageCommandFilesPath = global.GoatBot[folder === "cmds" ? "commandFilesPath" : "eventCommandsFilesPath"];
    const { removeHomeDir } = global.utils;
    let writtenPath = null;
    let previousCode = null;
    let oldCommand = null;

    try {
        let pathCommand;
        let resolvedFileName = fileName;

        if (rawCode) {
            const existing = resolveScriptPath(folder, fileName);
            if (existing) {
                pathCommand = existing.fullPath;
                resolvedFileName = existing.fileName;
            }
            else {
                resolvedFileName = normalizeFileName(fileName, folder);
                pathCommand = path.normalize(`${process.cwd()}/scripts/${folder}/${resolvedFileName}`);
            }
            if (fs.existsSync(pathCommand)) {
                previousCode = fs.readFileSync(pathCommand, "utf8");
                try {
                    const cachedOld = require(pathCommand);
                    oldCommand = cachedOld.default || cachedOld;
                }
                catch (e) {
                    oldCommand = null;
                }
            }
            fs.writeFileSync(pathCommand, rawCode, "utf8");
            writtenPath = pathCommand;
        }
        else {
            const resolved = resolveScriptPath(folder, fileName);
            if (!resolved) {
                const msg = typeof getLang === "function" ? getLang("missingFile", fileName) : `Command file "${fileName}" not found`;
                const err = new Error(msg);
                err.name = "FileNotFound";
                throw err;
            }
            pathCommand = resolved.fullPath;
            resolvedFileName = resolved.fileName;
            try {
                const cachedOld = require(pathCommand);
                oldCommand = cachedOld.default || cachedOld;
            }
            catch (e) {
                oldCommand = null;
            }
        }

        const regExpCheckPackage = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
        const { GoatBot } = global;
        const { onFirstChat: allOnFirstChat, onChat: allOnChat, onEvent: allOnEvent, onAnyEvent: allOnAnyEvent } = GoatBot;
        let setMap, typeEnvCommand, commandType;
        if (folder === "cmds") {
            typeEnvCommand = "envCommands";
            setMap = "commands";
            commandType = "command";
        }
        else {
            typeEnvCommand = "envEvents";
            setMap = "eventCommands";
            commandType = "event command";
        }

        const contentFile = stripComments(fs.readFileSync(pathCommand, "utf8"));
        const allPackageMatches = contentFile.match(regExpCheckPackage);
        if (allPackageMatches) {
            const allPackage = allPackageMatches
                .map(p => {
                    const match = p.match(/['"]([^'"]+)['"]/);
                    return match ? match[1].trim() : "";
                })
                .filter(p => p && !p.startsWith("/") && !p.startsWith("./") && !p.startsWith("../") && !p.includes("${") && p.indexOf(__dirname) !== 0);

            for (let packageName of allPackage) {
                if (packageName.startsWith("node:"))
                    continue;
                if (packageName.startsWith("@"))
                    packageName = packageName.split("/").slice(0, 2).join("/");
                else
                    packageName = packageName.split("/")[0];

                if (!packageName || isPackageInstalled(packageName))
                    continue;

                if (!packageAlready.includes(packageName)) {
                    packageAlready.push(packageName);
                    if (!isPackageInstalled(packageName)) {
                        const isBun = typeof globalThis.Bun !== "undefined";
                        const installCmd = isBun ? `bun add ${packageName}` : `npm install ${packageName} --save`;
                        try {
                            execSync(installCmd, { stdio: "pipe", timeout: 60000 });
                        }
                        catch (error) {
                            throw new Error(`Can't install package ${packageName}`);
                        }
                    }
                }
            }
        }

        try {
            delete require.cache[require.resolve(pathCommand)];
        }
        catch (e) {}
        delete require.cache[pathCommand];

        const commandModule = require(pathCommand);
        const command = commandModule.default || commandModule;
        command.location = pathCommand;
        const configCommand = command?.config;
        if (!configCommand || typeof configCommand !== "object")
            throw new Error(`config of ${commandType} must be an object`);

        const scriptName = configCommand.name;
        if (!scriptName || typeof scriptName !== "string")
            throw new Error(`Name of ${commandType} is missing!`);

        const normalizedScriptName = scriptName.toLowerCase();
        if (!configCommand.category)
            configCommand.category = folder === "cmds" ? "general" : "events";

        if (!command.onStart)
            throw new Error("Function onStart is missing!");
        if (typeof command.onStart !== "function")
            throw new Error("Function onStart must be a function!");

        const existingCmd = GoatBot[setMap].get(normalizedScriptName) || GoatBot[setMap].get(scriptName);
        if (existingCmd && existingCmd.location && path.normalize(existingCmd.location) !== path.normalize(pathCommand)) {
            throw new Error(`${commandType} name "${scriptName}" already exists in "${removeHomeDir(existingCmd.location)}"`);
        }

        const oldCommandName = oldCommand?.config?.name;
        const normalizedOldName = oldCommandName ? String(oldCommandName).toLowerCase() : null;

        if (oldCommand?.config?.aliases) {
            let oldAliases = oldCommand.config.aliases;
            if (typeof oldAliases === "string")
                oldAliases = [oldAliases];
            if (Array.isArray(oldAliases)) {
                for (const alias of oldAliases) {
                    GoatBot.aliases.delete(alias);
                    GoatBot.aliases.delete(String(alias).toLowerCase());
                }
            }
        }

        if (folder === "cmds" && GoatBot.aliases.has(normalizedScriptName)) {
            GoatBot.aliases.delete(normalizedScriptName);
        }
        if (folder === "cmds" && GoatBot.aliases.has(scriptName)) {
            GoatBot.aliases.delete(scriptName);
        }

        const validAliases = [];
        if (configCommand.aliases) {
            let { aliases } = configCommand;
            if (typeof aliases === "string")
                aliases = [aliases];
            if (!Array.isArray(aliases))
                throw new Error("The value of \"config.aliases\" must be an array!");

            const seenAliases = new Set();
            for (const rawAlias of aliases) {
                if (!rawAlias || typeof rawAlias !== "string")
                    continue;
                const alias = rawAlias.trim();
                const lowerAlias = alias.toLowerCase();
                if (!alias || lowerAlias === normalizedScriptName || seenAliases.has(lowerAlias))
                    continue;
                seenAliases.add(lowerAlias);

                const existingTarget = GoatBot.aliases.get(lowerAlias) || GoatBot.aliases.get(alias);
                if (existingTarget && String(existingTarget).toLowerCase() !== normalizedScriptName && String(existingTarget).toLowerCase() !== normalizedOldName) {
                    const ownerCmd = GoatBot[setMap].get(String(existingTarget).toLowerCase()) || GoatBot[setMap].get(existingTarget);
                    if (ownerCmd && ownerCmd.location && path.normalize(ownerCmd.location) !== path.normalize(pathCommand)) {
                        throw new Error(`alias "${alias}" already exists in ${commandType} "${existingTarget}" with file name "${removeHomeDir(ownerCmd.location)}"`);
                    }
                }
                if (GoatBot[setMap].has(lowerAlias) && lowerAlias !== normalizedScriptName && lowerAlias !== normalizedOldName) {
                    const ownerCmd = GoatBot[setMap].get(lowerAlias);
                    if (ownerCmd && ownerCmd.location && path.normalize(ownerCmd.location) !== path.normalize(pathCommand)) {
                        throw new Error(`alias "${alias}" conflicts with existing ${commandType} "${lowerAlias}"`);
                    }
                }
                validAliases.push(alias);
            }
            for (const alias of validAliases) {
                GoatBot.aliases.set(alias.toLowerCase(), normalizedScriptName);
                if (alias !== alias.toLowerCase())
                    GoatBot.aliases.set(alias, normalizedScriptName);
            }
        }

        const namesToMatch = new Set([scriptName, normalizedScriptName]);
        if (oldCommandName) {
            namesToMatch.add(oldCommandName);
            namesToMatch.add(normalizedOldName);
        }

        for (let i = allOnChat.length - 1; i >= 0; i--) {
            if (namesToMatch.has(allOnChat[i]) || namesToMatch.has(String(allOnChat[i]).toLowerCase()))
                allOnChat.splice(i, 1);
        }

        let oldOnFirstChat = null;
        for (let i = allOnFirstChat.length - 1; i >= 0; i--) {
            const itemName = allOnFirstChat[i]?.commandName;
            if (namesToMatch.has(itemName) || namesToMatch.has(String(itemName).toLowerCase())) {
                oldOnFirstChat = allOnFirstChat[i];
                allOnFirstChat.splice(i, 1);
            }
        }

        for (let i = allOnEvent.length - 1; i >= 0; i--) {
            if (namesToMatch.has(allOnEvent[i]) || namesToMatch.has(String(allOnEvent[i]).toLowerCase()))
                allOnEvent.splice(i, 1);
        }

        for (let i = allOnAnyEvent.length - 1; i >= 0; i--) {
            if (namesToMatch.has(allOnAnyEvent[i]) || namesToMatch.has(String(allOnAnyEvent[i]).toLowerCase()))
                allOnAnyEvent.splice(i, 1);
        }

        if (command.onLoad && typeof command.onLoad === "function") {
            Promise.resolve(command.onLoad({ api, threadModel, userModel, dashBoardModel, globalModel, threadsData, usersData, dashBoardData, globalData }))
                .catch(err => log.err("ONLOAD", `Error in onLoad of ${scriptName}`, err));
        }

        const { envGlobal, envConfig } = configCommand;
        if (envGlobal) {
            if (typeof envGlobal !== "object" || Array.isArray(envGlobal))
                throw new Error("envGlobal must be an object");
            if (!configCommands.envGlobal)
                configCommands.envGlobal = {};
            for (const key in envGlobal) {
                if (configCommands.envGlobal[key] === undefined)
                    configCommands.envGlobal[key] = envGlobal[key];
            }
        }
        if (envConfig && typeof envConfig === "object" && !Array.isArray(envConfig)) {
            if (!configCommands[typeEnvCommand])
                configCommands[typeEnvCommand] = {};
            if (!configCommands[typeEnvCommand][scriptName])
                configCommands[typeEnvCommand][scriptName] = {};
            configCommands[typeEnvCommand][scriptName] = {
                ...envConfig,
                ...configCommands[typeEnvCommand][scriptName]
            };
        }

        if (oldCommandName) {
            GoatBot[setMap].delete(oldCommandName);
            GoatBot[setMap].delete(normalizedOldName);
        }
        GoatBot[setMap].delete(scriptName);
        GoatBot[setMap].set(normalizedScriptName, command);

        const keyUnloadCommand = folder === "cmds" ? "commandUnload" : "commandEventUnload";
        const unloadList = configCommands[keyUnloadCommand] || [];
        const baseName = resolvedFileName.replace(/\.(ts|js)$/i, "");
        configCommands[keyUnloadCommand] = unloadList.filter(
            item => item !== resolvedFileName && item !== `${baseName}.js` && item !== `${baseName}.ts` && item !== baseName
        );
        fs.writeFileSync(global.client.dirConfigCommands, JSON.stringify(configCommands, null, 2));

        if (command.onChat)
            allOnChat.push(normalizedScriptName);
        if (command.onFirstChat)
            allOnFirstChat.push({ commandName: normalizedScriptName, threadIDsChattedFirstTime: oldOnFirstChat?.threadIDsChattedFirstTime || [] });
        if (command.onEvent)
            allOnEvent.push(normalizedScriptName);
        if (command.onAnyEvent)
            allOnAnyEvent.push(normalizedScriptName);

        const indexStorageCommandFilesPath = storageCommandFilesPath.findIndex(item => path.normalize(item.filePath) === path.normalize(pathCommand));
        if (indexStorageCommandFilesPath !== -1)
            storageCommandFilesPath.splice(indexStorageCommandFilesPath, 1);
        storageCommandFilesPath.push({
            filePath: pathCommand,
            commandName: [normalizedScriptName, ...validAliases]
        });

        if (global.temp?.contentScripts?.[folder]) {
            global.temp.contentScripts[folder][resolvedFileName] = fs.readFileSync(pathCommand, "utf8");
        }

        return {
            status: "success",
            name: resolvedFileName,
            command
        };
    }
    catch (err) {
        if (writtenPath) {
            try {
                if (previousCode !== null)
                    fs.writeFileSync(writtenPath, previousCode, "utf8");
                else if (fs.existsSync(writtenPath))
                    fs.unlinkSync(writtenPath);
                delete require.cache[require.resolve(writtenPath)];
            }
            catch (e) {}
            delete require.cache[writtenPath];
        }
        if (oldCommand?.config?.aliases) {
            const restoredName = String(oldCommand.config.name || "").toLowerCase();
            const oldAliases = Array.isArray(oldCommand.config.aliases) ? oldCommand.config.aliases : [oldCommand.config.aliases];
            for (const alias of oldAliases) {
                if (alias && restoredName)
                    global.GoatBot.aliases.set(String(alias).toLowerCase(), restoredName);
            }
        }
        const defaultError = new Error();
        defaultError.name = err.name || "Error";
        defaultError.message = err.message || String(err);
        defaultError.stack = err.stack;
        if (err.stack)
            err.stack = removeHomeDir(err.stack || "");
        try {
            fs.writeFileSync(global.client.dirConfigCommands, JSON.stringify(configCommands, null, 2));
        }
        catch (e) {}
        return {
            status: "failed",
            name: fileName,
            error: err,
            errorWithThoutRemoveHomeDir: defaultError
        };
    }
}

function unloadScripts(folder, fileName, configCommands, getLang) {
    try {
        const resolved = resolveScriptPath(folder, fileName);
        if (!resolved) {
            const msg = typeof getLang === "function" ? getLang("missingFile", fileName) : `Command file "${fileName}" not found`;
            const err = new Error(msg);
            err.name = "FileNotFound";
            throw err;
        }
        const pathCommand = resolved.fullPath;
        const resolvedFileName = resolved.fileName;
        let commandModule = require(pathCommand);
        const command = commandModule.default || commandModule;
        const commandName = command?.config?.name;
        if (!commandName) {
            const msg = typeof getLang === "function" ? getLang("invalidFileName", resolvedFileName) : `Invalid command file name "${resolvedFileName}"`;
            throw new Error(msg);
        }
        const normalizedName = String(commandName).toLowerCase();
        const { GoatBot } = global;
        const { onChat: allOnChat, onFirstChat: allOnFirstChat, onEvent: allOnEvent, onAnyEvent: allOnAnyEvent } = GoatBot;

        for (let i = allOnChat.length - 1; i >= 0; i--) {
            if (allOnChat[i] === commandName || String(allOnChat[i]).toLowerCase() === normalizedName)
                allOnChat.splice(i, 1);
        }
        for (let i = allOnFirstChat.length - 1; i >= 0; i--) {
            if (allOnFirstChat[i]?.commandName === commandName || String(allOnFirstChat[i]?.commandName).toLowerCase() === normalizedName)
                allOnFirstChat.splice(i, 1);
        }
        for (let i = allOnEvent.length - 1; i >= 0; i--) {
            if (allOnEvent[i] === commandName || String(allOnEvent[i]).toLowerCase() === normalizedName)
                allOnEvent.splice(i, 1);
        }
        for (let i = allOnAnyEvent.length - 1; i >= 0; i--) {
            if (allOnAnyEvent[i] === commandName || String(allOnAnyEvent[i]).toLowerCase() === normalizedName)
                allOnAnyEvent.splice(i, 1);
        }

        if (command.config?.aliases) {
            let aliases = command.config.aliases;
            if (typeof aliases === "string")
                aliases = [aliases];
            if (Array.isArray(aliases)) {
                for (const alias of aliases) {
                    GoatBot.aliases.delete(alias);
                    GoatBot.aliases.delete(String(alias).toLowerCase());
                }
            }
        }
        const setMap = folder === "cmds" ? "commands" : "eventCommands";
        try {
            delete require.cache[require.resolve(pathCommand)];
        }
        catch (e) {}
        delete require.cache[pathCommand];
        GoatBot[setMap].delete(commandName);
        GoatBot[setMap].delete(normalizedName);
        if (global.utils?.log?.master && typeof getLang === "function") {
            global.utils.log.master("UNLOADED", getLang("unloaded", commandName));
        }
        const keyUnloadCommand = folder === "cmds" ? "commandUnload" : "commandEventUnload";
        const commandUnload = configCommands[keyUnloadCommand] || [];
        if (!commandUnload.includes(resolvedFileName))
            commandUnload.push(resolvedFileName);
        configCommands[keyUnloadCommand] = commandUnload;
        fs.writeFileSync(global.client.dirConfigCommands, JSON.stringify(configCommands, null, 2));
        return {
            status: "success",
            name: resolvedFileName
        };
    }
    catch (err) {
        return {
            status: "failed",
            name: fileName,
            error: err
        };
    }
}

global.utils.loadScripts = loadScripts;
global.utils.unloadScripts = unloadScripts;