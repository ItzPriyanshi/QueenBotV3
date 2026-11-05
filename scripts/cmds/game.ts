const axios = require('axios');
const fs = require('fs');
const path = require('path');
const DIFFICULTY_LEVELS = {
    easy: { timeMultiplier: 1.3, rewardMultiplier: 0.8, maxAttempts: 5 },
    normal: { timeMultiplier: 1, rewardMultiplier: 1, maxAttempts: 3 },
    hard: { timeMultiplier: 0.7, rewardMultiplier: 1.5, maxAttempts: 2 }
};
const ACHIEVEMENTS = {
    quickWin: { name: "Speed Demon", description: "Win a game in under 5 seconds", reward: 100 },
    perfectStreak: { name: "Perfect Streak", description: "Win 5 games in a row", reward: 250 },
    masterPlayer: { name: "Game Master", description: "Win 50 games total", reward: 1000 }
};
module.exports = {
    config: {
        name: "game",
        version: "2.0.0",
        author: "Priyanshi Kaur",
        role: 0,
        countdown: 15,
        category: "GAMES",
        shortDescription: { en: "Enhanced word and number games with difficulty levels" },
        longDescription: { en: "Advanced collection of games with customizable settings, achievements, and statistics" },
        guide: {
            en: `{prefix}game [type] [difficulty] [custom_time] 
Available types: word, trivia, dict, number, quiz
Difficulty: easy, normal, hard
Custom time (optional): time in seconds
Additional commands:
{prefix}game stats - View your gaming statistics
{prefix}game achievements - View your achievements
{prefix}game settings - View/modify your game settings
{prefix}game leaderboard - View global rankings`
        }
    },
    onStart: async ({ message, event, args, commandName, usersData }) => {
        if (!args[0]) {
            return message.reply(getHelpMessage());
        }
        if (args[0] === "stats") {
            return showStats(event.senderID, message);
        }
        if (args[0] === "achievements") {
            return showAchievements(event.senderID, message);
        }
        if (args[0] === "settings") {
            return handleSettings(args.slice(1), event.senderID, message);
        }
        if (args[0] === "leaderboard") {
            return showLeaderboard(message);
        }
        const gameTypes = ['word', 'trivia', 'dict', 'number', 'quiz'];
        const gameType = args[0]?.toLowerCase();
        const difficulty = args[1]?.toLowerCase() || getUserSettings(event.senderID).defaultDifficulty || 'normal';
        const customTime = parseInt(args[2]);
        if (!gameTypes.includes(gameType)) {
            return message.reply(`Invalid game type. Available types: ${gameTypes.join(', ')}`);
        }
        if (!DIFFICULTY_LEVELS[difficulty]) {
            return message.reply("Invalid difficulty. Choose: easy, normal, or hard");
        }
        try {
            const userSettings = getUserSettings(event.senderID);
            const { question, answer, hint } = await generateQuestion(gameType, difficulty);
            const reward = calculateReward(gameType, difficulty, userSettings.rewardMultiplier);
            const timeLimit = calculateTimeLimit(gameType, difficulty, customTime, userSettings.timeMultiplier);
            const powerups = getAvailablePowerups(event.senderID, gameType);
            const startTime = Date.now();
            message.reply(`🎮 Game Type: ${gameType.toUpperCase()} (${difficulty})\n` +
                `❓ Question: ${question}\n` +
                `⏱️ Time: ${timeLimit}s\n` +
                `💰 Potential Reward: ${reward} coins\n` +
                `🎯 Attempts: ${DIFFICULTY_LEVELS[difficulty].maxAttempts}\n` +
                `${hint ? `💡 Hint: ${hint}\n` : ''}` +
                `${powerups.length > 0 ? `\n🎨 Available Powerups: ${powerups.join(', ')}` : ''}`, (err, info) => {
                global.GoatBot.onReply.set(info.messageID, {
                    commandName,
                    messageID: info.messageID,
                    author: event.senderID,
                    answer,
                    startTime,
                    timeLimit,
                    reward,
                    gameType,
                    difficulty,
                    attempts: 0,
                    maxAttempts: DIFFICULTY_LEVELS[difficulty].maxAttempts,
                    powerups,
                    streak: getUserStreak(event.senderID)
                });
            });
        }
        catch (error) {
            console.error(error);
            message.reply("Error starting game. Please try again.");
        }
    },
    onReply: async ({ message, Reply, event, usersData }) => {
        const { author, messageID, answer, startTime, timeLimit, reward, gameType, difficulty, attempts, maxAttempts, powerups, streak } = Reply;
        if (event.senderID !== author)
            return;
        const timeTaken = (Date.now() - startTime) / 1000;
        if (timeTaken > timeLimit) {
            global.GoatBot.onReply.delete(messageID);
            message.unsend(event.messageReply.messageID);
            handleGameLoss(event.senderID, gameType);
            return message.reply(`⏰ Time's up!\n🎯 Answer: ${answer}\n📉 Streak lost: ${streak}`);
        }
        const userAnswer = event.body.toLowerCase();
        if (userAnswer.startsWith("powerup ")) {
            return handlePowerup(userAnswer.split(" ")[1], Reply, message, event);
        }
        const isCorrect = checkAnswer(userAnswer, answer, gameType);
        if (isCorrect) {
            global.GoatBot.onReply.delete(messageID);
            message.unsend(event.messageReply.messageID);
            const finalReward = calculateFinalReward(reward, timeTaken, timeLimit, streak, difficulty);
            await usersData.addMoney(event.senderID, finalReward);
            handleGameWin(event.senderID, gameType, timeTaken, finalReward);
            checkAndAwardAchievements(event.senderID, timeTaken, streak + 1, message);
            return message.reply(generateWinMessage(answer, timeTaken, finalReward, streak + 1));
        }
        else {
            if (attempts + 1 >= maxAttempts) {
                global.GoatBot.onReply.delete(messageID);
                message.unsend(event.messageReply.messageID);
                handleGameLoss(event.senderID, gameType);
                return message.reply(generateLossMessage(answer, streak));
            }
            Reply.attempts++;
            return message.reply(generateWrongAnswerMessage(maxAttempts - attempts - 1, gameType, answer, difficulty));
        }
    }
};
function getUserSettings(userId) {
    const settingsFile = path.join(__dirname, 'gameSettings.json');
    let settings = {};
    if (fs.existsSync(settingsFile)) {
        settings = JSON.parse(fs.readFileSync(settingsFile));
    }
    if (!settings[userId]) {
        settings[userId] = {
            defaultDifficulty: 'normal',
            timeMultiplier: 1,
            rewardMultiplier: 1,
            notifications: true,
            theme: 'default'
        };
        fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
    }
    return settings[userId];
}
function getAvailablePowerups(userId, gameType) {
    const powerupsFile = path.join(__dirname, 'powerups.json');
    let powerups = {};
    if (fs.existsSync(powerupsFile)) {
        powerups = JSON.parse(fs.readFileSync(powerupsFile));
    }
    if (!powerups[userId])
        return [];
    return Object.entries(powerups[userId])
        .filter(([name, count]) => count > 0)
        .map(([name]) => name);
}
function handlePowerup(powerupName, gameData, message, event) {
    const powerupEffects = {
        timeExtend: () => { gameData.timeLimit += 15; },
        extraHint: () => generateExtraHint(gameData.gameType, gameData.answer),
        skipQuestion: () => handleSkipQuestion(gameData, message, event)
    };
    if (!powerupEffects[powerupName]) {
        return message.reply("Invalid powerup!");
    }
    if (!consumePowerup(event.senderID, powerupName)) {
        return message.reply("You don't have this powerup!");
    }
    const effect = powerupEffects[powerupName]();
    message.reply(`Powerup ${powerupName} activated!${effect ? ` Effect: ${effect}` : ''}`);
}
function handleSettings(args, userId, message) {
    const settings = getUserSettings(userId);
    if (args.length === 0) {
        return message.reply(generateSettingsMessage(settings));
    }
    const [setting, value] = args;
    const validSettings = ['difficulty', 'time', 'rewards', 'notifications', 'theme'];
    if (!validSettings.includes(setting)) {
        return message.reply(`Invalid setting. Available settings: ${validSettings.join(', ')}`);
    }
    settings[setting] = value;
    saveUserSettings(userId, settings);
    return message.reply(`Setting ${setting} updated to ${value}`);
}
function calculateFinalReward(baseReward, timeTaken, timeLimit, streak, difficulty) {
    const timeBonus = calculateTimeBonus(timeTaken, timeLimit);
    const streakBonus = calculateStreakBonus(streak);
    const difficultyMultiplier = DIFFICULTY_LEVELS[difficulty].rewardMultiplier;
    return Math.floor(baseReward * timeBonus * streakBonus * difficultyMultiplier);
}
function calculateTimeLimit(gameType, difficulty, customTime, userMultiplier) {
    const baseTime = getTimeLimit(gameType);
    const difficultyMultiplier = DIFFICULTY_LEVELS[difficulty].timeMultiplier;
    if (customTime && customTime > 0) {
        return Math.max(10, Math.min(customTime, 120));
    }
    return Math.floor(baseTime * difficultyMultiplier * userMultiplier);
}
function generateWinMessage(answer, timeTaken, reward, streak) {
    return `🎮 Victory!\n` +
        `✨ Answer: ${answer}\n` +
        `⏱️ Time: ${timeTaken.toFixed(1)}s\n` +
        `💰 Reward: ${reward} coins\n` +
        `🔥 Streak: ${streak}`;
}
function generateLossMessage(answer, streak) {
    return `💔 Game Over!\n` +
        `🎯 Correct Answer: ${answer}\n` +
        `📉 Streak lost: ${streak}`;
}
function checkAndAwardAchievements(userId, timeTaken, streak, message) {
    const achievements = loadAchievements(userId);
    let newAchievements = [];
    if (timeTaken < 5 && !achievements.includes('quickWin')) {
        awardAchievement(userId, 'quickWin');
        newAchievements.push(ACHIEVEMENTS.quickWin);
    }
    if (streak >= 5 && !achievements.includes('perfectStreak')) {
        awardAchievement(userId, 'perfectStreak');
        newAchievements.push(ACHIEVEMENTS.perfectStreak);
    }
    const stats = loadUserStats(userId);
    if (stats.totalWins >= 50 && !achievements.includes('masterPlayer')) {
        awardAchievement(userId, 'masterPlayer');
        newAchievements.push(ACHIEVEMENTS.masterPlayer);
    }
    if (newAchievements.length > 0) {
        message.reply(generateAchievementMessage(newAchievements));
    }
}
function handleGameWin(userId, gameType, timeTaken, reward) {
    updateStats(userId, gameType, true);
    updateStreak(userId, true);
    updateLeaderboard(userId, reward);
    checkDailyQuests(userId);
}
function handleGameLoss(userId, gameType) {
    updateStats(userId, gameType, false);
    updateStreak(userId, false);
}
function checkDailyQuests(userId) {
    const quests = loadDailyQuests(userId);
    if (!quests.lastUpdate || isNewDay(quests.lastUpdate)) {
        generateNewDailyQuests(userId);
    }
    updateQuestProgress(userId);
}
module.exports.getGameData = () => ({
    DIFFICULTY_LEVELS,
    ACHIEVEMENTS
});
