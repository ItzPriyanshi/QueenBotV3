const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');
module.exports = {
    config: {
        name: "ob",
        aliases: ["obfuscate", "encode", "protect"],
        author: "Priyanshi Kaur",
        version: "2.0.0",
        cooldowns: 5,
        role: 0,
        shortDescription: {
            en: "Advanced JavaScript code obfuscator"
        },
        longDescription: {
            en: "Obfuscate JavaScript code with multiple protection levels and save options"
        },
        category: "TOOL",
        guide: {
            en: "{p}ob <code> [-level 1-5] [-save filename] [-preset name] [-stats]"
        }
    },
    obfuscationPresets: {
        low: {
            compact: true,
            controlFlowFlattening: false,
            deadCodeInjection: false,
            stringArray: true,
            stringArrayEncoding: ['none'],
            stringArrayThreshold: 0.5,
            renameGlobals: false
        },
        medium: {
            compact: true,
            controlFlowFlattening: true,
            controlFlowFlatteningThreshold: 0.5,
            deadCodeInjection: true,
            deadCodeInjectionThreshold: 0.3,
            stringArray: true,
            stringArrayEncoding: ['base64'],
            stringArrayThreshold: 0.8,
            renameGlobals: false
        },
        high: {
            compact: true,
            controlFlowFlattening: true,
            controlFlowFlatteningThreshold: 1,
            deadCodeInjection: true,
            deadCodeInjectionThreshold: 0.4,
            debugProtection: true,
            debugProtectionInterval: 2000,
            stringArray: true,
            stringArrayEncoding: ['rc4'],
            stringArrayThreshold: 1,
            renameGlobals: true,
            selfDefending: true
        },
        extreme: {
            compact: true,
            controlFlowFlattening: true,
            controlFlowFlatteningThreshold: 1,
            deadCodeInjection: true,
            deadCodeInjectionThreshold: 0.4,
            debugProtection: true,
            debugProtectionInterval: 4000,
            domainLock: [],
            identifierNamesGenerator: 'hexadecimal',
            numbersToExpressions: true,
            renameGlobals: true,
            renameProperties: true,
            rotateStringArray: true,
            selfDefending: true,
            splitStrings: true,
            splitStringsChunkLength: 5,
            stringArray: true,
            stringArrayEncoding: ['rc4'],
            stringArrayThreshold: 1,
            transformObjectKeys: true,
            unicodeEscapeSequence: true
        }
    },
    parseArguments(args) {
        const params = {
            code: [],
            level: 3,
            save: null,
            preset: null,
            stats: false
        };
        let currentParam = 'code';
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            if (arg.startsWith('-')) {
                currentParam = arg.slice(1);
                continue;
            }
            if (currentParam === 'code') {
                params.code.push(arg);
            }
            else if (currentParam === 'level') {
                params.level = parseInt(arg);
            }
            else if (currentParam === 'save') {
                params.save = arg;
            }
            else if (currentParam === 'preset') {
                params.preset = arg;
            }
            else if (currentParam === 'stats') {
                params.stats = true;
            }
        }
        params.code = params.code.join(' ');
        return params;
    },
    getObfuscationOptions(level) {
        const baseOptions = {
            compact: false,
            controlFlowFlattening: true,
            controlFlowFlatteningThreshold: 0.2 * level,
            deadCodeInjection: level > 2,
            deadCodeInjectionThreshold: 0.1 * level,
            debugProtection: level > 3,
            debugProtectionInterval: 1000 * level,
            disableConsoleOutput: level > 4,
            identifierNamesGenerator: level > 3 ? 'hexadecimal' : 'mangled',
            numbersToExpressions: level > 2,
            renameGlobals: level > 4,
            renameProperties: level > 4,
            rotateStringArray: level > 2,
            selfDefending: level > 3,
            splitStrings: level > 2,
            splitStringsChunkLength: Math.max(10 - level, 2),
            stringArray: true,
            stringArrayEncoding: level > 3 ? ['rc4'] : ['base64'],
            stringArrayThreshold: 0.2 * level,
            transformObjectKeys: level > 4,
            unicodeEscapeSequence: level > 3
        };
        return baseOptions;
    },
    calculateStats(originalCode, obfuscatedCode) {
        return {
            originalSize: Buffer.from(originalCode).length,
            obfuscatedSize: Buffer.from(obfuscatedCode).length,
            compressionRatio: Buffer.from(originalCode).length / Buffer.from(obfuscatedCode).length,
            charactersChanged: [...originalCode].filter((char, i) => char !== obfuscatedCode[i]).length,
            timeStamp: new Date().toISOString()
        };
    },
    saveOutput(filename, code, stats) {
        const outputDir = path.join(process.cwd(), 'obfuscated');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir);
        }
        const outputPath = path.join(outputDir, `${filename}.js`);
        fs.writeFileSync(outputPath, code);
        if (stats) {
            const statsPath = path.join(outputDir, `${filename}_stats.json`);
            fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
        }
        return outputPath;
    },
    onStart: async function ({ api, event, args }) {
        try {
            if (args.length === 0) {
                api.sendMessage("Usage: {p}ob <code> [-level 1-5] [-save filename] [-preset low|medium|high|extreme] [-stats]", event.threadID, event.messageID);
                return;
            }
            const params = this.parseArguments(args);
            let obfuscationOptions;
            if (params.preset && this.obfuscationPresets[params.preset]) {
                obfuscationOptions = this.obfuscationPresets[params.preset];
            }
            else {
                obfuscationOptions = this.getObfuscationOptions(params.level);
            }
            const startTime = process.hrtime();
            const obfuscationResult = JavaScriptObfuscator.obfuscate(params.code, obfuscationOptions);
            const obfuscatedCode = obfuscationResult.getObfuscatedCode();
            const endTime = process.hrtime(startTime);
            const executionTime = (endTime[0] * 1000 + endTime[1] / 1000000).toFixed(2);
            let response = "Code obfuscation completed!\n";
            if (params.save) {
                const stats = params.stats ? this.calculateStats(params.code, obfuscatedCode) : null;
                const savedPath = this.saveOutput(params.save, obfuscatedCode, stats);
                response += `\nSaved to: ${savedPath}`;
                if (stats) {
                    response += `\n\nStats:
- Original size: ${stats.originalSize} bytes
- Obfuscated size: ${stats.obfuscatedSize} bytes
- Compression ratio: ${stats.compressionRatio.toFixed(2)}
- Characters changed: ${stats.charactersChanged}`;
                }
            }
            response += `\nExecution time: ${executionTime}ms`;
            const messages = [];
            const maxLength = 4000;
            if (response.length > maxLength) {
                messages.push(response);
            }
            if (!params.save) {
                let codeMessage = obfuscatedCode;
                while (codeMessage.length > 0) {
                    messages.push(codeMessage.slice(0, maxLength));
                    codeMessage = codeMessage.slice(maxLength);
                }
            }
            for (const msg of messages) {
                await api.sendMessage(msg, event.threadID);
            }
        }
        catch (error) {
            api.sendMessage(`Error during obfuscation: ${error.message}`, event.threadID, event.messageID);
        }
    }
};
