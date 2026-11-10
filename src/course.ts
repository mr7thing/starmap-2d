/**
 * 航线 —— 按时间次序，一站一站直连。
 *
 * ## 为什么是折线而不是样条
 *
 * 早先用 Catmull-Rom 样条穿过所有站点，问题是它**过冲**：
 * 相邻两站离得远时，曲线会在两点之间鼓出去，穿过别的站。
 * 十几条这样的鼓包叠在一起，航线就绞成了一张蛛网 ——
 * 看着像「所有东西都连在一起」，而不是一条路。
 *
 * 真实的海图上航线本来就是**航路点之间的直线段**（rhumb leg）。
 * 这里照做：按次序直连，不平滑，不绕路。
 * 于是「这是从 A 到 B 到 C 的旅程」这件事，图形直接说得出来。
 *
 * ## 已走过的航线怎么亮起来
 *
 * 三维版用着色器按弧长参数插值。二维版不用着色器：
 * 每一段航线是一根独立的 `<line>`，按进度决定它是亮的、暗的，
 * 还是「亮到一半」—— 跨过进度分界的那一段，用 `stroke-dasharray`
 * 截出已走过的部分。这比一条大路径做渐变更准，也更容易停在一半。
 */

import { svgEl, toSvg } from './chart.ts'
import type { Placed } from './layout.ts'

export interface CourseStyle {
  color: string
  /** 未走过的航线 */
  opacity: number
  /** 已走过的航线 */
  visitedOpacity: number
  /** 航路点菱形尺寸（相对符号半径） */
  waypointScale: number
  /** 航向箭头尺寸（相对符号半径），0 = 不画 */
  arrowScale: number
}

export const DEFAULT_COURSE: CourseStyle = {
  color: '#6fd0ff',
  opacity: 0.75,
  visitedOpacity: 1,
  waypointScale: 0.24,
  arrowScale: 0.3,
}

export interface Course {
  group: SVGGElement
  /**
   * 绘制已抵达的段落，t ∈ [0,1]（按站序号比例）
   *
   * `pxPerWorld` 是「一个世界单位等于多少像素」。
   *
   * 线的笔宽用 `vector-effect: non-scaling-stroke` 固定成设备像素 ——
   * 于是**虚线间隔也跟着走像素**，不是世界单位。不给这个倍率，
   * 「亮到一半」的那一截就会停在错的位置上。
   */
  setProgress(t: number, pxPerWorld?: number): void
  /** 高亮某一站的航路点 */
  markStation(index: number): void
  dispose(): void
}

export function createCourse(
  placed: readonly Placed[],
  nodeRadius: number,
  style: CourseStyle = DEFAULT_COURSE,
): Course {
  const group = svgEl('g', { 'data-part': 'course' })
  const n = placed.length
  if (n === 0) return { group, setProgress() {}, markStation() {}, dispose() { group.remove() } }

  const segLines: SVGLineElement[] = []
  const litLines: SVGLineElement[] = []
  const arrows: SVGPathElement[] = []
  const marks: SVGPolygonElement[] = []
  /** 每段的世界长度 —— 换算成像素时要用 */
  const segLen: number[] = []

  // --- 航线本体：逐段直线 ---
  // 位置先翻到 SVG 坐标系（y 向下），后面的箭头、法线全在 SVG 空间里算 ——
  // 方向、法线、长度在两个空间里是一致的，翻一次就够。
  for (let i = 0; i < n - 1; i++) {
    const a = toSvg(placed[i]!.position[0], placed[i]!.position[1])
    const b = toSvg(placed[i + 1]!.position[0], placed[i + 1]!.position[1])
    const base = svgEl('line', {
      x1: a[0], y1: a[1], x2: b[0], y2: b[1],
      stroke: style.color,
      'stroke-width': '1.4px',
      opacity: style.opacity,
    })
    group.append(base)
    segLines.push(base)

    // 亮的那一份叠在上面，用 dasharray 截出已走过的长度
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const lit = svgEl('line', {
      x1: a[0], y1: a[1], x2: b[0], y2: b[1],
      stroke: style.color,
      'stroke-width': '1.6px',
      opacity: style.visitedOpacity,
      'stroke-dasharray': len,
      'stroke-dashoffset': len,
    })
    group.append(lit)
    litLines.push(lit)
    segLen.push(len)
  }

  // --- 航向箭头：每段中间一个箭头，指示前进方向 ---
  // 没有方向标记的话，读者分不清这条线是从 A 走到 B，还是反过来。
  const aw = nodeRadius * style.arrowScale
  if (aw > 0) {
    for (let i = 0; i < n - 1; i++) {
      const a = toSvg(placed[i]!.position[0], placed[i]!.position[1])
      const b = toSvg(placed[i + 1]!.position[0], placed[i + 1]!.position[1])
      const mx = (a[0] + b[0]) / 2
      const my = (a[1] + b[1]) / 2
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const len = Math.hypot(dx, dy) || 1
      const ux = dx / len
      const uy = dy / len
      const nx = -uy
      const ny = ux
      const tipX = mx + ux * aw
      const tipY = my + uy * aw
      const backX = mx - ux * aw
      const backY = my - uy * aw
      const arrow = svgEl('path', {
        d: `M ${(backX + nx * aw * 0.55).toFixed(3)} ${(backY + ny * aw * 0.55).toFixed(3)} ` +
           `L ${tipX.toFixed(3)} ${tipY.toFixed(3)} ` +
           `L ${(backX - nx * aw * 0.55).toFixed(3)} ${(backY - ny * aw * 0.55).toFixed(3)}`,
        fill: 'none',
        stroke: style.color,
        'stroke-width': '1.4px',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        opacity: 0.28,
      })
      group.append(arrow)
      arrows.push(arrow)
    }
  }

  // --- 航路点：每站一个菱形 ---
  const wp = nodeRadius * style.waypointScale
  for (const p of placed) {
    const [px, py] = toSvg(p.position[0], p.position[1])
    const mk = svgEl('polygon', {
      points: [
        `${px},${py - wp}`,
        `${px + wp},${py}`,
        `${px},${py + wp}`,
        `${px - wp},${py}`,
      ].join(' '),
      fill: 'none',
      stroke: style.color,
      'stroke-width': '1.2px',
      opacity: 0.45,
    })
    group.append(mk)
    marks.push(mk)
  }

  return {
    group,
    setProgress(t, pxPerWorld = 1) {
      const denom = Math.max(1, n - 1)
      for (let i = 0; i < litLines.length; i++) {
        // 笔宽是设备像素，虚线间隔也得是设备像素
        const len = (segLen[i] ?? 0) * pxPerWorld
        const segStart = i / denom
        const segEnd = (i + 1) / denom
        const lit = litLines[i]!
        lit.setAttribute('stroke-dasharray', String(len))
        if (t >= segEnd) {
          lit.setAttribute('stroke-dashoffset', '0')
          lit.setAttribute('opacity', String(style.visitedOpacity))
        } else if (t <= segStart) {
          lit.setAttribute('opacity', '0')
        } else {
          // 跨过分界的那一段：只亮已走过的那截
          const f = (t - segStart) / (segEnd - segStart)
          lit.setAttribute('stroke-dashoffset', String(len * (1 - f)))
          lit.setAttribute('opacity', String(style.visitedOpacity))
        }
      }
      arrows.forEach((a, i) => {
        const segEnd = (i + 1) / denom
        a.setAttribute('opacity', segEnd <= t + 0.001 ? '0.95' : '0.28')
      })
      marks.forEach((m, i) => {
        m.setAttribute('opacity', i / denom <= t ? '0.95' : '0.45')
      })
    },
    markStation(index) {
      marks.forEach((m, i) => {
        const on = i === index
        m.setAttribute('opacity', on ? '1' : '0.45')
        const k = on ? 1.55 : 1
        const [x, y] = toSvg(placed[i]!.position[0], placed[i]!.position[1])
        const d = wp * k
        m.setAttribute(
          'points',
          [
            `${x},${y - d}`,
            `${x + d},${y}`,
            `${x},${y + d}`,
            `${x - d},${y}`,
          ].join(' '),
        )
      })
    },
    dispose() {
      group.remove()
    },
  }
}
