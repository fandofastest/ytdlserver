const fs = require("fs");
const crypto = require("crypto");
const { generateSha256 } = require("../utils/hash.util");
const cacheService = require("../cache/cache.service");
const ytDlpService = require("../services/ytdlp.service");
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

    // Generate unique UUID for tracking download task and output filename
    const downloadId = crypto.randomUUID();

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

    if (!job) {
      return res.status(404).json({
        success: false,
        message: `Download task with ID '${id}' not found`,
        code: "TASK_NOT_FOUND"
      });
    }

    const host = req.get("host");
    const protocol = req.protocol;
    const downloadUrl = job.status === "completed" ? `${protocol}://${host}/api/file/${id}` : null;

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

    const job = ytDlpService.getJobStatus(id);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: `Download file with ID '${id}' not found`,
        code: "FILE_NOT_FOUND"
      });
    }

    if (job.status !== "completed" || !job.filePath) {
      return res.status(400).json({
        success: false,
        message: `File is not ready for download. Current status: ${job.status}`,
        code: "FILE_NOT_READY"
      });
    }

    if (!fs.existsSync(job.filePath)) {
      return res.status(410).json({
        success: false,
        message: "File has expired or was removed by cleanup service",
        code: "FILE_EXPIRED"
      });
    }

    // Trigger attachment file download response
    return res.download(job.filePath, job.filename, (err) => {
      if (err && !res.headersSent) {
        logger.error(`Error sending download attachment for ID ${id}`, err);
        next(err);
      }
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

module.exports = {
  analyze,
  download,
  getStatus,
  getFile,
  updateYtDlp
};
