const fs = require("fs-extra");
const path = require("path");

const ALLOWED_EXTS = new Set([".ts", ".js", ".json", ".md"]);
const IGNORED_DIRS = new Set([
	"node_modules", ".git", ".fca-nx", "Fca_Database", "backup_js",
	"cache", "tmp", "group_memory", "database"
]);
const BLOCKED_FILE_PATTERNS = [
	/^account.*\.txt$/i,
	/^\.env/i,
	/\.cookie$/i,
	/\.session$/i,
	/\.qmem$/i,
	/^train\.data$/i,
	/ai_history\.json$/i,
	/ai_schedules\.json$/i,
	/ai_settings\.json$/i
];

function getRepoRoot() {
	return path.resolve(process.cwd());
}

function isSensitiveOrBlocked(targetPath) {
	const root = getRepoRoot();
	const resolved = path.resolve(targetPath);
	const rel = path.relative(root, resolved);
	if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
		return resolved !== root;
	}
	const parts = rel.split(path.sep);
	for (const part of parts) {
		if (IGNORED_DIRS.has(part)) return true;
		if (BLOCKED_FILE_PATTERNS.some(rx => rx.test(part))) return true;
	}
	return false;
}

function maskSecretsInJsonText(relPath, content) {
	if (!/\.json$/i.test(relPath)) return content;
	return String(content || "").replace(
		/("(?:token|password|secret|apiKey|apikey|cookie|appState|email|refreshToken|accessToken)"\s*:\s*)"([^"]*)"/gi,
		'$1"[REDACTED]"'
	);
}

function listProjectTree(relDir = "", maxDepth = 2) {
	const root = getRepoRoot();
	const base = relDir ? path.resolve(root, relDir) : root;
	if (isSensitiveOrBlocked(base) || !fs.existsSync(base)) {
		return { ok: false, error: `Directory "${relDir || "."}" not accessible.` };
	}

	const entries = [];
	function walk(dirPath, depth) {
		if (depth > maxDepth || entries.length >= 120) return;
		let items = [];
		try {
			items = fs.readdirSync(dirPath, { withFileTypes: true });
		}
		catch {
			return;
		}
		items.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
		for (const item of items) {
			if (entries.length >= 120) break;
			const full = path.join(dirPath, item.name);
			const rel = path.relative(root, full).replace(/\\/g, "/");
			if (isSensitiveOrBlocked(full)) continue;
			if (item.isDirectory()) {
				entries.push(`${rel}/`);
				walk(full, depth + 1);
			}
			else if (ALLOWED_EXTS.has(path.extname(item.name).toLowerCase())) {
				entries.push(rel);
			}
		}
	}

	walk(base, 0);
	return {
		ok: true,
		baseDir: relDir || ".",
		count: entries.length,
		entries
	};
}

function resolveSafeFilePath(targetInput) {
	const root = getRepoRoot();
	const clean = String(targetInput || "").trim().replace(/^['"`]|['"`]$/g, "");
	if (!clean) return null;

	const direct = path.resolve(root, clean);
	if (fs.existsSync(direct) && fs.statSync(direct).isFile() && !isSensitiveOrBlocked(direct)) {
		return direct;
	}

	const stem = path.basename(clean).replace(/\.(ts|js)$/i, "").toLowerCase();
	const candidates = [
		path.join(root, "scripts", "cmds", `${stem}.ts`),
		path.join(root, "scripts", "cmds", `${stem}.js`),
		path.join(root, "scripts", "events", `${stem}.ts`),
		path.join(root, "scripts", "events", `${stem}.js`),
		path.join(root, "bot", "ai", `${stem}.ts`),
		path.join(root, "bot", "ai", `${stem}.js`),
		path.join(root, "bot", "handler", `${stem}.ts`),
		path.join(root, "bot", "handler", `${stem}.js`),
		path.join(root, `${stem}.ts`),
		path.join(root, `${stem}.js`)
	];
	for (const c of candidates) {
		if (fs.existsSync(c) && fs.statSync(c).isFile() && !isSensitiveOrBlocked(c)) {
			return c;
		}
	}
	return null;
}

function inspectProjectFile(targetPathOrCmd, startLine = 1, lineCount = 110) {
	const resolved = resolveSafeFilePath(targetPathOrCmd);
	if (!resolved) {
		return { ok: false, error: `File or command "${targetPathOrCmd}" not found or protected.` };
	}
	const ext = path.extname(resolved).toLowerCase();
	if (!ALLOWED_EXTS.has(ext)) {
		return { ok: false, error: `Extension "${ext}" cannot be inspected.` };
	}
	const relPath = path.relative(getRepoRoot(), resolved).replace(/\\/g, "/");
	try {
		const raw = maskSecretsInJsonText(relPath, fs.readFileSync(resolved, "utf8"));
		const lines = raw.split(/\r?\n/);
		const start = Math.max(1, Number(startLine) || 1);
		const count = Math.min(160, Math.max(10, Number(lineCount) || 110));
		const slice = lines.slice(start - 1, start - 1 + count);
		const numbered = slice.map((l, idx) => `${start + idx}: ${l}`).join("\n");
		return {
			ok: true,
			relPath,
			totalLines: lines.length,
			startLine: start,
			endLine: Math.min(lines.length, start - 1 + slice.length),
			content: numbered.slice(0, 4800)
		};
	}
	catch (err) {
		return { ok: false, error: err?.message || "Failed to read file" };
	}
}

function searchProjectCode(query, scope = "all", maxHits = 18) {
	const q = String(query || "").trim().toLowerCase();
	if (!q) return { ok: false, error: "Empty search query." };
	const root = getRepoRoot();
	const scanDirs = scope === "cmds"
		? [path.join(root, "scripts", "cmds")]
		: scope === "bot"
			? [path.join(root, "bot")]
			: [path.join(root, "bot"), path.join(root, "scripts"), root];

	const hits = [];
	const visited = new Set();

	function scanFile(filePath) {
		if (hits.length >= maxHits || visited.has(filePath) || isSensitiveOrBlocked(filePath)) return;
		visited.add(filePath);
		const ext = path.extname(filePath).toLowerCase();
		if (!ALLOWED_EXTS.has(ext)) return;
		try {
			const stat = fs.statSync(filePath);
			if (!stat.isFile() || stat.size > 300000) return;
			const raw = fs.readFileSync(filePath, "utf8");
			const lines = raw.split(/\r?\n/);
			const relPath = path.relative(root, filePath).replace(/\\/g, "/");
			for (let i = 0; i < lines.length; i++) {
				if (lines[i].toLowerCase().includes(q)) {
					hits.push({
						relPath,
						line: i + 1,
						snippet: maskSecretsInJsonText(relPath, lines[i].trim()).slice(0, 140)
					});
					if (hits.length >= maxHits) break;
				}
			}
		}
		catch {
		}
	}

	function walk(dirPath, depth) {
		if (hits.length >= maxHits || depth > 3 || isSensitiveOrBlocked(dirPath)) return;
		let items = [];
		try {
			items = fs.readdirSync(dirPath, { withFileTypes: true });
		}
		catch {
			return;
		}
		for (const item of items) {
			if (hits.length >= maxHits) break;
			const full = path.join(dirPath, item.name);
			if (isSensitiveOrBlocked(full)) continue;
			if (item.isDirectory()) {
				if (dirPath !== root || !scope || scope !== "all") {
					walk(full, depth + 1);
				}
			}
			else {
				scanFile(full);
			}
		}
	}

	for (const d of scanDirs) {
		if (fs.existsSync(d)) walk(d, 0);
	}

	return {
		ok: true,
		query,
		count: hits.length,
		hits
	};
}

function summarizeCommandScript(cmdName) {
	const res = inspectProjectFile(cmdName, 1, 95);
	if (!res.ok) return null;
	const content = res.content;
	const hasAudio = /\b(?:audio|m4a|mp3|sing|yt-search)\b/i.test(content);
	const hasVideo = /\b(?:video|mp4|720p|1080p|-v)\b/i.test(content);
	const usesReplyMenu = /onReply\.set|choose/i.test(content);
	const isPreviewOnly = /previewUrl|itunes\.apple\.com/i.test(content);
	const usesYtSearch = /yt-search|yts\(/i.test(content);
	const notes = [];
	if (usesYtSearch) notes.push("uses yt-search");
	if (hasAudio) notes.push("supports audio");
	if (hasVideo) notes.push("supports video");
	if (isPreviewOnly) notes.push("iTunes 30s preview only");
	if (usesReplyMenu) notes.push("interactive choice menu when searching text");
	return {
		command: cmdName,
		file: res.relPath,
		capabilities: notes.join(", ") || "command module",
		excerpt: res.content.split("\n").slice(0, 48).join("\n")
	};
}

function inspectMediaCommandScripts() {
	const candidates = ["sing", "ytb", "music", "autolink"];
	const profiles = [];
	for (const name of candidates) {
		const summary = summarizeCommandScript(name);
		if (summary) {
			profiles.push(`- ${summary.file}: [${summary.capabilities}]`);
		}
	}
	return [
		`[INSPECTED MEDIA SCRIPTS IN scripts/cmds/]`,
		...profiles,
		`Conclusion from inspected code: "sing" (scripts/cmds/sing.ts) supports direct YouTube URL/query for both audio ("sing <url>") and video ("sing <url> video") in one step without interactive menu pauses.`
	].join("\n");
}

function detectPromptFileMentions(prompt) {
	const text = String(prompt || "");
	const mentions = new Set();
	const fileRgx = /(?:scripts\/(?:cmds|events)\/|bot\/(?:ai|handler|login)\/)?[a-zA-Z0-9_$-]+\.(?:ts|js|json|md)/gi;
	let m;
	while ((m = fileRgx.exec(text)) !== null) {
		mentions.add(m[0]);
	}
	const root = getRepoRoot();
	const cmdsDir = path.join(root, "scripts", "cmds");
	if (fs.existsSync(cmdsDir)) {
		const tokens = text.toLowerCase().match(/\b[a-z0-9_-]{2,20}\b/g) || [];
		for (const tok of tokens) {
			if (["the", "and", "for", "cmd", "how", "why", "this", "that", "what", "can", "you", "use", "file", "code"].includes(tok)) continue;
			if (fs.existsSync(path.join(cmdsDir, `${tok}.ts`)) || fs.existsSync(path.join(cmdsDir, `${tok}.js`))) {
				mentions.add(tok);
			}
		}
	}
	return Array.from(mentions).slice(0, 3);
}

function buildProjectAwarenessContext(prompt) {
	const lower = String(prompt || "").toLowerCase();
	const parts = [];

	const isMediaQuery = /\b(?:song|songs|music|audio|track|listen|sing|video|clip|watch|synthwave|edm|lofi|remix|playlist|play\s+a?)\b/i.test(lower);
	const isCodeQuery = /\b(?:code|script|file|project|source|understand|how\s+does|how\s+it\s+works|compare|inspect|check\s+.*cmd|why\s+did|\.ts|\.js|queenAgent|toolRegistry|groupMemory|handlerEvents|autolink|sing\.ts|ytb\.ts)\b/i.test(lower);

	if (isMediaQuery) {
		parts.push(inspectMediaCommandScripts());
	}

	if (isCodeQuery) {
		const mentions = detectPromptFileMentions(prompt);
		for (const target of mentions) {
			const inspected = inspectProjectFile(target, 1, 130);
			if (inspected.ok) {
				parts.push(`[INSPECTED FILE ${inspected.relPath} (lines ${inspected.startLine}-${inspected.endLine}/${inspected.totalLines})]\n${inspected.content.slice(0, 2600)}`);
			}
		}
		if (mentions.length === 0) {
			const tree = listProjectTree("", 1);
			if (tree.ok) {
				parts.push(`[PROJECT STRUCTURE]: ${tree.entries.slice(0, 45).join(", ")}`);
			}
		}
	}

	return parts.join("\n\n");
}

module.exports = {
	isSensitiveOrBlocked,
	listProjectTree,
	inspectProjectFile,
	searchProjectCode,
	summarizeCommandScript,
	inspectMediaCommandScripts,
	detectPromptFileMentions,
	buildProjectAwarenessContext
};
