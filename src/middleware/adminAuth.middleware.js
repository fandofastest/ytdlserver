const config = require("../config/app.config");

/**
 * Middleware to verify Admin Password for protected admin APIs.
 */
function verifyAdminPassword(req, res, next) {
  const providedPassword =
    req.headers["x-admin-password"] ||
    req.query.password ||
    (req.body && req.body.password);

  if (!config.adminPassword) {
    return next(); // Password protection disabled if empty
  }

  if (providedPassword === config.adminPassword) {
    return next();
  }

  return res.status(401).json({
    success: false,
    message: "Unauthorized: Invalid or missing Admin Password",
    code: "UNAUTHORIZED"
  });
}

module.exports = {
  verifyAdminPassword
};
