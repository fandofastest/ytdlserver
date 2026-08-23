const express = require("express");
const adminController = require("../controllers/admin.controller");

const router = express.Router();

// GET /admin - Serve Admin Dashboard UI
router.get("/admin", adminController.getDashboardPage);

// GET /api/admin/stats - Statistics JSON API
router.get("/api/admin/stats", adminController.getStats);

// POST /api/admin/reset - Reset statistics API
router.post("/api/admin/reset", adminController.resetStats);

// GET /api/admin/whitelist - Get whitelisted IPs and client IP
router.get("/api/admin/whitelist", adminController.getWhitelist);

// POST /api/admin/whitelist/add - Add IP to whitelist
router.post("/api/admin/whitelist/add", adminController.addWhitelist);

// POST /api/admin/whitelist/remove - Remove IP from whitelist
router.post("/api/admin/whitelist/remove", adminController.removeWhitelist);

module.exports = router;
