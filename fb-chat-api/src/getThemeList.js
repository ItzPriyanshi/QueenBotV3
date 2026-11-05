"use strict";

const utils = require("../utils");
const log = require("npmlog");

module.exports = function (defaultFuncs, api, ctx) {
	return function getThemeList(callback) {
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
			fb_api_req_friendly_name: "useMessengerCustomizationPickerThemesQuery",
			doc_id: "4477817452331572",
			variables: JSON.stringify({
				supported_capabilities: [
					"THEME",
					"CUSTOM_THEME",
					"GRADIENT"
				]
			})
		};

		defaultFuncs
			.post("https://www.facebook.com/api/graphql/", ctx.jar, form)
			.then(utils.parseAndCheckLogin(ctx, defaultFuncs))
			.then(function (resData) {
				if (resData.error) {
					throw resData;
				}
				const themes = resData.data?.theme_list?.map(theme => ({
					id: theme.id,
					name: theme.name,
					gradient: theme.color_gradient_colors,
					fallback_color: theme.fallback_color,
					icon_url: theme.icon_url,
					accessibility_label: theme.accessibility_label
				})) || [];
				return callback(null, themes);
			})
			.catch(function (err) {
				const fallbackThemes = [
					{ id: "1936306543117456", name: "Classic" },
					{ id: "1763784140683832", name: "Ocean" },
					{ id: "732049077227448", name: "Citrus" },
					{ id: "468943803859664", name: "Berry" },
					{ id: "647247752402120", name: "Cyberpunk" },
					{ id: "1074127539655611", name: "Lofi" },
					{ id: "3028210334139943", name: "Astronomy" },
					{ id: "338977114250269", name: "Tie-Dye" },
					{ id: "634863337190011", name: "Pride" },
					{ id: "1073827463054174", name: "Halloween" }
				];
				return callback(null, fallbackThemes);
			});

		return returnPromise;
	};
};
