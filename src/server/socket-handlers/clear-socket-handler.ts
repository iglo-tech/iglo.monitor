import { sendHeartbeatList } from "@/server/client";
import { log } from "@/server/logger";
import { clearWithStoppedMonitors } from "@/server/monitor-clear";
import { checkLogin } from "@/server/socket-auth";

/**
 * Register socket events that clear monitor history and statistics.
 *
 * @param socket Socket.io-compatible socket
 * @param heartbeatData Runtime heartbeat data plane
 * @param io Runtime socket adapter
 * @param server Runtime server owning monitor state
 * @param restartMonitor Existing monitor restart capability
 */
export function clearSocketHandler(socket, heartbeatData, io, server, restartMonitor) {
    socket.on("clearEvents", async (monitorID, callback) => {
        try {
            checkLogin(socket);

            log.info("manage", `Clear Events Monitor: ${monitorID} User ID: ${socket.userID}`);

            await heartbeatData.clearEvents(socket.userID, monitorID);

            callback({
                ok: true,
            });
        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    socket.on("clearHeartbeats", async (monitorID, callback) => {
        try {
            checkLogin(socket);

            log.info("manage", `Clear Heartbeats Monitor: ${monitorID} User ID: ${socket.userID}`);

            const monitor = server.monitorList[monitorID];
            const ownedMonitors = monitor?.user_id === socket.userID ? [monitor] : [];
            await clearWithStoppedMonitors(
                ownedMonitors,
                () => heartbeatData.clearMonitor(socket.userID, monitorID),
                (runningMonitor) => restartMonitor(socket.userID, runningMonitor.id)
            );

            await sendHeartbeatList(heartbeatData, io, socket, monitorID, true, true);

            callback({
                ok: true,
            });
        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    socket.on("clearStatistics", async (callback) => {
        try {
            checkLogin(socket);

            log.info("manage", `Clear Statistics User ID: ${socket.userID}`);

            const ownedMonitors = Object.values(server.monitorList).filter(
                (monitor) => monitor.user_id === socket.userID
            );
            await clearWithStoppedMonitors(
                ownedMonitors,
                () => heartbeatData.clearAll(socket.userID),
                (monitor) => restartMonitor(socket.userID, monitor.id)
            );

            callback({
                ok: true,
            });
        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });
}
