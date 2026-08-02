const crypto = require("crypto");

/**
 * Generates a SHA256 hex string hash from an input string (e.g. video URL).
 * Used for deterministic and safe cache keys.
 * 
 * @param {string} input - The string to hash.
 * @returns {string} SHA256 hex digest.
 */
function generateSha256(input) {
  if (typeof input !== "string") {
    throw new TypeError("Input to generateSha256 must be a string");
  }
  return crypto.createHash("sha256").update(input.trim()).digest("hex");
}

module.exports = {
  generateSha256
};
