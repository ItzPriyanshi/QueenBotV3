<div align="center">

# 👑 QueenBot v3

<p align="center">
  <b>High-Performance Facebook Messenger Bot Framework Powered by TypeScript & 100% Bun.js Native Execution</b>
</p>

[![Bun](https://img.shields.io/badge/Bun-v1.0+-FBF0DF?style=for-the-badge&logo=bun&logoColor=black)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Version](https://img.shields.io/badge/Version-3.1.0-8A2BE2?style=for-the-badge)](https://github.com/ItzPriyanshi/QueenBotV2)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)
[![Author](https://img.shields.io/badge/Author-Priyanshi%20Kaur-FF69B4?style=for-the-badge)](https://github.com/ItzPriyanshi)

</div>

---

## 🌟 Overview

**QueenBot v3** is a complete, modernized Facebook Messenger bot designed from the ground up for extreme speed, rock-solid stability, and simplicity. Rewritten entirely in **TypeScript** and optimized for **Bun.js**, QueenBot v3 drops legacy bloat, eliminates outdated dependencies, and delivers seamless End-to-End Encryption (E2EE) support for modern Facebook Messenger chats.

---

## ⚡ Key Highlights & What's New in v3.0.0

- 🚀 **100% Bun.js & TypeScript Native**: Run directly with `bun start` without compilation steps. Near-instant sub-second boot times and minimal RAM usage.
- 🔐 **Modern Signal Protocol / E2EE Support**: Built on top of the next-generation `fca-nx` engine. Automatically connects to Facebook's Noise WebSocket to send and receive messages in End-to-End Encrypted (E2EE) chats and DMs without dropping connections.
- 🚫 **Zero Credential Headaches**: Completely eliminated all OAuth2, Google Client ID, Gmail API, and Nodemailer requirements. The bot connects cleanly using just your standard `appState.json` or cookie string.
- 🎵 **Direct Song Search by Name**: Play and stream music clips instantly with `.music <song name>` (e.g. `.music high rated gabru`) without needing track IDs or complex keywords.
- 🎨 **Messenger Theme Customization**: Dynamically explore thread themes and update chat aesthetics on the fly via `.theme`.
- 🛡️ **Anti-Ban Sequential Queue**: Integrated 300ms throttling queue prevents Facebook rate-limits, spam triggers, and temporary action blocks.
- 🎛️ **Modern Web Management Dashboard**: Built-in lightweight dashboard to monitor uptime, chat statistics, and reload commands in real-time.
- 🧹 **Clean TypeScript Codebase**: All 71+ commands and 7+ events ported to clean TypeScript (`.ts`) with zero legacy clutter.

---

## 📁 Repository Structure

```
Project-QueenBotV2/
├── bot/
│   ├── handler/
│   │   ├── handlerAction.ts      # Main event router & lifecycle dispatcher
│   │   ├── handlerCheckData.ts   # Database user/thread synchronization
│   │   └── handlerEvents.ts      # Command executor, cooldowns & permissions
│   ├── login/
│   │   ├── login.ts              # FCA authentication & connection manager
│   │   ├── loadData.ts           # Database initialization (SQLite / JSON)
│   │   ├── loadScripts.ts        # Dynamic command loader & hot reloader
│   │   └── checkLiveCookie.ts    # Session validator
│   └── autoUptime.ts             # 24/7 keepalive pinger
├── scripts/
│   ├── cmds/                     # 71+ TypeScript command modules (.ts)
│   └── events/                   # 7+ TypeScript lifecycle event modules (.ts)
├── database/                     # SQLite models and data controllers
├── languages/                    # Multilingual localization bundles (en, vi)
├── Goat.ts                       # Bot runtime orchestrator
├── index.ts                      # CLI entrypoint & process supervisor
├── config.json                   # Main bot configuration
├── account.txt                   # Facebook session appState / cookie
├── package.json                  # Dependencies and scripts (v3.0.0)
└── tsconfig.json                 # TypeScript compiler configuration
```

---

## 🛠️ Getting Started

### 1. Requirements

- **Bun** (strongly recommended): [Install Bun](https://bun.sh)
  ```powershell
  powershell -c "irm bun.sh/install.ps1 | iex"
  ```
  *OR*
- **Node.js**: v18.0.0 or higher (with `npm`).

---

### 2. Installation

Clone your repository and install dependencies:

```bash
git clone https://github.com/ItzPriyanshi/QueenBotV2.git
cd QueenBotV2
```

Install packages using Bun:
```bash
bun install
```
*(Or with npm: `npm install`)*

---

### 3. Account Authentication

QueenBot v3 does not require an email, password, or API key.

1. Log into your Facebook account in your browser.
2. Export your session cookies or `appState` using any browser extension (such as **c喫okie-editor** or **Get FB State**).
3. Paste the exported JSON array (or raw cookie string) into [`account.txt`](file:///C:/Users/PRAKASH%20PATNAYAK/OneDrive/Desktop/Project-QueenBotV2/account.txt) in the project root:

```json
[
  {
    "key": "c_user",
    "value": "YOUR_UID",
    "domain": "facebook.com",
    "path": "/",
    "hostOnly": false
  },
  {
    "key": "xs",
    "value": "YOUR_XS_TOKEN",
    "domain": "facebook.com",
    "path": "/",
    "hostOnly": false
  }
]
```

---

### 4. Bot Configuration

Inspect [`config.json`](file:///C:/Users/PRAKASH%20PATNAYAK/OneDrive/Desktop/Project-QueenBotV2/config.json) to customize your preferences:

```json
{
  "botName": "QueenBot v3",
  "author": "Priyanshi Kaur",
  "prefix": ".",
  "language": "en",
  "adminBot": ["YOUR_UID"],
  "database": {
    "type": "sqlite",
    "autoRefreshThreadInfoFirstTime": true
  }
}
```

---

## 🚀 Running QueenBot v3

### Production Mode (Bun)
```bash
bun start
```

### Development Mode (with Live Auto-Reload)
```bash
bun run dev
```

### Node.js Fallback
```bash
npm run start:node
```

---

## 💬 Popular Commands

| Command | Syntax | Description | Permission |
| :--- | :--- | :--- | :--- |
| **Help** | `.help [command]` | Displays command list or detailed guide for a command | All Users |
| **Prefix** | `Prefix` or `.prefix <new_prefix>` | Shows or sets the bot trigger prefix | All Users / Admin |
| **Uptime2** | `.uptime2` | Generates a glassy anime UI status card with live CPU/RAM/Ping | All Users |
| **Sing** | `.sing <song name or URL>` | Downloads & streams YouTube audio or video with quality selection | All Users |
| **Music** | `.music <song name>` | Searches iTunes and sends a playable audio clip directly | All Users |
| **Theme** | `.theme [id]` | Displays available Messenger themes or applies one | Admin / Thread Admin |
| **Pin / Unpin** | `.pin` / `.unpin` | Pins or unpins a replied message in group chat | Thread Admin |
| **Info** | `.info` | Displays bot system stats, uptime, and memory usage | All Users |
| **Uid** | `.uid [@mention]` | Retrieves Facebook User ID of yourself or mentioned user | All Users |
| **Tid** | `.tid` | Displays current thread / group chat ID | All Users |
| **Restart** | `.restart` | Safely restarts the bot process | Bot Admin |

---

## 🛡️ Anti-Ban & Security Guidelines

- **Use Established Accounts**: Avoid using brand-new Facebook accounts for botting; accounts with older history are less prone to checkpoints.
- **2-Factor Authentication**: Always keep 2FA enabled on the bot account.
- **Keep Cookies Private**: Never share your `account.txt` file or commit it to GitHub. The included `.gitignore` keeps it protected locally.
- **Respect Rate Limits**: Do not modify command cooldowns below 1 second to avoid Facebook spam detection.

---

## 📜 License & Credits

- **Author**: [Priyanshi Kaur](https://github.com/ItzPriyanshi)
- **Repository**: [QueenBotV2 / v3](https://github.com/ItzPriyanshi/QueenBotV2)
- **Engine**: Powered by `fca-nx` and `bun`
- **License**: [MIT License](LICENSE)
