// @ts-nocheck

/**
 * Database & App Data Folder
 */
import fs from "fs";
import type { SQLiteStore } from "@/server/db-migrations";

const fsAsync = fs.promises;
import { log } from "@/server/logger";
import { isDev } from "@/server/runtime-flags";
import { runCommandSync } from "@/server/process-helper";
import path from "path";
import kumaDbTemplate from "@/db/kuma.db" with { type: "file" };
import { defaultDataDir, isCompiledBinary } from "@/server/app-paths";

class Database {
    /**
     * Bootstrap database for SQLite
     * @type {string}
     */
    static templatePath = "./src/db/kuma.db";

    /**
     * Data Dir (Default: ./data)
     * @type {string}
     */
    static dataDir;

    /**
     * User Upload Dir (Default: ./data/upload)
     * @type {string}
     */
    static uploadDir;

    /**
     * Chrome Screenshot Dir (Default: ./data/screenshots)
     * @type {string}
     */
    static screenshotDir;

    /**
     * SQLite file path (Default: ./data/kuma.db)
     * @type {string}
     */
    static sqlitePath;

    /**
     * For storing Docker TLS certs (Default: ./data/docker-tls)
     * @type {string}
     */
    static dockerTLSDir;



    /**
     * Initialize the data directory
     * @param {object} args Arguments to initialize DB with
     * @returns {void}
     */
    static getTemplatePath() {
        return isCompiledBinary() ? kumaDbTemplate : Database.templatePath;
    }

    static initDataDir(args) {
        // Data Directory (must be end with "/")
        const fallbackDataDir = isCompiledBinary() ? defaultDataDir() : "./data/";
        Database.dataDir = process.env.DATA_DIR || args["data-dir"] || Database.getDevDataDir() || fallbackDataDir;

        Database.sqlitePath = path.join(Database.dataDir, "kuma.db");
        if (!fs.existsSync(Database.dataDir)) {
            fs.mkdirSync(Database.dataDir, { recursive: true });
        }

        Database.uploadDir = path.join(Database.dataDir, "upload/");

        if (!fs.existsSync(Database.uploadDir)) {
            fs.mkdirSync(Database.uploadDir, { recursive: true });
        }

        // Create screenshot dir
        Database.screenshotDir = path.join(Database.dataDir, "screenshots/");
        if (!fs.existsSync(Database.screenshotDir)) {
            fs.mkdirSync(Database.screenshotDir, { recursive: true });
        }

        Database.dockerTLSDir = path.join(Database.dataDir, "docker-tls/");
        if (!fs.existsSync(Database.dockerTLSDir)) {
            fs.mkdirSync(Database.dockerTLSDir, { recursive: true });
        }

        log.info("server", `Data Dir: ${Database.dataDir}`);
    }

    /**
     * Development + non-main branch + no custom only
     * To avoid database migration issue during different pull request testing.
     * Path: ./data/dev-data/<git branch name>/
     * @returns {string} The dev data dir, empty string if not in dev mode or on main
     */
    static getDevDataDir() {
        if (isDev) {
            const gitBranch = this.getCurrentGitBranch();

            // HEAD means detached head. Don't handle this case, becasuse it is not common.
            if (gitBranch !== "" && gitBranch !== "main" && gitBranch !== "HEAD") {
                log.info("server", `Using development data directory for branch ${gitBranch}`);
                return path.join("./data/dev-data/", gitBranch, "/");
            } else {
                log.debug("server", "No branch-specific development data directory selected");
            }
        }
        return "";
    }

    /**
     * Get the current git branch name
     * @returns {string} The current git branch name, or empty string if it cannot be determined
     */
    static getCurrentGitBranch() {
        try {
            // Reference: https://stackoverflow.com/questions/6245570/how-do-i-get-the-current-branch-name-in-git
            return runCommandSync("git", ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
        } catch {
            return "";
        }
    }

    /**
     * Remove legacy db-config.json left over from multi-backend installs.
     * iglo.monitor is SQLite-only; the file is no longer read or written.
     * @returns {void}
     */
    static removeLegacyDbConfig() {
        const legacyPath = path.join(Database.dataDir, "db-config.json");
        if (fs.existsSync(legacyPath)) {
            fs.unlinkSync(legacyPath);
            log.info("db", "Removed legacy db-config.json (SQLite-only, config file no longer used)");
        }
    }

    /**
     * Connect to the database
     * @param {boolean} testMode Should the connection be started in test mode?
     * @param {boolean} noLog Should logs not be output?
     * @returns {Promise<void>}
     */
    static async connect(store: SQLiteStore, testMode = false, noLog = false) {
        Database.removeLegacyDbConfig();
        log.info("db", "Database Type: sqlite (bun:sqlite)");
        await store.connect({
            sqlitePath: Database.sqlitePath,
            templatePath: Database.getTemplatePath(),
            testMode,
        });
        if (!noLog) {
            log.debug("db", "SQLite config:");
            log.debug("db", await store.getAll("PRAGMA journal_mode"));
            log.debug("db", await store.getAll("PRAGMA cache_size"));
            log.debug("db", "SQLite Version: " + (await store.getCell("SELECT sqlite_version()")));
        }
    }

    /**
     * @returns {Promise<void>}
     */
    static async close(store: SQLiteStore) {
        log.info("db", "Closing the database");

        // Flush WAL to main database
        await store.exec("PRAGMA wal_checkpoint(TRUNCATE)");

        await store.close();
        log.info("db", "Database closed");
    }

    /**
     * Get the size of the database (SQLite only)
     * @returns {Promise<number>} Size of database
     */
    static async getSize() {
        log.debug("db", "Database.getSize()");
        let stats = await fsAsync.stat(Database.sqlitePath);
        log.debug("db", stats);
        return stats.size;
    }

    /**
     * Shrink the database
     * @returns {Promise<void>}
     */
    static async shrink(store: SQLiteStore) {
        await store.exec("VACUUM");
    }

    /**
     * @returns {string} Get the SQL for the current time plus a number of hours
     */
    static sqlHourOffset() {
        return "DATETIME('now', ? || ' hours')";
    }

    /**
     * Remove all non-important heartbeats from heartbeat table, keep last 24-hour or {KEEP_LAST_ROWS} rows for each monitor
     * @param {boolean} detailedLog Log detailed information
     * @returns {Promise<void>}
     */
    static async clearHeartbeatData(store: SQLiteStore, detailedLog = false) {
        let monitors = await store.getAll("SELECT id FROM monitor");
        const sqlHourOffset = Database.sqlHourOffset();

        for (let monitor of monitors) {
            if (detailedLog) {
                log.info("db", "Deleting non-important heartbeats for monitor " + monitor.id);
            }
            await store.exec(
                `
                DELETE FROM heartbeat
                WHERE monitor_id = ?
                AND important = 0
                AND time < ${sqlHourOffset}
                AND id NOT IN (
                    SELECT id FROM (
                        SELECT id
                        FROM heartbeat
                        WHERE monitor_id = ?
                        ORDER BY time DESC
                        LIMIT ?
                    )  AS limited_ids
                )
            `,
                [monitor.id, -24, monitor.id, 100]
            );
        }
    }
}

export default Database;
