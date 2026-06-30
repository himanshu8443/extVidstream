const express = require("express");
const crypto = require("crypto");
const https = require("https");

const router = express.Router();

const SECRET_B64 = "76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O";
const BASE_URL = "https://api4.aoneroom.com";
const AUTH =
  "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOjI2MDU1NDM3NjM5MzQxNzE5MjgsImV4cCI6MTc4NzY1NDY5MywiaWF0IjoxNzc5ODc4MzkzfQ.dUX9F_JSed-CiWANFqpCfmNNb3BQyQ1NqpfYzpLxvMI";

function signRequest(method, url, bodyStr) {
  const u = new URL(url);
  const m = method.toUpperCase();
  const rawQuery = u.search.slice(1);
  let signedPath = u.pathname;

  if (m === "GET" && rawQuery) {
    signedPath +=
      "?" +
      rawQuery
        .split("&")
        .map((p) => {
          const i = p.indexOf("=");
          const k = i < 0 ? p : p.slice(0, i);
          const v = i < 0 ? "" : p.slice(i + 1);
          return [decodeURIComponent(k), decodeURIComponent(v)];
        })
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => k + "=" + v)
        .join("&");
  }

  let bodyMd5 = "",
    contentLength = "";
  if (bodyStr && bodyStr.length > 0) {
    bodyMd5 = crypto.createHash("md5").update(bodyStr, "utf8").digest("hex");
    contentLength = String(Buffer.byteLength(bodyStr, "utf8"));
  }

  const toSign = [
    m,
    "*/*",
    bodyStr ? "application/json; charset=utf-8" : "",
    contentLength,
    String(Date.now()),
    bodyMd5,
    signedPath,
  ].join("\n");

  const hmac = crypto
    .createHmac("md5", Buffer.from(SECRET_B64, "base64"))
    .update(toSign, "utf8")
    .digest("base64");
  return Date.now() + "|2|" + hmac;
}

router.all("/moviebox", (req, res) => {
  const reqUrl = new URL(req.originalUrl || req.url, "http://localhost");
  let path = reqUrl.searchParams.get("url");
  if (!path) {
    return res.status(400).json({ error: "?url= is required" });
  }

  const method = reqUrl.searchParams.get("method") || req.method || "GET";
  const auth = reqUrl.searchParams.get("auth") || AUTH;

  const controlParams = ["url", "method", "auth", "body"];
  const extraParams = [];
  for (const [key, value] of reqUrl.searchParams.entries()) {
    if (!controlParams.includes(key)) {
      extraParams.push(`${key}=${value}`);
    }
  }
  if (extraParams.length > 0) {
    const separator = path.includes("?") ? "&" : "?";
    path += separator + extraParams.join("&");
  }

  const fullUrl = path.startsWith("http") ? path : BASE_URL + path;

  let finalBody = null;
  if (req.body) {
    if (typeof req.body === "string" && req.body.length > 0) {
      finalBody = req.body;
    } else if (
      typeof req.body === "object" &&
      Object.keys(req.body).length > 0
    ) {
      finalBody = JSON.stringify(req.body);
    }
  }

  if (!finalBody) {
    finalBody = reqUrl.searchParams.get("body") || null;
  }

  const targetUrl = new URL(fullUrl);
  const headers = {
    Accept: "*/*",
    Authorization: auth,
    "User-Agent":
      "com.community.oneroom/50020067 (Linux; U; Android 16; en_US; 23122PCD1I; Build/BP2A.250605.031.A3; Cronet/148.0.7778.60)",
    "x-tr-signature": signRequest(method, fullUrl, finalBody),
    "X-Client-Status": "1",
    "X-Play-Mode": "1",
  };

  if (finalBody) {
    headers["Content-Type"] = "application/json; charset=utf-8";
    headers["Content-Length"] = Buffer.byteLength(finalBody, "utf8");
  }

  const options = {
    method: method,
    headers: headers,
  };

  const proxyReq = https.request(targetUrl, options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on("error", (err) => {
    res.status(502).json({ error: "Upstream error: " + err.message });
  });

  if (finalBody) {
    proxyReq.write(finalBody);
  }
  proxyReq.end();
});

module.exports = router;
