const axios = require("axios");
const fs = require("fs-extra");
module.exports = {
    config: {
        name: "lyrics",
        aliases: ["ly"],
        version: "1.0.0",
        author: "Priyanshi Kaur",
        role: 0,
        countDown: 5,
        shortDescription: {
            en: "Get song lyrics by name"
        },
        longDescription: {
            en: "Search and display lyrics for songs, with automatic matching for similar song names"
        },
        category: "music",
        guide: {
            en: "{prefix}lyrics <song name>"
        }
    },
    searchLyrics: async function (songName) {
        try {
            const searchResponse = await axios.get(`https://api.lyrics.ovh/suggest/${encodeURIComponent(songName)}`);
            if (!searchResponse.data.data || searchResponse.data.data.length === 0) {
                throw new Error("No songs found matching your search.");
            }
            const song = searchResponse.data.data[0];
            const lyricsResponse = await axios.get(`https://api.lyrics.ovh/v1/${encodeURIComponent(song.artist.name)}/${encodeURIComponent(song.title)}`);
            return {
                success: true,
                songInfo: song,
                lyrics: lyricsResponse.data.lyrics,
                suggestions: searchResponse.data.data.slice(1, 4)
            };
        }
        catch (error) {
            try {
                const backupResponse = await axios.get(`https://api.textyl.co/api/lyrics?q=${encodeURIComponent(songName)}`);
                if (backupResponse.data && backupResponse.data.lyrics) {
                    return {
                        success: true,
                        songInfo: {
                            title: backupResponse.data.title,
                            artist: { name: backupResponse.data.artist }
                        },
                        lyrics: backupResponse.data.lyrics,
                        suggestions: []
                    };
                }
            }
            catch (backupError) {
                throw new Error("Could not find lyrics for this song.");
            }
        }
    },
    onStart: async function ({ api, event, args }) {
        const songName = args.join(" ").trim();
        if (!songName) {
            return api.sendMessage("⚠️ Please provide a song name.", event.threadID, event.messageID);
        }
        api.setMessageReaction("⌛", event.messageID, () => { }, true);
        try {
            const result = await this.searchLyrics(songName);
            if (!result.success) {
                api.setMessageReaction("❌", event.messageID, () => { }, true);
                return api.sendMessage("❌ Could not find lyrics for this song.", event.threadID, event.messageID);
            }
            let response = `🎵 ${result.songInfo.title} - ${result.songInfo.artist.name}\n\n📝 Lyrics:\n\n${result.lyrics}`;
            if (result.suggestions && result.suggestions.length > 0) {
                response += "\n\n📌 Similar songs you might be looking for:";
                result.suggestions.forEach((song, index) => {
                    response += `\n${index + 1}. ${song.title} - ${song.artist.name}`;
                });
            }
            if (response.length > 20000) {
                const parts = response.match(/.{1,19000}/g);
                for (const part of parts) {
                    await api.sendMessage(part.trim(), event.threadID);
                }
            }
            else {
                await api.sendMessage(response, event.threadID, event.messageID);
            }
            api.setMessageReaction("✅", event.messageID, () => { }, true);
        }
        catch (error) {
            console.error(error);
            api.setMessageReaction("❌", event.messageID, () => { }, true);
            return api.sendMessage(`❌ Error: ${error.message}`, event.threadID, event.messageID);
        }
    },
    onReply: async function ({ api, event, Reply, args }) {
    }
};
