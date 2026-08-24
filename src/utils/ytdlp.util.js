/**
 * Simplifies and formats raw yt-dlp single-json output into clean metadata schema.
 * 
 * @param {Object} rawData - Unparsed or parsed raw JSON object from yt-dlp --dump-single-json.
 * @returns {Object} Simplified video/audio metadata object.
 */
function parseAndSimplifyYtDlpJson(rawData) {
  const json = typeof rawData === "string" ? JSON.parse(rawData) : rawData;

  // Extract best thumbnail URL
  let thumbnail = json.thumbnail || "";
  if (!thumbnail && Array.isArray(json.thumbnails) && json.thumbnails.length > 0) {
    thumbnail = json.thumbnails[json.thumbnails.length - 1].url || "";
  }

  // Parse and simplify format options
  const rawFormats = Array.isArray(json.formats) ? json.formats : [];
  const formats = rawFormats.map((fmt) => {
    // Determine video presence (vcodec exists and is not 'none')
    const hasVideo = Boolean(fmt.vcodec && fmt.vcodec !== "none");
    // Determine audio presence (acodec exists and is not 'none')
    const hasAudio = Boolean(fmt.acodec && fmt.acodec !== "none");

    // Quality determination logic
    let quality = fmt.format_note || fmt.resolution;
    if (!quality) {
      if (fmt.height) {
        quality = `${fmt.height}p`;
      } else if (hasAudio && !hasVideo) {
        quality = fmt.abr ? `${Math.round(fmt.abr)}kbps` : "audio only";
      } else {
        quality = "unknown";
      }
    }

    return {
      id: String(fmt.format_id || ""),
      itag: parseInt(fmt.format_id, 10) || null,
      ext: fmt.ext || "",
      url: fmt.url || "",
      quality: String(quality),
      fps: typeof fmt.fps === "number" ? fmt.fps : null,
      filesize: fmt.filesize || fmt.filesize_approx || null,
      video: hasVideo,
      audio: hasAudio
    };
  });

  return {
    title: json.title || "",
    thumbnail: thumbnail,
    duration: typeof json.duration === "number" ? json.duration : 0,
    uploader: json.uploader || json.channel || json.uploader_id || "",
    view_count: typeof json.view_count === "number" ? json.view_count : 0,
    upload_date: json.upload_date || "",
    webpage_url: json.webpage_url || json.original_url || "",
    formats: formats
  };
}

module.exports = {
  parseAndSimplifyYtDlpJson
};
