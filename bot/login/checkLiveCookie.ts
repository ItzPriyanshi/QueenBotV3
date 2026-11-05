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
	try {
		const response = await axios({
			url: 'https://m.facebook.com/',
			method: "GET",
			headers: {
				cookie,
				"user-agent": userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
				"accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
			},
			maxRedirects: 5,
			validateStatus: () => true,
			timeout: 10000
		});
		const finalUrl = response.request?.res?.responseUrl || response.config?.url || "";
		if (finalUrl.includes("/login") || finalUrl.includes("/checkpoint") || finalUrl.includes("login.php")) {
			return false;
		}
		return true;
	}
	catch (e) {
		return hasUser && hasXs;
	}
}

module.exports = checkLiveCookie;
