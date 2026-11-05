import { spawn, type ChildProcess } from "child_process";
import log from "./logger/log.js";

const isBun = typeof (globalThis as any).Bun !== "undefined";
const MAX_CRASHES = 10;
const STABLE_MS = 60000;
const BASE_DELAY_MS = 3000;
const MAX_DELAY_MS = 60000;

let crashes = 0;
let startedAt = 0;

function start(message?: string, delay = 0): void {
	setTimeout(() => {
		if (message) {
			log.info("START", message);
		}

		const runtimeCmd = isBun ? "bun" : process.execPath;
<<<<<<< HEAD
		const runnerArgs = isBun ? ["run", "Queen.ts"] : ["Queen.js"];
=======
		const runnerArgs = isBun ? ["run", "Goat.ts"] : ["Goat.js"];
>>>>>>> 4f1c1c393e36b0ef1cb963a6bae6963a34bff83c

		startedAt = Date.now();

		const child: ChildProcess = spawn(runtimeCmd, runnerArgs, {
			cwd: __dirname,
			stdio: "inherit",
			shell: true
		});

		child.on("close", (code: number | null, signal: string | null) => {
			if (code === 2) {
				crashes = 0;
				start("Restarting QueenBot v3...");
				return;
			}

			if (code === 0 || code === 1) {
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

start("Starting QueenBot v3 by Priyanshi Kaur");
