const PLATFORM_RULES = [
  {
    platform: "大众点评",
    hosts: ["dianping.com"],
    contentType(url) {
      return url.pathname.includes("/shop") ? "store" : "link";
    }
  },
  {
    platform: "小红书",
    hosts: ["xiaohongshu.com", "xhslink.com"],
    contentType() {
      return "note";
    }
  },
  {
    platform: "抖音",
    hosts: ["douyin.com", "iesdouyin.com"],
    contentType() {
      return "video";
    }
  }
];

export function normalizeUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) {
    throw new Error("URL 不能为空");
  }

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withProtocol);
  url.hash = "";

  const trackingPrefixes = ["utm_", "spm", "share_token", "share_id"];
  for (const key of [...url.searchParams.keys()]) {
    if (trackingPrefixes.some((prefix) => key === prefix || key.startsWith(prefix))) {
      url.searchParams.delete(key);
    }
  }

  return url.toString();
}

export function inferPlatform(input) {
  try {
    const url = new URL(normalizeUrl(input));
    const host = url.hostname.toLowerCase();
    const rule = PLATFORM_RULES.find((candidate) =>
      candidate.hosts.some((knownHost) => host === knownHost || host.endsWith(`.${knownHost}`))
    );

    return rule?.platform || "未知平台";
  } catch {
    return "未知平台";
  }
}

export function inferContentType(input) {
  try {
    const url = new URL(normalizeUrl(input));
    const host = url.hostname.toLowerCase();
    const rule = PLATFORM_RULES.find((candidate) =>
      candidate.hosts.some((knownHost) => host === knownHost || host.endsWith(`.${knownHost}`))
    );

    return rule ? rule.contentType(url) : "unknown";
  } catch {
    return "unknown";
  }
}

export function buildPreviewFromUrl(input, metadata = {}) {
  let normalizedUrl = "";

  try {
    normalizedUrl = normalizeUrl(input);
  } catch (error) {
    return {
      status: "failed",
      platform: "未知平台",
      originalUrl: String(input || "").trim(),
      normalizedUrl: "",
      title: "",
      imageUrl: "",
      contentType: "unknown",
      failureReason: `无法识别链接：${error.message}`
    };
  }

  const platform = inferPlatform(normalizedUrl);
  const contentType = inferContentType(normalizedUrl);
  const title = String(metadata.title || "").trim();
  const imageUrl = String(metadata.imageUrl || "").trim();
  const isSupported = platform !== "未知平台";
  const hasMeaningfulTitle = isMeaningfulTitle(title, platform);

  return {
    status: isSupported ? (hasMeaningfulTitle ? "success" : "partial") : "failed",
    platform,
    originalUrl: String(input || "").trim(),
    normalizedUrl,
    title: title || (isSupported ? `${platform}种草线索` : ""),
    imageUrl,
    contentType,
    failureReason: isSupported
      ? hasMeaningfulTitle
        ? ""
        : "未解析到可识别标题，请补充标题、店名或菜名"
      : "暂不支持该平台，仍可手动补充标题后保存"
  };
}

export function platformInitial(platform) {
  if (!platform || platform === "未知平台") return "线索";
  return platform.slice(0, 2);
}

function isMeaningfulTitle(title, platform) {
  const normalizedTitle = String(title || "").trim();
  if (!normalizedTitle) return false;

  const genericTitles = new Set([
    platform,
    `${platform}种草线索`,
    "小红书",
    "抖音",
    "大众点评",
    "大众点评网",
    "小红书 - 你的生活指南",
    "抖音-记录美好生活"
  ]);

  return !genericTitles.has(normalizedTitle);
}
