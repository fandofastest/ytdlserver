const rateLimit = require("express-rate-limit");
const config = require("../config/app.config");
const statsService = require("../services/stats.service");

/**
 * Global API rate limiter middleware with IP Whitelist bypass.
 * Prevents DDoS and abuse on Express endpoints.
 */
const apiRateLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs, // 15 minutes window
  max: config.rateLimitMaxRequests, // Max 100 requests per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const clientIp = req.ip || (req.socket ? req.socket.remoteAddress : "") || "";
    return statsService.isIpWhitelisted(clientIp);
  },
  message: {
    success: false,
    message: "Too many requests from this IP, please try again later.",
    code: "TOO_MANY_REQUESTS"
  }
});

module.exports = {
  apiRateLimiter
};
