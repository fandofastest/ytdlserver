const fs = require("fs");
const path = require("path");
const config = require("../config/app.config");
const logger = require("../utils/logger.util");

const dataDir = path.join(__dirname, "..", "data");
const statsFilePath = path.join(dataDir, "stats.json");

const defaultStats = {
  totalRequests: 0,
  localHits: 0,
  ytdlHits: 0,
  rapidHits: 0,
  failedHits: 0,
  rapidQuotaSaved: 0,
  avgResponseTimeMs: 0,
  totalResponseTimeMs: 0,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  whitelistIps: [],
  history: []
};

/**
 * Service to manage persistent statistics tracking using a lightweight JSON file.
 */
class StatsService {
  constructor() {
    this._ensureFileExists();
  }

  /**
   * Ensures data directory and stats.json file exist.
   * @private
   */
  _ensureFileExists() {
    try {
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      if (!fs.existsSync(statsFilePath)) {
        fs.writeFileSync(statsFilePath, JSON.stringify(defaultStats, null, 2), "utf8");
      }
    } catch (err) {
      logger.error("Failed to initialize stats.json storage:", err);
    }
  }

  /**
   * Reads statistics data from JSON file.
   * 
   * @returns {Object} Current stats object.
   */
  getStats() {
    try {
      this._ensureFileExists();
      const content = fs.readFileSync(statsFilePath, "utf8");
      const parsed = JSON.parse(content);
      return {
        ...defaultStats,
        ...parsed
      };
    } catch (err) {
      logger.error("Failed to read stats file:", err);
      return { ...defaultStats };
    }
  }

  /**
   * Records a request hit in statistics.
   * 
   * @param {"local"|"ytdl"|"rapidapi"} provider - Hit provider type.
   * @param {Object} [meta={}] - Additional request metadata (url, filename, videoId, durationMs).
   */
  recordHit(provider, meta = {}) {
    try {
      const stats = this.getStats();
      const durationMs = typeof meta.durationMs === "number" ? Math.max(0, Math.round(meta.durationMs)) : 0;

      stats.totalRequests = (stats.totalRequests || 0) + 1;
      stats.updatedAt = Date.now();

      if (durationMs > 0) {
        stats.totalResponseTimeMs = (stats.totalResponseTimeMs || 0) + durationMs;
        stats.avgResponseTimeMs = Math.round(stats.totalResponseTimeMs / stats.totalRequests);
      }

      if (provider === "local") {
        stats.localHits = (stats.localHits || 0) + 1;
        stats.rapidQuotaSaved = (stats.rapidQuotaSaved || 0) + 1;
      } else if (provider === "ytdl") {
        stats.ytdlHits = (stats.ytdlHits || 0) + 1;
        stats.rapidQuotaSaved = (stats.rapidQuotaSaved || 0) + 1;
      } else if (provider === "rapidapi") {
        stats.rapidHits = (stats.rapidHits || 0) + 1;
      }

      // Add to recent activity history log (max 50 entries)
      const historyItem = {
        id: meta.id || meta.videoId || Date.now().toString(36),
        provider: provider,
        url: meta.url || "",
        filename: meta.filename || "",
        durationMs: durationMs,
        error: null,
        timestamp: Date.now()
      };

      if (!Array.isArray(stats.history)) {
        stats.history = [];
      }

      stats.history.unshift(historyItem);
      if (stats.history.length > 50) {
        stats.history = stats.history.slice(0, 50);
      }

      fs.writeFileSync(statsFilePath, JSON.stringify(stats, null, 2), "utf8");
    } catch (err) {
      logger.error("Failed to record stats hit:", err);
    }
  }

  /**
   * Records a failed request execution.
   * 
   * @param {Object} [meta={}] - Additional failure metadata (url, videoId, durationMs, error).
   */
  recordFailure(meta = {}) {
    try {
      const stats = this.getStats();
      const durationMs = typeof meta.durationMs === "number" ? Math.max(0, Math.round(meta.durationMs)) : 0;

      stats.totalRequests = (stats.totalRequests || 0) + 1;
      stats.failedHits = (stats.failedHits || 0) + 1;
      stats.updatedAt = Date.now();

      if (durationMs > 0) {
        stats.totalResponseTimeMs = (stats.totalResponseTimeMs || 0) + durationMs;
        stats.avgResponseTimeMs = Math.round(stats.totalResponseTimeMs / stats.totalRequests);
      }

      const historyItem = {
        id: meta.id || meta.videoId || Date.now().toString(36),
        provider: "failed",
        url: meta.url || "",
        filename: meta.filename || "N/A",
        durationMs: durationMs,
        error: meta.error || "Unknown error",
        timestamp: Date.now()
      };

      if (!Array.isArray(stats.history)) {
        stats.history = [];
      }

      stats.history.unshift(historyItem);
      if (stats.history.length > 50) {
        stats.history = stats.history.slice(0, 50);
      }

      fs.writeFileSync(statsFilePath, JSON.stringify(stats, null, 2), "utf8");
    } catch (err) {
      logger.error("Failed to record stats failure:", err);
    }
  }

  /**
   * Returns merged array of whitelisted IPs from config (.env) and persistent storage (stats.json).
   * 
   * @returns {Array<string>} Array of whitelisted IP strings.
   */
  getWhitelistIps() {
    const stats = this.getStats();
    const envIps = config.rateLimitWhitelistIps || [];
    const storedIps = Array.isArray(stats.whitelistIps) ? stats.whitelistIps : [];

    return Array.from(new Set([...envIps, ...storedIps])).filter(Boolean);
  }

  /**
   * Adds an IP address to dynamic whitelist storage.
   * 
   * @param {string} ip - IP address string.
   * @returns {Array<string>} Updated whitelist IPs array.
   */
  addWhitelistIp(ip) {
    if (!ip) return this.getWhitelistIps();
    const cleanIp = String(ip).trim();
    const stats = this.getStats();

    if (!Array.isArray(stats.whitelistIps)) {
      stats.whitelistIps = [];
    }

    if (!stats.whitelistIps.includes(cleanIp)) {
      stats.whitelistIps.push(cleanIp);
      stats.updatedAt = Date.now();
      fs.writeFileSync(statsFilePath, JSON.stringify(stats, null, 2), "utf8");
      logger.info(`Added IP to Whitelist: ${cleanIp}`);
    }

    return this.getWhitelistIps();
  }

  /**
   * Removes an IP address from dynamic whitelist storage.
   * 
   * @param {string} ip - IP address string.
   * @returns {Array<string>} Updated whitelist IPs array.
   */
  removeWhitelistIp(ip) {
    if (!ip) return this.getWhitelistIps();
    const cleanIp = String(ip).trim();
    const stats = this.getStats();

    if (Array.isArray(stats.whitelistIps)) {
      stats.whitelistIps = stats.whitelistIps.filter((item) => item !== cleanIp && item !== `::ffff:${cleanIp}`);
      stats.updatedAt = Date.now();
      fs.writeFileSync(statsFilePath, JSON.stringify(stats, null, 2), "utf8");
      logger.info(`Removed IP from Whitelist: ${cleanIp}`);
    }

    return this.getWhitelistIps();
  }

  /**
   * Checks if an IP address matches any whitelisted IP.
   * 
   * @param {string} ip - Client IP address.
   * @returns {boolean} True if IP is whitelisted.
   */
  isIpWhitelisted(ip) {
    if (!ip) return false;
    const cleanIp = String(ip).trim();
    const rawIpWithoutV6Prefix = cleanIp.replace(/^::ffff:/, "");

    const allWhitelisted = this.getWhitelistIps();

    return allWhitelisted.some((item) => {
      const cleanWhitelisted = item.replace(/^::ffff:/, "");
      return cleanWhitelisted === cleanIp || cleanWhitelisted === rawIpWithoutV6Prefix || item === cleanIp;
    });
  }

  /**
   * Resets all statistics counters back to zero.
   * 
   * @returns {Object} Clean stats object.
   */
  resetStats() {
    try {
      const clean = {
        ...defaultStats,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        whitelistIps: this.getStats().whitelistIps || [],
        history: []
      };
      fs.writeFileSync(statsFilePath, JSON.stringify(clean, null, 2), "utf8");
      return clean;
    } catch (err) {
      logger.error("Failed to reset stats:", err);
      return { ...defaultStats };
    }
  }
}

module.exports = new StatsService();
