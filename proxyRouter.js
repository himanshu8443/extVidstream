const express = require("express");
const crypto = require("crypto");
const https = require("https");

const router = express.Router();

const SECRET_B64 = "76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O";
const BASE_URL = "https://api4.aoneroom.com";
const RESOURCE_BASE_URL = "https://apig.inmoviebox.com";
const MAX_UPSTREAM_RETRIES = 3;
const AUTH =
  "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOjI2MDU1NDM3NjM5MzQxNzE5MjgsImV4cCI6MTc4NzY1NDY5MywiaWF0IjoxNzc5ODc4MzkzfQ.dUX9F_JSed-CiWANFqpCfmNNb3BQyQ1NqpfYzpLxvMI";

const CLIENT_INFO = JSON.stringify({
  package_name: "com.community.oneroom",
  version_name: "3.0.09.1014.03",
  version_code: 50020067,
  os: "android",
  os_version: "16",
  install_ch: "google-play",
  device_id: "5e72bed52c12ba1e3488ec4e7f82b787",
  install_store: "gp",
  gaid: "abeed222-6ff2-4a24-8af2-5deeb431e0cf",
  brand: "POCO",
  model: "23122PCD1I",
  system_language: "en",
  net: "NETWORK_WIFI",
  region: "US",
  timezone: "Asia/Calcutta",
  sp_code: "405858",
  "X-Play-Mode": "1",
  "X-Family-Mode": "0",
});

function getBaseUrl(path) {
  return path.startsWith("/wefeed-mobile-bff/subject-api/resource")
    ? RESOURCE_BASE_URL
    : BASE_URL;
}

function getTargetPath(reqUrl, directPath) {
  const configuredUrl = reqUrl.searchParams.get("url");
  if (!configuredUrl) {
    return directPath + reqUrl.search;
  }

  const targetUrl = new URL(configuredUrl, "http://local-target");
  for (const [key, value] of reqUrl.searchParams) {
    if (!["url", "method", "auth", "body"].includes(key)) {
      targetUrl.searchParams.append(key, value);
    }
  }

  return configuredUrl.startsWith("http")
    ? targetUrl.href
    : targetUrl.pathname + targetUrl.search;
}

function signRequest(method, url, bodyStr) {
  const u = new URL(url);
  const m = method.toUpperCase();
  const timestampMs = Date.now();
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
    String(timestampMs),
    bodyMd5,
    signedPath,
  ].join("\n");

  const hmac = crypto
    .createHmac("md5", Buffer.from(SECRET_B64, "base64"))
    .update(toSign, "utf8")
    .digest("base64");
  return timestampMs + "|2|" + hmac;
}

function createHeaders(method, fullUrl, body, auth) {
  const headers = {
    Accept: "*/*",
    Authorization: auth,
    "User-Agent":
      "com.community.oneroom/50020067 (Linux; U; Android 16; en_US; 23122PCD1I; Build/BP2A.250605.031.A3; Cronet/148.0.7778.60)",
    "X-Client-Info": CLIENT_INFO,
    "x-tr-signature": signRequest(method, fullUrl, body),
    "X-Client-Status": "1",
    "X-Play-Mode": "1",
    "X-Family-Mode": "0",
  };

  if (body) {
    headers["Content-Type"] = "application/json; charset=utf-8";
    headers["Content-Length"] = Buffer.byteLength(body, "utf8");
  }
  return headers;
}

function requestUpstream(
  fullUrl,
  method,
  body,
  auth,
  callback,
  retryCount = 0,
) {
  const proxyReq = https.request(
    new URL(fullUrl),
    { method, headers: createHeaders(method, fullUrl, body, auth) },
    (proxyRes) => {
      const chunks = [];
      proxyRes.on("data", (chunk) => chunks.push(chunk));
      proxyRes.on("end", () => {
        if (proxyRes.statusCode >= 500 && retryCount < MAX_UPSTREAM_RETRIES) {
          requestUpstream(
            fullUrl,
            method,
            body,
            auth,
            callback,
            retryCount + 1,
          );
          return;
        }
        callback(null, proxyRes, Buffer.concat(chunks));
      });
      proxyRes.on("error", (error) => {
        if (retryCount < MAX_UPSTREAM_RETRIES) {
          requestUpstream(
            fullUrl,
            method,
            body,
            auth,
            callback,
            retryCount + 1,
          );
          return;
        }
        callback(error);
      });
    },
  );

  proxyReq.on("error", (error) => {
    if (retryCount < MAX_UPSTREAM_RETRIES) {
      requestUpstream(fullUrl, method, body, auth, callback, retryCount + 1);
      return;
    }
    callback(error);
  });
  if (body) {
    proxyReq.write(body);
  }
  proxyReq.end();
}

function buildResourceFallback(detail, resourceUrl) {
  const detectors = Array.isArray(detail.resourceDetectors)
    ? detail.resourceDetectors
    : detail.resourceDetectors
      ? [detail.resourceDetectors]
      : [];
  let list = detectors.flatMap((detector) => detector.resolutionList || []);
  const resolution = Number(resourceUrl.searchParams.get("resolution"));
  if (resolution > 0) {
    list = list.filter((resource) => resource.resolution === resolution);
  }

  const page = resourceUrl.searchParams.get("page") || "1";
  const perPage = Number(resourceUrl.searchParams.get("perPage")) || 20;
  return {
    code: 0,
    message: "ok",
    data: {
      pager: {
        hasMore: false,
        nextPage: String(Number(page) + 1),
        page,
        perPage,
        totalCount: list.length,
      },
      list,
    },
  };
}

function sendResponse(res, statusCode, headers, body) {
  const responseHeaders = { ...headers };
  delete responseHeaders["content-length"];
  delete responseHeaders["content-encoding"];
  responseHeaders["access-control-allow-origin"] = "*";
  res.writeHead(statusCode, responseHeaders);
  res.end(body);
}

function handleResourceFallback(res, fullUrl, auth, upstreamRes, upstreamBody) {
  let resourceResponse;
  try {
    resourceResponse = JSON.parse(upstreamBody.toString("utf8"));
  } catch {
    sendResponse(
      res,
      upstreamRes.statusCode,
      upstreamRes.headers,
      upstreamBody,
    );
    return;
  }

  const resourceUrl = new URL(fullUrl);
  if (resourceResponse.code !== 406) {
    sendResponse(
      res,
      upstreamRes.statusCode,
      upstreamRes.headers,
      upstreamBody,
    );
    return;
  }

  const subjectId = resourceUrl.searchParams.get("subjectId");
  const detailUrl = `${BASE_URL}/wefeed-mobile-bff/subject-api/get?subjectId=${encodeURIComponent(subjectId || "")}`;
  requestUpstream(
    detailUrl,
    "GET",
    null,
    auth,
    (error, detailRes, detailBody) => {
      if (error) {
        res.status(502).json({ error: error.message });
        return;
      }

      try {
        const detailResponse = JSON.parse(detailBody.toString("utf8"));
        const fallback = buildResourceFallback(
          detailResponse.data || {},
          resourceUrl,
        );
        const hasResources = fallback.data.list.length > 0;
        sendResponse(
          res,
          hasResources ? 200 : upstreamRes.statusCode,
          { "content-type": "application/json" },
          JSON.stringify(hasResources ? fallback : resourceResponse),
        );
      } catch {
        sendResponse(res, detailRes.statusCode, detailRes.headers, detailBody);
      }
    },
  );
}

function getRequestBody(req, reqUrl) {
  if (typeof req.body === "string" && req.body.length > 0) {
    return req.body;
  }
  if (
    req.body &&
    typeof req.body === "object" &&
    Object.keys(req.body).length
  ) {
    return JSON.stringify(req.body);
  }
  return reqUrl.searchParams.get("body") || null;
}

function handleMovieBoxProxy(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  const reqUrl = new URL(req.originalUrl || req.url, "http://localhost");
  const directPath = req.path.slice("/moviebox".length) || "";
  const path = getTargetPath(reqUrl, directPath);
  if (!path) {
    return res
      .status(400)
      .json({ error: "A target path or ?url= is required" });
  }

  const method = (
    reqUrl.searchParams.get("method") ||
    req.method ||
    "GET"
  ).toUpperCase();
  const auth = reqUrl.searchParams.get("auth") || AUTH;
  const fullUrl = path.startsWith("http") ? path : getBaseUrl(path) + path;
  const body = getRequestBody(req, reqUrl);

  requestUpstream(
    fullUrl,
    method,
    body,
    auth,
    (error, proxyRes, upstreamBody) => {
      if (error) {
        res.status(502).json({ error: "Upstream error: " + error.message });
        return;
      }

      if (
        new URL(fullUrl).pathname === "/wefeed-mobile-bff/subject-api/resource"
      ) {
        handleResourceFallback(res, fullUrl, auth, proxyRes, upstreamBody);
        return;
      }
      sendResponse(res, proxyRes.statusCode, proxyRes.headers, upstreamBody);
    },
  );
}

router.all("/moviebox", handleMovieBoxProxy);
router.all("/moviebox/*", handleMovieBoxProxy);

module.exports = router;
