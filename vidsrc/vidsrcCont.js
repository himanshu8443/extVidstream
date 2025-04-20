const { fetchData } = require("./fetchUrl");
const cheerio = require("cheerio");

async function vidsrcController(req, res) {
  try {
    const { id, se } = req.params;
    const url = `https://vidsrc.me/embed/${id}/${se ? se : ""}`;
    console.log("vidsrc url:", url);

    const vidData = await fetchData(url);
    if (!vidData) {
      return res.status(500).json({ error: "Failed to fetch data" });
    }
    const $ = cheerio.load(vidData);
    const videoUrl = $("#player_iframe").attr("src");
    const iframeUrl1 = `https:${videoUrl}`;
    const iframeURl1BaseUrl = new URL(iframeUrl1);
    console.log("vidsrc iframeUrl1:", iframeUrl1);

    const iframeUrl1Data = await fetchData(iframeUrl1);
    if (!iframeUrl1Data) {
      return res.status(500).json({ error: "Failed to fetch data" });
    }
    const iframeSrcRegexPattern = /src:\s*['"]([^'"]+)['"]/;
    const match = iframeUrl1Data.match(iframeSrcRegexPattern);
    if (!match) {
      return res.status(500).json({ error: "Failed to extract video URL" });
    }
    const iframeUrl2 = iframeURl1BaseUrl.origin + match[1].replace(/\\/g, "");
    console.log("vidsrc iframeUrl2:", iframeUrl2);

    const iframeUrl2Data = await fetchData(iframeUrl2);
    if (!iframeUrl2Data) {
      return res.status(500).json({ error: "Failed to fetch data" });
    }
    const m3uRegexPattern = /file:\s*['"]([^'"]*\.m3u8[^'"]*)['"]/i;
    const m3uMatch = iframeUrl2Data.match(m3uRegexPattern);
    if (!m3uMatch) {
      return res.status(500).json({ error: "Failed to extract m3u8 URL" });
    }
    res.json({
      videoUrl: m3uMatch[1],
    });
  } catch (error) {
    console.error("Error in vidsrcController:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = { vidsrcController };
