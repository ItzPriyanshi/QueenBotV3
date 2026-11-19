const fs = require("fs");
const path = require("path");
const axios = require("axios");

function extractDomainUrl(text, domain) {
    if (!text || typeof text !== "string")
        return null;
    const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`https?:\\/\\/(?:www\\.)?${escaped}\\/[^\\s"'<>]+`, "i");
    const match = text.match(regex);
    if (!match)
        return null;
    let url = match[0];
    if (domain.toLowerCase() === "pastebin.com") {
        url = url.replace(/^https?:\/\/(?:www\.)?pastebin\.com\/(?!raw\/)([a-zA-Z0-9]+)/i, "https://pastebin.com/raw/$1");
    }
    return url;
}

module.exports = {
    config: {
        name: "cbin",
        version: "2.1.0",
        author: "LiANE || Priyanshi Kaur",
        countDown: 5,
        role: 2,
        shortDescription: { en: "Monitor Paste Services" },
        longDescription: { en: "Monitor and track various paste service links with advanced filtering" },
        category: "MONITOR",
        guide: {
            en: `
{pn} setup <destination_id> : Set destination for alerts
{pn} add <domain> : Add domain to monitor
{pn} remove <domain> : Remove domain from monitoring
{pn} list : List monitored domains
{pn} stats : View monitoring statistics
{pn} blacklist <keyword> : Add keyword to blacklist
{pn} whitelist <keyword> : Add keyword to whitelist
{pn} clear : Clear monitoring history`
        }
    },
    onLoad: function () {
        const configPath = path.join(__dirname, "paste_monitor_config.json");
        if (!fs.existsSync(configPath)) {
            const defaultConfig = {
                destinations: [],
                monitoredDomains: [
                    "pastebin.com",
                    "hastebin.com",
                    "ghostbin.co",
                    "pastie.org",
                    "dpaste.com",
                    "paste.debian.net",
                    "paste.ubuntu.com"
                ],
                blacklistedKeywords: [],
                whitelistedKeywords: [],
                statistics: {
                    totalAlerts: 0,
                    domainHits: {},
                    lastReset: new Date().toISOString()
                }
            };
            fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
        }
    },
    loadConfig: function () {
        const configPath = path.join(__dirname, "paste_monitor_config.json");
        if (!fs.existsSync(configPath)) {
            this.onLoad();
        }
        try {
            return JSON.parse(fs.readFileSync(configPath, "utf8"));
        }
        catch (e) {
            return {
                destinations: [],
                monitoredDomains: ["pastebin.com"],
                blacklistedKeywords: [],
                whitelistedKeywords: [],
                statistics: { totalAlerts: 0, domainHits: {}, lastReset: new Date().toISOString() }
            };
        }
    },
    saveConfig: function (config) {
        const configPath = path.join(__dirname, "paste_monitor_config.json");
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    },
    async fetchPasteContent(url) {
        if (!url || typeof url !== "string")
            return null;
        try {
            const response = await axios.get(url, {
                responseType: "text",
                timeout: 10000,
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                }
            });
            if (response.data === undefined || response.data === null)
                return null;
            return typeof response.data === "string" ? response.data : JSON.stringify(response.data);
        }
        catch (error) {
            return null;
        }
    },
    generateAlert: function (data) {
        const timestamp = new Date().toLocaleString();
        const contentStr = typeof data.content === "string" ? data.content : "";
        return `🚨 PASTE SERVICE ALERT
⏰ Time: ${timestamp}
👤 From: ${data.name}
🆔 UID: ${data.senderID}
💭 Thread: ${data.threadName}
📌 GCID: ${data.threadID}
🔗 Domain: ${data.domain}
${contentStr ? `📝 Content Preview:
${contentStr.slice(0, 500)}${contentStr.length > 500 ? "..." : ""}` : ""}
🔍 Analysis:
${data.analysis}`;
    },
    analyzePaste: function (content, config) {
        const analysis = [];
        const text = typeof content === "string" ? content : "";
        if (text) {
            (config.blacklistedKeywords || []).forEach(keyword => {
                if (text.toLowerCase().includes(String(keyword).toLowerCase())) {
                    analysis.push(`⚠️ Contains blacklisted keyword: ${keyword}`);
                }
            });
            if (text.includes("password") || text.includes("credentials")) {
                analysis.push("⚠️ Potential sensitive information detected");
            }
            if (text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
                analysis.push("📧 Contains email addresses");
            }
            if (text.match(/\b\d{16}\b/g)) {
                analysis.push("💳 Contains potential card numbers");
            }
        }
        return analysis.length > 0 ? analysis.join("\n") : "No suspicious content detected";
    },
    onStart: async function ({ args, message }) {
        const config = this.loadConfig();
        const command = args[0];
        const param = args.slice(1).join(" ");
        switch (command) {
            case "setup":
                if (!param || isNaN(param)) {
                    return message.reply("❌ Please provide a valid destination ID");
                }
                if (!config.destinations.includes(param))
                    config.destinations.push(param);
                this.saveConfig(config);
                return message.reply("✅ Destination added successfully");
            case "add":
                if (!param)
                    return message.reply("❌ Please provide a domain");
                if (!config.monitoredDomains.includes(param))
                    config.monitoredDomains.push(param);
                this.saveConfig(config);
                return message.reply(`✅ Added ${param} to monitored domains`);
            case "remove":
                if (!param)
                    return message.reply("❌ Please provide a domain");
                config.monitoredDomains = config.monitoredDomains.filter(d => d !== param);
                this.saveConfig(config);
                return message.reply(`✅ Removed ${param} from monitored domains`);
            case "list":
                return message.reply(`📋 Monitored Domains:\n${config.monitoredDomains.join("\n")}`);
            case "stats":
                return message.reply(`📊 Monitoring Statistics:
Total Alerts: ${config.statistics.totalAlerts}
Domain Hits: ${Object.entries(config.statistics.domainHits).map(([domain, hits]) => `\n${domain}: ${hits}`).join("")}
Last Reset: ${new Date(config.statistics.lastReset).toLocaleString()}`);
            case "blacklist":
                if (!param)
                    return message.reply("❌ Please provide a keyword");
                config.blacklistedKeywords.push(param);
                this.saveConfig(config);
                return message.reply(`✅ Added "${param}" to blacklist`);
            case "whitelist":
                if (!param)
                    return message.reply("❌ Please provide a keyword");
                config.whitelistedKeywords.push(param);
                this.saveConfig(config);
                return message.reply(`✅ Added "${param}" to whitelist`);
            case "clear":
                config.statistics = {
                    totalAlerts: 0,
                    domainHits: {},
                    lastReset: new Date().toISOString()
                };
                this.saveConfig(config);
                return message.reply("✅ Statistics cleared");
            default:
                return message.reply(`⚠️ Paste Monitor Guide:
Use the following commands:
cbin setup <destination_id>
cbin add <domain>
cbin remove <domain>
cbin list
cbin stats
cbin blacklist <keyword>
cbin whitelist <keyword>
cbin clear`);
        }
    },
    onChat: async function ({ api, usersData, threadsData, event, isUserCallCommand, prefix }) {
        if (!event || typeof event.body !== "string")
            return;
        const chat = event.body.trim();
        if (!chat || isUserCallCommand)
            return;
        const threadPrefix = prefix || (global.utils?.getPrefix ? global.utils.getPrefix(event.threadID) : ".");
        if (threadPrefix && chat.startsWith(threadPrefix))
            return;
        if (chat.includes("🚨 PASTE SERVICE ALERT"))
            return;

        const config = this.loadConfig();
        for (const domain of config.monitoredDomains || []) {
            const targetUrl = extractDomainUrl(chat, domain);
            if (targetUrl) {
                config.statistics.totalAlerts++;
                config.statistics.domainHits[domain] = (config.statistics.domainHits[domain] || 0) + 1;
                this.saveConfig(config);
                const data = usersData?.get ? await usersData.get(event.senderID).catch(() => null) : null;
                const thread = threadsData?.get ? await threadsData.get(event.threadID).catch(() => null) : null;
                const pasteContent = await this.fetchPasteContent(targetUrl);
                const analysis = this.analyzePaste(pasteContent, config);
                const alertData = {
                    name: data?.name || event.senderID || "Unknown",
                    senderID: event.senderID,
                    threadName: thread?.threadName || event.threadID || "Unknown",
                    threadID: event.threadID,
                    domain: domain,
                    content: pasteContent,
                    analysis: analysis
                };
                const alert = this.generateAlert(alertData);
                for (const destination of config.destinations || []) {
                    if (destination)
                        api.sendMessage(alert, destination);
                }
                api.setMessageReaction("🚨", event.messageID, () => { }, true);
            }
        }
    }
};