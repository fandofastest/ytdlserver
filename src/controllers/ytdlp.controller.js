const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const config = require("../config/app.config");
const { generateSha256 } = require("../utils/hash.util");
const cacheService = require("../cache/cache.service");
const ytDlpService = require("../services/ytdlp.service");
const rapidApiService = require("../services/rapidapi.service");
const statsService = require("../services/stats.service");
const logger = require("../utils/logger.util");

/**
 * Controller to handle video metadata extraction request.
 * Workflow: Validate -> SHA256 Cache Check -> Spawn yt-dlp if miss -> Format -> Cache -> Return JSON
 * POST /api/analyze
 */
async function analyze(req, res, next) {
  try {
    const { url } = req.body;

    // Generate deterministic SHA256 cache key from video URL
    const cacheKey = generateSha256(url);

    // Check if result exists in node-cache
    const cachedData = cacheService.get(cacheKey);
    if (cachedData) {
      logger.info(`Cache hit for URL hash: ${cacheKey}`);
      return res.status(200).json({
        success: true,
        cached: true,
        data: cachedData
      });
    }

    logger.info(`Cache miss for URL hash: ${cacheKey}. Triggering yt-dlp analyze.`);

    // Execute yt-dlp spawn command via service queue
    const metadata = await ytDlpService.analyzeUrl(url);

    // Store in node-cache with 10-minute TTL
    cacheService.set(cacheKey, metadata);

    return res.status(200).json({
      success: true,
      cached: false,
      data: metadata
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller to initiate background media download task.
 * POST /api/download
 */
async function download(req, res, next) {
  try {
    const { url, format } = req.body;

    // Generate unique UUID or deterministic hash (including format) for tracking download task
    const downloadId = url ? generateSha256(url + (format ? "_" + format : "")) : crypto.randomUUID();

    // Check if file already exists locally (Zero-Quota hit)
    const existingFile = ytDlpService.findLocalFileByHash(downloadId);
    if (existingFile) {
      logger.info(`Zero-Quota hit on download request for hash ${downloadId}: ${existingFile.filename}`);
      statsService.recordHit("local", { url, filename: existingFile.filename, id: downloadId });
      return res.status(200).json({
        success: true,
        cached: true,
        downloadId: downloadId,
        message: "File is already downloaded and available locally"
      });
    }

    // Start background spawn process in queue
    ytDlpService.startDownload(downloadId, url, format || "best");

    logger.info(`Started download task ID: ${downloadId} for format: ${format || "best"}`);

    return res.status(200).json({
      success: true,
      downloadId: downloadId
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller to poll status of background download task.
 * GET /api/status/:id
 */
async function getStatus(req, res, next) {
  try {
    const { id } = req.params;

    const job = ytDlpService.getJobStatus(id);

    // If job not in memory, check if file exists locally on disk
    if (!job) {
      const localFile = ytDlpService.findLocalFileByHash(id);
      if (localFile) {
        const host = req.get("host");
        const protocol = req.protocol;
        return res.status(200).json({
          success: true,
          data: {
            id: id,
            status: "completed",
            progress: 100,
            speed: "N/A (Local)",
            eta: "00:00",
            filename: localFile.filename,
            downloadUrl: `${protocol}://${host}/public/downloads/${localFile.filename}`,
            error: null
          }
        });
      }

      return res.status(404).json({
        success: false,
        message: `Download task with ID '${id}' not found`,
        code: "TASK_NOT_FOUND"
      });
    }

    const host = req.get("host");
    const protocol = req.protocol;
    const downloadUrl = job.status === "completed" ? `${protocol}://${host}/public/downloads/${job.filename || job.id}` : null;

    return res.status(200).json({
      success: true,
      data: {
        id: job.id,
        status: job.status,
        progress: job.progress,
        speed: job.speed,
        eta: job.eta,
        filename: job.filename,
        downloadUrl: downloadUrl,
        error: job.error
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller to download generated file.
 * GET /api/file/:id
 */
async function getFile(req, res, next) {
  try {
    const { id } = req.params;

    // 1. Check in-memory job status map
    const job = ytDlpService.getJobStatus(id);
    if (job && job.status === "completed" && job.filePath && fs.existsSync(job.filePath)) {
      if (job.filePath.toLowerCase().endsWith(".mp3")) {
        res.setHeader("Content-Type", "audio/mpeg");
      }
      return res.download(job.filePath, job.filename, (err) => {
        if (err && !res.headersSent) next(err);
      });
    }

    // 2. Check local disk for existing file starting with id (SHA256 hash or prefix)
    const localFile = ytDlpService.findLocalFileByHash(id);
    if (localFile && fs.existsSync(localFile.filePath)) {
      if (localFile.filePath.toLowerCase().endsWith(".mp3")) {
        res.setHeader("Content-Type", "audio/mpeg");
      }
      return res.download(localFile.filePath, localFile.filename, (err) => {
        if (err && !res.headersSent) next(err);
      });
    }

    if (job) {
      if (job.status !== "completed") {
        return res.status(400).json({
          success: false,
          message: `File is not ready for download. Current status: ${job.status}`,
          code: "FILE_NOT_READY"
        });
      }
      return res.status(410).json({
        success: false,
        message: "File has expired or was removed by cleanup service",
        code: "FILE_EXPIRED"
      });
    }

    return res.status(404).json({
      success: false,
      message: `Download file with ID '${id}' not found`,
      code: "FILE_NOT_FOUND"
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller to manually trigger yt-dlp binary update (yt-dlp -U).
 * POST /api/update
 */
async function updateYtDlp(req, res, next) {
  try {
    const resultMessage = await ytDlpService.updateBinary();
    return res.status(200).json({
      success: true,
      message: resultMessage
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller to handle instant direct download stream request with zero-quota local disk caching.
 * Checks local disk first for existing MP3 ({urlHash}.mp3).
 * If missing, downloads media to local disk (yt-dlp first, RapidAPI second) and serves the local file.
 * GET /api/stream?url=YOUTUBE_URL&redirect=true|false
 */
async function stream(req, res, next) {
  const startTime = Date.now();
  try {
    const url = req.query.url;
    const shouldRedirect = req.query.redirect !== "false";

    if (!url) {
      const durationMs = Date.now() - startTime;
      statsService.recordFailure({ url: "", durationMs, error: "Missing required query parameter: url" });
      return res.status(400).json({
        success: false,
        error: "Missing required query parameter: url"
      });
    }

    const host = req.get("host");
    const protocol = req.protocol;
    const cacheKey = generateSha256(url);

    // 1. Zero-Quota Check: Check if local file already exists on disk FIRST
    const existingFile = ytDlpService.findLocalFileByHash(cacheKey, "mp3");
    if (existingFile) {
      logger.info(`Zero-Quota Hit: Serving local cached MP3 file for URL hash (${cacheKey}): ${existingFile.filename}`);
      const durationMs = Date.now() - startTime;
      statsService.recordHit("local", { url, filename: existingFile.filename, id: cacheKey, durationMs });

      const localDownloadUrl = `${protocol}://${host}/public/downloads/${existingFile.filename}`;
      if (shouldRedirect) {
        return res.redirect(302, localDownloadUrl);
      }
      return res.status(200).json({
        success: true,
        cached: true,
        localFile: true,
        downloadUrl: localDownloadUrl,
        filename: existingFile.filename
      });
    }

    const isDirectRedirectMode = config.directStreamRedirect || req.query.mode === "direct";

    if (isDirectRedirectMode) {
      logger.info(`Direct Stream Redirect Mode active for URL: ${url}. Triggering async background local disk download...`);

      // Trigger background local download asynchronously (fire-and-forget so next request hits local file!)
      ytDlpService._spawnDownload(cacheKey, url, "mp3").catch((err) => {
        logger.warn(`Async background local download failed for ${cacheKey}: ${err.message}`);
      });

      const directInfo = await ytDlpService.getDirectStreamUrl(url);
      const durationMs = Date.now() - startTime;
      statsService.recordHit(directInfo.fromCache ? "local" : "ytdl", {
        url,
        filename: `${directInfo.title || cacheKey}.mp3`,
        id: cacheKey,
        durationMs
      });

      if (shouldRedirect) {
        return res.redirect(302, directInfo.streamUrl);
      }
      return res.status(200).json({
        success: true,
        mode: "direct_stream_redirect",
        backgroundCachingStarted: true,
        cached: directInfo.fromCache,
        streamUrl: directInfo.streamUrl,
        title: directInfo.title,
        duration: directInfo.duration
      });
    }

    logger.info(`Local file miss for URL hash: ${cacheKey}. Downloading and storing file to local disk.`);

    // 2. Download file to local storage (yt-dlp first, RapidAPI second)
    const tempJobState = {
      id: cacheKey,
      url: url,
      format: "mp3",
      status: "processing",
      progress: 0,
      speed: "0KiB/s",
      eta: "00:00",
      filename: null,
      filePath: null,
      error: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    let usedProvider = "ytdl";
    try {
      // Try yt-dlp first (saves RapidAPI quota!)
      await ytDlpService._spawnDownload(cacheKey, url, "mp3");
    } catch (err) {
      // If yt-dlp fails/times out and RapidAPI is available for YouTube, fallback to RapidAPI
      if (rapidApiService.isYouTubeUrl(url) && config.enableRapidApiFallback) {
        logger.warn(`yt-dlp download failed/timed out in stream controller for ${url}. Triggering RapidAPI download fallback...`);
        usedProvider = "rapidapi";
        await rapidApiService.downloadFile(cacheKey, url, tempJobState);
      } else {
        throw err;
      }
    }

    // Check newly downloaded local file
    const downloadedFile = ytDlpService.findLocalFileByHash(cacheKey, "mp3");
    if (!downloadedFile) {
      const durationMs = Date.now() - startTime;
      statsService.recordFailure({ url, durationMs, error: "Failed to locate stored MP3 file after download execution" });
      return res.status(502).json({
        success: false,
        error: "Failed to locate stored MP3 file after download execution"
      });
    }

    const durationMs = Date.now() - startTime;
    statsService.recordHit(usedProvider, { url, filename: downloadedFile.filename, id: cacheKey, durationMs });
    const localDownloadUrl = `${protocol}://${host}/public/downloads/${downloadedFile.filename}`;
    logger.info(`File successfully downloaded and cached to disk (${cacheKey}): ${downloadedFile.filename}`);

    if (shouldRedirect) {
      return res.redirect(302, localDownloadUrl);
    }

    return res.status(200).json({
      success: true,
      cached: false,
      localFile: true,
      downloadUrl: localDownloadUrl,
      filename: downloadedFile.filename
    });
  } catch (err) {
    const durationMs = Date.now() - startTime;
    statsService.recordFailure({ url: req.query ? req.query.url : "", durationMs, error: err.message });
    next(err);
  }
}

/**
 * Simple GET controller to download media directly by YouTube Video ID.
 * Usage: GET /dl/:id or GET /api/dl/:id
 */
async function downloadByVideoId(req, res, next) {
  const startTime = Date.now();
  try {
    const rawId = req.params.id;
    if (!rawId) {
      const durationMs = Date.now() - startTime;
      statsService.recordFailure({ videoId: "", durationMs, error: "Missing required video ID parameter" });
      return res.status(400).json({
        success: false,
        error: "Missing required video ID parameter"
      });
    }

    // Clean video ID (trim whitespace / query strings)
    const videoId = rawId.trim().split("?")[0].split("&")[0];
    const targetUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const urlHash = generateSha256(targetUrl);

    // 1. Zero-Quota Check: Check if local file exists by URL hash or Video ID FIRST (restrict to MP3)
    let localFile = ytDlpService.findLocalFileByHash(urlHash, "mp3") || ytDlpService.findLocalFileByHash(videoId, "mp3");
    if (localFile && fs.existsSync(localFile.filePath)) {
      logger.info(`Zero-Quota hit: Direct download file for Video ID ${videoId} (${localFile.filename})`);
      const durationMs = Date.now() - startTime;
      statsService.recordHit("local", { url: targetUrl, videoId, filename: localFile.filename, durationMs });
      res.setHeader("Content-Type", "audio/mpeg");
      return res.download(localFile.filePath, localFile.filename, (err) => {
        if (err && !res.headersSent) next(err);
      });
    }

    const isDirectRedirectMode = config.directStreamRedirect || (req.query && req.query.mode === "direct");

    if (isDirectRedirectMode) {
      logger.info(`Direct Stream Redirect Mode active for Video ID: ${videoId}. Triggering async background local disk download...`);

      // Trigger background local download asynchronously (fire-and-forget so next request hits local file!)
      ytDlpService._spawnDownload(urlHash, targetUrl, "mp3").catch((err) => {
        logger.warn(`Async background local download failed for Video ID ${videoId}: ${err.message}`);
      });

      const directInfo = await ytDlpService.getDirectStreamUrl(targetUrl);
      const durationMs = Date.now() - startTime;
      statsService.recordHit(directInfo.fromCache ? "local" : "ytdl", {
        url: targetUrl,
        videoId,
        filename: `${directInfo.title || videoId}.mp3`,
        durationMs
      });

      return res.redirect(302, directInfo.streamUrl);
    }

    logger.info(`Local file miss for Video ID: ${videoId} (${urlHash}). Triggering background download...`);

    const tempJobState = {
      id: urlHash,
      url: targetUrl,
      format: "mp3",
      status: "processing",
      progress: 0,
      speed: "0KiB/s",
      eta: "00:00",
      filename: null,
      filePath: null,
      error: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    let usedProvider = "ytdl";
    try {
      // Try yt-dlp first (saves RapidAPI quota!)
      await ytDlpService._spawnDownload(urlHash, targetUrl, "mp3");
    } catch (err) {
      if (rapidApiService.isYouTubeUrl(targetUrl) && config.enableRapidApiFallback) {
        logger.warn(`yt-dlp download failed/timed out for Video ID ${videoId}. Triggering RapidAPI fallback...`);
        usedProvider = "rapidapi";
        await rapidApiService.downloadFile(urlHash, targetUrl, tempJobState);
      } else {
        throw err;
      }
    }

    // Retrieve newly created local file
    const downloadedFile = ytDlpService.findLocalFileByHash(urlHash, "mp3") || ytDlpService.findLocalFileByHash(videoId, "mp3");
    if (downloadedFile && fs.existsSync(downloadedFile.filePath)) {
      logger.info(`Successfully downloaded file for Video ID ${videoId}, triggering attachment download: ${downloadedFile.filename}`);
      const durationMs = Date.now() - startTime;
      statsService.recordHit(usedProvider, { url: targetUrl, videoId, filename: downloadedFile.filename, durationMs });
      res.setHeader("Content-Type", "audio/mpeg");
      return res.download(downloadedFile.filePath, downloadedFile.filename, (err) => {
        if (err && !res.headersSent) next(err);
      });
    }

    const durationMs = Date.now() - startTime;
    statsService.recordFailure({ videoId, durationMs, error: `Failed to download or locate file for Video ID: ${videoId}` });
    return res.status(502).json({
      success: false,
      error: `Failed to download or locate file for Video ID: ${videoId}`
    });
  } catch (err) {
    const durationMs = Date.now() - startTime;
    statsService.recordFailure({ videoId: req.params ? req.params.id : "", durationMs, error: err.message });
    next(err);
  }
}

module.exports = {
  analyze,
  download,
  getStatus,
  getFile,
  updateYtDlp,
  stream,
  downloadByVideoId
};
