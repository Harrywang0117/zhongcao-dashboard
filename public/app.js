import {
  activeItems,
  applyInboxReparsePreview,
  createCustomTag,
  createInboxItem,
  createPlan,
  createVisitRecord,
  filterByTags,
  findPotentialDuplicateStores,
  getTrashItems,
  mergeInboxItemIntoStore,
  organizeInboxItem,
  restoreTargetToWishlist,
  restoreItem,
  searchCollections,
  softDeleteItem,
  updateDish,
  updatePlanStatus,
  updateStore
} from "./lib/domain.js";
import { buildPreviewFromUrl, platformInitial } from "./lib/link-preview.js";
import { loadState, saveState } from "./lib/storage.js";

const TAB_LABELS = {
  inbox: "收件箱",
  wishlist: "想去",
  calendar: "日历",
  visited: "已去过",
  profile: "我的"
};

const STATUS_LABELS = {
  want: "想去",
  planned: "已计划",
  visited: "已去过",
  eaten: "已吃过",
  not_interested: "不想去了"
};

const FEEDBACK_LABELS = {
  want_again: "还想去",
  ok: "一般",
  no_again: "不再去"
};

const app = document.querySelector("#app");
const ui = {
  tab: "inbox",
  viewMode: "grid",
  query: "",
  selectedTags: new Set(),
  toast: "",
  undo: null
};

let state = await loadState();

render();
bindEvents();
registerServiceWorker();

function bindEvents() {
  app.addEventListener("click", handleClick);
  app.addEventListener("submit", handleSubmit);
  app.addEventListener("input", handleInput);
}

async function handleSubmit(event) {
  const form = event.target.closest("form");
  if (!form) return;

  if (form.dataset.form === "quick-save") {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    await saveInboxFromForm(values);
  }

  if (form.dataset.form === "add-tag") {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    createCustomTag(state, values.name, values.group || "custom");
    await persist("标签已添加");
  }

  if (form.dataset.form === "edit-store") {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      updateStore(state, form.dataset.id, {
        name: values.name,
        city: values.city,
        businessDistrict: values.businessDistrict,
        addressNote: values.addressNote,
        tagNames: splitTags(values.tags),
        coverImageUrl: values.coverImageUrl,
        note: values.note
      });
      await persist("店铺已更新");
    } catch (error) {
      showToast(error.message);
    }
  }

  if (form.dataset.form === "edit-dish") {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      updateDish(state, form.dataset.id, {
        name: values.name,
        storeId: values.storeId,
        tagNames: splitTags(values.tags),
        coverImageUrl: values.coverImageUrl,
        note: values.note
      });
      await persist("菜品已更新");
    } catch (error) {
      showToast(error.message);
    }
  }
}

async function handleClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const action = button.dataset.action;

  if (action === "tab") {
    ui.tab = button.dataset.tab;
    render();
    return;
  }

  if (action === "view-mode") {
    ui.viewMode = button.dataset.mode;
    render();
    return;
  }

  if (action === "toggle-tag") {
    const tag = button.dataset.tag;
    ui.selectedTags.has(tag) ? ui.selectedTags.delete(tag) : ui.selectedTags.add(tag);
    render();
    return;
  }

  if (action === "clear-filters") {
    ui.query = "";
    ui.selectedTags.clear();
    render();
    return;
  }

  if (action === "organize-inbox") {
    await organizeFromButton(button);
    return;
  }

  if (action === "reparse-inbox") {
    await reparseInboxItem(button.dataset.id);
    return;
  }

  if (action === "soft-delete") {
    const undo = {
      collection: button.dataset.collection,
      id: button.dataset.id
    };
    softDeleteItem(state, button.dataset.collection, button.dataset.id);
    await persist("已移入回收站", undo);
    return;
  }

  if (action === "undo-last") {
    await undoLastAction();
    return;
  }

  if (action === "restore") {
    restoreItem(state, button.dataset.collection, button.dataset.id);
    await persist("已恢复");
    return;
  }

  if (action === "restore-target") {
    restoreTargetToWishlist(state, button.dataset.type, button.dataset.id);
    await persist("已放回想去");
    return;
  }

  if (action === "schedule") {
    await scheduleTarget(button.dataset.type, button.dataset.id);
    return;
  }

  if (action === "visit") {
    await visitTarget(button.dataset.type, button.dataset.id, button.dataset.feedback, button.dataset.date);
    return;
  }

  if (action === "plan-update") {
    await updatePlanFromButton(button);
  }
}

function handleInput(event) {
  const input = event.target;
  if (input.dataset.ui === "search") {
    const cursor = input.selectionStart;
    ui.query = input.value;
    render();
    const nextInput = app.querySelector('[data-ui="search"]');
    nextInput?.focus();
    nextInput?.setSelectionRange(cursor, cursor);
  }
}

async function saveInboxFromForm(values) {
  const sourceUrl = String(values.url || "").trim();
  const fallbackTitle = String(values.fallbackTitle || "").trim();
  if (!sourceUrl) {
    showToast("先粘贴一个链接");
    return;
  }

  try {
    const preview = await requestLinkPreview(sourceUrl);
    const item = createInboxItem({
      preview,
      fallbackTitle,
      note: values.note || ""
    });
    state.inboxItems.unshift(item);
    await persist(preview.status === "success" ? "已保存到收件箱" : "已补充关键信息并保存");
  } catch (error) {
    showToast(error.message);
  }
}

async function organizeFromButton(button) {
  const form = button.closest("form");
  const values = Object.fromEntries(new FormData(form).entries());
  const inboxId = form.dataset.inboxId;
  const template = button.dataset.template;
  const tagNames = splitTags(values.tags);
  const storeName = String(values.storeName || "").trim();
  const businessDistrict = String(values.businessDistrict || "").trim();

  try {
    if (template.includes("store") && storeName) {
      const duplicate = findPotentialDuplicateStores(state, storeName, businessDistrict)[0];
      if (duplicate && window.confirm(`发现疑似重复店铺「${duplicate.name}」，要合并来源吗？`)) {
        mergeInboxItemIntoStore(state, inboxId, duplicate.id, {
          dishName: template === "store-dish" ? values.dishName : "",
          tagNames,
          note: values.note || ""
        });
        await persist("已合并到已有店铺");
        return;
      }
    }

    organizeInboxItem(state, inboxId, {
      template,
      storeName,
      dishName: values.dishName,
      city: values.city,
      businessDistrict,
      addressNote: values.addressNote,
      tagNames,
      note: values.note
    });
    await persist(template === "hold" ? "已暂留线索" : "已整理完成");
  } catch (error) {
    showToast(error.message);
  }
}

async function reparseInboxItem(id) {
  const item = state.inboxItems.find((candidate) => candidate.id === id);
  if (!item) return;

  const preview = await requestLinkPreview(item.sourceUrl || item.normalizedUrl);
  applyInboxReparsePreview(item, preview);

  await persist(preview.status === "success" ? "重新解析成功" : "仍需补充关键信息");
}

async function scheduleTarget(type, id) {
  const input = app.querySelector(`[data-plan-date="${type}:${id}"]`);
  const date = input?.value;
  if (!date) {
    showToast("请选择计划日期");
    return;
  }

  const alreadyScheduled = state.plans.some(
    (plan) =>
      !plan.deletedAt &&
      plan.targetType === type &&
      plan.targetId === id &&
      plan.date === date &&
      plan.status === "scheduled"
  );
  createPlan(state, { targetType: type, targetId: id, date });
  await persist(alreadyScheduled ? "这天已经安排过" : "已加入日历");
}

async function visitTarget(type, id, feedback, dateOverride = "") {
  const input = app.querySelector(`[data-visit-date="${type}:${id}"]`);
  const date = input?.value || dateOverride || today();
  createVisitRecord(state, {
    storeId: type === "store" ? id : null,
    dishId: type === "dish" ? id : null,
    date,
    feedback
  });
  await persist("已记录轻反馈");
}

async function updatePlanFromButton(button) {
  const action = button.dataset.planAction;
  const id = button.dataset.id;
  const input = app.querySelector(`[data-reschedule-date="${id}"]`);
  const nextDate = input?.value;

  try {
    updatePlanStatus(state, id, action, nextDate);
    await persist("计划已更新");
  } catch (error) {
    showToast(error.message);
  }
}

async function undoLastAction() {
  const undo = ui.undo;
  if (!undo) return;

  try {
    ui.undo = null;
    restoreItem(state, undo.collection, undo.id);
    await persist("已撤销");
  } catch (error) {
    showToast(error.message);
  }
}

async function requestLinkPreview(url) {
  try {
    const response = await fetch("/api/link-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });
    if (!response.ok) throw new Error("接口不可用");
    return await response.json();
  } catch {
    return buildPreviewFromUrl(url);
  }
}

async function persist(message = "", undo = null) {
  state = await saveState(state);
  render();
  if (message) showToast(message, undo);
}

function render() {
  app.innerHTML = `
    <header class="topbar">
      <div>
        <p class="eyebrow">个人种草决策库</p>
        <h1>${TAB_LABELS[ui.tab]}</h1>
      </div>
      <div class="status-pill">待整理 ${pendingInboxItems().length}</div>
    </header>
    <main class="screen">${renderScreen()}</main>
    ${renderBottomNav()}
    ${ui.toast ? renderToast() : ""}
  `;
  bindImageFallbacks();
}

function renderScreen() {
  if (ui.tab === "inbox") return renderInbox();
  if (ui.tab === "wishlist") return renderWishlist();
  if (ui.tab === "calendar") return renderCalendar();
  if (ui.tab === "visited") return renderVisited();
  return renderProfile();
}

function renderInbox() {
  const items = pendingInboxItems();

  return `
    <section class="quick-panel">
      <form data-form="quick-save" class="stack">
        <label>
          <span>种草链接</span>
          <input name="url" type="url" inputmode="url" autocomplete="off" placeholder="粘贴大众点评、小红书或抖音链接…" />
        </label>
        <label>
          <span>标题/店名/菜名</span>
          <input name="fallbackTitle" autocomplete="off" placeholder="解析失败时必填，也可以提前写…" />
        </label>
        <label>
          <span>备注</span>
          <textarea name="note" rows="2" autocomplete="off" placeholder="可选：比如朋友推荐、想吃哪道菜…"></textarea>
        </label>
        <button class="primary-button" type="submit">保存到收件箱</button>
      </form>
    </section>

    <section class="section-head">
      <div>
        <h2>待整理线索</h2>
        <p>一次处理几条就好，别让收藏变成负担。</p>
      </div>
      <span>${items.length} 条</span>
    </section>

    ${items.length ? items.slice(0, 20).map(renderInboxItem).join("") : renderEmpty("粘贴一个链接开始收集")}
  `;
}

function renderInboxItem(item) {
  const needsManualContext = item.parseStatus !== "success";

  return `
    <article class="item-card">
      ${renderCover(item.previewImageUrl, item.platform)}
      <div class="item-body">
        <div class="item-title-row">
          <div>
            <span class="mini-label">${escapeHtml(item.platform)} · ${escapeHtml(item.contentType)}</span>
            <h3>${escapeHtml(item.title)}</h3>
          </div>
          <button class="icon-button" data-action="reparse-inbox" data-id="${item.id}" title="重新解析" aria-label="重新解析线索"><span aria-hidden="true">↻</span></button>
        </div>
        ${needsManualContext ? `<p class="warning">${escapeHtml(item.failureReason || "需要手动补充标题、店名或菜名")}</p>` : ""}
        <p class="source-url">${escapeHtml(item.normalizedUrl || item.sourceUrl)}</p>
        <form class="triage-form" data-inbox-id="${item.id}">
          <div class="form-grid">
            <label><span>店铺</span><input name="storeName" value="${escapeAttr(item.title)}" /></label>
            <label><span>菜品</span><input name="dishName" autocomplete="off" placeholder="可空…" /></label>
            <label><span>城市</span><input name="city" autocomplete="off" placeholder="上海…" /></label>
            <label><span>商圈</span><input name="businessDistrict" autocomplete="off" placeholder="静安寺…" /></label>
          </div>
          <label><span>地址备注</span><input name="addressNote" autocomplete="off" placeholder="地铁口、楼层、附近地标…" /></label>
          <label><span>标签</span><input name="tags" autocomplete="off" placeholder="火锅, 晚餐, 聚餐…" /></label>
          <label><span>整理备注</span><textarea name="note" rows="2">${escapeHtml(item.note || "")}</textarea></label>
          <div class="button-row">
            <button type="button" data-action="organize-inbox" data-template="store">保存为店铺</button>
            <button type="button" data-action="organize-inbox" data-template="dish">保存为菜品</button>
            <button type="button" data-action="organize-inbox" data-template="store-dish">店铺 + 菜品</button>
            <button type="button" data-action="organize-inbox" data-template="hold">暂留</button>
          </div>
        </form>
      </div>
    </article>
  `;
}

function renderWishlist() {
  const searched = searchCollections(state, ui.query);
  const selectedTags = [...ui.selectedTags];
  const stores = filterByTags(searched.stores, selectedTags).filter((store) =>
    ["want", "planned"].includes(store.status)
  );
  const dishes = filterByTags(searched.dishes, selectedTags).filter((dish) =>
    ["want", "planned"].includes(dish.status)
  );
  const items = [
    ...stores.map((item) => ({ type: "store", item })),
    ...dishes.map((item) => ({ type: "dish", item }))
  ];

  return `
    ${renderFilters()}
    <div class="view-toggle">
      <button data-action="view-mode" data-mode="grid" class="${ui.viewMode === "grid" ? "active" : ""}">图列</button>
      <button data-action="view-mode" data-mode="list" class="${ui.viewMode === "list" ? "active" : ""}">列表</button>
    </div>
    <section class="section-head">
      <div>
        <h2>近期想去</h2>
        <p>按标签、商圈、时间段筛出当下合适的选择。</p>
      </div>
      <span>${items.length} 个</span>
    </section>
    <div class="${ui.viewMode === "grid" ? "card-grid" : "list-stack"}">
      ${items.length ? items.map(({ type, item }) => renderWishCard(type, item)).join("") : renderEmpty("先去收件箱整理一条线索")}
    </div>
  `;
}

function renderFilters() {
  return `
    <section class="filter-panel">
      <input data-ui="search" value="${escapeAttr(ui.query)}" autocomplete="off" placeholder="搜索店名、菜名、商圈、备注、标签…" />
      <div class="chip-row">
        ${state.tags
          .map(
            (tag) =>
              `<button data-action="toggle-tag" data-tag="${escapeAttr(tag.name)}" class="chip ${ui.selectedTags.has(tag.name) ? "selected" : ""}">${escapeHtml(tag.name)}</button>`
          )
          .join("")}
      </div>
      <button class="text-button" data-action="clear-filters">清空筛选</button>
    </section>
  `;
}

function renderWishCard(type, item) {
  const name = item.name;
  const meta =
    type === "store"
      ? [item.city, item.businessDistrict, STATUS_LABELS[item.status]].filter(Boolean).join(" · ")
      : [findStoreName(item.storeId), STATUS_LABELS[item.status]].filter(Boolean).join(" · ");

  return `
    <article class="item-card compact">
      ${renderCover(item.coverImageUrl, type === "store" ? "店铺" : "菜品")}
      <div class="item-body">
        <div class="item-title-row">
          <div>
            <span class="mini-label">${type === "store" ? "店铺" : "菜品"}</span>
            <h3>${escapeHtml(name)}</h3>
            <p>${escapeHtml(meta)}</p>
          </div>
          <button class="icon-button" data-action="soft-delete" data-collection="${type === "store" ? "stores" : "dishes"}" data-id="${item.id}" title="移入回收站" aria-label="移入回收站"><span aria-hidden="true">×</span></button>
        </div>
        ${renderTags(item.tagNames)}
        ${type === "store" && item.sourceLinks?.length ? `<p class="mini-label">来源 ${item.sourceLinks.length} 条</p>` : ""}
        ${renderEditForm(type, item)}
        <div class="action-panel primary-action-panel">
          <label><span>计划日期</span><input type="date" data-plan-date="${type}:${item.id}" value="${today()}" /></label>
          <button type="button" data-action="schedule" data-type="${type}" data-id="${item.id}">加入日历</button>
        </div>
        <details class="feedback-panel">
          <summary>到店轻反馈</summary>
          <div class="action-panel nested-action-panel">
            <label><span>到店日期</span><input type="date" data-visit-date="${type}:${item.id}" value="${today()}" /></label>
            <div class="button-row tight">
              <button type="button" data-action="visit" data-type="${type}" data-id="${item.id}" data-feedback="want_again">还想去</button>
              <button type="button" data-action="visit" data-type="${type}" data-id="${item.id}" data-feedback="ok">一般</button>
              <button type="button" data-action="visit" data-type="${type}" data-id="${item.id}" data-feedback="no_again">不再去</button>
            </div>
          </div>
        </details>
      </div>
    </article>
  `;
}

function renderEditForm(type, item) {
  if (type === "store") {
    return `
      <details class="edit-panel">
        <summary>编辑资料</summary>
        <form data-form="edit-store" data-id="${item.id}" class="edit-form">
          <label><span>店铺名</span><input name="name" autocomplete="off" value="${escapeAttr(item.name)}" /></label>
          <div class="form-grid">
            <label><span>城市</span><input name="city" autocomplete="off" value="${escapeAttr(item.city || "")}" /></label>
            <label><span>商圈</span><input name="businessDistrict" autocomplete="off" value="${escapeAttr(item.businessDistrict || "")}" /></label>
          </div>
          <label><span>地址备注</span><input name="addressNote" autocomplete="off" value="${escapeAttr(item.addressNote || "")}" /></label>
          <label><span>标签</span><input name="tags" autocomplete="off" value="${escapeAttr((item.tagNames || []).join(", "))}" /></label>
          <label><span>封面链接</span><input name="coverImageUrl" type="url" inputmode="url" autocomplete="off" value="${escapeAttr(item.coverImageUrl || "")}" placeholder="https://…" /></label>
          <label><span>备注</span><textarea name="note" rows="2" autocomplete="off">${escapeHtml(item.note || "")}</textarea></label>
          <button class="primary-button" type="submit">保存编辑</button>
        </form>
      </details>
    `;
  }

  return `
    <details class="edit-panel">
      <summary>编辑资料</summary>
      <form data-form="edit-dish" data-id="${item.id}" class="edit-form">
        <label><span>菜品名</span><input name="name" autocomplete="off" value="${escapeAttr(item.name)}" /></label>
        <label><span>绑定店铺</span>${renderStoreSelect(item.storeId)}</label>
        <label><span>标签</span><input name="tags" autocomplete="off" value="${escapeAttr((item.tagNames || []).join(", "))}" /></label>
        <label><span>封面链接</span><input name="coverImageUrl" type="url" inputmode="url" autocomplete="off" value="${escapeAttr(item.coverImageUrl || "")}" placeholder="https://…" /></label>
        <label><span>备注</span><textarea name="note" rows="2" autocomplete="off">${escapeHtml(item.note || "")}</textarea></label>
        <button class="primary-button" type="submit">保存编辑</button>
      </form>
    </details>
  `;
}

function renderStoreSelect(selectedStoreId) {
  const stores = activeItems(state.stores);

  return `
    <select name="storeId">
      <option value="">不绑定店铺</option>
      ${stores
        .map(
          (store) =>
            `<option value="${escapeAttr(store.id)}" ${store.id === selectedStoreId ? "selected" : ""}>${escapeHtml(store.name)}</option>`
        )
        .join("")}
    </select>
  `;
}

function renderCalendar() {
  const plans = activeItems(state.plans)
    .filter((plan) => plan.status === "scheduled")
    .filter((plan) => findTarget(plan.targetType, plan.targetId))
    .sort((a, b) => a.date.localeCompare(b.date));

  return `
    <section class="section-head">
      <div>
        <h2>已安排</h2>
        <p>没去也没关系，改期、放回想去或直接放下。</p>
      </div>
      <span>${plans.length} 个</span>
    </section>
    <div class="list-stack">
      ${plans.length ? plans.map(renderPlanCard).join("") : renderEmpty("给一个想去项安排日期")}
    </div>
  `;
}

function renderPlanCard(plan) {
  const target = findTarget(plan.targetType, plan.targetId);
  const title = target?.name || "已删除项目";

  return `
    <article class="item-card compact">
      <div class="date-block">
        <strong>${formatDate(plan.date)}</strong>
        <span>${plan.targetType === "store" ? "店铺" : "菜品"}</span>
      </div>
      <div class="item-body">
        <h3>${escapeHtml(title)}</h3>
        <div class="action-panel">
          <label><span>改到</span><input type="date" data-reschedule-date="${plan.id}" value="${plan.date}" /></label>
          <button data-action="plan-update" data-plan-action="reschedule" data-id="${plan.id}">改期</button>
        </div>
        <div class="button-row">
          <button data-action="plan-update" data-plan-action="back-to-wishlist" data-id="${plan.id}">放回想去</button>
          <button data-action="plan-update" data-plan-action="not-interested" data-id="${plan.id}">不想去了</button>
        </div>
        <div class="button-row tight">
          <button data-action="visit" data-type="${plan.targetType}" data-id="${plan.targetId}" data-feedback="want_again" data-date="${plan.date}">还想去</button>
          <button data-action="visit" data-type="${plan.targetType}" data-id="${plan.targetId}" data-feedback="ok" data-date="${plan.date}">一般</button>
          <button data-action="visit" data-type="${plan.targetType}" data-id="${plan.targetId}" data-feedback="no_again" data-date="${plan.date}">不再去</button>
        </div>
      </div>
    </article>
  `;
}

function renderVisited() {
  const visits = activeItems(state.visitRecords)
    .filter((visit) => findTarget(visit.storeId ? "store" : "dish", visit.storeId || visit.dishId))
    .sort((a, b) => b.date.localeCompare(a.date));

  return `
    <section class="section-head">
      <div>
        <h2>轻反馈</h2>
        <p>只留给未来自己的一个判断。</p>
      </div>
      <span>${visits.length} 条</span>
    </section>
    <div class="list-stack">
      ${visits.length ? visits.map(renderVisitCard).join("") : renderEmpty("到店后点一个轻反馈就好")}
    </div>
  `;
}

function renderVisitCard(visit) {
  const target = visit.storeId
    ? findTarget("store", visit.storeId)
    : findTarget("dish", visit.dishId);
  const type = visit.storeId ? "店铺" : "菜品";

  return `
    <article class="item-card compact">
      <div class="date-block">
        <strong>${formatDate(visit.date)}</strong>
        <span>${type}</span>
      </div>
      <div class="item-body">
        <h3>${escapeHtml(target?.name || "已删除项目")}</h3>
        <div class="item-title-row">
          <p class="feedback">${FEEDBACK_LABELS[visit.feedback]}</p>
          <button class="icon-button" data-action="soft-delete" data-collection="visitRecords" data-id="${visit.id}" title="撤销轻反馈" aria-label="撤销轻反馈"><span aria-hidden="true">×</span></button>
        </div>
        ${visit.note ? `<p>${escapeHtml(visit.note)}</p>` : ""}
      </div>
    </article>
  `;
}

function renderProfile() {
  const trash = getTrashItems(state);
  const trashCount = Object.values(trash).reduce((sum, items) => sum + items.length, 0);
  const groups = groupTags(state.tags);
  const notInterestedStores = activeItems(state.stores).filter((store) => store.status === "not_interested");
  const notInterestedDishes = activeItems(state.dishes).filter((dish) => dish.status === "not_interested");

  return `
    <section class="quick-panel">
      <h2>标签</h2>
      ${Object.entries(groups)
        .map(([group, tags]) => `<p class="mini-label">${tagGroupLabel(group)}</p><div class="chip-row">${tags.map((tag) => `<span class="chip passive">${escapeHtml(tag.name)}</span>`).join("")}</div>`)
        .join("")}
      <form data-form="add-tag" class="inline-form">
        <input name="name" autocomplete="off" placeholder="新增自定义标签…" />
        <select name="group">
          <option value="category">品类</option>
          <option value="taste">口味</option>
          <option value="time">时间段</option>
          <option value="scene">场景</option>
          <option value="custom">自定义</option>
        </select>
        <button type="submit">添加</button>
      </form>
    </section>
    <section class="quick-panel">
      <h2>不想去了</h2>
      <p>误点后可以放回想去。</p>
      ${renderRestoreTargets("店铺", "store", notInterestedStores)}
      ${renderRestoreTargets("菜品", "dish", notInterestedDishes)}
      ${!notInterestedStores.length && !notInterestedDishes.length ? `<p class="mini-label">暂无搁置内容</p>` : ""}
    </section>
    <section class="quick-panel">
      <h2>回收站</h2>
      <p>共 ${trashCount} 条，可恢复误删内容。</p>
      ${renderTrashGroup("收件箱", "inboxItems", trash.inboxItems)}
      ${renderTrashGroup("店铺", "stores", trash.stores)}
      ${renderTrashGroup("菜品", "dishes", trash.dishes)}
      ${renderTrashGroup("计划", "plans", trash.plans)}
      ${renderTrashGroup("轻反馈", "visitRecords", trash.visitRecords)}
    </section>
    <section class="quick-panel">
      <h2>本地数据</h2>
      <p>数据版本：v${state.meta.dataVersion}</p>
      <p>收藏数据保存在当前浏览器的 IndexedDB 中。导出/导入会在下一版加入。</p>
    </section>
  `;
}

function renderRestoreTargets(label, type, items) {
  if (!items.length) return "";

  return `
    <div class="trash-group">
      <p class="mini-label">${label}</p>
      ${items
        .map(
          (item) => `
            <div class="trash-row">
              <span>${escapeHtml(item.name)}</span>
              <button data-action="restore-target" data-type="${type}" data-id="${item.id}">放回想去</button>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderTrashGroup(label, collection, items) {
  if (!items.length) return "";

  return `
    <div class="trash-group">
      <p class="mini-label">${label}</p>
      ${items
        .map(
          (item) => `
            <div class="trash-row">
              <span>${escapeHtml(item.name || item.title || item.date || item.id)}</span>
              <button data-action="restore" data-collection="${collection}" data-id="${item.id}">恢复</button>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderBottomNav() {
  return `
    <nav class="bottom-nav" aria-label="主导航">
      ${Object.entries(TAB_LABELS)
        .map(
          ([tab, label]) =>
            `<button data-action="tab" data-tab="${tab}" class="${ui.tab === tab ? "active" : ""}" ${ui.tab === tab ? 'aria-current="page"' : ""}><span>${escapeHtml(label)}</span></button>`
        )
        .join("")}
    </nav>
  `;
}

function renderToast() {
  return `
    <div class="toast" role="status" aria-live="polite" aria-atomic="true">
      <span>${escapeHtml(ui.toast)}</span>
      ${ui.undo ? `<button class="toast-action" data-action="undo-last" type="button">撤销</button>` : ""}
    </div>
  `;
}

function renderCover(url, platform) {
  if (url) {
    return `<div class="cover"><img src="${escapeAttr(url)}" alt="" loading="lazy" data-fallback="${escapeAttr(platformInitial(platform))}" /></div>`;
  }

  return `<div class="cover placeholder"><span>${escapeHtml(platformInitial(platform))}</span></div>`;
}

function renderTags(tagNames = []) {
  if (!tagNames.length) return "";
  return `<div class="chip-row">${tagNames.map((tag) => `<span class="chip passive">${escapeHtml(tag)}</span>`).join("")}</div>`;
}

function renderEmpty(text) {
  return `<div class="empty-state"><p>${escapeHtml(text)}</p></div>`;
}

function pendingInboxItems() {
  return activeItems(state.inboxItems).filter((item) => item.triageStatus !== "organized");
}

function findTarget(type, id) {
  const target = type === "store"
    ? state.stores.find((store) => store.id === id)
    : state.dishes.find((dish) => dish.id === id);
  return target && !target.deletedAt ? target : null;
}

function findStoreName(id) {
  if (!id) return "待补店铺";
  return activeItems(state.stores).find((store) => store.id === id)?.name || "待补店铺";
}

function groupTags(tags) {
  return tags.reduce((groups, tag) => {
    groups[tag.group] ||= [];
    groups[tag.group].push(tag);
    return groups;
  }, {});
}

function tagGroupLabel(group) {
  return {
    category: "品类",
    taste: "口味",
    time: "时间段",
    scene: "场景",
    custom: "自定义"
  }[group] || group;
}

function splitTags(value) {
  return String(value || "")
    .split(/[,，\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function bindImageFallbacks() {
  app.querySelectorAll("img[data-fallback]").forEach((img) => {
    img.addEventListener(
      "error",
      () => {
        const fallback = document.createElement("div");
        fallback.className = "cover placeholder";
        fallback.innerHTML = `<span>${escapeHtml(img.dataset.fallback)}</span>`;
        img.closest(".cover").replaceWith(fallback);
      },
      { once: true }
    );
  });
}

function showToast(message, undo = null) {
  ui.toast = message;
  ui.undo = undo;
  render();
  window.setTimeout(() => {
    if (ui.toast === message) {
      ui.toast = "";
      ui.undo = null;
      render();
    }
  }, 2400);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(date) {
  const parsed = new Date(`${date}T00:00:00`);
  return parsed.toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
    weekday: "short"
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("\n", " ");
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}
