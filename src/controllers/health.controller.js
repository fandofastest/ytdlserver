/**
 * Health check controller.
 * GET /health
 */
function getHealth(req, res) {
  res.status(200).json({
    success: true,
    version: "1.0.0"
  });
}

module.exports = {
  getHealth
};
