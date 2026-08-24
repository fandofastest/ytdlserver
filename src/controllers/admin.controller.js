const path = require("path");
const statsService = require("../services/stats.service");
const logger = require("../utils/logger.util");

/**
 * Admin controller for managing system statistics and dashboard.
 */
async function getStats(req, res, next) {
  try {
    const data = statsService.getStats();
    return res.status(200).json({
      success: true,
      data: data
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller to reset statistics counters.
 */
async function resetStats(req, res, next) {
  try {
    const cleanStats = statsService.resetStats();
    logger.info("Admin statistics reset by user request");
    return res.status(200).json({
      success: true,
      message: "Statistics reset successfully",
      data: cleanStats
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller to fetch whitelisted IPs and client IP.
 */
async function getWhitelist(req, res, next) {
  try {
    const clientIp = req.ip || (req.socket ? req.socket.remoteAddress : "") || "";
    const list = statsService.getWhitelistIps();
    return res.status(200).json({
      success: true,
      clientIp: clientIp,
      whitelist: list
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller to add IP to whitelist.
 */
async function addWhitelist(req, res, next) {
  try {
    const clientIp = req.ip || (req.socket ? req.socket.remoteAddress : "") || "";
    const targetIp = req.body && req.body.ip ? req.body.ip : clientIp;
    const updatedList = statsService.addWhitelistIp(targetIp);
    return res.status(200).json({
      success: true,
      message: `IP '${targetIp}' added to whitelist`,
      clientIp: clientIp,
      whitelist: updatedList
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller to remove IP from whitelist.
 */
async function removeWhitelist(req, res, next) {
  try {
    const clientIp = req.ip || (req.socket ? req.socket.remoteAddress : "") || "";
    const targetIp = req.body && req.body.ip ? req.body.ip : "";
    if (!targetIp) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameter: ip"
      });
    }
    const updatedList = statsService.removeWhitelistIp(targetIp);
    return res.status(200).json({
      success: true,
      message: `IP '${targetIp}' removed from whitelist`,
      clientIp: clientIp,
      whitelist: updatedList
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller to verify Admin Password.
 */
async function login(req, res, next) {
  try {
    const config = require("../config/app.config");
    const { password } = req.body || {};
    if (password === config.adminPassword) {
      return res.status(200).json({
        success: true,
        message: "Admin authentication successful"
      });
    }
    return res.status(401).json({
      success: false,
      message: "Incorrect Admin Password"
    });
  } catch (err) {
    next(err);
  }
}

const fs = require("fs");
const os = require("os");
const config = require("../config/app.config");

/**
 * Helper to update a key in the .env file.
 */
function updateEnvKey(key, value) {
  try {
    const envPath = path.join(__dirname, "..", "..", ".env");
    let content = "";
    if (fs.existsSync(envPath)) {
      content = fs.readFileSync(envPath, "utf8");
    }
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      content += `\n${key}=${value}\n`;
    }
    fs.writeFileSync(envPath, content, "utf8");
  } catch (err) {
    logger.warn(`Could not write to .env file: ${err.message}`);
  }
}

/**
 * Helper to get list of cookie files.
 */
function listCookieFiles() {
  const dirCandidates = [
    config.cookiesPath ? path.dirname(config.cookiesPath) : null,
    "/home/fandofast",
    os.homedir()
  ].filter(Boolean);

  const foundMap = new Map();

  for (let i = 1; i <= 10; i++) {
    const filename = i === 1 ? "cookies.txt" : `cookies${i}.txt`;
    for (const dir of dirCandidates) {
      const fullPath = path.join(dir, filename);
      if (fs.existsSync(fullPath) && !foundMap.has(filename)) {
        try {
          const stats = fs.statSync(fullPath);
          const content = fs.readFileSync(fullPath, "utf8");
          const lines = content.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).length;
          foundMap.set(filename, {
            filename: filename,
            path: fullPath,
            sizeBytes: stats.size,
            lineCount: lines,
            lastModified: stats.mtime
          });
        } catch (e) {
          // ignore read error
        }
      }
    }
  }

  return Array.from(foundMap.values());
}

/**
 * Controller to fetch all active cookie files.
 */
async function getCookies(req, res, next) {
  try {
    const cookies = listCookieFiles();
    return res.status(200).json({
      success: true,
      cookies: cookies
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller to upload / add a new cookie file.
 */
async function addCookie(req, res, next) {
  try {
    const { content, filename } = req.body || {};
    if (!content || typeof content !== "string" || !content.trim()) {
      return res.status(400).json({
        success: false,
        error: "Missing or empty cookie content"
      });
    }

    let targetName = filename ? path.basename(filename) : null;
    if (!targetName || !/^cookies\d*\.txt$/i.test(targetName)) {
      // Auto-pick next available cookie filename
      const existing = listCookieFiles().map((c) => c.filename);
      for (let i = 1; i <= 10; i++) {
        const candidate = i === 1 ? "cookies.txt" : `cookies${i}.txt`;
        if (!existing.includes(candidate)) {
          targetName = candidate;
          break;
        }
      }
      if (!targetName) targetName = "cookies1.txt";
    }

    const saveDirs = [
      "/home/fandofast",
      config.cookiesPath ? path.dirname(config.cookiesPath) : os.homedir()
    ];

    const cleanDirs = Array.from(new Set(saveDirs)).filter((d) => fs.existsSync(d));

    for (const dir of cleanDirs) {
      const fullPath = path.join(dir, targetName);
      fs.writeFileSync(fullPath, content.trim(), "utf8");
    }

    logger.info(`Admin added/updated cookie file: ${targetName}`);

    return res.status(200).json({
      success: true,
      message: `Cookie file '${targetName}' saved successfully`,
      cookies: listCookieFiles()
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller to delete a cookie file.
 */
async function deleteCookie(req, res, next) {
  try {
    const { filename } = req.body || {};
    if (!filename) {
      return res.status(400).json({
        success: false,
        error: "Missing parameter: filename"
      });
    }

    const targetName = path.basename(filename);
    const saveDirs = [
      "/home/fandofast",
      config.cookiesPath ? path.dirname(config.cookiesPath) : os.homedir()
    ];

    const cleanDirs = Array.from(new Set(saveDirs)).filter((d) => fs.existsSync(d));
    let deletedCount = 0;

    for (const dir of cleanDirs) {
      const fullPath = path.join(dir, targetName);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        deletedCount++;
      }
    }

    logger.info(`Admin deleted cookie file: ${targetName} (${deletedCount} locations)`);

    return res.status(200).json({
      success: true,
      message: `Cookie file '${targetName}' deleted`,
      cookies: listCookieFiles()
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller to fetch current Proxy URL.
 */
async function getProxy(req, res, next) {
  try {
    return res.status(200).json({
      success: true,
      proxyUrl: config.proxyUrl || ""
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller to update Proxy URL.
 */
async function updateProxy(req, res, next) {
  try {
    const { proxyUrl } = req.body || {};
    const newProxy = typeof proxyUrl === "string" ? proxyUrl.trim() : "";

    config.proxyUrl = newProxy;
    updateEnvKey("YTDLP_PROXY", newProxy);

    logger.info(`Admin updated fallback proxy URL: '${newProxy}'`);

    return res.status(200).json({
      success: true,
      message: newProxy ? "Fallback Proxy URL updated successfully" : "Fallback Proxy disabled",
      proxyUrl: config.proxyUrl
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller to fetch system settings (Direct Redirect mode & Proxy).
 */
async function getSettings(req, res, next) {
  try {
    return res.status(200).json({
      success: true,
      directStreamRedirect: Boolean(config.directStreamRedirect),
      proxyUrl: config.proxyUrl || ""
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller to update system settings.
 */
async function updateSettings(req, res, next) {
  try {
    const { directStreamRedirect, proxyUrl } = req.body || {};

    if (typeof directStreamRedirect === "boolean") {
      config.directStreamRedirect = directStreamRedirect;
      updateEnvKey("DIRECT_STREAM_REDIRECT", String(directStreamRedirect));
    }

    if (typeof proxyUrl === "string") {
      config.proxyUrl = proxyUrl.trim();
      updateEnvKey("YTDLP_PROXY", proxyUrl.trim());
    }

    logger.info(`Admin updated settings: directStreamRedirect=${config.directStreamRedirect}, proxyUrl='${config.proxyUrl}'`);

    return res.status(200).json({
      success: true,
      message: "System settings updated successfully",
      directStreamRedirect: config.directStreamRedirect,
      proxyUrl: config.proxyUrl
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Serves the HTML admin dashboard interface.
 */
async function getDashboardPage(req, res, next) {
  try {
    const pagePath = path.join(__dirname, "..", "public", "admin", "index.html");
    return res.sendFile(pagePath);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getStats,
  resetStats,
  getWhitelist,
  addWhitelist,
  removeWhitelist,
  getCookies,
  addCookie,
  deleteCookie,
  getProxy,
  updateProxy,
  getSettings,
  updateSettings,
  getDashboardPage,
  login
};
