import { createInitialState, createId } from "./domain.js";

/*
  In-memory preview seed. Only used when the app is opened with a
  `?demo` query flag, and it is NEVER written back to IndexedDB
  (App keeps demo state purely in React memory). This exists so the
  redesign can be reviewed with representative content without
  polluting real local-first storage. Not a production fixture.
*/

const DAY = 86400000;
const NOW = Date.parse("2026-07-21T20:00:00+08:00");

// index 0 is the most-recent (featured) item; timestamps descend.
function ago(index) {
  return new Date(NOW - index * (DAY / 3)).toISOString();
}

const STORE_SEED = [
  { name: "炭火小酒馆", city: "上海", district: "静安寺", category: "烧鸟", by: "xiaowang", tags: ["晚餐", "适合约会"], feature: "周五晚餐" },
  { name: "阿川夜市串串", city: "上海", district: "长宁", category: "串串", by: "xiaowang", tags: ["朋友聚餐", "夜宵"] },
  { name: "巷子口私房菜", city: "上海", district: "徐汇", category: "本帮菜", by: "xiaozhang", tags: ["家常", "工作日"] },
  { name: "海盐咖啡研究所", city: "上海", district: "武康路", category: "咖啡", by: "xiaozhang", tags: ["下午茶", "一个人吃"] },
  { name: "六月里手打面", city: "上海", district: "黄浦", category: "面馆", by: "xiaowang", tags: ["午餐", "工作日"] },
  { name: "山与海居酒屋", city: "上海", district: "南京西路", category: "日料", by: "xiaozhang", tags: ["晚餐", "朋友聚餐"] },
  { name: "老灶头火锅", city: "上海", district: "五角场", category: "火锅", by: "xiaowang", tags: ["聚餐", "夜宵"] },
  { name: "晚风露台餐厅", city: "上海", district: "新天地", category: "西餐", by: "xiaozhang", tags: ["适合约会", "晚餐"] },
  { name: "巷弄糖水铺", city: "上海", district: "田子坊", category: "甜品", by: "xiaowang", tags: ["下午茶", "甜品"] },
  { name: "河豚料理本店", city: "上海", district: "陆家嘴", category: "日料", by: "xiaozhang", tags: ["晚餐", "适合约会"] },
  { name: "拾光烘焙", city: "上海", district: "愚园路", category: "烘焙", by: "xiaowang", tags: ["早餐", "一个人吃"] },
  { name: "码头小龙虾", city: "上海", district: "虹口", category: "小龙虾", by: "xiaowang", tags: ["夜宵", "朋友聚餐"] },
  { name: "青柠泰厨", city: "上海", district: "静安寺", category: "泰餐", by: "xiaozhang", tags: ["午餐", "聚餐"] },
  { name: "半山茶室", city: "上海", district: "衡山路", category: "茶饮", by: "xiaowang", tags: ["下午茶", "一个人吃"] }
];

const DISH_SEED = [
  { name: "虾籽云吞面", storeIndex: 4, category: "面馆", by: "xiaozhang", tags: ["一个人吃", "工作日"] },
  { name: "炭烤鸡软骨", storeIndex: 0, category: "烧鸟", by: "xiaowang", tags: ["晚餐", "下酒"] },
  { name: "麻辣牛油锅底", storeIndex: 6, category: "火锅", by: "xiaowang", tags: ["聚餐", "夜宵"] },
  { name: "海盐芝士拿铁", storeIndex: 3, category: "咖啡", by: "xiaozhang", tags: ["下午茶"] },
  { name: "招牌红烧肉", storeIndex: 2, category: "本帮菜", by: "xiaowang", tags: ["家常", "午餐"] },
  { name: "厚切三文鱼刺身", storeIndex: 5, category: "日料", by: "xiaowang", tags: ["晚餐"] },
  { name: "杨枝甘露", storeIndex: 8, category: "甜品", by: "xiaowang", tags: ["甜品", "下午茶"] },
  { name: "蒜蓉小龙虾", storeIndex: 11, category: "小龙虾", by: "xiaozhang", tags: ["夜宵", "聚餐"] },
  { name: "冬阴功汤", storeIndex: 12, category: "泰餐", by: "xiaozhang", tags: ["午餐"] },
  { name: "现烤可颂", storeIndex: 10, category: "烘焙", by: "xiaozhang", tags: ["早餐", "一个人吃"] }
];

export function createDemoState() {
  const state = createInitialState();
  const storeIds = [];
  let clock = 0;

  STORE_SEED.forEach((seed, i) => {
    const id = createId("store");
    storeIds.push(id);
    const stamp = ago(clock++);
    state.stores.push({
      id,
      name: seed.name,
      addedBy: seed.by,
      city: seed.city,
      businessDistrict: seed.district,
      addressNote: "",
      category: seed.category,
      featureTag: seed.feature || "",
      tagNames: seed.tags,
      coverImageUrl: "",
      note: "",
      status: "want",
      sourceLinks: [],
      createdAt: stamp,
      updatedAt: stamp
    });
  });

  DISH_SEED.forEach((seed) => {
    const id = createId("dish");
    const stamp = ago(clock++);
    state.dishes.push({
      id,
      name: seed.name,
      addedBy: seed.by,
      storeId: storeIds[seed.storeIndex] || null,
      category: seed.category,
      tagNames: seed.tags,
      coverImageUrl: "",
      note: "",
      status: "want",
      createdAt: stamp,
      updatedAt: stamp
    });
  });

  return state;
}

export function isDemoMode() {
  try {
    return new URLSearchParams(window.location.search).has("demo");
  } catch {
    return false;
  }
}
