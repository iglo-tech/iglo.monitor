// @ts-nocheck
import { describe, test, expect, beforeAll, afterAll, spyOn } from "bun:test";
import DomainExpiry from "@/server/model/domain_expiry";
import mockWebhook from "./notification-providers/mock-webhook";
import TestDB from "../mock-testdb";
import { Settings } from "@/server/settings";
import dayjs from "dayjs";
import dayjsPlugin_10 from "dayjs/plugin/utc";
import rdapDnsFixture from "@/server/assets/rdap-dns.json" with { type: "json" };

process.env.IGLO_MONITOR_HIDE_LOG = ["info_db", "info_server"].join(",");

dayjs.extend(dayjsPlugin_10);

const testDb = new TestDB();
const settings = new Settings(testDb.store);
const providerRegistry = {
    get: async () => new (await import("@/server/notification-providers/webhook")).default(settings),
};

describe("Domain Expiry", () => {
    const monHttpCom = {
        type: "http",
        url: "https://www.google.com",
        domainExpiryNotification: true,
    };

    beforeAll(async () => {
        await testDb.create();
    });

    afterAll(async () => {
        settings.stopCacheCleaner();
        await testDb.destroy();
    });

    test("imports directly in a fresh process without a model-registry cycle", async () => {
        const child = Bun.spawn(
            [process.execPath, "-e", 'await import("@/server/model/domain_expiry"); process.stdout.write("ok")'],
            { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" }
        );
        const [stdout, stderr, exitCode] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
            child.exited,
        ]);

        expect(exitCode, stderr).toBe(0);
        expect(stdout).toBe("ok");
    });

    test("getExpiryDate() returns correct expiry date for .wiki domain with no A record", async () => {
        // Recorded RDAP answers instead of live lookups: the real registration changes when the
        // domain is renewed, which made this test fail once google.wiki was renewed in 2026.
        const realFetch = globalThis.fetch;
        const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
            const url = String(input instanceof Request ? input.url : input);
            if (url.startsWith("https://data.iana.org/rdap/dns.json")) {
                return Response.json(rdapDnsFixture);
            }
            if (url.endsWith("/domain/google.wiki")) {
                return Response.json({
                    objectClassName: "domain",
                    ldhName: "google.wiki",
                    events: [
                        { eventAction: "registration", eventDate: "2015-05-26T15:29:31Z" },
                        { eventAction: "expiration", eventDate: "2027-11-26T23:59:59Z" },
                    ],
                });
            }
            return realFetch(input, init);
        });
        try {
            const d = DomainExpiry.createByName("google.wiki", testDb.store);
            expect(await d.getExpiryDate(settings)).toEqual(new Date("2027-11-26T23:59:59.000Z"));
            expect(fetchSpy.mock.calls.some(([input]) => String(input).endsWith("/domain/google.wiki"))).toBe(true);
        } finally {
            fetchSpy.mockRestore();
        }
    });

    describe("checkSupport()", () => {
        test("allows and correctly parses http monitor with valid domain", async () => {
            const supportInfo = await DomainExpiry.checkSupport(monHttpCom, settings);
            let expected = {
                domain: "google.com",
                tld: "com",
            };
            expect(supportInfo).toEqual(expected);
        });

        describe("Target Validation", () => {
            test("throws error for empty string target", async () => {
                const monitor = {
                    type: "http",
                    url: "",
                    domainExpiryNotification: true,
                };
                try {
                    await DomainExpiry.checkSupport(monitor, settings);
                    expect.unreachable();
                } catch (error) {
                    expect(error.constructor.name).toBe("TranslatableError");
                    expect(error.message).toBe("domain_expiry_unsupported_missing_target");
                }
            });

            test("throws error for undefined target", async () => {
                const monitor = {
                    type: "http",
                    domainExpiryNotification: true,
                };
                try {
                    await DomainExpiry.checkSupport(monitor, settings);
                    expect.unreachable();
                } catch (error) {
                    expect(error.constructor.name).toBe("TranslatableError");
                    expect(error.message).toBe("domain_expiry_unsupported_missing_target");
                }
            });

            test("throws error for null target", async () => {
                const monitor = {
                    type: "http",
                    url: null,
                    domainExpiryNotification: true,
                };
                try {
                    await DomainExpiry.checkSupport(monitor, settings);
                    expect.unreachable();
                } catch (error) {
                    expect(error.constructor.name).toBe("TranslatableError");
                    expect(error.message).toBe("domain_expiry_unsupported_missing_target");
                }
            });
        });

        describe("Domain Parsing", () => {
            test("throws error for non-ICANN TLD (e.g. .local)", async () => {
                const monitor = {
                    type: "http",
                    url: "https://example.local",
                    domainExpiryNotification: true,
                };
                try {
                    await DomainExpiry.checkSupport(monitor, settings);
                    expect.unreachable();
                } catch (error) {
                    expect(error.constructor.name).toBe("TranslatableError");
                    expect(error.message).toBe("domain_expiry_unsupported_is_icann");
                }
            });
        });

        describe("Edge Cases & RDAP Support", () => {
            test("handles subdomain correctly", async () => {
                const monitor = {
                    type: "http",
                    url: "https://api.staging.example.com/v1/users",
                    domainExpiryNotification: true,
                };
                const supportInfo = await DomainExpiry.checkSupport(monitor, settings);
                expect(supportInfo.domain).toBe("example.com");
                expect(supportInfo.tld).toBe("com");
            });

            test("supports multi-level public suffix via RDAP fallback (e.g. com.br)", async () => {
                const monitor = {
                    type: "http",
                    url: "https://record.com.br",
                    domainExpiryNotification: true,
                };
                const supportInfo = await DomainExpiry.checkSupport(monitor, settings);
                expect(supportInfo.domain).toBe("record.com.br");
                expect(supportInfo.tld).toBe("br");
            });

            test("handles complex subdomain correctly", async () => {
                const monitor = {
                    type: "http",
                    url: "https://mail.subdomain.example.org",
                    domainExpiryNotification: true,
                };
                const supportInfo = await DomainExpiry.checkSupport(monitor, settings);
                expect(supportInfo.domain).toBe("example.org");
                expect(supportInfo.tld).toBe("org");
            });

            test("handles URL with port correctly", async () => {
                const monitor = {
                    type: "http",
                    url: "https://example.com:8080/api",
                    domainExpiryNotification: true,
                };
                const supportInfo = await DomainExpiry.checkSupport(monitor, settings);
                expect(supportInfo.domain).toBe("example.com");
                expect(supportInfo.tld).toBe("com");
            });

            test("handles URL with query parameters correctly", async () => {
                const monitor = {
                    type: "http",
                    url: "https://example.com/search?q=test&page=1",
                    domainExpiryNotification: true,
                };
                const supportInfo = await DomainExpiry.checkSupport(monitor, settings);
                expect(supportInfo.domain).toBe("example.com");
                expect(supportInfo.tld).toBe("com");
            });
        });
    });

    test("findByDomainNameOrCreate() retrieves expiration date for .com domain from RDAP", async () => {
        const domain = await DomainExpiry.findByDomainNameOrCreate("google.com", testDb.store);
        const expiryFromRdap = await domain.getExpiryDate(settings); // from RDAP
        expect(expiryFromRdap).toEqual(new Date("2028-09-14T04:00:00.000Z"));
    });

    test("checkExpiry() caches expiration date in database", async () => {
        await DomainExpiry.checkExpiry("google.com", testDb.store, settings); // RDAP -> Cache
        const domain = await DomainExpiry.findByName("google.com", testDb.store);
        expect(dayjs.utc().diff(dayjs.utc(domain.lastCheck), "second") < 5).toBeTruthy();
    });

    test("sendNotifications() triggers notification for expiring domain", async () => {
        await DomainExpiry.findByName("google.com", testDb.store);
        const hook = {
            port: 3010,
            url: "capture",
        };
        const manyDays = 3650;
        await settings.set("domainExpiryNotifyDays", [manyDays], "general");
        const notif = testDb.store.convertToBean("notification", {
            config: JSON.stringify({
                type: "webhook",
                httpMethod: "post",
                webhookContentType: "json",
                webhookURL: `http://127.0.0.1:${hook.port}/${hook.url}`,
            }),
            active: 1,
            user_id: 1,
            name: "Testhook",
        });
        const [, data] = await Promise.all([
            DomainExpiry.sendNotifications(providerRegistry, settings, testDb.store, "google.com", [notif]),
            mockWebhook(hook.port, hook.url),
        ]);
        expect(data.msg).toMatch(/will expire in/);
    });

    test("sendNotifications() handles domain with null expiry without sending NaN", async () => {
        // Regression test for bug: "Domain name will expire in NaN days"
        // Mock findByDomainNameOrCreate to return a bean with null expiry
        const mockDomain = {
            domain: "test-null.com",
            expiry: null,
            lastExpiryNotificationSent: null,
        };

        const findByDomainNameOrCreateSpy = spyOn(DomainExpiry, "findByDomainNameOrCreate").mockImplementation(
            async () => mockDomain
        );

        try {
            const hook = {
                port: 3012,
                url: "should-not-be-called-null",
            };

            const notif = {
                name: "TestNullExpiry",
                config: JSON.stringify({
                    type: "webhook",
                    httpMethod: "post",
                    webhookContentType: "json",
                    webhookURL: `http://127.0.0.1:${hook.port}/${hook.url}`,
                }),
            };

            // Race between sendNotifications and mockWebhook timeout
            // If webhook is called, we fail. If it times out, we pass.
            const result = await Promise.race([
                DomainExpiry.sendNotifications(providerRegistry, settings, testDb.store, "test-null.com", [notif]),
                mockWebhook(hook.port, hook.url, 500)
                    .then(() => {
                        throw new Error("Webhook was called but should not have been for null expiry");
                    })
                    .catch((e) => {
                        if (e.reason === "Timeout") {
                            return "timeout"; // Expected - webhook was not called
                        }
                        throw e;
                    }),
            ]);

            expect(result === undefined || result === "timeout").toBeTruthy();
        } finally {
            findByDomainNameOrCreateSpy.mockRestore();
        }
    });

    test("sendNotifications() handles domain with undefined expiry without sending NaN", async () => {
        // Mock findByDomainNameOrCreate to return a bean with undefined expiry (newly created bean scenario)
        const mockDomain = {
            domain: "test-undefined.com",
            expiry: undefined,
            lastExpiryNotificationSent: null,
        };

        const findByDomainNameOrCreateSpy = spyOn(DomainExpiry, "findByDomainNameOrCreate").mockImplementation(
            async () => mockDomain
        );

        try {
            const hook = {
                port: 3013,
                url: "should-not-be-called-undefined",
            };

            const notif = {
                name: "TestUndefinedExpiry",
                config: JSON.stringify({
                    type: "webhook",
                    httpMethod: "post",
                    webhookContentType: "json",
                    webhookURL: `http://127.0.0.1:${hook.port}/${hook.url}`,
                }),
            };

            // Race between sendNotifications and mockWebhook timeout
            // If webhook is called, we fail. If it times out, we pass.
            const result = await Promise.race([
                DomainExpiry.sendNotifications(providerRegistry, settings, testDb.store, "test-undefined.com", [notif]),
                mockWebhook(hook.port, hook.url, 500)
                    .then(() => {
                        throw new Error("Webhook was called but should not have been for undefined expiry");
                    })
                    .catch((e) => {
                        if (e.reason === "Timeout") {
                            return "timeout"; // Expected - webhook was not called
                        }
                        throw e;
                    }),
            ]);

            expect(result === undefined || result === "timeout").toBeTruthy();
        } finally {
            findByDomainNameOrCreateSpy.mockRestore();
        }
    });
});
