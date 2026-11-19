const axios = require('axios');
module.exports = {
    config: {
        name: "google",
        aliases: ["search", "gs"],
        version: "2.2",
        author: "Priyanshi Kaur (modified)",
        role: 0,
        shortDescription: {
            en: "Searches Google for a given query with image support."
        },
        longDescription: {
            en: "This command searches Google for a given query and returns the top 5 results. It supports image search and can send image attachments with the response."
        },
        category: "utility",
        guide: {
            en: "To use this command, type !google <query> [flags]. Flags: -i (image search), -f <file type> (filter by file type), -s (safe search)"
        }
    },
    onStart: async function ({ api, event, args, message }) {
        const query = args.join(' ');
        if (!query) {
            return message.reply("Please provide a search query.");
        }
        const cx = "7514b16a62add47ae";
        const apiKey = "AIzaSyAqBaaYWktE14aDwDE8prVIbCH88zni12E";
        let url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}`;
        let imageSearch = false;
        let fileTypeFilter = '';
        let safeSearch = false;
        for (const arg of args) {
            if (arg === '-i') {
                imageSearch = true;
                url += '&searchType=image';
            }
            else if (arg.startsWith('-f')) {
                fileTypeFilter = arg.substring(2);
                url += `&fileType=${fileTypeFilter}`;
            }
            else if (arg === '-s') {
                safeSearch = true;
                url += `&safe=high`;
            }
        }
        try {
            const response = await axios.get(url);
            const searchResults = response.data.items.slice(0, 5);
            let messageBody = `Top 5 results for '${query}':\n`;
            searchResults.forEach((result, index) => {
                messageBody += `${index + 1}. ${result.title}\n${result.link}\n\n`;
            });
            if (imageSearch) {
                const imageURLs = searchResults.map(item => item.link);
                const streams = await Promise.all(imageURLs.map(url => global.utils.getStreamFromURL(url)));
                api.sendMessage({
                    body: messageBody,
                    attachment: streams
                }, event.threadID, event.messageID);
            }
            else {
                api.sendMessage(messageBody, event.threadID, event.messageID);
            }
        }
        catch (error) {
            console.error(error);
            api.sendMessage("An error occurred while searching Google.", event.threadID);
        }
    }
};
