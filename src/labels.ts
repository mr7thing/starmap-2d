/**
 * 星点标签 —— 显示在星图上。
 *
 * 用 DOM 而非 SVG `<text>`：星图是一张**要读的地图**，不是一幅插画。
 * 文字必须清晰、可选中、可被读屏软件读到 —— 这些 DOM 天生就有。
 * SVG 的 `<text>` 也能读屏，但点不开、也不能用 CSS 排版。
 *
 * 三维版用 CSS2DRenderer 做投影，二维版自己算：
 * 世界坐标 → 屏幕坐标就是一次线性变换，viewBox 已经知道全部参数。
 */

import { svgEl, toSvg } from './chart.ts'
import type { Placed } from './layout.ts'

export interface LabelOptions {
  radius: number
  /** 显示年月。默认取 date 的前 7 位 */
  showDate?: boolean
  /** 标注与符号外框的间距（相对半径） */
  gap?: number
  /** 点标注时选中该站 —— 标注本身就是按钮，不该只有画布可点 */
  onPick?: (index: number) => void
}

/** 世界坐标 → 屏幕像素 */
export type Project = (x: number, y: number) => { x: number; y: number }

function formatDate(iso?: string): string {
  if (!iso) return ''
  return iso.slice(0, 7).replace('-', '.')
}

export interface Labels {
  /** 承载标注的覆盖层（绝对定位在图上） */
  layer: HTMLDivElement
  /** 引出线（标注甩出去之后，连回符号的那些线） */
  leaders: SVGGElement
  /** 逐个设置强调度 0–1，用于悬停与当前段高亮 */
  setEmphasis(i: number, v: number): void
  /**
   * 沿线甩标 + 冲突外推 —— 排版解不开的时候，靠引出线保住归属关系。
   *
   * `worldPerPx` 是「一个世界单位等于多少像素」。
   */
  reflow(worldPerPx: number, project: Project): void
  /** 标注溢出容器的像素数（各边取最大）。 */
  overflow(): number
  dispose(): void
}

export function createLabels(
  placed: readonly Placed[],
  options: LabelOptions,
): Labels {
  const radius = options.radius
  const gap = (options.gap ?? 0.75) * radius
  const showDate = options.showDate ?? true

  const layer = document.createElement('div')
  layer.className = 'sm2-label-layer'

  // 标注甩向航线**外侧**：在中心线之上的往上甩，以下的往下甩。
  //
  // 之前是一律往左右甩 —— 路线是斜的，站挨得又近，14 个标注全落在同一条带子里，
  // 必然互相压。沿线状要素标注甩到外侧，是海图的老办法。
  const midY =
    placed.length > 0 ? placed.reduce((s, p) => s + p.position[1], 0) / placed.length : 0

  const items = placed.map((s) => {
    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'sm2-label'
    el.dataset.index = String(s.index)
    // 图上只放「时间 + 地点」—— 海图上标注的就是这两样，而且它们足够短。
    // 完整站名 / 角色 / 受众放在提示里，悬停或聚焦都能读到。
    const full = [s.title, s.place, s.date, s.role].filter(Boolean).join(' · ')
    el.title = full
    el.setAttribute('aria-label', full)

    // 站号：航路点本来就该有编号，标出来读者才能把图和列表对上
    const no = document.createElement('span')
    no.className = 'sm2-label__no'
    no.textContent = String(s.index + 1).padStart(2, '0')
    el.append(no)

    const date = formatDate(s.date)
    if (showDate && date) {
      const d = document.createElement('span')
      d.className = 'sm2-label__date'
      d.textContent = date
      el.append(d)
    }

    // 地点才是图上的主标注 —— 字号比日期大
    const where = s.short ?? s.place
    if (where) {
      const p = document.createElement('span')
      p.className = 'sm2-label__place'
      p.textContent = where
      el.append(p)
    }

    if (s.draft) {
      // 「待校订」只进提示，不上图。
      // 它是内容加工流程的状态，不是这张图的一部分 ——
      // 开发期在图上挂角标，成品就会一直带着角标。
      el.dataset.draft = '1'
    }

    // 标注是 button，点它等于点那个符号 —— 键盘和读屏用户也能进站
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      options.onPick?.(s.index)
    })
    layer.append(el)
    return { el, base: s.position }
  })

  // 引出线：标注被甩出去之后，用一条细线连回它的符号。
  // 这是海图上处理密集注记的标准手法 —— 位置让位于可读，归属靠线保住。
  const leaders = svgEl('g', { 'data-part': 'leaders', stroke: '#3f6f9c', 'stroke-width': '1px', opacity: 0.45 })
  const leaderLines: SVGLineElement[] = placed.map(() => {
    const l = svgEl('line', { x1: 0, y1: 0, x2: 0, y2: 0 })
    leaders.append(l)
    return l
  })

  /** 每个标注在世界坐标里的外接框。 */
  interface Box {
    cx: number
    cy: number
    hw: number
    hh: number
  }

  const hit = (a: Box, b: Box, pad: number) =>
    Math.abs(a.cx - b.cx) < a.hw + b.hw + pad && Math.abs(a.cy - b.cy) < a.hh + b.hh + pad

  let project: Project = (x, y) => ({ x, y })

  return {
    layer,
    leaders,
    setEmphasis(i, v) {
      const it = items[i]
      if (!it) return
      const e = Math.min(1, Math.max(0, v))
      it.el.style.opacity = String(0.45 + e * 0.55)
      it.el.dataset.emphasis = e.toFixed(3)
    },

    reflow(worldPerPx, proj) {
      if (placed.length === 0) return
      project = proj

      // 标注的真实尺寸：量一次，之后按 scale 换算成世界单位
      let w = 0
      let h = 0
      for (const it of items) {
        const r = it.el.getBoundingClientRect()
        w = Math.max(w, r.width)
        h = Math.max(h, r.height)
      }
      if (w === 0) return
      const hw = (w * worldPerPx) / 2
      const hh = (h * worldPerPx) / 2
      const pad = radius * 0.35

      const placedBoxes: Box[] = []

      for (let i = 0; i < items.length; i++) {
        const it = items[i]!
        const b = it.base
        // 甩出方向：垂直于航线、且朝航线外侧
        const prev = placed[Math.max(0, i - 1)]!.position
        const next = placed[Math.min(placed.length - 1, i + 1)]!.position
        let dx = next[0] - prev[0]
        let dy = next[1] - prev[1]
        const len = Math.hypot(dx, dy) || 1
        dx /= len
        dy /= len
        // 法线指向远离航线中线的一侧
        let nx = -dy
        let ny = dx
        if (nx * b[0] + ny * (b[1] - midY) < 0) {
          nx = -nx
          ny = -ny
        }

        // 从「刚好盖住符号外框」开始，冲突就一级级往外推。
        // **左右交替甩** —— 只往一侧甩的话，所有标注会挤成一条更粗的带子；
        // 两侧都用到，可用空间翻倍。
        const start = radius * 1.5 + (hh + pad)
        let box: Box | null = null
        for (let step = 0; step < 16; step++) {
          const off = start + step * (hh + pad)
          const dir = step % 2 === 0 ? 1 : -1
          const cand: Box = { cx: b[0] + nx * off * dir, cy: b[1] + ny * off * dir, hw, hh }
          if (!placedBoxes.some((p) => hit(p, cand, pad))) {
            box = cand
            break
          }
        }
        // 全被占就用最后一次尝试：宁可挨着，也别压到别的标注上
        const last = start + 15 * (hh + pad)
        box ??= { cx: b[0] - nx * last, cy: b[1] - ny * last, hw, hh }
        placedBoxes.push(box)

        // 摆到屏幕上
        const s = project(box.cx, box.cy)
        it.el.style.translate = `${s.x.toFixed(1)}px ${s.y.toFixed(1)}px`
        it.el.dataset.side = ny * (box.cx > b[0] ? 1 : -1) >= 0 ? 'down' : 'up'

        // 引出线：从标注边缘连回符号中心
        // 线的两端是世界坐标 —— 画进 SVG 前要翻到 SVG 坐标系
        const ex = box.cx - nx * (hh * 0.1)
        const ey = box.cy - ny * (hh * 0.1)
        const [exs, eys] = toSvg(ex, ey)
        const [bxs, bys] = toSvg(b[0], b[1])
        const line = leaderLines[i]!
        line.setAttribute('x1', String(exs))
        line.setAttribute('y1', String(eys))
        line.setAttribute('x2', String(bxs))
        line.setAttribute('y2', String(bys))
      }
    },

    overflow() {
      const box = layer.getBoundingClientRect()
      let worst = 0
      for (const it of items) {
        const r = it.el.getBoundingClientRect()
        if (r.width === 0) continue
        const over = Math.max(
          box.left - r.left,
          r.right - box.right,
          box.top - r.top,
          r.bottom - box.bottom,
        )
        if (over > worst) worst = over
      }
      return worst
    },

    dispose() {
      for (const it of items) it.el.remove()
      layer.remove()
      leaders.remove()
    },
  }
}
