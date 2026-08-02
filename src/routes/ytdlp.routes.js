const express = require("express");
const ytdlpController = require("../controllers/ytdlp.controller");
const { validateAnalyzeRequest, validateDownloadRequest } = require("../middleware/validator.middleware");

const router = express.Router();

// POST /api/analyze - Extract metadata
router.post("/analyze", validateAnalyzeRequest, ytdlpController.analyze);

// POST /api/download - Request video/audio download
router.post("/download", validateDownloadRequest, ytdlpController.download);

// GET /api/status/:id - Check download progress
router.get("/status/:id", ytdlpController.getStatus);

// GET /api/file/:id - Serve completed downloaded file
router.get("/file/:id", ytdlpController.getFile);

module.exports = router;
