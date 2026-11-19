module.exports = {
    config: {
        name: "pending",
        version: "2.5.0",
        author: "Priyanshi Kaur",
        countDown: 5,
        role: 2,
        shortDescription: {
            vi: "",
            en: "Approve Threads"
        },
        longDescription: {
            vi: "",
            en: "Approve or Reject Your Bot Pending Threads"
        },
        category: "admin"
    },
    langs: {
        en: {
            invaildNumber: "%1 is not a valid number",
            cancelSuccess: "Rejected %1 thread(s)!",
            approveSuccess: "Approved successfully %1 thread(s)!",
            cantGetPendingList: "Can't get the pending list!",
            returnListPending: "»「PENDING」«❮ The total number of threads to approve is: %1 thread(s) ❯\n\n%2",
            returnListClean: "「PENDING」There are no threads in the pending list",
            welcome: "QueenBot is successfully connected 🫂🤍:\n\n•Join here to learn more about the bot:\nhttps://facebook.com/groups/7067206133407080/\n\n•Type %1enter to enter the messenger group 🙂🤍\n\n•Type %1help1 to view the bot's commands 🫂🌝🤍"
        }
    },
    onReply: async function ({ api, event, Reply, getLang, commandName, prefix }) {
        if (String(event.senderID) !== String(Reply.author))
            return;
        const { body, threadID, messageID } = event;
        let count = 0;
        if (body.toLowerCase().startsWith("c") || body.toLowerCase().startsWith("cancel")) {
            const index = body.slice(1).split(/\s+/).map(num => parseInt(num.trim())).filter(num => !isNaN(num) && num > 0 && num <= Reply.pending.length);
            for (const singleIndex of index) {
                await api.removeUserFromGroup(api.getCurrentUserID(), Reply.pending[singleIndex - 1].threadID);
                count++;
            }
            api.editMessage(getLang("cancelSuccess", count), messageID);
        }
        else {
            const index = body.split(/\s+/).map(num => parseInt(num.trim())).filter(num => !isNaN(num) && num > 0 && num <= Reply.pending.length);
            for (const singleIndex of index) {
                api.sendMessage(getLang("welcome", prefix), Reply.pending[singleIndex - 1].threadID);
                count++;
            }
            api.editMessage(getLang("approveSuccess", count), messageID);
        }
    },
    onStart: async function ({ api, event, getLang, commandName }) {
        const { threadID, messageID } = event;
        try {
            const spam = await api.getThreadList(100, null, ["OTHER"]) || [];
            const pending = await api.getThreadList(100, null, ["PENDING"]) || [];
            const list = [...spam, ...pending].filter(group => group.isSubscribed && group.isGroup);
            if (list.length === 0)
                return api.sendMessage(getLang("returnListClean"), threadID, messageID);
            const msg = list.map((group, index) => `${index + 1}/ ${group.name}(${group.threadID})`).join('\n');
            api.sendMessage(getLang("returnListPending", list.length, msg), threadID, (err, info) => {
                global.GoatBot.onReply.set(info.messageID, {
                    commandName,
                    messageID: info.messageID,
                    author: event.senderID,
                    pending: list
                });
            }, messageID);
        }
        catch (e) {
            console.error(e);
            return api.sendMessage(getLang("cantGetPendingList"), threadID, messageID);
        }
    }
};
