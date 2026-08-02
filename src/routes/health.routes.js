const express = require("express");
const healthController = require("../controllers/health.controller");

const router = express.Router();

// GET /health
router.get("/health", healthController.getHealth);

module.exports = router;
