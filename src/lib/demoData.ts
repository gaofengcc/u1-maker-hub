import type { ModelCard } from "./makerworld.ts";

/** 演示模式使用的本地模型数据，绝不访问外部模型站。 */
export const DEMO_MODELS: ModelCard[] = [
  {
    id: 910001,
    title: "多色桌面收纳盒",
    cover: "/icons/icon-512.png",
    creator: { name: "U1 示例作者", avatar: "/icons/icon-192.png" },
    downloads: 1280,
    likes: 96,
    prints: 42,
    license: "CC BY",
  },
  {
    id: 910002,
    title: "关节活动小龙",
    cover: "/icons/icon-512.png",
    creator: { name: "Demo Maker", avatar: "/icons/icon-192.png" },
    downloads: 860,
    likes: 74,
    prints: 31,
    license: "CC BY-SA",
  },
  {
    id: 910003,
    title: "模块化工具架",
    cover: "/icons/icon-512.png",
    creator: { name: "U1 示例作者", avatar: "/icons/icon-192.png" },
    downloads: 642,
    likes: 51,
    prints: 19,
    license: "CC0",
  },
  {
    id: 910004,
    title: "桌面植物花盆",
    cover: "/icons/icon-512.png",
    creator: { name: "Demo Studio", avatar: "/icons/icon-192.png" },
    downloads: 438,
    likes: 38,
    prints: 12,
    license: "CC BY",
  },
];

export function demoModelsForQuery(query: string): ModelCard[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return DEMO_MODELS;
  return DEMO_MODELS.filter((model) => `${model.title} ${model.creator.name}`.toLocaleLowerCase().includes(q));
}
