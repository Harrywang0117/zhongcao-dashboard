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
