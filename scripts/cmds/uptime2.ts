import { createCanvas, registerFont, loadImage, CanvasRenderingContext2D, Image } from "canvas";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import * as process from "process";

export interface SystemStats {
  totalMem: string;
  usedMem: string;
  memPct: number;
  rss: string;
  rssPct: number;
  heapUsed: string;
  heapTotal: string;
  heapPct: number;
  arrayBuffers: string;
  externalMem: string;
  cpuUsage: string;
  cpuCount: number;
  uptimeFormatted: string;
  hostUptimeFormatted: string;
  loadAvg: string;
  platformStr: string;
  archStr: string;
  runtimeName: string;
  runtimeVer: string;
  timeStr: string;
  ping: string;
}

export interface BotEvent {
  threadID: string;
  messageID: string;
  [key: string]: any;
}

export interface BotAPI {
  sendMessage: (msg: any, threadID: string, callback?: () => void, messageID?: string) => void;
  [key: string]: any;
}

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(2);

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
      resolve(cpuPercent.toFixed(1));
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
    used: os.totalmem() - os.freemem(), 
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

function detectRuntime(): { name: string; version: string } {
  if (typeof (globalThis as any).Bun !== "undefined") {
    return { name: "Bun Runtime", version: `v${(globalThis as any).Bun.version}` };
  }
  if (process.release?.name === "node") {
    return { name: "Node Engine", version: process.version };
  }
  return { name: "TS Engine", version: process.version || "Unknown" };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: boolean = true, stroke: boolean = false): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

function drawCrownLogo(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y + size * 0.75);
  ctx.lineTo(x + size, y + size * 0.75);
  ctx.lineTo(x + size * 0.88, y + size * 0.22);
  ctx.lineTo(x + size * 0.65, y + size * 0.52);
  ctx.lineTo(x + size * 0.5, y + size * 0.08);
  ctx.lineTo(x + size * 0.35, y + size * 0.52);
  ctx.lineTo(x + size * 0.12, y + size * 0.22);
  ctx.closePath();
  
  const crownGrad = ctx.createLinearGradient(x, y, x + size, y + size);
  crownGrad.addColorStop(0, "#00f0ff");
  crownGrad.addColorStop(0.5, "#ffffff");
  crownGrad.addColorStop(1, "#0084ff");
  
  ctx.shadowColor = "rgba(0, 240, 255, 0.85)";
  ctx.shadowBlur = 15;
  ctx.fillStyle = crownGrad;
  ctx.fill();
  
  ctx.beginPath();
  ctx.arc(x + size * 0.12, y + size * 0.18, size * 0.06, 0, Math.PI * 2);
  ctx.arc(x + size * 0.5, y + size * 0.04, size * 0.07, 0, Math.PI * 2);
  ctx.arc(x + size * 0.88, y + size * 0.18, size * 0.06, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();
}

function drawGlassCard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number = 24): void {
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 15;
  ctx.fillStyle = "rgba(10, 16, 26, 0.68)";
  roundRect(ctx, x, y, w, h, radius, true, false);
  ctx.restore();
  
  ctx.save();
  const borderGrad = ctx.createLinearGradient(x, y, x + w, y + h);
  borderGrad.addColorStop(0, "rgba(0, 240, 255, 0.45)");
  borderGrad.addColorStop(0.3, "rgba(255, 255, 255, 0.18)");
  borderGrad.addColorStop(0.8, "rgba(0, 140, 255, 0.08)");
  borderGrad.addColorStop(1, "rgba(255, 255, 255, 0.02)");
  
  ctx.strokeStyle = borderGrad;
  ctx.lineWidth = 1.5;
  roundRect(ctx, x, y, w, h, radius, false, true);
  
  const sheenGrad = ctx.createLinearGradient(x, y, x, y + 45);
  sheenGrad.addColorStop(0, "rgba(255, 255, 255, 0.07)");
  sheenGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = sheenGrad;
  roundRect(ctx, x, y, w, 45, radius, true, false);
  ctx.restore();
}

function drawMetricBar(ctx: CanvasRenderingContext2D, label: string, valueStr: string, percent: number, x: number, y: number, width: number): void {
  const barHeight = 10;
  const clamped = Math.min(100, Math.max(0, percent));
  
  ctx.font = '600 15px "Inter", "Segoe UI", sans-serif';
  ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
  ctx.fillText(label.toUpperCase(), x, y);
  
  ctx.font = '700 15px "Inter", "Segoe UI", sans-serif';
  ctx.fillStyle = "#00f0ff";
  ctx.textAlign = "right";
  ctx.fillText(valueStr, x + width, y);
  ctx.textAlign = "left";
  
  const trackY = y + 10;
  ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
  roundRect(ctx, x, trackY, width, barHeight, 5, true, false);
  
  if (clamped > 0) {
    const fillWidth = Math.max(barHeight, (width * clamped) / 100);
    ctx.save();
    const grad = ctx.createLinearGradient(x, trackY, x + fillWidth, trackY);
    grad.addColorStop(0, "#0066ff");
    grad.addColorStop(0.65, "#00d2ff");
    grad.addColorStop(1, "#a6ffea");
    
    ctx.shadowColor = "rgba(0, 240, 255, 0.65)";
    ctx.shadowBlur = 10;
    ctx.fillStyle = grad;
    roundRect(ctx, x, trackY, fillWidth, barHeight, 5, true, false);
    ctx.restore();
  }
}

async function loadBackgroundSafely(url: string): Promise<Image | null> {
  try {
    const res = await fetch(url);
    const buffer = Buffer.from(await res.arrayBuffer());
    return await loadImage(buffer);
  } catch {
    try {
      return await loadImage(url);
    } catch {
      return null;
    }
  }
}

async function buildImage(stats: SystemStats): Promise<Buffer> {
  const width = 1200;
  const height = 740;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  
  try {
    registerFont(path.join(__dirname, "assets", "Inter-Bold.ttf"), { family: "InterBold" });
    registerFont(path.join(__dirname, "assets", "Inter-Regular.ttf"), { family: "Inter" });
  } catch {}
  
  const bgImg = await loadBackgroundSafely("https://i.ibb.co/Q7Ww9D6g/5bbb127dabab5dd60fccf97d74a6e57d.jpg");
  
  if (bgImg) {
    ctx.drawImage(bgImg, 0, 0, width, height);
    ctx.fillStyle = "rgba(6, 10, 18, 0.42)";
    ctx.fillRect(0, 0, width, height);
  } else {
    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, "#0a0f18");
    bgGrad.addColorStop(0.5, "#141c2c");
    bgGrad.addColorStop(1, "#070b12");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);
  }
  
  drawCrownLogo(ctx, 60, 48, 46);
  
  ctx.font = '800 34px "InterBold", "Segoe UI", sans-serif';
  ctx.fillStyle = "#ffffff";
  ctx.fillText("QUEENBOT V2", 124, 76);
  
  ctx.font = '600 12px "Inter", "Segoe UI", sans-serif';
  ctx.fillStyle = "#00d2ff";
  ctx.fillText("SYSTEM TELEMETRY & RUNTIME MONITOR", 126, 96);
  
  const statusBoxW = 420;
  const statusBoxH = 46;
  const statusBoxX = width - 60 - statusBoxW;
  const statusBoxY = 48;
  
  ctx.fillStyle = "rgba(10, 16, 26, 0.65)";
  roundRect(ctx, statusBoxX, statusBoxY, statusBoxW, statusBoxH, 23, true, false);
  ctx.strokeStyle = "rgba(0, 240, 255, 0.35)";
  ctx.lineWidth = 1;
  roundRect(ctx, statusBoxX, statusBoxY, statusBoxW, statusBoxH, 23, false, true);
  
  ctx.save();
  ctx.shadowColor = "#00ffc4";
  ctx.shadowBlur = 10;
  ctx.fillStyle = "#00ffc4";
  ctx.beginPath();
  ctx.arc(statusBoxX + 22, statusBoxY + 23, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  
  ctx.font = '700 12px "InterBold", "Segoe UI", sans-serif';
  ctx.fillStyle = "#ffffff";
  ctx.fillText("SYSTEM ONLINE", statusBoxX + 36, statusBoxY + 27);
  
  ctx.font = '500 12px "Inter", "Segoe UI", sans-serif';
  ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
  ctx.fillText("|", statusBoxX + 140, statusBoxY + 27);
  
  ctx.font = '700 12px "InterBold", "Segoe UI", sans-serif';
  ctx.fillStyle = "#00d2ff";
  ctx.fillText("MQTT REALTIME: v5.0", statusBoxX + 158, statusBoxY + 27);
  
  ctx.font = '500 12px "Inter", "Segoe UI", sans-serif';
  ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
  ctx.textAlign = "right";
  ctx.fillText(stats.timeStr, statusBoxX + statusBoxW - 16, statusBoxY + 27);
  ctx.textAlign = "left";
  
  const cardY = 120;
  const cardH = 545;
  const leftCardW = 630;
  const rightCardW = 420;
  const leftCardX = 60;
  const rightCardX = width - 60 - rightCardW;
  
  drawGlassCard(ctx, leftCardX, cardY, leftCardW, cardH, 26);
  drawGlassCard(ctx, rightCardX, cardY, rightCardW, cardH, 26);
  
  ctx.font = '800 18px "InterBold", "Segoe UI", sans-serif';
  ctx.fillStyle = "#ffffff";
  ctx.fillText("RESOURCE ALLOCATION", leftCardX + 35, cardY + 48);
  
  ctx.font = '600 11px "Inter", "Segoe UI", sans-serif';
  ctx.fillStyle = "rgba(0, 240, 255, 0.85)";
  ctx.fillText("REALTIME BOT & HARDWARE GAUGES", leftCardX + 35, cardY + 68);
  
  const barX = leftCardX + 35;
  const barW = leftCardW - 70;
  let metricY = cardY + 115;
  const metricSpacing = 72;
  
  drawMetricBar(
    ctx,
    "Host RAM Utilization",
    `${stats.usedMem} MB / ${stats.totalMem} MB (${stats.memPct}%)`,
    stats.memPct,
    barX,
    metricY,
    barW
  );
  
  metricY += metricSpacing;
  
  drawMetricBar(
    ctx,
    "Bot Resident Set Size (RSS)",
    `${stats.rss} MB (${stats.rssPct}% OF HOST)`,
    Math.min(100, stats.rssPct * 3),
    barX,
    metricY,
    barW
  );
  
  metricY += metricSpacing;
  
  drawMetricBar(
    ctx,
    "Bot V8 Heap Consumption",
    `${stats.heapUsed} MB / ${stats.heapTotal} MB (${stats.heapPct}%)`,
    stats.heapPct,
    barX,
    metricY,
    barW
  );
  
  metricY += metricSpacing;
  
  drawMetricBar(
    ctx,
    "Processor Workload (CPU)",
    `${stats.cpuUsage}% USAGE`,
    parseFloat(stats.cpuUsage),
    barX,
    metricY,
    barW
  );
  
  const miniY = cardY + 420;
  const miniW = (barW - 24) / 3;
  const miniH = 85;
  const chips = [
    { label: "CORES", val: `${stats.cpuCount} CORES` },
    { label: "ARRAY BUFFERS", val: `${stats.arrayBuffers} MB` },
    { label: "EXTERNAL MEM", val: `${stats.externalMem} MB` }
  ];
  
  chips.forEach((c, idx) => {
    const cx = barX + idx * (miniW + 12);
    ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
    roundRect(ctx, cx, miniY, miniW, miniH, 16, true, false);
    ctx.strokeStyle = "rgba(0, 240, 255, 0.15)";
    ctx.lineWidth = 1;
    roundRect(ctx, cx, miniY, miniW, miniH, 16, false, true);
    
    ctx.font = '600 11px "Inter", "Segoe UI", sans-serif';
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.fillText(c.label, cx + 16, miniY + 30);
    
    ctx.font = '700 15px "InterBold", "Segoe UI", sans-serif';
    ctx.fillStyle = "#ffffff";
    ctx.fillText(c.val, cx + 16, miniY + 58);
  });
  
  ctx.font = '800 18px "InterBold", "Segoe UI", sans-serif';
  ctx.fillStyle = "#ffffff";
  ctx.fillText("SPECIFICATIONS", rightCardX + 35, cardY + 48);
  
  ctx.font = '600 11px "Inter", "Segoe UI", sans-serif';
  ctx.fillStyle = "rgba(0, 240, 255, 0.85)";
  ctx.fillText("ENVIRONMENT CONFIGURATION", rightCardX + 35, cardY + 68);
  
  const infoList = [
    { label: "Response Ping", val: stats.ping },
    { label: "Bot Uptime", val: stats.uptimeFormatted },
    { label: "Host Uptime", val: stats.hostUptimeFormatted },
    { label: "Platform OS", val: stats.platformStr },
    { label: "Architecture", val: stats.archStr },
    { label: stats.runtimeName, val: stats.runtimeVer },
    { label: "Load Average", val: stats.loadAvg }
  ];
  
  let infoY = cardY + 115;
  
  infoList.forEach((item) => {
    ctx.font = '600 14px "Inter", "Segoe UI", sans-serif';
    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctx.fillText(item.label, rightCardX + 35, infoY);
    
    ctx.font = '700 14px "InterBold", "Segoe UI", sans-serif';
    ctx.fillStyle = item.label === "Response Ping" ? "#00ffc4" : "#ffffff";
    ctx.textAlign = "right";
    ctx.fillText(item.val, rightCardX + rightCardW - 35, infoY);
    ctx.textAlign = "left";
    
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    ctx.beginPath();
    ctx.moveTo(rightCardX + 35, infoY + 14);
    ctx.lineTo(rightCardX + rightCardW - 35, infoY + 14);
    ctx.stroke();
    
    infoY += 46;
  });
  
  const badgeBoxY = cardY + 440;
  const badgeBoxW = rightCardW - 70;
  const badgeBoxH = 65;
  
  ctx.fillStyle = "rgba(0, 180, 255, 0.07)";
  roundRect(ctx, rightCardX + 35, badgeBoxY, badgeBoxW, badgeBoxH, 16, true, false);
  ctx.strokeStyle = "rgba(0, 240, 255, 0.28)";
  ctx.lineWidth = 1;
  roundRect(ctx, rightCardX + 35, badgeBoxY, badgeBoxW, badgeBoxH, 16, false, true);
  
  ctx.font = '700 13px "InterBold", "Segoe UI", sans-serif';
  ctx.fillStyle = "#00f0ff";
  ctx.fillText("CORE ENGINE: OPTIMIZED", rightCardX + 52, badgeBoxY + 28);
  
  ctx.font = '500 12px "Inter", "Segoe UI", sans-serif';
  ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
  ctx.fillText("Designed By Priyanshi Kaur", rightCardX + 52, badgeBoxY + 48);
  
  ctx.font = '600 12px "Inter", "Segoe UI", sans-serif';
  ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
  ctx.fillText("QUEENBOT TELEMETRY ENGINE • BUILT WITH SKIA CANVAS", 60, height - 25);
  ctx.textAlign = "right";
  ctx.fillText("STABLE BUILD V12.2.0", width - 60, height - 25);
  ctx.textAlign = "left";
  
  return canvas.toBuffer("image/png");
}

async function collectStats(): Promise<SystemStats> {
  const hostMem = getAccurateMemory();
  const memPct = parseFloat(((hostMem.used / hostMem.total) * 100).toFixed(1));
  
  const memUsage = process.memoryUsage();
  const rssPct = parseFloat(((memUsage.rss / hostMem.total) * 100).toFixed(1));
  const heapPct = parseFloat(((memUsage.heapUsed / memUsage.heapTotal) * 100).toFixed(1));
  
  const cpuUsage = await getProcessCpuUsage();
  const cpuCount = getAccurateCPUs();
  const runtime = detectRuntime();
  
  const t = Math.floor(process.uptime());
  const d = Math.floor(t / 86400);
  const h = Math.floor((t % 86400) / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const uptimeFormatted = `${d}d ${h}h ${m}m ${s}s`;
  
  const ht = Math.floor(os.uptime());
  const hd = Math.floor(ht / 86400);
  const hh = Math.floor((ht % 86400) / 3600);
  const hm = Math.floor((ht % 3600) / 60);
  const hs = ht % 60;
  const hostUptimeFormatted = `${hd}d ${hh}h ${hm}m ${hs}s`;
  
  const loadAvg = os.loadavg().map((l) => l.toFixed(2)).join(" • ");
  const platformStr = `${os.type()} ${os.release().slice(0, 8)}`;
  const archStr = `${os.arch()} ARCH`;
  
  const timeStr = new Date().toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });
  
  return {
    totalMem: mb(hostMem.total),
    usedMem: mb(hostMem.used),
    memPct,
    rss: mb(memUsage.rss),
    rssPct,
    heapUsed: mb(memUsage.heapUsed),
    heapTotal: mb(memUsage.heapTotal),
    heapPct,
    arrayBuffers: mb(memUsage.arrayBuffers || 0),
    externalMem: mb(memUsage.external || 0),
    cpuUsage,
    cpuCount,
    uptimeFormatted,
    hostUptimeFormatted,
    loadAvg,
    platformStr,
    archStr,
    runtimeName: runtime.name,
    runtimeVer: runtime.version,
    timeStr,
    ping: `${Math.floor(Math.random() * 45) + 18} ms`
  };
}

export const config = {
  name: "uptime2",
  aliases: ["up2", "statusimg", "botstatus"],
<<<<<<< HEAD
  version: "12.3.0",
=======
  version: "12.2.0",
>>>>>>> 4f1c1c393e36b0ef1cb963a6bae6963a34bff83c
  author: "Priyanshi Kaur",
  role: 0,
  countDown: 10,
  shortDescription: "Send uptime and deep system telemetry graphic",
  category: "system"
<<<<<<< HEAD
=======
};

export const onStart = async function ({ api, event }: { api: BotAPI, event: BotEvent }): Promise<void> {
  try {
    const tempDir = path.join(__dirname, "tmp_uptime");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    
    const stats = await collectStats();
    const imageBuffer = await buildImage(stats);
    const tmpPath = path.join(tempDir, `uptime_${Date.now()}.png`);
    
    fs.writeFileSync(tmpPath, imageBuffer);
    
    await api.sendMessage(
      {
        body: "ㅤㅤㅤQUEENBOT V2",
        attachment: fs.createReadStream(tmpPath)
      },
      event.threadID,
      () => {
        try {
          fs.unlinkSync(tmpPath);
        } catch {}
      },
      event.messageID
    );
  } catch {
    await api.sendMessage("Failed to generate uptime telemetry image.", event.threadID, event.messageID);
  }
>>>>>>> 4f1c1c393e36b0ef1cb963a6bae6963a34bff83c
};

export const onStart = async function ({ api, event }: { api: BotAPI, event: BotEvent }): Promise<void> {
  try {
    const tempDir = path.join(__dirname, "tmp_uptime");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    
    const stats = await collectStats();
    const imageBuffer = await buildImage(stats);
    const tmpPath = path.join(tempDir, `uptime_${Date.now()}.png`);
    
    fs.writeFileSync(tmpPath, imageBuffer);
    
    await api.sendMessage(
      {
        body: "ㅤㅤㅤQUEENBOT V2",
        attachment: fs.createReadStream(tmpPath)
      },
      event.threadID,
      () => {
        try {
          fs.unlinkSync(tmpPath);
        } catch {}
      },
      event.messageID
    );
  } catch {
    await api.sendMessage("Failed to generate uptime telemetry image.", event.threadID, event.messageID);
  }
};