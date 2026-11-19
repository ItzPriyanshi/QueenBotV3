"use strict";

const utils = require("../utils");
const log = require("npmlog");

module.exports = function (defaultFuncs, api, ctx) {
	return function getThreadTheme(threadID, callback) {
		let resolveFunc = function () { };
		let rejectFunc = function () { };
		const returnPromise = new Promise(function (resolve, reject) {
			resolveFunc = resolve;
			rejectFunc = reject;
		});

		if (typeof callback !== "function") {
			callback = function (err, data) {
				if (err) return rejectFunc(err);
				resolveFunc(data);
			};
		}

		api.getThreadInfo(threadID, (err, info) => {
			if (err) return callback(err);
			const theme = {
				color: info.color,
				emoji: info.emoji,
				threadTheme: info.threadTheme || null
			};
			callback(null, theme);
		});

		return returnPromise;
	};
};
