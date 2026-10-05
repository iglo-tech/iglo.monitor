// @ts-nocheck

import { log } from "@/server/logger";

class TokenBucket {
    /**
     * @param {object} config Token bucket configuration.
     */
    constructor(config) {
        this.tokensPerInterval = config.tokensPerInterval;
        this.intervalMs = config.interval === "minute" ? 60_000 : Number(config.interval) || 60_000;
        this.tokens = config.fireImmediately ? this.tokensPerInterval : 0;
        this.lastRefill = Date.now();
    }

    /**
     * Refill tokens based on elapsed time.
     * @returns {void}
     */
    refill() {
        const now = Date.now();
        const elapsed = now - this.lastRefill;
        if (elapsed <= 0) {
            return;
        }

        const tokensToAdd = (elapsed / this.intervalMs) * this.tokensPerInterval;
        this.tokens = Math.min(this.tokensPerInterval, this.tokens + tokensToAdd);
        this.lastRefill = now;
    }

    /**
     * Remove tokens from the bucket.
     * @param {number} count Number of tokens to remove.
     * @returns {number} Remaining tokens.
     */
    removeTokens(count = 1) {
        this.refill();
        this.tokens -= count;
        return this.tokens;
    }
}

class KeyedRateLimiter {
    /**
     * @param {object} config Rate limiter configuration object
     */
    constructor(config) {
        this.errorMessage = config.errorMessage;
        this.config = config;
        const intervalMs = config.interval === "minute" ? 60_000 : Number(config.interval) || 60_000;
        this.maxBuckets = Math.max(1, Number(config.maxBuckets) || 100);
        this.bucketTTL = Math.max(1, Number(config.bucketTTL) || intervalMs);
        this.rateLimiters = new Map();
    }

    removeExpiredBuckets() {
        const now = Date.now();
        for (const [bucketKey, bucket] of this.rateLimiters) {
            if (now - bucket.lastUsed >= this.bucketTTL) {
                this.rateLimiters.delete(bucketKey);
            }
        }
    }

    canPersist(key = "global") {
        key = String(key);
        this.removeExpiredBuckets();
        return (
            this.rateLimiters.has(key) ||
            this.rateLimiters.size < this.maxBuckets ||
            [...this.rateLimiters.values()].some((candidate) => this.isEvictable(candidate))
        );
    }

    isEvictable(bucket) {
        bucket.refill();
        return bucket.tokens >= bucket.tokensPerInterval;
    }

    getRateLimiter(key = "global") {
        key = String(key);
        const now = Date.now();
        this.removeExpiredBuckets();

        let bucket = this.rateLimiters.get(key);
        if (bucket) {
            bucket.lastUsed = now;
            this.rateLimiters.delete(key);
            this.rateLimiters.set(key, bucket);
            return bucket;
        }

        if (this.rateLimiters.size >= this.maxBuckets) {
            const evictable = [...this.rateLimiters].find(([, candidate]) => this.isEvictable(candidate));
            if (!evictable) {
                return new TokenBucket(this.config);
            }
            this.rateLimiters.delete(evictable[0]);
        }

        bucket = new TokenBucket(this.config);
        bucket.lastUsed = now;
        this.rateLimiters.set(key, bucket);
        return bucket;
    }

    /**
     * Callback for pass
     * @callback passCB
     * @param {object} err Too many requests
     */

    /**
     * Should the request be passed through
     * @param {passCB} callback Callback function to call with decision
     * @param {number} num Number of tokens to remove
     * @returns {Promise<boolean>} Should the request be allowed?
     */
    async pass(callback, num = 1, key = "global") {
        const remainingRequests = await this.removeTokens(num, key);
        log.info("rate-limit", "remaining requests: " + remainingRequests);
        if (remainingRequests < 0) {
            if (callback) {
                callback({
                    ok: false,
                    msg: this.errorMessage,
                });
            }
            return false;
        }
        return true;
    }

    /**
     * Remove a given number of tokens
     * @param {number} num Number of tokens to remove
     * @returns {Promise<number>} Number of remaining tokens
     */
    async removeTokens(num = 1, key = "global") {
        return this.getRateLimiter(key).removeTokens(num);
    }

    reset(key = "global") {
        this.rateLimiters.delete(String(key));
    }
}

const RATE_LIMIT_HASH_SEED = crypto.getRandomValues(new Uint32Array(1))[0];

function fixedBucketIndex(key, bucketCount) {
    let hash = 2166136261 ^ RATE_LIMIT_HASH_SEED;
    for (const character of String(key)) {
        hash ^= character.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) % bucketCount;
}

class FixedRateLimiter {
    constructor(config, tokensPerInterval) {
        this.errorMessage = config.errorMessage;
        const bucketConfig = {
            ...config,
            tokensPerInterval,
        };
        this.rateLimiters = Array.from(
            { length: Math.max(1, Number(config.fixedBuckets) || 4096) },
            () => new TokenBucket(bucketConfig)
        );
    }

    getRateLimiter(key) {
        return this.rateLimiters[fixedBucketIndex(key, this.rateLimiters.length)];
    }

    async pass(callback, num = 1, key) {
        const remainingRequests = this.getRateLimiter(key).removeTokens(num);
        if (remainingRequests < 0) {
            if (callback) {
                callback({
                    ok: false,
                    msg: this.errorMessage,
                });
            }
            return false;
        }
        return true;
    }
}

class SourceRateLimiter extends FixedRateLimiter {
    constructor(config) {
        super(config, config.sourceTokensPerInterval);
    }
}

class CredentialRateLimiter {
    constructor(config) {
        this.identity = new KeyedRateLimiter(config);
        this.fallback = new FixedRateLimiter(config, config.tokensPerInterval);
        this.source = new SourceRateLimiter(config);
    }

    async pass(callback, num = 1, identity = "global", source = "") {
        if (!this.identity.canPersist(identity)) {
            if (source && !(await this.source.pass(callback, num, source))) {
                return false;
            }
            if (!(await this.fallback.pass(callback, num, identity))) {
                return false;
            }
        }
        return this.identity.pass(callback, num, identity);
    }

    reset(identity = "global") {
        this.identity.reset(identity);
    }
}

const loginRateLimiter = new CredentialRateLimiter({
    tokensPerInterval: 20,
    sourceTokensPerInterval: 200,
    interval: "minute",
    fireImmediately: true,
    errorMessage: "Too frequently, try again later.",
});

const apiRateLimiter = new CredentialRateLimiter({
    tokensPerInterval: 60,
    sourceTokensPerInterval: 600,
    interval: "minute",
    fireImmediately: true,
    errorMessage: "Too frequently, try again later.",
});

const twoFaRateLimiter = new KeyedRateLimiter({
    tokensPerInterval: 30,
    interval: "minute",
    fireImmediately: true,
    errorMessage: "Too frequently, try again later.",
});

export { CredentialRateLimiter, TokenBucket, KeyedRateLimiter, loginRateLimiter, apiRateLimiter, twoFaRateLimiter };
