const express = require("express");
const healthRoutes = require("./health.routes");
const ytdlpRoutes = require("./ytdlp.routes");

const router = express.Router();

// Mount health route at root level
router.use("/", healthRoutes);

// Mount main API routes under /api
router.use("/api", ytdlpRoutes);

module.exports = router;
