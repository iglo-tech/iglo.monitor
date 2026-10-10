// @ts-nocheck

import { afterEach, describe, expect, test } from "bun:test";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseMaintenanceCoordinator } from "@/server/database-maintenance";
import { sendHeartbeatList } from "@/server/client";
import { HeartbeatDataPlane } from "@/server/heartbeat-data-plane";
import { clearWithStoppedMonitors } from "@/server/monitor-clear";
import { clearOldData } from "@/server/jobs/clear-old-data";
import "@/server/model-registry";
import { BunSQLiteRedbean } from "@/server/sqlite-core";
import Monitor from "@/server/model/monitor";
import { Notification } from "@/server/notification";
import { IgloMonitorServer } from "@/server/iglo-monitor-server";
import { Settings } from "@/server/settings";
import { Prometheus } from "@/server/prometheus";
import { handleApiRequest } from "@/server/routers/api-router";
import { chartSocketHandler } from "@/server/socket-handlers/chart-socket-handler";
import { clearSocketHandler } from "@/server/socket-handlers/clear-socket-handler";
import { createResponseCache } from "@/server/bun-response";
import { DOWN, MAINTENANCE, PENDING, UP } from "@/constants";

const resources = [];
const originalPrometheusUpdate = Prometheus.prototype.update;
const originalSendNotification = Monitor.sendNotification;
const originalIsUnderMaintenance = Monitor.isUnderMaintenance;
const originalNotificationSend = Notification.send;

dayjs.extend(timezone);

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

async function createRuntime(name, now = dayjs.utc("2026-08-07T12:00:00Z")) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), `iglo-monitor-${name}-`));
    const store = new BunSQLiteRedbean();
    await store.connect({
        sqlitePath: path.join(directory, "kuma.db"),
        templatePath: path.join(process.cwd(), "src/db/kuma.db"),
        testMode: true,
    });
    await store.exec("INSERT INTO user (id, username, active) VALUES (1, ?, 1)", [`${name}-owner`]);
    await store.exec(
        "INSERT INTO monitor (id, name, user_id, active, interval, type) VALUES (1, ?, 1, 1, 60, 'manual')",
        [`${name}-monitor`]
    );
    const data = new HeartbeatDataPlane(store, { now: () => now });
    const settings = new Settings(store);
    const server = new IgloMonitorServer(store, settings);
    const responseCache = createResponseCache();
    resources.push({ directory, settings, store });
    return { data, responseCache, server, settings, store };
}

function heartbeat(store, values = {}) {
    return Object.assign(store.dispense("heartbeat"), {
        monitor_id: 1,
        status: UP,
        msg: "OK",
        ping: 0,
        important: 1,
        duration: 60,
        retries: 0,
        time: store.isoDateTimeMillis(dayjs.utc("2026-08-07T12:00:00Z")),
        ...values,
    });
}

afterEach(async () => {
    Prometheus.prototype.update = originalPrometheusUpdate;
    Monitor.sendNotification = originalSendNotification;
    Monitor.isUnderMaintenance = originalIsUnderMaintenance;
    Notification.send = originalNotificationSend;
    for (const { directory, settings, store } of resources.splice(0)) {
        settings.stopCacheCleaner();
        await store.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe("heartbeat data plane", () => {
    test("isolates writes, reads, rolling buckets, and cache ownership between two real stores", async () => {
        const first = await createRuntime("first");
        const second = await createRuntime("second");

        await first.data.write(heartbeat(first.store, { ping: 0, retries: 2, duration: 7 }));

        expect((await first.data.latest(1)).toJSON()).toMatchObject({
            monitorID: 1,
            status: UP,
            ping: 0,
            important: 1,
            retries: 2,
            duration: 7,
        });
        expect(await first.data.list(1)).toHaveLength(1);
        expect((await first.data.stats(1)).day).toMatchObject({ uptime: 1, avgPing: 0 });

        expect(await second.data.latest(1)).toBeNull();
        expect(await second.data.list(1)).toEqual([]);
        expect((await second.data.stats(1)).day).toMatchObject({ uptime: 0, avgPing: null });

        const firstCalculator = await first.data.uptime.get(1);
        const secondCalculator = await second.data.uptime.get(1);
        expect(firstCalculator).not.toBe(secondCalculator);
        expect(await first.data.uptime.get("1")).toBe(firstCalculator);
        expect(firstCalculator.minutelyUptimeDataList.length()).toBe(1);
        expect(secondCalculator.minutelyUptimeDataList.length()).toBe(0);

        second.data.reset();
        expect((await first.data.stats(1)).day.uptime).toBe(1);
        expect(first.data.operationQueues).not.toBe(second.data.operationQueues);
    });

    test("preserves status, ping, important, retry, and rolling aggregate semantics", async () => {
        const { data, store } = await createRuntime("semantics");
        const statuses = [UP, DOWN, PENDING, MAINTENANCE];

        for (const [index, status] of statuses.entries()) {
            await data.write(
                heartbeat(store, {
                    status,
                    ping: status === UP ? 0 : null,
                    important: index % 2,
                    retries: index,
                    time: store.isoDateTimeMillis(dayjs.utc("2026-08-07T12:00:00Z").add(index, "second")),
                })
            );
        }

        const list = (await data.list(1)).map((beat) => beat.toJSON());
        expect(list.map(({ status }) => status)).toEqual(statuses);
        expect(list[0].ping).toBe(0);
        expect(list[2]).toMatchObject({ important: 0, retries: 2 });
        expect((await data.stats(1)).day).toMatchObject({ uptime: 1 / 3, avgPing: 0 });
        expect((await data.uptime.get(1)).lastDailyUptimeData.maintenance).toBe(1);
    });

    test("rolls back heartbeat and stats without publishing or mutating cache on a DB error", async () => {
        const { data, store } = await createRuntime("rollback");
        await store.exec(`CREATE TRIGGER fail_daily BEFORE INSERT ON stat_daily
                          BEGIN SELECT RAISE(ABORT, 'forced stat failure'); END`);
        const bean = heartbeat(store);
        let published = 0;

        await expect(
            data.write(bean).then(() => {
                published++;
            })
        ).rejects.toThrow("forced stat failure");

        expect(published).toBe(0);
        expect(await store.getCell("SELECT COUNT(*) FROM heartbeat")).toBe(0);
        expect(await store.getCell("SELECT COUNT(*) FROM stat_daily")).toBe(0);
        expect(await data.list(1)).toEqual([]);
        expect((await data.stats(1)).day).toMatchObject({ uptime: 0, avgPing: null });
        expect(bean.id).toBeUndefined();
    });

    test("keeps concurrent writes lossless and maintenance drain waits for the active transaction", async () => {
        const { data, store } = await createRuntime("drain");
        const coordinator = new DatabaseMaintenanceCoordinator();
        const started = deferred();
        const release = deferred();
        const originalBegin = store.begin.bind(store);
        let holdFirstWrite = true;
        store.begin = async () => {
            const transaction = await originalBegin();
            const originalStore = transaction.store;
            transaction.store = async (...args) => {
                if (holdFirstWrite) {
                    holdFirstWrite = false;
                    started.resolve();
                    await release.promise;
                }
                return originalStore(...args);
            };
            return transaction;
        };

        const first = coordinator.run(() => data.write(heartbeat(store, { time: "2026-08-07 12:00:00.000" })));
        const second = coordinator.run(() => data.write(heartbeat(store, { time: "2026-08-07 12:00:01.000" })));
        await started.promise;

        let snapshotStarted = false;
        const maintenance = coordinator.maintain(() => {
            snapshotStarted = true;
        });
        await Bun.sleep(0);
        expect(snapshotStarted).toBe(false);

        release.resolve();
        await Promise.all([first, second, maintenance]);
        expect(snapshotStarted).toBe(true);
        expect(await data.list(1)).toHaveLength(2);
        expect((await data.stats(1)).day).toMatchObject({ uptime: 1, avgPing: 0 });
        expect((await data.uptime.get(1)).lastUptimeData.up).toBe(2);
    });

    test("keeps important pagination and clear operations isolated by user", async () => {
        const { data, store } = await createRuntime("ownership");
        await store.exec("INSERT INTO user (id, username, active) VALUES (2, 'other-owner', 1)");
        await store.exec(
            "INSERT INTO monitor (id, name, user_id, active, interval, type) VALUES (2, 'other', 2, 1, 60, 'manual')"
        );
        await data.write(heartbeat(store));
        await data.write(heartbeat(store, { monitor_id: 2, msg: "foreign" }));

        expect(await data.importantCount(1)).toBe(1);
        expect(await data.importantCount(2)).toBe(1);
        expect((await data.importantPage(1, null, 0, 10)).map((beat) => beat.monitor_id)).toEqual([1]);
        expect((await data.importantPage(2, null, 0, 10)).map((beat) => beat.monitor_id)).toEqual([2]);

        await data.clearEvents(1, 2);
        expect((await data.latest(2)).important).toBe(1);
        await expect(data.clearMonitor(1, 2)).rejects.toThrow("You do not own this monitor.");
        expect(await data.latest(2)).not.toBeNull();

        const handlers = {};
        chartSocketHandler(
            {
                userID: 1,
                on: (event, handler) => {
                    handlers[event] = handler;
                },
            },
            store,
            data
        );
        let chartResponse;
        await handlers.getMonitorChartData(2, 24, (response) => {
            chartResponse = response;
        });
        expect(chartResponse).toMatchObject({ ok: false, msg: "You do not own this monitor." });
        await handlers.getMonitorChartData(1, 24, (response) => {
            chartResponse = response;
        });
        expect(chartResponse.ok).toBe(true);

        await data.clearAll(1);
        expect(await data.latest(1)).toBeNull();
        expect(await data.latest(2)).not.toBeNull();
    });

    test("keeps clear socket acknowledgements and monitor restart ordering", async () => {
        const { data, server, store } = await createRuntime("clear-socket");
        const handlers = {};
        const emitted = [];
        const lifecycle = [];
        const socket = {
            userID: 1,
            emit: (...args) => emitted.push(args),
            on: (event, handler) => {
                handlers[event] = handler;
            },
        };
        const runningMonitor = {
            id: 1,
            user_id: 1,
            active: 1,
            stop: async () => lifecycle.push("stop"),
        };
        server.monitorList[1] = runningMonitor;
        const io = {
            to: () => ({
                emit: (...args) => emitted.push(args),
            }),
        };

        clearSocketHandler(socket, data, io, server, async (userID, monitorID) => {
            lifecycle.push(["restart", userID, monitorID]);
        });

        await data.write(heartbeat(store, { msg: "event" }));
        let response;
        await handlers.clearEvents(1, (result) => {
            response = result;
        });
        expect(response).toEqual({ ok: true });
        expect((await data.latest(1)).toJSON()).toMatchObject({ msg: "", important: 0 });

        await data.write(heartbeat(store, { msg: "heartbeat" }));
        await handlers.clearHeartbeats(1, (result) => {
            response = result;
        });
        expect(response).toEqual({ ok: true });
        expect(await data.list(1)).toEqual([]);
        expect(lifecycle).toEqual(["stop", ["restart", 1, 1]]);
        expect(emitted).toContainEqual(["heartbeatList", 1, [], true]);

        await data.write(heartbeat(store, { msg: "statistics" }));
        await handlers.clearStatistics((result) => {
            response = result;
        });
        expect(response).toEqual({ ok: true });
        expect(await data.list(1)).toEqual([]);
        expect(lifecycle).toEqual(["stop", ["restart", 1, 1], "stop", ["restart", 1, 1]]);
    });

    test("filters recent heartbeat reads by the authenticated owner", async () => {
        const { data, store } = await createRuntime("recent-owner");
        await store.exec("INSERT INTO user (id, username, active) VALUES (2, 'foreign-owner', 1)");
        await store.exec(
            "INSERT INTO monitor (id, name, user_id, active, interval, type) VALUES (2, 'foreign', 2, 1, 60, 'manual')"
        );
        await data.write(heartbeat(store, { msg: "owner-secret", time: store.isoDateTimeMillis(dayjs.utc()) }));
        await data.write(
            heartbeat(store, { monitor_id: 2, msg: "foreign-secret", time: store.isoDateTimeMillis(dayjs.utc()) })
        );

        expect((await data.recentForOwner(1, 1, 24)).map((beat) => beat.msg)).toEqual(["owner-secret"]);
        expect(await data.recentForOwner(2, 1, 24)).toEqual([]);
        expect((await data.recentForOwner(2, 2, 24)).map((beat) => beat.msg)).toEqual(["foreign-secret"]);
    });

    test("serializes concurrent push transitions and resend counters without lost updates", async () => {
        const { data, server, settings, store } = await createRuntime("push-race");
        Prometheus.prototype.update = () => {};
        await store.exec(
            "UPDATE monitor SET type = 'push', push_token = 'race-token', maxretries = 0, resend_interval = 0 WHERE id = 1"
        );
        await data.write(heartbeat(store, { important: 0 }));
        const notifications = [];
        Monitor.sendNotification = async (...args) => notifications.push(args);
        const io = { rooms: new Map(), to: () => ({ emit: () => {} }) };
        server.io = io;
        const context = { server, store, heartbeatData: data, settings, disableFrameSameOrigin: false };

        const responses = await Promise.all(
            [1, 2].map((request) =>
                handleApiRequest(
                    new Request(`http://localhost/api/push/race-token?status=down&msg=down-${request}`),
                    context
                )
            )
        );
        expect(await Promise.all(responses.map((response) => response.json()))).toEqual([{ ok: true }, { ok: true }]);
        const raceBeats = await data.list(1);
        expect(raceBeats.slice(1).map((beat) => [beat.status, beat.important])).toEqual([
            [DOWN, 1],
            [DOWN, 0],
        ]);
        expect(notifications).toHaveLength(1);

        await store.exec("DELETE FROM heartbeat");
        data.reset();
        notifications.length = 0;
        await store.exec("UPDATE monitor SET maxretries = 2, resend_interval = 2 WHERE id = 1");
        await data.write(heartbeat(store, { important: 0 }));
        const retryResponses = await Promise.all(
            Array.from({ length: 5 }, (_, request) =>
                handleApiRequest(
                    new Request(`http://localhost/api/push/race-token?status=down&msg=retry-${request}`),
                    context
                )
            )
        );
        expect((await Promise.all(retryResponses.map((response) => response.json()))).every(({ ok }) => ok)).toBe(true);
        const retryBeats = (await data.list(1)).slice(1);
        expect(retryBeats.map((beat) => [beat.status, beat.retries, beat.downCount])).toEqual([
            [PENDING, 1, 0],
            [PENDING, 2, 0],
            [DOWN, 3, 0],
            [DOWN, 4, 1],
            [DOWN, 5, 0],
        ]);
        expect(notifications).toHaveLength(2);
    });

    test("publishes concurrent push transitions in commit order and never publishes a failed commit", async () => {
        const { data, server, settings, store } = await createRuntime("push-publication-order");
        Prometheus.prototype.update = () => {};
        await store.exec(
            "UPDATE monitor SET type = 'push', push_token = 'ordered-token', maxretries = 0, resend_interval = 0 WHERE id = 1"
        );
        await data.write(heartbeat(store, { important: 0 }));

        const downNotificationStarted = deferred();
        const releaseDownNotification = deferred();
        const notificationStatuses = [];
        const socketStatuses = [];
        Monitor.sendNotification = async (_isFirstBeat, _monitor, bean) => {
            if (bean.status === DOWN) {
                downNotificationStarted.resolve();
                await releaseDownNotification.promise;
            }
            notificationStatuses.push(bean.status);
        };
        const io = {
            rooms: new Map(),
            to: () => ({
                emit: (event, payload) => {
                    if (event === "heartbeat") {
                        socketStatuses.push(payload.status);
                    }
                },
            }),
        };
        server.io = io;
        const context = { server, store, heartbeatData: data, settings, disableFrameSameOrigin: false };
        const coordinator = new DatabaseMaintenanceCoordinator();

        const down = coordinator.run(() =>
            handleApiRequest(
                new Request("http://localhost/api/push/ordered-token?status=down&msg=ordered-down"),
                context
            )
        );
        await downNotificationStarted.promise;
        const up = coordinator.run(() =>
            handleApiRequest(new Request("http://localhost/api/push/ordered-token?status=up&msg=ordered-up"), context)
        );
        await Bun.sleep(20);

        expect((await data.latest(1)).status).toBe(DOWN);
        expect(notificationStatuses).toEqual([]);
        expect(socketStatuses).toEqual([]);
        let maintenanceStarted = false;
        const maintenance = coordinator.maintain(() => {
            maintenanceStarted = true;
        });
        await Bun.sleep(0);
        expect(maintenanceStarted).toBe(false);

        releaseDownNotification.resolve();
        const responses = await Promise.all([down, up]);
        await maintenance;
        expect(maintenanceStarted).toBe(true);
        expect(await Promise.all(responses.map((response) => response.json()))).toEqual([{ ok: true }, { ok: true }]);
        expect(notificationStatuses).toEqual([DOWN, UP]);
        expect(socketStatuses).toEqual([DOWN, UP]);
        expect((await data.latest(1)).status).toBe(UP);
        expect((await data.uptime.get(1)).lastUptimeData).toMatchObject({ up: 2, down: 1 });

        await store.exec(`CREATE TRIGGER fail_ordered_push BEFORE INSERT ON stat_daily
                          BEGIN SELECT RAISE(ABORT, 'forced ordered push failure'); END`);
        notificationStatuses.length = 0;
        socketStatuses.length = 0;
        const failed = await handleApiRequest(
            new Request("http://localhost/api/push/ordered-token?status=down&msg=must-not-publish"),
            context
        );
        expect(await failed.json()).toMatchObject({ ok: false, msg: "forced ordered push failure" });
        expect(notificationStatuses).toEqual([]);
        expect(socketStatuses).toEqual([]);
        expect((await data.latest(1)).status).toBe(UP);
    });

    test("revalidates a push scheduler timeout behind a concurrent API heartbeat", async () => {
        const { data, responseCache, server, settings, store } = await createRuntime("push-scheduler-revalidate");
        Prometheus.prototype.update = () => {};
        await store.exec(
            "UPDATE monitor SET type = 'push', push_token = 'scheduler-token', interval = 60, maxretries = 0 WHERE id = 1"
        );
        await data.write(
            heartbeat(store, {
                important: 0,
                time: store.isoDateTimeMillis(dayjs.utc().subtract(5, "minute")),
            })
        );

        const schedulerPaused = deferred();
        const resumeScheduler = deferred();
        let maintenanceCalls = 0;
        Monitor.isUnderMaintenance = async () => {
            maintenanceCalls++;
            if (maintenanceCalls === 1) {
                schedulerPaused.resolve();
                await resumeScheduler.promise;
            }
            return false;
        };
        const notifications = [];
        const socketStatuses = [];
        Monitor.sendNotification = async (_isFirstBeat, _monitor, bean) => notifications.push(bean.status);
        const io = {
            rooms: new Map(),
            to: () => ({
                emit: (event, payload) => {
                    if (event === "heartbeat") {
                        socketStatuses.push(payload.status);
                    }
                },
            }),
        };
        server.io = io;
        server.sendMaintenanceListByUserID = async () => {};
        const monitor = await store.load("monitor", 1);
        let scheduled;
        monitor.scheduleHeartbeat = (callback, delay) => {
            scheduled = { callback, delay };
        };
        await monitor.start(io, data, server, undefined, responseCache);
        scheduled.callback();
        await schedulerPaused.promise;

        const pushed = await handleApiRequest(
            new Request("http://localhost/api/push/scheduler-token?status=up&msg=fresh-api-beat"),
            { server, store, heartbeatData: data, settings, disableFrameSameOrigin: false }
        );
        expect(await pushed.json()).toEqual({ ok: true });
        resumeScheduler.resolve();
        await monitor.activeHeartbeat;

        expect((await data.list(1)).map((bean) => bean.status)).toEqual([UP, UP]);
        expect((await data.latest(1)).msg).toBe("fresh-api-beat");
        expect(notifications).toEqual([]);
        expect(socketStatuses).toEqual([UP]);
    });

    test("writes one DOWN when a push scheduler timeout remains stale", async () => {
        const { data, responseCache, server: runtimeServer, store } = await createRuntime("push-scheduler-timeout");
        Prometheus.prototype.update = () => {};
        await store.exec("UPDATE monitor SET type = 'push', interval = 60, maxretries = 0 WHERE id = 1");
        await data.write(
            heartbeat(store, {
                important: 0,
                time: store.isoDateTimeMillis(dayjs.utc().subtract(5, "minute")),
            })
        );

        const notifications = [];
        const socketStatuses = [];
        Monitor.sendNotification = async (_isFirstBeat, _monitor, bean) => notifications.push(bean.status);
        const io = {
            rooms: new Map(),
            to: () => ({
                emit: (event, payload) => {
                    if (event === "heartbeat") {
                        socketStatuses.push(payload.status);
                    }
                },
            }),
        };
        runtimeServer.sendMaintenanceListByUserID = async () => {};
        const monitor = await store.load("monitor", 1);
        let scheduled;
        monitor.scheduleHeartbeat = (callback, delay) => {
            scheduled = { callback, delay };
        };
        await monitor.start(io, data, runtimeServer, undefined, responseCache);
        scheduled.callback();
        await monitor.activeHeartbeat;

        expect((await data.list(1)).map((bean) => bean.status)).toEqual([UP, DOWN]);
        expect(notifications).toEqual([DOWN]);
        expect(socketStatuses).toEqual([DOWN]);
    });

    test("pins an active calculator across LRU churn and queued writes", async () => {
        const { store } = await createRuntime("uptime-pin");
        await store.exec(
            "INSERT INTO monitor (id, name, user_id, active, interval, type) VALUES (2, 'churn', 1, 1, 60, 'manual')"
        );
        const data = new HeartbeatDataPlane(store, { maxCalculators: 1 });
        const firstWriteStarted = deferred();
        const releaseFirstWrite = deferred();
        const originalBegin = store.begin.bind(store);
        let holdFirstWrite = true;
        store.begin = async () => {
            if (holdFirstWrite) {
                holdFirstWrite = false;
                firstWriteStarted.resolve();
                await releaseFirstWrite.promise;
            }
            return originalBegin();
        };

        const first = data.write(heartbeat(store, { time: "2026-08-07 12:00:00.000" }));
        await firstWriteStarted.promise;
        const activeCalculator = await data.uptime.get(1);
        await data.uptime.get(2);
        await data.stats(1);
        expect(await data.uptime.get(1)).toBe(activeCalculator);
        expect([...data.uptime.list.keys()]).toEqual(["1"]);

        const second = data.write(heartbeat(store, { time: "2026-08-07 12:00:01.000" }));
        releaseFirstWrite.resolve();
        await Promise.all([first, second]);

        expect(await store.getCell("SELECT COUNT(*) FROM heartbeat WHERE monitor_id = 1")).toBe(2);
        expect(await store.getCell("SELECT up FROM stat_minutely WHERE monitor_id = 1")).toBe(2);
        expect((await data.uptime.get(1)).lastUptimeData.up).toBe(2);
        expect(data.uptime.list.size).toBeLessThanOrEqual(1);
    });

    test("does not allocate uptime buckets for anonymous or read-only requests and bounds the registry", async () => {
        const { data, responseCache, server, settings, store } = await createRuntime("read-only", dayjs.utc());
        const io = { rooms: new Map(), to: () => ({ emit: () => {} }) };
        server.io = io;
        const context = { server, store, heartbeatData: data, settings, responseCache, disableFrameSameOrigin: false };

        for (let id = 1; id <= 50; id++) {
            const response = await handleApiRequest(
                new Request(`http://localhost/api/badge/${id}/ping?cache=${id}`),
                context
            );
            expect(await response.text()).toContain("N/A");
        }
        expect(data.uptime.list.size).toBe(0);

        const empty = await data.uptime.get(1);
        for (let i = 0; i < 20; i++) {
            await data.stats(1);
            empty.getKey(dayjs.utc(), "day");
            empty.getKey(dayjs.utc(), "hour");
            empty.getKey(dayjs.utc(), "minute");
            empty.getDataArray(24, "hour");
            empty.getDataArray(1440, "minute");
        }
        expect([
            empty.minutelyUptimeDataList.length(),
            empty.hourlyUptimeDataList.length(),
            empty.dailyUptimeDataList.length(),
        ]).toEqual([0, 0, 0]);

        const bounded = new HeartbeatDataPlane(store, { maxCalculators: 2 });
        await bounded.uptime.get(1);
        await bounded.uptime.get(2);
        await bounded.uptime.get(3);
        expect([...bounded.uptime.list.keys()]).toEqual(["2", "3"]);
    });

    test("emits certificates, tags, maintenance, and notifications from the injected store", async () => {
        const first = await createRuntime("emission-first");
        const second = await createRuntime("emission-second");
        for (const [runtime, suffix, maintenance] of [
            [first, "first", true],
            [second, "second", false],
        ]) {
            await runtime.store.exec(
                "UPDATE monitor SET kafka_producer_brokers = '[]', rabbitmq_nodes = '[]' WHERE id = 1"
            );
            await runtime.store.exec("INSERT INTO monitor_tls_info (monitor_id, info_json) VALUES (1, ?)", [
                JSON.stringify({ certInfo: suffix }),
            ]);
            await runtime.store.exec("INSERT INTO tag (id, name, color) VALUES (1, ?, ?)", [
                `${suffix}-tag`,
                maintenance ? "#111111" : "#222222",
            ]);
            await runtime.store.exec("INSERT INTO monitor_tag (monitor_id, tag_id, value) VALUES (1, 1, ?)", [suffix]);
            await runtime.store.exec("INSERT INTO notification (id, name, user_id, config) VALUES (1, ?, 1, ?)", [
                `${suffix}-notification`,
                JSON.stringify({ type: "test" }),
            ]);
            await runtime.store.exec("INSERT INTO monitor_notification (monitor_id, notification_id) VALUES (1, 1)");
            if (maintenance) {
                await runtime.store.exec(
                    "INSERT INTO maintenance (id, title, description, user_id, active, strategy) VALUES (1, 'first', '', 1, 1, 'manual')"
                );
                await runtime.store.exec("INSERT INTO monitor_maintenance (monitor_id, maintenance_id) VALUES (1, 1)");
            }
        }

        const firstSettings = first.settings;
        const secondSettings = second.settings;
        const firstServer = first.server;
        const secondServer = second.server;
        firstServer.maintenanceList = { 1: { isUnderMaintenance: async () => true } };
        secondServer.maintenanceList = {};
        firstServer.getTimezone = secondServer.getTimezone = async () => "UTC";
        firstServer.getTimezoneOffset = secondServer.getTimezoneOffset = () => "+00:00";
        const sent = [];
        Notification.send = async (_registry, _config, _msg, monitorJSON) => sent.push(monitorJSON);

        try {
            const firstEvents = [];
            const secondEvents = [];
            const io = (events) => ({
                rooms: new Map([[1, new Set(["client"])]]),
                to: () => ({ emit: (...args) => events.push(args) }),
            });
            await Monitor.sendStats(first.data, io(firstEvents), 1, 1, firstSettings);
            await Monitor.sendStats(second.data, io(secondEvents), 1, 1, secondSettings);
            expect(firstEvents).toContainEqual(["certInfo", 1, JSON.stringify({ certInfo: "first" })]);
            expect(secondEvents).toContainEqual(["certInfo", 1, JSON.stringify({ certInfo: "second" })]);

            const firstMonitor = await first.store.findOne("monitor", "id = ?", [1]);
            const secondMonitor = await second.store.findOne("monitor", "id = ?", [1]);
            await Monitor.sendNotification(
                false,
                firstMonitor,
                heartbeat(first.store, { status: DOWN }),
                first.store,
                firstServer
            );
            await Monitor.sendNotification(
                false,
                secondMonitor,
                heartbeat(second.store, { status: DOWN }),
                second.store,
                secondServer
            );
            expect(sent.map((monitor) => [monitor.tags[0].name, monitor.maintenance])).toEqual([
                ["first-tag", true],
                ["second-tag", false],
            ]);
            expect(sent.map((monitor) => Object.keys(monitor.notificationIDList))).toEqual([["1"], ["1"]]);
        } finally {
            firstSettings.stopCacheCleaner();
            secondSettings.stopCacheCleaner();
        }
    });

    test("restores the exact running set when stopping or clearing fails", async () => {
        const restarted = [];
        const first = { id: 1, active: 1, stop: async () => {} };
        const second = { id: 2, active: true, stop: async () => Promise.reject(new Error("stop failed")) };
        const inactive = { id: 3, active: 0, stop: async () => Promise.reject(new Error("unexpected stop")) };

        await expect(
            clearWithStoppedMonitors(
                [first, second, inactive],
                async () => {},
                async ({ id }) => restarted.push(id)
            )
        ).rejects.toThrow("stop failed");
        expect(restarted.sort()).toEqual([1, 2]);

        restarted.length = 0;
        second.stop = async () => {};
        await expect(
            clearWithStoppedMonitors(
                [first, second, inactive],
                async () => Promise.reject(new Error("clear failed")),
                async ({ id }) => restarted.push(id)
            )
        ).rejects.toThrow("clear failed");
        expect(restarted.sort()).toEqual([1, 2]);
    });

    test("drains a racing write before clear and gates the next write until restore", async () => {
        const { data, store } = await createRuntime("clear-race");
        const coordinator = new DatabaseMaintenanceCoordinator();
        const started = deferred();
        const release = deferred();
        const events = [];
        const originalBegin = store.begin.bind(store);
        let hold = true;
        store.begin = async () => {
            const transaction = await originalBegin();
            const originalStore = transaction.store;
            transaction.store = async (...args) => {
                if (hold) {
                    hold = false;
                    events.push("write-start");
                    started.resolve();
                    await release.promise;
                }
                return originalStore(...args);
            };
            return transaction;
        };
        const running = {
            id: 1,
            active: 1,
            stop: async () => events.push("stop"),
        };

        const firstWrite = coordinator.run(() => data.write(heartbeat(store, { msg: "before-clear" })));
        await started.promise;
        const clear = coordinator.maintain(() =>
            clearWithStoppedMonitors(
                [running],
                async () => {
                    events.push("clear");
                    await data.clearMonitor(1, 1);
                },
                async () => events.push("restart")
            )
        );
        const nextWrite = coordinator.run(() => data.write(heartbeat(store, { msg: "after-clear" })));
        await Bun.sleep(0);
        expect(events).toEqual(["write-start"]);

        release.resolve();
        await Promise.all([firstWrite, clear, nextWrite]);
        expect(events).toEqual(["write-start", "stop", "clear", "restart"]);
        expect((await data.list(1)).map((beat) => beat.msg)).toEqual(["after-clear"]);
    });

    test("keeps push retry, upside-down, live heartbeat, list, and stats payloads compatible", async () => {
        const { data, server, settings, store } = await createRuntime("payloads");
        await store.exec("UPDATE monitor SET push_token = 'retry-token', maxretries = 2 WHERE id = 1");
        await store.exec(
            "INSERT INTO monitor (id, name, user_id, active, interval, type, push_token, upside_down) VALUES (2, 'upside-down', 1, 1, 60, 'push', 'flip-token', 1)"
        );
        const emitted = [];
        const io = {
            rooms: new Map(),
            to: () => ({ emit: (...args) => emitted.push(args) }),
        };
        server.io = io;
        Prometheus.prototype.update = () => {};

        const pendingResponse = await handleApiRequest(
            new Request("http://localhost/api/push/retry-token?status=down&ping=0&msg=retry"),
            { server, store, heartbeatData: data, settings, disableFrameSameOrigin: false }
        );
        expect(await pendingResponse.json()).toEqual({ ok: true });
        expect((await data.latest(1)).toJSON()).toMatchObject({
            status: PENDING,
            ping: 0,
            msg: "retry",
            important: 1,
            retries: 1,
        });

        const flippedResponse = await handleApiRequest(
            new Request("http://localhost/api/push/flip-token?status=down&ping=0"),
            { server, store, heartbeatData: data, settings, disableFrameSameOrigin: false }
        );
        expect(await flippedResponse.json()).toEqual({ ok: true });
        expect((await data.latest(2)).toJSON()).toMatchObject({ status: UP, ping: 0, retries: 0 });
        expect(emitted.filter(([event]) => event === "heartbeat")).toHaveLength(2);

        const socketEvents = [];
        await sendHeartbeatList(data, io, { userID: 1, emit: (...args) => socketEvents.push(args) }, 1);
        expect(socketEvents).toEqual([
            [
                "heartbeatList",
                1,
                [expect.objectContaining({ monitorID: 1, status: PENDING, ping: 0, retries: 1 })],
                false,
            ],
        ]);

        const originalCert = Monitor.sendCertInfo;
        const originalDomain = Monitor.sendDomainInfo;
        Monitor.sendCertInfo = async () => {};
        Monitor.sendDomainInfo = async () => {};
        io.rooms.set(1, new Set(["client"]));
        try {
            await Monitor.sendStats(data, io, 1, 1, settings);
            await Monitor.sendStats(data, io, 2, 1, settings);
        } finally {
            Monitor.sendCertInfo = originalCert;
            Monitor.sendDomainInfo = originalDomain;
        }
        expect(emitted).toContainEqual(["avgPing", 1, null]);
        expect(emitted).toContainEqual(["avgPing", 2, 0]);
        expect(emitted).toContainEqual(["uptime", 1, 24, 0]);
        expect(emitted).toContainEqual(["uptime", 1, 720, 0]);
        expect(emitted).toContainEqual(["uptime", 1, "1y", 0]);
    });

    test("retention cleanup racing a tracked write removes only expired data", async () => {
        // Retention uses SQLite's wall clock, so keep the fixture and calculator on the same clock.
        const now = dayjs.utc();
        const { data, store } = await createRuntime("retention", now);
        await store.exec(
            "INSERT INTO heartbeat (monitor_id, status, msg, time, important) VALUES (1, 0, 'expired', ?, 1)",
            [store.isoDateTimeMillis(now.subtract(31, "day"))]
        );
        const coordinator = new DatabaseMaintenanceCoordinator();
        const settings = {
            get: async () => 30,
            set: async () => {
                throw new Error("unexpected settings write");
            },
        };

        await Promise.all([
            coordinator.run(() => data.write(heartbeat(store, { time: store.isoDateTimeMillis(now) }))),
            coordinator.maintain(() => clearOldData(store, settings, data)),
        ]);

        const list = await data.list(1);
        expect(list).toHaveLength(1);
        expect(list[0].msg).toBe("OK");
        expect((await data.stats(1)).day.uptime).toBe(1);
    });
});
