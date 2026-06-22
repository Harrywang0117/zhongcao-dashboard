import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Heart,
  Inbox,
  RotateCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Undo2,
  UserRound
} from "lucide-react";

import {
  activeItems,
  applyInboxReparsePreview,
  createCustomTag,
  createInitialState,
  createInboxItem,
  createPlan,
  createVisitRecord,
  filterByAddedBy,
  filterByTags,
  findDuplicateSource,
  findPotentialDuplicateStores,
  getTrashItems,
  mergeInboxItemIntoStore,
  organizeInboxItem,
  restoreItem,
  restoreTargetToWishlist,
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

const TAB_ICONS = {
  inbox: Inbox,
  wishlist: Heart,
  calendar: CalendarDays,
  visited: CheckCircle2,
  profile: UserRound
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

const FEEDBACK_TOAST_MESSAGES = {
  want_again: "已记录，还可以再次安排",
  ok: "已记录轻反馈",
  no_again: "已记录为不想去了"
};

const ADDED_BY_LABELS = {
  xiaowang: "小王",
  xiaozhang: "小张",
  unknown: "未标记"
};
const ACTIVE_ADDED_BY_OPTIONS = ["xiaowang", "xiaozhang"];
const EDITABLE_ADDED_BY_OPTIONS = ["xiaowang", "xiaozhang", "unknown"];
const ADDED_BY_FILTER_OPTIONS = ["all", "xiaowang", "xiaozhang", "unknown"];
const DEFAULT_ADDED_BY = "xiaowang";
const LAST_ADDED_BY_KEY = "zhongcao-last-added-by";

export default function App() {
  const [state, setState] = useState(null);
  const [tab, setTab] = useState("inbox");
  const [viewMode, setViewMode] = useState("grid");
  const [query, setQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState([]);
  const [selectedPlanDate, setSelectedPlanDate] = useState("");
  const [toast, setToast] = useState(null);
  const [undo, setUndo] = useState(null);
  const [pendingQuickSave, setPendingQuickSave] = useState(false);
  const [quickDraft, setQuickDraft] = useState(() => createEmptyQuickSaveDraft());
  const [addedByFilter, setAddedByFilter] = useState("all");
  const [openPanels, setOpenPanels] = useState([]);
  const [planDates, setPlanDates] = useState({});
  const [visitDates, setVisitDates] = useState({});
  const [rescheduleDates, setRescheduleDates] = useState({});
  const imageBackfillIds = useRef(new Set());
  const toastTimer = useRef(0);

  useEffect(() => {
    let mounted = true;
    loadState().then((loaded) => {
      if (mounted) setState(loaded);
    });
    registerServiceWorker();
    return () => {
      mounted = false;
      window.clearTimeout(toastTimer.current);
    };
  }, []);

  const counts = useMemo(() => {
    if (!state) return { pending: 0, wishlist: 0, plans: 0, visits: 0 };
    return {
      pending: pendingInboxItems(state).length,
      wishlist:
        activeItems(state.stores).filter((store) => ["want", "planned"].includes(store.status)).length +
        activeItems(state.dishes).filter((dish) => ["want", "planned"].includes(dish.status)).length,
      plans: activeItems(state.plans).filter((plan) => plan.status === "scheduled" && plan.date >= today()).length,
      visits: activeItems(state.visitRecords).length
    };
  }, [state]);

  useEffect(() => {
    if (!state || tab !== "inbox") return;

    pendingInboxItems(state)
      .filter(
        (item) =>
          !item.previewImageUrl &&
          item.platform === "大众点评" &&
          item.contentType === "store" &&
          !imageBackfillIds.current.has(item.id)
      )
      .forEach((item) => {
        imageBackfillIds.current.add(item.id);
        backfillInboxImage(item.id);
      });
  }, [state, tab]);

  function showToast(message, undoPayload = null) {
    setToast(message);
    setUndo(undoPayload);
    window.clearTimeout(toastTimer.current);
    const duration = undoPayload ? 7000 : 2400;
    toastTimer.current = window.setTimeout(() => {
      setToast((current) => (current === message ? null : current));
      setUndo((current) => (current === undoPayload ? null : current));
    }, duration);
  }

  async function persist(nextState, message = "", undoPayload = null) {
    const saved = await saveState(nextState);
    setState(saved);
    if (message) showToast(message, undoPayload);
    return saved;
  }

  async function mutate(mutator, message = "", undoPayload = null) {
    try {
      const nextState = structuredClone(state);
      const result = mutator(nextState);
      await persist(nextState, message, undoPayload);
      return result;
    } catch (error) {
      showToast(error.message);
      return null;
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

  async function saveInboxFromForm(values) {
    const sourceUrl = String(values.url || "").trim();
    const fallbackTitle = String(values.fallbackTitle || "").trim();
    const addedBy = String(values.addedBy || "").trim();
    if (!sourceUrl) {
      showToast("先粘贴一个链接");
      return;
    }
    if (!addedBy) {
      showToast("请选择添加人");
      return;
    }
    if (pendingQuickSave) return;

    setPendingQuickSave(true);
    try {
      const preview = await requestLinkPreview(sourceUrl);
      const duplicate = findDuplicateSource(state, preview.normalizedUrl);
      if (duplicate) {
        showToast(duplicate.collection === "stores" ? "这条链接已经在店铺来源里" : "这条链接已经在收件箱里");
        return;
      }

      const nextState = structuredClone(state);
      const item = createInboxItem({ preview, fallbackTitle, note: values.note || "", addedBy });
      nextState.inboxItems.unshift(item);
      rememberLastAddedBy(addedBy);
      setQuickDraft(createEmptyQuickSaveDraft());
      await persist(nextState, preview.status === "success" ? "已保存到收件箱" : "已补充关键信息并保存");
    } catch (error) {
      showToast(error.message);
    } finally {
      setPendingQuickSave(false);
    }
  }

  async function organizeInbox(id, template, values) {
    const tagNames = splitTags(values.tags);
    const storeName = String(values.storeName || "").trim();
    const businessDistrict = String(values.businessDistrict || "").trim();

    try {
      const nextState = structuredClone(state);
      if (template.includes("store") && storeName) {
        const duplicate = findPotentialDuplicateStores(nextState, storeName, businessDistrict)[0];
        if (duplicate && window.confirm(`发现疑似重复店铺「${duplicate.name}」，要合并来源吗？`)) {
          mergeInboxItemIntoStore(nextState, id, duplicate.id, {
            dishName: template === "store-dish" ? values.dishName : "",
            tagNames,
            note: values.note || ""
          });
          await persist(nextState, "已合并到已有店铺");
          return;
        }
      }

      organizeInboxItem(nextState, id, {
        template,
        storeName,
        dishName: values.dishName,
        city: values.city,
        businessDistrict,
        addressNote: values.addressNote,
        tagNames,
        note: values.note
      });
      await persist(nextState, template === "hold" ? "已暂留线索" : "已整理完成");
    } catch (error) {
      showToast(error.message);
    }
  }

  async function reparseInboxItem(id) {
    const item = state.inboxItems.find((candidate) => candidate.id === id);
    if (!item) return;

    const preview = await requestLinkPreview(item.sourceUrl || item.normalizedUrl);
    await mutate((nextState) => {
      const current = nextState.inboxItems.find((candidate) => candidate.id === id);
      applyInboxReparsePreview(current, preview);
    }, preview.status === "success" ? "重新解析成功" : "仍需补充关键信息");
  }

  async function backfillInboxImage(id) {
    const item = state.inboxItems.find((candidate) => candidate.id === id);
    if (!item || item.deletedAt || item.triageStatus === "organized" || item.previewImageUrl) {
      imageBackfillIds.current.delete(id);
      return;
    }

    try {
      const preview = await requestLinkPreview(item.sourceUrl || item.normalizedUrl);
      if (!preview.imageUrl) {
        imageBackfillIds.current.delete(id);
        return;
      }
      await mutate((nextState) => {
        const current = nextState.inboxItems.find((candidate) => candidate.id === id);
        if (current && !current.deletedAt && current.triageStatus !== "organized" && !current.previewImageUrl) {
          applyInboxReparsePreview(current, preview);
        }
      });
    } catch {
      imageBackfillIds.current.delete(id);
    }
  }

  async function scheduleTarget(type, id) {
    const key = `${type}:${id}`;
    const date = planDates[key];
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
    await mutate((nextState) => {
      createPlan(nextState, { targetType: type, targetId: id, date });
    }, alreadyScheduled ? "这天已经安排过" : "已加入日历");
    setPlanDates((dates) => omitKey(dates, key));
  }

  async function visitTarget(type, id, feedback, dateOverride = "") {
    const key = `${type}:${id}`;
    const date = visitDates[key] || dateOverride || today();
    await mutate((nextState) => {
      createVisitRecord(nextState, {
        storeId: type === "store" ? id : null,
        dishId: type === "dish" ? id : null,
        date,
        feedback
      });
    }, feedbackToastMessage(feedback));
    setVisitDates((dates) => omitKey(dates, key));
  }

  async function updatePlan(plan, action) {
    const nextDate = rescheduleDates[plan.id];
    await mutate((nextState) => {
      updatePlanStatus(nextState, plan.id, action, nextDate);
    }, "计划已更新");
    setRescheduleDates((dates) => omitKey(dates, plan.id));
  }

  async function softDelete(collection, id) {
    await mutate((nextState) => {
      softDeleteItem(nextState, collection, id);
    }, "已移入回收站", { collection, id });
  }

  async function undoLastAction() {
    if (!undo) return;
    const undoPayload = undo;
    setUndo(null);
    await mutate((nextState) => {
      restoreItem(nextState, undoPayload.collection, undoPayload.id);
    }, "已撤销");
  }

  async function clearLocalData() {
    imageBackfillIds.current.clear();
    setTab("inbox");
    setViewMode("grid");
    setQuery("");
    setSelectedTags([]);
    setAddedByFilter("all");
    setSelectedPlanDate("");
    setUndo(null);
    setPendingQuickSave(false);
    setQuickDraft(createEmptyQuickSaveDraft());
    setOpenPanels([]);
    setPlanDates({});
    setVisitDates({});
    setRescheduleDates({});
    await persist(createInitialState(), "本地数据已清空");
  }

  if (!state) {
    return (
      <main className="loading-screen">
        <span className="brand-mark h-14 w-14 animate-pulse font-display text-2xl">种</span>
        <p>正在打开种草收件箱...</p>
      </main>
    );
  }

  const screenProps = {
    state,
    viewMode,
    setViewMode,
    query,
    setQuery,
    selectedTags,
    setSelectedTags,
    addedByFilter,
    setAddedByFilter,
    selectedPlanDate,
    setSelectedPlanDate,
    quickDraft,
    setQuickDraft,
    pendingQuickSave,
    openPanels,
    setOpenPanels,
    planDates,
    setPlanDates,
    visitDates,
    setVisitDates,
    rescheduleDates,
    setRescheduleDates,
    saveInboxFromForm,
    organizeInbox,
    reparseInboxItem,
    scheduleTarget,
    visitTarget,
    updatePlan,
    softDelete,
    mutate,
    showToast,
    clearLocalData
  };

  return (
    <div className="app-shell">
      <header className="app-bar">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3" aria-label="种草软件">
            <span className="brand-mark font-display text-2xl leading-none">种</span>
            <div className="min-w-0">
              <p className="mini-label">个人美食种草库</p>
              <h1 className="font-display text-3xl leading-tight text-zinc-950">{TAB_LABELS[tab]}</h1>
            </div>
          </div>
          <div className="stat-pill">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">待整理</span>
            <strong className="font-display text-3xl leading-none text-emerald-950">{counts.pending}</strong>
          </div>
        </div>
      </header>

      <SummaryRail counts={counts} />

      <main className="grid gap-4 px-4 py-4">
        {tab === "inbox" && <InboxScreen {...screenProps} />}
        {tab === "wishlist" && <WishlistScreen {...screenProps} />}
        {tab === "calendar" && <CalendarScreen {...screenProps} />}
        {tab === "visited" && <VisitedScreen {...screenProps} />}
        {tab === "profile" && <ProfileScreen {...screenProps} />}
      </main>

      <BottomNav tab={tab} setTab={setTab} />
      {toast && <Toast message={toast} undo={undo} onUndo={undoLastAction} />}
    </div>
  );
}

function SummaryRail({ counts }) {
  const items = [
    ["待整理", counts.pending],
    ["想去", counts.wishlist],
    ["计划", counts.plans],
    ["反馈", counts.visits]
  ];

  return (
    <section className="grid grid-cols-4 gap-2.5 px-4 pt-3" aria-label="数据摘要">
      {items.map(([label, value]) => (
        <span key={label} className="summary-card">
          <b className="font-display text-2xl leading-none text-emerald-950">{value}</b>
          <small className="text-xs font-semibold text-zinc-500">{label}</small>
        </span>
      ))}
    </section>
  );
}

function InboxScreen({
  state,
  quickDraft,
  setQuickDraft,
  pendingQuickSave,
  saveInboxFromForm,
  organizeInbox,
  reparseInboxItem
}) {
  const items = pendingInboxItems(state);

  return (
    <>
      <section className="panel capture-panel">
        <div className="grid gap-2">
          <p className="mini-label text-emerald-800">收集入口</p>
          <h2 className="font-display text-[2rem] leading-tight text-zinc-950">先收起来，之后再整理</h2>
          <p className="max-w-prose text-base leading-relaxed text-zinc-600">
            分享文案、链接、店名都可以先放进来，之后按店铺或菜品慢慢归档。
          </p>
        </div>
        <QuickSaveForm
          draft={quickDraft}
          setDraft={setQuickDraft}
          pending={pendingQuickSave}
          onSubmit={saveInboxFromForm}
        />
      </section>

      <SectionHead title="待整理线索" description="一次处理几条就好，别让收藏变成负担。" count={`${items.length} 条`} />
      {items.length ? (
        items.slice(0, 20).map((item) => (
          <InboxItem key={item.id} item={item} onOrganize={organizeInbox} onReparse={reparseInboxItem} />
        ))
      ) : (
        <EmptyState>粘贴一个链接开始收集</EmptyState>
      )}
    </>
  );
}

function QuickSaveForm({ draft, setDraft, pending, onSubmit }) {
  function updateAddedBy(addedBy) {
    rememberLastAddedBy(addedBy);
    setDraft({ ...draft, addedBy });
  }

  return (
    <form
      className="grid gap-3"
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(draft);
      }}
    >
      <Field label="种草链接">
        <input
          name="url"
          inputMode="url"
          autoComplete="off"
          value={draft.url}
          placeholder="粘贴分享文案或链接..."
          onChange={(event) => setDraft({ ...draft, url: event.target.value })}
        />
      </Field>
      <Field label="标题/店名/菜名">
        <input
          name="fallbackTitle"
          autoComplete="off"
          value={draft.fallbackTitle}
          placeholder="解析失败时必填，也可以提前写..."
          onChange={(event) => setDraft({ ...draft, fallbackTitle: event.target.value })}
        />
      </Field>
      <Field label="备注">
        <textarea
          name="note"
          rows={2}
          autoComplete="off"
          value={draft.note}
          placeholder="可选：比如朋友推荐、想吃哪道菜..."
          onChange={(event) => setDraft({ ...draft, note: event.target.value })}
        />
      </Field>
      <Field label="添加人">
        <AddedBySegmentedControl
          value={draft.addedBy}
          options={ACTIVE_ADDED_BY_OPTIONS}
          onChange={updateAddedBy}
        />
      </Field>
      <button className="primary-button" type="submit" disabled={pending} aria-busy={pending}>
        {pending ? "保存中..." : "保存到收件箱"}
      </button>
    </form>
  );
}

function InboxItem({ item, onOrganize, onReparse }) {
  const formRef = useRef(null);
  const suggestion = item.suggested || {};
  const suggestedTags = Array.isArray(suggestion.tagNames) ? suggestion.tagNames.join(", ") : "";
  const suggestedNote = suggestion.note || item.note || "";

  function valuesFromForm() {
    return Object.fromEntries(new FormData(formRef.current).entries());
  }

  return (
    <article className="item-card">
      <Cover url={item.previewImageUrl} label={item.platform} />
      <div className="grid min-w-0 gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="mini-label">{item.platform} · {item.contentType}</span>
            <h3 className="break-words font-display text-xl text-zinc-950">{item.title}</h3>
          </div>
          <IconButton label="重新解析线索" onClick={() => onReparse(item.id)}>
            <RotateCw size={19} />
          </IconButton>
        </div>
        {item.parseStatus !== "success" && (
          <p className="rounded-lg border border-red-200 border-l-4 border-l-red-500 bg-red-50 px-3 py-2 text-sm font-semibold text-red-900">
            {item.failureReason || "需要手动补充标题、店名或菜名"}
          </p>
        )}
        <ContributorChip addedBy={item.addedBy} />
        <p className="line-clamp-2 break-all text-sm font-semibold text-zinc-500">{item.normalizedUrl || item.sourceUrl}</p>
        <form ref={formRef} className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="店铺"><input name="storeName" defaultValue={suggestion.storeName || item.title} /></Field>
            <Field label="菜品"><input name="dishName" autoComplete="off" placeholder="可空..." /></Field>
            <Field label="城市"><input name="city" autoComplete="off" defaultValue={suggestion.city || ""} placeholder="上海..." /></Field>
            <Field label="商圈"><input name="businessDistrict" autoComplete="off" defaultValue={suggestion.businessDistrict || ""} placeholder="静安寺..." /></Field>
          </div>
          <Field label="地址备注"><input name="addressNote" autoComplete="off" defaultValue={suggestion.addressNote || ""} placeholder="地铁口、楼层、附近地标..." /></Field>
          <Field label="标签"><input name="tags" autoComplete="off" defaultValue={suggestedTags} placeholder="火锅, 晚餐, 聚餐..." /></Field>
          <Field label="整理备注"><textarea name="note" rows={2} defaultValue={suggestedNote} /></Field>
          <div className="flex flex-wrap gap-2">
            {[
              ["store", "保存为店铺"],
              ["dish", "保存为菜品"],
              ["store-dish", "店铺 + 菜品"],
              ["hold", "暂留"]
            ].map(([template, label]) => (
              <button key={template} className="secondary-button flex-1 basis-28" type="button" onClick={() => onOrganize(item.id, template, valuesFromForm())}>
                {label}
              </button>
            ))}
          </div>
        </form>
      </div>
    </article>
  );
}

function WishlistScreen(props) {
  const { state, viewMode, setViewMode, query, selectedTags, addedByFilter } = props;
  const searched = searchCollections(state, query);
  const stores = filterByAddedBy(filterByTags(searched.stores, selectedTags), addedByFilter)
    .filter((store) => ["want", "planned"].includes(store.status));
  const dishes = filterByAddedBy(filterByTags(searched.dishes, selectedTags), addedByFilter)
    .filter((dish) => ["want", "planned"].includes(dish.status));
  const items = [...stores.map((item) => ({ type: "store", item })), ...dishes.map((item) => ({ type: "dish", item }))];

  return (
    <>
      <Filters {...props} />
      <SegmentedControl
        ariaLabel="视图模式"
        className="hidden sm:grid"
        value={viewMode}
        options={[{ value: "grid", label: "图列" }, { value: "list", label: "列表" }]}
        onChange={setViewMode}
      />
      <SectionHead title="近期想去" description="按标签、商圈、时间段筛出当下合适的选择。" count={`${items.length} 个`} />
      <div className={viewMode === "grid" ? "grid gap-3 sm:grid-cols-2" : "grid gap-3"}>
        {items.length ? items.map(({ type, item }) => <WishCard key={`${type}:${item.id}`} type={type} item={item} {...props} />) : <EmptyState>先去收件箱整理一条线索</EmptyState>}
      </div>
    </>
  );
}

function Filters({ state, query, setQuery, selectedTags, setSelectedTags, addedByFilter, setAddedByFilter }) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [tagFilterQuery, setTagFilterQuery] = useState("");
  const normalizedTagQuery = tagFilterQuery.trim().toLowerCase();
  const filteredTagGroups = Object.entries(groupTags(state.tags))
    .map(([group, tags]) => [
      group,
      tags.filter((tag) => tag.name.toLowerCase().includes(normalizedTagQuery))
    ])
    .filter(([, tags]) => tags.length);

  function toggleTag(tag) {
    setSelectedTags(selectedTags.includes(tag) ? selectedTags.filter((item) => item !== tag) : [...selectedTags, tag]);
  }

  function clearFilters() {
    setQuery("");
    setSelectedTags([]);
    setAddedByFilter("all");
    setTagFilterQuery("");
  }

  return (
    <section className="panel">
      <label className="sr-only" htmlFor="wishlist-search">搜索店名、菜名、商圈、备注、标签</label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={19} />
        <input id="wishlist-search" className="pl-10" value={query} autoComplete="off" placeholder="搜索店名、菜名、商圈、备注、标签..." onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="grid gap-3 rounded-lg border border-zinc-200 bg-zinc-50/70 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="mini-label">标签筛选</p>
            <p className="truncate text-sm font-semibold text-zinc-500">
              {selectedTags.length ? selectedTags.join("、") : "未选择标签"}
            </p>
            <p className="text-sm font-semibold text-zinc-500">添加人：{addedByFilterLabel(addedByFilter)}</p>
          </div>
          <button
            className="secondary-button inline-flex shrink-0 items-center gap-2"
            type="button"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <SlidersHorizontal size={17} />
            筛选
          </button>
        </div>
        {selectedTags.length ? (
          <div className="flex flex-wrap gap-2">
            {selectedTags.map((tag) => (
              <button key={tag} className="chip-selected" type="button" onClick={() => toggleTag(tag)}>
                {tag}
              </button>
            ))}
          </div>
        ) : null}
        {filtersOpen ? (
          <div className="grid gap-3 border-t border-zinc-200 pt-3">
            <div className="grid gap-2">
              <p className="mini-label">添加人</p>
              <div className="grid grid-cols-4 gap-2">
                {ADDED_BY_FILTER_OPTIONS.map((option) => (
                  <button
                    key={option}
                    className={addedByFilter === option ? "toggle-active" : "toggle-button"}
                    type="button"
                    aria-pressed={addedByFilter === option}
                    onClick={() => setAddedByFilter(option)}
                  >
                    {addedByFilterLabel(option)}
                  </button>
                ))}
              </div>
            </div>
            <label className="sr-only" htmlFor="tag-filter-search">搜索标签</label>
            <input
              id="tag-filter-search"
              value={tagFilterQuery}
              autoComplete="off"
              placeholder="搜索标签..."
              onChange={(event) => setTagFilterQuery(event.target.value)}
            />
            <div className="grid max-h-72 gap-3 overflow-y-auto pr-1">
              {filteredTagGroups.length ? filteredTagGroups.map(([group, tags]) => (
                <div key={group} className="grid gap-2">
                  <p className="mini-label">{tagGroupLabel(group)}</p>
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => (
                      <button key={tag.id} className={selectedTags.includes(tag.name) ? "chip-selected" : "chip"} type="button" onClick={() => toggleTag(tag.name)}>
                        {tag.name}
                      </button>
                    ))}
                  </div>
                </div>
              )) : <p className="mini-label">没有匹配标签</p>}
            </div>
          </div>
        ) : null}
      </div>
      <button className="text-button" type="button" onClick={clearFilters}>清空筛选</button>
    </section>
  );
}

function WishCard(props) {
  const { state, type, item, planDates, setPlanDates, visitDates, setVisitDates, scheduleTarget, visitTarget, softDelete } = props;
  const key = `${type}:${item.id}`;
  const meta =
    type === "store"
      ? [item.city, item.businessDistrict, STATUS_LABELS[item.status]].filter(Boolean).join(" · ")
      : [findStoreName(state, item.storeId), STATUS_LABELS[item.status]].filter(Boolean).join(" · ");

  return (
    <article className="wish-card item-card grid grid-cols-[86px_minmax(0,1fr)] items-start sm:grid-cols-[108px_minmax(0,1fr)]">
      <Cover url={item.coverImageUrl} label={type === "store" ? "店铺" : "菜品"} compact />
      <div className="grid min-w-0 gap-2 p-3 sm:gap-3 sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="mini-label">{type === "store" ? "店铺" : "菜品"}</span>
            <h3 className="break-words font-display text-lg leading-snug text-zinc-950 sm:text-xl">{item.name}</h3>
            <p className="break-words text-sm font-semibold text-zinc-500">{meta}</p>
            <div className="pt-2"><ContributorChip addedBy={item.addedBy} /></div>
          </div>
          <IconButton label="移入回收站" onClick={() => softDelete(type === "store" ? "stores" : "dishes", item.id)}>
            <Trash2 size={18} />
          </IconButton>
        </div>
        <Tags tags={item.tagNames} />
        {type === "store" && item.sourceLinks?.length ? <p className="mini-label">来源 {item.sourceLinks.length} 条</p> : null}
      </div>
      <div className="wish-card-actions col-span-2 grid gap-0 px-3 pb-3 sm:px-4 sm:pb-4">
        <EditForm type={type} item={item} {...props} />
        <DetailsPanel id={`plan:${key}`} title="加入日历" {...props}>
          <div className="action-panel border-t-0 pt-0">
            <Field label="计划日期">
              <input type="date" value={planDates[key] || today()} onChange={(event) => setPlanDates({ ...planDates, [key]: event.target.value })} />
            </Field>
            <button className="secondary-button" type="button" onClick={() => scheduleTarget(type, item.id)}>加入日历</button>
          </div>
        </DetailsPanel>
        <DetailsPanel id={`feedback:${key}`} title="到店轻反馈" {...props}>
          <div className="action-panel border-t-0 pt-0">
            <Field label="到店日期">
              <input type="date" value={visitDates[key] || today()} onChange={(event) => setVisitDates({ ...visitDates, [key]: event.target.value })} />
            </Field>
            <FeedbackButtons onPick={(feedback) => visitTarget(type, item.id, feedback)} />
          </div>
        </DetailsPanel>
      </div>
    </article>
  );
}

function EditForm({ state, type, item, mutate, openPanels, setOpenPanels }) {
  const formRef = useRef(null);
  const panelId = `edit:${type}:${item.id}`;

  async function submit(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(formRef.current).entries());
    const message = type === "store" ? "店铺已更新" : "菜品已更新";
    await mutate((nextState) => {
      if (type === "store") {
        updateStore(nextState, item.id, {
          name: values.name,
          addedBy: values.addedBy,
          city: values.city,
          businessDistrict: values.businessDistrict,
          addressNote: values.addressNote,
          tagNames: splitTags(values.tags),
          coverImageUrl: values.coverImageUrl,
          note: values.note
        });
      } else {
        updateDish(nextState, item.id, {
          name: values.name,
          addedBy: values.addedBy,
          storeId: values.storeId,
          tagNames: splitTags(values.tags),
          coverImageUrl: values.coverImageUrl,
          note: values.note
        });
      }
    }, message);
  }

  return (
    <details className="details-panel" open={openPanels.includes(panelId)} onToggle={(event) => syncOpenPanel(event, panelId, openPanels, setOpenPanels)}>
      <summary>编辑资料</summary>
      <form ref={formRef} className="grid gap-3 pt-3" onSubmit={submit}>
        <Field label={type === "store" ? "店铺名" : "菜品名"}><input name="name" autoComplete="off" defaultValue={item.name} /></Field>
        <Field label="添加人">
          <select name="addedBy" defaultValue={coerceAddedByForUi(item.addedBy)}>
            {EDITABLE_ADDED_BY_OPTIONS.map((option) => (
              <option key={option} value={option}>{ADDED_BY_LABELS[option]}</option>
            ))}
          </select>
        </Field>
        {type === "store" ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="城市"><input name="city" autoComplete="off" defaultValue={item.city || ""} /></Field>
              <Field label="商圈"><input name="businessDistrict" autoComplete="off" defaultValue={item.businessDistrict || ""} /></Field>
            </div>
            <Field label="地址备注"><input name="addressNote" autoComplete="off" defaultValue={item.addressNote || ""} /></Field>
          </>
        ) : (
          <Field label="绑定店铺">
            <select name="storeId" defaultValue={item.storeId || ""}>
              <option value="">不绑定店铺</option>
              {activeItems(state.stores).map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="标签"><input name="tags" autoComplete="off" defaultValue={(item.tagNames || []).join(", ")} /></Field>
        <Field label="封面链接"><input name="coverImageUrl" type="url" inputMode="url" autoComplete="off" defaultValue={item.coverImageUrl || ""} placeholder="https://..." /></Field>
        <Field label="备注"><textarea name="note" rows={2} autoComplete="off" defaultValue={item.note || ""} /></Field>
        <button className="primary-button" type="submit">保存编辑</button>
      </form>
    </details>
  );
}

function DetailsPanel({ id, title, openPanels, setOpenPanels, children }) {
  return (
    <details className="details-panel" open={openPanels.includes(id)} onToggle={(event) => syncOpenPanel(event, id, openPanels, setOpenPanels)}>
      <summary>{title}</summary>
      <div className="pt-3">{children}</div>
    </details>
  );
}

function CalendarScreen(props) {
  const { state, selectedPlanDate } = props;
  const scheduledPlans = activeItems(state.plans)
    .filter((plan) => plan.status === "scheduled")
    .filter((plan) => findTarget(state, plan.targetType, plan.targetId))
    .sort((a, b) => a.date.localeCompare(b.date));
  const plans = selectedPlanDate
    ? scheduledPlans.filter((plan) => plan.date === selectedPlanDate)
    : scheduledPlans.filter((plan) => plan.date >= today());

  return (
    <>
      <CalendarGrid plans={scheduledPlans} {...props} />
      <SectionHead
        title={selectedPlanDate ? formatDate(selectedPlanDate) : "未来计划"}
        description={selectedPlanDate ? "这天安排了这些选择。" : "没去也没关系，改期、放回想去或直接放下。"}
        count={`${plans.length} 个`}
      />
      <div className="grid gap-3">
        {plans.length ? plans.map((plan) => <PlanCard key={plan.id} plan={plan} {...props} />) : <EmptyState>{selectedPlanDate ? "这天还没有安排" : "给一个想去项安排日期"}</EmptyState>}
      </div>
    </>
  );
}

function CalendarGrid({ plans, selectedPlanDate, setSelectedPlanDate }) {
  const [viewMonth, setViewMonth] = useState(() => {
    const start = new Date(`${selectedPlanDate || today()}T00:00:00`);
    return { year: start.getFullYear(), month: start.getMonth() };
  });
  const { year, month } = viewMonth;
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const planDates = new Set(plans.map((plan) => plan.date));
  const cells = [];

  for (let index = 0; index < firstDay.getDay(); index += 1) cells.push(null);
  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    const date = toIsoDate(new Date(year, month, day));
    cells.push({ day, date, hasPlan: planDates.has(date) });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  function shiftMonth(delta) {
    setViewMonth((current) => {
      const next = new Date(current.year, current.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  }

  return (
    <section className="panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="mini-label">日历视图</p>
          <h2 className="font-display text-3xl text-zinc-950">{year}年{month + 1}月</h2>
        </div>
        <div className="flex items-center gap-2">
          {selectedPlanDate && <button className="text-button" type="button" onClick={() => setSelectedPlanDate("")}>看全部</button>}
          <button className="cal-nav" type="button" aria-label="上个月" onClick={() => shiftMonth(-1)}>
            <ChevronLeft size={18} strokeWidth={2.4} />
          </button>
          <button className="cal-nav" type="button" aria-label="下个月" onClick={() => shiftMonth(1)}>
            <ChevronRight size={18} strokeWidth={2.4} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 pt-2 text-center text-sm font-black text-zinc-500" aria-hidden="true">
        {["日", "一", "二", "三", "四", "五", "六"].map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((cell, index) =>
          cell ? (
            <button
              key={cell.date}
              className={[
                "cal-cell",
                cell.date === today() ? "cal-cell-today" : "",
                cell.date === selectedPlanDate ? "cal-cell-selected" : ""
              ].join(" ")}
              type="button"
              aria-label={formatCalendarDateLabel(cell.date, cell.hasPlan, cell.date === selectedPlanDate)}
              aria-pressed={cell.date === selectedPlanDate}
              onClick={() => setSelectedPlanDate(cell.date)}
            >
              <span>{cell.day}</span>
              {cell.hasPlan && <i className="cal-dot" aria-hidden="true" />}
            </button>
          ) : (
            <span key={`blank-${index}`} className="min-h-12" aria-hidden="true" />
          )
        )}
      </div>
    </section>
  );
}

function PlanCard({ state, plan, rescheduleDates, setRescheduleDates, updatePlan, visitTarget }) {
  const target = findTarget(state, plan.targetType, plan.targetId);

  return (
    <article className="item-card grid grid-cols-[104px_minmax(0,1fr)]">
      <div className="date-block">
        <strong className="font-display text-lg leading-tight">{formatDate(plan.date)}</strong>
        <span className="mini-label mt-1">{plan.targetType === "store" ? "店铺" : "菜品"}</span>
      </div>
      <div className="grid min-w-0 gap-3 p-4">
        <h3 className="break-words font-display text-xl text-zinc-950">{target?.name || "已删除项目"}</h3>
        <div className="action-panel">
          <Field label="改到">
            <input type="date" value={rescheduleDates[plan.id] || plan.date} onChange={(event) => setRescheduleDates({ ...rescheduleDates, [plan.id]: event.target.value })} />
          </Field>
          <button className="secondary-button" onClick={() => updatePlan(plan, "reschedule")}>改期</button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="secondary-button flex-1 basis-28" onClick={() => updatePlan(plan, "back-to-wishlist")}>放回想去</button>
          <button className="secondary-button flex-1 basis-28" onClick={() => updatePlan(plan, "not-interested")}>不想去了</button>
        </div>
        <FeedbackButtons onPick={(feedback) => visitTarget(plan.targetType, plan.targetId, feedback, plan.date)} />
      </div>
    </article>
  );
}

function VisitedScreen({ state, softDelete }) {
  const visits = activeItems(state.visitRecords)
    .filter((visit) => findTarget(state, visit.storeId ? "store" : "dish", visit.storeId || visit.dishId))
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <>
      <SectionHead title="轻反馈" description="只留给未来自己的一个判断。" count={`${visits.length} 条`} />
      <div className="grid gap-3">
        {visits.length ? visits.map((visit) => <VisitCard key={visit.id} state={state} visit={visit} softDelete={softDelete} />) : <EmptyState>到店后点一个轻反馈就好</EmptyState>}
      </div>
    </>
  );
}

function VisitCard({ state, visit, softDelete }) {
  const target = visit.storeId ? findTarget(state, "store", visit.storeId) : findTarget(state, "dish", visit.dishId);
  const type = visit.storeId ? "店铺" : "菜品";

  return (
    <article className="item-card grid grid-cols-[104px_minmax(0,1fr)]">
      <div className="date-block">
        <strong className="font-display text-lg leading-tight">{formatDate(visit.date)}</strong>
        <span className="mini-label mt-1">{type}</span>
      </div>
      <div className="grid min-w-0 gap-3 p-4">
        <h3 className="break-words font-display text-xl text-zinc-950">{target?.name || "已删除项目"}</h3>
        <div className="flex items-center justify-between gap-3">
          <p className="feedback-badge">{FEEDBACK_LABELS[visit.feedback]}</p>
          <IconButton label="撤销轻反馈" onClick={() => softDelete("visitRecords", visit.id)}>
            <Trash2 size={18} />
          </IconButton>
        </div>
        {visit.note ? <p className="text-sm font-semibold text-zinc-600">{visit.note}</p> : null}
      </div>
    </article>
  );
}

function ProfileScreen({ state, mutate, clearLocalData }) {
  const trash = getTrashItems(state);
  const trashCount = Object.values(trash).reduce((sum, items) => sum + items.length, 0);
  const groups = groupTags(state.tags);
  const notInterestedStores = activeItems(state.stores).filter((store) => store.status === "not_interested");
  const notInterestedDishes = activeItems(state.dishes).filter((dish) => dish.status === "not_interested");

  async function addTag(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    await mutate((nextState) => {
      createCustomTag(nextState, values.name, values.group || "custom");
    }, "标签已添加");
    event.currentTarget.reset();
  }

  async function restoreTarget(type, id) {
    await mutate((nextState) => {
      restoreTargetToWishlist(nextState, type, id);
    }, "已放回想去");
  }

  async function restore(collection, id) {
    await mutate((nextState) => {
      restoreItem(nextState, collection, id);
    }, "已恢复");
  }

  return (
    <>
      <section className="panel">
        <h2 className="font-display text-2xl text-zinc-950">标签</h2>
        {Object.entries(groups).map(([group, tags], index) => (
          <details key={group} className="details-panel" open={index < 2}>
            <summary className="flex items-center justify-between gap-3">
              <span>{tagGroupLabel(group)}</span>
              <span className="mini-label">{tags.length} 个</span>
            </summary>
            <div className="flex flex-wrap gap-2 pt-3">{tags.map((tag) => <span key={tag.id} className="chip-passive">{tag.name}</span>)}</div>
          </details>
        ))}
        <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_112px_72px]" onSubmit={addTag}>
          <input name="name" autoComplete="off" placeholder="新增自定义标签..." />
          <select name="group" defaultValue="category">
            <option value="category">品类</option>
            <option value="taste">口味</option>
            <option value="time">时间段</option>
            <option value="scene">场景</option>
            <option value="custom">自定义</option>
          </select>
          <button className="secondary-button" type="submit">添加</button>
        </form>
      </section>

      <section className="panel">
        <h2 className="font-display text-2xl text-zinc-950">不想去了</h2>
        <p className="text-base font-semibold text-zinc-600">误点后可以放回想去。</p>
        <RestoreTargets label="店铺" type="store" items={notInterestedStores} onRestore={restoreTarget} />
        <RestoreTargets label="菜品" type="dish" items={notInterestedDishes} onRestore={restoreTarget} />
        {!notInterestedStores.length && !notInterestedDishes.length ? <p className="mini-label">暂无搁置内容</p> : null}
      </section>

      <section className="panel">
        <h2 className="font-display text-2xl text-zinc-950">回收站</h2>
        <p className="text-base font-semibold text-zinc-600">共 {trashCount} 条，可恢复误删内容。</p>
        <TrashGroup label="收件箱" collection="inboxItems" items={trash.inboxItems} onRestore={restore} />
        <TrashGroup label="店铺" collection="stores" items={trash.stores} onRestore={restore} />
        <TrashGroup label="菜品" collection="dishes" items={trash.dishes} onRestore={restore} />
        <TrashGroup label="计划" collection="plans" items={trash.plans} onRestore={restore} />
        <TrashGroup label="轻反馈" collection="visitRecords" items={trash.visitRecords} onRestore={restore} />
      </section>

      <section className="panel">
        <h2 className="font-display text-2xl text-zinc-950">本地数据</h2>
        <p className="text-base font-semibold text-zinc-600">数据版本：v{state.meta.dataVersion}</p>
        <p className="text-base font-semibold text-zinc-600">当前支持固定添加人：小王 / 小张；历史数据会显示为未标记。</p>
        <p className="text-base font-semibold text-zinc-600">收藏数据保存在当前浏览器的 IndexedDB 中。导出/导入会在下一版加入。</p>
        <button className="text-button" type="button" onClick={clearLocalData}>清空本地数据</button>
      </section>
    </>
  );
}

function RestoreTargets({ label, type, items, onRestore }) {
  if (!items.length) return null;
  return (
    <div className="grid gap-2">
      <p className="mini-label">{label}</p>
      {items.map((item) => (
        <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_88px] items-center gap-2 border-t border-zinc-200 pt-2">
          <span className="break-words font-semibold text-zinc-700">{item.name}</span>
          <button className="secondary-button" type="button" onClick={() => onRestore(type, item.id)}>放回</button>
        </div>
      ))}
    </div>
  );
}

function TrashGroup({ label, collection, items, onRestore }) {
  if (!items.length) return null;
  return (
    <div className="grid gap-2">
      <p className="mini-label">{label}</p>
      {items.map((item) => (
        <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_72px] items-center gap-2 border-t border-zinc-200 pt-2">
          <span className="break-words font-semibold text-zinc-700">{item.name || item.title || item.date || item.id}</span>
          <button className="secondary-button" type="button" onClick={() => onRestore(collection, item.id)}>恢复</button>
        </div>
      ))}
    </div>
  );
}

function BottomNav({ tab, setTab }) {
  return (
    <nav className="bottom-nav" aria-label="主导航">
      {Object.entries(TAB_LABELS).map(([id, label]) => {
        const Icon = TAB_ICONS[id];
        const active = id === tab;
        return (
          <button
            key={id}
            type="button"
            className={`nav-item ${active ? "nav-item-active" : ""}`}
            aria-current={active ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            <Icon size={21} strokeWidth={active ? 2.4 : 2} />
            <span className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function Toast({ message, undo, onUndo }) {
  return (
    <div className="toast" role="status" aria-live="polite" aria-atomic="true">
      <span className="toast-icon" aria-hidden="true">
        <CheckCircle2 size={16} strokeWidth={2.4} />
      </span>
      <span className="min-w-0 flex-1 break-words font-semibold">{message}</span>
      {undo && (
        <button className="undo-button" type="button" onClick={onUndo}>
          <Undo2 size={16} />
          撤销
        </button>
      )}
    </div>
  );
}

function SectionHead({ title, description, count }) {
  return (
    <section className="flex items-end justify-between gap-3 px-1 pt-1">
      <div>
        <h2 className="font-display text-2xl text-zinc-950">{title}</h2>
        <p className="text-sm text-zinc-600">{description}</p>
      </div>
      <span className="shrink-0 rounded-full border border-emerald-950/12 bg-white/70 px-3 py-1 text-sm font-bold text-zinc-500">{count}</span>
    </section>
  );
}

function Field({ label, children }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-bold text-zinc-600">{label}</span>
      {children}
    </label>
  );
}

function SegmentedControl({ options, value, onChange, ariaLabel, className = "" }) {
  const activeIndex = Math.max(0, options.findIndex((option) => option.value === value));
  return (
    <div
      className={`segmented ${className}`.trim()}
      role="radiogroup"
      aria-label={ariaLabel}
      style={{ "--seg-count": options.length, "--seg-index": activeIndex }}
    >
      <span className="segmented-thumb" aria-hidden="true" />
      {options.map((option) => (
        <button
          key={option.value}
          className="segmented-option"
          type="button"
          role="radio"
          aria-checked={value === option.value}
          data-active={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function AddedBySegmentedControl({ value, options, onChange }) {
  return (
    <SegmentedControl
      ariaLabel="添加人"
      value={value}
      options={options.map((option) => ({ value: option, label: ADDED_BY_LABELS[option] }))}
      onChange={onChange}
    />
  );
}

function ContributorChip({ addedBy }) {
  return <span className="added-by-chip">添加人：{addedByLabel(addedBy)}</span>;
}

function IconButton({ label, onClick, children }) {
  return (
    <button className="grid h-11 min-h-11 w-11 shrink-0 place-items-center rounded-xl border border-zinc-200 bg-white text-zinc-600 transition-colors duration-200 hover:border-emerald-950/30 hover:bg-emerald-50 hover:text-emerald-900" type="button" aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  );
}

function Cover({ url, label, compact = false }) {
  const [failed, setFailed] = useState(false);
  const initial = platformInitial(label);

  if (url && !failed) {
    return (
      <div className={`cover ${compact ? "h-full min-h-28" : "min-h-32"}`}>
        <img src={url} alt="" width="320" height="232" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      </div>
    );
  }

  return (
    <div className={`cover grid place-items-center ${compact ? "h-full min-h-28" : "min-h-32"}`}>
      <span className="brand-mark relative z-10 h-14 w-14 rounded-2xl font-display text-2xl">{initial}</span>
    </div>
  );
}

function Tags({ tags = [] }) {
  if (!tags.length) return null;
  const visibleTags = tags.slice(0, 3);
  const hiddenCount = tags.length - visibleTags.length;
  return (
    <div className="flex flex-wrap gap-2">
      {visibleTags.map((tag) => <span key={tag} className="chip-passive">{tag}</span>)}
      {hiddenCount > 0 ? <span className="chip-overflow" aria-label={`还有 ${hiddenCount} 个标签`}>+{hiddenCount}</span> : null}
    </div>
  );
}

function EmptyState({ children }) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon" aria-hidden="true">
        <Sparkles size={22} strokeWidth={2.2} />
      </span>
      {children}
    </div>
  );
}

function FeedbackButtons({ onPick }) {
  return (
    <div className="flex flex-wrap gap-2">
      <button className="secondary-button flex-1 basis-20" type="button" onClick={() => onPick("want_again")}>还想去</button>
      <button className="secondary-button flex-1 basis-20" type="button" onClick={() => onPick("ok")}>一般</button>
      <button className="secondary-button flex-1 basis-20" type="button" onClick={() => onPick("no_again")}>不再去</button>
    </div>
  );
}

function feedbackToastMessage(feedback) {
  return FEEDBACK_TOAST_MESSAGES[feedback] || "已记录轻反馈";
}

function pendingInboxItems(state) {
  return activeItems(state.inboxItems).filter((item) => item.triageStatus !== "organized");
}

function findTarget(state, type, id) {
  const target = type === "store" ? state.stores.find((store) => store.id === id) : state.dishes.find((dish) => dish.id === id);
  return target && !target.deletedAt ? target : null;
}

function findStoreName(state, id) {
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

function addedByLabel(value) {
  return ADDED_BY_LABELS[coerceAddedByForUi(value)];
}

function addedByFilterLabel(value) {
  return value === "all" ? "全部" : addedByLabel(value);
}

function coerceAddedByForUi(value) {
  return EDITABLE_ADDED_BY_OPTIONS.includes(value) ? value : "unknown";
}

function createEmptyQuickSaveDraft() {
  return {
    url: "",
    fallbackTitle: "",
    note: "",
    addedBy: readLastAddedBy()
  };
}

function readLastAddedBy() {
  try {
    const value = window.localStorage.getItem(LAST_ADDED_BY_KEY);
    return ACTIVE_ADDED_BY_OPTIONS.includes(value) ? value : DEFAULT_ADDED_BY;
  } catch {
    return DEFAULT_ADDED_BY;
  }
}

function rememberLastAddedBy(value) {
  if (!ACTIVE_ADDED_BY_OPTIONS.includes(value)) return;
  try {
    window.localStorage.setItem(LAST_ADDED_BY_KEY, value);
  } catch {
    // Keeping this preference is optional; saving the item itself is still handled by IndexedDB.
  }
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

function syncOpenPanel(event, id, openPanels, setOpenPanels) {
  if (event.target.open) {
    if (!openPanels.includes(id)) setOpenPanels([...openPanels, id]);
  } else {
    setOpenPanels(openPanels.filter((panel) => panel !== id));
  }
}

function omitKey(record, key) {
  const next = { ...record };
  delete next[key];
  return next;
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function today() {
  return toIsoDate(new Date());
}

function formatDate(date) {
  const parsed = new Date(`${date}T00:00:00`);
  return parsed.toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
    weekday: "short"
  });
}

function formatCalendarDateLabel(date, hasPlan, isSelected) {
  const parsed = new Date(`${date}T00:00:00`);
  const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][parsed.getDay()];
  const parts = [`${parsed.getFullYear()}年${parsed.getMonth() + 1}月${parsed.getDate()}日`, weekday];
  if (date === today()) parts.push("今天");
  if (hasPlan) parts.push("已有计划");
  if (isSelected) parts.push("已选中");
  return parts.join(" ");
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}
