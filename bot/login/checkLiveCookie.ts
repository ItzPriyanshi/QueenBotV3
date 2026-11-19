const axios = require("axios");

async function checkLiveCookie(cookie: string, userAgent?: string): Promise<boolean> {
	if (!cookie || typeof cookie !== "string") {
		return false;
	}
	const hasUser = cookie.includes("c_user=") || cookie.includes("i_user=");
	const hasXs = cookie.includes("xs=");
	if (!hasUser || !hasXs) {
		return false;
	}
	const cUserMatch = cookie.match(/(?:c_user|i_user)=(\d+)/);
	const expectedUid = cUserMatch ? cUserMatch[1] : "";
	const ua = userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

	const tryUrl = async (url: string): Promise<boolean | null> => {
		try {
			const response = await axios({
				url,
				method: "GET",
				headers: {
					cookie,
					"user-agent": ua,
					"accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
					"accept-language": "en-US,en;q=0.9",
					"accept-encoding": "gzip, deflate, br",
					"sec-ch-ua": "\"Chromium\";v=\"124\", \"Google Chrome\";v=\"124\", \"Not-A.Brand\";v=\"99\"",
					"sec-ch-ua-mobile": "?0",
					"sec-ch-ua-platform": "\"Windows\"",
					"sec-fetch-dest": "document",
					"sec-fetch-mode": "navigate",
					"sec-fetch-site": "none",
					"sec-fetch-user": "?1",
					"upgrade-insecure-requests": "1",
					"cache-control": "max-age=0",
					"connection": "keep-alive"
				},
				maxRedirects: 10,
				validateStatus: () => true,
				timeout: 20000
			});

			if (response.status === 400 || response.status === 503 || response.status === 429) {
				return null;
			}

			const finalUrl = String(response.request?.res?.responseUrl || response.config?.url || "");
			if (finalUrl.includes("/login") || finalUrl.includes("/checkpoint") || finalUrl.includes("login.php")) {
				return false;
			}

			const body = String(response.data || "");
			if (!body || body.length < 500) {
				return null;
			}

			const userIdMatch = body.match(/"USER_ID":"(\d+)"/);
			if (userIdMatch) {
				if (userIdMatch[1] === "0") return false;
				if (expectedUid && userIdMatch[1] !== expectedUid) return false;
				return true;
			}

			if (body.includes("CurrentUserInitialData") && body.includes('"USER_ID":"0"')) {
				return false;
			}

			if (body.includes("DTSGInitialData") || body.includes("fb_dtsg")) {
				return true;
			}

			if (body.includes("CAAFBLogin") || body.includes("login_form")) {
				return false;
			}

			return null;
		} catch (e: any) {
			if (e && e.code && /ECONNRESET|ENOTFOUND|ETIMEDOUT|ECONNREFUSED/.test(e.code)) {
				return null;
			}
			return null;
		}
	};

	const r1 = await tryUrl("https://m.facebook.com/");
	if (r1 === true) return true;
	if (r1 === false) return false;

	const r2 = await tryUrl("https://www.facebook.com/");
	if (r2 === true) return true;
	if (r2 === false) return false;

	const r3 = await tryUrl("https://mbasic.facebook.com/");
	if (r3 === true) return true;
	if (r3 === false) return false;

	return true;
}

module.exports = checkLiveCookie;
