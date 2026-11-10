/**
 * 海图底 —— 一张宇宙航行的星图该有的所有「纸面」元素。
 *
 * 全部画成 SVG，用**世界坐标**（和三维版同一套），外面套一个 viewBox。
 * 于是这张图是矢量的：放大不糊，截图永远清晰，文字能选中、能被读屏读到。
 *
 * 三维版这些东西是用 three 的 LineSegments 拼的 —— 那是因为它得在 3D 场景里
 * 当底图用。平面图用 3D 引擎画，是全库最浪费的一处：正交相机的平面图
 * 和 SVG 的差别只剩下「能不能选中文字」这一项，而这一项 SVG 赢。
 *
 *   · 经纬网格（细格 + 粗格）
 *   · 斜航线（rhumb lines）—— 从罗盘玫瑰发出的辐射线
 *   · 罗盘玫瑰
 *   · 图廓与刻度
 *
 * ## 图幅跟着视口走
 *
 * 图廓不是一张方纸 —— 它就是**这块画布的边界**。所以图幅取视口的宽高，
 * 图廓四边正好压在画幅边上，罗盘也才落得出「左下角内侧」这个位置。
 *
 * 代价是：视口一变，图幅就得重画。所以图是跟着取景一起重建的，
 * 而不是建一次就永远不动。
 */

export const SVG_NS = 'http://www.w3.org/2000/svg'

/** 建一个 SVG 元素 */
export function svgEl<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, name)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
  return e
}

export type ChartInk = {
  /** 底色 */
  paper: string
  /** 细网格 */
  gridMinor: string
  /** 粗网格 */
  gridMajor: string
  /** 斜航线 */
  rhumb: string
  /** 罗盘与图廓 */
  frame: string
}

export const CHART_INK: ChartInk = {
  paper: '#04070e',
  gridMinor: '#16324f',
  gridMajor: '#24537f',
  rhumb: '#173a5c',
  frame: '#4e86b8',
}

export interface ChartOptions {
  /** 图幅在世界坐标里的宽（x 方向） */
  extentX: number
  /** 图幅在世界坐标里的高（y 方向） */
  extentY: number
  /** 细格步长（世界单位） */
  minorStep?: number
  /** 粗格每隔几格 */
  majorEvery?: number
  ink?: Partial<ChartInk>
  /** 斜航线的角度数，默认 32 向 */
  rhumbCount?: number
  /**
   * 罗盘玫瑰。
   *
   * `false` = 不画；给一个角 = 画在那个角（世界坐标的说法：bl 是左下）。
   * 固定一个角会被航线压住 —— 哪个角空着，画哪个。
   */
  compass?: boolean | CompassCorner
}

/** 图廓的四个角（世界坐标的说法，y 向上） */
export type CompassCorner = 'tl' | 'tr' | 'bl' | 'br'

export interface Chart {
  group: SVGGElement
  dispose(): void
}

/**
 * 世界坐标 → SVG 坐标。
 *
 * **SVG 的 y 向下，世界的 y 向上** —— 所以这里翻一次负号。
 *
 * 全库只有这一处做这件事。三维版用 three（y 向上），
 * 二维版如果直接拿世界坐标写进 SVG，整张图会上下颠倒；
 * 而各自翻、各自记，翻漏一处就只错一半 —— 更难查。
 */
export function toSvg(x: number, y: number): [number, number] {
  return [x, -y]
}

const INK = (o?: Partial<ChartInk>) => ({ ...CHART_INK, ...o })

// ---------------------------------------------------------------------------

/** 网格。细格与粗格分两组，透明度差一个量级。 */
function buildGrid(
  extentX: number,
  extentY: number,
  minorStep: number,
  majorEvery: number,
  ink: ChartInk,
) {
  const g = svgEl('g', { 'data-part': 'grid' })
  const ex = extentX / 2
  const ey = extentY / 2
  const nx = Math.floor(ex / minorStep)
  const ny = Math.floor(ey / minorStep)

  const minor: SVGElement[] = []
  const major: SVGElement[] = []
  for (let i = -nx; i <= nx; i++) {
    const c = i * minorStep
    const bucket = i % majorEvery === 0 ? major : minor
    bucket.push(svgEl('line', { x1: c, y1: -ey, x2: c, y2: ey }))
  }
  for (let j = -ny; j <= ny; j++) {
    const c = j * minorStep
    const bucket = j % majorEvery === 0 ? major : minor
    bucket.push(svgEl('line', { x1: -ex, y1: c, x2: ex, y2: c }))
  }

  const paint = (nodes: SVGElement[], stroke: string, opacity: number) => {
    const gg = svgEl('g', { stroke, 'stroke-width': '1px', opacity })
    for (const nd of nodes) gg.append(nd)
    g.append(gg)
  }
  paint(minor, ink.gridMinor, 0.34)
  paint(major, ink.gridMajor, 0.6)
  return g
}

/**
 * 斜航线 —— 从中心辐射出去的等角线。
 * 这是海图上最认得出的符号之一，也是「这是一张航图」最省力的暗示。
 */
function buildRhumb(extentX: number, extentY: number, count: number, ink: ChartInk) {
  const e = (Math.max(extentX, extentY) / 2) * 1.45 // 比图廓略大，出画才有「延伸出去」的意思
  const g = svgEl('g', { stroke: ink.rhumb, 'stroke-width': '1px', opacity: 0.4 })
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2
    g.append(svgEl('line', { x1: 0, y1: 0, x2: Math.cos(a) * e, y2: Math.sin(a) * e }))
  }
  return g
}

/** 罗盘玫瑰：外环 + 32 向刻度 + 四向主辐线。 */
function buildCompass(radius: number, ink: ChartInk) {
  const g = svgEl('g', { 'data-part': 'compass' })
  const ring = (r: number, opacity: number) =>
    g.append(
      svgEl('circle', { cx: 0, cy: 0, r, fill: 'none', stroke: ink.frame, 'stroke-width': '1px', opacity }),
    )

  ring(radius, 0.75)
  ring(radius * 0.86, 0.4)
  ring(radius * 0.3, 0.55)

  // 刻度：32 向，长短交替
  const ticks = svgEl('g', { stroke: ink.frame, 'stroke-width': '1px', opacity: 0.8 })
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2
    const long = i % 8 === 0
    const r0 = radius * (long ? 0.3 : 0.66)
    ticks.append(
      svgEl('line', {
        x1: Math.cos(a) * r0,
        y1: Math.sin(a) * r0,
        x2: Math.cos(a) * radius * 0.86,
        y2: Math.sin(a) * radius * 0.86,
      }),
    )
  }
  g.append(ticks)

  // 四向主辐线
  const rays = svgEl('g', { stroke: ink.frame, 'stroke-width': '1px', opacity: 0.55 })
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2
    rays.append(svgEl('line', { x1: 0, y1: 0, x2: Math.cos(a) * radius, y2: Math.sin(a) * radius }))
  }
  g.append(rays)
  return g
}

/** 图廓：四边框 + 四角标记。 */
function buildFrame(extentX: number, extentY: number, ink: ChartInk) {
  const ex = extentX / 2
  const ey = extentY / 2
  const tick = Math.min(ex, ey) * 0.16
  const g = svgEl('g', { stroke: ink.frame, 'stroke-width': '1px', opacity: 0.5, fill: 'none' })
  g.append(svgEl('rect', { x: -ex, y: -ey, width: extentX, height: extentY }))
  for (const [sx, sy] of [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ] as const) {
    const cx = sx * ex
    const cy = sy * ey
    g.append(svgEl('line', { x1: cx, y1: cy, x2: cx - sx * tick, y2: cy }))
    g.append(svgEl('line', { x1: cx, y1: cy, x2: cx, y2: cy - sy * tick }))
  }
  return g
}

/**
 * 底色：径向渐变 + 极淡的噪点，避免大面积纯色显得像没加载完。
 *
 * 噪点用 SVG 的 `feTurbulence` —— 一行滤镜，不用逐像素画。
 */
function buildPaper(extentX: number, extentY: number, ink: ChartInk) {
  const defs = svgEl('defs')
  const grad = svgEl('radialGradient', { id: 'sm-paper', cx: '50%', cy: '50%', r: '72%' })
  grad.append(svgEl('stop', { offset: '0%', 'stop-color': ink.paper, 'stop-opacity': 1 }))
  grad.append(svgEl('stop', { offset: '100%', 'stop-color': ink.paper, 'stop-opacity': 0.55 }))
  defs.append(grad)

  const filter = svgEl('filter', { id: 'sm-grain', x: '0%', y: '0%', width: '100%', height: '100%' })
  filter.append(
    svgEl('feTurbulence', {
      type: 'fractalNoise',
      baseFrequency: '0.9',
      numOctaves: '2',
      stitchTiles: 'stitch',
      result: 'n',
    }),
  )
  filter.append(
    svgEl('feColorMatrix', {
      in: 'n',
      type: 'matrix',
      values: '0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.035 0',
    }),
  )

  const g = svgEl('g', { 'data-part': 'paper' })
  g.append(defs)
  g.append(
    svgEl('rect', {
      x: -extentX / 2,
      y: -extentY / 2,
      width: extentX,
      height: extentY,
      fill: 'url(#sm-paper)',
    }),
  )
  // 噪点单独一层，盖在渐变上
  g.append(
    svgEl('rect', {
      x: -extentX / 2,
      y: -extentY / 2,
      width: extentX,
      height: extentY,
      filter: 'url(#sm-grain)',
      opacity: 0.9,
    }),
  )
  return g
}

// ---------------------------------------------------------------------------

export function createChart(options: ChartOptions): Chart {
  const ink = INK(options.ink)
  const extentX = options.extentX
  const extentY = options.extentY
  const group = svgEl('g', { 'data-part': 'chart' })

  group.append(buildPaper(extentX, extentY, ink))
  group.append(
    buildGrid(extentX, extentY, options.minorStep ?? extentX / 28, options.majorEvery ?? 7, ink),
  )
  group.append(buildRhumb(extentX, extentY, options.rhumbCount ?? 32, ink))
  group.append(buildFrame(extentX, extentY, ink))

  if (options.compass !== false) {
    // 尺寸跟着图幅走，但位置压在指定那个角的内侧 ——
    // 罗盘是图廓内的注记，不是画外的装饰。
    // 「左下」是世界坐标的说法（y 向上），换到 SVG 要翻负号。
    const corner: CompassCorner = typeof options.compass === 'string' ? options.compass : 'bl'
    const sx = corner === 'tl' || corner === 'bl' ? -1 : 1
    const sy = corner === 'bl' || corner === 'br' ? -1 : 1
    const rose = buildCompass(Math.min(extentX, extentY) * 0.085, ink)
    const [rx, ry] = toSvg(
      sx * (extentX / 2 - extentX * 0.13),
      sy * (extentY / 2 - extentY * 0.13),
    )
    rose.setAttribute('transform', `translate(${rx} ${ry})`)
    group.append(rose)
  }

  return {
    group,
    dispose() {
      group.remove()
    },
  }
}
