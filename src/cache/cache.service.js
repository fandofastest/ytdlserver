const NodeCache = require("node-cache");
const config = require("../config/app.config");

// Initialize NodeCache instance with 10-minute default TTL and automatic check period
const cacheInstance = new NodeCache({
  stdTTL: config.cacheTtlSeconds,
  checkperiod: 120, // Check for expired keys every 2 minutes
  useClones: false
});

/**
 * Cache service wrapper for node-cache operations.
 */
class CacheService {
  /**
   * Retrieves item from cache by key.
   * @param {string} key - Cache key (SHA256 hash).
   * @returns {Object|null} Cached item or null if not found.
   */
  get(key) {
    const value = cacheInstance.get(key);
    return value !== undefined ? value : null;
  }

  /**
   * Stores item in cache.
   * @param {string} key - Cache key.
   * @param {Object} value - Data to cache.
   * @param {number} [ttl] - Optional TTL override in seconds.
   * @returns {boolean} Success status.
   */
  set(key, value, ttl = config.cacheTtlSeconds) {
    return cacheInstance.set(key, value, ttl);
  }

  /**
   * Checks if key exists in cache.
   * @param {string} key - Cache key.
   * @returns {boolean} True if key exists.
   */
  has(key) {
    return cacheInstance.has(key);
  }

  /**
   * Deletes item from cache.
   * @param {string} key - Cache key.
   * @returns {number} Number of deleted entries.
   */
  del(key) {
    return cacheInstance.del(key);
  }

  /**
   * Flushes all cached entries.
   */
  flush() {
    cacheInstance.flushAll();
  }
}

module.exports = new CacheService();
