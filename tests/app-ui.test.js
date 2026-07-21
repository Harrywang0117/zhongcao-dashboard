import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const serverSource = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
const serviceWorkerSource = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const packageSource = readFileSync(new URL("../package.json", import.meta.url), "utf8");

test("React app mounts through the Vite entrypoint", () => {
  assert.match(indexSource, /id="root"/);
  assert.match(indexSource, /src="\/src\/main\.jsx"/);
  assert.match(mainSource, /createRoot/);
  assert.match(mainSource, /<App \/>/);
});

test("Tailwind is the app styling layer", () => {
  assert.match(stylesSource, /@import "tailwindcss"/);
  assert.match(stylesSource, /@theme/);
  assert.match(stylesSource, /\.panel/);
  assert.match(stylesSource, /\.bottom-nav/);
});

test("server serves the built React app from the shared source modules", () => {
  assert.match(packageSource, /"build":\s*"vite build"/);
  assert.match(packageSource, /"start":\s*"npm run build && node server\.mjs"/);
  assert.match(serverSource, /new URL\("\.\/dist\/", import\.meta\.url\)/);
  assert.match(serverSource, /from "\.\/src\/lib\/link-preview\.js"/);
  assert.match(serverSource, /POST" && requestUrl\.pathname === "\/api\/link-preview"/);
});

test("legacy public app shell and duplicated public libs are removed", () => {
  assert.equal(existsSync(new URL("../public/index.html", import.meta.url)), false);
  assert.equal(existsSync(new URL("../public/app.js", import.meta.url)), false);
  assert.equal(existsSync(new URL("../public/styles.css", import.meta.url)), false);
  assert.equal(existsSync(new URL("../public/lib/domain.js", import.meta.url)), false);
  assert.equal(existsSync(new URL("../public/lib/link-preview.js", import.meta.url)), false);
  assert.equal(existsSync(new URL("../public/lib/storage.js", import.meta.url)), false);
});

test("React UI keeps accessible navigation and icon labels", () => {
  assert.match(appSource, /aria-label="主导航"/);
  assert.match(appSource, /aria-current=\{active \? "page" : undefined\}/);
  assert.match(appSource, /aria-label="去收件箱保存新线索"/);
  assert.match(appSource, /label="重新解析线索"/);
  assert.match(appSource, /移入回收站/);
  assert.match(appSource, /label="撤销轻反馈"/);
});

test("forms preserve mobile touch and iOS input zoom fixes", () => {
  assert.match(stylesSource, /font-size:\s*16px/);
  assert.match(stylesSource, /min-height:\s*44px/);
  assert.match(stylesSource, /touch-action:\s*manipulation/);
  assert.match(stylesSource, /:focus-visible/);
});

test("quick save accepts platform share text and exposes pending state", () => {
  assert.doesNotMatch(appSource, /type="url"[^>]*name="url"/);
  assert.match(appSource, /粘贴分享文案或链接/);
  assert.match(appSource, /pendingQuickSave/);
  assert.match(appSource, /disabled=\{pending\}/);
  assert.match(appSource, /保存中\.\.\./);
});

test("source links remain clickable and weibo uses an honest fallback dialog", () => {
  assert.match(appSource, /target="_blank"/);
  assert.match(appSource, /rel="noopener noreferrer"/);
  assert.match(appSource, /打开\{label === "未知平台" \? "原" : label\}内容/);
  assert.match(appSource, /微博链接暂不支持自动解析/);
  assert.match(appSource, /这里不会尝试从微信直接唤起大众点评/);
  assert.match(appSource, /先保存微博链接/);
});

test("quick save writes a required local added-by value", () => {
  assert.match(appSource, /AddedBySegmentedControl/);
  assert.match(appSource, /ACTIVE_ADDED_BY_OPTIONS/);
  assert.match(appSource, /zhongcao-last-added-by/);
  assert.match(appSource, /请选择添加人/);
  assert.match(appSource, /createInboxItem\(\{ preview, fallbackTitle, note: values\.note \|\| "", addedBy \}\)/);
});

test("runtime UI state is controlled by React state", () => {
  assert.match(appSource, /useState\("inbox"\)/);
  assert.match(appSource, /useState\(\[\]\)/);
  assert.match(appSource, /setPlanDates/);
  assert.match(appSource, /setVisitDates/);
  assert.match(appSource, /setRescheduleDates/);
  assert.match(appSource, /syncOpenPanel/);
});

test("cover images avoid referrer leakage and decode asynchronously", () => {
  assert.match(appSource, /referrerPolicy="no-referrer"/);
  assert.match(appSource, /decoding="async"/);
  assert.match(appSource, /width="320"/);
  assert.match(appSource, /height="232"/);
});

test("missing covers expose a manual upload fallback and local cover APIs", () => {
  assert.match(appSource, /function CoverUploadControl/);
  assert.match(appSource, /accept="image\/jpeg,image\/png,image\/webp,image\/avif,image\/gif"/);
  assert.match(appSource, /从相册添加封面/);
  assert.match(appSource, /\/api\/cover-upload/);
  assert.match(appSource, /\/api\/cover-fetch/);
  assert.match(appSource, /imageFailureReason/);
  assert.match(serverSource, /requestUrl\.pathname\.startsWith\("\/covers\/"\)/);
});

test("calendar date buttons have descriptive accessible names", () => {
  assert.match(appSource, /formatCalendarDateLabel/);
  assert.match(appSource, /aria-label=\{formatCalendarDateLabel/);
  assert.match(appSource, /已有计划/);
});

test("wishlist tag filtering uses a quick chip row driven by real tags", () => {
  assert.match(appSource, /ChipFilters/);
  assert.match(appSource, /topTagNames/);
  assert.match(appSource, /filter-chip/);
  assert.match(appSource, /filterByTags/);
  assert.match(appSource, /setSelectedTags\(selectedTags\.includes\(tag\)/);
});

test("wishlist filters and cards expose added-by state", () => {
  assert.match(appSource, /filterByAddedBy/);
  assert.match(appSource, /addedByFilter/);
  assert.match(appSource, /setAddedByFilter\("xiaowang"\)/);
  assert.match(appSource, /setAddedByFilter\("xiaozhang"\)/);
  assert.match(appSource, /\$\{addedByLabel\(item\.addedBy\)\}添加/);
});

test("wishlist keeps a single feature card plus compact place cards", () => {
  assert.match(appSource, /FeatureCard/);
  assert.match(appSource, /PlaceCard/);
  assert.match(appSource, /PlanRow/);
  assert.match(appSource, /安排日期/);
  assert.match(stylesSource, /\.feature-card/);
  assert.match(stylesSource, /\.feature-cta/);
  assert.match(stylesSource, /\.place-card/);
});

test("store and dish edit forms can correct added-by", () => {
  assert.match(appSource, /name="addedBy"/);
  assert.match(appSource, /EDITABLE_ADDED_BY_OPTIONS/);
  assert.match(appSource, /addedBy: values\.addedBy/);
  assert.match(appSource, /当前支持固定添加人：小王 \/ 小张/);
  assert.match(stylesSource, /\.added-by-chip/);
});

test("dense tag displays are compressed in cards and grouped in profile", () => {
  assert.match(appSource, /tagNames\.slice\(0, 2\)/);
  assert.match(appSource, /item\.tagNames\.length - 2/);
  assert.match(appSource, /chip-overflow/);
  assert.match(appSource, /tags\.length} 个/);
  assert.match(stylesSource, /\.chip-overflow/);
});

test("toast announces status changes and keeps undo visible longer", () => {
  assert.match(appSource, /role="status"/);
  assert.match(appSource, /aria-live="polite"/);
  assert.match(appSource, /undoPayload \? 7000 : 2400/);
  assert.match(appSource, /onUndo/);
});

test("reduced motion is respected", () => {
  assert.match(stylesSource, /prefers-reduced-motion:\s*reduce/);
});

test("service worker caches only same-origin static GET requests", () => {
  assert.match(serviceWorkerSource, /requestUrl\.origin !== self\.location\.origin/);
  assert.match(serviceWorkerSource, /requestUrl\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(serviceWorkerSource, /requestUrl\.pathname === "\/healthz"/);
  assert.match(serviceWorkerSource, /if \(response\.ok\)/);
  assert.match(serviceWorkerSource, /event\.request\.mode === "navigate"/);
});

test("profile can download a migration-ready local data backup", () => {
  assert.match(appSource, /createStateBackup/);
  assert.match(appSource, /new Blob\(\[backup\.content\]/);
  assert.match(appSource, /link\.download = backup\.filename/);
  assert.match(appSource, /导出 JSON 备份/);
});
