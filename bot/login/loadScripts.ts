const { readdirSync, readFileSync, writeFileSync, existsSync } = require("fs-extra");
const path = require("path");
const exec = (cmd, options) => new Promise((resolve, reject) => {
	require("child_process").exec(cmd, options, (err, stdout) => {
		if (err) return reject(err);
		resolve(stdout);
	});
});
const { log, loading, removeHomeDir, colors: Color } = global.utils;
const { GoatBot } = global;
const regExpCheckPackage = /require(\s+|)\((\s+|)[`'"]([^`'"]+)[`'"](\s+|)\)/g;
const packageAlready = [];
const spinner = "\\|/-";
let count = 0;

function syncQueenAiTools() {
	try {
		if (global.QueenAI && typeof global.QueenAI.syncTools === "function") {
			global.QueenAI.syncTools();
			return;
		}
		const candidates = [
			path.join(__dirname, "..", "ai", "toolRegistry"),
			path.join(process.cwd(), "bot", "ai", "toolRegistry")
		];
		for (const c of candidates) {
			try {
				const reg = require(c);
				if (reg && typeof reg.syncCommandTools === "function") {
					reg.syncCommandTools();
					break;
				}
			}
			catch {
			}
		}
	}
	catch {
	}
}

function stripCommentsForScan(code) {
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
				while (i < s.length && s[i] !== "\n") i++;
				out += "\n";
				continue;
			}
			if (ch === "/" && next === "*") {
				i += 2;
				while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) i++;
				i++;
				continue;
			}
		}
		out += ch;
	}
	return out;
}

module.exports = async function (
	api,
	threadModel,
	userModel,
	dashBoardModel,
	globalModel,
	threadsData,
	usersData,
	dashBoardData,
	globalData,
	createLine
) {
	const aliasesData = await globalData.get("setalias", "data", []);
	if (aliasesData) {
		for (const data of aliasesData) {
			const { aliases, commandName } = data;
			for (const alias of aliases) {
				if (GoatBot.aliases.has(alias)) {
					continue;
				}
				else {
					GoatBot.aliases.set(alias, commandName);
				}
			}
		}
	}

	const folders = ["cmds", "events"];
	let text, setMap, typeEnvCommand;

	for (const folderModules of folders) {
		const makeColor =
			folderModules === "cmds"
				? createLine("LOAD COMMANDS")
				: createLine("LOAD COMMANDS EVENT");
		console.log(Color.hex("#f5ab00")(makeColor));

		if (folderModules === "cmds") {
			text = "command";
			typeEnvCommand = "envCommands";
			setMap = "commands";
		}
		else if (folderModules === "events") {
			text = "event command";
			typeEnvCommand = "envEvents";
			setMap = "eventCommands";
		}

		const fullPathModules = path.resolve(process.cwd(), "scripts", folderModules);
		const Files = readdirSync(fullPathModules).filter(
			file =>
				(file.endsWith(".js") || file.endsWith(".ts")) &&
				!file.endsWith(".eg.js") &&
				!file.endsWith(".eg.ts") &&
				!file.endsWith(".compiled.js") &&
				!global.GoatBot.config.commandUnload?.includes(file)
		);

		const commandError = [];
		let commandLoadSuccess = 0;

		for (const file of Files) {
			const pathCommand = path.resolve(fullPathModules, file);
			try {
				const contentFile = stripCommentsForScan(readFileSync(pathCommand, "utf8"));
				let allPackage = contentFile.match(regExpCheckPackage);
				if (allPackage) {
					allPackage = allPackage.map(p => p.match(/[`'"]([^`'"]+)[`'"]/)[1]);
					for (let packageName of allPackage) {
						if (packageName.startsWith("@")) {
							packageName = packageName.split("/").slice(0, 2).join("/");
						}
						else {
							packageName = packageName.split("/")[0];
						}

						if (!packageAlready.includes(packageName)) {
							packageAlready.push(packageName);
							if (
								!existsSync(`${process.cwd()}/node_modules/${packageName}`) &&
								!process.binding("natives")[packageName] &&
								!packageName.startsWith(".") &&
								!packageName.startsWith("/")
							) {
								const w = setInterval(() => {
									loading.info(
										"INSTALL PACKAGE",
										`${spinner[count % spinner.length]} Installing package ${packageName} for ${text} ${file}`
									);
									count++;
								}, 80);
								try {
									const isBun = typeof process !== "undefined" && Boolean(process.versions && process.versions.bun);
									const installCmd = isBun ? `bun add ${packageName}` : `npm install ${packageName} --save`;
									await exec(installCmd);
									clearInterval(w);
									process.stdout.write("\r\x1b[K");
									log.info("INSTALL PACKAGE", `Installed package ${packageName} successfully`);
								}
								catch (err) {
									clearInterval(w);
									process.stdout.write("\r\x1b[K");
									log.err("INSTALL PACKAGE", `Can't install package ${packageName}`);
									throw err;
								}
							}
						}
					}
				}

				const resolvedCommandPath = require.resolve(pathCommand);
				if (require.cache[resolvedCommandPath]) {
					delete require.cache[resolvedCommandPath];
				}
				const command = require(pathCommand);
				command.location = pathCommand;
				const configCommand = command.config;
				if (!configCommand) {
					throw new Error(`config of ${text} undefined`);
				}
				if (!configCommand.category) {
					configCommand.category = "other";
				}

				const scriptType = command.config.countDown ? "command" : "command event";
				if (!configCommand.name) {
					throw new Error(`name of ${scriptType} undefined`);
				}

				const commandName = String(configCommand.name).trim();
				const lowerCommandName = commandName.toLowerCase();

				if (!command.onStart) {
					throw new Error(`onStart of ${scriptType} undefined`);
				}
				if (typeof command.onStart !== "function") {
					throw new Error(`onStart of ${scriptType} must be a function`);
				}
				if (GoatBot[setMap].has(lowerCommandName) || GoatBot[setMap].has(commandName)) {
					throw new Error(`${scriptType} "${commandName}" already exists with other file "${removeHomeDir(GoatBot[setMap].get(lowerCommandName)?.location || GoatBot[setMap].get(commandName)?.location || "")}"`);
				}

				const { onFirstChat, onChat, onLoad, onEvent, onAnyEvent } = command;
				const { envGlobal, envConfig } = configCommand;
				const { aliases } = configCommand;
				const validAliases = [];

				if (aliases) {
					if (!Array.isArray(aliases)) {
						throw new Error("The value of \"config.aliases\" must be array!");
					}
					for (const alias of aliases) {
						const cleanAlias = String(alias || "").trim().toLowerCase();
						if (!cleanAlias) continue;
						if (aliases.filter(item => String(item || "").trim().toLowerCase() === cleanAlias).length > 1) {
							continue;
						}
						if (GoatBot.aliases.has(cleanAlias)) {
							continue;
						}
						validAliases.push(cleanAlias);
					}
					for (const alias of validAliases) {
						GoatBot.aliases.set(alias, lowerCommandName);
					}
				}

				if (onLoad) {
					await onLoad({
						api,
						threadModel,
						userModel,
						dashBoardModel,
						globalModel,
						threadsData,
						usersData,
						dashBoardData,
						globalData
					});
				}

				if (onChat) {
					if (!GoatBot.onChat.includes(lowerCommandName)) {
						GoatBot.onChat.push(lowerCommandName);
					}
				}
				if (onFirstChat) {
					GoatBot.onFirstChat.push({ commandName: lowerCommandName, threadIDsChattedFirstTime: [] });
				}
				if (onEvent) {
					if (!GoatBot.onEvent.includes(lowerCommandName)) {
						GoatBot.onEvent.push(lowerCommandName);
					}
				}
				if (onAnyEvent) {
					if (!GoatBot.onAnyEvent.includes(lowerCommandName)) {
						GoatBot.onAnyEvent.push(lowerCommandName);
					}
				}

				GoatBot[setMap].set(lowerCommandName, command);
				commandLoadSuccess++;
				global.GoatBot[folderModules === "cmds" ? "commandFilesPath" : "eventCommandsFilesPath"].push({
					filePath: path.normalize(pathCommand),
					commandName: [lowerCommandName, ...validAliases]
				});

				if (envGlobal) {
					if (typeof envGlobal !== "object" || Array.isArray(envGlobal)) {
						throw new Error("The value of \"envGlobal\" must be object");
					}
					for (const i in envGlobal) {
						if (!GoatBot.configCommands.envGlobal[i]) {
							GoatBot.configCommands.envGlobal[i] = envGlobal[i];
						}
					}
				}

				if (envConfig && typeof envConfig === "object" && !Array.isArray(envConfig)) {
					if (!GoatBot.configCommands[typeEnvCommand][lowerCommandName]) {
						GoatBot.configCommands[typeEnvCommand][lowerCommandName] = {};
					}
					for (const [key, value] of Object.entries(envConfig)) {
						if (!GoatBot.configCommands[typeEnvCommand][lowerCommandName][key]) {
							GoatBot.configCommands[typeEnvCommand][lowerCommandName][key] = value;
						}
					}
				}

				process.stdout.write("\r\x1b[K");
				loading.info(
					"LOADED",
					`${Color.green(`${spinner[count % spinner.length]} Loaded ${text}`)} "${commandName}" (${file})`
				);
				count++;
			}
			catch (error) {
				commandError.push({ name: file, error });
			}
		}

		process.stdout.write("\r\x1b[K");
		if (commandLoadSuccess) {
			log.info(
				"LOADED",
				`Loaded ${Color.yellow(commandLoadSuccess)} ${text}(s) successfully`
			);
		}
		if (commandError.length > 0) {
			log.err("LOADED", `Failed to load ${Color.yellow(commandError.length)} ${text}(s):`);
			for (const item of commandError) {
				console.log(` ${Color.red("✖ " + item.name)}: ${item.error.stack ? removeHomeDir(item.error.stack) : item.error.message}`);
			}
		}
	}

	const targetConfigCommands = global.client?.dirConfigCommands || path.join(process.cwd(), "configCommands.json");
	writeFileSync(targetConfigCommands, JSON.stringify(GoatBot.configCommands, null, 2));
	syncQueenAiTools();
};