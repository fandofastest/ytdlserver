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
  getDashboardPage,
  login
};
