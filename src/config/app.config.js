const path = require("path");
const os = require("os");
require("dotenv").config();

/**
 * Resolves path containing tilde (~) to full absolute home directory path.
 * @param {string} filepath - Input file path.
 * @returns {string} Absolute resolved file path.
 */
function resolveHomePath(filepath) {
  if (!filepath) return "yt-dlp";
  if (filepath.startsWith("~/") || filepath === "~") {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return filepath;
}

const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  host: process.env.HOST || "0.0.0.0",
  nodeEnv: process.env.NODE_ENV || "production",
  ytDlpPath: resolveHomePath(process.env.YTDLP_PATH || "~/bin/yt-dlp"),
  cookiesPath: resolveHomePath(process.env.YTDLP_COOKIES_PATH || "~/cookies.txt"),
  proxyUrl: process.env.YTDLP_PROXY || null,
  impersonate: process.env.YTDLP_IMPERSONATE || "chrome",
  userAgent: process.env.YTDLP_USER_AGENT || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  extractorArgs: process.env.YTDLP_EXTRACTOR_ARGS || null,
  maxConcurrentProcesses: parseInt(process.env.MAX_CONCURRENT_PROCESSES || "2", 10),
  ytDlpTimeoutMs: parseInt(process.env.YTDLP_TIMEOUT_MS || "60000", 10),
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000", 10), // 15 mins
  rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "100", 10),
  cacheTtlSeconds: parseInt(process.env.CACHE_TTL_SECONDS || "2592000", 10), // 30 days default (2,592,000 seconds)
  cleanupIntervalMs: parseInt(process.env.CLEANUP_INTERVAL_MS || "300000", 10), // 5 minutes
  fileMaxAgeMs: parseInt(process.env.FILE_MAX_AGE_MS || "1800000", 10), // 30 minutes
  downloadsDir: path.join(__dirname, "..", "public", "downloads"),
  logsDir: path.join(__dirname, "..", "logs")
};

module.exports = config;
