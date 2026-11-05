const { existsSync, writeJsonSync, readJSONSync } = require("fs-extra");
const moment = require("moment-timezone");
const path = require("path");
const _ = require("lodash");
const { CustomError, TaskQueue, getType } = global.utils;

const optionsWriteJSON = {
	spaces: 2,
	EOL: "\n"
};

const taskQueue = new TaskQueue(function (task, callback) {
	if (getType(task) === "AsyncFunction") {
		task()
			.then(result => callback(null, result))
			.catch(err => callback(err));
	}
	else {
		try {
			const result = task();
			callback(null, result);
		}
		catch (err) {
			callback(err);
		}
	}
});

const { creatingThreadData } = global.client.database;

function setupE2EEBridge(api) {
	if (!global.temp)
		global.temp = {};
	if (!global.temp.e2eeThreads)
		global.temp.e2eeThreads = new Set();

	if (api && !api.__e2eeBridgeInstalled) {
		api.__e2eeBridgeInstalled = true;

		if (typeof api.connectE2EE === "function" && (!api.e2ee || typeof api.e2ee.isConnected !== "function" || !api.e2ee.isConnected())) {
			Promise.resolve(api.connectE2EE()).catch(() => {});
		}

		const origSendMessage = typeof api.sendMessage === "function" ? api.sendMessage.bind(api) : null;
		if (origSendMessage) {
			api.sendMessage = function (form, threadID, callback, replyToMessage, isGroup) {
				if (!replyToMessage && typeof callback === "string") {
					replyToMessage = callback;
					callback = undefined;
				}
				const tid = String(threadID || "");
				const userCb = typeof callback === "function" ? callback : undefined;
				const isE2EEThread = global.temp?.e2eeThreads?.has(tid);

				if (isE2EEThread && api.e2ee && typeof api.e2ee.sendMessage === "function") {
					return new Promise((resolve, reject) => {
						const finish = (err, info) => {
							const normalizedInfo = info && typeof info === "object"
								? {
									threadID: info.threadID || tid,
									messageID: info.messageID || info.message_id || info.id || `e2ee_${Date.now()}`,
									timestamp: info.timestamp || Date.now(),
									...info
								}
								: { threadID: tid, messageID: `e2ee_${Date.now()}`, timestamp: Date.now() };
							if (userCb) {
								try {
									userCb(err, err ? undefined : normalizedInfo);
								}
								catch (_) {}
							}
							if (err)
								reject(err);
							else
								resolve(normalizedInfo);
						};
						Promise.resolve(api.e2ee.sendMessage(tid, form, replyToMessage))
							.then(info => finish(null, info))
							.catch(() => {
								try {
									const fallback = origSendMessage(form, threadID, (err, info) => finish(err, info), replyToMessage, isGroup);
									if (fallback && typeof fallback.then === "function") {
										fallback.then(info => finish(null, info)).catch(err => finish(err));
									}
								}
								catch (err) {
									finish(err);
								}
							});
					});
				}

				return origSendMessage(form, threadID, callback, replyToMessage, isGroup);
			};
		}

		const origSetReaction = typeof api.setMessageReaction === "function" ? api.setMessageReaction.bind(api) : null;
		if (origSetReaction) {
			api.setMessageReaction = function (reaction, messageID, callbackOrThreadID, forceCustomReaction) {
				const isNumericMid = typeof messageID === "string" && /^\d+$/.test(messageID);
				const e2eeTid = typeof callbackOrThreadID === "string"
					? callbackOrThreadID
					: global.temp?.messageThreadMap?.get(messageID);
				if ((isNumericMid || (e2eeTid && global.temp?.e2eeThreads?.has(String(e2eeTid)))) && api.e2ee && typeof api.e2ee.sendReaction === "function" && e2eeTid) {
					const cb = typeof callbackOrThreadID === "function" ? callbackOrThreadID : (typeof forceCustomReaction === "function" ? forceCustomReaction : undefined);
					return Promise.resolve(api.e2ee.sendReaction(String(e2eeTid), messageID, reaction))
						.then(res => {
							if (cb) cb(null, res);
							return res;
						})
						.catch(err => {
							if (cb) cb(err);
							throw err;
						});
				}
				return origSetReaction(reaction, messageID, callbackOrThreadID, forceCustomReaction);
			};
		}

		const origEditMessage = typeof api.editMessage === "function" ? api.editMessage.bind(api) : null;
		if (origEditMessage) {
			api.editMessage = function (text, messageID, callback) {
				const e2eeTid = global.temp?.messageThreadMap?.get(messageID);
				if (e2eeTid && global.temp?.e2eeThreads?.has(String(e2eeTid)) && api.e2ee && typeof api.e2ee.editMessage === "function") {
					const cb = typeof callback === "function" ? callback : undefined;
					return Promise.resolve(api.e2ee.editMessage(String(e2eeTid), messageID, text))
						.then(res => {
							if (cb) cb(null, res);
							return res;
						})
						.catch(err => {
							if (cb) cb(err);
							throw err;
						});
				}
				return origEditMessage(text, messageID, callback);
			};
		}

		const origUnsendMessage = typeof api.unsendMessage === "function" ? api.unsendMessage.bind(api) : null;
		if (origUnsendMessage) {
			api.unsendMessage = function (messageID, callback) {
				const e2eeTid = global.temp?.messageThreadMap?.get(messageID);
				if (e2eeTid && global.temp?.e2eeThreads?.has(String(e2eeTid)) && api.e2ee && typeof api.e2ee.unsendMessage === "function") {
					const cb = typeof callback === "function" ? callback : undefined;
					return Promise.resolve(api.e2ee.unsendMessage(messageID, String(e2eeTid)))
						.then(res => {
							if (cb) cb(null, res);
							return res;
						})
						.catch(err => {
							if (cb) cb(err);
							throw err;
						});
				}
				return origUnsendMessage(messageID, callback);
			};
		}
	}

	if (global.utils && typeof global.utils.message === "function" && !global.utils.__e2eeMessageHooked) {
		const origMessage = global.utils.message;
		global.utils.message = function (apiInstance, event) {
			if (event && event.threadID) {
				const tid = String(event.threadID);
				if (!global.temp.messageThreadMap)
					global.temp.messageThreadMap = new Map();
				if (event.messageID) {
					global.temp.messageThreadMap.set(event.messageID, tid);
					if (global.temp.messageThreadMap.size > 3000) {
						const oldest = global.temp.messageThreadMap.keys().next().value;
						global.temp.messageThreadMap.delete(oldest);
					}
				}
				if (event.isE2EE === true || event.messageReply?.isE2EE === true) {
					global.temp.e2eeThreads.add(tid);
				}
				if (global.temp.createThreadDataError) {
					if (typeof global.temp.createThreadDataError.delete === "function")
						global.temp.createThreadDataError.delete(event.threadID);
					else if (Array.isArray(global.temp.createThreadDataError)) {
						const errIdx = global.temp.createThreadDataError.indexOf(event.threadID);
						if (errIdx !== -1)
							global.temp.createThreadDataError.splice(errIdx, 1);
					}
				}
			}
			if (apiInstance && !apiInstance.__e2eeBridgeInstalled) {
				setupE2EEBridge(apiInstance);
			}
			const baseMsg = origMessage(apiInstance, event);
			if (baseMsg && event && event.threadID) {
				const origReply = baseMsg.reply;
				const origSend = baseMsg.send;
				baseMsg.reply = async function (form, callback) {
					const info = await origReply(form, callback);
					if (info?.messageID && global.temp?.messageThreadMap) {
						global.temp.messageThreadMap.set(info.messageID, String(event.threadID));
					}
					return info;
				};
				baseMsg.send = async function (form, callback) {
					const info = await origSend(form, callback);
					if (info?.messageID && global.temp?.messageThreadMap) {
						global.temp.messageThreadMap.set(info.messageID, String(event.threadID));
					}
					return info;
				};
			}
			return baseMsg;
		};
		global.utils.__e2eeMessageHooked = true;
	}
}

function normalizeThreadInfo(threadID, rawInfo) {
	const info = rawInfo && typeof rawInfo === "object" ? rawInfo : {};
	const rawAdmins = Array.isArray(info.adminIDs) ? info.adminIDs : [];
	const adminIDs = rawAdmins
		.map(b => (typeof b === "object" && b !== null ? String(b.id || b.userID || "") : String(b || "")))
		.filter(Boolean);

	const nicknames = info.nicknames && typeof info.nicknames === "object" ? info.nicknames : {};
	let userInfo = Array.isArray(info.userInfo) ? info.userInfo : [];
	if (userInfo.length === 0 && Array.isArray(info.participantIDs)) {
		userInfo = info.participantIDs.map(id => ({
			id: String(id),
			name: String(id),
			gender: 0
		}));
	}

	const isGroup = info.isGroup !== undefined
		? Boolean(info.isGroup)
		: info.threadType !== undefined
			? info.threadType == 2
			: String(threadID).length > 15;

	return {
		threadName: info.threadName || info.name || String(threadID),
		threadThemeID: info.threadTheme?.id || info.threadThemeID || info.color || null,
		emoji: info.emoji || null,
		adminIDs,
		imageSrc: info.imageSrc || info.thumbSrc || null,
		approvalMode: Boolean(info.approvalMode),
		userInfo,
		nicknames,
		isGroup
	};
}

module.exports = async function (databaseType, threadModel, api, fakeGraphql) {
	setupE2EEBridge(api);

	let Threads = [];
	const pathThreadsData = path.join(__dirname, "..", "data/threadsData.json");

	switch (databaseType) {
		case "mongodb": {
			Threads = (await threadModel.find({}).lean()).map(thread => _.omit(thread, ["_id", "__v"]));
			break;
		}
		case "sqlite": {
			Threads = (await threadModel.findAll()).map(thread => thread.get({ plain: true }));
			break;
		}
		case "json": {
			if (!existsSync(pathThreadsData))
				writeJsonSync(pathThreadsData, [], optionsWriteJSON);
			Threads = readJSONSync(pathThreadsData);
			break;
		}
	}

	global.db.allThreadData = Threads;

	async function save(threadID, threadData, mode, path) {
		try {
			let index = _.findIndex(global.db.allThreadData, { threadID });
			if (index === -1) {
				index = global.db.allThreadData.findIndex(t => String(t.threadID) === String(threadID));
			}
			if (index === -1 && mode === "update") {
				try {
					await create_(threadID);
					index = global.db.allThreadData.findIndex(t => String(t.threadID) === String(threadID));
				}
				catch (err) {
					throw new CustomError({
						name: "THREAD_NOT_EXIST",
						message: `Can't find thread with threadID: ${threadID} in database`
					});
				}
			}

			switch (mode) {
				case "create": {
					switch (databaseType) {
						case "mongodb":
						case "sqlite": {
							let dataCreated = await threadModel.create(threadData);
							dataCreated = databaseType == "mongodb" ?
								_.omit(dataCreated._doc, ["_id", "__v"]) :
								dataCreated.get({ plain: true });
							global.db.allThreadData.push(dataCreated);
							return _.cloneDeep(dataCreated);
						}
						case "json": {
							const timeCreate = moment.tz().format();
							threadData.createdAt = timeCreate;
							threadData.updatedAt = timeCreate;
							global.db.allThreadData.push(threadData);
							writeJsonSync(pathThreadsData, global.db.allThreadData, optionsWriteJSON);
							return _.cloneDeep(threadData);
						}
						default: {
							break;
						}
					}
					break;
				}
				case "update": {
					const oldThreadData = global.db.allThreadData[index];
					const dataWillChange = {};

					if (Array.isArray(path) && Array.isArray(threadData)) {
						path.forEach((p, idx) => {
							const key = p.split(".")[0];
							if (!(key in dataWillChange))
								dataWillChange[key] = _.cloneDeep(oldThreadData[key]);
							_.set(dataWillChange, p, threadData[idx]);
						});
					}
					else if (path && typeof path === "string" || Array.isArray(path)) {
						const key = Array.isArray(path) ? path[0] : path.split(".")[0];
						dataWillChange[key] = _.cloneDeep(oldThreadData[key]);
						_.set(dataWillChange, path, threadData);
					}
					else {
						for (const key in threadData)
							dataWillChange[key] = threadData[key];
					}

					switch (databaseType) {
						case "mongodb": {
							let dataUpdated = await threadModel.findOneAndUpdate({ threadID }, dataWillChange, { returnDocument: "after" });
							dataUpdated = _.omit(dataUpdated._doc, ["_id", "__v"]);
							global.db.allThreadData[index] = dataUpdated;
							return _.cloneDeep(dataUpdated);
						}
						case "sqlite": {
							const thread = await threadModel.findOne({ where: { threadID } });
							const dataUpdated = (await thread.update(dataWillChange)).get({ plain: true });
							global.db.allThreadData[index] = dataUpdated;
							return _.cloneDeep(dataUpdated);
						}
						case "json": {
							dataWillChange.updatedAt = moment.tz().format();
							global.db.allThreadData[index] = {
								...oldThreadData,
								...dataWillChange
							};
							writeJsonSync(pathThreadsData, global.db.allThreadData, optionsWriteJSON);
							return _.cloneDeep(global.db.allThreadData[index]);
						}
						default:
							break;
					}
					break;
				}
				case "delete": {
					if (index != -1) {
						global.db.allThreadData.splice(index, 1);
						switch (databaseType) {
							case "mongodb":
								await threadModel.deleteOne({ threadID });
								break;
							case "sqlite":
								await threadModel.destroy({ where: { threadID } });
								break;
							case "json":
								writeJsonSync(pathThreadsData, global.db.allThreadData, optionsWriteJSON);
								break;
							default:
								break;
						}
					}
					break;
				}
				default: {
					break;
				}
			}
			return null;
		}
		catch (err) {
			throw err;
		}
	}

	async function create_(threadID, threadInfo) {
		const findInCreatingData = creatingThreadData.find(t => String(t.threadID) === String(threadID));
		if (findInCreatingData)
			return findInCreatingData.promise;

		const queue = new Promise(async function (resolve_, reject_) {
			try {
				if (global.db.allThreadData.some(t => String(t.threadID) === String(threadID))) {
					throw new CustomError({
						name: "DATA_ALREADY_EXISTS",
						message: `Thread with id "${threadID}" already exists in the data`
					});
				}
				if (isNaN(threadID)) {
					throw new CustomError({
						name: "INVALID_THREAD_ID",
						message: `The first argument (threadID) must be a number, not a ${typeof threadID}`
					});
				}
				const isE2EEThread = global.temp?.e2eeThreads?.has(String(threadID));
				if (!threadInfo && !isE2EEThread && api && typeof api.getThreadInfo === "function") {
					try {
						threadInfo = await api.getThreadInfo(threadID);
					}
					catch (err) {
						threadInfo = null;
					}
				}
				const normalized = normalizeThreadInfo(threadID, threadInfo);
				const newMembers = normalized.userInfo.reduce(function (arr, user) {
					const userID = String(user.id || user.userID || "");
					if (!userID)
						return arr;
					arr.push({
						userID,
						name: user.name || userID,
						gender: user.gender || 0,
						nickname: normalized.nicknames[userID] || null,
						inGroup: true,
						count: 0,
						permissionConfigDashboard: false
					});
					return arr;
				}, []);

				let threadData = {
					threadID: String(threadID),
					threadName: normalized.threadName,
					threadThemeID: normalized.threadThemeID,
					emoji: normalized.emoji,
					adminIDs: normalized.adminIDs,
					imageSrc: normalized.imageSrc,
					approvalMode: normalized.approvalMode,
					members: newMembers,
					banned: {},
					settings: {
						sendWelcomeMessage: true,
						sendLeaveMessage: true,
						sendRankupMessage: false,
						customCommand: true
					},
					data: {},
					isGroup: normalized.isGroup
				};
				threadData = await save(String(threadID), threadData, "create");
				resolve_(_.cloneDeep(threadData));
			}
			catch (err) {
				reject_(err);
			}
			const idx = creatingThreadData.findIndex(t => String(t.threadID) === String(threadID));
			if (idx !== -1)
				creatingThreadData.splice(idx, 1);
		});
		creatingThreadData.push({
			threadID: String(threadID),
			promise: queue
		});
		return queue;
	}

	async function create(threadID, threadInfo) {
		return new Promise(function (resolve, reject) {
			taskQueue.push(async function () {
				create_(threadID, threadInfo)
					.then(resolve)
					.catch(reject);
			});
		});
	}

	async function refreshInfo(threadID, newThreadInfo) {
		return new Promise(function (resolve, reject) {
			taskQueue.push(async function () {
				try {
					if (isNaN(threadID)) {
						return reject(new CustomError({
							name: "INVALID_THREAD_ID",
							message: `The first argument (threadID) must be a number, not a ${typeof threadID}`
						}));
					}
					const threadInfo = await get_(threadID);
					const isE2EEThread = global.temp?.e2eeThreads?.has(String(threadID));
					if (!newThreadInfo && !isE2EEThread && api && typeof api.getThreadInfo === "function") {
						try {
							newThreadInfo = await api.getThreadInfo(threadID);
						}
						catch (err) {
							newThreadInfo = null;
						}
					}
					if (!newThreadInfo) {
						return resolve(_.cloneDeep(threadInfo));
					}
					const normalized = normalizeThreadInfo(threadID, newThreadInfo);
					let oldMembers = Array.isArray(threadInfo.members) ? [...threadInfo.members] : [];
					const newMembers = [];
					for (const user of normalized.userInfo) {
						const userID = String(user.id || user.userID || "");
						if (!userID)
							continue;
						const indexUser = oldMembers.findIndex(m => String(m.userID) === userID);
						const oldDataUser = indexUser !== -1 ? oldMembers[indexUser] : {};
						const data = {
							userID,
							...oldDataUser,
							name: user.name || oldDataUser.name || userID,
							gender: user.gender ?? oldDataUser.gender ?? 0,
							nickname: normalized.nicknames[userID] || null,
							inGroup: true,
							count: oldDataUser.count || 0,
							permissionConfigDashboard: oldDataUser.permissionConfigDashboard || false
						};
						if (indexUser !== -1)
							oldMembers.splice(indexUser, 1);
						newMembers.push(data);
					}
					oldMembers = oldMembers.map(user => {
						user.inGroup = false;
						return user;
					});
					let threadData = {
						...threadInfo,
						threadName: normalized.threadName || threadInfo.threadName,
						threadThemeID: normalized.threadThemeID ?? threadInfo.threadThemeID,
						emoji: normalized.emoji ?? threadInfo.emoji,
						adminIDs: normalized.adminIDs.length > 0 ? normalized.adminIDs : (threadInfo.adminIDs || []),
						imageSrc: normalized.imageSrc ?? threadInfo.imageSrc,
						members: [
							...oldMembers,
							...newMembers
						]
					};

					threadData = await save(String(threadID), threadData, "update");
					return resolve(_.cloneDeep(threadData));
				}
				catch (err) {
					return reject(err);
				}
			});
		});
	}

	function getAll(path, defaultValue, query) {
		return new Promise(async function (resolve, reject) {
			taskQueue.push(async function () {
				try {
					let dataReturn = _.cloneDeep(global.db.allThreadData);

					if (query)
						if (typeof query !== "string")
							throw new CustomError({
								name: "INVALID_QUERY",
								message: `The third argument (query) must be a string, not a ${typeof query}`
							});
						else
							dataReturn = dataReturn.map(tData => fakeGraphql(query, tData));

					if (path)
						if (!["string", "object"].includes(typeof path))
							throw new CustomError({
								name: "INVALID_PATH",
								message: `The first argument (path) must be a string or an object, not a ${typeof path}`
							});
						else
							if (typeof path === "string")
								return resolve(dataReturn.map(tData => _.get(tData, path, defaultValue)));
							else
								return resolve(dataReturn.map(tData => _.times(path.length, i => _.get(tData, path[i], defaultValue[i]))));

					return resolve(dataReturn);
				}
				catch (err) {
					reject(err);
				}
			});
		});
	}

	async function get_(threadID, path, defaultValue, query) {
		if (isNaN(threadID)) {
			throw new CustomError({
				name: "INVALID_THREAD_ID",
				message: `The first argument (threadID) must be a number, not a ${typeof threadID}`
			});
		}
		let threadData;

		const index = global.db.allThreadData.findIndex(t => String(t.threadID) === String(threadID));
		if (index === -1)
			threadData = await create_(threadID);
		else
			threadData = global.db.allThreadData[index];

		if (query)
			if (typeof query != "string")
				throw new CustomError({
					name: "INVALID_QUERY",
					message: `The fourth argument (query) must be a string, not a ${typeof query}`
				});
			else
				threadData = fakeGraphql(query, threadData);

		if (path)
			if (!["string", "object"].includes(typeof path))
				throw new CustomError({
					name: "INVALID_PATH",
					message: `The second argument (path) must be a string or an object, not a ${typeof path}`
				});
			else
				if (typeof path === "string")
					return _.cloneDeep(_.get(threadData, path, defaultValue));
				else
					return _.cloneDeep(_.times(path.length, i => _.get(threadData, path[i], defaultValue[i])));

		return _.cloneDeep(threadData);
	}

	async function get(threadID, path, defaultValue, query) {
		return new Promise(async function (resolve, reject) {
			taskQueue.push(function () {
				get_(threadID, path, defaultValue, query)
					.then(resolve)
					.catch(reject);
			});
		});
	}

	async function set(threadID, updateData, path, query) {
		return new Promise(async function (resolve, reject) {
			taskQueue.push(async function () {
				try {
					if (isNaN(threadID)) {
						throw new CustomError({
							name: "INVALID_THREAD_ID",
							message: `The first argument (threadID) must be a number, not a ${typeof threadID}`
						});
					}
					if (!path && (typeof updateData != "object" || Array.isArray(updateData)))
						throw new CustomError({
							name: "INVALID_UPDATE_DATA",
							message: `The second argument (updateData) must be an object, not a ${typeof updateData}`
						});
					const threadData = await save(String(threadID), updateData, "update", path);
					if (query)
						if (typeof query !== "string")
							throw new CustomError({
								name: "INVALID_QUERY",
								message: `The fourth argument (query) must be a string, not a ${typeof query}`
							});
						else
							return resolve(_.cloneDeep(fakeGraphql(query, threadData)));
					return resolve(_.cloneDeep(threadData));
				}
				catch (err) {
					reject(err);
				}
			});
		});
	}

	async function deleteKey(threadID, path, query) {
		return new Promise(async function (resolve, reject) {
			taskQueue.push(async function () {
				try {
					if (isNaN(threadID)) {
						throw new CustomError({
							name: "INVALID_THREAD_ID",
							message: `The first argument (threadID) must be a number, not a ${typeof threadID}`
						});
					}
					if (typeof path !== "string")
						throw new CustomError({
							name: "INVALID_PATH",
							message: `The second argument (path) must be a string, not a ${typeof path}`
						});
					const spitPath = path.split(".");
					if (spitPath.length == 1)
						throw new CustomError({
							name: "INVALID_PATH",
							message: `Can't delete key "${path}" because it's a root key`
						});
					const parent = spitPath.slice(0, spitPath.length - 1).join(".");
					const parentData = await get_(threadID, parent);
					if (!parentData)
						throw new CustomError({
							name: "KEY_NOT_FOUND",
							message: `Can't find key "${parent}" in thread with threadID: ${threadID}`
						});

					_.unset(parentData, spitPath[spitPath.length - 1]);
					const setData = await save(String(threadID), parentData, "update", parent);
					if (query)
						if (typeof query !== "string")
							throw new CustomError({
								name: "INVALID_QUERY",
								message: `The fourth argument (query) must be a string, not a ${typeof query}`
							});
						else
							return resolve(_.cloneDeep(fakeGraphql(query, setData)));
					return resolve(_.cloneDeep(setData));
				}
				catch (err) {
					reject(err);
				}
			});
		});
	}

	async function remove(threadID) {
		return new Promise(async function (resolve, reject) {
			taskQueue.push(async function () {
				try {
					if (isNaN(threadID)) {
						throw new CustomError({
							name: "INVALID_THREAD_ID",
							message: `The first argument (threadID) must be a number, not a ${typeof threadID}`
						});
					}
					await save(String(threadID), { threadID: String(threadID) }, "delete");
					return resolve(true);
				}
				catch (err) {
					reject(err);
				}
			});
		});
	}

	return {
		existsSync: function existsSync(threadID) {
			return global.db.allThreadData.some(t => String(t.threadID) === String(threadID));
		},
		create,
		refreshInfo,
		getAll,
		get,
		set,
		deleteKey,
		remove
	};
};