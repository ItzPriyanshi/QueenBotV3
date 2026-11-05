const { readdirSync, readFileSync, writeFileSync, existsSync } = require("fs-extra");
const path = require("path");
const { exec: childExec } = require("child_process");

const exec = (cmd: string, options?: any) => new Promise((resolve, reject) => {
	childExec(cmd, options, (err: any, stdout: any) => {
		if (err)
			return reject(err);
		resolve(stdout);
	});
});

const spinner = [
	"⠋", "⠙", "⠹",
	"⠸", "⠼", "⠴",
	"⠦", "⠧", "⠇",
	"⠏"
];
let count = 0;

function stripCodeComments(code: string): string {
	return code.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => g ? "" : m);
}

async function loadScripts(api: any, threadModel: any, userModel: any, dashBoardModel: any, globalModel: any, threadsData: any, usersData: any, dashBoardData: any, globalData: any, createLine: any) {
	const { log, loading, getText, colors, removeHomeDir } = (global as any).utils;
	const { GoatBot } = global as any;
	const { configCommands } = GoatBot;
	const regExpCheckPackage = /require\s*\(\s*[`'"]([^`'"]+)[`'"]\s*\)/g;
	const packageAlready: string[] = [];

	const aliasesData = await globalData.get("setalias", "data", []);
	if (aliasesData) {
		for (const data of aliasesData) {
			const { aliases, commandName } = data;
			if (!Array.isArray(aliases) || !commandName)
				continue;
			const targetCmd = String(commandName).toLowerCase();
			for (const alias of aliases) {
				const normalizedAlias = String(alias).toLowerCase();
				if (!GoatBot.aliases.has(normalizedAlias)) {
					GoatBot.aliases.set(normalizedAlias, targetCmd);
				}
			}
		}
	}
	const folders = ["cmds", "events"];
	let text: string, setMap: string, typeEnvCommand: string;

	for (const folderModules of folders) {
		const makeColor = folderModules == "cmds" ?
			createLine("LOAD COMMANDS") :
			createLine("LOAD COMMANDS EVENT");
		console.log(colors.hex("#f5ab00")(makeColor));

		if (folderModules == "cmds") {
			text = "command";
			typeEnvCommand = "envCommands";
			setMap = "commands";
		}
		else {
			text = "event command";
			typeEnvCommand = "envEvents";
			setMap = "eventCommands";
		}

		const fullPathModules = path.normalize(process.cwd() + `/scripts/${folderModules}`);
		if (!existsSync(fullPathModules))
			continue;

		const Files = readdirSync(fullPathModules)
			.filter((file: string) =>
				(file.endsWith(".js") || file.endsWith(".ts")) &&
				!file.endsWith("eg.js") && !file.endsWith("eg.ts") &&
				(process.env.NODE_ENV == "development" ? true : !file.match(/(dev)\.(js|ts)$/g)) &&
				!configCommands[folderModules == "cmds" ? "commandUnload" : "commandEventUnload"]?.includes(file)
			);

		const commandError: any[] = [];
		let commandLoadSuccess = 0;

		for (const file of Files) {
			const pathCommand = path.normalize(fullPathModules + "/" + file);
			try {
				const contentFile = readFileSync(pathCommand, "utf8");
				const uncommentedContent = stripCodeComments(contentFile);
				const allPackageMatches = uncommentedContent.match(regExpCheckPackage);
				if (allPackageMatches) {
					const allPackage = allPackageMatches.map((p: string) => {
						const m = p.match(/[`'"]([^`'"]+)[`'"]/);
						return m ? m[1].trim() : "";
					})
						.filter((p: string) =>
							p &&
							!p.includes("${") &&
							!/\s/.test(p) &&
							p.indexOf("/") !== 0 &&
							p.indexOf("./") !== 0 &&
							p.indexOf("../") !== 0 &&
							p.indexOf(__dirname) !== 0
						);
					for (let packageName of allPackage) {
						if (packageName.startsWith("node:"))
							continue;
						if (packageName.startsWith("@"))
							packageName = packageName.split("/").slice(0, 2).join("/");
						else
							packageName = packageName.split("/")[0];

						if (require("module").isBuiltin(packageName))
							continue;
						if (!packageAlready.includes(packageName)) {
							packageAlready.push(packageName);
							if (!existsSync(`${process.cwd()}/node_modules/${packageName}`)) {
								const wating = setInterval(() => {
									loading.info("PACKAGE", `${spinner[count % spinner.length]} Installing package ${colors.yellow(packageName)} for ${text} ${colors.yellow(file)}`);
									count++;
								}, 80);
								try {
									const isBun = (typeof process !== "undefined" && Boolean(process.versions && process.versions.bun)) || typeof (globalThis as any).Bun !== "undefined";
									const installCmd = isBun ? `bun add ${packageName}` : `npm install ${packageName} --save`;
									await exec(installCmd);
									clearInterval(wating);
									process.stderr.write("\r\x1b[K");
									console.log(`${colors.green("✔")} installed package ${packageName} successfully`);
								}
								catch (err) {
									clearInterval(wating);
									process.stderr.write("\r\x1b[K");
									console.log(`${colors.red("✖")} installed package ${packageName} failed`);
									throw new Error(`Can't install package ${packageName}`);
								}
							}
						}
					}
				}

				(global as any).temp.contentScripts[folderModules][file] = contentFile;

				try {
					delete require.cache[require.resolve(pathCommand)];
				}
				catch (e) {
				}
				const commandModule = require(pathCommand);
				const command = commandModule.default || commandModule;
				command.location = pathCommand;
				const configCommand = command.config;
				const rawCommandName = configCommand ? configCommand.name : undefined;

				if (!configCommand)
					throw new Error(`config of ${text} undefined`);
				if (!rawCommandName || typeof rawCommandName !== "string")
					throw new Error(`name of ${text} undefined`);
				if (!configCommand.category)
					configCommand.category = folderModules == "cmds" ? "uncategorized" : "events";
				if (!command.onStart)
					throw new Error(`onStart of ${text} undefined`);
				if (typeof command.onStart !== "function")
					throw new Error(`onStart of ${text} must be a function`);

				const commandName = rawCommandName.trim().toLowerCase();
				configCommand.name = commandName;

				if (GoatBot[setMap].has(commandName))
					throw new Error(`${text} "${commandName}" already exists with file "${removeHomeDir(GoatBot[setMap].get(commandName).location || "")}"`);

				const { onFirstChat, onChat, onLoad, onEvent, onAnyEvent } = command;
				const { envGlobal, envConfig } = configCommand;
				const { aliases } = configCommand;

				const validAliases: string[] = [];
				if (aliases) {
					if (!Array.isArray(aliases))
						throw new Error("The value of \"config.aliases\" must be array!");
					const seenInSelf = new Set<string>();
					for (const rawAlias of aliases) {
						if (!rawAlias || typeof rawAlias !== "string")
							continue;
						const alias = rawAlias.trim().toLowerCase();
						if (!alias || alias === commandName || seenInSelf.has(alias))
							continue;
						seenInSelf.add(alias);
						if (GoatBot.aliases.has(alias) || GoatBot[setMap].has(alias))
							continue;
						validAliases.push(alias);
					}
					for (const alias of validAliases)
						GoatBot.aliases.set(alias, commandName);
				}

				if (envGlobal) {
					if (typeof envGlobal != "object" || (typeof envGlobal == "object" && Array.isArray(envGlobal)))
						throw new Error("the value of \"envGlobal\" must be object");
					if (!configCommands.envGlobal)
						configCommands.envGlobal = {};
					for (const i in envGlobal) {
						if (!configCommands.envGlobal[i]) {
							configCommands.envGlobal[i] = envGlobal[i];
						}
						else {
							const readCommand = readFileSync(pathCommand, "utf-8").replace(envGlobal[i], configCommands.envGlobal[i]);
							writeFileSync(pathCommand, readCommand);
						}
					}
				}

				if (envConfig) {
					if (typeof envConfig != "object" || (typeof envConfig == "object" && Array.isArray(envConfig)))
						throw new Error("The value of \"envConfig\" must be object");
					if (!configCommands[typeEnvCommand])
						configCommands[typeEnvCommand] = {};
					if (!configCommands[typeEnvCommand][commandName])
						configCommands[typeEnvCommand][commandName] = {};
					for (const [key, value] of Object.entries(envConfig)) {
						if (!configCommands[typeEnvCommand][commandName][key])
							configCommands[typeEnvCommand][commandName][key] = value;
						else {
							const readCommand = readFileSync(pathCommand, "utf-8").replace(value as any, configCommands[typeEnvCommand][commandName][key]);
							writeFileSync(pathCommand, readCommand);
						}
					}
				}

				if (onLoad) {
					if (typeof onLoad != "function")
						throw new Error("The value of \"onLoad\" must be function");
					await onLoad({ api, threadModel, userModel, dashBoardModel, globalModel, threadsData, usersData, dashBoardData, globalData });
				}

				if (onChat)
					GoatBot.onChat.push(commandName);
				if (onFirstChat)
					GoatBot.onFirstChat.push({ commandName, threadIDsChattedFirstTime: [] });
				if (onEvent)
					GoatBot.onEvent.push(commandName);
				if (onAnyEvent)
					GoatBot.onAnyEvent.push(commandName);

				GoatBot[setMap].set(commandName, command);
				commandLoadSuccess++;

				(global as any).GoatBot[folderModules == "cmds" ? "commandFilesPath" : "eventCommandsFilesPath"].push({
					filePath: path.normalize(pathCommand),
					commandName: [commandName, ...validAliases]
				});
			}
			catch (error: any) {
				commandError.push({
					name: file,
					error
				});
			}
			loading.info("LOADED", `${colors.green(`${commandLoadSuccess}`)}${commandError.length ? `, ${colors.red(`${commandError.length}`)}` : ""}`);
		}
		console.log("\r");
		if (commandError.length > 0) {
			log.err("LOADED", getText("loadScripts", "loadScriptsError", colors.yellow(text)));
			for (const item of commandError)
				console.log(` ${colors.red("✖ " + item.name)}: ${item.error.message}\n`, item.error);
		}
	}
}

module.exports = loadScripts;