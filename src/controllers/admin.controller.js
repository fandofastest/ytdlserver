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
  getDashboardPage
};
