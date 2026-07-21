import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPreviewFromUrl,
  inferPlatform,
  normalizeUrl
} from "../src/lib/link-preview.js";

test("normalizes urls by trimming and removing hashes", () => {
  assert.equal(
    normalizeUrl(" https://www.dianping.com/shop/123#comments "),
    "https://www.dianping.com/shop/123"
  );
  assert.equal(
    normalizeUrl("http://xhslink.com/o/8VMYfNafDQA"),
    "https://xhslink.com/o/8VMYfNafDQA"
  );
});

test("extracts supported urls from platform share text", () => {
  assert.equal(
    normalizeUrl("复制这条信息，打开【小红书】看看 https://xhslink.com/a/abc123，更多内容"),
    "https://xhslink.com/a/abc123"
  );
  assert.equal(
    normalizeUrl("7.89 复制打开抖音，看看这个视频 https://v.douyin.com/abc123/"),
    "https://v.douyin.com/abc123/"
  );
  assert.equal(
    normalizeUrl("【凤隐·炉端烧鸟居酒场】 ★★★★☆ 4.6 ¥136/人 天府新区 日本料理 兴隆街道 https://m.dianping.com/shopinfo/lahzE4c5VaHE3zds?msource=Appshare2021&utm_source=shop_share&shoptype=10&shopcategoryid=224&cityid=1609&isoversea=0"),
    "https://m.dianping.com/shopinfo/lahzE4c5VaHE3zds?msource=Appshare2021&shoptype=10&shopcategoryid=224&cityid=1609&isoversea=0"
  );
});

test("infers supported Chinese food discovery platforms", () => {
  assert.equal(inferPlatform("https://www.dianping.com/shop/123"), "大众点评");
  assert.equal(inferPlatform("复制后打开大众点评 http://dpurl.cn/abc123"), "大众点评");
  assert.equal(inferPlatform("https://www.xiaohongshu.com/explore/abc"), "小红书");
  assert.equal(inferPlatform("https://v.douyin.com/abc/"), "抖音");
  assert.equal(inferPlatform("https://weibo.com/5244108114/5322166456299780"), "微博");
});

test("builds a successful preview for supported urls", () => {
  const preview = buildPreviewFromUrl("https://www.xiaohongshu.com/explore/abc", {
    title: "静安寺新开的牛油火锅"
  });

  assert.equal(preview.status, "success");
  assert.equal(preview.platform, "小红书");
  assert.equal(preview.contentType, "note");
  assert.ok(preview.normalizedUrl.includes("xiaohongshu.com"));
});

test("treats dianping shopinfo share links as stores", () => {
  const preview = buildPreviewFromUrl("【凤隐·炉端烧鸟居酒场】 ★★★★☆ 4.6 ¥136/人 天府新区 日本料理 兴隆街道 https://m.dianping.com/shopinfo/lahzE4c5VaHE3zds?msource=Appshare2021&utm_source=shop_share&shoptype=10&shopcategoryid=224&cityid=1609&isoversea=0");

  assert.equal(preview.platform, "大众点评");
  assert.equal(preview.contentType, "store");
  assert.equal(preview.status, "success");
});

test("parses dianping share text into suggested store fields", () => {
  const preview = buildPreviewFromUrl("【凤隐·炉端烧鸟居酒场】 ★★★★☆ 4.6 ¥136/人 天府新区 日本料理 兴隆街道 https://m.dianping.com/shopinfo/lahzE4c5VaHE3zds?msource=Appshare2021&utm_source=shop_share&shoptype=10&shopcategoryid=224&cityid=1609&isoversea=0");

  assert.equal(preview.title, "凤隐·炉端烧鸟居酒场");
  assert.deepEqual(preview.suggested, {
    storeName: "凤隐·炉端烧鸟居酒场",
    city: "成都",
    businessDistrict: "天府新区",
    addressNote: "兴隆街道",
    tagNames: ["日料"],
    note: "评分 4.6，人均 ¥136/人，日本料理"
  });
});

test("keeps dianping share store names when fetched metadata is generic", () => {
  const preview = buildPreviewFromUrl(
    "【凤隐·炉端烧鸟居酒场】 ★★★★☆ 4.6 ¥136/人 天府新区 日本料理 兴隆街道 https://m.dianping.com/shopinfo/lahzE4c5VaHE3zds?msource=Appshare2021&utm_source=shop_share&shoptype=10&shopcategoryid=224&cityid=1609&isoversea=0",
    { title: "大众点评" }
  );

  assert.equal(preview.status, "success");
  assert.equal(preview.title, "凤隐·炉端烧鸟居酒场");
});

test("parses dianping share text without rating and average price", () => {
  const preview = buildPreviewFromUrl("【凤隐·炉端烧鸟居酒场】 天府新区 日本料理 兴隆街道 https://m.dianping.com/shopinfo/lahzE4c5VaHE3zds");

  assert.equal(preview.title, "凤隐·炉端烧鸟居酒场");
  assert.deepEqual(preview.suggested, {
    storeName: "凤隐·炉端烧鸟居酒场",
    city: "",
    businessDistrict: "天府新区",
    addressNote: "兴隆街道",
    tagNames: ["日料"],
    note: "日本料理"
  });
});

test("builds previews from full share text while preserving original text", () => {
  const preview = buildPreviewFromUrl("复制这条信息，打开【小红书】看看 https://xhslink.com/a/abc123，更多内容");

  assert.equal(preview.status, "partial");
  assert.equal(preview.platform, "小红书");
  assert.equal(preview.originalUrl, "复制这条信息，打开【小红书】看看 https://xhslink.com/a/abc123，更多内容");
  assert.equal(preview.normalizedUrl, "https://xhslink.com/a/abc123");
});

test("parses douyin place share text into suggested store fields", () => {
  const preview = buildPreviewFromUrl("4- 虾子娃娃虾蟹馆(东光店)，人均 ¥129，小龙虾，戳链接查看地点详情 https://v.douyin.com/g-WxyAzu7pQ/ 1@0.com :3pm");

  assert.equal(preview.status, "success");
  assert.equal(preview.platform, "抖音");
  assert.equal(preview.contentType, "store");
  assert.equal(preview.title, "虾子娃娃虾蟹馆(东光店)");
  assert.deepEqual(preview.suggested, {
    storeName: "虾子娃娃虾蟹馆(东光店)",
    city: "",
    businessDistrict: "",
    addressNote: "",
    tagNames: ["小龙虾"],
    note: "人均 ¥129/人，小龙虾"
  });
});

test("parses ordinary douyin work text without inventing a store name", () => {
  const preview = buildPreviewFromUrl("7.61 复制打开抖音，看看【鹿森森和大一欧巴的作品】开了14年的韩国烤肉老店，太夯了！！ # 韩餐 #... https://v.douyin.com/d3ENJCRrM-I/ Y@z.tr 04/04 :8pm qRk:/");

  assert.equal(preview.status, "partial");
  assert.equal(preview.failureCode, "needs_review");
  assert.equal(preview.authorName, "鹿森森和大一欧巴");
  assert.equal(preview.title, "开了14年的韩国烤肉老店，太夯了！！ # 韩餐 #...");
  assert.equal(preview.sourceDescription, preview.title);
  assert.equal(preview.suggested.storeName, "");
  assert.ok(preview.suggested.tagNames.includes("韩餐"));
  assert.equal(preview.sharedUrl, "https://v.douyin.com/d3ENJCRrM-I/");
});

test("parses xiaohongshu descriptions and food clues from http short links", () => {
  const preview = buildPreviewFromUrl("拜见成都九眼桥冒菜之王！！！！！！！！ 老小区旁的... http://xhslink.com/o/3QES4XLwaMq 直达【小红书】看看这篇分享~");

  assert.equal(preview.status, "partial");
  assert.equal(preview.platform, "小红书");
  assert.equal(preview.failureCode, "needs_review");
  assert.equal(preview.sharedUrl, "https://xhslink.com/o/3QES4XLwaMq");
  assert.equal(preview.sourceDescription, "拜见成都九眼桥冒菜之王！！！！！！！！ 老小区旁的...");
  assert.equal(preview.suggested.city, "成都");
  assert.deepEqual(preview.suggested.tagNames, ["冒菜"]);
});

test("fills tested dianping city ids and category tags", () => {
  const preview = buildPreviewFromUrl("【温野菜涮涮锅(万象城店)】 ★★★★☆ 4.5 ¥181/人 万年场/万象城 日式自助 万象城-B馆-L3-341 https://m.dianping.com/shopinfo/H7dlE8WuH0Zrx792?shopcategoryid=25151&cityid=8");

  assert.equal(preview.status, "success");
  assert.equal(preview.suggested.city, "成都");
  assert.deepEqual(preview.suggested.tagNames, ["日料"]);
});

test("keeps the original dianping shop id when metadata is blocked by login", () => {
  const url = "https://m.dianping.com/shopinfo/k30Ld5XSgFERQgYE?cityid=1609";
  const preview = buildPreviewFromUrl(`【净味鲜烧烤(天府大悦城店)】 ${url}`, {
    metadataStatus: "blocked",
    imageStatus: "blocked",
    imageSource: "none",
    failureCode: "platform_login_required",
    failureReason: "大众点评向服务器返回了登录页面，可手动添加封面",
    imageFailureCode: "platform_login_required",
    imageFailureReason: "大众点评向服务器返回了登录页面，可手动添加封面",
    observedUrl: "https://m.dianping.com/shopinfo/login-redirect"
  });

  assert.equal(preview.status, "success");
  assert.equal(preview.normalizedUrl, url);
  assert.equal(preview.sourceKey, "dianping:store:k30Ld5XSgFERQgYE");
  assert.equal(preview.metadataStatus, "blocked");
  assert.equal(preview.imageStatus, "blocked");
  assert.equal(preview.imageUrl, "");
});

test("recognizes weibo as an unsupported source while preserving its stable id", () => {
  const preview = buildPreviewFromUrl("https://weibo.com/5244108114/5322166456299780");

  assert.equal(preview.status, "failed");
  assert.equal(preview.platform, "微博");
  assert.equal(preview.contentType, "post");
  assert.equal(preview.failureCode, "unsupported_platform");
  assert.equal(preview.sourceKey, "weibo:post:5322166456299780");
  assert.equal(preview.normalizedUrl, "https://weibo.com/5244108114/5322166456299780");
});

test("uses a resolved platform url and content id for stable deduplication", () => {
  const preview = buildPreviewFromUrl("https://xhslink.com/a/abc123", {
    title: "静安寺新开的牛油火锅",
    resolvedUrl: "https://www.xiaohongshu.com/explore/note-123"
  });

  assert.equal(preview.sharedUrl, "https://xhslink.com/a/abc123");
  assert.equal(preview.resolvedUrl, "https://www.xiaohongshu.com/explore/note-123");
  assert.equal(preview.normalizedUrl, preview.resolvedUrl);
  assert.equal(preview.sourceKey, "xiaohongshu:note:note-123");
});

test("marks supported urls without meaningful title as partial", () => {
  const emptyTitlePreview = buildPreviewFromUrl("https://www.xiaohongshu.com/explore/abc");
  const platformTitlePreview = buildPreviewFromUrl("https://www.xiaohongshu.com/explore/abc", {
    title: "小红书"
  });

  assert.equal(emptyTitlePreview.status, "partial");
  assert.equal(platformTitlePreview.status, "partial");
  assert.match(platformTitlePreview.failureReason, /标题/);
});

test("returns a failed preview for invalid urls", () => {
  const preview = buildPreviewFromUrl("not a url");

  assert.equal(preview.status, "failed");
  assert.equal(preview.platform, "未知平台");
  assert.match(preview.failureReason, /无法识别/);
});
