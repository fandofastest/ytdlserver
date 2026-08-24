const express = require("express");
const adminController = require("../controllers/admin.controller");
const { verifyAdminPassword } = require("../middleware/adminAuth.middleware");

const router = express.Router();

// GET /admin - Serve Admin Dashboard UI
router.get("/admin", adminController.getDashboardPage);

// POST /api/admin/login - Verify admin password
router.post("/api/admin/login", adminController.login);

// Protected Admin API Endpoints (Require X-Admin-Password header or password query/body)
router.get("/api/admin/stats", verifyAdminPassword, adminController.getStats);
router.post("/api/admin/reset", verifyAdminPassword, adminController.resetStats);
router.get("/api/admin/whitelist", verifyAdminPassword, adminController.getWhitelist);
router.post("/api/admin/whitelist/add", verifyAdminPassword, adminController.addWhitelist);
router.post("/api/admin/whitelist/remove", verifyAdminPassword, adminController.removeWhitelist);

// Cookie Management Routes
router.get("/api/admin/cookies", verifyAdminPassword, adminController.getCookies);
router.post("/api/admin/cookies/add", verifyAdminPassword, adminController.addCookie);
router.post("/api/admin/cookies/delete", verifyAdminPassword, adminController.deleteCookie);

// Proxy Management Routes
router.get("/api/admin/proxy", verifyAdminPassword, adminController.getProxy);
router.post("/api/admin/proxy", verifyAdminPassword, adminController.updateProxy);

module.exports = router;
