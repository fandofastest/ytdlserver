const app = require("./src/app");
const config = require("./src/config/app.config");
const logger = require("./src/utils/logger.util");
const cleanupService = require("./src/services/cleanup.service");

// Initialize server
const server = app.listen(config.port, () => {
  logger.info(`=======================================================`);
  logger.info(` yt-dlp Express REST API Server running on port ${config.port}`);
  logger.info(` Environment: ${config.nodeEnv}`);
  logger.info(` Executable Path: ${config.ytDlpPath}`);
  logger.info(` Max Concurrent yt-dlp Processes: ${config.maxConcurrentProcesses}`);
  logger.info(`=======================================================`);

  // Start background file cleanup worker
  cleanupService.start();
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
