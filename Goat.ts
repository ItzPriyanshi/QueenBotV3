process.on("unhandledRejection", (error: any) => console.log(error));
process.on("uncaughtException", (error: any) => console.log(error));

import fs from "fs-extra";
import path from "path";
import { Elysia } from "elysia";
import log from "./logger/log.js";

process.env.BLUEBIRD_W_FORGOTTEN_RETURN = "0";

const PORT = Number(process.env.PORT) || 3000;

new Elysia()
        .get("/", () => ({ status: "ok", uptime: process.uptime() }))
        .get("/health", () => "OK")
        .listen({ port: PORT, hostname: "0.0.0.0" }, () => {
                log.info("SERVER", `Listening on port ${PORT}`);
        });

function validJSON(pathDir: string): boolean {
        try {
                if (!fs.existsSync(pathDir)) {
                        throw new Error(`File "${pathDir}" not found`);
                }
                JSON.parse(fs.readFileSync(pathDir, "utf-8"));
                return true;
        } catch (err: any) {
                throw new Error(err.message || String(err));
        }
}

const { NODE_ENV } = process.env;
const suffix = ["production", "development"].includes(NODE_ENV || "") ? ".dev" : "";
const dirConfig = path.normalize(`${__dirname}/config${suffix}.json`);
const dirConfigCommands = path.normalize(`${__dirname}/configCommands${suffix}.json`);
const dirAccount = path.normalize(`${__dirname}/account${suffix}.txt`);

for (const pathDir of [dirConfig, dirConfigCommands]) {
        try {
                validJSON(pathDir);
        } catch (err: any) {
                log.error("CONFIG", `Invalid JSON file "${pathDir.replace(__dirname, "")}":\n  ${err.message}\nPlease fix it and restart bot`);
                process.exit(0);
        }
}

const config = require(dirConfig);
if (Array.isArray(config.whiteListMode?.whiteListIds)) {
        config.whiteListMode.whiteListIds = config.whiteListMode.whiteListIds.map((id: any) => id.toString());
}
const configCommands = require(dirConfigCommands);

const g = global as any;

g.GoatBot = {
        startTime: Date.now() - process.uptime() * 1000,
        commands: new Map(),
        eventCommands: new Map(),
        commandFilesPath: [],
        eventCommandsFilesPath: [],
        aliases: new Map(),
        onFirstChat: [],
        onChat: [],
        onEvent: [],
        onReply: new Map(),
        onReaction: new Map(),
        onAnyEvent: [],
        config,
        configCommands,
        envCommands: {},
        envEvents: {},
        envGlobal: {},
        reLoginBot: function () { },
        Listening: null,
        oldListening: [],
        callbackListenTime: {},
        storage5Message: [],
        fcaApi: null,
        botID: null
};

g.db = {
        allThreadData: [],
        allUserData: [],
        allDashBoardData: [],
        allGlobalData: [],
        threadModel: null,
        userModel: null,
        dashboardModel: null,
        globalModel: null,
        threadsData: null,
        usersData: null,
        dashBoardData: null,
        globalData: null,
        receivedTheFirstMessage: {}
};

g.client = {
        dirConfig,
        dirConfigCommands,
        dirAccount,
        countDown: {},
        cache: {},
        database: {
                creatingThreadData: [],
                creatingUserData: [],
                creatingDashBoardData: [],
                creatingGlobalData: []
        },
        commandBanned: configCommands.commandBanned || {}
};

const utilsModule = require("./utils");
const utils = utilsModule.default || utilsModule;
g.utils = utils;

g.temp = {
        createThreadData: [],
        createUserData: [],
        createThreadDataError: (() => {
                const s = new Set();
                (s as any).includes = (x: any) => s.has(x);
                return s;
        })(),
        filesOfGoogleDrive: {
                arraybuffer: {},
                stream: {},
                fileNames: {}
        },
        contentScripts: {
                cmds: {},
                events: {}
        }
};

const watchAndReloadConfig = (dir: string, prop: string, logName: string) => {
        let lastModified = fs.statSync(dir).mtimeMs;
        let isFirstModified = true;

        fs.watch(dir, (eventType: string) => {
                if (eventType !== "change") return;

                const oldConfig = g.GoatBot[prop];
                setTimeout(() => {
                        try {
                                if (isFirstModified) {
                                        isFirstModified = false;
                                        return;
                                }
                                if (lastModified === fs.statSync(dir).mtimeMs) return;

                                g.GoatBot[prop] = JSON.parse(fs.readFileSync(dir, "utf-8"));
                                log.success(logName, `Reloaded ${dir.replace(process.cwd(), "")}`);
                        } catch {
                                log.warn(logName, `Can't reload ${dir.replace(process.cwd(), "")}`);
                                g.GoatBot[prop] = oldConfig;
                        } finally {
                                lastModified = fs.statSync(dir).mtimeMs;
                        }
                }, 200);
        });
};

watchAndReloadConfig(dirConfigCommands, "configCommands", "CONFIG COMMANDS");
watchAndReloadConfig(dirConfig, "config", "CONFIG");

g.GoatBot.envGlobal = g.GoatBot.configCommands.envGlobal;
g.GoatBot.envCommands = g.GoatBot.configCommands.envCommands;
g.GoatBot.envEvents = g.GoatBot.configCommands.envEvents;

const getText = g.utils.getText;

if (config.autoRestart) {
        const time = config.autoRestart.time;
        if (!isNaN(time) && time > 0) {
                utils.log.info("AUTO RESTART", getText("Goat", "autoRestart1", utils.convertTime(time, true)));
                setTimeout(() => {
                        utils.log.info("AUTO RESTART", "Restarting...");
                        process.exit(2);
                }, time);
        } else if (typeof time === "string" && time.match(/^((((\d+,)+\d+|(\d+(\/|-|#)\d+)|\d+L?|\*(\/\d+)?|L(-\d+)?|\?|[A-Z]{3}(-[A-Z]{3})?) ?){5,7})$/gmi)) {
                utils.log.info("AUTO RESTART", getText("Goat", "autoRestart2", time));
                const cron = require("node-cron");
                cron.schedule(time, () => {
                        utils.log.info("AUTO RESTART", "Restarting...");
                        process.exit(2);
                });
        }
}

(async () => {
        const loginScriptPath = fs.existsSync(path.join(__dirname, "bot", "login", "login.ts"))
                ? "./bot/login/login.ts"
                : `./bot/login/login${NODE_ENV === "development" ? ".dev.js" : ".js"}`;
        require(loginScriptPath);
})();
