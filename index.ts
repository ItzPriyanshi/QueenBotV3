import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import log from "./logger/log.js";

const isBun = typeof (globalThis as any).Bun !== "undefined" || Boolean((process as any).versions?.bun);
const MAX_CRASHES = 10;
const STABLE_MS = 60000;
const BASE_DELAY_MS = 3000;
const MAX_DELAY_MS = 60000;

let crashes = 0;
let startedAt = 0;
let activeChild: ChildProcess | null = null;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let isShuttingDown = false;

function resolveRunnerConfig(): { runtimeCmd: string; runnerArgs: string[] } {
	const tsEntry = path.join(__dirname, "Queen.ts");
	const jsEntry = path.join(__dirname, "Queen.js");

	if (isBun) {
		const target = fs.existsSync(tsEntry) ? "Queen.ts" : "Queen.js";
		return {
			runtimeCmd: "bun",
			runnerArgs: ["run", target]
		};
	}

	if (fs.existsSync(jsEntry)) {
		return {
			runtimeCmd: process.execPath,
			runnerArgs: ["Queen.js"]
		};
	}

	return {
		runtimeCmd: process.execPath,
		runnerArgs: ["Queen.ts"]
	};
}

function start(message?: string, delay = 0): void {
	if (restartTimer) {
		clearTimeout(restartTimer);
		restartTimer = null;
	}

	restartTimer = setTimeout(() => {
		if (isShuttingDown) {
			return;
		}

		if (message) {
			log.info("START", message);
		}

		const { runtimeCmd, runnerArgs } = resolveRunnerConfig();
		startedAt = Date.now();

		const child: ChildProcess = spawn(runtimeCmd, runnerArgs, {
			cwd: __dirname,
			stdio: "inherit",
			shell: process.platform === "win32",
			env: { ...process.env }
		});

		activeChild = child;

		child.on("close", (code: number | null, signal: string | null) => {
			if (activeChild === child) {
				activeChild = null;
			}

			if (isShuttingDown) {
				return;
			}

			if (code === 2) {
				crashes = 0;
				start("Restarting QueenBot v3...");
				return;
			}

			if (code === 0) {
				return;
			}

			if (Date.now() - startedAt > STABLE_MS) {
				crashes = 0;
			}

			crashes++;

			if (crashes > MAX_CRASHES) {
				log.err("ERROR", `Bot crashed ${MAX_CRASHES} times in a row, giving up`);
				process.exit(1);
			}

			const wait = Math.min(BASE_DELAY_MS * 2 ** (crashes - 1), MAX_DELAY_MS);
			start(`Bot exited (${code ?? signal}), restarting in ${wait}ms (${crashes}/${MAX_CRASHES})...`, wait);
		});

		child.on("error", (error: Error) => {
			log.err("ERROR", "An error occurred:", error);
		});
	}, delay);
}

function shutdownGracefully(signal: NodeJS.Signals): void {
	if (isShuttingDown) {
		return;
	}
	isShuttingDown = true;
	if (restartTimer) {
		clearTimeout(restartTimer);
		restartTimer = null;
	}
	if (activeChild && !activeChild.killed) {
		try {
			activeChild.kill(signal);
		}
		catch {
		}
	}
}

process.on("SIGINT", () => shutdownGracefully("SIGINT"));
process.on("SIGTERM", () => shutdownGracefully("SIGTERM"));

start("Starting QueenBot v3 by Priyanshi Kaur");
