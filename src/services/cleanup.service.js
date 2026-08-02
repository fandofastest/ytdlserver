const fs = require("fs");
const path = require("path");
const config = require("../config/app.config");
const logger = require("../utils/logger.util");
const ytDlpService = require("./ytdlp.service");

/**
 * Service to automatically purge generated files and download jobs older than 30 minutes.
 */
class CleanupService {
  constructor() {
    this.intervalTimer = null;
  }

  /**
   * Starts periodic interval timer for auto-deleting stale files.
   */
  start() {
    if (this.intervalTimer) return;

    logger.info(`Cleanup service initialized. Interval: ${config.cleanupIntervalMs}ms, Max file age: ${config.fileMaxAgeMs}ms`);
    
    // Initial cleanup check on service startup
    this.cleanStaleFiles();

    // Set recurring timer
    this.intervalTimer = setInterval(() => {
      this.cleanStaleFiles();
    }, config.cleanupIntervalMs);
  }

  /**
   * Stops the cleanup interval timer.
   */
  stop() {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
      logger.info("Cleanup service stopped.");
    }
  }

  /**
   * Scans public/downloads directory and removes files older than max age (30 mins).
   * Also purges corresponding download status entries from memory map.
   */
  cleanStaleFiles() {
    const downloadsFolder = config.downloadsDir;

    if (!fs.existsSync(downloadsFolder)) {
      return;
    }

    const now = Date.now();
    let deletedCount = 0;

    try {
      const files = fs.readdirSync(downloadsFolder);

      for (const file of files) {
        const filePath = path.join(downloadsFolder, file);
        try {
          const stats = fs.statSync(filePath);
          const ageMs = now - stats.mtimeMs;

          if (ageMs > config.fileMaxAgeMs) {
            fs.unlinkSync(filePath);
            deletedCount++;
            logger.info(`Auto-deleted stale download file (${Math.round(ageMs / 60000)} mins old): ${file}`);
          }
        } catch (err) {
          logger.error(`Error processing file during cleanup: ${file}`, err);
        }
      }

      // Cleanup stale download status records in memory
      const jobsMap = ytDlpService.getAllJobs();
      for (const [id, job] of jobsMap.entries()) {
        const jobAgeMs = now - job.updatedAt;
        if (jobAgeMs > config.fileMaxAgeMs) {
          jobsMap.delete(id);
          logger.info(`Purged expired download job status record: ${id}`);
        }
      }

      if (deletedCount > 0) {
        logger.info(`Cleanup complete. Removed ${deletedCount} file(s).`);
      }
    } catch (err) {
      logger.error("Failed to execute directory cleanup scan", err);
    }
  }
}

module.exports = new CleanupService();
