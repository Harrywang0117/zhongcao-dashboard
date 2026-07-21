import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildPreviewFromUrl,
  inferPlatform,
  supportsMetadataFetch
} from "./src/lib/link-preview.js";
import { readServerConfig } from "./server/config.mjs";
import {
  CoverStoreError,
  MAX_COVER_BYTES,
  fetchAndStoreCover,
  readStoredCover,
  storeCoverBytes
} from "./server/cover-store.mjs";

const { host: HOST, port: PORT, dataDir: DATA_DIR } = readServerConfig();
const BUILD_DIR = new URL("./dist/", import.meta.url);
const PUBLIC_ASSET_DIR = new URL("./public/", import.meta.url);
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer"
};
const MAX_PREVIEW_REDIRECTS = 5;
const MAX_PREVIEW_BYTES = 180_000;
const MAX_CONCURRENT_PREVIEWS = 4;
let activePreviewFetches = 0;

export function createRequestHandler({
  dataDir = DATA_DIR,
  fetchImpl = globalThis.fetch,
  coverLookupImpl
} = {}) {
  return async function requestHandler(request, response) {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "GET" && requestUrl.pathname === "/healthz") {
      sendJson(response, 200, { status: "ok" });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/link-preview") {
      await handleLinkPreview(request, response, { dataDir, fetchImpl, coverLookupImpl });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/cover-upload") {
      await handleCoverUpload(request, response, { dataDir });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/cover-fetch") {
      await handleCoverFetch(request, response, { dataDir, fetchImpl, coverLookupImpl });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname.startsWith("/covers/")) {
      await serveCover(requestUrl.pathname, response, dataDir);
      return;
    }

    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method Not Allowed" });
      return;
    }

    await serveStatic(requestUrl, response);
  };
}

export const handleRequest = createRequestHandler();
const server = createServer(handleRequest);

if (isDirectRun()) {
  server.listen(PORT, HOST, () => {
    console.log(`种草软件已启动：http://${HOST}:${PORT}`);
  });
}

async function handleLinkPreview(request, response, { dataDir, fetchImpl, coverLookupImpl }) {
  try {
    const body = await readJson(request);
    const url = String(body.url || "").trim();
    const localPreview = buildPreviewFromUrl(url);

    if (localPreview.status === "failed") {
      sendJson(response, 200, localPreview);
      return;
    }

    const metadata = await fetchOpenGraphMetadata(localPreview.normalizedUrl, localPreview.platform, {
      fetchImpl
    });
    const enrichedMetadata = await snapshotPreviewImage(metadata, {
      dataDir,
      fetchImpl,
      coverLookupImpl,
      sourcePageUrl: metadata.resolvedUrl || localPreview.normalizedUrl
    });
    sendJson(response, 200, buildPreviewFromUrl(url, enrichedMetadata));
  } catch (error) {
    sendJson(response, 200, {
      status: "failed",
      platform: "未知平台",
      originalUrl: "",
      normalizedUrl: "",
      title: "",
      imageUrl: "",
      metadataStatus: "failed",
      metadataFailureCode: "preview_failed",
      metadataFailureReason: "链接解析失败",
      imageStatus: "failed",
      imageSource: "none",
      imageFailureCode: "preview_failed",
      imageFailureReason: "链接解析失败",
      contentType: "unknown",
      failureCode: "preview_failed",
      failureReason: error.message || "解析失败"
    });
  }
}

async function snapshotPreviewImage(metadata, options) {
  if (!metadata.imageSourceUrl) return metadata;

  try {
    const stored = await fetchAndStoreCover(metadata.imageSourceUrl, {
      dataDir: options.dataDir,
      fetchImpl: options.fetchImpl,
      lookupImpl: options.coverLookupImpl,
      sourcePageUrl: options.sourcePageUrl,
      imageSource: "automatic"
    });
    return {
      ...metadata,
      ...stored,
      imageFailureCode: "",
      imageFailureReason: ""
    };
  } catch (error) {
    const failure = normalizeCoverError(error);
    return {
      ...metadata,
      imageUrl: "",
      imageStatus: "download_failed",
      imageSource: "none",
      imageFailureCode: failure.code,
      imageFailureReason: failure.message
    };
  }
}

async function handleCoverUpload(request, response, { dataDir }) {
  try {
    const bytes = await readRequestBytes(request, MAX_COVER_BYTES);
    const stored = await storeCoverBytes(bytes, request.headers["content-type"] || "", {
      dataDir,
      imageSource: "manual"
    });
    sendJson(response, 201, stored);
  } catch (error) {
    sendCoverError(response, error);
  }
}

async function handleCoverFetch(request, response, { dataDir, fetchImpl, coverLookupImpl }) {
  try {
    const body = await readJson(request);
    const stored = await fetchAndStoreCover(String(body.url || "").trim(), {
      dataDir,
      fetchImpl,
      lookupImpl: coverLookupImpl,
      sourcePageUrl: String(body.sourcePageUrl || "").trim(),
      imageSource: "automatic"
    });
    sendJson(response, 201, stored);
  } catch (error) {
    sendCoverError(response, error);
  }
}

async function serveCover(pathname, response, dataDir) {
  try {
    const cover = await readStoredCover(pathname, dataDir);
    response.writeHead(200, {
      ...SECURITY_HEADERS,
      "Content-Type": cover.contentType,
      "Content-Length": cover.data.length,
      "Cache-Control": "public, max-age=31536000, immutable"
    });
    response.end(cover.data);
  } catch (error) {
    const failure = normalizeCoverError(error);
    response.writeHead(failure.statusCode, {
      ...SECURITY_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(failure.statusCode === 404 ? "Not Found" : "Cover unavailable");
  }
}

async function serveStatic(requestUrl, response) {
  const pathname = requestUrl.pathname === "/" ? "/index.html" : decodeURIComponent(requestUrl.pathname);
  const buildFileUrl = new URL(`.${pathname}`, BUILD_DIR);
  const publicFileUrl = new URL(`.${pathname}`, PUBLIC_ASSET_DIR);
  const extension = extname(pathname);

  if (!isInsideDirectory(buildFileUrl, BUILD_DIR)) {
    response.writeHead(403, SECURITY_HEADERS);
    response.end("Forbidden");
    return;
  }

  try {
    const data = await readFile(buildFileUrl);
    response.writeHead(200, {
      ...SECURITY_HEADERS,
      "Content-Type": MIME_TYPES[extname(fileURLToPath(buildFileUrl))] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    response.end(data);
  } catch (buildError) {
    if (pathname !== "/index.html" && isInsideDirectory(publicFileUrl, PUBLIC_ASSET_DIR)) {
      try {
        const data = await readFile(publicFileUrl);
        response.writeHead(200, {
          ...SECURITY_HEADERS,
          "Content-Type": MIME_TYPES[extname(fileURLToPath(publicFileUrl))] || "application/octet-stream",
          "Cache-Control": "no-cache"
        });
        response.end(data);
        return;
      } catch {
        // Fall back to the React app shell below.
      }
    }

    if (extension) {
      response.writeHead(404, {
        ...SECURITY_HEADERS,
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache"
      });
      response.end("Not Found");
      return;
    }

    const fallback = await readFile(new URL("./index.html", BUILD_DIR));
    response.writeHead(200, {
      ...SECURITY_HEADERS,
      "Content-Type": MIME_TYPES[".html"],
      "Cache-Control": "no-cache"
    });
    response.end(fallback);
  }
}

export async function fetchOpenGraphMetadata(
  url,
  expectedPlatform,
  { fetchImpl = globalThis.fetch } = {}
) {
  if (!isSafePreviewFetchUrl(url, expectedPlatform)) {
    return previewFetchFailure("unsafe_url", "链接不符合安全抓取规则");
  }
  if (activePreviewFetches >= MAX_CONCURRENT_PREVIEWS) {
    return previewFetchFailure("preview_busy", "在线解析繁忙，请稍后重试");
  }

  activePreviewFetches += 1;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);

  try {
    let currentUrl = url;
    for (let redirects = 0; redirects <= MAX_PREVIEW_REDIRECTS; redirects += 1) {
      if (!isSafePreviewFetchUrl(currentUrl, expectedPlatform)) {
        return previewFetchFailure("unsafe_redirect", "链接跳转到了不安全的地址");
      }

      const response = await fetchImpl(currentUrl, {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          "User-Agent": "Mozilla/5.0 zhongcao-link-preview/1.0"
        }
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return previewFetchFailure("redirect_missing_location", "平台跳转缺少目标地址");
        if (redirects === MAX_PREVIEW_REDIRECTS) {
          return previewFetchFailure("too_many_redirects", "平台链接跳转次数过多");
        }
        const nextUrl = new URL(location, currentUrl).toString();
        if (!isSafePreviewFetchUrl(nextUrl, expectedPlatform)) {
          return previewFetchFailure("unsafe_redirect", "链接跳转到了其他平台或不安全地址");
        }
        const barrier = detectPlatformBarrier(nextUrl, expectedPlatform);
        if (barrier) return previewBlocked(barrier, nextUrl);
        currentUrl = nextUrl;
        continue;
      }

      const resolvedUrl = response.url || currentUrl;
      if (!isSafePreviewFetchUrl(resolvedUrl, expectedPlatform)) {
        return previewFetchFailure("unsafe_redirect", "链接最终地址不符合安全规则");
      }

      const contentType = response.headers.get("content-type") || "";
      if (!response.ok) {
        return previewFetchFailure("upstream_http_error", `平台页面返回 ${response.status}`);
      }
      if (!contentType.includes("text/html")) {
        return previewFetchFailure("non_html_response", "平台没有返回可解析网页");
      }

      const html = await readResponseText(response, MAX_PREVIEW_BYTES);
      const title = extractMeta(html, "og:title") || extractTitle(html);
      const description = extractMeta(html, "og:description") || extractMeta(html, "description");
      const barrier = detectPlatformBarrier(resolvedUrl, expectedPlatform, { title, description, html });
      if (barrier) return previewBlocked(barrier, resolvedUrl);

      const rawImageUrl = extractMeta(html, "og:image") || extractMeta(html, "twitter:image");
      const imageSourceUrl = resolveMetadataUrl(rawImageUrl, resolvedUrl);
      return {
        metadataStatus: "success",
        title,
        description,
        imageSourceUrl,
        imageUrl: "",
        imageStatus: imageSourceUrl ? "discovered" : "not_found",
        imageSource: "none",
        imageFailureCode: imageSourceUrl ? "" : "metadata_image_missing",
        imageFailureReason: imageSourceUrl ? "" : "平台页面没有提供可用封面",
        resolvedUrl,
        observedUrl: resolvedUrl
      };
    }
    return previewFetchFailure("too_many_redirects", "平台链接跳转次数过多");
  } catch (error) {
    return error?.name === "AbortError"
      ? previewFetchFailure("fetch_timeout", "在线解析超时，已保留原链接")
      : previewFetchFailure("fetch_failed", "平台页面暂时无法访问，已保留原链接");
  } finally {
    clearTimeout(timeout);
    activePreviewFetches -= 1;
  }
}

export function isSafePreviewFetchUrl(url, expectedPlatform) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;
    if (inferPlatform(parsed.toString()) !== expectedPlatform) return false;
    return supportsMetadataFetch(expectedPlatform);
  } catch {
    return false;
  }
}

async function readResponseText(response, maxBytes) {
  if (!response.body?.getReader) {
    return (await response.text()).slice(0, maxBytes);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = maxBytes - total;
    const chunk = value.length > remaining ? value.slice(0, remaining) : value;
    chunks.push(chunk);
    total += chunk.length;
    if (value.length > remaining) {
      await reader.cancel();
      break;
    }
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(merged);
}

function previewFetchFailure(failureCode, failureReason) {
  return {
    metadataStatus: "failed",
    imageStatus: "failed",
    imageSource: "none",
    imageFailureCode: failureCode,
    imageFailureReason: failureReason,
    failureCode,
    failureReason
  };
}

function previewBlocked(barrier, observedUrl) {
  return {
    metadataStatus: "blocked",
    imageStatus: "blocked",
    imageSource: "none",
    imageFailureCode: barrier.code,
    imageFailureReason: barrier.reason,
    failureCode: barrier.code,
    failureReason: barrier.reason,
    observedUrl
  };
}

function detectPlatformBarrier(url, platform, page = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (platform === "大众点评" && parsed.pathname.includes("/shopinfo/login-redirect")) {
    return {
      code: "platform_login_required",
      reason: "大众点评向服务器返回了登录页面，可手动添加封面"
    };
  }

  const genericTitles = new Set(["大众点评", "小红书", "抖音", "抖音-记录美好生活"]);
  if (page.html && genericTitles.has(String(page.title || "").trim()) && !page.description) {
    const hasImage = Boolean(extractMeta(page.html, "og:image") || extractMeta(page.html, "twitter:image"));
    if (!hasImage && /login|captcha|verify|challenge/i.test(`${parsed.pathname}${parsed.search}`)) {
      return {
        code: "platform_access_blocked",
        reason: "平台限制了服务器访问，可手动添加封面"
      };
    }
  }

  return null;
}

function resolveMetadataUrl(value, baseUrl) {
  if (!value) return "";
  try {
    const resolved = new URL(value, baseUrl);
    return resolved.protocol === "https:" ? resolved.toString() : "";
  } catch {
    return "";
  }
}

function extractMeta(html, key) {
  const propertyPattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escapeRegExp(key)}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    "i"
  );
  const contentFirstPattern = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escapeRegExp(key)}["'][^>]*>`,
    "i"
  );
  return decodeHtml(propertyPattern.exec(html)?.[1] || contentFirstPattern.exec(html)?.[1] || "");
}

function extractTitle(html) {
  return decodeHtml(/<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1] || "");
}

function decodeHtml(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isInsideDirectory(fileUrl, directoryUrl) {
  const publicPath = fileURLToPath(directoryUrl);
  const filePath = fileURLToPath(fileUrl);
  return pathToFileURL(filePath).href.startsWith(pathToFileURL(publicPath).href);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 128 * 1024) {
        reject(new Error("请求过大"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("请求 JSON 无法解析"));
      }
    });
    request.on("error", reject);
  });
}

function readRequestBytes(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new CoverStoreError("image_too_large", "图片不能超过 5MB", 413));
        request.destroy();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    request.on("end", () => resolve(Buffer.concat(chunks, total)));
    request.on("error", reject);
  });
}

function normalizeCoverError(error) {
  if (error instanceof CoverStoreError) {
    return {
      code: error.code,
      message: error.message,
      statusCode: error.statusCode
    };
  }
  return {
    code: "cover_store_failed",
    message: "封面暂时无法保存",
    statusCode: 500
  };
}

function sendCoverError(response, error) {
  const failure = normalizeCoverError(error);
  sendJson(response, failure.statusCode, {
    imageStatus: "failed",
    imageSource: "none",
    imageUrl: "",
    imageFailureCode: failure.code,
    imageFailureReason: failure.message
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    ...SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function isDirectRun() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

export { serveStatic, server };
