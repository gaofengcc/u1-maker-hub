# 中文 + 中国站改造清单（只读代码梳理）

> 依据仓库当前代码与用户给出的 2026-11-23 外部事实整理。本轮只给方案，不修改业务代码；行号以当前工作树为准。

## 1. 架构总览

这是 Next.js 16 App Router 应用。`src/app/layout.tsx:25-45` 是根布局、全局 `<Header>`、页脚和 Service Worker；`src/app/page.tsx:5-22`、`src/app/model/[id]/page.tsx:12-71` 等是服务端页面，读取 URL 参数、本地设置或上游数据后把 props 交给客户端组件。交互密集的 `Explore`、`ModelView`、`PlateView`、`PrinterView`、`SettingsView` 等在文件首行标记 `"use client"`（例如 `src/components/Explore.tsx:1`），浏览器通过 `src/lib/format.ts:69-81` 的 `api()` 调用本应用 API；Three.js 预览也在客户端（`src/components/BedViewer.tsx:1-6`、`src/lib/bedScene.ts:24`）。

持久化是进程本地文件而非数据库：`src/lib/store.ts:6-9` 从 `DATA_DIR` 派生 `settings.json`、`downloads/`、`jobs/`；`favorites.ts:21-22`、`plate.ts:41`、`uploads.ts:15` 各自追加 favorites、plate、uploads。`writeSettings()` 使用 `mkdirSync` 和 mode `0600`（`store.ts:45-49`），但 favorites、plate、job JSON 没有锁；进程内 job registry 在 `jobs.ts:69`。

systemd 路径在 `deploy/setup-lxc.sh:11-15,51-76`：Ubuntu 24.04、Node 22、`DATA_DIR=/var/lib/u1-maker-hub`、`HOME` 同目录、`SLICER_APP=/opt/orcaslicer`，服务用户 `u1hub`，`ProtectSystem=full`、`PrivateTmp`、`NoNewPrivileges`。`deploy/deploy.sh:14-32` rsync 源码（排除 data/node_modules/.next），远端构建后重启 systemd。Docker 路径在 `Dockerfile:26-72`：多阶段构建，Ubuntu 24.04 runtime 内置 OrcaSlicer 2.4.2，`DATA_DIR=/data`、`HOME=/data`、UID 1000；`docker-compose.yml:4-29` 强制 `linux/amd64`、`init: true`、命名卷 `u1-data`、2 CPU/3 GB 内存限制和 30 秒优雅停止。两者共同点是单实例、文件存储、Node 服务监听 3000；差异是数据目录、进程回收/权限隔离、升级方式（rsync+systemd 对比重建镜像/卷保留）以及 Docker 的 amd64 仿真约束。

文字版数据流：

```text
浏览器
  ├─ GET /（服务端 page → Explore 客户端）
  │    └─ /api/mw/search → makerworld.search → api.bambulab.{com|cn}/v1/search-service/select/design2
  ├─ /model/{id}（服务端 page → getDesign）
  │    └─ /api/mw/design/{id} → makerworld.getDesign → /v1/design-service/design/{id}
  └─ ModelView/PlateView 点击切片或打印
       └─ /api/jobs 或 /api/plate/print
            └─ jobs.createJob（异步 runJob）
                 ├─ makerworld.downloadInstance → instance/{id}/f3mf（Bearer）→ 签名 CDN → DATA_DIR/downloads
                 ├─ slicer.sliceForU1 → OrcaSlicer 2.4.2 CLI → DATA_DIR/jobs/{job}/...
                 └─ jobs.runSend → printer.uploadGcode/runGcode/startPrint → Moonraker → Snapmaker U1
                       └─ /api/printer/status、/camera 轮询状态与 JPEG
```

## 2. 模块地图

下表按 `src/lib/*` 逐文件列出职责；“纯/IO”分别表示主要是纯计算、文件/网络/进程副作用。

| 文件 | 一句话职责；依赖/性质 |
|---|---|
| `bedScene.ts:1-91` | Three.js 床面场景；依赖 `packing`；浏览器对象副作用（客户端）。 |
| `combine.ts:1-196` | 合并多个 3MF、排版、重编号耗材；依赖 geometry/packing/orient/jszip；文件 IO。 |
| `favorites.ts:1-122` | favorites 与同步状态 JSON；依赖 store、makerworld 类型；文件 IO。 |
| `format.ts:1-122` | 图片 URL、数字/时长/价格、浏览器 API、颜色匹配；除 `api()` 外均纯函数。 |
| `geometry.ts:1-351` | 解析 3MF 网格、矩阵、盘面变换；依赖 packing/orient/jszip；解析纯函数+文件/ZIP IO。 |
| `homeassistant.ts:1-89` | Home Assistant 电源状态/开关；依赖 store；网络 IO。 |
| `http.ts:1-28` | `MakerWorldError`/`PrinterError`/`PowerError` 转 JSON、读 JSON body；副作用为日志输出。 |
| `jobs.ts:1-348` | job JSON、异步下载→预设→切片→上传→打印状态机；依赖 store/makerworld/threemf/slicer/combine/printer/uploads；文件、网络、子进程 IO。 |
| `layerHeights.ts:1-225` | 从三角面计算自适应层高并写入 3MF；依赖 geometry/jszip；计算+ZIP IO。 |
| `makerworld.ts:1-430` | Bambu/MakerWorld 搜索、详情、收藏、下载、登录；依赖 store；HTTP IO、下载缓存、token 写入。 |
| `meshFile.ts:1-27` | 自定义 mesh 二进制编码和响应头；纯函数。 |
| `orient.ts:1-81` | 姿态矩阵、铺平、输入清洗；纯函数。 |
| `packing.ts:1-91` | U1 床尺寸及多床排版；纯函数。 |
| `plate.ts:1-116` | 待打印模型列表 `plate.json` 的增删改；依赖 store/uploads；文件 IO。 |
| `previewMesh.ts:1-61` | 客户端从 `/api/preview` 或 `/api/uploads` 获取 mesh 并解码；网络 IO+纯解码。 |
| `printer.ts:1-238` | Moonraker 查询、G-code、上传、启动、摄像头唤醒；依赖 store；网络/WebSocket/文件 IO。 |
| `profiles.ts:1-92` | 从 `SLICER_APP` 读取 Orca/ Snapmaker 预设并展平；文件 IO+少量纯过滤。 |
| `slicer.ts:1-333` | 生成 U1 预设、变换输入、spawn OrcaSlicer、解析退出码；依赖 profiles/threemf/geometry/stl/layerHeights；子进程/文件 IO。 |
| `stl.ts:1-251` | STL 解析、检查、变换、封装 3MF；依赖 geometry/packing/orient/jszip；主要纯计算。 |
| `store.ts:1-65` | `DATA_DIR`、设置读写和脱敏公开设置；文件 IO。 |
| `threemf.ts:1-109` | 读取/替换 3MF project/model settings、缩略图；依赖 geometry/layerHeights/jszip；ZIP/文件 IO。 |
| `toolpath.ts:1-156` | G-code 工具路径解析/编码；纯函数+读取文件入口。 |
| `toolpathView.ts:1-74` | 客户端获取并解码工具路径；网络 IO+纯解码。 |
| `uploads.ts:1-199` | 上传 STL/3MF 校验、预览和封面；依赖 store/stl/meshFile/geometry/threemf；文件 IO。 |
| `useCreatorSupports.ts:1-64` | 客户端 hook 读取 profile supports 并合并选项；网络 IO（hook）+状态。 |
| `useFavorites.ts:1-124` | 客户端 favorites 外部 store、同步和 toggle；网络 IO+浏览器状态。 |
| `usePlate.ts:1-95` | 客户端 plate 外部 store、增删改；网络 IO+浏览器状态。 |

API 路由地图（逐文件一句话）：

| 路由 | 职责/调用 |
|---|---|
| `api/auth/code/route.ts:1-15` | 发送邮箱一次性登录码；调用 `sendLoginCode`。 |
| `api/auth/login/route.ts:1-16` | 密码、邮箱码登录；调用 `login/loginWithCode`。 |
| `api/auth/tfa/route.ts:1-13` | 校验认证器 TFA；调用 `loginWithTfa`。 |
| `api/auth/token/route.ts:1-25` | 粘贴 token、读取登录态、登出；调用 `saveToken/logout/publicSettings`。 |
| `api/download/[instanceId]/route.ts:1-28` | 读取并下载本地缓存的原始 3MF；调用 `downloadInstance` 和文件 IO。 |
| `api/favorites/route.ts:1-18` | 列出/新增本地收藏；调用 `listFavorites/addFavorite`。 |
| `api/favorites/[id]/route.ts:1-9` | 删除本地收藏；调用 `removeFavorite`。 |
| `api/favorites/sync/route.ts:1-47` | 同步 MakerWorld likes/collects 并写同步状态；调用 `myMakerWorldSaves/mergeMakerWorld`。 |
| `api/jobs/route.ts:1-72` | 创建或列出 job，校验上传/变换参数；调用 `createJob/listJobs`。 |
| `api/jobs/[id]/route.ts:1-9` | 返回单个 job 和最近日志；调用 `getJob`。 |
| `api/jobs/[id]/file/route.ts:1-29` | 发送 job 的 G-code/3MF 文件；调用 `getJob` 和文件 IO。 |
| `api/jobs/[id]/send/route.ts:1-14` | 把已切片 job 的指定盘发送到打印机；调用 `sendJob`。 |
| `api/jobs/[id]/toolpath/route.ts:1-22` | 将 job G-code 转为工具路径 mesh；调用 `toolpathFor`。 |
| `api/mw/search/route.ts:1-23` | 规范化搜索参数并返回分页；调用 `defaultListing/search`。 |
| `api/mw/design/[id]/route.ts:1-14` | 返回 MakerWorld 设计详情；调用 `getDesign`。 |
| `api/plate/route.ts:1-30` | 列出、加入、清空待打印盘；调用 `listPlate/addToPlate/addManyToPlate/clearPlate`。 |
| `api/plate/[id]/route.ts:1-14` | 修改或删除盘上的一项；调用 `updatePlateEntry/removePlateEntry`。 |
| `api/plate/print/route.ts:1-45` | 把整盘项目创建成多盘 job，可选择直接发送；调用 `createJob`。 |
| `api/presets/route.ts:1-17` | 返回打印模式、默认选项和 U1 耗材预设；调用 `u1Filaments` 和 `PRINT_MODES`。 |
| `api/preview/[instanceId]/route.ts:1-28` | 下载 profile 后缓存并返回盘面 mesh；调用 `downloadInstance/readPlateMesh`。 |
| `api/profile/[instanceId]/route.ts:1-18` | 返回创作者 profile 的 supports；调用 `downloadInstance/readProject`。 |
| `api/printer/status/route.ts:1-17` | 返回 Moonraker 状态和可选历史；调用 `getStatus/jobHistory`。 |
| `api/printer/camera/route.ts:1-50` | 获取完整 JPEG，相机睡眠时唤醒重试；调用 `cameraUrls/wakeCamera`。 |
| `api/printer/action/route.ts:1-49` | 只允许固定暂停/速度/温度等动作；调用 `printerAction/runGcode`。 |
| `api/printer/power/route.ts:1-35` | 读取/切换 Home Assistant 电源，并防止打印中断电；调用 `getPower/setPower/getStatus`。 |
| `api/printer/test/route.ts:1-14` | 探测给定 host 是否为 Moonraker；调用 `serverInfo`。 |
| `api/settings/route.ts:1-54` | 读取脱敏设置、校验并保存打印机/HA/工具头；调用 `publicSettings/writeSettings`。 |
| `api/uploads/route.ts:1-26` | 原始 STL/3MF 上传和列表；调用 `saveUpload/listUploads`。 |
| `api/uploads/[id]/route.ts:1-15` | 读取或删除上传记录；调用 `getUpload/deleteUpload`。 |
| `api/uploads/[id]/cover/route.ts:1-24` | 上传或读取模型封面；调用 `saveUploadCover/uploadCoverPath`。 |
| `api/uploads/[id]/mesh/route.ts:1-14` | 返回上传模型某盘的预览 mesh；调用 `uploadPreviewPath`。 |

## 3. 端到端调用链

1. 首页服务端 `src/app/page.tsx:13-22` 计算排序/周期并渲染 `Explore`；用户点击 `src/components/Explore.tsx:76-93` 的搜索或 `:140-145` 的“加载更多”。
2. `Explore.load()` 在 `src/components/Explore.tsx:36-58` 调 `/api/mw/search`；`src/app/api/mw/search/route.ts:6-21` 校验参数并调用 `search`；`src/lib/makerworld.ts:147-173` 组装 `design2` 查询，`call()` 在 `:25-62,168` 请求 `https://api.bambulab.com`（中国站改造后按站点选择 `.cn`）。
3. 点击卡片进入 `src/components/ModelCard.tsx:17-33` → `src/app/model/[id]/page.tsx:37-69`；服务端 `getDesign()` 位于 `src/lib/makerworld.ts:253-303`，请求 `/v1/design-service/design/{id}` 并映射 instances/plates。
4. `ModelView` 的“切片/打印”表单在 `src/components/ModelView.tsx:238-253` 调 `POST /api/jobs`；单模型路由 `src/app/api/jobs/route.ts:39-70` 调 `createJob`。多模型则 `src/components/PlateView.tsx:124-140` → `src/app/api/plate/print/route.ts:10-44` → `createJob`。
5. `createJob()` 在 `src/lib/jobs.ts:101-131` 写 `DATA_DIR/jobs/{uuid}/job.json`，并以 `void runJob(job)` 异步执行。`runJob` 分支在 `:167-230`：MakerWorld profile 调 `downloadInstance`（`:220-229`；多模型 `:193-218`），上传模型走 `uploads.ts`。
6. `downloadInstance()` 在 `src/lib/makerworld.ts:345-364` 以 `instanceId.3mf` 缓存；先用 Bearer 请求 `:353-355` 的 `f3mf?type=download`，再用签名 CDN URL（`:357-360`）取 PK/3MF。给定事实要求 token，403 应在此映射为登录错误。
7. `runJob` 在 `src/lib/jobs.ts:233-275` 对每张盘串行调用 `sliceForU1`；`src/lib/slicer.ts:154-258` 写预设、变换 3MF/STL、`spawn` OrcaSlicer（`slicer.ts:306-332`），使用上游 OrcaSlicer 2.4.2。
8. 若 `send=true`，`runSend` 在 `src/lib/jobs.ts:281-311` 先 `getStatus` 检查打印/暂停，再 `uploadGcode`（`src/lib/printer.ts:151-164`）、按耗材映射 `runGcode`（`jobs.ts:299-303`），最后 `startPrint`（`printer.ts:166-168`）。三者均经 Moonraker `printerBase()`（`printer.ts:15-36`）。
9. `PrinterView` 每 2 秒请求 `/api/printer/status?history=1`（`src/components/PrinterView.tsx:25-41`），API `src/app/api/printer/status/route.ts:5-16` 调 `getStatus/jobHistory`；相机由 `src/components/CameraView.tsx:10` → `/api/printer/camera` → `src/lib/printer.ts:182-226`/Moonraker 文件或 WebSocket 唤醒。

## 4. 中文化改造点清单

**字符串盘点。** 以下是按源文件中可见英文 UI、错误文案和服务端状态文案的字面出现次数统计（模板字符串按一条，注释、类型和协议字段排除；数字是改造初始基线，不是运行时去重数）。

`src/app/**` 共 71 条：`layout.tsx 4`、`page.tsx 1`、`model/[id]/page.tsx 4`、`offline/page.tsx 2`、`plate/page.tsx 2`、`printer/page.tsx 1`、`saved/page.tsx 1`、`settings/page.tsx 2`、`upload/page.tsx 2`；API：`auth/code 1`、`auth/login 2`、`auth/tfa 1`、`auth/token 1`、`download 2`、`favorites/[id] 1`、`favorites 1`、`jobs/[id]/file 6`、`jobs/[id] 1`、`jobs/[id]/toolpath 2`、`jobs 4`、`mw/design 1`、`plate/print 3`、`plate 2`、`preview 1`、`printer/action 6`、`printer/camera 1`、`printer/power 2`、`printer/status 1`、`printer/test 1`、`profile 2`、`settings 3`、`uploads/[id]/cover 3`、`uploads/[id]/mesh 1`、`uploads/[id] 1`、`uploads 2`；其余 API route 为 0。

`src/components/**` 共 429 条：`BedViewer 3`、`CameraView 10`、`Explore 15`、`FavoriteButton 14`、`Header 18`、`Icons 1`、`ModelCard 4`、`ModelView 17`、`OrientControls 16`、`PlateView 57`、`PrintOptions 44`、`PrintSetup 38`、`PrinterView 52`、`SavedView 31`、`ServiceWorker 1`、`SettingsView 43`、`SizePanel 16`、`ToolpathViewer 21`、`UploadView 28`。

`src/lib/**` 共 238 条：`bedScene 1`、`combine 21`、`format 6`、`geometry 5`、`homeassistant 14`、`jobs 33`、`layerHeights 1`、`makerworld 34`、`meshFile 1`、`plate 1`、`previewMesh 2`、`printer 12`、`profiles 6`、`slicer 43`、`stl 33`、`store 4`、`threemf 2`、`toolpathView 2`、`uploads 12`、`useCreatorSupports 2`、`useFavorites 2`、`usePlate 1`；其余纯几何/解析文件为 0。高密度文件优先处理 `PrintOptions.tsx`、`PrintSetup.tsx`、`PlateView.tsx`、`SettingsView.tsx`、`PrinterView.tsx`、`jobs.ts`、`slicer.ts`、`makerworld.ts`。

当前没有 i18n 框架：`package.json:13-19` 没有 `next-intl`/`react-intl`，所有文案直接写在 JSX、路由和 lib 常量中（例 `makerworld.ts:52-60`、`slicer.ts:36-55`、`jobs.ts:61-67`）。服务端错误通过 `src/lib/http.ts:7-19` 原样把 `err.message` 放到 `{error}`，客户端 `format.api()` 在 `:74-78` 直接 throw 该英文，因此不能只翻 JSX；应给错误定义稳定 `code`/参数，UI 用同一字典渲染。

硬编码格式点：`format.ts:24-36` 使用 `k/M`、`m/h` 英文单位；`:64-67` 固定欧元和逗号小数；`Explore.tsx:109` 使用默认 `toLocaleString()`；`SettingsView.tsx:77` 使用无 locale 的 `toLocaleDateString()`；`ModelView.tsx:193-214`、`PrintSetup.tsx:471-485`、`PlateView.tsx:306-310` 拼接 `g/mm/plates/prints`；`jobs.ts:267-269` 固定 `mm`；`printer.ts`/`PrinterView.tsx` 的温度、速度和 ETA 由字符串拼接。中文化要统一 `Intl.NumberFormat("zh-CN")`、`Intl.DateTimeFormat("zh-CN")`，单位交给 `Intl.NumberFormat` 或字典，不要继续散落模板字符串。

最小侵入方案：新建（未来实现阶段）`src/messages/zh-CN.ts`，导出嵌套字典、参数插值和 `t(key, vars)`；把 `t` 做成无 React 依赖的同构函数，服务端页面/API/lib 与客户端组件都能导入。第一阶段只支持 `zh-CN`，在 `layout.tsx:25-27` 固定 locale；分批替换组件可见文案、API 错误码和 `PRINT_MODES/SORTS/PERIODS/STEP_LABELS`，约需改动全部 19 个组件、8 个页面、约 30 个 API/lib 文案文件。`next-intl` 会增加 provider、路由 locale 和服务端/客户端边界改造，当前只有单语言目标，侵入更大；若未来真的需要中英切换，再把现有 `t()` 换成 next-intl 适配层。

## 5. 多站点改造点清单

**硬编码位置。**

- API base 只有 `src/lib/makerworld.ts:11` 的 `https://api.bambulab.com`，所有 `call()` 在 `:37` 拼接；登录 TFA 另有 `https://bambulab.com/api/sign-in/tfa`（`:405`）。中国站应使用给定的 `https://api.bambulab.cn`，两站 schema 相同。
- MakerWorld 网页 URL 在 `makerworld.ts:300` 固定 `https://makerworld.com/en/models/...`；登录帮助文字在 `src/components/SettingsView.tsx:211-213` 固定 `.com`。
- CDN 域名判断在 `src/lib/format.ts:7-15`：只有 hostname 以 `bblmw.com` 才追加 `x-oss-process`；根布局预连接 `src/app/layout.tsx:31-33` 固定 `https://makerworld.bblmw.com`。这是图片直连/变换，不是服务端代理。
- UA 在 `makerworld.ts:12-13`，用于 API `:27`、签名 CDN `:357` 和 TFA `:407`；Accept-Language `en-US` 在 `:29`。站点选择应成为 provider 配置，而非复制常量。

**token 与缓存。** `store.ts:13-24` 只有单组 `bambuToken/bambuRefreshToken/bambuUser/tokenSavedAt`；`publicSettings():55-64` 只返回一个 `loggedIn`。结构可以向后兼容扩展为 `accounts: { international?: BambuAccount; china?: BambuAccount }`，迁移旧字段到默认站点，并按 `site` 读写；不能继续让两个站点共用一个 token，因为登录/403/用户收藏是站点域隔离的。`downloadInstance()` 的文件名 `DOWNLOAD_DIR/{instanceId}.3mf`（`makerworld.ts:345-351`）没有站点前缀；同 ID 会撞缓存。`search`/详情内存缓存 key `search:${qs}`（`:167`）与 `design:${id}`（`:254`）也没有站点；favorites 以 `id` 去重（`favorites.ts:58-63,83-107`），跨站同 ID 会合并；`ModelView` 的 `sourceKey` 固定 `mw:${instance.id}`（`ModelView.tsx:82`），plate 条目也只有 numeric `designId/instanceId`（`plate.ts:11-39`）。改造必须把 `site` 纳入缓存路径、内存 key、favorite/plate/job 的来源标识和客户端 key。

**切换 UI。** `SettingsView.tsx:20-31,66-94` 是账号设置，应增加“国际站/中国站”选择与各自登录状态；`Explore` 的 server page `src/app/page.tsx:13-22` 和客户端请求 `Explore.tsx:41-43` 要把站点写入 URL/query，API `mw/search` 透传；`src/app/model/[id]/page.tsx:37-69` 与 `ModelView.tsx:170-235` 要按站点加载详情、原站链接、下载/登录提示；`Header.tsx:12-19` 可显示当前站点，但切换控件应放 Settings 并在 Explore/Model 提供当前站点徽标。下载、收藏同步、preview/profile 路由均要接受并校验 `site`。

## 6. 第二模型来源的抽象设计

现在耦合集中在 `makerworld.ts` 的 `ModelCard/ModelDetail/Instance` 类型（`:66-75,177-207`），`Explore.tsx:5,24-43` 直接依赖 `ModelCard` 和 `/api/mw/search`，`ModelView.tsx:5,37-55` 直接依赖 `Instance/ModelDetail`，且 `ModelView.tsx:82,215,230-253` 把来源 key、预览 URL、下载 URL、job body 都写成 MakerWorld 语义；`jobs.ts:5,193-229` 直接 import `downloadInstance`。因此不是换一个 API URL 就能接 Snapmaker 来源。

建议在 `src/lib/model-source.ts`（未来新增）定义与站点无关的规范化模型 DTO 和接口：

```ts
type SourceId = string; // 例如 "makerworld-intl:123"、"snapmaker:abc"
type ModelSource = "makerworld-intl" | "makerworld-cn" | "snapmaker";
interface ModelSummary { source: ModelSource; id: SourceId; title: string; cover: string; creator: { name: string; avatar?: string }; downloads?: number; likes?: number; prints?: number; license?: string; url?: string; }
interface ModelDetail extends ModelSummary { summary: string; tags: string[]; pictures: string[]; instances: PrintProfile[]; defaultInstanceId?: string; }
interface PrintProfile { id: SourceId; title: string; printer?: string; nozzle?: number; seconds?: number; grams?: number; filaments: FilamentInfo[]; plates: PlateInfo[]; fileSize?: number; }
interface ModelSourceProvider { source: ModelSource; search(p: SearchParams): Promise<{ total: number; items: ModelSummary[] }>; getModel(id: SourceId): Promise<ModelDetail>; getProfile(id: SourceId, token?: string): Promise<PrintProfile>; downloadProfile(id: SourceId, token?: string): Promise<{ file: string; name: string; cached: boolean }>; preview(profileId: SourceId, plate: number, token?: string): Promise<Buffer>; listSaves?(token: string): Promise<{ likes: ModelSummary[]; collects: ModelSummary[] }>; authenticate?(input: LoginInput): Promise<LoginStep>; }
```

`makerworld.ts` 以后实现 `MakerWorldProvider`（国际/中国只由配置的 API/site/token/CDN 不同），Snapmaker provider 只需实现上述接口，不假设其 API。`Explore` 应改收 `ModelSourceProvider` 对应的规范化分页数据或只调用统一 `/api/models/search`；`ModelView`、`ModelCard`、`FavoriteButton`、`useCreatorSupports`、`previewMesh`、`PrintSetup` 的 source key/下载/预览都面向 `SourceId` 和 `ModelDetail`，不能再 import MakerWorld 专属类型。API 路由应由 `source` registry 选择 provider；`jobs.NewJob` 保存 `source`、`profileId`，`jobs.ts` 只调用 `provider.downloadProfile`。这样 Snapmaker 未知的登录、CDN、资料格式被隔离在 provider 适配层。

## 7. 脆弱点清单（按严重程度）

1. **异步 job 无持久化队列/恢复。** `src/lib/jobs.ts:127-131,167-279` 用 `void runJob(job)`，状态写 JSON 但进程重启不会恢复运行中的下载/切片；systemd/Docker 重启或 OOM 后 job 永远停在 `running`，文件可能半成品。触发：切片期间服务重启、容器被杀。
2. **并发写同一 JSON 会丢数据。** `src/lib/store.ts:45-49`、`plate.ts:52-64`、`favorites.ts:37-42`、`jobs.ts:75-78` 都是 read/modify/write 且无锁；多标签同时保存设置、同步收藏或两个请求改 plate 会互相覆盖/写出截断 JSON。触发：双击、多个浏览器标签、Next 多 worker。
3. **切片进程清理不完整。** `src/lib/slicer.ts:306-332` 只对主 child 设置 15 分钟 timer 并 `child.kill("SIGKILL")`，没有杀进程组、没有 `finally` 清理工作目录；OrcaSlicer 派生子进程可能残留，重复 job 叠加 CPU/RAM，磁盘持续增长。触发：超时、请求取消、Orca CLI 段错误。
4. **下载缓存原子性与资源上限不足。** `src/lib/makerworld.ts:345-364` 直接写 `${id}.3mf` 和 `.json`，并发同一 profile 会读到半写文件；`Buffer.from(await res.arrayBuffer())`（`:359`）没有响应大小上限，恶意/异常 CDN 响应可耗尽 11 GB 机器内存/磁盘。触发：并行 preview/download、上游返回超大文件或断电。
5. **内网控制与输入安全边界薄弱。** `src/lib/printer.ts:21-36,147-168` 以设置中的 host 拼接 URL，`api/printer/action/route.ts:10-40` 虽限制动作但服务端无认证/CSRF；部署说明还允许 Moonraker trusted subnet（`printer.ts:4-7`）。若应用端口暴露到不可信网络，攻击者可暂停/加热/执行固定 G-code；同时 `api/jobs/[id]/file/route.ts:18-27` 直接读取 job 记录路径，依赖 JSON 未被篡改。触发：反向代理未加认证、局域网恶意请求、可写 DATA_DIR 被利用。

## 8. 批次 1.1 实施记录

本批次完成后端双站点支持，新增 `src/lib/sites.ts`，并修改 `store.ts`、`makerworld.ts`、`jobs.ts`、`plate.ts`、`favorites.ts`、`format.ts`、`layout.tsx` 以及 MakerWorld、认证、下载/预览/profile、收藏同步、job/plate/settings API 路由。站点配置集中维护 API、网页、TFA、CDN 与 Accept-Language；设置文件支持 `intl`/`cn` 双账号，旧单账号数据迁移到 `accounts.intl`，写回保留旧字段且公开设置不返回 token。MakerWorld 请求、缓存、下载目录、登录和 TFA 按站点透传；job、plate、favorite 记录保存来源站点，旧记录按国际站兼容读取。

验收结果：

1. `export PATH=~/node22/bin:$PATH && pnpm build` 通过，TypeScript 零错误；仅有 `src/lib/profiles.ts` 原有动态文件访问的 2 条 Turbopack warning。
2. `pnpm lint` 通过，无 error、无 warning。
3. 匿名请求同一关键词 `benchy`：国际站 `200 / total=3606 / hits=20`，中国站 `200 / total=3438 / hits=20`，命中总数不同，站点数据已分开。
4. `git status --short` 已检查，业务改动仅在本批次允许的服务端、类型、布局与本记录文件内；未修改 `src/components/**`、页面文件、`package.json`、`README.md`。

与本文档要求不一致的决定：为避免 `src/lib/format.ts`（客户端模块）把 Node `fs` 引入浏览器 bundle，`sites.ts` 未直接导入 `store.ts`；改为由 store 初始化时设置进程内当前站点，`resolveSite()` 读取该设置并回落 `DEFAULT_SITE`。此外，为保持现有客户端构造 plate/favorite 的 TypeScript 兼容，`PlateEntry.site` 与 `Favorite.site` 在类型上可选，但所有服务端新写入记录都会补齐站点，旧记录按国际站读取。

## 9. 批次 1.2a 实施记录（Settings 中文化 + 站点切换）

- 新建 `src/lib/i18n.ts`（零依赖 `t()` / `tList()`，`{var}` 插值，无 React/Node 依赖，服务端与客户端共用）
- 新建 `src/messages/zh-CN.ts`（中文词典）
- `SettingsView.tsx` 全中文 + 站点选择（国际站/中国站）+ 按站点显示登录态，三种登录方式均带 `site`
- `Header.tsx` 全中文 + 当前站点徽标（客户端 fetch `/api/settings`）
- `format.ts` 增加中文日期/数字格式化

术语：toolhead→喷头、filament→耗材、slice→切片、plate→打印盘、infill→填充、support→支撑、brim→裙边、seam→接缝、preset→预设。

**实施说明（与原计划不一致处）**：
1. codex 首次执行被中途中断，留下 4 处 `TS2349`（`tools.map((t, i)` 的参数遮蔽了 i18n 的 `t()`）与 1 处 `PublicSettings` 类型不匹配，由 Hermes 手工修正：map 参数改名 `tool`，`accounts` 放宽为 `Record<string, ...>`。
2. 站点按钮原用 `aria-checked`，但 `globals.css` 只定义 `.chip[aria-pressed="true"]`，选中态不可见 → 改用 `aria-pressed` + `role="group"`，与 Explore 的排序按钮一致。

验收：`pnpm build` rc=0、`pnpm lint` rc=0；`/settings` 200 且无英文残留（仅用户名）；headless Chrome 截图确认站点选中态、全中文、无布局错乱；`PUT /api/settings {site}` 双站切换正常且登录态互不影响。

## 10. 批次 1.3 实施记录

- `profiles.ts` 新增 `materialOf()` 与 `presetForMaterial()`：按模型耗材类别选择 U1 预设；喷头已装材料类别一致时沿用喷头预设，否则使用对应 U1 默认预设并在 job 的“预设”步骤写出替换说明。
- `slicer.ts` 的 `SliceRequest` 增加 `filamentTypes`；切片后扫描 G-code，发现 `M600` 换料指令即失败。
- `threemf.ts` 新增 `plateFilaments()`，通过盘内 `model_instance/object_id` 和对象 `extruder` 精确得到本盘耗材集合；`jobs.ts` 在每盘切片前检查多个逻辑耗材是否复用同一 U1 喷头。
- `makerworld.ts` 中国站模型链接改为 `/zh/models/<id>-<slug>#profileId-<instanceId>`，国际站仍为 `/en/models/<id>-<slug>`。

验收：

1. `export PATH=~/node22/bin:$PATH && pnpm build` 通过，TypeScript 零错误；仍只有 `profiles.ts` 原有动态文件访问的 2 条 Turbopack warning。
2. `pnpm lint` 通过，无新增问题。
3. 真实模型 `designId=3006416 / instanceId=3531155`（中国站，第 1 盘）切片完成；G-code 原文为：
   `; filament_settings_id = "Snapmaker TPU @U1";"Snapmaker PETG @U1";"Snapmaker PETG @U1";"Snapmaker PETG @U1";"Snapmaker TPU @U1"`
   job 步骤同时记录了槽 1/5 TPU、槽 2–4 PETG 从喷头 PLA 预设替换的中文明细。
4. 冲突检测验收：临时让第 1 盘同时引用颜色 1、4、5，并提交 `filamentToTool=[0,1,2,3,0]`；job 在切片前失败，错误原文为：
   `第 1 盘的颜色 1 和颜色 5 都会用 T1 打印，U1 一个喷头不能同时装两种料。请在打印设置里把其中一个改到别的喷头，或分成两次打印。`

实施决定：模型页中国站链接的 `profileId` 使用设计返回的 `defaultInstanceId`；切片输入中的 `filamentTypes` 由 `readProject().filaments[].type` 提供，设置里的 `tools` 仍只表示喷头实际装载耗材和颜色/价格。
