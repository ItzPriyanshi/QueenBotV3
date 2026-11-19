const Canvas = require("canvas");
const { uploadZippyshare } = global.utils;
const defaultFontName = "BeVietnamPro-SemiBold";
const defaultPathFontName = `${__dirname}/assets/font/BeVietnamPro-SemiBold.ttf`;
const { randomString } = global.utils;
const percentage = total => total / 100;
Canvas.registerFont(`${__dirname}/assets/font/BeVietnamPro-Bold.ttf`, {
    family: "BeVietnamPro-Bold"
});
Canvas.registerFont(defaultPathFontName, {
    family: defaultFontName
});
let deltaNext;
const expToLevel = (exp, deltaNextLevel = deltaNext) => Math.floor((1 + Math.sqrt(1 + 8 * exp / deltaNextLevel)) / 2);
const levelToExp = (level, deltaNextLevel = deltaNext) => Math.floor(((Math.pow(level, 2) - level) * deltaNextLevel) / 2);
global.client.makeRankCard = makeRankCard;
module.exports = {
    config: {
        name: "rank",
        version: "1.7",
        author: "NTKhang",
        countDown: 5,
        role: 0,
        description: {
            vi: "Xem level của bạn hoặc người được tag. Có thể tag nhiều người",
            en: "View your level or the level of the tagged person. You can tag many people"
        },
        category: "rank",
        guide: {
            vi: "   {pn} [để trống | @tags]",
            en: "   {pn} [empty | @tags]"
        },
        envConfig: {
            deltaNext: 5
        }
    },
    onStart: async function ({ message, event, usersData, threadsData, commandName, envCommands, api }) {
        deltaNext = envCommands[commandName].deltaNext;
        let targetUsers;
        const arrayMentions = Object.keys(event.mentions);
        if (arrayMentions.length == 0)
            targetUsers = [event.senderID];
        else
            targetUsers = arrayMentions;
        const rankCards = await Promise.all(targetUsers.map(async (userID) => {
            const rankCard = await makeRankCard(userID, usersData, threadsData, event.threadID, deltaNext, api);
            rankCard.path = `${randomString(10)}.png`;
            return rankCard;
        }));
        return message.reply({
            attachment: rankCards
        });
    },
    onChat: async function ({ usersData, event }) {
        let { exp } = await usersData.get(event.senderID);
        if (isNaN(exp) || typeof exp != "number")
            exp = 0;
        try {
            await usersData.set(event.senderID, {
                exp: exp + 1
            });
        }
        catch (e) { }
    }
};
const defaultDesignCard = {
    widthCard: 2000,
    heightCard: 500,
    main_color: "#474747",
    sub_color: "rgba(255, 255, 255, 0.5)",
    alpha_subcard: 0.9,
    exp_color: "#e1e1e1",
    expNextLevel_color: "#3f3f3f",
    text_color: "#000000"
};
async function makeRankCard(userID, usersData, threadsData, threadID, deltaNext, api = global.GoatBot.fcaApi) {
    const { exp } = await usersData.get(userID);
    const levelUser = expToLevel(exp, deltaNext);
    const expNextLevel = levelToExp(levelUser + 1, deltaNext) - levelToExp(levelUser, deltaNext);
    const currentExp = expNextLevel - (levelToExp(levelUser + 1, deltaNext) - exp);
    const allUser = await usersData.getAll();
    allUser.sort((a, b) => b.exp - a.exp);
    const rank = allUser.findIndex(user => user.userID == userID) + 1;
    const customRankCard = await threadsData.get(threadID, "data.customRankCard") || {};
    const dataLevel = {
        exp: currentExp,
        expNextLevel,
        name: allUser[rank - 1].name,
        rank: `#${rank}/${allUser.length}`,
        level: levelUser,
        avatar: await usersData.getAvatarUrl(userID)
    };
    const configRankCard = {
        ...defaultDesignCard,
        ...customRankCard
    };
    const checkImagKey = [
        "main_color",
        "sub_color",
        "line_color",
        "exp_color",
        "expNextLevel_color"
    ];
    for (const key of checkImagKey) {
        if (!isNaN(configRankCard[key]))
            configRankCard[key] = await api.resolvePhotoUrl(configRankCard[key]);
    }
    const image = new RankCard({
        ...configRankCard,
        ...dataLevel
    });
    return await image.buildCard();
}
class RankCard {
    constructor(options) {
        this.widthCard = 2000;
        this.heightCard = 500;
        this.main_color = "#474747";
        this.sub_color = "rgba(255, 255, 255, 0.5)";
        this.alpha_subcard = 0.9;
        this.exp_color = "#e1e1e1";
        this.expNextLevel_color = "#3f3f3f";
        this.text_color = "#000000";
        this.fontName = "BeVietnamPro-Bold";
        this.textSize = 0;
        for (const key in options)
            this[key] = options[key];
    }
    registerFont(path, name) {
        Canvas.registerFont(path, {
            family: name
        });
        return this;
    }
    setFontName(fontName) {
        this.fontName = fontName;
        return this;
    }
    increaseTextSize(size) {
        if (isNaN(size))
            throw new Error("Size must be a number");
        if (size < 0)
            throw new Error("Size must be greater than 0");
        this.textSize = size;
        return this;
    }
    decreaseTextSize(size) {
        if (isNaN(size))
            throw new Error("Size must be a number");
        if (size < 0)
            throw new Error("Size must be greater than 0");
        this.textSize = -size;
        return this;
    }
    setWidthCard(widthCard) {
        if (isNaN(widthCard))
            throw new Error("Width card must be a number");
        if (widthCard < 0)
            throw new Error("Width card must be greater than 0");
        this.widthCard = Number(widthCard);
        return this;
    }
    setHeightCard(heightCard) {
        if (isNaN(heightCard))
            throw new Error("Height card must be a number");
        if (heightCard < 0)
            throw new Error("Height card must be greater than 0");
        this.heightCard = Number(heightCard);
        return this;
    }
    setAlphaSubCard(alpha_subcard) {
        if (isNaN(alpha_subcard))
            throw new Error("Alpha subcard must be a number");
        if (alpha_subcard < 0 || alpha_subcard > 1)
            throw new Error("Alpha subcard must be between 0 and 1");
        this.alpha_subcard = Number(alpha_subcard);
        return this;
    }
    setMainColor(main_color) {
        if (typeof main_color !== "string" && !Array.isArray(main_color))
            throw new Error("Main color must be a string or array");
        checkFormatColor(main_color);
        this.main_color = main_color;
        return this;
    }
    setSubColor(sub_color) {
        if (typeof sub_color !== "string" && !Array.isArray(sub_color))
            throw new Error("Sub color must be a string or array");
        checkFormatColor(sub_color);
        this.sub_color = sub_color;
        return this;
    }
    setExpColor(exp_color) {
        if (typeof exp_color !== "string" && !Array.isArray(exp_color))
            throw new Error("Exp color must be a string or array");
        checkFormatColor(exp_color);
        this.exp_color = exp_color;
        return this;
    }
    setExpBarColor(expNextLevel_color) {
        if (typeof expNextLevel_color !== "string" && !Array.isArray(expNextLevel_color))
            throw new Error("Exp next level color must be a string");
        checkFormatColor(expNextLevel_color);
        this.expNextLevel_color = expNextLevel_color;
        return this;
    }
    setTextColor(text_color) {
        if (typeof text_color !== "string" && !Array.isArray(text_color))
            throw new Error("Text color must be a string or an array of string");
        checkFormatColor(text_color, false);
        this.text_color = text_color;
        return this;
    }
    setNameColor(name_color) {
        if (typeof name_color !== "string" && !Array.isArray(name_color))
            throw new Error("Name color must be a string or an array of string");
        checkFormatColor(name_color, false);
        this.name_color = name_color;
        return this;
    }
    setLevelColor(level_color) {
        if (typeof level_color !== "string" && !Array.isArray(level_color))
            throw new Error("Level color must be a string or an array of string");
        checkFormatColor(level_color, false);
        this.level_color = level_color;
        return this;
    }
    setExpTextColor(exp_text_color) {
        if (typeof exp_text_color !== "string" && !Array.isArray(exp_text_color))
            throw new Error("Exp text color must be a string or an array of string");
        checkFormatColor(exp_text_color, false);
        this.exp_text_color = exp_text_color;
        return this;
    }
    setRankColor(rank_color) {
        if (typeof rank_color !== "string" && !Array.isArray(rank_color))
            throw new Error("Rank color must be a string or an array of string");
        checkFormatColor(rank_color, false);
        this.rank_color = rank_color;
        return this;
    }
    setLineColor(line_color) {
        if (typeof line_color !== "string" && !Array.isArray(line_color))
            throw new Error("Line color must be a string or an array of string");
        this.line_color = line_color;
        return this;
    }
    setExp(exp) {
        this.exp = exp;
        return this;
    }
    setExpNextLevel(expNextLevel) {
        this.expNextLevel = expNextLevel;
        return this;
    }
    setLevel(level) {
        this.level = level;
        return this;
    }
    setRank(rank) {
        this.rank = rank;
        return this;
    }
    setName(name) {
        this.name = name;
        return this;
    }
    setAvatar(avatar) {
        this.avatar = avatar;
        return this;
    }
    async buildCard() {
        let { widthCard, heightCard } = this;
        const { main_color, sub_color, alpha_subcard, exp_color, expNextLevel_color, text_color, name_color, level_color, rank_color, line_color, exp_text_color, exp, expNextLevel, name, level, rank, avatar } = this;
        widthCard = Number(widthCard);
        heightCard = Number(heightCard);
        const canvas = Canvas.createCanvas(widthCard, heightCard);
        const ctx = canvas.getContext("2d");
        const alignRim = 3 * percentage(widthCard);
        const Alpha = parseFloat(alpha_subcard || 0);
        ctx.globalAlpha = Alpha;
        await checkColorOrImageAndDraw(alignRim, alignRim, widthCard - alignRim * 2, heightCard - alignRim * 2, ctx, sub_color, 20, alpha_subcard);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "destination-out";
        const xyAvatar = heightCard / 2;
        const resizeAvatar = 60 * percentage(heightCard);
        const widthLineBetween = 58 * percentage(widthCard);
        const heightLineBetween = 2 * percentage(heightCard);
        const angleLineCenter = 40;
        const edge = heightCard / 2 * Math.tan(angleLineCenter * Math.PI / 180);
        if (line_color) {
            if (!isUrl(line_color)) {
                ctx.fillStyle = ctx.strokeStyle = checkGradientColor(ctx, Array.isArray(line_color) ? line_color : [line_color], xyAvatar - resizeAvatar / 2 - heightLineBetween, 0, xyAvatar + resizeAvatar / 2 + widthLineBetween + edge, 0);
                ctx.globalCompositeOperation = "source-over";
            }
            else {
                ctx.save();
                const img = Canvas.loadImage(line_color);
                ctx.globalCompositeOperation = "source-over";
                ctx.beginPath();
                ctx.arc(xyAvatar, xyAvatar, resizeAvatar / 2 + heightLineBetween, 0, 2 * Math.PI);
                ctx.fill();
                ctx.rect(xyAvatar + resizeAvatar / 2, heightCard / 2 - heightLineBetween / 2, widthLineBetween, heightLineBetween);
                ctx.fill();
                ctx.translate(xyAvatar + resizeAvatar / 2 + widthLineBetween + edge, 0);
                ctx.rotate(angleLineCenter * Math.PI / 180);
                ctx.rect(0, 0, heightLineBetween, 1000);
                ctx.fill();
                ctx.rotate(-angleLineCenter * Math.PI / 180);
                ctx.translate(-xyAvatar - resizeAvatar / 2 - widthLineBetween - edge, 0);
                ctx.clip();
                ctx.drawImage(await img, 0, 0, widthCard, heightCard);
                ctx.restore();
            }
        }
        ctx.beginPath();
        if (!isUrl(line_color))
            ctx.rect(xyAvatar + resizeAvatar / 2, heightCard / 2 - heightLineBetween / 2, widthLineBetween, heightLineBetween);
        ctx.fill();
        ctx.beginPath();
        if (!isUrl(line_color)) {
            ctx.moveTo(xyAvatar + resizeAvatar / 2 + widthLineBetween + edge, 0);
            ctx.lineTo(xyAvatar + resizeAvatar / 2 + widthLineBetween - edge, heightCard);
            ctx.lineWidth = heightLineBetween;
            ctx.stroke();
        }
        ctx.beginPath();
        if (!isUrl(line_color))
            ctx.arc(xyAvatar, xyAvatar, resizeAvatar / 2 + heightLineBetween, 0, 2 * Math.PI);
        ctx.fill();
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillRect(0, 0, widthCard, alignRim);
        ctx.fillRect(0, heightCard - alignRim, widthCard, alignRim);
        const radius = 6 * percentage(heightCard);
        const xStartExp = (25 + 1.5) * percentage(widthCard), yStartExp = 67 * percentage(heightCard), widthExp = 40.5 * percentage(widthCard), heightExp = radius * 2;
        ctx.globalCompositeOperation = "source-over";
        centerImage(ctx, await Canvas.loadImage(avatar), xyAvatar, xyAvatar, resizeAvatar, resizeAvatar);
        if (!isUrl(expNextLevel_color)) {
            ctx.beginPath();
            ctx.fillStyle = checkGradientColor(ctx, expNextLevel_color, xStartExp, yStartExp, xStartExp + widthExp, yStartExp);
            ctx.arc(xStartExp, yStartExp + radius, radius, 1.5 * Math.PI, 0.5 * Math.PI, true);
            ctx.fill();
            ctx.fillRect(xStartExp, yStartExp, widthExp, heightExp);
            ctx.arc(xStartExp + widthExp, yStartExp + radius, radius, 1.5 * Math.PI, 0.5 * Math.PI, false);
            ctx.fill();
        }
        else {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(xStartExp, yStartExp);
            ctx.lineTo(xStartExp + widthExp, yStartExp);
            ctx.arcTo(xStartExp + widthExp + radius, yStartExp, xStartExp + widthExp + radius, yStartExp + radius, radius);
            ctx.lineTo(xStartExp + widthExp + radius, yStartExp + heightExp - radius);
            ctx.arcTo(xStartExp + widthExp + radius, yStartExp + heightExp, xStartExp + widthExp, yStartExp + heightExp, radius);
            ctx.lineTo(xStartExp, yStartExp + heightExp);
            ctx.arcTo(xStartExp, yStartExp + heightExp, xStartExp - radius, yStartExp + heightExp - radius, radius);
            ctx.lineTo(xStartExp - radius, yStartExp + radius);
            ctx.arcTo(xStartExp, yStartExp, xStartExp, yStartExp, radius);
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(await Canvas.loadImage(expNextLevel_color), xStartExp, yStartExp, widthExp + radius, heightExp);
            ctx.restore();
        }
        const widthExpCurrent = (100 / expNextLevel * exp) * percentage(widthExp);
        if (!isUrl(exp_color)) {
            ctx.fillStyle = checkGradientColor(ctx, exp_color, xStartExp, yStartExp, xStartExp + widthExp, yStartExp);
            ctx.beginPath();
            ctx.arc(xStartExp, yStartExp + radius, radius, 1.5 * Math.PI, 0.5 * Math.PI, true);
            ctx.fill();
            ctx.fillRect(xStartExp, yStartExp, widthExpCurrent, heightExp);
            ctx.beginPath();
            ctx.arc(xStartExp + widthExpCurrent - 1, yStartExp + radius, radius, 1.5 * Math.PI, 0.5 * Math.PI);
            ctx.fill();
        }
        else {
            const imgExp = await Canvas.loadImage(exp_color);
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(xStartExp, yStartExp);
            ctx.lineTo(xStartExp + widthExpCurrent, yStartExp);
            ctx.arc(xStartExp + widthExpCurrent, yStartExp + radius, radius, 1.5 * Math.PI, 0.5 * Math.PI, false);
            ctx.lineTo(xStartExp + widthExpCurrent + radius, yStartExp + heightExp - radius);
            ctx.arcTo(xStartExp + widthExpCurrent + radius, yStartExp + heightExp, xStartExp + widthExpCurrent, yStartExp + heightExp, radius);
            ctx.lineTo(xStartExp, yStartExp + heightExp);
            ctx.arc(xStartExp, yStartExp + radius, radius, 1.5 * Math.PI, 0.5 * Math.PI, true);
            ctx.lineTo(xStartExp - radius, yStartExp + radius);
            ctx.arc(xStartExp, yStartExp + radius, radius, 1.5 * Math.PI, 0.5 * Math.PI, true);
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(imgExp, xStartExp - radius, yStartExp, widthExp + radius * 2, heightExp);
            ctx.restore();
        }
        const maxSizeFont_Name = 4 * percentage(widthCard) + this.textSize;
        const maxSizeFont_Exp = 2 * percentage(widthCard) + this.textSize;
        const maxSizeFont_Level = 3.25 * percentage(widthCard) + this.textSize;
        const maxSizeFont_Rank = 4 * percentage(widthCard) + this.textSize;
        ctx.textAlign = "end";
        ctx.font = autoSizeFont(18.4 * percentage(widthCard), maxSizeFont_Rank, rank, ctx, this.fontName);
        const metricsRank = ctx.measureText(rank);
        ctx.fillStyle = checkGradientColor(ctx, rank_color || text_color, 94 * percentage(widthCard) - metricsRank.width, 76 * percentage(heightCard) + metricsRank.emHeightDescent, 94 * percentage(widthCard), 76 * percentage(heightCard) - metricsRank.actualBoundingBoxAscent);
        ctx.fillText(rank, 94 * percentage(widthCard), 76 * percentage(heightCard));
        const textLevel = `Lv ${level}`;
        ctx.font = autoSizeFont(9.8 * percentage(widthCard), maxSizeFont_Level, textLevel, ctx, this.fontName);
        const metricsLevel = ctx.measureText(textLevel);
        const xStartLevel = 94 * percentage(widthCard);
        const yStartLevel = 32 * percentage(heightCard);
        ctx.fillStyle = checkGradientColor(ctx, level_color || text_color, xStartLevel - ctx.measureText(textLevel).width, yStartLevel + metricsLevel.emHeightDescent, xStartLevel, yStartLevel - metricsLevel.actualBoundingBoxAscent);
        ctx.fillText(textLevel, xStartLevel, yStartLevel);
        ctx.font = autoSizeFont(52.1 * percentage(widthCard), maxSizeFont_Name, name, ctx, this.fontName);
        ctx.textAlign = "center";
        const metricsName = ctx.measureText(name);
        ctx.fillStyle = checkGradientColor(ctx, name_color || text_color, 47.5 * percentage(widthCard) - metricsName.width / 2, 40 * percentage(heightCard) + metricsName.emHeightDescent, 47.5 * percentage(widthCard) + metricsName.width / 2, 40 * percentage(heightCard) - metricsName.actualBoundingBoxAscent);
        ctx.fillText(name, 47.5 * percentage(widthCard), 40 * percentage(heightCard));
        const textExp = `Exp ${exp}/${expNextLevel}`;
        ctx.font = autoSizeFont(49 * percentage(widthCard), maxSizeFont_Exp, textExp, ctx, this.fontName);
        const metricsExp = ctx.measureText(textExp);
        ctx.fillStyle = checkGradientColor(ctx, exp_text_color || text_color, 47.5 * percentage(widthCard) - metricsExp.width / 2, 61.4 * percentage(heightCard) + metricsExp.emHeightDescent, 47.5 * percentage(widthCard) + metricsExp.width / 2, 61.4 * percentage(heightCard) - metricsExp.actualBoundingBoxAscent);
        ctx.fillText(textExp, 47.5 * percentage(widthCard), 61.4 * percentage(heightCard));
        ctx.globalCompositeOperation = "destination-over";
        if (main_color.match?.(/^https?:\/\//) || Buffer.isBuffer(main_color)) {
            ctx.beginPath();
            ctx.moveTo(radius, 0);
            ctx.lineTo(widthCard - radius, 0);
            ctx.quadraticCurveTo(widthCard, 0, widthCard, radius);
            ctx.lineTo(widthCard, heightCard - radius);
            ctx.quadraticCurveTo(widthCard, heightCard, widthCard - radius, heightCard);
            ctx.lineTo(radius, heightCard);
            ctx.quadraticCurveTo(0, heightCard, 0, heightCard - radius);
            ctx.lineTo(0, radius);
            ctx.quadraticCurveTo(0, 0, radius, 0);
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(await Canvas.loadImage(main_color), 0, 0, widthCard, heightCard);
        }
        else {
            ctx.fillStyle = checkGradientColor(ctx, main_color, 0, 0, widthCard, heightCard);
            drawSquareRounded(ctx, 0, 0, widthCard, heightCard, radius, main_color);
        }
        return canvas.createPNGStream();
    }
}
async function checkColorOrImageAndDraw(xStart, yStart, width, height, ctx, colorOrImage, r) {
    if (!colorOrImage.match?.(/^https?:\/\//)) {
        if (Array.isArray(colorOrImage)) {
            const gradient = ctx.createLinearGradient(xStart, yStart, xStart + width, yStart + height);
            colorOrImage.forEach((color, index) => {
                gradient.addColorStop(index / (colorOrImage.length - 1), color);
            });
            ctx.fillStyle = gradient;
        }
        drawSquareRounded(ctx, xStart, yStart, width, height, r, colorOrImage);
    }
    else {
        const imageLoad = await Canvas.loadImage(colorOrImage);
        ctx.save();
        roundedImage(xStart, yStart, width, height, r, ctx);
        ctx.clip();
        ctx.drawImage(imageLoad, xStart, yStart, width, height);
        ctx.restore();
    }
}
function drawSquareRounded(ctx, x, y, w, h, r, color, defaultGlobalCompositeOperation, notChangeColor) {
    ctx.save();
    if (defaultGlobalCompositeOperation)
        ctx.globalCompositeOperation = "source-over";
    if (w < 2 * r)
        r = w / 2;
    if (h < 2 * r)
        r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    if (!notChangeColor)
        ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
}
function roundedImage(x, y, width, height, radius, ctx) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}
function centerImage(ctx, img, xCenter, yCenter, w, h) {
    const x = xCenter - w / 2;
    const y = yCenter - h / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(xCenter, yCenter, w / 2, 0, 2 * Math.PI);
    ctx.clip();
    ctx.closePath();
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
}
function autoSizeFont(maxWidthText, maxSizeFont, text, ctx, fontName) {
    let sizeFont = 0;
    while (true) {
        sizeFont += 1;
        ctx.font = sizeFont + "px " + fontName;
        const widthText = ctx.measureText(text).width;
        if (widthText > maxWidthText || sizeFont > maxSizeFont)
            break;
    }
    return sizeFont + "px " + fontName;
}
function checkGradientColor(ctx, color, x1, y1, x2, y2) {
    if (Array.isArray(color)) {
        const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
        color.forEach((c, index) => {
            gradient.addColorStop(index / (color.length - 1), c);
        });
        return gradient;
    }
    else {
        return color;
    }
}
function isUrl(string) {
    try {
        new URL(string);
        return true;
    }
    catch (err) {
        return false;
    }
}
function checkFormatColor(color, enableUrl = true) {
    if (!/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color) &&
        !/^rgb\((\d{1,3}), (\d{1,3}), (\d{1,3})\)$/.test(color) &&
        !/^rgba\((\d{1,3}), (\d{1,3}), (\d{1,3}), (\d{1,3})\)$/.test(color) &&
        (enableUrl ? !isUrl(color) : true) &&
        !Array.isArray(color))
        throw new Error(`The color format must be a hex, rgb, rgba ${enableUrl ? ", url image" : ""} or an array of colors`);
}
