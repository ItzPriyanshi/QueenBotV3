const axios = require("axios");
const log = require("../logger/log.js");

function autoUptime(config: any) {
	if (!config.autoUptime || !config.autoUptime.enable) {
		return;
	}

	const url = config.autoUptime.url;
	const interval = (config.autoUptime.timeInterval || 180) * 1000;

	if (!url) {
		return;
	}

	let isPinging = false;
	const timer = setInterval(async () => {
		if (isPinging) return;
		isPinging = true;
		try {
			await axios.get(url, { timeout: 10000 });
			log.info("AUTO UPTIME", `Pinged ${url} successfully`);
		} catch (err: any) {
			log.warn("AUTO UPTIME", `Ping failed: ${err.message}`);
		} finally {
			isPinging = false;
		}
	}, interval);

	return () => clearInterval(timer);
}

module.exports = autoUptime;
