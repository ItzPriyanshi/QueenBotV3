"use strict";

const utils = require("../utils");
const log = require("npmlog");
const fs = require("fs-extra");

module.exports = function (defaultFuncs, api, ctx) {
	return async function sendMusic(audioSource, threadID, metadata, callback) {
		let resolveFunc = function () { };
		let rejectFunc = function () { };
		const returnPromise = new Promise(function (resolve, reject) {
			resolveFunc = resolve;
			rejectFunc = reject;
		});

		if (typeof metadata === "function") {
			callback = metadata;
			metadata = {};
		}
		if (typeof callback !== "function") {
			callback = function (err, data) {
				if (err) return rejectFunc(err);
				resolveFunc(data);
			};
		}

		try {
			let stream = audioSource;
			if (typeof audioSource === "string") {
				if (fs.existsSync(audioSource)) {
					stream = fs.createReadStream(audioSource);
				}
			}

			const msgForm = {
				body: metadata && metadata.title ? `🎵 ${metadata.title}${metadata.artist ? ` • ${metadata.artist}` : ""}` : "",
				attachment: stream
			};
			api.sendMessage(msgForm, threadID, callback);
		} catch (err) {
			log.error("sendMusic", err);
			callback(err);
		}

		return returnPromise;
	};
};
