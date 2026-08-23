const express = require("express");
const adminController = require("../controllers/admin.controller");

const router = express.Router();

// GET /admin - Serve Admin Dashboard UI
router.get("/admin", adminController.getDashboardPage);

// GET /api/admin/stats - Statistics JSON API
router.get("/api/admin/stats", adminController.getStats);

// POST /api/admin/reset - Reset statistics API
router.post("/api/admin/reset", adminController.resetStats);

module.exports = router;
