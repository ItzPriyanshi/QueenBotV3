const axios = require('axios');
const fs = require('fs');
const path = require('path');
const HISTORY_FILE = path.join(__dirname, 'data', 'love_history.json');
const loveCalculator = {
    initDatabase: () => {
        const dataDir = path.join(__dirname, 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir);
        }
        if (!fs.existsSync(HISTORY_FILE)) {
            fs.writeFileSync(HISTORY_FILE, JSON.stringify({}));
        }
    },
    saveToHistory: (uid, data) => {
        const history = JSON.parse(fs.readFileSync(HISTORY_FILE));
        if (!history[uid]) {
            history[uid] = [];
        }
        history[uid].unshift({
            ...data,
            timestamp: new Date().toISOString()
        });
        history[uid] = history[uid].slice(0, 10);
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    },
    getHistory: (uid) => {
        const history = JSON.parse(fs.readFileSync(HISTORY_FILE));
        return history[uid] || [];
    },
    calculateLovePercentage: (name1, name2) => {
        const combinedNames = (name1 + name2).toLowerCase();
        let basePercentage = Math.floor(Math.random() * 101);
        const lengthDiff = Math.abs(name1.length - name2.length);
        basePercentage += Math.max(0, 20 - lengthDiff * 2);
        const commonLetters = new Set(name1.toLowerCase().split('')
            .filter(letter => name2.toLowerCase().includes(letter)));
        basePercentage += commonLetters.size * 5;
        const vowels = 'aeiou';
        const vowelCount1 = name1.toLowerCase().split('')
            .filter(char => vowels.includes(char)).length;
        const vowelCount2 = name2.toLowerCase().split('')
            .filter(char => vowels.includes(char)).length;
        basePercentage += Math.min(vowelCount1, vowelCount2) * 3;
        const randomFactor = Math.floor(Math.random() * 21) - 10;
        return Math.min(100, Math.max(0, basePercentage + randomFactor));
    },
    getCompatibilityDetails: (percentage) => {
        const aspects = [
            { name: "Communication", score: Math.min(100, percentage + Math.floor(Math.random() * 20) - 10) },
            { name: "Romance", score: Math.min(100, percentage + Math.floor(Math.random() * 20) - 10) },
            { name: "Trust", score: Math.min(100, percentage + Math.floor(Math.random() * 20) - 10) },
            { name: "Compatibility", score: Math.min(100, percentage + Math.floor(Math.random() * 20) - 10) }
        ];
        return aspects;
    },
    getLoveComment: async (percentage) => {
        if (percentage < 10)
            return {
                comment: "It's better to find another partner☺️",
                gifLink: "https://i.imgur.com/l74sepy.gif",
                audioLink: "https://drive.google.com/uc?export=download&id=1CYTTaxQIMIdXXdYFO6UN1ShdQiasaUX9",
                emoji: "💔"
            };
        if (percentage < 20)
            return {
                comment: "The chance of success is very low",
                gifLink: "https://i.imgur.com/GdgW1fm.gif",
                audioLink: "https://drive.google.com/uc?export=download&id=1BN_FCS8hNqrg4vgq7mso9zPlR5RW0JD7",
                emoji: "😢"
            };
        if (percentage < 30)
            return {
                comment: "Very low chance. You both have to work on it",
                gifLink: "https://i.imgur.com/2oLW6ow.gif",
                audioLink: "https://drive.google.com/uc?export=download&id=1RiIqz4YwL9xbcoGa5svtFsGpmewEaCj0",
                emoji: "💐"
            };
        if (percentage < 40)
            return {
                comment: "Not bad, give your best to make it a success",
                gifLink: "https://i.imgur.com/rqGLgqm.gif",
                audioLink: "https://drive.google.com/uc?export=download&id=1eycxUA5jDZB_LSheX0kkZU-pwE7o1TbM",
                emoji: "💝"
            };
        if (percentage < 50)
            return {
                comment: "You two will be a fine couple but not perfect",
                gifLink: "https://i.imgur.com/6wAxorq.gif",
                audioLink: "https://drive.google.com/uc?export=download&id=1P83CMEWiZ08eMr6G5kMyBZ7DYlljMWac",
                emoji: "😔💟"
            };
        if (percentage < 60)
            return {
                comment: "You two have some potential. Keep working on it!",
                gifLink: "https://i.imgur.com/ceDO779.gif",
                audioLink: "https://drive.google.com/uc?export=download&id=1_RjvyfAbJEQc5M9v-2_9lEuczp5I5nFy",
                emoji: "💏"
            };
        if (percentage < 70)
            return {
                comment: "You two will be a nice couple",
                gifLink: "https://i.imgur.com/pGuGuC0.gif",
                audioLink: "https://drive.google.com/uc?export=download&id=1AkwiVnY7kpHTwLKi0hZv4jT19UKc5x4C",
                emoji: "💑"
            };
        if (percentage < 80)
            return {
                comment: "If you two keep loving each other, it might make some good changes",
                gifLink: "https://i.imgur.com/bt77RPY.gif",
                audioLink: "https://drive.google.com/uc?export=download&id=1jGiEvE6namRCfMU2IEOU7bFzFX5QrSGu",
                emoji: "👩‍❤️‍💋‍👨"
            };
        if (percentage < 90)
            return {
                comment: "Perfect match! Your love is meant to be!",
                gifLink: "https://i.imgur.com/kXNlsFf.gif",
                audioLink: "https://drive.google.com/uc?export=download&id=1kx4HkDM-SBF2h62Na_gHTmow653zL0nm",
                emoji: "💑"
            };
        return {
            comment: "Amazing perfectly matched! You two are meant to be for each other!",
            gifLink: "https://i.imgur.com/sY03YzC.gif",
            audioLink: "https://drive.google.com/uc?export=download&id=1NNML3BkFOWuRodg2VBsgQNfV_pgSDa1I",
            emoji: "💑💕"
        };
    },
    async downloadMedia(url, localPath) {
        try {
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            fs.writeFileSync(localPath, Buffer.from(response.data));
            return true;
        }
        catch (error) {
            console.error(`Failed to download media: ${error.message}`);
            return false;
        }
    },
    run: async ({ api, event, args }) => {
        try {
            loveCalculator.initDatabase();
            const tzt = args.join(" ").split("|").map(item => item.trim());
            if (!args[0] || tzt.length !== 2) {
                return api.sendMessage("❌ Please provide two names separated by a line | \nExample: /love John | Mary", event.threadID, event.messageID);
            }
            const [firstName, secondName] = tzt;
            const lovePercentage = loveCalculator.calculateLovePercentage(firstName, secondName);
            const compatibility = loveCalculator.getCompatibilityDetails(lovePercentage);
            const { comment, gifLink, audioLink, emoji } = await loveCalculator.getLoveComment(lovePercentage);
            const cacheDir = path.join(__dirname, 'cache');
            if (!fs.existsSync(cacheDir)) {
                fs.mkdirSync(cacheDir);
            }
            const gifPath = path.join(cacheDir, `love_${event.messageID}.gif`);
            const audioPath = path.join(cacheDir, `love_${event.messageID}.mp3`);
            await loveCalculator.downloadMedia(gifLink, gifPath);
            await loveCalculator.downloadMedia(audioLink, audioPath);
            loveCalculator.saveToHistory(event.senderID, {
                names: [firstName, secondName],
                percentage: lovePercentage,
                compatibility
            });
            const message = `💌 Love Calculator Results 💌\n\n${firstName} & ${secondName}\nLove Percentage: ${lovePercentage}% ${emoji}\n\n${comment}\n\nCompatibility Analysis:\n${compatibility.map(aspect => `${aspect.name}: ${aspect.score}%`).join('\n')}\n\n💝 Made with love 💝`;
            const gifStream = fs.createReadStream(gifPath);
            api.sendMessage({ body: message, attachment: gifStream }, event.threadID, async (err, info) => {
                if (!err) {
                    setTimeout(async () => {
                        const audioStream = fs.createReadStream(audioPath);
                        await api.sendMessage({ attachment: audioStream }, event.threadID);
                        setTimeout(() => {
                            try {
                                if (fs.existsSync(gifPath))
                                    fs.unlinkSync(gifPath);
                                if (fs.existsSync(audioPath))
                                    fs.unlinkSync(audioPath);
                            }
                            catch (e) {
                                console.error("Error cleaning up files:", e);
                            }
                        }, 1000);
                    }, 1000);
                }
            });
        }
        catch (error) {
            console.error("Error in love calculator:", error);
            api.sendMessage("❌ Something went wrong. Please try again later.", event.threadID);
        }
    }
};
module.exports = {
    config: {
        name: "love",
        aliases: ["lovecalc", "ship"],
        author: "kshitiz || Priyanshi Kaur",
        version: "2.5.0",
        cooldowns: 15,
        role: 0,
        shortDescription: {
            en: "Calculate love compatibility",
        },
        longDescription: {
            en: "Analyzes love compatibility between two people",
        },
        category: "love",
        guide: {
            en: "{p}love [name1] | [name2]",
        },
    },
    onStart: loveCalculator.run,
    onChat: async function ({ api, event, args }) {
        if (args[0] === "history") {
            try {
                const history = loveCalculator.getHistory(event.senderID);
                if (history.length === 0) {
                    return api.sendMessage("You haven't made any love calculations yet!", event.threadID);
                }
                const historyMessage = "💘 Your Love Calculation History 💘\n\n" +
                    history.map((calc, index) => `${index + 1}. ${calc.names[0]} & ${calc.names[1]}\nMatch: ${calc.percentage}%\nDate: ${new Date(calc.timestamp).toLocaleDateString()}`).join('\n\n');
                api.sendMessage(historyMessage, event.threadID);
            }
            catch (error) {
                console.error("Error retrieving history:", error);
                api.sendMessage("❌ Error retrieving history.", event.threadID);
            }
        }
    }
};
