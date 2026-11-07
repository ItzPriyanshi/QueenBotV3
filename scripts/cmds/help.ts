const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const https = require("https");

const BACKGROUND_IMAGE_URL = [
	"https:",
	"",
	"i.postimg.cc",
	"KjyJm6GJ",
	"013ca0a8b6959c25a5a2934af5dd1ef9.jpg"
].join("/");
const CACHE_DIR = path.join(__dirname, "cache");
const CACHED_BG_PATH = path.join(CACHE_DIR, "help_liquid_bg_v3.jpg");
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

let cachedBgBuffer = null;

const CATEGORY_ICONS = {
	ai: "🤖",
	admin: "🛡️",
	box: "📦",
	chat: "💬",
	config: "⚙️",
	custom: "🧩",
	economy: "💰",
	events: "🎉",
	fun: "🎭",
	game: "🎮",
	games: "🎮",
	group: "👥",
	image: "🖼️",
	info: "📊",
	media: "🎬",
	music: "🎵",
	nsfw: "🔞",
	owner: "👑",
	rank: "🏆",
	rp: "⚔️",
	staff: "👮",
	system: "🖥️",
	tools: "🛠️",
	utility: "🧰",
	user: "👤",
	other: "✨"
};

function getCategoryIcon(category) {
	const key = String(category || "other").trim().toLowerCase();
	return CATEGORY_ICONS[key] || "💠";
}

function getRoleLabel(role, getLang) {
	const r = Number(role) || 0;
	if (typeof getLang === "function") {
		try {
			if (r === 0) return getLang("roleText0") || "0 • All Users";
			if (r === 1) return getLang("roleText1") || "1 • Group Admin";
			if (r === 2) return getLang("roleText2") || "2 • Bot Admin";
		}
		catch {
		}
	}
	if (r === 0) return "0 • All Users";
	if (r === 1) return "1 • Group Admin";
	if (r === 2) return "2 • Bot Admin";
	return `${r} • Custom Role`;
}

function getShortRoleBadge(role) {
	const r = Number(role) || 0;
	if (r === 0) return "ROLE 0 • PUBLIC";
	if (r === 1) return "ROLE 1 • GROUP ADMIN";
	if (r === 2) return "ROLE 2 • BOT ADMIN";
	return `ROLE ${r} • RESTRICTED`;
}

function resolveLocalizedField(field, langCode = "en") {
	if (!field) return "";
	if (typeof field === "string") return field.trim();
	if (typeof field === "object") {
		if (typeof field[langCode] === "string" && field[langCode].trim()) {
			return field[langCode].trim();
		}
		if (typeof field.en === "string" && field.en.trim()) {
			return field.en.trim();
		}
		if (typeof field.vi === "string" && field.vi.trim()) {
			return field.vi.trim();
		}
		for (const val of Object.values(field)) {
			if (typeof val === "string" && val.trim()) {
				return val.trim();
			}
		}
	}
	return "";
}

function getThreadPrefix(threadID) {
	try {
		const utils = global.utils;
		if (utils && typeof utils.getPrefix === "function" && threadID) {
			const p = utils.getPrefix(threadID);
			if (typeof p === "string" && p.length > 0) return p;
		}
	}
	catch {
	}
	const cfgPrefix = global.GoatBot?.config?.prefix;
	return typeof cfgPrefix === "string" && cfgPrefix.length > 0 ? cfgPrefix : ".";
}

function getThreadLang(threadData) {
	if (threadData?.data?.lang && typeof threadData.data.lang === "string") {
		return threadData.data.lang;
	}
	const defaultLang = global.GoatBot?.config?.language;
	return typeof defaultLang === "string" && defaultLang ? defaultLang : "en";
}

function normalizeCommandObject(rawCmd, fallbackName = "", langCode = "en") {
	const cfg = rawCmd?.config || rawCmd;
	if (!cfg || typeof cfg !== "object") return null;
	const name = String(cfg.name || fallbackName || "").trim();
	if (!name) return null;

	const rawAliases = Array.isArray(cfg.aliases) ? cfg.aliases : [];
	const aliases = [];
	for (const a of rawAliases) {
		const clean = String(a || "").trim();
		if (clean && clean.toLowerCase() !== name.toLowerCase() && !aliases.some(x => x.toLowerCase() === clean.toLowerCase())) {
			aliases.push(clean);
		}
	}

	const goatAliases = global.GoatBot?.aliases;
	if (goatAliases instanceof Map) {
		for (const [aliasKey, targetVal] of goatAliases.entries()) {
			const targetName = typeof targetVal === "string" ? targetVal : targetVal?.config?.name;
			if (targetName && String(targetName).toLowerCase() === name.toLowerCase()) {
				const cleanAlias = String(aliasKey || "").trim();
				if (cleanAlias && cleanAlias.toLowerCase() !== name.toLowerCase() && !aliases.some(x => x.toLowerCase() === cleanAlias.toLowerCase())) {
					aliases.push(cleanAlias);
				}
			}
		}
	}

	const shortDesc = resolveLocalizedField(cfg.shortDescription, langCode) || resolveLocalizedField(cfg.description, langCode);
	const longDesc = resolveLocalizedField(cfg.longDescription, langCode) || shortDesc || "No description provided for this command.";
	const guide = resolveLocalizedField(cfg.guide, langCode) || "{pn}";

	return {
		name,
		version: String(cfg.version || "1.0.0").trim(),
		author: String(cfg.author || "Unknown").trim(),
		role: Number.isFinite(Number(cfg.role)) ? Number(cfg.role) : 0,
		countDown: Number.isFinite(Number(cfg.countDown)) ? Number(cfg.countDown) : 1,
		category: String(cfg.category || "other").trim(),
		shortDescription: shortDesc || longDesc,
		longDescription: longDesc,
		guide,
		aliases,
		priority: Number.isFinite(Number(cfg.priority)) ? Number(cfg.priority) : 0
	};
}

function collectAllCommands(langCode = "en") {
	const map = new Map();
	const goatBot = global.GoatBot;
	const commandsMap = goatBot?.commands;

	if (commandsMap instanceof Map) {
		for (const [key, val] of commandsMap.entries()) {
			const norm = normalizeCommandObject(val, String(key), langCode);
			if (norm) {
				map.set(norm.name.toLowerCase(), norm);
			}
		}
	}

	if (map.size === 0 && fs.existsSync(__dirname)) {
		try {
			const files = fs.readdirSync(__dirname);
			for (const file of files) {
				if (!/\.(js|ts)$/i.test(file) || /\.eg\.(js|ts)$/i.test(file) || /\.compiled\.js$/i.test(file)) {
					continue;
				}
				const stem = file.replace(/\.(js|ts)$/i, "");
				const fullPath = path.join(__dirname, file);
				try {
					const content = fs.readFileSync(fullPath, "utf8");
					const nameMatch = content.match(/name\s*:\s*[\x22\x27\x60]([^\x22\x27\x60]+)[\x22\x27\x60]/);
					const versionMatch = content.match(/version\s*:\s*[\x22\x27\x60]([^\x22\x27\x60]+)[\x22\x27\x60]/);
					const authorMatch = content.match(/author\s*:\s*[\x22\x27\x60]([^\x22\x27\x60]+)[\x22\x27\x60]/);
					const categoryMatch = content.match(/category\s*:\s*[\x22\x27\x60]([^\x22\x27\x60]+)[\x22\x27\x60]/);
					const roleMatch = content.match(/role\s*:\s*(\d+)/);
					const countDownMatch = content.match(/countDown\s*:\s*(\d+)/);
					const parsedName = nameMatch ? nameMatch[1].trim() : stem;
					if (!map.has(parsedName.toLowerCase())) {
						map.set(parsedName.toLowerCase(), {
							name: parsedName,
							version: versionMatch ? versionMatch[1].trim() : "1.0.0",
							author: authorMatch ? authorMatch[1].trim() : "Unknown",
							role: roleMatch ? Number(roleMatch[1]) : 0,
							countDown: countDownMatch ? Number(countDownMatch[1]) : 1,
							category: categoryMatch ? categoryMatch[1].trim() : "other",
							shortDescription: `Execute ${parsedName} command`,
							longDescription: `Execute ${parsedName} command module`,
							guide: "{pn}",
							aliases: [],
							priority: 0
						});
					}
				}
				catch {
				}
			}
		}
		catch {
		}
	}

	return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function resolveCommandByQuery(rawQuery, langCode = "en") {
	const clean = String(rawQuery || "")
		.trim()
		.replace(/^[^a-zA-Z0-9_-]+/, "")
		.replace(/\.(js|ts)$/i, "")
		.toLowerCase();
	if (!clean) return null;

	const all = collectAllCommands(langCode);
	for (const cmd of all) {
		if (cmd.name.toLowerCase() === clean) {
			return cmd;
		}
	}

	const goatAliases = global.GoatBot?.aliases;
	if (goatAliases instanceof Map && goatAliases.has(clean)) {
		const target = goatAliases.get(clean);
		const targetName = typeof target === "string" ? target : target?.config?.name;
		if (targetName) {
			const matched = all.find(c => c.name.toLowerCase() === String(targetName).toLowerCase());
			if (matched) return matched;
		}
	}

	for (const cmd of all) {
		if (cmd.aliases.some(a => a.toLowerCase() === clean)) {
			return cmd;
		}
	}

	return null;
}

function levenshteinDistance(a, b) {
	const m = a.length;
	const n = b.length;
	if (m === 0) return n;
	if (n === 0) return m;

	const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
	for (let i = 0; i <= m; i++) dp[i][0] = i;
	for (let j = 0; j <= n; j++) dp[0][j] = j;

	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			dp[i][j] = Math.min(
				dp[i - 1][j] + 1,
				dp[i][j - 1] + 1,
				dp[i - 1][j - 1] + cost
			);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
				dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
			}
		}
	}
	return dp[m][n];
}

function isSubsequence(shortStr, longStr) {
	let i = 0;
	let j = 0;
	while (i < shortStr.length && j < longStr.length) {
		if (shortStr[i] === longStr[j]) i++;
		j++;
	}
	return i === shortStr.length;
}

function computeSimilarity(query, candidate) {
	const q = query.toLowerCase().trim();
	const c = candidate.toLowerCase().trim();
	if (!q || !c) return 0;
	if (q === c) return 1;

	const maxLen = Math.max(q.length, c.length);
	const dist = levenshteinDistance(q, c);
	const baseScore = 1 - dist / maxLen;

	let bonus = 0;
	if (c.startsWith(q) || q.startsWith(c)) {
		bonus += 0.35;
	}
	else if (c.includes(q) || q.includes(c)) {
		bonus += 0.25;
	}
	else if (q.length >= 2 && isSubsequence(q, c)) {
		bonus += 0.2;
	}
	if (q[0] === c[0]) {
		bonus += 0.08;
	}

	return Math.min(0.99, baseScore + bonus);
}

function findSmartCommandSuggestions(rawQuery, langCode = "en", limit = 3) {
	const clean = String(rawQuery || "")
		.trim()
		.replace(/^[^a-zA-Z0-9_-]+/, "")
		.replace(/\.(js|ts)$/i, "")
		.toLowerCase();
	if (!clean) return [];

	const all = collectAllCommands(langCode);
	const results = [];

	for (const cmd of all) {
		const keys = [cmd.name, ...cmd.aliases];
		let bestScore = 0;
		let bestKey = cmd.name;

		for (const k of keys) {
			const s = computeSimilarity(clean, k);
			if (s > bestScore) {
				bestScore = s;
				bestKey = k;
			}
		}

		if (bestScore > 0.15) {
			results.push({ cmd, matchedKey: bestKey, score: bestScore });
		}
	}

	results.sort((a, b) => b.score - a.score || a.cmd.name.localeCompare(b.cmd.name));
	return results.slice(0, limit);
}

async function fetchBackgroundBuffer() {
	if (cachedBgBuffer && cachedBgBuffer.length > 0) {
		return cachedBgBuffer;
	}
	try {
		fs.ensureDirSync(CACHE_DIR);
		if (fs.existsSync(CACHED_BG_PATH)) {
			const stat = fs.statSync(CACHED_BG_PATH);
			if (stat.size > 1024) {
				cachedBgBuffer = fs.readFileSync(CACHED_BG_PATH);
				return cachedBgBuffer;
			}
		}
	}
	catch {
	}

	try {
		const response = await axios.get(BACKGROUND_IMAGE_URL, {
			responseType: "arraybuffer",
			httpsAgent,
			timeout: 15000,
			headers: {
				"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
				Accept: "image/avif,image/webp,image/apng,image/jpeg,image/png"
			}
		});
		if (response?.data) {
			const buf = Buffer.from(response.data);
			if (buf.length > 1024) {
				cachedBgBuffer = buf;
				try {
					fs.ensureDirSync(CACHE_DIR);
					fs.writeFileSync(CACHED_BG_PATH, buf);
				}
				catch {
				}
				return buf;
			}
		}
	}
	catch {
	}
	return null;
}

function getCanvasPackage() {
	const customEngine = global.__QUEENBOT_CANVAS_ENGINE;
	if (customEngine && typeof customEngine.createCanvas === "function") {
		return customEngine;
	}

	const candidates = ["skia-canvas", "@napi-rs/canvas", "canvas"];
	for (const pkgName of candidates) {
		try {
			const mod = require(pkgName);
			if (!mod) continue;
			const createCanvasFn = typeof mod.createCanvas === "function"
				? (w, h) => mod.createCanvas(w, h)
				: typeof mod.Canvas === "function"
					? (w, h) => new mod.Canvas(w, h)
					: null;
			const loadImageFn = typeof mod.loadImage === "function"
				? (src) => mod.loadImage(src)
				: null;
			if (createCanvasFn && loadImageFn) {
				return { createCanvas: createCanvasFn, loadImage: loadImageFn };
			}
		}
		catch {
		}
	}
	return null;
}

function drawRoundedRectPath(ctx, x, y, w, h, r) {
	const radius = Math.max(0, Math.min(r, w / 2, h / 2));
	ctx.beginPath();
	ctx.moveTo(x + radius, y);
	ctx.lineTo(x + w - radius, y);
	ctx.arcTo(x + w, y, x + w, y + radius, radius);
	ctx.lineTo(x + w, y + h - radius);
	ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
	ctx.lineTo(x + radius, y + h);
	ctx.arcTo(x, y + h, x, y + h - radius, radius);
	ctx.lineTo(x, y + radius);
	ctx.arcTo(x, y, x + radius, y, radius);
	ctx.closePath();
}

function fillLiquidGlassPanel(
	ctx,
	x,
	y,
	w,
	h,
	r,
	borderColor = "rgba(0, 238, 255, 0.34)",
	topTint = "rgba(10, 26, 38, 0.84)",
	bottomTint = "rgba(4, 12, 20, 0.91)"
) {
	ctx.save();
	drawRoundedRectPath(ctx, x, y, w, h, r);
	const bgGrad = ctx.createLinearGradient(x, y, x, y + h);
	bgGrad.addColorStop(0, topTint);
	bgGrad.addColorStop(0.55, "rgba(6, 16, 26, 0.88)");
	bgGrad.addColorStop(1, bottomTint);
	ctx.fillStyle = bgGrad;
	ctx.shadowColor = "rgba(0, 0, 0, 0.65)";
	ctx.shadowBlur = 22;
	ctx.shadowOffsetY = 8;
	ctx.fill();
	ctx.restore();

	ctx.save();
	drawRoundedRectPath(ctx, x + 1, y + 1, w - 2, Math.min(54, h * 0.35), Math.max(2, r - 1));
	const sheenGrad = ctx.createLinearGradient(x, y, x, y + Math.min(54, h * 0.35));
	sheenGrad.addColorStop(0, "rgba(255, 255, 255, 0.11)");
	sheenGrad.addColorStop(0.45, "rgba(0, 238, 255, 0.04)");
	sheenGrad.addColorStop(1, "rgba(255, 255, 255, 0.00)");
	ctx.fillStyle = sheenGrad;
	ctx.fill();
	ctx.restore();

	ctx.save();
	drawRoundedRectPath(ctx, x, y, w, h, r);
	ctx.lineWidth = 1.4;
	ctx.strokeStyle = borderColor;
	ctx.stroke();
	ctx.restore();
}

function drawGlowingProgressBar(
	ctx,
	x,
	y,
	w,
	h,
	fillRatio,
	startColor = "#0066ff",
	endColor = "#00f7ff"
) {
	const r = h / 2;
	ctx.save();
	drawRoundedRectPath(ctx, x, y, w, h, r);
	ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
	ctx.fill();
	ctx.restore();

	const activeWidth = Math.max(h, Math.min(w, w * Math.max(0.08, Math.min(1, fillRatio))));
	ctx.save();
	drawRoundedRectPath(ctx, x, y, activeWidth, h, r);
	const grad = ctx.createLinearGradient(x, y, x + activeWidth, y);
	grad.addColorStop(0, startColor);
	grad.addColorStop(0.82, endColor);
	grad.addColorStop(1, "#d8ffff");
	ctx.fillStyle = grad;
	ctx.shadowColor = endColor;
	ctx.shadowBlur = 12;
	ctx.fill();
	ctx.restore();
}

function wrapTextLines(ctx, text, maxWidth, maxLines) {
	const rawParagraphs = String(text || "")
		.replace(/\r\n/g, "\n")
		.split("\n")
		.map(line => line.trim())
		.filter(Boolean);

	const lines = [];

	for (const paragraph of rawParagraphs) {
		const words = paragraph.split(/\s+/);
		let currentLine = "";

		for (const word of words) {
			const candidate = currentLine ? `${currentLine} ${word}` : word;
			const width = ctx.measureText ? ctx.measureText(candidate).width : candidate.length * 8.5;
			if (width <= maxWidth || !currentLine) {
				currentLine = candidate;
			}
			else {
				lines.push(currentLine);
				currentLine = word;
				if (lines.length >= maxLines) break;
			}
		}
		if (lines.length >= maxLines) break;
		if (currentLine) {
			lines.push(currentLine);
		}
		if (lines.length >= maxLines) break;
	}

	if (lines.length > maxLines) {
		return lines.slice(0, maxLines);
	}
	return lines.length > 0 ? lines : ["No details available."];
}

function truncateSingleLine(ctx, text, maxWidth) {
	const clean = String(text || "").trim();
	if (!clean) return "None";
	const measure = (s) => (ctx.measureText ? ctx.measureText(s).width : s.length * 8.5);
	if (measure(clean) <= maxWidth) return clean;
	let out = clean;
	while (out.length > 3 && measure(`${out}...`) > maxWidth) {
		out = out.slice(0, -1);
	}
	return `${out}...`;
}

function drawProceduralHudBackground(ctx, width, height) {
	const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
	bgGrad.addColorStop(0, "#051017");
	bgGrad.addColorStop(0.5, "#07141d");
	bgGrad.addColorStop(1, "#03090e");
	ctx.fillStyle = bgGrad;
	ctx.fillRect(0, 0, width, height);

	ctx.save();
	ctx.strokeStyle = "rgba(0, 225, 255, 0.04)";
	ctx.lineWidth = 1;
	for (let x = 0; x < width; x += 6) {
		ctx.beginPath();
		ctx.moveTo(x, 0);
		ctx.lineTo(x, height);
		ctx.stroke();
	}
	ctx.restore();

	ctx.save();
	drawRoundedRectPath(ctx, 10, 10, width - 20, height - 20, 34);
	ctx.strokeStyle = "#00eaff";
	ctx.lineWidth = 5;
	ctx.shadowColor = "#00eaff";
	ctx.shadowBlur = 16;
	ctx.stroke();
	ctx.restore();
}

function drawCrownBadge(ctx, x, y, size) {
	ctx.save();
	drawRoundedRectPath(ctx, x, y, size, size, 12);
	const boxGrad = ctx.createLinearGradient(x, y, x, y + size);
	boxGrad.addColorStop(0, "rgba(0, 238, 255, 0.25)");
	boxGrad.addColorStop(1, "rgba(0, 110, 255, 0.12)");
	ctx.fillStyle = boxGrad;
	ctx.shadowColor = "rgba(0, 238, 255, 0.45)";
	ctx.shadowBlur = 14;
	ctx.fill();
	ctx.lineWidth = 1.5;
	ctx.strokeStyle = "rgba(0, 242, 255, 0.65)";
	ctx.stroke();

	const cx = x + size / 2;
	const cy = y + size / 2;
	ctx.beginPath();
	ctx.moveTo(cx - 13, cy + 9);
	ctx.lineTo(cx - 15, cy - 6);
	ctx.lineTo(cx - 6, cy + 1);
	ctx.lineTo(cx, cy - 10);
	ctx.lineTo(cx + 6, cy + 1);
	ctx.lineTo(cx + 15, cy - 6);
	ctx.lineTo(cx + 13, cy + 9);
	ctx.closePath();
	ctx.fillStyle = "#e6ffff";
	ctx.shadowColor = "#00f7ff";
	ctx.shadowBlur = 10;
	ctx.fill();
	ctx.restore();
}

function drawLiquidGlassHelpCard(
	ctx,
	width,
	height,
	bgImage,
	cmd,
	prefix,
	totalCommands
) {
	if (bgImage) {
		ctx.drawImage(bgImage, 0, 0, width, height);
		ctx.save();
		const overlay = ctx.createLinearGradient(0, 0, 0, height);
		overlay.addColorStop(0, "rgba(3, 10, 16, 0.30)");
		overlay.addColorStop(0.5, "rgba(3, 10, 16, 0.42)");
		overlay.addColorStop(1, "rgba(2, 8, 14, 0.50)");
		ctx.fillStyle = overlay;
		ctx.fillRect(0, 0, width, height);
		ctx.restore();
	}
	else {
		drawProceduralHudBackground(ctx, width, height);
	}

	ctx.save();
	ctx.font = "bold 12px sans-serif";
	ctx.fillStyle = "#7cefff";
	ctx.textAlign = "center";
	ctx.fillText("QUEENBOT V3 • MODULE INSPECTOR", 422, 36);
	ctx.restore();

	drawCrownBadge(ctx, 50, 74, 48);

	ctx.save();
	ctx.textAlign = "left";
	ctx.font = "bold 27px sans-serif";
	ctx.fillStyle = "#ffffff";
	ctx.shadowColor = "rgba(0, 238, 255, 0.35)";
	ctx.shadowBlur = 10;
	ctx.fillText(`COMMAND • ${cmd.name.toUpperCase()}`, 112, 101);

	ctx.font = "bold 11.5px sans-serif";
	ctx.fillStyle = "#00eaff";
	ctx.shadowBlur = 0;
	ctx.fillText("LIQUID GLASS COMMAND ARCHITECTURE & RUNTIME TELEMETRY", 112, 121);
	ctx.restore();

	fillLiquidGlassPanel(
		ctx,
		776,
		76,
		454,
		46,
		14,
		"rgba(0, 238, 255, 0.38)",
		"rgba(8, 24, 36, 0.85)",
		"rgba(5, 14, 22, 0.92)"
	);

	ctx.save();
	ctx.beginPath();
	ctx.arc(798, 99, 5, 0, Math.PI * 2);
	ctx.fillStyle = "#00ff9d";
	ctx.shadowColor = "#00ff9d";
	ctx.shadowBlur = 10;
	ctx.fill();
	ctx.restore();

	ctx.save();
	ctx.textAlign = "left";
	ctx.font = "bold 12px sans-serif";
	ctx.fillStyle = "#e8faff";
	ctx.fillText("MODULE ONLINE", 812, 103);

	ctx.fillStyle = "#00e5ff";
	ctx.fillText(`BUILD: v${cmd.version}`, 934, 103);

	ctx.textAlign = "right";
	ctx.fillStyle = "#8aa8be";
	ctx.fillText(`PREFIX: ${prefix}`, 1212, 103);
	ctx.restore();

	const leftX = 48;
	const leftY = 142;
	const leftW = 736;
	const leftH = 478;
	fillLiquidGlassPanel(ctx, leftX, leftY, leftW, leftH, 18, "rgba(0, 238, 255, 0.32)");

	ctx.save();
	ctx.textAlign = "left";
	ctx.font = "bold 17px sans-serif";
	ctx.fillStyle = "#ffffff";
	ctx.fillText("COMMAND OVERVIEW & EXECUTION GUIDE", leftX + 26, leftY + 34);

	ctx.font = "bold 11px sans-serif";
	ctx.fillStyle = "#00d9ff";
	ctx.fillText("DESCRIPTION, SYNTAX PARAMETERS & USAGE EXAMPLES", leftX + 26, leftY + 52);

	ctx.font = "bold 13px sans-serif";
	ctx.fillStyle = "#d2ecff";
	ctx.fillText("MODULE DESCRIPTION", leftX + 26, leftY + 86);

	ctx.textAlign = "right";
	ctx.fillStyle = "#00eaff";
	ctx.fillText(`CATEGORY: ${cmd.category.toUpperCase()}`, leftX + leftW - 26, leftY + 86);
	ctx.restore();

	drawGlowingProgressBar(ctx, leftX + 26, leftY + 96, leftW - 52, 8, 0.92, "#0066ff", "#00f2fe");

	ctx.save();
	ctx.textAlign = "left";
	ctx.font = "14px sans-serif";
	ctx.fillStyle = "#e4f5ff";
	const descLines = wrapTextLines(ctx, cmd.longDescription || cmd.shortDescription, leftW - 56, 2);
	descLines.forEach((line, idx) => {
		ctx.fillText(line, leftX + 26, leftY + 126 + idx * 21);
	});
	ctx.restore();

	ctx.save();
	ctx.textAlign = "left";
	ctx.font = "bold 13px sans-serif";
	ctx.fillStyle = "#d2ecff";
	ctx.fillText("SYNTAX & USAGE GUIDE", leftX + 26, leftY + 178);

	ctx.textAlign = "right";
	ctx.fillStyle = "#00eaff";
	ctx.fillText(`INVOCATION: ${prefix}${cmd.name}`, leftX + leftW - 26, leftY + 178);
	ctx.restore();

	drawGlowingProgressBar(ctx, leftX + 26, leftY + 188, leftW - 52, 8, 0.76, "#0055ff", "#00ffaa");

	const guideBoxX = leftX + 26;
	const guideBoxY = leftY + 208;
	const guideBoxW = leftW - 52;
	const guideBoxH = 166;
	fillLiquidGlassPanel(
		ctx,
		guideBoxX,
		guideBoxY,
		guideBoxW,
		guideBoxH,
		13,
		"rgba(0, 225, 255, 0.22)",
		"rgba(4, 12, 20, 0.78)",
		"rgba(2, 8, 14, 0.88)"
	);

	const formattedGuide = String(cmd.guide || "{pn}")
		.replace(/\{pn\}/g, `${prefix}${cmd.name}`)
		.replace(/\{p\}/g, prefix);

	ctx.save();
	ctx.textAlign = "left";
	ctx.font = "13.5px monospace";
	ctx.fillStyle = "#cceeff";
	const guideLines = wrapTextLines(ctx, formattedGuide, guideBoxW - 36, 6);
	guideLines.forEach((line, index) => {
		const cleanLine = truncateSingleLine(ctx, line, guideBoxW - 36);
		ctx.fillText(cleanLine, guideBoxX + 18, guideBoxY + 28 + index * 23);
	});
	ctx.restore();

	const miniY = leftY + 388;
	const miniH = 68;
	const miniW = 216;
	const miniGap = 18;
	const miniCards = [
		{
			label: "PERMISSION LEVEL",
			value: getShortRoleBadge(cmd.role)
		},
		{
			label: "COOLDOWN TIMER",
			value: `${cmd.countDown} SECONDS`
		},
		{
			label: "REGISTERED ALIASES",
			value: cmd.aliases.length > 0 ? `${cmd.aliases.length} ALIASES` : "NO ALIASES"
		}
	];

	miniCards.forEach((card, idx) => {
		const mx = leftX + 26 + idx * (miniW + miniGap);
		fillLiquidGlassPanel(
			ctx,
			mx,
			miniY,
			miniW,
			miniH,
			12,
			"rgba(0, 230, 255, 0.24)",
			"rgba(9, 22, 34, 0.78)",
			"rgba(5, 13, 21, 0.88)"
		);
		ctx.save();
		ctx.textAlign = "left";
		ctx.font = "bold 10.5px sans-serif";
		ctx.fillStyle = "#7aa2bd";
		ctx.fillText(card.label, mx + 16, miniY + 25);

		ctx.font = "bold 15px sans-serif";
		ctx.fillStyle = "#ffffff";
		ctx.fillText(truncateSingleLine(ctx, card.value, miniW - 28), mx + 16, miniY + 49);
		ctx.restore();
	});

	const rightX = 804;
	const rightY = 142;
	const rightW = 426;
	const rightH = 478;
	fillLiquidGlassPanel(ctx, rightX, rightY, rightW, rightH, 18, "rgba(0, 238, 255, 0.32)");

	ctx.save();
	ctx.textAlign = "left";
	ctx.font = "bold 17px sans-serif";
	ctx.fillStyle = "#ffffff";
	ctx.fillText("SPECIFICATIONS", rightX + 26, rightY + 34);

	ctx.font = "bold 11px sans-serif";
	ctx.fillStyle = "#00d9ff";
	ctx.fillText("ENVIRONMENT & MODULE METADATA", rightX + 26, rightY + 52);
	ctx.restore();

	const aliasPreview = cmd.aliases.length > 0 ? cmd.aliases.slice(0, 4).join(", ") : "None";
	const specRows = [
		{ label: "Command Name", value: `${prefix}${cmd.name}`, color: "#00ff9d" },
		{ label: "Category", value: cmd.category.toUpperCase(), color: "#ffffff" },
		{ label: "Author", value: cmd.author, color: "#ffffff" },
		{ label: "Version", value: `v${cmd.version}`, color: "#00eaff" },
		{ label: "Access Role", value: getRoleLabel(cmd.role), color: "#ffffff" },
		{ label: "Cooldown", value: `${cmd.countDown}s`, color: "#ffffff" },
		{ label: "Aliases", value: aliasPreview, color: "#7cefff" }
	];

	specRows.forEach((row, idx) => {
		const ry = rightY + 86 + idx * 41;
		ctx.save();
		ctx.textAlign = "left";
		ctx.font = "13px sans-serif";
		ctx.fillStyle = "#92b4cb";
		ctx.fillText(row.label, rightX + 26, ry);

		ctx.textAlign = "right";
		ctx.font = "bold 13.5px sans-serif";
		ctx.fillStyle = row.color;
		const maxValW = rightW - 175;
		ctx.fillText(truncateSingleLine(ctx, row.value, maxValW), rightX + rightW - 26, ry);

		if (idx < specRows.length - 1) {
			ctx.beginPath();
			ctx.moveTo(rightX + 26, ry + 14);
			ctx.lineTo(rightX + rightW - 26, ry + 14);
			ctx.strokeStyle = "rgba(0, 225, 255, 0.10)";
			ctx.lineWidth = 1;
			ctx.stroke();
		}
		ctx.restore();
	});

	const badgeX = rightX + 24;
	const badgeY = rightY + 382;
	const badgeW = rightW - 48;
	const badgeH = 72;
	fillLiquidGlassPanel(
		ctx,
		badgeX,
		badgeY,
		badgeW,
		badgeH,
		13,
		"rgba(0, 238, 255, 0.42)",
		"rgba(0, 175, 255, 0.12)",
		"rgba(0, 80, 140, 0.18)"
	);

	ctx.save();
	ctx.textAlign = "left";
	ctx.font = "bold 13.5px sans-serif";
	ctx.fillStyle = "#00eaff";
	ctx.fillText("QUEEN V3 ENGINE: OPTIMIZED", badgeX + 18, badgeY + 29);

	ctx.font = "12.5px sans-serif";
	ctx.fillStyle = "#9ec4dc";
	ctx.fillText("Designed by Priyanshi Kaur • Build v3.0.0", badgeX + 18, badgeY + 51);
	ctx.restore();

	ctx.save();
	ctx.textAlign = "left";
	ctx.font = "bold 11.5px sans-serif";
	ctx.fillStyle = "#6c8ea6";
	ctx.fillText("QUEENBOT TELEMETRY ENGINE • LIQUID GLASS UI", 52, 658);

	ctx.textAlign = "right";
	ctx.fillText(`TOTAL MODULES: ${totalCommands} • HELP V3.0.0`, 880, 658);

	ctx.textAlign = "center";
	ctx.font = "bold 12px sans-serif";
	ctx.fillStyle = "#7cefff";
	ctx.fillText("STABLE V3.0", 1030, 690);
	ctx.restore();
}

function escapeXml(str) {
	return String(str || "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function buildSvgOverlayForSharp(
	width,
	height,
	cmd,
	prefix,
	totalCommands
) {
	const fakeCtx = {
		measureText: (s) => ({ width: String(s || "").length * 8.2 })
	};
	const descLines = wrapTextLines(fakeCtx, cmd.longDescription || cmd.shortDescription, 680, 2);
	const formattedGuide = String(cmd.guide || "{pn}")
		.replace(/\{pn\}/g, `${prefix}${cmd.name}`)
		.replace(/\{p\}/g, prefix);
	const guideLines = wrapTextLines(fakeCtx, formattedGuide, 648, 6);
	const aliasPreview = cmd.aliases.length > 0 ? cmd.aliases.slice(0, 4).join(", ") : "None";
	const aliasBadgeText = cmd.aliases.length > 0 ? `${cmd.aliases.length} ALIASES` : "NO ALIASES";
	const roleBadgeText = getShortRoleBadge(cmd.role);

	const specRows = [
		{ label: "Command Name", value: `${prefix}${cmd.name}`, color: "#00ff9d" },
		{ label: "Category", value: cmd.category.toUpperCase(), color: "#ffffff" },
		{ label: "Author", value: cmd.author, color: "#ffffff" },
		{ label: "Version", value: `v${cmd.version}`, color: "#00eaff" },
		{ label: "Access Role", value: getRoleLabel(cmd.role), color: "#ffffff" },
		{ label: "Cooldown", value: `${cmd.countDown}s`, color: "#ffffff" },
		{ label: "Aliases", value: aliasPreview, color: "#7cefff" }
	];

	const descSvg = descLines
		.map((line, i) => `<text x="74" y="${268 + i * 21}" fill="#e4f5ff" font-family="DejaVu Sans, Arial, sans-serif" font-size="14">${escapeXml(truncateSingleLine(fakeCtx, line, 680))}</text>`)
		.join("\n");

	const guideSvg = guideLines
		.map((line, i) => `<text x="92" y="${378 + i * 23}" fill="#cceeff" font-family="DejaVu Sans Mono, monospace" font-size="13.5">${escapeXml(truncateSingleLine(fakeCtx, line, 648))}</text>`)
		.join("\n");

	const specsSvg = specRows
		.map((row, idx) => {
			const ry = 228 + idx * 41;
			const divider = idx < specRows.length - 1
				? `<line x1="830" y1="${ry + 14}" x2="1204" y2="${ry + 14}" stroke="#00e1ff" stroke-opacity="0.12" stroke-width="1"/>`
				: "";
			return `
				<text x="830" y="${ry}" fill="#92b4cb" font-family="DejaVu Sans, Arial, sans-serif" font-size="13">${escapeXml(row.label)}</text>
				<text x="1204" y="${ry}" text-anchor="end" fill="${row.color}" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="13.5">${escapeXml(truncateSingleLine(fakeCtx, row.value, 240))}</text>
				${divider}
			`;
		})
		.join("\n");

	const svgNs = ["http:", "", "www.w3.org", "2000", "svg"].join("/");
	const svg = `<svg xmlns="${svgNs}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
		<defs>
			<linearGradient id="bgDim" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color="#030a10" stop-opacity="0.30"/>
				<stop offset="50%" stop-color="#030a10" stop-opacity="0.42"/>
				<stop offset="100%" stop-color="#02080e" stop-opacity="0.52"/>
			</linearGradient>
			<linearGradient id="glassGrad" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color="#0a1a26" stop-opacity="0.85"/>
				<stop offset="55%" stop-color="#06101a" stop-opacity="0.89"/>
				<stop offset="100%" stop-color="#040c14" stop-opacity="0.93"/>
			</linearGradient>
			<linearGradient id="innerTerminalGrad" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color="#040c14" stop-opacity="0.80"/>
				<stop offset="100%" stop-color="#02080e" stop-opacity="0.90"/>
			</linearGradient>
			<linearGradient id="sheenGrad" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color="#ffffff" stop-opacity="0.12"/>
				<stop offset="50%" stop-color="#00eeff" stop-opacity="0.04"/>
				<stop offset="100%" stop-color="#ffffff" stop-opacity="0.0"/>
			</linearGradient>
			<linearGradient id="barCyan" x1="0" y1="0" x2="1" y2="0">
				<stop offset="0%" stop-color="#0066ff"/>
				<stop offset="85%" stop-color="#00f2fe"/>
				<stop offset="100%" stop-color="#e0ffff"/>
			</linearGradient>
			<linearGradient id="barMint" x1="0" y1="0" x2="1" y2="0">
				<stop offset="0%" stop-color="#0055ff"/>
				<stop offset="85%" stop-color="#00ffaa"/>
				<stop offset="100%" stop-color="#e0ffff"/>
			</linearGradient>
			<linearGradient id="badgeGrad" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color="#00afff" stop-opacity="0.16"/>
				<stop offset="100%" stop-color="#00508c" stop-opacity="0.22"/>
			</linearGradient>
		</defs>

		<rect x="0" y="0" width="${width}" height="${height}" fill="url(#bgDim)"/>

		<text x="422" y="36" text-anchor="middle" fill="#7cefff" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="12">QUEENBOT V3 • MODULE INSPECTOR</text>

		<rect x="50" y="74" width="48" height="48" rx="12" fill="url(#badgeGrad)" stroke="#00f2ff" stroke-opacity="0.65" stroke-width="1.5"/>
		<polygon points="61,107 59,92 68,99 74,88 80,99 89,92 87,107" fill="#e6ffff"/>

		<text x="112" y="101" fill="#ffffff" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="27">COMMAND • ${escapeXml(cmd.name.toUpperCase())}</text>
		<text x="112" y="121" fill="#00eaff" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="11.5">LIQUID GLASS COMMAND ARCHITECTURE &amp; RUNTIME TELEMETRY</text>

		<rect x="776" y="76" width="454" height="46" rx="14" fill="url(#glassGrad)" stroke="#00eeff" stroke-opacity="0.38" stroke-width="1.4"/>
		<circle cx="798" cy="99" r="5" fill="#00ff9d"/>
		<text x="812" y="103" fill="#e8faff" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="12">MODULE ONLINE</text>
		<text x="934" y="103" fill="#00e5ff" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="12">BUILD: v${escapeXml(cmd.version)}</text>
		<text x="1212" y="103" text-anchor="end" fill="#8aa8be" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="12">PREFIX: ${escapeXml(prefix)}</text>

		<rect x="48" y="142" width="736" height="478" rx="18" fill="url(#glassGrad)" stroke="#00eeff" stroke-opacity="0.34" stroke-width="1.4"/>
		<rect x="49" y="143" width="734" height="52" rx="17" fill="url(#sheenGrad)"/>

		<text x="74" y="176" fill="#ffffff" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="17">COMMAND OVERVIEW &amp; EXECUTION GUIDE</text>
		<text x="74" y="194" fill="#00d9ff" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="11">DESCRIPTION, SYNTAX PARAMETERS &amp; USAGE EXAMPLES</text>

		<text x="74" y="228" fill="#d2ecff" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="13">MODULE DESCRIPTION</text>
		<text x="758" y="228" text-anchor="end" fill="#00eaff" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="13">CATEGORY: ${escapeXml(cmd.category.toUpperCase())}</text>
		<rect x="74" y="238" width="684" height="8" rx="4" fill="#ffffff" fill-opacity="0.08"/>
		<rect x="74" y="238" width="630" height="8" rx="4" fill="url(#barCyan)"/>
		${descSvg}

		<text x="74" y="320" fill="#d2ecff" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="13">SYNTAX &amp; USAGE GUIDE</text>
		<text x="758" y="320" text-anchor="end" fill="#00eaff" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="13">INVOCATION: ${escapeXml(prefix + cmd.name)}</text>
		<rect x="74" y="330" width="684" height="8" rx="4" fill="#ffffff" fill-opacity="0.08"/>
		<rect x="74" y="330" width="520" height="8" rx="4" fill="url(#barMint)"/>

		<rect x="74" y="350" width="684" height="166" rx="13" fill="url(#innerTerminalGrad)" stroke="#00e1ff" stroke-opacity="0.24" stroke-width="1.2"/>
		${guideSvg}

		<rect x="74" y="530" width="216" height="68" rx="12" fill="url(#innerTerminalGrad)" stroke="#00e6ff" stroke-opacity="0.25" stroke-width="1.2"/>
		<text x="90" y="555" fill="#7aa2bd" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="10.5">PERMISSION LEVEL</text>
		<text x="90" y="579" fill="#ffffff" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="14.5">${escapeXml(roleBadgeText)}</text>

		<rect x="308" y="530" width="216" height="68" rx="12" fill="url(#innerTerminalGrad)" stroke="#00e6ff" stroke-opacity="0.25" stroke-width="1.2"/>
		<text x="324" y="555" fill="#7aa2bd" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="10.5">COOLDOWN TIMER</text>
		<text x="324" y="579" fill="#ffffff" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="14.5">${escapeXml(String(cmd.countDown))} SECONDS</text>

		<rect x="542" y="530" width="216" height="68" rx="12" fill="url(#innerTerminalGrad)" stroke="#00e6ff" stroke-opacity="0.25" stroke-width="1.2"/>
		<text x="558" y="555" fill="#7aa2bd" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="10.5">REGISTERED ALIASES</text>
		<text x="558" y="579" fill="#ffffff" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="14.5">${escapeXml(aliasBadgeText)}</text>

		<rect x="804" y="142" width="426" height="478" rx="18" fill="url(#glassGrad)" stroke="#00eeff" stroke-opacity="0.34" stroke-width="1.4"/>
		<rect x="805" y="143" width="424" height="52" rx="17" fill="url(#sheenGrad)"/>

		<text x="830" y="176" fill="#ffffff" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="17">SPECIFICATIONS</text>
		<text x="830" y="194" fill="#00d9ff" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="11">ENVIRONMENT &amp; MODULE METADATA</text>

		${specsSvg}

		<rect x="828" y="524" width="378" height="72" rx="13" fill="url(#badgeGrad)" stroke="#00eeff" stroke-opacity="0.42" stroke-width="1.3"/>
		<text x="846" y="553" fill="#00eaff" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="13.5">LIQUID GLASS ENGINE: OPTIMIZED</text>
		<text x="846" y="575" fill="#9ec4dc" font-family="DejaVu Sans, Arial, sans-serif" font-size="12.5">Designed by Priyanshi Kaur • Build v3.0.0</text>

		<text x="52" y="658" fill="#6c8ea6" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="11.5">QUEENBOT TELEMETRY ENGINE • NEXUS UI V4</text>
		<text x="880" y="658" text-anchor="end" fill="#6c8ea6" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="11.5">TOTAL MODULES: ${totalCommands} • HELP V3.0.0</text>
		<text x="1030" y="690" text-anchor="middle" fill="#7cefff" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="12">STABLE V3.0</text>
	</svg>`;

	return Buffer.from(svg, "utf8");
}

async function generateHelpCardImage(cmd, prefix, totalCommands) {
	const width = 1280;
	const height = 720;
	fs.ensureDirSync(CACHE_DIR);
	const outPath = path.join(CACHE_DIR, `help_card_${cmd.name.replace(/[^a-zA-Z0-9_-]/g, "")}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`);

	const bgBuffer = await fetchBackgroundBuffer();
	const canvasPkg = getCanvasPackage();

	if (canvasPkg) {
		try {
			const canvas = canvasPkg.createCanvas(width, height);
			const ctx = canvas.getContext("2d");
			let bgImg = null;
			if (bgBuffer) {
				try {
					bgImg = await canvasPkg.loadImage(bgBuffer);
				}
				catch {
					try {
						bgImg = await canvasPkg.loadImage(CACHED_BG_PATH);
					}
					catch {
					}
				}
			}
			if (!bgImg) {
				try {
					bgImg = await canvasPkg.loadImage(BACKGROUND_IMAGE_URL);
				}
				catch {
				}
			}

			drawLiquidGlassHelpCard(ctx, width, height, bgImg, cmd, prefix, totalCommands);

			let pngBuffer;
			if (typeof canvas.toBuffer === "function") {
				try {
					const maybePromise = canvas.toBuffer("image/png");
					pngBuffer = maybePromise instanceof Promise ? await maybePromise : maybePromise;
				}
				catch {
					const maybePromise = canvas.toBuffer("png");
					pngBuffer = maybePromise instanceof Promise ? await maybePromise : maybePromise;
				}
			}
			else if (typeof canvas.encode === "function") {
				pngBuffer = await canvas.encode("png");
			}
			else {
				throw new Error("Unsupported canvas buffer export");
			}

			fs.writeFileSync(outPath, pngBuffer);
			return outPath;
		}
		catch {
		}
	}

	try {
		const sharpMod = require("sharp");
		const svgOverlay = buildSvgOverlayForSharp(width, height, cmd, prefix, totalCommands);
		if (bgBuffer) {
			await sharpMod(bgBuffer)
				.resize(width, height, { fit: "fill" })
				.composite([{ input: svgOverlay, top: 0, left: 0 }])
				.png()
				.toFile(outPath);
		}
		else {
			await sharpMod({
				create: {
					width,
					height,
					channels: 4,
					background: { r: 5, g: 16, b: 23, alpha: 1 }
				}
			})
				.composite([{ input: svgOverlay, top: 0, left: 0 }])
				.png()
				.toFile(outPath);
		}
		return outPath;
	}
	catch {
	}

	return null;
}

function cleanupTempCard(filePath, stream) {
	try {
		if (stream && typeof stream.destroy === "function" && !stream.destroyed) {
			stream.destroy();
		}
	}
	catch {
	}
	if (filePath && fs.existsSync(filePath)) {
		try {
			fs.unlinkSync(filePath);
		}
		catch {
		}
	}
}

function buildFallbackCommandText(cmd, prefix) {
	const aliasText = cmd.aliases.length > 0 ? cmd.aliases.join(", ") : "None";
	const usageText = String(cmd.guide || "{pn}")
		.replace(/\{pn\}/g, `${prefix}${cmd.name}`)
		.replace(/\{p\}/g, prefix);

	return [
		`╭── 💠 COMMAND • ${cmd.name.toUpperCase()} ──╮`,
		`│ 🏷️ Category : ${cmd.category}`,
		`│ 🔖 Version  : v${cmd.version}`,
		`│ 👑 Author   : ${cmd.author}`,
		`│ 🛡️ Role     : ${getRoleLabel(cmd.role)}`,
		`│ ⏱️ Cooldown : ${cmd.countDown}s`,
		`│ 🔗 Aliases  : ${aliasText}`,
		`╰────────────────────────────╯`,
		`📝 Description:`,
		`${cmd.longDescription || cmd.shortDescription}`,
		``,
		`📘 Usage Guide:`,
		`${usageText}`
	].join("\n");
}

async function sendCommandHelpCard(
	message,
	cmd,
	prefix,
	totalCommands
) {
	let cardPath = null;
	let stream = null;
	try {
		cardPath = await generateHelpCardImage(cmd, prefix, totalCommands);
		if (cardPath && fs.existsSync(cardPath)) {
			stream = fs.createReadStream(cardPath);
			stream.on("error", () => {});
			const aliasLine = cmd.aliases.length > 0 ? ` • Aliases: ${cmd.aliases.join(", ")}` : "";
			await message.reply({
				body: `💠 Command Module: ${prefix}${cmd.name} (v${cmd.version})${aliasLine}`,
				attachment: stream
			});
			setTimeout(() => cleanupTempCard(cardPath, stream), 15000);
			return;
		}
	}
	catch {
		cleanupTempCard(cardPath, stream);
	}
	await message.reply(buildFallbackCommandText(cmd, prefix));
}

function filterVisibleCommands(allCommands, role, threadData) {
	const hideNotFound = Boolean(
		threadData?.data?.hideNotiMessage?.commandNotFound ||
		global.GoatBot?.config?.hideNotiMessage?.commandNotFound
	);
	if (!hideNotFound) {
		return allCommands;
	}
	return allCommands.filter(c => c.role <= (Number(role) || 0));
}

function buildStructuredHelpDirectory(
	commandsList,
	prefix,
	pageNumber,
	showAll = false,
	categoryFilter = ""
) {
	const grouped = new Map();
	for (const cmd of commandsList) {
		const catKey = String(cmd.category || "other").trim().toLowerCase();
		if (categoryFilter && catKey !== categoryFilter.toLowerCase()) {
			continue;
		}
		if (!grouped.has(catKey)) {
			grouped.set(catKey, []);
		}
		grouped.get(catKey).push(cmd);
	}

	const sortedCategories = Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]));
	for (const [, list] of sortedCategories) {
		list.sort((a, b) => (b.priority - a.priority) || a.name.localeCompare(b.name));
	}

	if (sortedCategories.length === 0) {
		return `⚠️ No commands found${categoryFilter ? ` in category "${categoryFilter}"` : ""}.`;
	}

	const categoriesPerPage = showAll || categoryFilter ? sortedCategories.length : 6;
	const totalPages = Math.max(1, Math.ceil(sortedCategories.length / categoriesPerPage));
	const safePage = Math.max(1, Math.min(pageNumber || 1, totalPages));
	const startIdx = (safePage - 1) * categoriesPerPage;
	const visibleCategories = sortedCategories.slice(startIdx, startIdx + categoriesPerPage);

	const lines = [
		"╭━━━〔  QUEENBOT V3  〕━━━╮",
		`│ ⚡ Prefix: ${prefix}   •   📦 Total Modules: ${commandsList.length}`,
		`│ 🧭 Mode: ${categoryFilter ? `Category [${categoryFilter.toUpperCase()}]` : showAll ? "Full Command Catalog" : `Page ${safePage}/${totalPages}`}`,
		"╰━━━━━━━━━━━━━━━━━━━━━╯"
	];

	for (const [catName, list] of visibleCategories) {
		const icon = getCategoryIcon(catName);
		const title = catName.toUpperCase();
		const namesFormatted = list.map(c => `${prefix}${c.name}`).join("  •  ");
		lines.push("");
		lines.push(`╭─ ${icon} ${title} [${list.length}]`);
		lines.push(`╰┈➤ ${namesFormatted}`);
	}

	lines.push("");
	lines.push("╭─── 💡 QUICK NAVIGATION & SMART HELP ───╮");
	if (!showAll && !categoryFilter && totalPages > 1) {
		lines.push(`│ 📄 Next Page : ${prefix}help ${safePage < totalPages ? safePage + 1 : 1}`);
	}
	lines.push(`│ 📚 Full List : ${prefix}help all`);
	lines.push(`│ 🖼️ Card View : ${prefix}help <command_or_alias>`);
	lines.push("╰────────────────────────────────────────╯");

	return lines.join("\n");
}

function buildSmartSuggestionPrompt(
	rawQuery,
	prefix,
	suggestions
) {
	const clean = String(rawQuery || "").trim();
	const lines = [
		`⚠️ Command "${clean}" was not found.`,
		"🔎 Smart Filter found the closest matching commands:",
		""
	];

	suggestions.forEach((item, index) => {
		const aliasPart = item.cmd.aliases.length > 0
			? ` (aliases: ${item.cmd.aliases.slice(0, 3).join(", ")})`
			: "";
		lines.push(`${index + 1}. ${prefix}${item.cmd.name} [${item.cmd.category.toUpperCase()}]${aliasPart}`);
	});

	lines.push("");
	lines.push("💡 Reply with 1, 2, or 3 to view the Liquid Glass command card.");
	return lines.join("\n");
}

module.exports = {
	config: {
		name: "help",
		aliases: ["menu", "commands", "cmds", "h"],
		version: "3.0.0",
		author: "Priyanshi Kaur",
		countDown: 5,
		role: 0,
		shortDescription: {
			vi: "Xem cách dùng lệnh và danh sách lệnh Liquid Glass",
			en: "View command usage with Liquid Glass UI card & smart filtering"
		},
		longDescription: {
			vi: "Xem danh sách lệnh theo trang/danh mục hoặc xem thẻ hướng dẫn Liquid Glass cho từng lệnh kèm gợi ý thông minh",
			en: "Browse the structured command catalog or render a Liquid Glass UI card for any specific command or alias with smart typo suggestions"
		},
		category: "info",
		guide: {
			vi: "{pn} [<trang> | all | <tên lệnh>]",
			en:
				"{pn} [empty | <page> | all | -c <category>]\n" +
				"{pn} <command_name | alias> — Render Liquid Glass command card\n" +
				"Example:\n" +
				"{pn}\n" +
				"{pn} all\n" +
				"{pn} uptime2"
		},
		priority: 1
	},

	langs: {
		vi: {
			roleText0: "0 • Tất cả người dùng",
			roleText1: "1 • Quản trị viên nhóm",
			roleText2: "2 • Admin Bot"
		},
		en: {
			roleText0: "0 • All Users",
			roleText1: "1 • Group Admin",
			roleText2: "2 • Bot Admin"
		}
	},

	onStart: async function ({ message, args, event, threadsData, role }) {
		const langCode = getThreadLang(threadsData);
		const prefix = getThreadPrefix(event?.threadID);
		const allCommands = collectAllCommands(langCode);
		const visibleCommands = filterVisibleCommands(allCommands, role, threadsData);

		const rawArgs = Array.isArray(args) ? args.map(a => String(a || "").trim()).filter(Boolean) : [];

		if (rawArgs.length === 0) {
			const text = buildStructuredHelpDirectory(visibleCommands, prefix, 1, false);
			return await message.reply(text);
		}

		const firstArgLower = rawArgs[0].toLowerCase();

		if (firstArgLower === "all" || firstArgLower === "-a" || firstArgLower === "--all") {
			const text = buildStructuredHelpDirectory(visibleCommands, prefix, 1, true);
			return await message.reply(text);
		}

		if ((firstArgLower === "-c" || firstArgLower === "category" || firstArgLower === "cat") && rawArgs[1]) {
			const catQuery = rawArgs.slice(1).join(" ").trim();
			const text = buildStructuredHelpDirectory(visibleCommands, prefix, 1, true, catQuery);
			return await message.reply(text);
		}

		if (/^\d+$/.test(firstArgLower) && rawArgs.length === 1) {
			const pageNum = parseInt(firstArgLower, 10);
			const text = buildStructuredHelpDirectory(visibleCommands, prefix, pageNum, false);
			return await message.reply(text);
		}

		const query = rawArgs[0];
		const matchedCommand = resolveCommandByQuery(query, langCode);
		if (matchedCommand) {
			return await sendCommandHelpCard(message, matchedCommand, prefix, visibleCommands.length || allCommands.length);
		}

		const categoryMatch = visibleCommands.some(c => c.category.toLowerCase() === firstArgLower);
		if (categoryMatch) {
			const text = buildStructuredHelpDirectory(visibleCommands, prefix, 1, true, firstArgLower);
			return await message.reply(text);
		}

		const suggestions = findSmartCommandSuggestions(query, langCode, 3);
		if (suggestions.length > 0) {
			const promptText = buildSmartSuggestionPrompt(query, prefix, suggestions);
			const sent = await message.reply(promptText);
			const sentMessageID = sent?.messageID;
			if (sentMessageID && global.GoatBot?.onReply instanceof Map) {
				global.GoatBot.onReply.set(sentMessageID, {
					commandName: "help",
					messageID: sentMessageID,
					author: event?.senderID,
					prefix,
					totalCommands: visibleCommands.length || allCommands.length,
					suggestions: suggestions.map(s => s.cmd)
				});
			}
			return;
		}

		return await message.reply(`❌ Command "${query}" does not exist. Type ${prefix}help to browse all available commands.`);
	},

	onReply: async function ({ event, message, Reply }) {
		const { author, messageID, suggestions, prefix, totalCommands } = Reply || {};
		if (author && String(event?.senderID) !== String(author)) {
			return;
		}
		if (!Array.isArray(suggestions) || suggestions.length === 0) {
			return;
		}

		const choice = parseInt(String(event?.body || "").trim(), 10);
		if (isNaN(choice) || choice < 1 || choice > suggestions.length) {
			return;
		}

		if (messageID && global.GoatBot?.onReply instanceof Map) {
			global.GoatBot.onReply.delete(messageID);
		}

		const selectedCmd = suggestions[choice - 1];
		const resolvedPrefix = prefix || getThreadPrefix(event?.threadID);
		const total = Number(totalCommands) || collectAllCommands("en").length;

		await sendCommandHelpCard(message, selectedCmd, resolvedPrefix, total);
	}
};