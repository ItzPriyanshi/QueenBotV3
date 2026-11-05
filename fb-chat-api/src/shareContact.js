"use strict";

const utils = require("../utils");
const log = require("npmlog");

module.exports = function (defaultFuncs, api, ctx) {
	return function shareContact(text, senderID, threadID, callback) {
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

		const messageAndOTID = utils.generateOfflineThreadingID();
		const form = {
			client: "mercury",
			action_type: "ma-type:user-generated-message",
			author: "fbid:" + ctx.userID,
			timestamp: Date.now(),
			timestamp_absolute: "Today",
			timestamp_relative: utils.generateTimestampRelative(),
			timestamp_time_passed: "0",
			is_unread: false,
			is_cleared: false,
			is_forward: false,
			is_filtered_content: false,
			is_filtered_content_bh: false,
			is_filtered_content_account: false,
			is_filtered_content_quasar: false,
			is_filtered_content_invalid_app: false,
			is_spoof_warning: false,
			source: "source:chat:web",
			"source_tags[0]": "source:chat",
			body: text || "",
			html_body: false,
			ui_push_phase: "V3",
			status: "0",
			offline_threading_id: messageAndOTID,
			message_id: messageAndOTID,
			threading_id: utils.generateThreadingID(ctx.clientID),
			"ephemeral_ttl_mode:": "0",
			manual_retry_cnt: "0",
			has_attachment: true,
			signatureID: utils.getSignatureID(),
			profile_xmd: JSON.stringify({
				contact_recipient_id: senderID
			})
		};

		if (threadID) {
			form["thread_fbid"] = threadID;
		}

		defaultFuncs
			.post("https://www.facebook.com/messaging/send/", ctx.jar, form)
			.then(utils.parseAndCheckLogin(ctx, defaultFuncs))
			.then(function (resData) {
				if (!resData) {
					throw { error: "Send message returned empty response." };
				}
				if (resData.error) {
					throw resData;
				}
				return callback(null, resData);
			})
			.catch(function (err) {
				log.error("shareContact", err);
				return callback(err);
			});

		return returnPromise;
	};
};
