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
  assert.match(packageSource, /"start":\s*"node server\.mjs"/);
  assert.match(packageSource, /"db:migrate":\s*"node server\/migrate\.mjs"/);
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
  assert.match(stylesSource, /touch-action:\s*manipulation/);
  assert.match(stylesSource, /:focus-visible/);

  // Touch-target floor: any explicit px min-height on a control must clear
  // 44px (0 is allowed — it only ever resets an inherited value).
  const minHeights = [...stylesSource.matchAll(/min-height:\s*(\d+)px/g)].map((match) =>
    Number(match[1])
  );
  assert.ok(minHeights.length > 0, "expected explicit px min-height declarations");
  const belowFloor = minHeights.filter((value) => value > 0 && value < 44);
  assert.deepEqual(belowFloor, [], `min-height below the 44px touch floor: ${belowFloor}`);
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
  assert.match(
    appSource,
    /createInboxItem\(\{\s*preview,\s*fallbackTitle,\s*note: values\.note \|\| "",\s*addedBy\s*\}\)/
  );
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

test("wishlist filters live in a sheet and only active ones take list space", () => {
  // 旧版把添加人和标签 chip 全部常驻在列表上方，折成三行吃掉 150px。
  // 现在控件在 sheet 里，列表上方只留搜索 + 筛选按钮，外加已选中的 token。
  assert.match(appSource, /function FilterBar\(/);
  assert.match(appSource, /function FilterSheet\(/);
  assert.doesNotMatch(appSource, /function ChipFilters\(/);
  assert.match(appSource, /tagNamesByFrequency/);
  assert.doesNotMatch(appSource, /topTagNames\(base,\s*4\)/);
  assert.match(appSource, /更多 \$\{hiddenTagCount\}/);
  assert.match(appSource, /filter-chip/);
  assert.match(appSource, /filterByTags/);
  assert.match(appSource, /setSelectedTags\(selectedTags\.includes\(tag\)/);
  assert.match(stylesSource, /\.filter-stack/);
  assert.match(stylesSource, /\.filter-more/);
  assert.match(stylesSource, /\.filter-token/);

  // sheet 是模态：焦点进出、Escape 关闭、挂到 body 不受祖先 transform 影响
  assert.match(appSource, /createPortal/);
  assert.match(appSource, /role="dialog"/);
  assert.match(appSource, /aria-modal="true"/);
  assert.match(appSource, /event\.key === "Escape"/);
  assert.match(appSource, /restoreFocus/);
  assert.match(appSource, /aria-label=\{`移除筛选 \$\{label\}`\}/);
});

test("the top bar shows a real count, never a decorative subtitle", () => {
  // 旧版顶栏「大标题 + 一句情绪文案」会和正文区块标题重复，
  // 收件箱页甚至把同一句话说了两遍。
  assert.match(appSource, /function topBarCount\(/);
  assert.doesNotMatch(appSource, /function topBarSubtitle\(/);
  assert.doesNotMatch(appSource, /条灵感，等一次出发/);
  assert.doesNotMatch(appSource, /给想去的地方安排日期/);
  assert.match(stylesSource, /\.app-bar-count/);
  assert.match(stylesSource, /height:\s*56px/);
});

test("shared PostgreSQL state is visible: sync status, remote edits, offline", () => {
  // 迁到共享库之后，409 重放会把对方的状态换进当前视图。
  // 以前这一步是无声的；现在有常驻同步点和一条要人点掉的提示条。
  assert.match(appSource, /function SyncDot\(/);
  assert.match(appSource, /function RemoteChangeBar\(/);
  assert.match(appSource, /setSyncStatus\("saving"\)/);
  assert.match(appSource, /setSyncStatus\("synced"\)/);
  assert.match(appSource, /setRemoteChange\(\{ at: Date\.now\(\) \}\)/);
  assert.match(appSource, /addEventListener\("offline", goOffline\)/);
  assert.match(appSource, /removeEventListener\("offline", goOffline\)/);
  assert.match(appSource, /navigator\.onLine === false/);
  assert.match(appSource, /aria-live="polite"/);
  assert.match(stylesSource, /\.sync-dot/);
  assert.match(stylesSource, /\.remote-bar/);
});

test("list rows stay dense and keep every field they used to show", () => {
  // 行高 138 → 97：缩略图 130 → 76，添加人从 76px 胶囊变 22px 字圆点。
  // 完整说法仍然留在 title 和 sr-only 里，读屏拿得到。
  assert.match(stylesSource, /grid-template-columns:\s*76px minmax\(0, 1fr\) auto auto/);
  assert.match(stylesSource, /\.place-thumb \{[^}]*h-\[76px\]/);
  assert.match(stylesSource, /\.who-dot/);
  assert.match(appSource, /className=\{`who-dot who-dot-\$\{item\.addedBy \|\| "unknown"\}`\}/);
  assert.match(appSource, /title=\{contributor\}/);
  assert.match(appSource, /<span className="sr-only">\{contributor\}<\/span>/);
});

test("the inbox main path is link plus added-by plus save", () => {
  // PRD 的硬目标是 15 秒存一条；标题和备注折进 details，默认不占位置。
  assert.match(appSource, /className="optional-fields"/);
  assert.match(appSource, /补充店名、备注（可选）/);
  assert.match(stylesSource, /\.optional-fields/);
  const formStart = appSource.indexOf("function QuickSaveForm(");
  const form = appSource.slice(formStart, appSource.indexOf("function InboxItem("));
  // 主按钮必须排在可选字段之前
  assert.ok(form.indexOf("保存线索") < form.indexOf("optional-fields"));
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

test("wishlist sorting copy matches the active timestamp", () => {
  const sortHeadingIndex = appSource.indexOf("{sortHeading}</h2>");
  const featureCardIndex = appSource.indexOf("<FeatureCard type={featured.type}");

  assert.match(appSource, /useState\("createdAt"\)/);
  assert.match(appSource, /sortBy === "createdAt" \? "最近收藏" : "最近更新"/);
  assert.match(appSource, /当前按\$\{sortLabel\}排序，切换到\$\{nextSortLabel\}/);
  assert.match(appSource, /type === "store" \? "店铺" : "菜品"/);
  assert.ok(sortHeadingIndex >= 0 && sortHeadingIndex < featureCardIndex);
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
  const toastAnimation = stylesSource.slice(
    stylesSource.indexOf("@keyframes zc-toast"),
    stylesSource.indexOf("@keyframes zc-drawer")
  );

  assert.match(appSource, /role="status"/);
  assert.match(appSource, /aria-live="polite"/);
  assert.match(appSource, /undoPayload \? 7000 : 2400/);
  assert.match(appSource, /onUndo/);
  assert.match(toastAnimation, /transform:\s*translateY\(10px\)/);
  assert.doesNotMatch(toastAnimation, /translate\(-50%/);
});

test("reduced motion is respected", () => {
  assert.match(stylesSource, /prefers-reduced-motion:\s*reduce/);
});

test("service worker caches only same-origin static GET requests", () => {
  assert.match(serviceWorkerSource, /requestUrl\.origin !== self\.location\.origin/);
  assert.match(serviceWorkerSource, /requestUrl\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(serviceWorkerSource, /requestUrl\.pathname === "\/healthz"/);
  assert.match(serviceWorkerSource, /requestUrl\.pathname === "\/readyz"/);
  assert.match(serviceWorkerSource, /if \(response\.ok\)/);
  assert.match(serviceWorkerSource, /event\.request\.mode === "navigate"/);
});

test("profile can download a migration-ready local data backup", () => {
  assert.match(appSource, /createStateBackup/);
  assert.match(appSource, /new Blob\(\[backup\.content\]/);
  assert.match(appSource, /link\.download = backup\.filename/);
  assert.match(appSource, /导出 JSON 备份/);
  assert.match(appSource, /window\.confirm\("确认清空共享收藏库/);
});
