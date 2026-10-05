// @ts-nocheck
"use strict";

import fs from "fs";
import path from "path";
import { Database as SQLiteDatabase } from "bun:sqlite";
import { isDev } from "@/server/runtime-flags";
import { log } from "@/server/logger";
import { printServerUrls } from "@/server/server-urls";
import config from "@/server/config";
import Database from "@/server/database";
import type { SQLiteStore } from "@/server/db-migrations";
import type { DatabaseMaintenanceCoordinator } from "@/server/database-maintenance";
import StatusPage from "@/server/model/status_page";
import { Prometheus } from "@/server/prometheus";
import { initBackgroundJobs, stopBackgroundJobs } from "@/server/jobs";
import { authenticateAPIRequest } from "@/server/auth";
import { handleApiRequest } from "@/server/routers/api-router";
import { handleStatusPageRequest } from "@/server/routers/status-page-router";
import {
    applyCommonHeaders,
    clearResponseCache,
    createResponseCache,
    htmlResponse,
    jsonResponse,
    redirectResponse,
    textResponse,
} from "@/server/bun-response";
import { isCompiledBinary } from "@/server/app-paths";

const MIME_TYPES = {
    ".br": "application/octet-stream",
    ".css": "text/css; charset=utf-8",
    ".gif": "image/gif",
    ".gz": "application/gzip",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".wasm": "application/wasm",
    ".webmanifest": "application/manifest+json",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
};

function validateSqliteSnapshot(snapshotPath) {
    const db = new SQLiteDatabase(snapshotPath, { strict: true });
    try {
        const check = db.query("PRAGMA quick_check").get();
        if (Object.values(check || {})[0] !== "ok") {
            throw new Error("Snapshot failed SQLite integrity validation.");
        }
        const requiredTables = db
            .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('monitor', 'setting', 'user')")
            .all();
        if (requiredTables.length !== 3) {
            throw new Error("Snapshot is not an iglo.monitor database.");
        }
        if (db.query("PRAGMA foreign_key_check").all().length > 0) {
            throw new Error("Snapshot failed foreign-key validation.");
        }
    } finally {
        db.close();
        fs.rmSync(`${snapshotPath}-shm`, { force: true });
        fs.rmSync(`${snapshotPath}-wal`, { force: true });
    }
}

async function stopRuntimeForSnapshot(server, settings, heartbeatData, backgroundJobs, responseCache) {
    stopBackgroundJobs(backgroundJobs);
    for (const maintenance of Object.values(server.maintenanceList)) {
        maintenance.stop();
    }
    await Promise.all(Object.values(server.monitorList).map((monitor) => monitor.stop()));
    await server.getLoadedMonitorType("real-browser")?.resetChrome();
    server.monitorList = {};
    server.maintenanceList = {};
    heartbeatData.reset();
    settings.cacheList = {};
    server.statusPageDomainMappingList = {};
    clearResponseCache(responseCache);
}

async function reloadRuntimeAfterSnapshot(
    server,
    store: SQLiteStore,
    databaseMaintenance: DatabaseMaintenanceCoordinator,
    settings,
    heartbeatData,
    backgroundJobs,
    responseCache
) {
    settings.cacheList = {};
    const jwtSecret = await store.findOne("setting", " `key` = ? ", ["jwtSecret"]);
    server.jwtSecret = jwtSecret?.value || null;
    await server.initAfterDatabaseReady(responseCache);
    server.entryPage = await settings.get("entryPage");
    await StatusPage.loadDomainMappingList(store, server.statusPageDomainMappingList);

    const monitors = await store.find("monitor", " active = 1 ");
    for (const monitor of monitors) {
        server.monitorList[monitor.id] = monitor;
        await monitor.start(
            server.io,
            heartbeatData,
            server,
            (operation) => databaseMaintenance.run(operation),
            responseCache
        );
    }
    await initBackgroundJobs(
        store,
        databaseMaintenance,
        await server.getTimezone(),
        settings,
        heartbeatData,
        backgroundJobs
    );
    clearResponseCache(responseCache);
}

function createSnapshotMonitorRuntime(server, heartbeatData, databaseMaintenance, responseCache) {
    let runningMonitors = [];

    return {
        async stop() {
            runningMonitors = Object.values(server.monitorList).filter((monitor) => monitor.isStop === false);
            await Promise.all(runningMonitors.map((monitor) => monitor.stop()));
        },
        async reload() {
            await Promise.all(
                runningMonitors.map((monitor) =>
                    monitor.start(
                        server.io,
                        heartbeatData,
                        server,
                        (operation) => databaseMaintenance.run(operation),
                        responseCache
                    )
                )
            );
            runningMonitors = [];
        },
    };
}

async function takeSqliteSnapshot(
    store: SQLiteStore,
    databaseMaintenance: DatabaseMaintenanceCoordinator,
    runtime,
    copySnapshot = fs.cpSync,
    snapshotState = { phase: "idle" }
) {
    return databaseMaintenance.maintain(async () => {
        let operationError;
        let runtimeStopped = false;
        snapshotState.phase = "quiescing";
        try {
            try {
                runtimeStopped = true;
                await runtime.stop();
                await Database.close(store);
                snapshotState.phase = "copying";
                try {
                    await copySnapshot(Database.sqlitePath, `${Database.sqlitePath}.e2e-snapshot`);
                } catch (error) {
                    throw new Error("Unable to copy SQLite DB.", { cause: error });
                }
            } catch (error) {
                operationError = error;
            }

            const recoveryErrors = [];
            try {
                if (!store.isOpen()) {
                    await Database.connect(store);
                }
            } catch (recoveryError) {
                recoveryErrors.push(recoveryError);
            }

            if (runtimeStopped && store.isOpen()) {
                snapshotState.phase = "rehydrating";
                try {
                    await runtime.reload();
                } catch (recoveryError) {
                    recoveryErrors.push(recoveryError);
                }
            }

            if (recoveryErrors.length) {
                throw new AggregateError(
                    operationError ? [operationError, ...recoveryErrors] : recoveryErrors,
                    "Snapshot copy and recovery failed"
                );
            }

            if (operationError) {
                throw operationError;
            }
        } finally {
            snapshotState.phase = "idle";
        }
    });
}

async function restoreSqliteSnapshot(
    server,
    store: SQLiteStore,
    databaseMaintenance: DatabaseMaintenanceCoordinator,
    runtime = null,
    settings,
    heartbeatData,
    backgroundJobs = [],
    snapshotState = { phase: "idle" },
    responseCache = createResponseCache()
) {
    runtime ||= {
        stop: () => stopRuntimeForSnapshot(server, settings, heartbeatData, backgroundJobs, responseCache),
        reload: () =>
            reloadRuntimeAfterSnapshot(
                server,
                store,
                databaseMaintenance,
                settings,
                heartbeatData,
                backgroundJobs,
                responseCache
            ),
    };
    return databaseMaintenance.maintain(async () => {
        const snapshotPath = `${Database.sqlitePath}.e2e-snapshot`;
        if (!fs.existsSync(snapshotPath)) {
            throw new Error("Snapshot doesn't exist.");
        }

        const suffix = crypto.randomUUID();
        const restorePath = `${Database.sqlitePath}.e2e-restore-${suffix}`;
        const backupPath = `${Database.sqlitePath}.e2e-backup-${suffix}`;
        let backupCreated = false;
        let runtimeStopped = false;

        snapshotState.phase = "validating";
        try {
            fs.copyFileSync(snapshotPath, restorePath);
            validateSqliteSnapshot(restorePath);

            snapshotState.phase = "quiescing";
            runtimeStopped = true;
            await runtime.stop();
            snapshotState.phase = "restoring";
            await Database.close(store);
            fs.renameSync(Database.sqlitePath, backupPath);
            backupCreated = true;
            fs.renameSync(restorePath, Database.sqlitePath);
            await Database.connect(store);

            snapshotState.phase = "rehydrating";
            await runtime.reload();
            fs.rmSync(backupPath, { force: true });
            backupCreated = false;
        } catch (error) {
            if (!runtimeStopped) {
                throw error;
            }

            const recoveryErrors = [];
            try {
                await runtime.stop();
            } catch (recoveryError) {
                recoveryErrors.push(recoveryError);
            }

            let canRollback = true;
            if (backupCreated && store.isOpen()) {
                try {
                    await Database.close(store);
                } catch (recoveryError) {
                    recoveryErrors.push(recoveryError);
                    canRollback = false;
                }
            }

            if (backupCreated && canRollback) {
                try {
                    fs.rmSync(Database.sqlitePath, { force: true });
                    fs.renameSync(backupPath, Database.sqlitePath);
                    backupCreated = false;
                } catch (recoveryError) {
                    recoveryErrors.push(recoveryError);
                }
            }

            if (!store.isOpen()) {
                try {
                    await Database.connect(store);
                } catch (recoveryError) {
                    recoveryErrors.push(recoveryError);
                }
            }

            if (store.isOpen()) {
                try {
                    await runtime.reload();
                } catch (recoveryError) {
                    recoveryErrors.push(recoveryError);
                }
            }

            if (recoveryErrors.length) {
                throw new AggregateError([error, ...recoveryErrors], "Snapshot restore and recovery failed");
            }

            throw error;
        } finally {
            fs.rmSync(restorePath, { force: true });
            snapshotState.phase = "idle";
        }
    });
}

function getHostname(request) {
    const url = new URL(request.url);
    const host = request.headers.get("host");
    if (!host) {
        return url.hostname;
    }

    if (host.startsWith("[")) {
        const end = host.indexOf("]");
        return end === -1 ? host : host.slice(1, end);
    }

    return host.split(":")[0];
}

async function resolveTrustedHostname(request, settings) {
    let hostname = getHostname(request);
    const forwardedHost = request.headers.get("x-forwarded-host");
    if ((await settings.get("trustProxy")) && forwardedHost) {
        hostname = forwardedHost;
    }
    return hostname;
}

function resolveRequestPath(root, requestPath) {
    let decodedPath;
    try {
        decodedPath = decodeURIComponent(requestPath);
    } catch {
        return null;
    }

    if (decodedPath.includes("\0") || path.isAbsolute(decodedPath) || decodedPath.split(/[\\/]+/).includes("..")) {
        return null;
    }

    const resolvedRoot = path.resolve(root);
    const resolvedPath = path.resolve(resolvedRoot, decodedPath);
    if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(resolvedRoot + path.sep)) {
        return null;
    }

    return resolvedPath;
}

function acceptsEncoding(request, encoding) {
    const acceptEncoding = request.headers.get("accept-encoding") || "";
    return acceptEncoding
        .split(",")
        .map((part) => part.trim().toLowerCase())
        .some((part) => part === encoding || part.startsWith(encoding + ";"));
}

async function pickFile(filePath, request, precompressed) {
    if (precompressed && acceptsEncoding(request, "br")) {
        const brotliFile = Bun.file(filePath + ".br");
        if (await brotliFile.exists()) {
            return {
                file: brotliFile,
                contentEncoding: "br",
            };
        }
    }

    if (precompressed && acceptsEncoding(request, "gzip")) {
        const gzipFile = Bun.file(filePath + ".gz");
        if (await gzipFile.exists()) {
            return {
                file: gzipFile,
                contentEncoding: "gzip",
            };
        }
    }

    const file = Bun.file(filePath);
    if (await file.exists()) {
        return { file };
    }

    return null;
}

async function pickEmbeddedFile(webPath, request, precompressed) {
    const { hasEmbeddedAsset, readEmbeddedAsset } = await import("@/server/generated/embedded-assets");
    if (precompressed && acceptsEncoding(request, "br") && hasEmbeddedAsset(`${webPath}.br`)) {
        const file = await readEmbeddedAsset(`${webPath}.br`);
        if (file) {
            return { file, contentEncoding: "br" };
        }
    }

    if (precompressed && acceptsEncoding(request, "gzip") && hasEmbeddedAsset(`${webPath}.gz`)) {
        const file = await readEmbeddedAsset(`${webPath}.gz`);
        if (file) {
            return { file, contentEncoding: "gzip" };
        }
    }

    const file = await readEmbeddedAsset(webPath);
    if (file) {
        return { file };
    }

    return null;
}

async function serveFile(root, urlPathname, request, disableFrameSameOrigin, options = {}) {
    if (isCompiledBinary() && root === "dist") {
        const picked = await pickEmbeddedFile(urlPathname, request, !!options.precompressed);
        if (picked) {
            const headers = new Headers();
            const type = MIME_TYPES[path.extname(urlPathname)];
            if (type) {
                headers.set("Content-Type", type);
            }
            if (picked.contentEncoding) {
                headers.set("Content-Encoding", picked.contentEncoding);
                headers.set("Vary", "Accept-Encoding");
            }
            applyCommonHeaders(headers, disableFrameSameOrigin);
            return new Response(request.method === "HEAD" ? null : picked.file, { headers });
        }

        return null;
    }

    const filePath = resolveRequestPath(root, urlPathname);
    if (!filePath) {
        return null;
    }

    const picked = await pickFile(filePath, request, !!options.precompressed);
    if (!picked) {
        return null;
    }

    const headers = new Headers();
    const type = MIME_TYPES[path.extname(filePath)];
    if (type) {
        headers.set("Content-Type", type);
    }
    if (picked.contentEncoding) {
        headers.set("Content-Encoding", picked.contentEncoding);
        headers.set("Vary", "Accept-Encoding");
    }
    applyCommonHeaders(headers, disableFrameSameOrigin);

    return new Response(request.method === "HEAD" ? null : picked.file, { headers });
}

async function rootResponse(request, server, store, settings, disableFrameSameOrigin) {
    const hostname = await resolveTrustedHostname(request, settings);
    log.debug("entry", `Request Domain: ${hostname}`);

    if (hostname in server.statusPageDomainMappingList) {
        const slug = server.statusPageDomainMappingList[hostname];
        const result = await StatusPage.renderHTMLBySlug(store, server, slug);
        return htmlResponse(result.body, {
            status: result.status,
            disableFrameSameOrigin,
        });
    }

    const entryPage = server.entryPage;
    if (entryPage && entryPage.startsWith("statusPage-")) {
        return redirectResponse("/status/" + entryPage.replace("statusPage-", ""), {
            disableFrameSameOrigin,
        });
    }

    return redirectResponse("/dashboard", {
        disableFrameSameOrigin,
    });
}

async function parseDevBody(request) {
    const contentType = request.headers.get("content-type") || "";
    const body = await request.text();

    if (contentType.includes("application/json")) {
        try {
            return JSON.parse(body);
        } catch {
            return body;
        }
    }

    if (contentType.includes("application/x-www-form-urlencoded")) {
        return Object.fromEntries(new URLSearchParams(body).entries());
    }

    return body;
}

function isSnapshotControlRequest(request) {
    if (request.method !== "GET") {
        return false;
    }
    return ["/_e2e/sqlite-snapshot-state", "/_e2e/take-sqlite-snapshot", "/_e2e/restore-sqlite-snapshot"].includes(
        new URL(request.url).pathname
    );
}

async function handleDevRequest(
    request,
    server,
    store: SQLiteStore,
    databaseMaintenance: DatabaseMaintenanceCoordinator,
    snapshotRuntime,
    settings,
    heartbeatData,
    backgroundJobs,
    snapshotState,
    responseCache,
    disableFrameSameOrigin,
    development = isDev
) {
    if (!development) {
        return null;
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/_e2e/sqlite-snapshot-state") {
        return jsonResponse({ phase: snapshotState.phase }, { disableFrameSameOrigin });
    }

    if (
        request.method === "POST" &&
        (url.pathname === "/test-webhook" || url.pathname === "/test-x-www-form-urlencoded")
    ) {
        log.debug("test", Object.fromEntries(request.headers.entries()));
        log.debug("test", await parseDevBody(request));
        return textResponse("OK", { disableFrameSameOrigin });
    }

    if (request.method === "GET" && url.pathname === "/_e2e/take-sqlite-snapshot") {
        await takeSqliteSnapshot(store, databaseMaintenance, snapshotRuntime, fs.cpSync, snapshotState);

        return textResponse("Snapshot taken.", { disableFrameSameOrigin });
    }

    if (request.method === "GET" && url.pathname === "/_e2e/restore-sqlite-snapshot") {
        await restoreSqliteSnapshot(
            server,
            store,
            databaseMaintenance,
            null,
            settings,
            heartbeatData,
            backgroundJobs,
            snapshotState,
            responseCache
        );

        return textResponse("Snapshot restored.", { disableFrameSameOrigin });
    }

    return null;
}

async function metricsResponse(request, bunServer, server, store, settings, disableFrameSameOrigin) {
    const source = await server.getClientIPwithProxy(
        bunServer.requestIP(request)?.address || "",
        Object.fromEntries(request.headers)
    );
    const auth = await authenticateAPIRequest(store, settings, request, { disableFrameSameOrigin, source });
    if (auth.response) {
        return auth.response;
    }

    const metrics = await Prometheus.metrics(store, auth.userID);
    return textResponse(metrics.body, {
        type: metrics.contentType,
        disableFrameSameOrigin,
    });
}

function createBunFetchHandler({
    server,
    store,
    databaseMaintenance,
    heartbeatData,
    backgroundJobs = [],
    disableFrameSameOrigin,
    settings,
    development = isDev,
    responseCache = createResponseCache(),
    snapshotRuntime = createSnapshotMonitorRuntime(server, heartbeatData, databaseMaintenance, responseCache),
}) {
    const snapshotState = { phase: "idle" };
    const fetch = async function (request, bunServer) {
        const url = new URL(request.url);

        if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
            const upgraded = await server.io.canUpgrade(request, bunServer);
            if (upgraded) {
                return undefined;
            }
            return textResponse("WebSocket upgrade rejected.", {
                status: 403,
                disableFrameSameOrigin,
            });
        }

        if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/") {
            return rootResponse(request, server, store, settings, disableFrameSameOrigin);
        }

        const devResponse = await handleDevRequest(
            request,
            server,
            store,
            databaseMaintenance,
            snapshotRuntime,
            settings,
            heartbeatData,
            backgroundJobs,
            snapshotState,
            responseCache,
            disableFrameSameOrigin,
            development
        );
        if (devResponse) {
            return devResponse;
        }

        if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/robots.txt") {
            let body = "User-agent: *\nDisallow:";
            if (!(await settings.get("searchEngineIndex"))) {
                body += " /";
            }
            return textResponse(body, { disableFrameSameOrigin });
        }

        if (
            (request.method === "GET" || request.method === "HEAD") &&
            url.pathname === "/.well-known/change-password"
        ) {
            return redirectResponse(
                "https://github.com/iglo-tech/iglo.monitor/blob/main/docs/operations.md#password-recovery",
                {
                    disableFrameSameOrigin,
                }
            );
        }

        if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/metrics") {
            return metricsResponse(request, bunServer, server, store, settings, disableFrameSameOrigin);
        }

        const apiResponse = await handleApiRequest(request, {
            server,
            store,
            heartbeatData,
            settings,
            responseCache,
            disableFrameSameOrigin,
        });
        if (apiResponse) {
            return apiResponse;
        }

        const statusPageResponse = await handleStatusPageRequest(request, {
            server,
            store,
            heartbeatData,
            settings,
            responseCache,
            disableFrameSameOrigin,
        });
        if (statusPageResponse) {
            return statusPageResponse;
        }

        if ((request.method === "GET" || request.method === "HEAD") && url.pathname.startsWith("/upload/")) {
            const response = await serveFile(
                Database.uploadDir,
                url.pathname.replace(/^\/upload\//, ""),
                request,
                disableFrameSameOrigin
            );
            return response || textResponse("File not found.", { status: 404, disableFrameSameOrigin });
        }

        if ((request.method === "GET" || request.method === "HEAD") && url.pathname.startsWith("/screenshots/")) {
            const response = await serveFile(
                Database.screenshotDir,
                url.pathname.replace(/^\/screenshots\//, ""),
                request,
                disableFrameSameOrigin
            );
            if (response) {
                return response;
            }
        }

        if (request.method === "GET" || request.method === "HEAD") {
            const staticPath = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\//, "");
            const staticResponse = await serveFile("dist", staticPath, request, disableFrameSameOrigin, {
                precompressed: true,
            });
            if (staticResponse) {
                return staticResponse;
            }
        }

        return htmlResponse(server.indexHTML, { disableFrameSameOrigin });
    };

    return async function gatedFetch(request, bunServer) {
        if (development && isSnapshotControlRequest(request)) {
            return handleDevRequest(
                request,
                server,
                store,
                databaseMaintenance,
                snapshotRuntime,
                settings,
                heartbeatData,
                backgroundJobs,
                snapshotState,
                responseCache,
                disableFrameSameOrigin,
                development
            );
        }

        return databaseMaintenance.run(() => fetch(request, bunServer));
    };
}

function listenWithBunServe({
    server,
    store,
    databaseMaintenance,
    heartbeatData,
    backgroundJobs,
    settings,
    responseCache,
    hostname,
    port,
    disableFrameSameOrigin,
}) {
    const bunServer = Bun.serve({
        hostname,
        port,
        fetch: createBunFetchHandler({
            server,
            store,
            databaseMaintenance,
            heartbeatData,
            backgroundJobs,
            settings,
            responseCache,
            disableFrameSameOrigin,
        }),
        websocket: {
            open(ws) {
                void server.io.open(ws).catch((error) => log.error("socket", error));
            },
            message(ws, message) {
                server.io.message(ws, message);
            },
            close(ws) {
                server.io.close(ws);
            },
        },
        error(error) {
            log.error("server", "Bun.serve request failed: " + error.message);
            return new Response("Internal Server Error", { status: 500 });
        },
    });

    server.bunHttpServer = bunServer;
    printServerUrls("server", port, hostname, config.isSSL);
    return bunServer;
}

export {
    createBunFetchHandler,
    isSnapshotControlRequest,
    listenWithBunServe,
    resolveRequestPath,
    restoreSqliteSnapshot,
    takeSqliteSnapshot,
};
