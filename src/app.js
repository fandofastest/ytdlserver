const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const morgan = require("morgan");
const path = require("path");
const logger = require("./utils/logger.util");
const { apiRateLimiter } = require("./middleware/rateLimiter.middleware");
const { errorHandler, notFoundHandler } = require("./middleware/error.middleware");
const routes = require("./routes");
const config = require("./config/app.config");

const app = express();

// Security Headers with Helmet
app.use(helmet());

// Cross-Origin Resource Sharing (CORS)
app.use(cors({
  origin: "*", // Enables Flutter and web access from any domain
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// Gzip payload compression
app.use(compression());

// Body Parsers
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// HTTP Request Logging with Morgan
app.use(morgan("short", { stream: logger.morganStream }));

// Rate Limiting Middleware
app.use(apiRateLimiter);

// Serve static directory if needed (downloads directory)
app.use("/public", express.static(path.join(__dirname, "public")));

// Register Master Router
app.use("/", routes);

// 404 Handler
app.use(notFoundHandler);

// Centralized JSON Error Handling Middleware
app.use(errorHandler);

module.exports = app;
