const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");
const cheerio = require("cheerio");
const https = require("https");
const moment = require("moment-timezone");
const mimeDB = require("mime-db");
const _ = require("lodash");
const ora = require("ora");
const log = require("./logger/log.js");
const { isHexColor, colors } = require("./func/colors.js");
const Prism = require("./func/prism.js");

const agent = new https.Agent({
	rejectUnauthorized: false
});

const word = [
	'A', 'Á', 'À', 'Ả', 'Ã', 'Ạ', 'a', 'á', 'à', 'ả', 'ã', 'ạ',
	'Ă', 'Ắ', 'Ằ', 'Ẳ', 'Ẵ', 'Ặ', 'ă', 'ắ', 'ằ', 'ẳ', 'ẵ', 'ặ',
	'Â', 'Ấ', 'Ầ', 'Ẩ', 'Ẫ', 'Ậ', 'â', 'ấ', 'ầ', 'ẩ', 'ẫ', 'ậ',
	'B', 'b',
	'C', 'c',
	'D', 'Đ', 'd', 'đ',
	'E', 'É', 'È', 'Ẻ', 'Ẽ', 'Ẹ', 'e', 'é', 'è', 'ẻ', 'ẽ', 'ẹ',
	'Ê', 'Ế', 'Ề', 'Ể', 'Ễ', 'Ệ', 'ê', 'ế', 'ề', 'ể', 'ễ', 'ệ',
	'F', 'f',
	'G', 'g',
	'H', 'h',
	'I', 'Í', 'Ì', 'Ỉ', 'Ĩ', 'Ị', 'i', 'í', 'ì', 'ỉ', 'ĩ', 'ị',
	'J', 'j',
	'K', 'k',
	'L', 'l',
	'M', 'm',
	'N', 'n',
	'O', 'Ó', 'Ò', 'Ỏ', 'Õ', 'Ọ', 'o', 'ó', 'ò', 'ỏ', 'õ', 'ọ',
	'Ô', 'Ố', 'Ồ', 'Ổ', 'Ỗ', 'Ộ', 'ô', 'ố', 'ồ', 'ổ', 'ỗ', 'ộ',
	'Ơ', 'Ớ', 'Ờ', 'Ở', 'Ỡ', 'Ợ', 'ơ', 'ớ', 'ờ', 'ở', 'ỡ', 'ợ',
	'P', 'p',
	'Q', 'q',
	'R', 'r',
	'S', 's',
	'T', 't',
	'U', 'Ú', 'Ù', 'Ủ', 'Ũ', 'Ụ', 'u', 'ú', 'ù', 'ủ', 'ũ', 'ụ',
	'Ư', 'Ứ', 'Ừ', 'Ử', 'Ữ', 'Ự', 'ư', 'ứ', 'ừ', 'ử', 'ữ', 'ự',
	'V', 'v',
	'W', 'w',
	'X', 'x',
	'Y', 'Ý', 'Ỳ', 'Ỷ', 'Ỹ', 'Ỵ', 'y', 'ý', 'ỳ', 'ỷ', 'ỹ', 'ỵ',
	'Z', 'z',
	' '
];

const regCheckURL = new RegExp("https?:\\/\\/(www\\.)?[-a-zA-Z0-9@:%._\\+~#=]{1,256}\\.[a-zA-Z0-9()]{1,6}\\b([-a-zA-Z0-9()@:%_\\+.~#?&\\/\\/=]*)");

class CustomError extends Error {
	constructor(obj: any) {
		if (typeof obj === 'string')
			obj = { message: obj };
		if (typeof obj !== 'object' || obj === null)
			throw new TypeError('Object required');
		obj.message ? super(obj.message) : super();
		Object.assign(this, obj);
	}
}

function lengthWhiteSpacesEndLine(text: string): number {
	let length = 0;
	for (let i = text.length - 1; i >= 0; i--) {
		if (text[i] == ' ')
			length++;
		else
			break;
	}
	return length;
}

function lengthWhiteSpacesStartLine(text: string): number {
	let length = 0;
	for (let i = 0; i < text.length; i++) {
		if (text[i] == ' ')
			length++;
		else
			break;
	}
	return length;
}

function setErrorUptime(): void {
	(global as any).statusAccountBot = 'block spam';
	(global as any).responseUptimeCurrent = (global as any).responseUptimeError;
}

const defaultStderrClearLine = process.stderr.clearLine;

function convertTime(miliSeconds: number, replaceSeconds: any = "s", replaceMinutes = "m", replaceHours = "h", replaceDays = "d", replaceMonths = "M", replaceYears = "y", notShowZero = false): string {
	if (typeof replaceSeconds == 'boolean') {
		notShowZero = replaceSeconds;
		replaceSeconds = "s";
	}
	const second = Math.floor(miliSeconds / 1000 % 60);
	const minute = Math.floor(miliSeconds / 1000 / 60 % 60);
	const hour = Math.floor(miliSeconds / 1000 / 60 / 60 % 24);
	const day = Math.floor(miliSeconds / 1000 / 60 / 60 / 24 % 30);
	const month = Math.floor(miliSeconds / 1000 / 60 / 60 / 24 / 30 % 12);
	const year = Math.floor(miliSeconds / 1000 / 60 / 60 / 24 / 30 / 12);
	let formattedDate = '';

	const dateParts = [
		{ value: year, replace: replaceYears },
		{ value: month, replace: replaceMonths },
		{ value: day, replace: replaceDays },
		{ value: hour, replace: replaceHours },
		{ value: minute, replace: replaceMinutes },
		{ value: second, replace: replaceSeconds }
	];

	for (let i = 0; i < dateParts.length; i++) {
		const datePart = dateParts[i];
		if (datePart.value)
			formattedDate += datePart.value + datePart.replace;
		else if (formattedDate != '')
			formattedDate += '00' + datePart.replace;
		else if (i == dateParts.length - 1)
			formattedDate += '0' + datePart.replace;
	}

	if (formattedDate == '')
		formattedDate = '0' + replaceSeconds;

	if (notShowZero)
		formattedDate = formattedDate.replace(/00\w+/g, '');

	return formattedDate;
}

function createOraDots(text: string): any {
	const spin: any = new (ora as any)({
		text: text,
		spinner: {
			interval: 80,
			frames: [
				'⠋', '⠙', '⠹',
				'⠸', '⠼', '⠴',
				'⠦', '⠧', '⠇',
				'⠏'
			]
		}
	});
	spin._start = () => {
		enableStderrClearLine(false);
		spin.start();
	};
	spin._stop = () => {
		enableStderrClearLine(true);
		spin.stop();
	};
	return spin;
}

class TaskQueue {
	queue: any[];
	running: any;
	callback: any;
	constructor(callback: any) {
		this.queue = [];
		this.running = null;
		this.callback = callback;
	}
	push(task: any) {
		this.queue.push(task);
		if (this.queue.length == 1)
			this.next();
	}
	next() {
		if (this.queue.length > 0) {
			const task = this.queue[0];
			this.running = task;
			this.callback(task, async (_err: any, _result: any) => {
				this.running = null;
				this.queue.shift();
				this.next();
			});
		}
	}
	length(): number {
		return this.queue.length;
	}
}

function enableStderrClearLine(isEnable = true): void {
	process.stderr.clearLine = isEnable ? defaultStderrClearLine : (() => { }) as any;
}

function formatNumber(number: any): string {
	const regionCode = (global as any).GoatBot?.config?.language;
	if (isNaN(number))
		throw new Error('The first argument (number) must be a number');

	number = Number(number);
	return number.toLocaleString(regionCode || "en-US");
}

function getExtFromAttachmentType(type: string): string {
	switch (type) {
		case "photo":
			return 'png';
		case "animated_image":
			return "gif";
		case "video":
			return "mp4";
		case "audio":
			return "mp3";
		default:
			return "txt";
	}
}

function getExtFromMimeType(mimeType = ""): string {
	const cleanMime = String(mimeType || "").split(";")[0].trim().toLowerCase();
	return (mimeDB as any)[cleanMime] ? ((mimeDB as any)[cleanMime].extensions || [])[0] || "unknow" : "unknow";
}

function getExtFromUrl(url = ""): string {
	if (!url || typeof url !== "string")
		throw new Error('The first argument (url) must be a string');
	const reg = /(?<=https:\/\/cdn\.fbsbx\.com\/v\/.*?\/|https:\/\/video\.[^\s/]+\.fbcdn\.net\/v\/.*?\/|https:\/\/scontent\.[^\s/]+\.fbcdn\.net\/v\/.*?\/).*?(\/|\?)/g;
	const match = url.match(reg);
	if (match) {
		const fileName = match[0].slice(0, -1);
		if (fileName.includes("."))
			return fileName.slice(fileName.lastIndexOf(".") + 1);
	}
	try {
		const pathname = new URL(url).pathname;
		const base = path.basename(pathname);
		if (base.includes("."))
			return base.slice(base.lastIndexOf(".") + 1);
	}
	catch (e) {}
	return "bin";
}

function getPrefix(threadID: any): string {
	if (!threadID || isNaN(threadID))
		throw new Error('The first argument (threadID) must be a number');
	threadID = String(threadID);
	let prefix = (global as any).GoatBot.config.prefix;
	const threadData = (global as any).db?.allThreadData?.find((t: any) => t.threadID == threadID);
	if (threadData)
		prefix = threadData.data?.prefix || prefix;
	return prefix;
}

function getTime(timestamps?: any, format?: string): string {
	if (!format && typeof timestamps == 'string') {
		format = timestamps;
		timestamps = undefined;
	}
	const tz = (global as any).GoatBot?.config?.timeZone || "Asia/Kolkata";
	return moment(timestamps).tz(tz).format(format);
}

function getType(value: any): string {
	return Object.prototype.toString.call(value).slice(8, -1);
}

function isNumber(value: any): boolean {
	return !isNaN(parseFloat(value));
}

function jsonStringifyColor(obj: any, filter?: any, indent: number = 0, level: number = 0): string {
	let output = '';

	if (typeof obj === 'string')
		output += colors.green(`"${obj}"`);
	else if (typeof obj === 'number' || typeof obj === 'boolean' || obj === null)
		output += colors.yellow(obj);
	else if (obj === undefined)
		output += colors.gray('undefined');
	else if (obj !== undefined && typeof obj !== 'function')
		if (!Array.isArray(obj)) {
			if (Object.keys(obj).length === 0)
				output += '{}';
			else {
				output += colors.gray('{\n');
				Object.keys(obj).forEach(key => {
					let value = obj[key];

					if (filter) {
						if (typeof filter === 'function')
							value = filter(key, value);
						else if (typeof filter === 'object' && filter.length !== undefined)
							if (filter.indexOf(key) < 0)
								return;
					}

					if (!isNaN(Number(key[0])) || key.match(/[^a-zA-Z0-9_]/))
						key = colors.green(JSON.stringify(key));

					output += ' '.repeat(indent + level * indent) + `${key}:${indent ? ' ' : ''}`;
					output += jsonStringifyColor(value, filter, indent, level + 1) + ',\n';
				});

				output = output.replace(/,\n$/, '\n');
				output += ' '.repeat(level * indent) + colors.gray('}');
			}
		}
		else {
			if (obj.length === 0)
				output += '[]';
			else {
				output += colors.gray('[\n');
				obj.forEach(subObj => {
					output += ' '.repeat(indent + level * indent) + jsonStringifyColor(subObj, filter, indent, level + 1) + ',\n';
				});

				output = output.replace(/,\n$/, '\n');
				output += ' '.repeat(level * indent) + colors.gray(']');
			}
		}
	else if (typeof obj === 'function')
		output += colors.green(obj.toString());

	output = output.replace(/,$/gm, colors.gray(','));
	if (indent === 0)
		return output.replace(/\n/g, '');

	return output;
}

const messageQueues = new Map<string, Promise<any>>();

function enqueueMessage(threadID: string, task: () => Promise<any>): Promise<any> {
	const key = String(threadID || "default");
	const previous = messageQueues.get(key) || Promise.resolve();
	const currentTaskPromise = previous
		.catch(() => {})
		.then(() => new Promise((resolve, reject) => {
			setTimeout(() => {
				Promise.resolve()
					.then(task)
					.then(resolve)
					.catch(reject);
			}, 300);
		}));
	messageQueues.set(key, currentTaskPromise.catch(() => {}));
	return currentTaskPromise;
}

function invokeApiWithCallback(
	fn: (...args: any[]) => any,
	argsBeforeCallback: any[],
	userCallback?: any,
	argsAfterCallback: any[] = [],
	timeoutMs: number = 15000
): Promise<any> {
	return new Promise((resolve, reject) => {
		if (typeof fn !== "function") {
			return resolve(undefined);
		}
		let settled = false;
		const validCallback = typeof userCallback === "function" ? userCallback : undefined;

		const timer = setTimeout(() => {
			if (settled)
				return;
			settled = true;
			if (validCallback) {
				try {
					validCallback(null, {});
				}
				catch (e) {}
			}
			resolve({});
		}, timeoutMs);

		const finish = (err: any, data?: any) => {
			if (settled)
				return;
			settled = true;
			clearTimeout(timer);
			if (validCallback) {
				try {
					validCallback(err, data);
				}
				catch (e) {}
			}
			if (err)
				reject(err);
			else
				resolve(data);
		};

		try {
			const internalCallback = (err: any, data?: any) => {
				finish(err, data);
			};
			const ret = fn(...argsBeforeCallback, internalCallback, ...argsAfterCallback);
			if (ret && typeof ret.then === "function") {
				ret.then((data: any) => finish(null, data)).catch((err: any) => finish(err));
			}
		}
		catch (err) {
			finish(err);
		}
	});
}

function message(api: any, event: any) {
	async function sendMessageError(err: any) {
		if (typeof err === "object" && !err.stack)
			err = removeHomeDir(JSON.stringify(err, null, 2));
		else
			err = removeHomeDir(`${err.name || err.error}: ${err.message}`);
		return await enqueueMessage(event.threadID, () =>
			invokeApiWithCallback(
				api.sendMessage.bind(api),
				[(global as any).utils.getText("utils", "errorOccurred", err), event.threadID],
				undefined,
				[event.messageID]
			)
		);
	}
	return {
		send: async (form: any, callback?: any) => {
			return await enqueueMessage(event.threadID, async () => {
				try {
					(global as any).statusAccountBot = 'good';
					return await invokeApiWithCallback(
						api.sendMessage.bind(api),
						[form, event.threadID],
						callback
					);
				} catch (err: any) {
					if (JSON.stringify(err).includes('spam')) {
						setErrorUptime();
					}
					throw err;
				}
			});
		},
		reply: async (form: any, callback?: any) => {
			return await enqueueMessage(event.threadID, async () => {
				try {
					(global as any).statusAccountBot = 'good';
					return await invokeApiWithCallback(
						api.sendMessage.bind(api),
						[form, event.threadID],
						callback,
						[event.messageID]
					);
				} catch (err: any) {
					if (JSON.stringify(err).includes('spam')) {
						setErrorUptime();
					}
					throw err;
				}
			});
		},
		unsend: async (messageID: string, callback?: any) => {
			return await invokeApiWithCallback(
				api.unsendMessage.bind(api),
				[messageID],
				callback
			);
		},
		reaction: async (emoji: string, messageID: string, callback?: any) => {
			try {
				(global as any).statusAccountBot = 'good';
				return await invokeApiWithCallback(
					api.setMessageReaction.bind(api),
					[emoji, messageID],
					callback,
					[true]
				);
			} catch (err: any) {
				if (JSON.stringify(err).includes('spam')) {
					setErrorUptime();
				}
				throw err;
			}
		},
		edit: async (text: string, messageID: string, callback?: any) => {
			if (typeof api.editMessage === "function") {
				return await invokeApiWithCallback(
					api.editMessage.bind(api),
					[text, messageID],
					callback,
					[],
					5000
				);
			}
		},
		typing: (isGroup?: boolean) => {
			if (typeof api.sendTypingIndicator === "function") {
				return api.sendTypingIndicator(event.threadID, () => {}, isGroup);
			}
		},
		changeTheme: async (themeNameOrId: string, callback?: any) => {
			if (typeof api.changeTheme === "function") {
				return await invokeApiWithCallback(api.changeTheme.bind(api), [themeNameOrId, event.threadID], callback);
			} else if (typeof api.changeThreadColor === "function") {
				return await invokeApiWithCallback(api.changeThreadColor.bind(api), [themeNameOrId, event.threadID], callback);
			}
		},
		getTheme: async (callback?: any) => {
			if (typeof api.getThreadTheme === "function") {
				return await invokeApiWithCallback(api.getThreadTheme.bind(api), [event.threadID], callback);
			}
		},
		getThemes: async (callback?: any) => {
			if (typeof api.getThemeList === "function") {
				return await invokeApiWithCallback(api.getThemeList.bind(api), [], callback);
			}
		},
		sendMusic: async (audioSource: any, metadata?: any, callback?: any) => {
			if (typeof api.sendMusic === "function") {
				return await invokeApiWithCallback(api.sendMusic.bind(api), [audioSource, event.threadID, metadata], callback);
			}
		},
		sendMusicByName: async (songName: string, options?: any, callback?: any) => {
			if (typeof api.sendMusicByName === "function") {
				return await invokeApiWithCallback(api.sendMusicByName.bind(api), [songName, event.threadID, options], callback);
			}
		},
		playMusic: async (songName: string, options?: any, callback?: any) => {
			if (typeof api.sendMusicByName === "function") {
				return await invokeApiWithCallback(api.sendMusicByName.bind(api), [songName, event.threadID, options], callback);
			}
		},
		sendMusicSticker: async (stickerID: string, callback?: any) => {
			if (typeof api.sendMusicSticker === "function") {
				return await invokeApiWithCallback(api.sendMusicSticker.bind(api), [stickerID, event.threadID], callback);
			}
		},
		pin: async (messageID?: string, callback?: any) => {
			if (typeof api.pinMessage === "function") {
				return await invokeApiWithCallback(api.pinMessage.bind(api), [messageID || event.messageID, event.threadID], callback);
			}
		},
		unpin: async (messageID?: string, callback?: any) => {
			if (typeof api.unpinMessage === "function") {
				return await invokeApiWithCallback(api.unpinMessage.bind(api), [messageID || event.messageID, event.threadID], callback);
			}
		},
		shareContact: async (text: string, senderID?: string, callback?: any) => {
			if (typeof api.shareContact === "function") {
				return await invokeApiWithCallback(api.shareContact.bind(api), [text, senderID || event.senderID, event.threadID], callback);
			}
		},
		err: async (err: any) => await sendMessageError(err),
		error: async (err: any) => await sendMessageError(err)
	};
}

function randomString(max: number = 10, onlyOnce = false, possible?: string): string {
	if (!max || isNaN(max))
		max = 10;
	let text = "";
	possible = possible || "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (let i = 0; i < max; i++) {
		let random = Math.floor(Math.random() * possible.length);
		if (onlyOnce && text.length < possible.length) {
			while (text.includes(possible[random]))
				random = Math.floor(Math.random() * possible.length);
		}
		text += possible[random];
	}
	return text;
}

function randomNumber(min: number, max?: number): number {
	if (max === undefined || max === null) {
		max = min;
		min = 0;
	}
	if (min == null || min == undefined || isNaN(min))
		throw new Error('The first argument (min) must be a number');
	if (max == null || max == undefined || isNaN(max))
		throw new Error('The second argument (max) must be a number');
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

function removeHomeDir(fullPath: string): string {
	if (!fullPath || typeof fullPath !== "string")
		throw new Error('The first argument (fullPath) must be a string');
	const cwd = process.cwd();
	if (!cwd || cwd === "/")
		return fullPath;
	return fullPath.split(cwd).join("");
}

function splitPage(arr: any[], limit: number): { totalPage: number; allPage: any[] } {
	const allPage = _.chunk(arr, limit);
	return {
		totalPage: allPage.length,
		allPage
	};
}

async function translateAPI(text: string, lang: string): Promise<string> {
	try {
		const res = await axios.get(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${lang}&dt=t&q=${encodeURIComponent(text)}`);
		return res.data[0][0][0];
	}
	catch (err: any) {
		throw new CustomError(err.response ? err.response.data : err);
	}
}

async function downloadFile(url = "", filePath = ""): Promise<string> {
	if (!url || typeof url !== "string")
		throw new Error(`The first argument (url) must be a string`);
	if (!filePath || typeof filePath !== "string")
		throw new Error(`The second argument (path) must be a string`);
	let getFile: any;
	try {
		getFile = await axios.get(url, {
			responseType: "arraybuffer"
		});
	}
	catch (err: any) {
		throw new CustomError(err.response ? err.response.data : err);
	}
	fs.writeFileSync(filePath, Buffer.from(getFile.data));
	return filePath;
}

async function findUid(link: string): Promise<string> {
	try {
		const response = await axios.post(
			'https://seomagnifier.com/fbid',
			new URLSearchParams({
				'facebook': '1',
				'sitelink': link
			}),
			{
				headers: {
					'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
					'Cookie': 'PHPSESSID=0d8feddd151431cf35ccb0522b056dc6'
				}
			}
		);
		const id = response.data;
		if (isNaN(id)) {
			const html = await axios.get(link);
			const $ = cheerio.load(html.data);
			const el = $('meta[property="al:android:url"]').attr('content');
			if (!el) {
				throw new Error('UID not found');
			}
			const number = el.split('/').pop();
			return number || "";
		}
		return id;
	} catch (error) {
		throw new Error('An unexpected error occurred. Please try again.');
	}
}

async function getStreamsFromAttachment(attachments: any[]): Promise<any[]> {
	const streams: any[] = [];
	for (const attachment of attachments) {
		const url = attachment.url;
		const ext = getExtFromUrl(url);
		const fileName = `${randomString(10)}.${ext}`;
		streams.push({
			pending: axios({
				url,
				method: "GET",
				responseType: "stream"
			}),
			fileName
		});
	}
	for (let i = 0; i < streams.length; i++) {
		const stream = await streams[i].pending;
		stream.data.path = streams[i].fileName;
		streams[i] = stream.data;
	}
	return streams;
}

async function getStreamFromURL(url = "", pathName = "", options: any = {}): Promise<any> {
	if (!options && typeof pathName === "object") {
		options = pathName;
		pathName = "";
	}
	if (!url || typeof url !== "string")
		throw new Error(`The first argument (url) must be a string`);
	const response = await axios({
		url,
		method: "GET",
		responseType: "stream",
		...options
	});
	if (!pathName)
		pathName = randomString(10) + (response.headers["content-type"] ? '.' + getExtFromMimeType(response.headers["content-type"]) : ".noext");
	response.data.path = pathName;
	return response.data;
}

async function translate(text: string, lang: string = 'en'): Promise<string> {
	if (typeof text !== "string")
		throw new Error(`The first argument (text) must be a string`);
	if (typeof lang !== "string")
		throw new Error(`The second argument (lang) must be a string`);
	const wordTranslate = [''];
	const wordNoTranslate = [''];
	const wordTransAfter: any[] = [];
	let lastPosition = 'wordTranslate';

	if (word.indexOf(text.charAt(0)) == -1)
		wordTranslate.push('');
	else
		wordNoTranslate.splice(0, 1);

	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (word.indexOf(char) !== -1) {
			const lengWordNoTranslate = wordNoTranslate.length - 1;
			if (wordNoTranslate[lengWordNoTranslate] && wordNoTranslate[lengWordNoTranslate].includes('{') && !wordNoTranslate[lengWordNoTranslate].includes('}')) {
				wordNoTranslate[lengWordNoTranslate] += char;
				continue;
			}
			const lengWordTranslate = wordTranslate.length - 1;
			if (lastPosition == 'wordTranslate') {
				wordTranslate[lengWordTranslate] += char;
			}
			else {
				wordTranslate.push(char);
				lastPosition = 'wordTranslate';
			}
		}
		else {
			const lengWordNoTranslate = wordNoTranslate.length - 1;
			const twoWordLast = wordNoTranslate[lengWordNoTranslate]?.slice(-2) || '';
			if (lastPosition == 'wordNoTranslate') {
				if (twoWordLast == '}}') {
					wordTranslate.push("");
					wordNoTranslate.push(char);
				}
				else
					wordNoTranslate[lengWordNoTranslate] += char;
			}
			else {
				wordNoTranslate.push(char);
				lastPosition = 'wordNoTranslate';
			}
		}
	}

	for (let i = 0; i < wordTranslate.length; i++) {
		const part = wordTranslate[i];
		if (!part.match(/[^\s]+/))
			wordTransAfter.push(part);
		else
			wordTransAfter.push(translateAPI(part, lang));
	}

	let output = '';

	for (let i = 0; i < wordTransAfter.length; i++) {
		let wordTrans = await wordTransAfter[i];
		if (wordTrans.trim().length === 0) {
			output += wordTrans;
			if (wordNoTranslate[i] != undefined)
				output += wordNoTranslate[i];
			continue;
		}

		wordTrans = wordTrans.trim();
		const numberStartSpace = lengthWhiteSpacesStartLine(wordTranslate[i]);
		const numberEndSpace = lengthWhiteSpacesEndLine(wordTranslate[i]);

		wordTrans = ' '.repeat(numberStartSpace) + wordTrans.trim() + ' '.repeat(numberEndSpace);

		output += wordTrans;
		if (wordNoTranslate[i] != undefined)
			output += wordNoTranslate[i];
	}
	return output;
}

async function shortenURL(url: string): Promise<string> {
	try {
		const result = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
		return result.data;
	}
	catch (err: any) {
		if (err.response) {
			const error = new Error();
			Object.assign(error, err.response.data);
			throw error;
		}
		throw new Error(err.message);
	}
}

async function uploadImgbb(file: any): Promise<any> {
	let type = "file";
	try {
		if (!file)
			throw new Error('The first argument (file) must be a stream or a image url');
		if (regCheckURL.test(file) == true)
			type = "url";
		if (
			(type != "url" && (!(typeof file._read === 'function' && typeof file._readableState === 'object')))
			|| (type == "url" && !regCheckURL.test(file))
		)
			throw new Error('The first argument (file) must be a stream or an image URL');

		const res_ = await axios({
			method: 'GET',
			url: 'https://imgbb.com'
		});

		const auth_token = res_.data.match(/auth_token="([^"]+)"/)[1];
		const timestamp = Date.now();

		const res = await axios({
			method: 'POST',
			url: 'https://imgbb.com/json',
			headers: {
				"content-type": "multipart/form-data"
			},
			data: {
				source: file,
				type: type,
				action: 'upload',
				timestamp: timestamp,
				auth_token: auth_token
			}
		});

		return res.data;
	}
	catch (err: any) {
		throw new CustomError(err.response ? err.response.data : err);
	}
}

async function uploadZippyshare(stream: any): Promise<any> {
	const res = await axios({
		method: 'POST',
		url: 'https://api.zippysha.re/upload',
		httpsAgent: agent,
		headers: {
			'Content-Type': 'multipart/form-data'
		},
		data: {
			file: stream
		}
	});

	const fullUrl = res.data.data.file.url.full;
	const res_ = await axios({
		method: 'GET',
		url: fullUrl,
		httpsAgent: agent,
		headers: {
			"user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 Edg/114.0.1823.43"
		}
	});

	const downloadUrl = res_.data.match(/id="download-url"(?:.|\n)*?href="(.+?)"/)[1];
	res.data.data.file.url.download = downloadUrl;

	return res.data;
}

const drive = {
	default: null,
	parentID: "",
	async uploadFile(fileName: string, mimeType?: any, file?: any): Promise<any> {
		if (!file && typeof fileName === "string") {
			file = mimeType;
			mimeType = undefined;
		}
		return { id: "local_" + Date.now(), name: fileName };
	},
	async deleteFile(id: string): Promise<boolean> {
		if (!id || typeof id !== "string")
			throw new Error('The first argument (id) must be a string');
		return true;
	},
	getUrlDownload(id = ""): string {
		if (!id || typeof id !== "string")
			throw new Error('The first argument (id) must be a string');
		return id;
	},
	async getFile(id: string, _responseType = "arraybuffer"): Promise<any> {
		if (!id || typeof id !== "string")
			throw new Error('The first argument (id) must be a string');
		return Buffer.from("");
	},
	async getFileName(id: string): Promise<string> {
		if (!id || typeof id !== "string")
			throw new Error('The first argument (id) must be a string');
		return id;
	},
	async makePublic(id: string): Promise<string> {
		if (!id || typeof id !== "string")
			throw new Error('The first argument (id) must be a string');
		return id;
	},
	async checkAndCreateParentFolder(folderName: string): Promise<string> {
		if (!folderName || typeof folderName !== "string")
			throw new Error('The first argument (folderName) must be a string');
		return "local_folder";
	}
};

class GoatBotApis {
	apiKey: string;
	api: any;
	constructor(apiKey: string) {
		this.apiKey = apiKey;
		const url = `https://goatbot.tk/api`;
		this.api = axios.create({
			baseURL: url,
			headers: {
				"x-api-key": apiKey
			}
		});

		this.api.interceptors.response.use((response: any) => {
			return {
				status: response.status,
				statusText: response.statusText,
				responseHeaders: {
					'x-remaining-requests': parseInt(response.headers['x-remaining-requests']),
					'x-free-remaining-requests': parseInt(response.headers['x-free-remaining-requests']),
					'x-used-requests': parseInt(response.headers['x-used-requests'])
				},
				data: response.data
			};
		});

		this.api.interceptors.response.use(undefined, async (error: any) => {
			if (!error || !error.response) {
				return Promise.reject(error);
			}
			let responseDataError: any;
			const promise = () => new Promise<void>((resolveFunc) => {
				if (error.response.config?.responseType === "arraybuffer") {
					responseDataError = Buffer.from(error.response.data, "binary").toString("utf8");
					resolveFunc();
				}
				else if (error.response.config?.responseType === "stream") {
					let data = "";
					error.response.data.on("data", (chunk: any) => {
						data += chunk;
					});
					error.response.data.on("end", () => {
						responseDataError = data;
						resolveFunc();
					});
				}
				else {
					responseDataError = error.response.data;
					resolveFunc();
				}
			});

			await promise();
			try {
				responseDataError = JSON.parse(responseDataError);
			}
			catch (err) { }
			return Promise.reject({
				status: error.response.status,
				statusText: error.response.statusText,
				responseHeaders: {
					'x-remaining-requests': parseInt(error.response.headers?.['x-remaining-requests']),
					'x-free-remaining-requests': parseInt(error.response.headers?.['x-free-remaining-requests']),
					'x-used-requests': parseInt(error.response.headers?.['x-used-requests'])
				},
				data: responseDataError
			});
		});
	}

	isSetApiKey(): boolean {
		return !!(this.apiKey && typeof this.apiKey === "string");
	}

	getApiKey(): string {
		return this.apiKey;
	}

	async getAccountInfo(): Promise<any> {
		const { data } = await this.api.get("/info");
		return data;
	}
}

const utils = {
	CustomError,
	TaskQueue,
	colors,
	convertTime,
	createOraDots,
	defaultStderrClearLine,
	enableStderrClearLine,
	formatNumber,
	getExtFromAttachmentType,
	getExtFromMimeType,
	getExtFromUrl,
	getPrefix,
	getText: require("./languages/makeFuncGetLangs.js"),
	getTime,
	getType,
	isHexColor,
	isNumber,
	jsonStringifyColor,
	loading: require("./logger/loading.js"),
	log,
	logColor: require("./logger/logColor.js"),
	message,
	randomString,
	randomNumber,
	removeHomeDir,
	splitPage,
	translateAPI,
	downloadFile,
	findUid,
	getStreamsFromAttachment,
	getStreamFromURL,
	getStreamFromUrl: getStreamFromURL,
	Prism,
	translate,
	shortenURL,
	uploadZippyshare,
	uploadImgbb,
	drive,
	GoatBotApis,
	__safeMessagePatched: true
};

module.exports = utils;