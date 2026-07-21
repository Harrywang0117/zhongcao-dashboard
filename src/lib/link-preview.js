const PLATFORM_RULES = [
  {
    platform: "大众点评",
    hosts: ["dianping.com", "dpurl.cn"],
    upgradeToHttps: true,
    autoParse: true,
    contentType(url) {
      return /\/shop(?:info)?\b/.test(url.pathname) ? "store" : "link";
    }
  },
  {
    platform: "小红书",
    hosts: ["xiaohongshu.com", "xhslink.com"],
    upgradeToHttps: true,
    autoParse: true,
    contentType() {
      return "note";
    }
  },
  {
    platform: "抖音",
    hosts: ["douyin.com", "iesdouyin.com"],
    upgradeToHttps: true,
    autoParse: true,
    contentType() {
      return "video";
    }
  },
  {
    platform: "微博",
    hosts: ["weibo.com", "weibo.cn"],
    upgradeToHttps: true,
    autoParse: false,
    contentType() {
      return "post";
    }
  }
];

const CATEGORY_TAG_MAP = new Map([
  ["日本料理", "日料"],
  ["日料", "日料"],
  ["日式面条", "日料"],
  ["日式自助", "日料"],
  ["新疆菜", "新疆菜"],
  ["火锅", "火锅"],
  ["烧烤", "烧烤"],
  ["甜品", "甜品"],
  ["面馆", "面馆"],
  ["咖啡", "咖啡"],
  ["小龙虾", "小龙虾"]
]);

const FOOD_TAG_PATTERNS = [
  ["冒菜", /冒菜/],
  ["韩餐", /韩餐|韩国烤肉/],
  ["新疆菜", /新疆菜/],
  ["日料", /日料|日本料理|日式面条|日式自助|天妇罗/],
  ["火锅", /火锅|涮涮锅/],
  ["烧烤", /烧烤|烤肉|烧鸟/],
  ["排骨", /排骨/],
  ["普洱菜", /普洱菜/],
  ["小龙虾", /小龙虾/],
  ["咖啡", /咖啡/],
  ["甜品", /甜品|蛋糕|糖水/]
];

const CITY_NAMES = [
  "成都",
  "上海",
  "北京",
  "广州",
  "深圳",
  "杭州",
  "重庆",
  "南京",
  "武汉",
  "西安",
  "苏州",
  "长沙"
];

const DIANPING_CITY_ID_MAP = new Map([
  ["8", "成都"],
  ["1609", "成都"]
]);

export function normalizeUrl(input) {
  const raw = extractUrlFromText(input);
  if (!raw) {
    throw new Error("URL 不能为空");
  }

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withProtocol);
  const rule = findPlatformRule(url);
  if (url.protocol === "http:" && rule?.upgradeToHttps) {
    url.protocol = "https:";
  }
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
    return findPlatformRule(new URL(normalizeUrl(input)))?.platform || "未知平台";
  } catch {
    return "未知平台";
  }
}

export function supportsMetadataFetch(platform) {
  return PLATFORM_RULES.some((rule) => rule.platform === platform && rule.autoParse);
}

export function inferContentType(input) {
  try {
    const url = new URL(normalizeUrl(input));
    return findPlatformRule(url)?.contentType(url) || "unknown";
  } catch {
    return "unknown";
  }
}

export function buildPreviewFromUrl(input, metadata = {}) {
  const rawShareText = String(input || "").trim();
  let sharedUrl = "";

  try {
    sharedUrl = normalizeUrl(input);
  } catch (error) {
    return {
      status: "failed",
      platform: "未知平台",
      rawShareText,
      originalUrl: rawShareText,
      sharedUrl: "",
      resolvedUrl: "",
      normalizedUrl: "",
      sourceKey: "",
      title: "",
      sourceDescription: "",
      authorName: "",
      hashtags: [],
      imageUrl: "",
      contentType: "unknown",
      suggested: {},
      failureCode: "invalid_url",
      failureReason: `无法识别链接：${error.message}`
    };
  }

  const rule = findPlatformRule(new URL(sharedUrl));
  const platform = rule?.platform || "未知平台";
  const resolvedUrl = normalizeResolvedUrl(metadata.resolvedUrl, platform) || sharedUrl;
  const shareParse = parsePlatformShareText(rawShareText, platform);
  const contentType = shareParse.contentType || inferContentType(resolvedUrl);
  const suggested = shareParse.suggested || {};
  const sourceDescription = String(shareParse.description || metadata.description || "").trim();
  const authorName = String(shareParse.authorName || "").trim();
  const hashtags = uniqueStrings(shareParse.hashtags || []);
  const title = String(suggested.storeName || shareParse.title || metadata.title || "").trim();
  const imageUrl = String(metadata.imageUrl || "").trim();
  const sourceKey = buildSourceKey(platform, resolvedUrl);
  const isSupported = Boolean(rule?.autoParse);
  const hasMeaningfulTitle = isMeaningfulTitle(title, platform);

  let status = "failed";
  let failureCode = "unsupported_platform";
  let failureReason = "暂不支持该平台，仍可先保存链接";

  if (isSupported && !hasMeaningfulTitle) {
    status = "partial";
    failureCode = metadata.failureCode || "missing_title";
    failureReason = metadata.failureReason || "未解析到可识别标题，已保留原链接供后续整理";
  } else if (isSupported && shareParse.needsReview) {
    status = "partial";
    failureCode = "needs_review";
    failureReason = "已提取作品描述，具体店名仍需确认";
  } else if (isSupported) {
    status = "success";
    failureCode = "";
    failureReason = "";
  }

  return {
    status,
    platform,
    rawShareText,
    originalUrl: rawShareText,
    sharedUrl,
    resolvedUrl,
    normalizedUrl: resolvedUrl,
    sourceKey,
    title: title || (platform !== "未知平台" ? `${platform}待整理链接` : ""),
    sourceDescription,
    authorName,
    hashtags,
    imageUrl,
    contentType,
    suggested,
    failureCode,
    failureReason,
    metadataFailureCode: String(metadata.failureCode || ""),
    metadataFailureReason: String(metadata.failureReason || "")
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
    `${platform}待整理链接`,
    "小红书",
    "抖音",
    "大众点评",
    "大众点评网",
    "微博",
    "小红书 - 你的生活指南",
    "抖音-记录美好生活"
  ]);

  return !genericTitles.has(normalizedTitle);
}

function parsePlatformShareText(input, platform) {
  if (platform === "大众点评") {
    return { contentType: "", suggested: parseDianpingShareText(input), needsReview: false };
  }
  if (platform === "抖音") {
    return parseDouyinShareText(input);
  }
  if (platform === "小红书") {
    return parseXiaohongshuShareText(input);
  }

  return { contentType: "", suggested: {}, needsReview: false };
}

function parseDianpingShareText(input) {
  const textBeforeUrl = textBeforeFirstUrl(input);
  const storeName = /【([^】]+)】/.exec(textBeforeUrl)?.[1]?.trim() || "";
  if (!storeName) return {};

  const rating = /[★☆]+\s*([0-5](?:\.\d)?)/.exec(textBeforeUrl)?.[1] || "";
  const averagePrice = /¥\s*([\d.]+)\s*\/\s*人/.exec(textBeforeUrl)?.[1] || "";
  const detailText = textBeforeUrl
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
  const textBeforeUrl = textBeforeFirstUrl(raw);

  if (/地点详情|人均/.test(textBeforeUrl)) {
    const parts = textBeforeUrl.split(/[，,]/).map((part) => part.trim()).filter(Boolean);
    const storeName = normalizeDouyinStoreName(parts[0] || "");
    if (storeName) {
      const averagePrice = /人均\s*¥?\s*([\d.]+)/.exec(textBeforeUrl)?.[1] || "";
      const category = parts.find(
        (part) => !/人均|链接|详情|查看|戳|打开/.test(part) && normalizeDouyinStoreName(part) !== storeName
      ) || "";
      const tagName = CATEGORY_TAG_MAP.get(category) || category;
      const noteParts = [averagePrice ? `人均 ¥${averagePrice}/人` : "", category].filter(Boolean);

      return {
        contentType: "store",
        suggested: {
          storeName,
          city: inferCity(textBeforeUrl),
          businessDistrict: "",
          addressNote: "",
          tagNames: tagName ? [tagName] : [],
          note: noteParts.join("，")
        },
        title: storeName,
        description: textBeforeUrl,
        authorName: "",
        hashtags: extractHashtags(raw),
        needsReview: false
      };
    }
  }

  const authorMatch = /【([^】]+?)的作品】/.exec(textBeforeUrl);
  const authorName = authorMatch?.[1]?.trim() || "";
  const description = cleanShareDescription(
    authorMatch
      ? textBeforeUrl.slice((authorMatch.index || 0) + authorMatch[0].length)
      : textBeforeUrl.replace(/^\s*\d+(?:\.\d+)?\s*复制打开抖音，?\s*看看\s*/u, "")
  );
  const hashtags = extractHashtags(raw);

  return {
    contentType: "video",
    suggested: description
      ? {
          storeName: "",
          city: inferCity(description),
          businessDistrict: "",
          addressNote: "",
          tagNames: inferFoodTags(description, hashtags),
          note: ""
        }
      : {},
    title: description,
    description,
    authorName,
    hashtags,
    needsReview: Boolean(description)
  };
}

function parseXiaohongshuShareText(input) {
  const raw = String(input || "").trim();
  const description = cleanShareDescription(
    textBeforeFirstUrl(raw)
      .replace(/^复制这条信息，?\s*打开【小红书】看看\s*/u, "")
      .replace(/^复制后打开【小红书】看看\s*/u, "")
  );
  const hashtags = extractHashtags(raw);

  return {
    contentType: "note",
    suggested: description
      ? {
          storeName: "",
          city: inferCity(description),
          businessDistrict: "",
          addressNote: "",
          tagNames: inferFoodTags(description, hashtags),
          note: ""
        }
      : {},
    title: description,
    description,
    authorName: "",
    hashtags,
    needsReview: Boolean(description)
  };
}

function cleanShareDescription(value) {
  return String(value || "")
    .replace(/^[\s，,：:;-]+/, "")
    .replace(/[\s，,：:;-]+$/, "")
    .trim();
}

function extractHashtags(value) {
  return uniqueStrings(
    [...String(value || "").matchAll(/#\s*([^#\s，。,.!！?？]+)/gu)].map((match) => match[1])
  ).slice(0, 5);
}

function inferFoodTags(text, hashtags = []) {
  const haystack = `${text || ""} ${hashtags.join(" ")}`;
  const inferred = FOOD_TAG_PATTERNS
    .filter(([, pattern]) => pattern.test(haystack))
    .map(([tag]) => tag);
  const cleanHashtags = hashtags.filter((tag) => tag.length <= 12 && !/作品|视频|分享|探店/.test(tag));
  return uniqueStrings([...inferred, ...cleanHashtags]).slice(0, 4);
}

function inferCity(text) {
  return CITY_NAMES.find((city) => String(text || "").includes(city)) || "";
}

function normalizeDouyinStoreName(value) {
  return String(value || "")
    .replace(/^\s*\d+\s*[-–—、.．]?\s*/, "")
    .trim();
}

function inferDianpingCity(input) {
  try {
    return DIANPING_CITY_ID_MAP.get(new URL(normalizeUrl(input)).searchParams.get("cityid") || "") || "";
  } catch {
    return "";
  }
}

function normalizeResolvedUrl(value, expectedPlatform) {
  if (!value) return "";
  try {
    const normalized = normalizeUrl(value);
    return inferPlatform(normalized) === expectedPlatform ? normalized : "";
  } catch {
    return "";
  }
}

function buildSourceKey(platform, value) {
  try {
    const url = new URL(value);
    let match = null;
    if (platform === "大众点评") {
      match = /\/shop(?:info)?\/([^/?]+)/.exec(url.pathname);
      return match ? `dianping:store:${match[1]}` : "";
    }
    if (platform === "小红书") {
      match = /\/(?:explore|discovery\/item)\/([^/?]+)/.exec(url.pathname);
      return match ? `xiaohongshu:note:${match[1]}` : "";
    }
    if (platform === "抖音") {
      match = /\/(?:video|note)\/([^/?]+)/.exec(url.pathname);
      return match ? `douyin:content:${match[1]}` : "";
    }
    if (platform === "微博") {
      match = /\/(\d+)\/?$/.exec(url.pathname);
      return match ? `weibo:post:${match[1]}` : "";
    }
  } catch {
    return "";
  }
  return "";
}

function textBeforeFirstUrl(input) {
  return String(input || "").split(/https?:\/\//i)[0]?.trim() || "";
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

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}
