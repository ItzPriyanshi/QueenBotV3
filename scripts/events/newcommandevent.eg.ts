module.exports = {
    config: {
        name: "commandName",
        version: "1.0",
        author: "Priyanshi Kaur",
        category: "events"
    },
    langs: {
        vi: {
            hello: "xin chÃ o thÃ nh viÃªn má»›i",
            helloWithName: "xin chÃ o thÃ nh vien má»›i, id facebook cá»§a báº¡n lÃ  %1"
        },
        en: {
            hello: "hello new member",
            helloWithName: "hello new member, your facebook id is %1"
        }
    },
    onStart: async function ({ api, usersData, threadsData, message, event, userModel, threadModel, prefix, dashBoardModel, globalModel, dashBoardData, globalData, envCommands, envEvents, envGlobal, role, getLang, commandName }) {
        if (event.logMessageType == "log:subscribe") {
            message.send(getLang("hello"));
        }
    }
};
