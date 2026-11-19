const os = require("os");

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fmt(n: number) {
  return `${Math.round(n)} ms`;
}

async function rtt(url: string, timeoutMs = 5000): Promise<number> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(url, { method: "GET", signal: ctrl.signal });
    await res.arrayBuffer();
    return Date.now() - start;
  } finally {
    clearTimeout(t);
  }
}

function stats(arr: number[]) {
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
  const jitter = arr.map((x) => Math.abs(x - avg)).reduce((a, b) => a + b, 0) / arr.length;
  return { min, max, avg, jitter };
}

module.exports = {
  config: {
    name: "ping",
    version: "2.0.0",
    author: "Priyanshi Kaur",
    role: 0,
    countDown: 5,
    shortDescription: "Live network latency and server diagnostics",
    category: "system",
    guide: {
      en: "{p}ping"
    }
  },

  onStart: async function ({ api, message }: any) {
    const endpoints = [
      "https://www.google.com/generate_204",
      "https://1.1.1.1/",
      "https://cloudflare.com/cdn-cgi/trace"
    ];

    const pings: number[] = [];
    const msg = await message.reply("⏱️ Measuring ping and system response...");

    for (let i = 0; i < 3; i++) {
      const target = endpoints[i % endpoints.length];
      let ms: number;
      try {
        ms = await rtt(target);
      } catch {
        ms = NaN;
      }
      pings.push(Number.isFinite(ms) ? ms : 0);

      await api.editMessage(
        `🏓 Ping ${i + 1}/3\n` +
          `• Target: ${target}\n` +
          `• RTT: ${Number.isFinite(ms) ? fmt(ms) : "timeout"}\n` +
          `• Time: ${new Date().toLocaleTimeString()}`,
        msg.messageID
      );

      await sleep(1500);
    }

    const validPings = pings.map((x) => x || 0);
    const { min, max, avg, jitter } = stats(validPings.length > 0 ? validPings : [0]);
    const memTotal = os.totalmem();
    const memFree = os.freemem();
    const memUsed = memTotal - memFree;
    const toMB = (b: number) => (b / 1024 / 1024).toFixed(1) + " MB";
    const toPct = (a: number, b: number) => ((a / b) * 100).toFixed(1) + "%";
    const cpu = os.cpus()[0] || {};
    const load = os.loadavg();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

    await api.editMessage(
      `✅ QueenBot v3 Network & System Ping\n━━━━━━━━━━━━━━━━━━━━━\n` +
        `• Min: ${fmt(min)}\n` +
        `• Max: ${fmt(max)}\n` +
        `• Avg: ${fmt(avg)}\n` +
        `• Jitter: ${fmt(jitter)}\n\n` +
        `🖥️ System Information\n` +
        `• OS: ${os.platform()} ${os.release()} (${os.arch()})\n` +
        `• CPU: ${cpu.model || "Unknown"} x${os.cpus().length}\n` +
        `• Load: ${load.map((n: number) => n.toFixed(2)).join(" / ")}\n` +
        `• Memory: ${toMB(memUsed)} / ${toMB(memTotal)} (${toPct(memUsed, memTotal)})\n` +
        `• Timezone: ${tz}`,
      msg.messageID
    );
  }
};
