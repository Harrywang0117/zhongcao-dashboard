import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpDown,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Minus,
  Plus,
  RotateCw,
  Search,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Undo2
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
import { createStateBackup, loadState, saveState } from "./lib/storage.js";
import { createDemoState, isDemoMode } from "./lib/demo-data.js";
import { Mascot } from "./components/Mascot.jsx";
import {
  CalendarIcon,
  CheckIcon,
  HeartIcon,
  InboxIcon,
  PersonIcon
} from "./components/HandIcons.jsx";

const TAB_LABELS = {
  inbox: "收件箱",
  wishlist: "想去",
  calendar: "日历",
  visited: "已去过",
  profile: "我的"
};

const TAB_ICONS = {
  inbox: InboxIcon,
  wishlist: HeartIcon,
  calendar: CalendarIcon,
  visited: CheckIcon,
  profile: PersonIcon
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

const FEEDBACK_PILL = {
  want_again: { cls: "feedback-badge feedback-good", Icon: ThumbsUp },
  ok: { cls: "feedback-badge feedback-ok", Icon: Minus },
  no_again: { cls: "feedback-badge feedback-bad", Icon: ThumbsDown }
};

const ADDED_BY_LABELS = {
  xiaowang: "小王",
  xiaozhang: "小张",
  unknown: "未标记"
};
const ACTIVE_ADDED_BY_OPTIONS = ["xiaowang", "xiaozhang"];
const EDITABLE_ADDED_BY_OPTIONS = ["xiaowang", "xiaozhang", "unknown"];
const DEFAULT_ADDED_BY = "xiaowang";
const LAST_ADDED_BY_KEY = "zhongcao-last-added-by";

export default function App() {
  const [state, setState] = useState(null);
  const [tab, setTab] = useState("inbox");
  const [query, setQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState([]);
  const [selectedPlanDate, setSelectedPlanDate] = useState("");
  const [toast, setToast] = useState(null);
  const [undo, setUndo] = useState(null);
  const [pendingQuickSave, setPendingQuickSave] = useState(false);
  const [weiboFallback, setWeiboFallback] = useState(null);
  const [quickDraft, setQuickDraft] = useState(() => createEmptyQuickSaveDraft());
  const [addedByFilter, setAddedByFilter] = useState("all");
  const [openPanels, setOpenPanels] = useState([]);
  const [planDates, setPlanDates] = useState({});
  const [visitDates, setVisitDates] = useState({});
  const [rescheduleDates, setRescheduleDates] = useState({});
  const imageBackfillIds = useRef(new Set());
  const toastTimer = useRef(0);
  const demoMode = useRef(isDemoMode());

  useEffect(() => {
    let mounted = true;
    if (demoMode.current) {
      // Preview-only: keep demo content purely in memory, never persisted.
      setTab("wishlist");
      setState(createDemoState());
    } else {
      loadState().then((loaded) => {
        if (mounted) setState(loaded);
      });
      registerServiceWorker();
    }
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
    const saved = demoMode.current ? nextState : await saveState(nextState);
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

  async function savePreviewToInbox(preview, values) {
    const fallbackTitle = String(values.fallbackTitle || "").trim();
    const addedBy = String(values.addedBy || "").trim();
    const duplicate = findDuplicateSource(state, preview.normalizedUrl, preview.sourceKey);
    if (duplicate) {
      showToast(duplicate.collection === "stores" ? "这条链接已经在店铺来源里" : "这条链接已经保存过了");
      return false;
    }

    const nextState = structuredClone(state);
    const item = createInboxItem({ preview, fallbackTitle, note: values.note || "", addedBy });
    nextState.inboxItems.unshift(item);
    rememberLastAddedBy(addedBy);
    setQuickDraft(createEmptyQuickSaveDraft());
    const message = preview.status === "success"
      ? "已保存到收件箱"
      : fallbackTitle
        ? "已补充关键信息并保存"
        : "已保存为待整理链接";
    await persist(nextState, message);
    return true;
  }

  async function saveInboxFromForm(values) {
    const sourceUrl = String(values.url || "").trim();
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
      if (preview.platform === "微博" && preview.failureCode === "unsupported_platform") {
        const duplicate = findDuplicateSource(state, preview.normalizedUrl, preview.sourceKey);
        if (duplicate) {
          showToast("这条微博链接已经保存过了");
          return;
        }
        setWeiboFallback({ preview, values: { ...values, url: sourceUrl, addedBy } });
        return;
      }
      await savePreviewToInbox(preview, { ...values, addedBy });
    } catch (error) {
      showToast(error.message);
    } finally {
      setPendingQuickSave(false);
    }
  }

  async function savePendingWeiboLink() {
    if (!weiboFallback || pendingQuickSave) return;
    setPendingQuickSave(true);
    try {
      const saved = await savePreviewToInbox(weiboFallback.preview, weiboFallback.values);
      if (saved) setWeiboFallback(null);
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
    const date = planDates[key] || today();

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
    setQuery("");
    setSelectedTags([]);
    setAddedByFilter("all");
    setSelectedPlanDate("");
    setUndo(null);
    setPendingQuickSave(false);
    setWeiboFallback(null);
    setQuickDraft(createEmptyQuickSaveDraft());
    setOpenPanels([]);
    setPlanDates({});
    setVisitDates({});
    setRescheduleDates({});
    await persist(createInitialState(), "本地数据已清空");
  }

  function exportLocalData() {
    try {
      const backup = createStateBackup(state);
      const blobUrl = URL.createObjectURL(
        new Blob([backup.content], { type: "application/json;charset=utf-8" })
      );
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = backup.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(blobUrl);
      showToast("本地数据备份已导出");
    } catch (error) {
      showToast(error.message || "导出失败");
    }
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
    exportLocalData,
    clearLocalData
  };

  return (
    <div className="app-shell">
      <TopBar tab={tab} counts={counts} onQuickAdd={() => setTab("inbox")} />

      <main className="grid gap-4 px-4 py-4">
        {tab === "inbox" && <InboxScreen {...screenProps} />}
        {tab === "wishlist" && <WishlistScreen {...screenProps} />}
        {tab === "calendar" && <CalendarScreen {...screenProps} />}
        {tab === "visited" && <VisitedScreen {...screenProps} />}
        {tab === "profile" && <ProfileScreen {...screenProps} />}
      </main>

      <BottomNav tab={tab} setTab={setTab} />
      {weiboFallback && (
        <WeiboFallbackDialog
          pending={pendingQuickSave}
          onClose={() => setWeiboFallback(null)}
          onSave={savePendingWeiboLink}
        />
      )}
      {toast && <Toast message={toast} undo={undo} onUndo={undoLastAction} />}
    </div>
  );
}

function TopBar({ tab, counts, onQuickAdd }) {
  const subtitle = topBarSubtitle(tab, counts);

  return (
    <header className="app-bar">
      <div className="flex items-center gap-2.5">
        <Mascot size={46} />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[26px] leading-none text-zinc-950">{TAB_LABELS[tab]}</h1>
          <p className="mt-1 truncate text-sm font-medium text-zinc-500">{subtitle}</p>
        </div>
        <button className="icon-fab" type="button" aria-label="去收件箱保存新线索" title="保存新线索" onClick={onQuickAdd}>
          <Plus size={22} strokeWidth={2.4} />
        </button>
      </div>
    </header>
  );
}

function topBarSubtitle(tab, counts) {
  switch (tab) {
    case "inbox":
      return counts.pending ? `${counts.pending} 条待整理` : "先收起来，之后再整理";
    case "wishlist":
      return `${counts.wishlist} 条灵感，等一次出发`;
    case "calendar":
      return counts.plans ? `${counts.plans} 个计划待赴约` : "给想去的地方安排日期";
    case "visited":
      return counts.visits ? `${counts.visits} 条到店反馈` : "到店后留一个轻反馈";
    case "profile":
      return "标签、备份与本地数据";
    default:
      return "";
  }
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
        <div className="grid gap-1.5">
          <h2 className="font-display text-2xl leading-tight text-zinc-950">先收起来，之后再整理</h2>
          <p className="max-w-prose text-[15px] leading-relaxed text-zinc-600">
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
          placeholder="可选：解析不完整时可以补充..."
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
        {pending ? "保存中..." : "保存线索"}
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
        {item.authorName && <p className="text-sm font-semibold text-zinc-600">作者：{item.authorName}</p>}
        {item.sourceDescription && item.sourceDescription !== item.title && (
          <p className="line-clamp-3 text-sm leading-relaxed text-zinc-600">{item.sourceDescription}</p>
        )}
        <ContributorChip addedBy={item.addedBy} />
        <SourceLinkButton source={item} label={item.platform} />
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
              ["store", "整理为店铺"],
              ["dish", "整理为菜品"],
              ["store-dish", "店铺 + 菜品"],
              ["hold", "暂留一下"]
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
  const { state, query, setQuery, selectedTags, setSelectedTags, addedByFilter, setAddedByFilter } = props;
  const [sortBy, setSortBy] = useState("updatedAt");

  const searched = searchCollections(state, query);
  const tagStores = filterByTags(searched.stores, selectedTags)
    .filter((store) => ["want", "planned"].includes(store.status))
    .map((item) => ({ type: "store", item }));
  const tagDishes = filterByTags(searched.dishes, selectedTags)
    .filter((dish) => ["want", "planned"].includes(dish.status))
    .map((item) => ({ type: "dish", item }));
  const base = [...tagStores, ...tagDishes];

  const filterCounts = {
    all: base.length,
    xiaowang: base.filter((entry) => entry.item.addedBy === "xiaowang").length,
    xiaozhang: base.filter((entry) => entry.item.addedBy === "xiaozhang").length
  };
  const tagChips = topTagNames(base, 4);

  const items = base
    .filter((entry) => addedByFilter === "all" || entry.item.addedBy === addedByFilter)
    .sort((a, b) => sortValue(b.item, sortBy).localeCompare(sortValue(a.item, sortBy)));

  const featured = items[0];
  const rest = items.slice(1);

  return (
    <>
      <SearchField value={query} onChange={setQuery} />
      <ChipFilters
        addedByFilter={addedByFilter}
        setAddedByFilter={setAddedByFilter}
        selectedTags={selectedTags}
        setSelectedTags={setSelectedTags}
        counts={filterCounts}
        tagChips={tagChips}
      />

      {featured ? (
        <FeatureCard type={featured.type} item={featured.item} {...props} />
      ) : (
        <EmptyState>先去收件箱整理一条线索，就会出现在这里</EmptyState>
      )}

      {featured && (
        <>
          <div className="flex items-center justify-between gap-3 px-1 pt-1">
            <h2 className="font-display text-xl text-zinc-950">最近收藏</h2>
            <button
              className="sort-chip"
              type="button"
              onClick={() => setSortBy(sortBy === "updatedAt" ? "createdAt" : "updatedAt")}
            >
              <ArrowUpDown size={15} strokeWidth={2.2} />
              {sortBy === "updatedAt" ? "更新时间" : "收藏时间"}
            </button>
          </div>
          <div className="grid gap-3">
            {rest.length ? (
              rest.map(({ type, item }) => (
                <PlaceCard key={`${type}:${item.id}`} type={type} item={item} {...props} />
              ))
            ) : (
              <p className="mini-label px-1">没有更多收藏了</p>
            )}
          </div>
        </>
      )}
    </>
  );
}

function SearchField({ value, onChange }) {
  return (
    <div className="search-field">
      <label className="sr-only" htmlFor="wishlist-search">搜索店名、菜名或商圈</label>
      <Search className="search-icon" size={20} strokeWidth={2.2} />
      <input
        id="wishlist-search"
        value={value}
        autoComplete="off"
        placeholder="搜店名、菜名或商圈"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function ChipFilters({ addedByFilter, setAddedByFilter, selectedTags, setSelectedTags, counts, tagChips }) {
  function toggleTag(tag) {
    setSelectedTags(selectedTags.includes(tag) ? selectedTags.filter((item) => item !== tag) : [...selectedTags, tag]);
  }

  return (
    <div className="chip-row" aria-label="快速筛选">
      <FilterChip active={addedByFilter === "all"} onClick={() => setAddedByFilter("all")}>
        全部<span className="chip-count">{counts.all}</span>
      </FilterChip>
      <FilterChip active={addedByFilter === "xiaowang"} onClick={() => setAddedByFilter("xiaowang")}>
        小王<span className="chip-count">{counts.xiaowang}</span>
      </FilterChip>
      <FilterChip active={addedByFilter === "xiaozhang"} onClick={() => setAddedByFilter("xiaozhang")}>
        小张<span className="chip-count">{counts.xiaozhang}</span>
      </FilterChip>
      {tagChips.map((tag) => (
        <FilterChip key={tag} active={selectedTags.includes(tag)} onClick={() => toggleTag(tag)}>
          {tag}
        </FilterChip>
      ))}
    </div>
  );
}

function FilterChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      className={active ? "filter-chip filter-chip-active" : "filter-chip"}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function StatusButton({ className, idleLabel, pendingLabel, successLabel, onRun }) {
  const [status, setStatus] = useState("idle");
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function handleClick() {
    if (status !== "idle") return;
    setStatus("pending");
    try {
      await onRun();
      setStatus("success");
      timer.current = window.setTimeout(() => setStatus("idle"), 1100);
    } catch {
      setStatus("idle");
    }
  }

  return (
    <button
      className={className}
      type="button"
      onClick={handleClick}
      disabled={status !== "idle"}
      aria-busy={status === "pending"}
    >
      {status === "pending" && <Loader2 className="btn-spinner" size={17} aria-hidden="true" />}
      {status === "success" && <Check size={17} strokeWidth={2.6} aria-hidden="true" />}
      <span>{status === "pending" ? pendingLabel : status === "success" ? successLabel : idleLabel}</span>
    </button>
  );
}

function FeatureCard(props) {
  const { state, type, item, planDates, setPlanDates, scheduleTarget } = props;
  const [open, setOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const key = `${type}:${item.id}`;
  const location = itemLocation(state, type, item);
  const featureTag = item.featureTag || item.tagNames?.[0] || "最近收藏";
  const metaTag = (item.tagNames || []).find((tag) => tag !== featureTag) || "";
  const meta = [location, item.category, metaTag].filter(Boolean).join(" · ");

  return (
    <div className="grid gap-2">
      <article className={`feature-card feature-card-${foodMeta(item).key}`}>
        <div className="feature-cover">
          {item.coverImageUrl && !imageFailed ? (
            <img
              src={item.coverImageUrl}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <span className="feature-glyph" aria-hidden="true">{foodGlyph(item)}</span>
          )}
          <span className="feature-tag">{featureTag}</span>
          <span className="feature-contributor">{addedByLabel(item.addedBy)}添加</span>
        </div>
        <div className="feature-body">
          <div className="min-w-0">
            <h2 className="font-display text-2xl leading-tight text-zinc-950">{item.name}</h2>
            <p className="mt-1.5 truncate text-sm font-medium text-zinc-500">{meta || (type === "store" ? "店铺" : "菜品")}</p>
          </div>
          <button className="feature-cta" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
            安排日期
          </button>
        </div>
      </article>
      {open && (
        <div className="item-card card-drawer p-4">
          <div className="action-panel border-t-0 pt-0">
            <Field label="计划日期">
              <input
                type="date"
                value={planDates[key] || today()}
                onChange={(event) => setPlanDates({ ...planDates, [key]: event.target.value })}
              />
            </Field>
            <StatusButton
              className="primary-button"
              idleLabel="加入日历"
              pendingLabel="安排中…"
              successLabel="已加入日历"
              onRun={() => scheduleTarget(type, item.id)}
            />
          </div>
          <CardExtras {...props} />
        </div>
      )}
    </div>
  );
}

function PlaceCard(props) {
  const { state, type, item } = props;
  const [open, setOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const location = itemLocation(state, type, item);
  const meta = [location, type === "store" ? "店铺" : "菜品", `${addedByLabel(item.addedBy)}添加`]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="grid gap-2">
      <button className="place-card text-left" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={`place-thumb place-thumb-${foodMeta(item).key}`}>
          {item.coverImageUrl && !imageFailed ? (
            <img
              src={item.coverImageUrl}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <span className="glyph" aria-hidden="true">{foodGlyph(item)}</span>
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-display text-[17px] text-zinc-950">{item.name}</span>
          <span className="mt-0.5 block truncate text-[13px] font-medium text-zinc-500">{meta}</span>
          {item.tagNames?.length ? (
            <span className="mt-2 flex flex-wrap gap-2">
              {item.tagNames.slice(0, 2).map((tag) => (
                <span key={tag} className="chip-passive">{tag}</span>
              ))}
              {item.tagNames.length > 2 ? <span className="chip-overflow">+{item.tagNames.length - 2}</span> : null}
            </span>
          ) : null}
        </span>
        <span className="place-chevron" aria-hidden="true">
          <ChevronRight size={20} strokeWidth={2.2} />
        </span>
      </button>
      {open && (
        <div className="item-card card-drawer p-4">
          <PlanRow {...props} />
          <CardExtras {...props} />
        </div>
      )}
    </div>
  );
}

function PlanRow({ type, item, planDates, setPlanDates, scheduleTarget }) {
  const key = `${type}:${item.id}`;
  return (
    <div className="action-panel border-t-0 pt-0">
      <Field label="计划日期">
        <input
          type="date"
          value={planDates[key] || today()}
          onChange={(event) => setPlanDates({ ...planDates, [key]: event.target.value })}
        />
      </Field>
      <StatusButton
        className="primary-button"
        idleLabel="安排日期"
        pendingLabel="安排中…"
        successLabel="已加入日历"
        onRun={() => scheduleTarget(type, item.id)}
      />
    </div>
  );
}

function CardExtras(props) {
  const { type, item, visitDates, setVisitDates, visitTarget, softDelete } = props;
  const key = `${type}:${item.id}`;

  return (
    <>
      <SourceLinksPanel links={item.sourceLinks || []} />
      <DetailsPanel id={`feedback:${key}`} title="到店轻反馈" {...props}>
        <div className="action-panel border-t-0 pt-0">
          <Field label="到店日期">
            <input
              type="date"
              value={visitDates[key] || today()}
              onChange={(event) => setVisitDates({ ...visitDates, [key]: event.target.value })}
            />
          </Field>
          <FeedbackButtons onPick={(feedback) => visitTarget(type, item.id, feedback)} />
        </div>
      </DetailsPanel>
      <EditForm type={type} item={item} {...props} />
      <button
        className="text-button"
        type="button"
        onClick={() => softDelete(type === "store" ? "stores" : "dishes", item.id)}
      >
        移入回收站
      </button>
    </>
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
          <FeedbackPill feedback={visit.feedback} />
          <IconButton label="撤销轻反馈" onClick={() => softDelete("visitRecords", visit.id)}>
            <Trash2 size={18} />
          </IconButton>
        </div>
        {visit.note ? <p className="text-sm font-semibold text-zinc-600">{visit.note}</p> : null}
      </div>
    </article>
  );
}

function ProfileScreen({ state, mutate, exportLocalData, clearLocalData }) {
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
        <p className="text-[15px] font-medium text-zinc-600">数据版本：v{state.meta.dataVersion}</p>
        <p className="text-[15px] font-medium text-zinc-600">当前支持固定添加人：小王 / 小张；历史数据会显示为未标记。</p>
        <p className="text-[15px] font-medium text-zinc-600">收藏数据保存在当前浏览器的 IndexedDB 中，可先导出 JSON 备份供后续迁移。</p>
        <button className="secondary-button w-fit" type="button" onClick={exportLocalData}>导出 JSON 备份</button>
      </section>

      <section className="panel danger-zone">
        <h2 className="font-display text-2xl text-zinc-950">危险操作</h2>
        <p className="text-[15px] font-medium text-zinc-600">清空后只能靠已导出的 JSON 备份恢复，操作前请先导出。</p>
        <button className="danger-button" type="button" onClick={clearLocalData}>清空本地数据</button>
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
  const ids = Object.keys(TAB_LABELS);
  const activeIndex = Math.max(0, ids.indexOf(tab));

  return (
    <nav className="bottom-nav" aria-label="主导航">
      <span className="nav-indicator" aria-hidden="true" style={{ "--nav-index": activeIndex }} />
      {ids.map((id) => {
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
            <Icon size={22} active={active} />
            <span className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap">{TAB_LABELS[id]}</span>
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

function SourceLinkButton({ source, label = "来源" }) {
  const href = sourceHref(source);
  if (!href) return null;

  return (
    <a
      className="secondary-button w-fit max-w-full"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      打开{label === "未知平台" ? "原" : label}内容
    </a>
  );
}

function SourceLinksPanel({ links }) {
  const visibleLinks = uniqueSourceLinks(links);
  if (!visibleLinks.length) return null;

  return (
    <div className="action-panel border-t-0 pt-0">
      <p className="mini-label">来源链接（{visibleLinks.length}）</p>
      <div className="flex flex-wrap gap-2">
        {visibleLinks.map((link) => (
          <SourceLinkButton key={link.id || sourceHref(link)} source={link} label={link.platform || "来源"} />
        ))}
      </div>
    </div>
  );
}

function WeiboFallbackDialog({ pending, onClose, onSave }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/55 p-4" role="presentation">
      <section
        className="panel w-full max-w-md"
        role="dialog"
        aria-modal="true"
        aria-labelledby="weibo-fallback-title"
      >
        <h2 id="weibo-fallback-title" className="font-display text-2xl text-zinc-950">微博链接暂不支持自动解析</h2>
        <p className="text-[15px] leading-relaxed text-zinc-600">
          建议手动打开大众点评，搜索对应店铺后，再复制完整的大众点评分享内容。这里不会尝试从微信直接唤起大众点评。
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <button className="primary-button" type="button" onClick={onClose} disabled={pending}>我去大众点评搜索</button>
          <button className="secondary-button" type="button" onClick={onSave} disabled={pending}>
            {pending ? "保存中..." : "先保存微博链接"}
          </button>
        </div>
      </section>
    </div>
  );
}

function FeedbackPill({ feedback }) {
  const { cls, Icon } = FEEDBACK_PILL[feedback] || FEEDBACK_PILL.ok;
  return (
    <span className={cls}>
      <Icon size={14} strokeWidth={2.4} aria-hidden="true" />
      {FEEDBACK_LABELS[feedback]}
    </span>
  );
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

function EmptyState({ children }) {
  return (
    <div className="empty-state">
      <Mascot size={72} mood="calm" />
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

function sourceHref(source) {
  const value = String(
    source?.resolvedUrl || source?.normalizedUrl || source?.sharedUrl || ""
  ).trim();
  return /^https?:\/\//i.test(value) ? value : "";
}

function uniqueSourceLinks(links) {
  const seen = new Set();
  return (Array.isArray(links) ? links : []).filter((link) => {
    const href = sourceHref(link);
    if (!href || seen.has(href)) return false;
    seen.add(href);
    return true;
  });
}

function itemLocation(state, type, item) {
  if (type === "store") return item.businessDistrict || item.city || "";
  const store = item.storeId ? activeItems(state.stores).find((candidate) => candidate.id === item.storeId) : null;
  return store?.businessDistrict || store?.city || "";
}

function sortValue(item, key) {
  return item[key] || item.updatedAt || item.createdAt || "";
}

function topTagNames(entries, limit) {
  const freq = new Map();
  for (const { item } of entries) {
    for (const tag of item.tagNames || []) {
      freq.set(tag, (freq.get(tag) || 0) + 1);
    }
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name]) => name);
}

const FOOD_CATEGORIES = [
  { re: /面|云吞|馄饨|粉|米线/, glyph: "🍜", key: "noodle" },
  { re: /串|烧鸟|烧烤|烤/, glyph: "🍢", key: "skewer" },
  { re: /火锅|锅底|涮/, glyph: "🍲", key: "hotpot" },
  { re: /咖啡|拿铁|美式/, glyph: "☕️", key: "coffee" },
  { re: /糖水|甜|蛋糕|布丁|杨枝/, glyph: "🍮", key: "dessert" },
  { re: /烘焙|可颂|面包|吐司|贝果/, glyph: "🥐", key: "bakery" },
  { re: /日料|刺身|寿司|三文鱼|河豚|居酒屋/, glyph: "🍣", key: "sushi" },
  { re: /龙虾|虾/, glyph: "🦐", key: "seafood" },
  { re: /泰|冬阴功|咖喱/, glyph: "🍛", key: "curry" },
  { re: /茶/, glyph: "🍵", key: "tea" },
  { re: /酒/, glyph: "🍶", key: "izakaya" },
  { re: /西餐|牛排|意面/, glyph: "🍽️", key: "western" },
  { re: /肉/, glyph: "🍖", key: "meat" }
];

const DEFAULT_FOOD_CATEGORY = { glyph: "🍽️", key: "default" };

function foodMeta(item) {
  const hay = `${item.category || ""} ${item.name || ""} ${(item.tagNames || []).join(" ")}`;
  return FOOD_CATEGORIES.find((category) => category.re.test(hay)) || DEFAULT_FOOD_CATEGORY;
}

function foodGlyph(item) {
  return foodMeta(item).glyph;
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
