# 移动端优化验收报告

验收视口为 390 × 844，页面通过本地 Next 开发服务器 `http://127.0.0.1:3002` 访问。

## 页面清单

| 页面 | 实测 `document.documentElement.scrollWidth` | 截图 |
| --- | ---: | --- |
| `/` | 390 px | `/tmp/mobile-acceptance/m-home.png` |
| `/model/2322561?source=cn` | 390 px | `/tmp/mobile-acceptance/m-model.png` |
| `/settings` | 390 px | `/tmp/mobile-acceptance/m-settings.png` |
| `/history` | 390 px | `/tmp/mobile-acceptance/m-history.png` |

桌面视口 1280 × 800 截图为 `/tmp/mobile-acceptance/m-desktop-home.png`。已目视检查导航、搜索、筛选和卡片网格，没有发现桌面布局错位。

## 实现内容

- `src/app/globals.css` 增加 640 px 和 420 px 移动断点、容器宽度约束、44 px 触控尺寸、16 px 输入字号、窄屏 1:1 预览画布、48 px 缩略图、首页双列卡片和底部安全区 sticky 操作区。
- `src/components/PrintSetup.tsx`、`src/components/PlateView.tsx`、`src/components/ModelView.tsx` 为切片、发送和摆盘优化操作区增加移动端 sticky 布局。
- `src/components/ModelView.tsx`、`src/components/HistoryView.tsx`、`src/components/PrinterView.tsx` 为表格行增加 `data-label`，窄屏使用 CSS 卡片布局。
- `src/components/SettingsView.tsx` 让验证码和邮箱操作行在窄屏换行，避免输入控件超出容器。

## 验证命令

- `pnpm exec tsc --noEmit` 通过，使用项目声明的 pnpm 8.7.4 执行。
- 截图使用 `google-chrome --headless=new --window-size=390,844 --screenshot=... --virtual-time-budget=6000` 实际生成。
- `scrollWidth` 使用 Chrome DevTools Protocol 在 390 × 844 页面中实际读取，四页均为 390 px。

## 遗留问题

验收页面没有发现横向滚动。未对 SPEC 未列出的页面逐页截图。
