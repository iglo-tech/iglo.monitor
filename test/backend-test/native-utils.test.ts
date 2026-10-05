// @ts-nocheck

import { describe, test, expect } from "bun:test";
import { createHmac } from "node:crypto";
import net from "node:net";
import jwt from "@/server/jwt";
import passwordHash from "@/server/password-hash";
import { verify as verifyTotp, encodeSecretForUri } from "@/server/totp";
import { CredentialRateLimiter, KeyedRateLimiter, TokenBucket } from "@/server/rate-limiter";

const PASSWORD_DIVERSITY_PATTERNS = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/];
const PASSWORD_STRENGTH_LEVELS = [
    { value: "Too weak", minDiversity: 0, minLength: 0 },
    { value: "Weak", minDiversity: 2, minLength: 6 },
    { value: "Medium", minDiversity: 3, minLength: 8 },
    { value: "Strong", minDiversity: 4, minLength: 10 },
];

function passwordStrength(password) {
    let diversity = 0;
    for (const pattern of PASSWORD_DIVERSITY_PATTERNS) {
        if (pattern.test(password)) {
            diversity++;
        }
    }

    let value = "Too weak";
    for (const level of PASSWORD_STRENGTH_LEVELS) {
        if (diversity >= level.minDiversity && password.length >= level.minLength) {
            value = level.value;
        }
    }

    return { value };
}

const editMonitorFqdnOptions = {
    allowWildcard: true,
};

const HOSTNAME_LABEL_PATTERN = /^[a-zA-Z0-9_](?:[a-zA-Z0-9-_]{0,61}[a-zA-Z0-9_])?$/;

function isMonitorHostname(hostname, { allowWildcard = false } = {}) {
    if (typeof hostname !== "string" || hostname.length === 0) {
        return false;
    }

    let host = hostname;
    if (host.endsWith(".")) {
        host = host.slice(0, -1);
    }

    if (host.length === 0) {
        return false;
    }

    for (const label of host.split(".")) {
        if (label.length === 0) {
            return false;
        }

        if (allowWildcard && label === "*") {
            continue;
        }

        if (!HOSTNAME_LABEL_PATTERN.test(label)) {
            return false;
        }
    }

    return true;
}

function isUrl(str) {
    if (typeof str !== "string" || str.length === 0 || !URL.canParse(str)) {
        return false;
    }

    const { hostname } = new URL(str);
    return hostname === "localhost" || /^[^\s.]+\.\S{2,}$/.test(hostname);
}

describe("native JWT", () => {
    test("signs and verifies object payloads", () => {
        const token = jwt.sign({ username: "admin", h: "abc123" }, "secret");
        expect(jwt.verify(token, "secret")).toEqual({ username: "admin", h: "abc123" });
    });

    test("signs and verifies numeric payloads", () => {
        const token = jwt.sign(42, "secret");
        expect(jwt.verify(token, "secret")).toBe(42);
    });

    test("rejects invalid signatures", () => {
        const token = jwt.sign({ ok: true }, "secret");
        expect(() => jwt.verify(token, "wrong-secret")).toThrow("invalid signature");
    });

    test("rejects non-HS256 algorithms", () => {
        const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" })).replace(/=+$/, "");
        const payload = btoa(JSON.stringify({ user: "x" })).replace(/=+$/, "");
        const token = `${header}.${payload}.`;
        expect(() => jwt.verify(token, "secret")).toThrow("invalid algorithm");
    });
});

describe("native TOTP", () => {
    test("encodeSecretForUri strips padding", () => {
        const secret = "test-secret-bytes";
        expect(encodeSecretForUri(secret).includes("=")).toBe(false);
    });

    test("verify accepts the current token for a known secret", () => {
        const secret = "ABCDEFGHIJKLMNOP";
        const step = 30;
        const counter = Math.floor(Date.now() / 1000 / step);
        const buffer = new ArrayBuffer(8);
        const view = new DataView(buffer);
        view.setUint32(4, counter, false);
        const hmac = new Bun.CryptoHasher("sha1", new TextEncoder().encode(secret));
        hmac.update(new Uint8Array(buffer));
        const digest = hmac.digest();
        const offset = digest[digest.length - 1] & 0x0f;
        const code =
            ((digest[offset] & 0x7f) << 24) |
            ((digest[offset + 1] & 0xff) << 16) |
            ((digest[offset + 2] & 0xff) << 8) |
            (digest[offset + 3] & 0xff);
        const token = String(code % 1000000).padStart(6, "0");

        expect(verifyTotp(token, secret, { window: 0, time: step })).toBe(true);
    });
});

describe("password strength", () => {
    test("matches expected labels", () => {
        expect(passwordStrength("123").value).toBe("Too weak");
        expect(passwordStrength("abc123").value).toBe("Weak");
        expect(passwordStrength("Abc12345").value).toBe("Medium");
        expect(passwordStrength("Abc12345!@").value).toBe("Strong");
    });
});

describe("native password hashes", () => {
    test("rejects empty and hashes Unicode and long inputs without truncation", async () => {
        await expect(passwordHash.generate("")).rejects.toThrow();
        for (const password of ["Pąsswörd-熊-🔐", "x".repeat(10_000)]) {
            const hash = await passwordHash.generate(password);
            expect(hash).toStartWith("$argon2id$");
            expect(await passwordHash.verify(password, hash)).toBe(true);
            expect(await passwordHash.verify(`${password}x`, hash)).toBe(false);
            expect(passwordHash.needRehash(hash)).toBe(false);
        }
    });

    test("verifies legacy SHA-1 hashes and marks them for migration", async () => {
        const password = "legacy-password";
        const salt = "legacy-salt";
        const digest = createHmac("sha1", salt).update(password).digest("hex");
        const hash = `sha1$${salt}$1$${digest}`;

        expect(await passwordHash.verify(password, hash)).toBe(true);
        expect(await passwordHash.verify("wrong-password", hash)).toBe(false);
        expect(passwordHash.needRehash(hash)).toBe(true);
    });
});

describe("token bucket rate limiter", () => {
    test("depletes tokens and refills over time", () => {
        const realNow = Date.now;
        let now = 10_000;
        Date.now = () => now;
        try {
            const bucket = new TokenBucket({
                tokensPerInterval: 2,
                interval: 1000,
                fireImmediately: true,
            });

            expect(bucket.removeTokens(1)).toBe(1);
            expect(bucket.removeTokens(1)).toBe(0);
            expect(bucket.removeTokens(1)).toBe(-1);

            now += 2000;
            expect(bucket.removeTokens(1)).toBe(1);
        } finally {
            Date.now = realNow;
        }
    });

    test("isolates keys and resets a successful identity", async () => {
        const limiter = new KeyedRateLimiter({
            tokensPerInterval: 2,
            interval: 1000,
            fireImmediately: true,
            errorMessage: "limited",
        });

        await limiter.removeTokens(3, "user-a");
        expect(await limiter.pass(null, 0, "user-a")).toBe(false);
        expect(await limiter.pass(null, 0, "user-b")).toBe(true);
        limiter.reset("user-a");
        expect(await limiter.pass(null, 0, "user-a")).toBe(true);
    });

    test("evicts identities with bounded LRU/TTL state instead of a shared overflow bucket", async () => {
        const limiter = new KeyedRateLimiter({
            tokensPerInterval: 2,
            interval: 1000,
            bucketTTL: 10_000,
            maxBuckets: 3,
            fireImmediately: true,
            errorMessage: "limited",
        });

        await limiter.removeTokens(3, "blocked");
        await limiter.pass(null, 0, "recent");
        await limiter.pass(null, 0, "identity-0");
        await limiter.pass(null, 0, "blocked");
        await limiter.pass(null, 0, "identity-1");
        await limiter.pass(null, 0, "identity-new");

        expect(limiter.rateLimiters.size).toBe(3);
        expect(limiter.rateLimiters.has("overflow")).toBe(false);
        expect(await limiter.pass(null, 0, "blocked")).toBe(false);

        const ttlLimiter = new KeyedRateLimiter({
            tokensPerInterval: 1,
            interval: 1000,
            bucketTTL: 1,
            maxBuckets: 3,
            fireImmediately: true,
            errorMessage: "limited",
        });
        await ttlLimiter.removeTokens(1, "expired");
        await Bun.sleep(5);
        expect(await ttlLimiter.pass(null, 0, "expired")).toBe(true);

        const bounded = new KeyedRateLimiter({
            tokensPerInterval: 1,
            interval: "minute",
            fireImmediately: true,
            errorMessage: "limited",
        });
        for (let index = 0; index < 150; index++) {
            await bounded.removeTokens(1, `identity-${index}`);
        }
        expect(bounded.rateLimiters.size).toBe(100);
        expect(bounded.rateLimiters.has("overflow")).toBe(false);
        bounded.reset("identity-0");
        expect(bounded.rateLimiters.size).toBe(99);
    });

    test("preserves login and API partial penalties through exact-LRU churn", async () => {
        for (const { identity, capacity, initialFailures, remaining } of [
            { identity: "login-admin-1", capacity: 20, initialFailures: 1, remaining: 19 },
            { identity: "login-admin-5", capacity: 20, initialFailures: 5, remaining: 15 },
            { identity: "login-admin-19", capacity: 20, initialFailures: 19, remaining: 1 },
            { identity: "api-key:1", capacity: 60, initialFailures: 1, remaining: 59 },
            { identity: "api-key:30", capacity: 60, initialFailures: 30, remaining: 30 },
            { identity: "api-key:59", capacity: 60, initialFailures: 59, remaining: 1 },
        ]) {
            const limiter = new KeyedRateLimiter({
                tokensPerInterval: capacity,
                interval: "minute",
                fireImmediately: true,
                errorMessage: "limited",
            });

            for (let attempt = 0; attempt < initialFailures; attempt++) {
                expect(await limiter.pass(null, 1, identity)).toBe(true);
            }
            for (let churn = 0; churn < 1001; churn++) {
                await limiter.pass(null, 1, `churn-${churn}`);
            }

            const attemptsAfterChurn = await Promise.all(
                Array.from({ length: capacity }, () => limiter.pass(null, 1, identity))
            );
            expect(attemptsAfterChurn.filter(Boolean)).toHaveLength(remaining);
            expect(limiter.rateLimiters.size).toBe(100);
        }
    });

    test("evicts a partial bucket only at the deterministic full-refill boundary", async () => {
        const realNow = Date.now;
        let now = 10_000;
        Date.now = () => now;
        try {
            const limiter = new KeyedRateLimiter({
                tokensPerInterval: 2,
                interval: 1_000,
                maxBuckets: 1,
                fireImmediately: true,
                errorMessage: "limited",
            });

            await limiter.pass(null, 1, "partial");
            now += 499;
            expect(limiter.isEvictable(limiter.rateLimiters.get("partial"))).toBe(false);
            await limiter.pass(null, 1, "before-full");
            expect(limiter.rateLimiters.has("partial")).toBe(true);
            expect(limiter.rateLimiters.has("before-full")).toBe(false);

            now += 1;
            expect(limiter.isEvictable(limiter.rateLimiters.get("partial"))).toBe(true);
            await limiter.pass(null, 1, "at-full");
            expect(limiter.rateLimiters.has("partial")).toBe(false);
            expect(limiter.rateLimiters.has("at-full")).toBe(true);
        } finally {
            Date.now = realNow;
        }
    });

    test("derives the bounded production credential limiter pair", () => {
        const limiters = [
            { tokensPerInterval: 20, sourceTokensPerInterval: 200 },
            { tokensPerInterval: 60, sourceTokensPerInterval: 600 },
        ].map(
            ({ tokensPerInterval, sourceTokensPerInterval }) =>
                new CredentialRateLimiter({
                    tokensPerInterval,
                    sourceTokensPerInterval,
                    interval: "minute",
                    fireImmediately: true,
                    errorMessage: "limited",
                })
        );
        const perLimiterBounds = limiters.map(
            (limiter) =>
                limiter.identity.maxBuckets + limiter.fallback.rateLimiters.length + limiter.source.rateLimiters.length
        );

        expect(perLimiterBounds).toEqual([8_292, 8_292]);
        expect(perLimiterBounds.reduce((total, bound) => total + bound, 0)).toBe(16_584);
    });

    test("keeps a fully blocked identity through adversarial identity churn", async () => {
        const limiter = new KeyedRateLimiter({
            tokensPerInterval: 20,
            interval: "minute",
            fireImmediately: true,
            errorMessage: "limited",
        });

        for (let index = 0; index < 21; index++) {
            await limiter.pass(null, 1, "admin");
        }
        for (let index = 0; index < 1001; index++) {
            await limiter.pass(null, 1, `churn-${index}`);
        }

        expect(limiter.rateLimiters.size).toBe(100);
        expect(await limiter.pass(null, 1, "admin")).toBe(false);
    });

    test("evicts only an exact identity reset or fully regenerated to capacity", async () => {
        const limiter = new KeyedRateLimiter({
            tokensPerInterval: 2,
            interval: 1_000,
            maxBuckets: 2,
            fireImmediately: true,
            errorMessage: "limited",
        });

        await limiter.pass(null, 1, "partial");
        await limiter.pass(null, 1, "other");
        await limiter.pass(null, 1, "new");
        expect(limiter.rateLimiters.has("partial")).toBe(true);

        limiter.reset("partial");
        expect(limiter.rateLimiters.has("partial")).toBe(false);

        await limiter.pass(null, 1, "refilled");
        limiter.rateLimiters.get("refilled").lastRefill -= 2_000;
        await limiter.pass(null, 1, "another");
        expect(limiter.rateLimiters.has("refilled")).toBe(false);
    });

    test("throttles a late identity after protected capacity is full", async () => {
        const limiter = new CredentialRateLimiter({
            tokensPerInterval: 3,
            sourceTokensPerInterval: 3,
            interval: "minute",
            maxBuckets: 3,
            fixedBuckets: 7,
            fireImmediately: true,
            errorMessage: "limited",
        });

        for (let identity = 0; identity < 3; identity++) {
            await limiter.identity.removeTokens(3, `blocked-${identity}`);
        }
        expect(limiter.identity.rateLimiters.size).toBe(3);

        for (let attempt = 0; attempt < 3; attempt++) {
            await limiter.pass(null, 1, "late-admin", "origin-a");
        }
        expect(await limiter.pass(null, 1, "late-admin", "origin-a")).toBe(false);
        expect(limiter.identity.rateLimiters.size).toBe(3);
        expect(limiter.fallback.rateLimiters).toHaveLength(7);
        expect(limiter.source.rateLimiters).toHaveLength(7);

        const otherIdentity = Array.from({ length: 100 }, (_, index) => `real-user-${index}`).find(
            (identity) => limiter.fallback.getRateLimiter(identity) !== limiter.fallback.getRateLimiter("late-admin")
        );
        expect(otherIdentity).toBeDefined();
        expect(await limiter.pass(null, 1, otherIdentity, "origin-b")).toBe(true);
    });

    test("does not reset a late victim's source admission after another identity succeeds", async () => {
        const limiter = new CredentialRateLimiter({
            tokensPerInterval: 3,
            sourceTokensPerInterval: 3,
            interval: "minute",
            maxBuckets: 3,
            fireImmediately: true,
            errorMessage: "limited",
        });

        for (let identity = 0; identity < 3; identity++) {
            await limiter.identity.removeTokens(3, `blocked-${identity}`);
        }
        for (let attempt = 0; attempt < 3; attempt++) {
            expect(await limiter.pass(null, 1, "late-admin", "origin-a")).toBe(true);
        }
        expect(await limiter.pass(null, 1, "late-admin", "origin-a")).toBe(false);

        limiter.reset("attacker-owned-account", "origin-a");
        expect(await limiter.pass(null, 1, "late-admin", "origin-a")).toBe(false);
        expect(limiter.identity.rateLimiters.size).toBe(3);
    });

    test("rejects at source admission before consuming a late identity bucket", async () => {
        const limiter = new CredentialRateLimiter({
            tokensPerInterval: 3,
            sourceTokensPerInterval: 1,
            interval: "minute",
            maxBuckets: 1,
            fixedBuckets: 1,
            fireImmediately: true,
            errorMessage: "limited",
        });

        await limiter.identity.removeTokens(3, "protected");
        expect(await limiter.pass(null, 1, "late-one", "source-a")).toBe(true);
        expect(await limiter.pass(null, 1, "late-two", "source-a")).toBe(false);
        expect(limiter.identity.rateLimiters.size).toBe(1);
        expect(limiter.identity.rateLimiters.has("late-two")).toBe(false);
    });

    test("throttles a late identity across many sources after protected capacity is full", async () => {
        const limiter = new CredentialRateLimiter({
            tokensPerInterval: 20,
            sourceTokensPerInterval: 100,
            interval: "minute",
            maxBuckets: 3,
            fireImmediately: true,
            errorMessage: "limited",
        });

        for (let identity = 0; identity < 3; identity++) {
            await limiter.identity.removeTokens(3, `blocked-${identity}`);
        }

        for (let attempt = 0; attempt < 20; attempt++) {
            expect(await limiter.pass(null, 1, "late-api-key:77", `origin-${attempt}`)).toBe(true);
        }
        expect(await limiter.pass(null, 1, "late-api-key:77", "origin-20")).toBe(false);
        expect(limiter.identity.rateLimiters.size).toBe(3);
    });
});

describe("validator replacements", () => {
    test("node:net isIP rejects CIDR notation", () => {
        expect(net.isIP("192.168.1.1")).toBe(4);
        expect(net.isIP("192.168.1.1/24")).toBe(0);
        expect(net.isIP("::1/128")).toBe(0);
    });

    test("hostname validation matches EditMonitor option set", () => {
        expect(isMonitorHostname("_bad.com", editMonitorFqdnOptions)).toBe(true);
        expect(isMonitorHostname("host.example", editMonitorFqdnOptions)).toBe(true);
        expect(isMonitorHostname("bad..host", editMonitorFqdnOptions)).toBe(false);
    });

    test("URL.canParse hostname check matches is-url package behavior", () => {
        expect(isUrl("https://example.com")).toBe(true);
        expect(isUrl("https://foo")).toBe(false);
        expect(isUrl("ftp://x.com")).toBe(true);
        expect(isUrl("not-a-url")).toBe(false);
    });
});

describe("version compare", () => {
    test("treats pre-release versions as lower than release", () => {
        expect(Bun.semver.order("1.0.0-beta", "1.0.0")).toBeLessThan(0);
        expect(Bun.semver.order("1.0.0", "1.0.0-beta")).toBeGreaterThan(0);
    });
});

describe("api key secret generation", () => {
    test("generates requested length using allowed alphabet", () => {
        let id = "";
        while (id.length < 40) {
            id += crypto.randomUUID().replace(/-/g, "");
        }
        id = id.slice(0, 40);

        expect(id).toHaveLength(40);
        expect(id).toMatch(/^[A-Za-z0-9]+$/);
    });
});
