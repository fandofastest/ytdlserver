/**
 * Validates if the string is a valid HTTP or HTTPS URL.
 * Sanitizes against command injection inputs.
 * 
 * @param {string} urlString - Input URL.
 * @returns {boolean} True if valid HTTP/HTTPS URL, false otherwise.
 */
function isValidUrl(urlString) {
  if (!urlString || typeof urlString !== "string") {
    return false;
  }

  const trimmed = urlString.trim();

  // Basic sanity check on length and malicious control characters
  if (trimmed.length > 2048 || /[\r\n\0]/g.test(trimmed)) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (err) {
    return false;
  }
}

/**
 * Validates download format specifier (e.g. "137", "137+140", "bestvideo+bestaudio/best", "mp4").
 * Allows alphanumeric, plus, slash, dash, underscore, and dot characters.
 * 
 * @param {string} formatString - Input format parameter.
 * @returns {boolean} True if valid, false otherwise.
 */
function isValidFormat(formatString) {
  if (!formatString || typeof formatString !== "string") {
    return false;
  }

  const trimmed = formatString.trim();
  if (trimmed.length > 100) return false;

  // Pattern allowing valid yt-dlp format selectors like "137+140", "bestvideo", "b[ext=mp4]"
  const formatRegex = /^[a-zA-Z0-9_\-+/.[\]=]+$/;
  return formatRegex.test(trimmed);
}

module.exports = {
  isValidUrl,
  isValidFormat
};
