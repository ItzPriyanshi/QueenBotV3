const chalk = require("chalk");
const path = require("path");

async function loadData(api: any, createLine: any) {
	const { log, createOraDots, getText } = (global as any).utils;
	console.log(chalk.hex("#f5ab00")(createLine("DATABASE")));
	const controller = await require(path.join(__dirname, '..', '..', 'database/controller/index.js'))(api);
	const { threadModel, userModel, dashBoardModel, globalModel, threadsData, usersData, dashBoardData, globalData, sequelize } = controller;
	log.info('DATABASE', getText('loadData', 'loadThreadDataSuccess', (global as any).db.allThreadData.filter((t: any) => t.threadID.toString().length > 15).length));
	log.info('DATABASE', getText('loadData', 'loadUserDataSuccess', (global as any).db.allUserData.length));
	if (api && (global as any).GoatBot.config.database.autoSyncWhenStart == true) {
		console.log(chalk.hex("#f5ab00")(createLine("AUTO SYNC")));
		const spin = createOraDots(getText('loadData', 'refreshingThreadData'));
		try {
			api.setOptions({
				logLevel: 'silent'
			});
			spin._start();
			const threadDataWillSet = [];
			const allThreadData = [...(global as any).db.allThreadData];
			const allThreadInfo = await api.getThreadList(9999999, null, 'INBOX');
			for (const threadInfo of allThreadInfo) {
				if (threadInfo.isGroup && !allThreadData.some((thread: any) => thread.threadID === threadInfo.threadID))
					threadDataWillSet.push(await threadsData.create(threadInfo.threadID, threadInfo));
				else {
					const threadRefreshed = await threadsData.refreshInfo(threadInfo.threadID, threadInfo);
					allThreadData.splice(allThreadData.findIndex((thread: any) => thread.threadID === threadInfo.threadID), 1);
					threadDataWillSet.push(threadRefreshed);
				}
				(global as any).db.receivedTheFirstMessage[threadInfo.threadID] = true;
			}

			const allThreadDataDontHaveBot = allThreadData.filter((thread: any) => !allThreadInfo.some((thread1: any) => thread.threadID === thread1.threadID));
			const botID = api.getCurrentUserID();
			for (const thread of allThreadDataDontHaveBot) {
				const findMe = thread.members.find((m: any) => m.userID == botID);
				if (findMe) {
					findMe.inGroup = false;
					await threadsData.set(thread.threadID, { members: thread.members });
				}
			}
			(global as any).db.allThreadData = [
				...threadDataWillSet,
				...allThreadDataDontHaveBot
			];
			spin._stop();
			log.info('DATABASE', getText('loadData', 'refreshThreadDataSuccess', (global as any).db.allThreadData.length));
		}
		catch (err: any) {
			spin._stop();
			log.err('DATABASE', getText('loadData', 'refreshThreadDataError'), err);
		}
		finally {
			api.setOptions({
				logLevel: (global as any).GoatBot.config.optionsFca.logLevel
			});
		}
	}
	return {
		threadModel: threadModel || null,
		userModel: userModel || null,
		dashBoardModel: dashBoardModel || null,
		globalModel: globalModel || null,
		threadsData,
		usersData,
		dashBoardData,
		globalData,
		sequelize
	};
}

module.exports = loadData;
