"use strict";

const utils = require("../utils");
const log = require("npmlog");

module.exports = function (defaultFuncs, api, ctx) {
	return function unpinMessage(messageID, threadID, callback) {
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
			fb_api_req_friendly_name: "useMercuryPinMessageMutation",
			doc_id: "7538237919532821",
			variables: JSON.stringify({
				input: {
					client_mutation_id: Math.round(Math.random() * 1024).toString(),
					actor_id: ctx.userID,
					thread_id: threadID,
					message_id: messageID,
					pin_action: "UNPIN"
				}
			})
		};

		defaultFuncs
			.post("https://www.facebook.com/api/graphqlbatch/", ctx.jar, form)
			.then(utils.parseAndCheckLogin(ctx, defaultFuncs))
			.then(function (resData) {
				if (resData.error) {
					throw resData;
				}
				return callback(null, resData);
			})
			.catch(function (err) {
				log.error("unpinMessage", err);
				return callback(err);
			});

		return returnPromise;
	};
};
