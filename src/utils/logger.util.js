const fs = require("fs");
const path = require("path");
const config = require("../config/app.config");

// Ensure logs directory exists
if (!fs.existsSync(config.logsDir)) {
  fs.mkdirSync(config.logsDir, { recursive: true });
}

const errorLogPath = path.join(config.logsDir, "error.log");
const errorLogStream = fs.createWriteStream(errorLogPath, { flags: "a" });

/**
 * Formats current timestamp for readable logging.
 * @returns {string} Formatted timestamp.
 */
function getTimestamp() {
  return new Date().toISOString();
}

/**
 * Logs info messages to stdout.
 * @param {string} message - Message text.
 * @param {Object} [meta] - Optional metadata object.
 */
function info(message, meta = null) {
  const metaStr = meta ? ` | ${JSON.stringify(meta)}` : "";
  console.log(`[${getTimestamp()}] [INFO] ${message}${metaStr}`);
}

/**
 * Logs error messages to stderr and error log file.
 * @param {string} message - Error description.
 * @param {Error|Object} [error] - Error object or context.
 */
function error(message, err = null) {
  const errDetails = err ? (err.stack || JSON.stringify(err)) : "";
  const logLine = `[${getTimestamp()}] [ERROR] ${message} ${errDetails}\n`;
  
  console.error(logLine.trim());
  errorLogStream.write(logLine);
}

/**
 * Custom stream for Morgan HTTP logging middleware.
 */
const morganStream = {
  write: (message) => {
    console.log(`[HTTP] ${message.trim()}`);
  }
};

module.exports = {
  info,
  error,
  morganStream
};
