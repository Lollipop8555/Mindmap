/**
 * Vendored markmap (upstream v1.1.1, MIT) 的统一入口。
 *
 * 三个子包原样保留在 `src/{core,render,view}`，互相之间仍用 `@markmap/core` 之类的
 * 裸导入，由 vite/vitest 的 alias 与 tsconfig paths 指回这里，升级时只做 diff。
 *
 * 与上游的差异见同目录 README.md（`PATCHES` 一节），目前只有三处：
 * 1. `Decoration.underline`：内联下划线。
 * 2. 主题可按节点覆盖字体、文字色与盒内边距。
 * 3. `SvgDomBackend` 暴露 `get()`，便于给单节点打状态类名。
 */
export * from '@markmap/core'
export * from '@markmap/render'
export * from '@markmap/view'
