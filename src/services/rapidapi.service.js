const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const config = require("../config/app.config");
const logger = require("../utils/logger.util");

/**
 * Helper to extract YouTube Video ID from various URL formats.
 * 
 * @param {string} raw - Input URL string.
 * @returns {string|null} Video ID or null if unparseable.
 */
function extractVideoId(raw) {
  try {
    let u = new URL(raw);
    const nested = u.searchParams.get("url");
    if (nested) {
      u = new URL(nested);
    }
    if (u.hostname.includes("youtube.com")) {
      const id = u.searchParams.get("v");
      return id || null;
    }
    if (u.hostname === "youtu.be") {
      return u.pathname.slice(1).split("?")[0] || null;
    }
  } catch (_) {}
  return null;
}

/**
 * RapidAPI YouTube MP3 Downloader Service (Fallback for yt-dlp)
 */
class RapidApiService {
  /**
   * Checks if a given URL is a valid YouTube URL.
   * 
   * @param {string} url - Input URL.
   * @returns {boolean} True if URL is a YouTube link.
   */
  isYouTubeUrl(url) {
    return Boolean(extractVideoId(url));
  }

  /**
   * Fetches MP3 download information from RapidAPI for a YouTube Video ID.
   * 
   * @param {string} videoId - YouTube video ID.
   * @returns {Promise<Object>} Upstream JSON response object.
   */
  fetchMp3Info(videoId) {
    const apiUrl = new URL(`https://${config.rapidApiHost}/dl?id=${encodeURIComponent(videoId)}`);
    const options = {
      method: "GET",
      headers: {
        "x-rapidapi-key": config.rapidApiKey,
        "x-rapidapi-host": config.rapidApiHost
      }
    };

    return new Promise((resolve, reject) => {
      logger.info(`Requesting RapidAPI YouTube MP3 info for video ID: ${videoId}`);
      const req = https.request(apiUrl, options, (resp) => {
        let body = "";
        resp.on("data", (chunk) => (body += chunk));
        resp.on("end", () => {
          if (resp.statusCode !== 200) {
            return reject(new Error(`RapidAPI returned HTTP status ${resp.statusCode}: ${body}`));
          }
          try {
            const parsed = JSON.parse(body);
            resolve(parsed);
          } catch (err) {
            reject(new Error(`Failed to parse RapidAPI JSON response: ${err.message}`));
          }
        });
      });
      req.on("error", reject);
      req.end();
    });
  }

  /**
   * Fallback metadata extraction using RapidAPI.
   * Formats response to match yt-dlp simplified JSON structure.
   * 
   * @param {string} url - YouTube URL.
   * @returns {Promise<Object>} Simplified metadata object.
   */
  async fetchMetadata(url) {
    const videoId = extractVideoId(url);
    if (!videoId) {
      throw new Error("Could not extract YouTube video ID for RapidAPI fallback");
    }

    let info = null;
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      info = await this.fetchMp3Info(videoId);
      if (info && info.title) {
        break;
      }
      if (info && info.status === "fail" && info.msg !== "in process") {
        throw new Error(info.msg || "RapidAPI failed to fetch metadata");
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (!info) {
      throw new Error("RapidAPI metadata fetch timed out");
    }

    return {
      title: info.title || `YouTube Audio (${videoId})`,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      duration: typeof info.duration === "number" ? info.duration : 0,
      uploader: "YouTube",
      view_count: 0,
      upload_date: "",
      webpage_url: `https://www.youtube.com/watch?v=${videoId}`,
      directLink: info.link,
      formats: [
        {
          id: "rapidapi-mp3",
          ext: "mp3",
          quality: "mp3 (RapidAPI Fallback)",
          fps: null,
          filesize: info.filesize || null,
          video: false,
          audio: true,
          directLink: info.link
        }
      ]
    };
  }

  /**
   * Downloads media file directly from RapidAPI direct link to public/downloads directory.
   * 
   * @param {string} downloadId - Job ID.
   * @param {string} url - YouTube URL.
   * @param {Object} job - Download job state object reference.
   * @returns {Promise<void>} Resolves when download completes.
   */
  async downloadFile(downloadId, url, job) {
    const videoId = extractVideoId(url);
    if (!videoId) {
      throw new Error("Could not extract YouTube video ID for RapidAPI fallback");
    }

    let info = null;
    const maxAttempts = 10;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      info = await this.fetchMp3Info(videoId);
      if (info && info.link) {
        break;
      }
      if (info && info.status === "fail" && info.msg !== "in process") {
        throw new Error(info.msg || "RapidAPI failed to convert video");
      }
      logger.info(`RapidAPI conversion in progress for ${videoId} (attempt ${attempt}/${maxAttempts}), waiting 1.5s...`);
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    if (!info || !info.link) {
      throw new Error((info && info.msg) || "RapidAPI conversion timed out");
    }

    const targetFileName = `${downloadId}.mp3`;
    const targetFilePath = path.join(config.downloadsDir, targetFileName);

    if (!fs.existsSync(config.downloadsDir)) {
      fs.mkdirSync(config.downloadsDir, { recursive: true });
    }

    logger.info(`RapidAPI downloading audio from ${info.link} -> ${targetFilePath}`);
    await this._downloadStream(info.link, targetFilePath, job);

    job.status = "completed";
    job.progress = 100;
    job.filename = targetFileName;
    job.filePath = targetFilePath;
    job.updatedAt = Date.now();
  }

  /**
   * Downloads stream from direct HTTP/HTTPS URL to file path with redirect handling.
   * 
   * @private
   * @param {string} fileUrl - Target media direct URL.
   * @param {string} destPath - Destination file path.
   * @param {Object} job - Job state object for progress updates.
   * @param {number} [maxRedirects=5] - Maximum redirect limit.
   * @returns {Promise<void>}
   */
  _downloadStream(fileUrl, destPath, job, maxRedirects = 5) {
    return new Promise((resolve, reject) => {
      if (maxRedirects <= 0) {
        return reject(new Error("Too many redirects during RapidAPI file download"));
      }

      const parsedUrl = new URL(fileUrl);
      const httpModule = parsedUrl.protocol === "https:" ? https : http;

      const req = httpModule.get(fileUrl, (resp) => {
        // Handle HTTP redirects (301, 302, 307, 308)
        if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
          const redirectUrl = new URL(resp.headers.location, fileUrl).href;
          return this._downloadStream(redirectUrl, destPath, job, maxRedirects - 1)
            .then(resolve)
            .catch(reject);
        }

        if (resp.statusCode !== 200) {
          return reject(new Error(`Direct stream returned HTTP status ${resp.statusCode}`));
        }

        const totalBytes = parseInt(resp.headers["content-length"] || "0", 10);
        let downloadedBytes = 0;
        const fileStream = fs.createWriteStream(destPath);

        resp.on("data", (chunk) => {
          downloadedBytes += chunk.length;
          fileStream.write(chunk);
          if (totalBytes > 0 && job) {
            job.progress = Math.round((downloadedBytes / totalBytes) * 100);
            job.updatedAt = Date.now();
          }
        });

        resp.on("end", () => {
          fileStream.end();
        });

        fileStream.on("finish", () => {
          resolve();
        });

        fileStream.on("error", (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });

        resp.on("error", (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      });

      req.on("error", (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    });
  }
}

module.exports = new RapidApiService();
