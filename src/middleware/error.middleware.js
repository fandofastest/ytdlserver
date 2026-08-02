const logger = require("../utils/logger.util");

/**
 * Global Express error handling middleware.
 * Ensures consistent JSON error responses across all API failures.
 * 
 * @param {Error} err - Error object thrown or passed to next().
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware callback.
 */
function errorHandler(err, req, res, next) {
  logger.error(`Unhandled request error at ${req.method} ${req.originalUrl}`, err);

  const statusCode = err.statusCode || err.status || 500;
  const errorCode = err.code || (statusCode === 404 ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR");
  const message = err.message || "An unexpected error occurred on the server.";

  res.status(statusCode).json({
    success: false,
    message: message,
    code: errorCode
  });
}

/**
 * Catch-all middleware for handling 404 Not Found endpoints.
 */
function notFoundHandler(req, res, next) {
  res.status(404).json({
    success: false,
    message: `Endpoint not found: ${req.method} ${req.originalUrl}`,
    code: "NOT_FOUND"
  });
}

module.exports = {
  errorHandler,
  notFoundHandler
};
