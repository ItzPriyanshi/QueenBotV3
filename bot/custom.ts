async function custom({ api, getText }: any) {
	const { log } = (global as any).utils;

	setInterval(async () => {
		if (typeof api.refreshFb_dtsg === "function") {
			api.refreshFb_dtsg()
				.then(() => {
					log.succes("refreshFb_dtsg", getText("custom", "refreshedFb_dtsg"));
				})
				.catch((err: any) => {
					log.error("refreshFb_dtsg", getText("custom", "refreshedFb_dtsgError"), err);
				});
		}
	}, 1000 * 60 * 60 * 48);
}

module.exports = custom;
