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
const gatewayTimeOffsets = new Map();

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

function decodeQueryComponent(value) {
  return decodeURIComponent(value.replace(/\+/g, " "));
}

function signRequest(method, url, bodyStr, timestampMs = Date.now()) {
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
          return [decodeQueryComponent(k), decodeQueryComponent(v)];
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

function createHeaders(method, fullUrl, body, auth, timestampMs) {
  const headers = {
    Accept: "*/*",
    Authorization: auth,
    "User-Agent":
      "com.community.oneroom/50020067 (Linux; U; Android 16; en_US; 23122PCD1I; Build/BP2A.250605.031.A3; Cronet/148.0.7778.60)",
    "X-Client-Info": CLIENT_INFO,
    "x-tr-signature": signRequest(method, fullUrl, body, timestampMs),
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
  const upstreamUrl = new URL(fullUrl);
  const offsetKey = upstreamUrl.hostname;
  const timestampMs = Date.now() + (gatewayTimeOffsets.get(offsetKey) || 0);
  const proxyReq = https.request(
    upstreamUrl,
    {
      method,
      headers: createHeaders(method, fullUrl, body, auth, timestampMs),
    },
    (proxyRes) => {
      const chunks = [];
      proxyRes.on("data", (chunk) => chunks.push(chunk));
      proxyRes.on("end", () => {
        const responseBody = Buffer.concat(chunks);
        if (proxyRes.statusCode === 407) {
          try {
            const errorResponse = JSON.parse(responseBody.toString("utf8"));
            const encodedTime = errorResponse.metadata?.errorMsg;
            if (
              errorResponse.metadata?.errorCode === "GW.4410" &&
              encodedTime
            ) {
              const timeData = JSON.parse(
                Buffer.from(encodedTime, "base64").toString("utf8"),
              );
              gatewayTimeOffsets.set(offsetKey, timeData.time - Date.now());
            }
          } catch {}
        }

        const shouldRetry =
          proxyRes.statusCode === 407 ||
          proxyRes.statusCode >= 500 ||
          (proxyRes.statusCode === 406 &&
            upstreamUrl.pathname === "/wefeed-mobile-bff/subject-api/resource");
        if (shouldRetry && retryCount < MAX_UPSTREAM_RETRIES) {
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
        callback(null, proxyRes, responseBody);
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

function requestUpstreamAsync(fullUrl, method, body, auth) {
  return new Promise((resolve, reject) => {
    requestUpstream(
      fullUrl,
      method,
      body,
      auth,
      (error, response, responseBody) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ response, body: responseBody });
      },
    );
  });
}

function getDetectorResources(detector, resourceUrl) {
  if (
    Array.isArray(detector.resolutionList) &&
    detector.resolutionList.length
  ) {
    return detector.resolutionList;
  }
  if (!detector.downloadUrl) {
    return [];
  }

  const episode = Number(resourceUrl.searchParams.get("epFrom")) || 1;
  return [
    {
      episode,
      title: `Episode ${episode}`,
      resourceLink: detector.downloadUrl,
      linkType: detector.type ?? 0,
      size: detector.firstSize || detector.totalSize || "0",
      uploadBy: detector.uploadBy || "",
      resourceId: detector.resourceId || "",
      postId: detector.postId || "",
      extCaptions: detector.extCaptions || [],
      se: Number(resourceUrl.searchParams.get("se")) || 0,
      ep: episode,
      sourceUrl: detector.resourceLink || "",
      resolution: Number(resourceUrl.searchParams.get("resolution")) || null,
    },
  ];
}

function buildResourceResponse(list, resourceUrl, filterResolution = true) {
  const resolution = Number(resourceUrl.searchParams.get("resolution"));
  if (filterResolution && resolution > 0) {
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

function buildResourceFallback(detail, resourceUrl) {
  const detectors = Array.isArray(detail.resourceDetectors)
    ? detail.resourceDetectors
    : detail.resourceDetectors
      ? [detail.resourceDetectors]
      : [];
  const list = detectors.flatMap((detector) =>
    getDetectorResources(detector, resourceUrl),
  );
  return buildResourceResponse(list, resourceUrl);
}

function replaceSeriesPosition(link, season, episode, resolutionPlaceholder) {
  let result = link;

  if (/S\d+E\d+/i.test(result)) {
    result = result.replace(/S\d+E\d+/i, `S${season}E${episode}`);
  }

  if (/season[-_. ]*\d+/i.test(result)) {
    result = result.replace(/season([-_. ]*)\d+/i, `season$1${season}`);
  }
  if (/episode[-_. ]*\d+/i.test(result)) {
    result = result.replace(/episode([-_. ]*)\d+/i, `episode$1${episode}`);
  }

  const numericTuple = /([_.-])(\d+)\1(\d+)\1(\d{3,4})P/i;
  if (numericTuple.test(result)) {
    result = result.replace(
      numericTuple,
      (_, separator) =>
        `${separator}${season}${separator}${episode}${separator}` +
        `${resolutionPlaceholder}P`,
    );
  }

  return result;
}

function getSeriesLinkCandidates(link, season, episode, resolution) {
  const resolutionPlaceholder = "__RESOLUTION__";
  const positionedLink = replaceSeriesPosition(
    link,
    season,
    episode,
    resolutionPlaceholder,
  );

  const candidates = new Set();
  candidates.add(
    positionedLink.replace(`${resolutionPlaceholder}P`, `${resolution}P`),
  );
  candidates.add(positionedLink.replace(/\d{3,4}P/i, `${resolution}P`));
  candidates.add(
    positionedLink.replace(
      /-\d{3,4}P(?:-[^/?#]+)*(?=$|[?#])/i,
      `-${resolution}P`,
    ),
  );
  candidates.add(positionedLink);
  candidates.add(link);
  for (const candidate of [...candidates]) {
    const resolutionChain = candidate.match(
      /(-r\d{3,4}P(?:-\d+)?)(?:-r\d{3,4}P(?:-\d+)?)+(?=$|[?#])/i,
    );
    if (resolutionChain) {
      candidates.add(candidate.replace(resolutionChain[0], resolutionChain[1]));
    }
  }
  return [...candidates];
}

function getSeriesResourceCandidates(detail, resourceUrl) {
  const detectors = Array.isArray(detail.resourceDetectors)
    ? detail.resourceDetectors
    : [];
  const season = Number(resourceUrl.searchParams.get("se")) || 1;
  const epFrom = Number(resourceUrl.searchParams.get("epFrom")) || 1;
  const epTo = Number(resourceUrl.searchParams.get("epTo")) || epFrom;
  const resolution = Number(resourceUrl.searchParams.get("resolution")) || 360;

  return detectors.flatMap((detector) => {
    if (!detector.resourceLink || detector.downloadUrl) {
      return [];
    }

    const episodes = [];
    for (let episode = epFrom; episode <= epTo; episode += 1) {
      const links = getSeriesLinkCandidates(
        detector.resourceLink,
        season,
        episode,
        resolution,
      );
      if (links.length) {
        episodes.push({ episode, links });
      }
    }
    return episodes;
  });
}

function matchesRequestedResource(
  resource,
  resourceUrl,
  episode,
  requireResolution = true,
) {
  if (!resource?.resourceLink) {
    return false;
  }

  const season = Number(resourceUrl.searchParams.get("se")) || 1;
  const resolution = Number(resourceUrl.searchParams.get("resolution"));
  return (
    Number(resource.se) === season &&
    Number(resource.ep) === episode &&
    (!requireResolution ||
      !resolution ||
      Number(resource.resolution) === resolution)
  );
}

async function resolveSeriesResource(
  subjectId,
  candidate,
  resourceUrl,
  auth,
  requireResolution,
) {
  let bestResource = null;
  for (const link of candidate.links) {
    const sniffUrl = new URL("/wefeed-mobile-bff/sniff/config", BASE_URL);
    sniffUrl.searchParams.set("linkUrl", link);
    sniffUrl.searchParams.set("subjectId", subjectId);
    const { body } = await requestUpstreamAsync(
      sniffUrl.href,
      "GET",
      null,
      auth,
    );
    const sniffResponse = JSON.parse(body.toString("utf8"));
    const resource =
      sniffResponse.code === 0 ? sniffResponse.data?.resource : null;
    if (
      matchesRequestedResource(
        resource,
        resourceUrl,
        candidate.episode,
        requireResolution,
      )
    ) {
      if (requireResolution) return resource;
      if (
        !bestResource ||
        Number(resource.resolution) > Number(bestResource.resolution)
      ) {
        bestResource = resource;
      }
    }
  }
  return bestResource;
}

async function buildSeriesResourceFallback(
  detail,
  resourceUrl,
  auth,
  subjectId = resourceUrl.searchParams.get("subjectId") || "",
  requireResolution = true,
) {
  const candidates = getSeriesResourceCandidates(detail, resourceUrl);
  const resources = await Promise.all(
    candidates.map((candidate) =>
      resolveSeriesResource(
        subjectId,
        candidate,
        resourceUrl,
        auth,
        requireResolution,
      ),
    ),
  );
  return buildResourceResponse(
    resources.filter(Boolean),
    resourceUrl,
    requireResolution,
  );
}

function normalizeSearchTitle(title) {
  return String(title || "")
    .replace(
      /\s*[[(](?:hindi|english|tamil|telugu|malayalam|kannada|urdu|spanish(?:latam)?|latam|dubbed)[\])]/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function isMatchingSubject(subject, detail, currentSubjectId) {
  if (!subject?.hasResource || subject.subjectId === currentSubjectId) {
    return false;
  }

  const titleMatches =
    normalizeSearchTitle(subject.title).toLowerCase() ===
    normalizeSearchTitle(detail.title).toLowerCase();
  const typeMatches =
    Number(subject.subjectType) === Number(detail.subjectType);
  const releaseMatches =
    !detail.releaseDate || subject.releaseDate === detail.releaseDate;
  return titleMatches && typeMatches && releaseMatches;
}

async function buildAlternateSubjectFallback(
  detail,
  resourceUrl,
  auth,
  requireResolution = true,
) {
  const currentSubjectId = resourceUrl.searchParams.get("subjectId");
  const keyword = normalizeSearchTitle(detail.title);
  if (!keyword) {
    return buildResourceResponse([], resourceUrl);
  }

  const searchUrl = new URL("/wefeed-mobile-bff/subject-api/search", BASE_URL);
  const searchBody = JSON.stringify({ page: 1, keyword });
  const { body } = await requestUpstreamAsync(
    searchUrl.href,
    "POST",
    searchBody,
    auth,
  );
  const searchResponse = JSON.parse(body.toString("utf8"));
  const matches = Array.isArray(searchResponse.data?.items)
    ? searchResponse.data.items.filter((subject) =>
        isMatchingSubject(subject, detail, currentSubjectId),
      )
    : [];

  for (const subject of matches) {
    let fallback = buildResourceFallback(subject, resourceUrl);
    if (!fallback.data.list.length) {
      fallback = await buildSeriesResourceFallback(
        subject,
        resourceUrl,
        auth,
        subject.subjectId,
        requireResolution,
      );
    }
    if (fallback.data.list.length) {
      return fallback;
    }
  }

  return buildResourceResponse([], resourceUrl);
}

async function buildAvailableSeasonFallback(detail, resourceUrl, auth) {
  const subjectId = resourceUrl.searchParams.get("subjectId");
  const seasonInfoUrl = new URL(
    "/wefeed-mobile-bff/subject-api/season-info",
    BASE_URL,
  );
  seasonInfoUrl.searchParams.set("subjectId", subjectId);
  const { body } = await requestUpstreamAsync(
    seasonInfoUrl.href,
    "GET",
    null,
    auth,
  );
  const seasonInfo = JSON.parse(body.toString("utf8"));
  const seasons = Array.isArray(seasonInfo.data?.seasons)
    ? seasonInfo.data.seasons
    : [];
  const requestedSeason = Number(resourceUrl.searchParams.get("se")) || 1;
  if (
    !seasons.length ||
    seasons.some((season) => season.se === requestedSeason)
  ) {
    return buildResourceResponse([], resourceUrl);
  }

  for (const season of seasons) {
    const availableUrl = new URL(resourceUrl.href);
    availableUrl.searchParams.set("se", season.se);
    let fallback = await buildSeriesResourceFallback(
      detail,
      availableUrl,
      auth,
      subjectId || "",
    );
    if (!fallback.data.list.length) {
      fallback = await buildSeriesResourceFallback(
        detail,
        availableUrl,
        auth,
        subjectId || "",
        false,
      );
    }
    if (fallback.data.list.length) return fallback;
  }

  return buildResourceResponse([], resourceUrl);
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
    async (error, detailRes, detailBody) => {
      if (error) {
        res.status(502).json({ error: error.message });
        return;
      }

      try {
        const detailResponse = JSON.parse(detailBody.toString("utf8"));
        let fallback = buildResourceFallback(
          detailResponse.data || {},
          resourceUrl,
        );
        if (!fallback.data.list.length) {
          fallback = await buildSeriesResourceFallback(
            detailResponse.data || {},
            resourceUrl,
            auth,
          );
        }
        if (!fallback.data.list.length) {
          fallback = await buildAlternateSubjectFallback(
            detailResponse.data || {},
            resourceUrl,
            auth,
          );
        }
        if (!fallback.data.list.length) {
          fallback = await buildSeriesResourceFallback(
            detailResponse.data || {},
            resourceUrl,
            auth,
            subjectId || "",
            false,
          );
        }
        if (!fallback.data.list.length) {
          fallback = await buildAlternateSubjectFallback(
            detailResponse.data || {},
            resourceUrl,
            auth,
            false,
          );
        }
        if (!fallback.data.list.length) {
          fallback = await buildAvailableSeasonFallback(
            detailResponse.data || {},
            resourceUrl,
            auth,
          );
        }
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
