import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

/**
 * `@uncle7/starmap-2d` —— 二维版星图库。
 *
 * **没有 three.js，没有运行时依赖。** 一级星图是 SVG，二级巡航是 Canvas 2D。
 * 这是它和 `@uncle7/starmap`（三维版）的根本差别：三维版用 three 的正交相机
 * 画一张平面图，是全库最浪费的地方；二维版直接用 SVG 画平面图。
 *
 * 两个包共用同一套内容标准（`Manifest`），航线布局与档位状态机也一模一样 ——
 * 所以同一份内容在两边画出来的是同一张图、同一条航线。
 */
function here(): string {
  try {
    return fileURLToPath(new URL('.', import.meta.url))
  } catch {
    return process.cwd() + '/'
  }
}

export default defineConfig({
  build: {
    lib: {
      entry: {
        'starmap-2d': `${here()}src/index.ts`,
        'content/reader': `${here()}src/content/reader.ts`,
      },
      formats: ['es'],
    },
    rollupOptions: {
      /**
       * 内容读取器是 **Node 侧** 的工具（把标准目录读成 manifest），
       * 它用 `node:fs` 读磁盘 —— 不能被打进浏览器包。
       *
       * 标成 external 之后，`dist/content/reader.js` 里留着
       * `import { readdir } from 'node:fs/promises'`，Node 侧直接能用；
       * 浏览器入口根本不引用它（`src/index.ts` 不依赖 reader）。
       */
      external: [/^node:/],
    },
    target: 'es2022',
  },
})
