const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const config = require("../config/app.config");
const logger = require("../utils/logger.util");
const { parseAndSimplifyYtDlpJson } = require("../utils/ytdlp.util");
const queueService = require("./queue.service");

// In-memory status map for tracking active and completed download jobs
const downloadJobsMap = new Map();

/**
 * Resolves the binary path to use for spawning yt-dlp processes.
 * Checks configured path (~/bin/yt-dlp), falls back to system PATH if missing.
 * 
 * @returns {string} Path or command string for yt-dlp.
 */
function getExecutablePath() {
  if (fs.existsSync(config.ytDlpPath)) {
    return config.ytDlpPath;
  }
  const localBin = path.join(__dirname, "..", "..", "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  if (fs.existsSync(localBin)) {
    return localBin;
  }
  return "yt-dlp";
}

/**
 * Builds common yt-dlp command arguments including cookie injection and proxy support.
 * 
 * @returns {Array<string>} Common args array.
 */
function getCommonArgs() {
  const args = [
    "--no-playlist",
    "--js-runtimes",
    "node"
  ];

  // Attach browser impersonation target (fixes TikTok anti-bot / rehydration issue)
  if (config.impersonateTarget) {
    args.push("--impersonate", config.impersonateTarget);
  }

  // Automatically attach cookies file if present (bypasses CAPTCHA / bot detection)
  if (config.cookiesPath && fs.existsSync(config.cookiesPath)) {
    args.push("--cookies", config.cookiesPath);
  }

  // Automatically attach proxy if configured
  if (config.proxyUrl) {
    args.push("--proxy", config.proxyUrl);
  }

  return args;
}

class YtDlpService {
  /**
   * Executes yt-dlp to extract single-json metadata for a URL.
   * Wraps spawn call inside queueService to ensure concurrency control.
   * 
   * @param {string} url - Validated video/audio URL.
   * @returns {Promise<Object>} Simplified metadata object.
   */
  async analyzeUrl(url) {
    return queueService.enqueue(() => this._spawnAnalyze(url));
  }

  /**
   * Internal spawn method for analyze command.
   * Command: ~/bin/yt-dlp --dump-single-json --no-playlist --js-runtimes node URL
   * 
   * @private
   * @param {string} url - Target URL.
   * @returns {Promise<Object>} Formatted video metadata.
   */
  _spawnAnalyze(url) {
    return new Promise((resolve, reject) => {
      const executable = getExecutablePath();
      const args = [
        "--dump-single-json",
        ...getCommonArgs(),
        url
      ];

      logger.info(`Spawning yt-dlp analyze process: ${executable} ${args.join(" ")}`);

      const child = spawn(executable, args, {
        windowsHide: true
      });

      let stdoutData = "";
      let stderrData = "";
      let isTimedOut = false;

      // Enforce execution timeout (60s default)
      const timer = setTimeout(() => {
        isTimedOut = true;
        logger.error(`yt-dlp analyze process timed out after ${config.ytDlpTimeoutMs}ms`);
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 2000);
      }, config.ytDlpTimeoutMs);

      child.stdout.on("data", (chunk) => {
        stdoutData += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderrData += chunk.toString();
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        logger.error("Failed to spawn yt-dlp process", err);
        reject(new Error(`Failed to execute yt-dlp binary: ${err.message}`));
      });

      child.on("close", (code) => {
        clearTimeout(timer);

        if (isTimedOut) {
          return reject(new Error("yt-dlp metadata extraction request timed out"));
        }

        if (code !== 0) {
          logger.error(`yt-dlp analyze exited with code ${code}: ${stderrData}`);
          return reject(new Error(`yt-dlp error (${code}): ${stderrData || "Failed to extract metadata"}`));
        }

        try {
          const simplified = parseAndSimplifyYtDlpJson(stdoutData);
          resolve(simplified);
        } catch (parseErr) {
          logger.error("Error parsing yt-dlp JSON output", parseErr);
          reject(new Error("Failed to parse metadata from yt-dlp output"));
        }
      });
    });
  }

  /**
   * Initializes a download job record and queues background spawn execution.
   * 
   * @param {string} downloadId - Unique UUID for the download task.
   * @param {string} url - Target media URL.
   * @param {string} [format="best"] - Format selection string (e.g. "137+140").
   */
  startDownload(downloadId, url, format = "best") {
    // Ensure target downloads directory exists
    if (!fs.existsSync(config.downloadsDir)) {
      fs.mkdirSync(config.downloadsDir, { recursive: true });
    }

    const jobState = {
      id: downloadId,
      url: url,
      format: format,
      status: "pending", // pending, processing, completed, error
      progress: 0,
      speed: "0KiB/s",
      eta: "00:00",
      filename: null,
      filePath: null,
      error: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    downloadJobsMap.set(downloadId, jobState);

    // Enqueue actual download spawn execution without blocking API response
    queueService.enqueue(() => this._spawnDownload(downloadId, url, format))
      .catch((err) => {
        logger.error(`Download job ${downloadId} failed with error:`, err);
      });
  }

  /**
   * Internal spawn method for media download execution.
   * Command: ~/bin/yt-dlp --no-playlist --js-runtimes node -f <format> -o <downloadsDir>/<downloadId>.%(ext)s URL
   * 
   * @private
   * @param {string} downloadId - Download task ID.
   * @param {string} url - Target URL.
   * @param {string} format - Format selector.
   * @returns {Promise<void>} Resolves when download finishes.
   */
  _spawnDownload(downloadId, url, format) {
    return new Promise((resolve, reject) => {
      const job = downloadJobsMap.get(downloadId);
      if (!job) {
        return reject(new Error(`Download job ${downloadId} not found in state`));
      }

      job.status = "processing";
      job.updatedAt = Date.now();

      const executable = getExecutablePath();
      const outputPattern = path.join(config.downloadsDir, `${downloadId}.%(ext)s`);

      const args = [
        ...getCommonArgs(),
        "-f",
        format || "best",
        "-o",
        outputPattern,
        "--newline", // Enable clean line-by-line stdout for progress parsing
        url
      ];

      logger.info(`Spawning yt-dlp download process: ${executable} ${args.join(" ")}`);

      const child = spawn(executable, args, {
        windowsHide: true
      });

      let stderrData = "";
      let isTimedOut = false;

      // 60-second download timeout per process step (can be extended if needed via config)
      const timer = setTimeout(() => {
        isTimedOut = true;
        logger.error(`yt-dlp download process ${downloadId} timed out after ${config.ytDlpTimeoutMs}ms`);
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 2000);
      }, config.ytDlpTimeoutMs * 5); // 5 minutes max timeout for video downloads

      child.stdout.on("data", (chunk) => {
        const lines = chunk.toString().split(/\r?\n/);
        for (const line of lines) {
          this._parseProgressLine(job, line);
        }
      });

      child.stderr.on("data", (chunk) => {
        stderrData += chunk.toString();
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        job.status = "error";
        job.error = err.message;
        job.updatedAt = Date.now();
        reject(err);
      });

      child.on("close", (code) => {
        clearTimeout(timer);

        if (isTimedOut) {
          job.status = "error";
          job.error = "Download timed out";
          job.updatedAt = Date.now();
          return reject(new Error("Download process timed out"));
        }

        if (code !== 0) {
          job.status = "error";
          job.error = stderrData || `yt-dlp exited with error code ${code}`;
          job.updatedAt = Date.now();
          logger.error(`Download process ${downloadId} failed: ${job.error}`);
          return reject(new Error(job.error));
        }

        // Find created output file matching downloadId prefix in downloads directory
        try {
          const files = fs.readdirSync(config.downloadsDir);
          const matchedFile = files.find((file) => file.startsWith(downloadId));

          if (matchedFile) {
            job.status = "completed";
            job.progress = 100;
            job.filename = matchedFile;
            job.filePath = path.join(config.downloadsDir, matchedFile);
            job.updatedAt = Date.now();
            logger.info(`Download completed successfully for ID ${downloadId}: ${matchedFile}`);
            resolve();
          } else {
            job.status = "error";
            job.error = "Output file not found after download completed";
            job.updatedAt = Date.now();
            reject(new Error(job.error));
          }
        } catch (err) {
          job.status = "error";
          job.error = err.message;
          job.updatedAt = Date.now();
          reject(err);
        }
      });
    });
  }

  /**
   * Parses stdout line from yt-dlp to update download job progress, speed, and ETA.
   * Example line: [download]  45.2% of 10.00MiB at 2.50MiB/s ETA 00:05
   * 
   * @private
   * @param {Object} job - Download job state reference.
   * @param {string} line - Line of stdout text.
   */
  _parseProgressLine(job, line) {
    if (!line || !line.includes("[download]")) return;

    // Extract progress percentage
    const percentMatch = line.match(/(\d+(?:\.\d+)?)%/);
    if (percentMatch) {
      job.progress = parseFloat(percentMatch[1]);
    }

    // Extract speed
    const speedMatch = line.match(/at\s+([\d.]+\s*[a-zA-Z]+\/s)/);
    if (speedMatch) {
      job.speed = speedMatch[1];
    }

    // Extract ETA
    const etaMatch = line.match(/ETA\s+([\d:]+)/);
    if (etaMatch) {
      job.eta = etaMatch[1];
    }

    // Extract destination filename if reported
    const destinationMatch = line.match(/Destination:\s*(.+)/);
    if (destinationMatch) {
      const fullPath = destinationMatch[1].trim();
      job.filename = path.basename(fullPath);
      job.filePath = fullPath;
    }

    job.updatedAt = Date.now();
  }

  /**
   * Retrieves status record of a download task.
   * 
   * @param {string} downloadId - Download task UUID.
   * @returns {Object|null} Job state object or null if not found.
   */
  getJobStatus(downloadId) {
    return downloadJobsMap.get(downloadId) || null;
  }

  /**
   * Gets map reference of all download jobs (used by cleanup service).
   * @returns {Map<string, Object>} Map of jobs.
   */
  getAllJobs() {
    return downloadJobsMap;
  }
}

module.exports = new YtDlpService();
