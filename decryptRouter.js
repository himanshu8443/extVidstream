const express = require("express");
const { safeDecryptAndLog } = require("./decryptionUtils");

const router = express.Router();

router.post("/decrypt", async (req, res) => {
  const contents = req?.body;
  const passphrase = req?.query?.passphrase;

  if (!contents || !passphrase) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  console.log("Decryption request received with passphrase:", passphrase);
  console.log("Contents:", contents);

  // Decrypt the content
  const decryptionResult = safeDecryptAndLog(contents, passphrase);

  if (!decryptionResult.success) {
    return res.status(400).json({ error: decryptionResult.error });
  }

  try {
    // Return the decrypted data
    function extractVideoDetailsUsingRegex(configString) {
      // Regex to match the video URL in the sources array
      const videoUrlRegex = /"file":"(https?:\/\/[^\s"]+\.m3u8[^"]*)"/;
      const videoUrlMatch = configString.match(videoUrlRegex);
      const videoUrl = videoUrlMatch ? videoUrlMatch[1] : null;

      // Regex to match all subtitle URLs and their labels
      const subtitleRegex =
        /"file":"(https?:\/\/[^\s"]+\.srt)","label":"([^"]*)"/g;
      let subtitles = [];
      let subtitleMatch;

      // Loop to find all subtitles in the config string
      while ((subtitleMatch = subtitleRegex.exec(configString)) !== null) {
        subtitles.push({
          file: subtitleMatch[1],
          label: subtitleMatch[2] || "Unknown",
        });
      }

      // Return the extracted video URL and subtitles as JSON
      return {
        videoUrl: videoUrl,
        subtitles: subtitles,
      };
    }

    const videoDetails = extractVideoDetailsUsingRegex(
      decryptionResult.decrypted
    );

    res.json(videoDetails);
  } catch (error) {
    console.error("Error processing request:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
