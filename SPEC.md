# SPEC：移动端体验优化（B5）

## 背景

用户主要在手机上用这个应用（PWA 已装）。当前桌面优先的布局在小屏上有四个具体问题：
1. 模型页「打印配置」的表格在 390 px 宽度下横向溢出，得左右拖动才能看全。
2. 参数面板（PrintOptions）字段多、控件高 32 px，手指点容易点错。
3. 底部操作按钮（切片/发送）在长页面里要滚到底才能点到。
4. 首页模型卡片在窄屏变成单列但留白过多，滚动距离长。

## 目标

在 **390 × 844（iPhone 14/15 逻辑分辨率）** 下做到：无横向滚动、主要操作拇指可达、表格信息完整不丢失。

## 具体要求

### 1. 布局
- 所有页面 `body { overflow-x: hidden }` 不能靠这个糊过去；要真正让容器不超宽。
- 用 CSS 变量控制断点：`@media (max-width: 640px)` 为主要断点，`@media (max-width: 420px)` 为小屏微调。
- 不要在 JS 里读 `window.innerWidth` 做布局（会闪），用纯 CSS。

### 2. 表格 → 卡片
- 模型页的打印配置表、摆盘结果表、历史明细表，在 ≤640px 时改为纵向卡片布局（每行一个卡片，字段名 + 值左右对齐）。
- 只能用 CSS（`display: block` + `::before` 取 `data-label`），**不要**复制一份 JSX 出来做两套渲染。

### 3. 触控
- 所有可点击元素最小高度 **44 px**，间距 ≥8 px。
- 主要操作（切片、发送、开始打印、摆盘优化）在 ≤640px 时固定在屏幕底部（`position: sticky; bottom: 0`），带安全区内边距 `env(safe-area-inset-bottom)`。
- 输入框字号 ≥16 px（否则 iOS 会自动放大页面）。

### 4. 图形
- 3D 预览画布在窄屏按 `aspect-ratio: 1 / 1` 自适应，不要固定高度。
- 表格里的缩略图在窄屏降到 48 px。

### 5. 不改的东西
- 不改任何后端逻辑、API、数据结构。
- 不改桌面端（>640px）的视觉效果：桌面截图应与改动前一致。

## 禁止事项

- 不要跑 `pnpm build`，只允许 `pnpm exec tsc --noEmit`。
- 不要引入新依赖（不要 tailwind、不要 UI 库）。
- 不要修改 `src/lib/*.ts`（除了纯样式常量的地方，如需要把尺寸抽成常量）。
- 不要改打印/切片/摆盘的任何业务逻辑。

## 验收标准（必须真做）

1. `pnpm exec tsc --noEmit` 通过。
2. 用 headless Chrome 在 **390×844** 下逐页截图并检查：
   ```
   google-chrome --headless=new --window-size=390,844 --screenshot=/tmp/m-<page>.png --virtual-time-budget=6000 <url>
   ```
   页面至少覆盖：`/`（首页）、`/model/2322561?source=cn`（模型页）、`/settings`、`/history`。
3. 用 JS 检查每页 `document.documentElement.scrollWidth <= 390`，把每页的 `scrollWidth` 实数写进报告。
4. 同样方式在 **1280×800** 下截一张桌面图，确认布局没被改坏（对比可见元素没有错位）。
5. 报告里贴出：每页 scrollWidth、截图路径、改了哪些文件。

## 交付

- 一个 commit，中文 message。
- 报告：页面清单 + scrollWidth 实测 + 截图路径 + 遗留问题（哪些页面还没优化）。
