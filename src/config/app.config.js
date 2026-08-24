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
  proxyUrl: process.env.YTDLP_PROXY || "http://proxyuser:Palang66@168.138.163.64:3128",
  impersonate: process.env.YTDLP_IMPERSONATE && process.env.YTDLP_IMPERSONATE !== "none" ? process.env.YTDLP_IMPERSONATE : null,
  userAgent: process.env.YTDLP_USER_AGENT || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  extractorArgs: process.env.YTDLP_EXTRACTOR_ARGS || "youtube:player_client=android,mweb",
  autoUpdateYtDlp: process.env.YTDLP_AUTO_UPDATE !== "false",
  rapidApiKey: process.env.RAPIDAPI_KEY || "ebc2265decmshb2099ea7fde3d31p123991jsn838cf9cada3f",
  rapidApiHost: process.env.RAPIDAPI_HOST || "youtube-mp36.p.rapidapi.com",
  enableRapidApiFallback: process.env.RAPIDAPI_FALLBACK_ENABLED !== "false",
  directStreamRedirect: process.env.DIRECT_STREAM_REDIRECT === "true",
  adminPassword: process.env.ADMIN_PASSWORD || "Palang6666",
  maxConcurrentProcesses: parseInt(process.env.MAX_CONCURRENT_PROCESSES || "2", 10),
  ytDlpTimeoutMs: parseInt(process.env.YTDLP_TIMEOUT_MS || "60000", 10),
  ytDlpFastTimeoutMs: parseInt(process.env.YTDLP_FAST_TIMEOUT_MS || "15000", 10),
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000", 10), // 15 mins
  rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "100", 10),
  rateLimitWhitelistIps: (process.env.RATE_LIMIT_WHITELIST_IPS || "127.0.0.1,::1,::ffff:127.0.0.1").split(",").map((ip) => ip.trim()),
  cacheTtlSeconds: parseInt(process.env.CACHE_TTL_SECONDS || "2592000", 10), // 30 days default (2,592,000 seconds)
  cleanupIntervalMs: parseInt(process.env.CLEANUP_INTERVAL_MS || "300000", 10), // 5 minutes
  fileMaxAgeMs: parseInt(process.env.FILE_MAX_AGE_MS || "1800000", 10), // 30 minutes (Set to 0 to keep files permanently for max quota saving)
  downloadsDir: path.join(__dirname, "..", "public", "downloads"),
  logsDir: path.join(__dirname, "..", "logs")
};

module.exports = config;
