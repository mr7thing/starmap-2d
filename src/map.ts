/**
 * 一级 · 星图 —— 一张宇宙航行的海图。
 *
 * ## 为什么是 SVG 而不是 canvas
 *
 * 这张图的全部内容都是**线**：网格、斜航线、罗盘、航线、符号、标注。
 * 线用 SVG 画，就是矢量 —— 放大不糊、截图永远清晰。
 * 文字用 DOM 覆盖层，于是它可点、可选中、能被读屏软件读到。
 *
 * 三维版用 three 的正交相机画同一张图。那是全库最浪费的一处：
 * 正交相机的平面图和 SVG 的差别，只剩下「文字能不能点」这一项，
 * 而这一项 DOM 赢、SVG 的 `<text>` 也赢不了。
 *
 * ## 为什么没有视差
 *
 * 之前的版本有指针视差。海图不能有视差：读者要靠比例判断距离，
 * 一动比例就作废了。所以图是**静的**，只有图廓之外的星在闪。
 * 这同时让截图更可靠 —— 动的东西永远截不准。
 */

import { createChart, svgEl, toSvg, type Chart, type ChartOptions, type CompassCorner } from './chart.ts'
import { createCourse, DEFAULT_COURSE, type CourseStyle } from './course.ts'
import { createLabels, type Project } from './labels.ts'
import { fitView, layoutStations, minAdjacentGap, type Frame, type LayoutOptions } from './layout.ts'
import { createSymbols, type SymbolOptions, type SymbolShape } from './symbol.ts'
import type { Manifest } from './types.ts'

export interface MapOptions {
  layout?: LayoutOptions
  symbol?: SymbolOptions
  shape?: SymbolShape
  course?: Partial<CourseStyle> | false
  /** 图廓留白倍率 */
  padding?: number
  /** 图廓线宽与网格的强调程度 */
  chart?: { minorStep?: number; majorEvery?: number; compass?: boolean }
  /** 视口宽高比 —— 星团场地的比例跟着它走 */
  aspect?: number
}

export interface MapView {
  frame(dt: number, time: number): void
  resize(w: number, h: number): void
  hovered(): number
  select(i: number): void
  debug(): {
    count: number
    center: [number, number, number]
    half: [number, number, number]
    viewBox: [number, number, number, number]
    aspect: number
    /** 符号外框直径 —— 相邻间距必须不小于它 */
    symbolSize: number
    /** 实测的相邻两站最小直线距离 */
    minGap: number
    nodeScreen: [number, number][]
  }
  dispose(): void
  dom: HTMLElement
}

// ---------------------------------------------------------------------------
// 图廓之外的星 —— 天在闪，图是静的
// ---------------------------------------------------------------------------

interface Star {
  x: number
  y: number
  r: number
  /** 闪烁相位 */
  p: number
}

/** 固定种子的伪随机 —— 同一张图每次打开闪的节奏一样，截图才可复现 */
function hash01(key: string, salt = 0): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  h ^= h >>> 15
  h = Math.imul(h, 2246822507)
  h ^= h >>> 13
  return (h >>> 0) / 4294967296
}

function createStars(count: number, w: number, h: number): Star[] {
  const out: Star[] = []
  for (let i = 0; i < count; i++) {
    out.push({
      x: hash01(`sx${i}`, 11) * w,
      y: hash01(`sy${i}`, 23) * h,
      r: 0.4 + hash01(`sr${i}`, 37) * 1.1,
      p: hash01(`sp${i}`, 53) * Math.PI * 2,
    })
  }
  return out
}

// ---------------------------------------------------------------------------

export function createMapView(
  manifest: Manifest,
  options: MapOptions = {},
  onSelect?: (index: number) => void,
): MapView {
  const stations = manifest.stations
  const radius = options.symbol?.radius ?? options.layout?.radius ?? 2.2
  const padding = options.padding ?? 1.08

  const layoutOpts: LayoutOptions = {
    ...options.layout,
    // 排布和符号必须用同一个半径，否则「相邻间距 ≥ 符号外框」这条约束算的是另一个尺寸
    radius,
    fieldAspect: options.layout?.fieldAspect ?? options.aspect ?? 1.9,
  }
  const placed = layoutStations(stations, layoutOpts)

  // --- 场景 ---
  const svg = svgEl('svg', { xmlns: 'http://www.w3.org/2000/svg', 'data-part': 'chart' })
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')

  /**
   * 图幅跟着视口走 —— 图廓四边正好压在画幅边上。
   *
   * 所以图是**跟着取景一起重建**的，而不是建一次就永远不动：
   * 视口一变，图幅的宽高就变，不重画的话图廓会跑出画外。
   */
  let chart: Chart | null = null
  function buildChart(extentX: number, extentY: number, cx: number, cy: number): void {
    chart?.dispose()

    // 罗盘放**离所有站点最远的那个角** —— 固定一个角会被航线和标注压住。
    let corner: CompassCorner = 'bl'
    let best = -1
    for (const [name, sx, sy] of [
      ['tl', -1, 1],
      ['tr', 1, 1],
      ['bl', -1, -1],
      ['br', 1, -1],
    ] as const) {
      const px = cx + sx * (extentX / 2 - extentX * 0.13)
      const py = cy + sy * (extentY / 2 - extentY * 0.13)
      let d = Infinity
      for (const p of placed) {
        d = Math.min(d, Math.hypot(p.position[0]! - px, p.position[1]! - py))
      }
      if (d > best) {
        best = d
        corner = name
      }
    }

    const opts: ChartOptions = {
      extentX,
      extentY,
      minorStep: options.chart?.minorStep ?? extentX / 28,
      majorEvery: options.chart?.majorEvery ?? 7,
      rhumbCount: 32,
      compass: options.chart?.compass === false ? false : corner,
    }
    chart = createChart(opts)
    // 图幅的中心跟着取景的中心走：图廓四边才正好压在画幅边上
    const [tx, ty] = toSvg(cx, cy)
    chart.group.setAttribute('transform', `translate(${tx} ${ty})`)
    svg.prepend(chart.group)
  }

  const symbols = createSymbols(placed, { radius, shape: options.shape, ...options.symbol })
  svg.append(symbols.group)

  let course: ReturnType<typeof createCourse> | null = null
  if (options.course !== false) {
    course = createCourse(placed, radius, { ...DEFAULT_COURSE, ...options.course })
    svg.append(course.group)
  }

  const labels = createLabels(placed, { radius, onPick: (i) => onSelect?.(i) })
  svg.append(labels.leaders)

  // --- 容器 ---
  const dom = document.createElement('div')
  dom.className = 'sm2-map'

  // 星尘画布在最底下：图廓之外的背景
  const dustCanvas = document.createElement('canvas')
  dustCanvas.className = 'sm2-dust'
  const dctx = dustCanvas.getContext('2d')

  const labelLayer = labels.layer
  dom.append(dustCanvas, svg, labelLayer)

  // 图廓注记：标题块 + 方位标。海图上这几块固定文字是「这是张正式图」的前提。
  const chrome = document.createElement('div')
  chrome.className = 'sm2-chrome'
  chrome.innerHTML = `
    <div class="sm2-chrome__title">STAR CHART</div>
    <div class="sm2-chrome__sub">${stations.length} STATIONS · ${placed[0]?.date?.slice(0, 4) ?? ''}–${placed[placed.length - 1]?.date?.slice(0, 4) ?? ''}</div>
    <div class="sm2-chrome__north">N ↑</div>
  `
  dom.append(chrome)

  // --- 交互 ---
  let hover = -1
  const emphasis = new Float32Array(placed.length)
  let frame: Frame = { distance: 40, center: [0, 0, 0], half: [20, 20, 0] }
  let viewW = 1
  let viewH = 1
  /**
   * 标注留白的倍率。**只增不减** ——
   * 一个会来回增减的取景比一个偏大的取景糟糕得多（画面会在呼吸）。
   */
  let labelRoomFactor = 1
  let stars: Star[] = createStars(240, viewW, viewH)

  function applyViewBox() {
    const aspect = viewW / viewH
    frame = fitView(placed, radius, 42, aspect)
    const [cx, cy] = frame.center
    const half = frame.half

    // 标注甩向两侧，所以**取景要为标注留出图外的空间**。
    const base = Math.min(radius * 6, half[0]! * 0.8)
    const labelRoom = base * labelRoomFactor
    const halfW = Math.max(half[0]! + labelRoom, (half[1]! + labelRoom * 0.3) * aspect) * padding
    const halfH = halfW / aspect

    // SVG 的 y 向下，世界的 y 向上 —— viewBox 的上边对应世界的**上边**，
    // 所以上边取世界中心的负 y。差这一个负号，整张图就落在画幅外了。
    svg.setAttribute('viewBox', `${cx - halfW} ${-(cy + halfH)} ${halfW * 2} ${halfH * 2}`)

    // 图幅跟着视口走：图廓四边压在画幅边上
    buildChart(halfW * 2, halfH * 2, cx, cy)

    // 航线的笔宽是设备像素，虚线间隔也得跟着换算 ——
    // 否则「亮到一半」的那一截会停在错的位置上。
    course?.setProgress(0, viewW / (halfW * 2))
  }

  /** 世界坐标 → 屏幕像素（与 viewBox 同一套变换） */
  const project: Project = (x, y) => {
    const vb = svg.viewBox.baseVal
    // 世界 → SVG（y 翻负号）→ 屏幕
    const [sx, sy] = toSvg(x, y)
    return {
      x: ((sx - vb.x) / vb.width) * viewW,
      y: ((sy - vb.y) / vb.height) * viewH,
    }
  }

  /**
   * 量一次标注溢出，必要时撑开取景。
   * 排版的实际宽度是 CSS 算出来的，库在构建期拿不到 ——
   * 所以只能渲染后量、量完再撑开。这比猜一个常数可靠。
   */
  let tickCount = 0

  function reflowLabels() {
    const vb = svg.viewBox.baseVal
    const worldPerPx = vb.width / Math.max(1, viewW)
    labels.reflow(worldPerPx, project)
  }

  function refitLabels() {
    const over = labels.overflow()
    if (over <= 3) return
    const next = Math.min(1.3, labelRoomFactor * (1 + (over / Math.max(1, viewW * 0.5)) * 0.5))
    if (next <= labelRoomFactor) return
    labelRoomFactor = next
    applyViewBox()
  }

  // 符号的悬停与点击：直接用 DOM 事件，不用射线检测
  symbols.group.querySelectorAll<SVGGElement>('g[data-index]').forEach((g) => {
    const idx = Number(g.dataset.index)
    g.addEventListener('pointerenter', () => {
      hover = idx
    })
    g.addEventListener('pointerleave', () => {
      if (hover === idx) hover = -1
    })
    g.addEventListener('click', (e) => {
      e.stopPropagation()
      onSelect?.(idx)
    })
  })

  return {
    dom,

    hovered: () => hover,

    select(i) {
      onSelect?.(i)
    },

    debug() {
      return {
        count: placed.length,
        center: [...frame.center] as [number, number, number],
        half: [...frame.half] as [number, number, number],
        viewBox: [
          svg.viewBox.baseVal.x,
          svg.viewBox.baseVal.y,
          svg.viewBox.baseVal.width,
          svg.viewBox.baseVal.height,
        ],
        aspect: viewW / viewH,
        symbolSize: radius * 2.7,
        minGap: minAdjacentGap(placed),
        nodeScreen: placed.map((p) => {
          const s = project(p.position[0], p.position[1])
          return [s.x, s.y] as [number, number]
        }),
      }
    },

    resize(w, h) {
      viewW = w
      viewH = h
      svg.setAttribute('width', String(w))
      svg.setAttribute('height', String(h))
      const dpr = Math.min(devicePixelRatio || 1, 2)
      dustCanvas.width = Math.round(w * dpr)
      dustCanvas.height = Math.round(h * dpr)
      dustCanvas.style.width = w + 'px'
      dustCanvas.style.height = h + 'px'
      dctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
      stars = createStars(240, w, h)
      applyViewBox()
    },

    frame(_dt, time) {
      const k = 0.18
      for (let i = 0; i < placed.length; i++) {
        const target = i === hover ? 1 : 0
        emphasis[i] = emphasis[i]! + (target - emphasis[i]!) * k
        symbols.update(i, { emphasis: emphasis[i]!, visited: false })
        labels.setEmphasis(i, emphasis[i]!)
      }
      course?.markStation(hover)

      // 图廓之外的星在闪
      if (dctx) {
        dctx.clearRect(0, 0, viewW, viewH)
        dctx.fillStyle = '#cfe6ff'
        for (const s of stars) {
          const a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(time * 1.4 + s.p))
          dctx.globalAlpha = a
          dctx.fillRect(s.x, s.y, s.r, s.r)
        }
        dctx.globalAlpha = 1
      }

      // 标注要等 CSS 排完版才知道实际占多宽，所以只能在渲染后量
      if (++tickCount % 20 === 0) {
        refitLabels()
        reflowLabels()
      }
    },

    dispose() {
      labels.dispose()
      symbols.dispose()
      course?.dispose()
      chart?.dispose()
      dom.remove()
    },
  }
}
