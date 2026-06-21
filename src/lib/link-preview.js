const PLATFORM_RULES = [
  {
    platform: "大众点评",
    hosts: ["dianping.com", "dpurl.cn"],
    contentType(url) {
      return /\/shop(?:info)?\b/.test(url.pathname) ? "store" : "link";
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

const CATEGORY_TAG_MAP = new Map([
  ["日本料理", "日料"],
  ["日料", "日料"],
  ["火锅", "火锅"],
  ["烧烤", "烧烤"],
  ["甜品", "甜品"],
  ["面馆", "面馆"],
  ["咖啡", "咖啡"],
  ["小龙虾", "小龙虾"]
]);

const DIANPING_CITY_ID_MAP = new Map([
  ["1609", "成都"]
]);

export function normalizeUrl(input) {
  const raw = extractUrlFromText(input);
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
    const rule = findPlatformRule(url);

    return rule?.platform || "未知平台";
  } catch {
    return "未知平台";
  }
}

export function inferContentType(input) {
  try {
    const url = new URL(normalizeUrl(input));
    const rule = findPlatformRule(url);

    return rule ? rule.contentType(url) : "unknown";
  } catch {
    return "unknown";
  }
}

export function buildPreviewFromUrl(input, metadata = {}) {
  let normalizedUrl = "";
  const originalInput = String(input || "").trim();

  try {
    normalizedUrl = normalizeUrl(input);
  } catch (error) {
    return {
      status: "failed",
      platform: "未知平台",
      originalUrl: originalInput,
      normalizedUrl: "",
      title: "",
      imageUrl: "",
      contentType: "unknown",
      failureReason: `无法识别链接：${error.message}`
    };
  }

  const platform = inferPlatform(normalizedUrl);
  const shareParse = parsePlatformShareText(originalInput, platform);
  const contentType = shareParse.contentType || inferContentType(normalizedUrl);
  const shareSuggestion = shareParse.suggested;
  const title = String(shareSuggestion.storeName || metadata.title || "").trim();
  const imageUrl = String(metadata.imageUrl || "").trim();
  const isSupported = platform !== "未知平台";
  const hasMeaningfulTitle = isMeaningfulTitle(title, platform);

  return {
    status: isSupported ? (hasMeaningfulTitle ? "success" : "partial") : "failed",
    platform,
    originalUrl: originalInput,
    normalizedUrl,
    title: title || (isSupported ? `${platform}种草线索` : ""),
    imageUrl,
    contentType,
    suggested: shareSuggestion,
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

function parsePlatformShareText(input, platform) {
  if (platform === "大众点评") {
    return { contentType: "", suggested: parseDianpingShareText(input) };
  }
  if (platform === "抖音") {
    return parseDouyinShareText(input);
  }

  return { contentType: "", suggested: {} };
}

function parseDianpingShareText(input) {
  const raw = String(input || "").trim();
  const textBeforeUrl = raw.split(/https?:\/\//i)[0]?.trim() || "";
  const storeName = /【([^】]+)】/.exec(textBeforeUrl)?.[1]?.trim() || "";
  if (!storeName) return {};

  const rating = /[★☆]+\s*([0-5](?:\.\d)?)/.exec(textBeforeUrl)?.[1] || "";
  const averagePrice = /¥\s*([\d.]+)\s*\/\s*人/.exec(textBeforeUrl)?.[1] || "";
  let detailText = textBeforeUrl
    .replace(/【[^】]+】/, " ")
    .replace(/[★☆]+\s*[0-5](?:\.\d)?/, " ")
    .replace(/¥\s*[\d.]+\s*\/\s*人/, " ")
    .trim();

  const detailParts = detailText.split(/\s+/).filter(Boolean);
  const businessDistrict = detailParts[0] || "";
  const category = detailParts[1] || "";
  const addressNote = detailParts.slice(2).join(" ");
  const tagName = CATEGORY_TAG_MAP.get(category) || "";
  const city = inferDianpingCity(input);
  const noteParts = [
    rating ? `评分 ${rating}` : "",
    averagePrice ? `人均 ¥${averagePrice}/人` : "",
    category
  ].filter(Boolean);

  return {
    storeName,
    city,
    businessDistrict,
    addressNote,
    tagNames: tagName ? [tagName] : [],
    note: noteParts.join("，")
  };
}

function parseDouyinShareText(input) {
  const raw = String(input || "").trim();
  const textBeforeUrl = raw.split(/https?:\/\//i)[0]?.trim() || "";
  if (!/地点详情|人均/.test(textBeforeUrl)) return { contentType: "", suggested: {} };

  const parts = textBeforeUrl.split(/[，,]/).map((part) => part.trim()).filter(Boolean);
  const storeName = normalizeDouyinStoreName(parts[0] || "");
  if (!storeName) return { contentType: "", suggested: {} };

  const averagePrice = /人均\s*¥?\s*([\d.]+)/.exec(textBeforeUrl)?.[1] || "";
  const category = parts.find(
    (part) => !/人均|链接|详情|查看|戳|打开/.test(part) && normalizeDouyinStoreName(part) !== storeName
  ) || "";
  const tagName = CATEGORY_TAG_MAP.get(category) || category;
  const noteParts = [
    averagePrice ? `人均 ¥${averagePrice}/人` : "",
    category
  ].filter(Boolean);

  return {
    contentType: "store",
    suggested: {
      storeName,
      city: "",
      businessDistrict: "",
      addressNote: "",
      tagNames: tagName ? [tagName] : [],
      note: noteParts.join("，")
    }
  };
}

function normalizeDouyinStoreName(value) {
  return String(value || "")
    .replace(/^\s*\d+\s*[-–—、.．]?\s*/, "")
    .trim();
}

function inferDianpingCity(input) {
  try {
    const url = new URL(normalizeUrl(input));
    return DIANPING_CITY_ID_MAP.get(url.searchParams.get("cityid") || "") || "";
  } catch {
    return "";
  }
}

function extractUrlFromText(input) {
  const raw = String(input || "").trim();
  const candidates = [...raw.matchAll(/https?:\/\/[^\s"'<>，。；、！？）】》」』]+/gi)].map((match) =>
    cleanSharedUrl(match[0])
  );

  if (!candidates.length) return raw;

  return candidates.find((candidate) => inferPlatformFromUrl(candidate) !== "未知平台") || candidates[0];
}

function cleanSharedUrl(value) {
  return String(value || "")
    .trim()
    .replace(/[，。；、！？）】》」』"'.,;!?]+$/g, "");
}

function inferPlatformFromUrl(value) {
  try {
    return findPlatformRule(new URL(value))?.platform || "未知平台";
  } catch {
    return "未知平台";
  }
}

function findPlatformRule(url) {
  const host = url.hostname.toLowerCase();
  return PLATFORM_RULES.find((candidate) =>
    candidate.hosts.some((knownHost) => host === knownHost || host.endsWith(`.${knownHost}`))
  );
}
