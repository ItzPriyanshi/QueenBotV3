import type { AxiosError } from 'axios';

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

type Service = 'pastebin' | 'mocky';

interface PasteOptions {
    title: string;
    expiration: string;
    privacy: string;
    service: Service;
    content: string;
    fileName: string;
}

interface PasteResult {
    url: string;
    raw: string;
}

interface ReplyAttachment {
    type: string;
    url?: string;
}

interface CommandContext {
    api: {
        editMessage: (text: string, messageID: string) => void;
        setMessageReaction: (emoji: string, messageID: string, callback: () => void, force: boolean) => void;
    };
    event: {
        type: string;
        messageID: string;
        messageReply?: {
            body?: string;
            attachments?: ReplyAttachment[];
        };
    };
    args: string[];
    message: {
        reply: (text: string) => Promise<{ messageID: string }>;
    };
}

const PASTEBIN_API_KEY: string = process.env.PASTEBIN_API_KEY ?? 'YOUR_PASTEBIN_API_KEY_HERE';
const PASTEBIN_API_URL = 'https://pastebin.com/api/api_post.php';
const MOCKY_BASE_URL: string = process.env.MOCKY_BASE_URL ?? 'https://unofficial-mocky.onrender.com';
const MOCKY_API_URL = `${MOCKY_BASE_URL}/api/mock`;
const MOCKY_SECRET: string = process.env.MOCKY_SECRET ?? 'uY8qN3mXv5B9zW4kP7rT2jE1sQ6cK9hA4fD8gV2bN7mX3pL1zW5kQ8rT0jE2sC9h';

const EXPIRATION_LABELS: Record<string, string> = {
    N: 'Never',
    '10M': '10 Minutes',
    '1H': '1 Hour',
    '1D': '1 Day',
    '1W': '1 Week',
    '2W': '2 Weeks',
    '1M': '1 Month',
    '6M': '6 Months',
    '1Y': '1 Year'
};

const PRIVACY_LABELS: Record<string, string> = {
    '0': 'Public',
    '1': 'Unlisted',
    '2': 'Private'
};

const VALID_SERVICES: Service[] = ['pastebin', 'mocky'];
const DEFAULT_TITLE = 'Untitled Paste';

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return (error as AxiosError).message;
    }
    return String(error);
}

async function createPastebinPaste(text: string, title: string, expiration: string, privacy: string): Promise<PasteResult> {
    try {
        const formData = new FormData();
        formData.append('api_dev_key', PASTEBIN_API_KEY);
        formData.append('api_option', 'paste');
        formData.append('api_paste_code', text);
        formData.append('api_paste_private', privacy);
        formData.append('api_paste_name', title);
        formData.append('api_paste_expire_date', expiration);

        const response = await axios.post(PASTEBIN_API_URL, formData, {
            headers: formData.getHeaders()
        });

        const url = String(response.data);
        if (!url.startsWith('http')) {
            throw new Error(url);
        }

        return {
            url,
            raw: url.replace('pastebin.com', 'pastebin.com/raw')
        };
    } catch (error) {
        throw new Error(`Pastebin Error: ${getErrorMessage(error)}`);
    }
}

async function createMockyPaste(content: string): Promise<PasteResult> {
    try {
        const response = await axios.post(
            MOCKY_API_URL,
            {
                status: 200,
                content,
                content_type: 'text/plain',
                charset: 'UTF-8',
                secret: MOCKY_SECRET,
                expiration: '1year'
            },
            { timeout: 90000 }
        );

        const link: string | undefined = response.data?.link;
        if (!link) {
            throw new Error('No link returned');
        }

        return { url: link, raw: link };
    } catch (error) {
        throw new Error(`Mocky Error: ${getErrorMessage(error)}`);
    }
}

function parseArgs(args: string[]): PasteOptions {
    const options: PasteOptions = {
        title: DEFAULT_TITLE,
        expiration: '1W',
        privacy: '0',
        service: 'pastebin',
        content: '',
        fileName: ''
    };

    const contentParts: string[] = [];

    for (const arg of args) {
        if (arg.startsWith('-t:')) {
            options.title = arg.slice(3);
        } else if (arg.startsWith('-e:') && EXPIRATION_LABELS[arg.slice(3)]) {
            options.expiration = arg.slice(3);
        } else if (arg.startsWith('-p:') && PRIVACY_LABELS[arg.slice(3)]) {
            options.privacy = arg.slice(3);
        } else if (arg.startsWith('-s:') && VALID_SERVICES.includes(arg.slice(3) as Service)) {
            options.service = arg.slice(3) as Service;
        } else if (arg.startsWith('-f:')) {
            options.fileName = path.basename(arg.slice(3));
        } else {
            contentParts.push(arg);
        }
    }

    options.content = contentParts.join(' ').trim();
    return options;
}

function findCommandFile(fileName: string): string | null {
    for (const extension of ['ts', 'js']) {
        const filePath: string = path.join(__dirname, `${fileName}.${extension}`);
        if (fs.existsSync(filePath)) {
            return filePath;
        }
    }
    return null;
}

function buildSuccessMessage(options: PasteOptions, result: PasteResult): string {
    const lines: string[] = [
        '📋 Paste created successfully!',
        '',
        `🔗 URL: ${result.url}`,
        `📝 Raw URL: ${result.raw}`,
        `📑 Title: ${options.title}`,
        `🔧 Service: ${options.service}`
    ];

    if (options.service === 'pastebin') {
        lines.push(
            `⏳ Expires: ${EXPIRATION_LABELS[options.expiration]}`,
            `🔒 Privacy: ${PRIVACY_LABELS[options.privacy]}`
        );
    }

    return lines.join('\n');
}

module.exports = {
    config: {
        name: 'paste',
        aliases: ['pastebin', 'mocky', 'bin'],
        version: '2.1.0',
        author: 'Priyanshi Kaur',
        countDown: 5,
        role: 0,
        shortDescription: 'Create pastes on various services',
        longDescription: 'Upload text or code to Pastebin or Mocky with various options',
        category: 'utility',
        guide: {
            en: `
                Usage:
                1. Direct text: {p}paste [options] <content>
                2. Reply to message: {p}paste [options]
                3. Upload command: {p}paste -f:commandName

                Options:
                -t:<title> : Set paste title
                -e:<expiration> : Set expiration (N, 10M, 1H, 1D, 1W, 2W, 1M, 6M, 1Y)
                -p:<privacy> : Set privacy (0=public, 1=unlisted, 2=private)
                -s:<service> : Select service (pastebin, mocky)
                -f:<filename> : Upload command file

                Examples:
                {p}paste -t:MyCode -e:1D Some code here
                {p}paste -s:mocky -f:help
                Reply with: {p}paste -t:SavedText`
        }
    },

    onStart: async function ({ api, event, args, message }: CommandContext): Promise<void> {
        let processingMessage: { messageID: string } | null = null;

        try {
            const options = parseArgs(args);
            processingMessage = await message.reply('📤 Processing your request...');

            let textToPaste = '';

            if (options.fileName) {
                const filePath = findCommandFile(options.fileName);
                if (!filePath) {
                    throw new Error(`File not found: ${options.fileName}.ts / ${options.fileName}.js`);
                }
                textToPaste = fs.readFileSync(filePath, 'utf8');
                if (options.title === DEFAULT_TITLE) {
                    options.title = `Command: ${options.fileName}`;
                }
            } else if (event.type === 'message_reply' && event.messageReply) {
                textToPaste = event.messageReply.body || '';
                const attachments = event.messageReply.attachments || [];
                if (attachments.length > 0) {
                    const attachmentInfo = attachments
                        .map(att => `[Attachment: ${att.type}${att.url ? ` - ${att.url}` : ''}]`)
                        .join('\n');
                    textToPaste += `\n\nAttachments:\n${attachmentInfo}`;
                }
                if (options.title === DEFAULT_TITLE) {
                    options.title = 'Saved Reply';
                }
            } else if (options.content) {
                textToPaste = options.content;
            } else {
                throw new Error('Please provide content to paste, reply to a message, or specify a command file.');
            }

            const result: PasteResult = options.service === 'mocky'
                ? await createMockyPaste(textToPaste)
                : await createPastebinPaste(textToPaste, options.title, options.expiration, options.privacy);

            api.editMessage(buildSuccessMessage(options, result), processingMessage.messageID);
            api.setMessageReaction('✅', event.messageID, () => {}, true);
        } catch (error) {
            const errorMessage = `❌ Error: ${getErrorMessage(error)}`;
            if (processingMessage) {
                api.editMessage(errorMessage, processingMessage.messageID);
            } else {
                message.reply(errorMessage);
            }
            api.setMessageReaction('❌', event.messageID, () => {}, true);
        }
    }
};
