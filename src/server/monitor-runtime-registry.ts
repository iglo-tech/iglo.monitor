"use strict";

import type Heartbeat from "@/server/model/heartbeat.js";
import type Monitor from "@/server/model/monitor.js";
import type { HeartbeatDataPlane } from "@/server/heartbeat-data-plane.js";
import type { BunSQLiteRedbean } from "@/server/sqlite-core.js";
import type { Settings } from "@/server/settings.js";
import type { UptimeMakuServer } from "@/server/uptime-maku-server.js";
import { ConditionVariable } from "@/server/monitor-conditions/variables.js";
import { defaultStringOperators } from "@/server/monitor-conditions/operators.js";

type MonitorRuntimeServer = {
    store: BunSQLiteRedbean;
    settings: Settings;
    getUserAgent: () => string;
};

type MonitorCheck = (
    monitor: Monitor,
    heartbeat: Heartbeat,
    server: UptimeMakuServer,
    heartbeatData: HeartbeatDataPlane
) => Promise<void>;

type MonitorContract = {
    check: MonitorCheck;
    allowCustomStatus?: boolean;
};

type RealBrowserMonitor = MonitorContract & {
    resetChrome: () => Promise<void>;
    resetRemoteBrowser: (remoteBrowserID: string | number, userID: string | number) => Promise<void>;
    testChrome: (executablePath: string) => Promise<string>;
    testRemoteBrowser: (remoteBrowserURL: string) => Promise<boolean>;
};

type MonitorDefinition = {
    supportsConditions?: boolean;
    conditionVariables?: ConditionVariable[];
    allowCustomStatus?: boolean;
    load: (server: MonitorRuntimeServer) => MonitorContract | Promise<MonitorContract>;
};

type MonitorDefinitionMap = Record<string, MonitorDefinition>;

type MonitorTypeMetadata = {
    supportsConditions: boolean;
    conditionVariables: ConditionVariable[];
    allowCustomStatus: boolean;
};

type MonitorTypeList = Record<string, MonitorTypeMetadata>;

const CORE_MONITOR_TYPES = ["http", "keyword", "json-query", "ping", "push", "docker", "radius", "kafka-producer"];

const optionalMonitorDefinitions = {
    "real-browser": {
        load: async (server) =>
            new (await import("@/server/monitor-types/real-browser-monitor-type.js")).RealBrowserMonitorType(
                server.store,
                server.settings
            ),
    },
    "tailscale-ping": {
        load: async () => new (await import("@/server/monitor-types/tailscale-ping.js")).TailscalePing(),
    },
    "websocket-upgrade": {
        load: async () => new (await import("@/server/monitor-types/websocket-upgrade.js")).WebSocketMonitorType(),
    },
    dns: {
        supportsConditions: true,
        conditionVariables: [new ConditionVariable("record", defaultStringOperators)],
        load: async (server) => new (await import("@/server/monitor-types/dns.js")).DnsMonitorType(server.store),
    },
    postgres: {
        load: async () => new (await import("@/server/monitor-types/postgres.js")).PostgresMonitorType(),
    },
    mqtt: {
        supportsConditions: true,
        conditionVariables: [
            new ConditionVariable("message", defaultStringOperators),
            new ConditionVariable("topic", defaultStringOperators),
        ],
        load: async () => new (await import("@/server/monitor-types/mqtt.js")).MqttMonitorType(),
    },
    smtp: {
        load: async () => new (await import("@/server/monitor-types/smtp.js")).SMTPMonitorType(),
    },
    group: {
        allowCustomStatus: true,
        load: async () => new (await import("@/server/monitor-types/group.js")).GroupMonitorType(),
    },
    snmp: {
        load: async () => new (await import("@/server/monitor-types/snmp.js")).SNMPMonitorType(),
    },
    "grpc-keyword": {
        load: async () => new (await import("@/server/monitor-types/grpc.js")).GrpcKeywordMonitorType(),
    },
    mongodb: {
        load: async () => new (await import("@/server/monitor-types/mongodb.js")).MongodbMonitorType(),
    },
    rabbitmq: {
        load: async () => new (await import("@/server/monitor-types/rabbitmq.js")).RabbitMqMonitorType(),
    },
    "sip-options": {
        load: async () => new (await import("@/server/monitor-types/sip-options.js")).SIPMonitorType(),
    },
    gamedig: {
        load: async () => new (await import("@/server/monitor-types/gamedig.js")).GameDigMonitorType(),
    },
    steam: {
        load: async (server) =>
            new (await import("@/server/monitor-types/steam.js")).SteamMonitorType({ settings: server.settings }),
    },
    port: {
        load: async () => new (await import("@/server/monitor-types/tcp.js")).TCPMonitorType(),
    },
    manual: {
        allowCustomStatus: true,
        load: async () => new (await import("@/server/monitor-types/manual.js")).ManualMonitorType(),
    },
    globalping: {
        load: async (server) =>
            new (await import("@/server/monitor-types/globalping.js")).GlobalpingMonitorType(
                server.store,
                server.settings,
                server.getUserAgent()
            ),
    },
    redis: {
        load: async () => new (await import("@/server/monitor-types/redis.js")).RedisMonitorType(),
    },
    "system-service": {
        load: async () => new (await import("@/server/monitor-types/system-service.js")).SystemServiceMonitorType(),
    },
    sqlserver: {
        supportsConditions: true,
        conditionVariables: [new ConditionVariable("result", defaultStringOperators)],
        load: async () => new (await import("@/server/monitor-types/mssql.js")).MssqlMonitorType(),
    },
    mysql: {
        supportsConditions: true,
        conditionVariables: [new ConditionVariable("result", defaultStringOperators)],
        load: async () => new (await import("@/server/monitor-types/mysql.js")).MysqlMonitorType(),
    },
    oracledb: {
        supportsConditions: true,
        conditionVariables: [new ConditionVariable("result", defaultStringOperators)],
        load: async () => new (await import("@/server/monitor-types/oracledb.js")).OracleDbMonitorType(),
    },
} satisfies MonitorDefinitionMap;

const OPTIONAL_MONITOR_TYPES = Object.keys(optionalMonitorDefinitions);

function createMonitorTypeList(definitions: MonitorDefinitionMap = optionalMonitorDefinitions): MonitorTypeList {
    return Object.fromEntries(
        Object.entries(definitions).map(([name, definition]) => [
            name,
            {
                supportsConditions: Boolean(definition.supportsConditions),
                conditionVariables: definition.conditionVariables || [],
                allowCustomStatus: Boolean(definition.allowCustomStatus),
            },
        ])
    );
}

class MonitorRuntimeRegistry {
    server: MonitorRuntimeServer;
    definitions: MonitorDefinitionMap;
    monitorTypeList: MonitorTypeList;
    loaded: Map<string, MonitorContract>;
    loading: Map<string, Promise<MonitorContract>>;

    constructor(server: MonitorRuntimeServer, definitions: MonitorDefinitionMap = optionalMonitorDefinitions) {
        this.server = server;
        this.definitions = definitions;
        this.monitorTypeList = createMonitorTypeList(definitions);
        this.loaded = new Map();
        this.loading = new Map();
    }

    get(name: "real-browser"): Promise<RealBrowserMonitor | null>;
    get(name: string): Promise<MonitorContract | null>;
    get(name: string): Promise<MonitorContract | null> {
        const definition = this.definitions[name];
        if (!definition) {
            return Promise.resolve(null);
        }

        if (this.loaded.has(name)) {
            return Promise.resolve(this.loaded.get(name)!);
        }

        if (!this.loading.has(name)) {
            const loading = Promise.resolve()
                .then(() => definition.load(this.server))
                .then((instance) => {
                    if (!isLoadedMonitor(instance)) {
                        throw new Error(`Invalid monitor type factory for "${name}": expected an object with check()`);
                    }
                    this.loaded.set(name, instance);
                    return instance;
                })
                .finally(() => this.loading.delete(name));
            this.loading.set(name, loading);
        }

        return this.loading.get(name)!;
    }

    getLoadedTypes(): string[] {
        return [...this.loaded.keys()];
    }

    getLoaded(name: "real-browser"): RealBrowserMonitor | null;
    getLoaded(name: string): MonitorContract | null;
    getLoaded(name: string): MonitorContract | null {
        return this.loaded.get(name) || null;
    }
}

function isLoadedMonitor(value: unknown): value is MonitorContract {
    return typeof value === "object" && value !== null && "check" in value && typeof value.check === "function";
}

export { CORE_MONITOR_TYPES, MonitorRuntimeRegistry, OPTIONAL_MONITOR_TYPES, createMonitorTypeList };
