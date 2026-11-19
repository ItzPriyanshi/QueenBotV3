"use strict";

const utils = require("../utils");
const log = require("npmlog");

module.exports = function (defaultFuncs, api, ctx) {
	function makeTypingIndicator(typ, threadID, callback, isGroup) {
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

		const form = {
			typ: +typ,
			to: "",
			source: "mercury-chat",
			thread: threadID
		};

		if (isGroup === false) {
			form.to = threadID;
		}

		defaultFuncs
			.post("https://www.facebook.com/ajax/messaging/typ.php", ctx.jar, form)
			.then(utils.parseAndCheckLogin(ctx, defaultFuncs))
			.then(function (resData) {
				if (resData.error) {
					throw resData;
				}
				return callback();
			})
			.catch(function (err) {
				log.error("sendTypingIndicator", err);
				if (utils.getType(err) == "Object" && err.error === "Not logged in") {
					ctx.loggedIn = false;
				}
				return callback(err);
			});

		return returnPromise;
	}

	return function sendTypingIndicator(threadID, callback, isGroup) {
		if (typeof callback === "boolean") {
			isGroup = callback;
			callback = null;
		}
		return makeTypingIndicator(1, threadID, callback, isGroup);
	};
};
