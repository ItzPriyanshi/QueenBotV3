"use strict";

const utils = require("../utils");
const log = require("npmlog");

module.exports = function (defaultFuncs, api, ctx) {
	return function changeTheme(themeID, threadID, callback) {
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
			dtsg_ag: {
				client_mutation_id: Math.round(Math.random() * 1024).toString(),
				actor_id: ctx.userID,
				thread_id: threadID,
				theme_id: themeID
			}
		};

		const payload = {
			q0: {
				doc_id: "1936306543117456",
				query_params: {
					data: {
						actor_id: ctx.userID,
						client_mutation_id: Math.round(Math.random() * 1024).toString(),
						theme_id: themeID,
						thread_id: threadID
					}
				}
			}
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
				log.error("changeTheme", err);
				return callback(err);
			});

		return returnPromise;
	};
};
