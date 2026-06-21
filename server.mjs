import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildPreviewFromUrl, inferPlatform } from "./src/lib/link-preview.js";

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 4173);
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

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "POST" && requestUrl.pathname === "/api/link-preview") {
    await handleLinkPreview(request, response);
    return;
  }

  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method Not Allowed" });
    return;
  }

  await serveStatic(requestUrl, response);
});

if (isDirectRun()) {
  server.listen(PORT, HOST, () => {
    console.log(`种草软件已启动：http://${HOST}:${PORT}`);
  });
}

async function handleLinkPreview(request, response) {
  try {
    const body = await readJson(request);
    const url = String(body.url || "").trim();
    const localPreview = buildPreviewFromUrl(url);

    if (localPreview.status === "failed") {
      sendJson(response, 200, localPreview);
      return;
    }

    const metadata = await fetchOpenGraphMetadata(localPreview.normalizedUrl, localPreview.platform);
    sendJson(response, 200, buildPreviewFromUrl(url, metadata));
  } catch (error) {
    sendJson(response, 200, {
      status: "failed",
      platform: "未知平台",
      originalUrl: "",
      normalizedUrl: "",
      title: "",
      imageUrl: "",
      contentType: "unknown",
      failureReason: error.message || "解析失败"
    });
  }
}

async function serveStatic(requestUrl, response) {
  const pathname = requestUrl.pathname === "/" ? "/index.html" : decodeURIComponent(requestUrl.pathname);
  const buildFileUrl = new URL(`.${pathname}`, BUILD_DIR);
  const publicFileUrl = new URL(`.${pathname}`, PUBLIC_ASSET_DIR);
  const extension = extname(pathname);

  if (!isInsideDirectory(buildFileUrl, BUILD_DIR)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const data = await readFile(buildFileUrl);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extname(fileURLToPath(buildFileUrl))] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    response.end(data);
  } catch (buildError) {
    if (pathname !== "/index.html" && isInsideDirectory(publicFileUrl, PUBLIC_ASSET_DIR)) {
      try {
        const data = await readFile(publicFileUrl);
        response.writeHead(200, {
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
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache"
      });
      response.end("Not Found");
      return;
    }

    const fallback = await readFile(new URL("./index.html", BUILD_DIR));
    response.writeHead(200, { "Content-Type": MIME_TYPES[".html"] });
    response.end(fallback);
  }
}

async function fetchOpenGraphMetadata(url, expectedPlatform) {
  if (!isSafePreviewFetchUrl(url, expectedPlatform)) {
    return {};
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 zhongcao-link-preview/1.0"
      }
    });

    if (!isSafePreviewFetchUrl(response.url, expectedPlatform)) {
      return {};
    }

    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("text/html")) {
      return {};
    }

    const html = (await response.text()).slice(0, 180000);
    return {
      title: extractMeta(html, "og:title") || extractTitle(html),
      imageUrl: extractMeta(html, "og:image") || extractMeta(html, "twitter:image")
    };
  } catch {
    return {};
  } finally {
    clearTimeout(timeout);
  }
}

export function isSafePreviewFetchUrl(url, expectedPlatform) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;
    if (inferPlatform(parsed.toString()) !== expectedPlatform) return false;
    return expectedPlatform !== "未知平台";
  } catch {
    return false;
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

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function isDirectRun() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

export { serveStatic, server };
