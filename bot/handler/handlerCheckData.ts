const MAX_ERROR_SET_SIZE = 2000;

function addToBoundedSet(targetSet: any, item: any): void {
	if (targetSet.size >= MAX_ERROR_SET_SIZE) {
		const firstItem = targetSet.values().next().value;
		targetSet.delete(firstItem);
	}
	targetSet.add(item);
}

async function handlerCheckData(usersData: any, threadsData: any, event: any): Promise<void> {
	const { db, utils, GoatBot } = global as any;
	const { config } = GoatBot;
	const { log, getText } = utils;
	const { creatingThreadData, creatingUserData } = (global as any).client.database;
	const { threadID } = event;
	const senderID = event.senderID || event.author || event.userID;

	if (threadID) {
		try {
			if ((global as any).temp.createThreadDataError && typeof (global as any).temp.createThreadDataError.has === "function") {
				if ((global as any).temp.createThreadDataError.has(threadID)) return;
			} else if (Array.isArray((global as any).temp.createThreadDataError) && (global as any).temp.createThreadDataError.includes(threadID)) {
				return;
			}

			const findInCreatingThreadData = creatingThreadData.find((t: any) => t.threadID == threadID);
			if (!findInCreatingThreadData) {
				if (db.allThreadData.some((t: any) => t.threadID == threadID))
					return;

				const threadData = await threadsData.create(threadID);
				log.info("DATABASE", `New Thread: ${threadID} | ${threadData.threadName} | ${config.database.type}`);
			}
			else {
				await findInCreatingThreadData.promise;
			}
		}
		catch (err: any) {
			if (err.name != "DATA_ALREADY_EXISTS") {
				if ((global as any).temp.createThreadDataError && typeof (global as any).temp.createThreadDataError.add === "function") {
					addToBoundedSet((global as any).temp.createThreadDataError, threadID);
				} else if (Array.isArray((global as any).temp.createThreadDataError)) {
					if ((global as any).temp.createThreadDataError.length >= MAX_ERROR_SET_SIZE) {
						(global as any).temp.createThreadDataError.shift();
					}
					(global as any).temp.createThreadDataError.push(threadID);
				}
				log.err("DATABASE", getText("handlerCheckData", "cantCreateThread", threadID), err);
			}
		}
	}

	if (senderID) {
		try {
			const findInCreatingUserData = creatingUserData.find((u: any) => u.userID == senderID);
			if (!findInCreatingUserData) {
				if (db.allUserData.some((u: any) => u.userID == senderID))
					return;

				const userData = await usersData.create(senderID);
				log.info("DATABASE", `New User: ${senderID} | ${userData.name} | ${config.database.type}`);
			}
			else {
				await findInCreatingUserData.promise;
			}
		}
		catch (err: any) {
			if (err.name != "DATA_ALREADY_EXISTS")
				log.err("DATABASE", getText("handlerCheckData", "cantCreateUser", senderID), err);
		}
	}
}

module.exports = handlerCheckData;
