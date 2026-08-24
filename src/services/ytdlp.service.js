const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const config = require("../config/app.config");
const logger = require("../utils/logger.util");
const { parseAndSimplifyYtDlpJson } = require("../utils/ytdlp.util");
const queueService = require("./queue.service");
const rapidApiService = require("./rapidapi.service");
const statsService = require("./stats.service");

function generateSha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

// In-memory status map for tracking active and completed download jobs
const downloadJobsMap = new Map();

// In-memory cache for high-speed direct stream URLs
const directStreamCache = new Map();

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
  return "yt-dlp";
}

// In-memory cooldown tracker for rate-limited/failed cookie files
const cookieCooldownMap = new Map();

/**
 * Scans available cookie files for rotation and fallback.
 * @returns {Array<string>} Array of existing absolute cookie file paths.
 */
function getAvailableCookiePaths() {
  const candidates = [];
  if (config.cookiesPath) candidates.push(config.cookiesPath);

  const baseDir = config.cookiesPath ? path.dirname(config.cookiesPath) : os.homedir();
  for (let i = 1; i <= 10; i++) {
    const filename = i === 1 ? "cookies.txt" : `cookies${i}.txt`;
    candidates.push(path.join(baseDir, filename));
    candidates.push(`/home/fandofast/${filename}`);
  }

  const now = Date.now();
  const validFiles = Array.from(new Set(candidates)).filter((p) => {
    if (!p || !fs.existsSync(p)) return false;
    const cooldown = cookieCooldownMap.get(p);
    if (cooldown && now < cooldown) return false;
    return true;
  });

  // If all cookies are in cooldown, reset cooldown map to allow retry
  if (validFiles.length === 0) {
    cookieCooldownMap.clear();
    return Array.from(new Set(candidates)).filter((p) => p && fs.existsSync(p));
  }

  return validFiles;
}

/**
 * Builds array of common yt-dlp arguments.
 * 
 * @param {Object} [options={}] - Execution options.
 * @param {boolean} [options.disableImpersonate=false] - Disable --impersonate argument if true.
 * @param {string} [options.cookiePath] - Specific cookie path to use for this execution.
 * @param {boolean} [options.skipSleepRequests=false] - Omit --sleep-requests for fast operations.
 * @returns {Array<string>} Common args array.
 */
function getCommonArgs(options = {}) {
  const args = [
    "--no-playlist",
    "--js-runtimes",
    "node"
  ];

  if (!options.skipSleepRequests) {
    args.push("--sleep-requests", "0.5");
  }

  if (config.userAgent) {
    args.push("--user-agent", config.userAgent);
  }

  if (!options.disableImpersonate && config.impersonate && config.impersonate !== "none") {
    args.push("--impersonate", config.impersonate);
  }

  if (config.extractorArgs) {
    args.push("--extractor-args", config.extractorArgs);
  }

  // Attach selected or default cookies file if present
  const availableCookies = getAvailableCookiePaths();
  const selectedCookie = options.cookiePath || (availableCookies.length > 0 ? availableCookies[0] : null);
  if (selectedCookie && fs.existsSync(selectedCookie)) {
    args.push("--cookies", selectedCookie);
  }

  // Attach proxy only when requested for fallback or when config explicitly forces it
  const targetProxy = options.useProxy ? (options.proxyUrl || config.proxyUrl) : (options.forceProxy ? config.proxyUrl : null);
  if (targetProxy) {
    args.push("--proxy", targetProxy);
  }

  return args;
}

class YtDlpService {
  /**
   * Executes yt-dlp to extract single-json metadata for a URL.
   * Wraps spawn call inside queueService to ensure concurrency control.
   * 
   * @param {string} url - Validated video/audio URL.
   * @param {Object} [options={}] - Options (e.g. useFastTimeout).
   * @returns {Promise<Object>} Simplified metadata object.
   */
  async analyzeUrl(url, options = {}) {
    return queueService.enqueue(() => this._spawnAnalyze(url, options));
  }

  /**
   * Internal spawn method for analyze command.
   * Command: ~/bin/yt-dlp --dump-single-json --no-playlist --js-runtimes node URL
   * 
   * @private
   * @param {string} url - Target URL.
   * @param {Object} [options={}] - Options object.
   * @param {boolean} [options.disableImpersonate=false] - Retries execution without --impersonate if curl-cffi is missing.
   * @param {boolean} [options.useFastTimeout=false] - Enforces 4s fast timeout before RapidAPI fallback.
   * @returns {Promise<Object>} Formatted video metadata.
   */
  _spawnAnalyze(url, options = {}) {
    const disableImpersonate = Boolean(options.disableImpersonate);
    const useFastTimeout = Boolean(options.useFastTimeout);
    const cookieIndex = parseInt(options.cookieIndex || "0", 10);
    const availableCookies = getAvailableCookiePaths();
    const currentCookie = availableCookies[cookieIndex] || null;

    return new Promise((resolve, reject) => {
      const executable = getExecutablePath();
      const commonArgs = getCommonArgs({ disableImpersonate, cookiePath: currentCookie, skipSleepRequests: true });
      const args = [
        "--dump-single-json",
        ...commonArgs,
        url
      ];

      logger.info(`Spawning yt-dlp analyze process (cookie ${cookieIndex + 1}/${availableCookies.length || 1}): ${executable} ${args.join(" ")}`);

      const child = spawn(executable, args, {
        windowsHide: true
      });

      let stdoutData = "";
      let stderrData = "";
      let isTimedOut = false;

      const timeoutMs = useFastTimeout ? config.ytDlpFastTimeoutMs : config.ytDlpTimeoutMs;

      // Enforce execution timeout
      const timer = setTimeout(() => {
        isTimedOut = true;
        logger.error(`yt-dlp analyze process timed out after ${timeoutMs}ms`);
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 2000);
      }, timeoutMs);

      child.stdout.on("data", (chunk) => {
        stdoutData += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderrData += chunk.toString();
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        logger.error("Failed to spawn yt-dlp process", err);
        if (config.enableRapidApiFallback && rapidApiService.isYouTubeUrl(url)) {
          logger.warn(`yt-dlp spawn error for ${url}. Attempting RapidAPI YouTube fallback...`);
          return rapidApiService.fetchMetadata(url).then(resolve).catch((fbErr) => {
            reject(new Error(`Failed to execute yt-dlp binary: ${err.message}. Fallback error: ${fbErr.message}`));
          });
        }
        reject(new Error(`Failed to execute yt-dlp binary: ${err.message}`));
      });

      child.on("close", (code) => {
        clearTimeout(timer);

        if (isTimedOut) {
          if (config.enableRapidApiFallback && rapidApiService.isYouTubeUrl(url)) {
            logger.warn(`yt-dlp analyze timed out for ${url}. Attempting RapidAPI YouTube fallback...`);
            return rapidApiService.fetchMetadata(url).then(resolve).catch((fbErr) => {
              reject(new Error(`yt-dlp metadata extraction timed out. Fallback error: ${fbErr.message}`));
            });
          }
          return reject(new Error("yt-dlp metadata extraction request timed out"));
        }

        if (code !== 0) {
          // Record cookie failure in cooldown map if rate-limited or expired
          const isCookieError = /rate-limited|Sign in to confirm|invalid Netscape|429/i.test(stderrData);
          if (isCookieError && currentCookie) {
            cookieCooldownMap.set(currentCookie, Date.now() + 15 * 60 * 1000); // 15 min cooldown
            logger.warn(`Cookie '${path.basename(currentCookie)}' hit rate limit/session error. Cooldown active for 15 minutes.`);
          }

          // If impersonation failed because curl-cffi or impersonate target is missing, retry without --impersonate
          const isImpersonateError = /curl-cffi|impersonate/i.test(stderrData);
          if (isImpersonateError && !disableImpersonate && config.impersonate && config.impersonate !== "none") {
            logger.warn("yt-dlp impersonation failed (curl-cffi missing on host). Retrying analyze without --impersonate...");
            return this._spawnAnalyze(url, { ...options, disableImpersonate: true }).then(resolve).catch(reject);
          }

          // Try fallback cookie first if available
          if (cookieIndex + 1 < availableCookies.length) {
            logger.warn(`yt-dlp analyze exited with code ${code}. Retrying with fallback cookie (${cookieIndex + 2}/${availableCookies.length}): ${availableCookies[cookieIndex + 1]}`);
            return this._spawnAnalyze(url, { ...options, cookieIndex: cookieIndex + 1 }).then(resolve).catch(reject);
          } else if (!options.useProxy && config.proxyUrl) {
            logger.warn(`yt-dlp analyze exited with code ${code} on all cookies. Retrying with fallback proxy: ${config.proxyUrl}`);
            return this._spawnAnalyze(url, { ...options, cookieIndex: 0, useProxy: true }).then(resolve).catch(reject);
          }

          if (config.enableRapidApiFallback && rapidApiService.isYouTubeUrl(url)) {
            logger.warn(`yt-dlp analyze exited with code ${code}. Attempting RapidAPI YouTube fallback...`);
            return rapidApiService.fetchMetadata(url).then(resolve).catch((fbErr) => {
              logger.error(`RapidAPI analyze fallback failed: ${fbErr.message}`);
              reject(new Error(`yt-dlp error (${code}): ${stderrData || "Failed to extract metadata"}. Fallback error: ${fbErr.message}`));
            });
          }

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
   * High-speed direct stream URL extraction with in-memory TTL caching.
   * @param {string} url - YouTube URL.
   * @returns {Promise<Object>} Stream URL info { streamUrl, title, duration, fromCache }
   */
  async getDirectStreamUrl(url) {
    const cacheKey = generateSha256(url);
    const cached = directStreamCache.get(cacheKey);

    // 3 hours TTL for cached direct stream URLs
    if (cached && Date.now() - cached.timestamp < 3 * 3600 * 1000) {
      logger.info(`Direct Stream Cache hit for ${url}`);
      return { ...cached, fromCache: true };
    }

    const metadata = await this._spawnAnalyze(url);
    if (!metadata) {
      throw new Error("No media metadata returned for direct stream redirect");
    }

    const formats = metadata.formats || [];
    const adaptive = metadata.adaptiveFormats || [];
    const allFormats = [...formats, ...adaptive];

    if (allFormats.length === 0) {
      throw new Error("No media formats available for direct stream redirect");
    }

    // Pick best audio format (id '251', '140', '18', audio: true, or first format with url)
    let bestFormat = allFormats.find(f => (f.id === '251' || f.itag === 251) && f.url) ||
                     allFormats.find(f => (f.id === '140' || f.itag === 140) && f.url) ||
                     allFormats.find(f => (f.id === '18' || f.itag === 18) && f.url) ||
                     allFormats.find(f => f.audio && f.url) ||
                     allFormats.find(f => f.url);

    if (!bestFormat || !bestFormat.url) {
      throw new Error("Failed to extract direct stream URL");
    }

    const result = {
      streamUrl: bestFormat.url,
      title: metadata.title,
      duration: metadata.duration || metadata.lengthSeconds || 0,
      timestamp: Date.now()
    };

    directStreamCache.set(cacheKey, result);
    return { ...result, fromCache: false };
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
   * @param {boolean} [disableImpersonate=false] - Retries execution without --impersonate if curl-cffi is missing.
   * @returns {Promise<void>} Resolves when download finishes.
   */
  _spawnDownload(downloadId, url, format, disableImpersonate = false, cookieIndex = 0, useProxy = false) {
    return new Promise((resolve, reject) => {
      let job = downloadJobsMap.get(downloadId);
      if (!job) {
        job = {
          id: downloadId,
          url: url,
          format: format || "best",
          status: "pending",
          progress: 0,
          speed: "0KiB/s",
          eta: "00:00",
          filename: null,
          filePath: null,
          error: null,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        downloadJobsMap.set(downloadId, job);
      }

      job.status = "processing";
      job.updatedAt = Date.now();

      const executable = getExecutablePath();
      const outputPattern = path.join(config.downloadsDir, `${downloadId}.%(ext)s`);

      const availableCookies = getAvailableCookiePaths();
      const currentCookie = availableCookies[cookieIndex] || null;

      const commonArgs = getCommonArgs({ disableImpersonate, cookiePath: currentCookie, useProxy });
      const args = [
        ...commonArgs,
        "-f",
        format || "best",
        "-o",
        outputPattern,
        "--newline", // Enable clean line-by-line stdout for progress parsing
        url
      ];

      logger.info(`Spawning yt-dlp download process (cookie ${cookieIndex + 1}/${availableCookies.length || 1}, proxy=${useProxy}): ${executable} ${args.join(" ")}`);

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
        logger.error(`Failed to spawn yt-dlp download process for ${downloadId}`, err);
        if (config.enableRapidApiFallback && rapidApiService.isYouTubeUrl(url)) {
          logger.warn(`yt-dlp download spawn error for ${downloadId}. Attempting RapidAPI YouTube fallback...`);
          return rapidApiService.downloadFile(downloadId, url, job).then(resolve).catch((fbErr) => {
            job.status = "error";
            job.error = `Failed to execute yt-dlp binary: ${err.message}. Fallback error: ${fbErr.message}`;
            job.updatedAt = Date.now();
            reject(new Error(job.error));
          });
        }
        job.status = "error";
        job.error = err.message;
        job.updatedAt = Date.now();
        reject(err);
      });

      child.on("close", (code) => {
        clearTimeout(timer);

        if (isTimedOut) {
          if (config.enableRapidApiFallback && rapidApiService.isYouTubeUrl(url)) {
            logger.warn(`yt-dlp download process ${downloadId} timed out. Attempting RapidAPI YouTube fallback...`);
            return rapidApiService.downloadFile(downloadId, url, job).then(resolve).catch((fbErr) => {
              job.status = "error";
              job.error = `yt-dlp download timed out. Fallback error: ${fbErr.message}`;
              job.updatedAt = Date.now();
              reject(new Error(job.error));
            });
          }
          job.status = "error";
          job.error = "Download timed out";
          job.updatedAt = Date.now();
          return reject(new Error("Download process timed out"));
        }

        if (code !== 0) {
          logger.warn(`Download process ${downloadId} exited with code ${code}. Stderr: ${stderrData.trim()}`);

          // If format is not available, retry with fallback format 'best'
          const isFormatError = /Requested format is not available|format.*not available/i.test(stderrData);
          if (isFormatError && format !== "best") {
            logger.warn(`Download process ${downloadId} format '${format}' not available. Retrying with format 'best'...`);
            return this._spawnDownload(downloadId, url, "best", disableImpersonate, cookieIndex, useProxy).then(resolve).catch(reject);
          }

          // If impersonation failed because curl-cffi or impersonate target is missing, retry without --impersonate
          const isImpersonateError = /curl-cffi|impersonate/i.test(stderrData);
          if (isImpersonateError && !disableImpersonate && config.impersonate && config.impersonate !== "none") {
            logger.warn(`Download process ${downloadId} impersonation failed. Retrying download without --impersonate...`);
            return this._spawnDownload(downloadId, url, format, true, cookieIndex, useProxy).then(resolve).catch(reject);
          }

          // Try fallback cookie first if available
          if (cookieIndex + 1 < availableCookies.length) {
            logger.warn(`Download process ${downloadId} exited with code ${code}. Retrying with fallback cookie (${cookieIndex + 2}/${availableCookies.length}): ${availableCookies[cookieIndex + 1]}`);
            return this._spawnDownload(downloadId, url, format, disableImpersonate, cookieIndex + 1, useProxy).then(resolve).catch(reject);
          } else if (!useProxy && config.proxyUrl) {
            logger.warn(`Download process ${downloadId} exited with code ${code} on all cookies. Retrying with fallback proxy: ${config.proxyUrl}`);
            return this._spawnDownload(downloadId, url, format, disableImpersonate, 0, true).then(resolve).catch(reject);
          }

          if (config.enableRapidApiFallback && rapidApiService.isYouTubeUrl(url)) {
            logger.warn(`Download process ${downloadId} exited with code ${code}. Attempting RapidAPI YouTube fallback...`);
            return rapidApiService.downloadFile(downloadId, url, job).then(resolve).catch((fbErr) => {
              job.status = "error";
              job.error = `yt-dlp exited with code ${code}: ${stderrData}. Fallback error: ${fbErr.message}`;
              job.updatedAt = Date.now();
              reject(new Error(job.error));
            });
          }

          job.status = "error";
          job.error = stderrData || `yt-dlp exited with error code ${code}`;
          job.updatedAt = Date.now();
          logger.error(`Download process ${downloadId} failed: ${job.error}`);
          return reject(new Error(job.error));
        }

        // Find created output file matching downloadId prefix in downloads directory
        try {
          const files = fs.readdirSync(config.downloadsDir);
          const matchedFile = files.find((file) => {
            if (!file.startsWith(downloadId)) return false;
            const lower = file.toLowerCase();
            if (lower.endsWith(".part") || lower.endsWith(".ytdl") || lower.endsWith(".tmp") || lower.endsWith(".temp")) {
              return false;
            }
            return true;
          });

          if (matchedFile) {
            job.status = "completed";
            job.progress = 100;
            job.filename = matchedFile;
            job.filePath = path.join(config.downloadsDir, matchedFile);
            job.updatedAt = Date.now();
            const durationMs = Date.now() - (job.createdAt || Date.now());
            statsService.recordHit("ytdl", { url, filename: matchedFile, id: downloadId, durationMs });
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
   * Scans downloads directory for an existing local file starting with fileHash prefix.
   * 
   * @param {string} fileHash - SHA256 or unique file hash identifier.
   * @returns {Object|null} Object containing filename and filePath if found, or null.
   */
  findLocalFileByHash(fileHash) {
    if (!fileHash || !fs.existsSync(config.downloadsDir)) {
      return null;
    }
    try {
      const files = fs.readdirSync(config.downloadsDir);
      const matched = files.find((file) => {
        if (!file.startsWith(fileHash)) return false;
        const lower = file.toLowerCase();
        if (lower.endsWith(".part") || lower.endsWith(".ytdl") || lower.endsWith(".tmp") || lower.endsWith(".temp")) {
          return false;
        }
        return true;
      });

      if (matched) {
        const fullPath = path.join(config.downloadsDir, matched);
        const stats = fs.statSync(fullPath);
        if (stats.size > 0) {
          return {
            filename: matched,
            filePath: fullPath
          };
        }
      }
    } catch (err) {
      logger.error(`Error finding local file for hash ${fileHash}:`, err);
    }
    return null;
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

  /**
   * Runs yt-dlp -U to update executable to latest release on GitHub.
   * 
   * @returns {Promise<string>} Output result message from yt-dlp.
   */
  updateBinary() {
    return new Promise((resolve, reject) => {
      const executable = getExecutablePath();
      logger.info(`Checking and updating yt-dlp binary: ${executable} -U`);

      const child = spawn(executable, ["-U"], { windowsHide: true });
      let outputData = "";

      child.stdout.on("data", (chunk) => {
        outputData += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        outputData += chunk.toString();
      });

      child.on("error", (err) => {
        logger.error("Failed to execute yt-dlp update process", err);
        reject(new Error(`Failed to execute yt-dlp update: ${err.message}`));
      });

      child.on("close", (code) => {
        const trimmed = outputData.trim() || `yt-dlp update process exited with code ${code}`;
        if (code === 0) {
          logger.info(`yt-dlp update result: ${trimmed}`);
          resolve(trimmed);
        } else {
          logger.warn(`yt-dlp update exited with code ${code}: ${trimmed}`);
          resolve(trimmed);
        }
      });
    });
  }
}

module.exports = new YtDlpService();
