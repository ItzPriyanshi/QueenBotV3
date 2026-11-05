const { Server } = require("socket.io");

module.exports = async (server: any) => {
	const { log, getText } = (global as any).utils;
	const { config } = (global as any).GoatBot;
	const { channelName, verifyToken } = config.serverUptime?.socket || {};
	let io: any;

	if (!channelName || !verifyToken) {
		return;
	}

	try {
		io = new Server(server);
		log.info("SOCKET IO", getText("socketIO", "connected"));
	}
	catch (err: any) {
		return log.err("SOCKET IO", getText("socketIO", "error"), err);
	}

	io.on("connection", (socket: any) => {
		if (socket.handshake.query.verifyToken != verifyToken) {
			io.to(socket.id).emit(channelName, {
				status: "error",
				message: "Token is invalid"
			});
			socket.disconnect();
			return;
		}
		log.info("SOCKET IO", `New client connected to socket: ${socket.id}`);
		io.to(socket.id).emit(channelName, {
			status: "success",
			message: "Connected to server successfully"
		});
		socket.on("disconnect", () => {
			log.info("SOCKET IO", `Client disconnected from socket: ${socket.id}`);
		});
	});
};
