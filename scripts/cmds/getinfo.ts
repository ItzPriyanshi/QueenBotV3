const axios = require("axios");
const fs = require("fs-extra");
const https = require("https");
const path = require("path");

const CACHE_DIR = path.join(__dirname, "cache");
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

function callFcaMethod(api, methodName, ...args) {
	return new Promise((resolve, reject) => {
		if (!api || typeof api[methodName] !== "function") {
			return reject(new Error(`API method ${methodName} is not available`));
		}
		let settled = false;
		const done = (err, res) => {
			if (settled) return;
			settled = true;
			if (err) return reject(err);
			resolve(res);
		};
		try {
			const maybePromise = api[methodName](...args, done);
			if (maybePromise && typeof maybePromise.then === "function") {
				maybePromise.then(res => done(null, res)).catch(err => done(err, null));
			}
		}
		catch (err) {
			done(err, null);
		}
	});
}

async function safeFcaCall(api, methodName, ...args) {
	try {
		return await callFcaMethod(api, methodName, ...args);
	}
	catch {
		return null;
	}
}

function calculateAccountAge(timestamp) {
	if (!timestamp) return "Unknown";
	let createdMs = NaN;
	if (typeof timestamp === "number" || /^\d+$/.test(String(timestamp).trim())) {
		const num = Number(timestamp);
		if (!Number.isFinite(num) || num <= 0) return "Unknown";
		createdMs = num < 1e12 ? num * 1000 : num;
	}
	else {
		createdMs = Date.parse(String(timestamp));
	}
	if (!Number.isFinite(createdMs) || createdMs <= 0) return "Unknown";

	const createdDate = new Date(createdMs);
	const now = new Date();
	if (isNaN(createdDate.getTime()) || createdDate > now) return "Unknown";

	const diffTime = Math.max(0, now.getTime() - createdDate.getTime());
	const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
	const years = Math.floor(diffDays / 365);
	const months = Math.floor((diffDays % 365) / 30);
	const days = Math.floor((diffDays % 365) % 30);

	const parts = [];
	if (years > 0) parts.push(`${years}y`);
	if (months > 0) parts.push(`${months}m`);
	parts.push(`${days}d`);
	return parts.join(" ");
}

function formatGender(rawGender) {
	if (rawGender === 1 || String(rawGender).toUpperCase() === "FEMALE") return "Female";
	if (rawGender === 2 || String(rawGender).toUpperCase() === "MALE") return "Male";
	if (typeof rawGender === "string" && rawGender.trim() && rawGender.toUpperCase() !== "UNKNOWN") {
		return rawGender.trim();
	}
	return "Not specified";
}

function isHttpUrl(input) {
	return /^https?:[/][/]/i.test(String(input || "").trim());
}

function isFacebookUrl(input) {
	return /^(?:https?:[/][/])?(?:www\.|m\.|mbasic\.|web\.)?(?:facebook\.com|fb\.com)[/]/i.test(String(input || "").trim());
}

function extractUserPayload(rawResult, userID) {
	if (!rawResult || typeof rawResult !== "object") return {};
	if (rawResult[userID] && typeof rawResult[userID] === "object") {
		return rawResult[userID];
	}
	if (rawResult.data && typeof rawResult.data === "object") {
		if (rawResult.data[userID] && typeof rawResult.data[userID] === "object") {
			return rawResult.data[userID];
		}
		return rawResult.data;
	}
	return rawResult;
}

function extractAvatarUrl(avatarResult, userID, userV2, userBasic) {
	if (typeof avatarResult === "string" && isHttpUrl(avatarResult)) {
		return avatarResult;
	}
	if (avatarResult && typeof avatarResult === "object") {
		const byId = avatarResult[userID];
		if (typeof byId === "string" && isHttpUrl(byId)) {
			return byId;
		}
		if (byId && typeof byId.url === "string" && isHttpUrl(byId.url)) {
			return byId.url;
		}
		if (typeof avatarResult.url === "string" && isHttpUrl(avatarResult.url)) {
			return avatarResult.url;
		}
	}
	const candidates = [
		userV2?.avatar,
		userV2?.profile_pic,
		userV2?.picture?.data?.url,
		userV2?.thumbSrc,
		userBasic?.thumbSrc,
		userBasic?.profilePicUrl
	];
	for (const c of candidates) {
		if (typeof c === "string" && isHttpUrl(c)) {
			return c;
		}
	}
	return "";
}

async function downloadAvatarToTempFile(url, userID) {
	if (!url || !isHttpUrl(url)) return null;
	try {
		fs.ensureDirSync(CACHE_DIR);
		const filePath = path.join(CACHE_DIR, `avatar_${String(userID).replace(/[^a-zA-Z0-9_-]/g, "")}_${Date.now()}.jpg`);
		const response = await axios.get(url, {
			responseType: "arraybuffer",
			httpsAgent,
			timeout: 15000,
			headers: {
				"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
			}
		});
		if (response?.data && response.data.byteLength > 100) {
			fs.writeFileSync(filePath, Buffer.from(response.data));
			return filePath;
		}
	}
	catch {
	}
	return null;
}

function cleanupTempFile(filePath, stream) {
	try {
		if (stream && typeof stream.destroy === "function" && !stream.destroyed) {
			stream.destroy();
		}
	}
	catch {
	}
	if (filePath && fs.existsSync(filePath)) {
		try {
			fs.unlinkSync(filePath);
		}
		catch {
		}
	}
}

async function resolveTargetUsers(api, event, args) {
	const mentions = event?.mentions || {};
	const mentionIds = Object.keys(mentions);
	if (mentionIds.length > 0) {
		return { userIDs: mentionIds, searchCandidates: [] };
	}

	if (event?.messageReply?.senderID) {
		return { userIDs: [String(event.messageReply.senderID)], searchCandidates: [] };
	}

	const rawQuery = Array.isArray(args) ? args.join(" ").trim() : "";
	if (!rawQuery) {
		return { userIDs: [String(event.senderID)], searchCandidates: [] };
	}

	if (/^\d+$/.test(rawQuery)) {
		return { userIDs: [rawQuery], searchCandidates: [] };
	}

	if (isFacebookUrl(rawQuery)) {
		const uidResult = await safeFcaCall(api, "getUID", rawQuery);
		const resolvedUid = typeof uidResult === "string" || typeof uidResult === "number"
			? String(uidResult).trim()
			: uidResult?.id || uidResult?.userID || uidResult?.uid;
		if (resolvedUid && /^\d+$/.test(String(resolvedUid))) {
			return { userIDs: [String(resolvedUid)], searchCandidates: [] };
		}
		throw new Error("Could not resolve UID from the provided Facebook URL.");
	}

	const searchResults = await safeFcaCall(api, "getUserID", rawQuery);
	if (Array.isArray(searchResults) && searchResults.length > 0) {
		const validResults = searchResults
			.map(item => ({
				userID: String(item?.userID || item?.uid || item?.id || "").trim(),
				name: String(item?.name || item?.fullName || "Unknown").trim(),
				profileUrl: String(item?.profileUrl || item?.url || "").trim(),
				vanity: String(item?.vanity || item?.username || "").trim()
			}))
			.filter(item => /^\d+$/.test(item.userID));

		if (validResults.length === 1) {
			return { userIDs: [validResults[0].userID], searchCandidates: [] };
		}
		if (validResults.length > 1) {
			return { userIDs: [validResults[0].userID], searchCandidates: validResults.slice(0, 5) };
		}
	}

	throw new Error(`No user found matching "${rawQuery}".`);
}

async function executeRelationshipAction(api, action, targetUserID) {
	const act = String(action || "").toLowerCase();
	if (act === "add" || act === "friend" || act === "request") {
		await callFcaMethod(api, "sendFriendRequest", targetUserID);
		return `✅ Sent a friend request to UID ${targetUserID}.`;
	}
	if (act === "accept" || act === "approve") {
		await callFcaMethod(api, "handleFriendRequest", targetUserID, true);
		return `✅ Accepted friend request from UID ${targetUserID}.`;
	}
	if (act === "reject" || act === "decline") {
		await callFcaMethod(api, "handleFriendRequest", targetUserID, false);
		return `✅ Declined friend request from UID ${targetUserID}.`;
	}
	if (act === "unfriend" || act === "removefriend") {
		await callFcaMethod(api, "unfriend", targetUserID);
		return `✅ Unfriended UID ${targetUserID}.`;
	}
	if (act === "block") {
		await callFcaMethod(api, "changeBlockedStatus", targetUserID, true);
		return `🚫 Blocked UID ${targetUserID}.`;
	}
	if (act === "unblock") {
		await callFcaMethod(api, "changeBlockedStatus", targetUserID, false);
		return `✅ Unblocked UID ${targetUserID}.`;
	}
	return null;
}

async function inspectAndSendUserProfile({
	api,
	message,
	event,
	threadsData,
	usersData,
	userID,
	friendsSet
}) {
	const [rawBasic, rawV2, rawAvatar, dbUser, threadData] = await Promise.all([
		safeFcaCall(api, "getUserInfo", userID),
		safeFcaCall(api, "getUserInfoV2", userID),
		safeFcaCall(api, "getAvatarUser", userID),
		usersData && typeof usersData.get === "function"
			? Promise.resolve(usersData.get(userID)).catch(() => null)
			: Promise.resolve(null),
		threadsData && typeof threadsData.get === "function" && event?.threadID
			? Promise.resolve(threadsData.get(event.threadID)).catch(() => null)
			: Promise.resolve(null)
	]);

	const user = extractUserPayload(rawBasic, userID);
	const userV2 = extractUserPayload(rawV2, userID);

	let memberData = null;
	if (threadData && Array.isArray(threadData.members)) {
		memberData = threadData.members.find(m => String(m?.userID) === String(userID)) || null;
	}

	const name = user.name || userV2.name || dbUser?.name || memberData?.name || "Unknown";
	const username = user.vanity || userV2.username || userV2.vanity || dbUser?.data?.vanity || "";
	const gender = formatGender(user.gender ?? userV2.gender ?? dbUser?.gender);
	const isFriend = Boolean(
		user.isFriend ||
		userV2.is_friend ||
		userV2.isFriend ||
		(friendsSet instanceof Set && friendsSet.has(String(userID)))
	);
	const isVerified = Boolean(user.verified || userV2.is_verified || userV2.verified);
	const isBirthday = Boolean(user.isBirthday || userV2.is_birthday);
	const birthday = userV2.birthday || "";
	const createdRaw = user.createdTime || userV2.created_time || userV2.createdTime || dbUser?.createdAt;
	const accountAge = calculateAccountAge(createdRaw);
	const followers = userV2.followers ?? userV2.follower_count ?? null;
	const location = userV2.location?.name || (typeof userV2.location === "string" ? userV2.location : "") || "";
	const hometown = userV2.hometown?.name || (typeof userV2.hometown === "string" ? userV2.hometown : "") || "";
	const relationship = userV2.relationship_status || "";
	const bio = userV2.about || userV2.bio || userV2.quotes || "";

	const messageCount = memberData
		? Number(memberData.count ?? memberData.messageCount ?? 0)
		: 0;
	const inGroup = memberData ? (memberData.inGroup !== false ? "Yes" : "Left") : "Unknown";
	const joinDate = memberData?.joinedAt
		? new Date(memberData.joinedAt).toLocaleDateString()
		: null;
	const money = dbUser?.money ?? null;
	const exp = dbUser?.exp ?? null;

	const lines = [
		`👤 User Profile • ${name}`,
		`────────────`,
		`• UID: ${userID}`,
		username ? `• Username: @${username}` : null,
		`• Gender: ${gender}`,
		birthday ? `• Birthday: ${birthday}` : (isBirthday ? `• Birthday: Today 🎂` : null),
		`• Profile: facebook.com/${username || userID}`,
		``,
		`📊 Account Status`,
		`────────────`,
		`• Friend: ${isFriend ? "Yes ✓" : "No"}`,
		`• Verified: ${isVerified ? "Verified ✓" : "Standard"}`,
		accountAge !== "Unknown" ? `• Account Age: ${accountAge}` : null,
		followers !== null && followers !== undefined ? `• Followers: ${Number(followers).toLocaleString()}` : null,
		relationship ? `• Relationship: ${relationship}` : null,
		location ? `• Location: ${location}` : null,
		hometown ? `• Hometown: ${hometown}` : null,
		bio ? `• Bio: ${String(bio).trim().slice(0, 120)}` : null,
		``,
		`💬 Group & Bot Stats`,
		`────────────`,
		`• Messages Sent: ${messageCount.toLocaleString()}`,
		`• In Group: ${inGroup}`,
		joinDate ? `• Joined: ${joinDate}` : null,
		money !== null ? `• Balance: ${Number(money).toLocaleString()}` : null,
		exp !== null ? `• EXP: ${Number(exp).toLocaleString()}` : null
	].filter(line => line !== null);

	const responseText = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();

	const avatarUrl = extractAvatarUrl(rawAvatar, userID, userV2, user);
	let tempAvatarPath = await downloadAvatarToTempFile(avatarUrl, userID);
	let avatarStream = null;

	if (tempAvatarPath && fs.existsSync(tempAvatarPath)) {
		avatarStream = fs.createReadStream(tempAvatarPath);
		avatarStream.on("error", () => {});
	}

	const sent = await message.reply(
		avatarStream
			? { body: responseText, attachment: avatarStream }
			: responseText
	);

	if (tempAvatarPath) {
		setTimeout(() => cleanupTempFile(tempAvatarPath, avatarStream), 15000);
	}

	if (sent?.messageID && global.GoatBot?.onReply instanceof Map) {
		global.GoatBot.onReply.set(sent.messageID, {
			commandName: "getinfo",
			messageID: sent.messageID,
			author: event?.senderID,
			targetUserID: String(userID),
			targetName: name
		});
	}
}

module.exports = {
	config: {
		name: "getinfo",
		aliases: ["spy", "userinfo", "whois"],
		version: "2.2.0",
		author: "Priyanshi Kaur",
		countDown: 5,
		role: 0,
		shortDescription: {
			en: "Get detailed user information and manage relationships"
		},
		longDescription: {
			en: "Fetch detailed Facebook user profile info by mention, reply, UID, profile URL, or name search, plus relationship management actions"
		},
		category: "info",
		guide: {
			en:
				"{pn} [@mention | reply | UID | URL | Name]\n" +
				"{pn} friends — View bot friend list summary\n" +
				"{pn} <add|accept|reject|unfriend|block|unblock> <UID|URL|@mention>"
		}
	},

	onStart: async function ({ api, args, message, event, threadsData, usersData, role }) {
		try {
			const cleanArgs = Array.isArray(args) ? args.map(a => String(a || "").trim()).filter(Boolean) : [];
			const subAction = cleanArgs[0] ? cleanArgs[0].toLowerCase() : "";

			if (subAction === "friends" || subAction === "friendlist") {
				const friends = await safeFcaCall(api, "getFriendsList");
				if (!Array.isArray(friends) || friends.length === 0) {
					return await message.reply("📋 No friends found or friend list is unavailable.");
				}
				const preview = friends
					.slice(0, 15)
					.map((f, idx) => `${idx + 1}. ${f.fullName || f.name || "Unknown"} (${f.userID || f.uid || "N/A"})`)
					.join("\n");
				const moreLine = friends.length > 15 ? `\n\n• And ${friends.length - 15} more friends.` : "";
				return await message.reply(
					`👥 Friends List (${friends.length})\n────────────\n${preview}${moreLine}`
				);
			}

			const relationshipActions = ["add", "friend", "request", "accept", "approve", "reject", "decline", "unfriend", "removefriend", "block", "unblock"];
			if (relationshipActions.includes(subAction)) {
				if ((Number(role) || 0) < 2) {
					return await message.reply("⚠️ Only Bot Admins can execute relationship management actions.");
				}
				const targetArgs = cleanArgs.slice(1);
				const resolved = await resolveTargetUsers(api, event, targetArgs);
				const targetUID = resolved.userIDs[0];
				if (!targetUID) {
					return await message.reply("⚠️ Please specify a target user via @mention, reply, UID, or URL.");
				}
				const statusMsg = await executeRelationshipAction(api, subAction, targetUID);
				return await message.reply(statusMsg || "✅ Action completed.");
			}

			const resolved = await resolveTargetUsers(api, event, cleanArgs);

			const friendsList = await safeFcaCall(api, "getFriendsList");
			const friendsSet = new Set();
			if (Array.isArray(friendsList)) {
				for (const f of friendsList) {
					const fId = f?.userID || f?.uid || f?.id;
					if (fId) friendsSet.add(String(fId));
				}
			}

			for (const userID of resolved.userIDs) {
				await inspectAndSendUserProfile({
					api,
					message,
					event,
					threadsData,
					usersData,
					userID: String(userID),
					friendsSet
				});
			}
		}
		catch (err) {
			return await message.reply(`❌ Error retrieving user info: ${err.message}`);
		}
	},

	onReply: async function ({ api, event, message, Reply, role }) {
		const { author, targetUserID } = Reply || {};
		if (author && String(event?.senderID) !== String(author)) {
			return;
		}
		if (!targetUserID) return;

		const action = String(event?.body || "").trim().split(/\s+/)[0]?.toLowerCase() || "";
		const relationshipActions = ["add", "friend", "request", "accept", "approve", "reject", "decline", "unfriend", "removefriend", "block", "unblock"];
		if (!relationshipActions.includes(action)) {
			return;
		}

		if ((Number(role) || 0) < 2) {
			return await message.reply("⚠️ Only Bot Admins can execute relationship management actions.");
		}

		try {
			const resultText = await executeRelationshipAction(api, action, targetUserID);
			if (resultText) {
				return await message.reply(resultText);
			}
		}
		catch (err) {
			return await message.reply(`❌ Relationship action failed: ${err.message}`);
		}
	}
};