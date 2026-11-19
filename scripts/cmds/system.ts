const os = require("os");
const fs = require("fs");
const axios = require("axios");
const process = require("process");

function getProcessCpuUsage(): Promise<string> {
    return new Promise(resolve => {
        const startUsage = process.cpuUsage();
        const startTime = process.hrtime.bigint();
        setTimeout(() => {
            const elapUsage = process.cpuUsage(startUsage);
            const elapTime = process.hrtime.bigint() - startTime;
            const elapUser = elapUsage.user;
            const elapSystem = elapUsage.system;
            const cpuPercent = ((Number(elapUser + elapSystem) * 1000) / Number(elapTime)) * 100;
            resolve(cpuPercent.toFixed(1) + "%");
        }, 500);
    });
}

function getAccurateMemory(): { used: number; total: number } {
    try {
        if (fs.existsSync("/sys/fs/cgroup/memory.max")) {
            const max = fs.readFileSync("/sys/fs/cgroup/memory.max", "utf8").trim();
            const current = fs.readFileSync("/sys/fs/cgroup/memory.current", "utf8").trim();
            if (max !== "max") {
                return { used: parseInt(current), total: parseInt(max) };
            }
        }
        if (fs.existsSync("/sys/fs/cgroup/memory/memory.limit_in_bytes")) {
            const limit = fs.readFileSync("/sys/fs/cgroup/memory/memory.limit_in_bytes", "utf8").trim();
            const usage = fs.readFileSync("/sys/fs/cgroup/memory/memory.usage_in_bytes", "utf8").trim();
            if (parseInt(limit) < 9000000000000000000) {
                return { used: parseInt(usage), total: parseInt(limit) };
            }
        }
    } catch {}
    
    return { 
        used: process.memoryUsage().rss, 
        total: os.totalmem() 
    };
}

function getAccurateCPUs(): number {
    try {
        if (fs.existsSync("/sys/fs/cgroup/cpu.max")) {
            const parts = fs.readFileSync("/sys/fs/cgroup/cpu.max", "utf8").trim().split(" ");
            if (parts[0] !== "max") {
                return Math.ceil(parseInt(parts[0]) / parseInt(parts[1]));
            }
        }
        if (fs.existsSync("/sys/fs/cgroup/cpu/cpu.cfs_quota_us")) {
            const quota = parseInt(fs.readFileSync("/sys/fs/cgroup/cpu/cpu.cfs_quota_us", "utf8").trim());
            const period = parseInt(fs.readFileSync("/sys/fs/cgroup/cpu/cpu.cfs_period_us", "utf8").trim());
            if (quota > 0) {
                return Math.ceil(quota / period);
            }
        }
    } catch {}
    return os.cpus().length;
}

function formatBytes(bytes: number): string {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function detectRuntime(): { lang: string; version: string } {
    if (typeof (globalThis as any).Bun !== "undefined") {
        return { lang: "Bun.js", version: `v${(globalThis as any).Bun.version}` };
    }
    if (process.release?.name === "node") {
        return { lang: "Node.js", version: process.version };
    }
    return { lang: "TypeScript", version: "v3.0.0" };
}

async function getServerLocation() {
    try {
        const res = await axios.get("https://ipapi.co/json/", { timeout: 4000 });
        return { 
            ip: res.data.ip || "N/A", 
            city: res.data.city || "N/A", 
            region: res.data.region || "N/A", 
            country: res.data.country_name || "N/A", 
            org: res.data.org || "N/A" 
        };
    } catch {
        return { ip: "Hidden/Protected", city: "N/A", region: "N/A", country: "N/A", org: "N/A" };
    }
}

module.exports = {
    config: {
        name: "system",
        aliases: ["sys", "sysinfo"],
        author: "Priyanshi Kaur",
        version: "2.0.0",
        countDown: 5,
        role: 0,
        category: "system",
        shortDescription: "Get detailed system hardware and server metrics",
        guide: { en: "{p}system" }
    },
    onStart: async function ({ message, api }: any) {
        const checking = await message.reply("⚙️ Fetching system diagnostics...");
        
        const memStats = getAccurateMemory();
        const memPct = ((memStats.used / memStats.total) * 100).toFixed(1);
        const cpuUsage = await getProcessCpuUsage();
        const cpuCount = getAccurateCPUs();
        
        const runtime = detectRuntime();
        const location = await getServerLocation();
        
        const uptime = process.uptime();
        const days = Math.floor(uptime / 86400);
        const hours = Math.floor((uptime % 86400) / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);
        const uptimeFormatted = `${days}d ${hours}h ${minutes}m ${seconds}s`;
        
        const cpus = os.cpus();
        const cpuModel = cpus[0]?.model || "Unknown Processor";

        const report = `🖥️ SYSTEM SPECIFICATIONS\n━━━━━━━━━━━━━━━━━━━━━━\n` +
            `👑 Bot: QueenBot v3\n` +
            `⚡ Runtime: ${runtime.lang} ${runtime.version}\n` +
            `⏳ Uptime: ${uptimeFormatted}\n\n` +
            `💻 HARDWARE STATS\n` +
            `• CPU: ${cpuModel} (${cpuCount} cores)\n` +
            `• CPU Usage: ${cpuUsage}\n` +
            `• RAM: ${formatBytes(memStats.used)} / ${formatBytes(memStats.total)} (${memPct}% used)\n` +
            `• Platform: ${os.platform()} ${os.arch()} (${os.release()})\n\n` +
            `🌍 HOST LOCATION\n` +
            `• City: ${location.city}, ${location.region}\n` +
            `• Country: ${location.country}\n` +
            `• ISP/Org: ${location.org}`;

        await message.reply(report);

        if (checking && checking.messageID && api && api.unsendMessage) {
            try {
                await api.unsendMessage(checking.messageID);
            } catch {}
        }
    }
};
