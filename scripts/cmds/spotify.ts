const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");
const play = require('play-dl');
const SPOTIFY_CLIENT_ID = "YOUR_CLIENT_ID";
const SPOTIFY_CLIENT_SECRET = "YOUR_CLIENT_SECRET";
module.exports = {
    config: {
        name: "spotify",
        aliases: ["s"],
        version: "2.1.0",
        author: "Priyanshi Kaur",
        role: 0,
        countDown: 5,
        shortDescription: {
            en: "Search and stream songs or find artists on Spotify"
        },
        longDescription: {
            en: "Search for songs by name or link on Spotify and stream them, or search for artists and get their information."
        },
        category: "music",
        guide: {
            en: "{prefix}spotify <song name> or <spotify link>\n{prefix}spotify artist <artist name>"
        }
    },
    getSpotifyToken: async function () {
        const tokenRes = await axios.post("https://accounts.spotify.com/api/token", new URLSearchParams({
            grant_type: "client_credentials"
        }).toString(), {
            headers: {
                "Authorization": `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
                "Content-Type": "application/x-www-form-urlencoded"
            }
        });
        return tokenRes.data.access_token;
    },
    searchSpotifyTrack: async function (trackName, token) {
        const searchRes = await axios.get(`https://api.spotify.com/v1/search`, {
            headers: {
                "Authorization": `Bearer ${token}`
            },
            params: {
                q: trackName,
                type: "track",
                limit: 1
            }
        });
        if (searchRes.data.tracks.items.length === 0) {
            throw new Error("No track found with the given name.");
        }
        return searchRes.data.tracks.items[0];
    },
    searchSpotifyArtist: async function (artistName, token) {
        const searchRes = await axios.get(`https://api.spotify.com/v1/search`, {
            headers: {
                "Authorization": `Bearer ${token}`
            },
            params: {
                q: artistName,
                type: "artist",
                limit: 1
            }
        });
        if (searchRes.data.artists.items.length === 0) {
            throw new Error("No artist found with the given name.");
        }
        return searchRes.data.artists.items[0];
    },
    getArtistTopTracks: async function (artistId, token) {
        const topTracksRes = await axios.get(`https://api.spotify.com/v1/artists/${artistId}/top-tracks`, {
            headers: {
                "Authorization": `Bearer ${token}`
            },
            params: {
                market: "US"
            }
        });
        return topTracksRes.data.tracks.slice(0, 5);
    },
    onStart: async function ({ api, event, args }) {
        try {
            if (args[0] === "artist") {
                const artistName = args.slice(1).join(" ").trim();
                if (!artistName) {
                    return api.sendMessage("Please provide an artist name.", event.threadID, event.messageID);
                }
                const spotifyToken = await this.getSpotifyToken();
                const artist = await this.searchSpotifyArtist(artistName, spotifyToken);
                const topTracks = await this.getArtistTopTracks(artist.id, spotifyToken);
                const artistInfo = `
🎤 Artist: ${artist.name}
👥 Followers: ${artist.followers.total.toLocaleString()}
🎵 Genres: ${artist.genres.join(", ") || "N/A"}
🔥 Popularity: ${artist.popularity}%
🔗 Spotify URL: ${artist.external_urls.spotify}

Top Tracks:
${topTracks.map((track, index) => `${index + 1}. ${track.name}`).join("\n")}
        `.trim();
                if (artist.images && artist.images.length > 0) {
                    const imageResponse = await axios.get(artist.images[0].url, { responseType: 'arraybuffer' });
                    const imagePath = path.join(__dirname, 'cache', `${artist.id}.jpg`);
                    await fs.outputFile(imagePath, imageResponse.data);
                    await api.sendMessage({
                        attachment: fs.createReadStream(imagePath),
                        body: artistInfo
                    }, event.threadID, event.messageID);
                    await fs.remove(imagePath);
                }
                else {
                    await api.sendMessage(artistInfo, event.threadID, event.messageID);
                }
            }
            else {
                const trackName = args.join(" ").trim();
                if (!trackName) {
                    return api.sendMessage(`Please provide a song name or use "artist" to search for an artist.\nFormat: ${this.config.guide.en}`, event.threadID, event.messageID);
                }
                const spotifyToken = await this.getSpotifyToken();
                const track = await this.searchSpotifyTrack(trackName, spotifyToken);
                const trackUrl = track.external_urls.spotify;
                if (play.is_expired()) {
                    await play.refreshToken();
                }
                const stream = await play.stream(trackUrl);
                const songPath = path.join(__dirname, 'cache', `${track.id}.mp3`);
                await fs.outputFile(songPath, stream.stream);
                await api.sendMessage({
                    attachment: fs.createReadStream(songPath),
                    body: `🎵 Title: ${track.name}\n👤 Artists: ${track.artists.map(artist => artist.name).join(", ")}`
                }, event.threadID, event.messageID);
                await fs.remove(songPath);
            }
        }
        catch (error) {
            console.error(error);
            return api.sendMessage(`An error occurred: ${error.message}`, event.threadID, event.messageID);
        }
    }
};
