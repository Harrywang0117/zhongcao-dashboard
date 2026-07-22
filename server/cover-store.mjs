import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";

export const MAX_COVER_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_REDIRECTS = 3;
const IMAGE_FETCH_TIMEOUT_MS = 4000;
const MAX_CONCURRENT_IMAGE_FETCHES = 4;
let activeImageFetches = 0;
const COVER_NAME_PATTERN = /^\/covers\/([a-f0-9]{2})\/([a-f0-9]{64})\.(jpg|png|webp|avif|gif)$/;
const IMAGE_TYPES = new Map([
  ["image/jpeg", { extension: "jpg", matches: isJpeg }],
  ["image/png", { extension: "png", matches: isPng }],
  ["image/webp", { extension: "webp", matches: isWebp }],
  ["image/avif", { extension: "avif", matches: isAvif }],
  ["image/gif", { extension: "gif", matches: isGif }]
]);

export class CoverStoreError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "CoverStoreError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export async function storeCoverBytes(
  bytes,
  contentType,
  { dataDir, imageSource = "manual" } = {}
) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (!buffer.length) {
    throw new CoverStoreError("empty_image", "图片内容为空");
  }
  if (buffer.length > MAX_COVER_BYTES) {
    throw new CoverStoreError("image_too_large", "图片不能超过 5MB", 413);
  }

  const type = validateImage(buffer, contentType);
  const hash = createHash("sha256").update(buffer).digest("hex");
  const prefix = hash.slice(0, 2);
  const relativeUrl = `/covers/${prefix}/${hash}.${type.extension}`;
  const targetPath = coverPathFromUrl(relativeUrl, dataDir);
  const temporaryPath = join(dirname(targetPath), `.${hash}.${randomUUID()}.tmp`);

  await mkdir(dirname(targetPath), { recursive: true });
  try {
    await writeFile(temporaryPath, buffer, { flag: "wx" });
    await rename(temporaryPath, targetPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }

  return {
    imageStatus: "stored",
    imageSource,
    imageUrl: relativeUrl,
    bytes: buffer.length,
    contentType: type.contentType
  };
}

export async function fetchAndStoreCover(
  imageUrl,
  {
    dataDir,
    imageSource = "automatic",
    sourcePageUrl = "",
    fetchImpl = globalThis.fetch,
    lookupImpl = lookup
  } = {}
) {
  if (activeImageFetches >= MAX_CONCURRENT_IMAGE_FETCHES) {
    throw new CoverStoreError("image_fetch_busy", "封面获取繁忙，请稍后重试", 503);
  }
  activeImageFetches += 1;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);

  try {
    let currentUrl = String(imageUrl || "").trim();
    for (let redirects = 0; redirects <= MAX_IMAGE_REDIRECTS; redirects += 1) {
      await assertSafeRemoteImageUrl(currentUrl, lookupImpl);
      const headers = {
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.8,*/*;q=0.1",
        "User-Agent": "Mozilla/5.0 zhongcao-cover-snapshot/1.0"
      };
      const referer = safeReferer(sourcePageUrl);
      if (referer) headers.Referer = referer;

      const response = await fetchImpl(currentUrl, {
        signal: controller.signal,
        redirect: "manual",
        headers
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new CoverStoreError("image_redirect_missing", "图片跳转缺少目标地址", 502);
        }
        if (redirects === MAX_IMAGE_REDIRECTS) {
          throw new CoverStoreError("image_redirect_limit", "图片跳转次数过多", 502);
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      if (!response.ok) {
        throw new CoverStoreError("image_upstream_error", `图片服务器返回 ${response.status}`, 502);
      }

      const contentType = response.headers.get("content-type") || "";
      const bytes = await readResponseBytes(response, MAX_COVER_BYTES);
      return await storeCoverBytes(bytes, contentType, { dataDir, imageSource });
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new CoverStoreError("image_fetch_timeout", "图片获取超时", 504);
    }
    if (error instanceof CoverStoreError) throw error;
    throw new CoverStoreError("image_fetch_failed", "图片暂时无法获取", 502);
  } finally {
    clearTimeout(timeout);
    activeImageFetches -= 1;
  }

  throw new CoverStoreError("image_fetch_failed", "图片暂时无法获取", 502);
}

export async function readStoredCover(pathname, dataDir) {
  const filePath = coverPathFromUrl(pathname, dataDir);
  const extension = extname(filePath).slice(1);
  const contentType = [...IMAGE_TYPES.entries()].find(([, value]) => value.extension === extension)?.[0];
  if (!contentType) throw new CoverStoreError("cover_not_found", "封面不存在", 404);

  try {
    return { data: await readFile(filePath), contentType };
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new CoverStoreError("cover_not_found", "封面不存在", 404);
    }
    throw error;
  }
}

export function coverPathFromUrl(pathname, dataDir) {
  const match = COVER_NAME_PATTERN.exec(String(pathname || ""));
  if (!match || match[1] !== match[2].slice(0, 2)) {
    throw new CoverStoreError("cover_not_found", "封面不存在", 404);
  }

  const root = resolve(String(dataDir || "data"), "covers");
  const filePath = resolve(root, match[1], `${match[2]}.${match[3]}`);
  if (!filePath.startsWith(`${root}${sep}`)) {
    throw new CoverStoreError("cover_not_found", "封面不存在", 404);
  }
  return filePath;
}

export async function assertSafeRemoteImageUrl(url, lookupImpl = lookup) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new CoverStoreError("invalid_image_url", "图片链接无效");
  }

  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new CoverStoreError("unsafe_image_url", "图片链接不符合安全规则");
  }
  if (parsed.port && parsed.port !== "443") {
    throw new CoverStoreError("unsafe_image_url", "图片链接端口不符合安全规则");
  }
  if (isIP(parsed.hostname)) {
    throw new CoverStoreError("unsafe_image_url", "图片链接不能使用 IP 地址");
  }

  let addresses;
  try {
    addresses = await lookupImpl(parsed.hostname, { all: true, verbatim: true });
  } catch {
    throw new CoverStoreError("image_dns_failed", "图片域名暂时无法解析", 502);
  }
  if (!addresses?.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new CoverStoreError("unsafe_image_url", "图片链接指向了不安全的网络地址");
  }

  return parsed;
}

async function readResponseBytes(response, maxBytes) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > maxBytes) {
    throw new CoverStoreError("image_too_large", "图片不能超过 5MB", 413);
  }
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) {
      throw new CoverStoreError("image_too_large", "图片不能超过 5MB", 413);
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new CoverStoreError("image_too_large", "图片不能超过 5MB", 413);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

function validateImage(buffer, rawContentType) {
  const contentType = String(rawContentType || "").split(";", 1)[0].trim().toLowerCase();
  const type = IMAGE_TYPES.get(contentType);
  if (!type || !type.matches(buffer)) {
    throw new CoverStoreError("invalid_image_type", "仅支持 JPEG、PNG、WebP、AVIF 或 GIF 图片", 415);
  }
  return { ...type, contentType };
}

function isPrivateAddress(address) {
  if (!address) return true;
  const normalized = address.toLowerCase().split("%")[0];

  if (normalized.includes(":")) {
    if (normalized === "::" || normalized === "::1") return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    if (/^fe[89ab]/.test(normalized)) return true;
    if (normalized.startsWith("ff")) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)?.[1];
    return mapped ? isPrivateIpv4(mapped) : false;
  }

  return isPrivateIpv4(normalized);
}

function isPrivateIpv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function safeReferer(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function isJpeg(buffer) {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function isPng(buffer) {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

function isWebp(buffer) {
  return buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
}

function isAvif(buffer) {
  if (buffer.length < 16 || buffer.toString("ascii", 4, 8) !== "ftyp") return false;
  const brands = buffer.toString("ascii", 8, Math.min(buffer.length, 32));
  return brands.includes("avif") || brands.includes("avis");
}

function isGif(buffer) {
  if (buffer.length < 6) return false;
  const signature = buffer.toString("ascii", 0, 6);
  return signature === "GIF87a" || signature === "GIF89a";
}
