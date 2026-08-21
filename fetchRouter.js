const express = require("express");

const router = express.Router();

const FORBIDDEN_HEADER_KEYS = new Set([
  "host",
  "connection",
  "content-length",
]);

function parseTargetUrl(req) {
  let targetUrl = req.body?.url || req.query?.url;
  if (!targetUrl && typeof req.body === "string") {
    try {
      const parsedBody = JSON.parse(req.body);
      targetUrl = parsedBody?.url;
    } catch {}
  }

  if (!targetUrl || typeof targetUrl !== "string") {
    throw new Error("Missing required field: url");
  }

  const trimmedUrl = targetUrl.trim();
  let parsed;
  try {
    parsed = new URL(trimmedUrl);
  } catch {
    throw new Error("Invalid URL format");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("URL must use HTTP or HTTPS protocol");
  }

  return trimmedUrl;
}

function parseHeaders(req) {
  let rawHeaders = req.body?.headers || req.query?.headers;
  if (!rawHeaders && typeof req.body === "string") {
    try {
      const parsedBody = JSON.parse(req.body);
      rawHeaders = parsedBody?.headers;
    } catch {}
  }

  if (!rawHeaders) {
    return {};
  }

  let parsedHeaders = rawHeaders;
  if (typeof rawHeaders === "string") {
    try {
      parsedHeaders = JSON.parse(rawHeaders);
    } catch {
      throw new Error("headers must be a valid JSON object or string");
    }
  }

  if (typeof parsedHeaders !== "object" || Array.isArray(parsedHeaders)) {
    throw new Error("headers must be a key-value object");
  }

  const sanitizedHeaders = {};
  for (const [key, value] of Object.entries(parsedHeaders)) {
    if (!FORBIDDEN_HEADER_KEYS.has(key.toLowerCase()) && value !== undefined && value !== null) {
      sanitizedHeaders[key] = String(value);
    }
  }

  return sanitizedHeaders;
}

function extractRequestBody(req) {
  if (req.body?.body !== undefined) return req.body.body;
  if (req.body?.data !== undefined) return req.body.data;
  return null;
}

function buildFetchOptions(req, headers) {
  const method = (
    req.body?.method ||
    req.query?.method ||
    (extractRequestBody(req) ? "POST" : "GET")
  ).toUpperCase();

  const options = {
    method,
    headers,
    redirect: "follow",
  };

  if (!["GET", "HEAD"].includes(method)) {
    const rawBody = extractRequestBody(req);
    if (rawBody !== null) {
      if (typeof rawBody === "object") {
        options.body = JSON.stringify(rawBody);
        if (!headers["content-type"] && !headers["Content-Type"]) {
          options.headers["Content-Type"] = "application/json";
        }
      } else {
        options.body = String(rawBody);
      }
    }
  }

  return options;
}

function copyResponseHeaders(res, upstreamResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD");
  res.setHeader("Access-Control-Allow-Headers", "*");

  upstreamResponse.headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    if (!["content-length", "content-encoding", "access-control-allow-origin"].includes(lowerKey)) {
      res.setHeader(key, value);
    }
  });
}

async function forwardDetailsResponse(res, upstreamResponse) {
  const contentType = upstreamResponse.headers.get("content-type") || "";
  let data;

  if (contentType.includes("application/json")) {
    try {
      data = await upstreamResponse.json();
    } catch {
      data = await upstreamResponse.text();
    }
  } else {
    data = await upstreamResponse.text();
  }

  const headers = {};
  upstreamResponse.headers.forEach((value, key) => {
    headers[key] = value;
  });

  res.status(upstreamResponse.status).json({
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers,
    data,
  });
}

async function forwardStreamResponse(res, upstreamResponse) {
  copyResponseHeaders(res, upstreamResponse);
  res.status(upstreamResponse.status);

  const arrayBuffer = await upstreamResponse.arrayBuffer();
  res.end(Buffer.from(arrayBuffer));
}

async function handleFetch(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD");
    res.setHeader("Access-Control-Allow-Headers", "*");
    return res.sendStatus(204);
  }

  let targetUrl;
  let headers;

  try {
    targetUrl = parseTargetUrl(req);
    headers = parseHeaders(req);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  try {
    const fetchOptions = buildFetchOptions(req, headers);
    const upstreamResponse = await fetch(targetUrl, fetchOptions);

    const wantsDetails =
      req.query?.details === "true" ||
      req.body?.responseType === "details";

    if (wantsDetails) {
      await forwardDetailsResponse(res, upstreamResponse);
    } else {
      await forwardStreamResponse(res, upstreamResponse);
    }
  } catch (error) {
    res.status(502).json({
      error: `Failed to fetch target URL: ${error.message}`,
    });
  }
}

router.all("/fetch", handleFetch);
router.all("/fetch/*", handleFetch);

module.exports = router;
