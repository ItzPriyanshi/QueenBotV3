"use strict";

const https = require("https");
const log = require("npmlog");

module.exports = function (defaultFuncs, api, ctx) {
	return function sendMusicByName(songName, threadID, options, callback) {
		let resolveFunc = function () { };
		let rejectFunc = function () { };
		const returnPromise = new Promise(function (resolve, reject) {
			resolveFunc = resolve;
			rejectFunc = reject;
		});

		if (typeof options === "function") {
			callback = options;
			options = {};
		}
		if (typeof callback !== "function") {
			callback = function (err, data) {
				if (err) return rejectFunc(err);
				resolveFunc(data);
			};
		}
		if (!options || typeof options !== "object") {
			options = {};
		}

		if (!songName || typeof songName !== "string" || !songName.trim()) {
			const err = new Error("songName must be a valid non-empty string");
			log.error("sendMusicByName", err);
			callback(err);
			return returnPromise;
		}

		const query = encodeURIComponent(songName.trim());
		const searchUrl = `https://itunes.apple.com/search?term=${query}&media=music&entity=song&limit=1`;

		https.get(searchUrl, function (res) {
			let rawData = "";
			res.setEncoding("utf8");
			res.on("data", function (chunk) {
				rawData += chunk;
			});
			res.on("end", function () {
				try {
					const parsed = JSON.parse(rawData);
					if (!parsed.results || parsed.results.length === 0) {
						const notFoundErr = new Error(`No music tracks found matching "${songName}"`);
						log.warn("sendMusicByName", notFoundErr.message);
						callback(notFoundErr);
						return;
					}

					const track = parsed.results[0];
					const title = track.trackName || songName;
					const artist = track.artistName || "Unknown Artist";
					const album = track.collectionName || "";
					const audioUrl = track.previewUrl;

					if (!audioUrl) {
						const noAudioErr = new Error("No playable audio stream available for this track");
						log.warn("sendMusicByName", noAudioErr.message);
						callback(noAudioErr);
						return;
					}

					https.get(audioUrl, function (audioStream) {
						audioStream.path = `${title.replace(/[/\\?%*:|"<>]/g, "")}.m4a`;
						const bodyText = options.hideBody ? "" : `🎵 ${title}\n👤 ${artist}${album ? `\n💿 ${album}` : ""}\n✨ QueenBot v2`;
						const msg = {
							body: bodyText,
							attachment: audioStream
						};
						api.sendMessage(msg, threadID, callback);
					}).on("error", function (streamErr) {
						log.error("sendMusicByName", streamErr);
						callback(streamErr);
					});
				} catch (parseErr) {
					log.error("sendMusicByName", parseErr);
					callback(parseErr);
				}
			});
		}).on("error", function (reqErr) {
			log.error("sendMusicByName", reqErr);
			callback(reqErr);
		});

		return returnPromise;
	};
};
