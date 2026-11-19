module.exports = {
    config: {
        name: "theme",
        aliases: ["settheme", "themes"],
        version: "2.0.0",
        author: "Priyanshi Kaur",
        role: 0,
        countDown: 5,
        category: "box chat",
        shortDescription: {
            en: "Change or list chat themes"
        },
        longDescription: {
            en: "View current theme, list available Messenger themes, or change theme by name/ID"
        },
        guide: {
            en: "{pn} list\n{pn} info\n{pn} set <themeID or themeName>"
        }
    },
    onStart: async function ({ api, args, message, event }) {
        const action = args[0]?.toLowerCase();
        if (action === "list" || action === "all") {
            if (typeof message.getThemes === "function") {
                await message.getThemes((err, themes) => {
                    if (err)
                        return message.reply("❌ Error fetching themes: " + (err.message || err));
                    const listStr = themes.map((t, idx) => `${idx + 1}. ${t.name} (ID: ${t.id})`).join("\n");
                    return message.reply(`🎨 Available Themes (${themes.length}):\n\n${listStr}\n\n👉 Use: theme set <themeID>`);
                });
            }
            else {
                return message.reply("Theme list is not supported by current FCA.");
            }
        }
        else if (action === "info" || action === "current") {
            if (typeof message.getTheme === "function") {
                await message.getTheme((err, theme) => {
                    if (err)
                        return message.reply("❌ Error getting current theme: " + (err.message || err));
                    return message.reply(`🎨 Current Thread Theme:\nColor: ${theme.color || "Default"}\nEmoji: ${theme.emoji || "None"}`);
                });
            }
            else {
                return message.reply("Theme info is not supported by current FCA.");
            }
        }
        else if (action === "set") {
            const themeTarget = args.slice(1).join(" ").trim();
            if (!themeTarget) {
                return message.reply("⚠️ Please provide a theme ID or name!\nExample: theme set 1936306543117456");
            }
            if (typeof message.changeTheme === "function") {
                await message.changeTheme(themeTarget, (err) => {
                    if (err)
                        return message.reply("❌ Failed to change theme: " + (err.message || err));
                    return message.reply(`✅ Successfully changed theme to ${themeTarget}!`);
                });
            }
            else {
                return message.reply("Theme change is not supported by current FCA.");
            }
        }
        else {
            return message.reply("🎨 Theme Commands:\n• theme list - View available themes\n• theme info - View current theme\n• theme set <themeID> - Change theme");
        }
    }
};
