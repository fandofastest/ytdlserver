/**
 * PM2 Ecosystem Configuration File
 * Configured for deployment on shared hosting / Linux / Whatbox environment.
 * Reads environment settings dynamically from .env file.
 */
module.exports = {
  apps: [
    {
      name: "ytdlp-api",
      script: "./server.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production"
      },
      env_development: {
        NODE_ENV: "development"
      },
      error_file: "./src/logs/pm2-error.log",
      out_file: "./src/logs/pm2-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z"
    }
  ]
};
