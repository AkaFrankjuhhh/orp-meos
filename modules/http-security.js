const fs = require("node:fs");
const path = require("node:path");

const stateChangingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function requestHost(req) {
  return String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim().toLowerCase();
}

function configuredAppHost(appBaseUrl) {
  try {
    return new URL(appBaseUrl).host.toLowerCase();
  } catch (error) {
    return "";
  }
}

function isTrustedMutationOrigin(req, appBaseUrl) {
  const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (fetchSite === "cross-site") return false;
  const origin = String(req.headers.origin || "").trim();
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const allowedHosts = new Set([requestHost(req), configuredAppHost(appBaseUrl)].filter(Boolean));
    return allowedHosts.has(originUrl.host.toLowerCase());
  } catch (error) {
    return false;
  }
}

function securityHeaders(appBaseUrl, contentType = "") {
  const headers = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin"
  };
  if (String(appBaseUrl || "").startsWith("https://")) {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  }
  if (contentType.includes("text/html")) {
    headers["Content-Security-Policy"] = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://cdn.discordapp.com https://*.discordapp.com",
      "connect-src 'self' https://discord.com https://discordapp.com",
      "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'"
    ].join("; ");
  }
  return headers;
}

function createHttpResponder({ appBaseUrl }) {
  function writeHeadSecure(res, status, headers = {}) {
    res.writeHead(status, { ...securityHeaders(appBaseUrl, headers["Content-Type"] || ""), ...headers });
  }

  function sendJson(res, status, body) {
    const payload = JSON.stringify(body);
    writeHeadSecure(res, status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(payload)
    });
    res.end(payload);
  }

  function sendHtml(res, status, html) {
    writeHeadSecure(res, status, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  }

  return { writeHeadSecure, sendJson, sendHtml };
}

async function readRawBody(req, limitBytes) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > limitBytes) {
      const error = new Error("Request body is te groot.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function createJsonBodyReader(maxBodyBytes) {
  return async function readBody(req) {
    const buffer = await readRawBody(req, maxBodyBytes);
    const body = buffer.toString("utf8");
    if (!body) return {};
    try {
      return JSON.parse(body);
    } catch (error) {
      const parseError = new Error("Ongeldige JSON body.");
      parseError.status = 400;
      throw parseError;
    }
  };
}

function contentTypeForPath(filePath) {
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml; charset=utf-8"
  }[path.extname(filePath)] || "application/octet-stream";
}

function serveWhitelistedStatic({ root, requested, res, writeHeadSecure, publicRootFiles, isAllowedFeatureScript }) {
  const filePath = path.normalize(path.join(root, requested));
  const relativePath = path.relative(root, filePath);
  const normalizedRelative = relativePath.replaceAll("\\", "/");
  const isOutsideRoot = relativePath.startsWith("..") || path.isAbsolute(relativePath);
  const isAsset = normalizedRelative.startsWith("assets/");
  const isPublicRootFile = publicRootFiles.has(normalizedRelative);
  const isFeatureScript = typeof isAllowedFeatureScript === "function" && isAllowedFeatureScript(normalizedRelative);
  if (isOutsideRoot || (!isPublicRootFile && !isAsset && !isFeatureScript) || path.basename(filePath).startsWith(".")) {
    writeHeadSecure(res, 403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      writeHeadSecure(res, 404);
      res.end("Not found");
      return;
    }
    const extension = path.extname(filePath).toLowerCase();
    const cacheControl = extension === ".html"
      ? "no-cache"
      : "public, max-age=300, stale-while-revalidate=86400";
    writeHeadSecure(res, 200, {
      "Content-Type": contentTypeForPath(filePath),
      // HTML blijft altijd vers; assets mogen kort gecachet worden voor merkbaar
      // snellere pagina's zonder dat een deployment lang blijft hangen.
      "Cache-Control": cacheControl
    });
    res.end(data);
  });
}

function shouldRejectMutation(req, appBaseUrl) {
  return stateChangingMethods.has(req.method) && !isTrustedMutationOrigin(req, appBaseUrl);
}

module.exports = {
  stateChangingMethods,
  requestHost,
  configuredAppHost,
  isTrustedMutationOrigin,
  securityHeaders,
  createHttpResponder,
  readRawBody,
  createJsonBodyReader,
  contentTypeForPath,
  serveWhitelistedStatic,
  shouldRejectMutation
};
