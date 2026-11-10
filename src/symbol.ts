/**
 * 站点符号 —— 海图上用的那几种符号。
 *
 * ## 为什么换成制图符号
 *
 * 三维版那四个「线条构成的三维几何体」（测地体 / 陀螺仪 / 纽结 / 晶格）
 * 在平面图上其实不好认 —— 它们靠**转动**才看得出是三维的，而图是静的。
 *
 * 一级星图本来就是一张海图。海图有它自己的符号库，而海图符号的读法是
 * **先看形状，再看颜色**：颜色只能区分三四个，形状才能区分十几个。
 * 所以这里四种符号的轮廓必须一眼能分开：
 *
 * | 符号 | 轮廓特征 | 海图上的含义 |
 * |---|---|---|
 * | `anchor` 锚 | 竖长 | 锚地 / 泊位 |
 * | `star` 星标 | 尖刺朝外 | 显著物标 |
 * | `diamond` 菱形十字 | 硬角 | 位置（国际海图符号） |
 * | `beacon` 灯标 | 圆 + 光芒 | 灯标及其光质 |
 *
 * ## 不变式
 *
 * 符号外框直径 ≤ 相邻两站间距。这条在三维版就守着（`minGap`），
 * 二维版照抄 —— 两个符号的线缠在一起，就不是图了。
 */

import { svgEl, toSvg } from './chart.ts'
import type { Placed } from './layout.ts'

export type SymbolShape = 'anchor' | 'star' | 'diamond' | 'beacon'

export interface SymbolState {
  /** 0–1，悬停或当前段的加权值 */
  emphasis: number
  /** 已经抵达 */
  visited: boolean
}

export interface SymbolOptions {
  shape?: SymbolShape
  /** 符号半径（世界单位） */
  radius?: number
}

export interface Symbols {
  group: SVGGElement
  update(index: number, state: SymbolState): void
  dispose(): void
}

// ---------------------------------------------------------------------------
// 符号的几何 —— 都画在半径 1 的单位圆里，调用方再缩放
// ---------------------------------------------------------------------------

/** 锚：环 + 竖杆 + 横杆 + 底部的钩。竖长的轮廓，一眼能和别的分开。 */
function anchor(): SVGElement[] {
  const g = svgEl('g', { fill: 'none', 'stroke-width': '1.7px', 'stroke-linecap': 'round' })
  // 顶环
  g.append(svgEl('circle', { cx: 0, cy: -0.88, r: 0.17 }))
  // 竖杆
  g.append(svgEl('line', { x1: 0, y1: -0.71, x2: 0, y2: 0.42 }))
  // 横杆（stock）
  g.append(svgEl('line', { x1: -0.44, y1: -0.5, x2: 0.44, y2: -0.5 }))
  // 钩：从左下兜到右下
  g.append(
    svgEl('path', {
      d: 'M -0.66 0.1 C -0.66 0.86 0.66 0.86 0.66 0.1',
    }),
  )
  // 两端的爪
  g.append(svgEl('line', { x1: -0.66, y1: 0.1, x2: -0.82, y2: -0.12 }))
  g.append(svgEl('line', { x1: 0.66, y1: 0.1, x2: 0.82, y2: -0.12 }))
  return [g]
}

/** 星标：五角星 + 中心小圆。尖刺朝外，是「显著物标」的画法。 */
function star(): SVGElement[] {
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 1 : 0.42
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    pts.push(`${(Math.cos(a) * r).toFixed(4)},${(Math.sin(a) * r).toFixed(4)}`)
  }
  const g = svgEl('g', { fill: 'none', 'stroke-width': '1.5px', 'stroke-linejoin': 'round' })
  g.append(svgEl('polygon', { points: pts.join(' ') }))
  g.append(svgEl('circle', { cx: 0, cy: 0, r: 0.16, 'stroke-width': '1.3px' }))
  return [g]
}

/** 菱形十字：国际海图上的「位置」符号。硬角，一眼能和圆的东西分开。 */
function diamond(): SVGElement[] {
  const g = svgEl('g', { fill: 'none', 'stroke-width': '1.7px', 'stroke-linejoin': 'round' })
  g.append(svgEl('polygon', { points: '0,-1 1,0 0,1 -1,0' }))
  g.append(svgEl('line', { x1: 0, y1: -1.32, x2: 0, y2: 1.32 }))
  g.append(svgEl('line', { x1: -1.32, y1: 0, x2: 1.32, y2: 0 }))
  return [g]
}

/** 灯标：一个光源 + 它的光质光芒。圆里带射线，轮廓最「软」的一种。 */
function beacon(): SVGElement[] {
  const g = svgEl('g', { fill: 'none', 'stroke-width': '1.5px', 'stroke-linecap': 'round' })
  g.append(svgEl('circle', { cx: 0, cy: 0, r: 0.34 }))
  g.append(svgEl('circle', { cx: 0, cy: 0, r: 0.1, fill: 'currentColor', stroke: 'none' }))
  // 光质：向右的两道弧
  g.append(svgEl('path', { d: 'M 0.5 -0.5 A 0.71 0.71 0 0 1 0.5 0.5' }))
  g.append(svgEl('path', { d: 'M 0.78 -0.78 A 1.1 1.1 0 0 1 0.78 0.78' }))
  return [g]
}

const BUILDERS: Record<SymbolShape, () => SVGElement[]> = {
  anchor,
  star,
  diamond,
  beacon,
}

// ---------------------------------------------------------------------------

export function createSymbols(
  placed: readonly Placed[],
  options: SymbolOptions = {},
): Symbols {
  const radius = options.radius ?? 2.2
  const shape = options.shape ?? 'star'
  const build = BUILDERS[shape]

  const group = svgEl('g', { 'data-part': 'symbols' })
  const items = placed.map((s) => {
    // 位置翻到 SVG 坐标系；符号**自身的形状不翻** —— 锚的环在上、钩在下，
    // 翻了就不是锚了。翻的只是它站在哪儿。
    const [sx, sy] = toSvg(s.position[0], s.position[1])
    const g = svgEl('g', {
      'data-index': s.index,
      transform: `translate(${sx} ${sy}) scale(${radius})`,
    })
    // 颜色跟着站点的稳定色相走；`currentColor` 让符号内部的实心部分跟着变
    g.setAttribute('color', `hsl(${s.hue} 85% 66%)`)
    g.setAttribute('stroke', `hsl(${s.hue} 85% 66%)`)
    for (const e of build()) g.append(e)
    group.append(g)
    return g
  })

  return {
    group,
    update(index, state) {
      const g = items[index]
      if (!g) return
      const e = Math.min(1, Math.max(0, state.emphasis))
      const base = state.visited ? 0.95 : 0.72
      g.setAttribute('opacity', (base + e * 0.28).toFixed(3))
      // 悬停时符号放大一点 —— 海图上的注记要素被指到时会「立起来」
      const k = radius * (1 + e * 0.22)
      const [sx, sy] = toSvg(placed[index]!.position[0], placed[index]!.position[1])
      g.setAttribute('transform', `translate(${sx} ${sy}) scale(${k})`)
    },
    dispose() {
      group.remove()
    },
  }
}
