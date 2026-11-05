const https = require("https");
module.exports = {
    config: {
        name: "music",
        aliases: ["song", "play"],
        version: "2.0.0",
        author: "Priyanshi Kaur",
        role: 0,
        countDown: 5,
        category: "media",
        shortDescription: {
            en: "Search and play any song by name"
        },
        longDescription: {
            en: "Search any track by song name (e.g. high rated gabru) and instantly send the playable audio clip directly to Messenger without needing any IDs."
        },
        guide: {
            en: "{pn} <song name>\n\nExamples:\n{pn} high rated gabru\n{pn} faded\n{pn} shape of you"
        }
    },
    onStart: async function ({ api, args, message, event }) {
        const songName = args.join(" ").trim();
        if (!songName) {
            return message.reply("⚠️ Please enter a song name!\n\nExample:\n" + this.config.name + " high rated gabru");
        }
        try {
            if (typeof message.reaction === "function") {
                message.reaction("🔍", event.messageID);
            }
            if (typeof message.playMusic === "function") {
                await message.playMusic(songName, (err) => {
                    if (err) {
                        if (typeof message.reaction === "function") {
                            message.reaction("❌", event.messageID);
                        }
                        return message.reply(`❌ Could not find or send audio for "${songName}": ${err.message || err}`);
                    }
                    if (typeof message.reaction === "function") {
                        message.reaction("🎵", event.messageID);
                    }
                });
            }
            else if (typeof api.sendMusicByName === "function") {
                await api.sendMusicByName(songName, event.threadID, (err) => {
                    if (err) {
                        if (typeof message.reaction === "function") {
                            message.reaction("❌", event.messageID);
                        }
                        return message.reply(`❌ Could not find or send audio for "${songName}": ${err.message || err}`);
                    }
                    if (typeof message.reaction === "function") {
                        message.reaction("🎵", event.messageID);
                    }
                });
            }
            else {
                const query = encodeURIComponent(songName);
                https.get(`https://itunes.apple.com/search?term=${query}&media=music&entity=song&limit=1`, (res) => {
                    let rawData = "";
                    res.setEncoding("utf8");
                    res.on("data", (chunk) => { rawData += chunk; });
                    res.on("end", () => {
                        try {
                            const parsed = JSON.parse(rawData);
                            if (!parsed.results || parsed.results.length === 0) {
                                if (typeof message.reaction === "function") {
                                    message.reaction("❌", event.messageID);
                                }
                                return message.reply(`❌ No tracks found matching "${songName}".`);
                            }
                            const track = parsed.results[0];
                            const title = track.trackName || songName;
                            const artist = track.artistName || "Unknown Artist";
                            const album = track.collectionName || "";
                            const audioUrl = track.previewUrl;
                            if (!audioUrl) {
                                return message.reply(`❌ No preview stream available for "${title}".`);
                            }
                            https.get(audioUrl, (audioRes) => {
                                audioRes.path = `${title.replace(/[/\\?%*:|"<>]/g, "")}.m4a`;
                                const bodyText = `🎵 ${title}\n👤 ${artist}${album ? `\n💿 ${album}` : ""}\n✨ QueenBot v2`;
                                api.sendMessage({ body: bodyText, attachment: audioRes }, event.threadID, (sendErr) => {
                                    if (sendErr) {
                                        if (typeof message.reaction === "function") {
                                            message.reaction("❌", event.messageID);
                                        }
                                        return message.reply(`❌ Failed to send audio clip: ${sendErr.message || sendErr}`);
                                    }
                                    if (typeof message.reaction === "function") {
                                        message.reaction("🎵", event.messageID);
                                    }
                                });
                            });
                        }
                        catch (err) {
                            return message.reply(`❌ Error parsing music track: ${err.message}`);
                        }
                    });
                }).on("error", (err) => {
                    return message.reply(`❌ Network error while searching music: ${err.message}`);
                });
            }
        }
        catch (err) {
            if (typeof message.reaction === "function") {
                message.reaction("❌", event.messageID);
            }
            return message.reply(`❌ Error: ${err.message || err}`);
        }
    }
};
