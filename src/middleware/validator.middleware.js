const { isValidUrl, isValidFormat } = require("../utils/validator.util");

/**
 * Middleware to validate request payload for POST /api/analyze.
 */
function validateAnalyzeRequest(req, res, next) {
  const { url } = req.body || {};

  if (!url) {
    return res.status(400).json({
      success: false,
      message: "Missing 'url' field in request body",
      code: "INVALID_INPUT"
    });
  }

  if (!isValidUrl(url)) {
    return res.status(400).json({
      success: false,
      message: "Invalid or unsupported URL provided",
      code: "INVALID_URL"
    });
  }

  next();
}

/**
 * Middleware to validate request payload for POST /api/download.
 */
function validateDownloadRequest(req, res, next) {
  const { url, format } = req.body || {};

  if (!url) {
    return res.status(400).json({
      success: false,
      message: "Missing 'url' field in request body",
      code: "INVALID_INPUT"
    });
  }

  if (!isValidUrl(url)) {
    return res.status(400).json({
      success: false,
      message: "Invalid or unsupported URL provided",
      code: "INVALID_URL"
    });
  }

  if (format && !isValidFormat(format)) {
    return res.status(400).json({
      success: false,
      message: "Invalid format specifier provided",
      code: "INVALID_FORMAT"
    });
  }

  next();
}

module.exports = {
  validateAnalyzeRequest,
  validateDownloadRequest
};
