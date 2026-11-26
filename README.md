# MindMap

一个纯静态的思维导图应用，构建产物可直接部署到 GitHub Pages：离线可用，数据只保存在浏览器里。

## 特性

- **自研渲染引擎**：`packages/markmap` 是在上游 markmap 基础上 fork 出来的引擎，按 Primitive（group/path/rect/text）出图，同一套图元既能画到 SVG，也能导出 SVG/PNG。
- **富文本节点**：GFM + 数学公式 + 指令式内联（徽标、进度、日期、图标、键帽、上标/下标、着色、标签），含 CJK 友好换行。
- **两种布局**：左右对称（two-sided）与单侧生长（tree），可折叠、拖拽调整父子关系。
- **主题**：Monet 配色，浅色/深色/跟随系统，画布与 UI 共用同一套 token。
- **本地优先**：文档存在 IndexedDB，Service Worker 预缓存全部产物，断网冷启动可用。

## 开发

```bash
npm install
npm run dev        # http://localhost:5173/Mindmap/
npm test           # vitest
npm run typecheck  # vue-tsc
npm run build      # 类型检查 + 打包 + 生成 sw.js
npm run preview    # 本地预览产物
```

## 部署

仓库已带 `.github/workflows/deploy.yml`：push 到 `main` 即构建并发布到 GitHub Pages
（需在仓库 Settings → Pages 里把 Source 设为 *GitHub Actions*）。

构建路径由 `BASE_PATH` 控制，默认 `/Mindmap/`；部署到其他仓库或用户主页时覆盖它：

```bash
BASE_PATH=/my-mindmap/ npm run build
```

路由用 HashRouter，`base` 变了也不会刷新 404；Service Worker 的 scope 与 `base` 保持一致。

## 语法速查

| 写法 | 效果 |
| --- | --- |
| `**粗体**` `*斜体*` `~~删除~~` `` `代码` `` | 基础行内 |
| `==高亮==` `++下划线++` `^上标^` | 行内简写 |
| `#标签` | 按字符串哈希到 10 色板的小标签 |
| `:badge[进行中]{tone="amber"}` | 徽标（tone 取 10 色板） |
| `:progress[60]{tone="sage"}` | 进度条 |
| `:date[2026-12-31]` | 日期（过期标红） |
| `:icon[rocket]` | lucide 图标 |
| `:kbd[⌘K]` `:sup[2]` `:sub[2]` | 键帽 / 上下标 |
| `:color[文字]{c="rose"}` | 指定颜色 |
| `$a^2+b^2$` | 行内公式 |

下标没有 `~x~` 简写：GFM 把单波浪线当作删除线，请用 `:sub[...]`。

## 结构

```
src/
  components/     画布、侧栏、工具条、对话框
  mindmap/
    engine/       控制器 + markmap 引擎适配（布局、状态、命中测试）
    markdown/     md ↔ 文档树、内联解析
    inline/       富内联契约节点与渲染插件
    theme/        Monet 配色与主题适配
    persist/      IndexedDB 存取
packages/markmap/ 引擎 fork：core（模型/测量/布局）、render（图元/SVG/主题 token）、view（Markmap、缩放、DOM 后端）
scripts/          构建期脚本（图标子集、sw.js 生成）
```

## 快捷键

`Tab` 子节点 · `Enter` 同级 · `Shift+Enter` 软换行 · `F2`/双击 编辑 · `Delete` 删除 ·
`Space` 折叠 · `⌘/Ctrl+Z` 撤销 · `⌘/Ctrl+Shift+Z` 重做 · `⌘/Ctrl+K` 命令面板 · `?` 帮助
