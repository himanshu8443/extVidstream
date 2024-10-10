const express = require("express");
const { safeDecryptAndLog } = require("./decryptionUtils");

const router = express.Router();

router.get("/decrypt", async (req, res) => {
  const { url, passphrase } = req.query;

  if (!url || !passphrase) {
    return res.status(400).json({ error: "URL and passphrase are required" });
  }

  try {
    // Fetch the content from the provided URL
    const response = await fetch(url, {
      credentials: "omit",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:101.0) Gecko/20100101 Firefox/101.0",
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.5",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "cross-site",
        Pragma: "no-cache",
        "Cache-Control": "no-cache",
      },
      referrer: "https://vidstreaming.xyz/",
      method: "GET",
      mode: "cors",
    });
    const data = await response.text();

    // Extract the encrypted content
    const contents =
      data.match(/const\s+Contents\s*=\s*['"]({.*})['"]/)?.[1] || "";

    if (!contents) {
      return res.status(404).json({ error: "Encrypted content not found" });
    }

    // Decrypt the content
    const decryptionResult = safeDecryptAndLog(contents, passphrase);

    if (!decryptionResult.success) {
      return res.status(400).json({ error: decryptionResult.error });
    }

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
