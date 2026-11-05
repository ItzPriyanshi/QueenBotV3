const { existsSync, writeJsonSync, readJSONSync } = require("fs-extra");
const moment = require("moment-timezone");
const path = require("path");
const axios = require("axios");
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

const { creatingUserData } = global.client.database;

function normalizeGender(gender) {
	if (typeof gender === "number") return gender;
	if (typeof gender === "string") {
		const g = gender.toUpperCase();
		if (g === "FEMALE" || g === "1") return 1;
		if (g === "MALE" || g === "2") return 2;
	}
	return 0;
}

<<<<<<< HEAD
function normalizeUserInfo(userID, rawInfo, fallbackInfo) {
	const base = fallbackInfo && typeof fallbackInfo === "object" ? fallbackInfo : {};
	const info = rawInfo && typeof rawInfo === "object" ? rawInfo : {};
	const name = typeof info.name === "string" && info.name.trim()
		? info.name
		: (typeof base.name === "string" && base.name.trim() ? base.name : "Facebook User");
	const vanity = typeof info.vanity === "string"
		? info.vanity
		: (typeof info.alternateName === "string" ? info.alternateName : (typeof base.vanity === "string" ? base.vanity : ""));
	const gender = info.gender !== undefined ? normalizeGender(info.gender) : normalizeGender(base.gender);
	return {
		userID: String(userID),
		name,
		gender,
		vanity
	};
}

=======
>>>>>>> 4f1c1c393e36b0ef1cb963a6bae6963a34bff83c
module.exports = async function (databaseType, userModel, api, fakeGraphql) {
	let Users = [];
	const pathUsersData = path.join(__dirname, "..", "data/usersData.json");

	switch (databaseType) {
		case "mongodb": {
			Users = (await userModel.find({}).lean()).map(user => _.omit(user, ["_id", "__v"]));
			break;
		}
		case "sqlite": {
			Users = (await userModel.findAll()).map(user => user.get({ plain: true }));
			break;
		}
		case "json": {
			if (!existsSync(pathUsersData))
				writeJsonSync(pathUsersData, [], optionsWriteJSON);
			Users = readJSONSync(pathUsersData);
			break;
		}
	}
	global.db.allUserData = Users;

	async function fetchSafeUserInfo(userID, providedInfo, existingInfo) {
		if (providedInfo && typeof providedInfo === "object" && providedInfo.name) {
			return normalizeUserInfo(userID, providedInfo, existingInfo);
		}
		if (api && typeof api.getUserInfo === "function") {
			try {
				const res = await api.getUserInfo(userID);
				const extracted = res && typeof res === "object"
					? (res[userID] || res[String(userID)] || (res.name ? res : null))
					: null;
				if (extracted) {
					return normalizeUserInfo(userID, extracted, existingInfo);
				}
			}
			catch (e) {
			}
		}
		return normalizeUserInfo(userID, providedInfo, existingInfo);
	}

	function clearCreateUserError(userID) {
		if (global.temp && Array.isArray(global.temp.createUserDataError)) {
			const errIdx = global.temp.createUserDataError.findIndex(id => String(id) === String(userID));
			if (errIdx !== -1) {
				global.temp.createUserDataError.splice(errIdx, 1);
			}
		}
	}

	async function save(userID, userData, mode, updatePath) {
		try {
			let index = _.findIndex(global.db.allUserData, u => String(u.userID) === String(userID));
			if (index === -1 && mode === "update") {
				try {
					await create_(userID);
					index = _.findIndex(global.db.allUserData, u => String(u.userID) === String(userID));
				}
				catch (err) {
					throw new CustomError({
						name: "USER_NOT_FOUND",
						message: `Can't find user with userID: ${userID} in database`
					});
				}
			}

			switch (mode) {
				case "create": {
					switch (databaseType) {
						case "mongodb":
						case "sqlite": {
							let dataCreated = await userModel.create(userData);
							dataCreated = databaseType === "mongodb" ?
								_.omit(dataCreated._doc, ["_id", "__v"]) :
								dataCreated.get({ plain: true });
							global.db.allUserData.push(dataCreated);
							clearCreateUserError(userID);
							return _.cloneDeep(dataCreated);
						}
						case "json": {
							const timeCreate = moment.tz().format();
							userData.createdAt = timeCreate;
							userData.updatedAt = timeCreate;
							global.db.allUserData.push(userData);
							writeJsonSync(pathUsersData, global.db.allUserData, optionsWriteJSON);
							clearCreateUserError(userID);
							return _.cloneDeep(userData);
						}
						default: {
							break;
						}
					}
					break;
				}
				case "update": {
					const oldUserData = global.db.allUserData[index];
					const dataWillChange = {};

					if (Array.isArray(updatePath) && Array.isArray(userData)) {
						updatePath.forEach((p, idx) => {
							const key = p.split(".")[0];
							if (!(key in dataWillChange)) {
								dataWillChange[key] = _.cloneDeep(oldUserData[key]);
							}
							_.set(dataWillChange, p, userData[idx]);
						});
					}
					else if (updatePath && (typeof updatePath === "string" || Array.isArray(updatePath))) {
						const key = Array.isArray(updatePath) ? updatePath[0] : updatePath.split(".")[0];
						if (!(key in dataWillChange)) {
							dataWillChange[key] = _.cloneDeep(oldUserData[key]);
						}
						_.set(dataWillChange, updatePath, userData);
					}
					else {
						for (const key in userData)
							dataWillChange[key] = userData[key];
					}

					switch (databaseType) {
						case "mongodb": {
							let dataUpdated = await userModel.findOneAndUpdate({ userID }, dataWillChange, { returnDocument: "after" });
							dataUpdated = _.omit(dataUpdated._doc, ["_id", "__v"]);
							global.db.allUserData[index] = dataUpdated;
							return _.cloneDeep(dataUpdated);
						}
						case "sqlite": {
							const user = await userModel.findOne({ where: { userID } });
							const dataUpdated = (await user.update(dataWillChange)).get({ plain: true });
							global.db.allUserData[index] = dataUpdated;
							return _.cloneDeep(dataUpdated);
						}
						case "json": {
							dataWillChange.updatedAt = moment.tz().format();
							global.db.allUserData[index] = {
								...oldUserData,
								...dataWillChange
							};
							writeJsonSync(pathUsersData, global.db.allUserData, optionsWriteJSON);
							return _.cloneDeep(global.db.allUserData[index]);
						}
					}
					break;
				}
				case "remove": {
					if (index != -1) {
						global.db.allUserData.splice(index, 1);
						switch (databaseType) {
							case "mongodb":
								await userModel.deleteOne({ userID });
								break;
							case "sqlite":
								await userModel.destroy({ where: { userID } });
								break;
							case "json":
								writeJsonSync(pathUsersData, global.db.allUserData, optionsWriteJSON);
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

	function getNameInDB(userID) {
		const userData = global.db.allUserData.find(u => u.userID == userID);
		if (userData)
			return userData.name;
		else
			return null;
	}

	async function getName(userID, checkData = true) {
		if (isNaN(userID)) {
			throw new CustomError({
				name: "INVALID_USER_ID",
				message: `The first argument (userID) must be a number, not ${typeof userID}`
			});
		}

		if (checkData) {
			const nameInDb = getNameInDB(userID);
			if (nameInDb)
				return nameInDb;
		}

		try {
			const user = await axios.post(`https://www.facebook.com/api/graphql/?q=${`node(${userID}){name}`}`);
			if (user && user.data && user.data[userID] && user.data[userID].name) {
				return user.data[userID].name;
			}
		}
		catch (error) {
		}

		if (api && typeof api.getUserInfo === "function") {
			try {
				const info = await fetchSafeUserInfo(userID);
				if (info && info.name) return info.name;
			}
			catch (e) {
			}
		}

		return getNameInDB(userID) || "Facebook User";
	}

	async function getAvatarUrl(userID) {
		if (isNaN(userID)) {
			throw new CustomError({
				name: "INVALID_USER_ID",
				message: `The first argument (userID) must be a number, not ${typeof userID}`
			});
		}
		try {
			const user = await axios.post(`https://www.facebook.com/api/graphql/`, null, {
				params: {
					doc_id: "5341536295888250",
					variables: JSON.stringify({ height: 500, scale: 1, userID, width: 500 })
				}
			});
			return user.data.data.profile.profile_picture.uri;
		}
		catch (err) {
			return "https://i.ibb.co/bBSpr5v/143086968-2856368904622192-1959732218791162458-n.png";
		}
	}

	async function create_(userID, userInfo) {
		const findInCreatingData = creatingUserData.find(u => u.userID == userID);
		if (findInCreatingData)
			return findInCreatingData.promise;

		const queue = new Promise(async function (resolve_, reject_) {
			try {
				if (global.db.allUserData.some(u => u.userID == userID)) {
					throw new CustomError({
						name: "DATA_ALREADY_EXISTS",
						message: `User with id "${userID}" already exists in the data`
					});
				}
				if (isNaN(userID)) {
					throw new CustomError({
						name: "INVALID_USER_ID",
						message: `The first argument (userID) must be a number, not ${typeof userID}`
					});
				}
				const safeInfo = await fetchSafeUserInfo(userID, userInfo);
				let userData = {
					userID,
<<<<<<< HEAD
					name: safeInfo.name,
					gender: safeInfo.gender,
					vanity: safeInfo.vanity,
=======
					name: userInfo.name,
					gender: normalizeGender(userInfo.gender),
					vanity: userInfo.vanity,
>>>>>>> 4f1c1c393e36b0ef1cb963a6bae6963a34bff83c
					exp: 0,
					money: 0,
					banned: {},
					settings: {},
					data: {}
				};
				userData = await save(userID, userData, "create");
				resolve_(_.cloneDeep(userData));
			}
			catch (err) {
				reject_(err);
			}
			finally {
				const idx = creatingUserData.findIndex(u => u.userID == userID);
				if (idx !== -1) {
					creatingUserData.splice(idx, 1);
				}
			}
		});
		creatingUserData.push({
			userID,
			promise: queue
		});
		return queue;
	}

	async function create(userID, userInfo) {
		return new Promise(function (resolve, reject) {
			taskQueue.push(function () {
				create_(userID, userInfo)
					.then(resolve)
					.catch(reject);
			});
		});
	}

	async function refreshInfo(userID, updateInfoUser) {
		return new Promise(async function (resolve, reject) {
			taskQueue.push(async function () {
				try {
					if (isNaN(userID)) {
						throw new CustomError({
							name: "INVALID_USER_ID",
							message: `The first argument (userID) must be a number, not ${typeof userID}`
						});
					}
					const infoUser = await get_(userID);
					const safeInfo = await fetchSafeUserInfo(userID, updateInfoUser, infoUser);

					const newData = {
<<<<<<< HEAD
						name: safeInfo.name,
						vanity: safeInfo.vanity,
						gender: safeInfo.gender
=======
						name: updateInfoUser.name,
						vanity: updateInfoUser.vanity,
						gender: normalizeGender(updateInfoUser.gender)
>>>>>>> 4f1c1c393e36b0ef1cb963a6bae6963a34bff83c
					};
					let userData = {
						...infoUser,
						...newData
					};

					userData = await save(userID, userData, "update");
					resolve(_.cloneDeep(userData));
				}
				catch (err) {
					reject(err);
				}
			});
		});
	}

	function getAll(getPath, defaultValue, query) {
		return new Promise((resolve, reject) => {
			taskQueue.push(function () {
				try {
					let dataReturn = _.cloneDeep(global.db.allUserData);

					if (query)
						if (typeof query !== "string")
							throw new CustomError({
								name: "INVALID_QUERY",
								message: `The third argument (query) must be a string, not ${typeof query}`
							});
						else
							dataReturn = dataReturn.map(uData => fakeGraphql(query, uData));

					if (getPath)
						if (!["string", "object"].includes(typeof getPath))
							throw new CustomError({
								name: "INVALID_PATH",
								message: `The first argument (path) must be a string or object, not ${typeof getPath}`
							});
						else
							if (typeof getPath === "string")
								return resolve(dataReturn.map(uData => _.get(uData, getPath, defaultValue)));
							else
								return resolve(dataReturn.map(uData => _.times(getPath.length, i => _.get(uData, getPath[i], Array.isArray(defaultValue) ? defaultValue[i] : defaultValue))));

					return resolve(dataReturn);
				}
				catch (err) {
					reject(err);
				}
			});
		});
	}

	async function get_(userID, getPath, defaultValue, query) {
		if (isNaN(userID)) {
			throw new CustomError({
				name: "INVALID_USER_ID",
				message: `The first argument (userID) must be a number, not ${typeof userID}`
			});
		}
		let userData;

		const index = global.db.allUserData.findIndex(u => u.userID == userID);
		if (index === -1)
			userData = await create_(userID);
		else
			userData = global.db.allUserData[index];

		if (query)
			if (typeof query !== "string")
				throw new CustomError({
					name: "INVALID_QUERY",
					message: `The fourth argument (query) must be a string, not ${typeof query}`
				});
			else
				userData = fakeGraphql(query, userData);

		if (getPath)
			if (typeof getPath !== "string" && !Array.isArray(getPath))
				throw new CustomError({
					name: "INVALID_PATH",
					message: `The second argument (path) must be a string or array, not ${typeof getPath}`
				});
			else
				if (typeof getPath === "string")
					return _.cloneDeep(_.get(userData, getPath, defaultValue));
				else
					return _.cloneDeep(_.times(getPath.length, i => _.get(userData, getPath[i], Array.isArray(defaultValue) ? defaultValue[i] : defaultValue)));

		return _.cloneDeep(userData);
	}

	async function get(userID, getPath, defaultValue, query) {
		return new Promise((resolve, reject) => {
			taskQueue.push(function () {
				get_(userID, getPath, defaultValue, query)
					.then(resolve)
					.catch(reject);
			});
		});
	}

	async function set(userID, updateData, setPath, query) {
		return new Promise((resolve, reject) => {
			taskQueue.push(async function () {
				try {
					if (isNaN(userID)) {
						throw new CustomError({
							name: "INVALID_USER_ID",
							message: `The first argument (userID) must be a number, not ${typeof userID}`
						});
					}

					if (!setPath && (typeof updateData != "object" || typeof updateData == "object" && Array.isArray(updateData)))
						throw new CustomError({
							name: "INVALID_UPDATE_DATA",
							message: `The second argument (updateData) must be an object, not ${typeof updateData}`
						});

					const userData = await save(userID, updateData, "update", setPath);
					if (query)
						if (typeof query !== "string")
							throw new CustomError({
								name: "INVALID_QUERY",
								message: `The fourth argument (query) must be a string, not ${typeof query}`
							});
						else
							return resolve(_.cloneDeep(fakeGraphql(query, userData)));

					return resolve(_.cloneDeep(userData));
				}
				catch (err) {
					reject(err);
				}
			});
		});
	}

	async function deleteKey(userID, deletePath, query) {
		return new Promise(async function (resolve, reject) {
			taskQueue.push(async function () {
				try {
					if (isNaN(userID)) {
						throw new CustomError({
							name: "INVALID_USER_ID",
							message: `The first argument (userID) must be a number, not a ${typeof userID}`
						});
					}
					if (typeof deletePath !== "string")
						throw new CustomError({
							name: "INVALID_PATH",
							message: `The second argument (path) must be a string, not a ${typeof deletePath}`
						});
					const spitPath = deletePath.split(".");
					if (spitPath.length == 1)
						throw new CustomError({
							name: "INVALID_PATH",
							message: `Can't delete key "${deletePath}" because it's a root key`
						});
					const parent = spitPath.slice(0, spitPath.length - 1).join(".");
					const parentData = await get_(userID, parent);
					if (!parentData)
						throw new CustomError({
							name: "INVALID_PATH",
							message: `Can't find key "${parent}" in user with userID: ${userID}`
						});

					_.unset(parentData, spitPath[spitPath.length - 1]);
					const setData = await save(userID, parentData, "update", parent);
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

	async function getMoney(userID) {
		return new Promise((resolve, reject) => {
			taskQueue.push(async function () {
				try {
					if (isNaN(userID)) {
						throw new CustomError({
							name: "INVALID_USER_ID",
							message: `The first argument (userID) must be a number, not ${typeof userID}`
						});
					}
					const money = await get_(userID, "money");
					resolve(money);
				}
				catch (err) {
					reject(err);
				}
			});
		});
	}

	async function addMoney(userID, money, query) {
		return new Promise((resolve, reject) => {
			taskQueue.push(async function () {
				try {
					if (isNaN(userID)) {
						throw new CustomError({
							name: "INVALID_USER_ID",
							message: `The first argument (userID) must be a number, not ${typeof userID}`
						});
					}
					if (isNaN(money)) {
						throw new CustomError({
							name: "INVALID_MONEY",
							message: `The second argument (money) must be a number, not ${typeof money}`
						});
					}
					if (!global.db.allUserData.some(u => u.userID == userID))
						await create_(userID);
					const currentMoney = await get_(userID, "money");
					const newMoney = currentMoney + money;
					const userData = await save(userID, newMoney, "update", "money");
					if (query)
						if (typeof query !== "string")
							throw new CustomError({
								name: "INVALID_QUERY",
								message: `The third argument (query) must be a string, not ${typeof query}`
							});
						else
							return resolve(_.cloneDeep(fakeGraphql(query, userData)));

					return resolve(_.cloneDeep(userData));
				}
				catch (err) {
					reject(err);
				}
			});
		});
	}

	async function subtractMoney(userID, money, query) {
		return new Promise((resolve, reject) => {
			taskQueue.push(async function () {
				try {
					if (isNaN(userID)) {
						throw new CustomError({
							name: "INVALID_USER_ID",
							message: `The first argument (userID) must be a number, not ${typeof userID}`
						});
					}
					if (isNaN(money)) {
						throw new CustomError({
							name: "INVALID_MONEY",
							message: `The second argument (money) must be a number, not ${typeof money}`
						});
					}
					if (!global.db.allUserData.some(u => u.userID == userID))
						await create_(userID);
					const currentMoney = await get_(userID, "money");
					const newMoney = currentMoney - money;
					const userData = await save(userID, newMoney, "update", "money");
					if (query)
						if (typeof query !== "string")
							throw new CustomError({
								name: "INVALID_QUERY",
								message: `The third argument (query) must be a string, not ${typeof query}`
							});
						else
							return resolve(_.cloneDeep(fakeGraphql(query, userData)));
					return resolve(_.cloneDeep(userData));
				}
				catch (err) {
					reject(err);
				}
			});
		});
	}

	async function remove(userID) {
		return new Promise((resolve, reject) => {
			taskQueue.push(async function () {
				try {
					if (isNaN(userID)) {
						throw new CustomError({
							name: "INVALID_USER_ID",
							message: `The first argument (userID) must be a number, not ${typeof userID}`
						});
					}
					await save(userID, { userID }, "remove");
					return resolve(true);
				}
				catch (err) {
					reject(err);
				}
			});
		});
	}

	return {
		existsSync: function existsSync(userID) {
			return global.db.allUserData.some(u => u.userID == userID);
		},
		getName,
		getNameInDB,
		getAvatarUrl,
		create,
		refreshInfo,
		getAll,
		get,
		set,
		deleteKey,
		getMoney,
		addMoney,
		subtractMoney,
		remove
	};
};
