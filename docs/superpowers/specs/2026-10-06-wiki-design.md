# Wiki 站点设计

日期：2026-10-06

## 目标

用仓库里已有的游戏资源和规则层生成一个《Slay the Spire 2》资料站：

- 路径在 `/wiki/` 下，与游戏（`packages/app`）代码隔离。
- 每个条目一个预渲染的静态 HTML 页，搜索引擎可以收录，可以直接分享链接。
- 中文（`zhs`）+ 英文（`eng`）。
- 和游戏一起构建（`pnpm build`），一起发布（Cloudflare Worker、Docker 镜像、Vercel 备用），发布配置不改。

成功标准：`pnpm build` 后 `packages/app/dist/wiki/` 里有全部分类的列表页和详情页；描述里显示的是实际数值（"造成 8 点伤害"），而不是 `{Damage:diff()}` 这样的模板；游戏本身的行为和存档不受影响。

## 方案

新包 `packages/wiki`（`@sts2/wiki`）。构建时在 Node 里无头启动 `@sts2/core`（和 `packages/core/test/helpers.ts` 的 `boot()` 一样：资源从 `assets/` 读，`initGame({ test: true })`），遍历 `ModelDb` 导出数据，用模板字符串生成 HTML，写入 `packages/app/dist/wiki/`。

浏览器端只有静态 HTML、一份 `wiki.css`、一个 `wiki.js`（原生 JS，负责列表页的筛选和搜索）。规则层、Pixi、Preact 都不会发到浏览器。不新增运行时依赖；构建脚本用 `vite-node` 运行（已在 lockfile 中，是 vitest 的依赖；作为 wiki 的 devDependency 直接声明，版本固定为同一个）。

没有选的方案：Preact + `preact-render-to-string`（多一个依赖，还要处理 hydration，对只读页面没有收益）；Astro / VitePress（框架重、工具链不同，"从规则层导出数据"这一步还是得自己写）。

## 隔离

- `packages/wiki` 只依赖 `@sts2/core`，而且只在构建时用。不 import `@sts2/app` 的任何代码。BBCode → HTML 在 wiki 里单独实现一个精简版：颜色、`[b]`、`[i]`、`[img]`；动画效果标签（`sine`、`jitter` 等）只保留文字。
- 游戏的 Service Worker（`packages/app/public/sw.js`，作用域是站点根）在 fetch 处理里加一行，对 `wiki/` 下的请求直接 `return`，不让 Wiki 的 HTML、CSS、JS 进游戏的缓存。Wiki 页面引用的 `assets/` 图片仍然走 SW 已有的资源缓存，这是两边共用的。
- Wiki 页面不注册 Service Worker，不读写 IndexedDB 或 localStorage 的存档数据。
- 游戏主菜单不加 Wiki 入口。Wiki 页头放一个"开始游戏"链接，指回站点根。

## 构建与发布

- 根目录 `package.json` 的 `build` 改为 `pnpm -F @sts2/app build && pnpm -F @sts2/wiki build`。顺序是固定的：vite 构建会清空 `dist/`，所以 wiki 必须在 app 之后。
- `packages/wiki` 的 `build` 脚本：`vite-node src/build.ts`。
- `Dockerfile`：在安装依赖前加 `COPY packages/wiki/package.json ./packages/wiki/package.json`。
- 不需要改的：`.github/workflows/cloudflare.yml`（已经运行 `pnpm build`，触发路径里已有 `packages/**`），以及 `wrangler.jsonc`、`vercel.json`。它们和 nginx 一样会把 `/wiki/x` 补成 `/wiki/x/` 并返回其中的 `index.html`。
- `docker/nginx.conf` 加 `absolute_redirect off`：nginx 补斜杠时默认发绝对地址，会丢掉 `docker run -p 8080:80` 映射的端口。
- 本地预览：先 `pnpm build`，再 `pnpm -F @sts2/app preview`，打开 `http://127.0.0.1:47174/wiki/`。
- `docs/deployment.md`、`docs/development.md` 补充 Wiki 的构建和预览说明。`AGENTS.md` 的常用命令里补一行。

## URL

slug 由模型 Id 的 `Entry` 转成：小写，`_` 换成 `-`（`BASH` → `bash`，`AKABEKO` → `akabeko`）。

| 路径 | 内容 |
|---|---|
| `/wiki/` | 双语落地页，链接到两种语言 |
| `/wiki/{lang}/` | 分类首页 |
| `/wiki/{lang}/{category}/` | 列表页 |
| `/wiki/{lang}/{category}/{slug}/` | 详情页 |
| `/wiki/sitemap.xml` | 所有页面的绝对地址 |

`lang` ∈ `zhs`、`eng`。`category` ∈ `cards`、`relics`、`potions`、`powers`、`keywords`、`characters`、`monsters`、`encounters`、`events`。

页面内的所有链接和资源都用相对路径（按页面深度计算 `../` 前缀），这样站点部署在子路径下或用 `vite preview` 预览时也能正常工作。图片直接引用 `assets/` 下的 webp 文件，不复制资源，路径通过 `assets/manifest.json` 的 `textures`（`src` → `out`）查得。

## 内容

所有文本都在对应语言下通过 `LocManager.Instance.SetLanguage(lang)` 和规则层的格式化流程生成；BBCode 由 wiki 自己的转换器转成 HTML。`Deprecated*` 卡池、遗物池、药水池里的条目不收录；Id 以 `MOCK_` 开头的能力也不收录。

| 分类 | 数据来源 | 列表页 | 详情页 |
|---|---|---|---|
| 卡牌 | `ModelDb.AllCards` | 按角色/卡池、类型、稀有度筛选，并支持搜索 | 卡图（`PortraitPngPath`，缺图时用 `BetaPortraitPngPath`，再缺就不显示）、费用（含 X 费和辉星费用）、类型、稀有度、卡池、描述、升级后描述（`UpgradeInternal()` 后再格式化一次）、关键词链接 |
| 遗物 | `ModelDb.AllRelics` | 按稀有度、所属池筛选 | 图标（`BigIconPath`）、稀有度、所属池、描述（`DynamicDescription`）、风味文本 |
| 药水 | `ModelDb.AllPotions` | 按稀有度、所属池筛选 | 图标（`images/potions/<id>.png`）、稀有度、所属池、描述 |
| 能力 | `ModelDb.AllPowers` | 按增益/减益（`Type`）筛选 | 图标（`BigIconPath`）、类型、叠加方式（`StackType`）、描述 |
| 关键词 | `card_keywords` 本地化表 | 全部列出 | 名称、说明、带该关键词的卡牌 |
| 角色 | `ModelDb.AllCharacters` | 5 个角色 | 图标、初始血量和金币、初始牌组（链接到卡牌）、初始遗物（链接到遗物）、角色卡池的卡牌数量和链接 |
| 怪物 | `ModelDb.Monsters` | 按章节筛选 | 血量区间（`MinInitialHp`–`MaxInitialHp`）、招式名、出现在哪些遭遇战 |
| 遭遇战 | `ModelDb.AllEncounters` | 按章节、房间类型（普通、精英、Boss）筛选 | 章节、房间类型、可能出现的怪物（`AllPossibleMonsters`）、金币奖励区间 |
| 事件 | `ModelDb.AllEvents` + `AllAncients` | 按章节、共享事件或先古之民筛选 | 各页正文和选项（`events` 本地化表中 `<ID>.pages.*` 的键），变量用事件的 `CanonicalVars` 填充 |

每个详情页带 `<title>`、`<meta name="description">`（描述的纯文本）、`<link rel="alternate" hreflang>`（中英互指，`/wiki/` 落地页作为 `x-default`）、`<html lang>`。`sitemap.xml` 里的绝对地址用环境变量 `WIKI_ORIGIN`，默认 `https://sts2.moonrailgun.com`。

## 样式

深色主题，配色取自游戏的 BBCode 颜色（金色 `#efc851` 等），字体用 `assets/fonts` 里的游戏字体。手机宽度下是单列布局，不出现横向滚动。不还原游戏内的卡框。

## 出错处理

- 单个条目的格式化抛错或输出 Godot error 日志时，回退到原始本地化文本（把 `{…}` 占位符去掉），把条目 Id 记下来，构建结束时汇总打印。整体构建不失败。
- 构建失败的情况：各分类数量明显不对（卡牌少于 500、遗物少于 250、药水少于 50、能力少于 200、关键词少于 5、角色少于 5、怪物少于 90、遭遇战少于 60、事件少于 50），或者有详情页没写出来。数量阈值用来防止规则层或资源变动后，悄悄产出一个残缺的站点。

## 验证

- `pnpm build` 成功，构建日志里的数量和回退汇总符合预期。
- 浏览器打开 `/wiki/`、两种语言的分类首页、每个分类的列表页和若干详情页，包括 375px 手机宽度。确认筛选、搜索、相对链接和图片都正常。
- `sw.js` 有改动，按 AGENTS.md 运行 `pnpm -F @sts2/core test` 和 `tools/e2e/continue.mjs`，并确认游戏主页面在构建后照常运行。
- `packages/app/src/port-patchnotes.ts` 当天日期下补中英文更新日志（新增 Wiki 站点）。

## 存档兼容

Wiki 不读写存档、不改模型 Id、不改存储位置。唯一碰到游戏运行时的改动是 `sw.js` 对 `wiki/` 的放行；它不涉及 IndexedDB 和 localStorage。即便如此，仍按上面"验证"一节跑核心测试和继续游戏检查。

## v1 不做

- 怪物立绘：怪物是 Spine 动画，没有静态图。以后可以在构建时用 Playwright 渲染截图。
- 游戏内卡框的完整还原。
- 其余 12 种语言。
- 游戏主菜单里的 Wiki 入口。
- 站内全文搜索：列表页只做按名称过滤。
