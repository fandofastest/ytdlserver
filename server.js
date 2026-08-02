const app = require("./src/app");
const config = require("./src/config/app.config");
const logger = require("./src/utils/logger.util");
const cleanupService = require("./src/services/cleanup.service");

// Initialize server with explicit host and port
const server = app.listen(config.port, config.host, () => {
  logger.info(`=======================================================`);
  logger.info(` yt-dlp Express REST API Server running on http://${config.host}:${config.port}`);
  logger.info(` Environment: ${config.nodeEnv}`);
  logger.info(` Executable Path: ${config.ytDlpPath}`);
  logger.info(` Max Concurrent yt-dlp Processes: ${config.maxConcurrentProcesses}`);
  logger.info(`=======================================================`);

  // Start background file cleanup worker
  cleanupService.start();
});

// Handle server listen errors (e.g. EPERM, EADDRINUSE on shared hosting like Whatbox)
server.on("error", (err) => {
  if (err.code === "EPERM" || err.code === "EACCES") {
    logger.error(`Permission denied binding to ${config.host}:${config.port}.`);
    logger.error(`On shared hosting (e.g. Whatbox), port 3000 or binding to 0.0.0.0 may be restricted.`);
    logger.error(`Solution: Edit .env and set PORT to your assigned port (e.g. PORT=35421) and HOST=127.0.0.1 or 0.0.0.0.`);
  } else if (err.code === "EADDRINUSE") {
    logger.error(`Port ${config.port} is already in use by another process.`);
    logger.error(`Solution: Change PORT in .env or stop the existing process.`);
  } else {
    logger.error("HTTP Server error:", err);
  }
  process.exit(1);
});

// Graceful Shutdown handling
function handleShutdown(signal) {
  logger.info(`Received ${signal}. Shutting down server gracefully...`);
  cleanupService.stop();
  server.close(() => {
    logger.info("Server closed successfully.");
    process.exit(0);
  });
}

process.on("SIGTERM", () => handleShutdown("SIGTERM"));
process.on("SIGINT", () => handleShutdown("SIGINT"));
