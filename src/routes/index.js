const express = require("express");
const healthRoutes = require("./health.routes");
const ytdlpRoutes = require("./ytdlp.routes");
const adminRoutes = require("./admin.routes");

const ytdlpController = require("../controllers/ytdlp.controller");

const router = express.Router();

// Mount health route at root level
router.use("/", healthRoutes);

// Mount admin routes (/admin, /api/admin/stats, /api/admin/reset)
router.use("/", adminRoutes);

// Mount direct stream route at root level /stream
router.get("/stream", ytdlpController.stream);

// Mount simple video ID direct download route at root level /dl/:id
router.get("/dl/:id", ytdlpController.downloadByVideoId);

// Mount main API routes under /api
router.use("/api", ytdlpRoutes);

module.exports = router;
