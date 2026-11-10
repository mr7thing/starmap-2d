/**
 * 排布 —— 内容 → 节点坐标。纯函数，无副作用。
 *
 * ## 唯一的硬性设计决定
 *
 * **相邻站点的间距是一个常量，和图片数量毫无关系。**
 *
 * 这是整个库能长成现在这样的原因。早期版本让「距离严格等于图片数」，
 * 于是只有 1 张图的站点间距被压到 1，而它自己的半径就有 1.1 ——
 * 几何上装不下，参数怎么调都无解。
 *
 * 解法不是找到更好的参数，是**删掉那个从来没人要求的约束**。
 * 现在图片数只决定「这一段要看几张图」，不参与任何几何计算。
 */

import type { Station } from './types.ts'

export interface LayoutOptions {
  /**
   * 排布形态。
   * - `route`（默认）：**X 是进度，Y 是起伏**。一级星图用这个。
   * - `line`：一维等距。二级的巡航段内用这个，段长必须是常量。
   * - `scatter`：二维散布。只在需要「非路线」语义时用。
   */
  field?: 'route' | 'line' | 'scatter'
  /**
   * X 方向的站间距。**默认必须小于符号外框直径**，否则相邻站本来就不重叠，
   * 上下也就没有起伏的必要 —— 整条路线会退化成一条直线。
   * 默认 5。
   */
  spacing?: number
  /**
   * 整条路线从起点到终点在 Y 上净上升多少。
   * **缺省跟水平跨度挂钩**（默认 0.45×），于是路线自动成为一条斜向的航线 ——
   * 「从左到右」用掉 X，「从下到上」用掉 Y，两个维度都在工作。
   * 固定成一个绝对值的话，站数一变斜率就变，构图密度跟着乱。
   */
  rise?: number
  /** 相邻两站之间的转角（度）。默认 28 */
  turn?: number
  /** 斜向航线的升幅系数（相对水平跨度）。默认 0.45 */
  riseRatio?: number
  /**
   * 航线的**蜿蜒幅度**（相对水平跨度）。0 就是一条直线。
   * 默认 0.16 —— 一次两次明显的拐弯，不是抖动的锯齿。
   */
  meander?: number
  /**
   * 蜿蜒的空间频率。越大拐弯越密。默认 1.6
   * 固定种子的噪声：同一个 seed 永远得到同一条航线。
   */
  meanderFreq?: number
  /** 航线种子。改它就换一条航线，但同一个值永远可复现 */
  seed?: string
  /** 弧度系数（line 模式）。默认 0.22 */
  arc?: number
  /** 扰动幅度。默认 1.5 */
  jitter?: number
  /** 纵深扰动幅度。默认 3.0 */
  depth?: number
  /** 节点半径。默认 2.2 */
  radius?: number
  /** 星团场地的宽高比。跟视口一致时填满画面，默认 1.9 */
  fieldAspect?: number
  /** 松弛迭代上限。默认 24 */
  relaxIterations?: number
}

export interface Placed extends Station {
  index: number
  /** 世界坐标 x, y, z */
  position: [number, number, number]
  /** 由 id 决定的稳定色相 0–360 */
  hue: number
}

/** 除 `rise` 外全部有缺省；`rise` 缺省时由水平跨度算出来，所以保持可选。 */
type Resolved = Required<Omit<LayoutOptions, 'rise'>> & Pick<LayoutOptions, 'rise'>

const DEFAULTS: Resolved = {
  field: 'route',
  spacing: 6.4,
  riseRatio: 0.45,
  meander: 0.3,
  meanderFreq: 1.0,
  seed: 'star-chart',
  turn: 28,
  arc: 0.22,
  jitter: 1.5,
  depth: 3,
  radius: 2.2,
  fieldAspect: 1.9,
  relaxIterations: 24,
}

/** 黄金角（137.5°）—— 只在 scatter 模式用。 */
const GOLDEN = Math.PI * (3 - Math.sqrt(5))

/** 32 位字符串哈希 → [0,1)。用于色相与扰动，同一 id 永远得同一结果。 */
export function hash01(key: string, salt = 0): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

// ---------------------------------------------------------------------------
// 确定性噪声 —— 路线蜿蜒的来源
//
// 只用哈希，不用库、不用 Math.random：**同一个种子必须每次得到同一条航线**，
// 否则截图每次都不一样，库也就没法当「可复现的效果」用。
// 这和游戏里生成河流、山脊、洞穴用的是同一套办法。
// ---------------------------------------------------------------------------

/**
 * 一维值噪声（平滑插值的哈希格点）。
 *
 * 导出是因为二级巡航的航线要用**同一套**噪声 ——
 * 两层的站点如果各用各的随机源，同一站在一级和二级会落在两个地方，对不上。
 */
export function noise1(t: number, seed: number): number {
  const i = Math.floor(t)
  const f = t - i
  const u = f * f * (3 - 2 * f)
  const a = hash01(`${seed}`, i)
  const b = hash01(`${seed}`, i + 1)
  return (a * (1 - u) + b * u) * 2 - 1
}

/** 分形叠加：多个倍频叠加，得到自然的起伏而不是单一周期。 */
function fbm(t: number, seed: number, octaves = 3): number {
  let sum = 0
  let amp = 0.5
  let freq = 1
  for (let o = 0; o < octaves; o++) {
    sum += noise1(t * freq, seed + o * 131) * amp
    freq *= 2.07
    amp *= 0.5
  }
  return sum
}

export function layoutStations(
  stations: readonly Station[],
  options: LayoutOptions = {},
): Placed[] {
  const o = { ...DEFAULTS, ...options }
  const n = stations.length
  if (n === 0) return []

  if (o.field === 'line') return layoutLine(stations, o)
  if (o.field === 'scatter') return layoutScatter(stations, o)
  return layoutRoute(stations, o)
}

/**
 * 路线排布 —— **X 是进度，Y 是起伏**。
 *
 * ## 为什么不用螺旋
 *
 * 螺旋是「绕」，不是「航」。读图的人看到螺旋只会想到涡旋、毛细、装饰，
 * 不会想到「从 A 走到 B」。航线必须是**有方向、有起点终点的**。
 *
 * ## 为什么不是黄金角散布
 *
 * 黄金角（137.5°）保证点与点**不重叠**，但它保证不了**相邻序号相邻**：
 * 第 i 站和第 i+1 站在图上隔着大半个圆。按次序连起来就成了蛛网。
 *
 * ## 这里的模型
 *
 * ```
 *   x_i = i · spacing − 居中        ← 恒定间距，严格从左到右
 *   y_i = 整体上行趋势 + 起伏        ← 唯一的自由度
 * ```
 *
 * X 不动 —— 读者靠它读时间。起伏怎么给，由**松弛**决定：
 * 逐站放置，每站躲开所有**已经放下**的点（不只是前一个）。
 * 这和 Poisson disk 采样、Lloyd 松弛是同一族思路：
 * 「不重叠」不是靠一条全局规则硬凑，而是靠反复把点推开而收敛。
 *
 * 所以路线既能保持水平位置大体等距，又能上下曲折，还不会缠成一团。
 */
function layoutRoute(stations: readonly Station[], o: Resolved): Placed[] {
  const n = stations.length
  const dx = o.spacing

  // 整条航线的升幅：跟水平跨度挂钩，于是站数变了斜率不变、构图密度稳定。
  const rise = o.rise ?? (n - 1) * dx * o.riseRatio
  const spanX = (n - 1) * dx

  /**
   * 航线本体：一条**程序化的曲折曲线**，从左下走到右上。
   *
   * 做法和游戏里生成河流、山脊、洞穴是同一套：
   *   1. 先定两个锚点（左下 → 右上），这是「大方向」
   *   2. 中间叠一个**固定种子**的分形噪声，这是「曲折」
   *   3. 站点沿这条曲线**按弧长等距**布置 —— 站间距均匀，
   *      又不会像「直线 + 松弛」那样被非重叠约束压成一条直线
   *
   * 为什么不用样条穿过站点：站点是**采样点**，不是控制点。
   * 拿站点当控制点，站一远曲线就过冲，最后绞成蛛网。
   */
  const SAMPLES = 512
  const amp = spanX * o.meander
  const seedNum = [...o.seed].reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 7)

  const spine: [number, number][] = []
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES
    const x = -spanX / 2 + t * spanX
    // 噪声两端收敛到 0，锚点才真的是锚点（用 sin 包络）
    const envelope = Math.sin(Math.PI * t)
    const wobble = fbm(t * o.meanderFreq, seedNum) * amp * envelope
    spine.push([x, (t - 0.5) * rise + wobble])
  }

  // 累积弧长 → 站点按等弧长落点
  const cum: number[] = [0]
  for (let i = 1; i < spine.length; i++) {
    const a = spine[i - 1]!
    const b = spine[i]!
    cum.push(cum[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]))
  }
  const total = cum[cum.length - 1]!

  const at = (frac: number): [number, number] => {
    const target = frac * total
    let lo = 0
    let hi = cum.length - 1
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1
      if (cum[mid]! <= target) lo = mid
      else hi = mid
    }
    const seg = cum[hi]! - cum[lo]! || 1
    const k = (target - cum[lo]!) / seg
    const a = spine[lo]!
    const b = spine[hi]!
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
  }

  // 符号外框：内核 + 线框。留余量，别让两个符号的线碰到。
  const minSep = o.radius * 2.9

  // 等弧长保证的是「沿曲线」均匀；曲线急转弯处相邻站仍可能贴太近，
  // 所以额外给一点自由度数，让松弛去摆平。
  const need = Math.sqrt(Math.max(0, minSep * minSep - dx * dx))
  const slack = Math.max(o.jitter, need * 0.5)

  const xs: number[] = []
  const ys: number[] = []

  for (let i = 0; i < n; i++) {
    const frac = n > 1 ? i / (n - 1) : 0.5
    const [x, y0] = at(frac)

    // 扰动先加，松弛后统一保证间距 —— 顺序反过来的话，起伏会被松弛抹平
    let y =
      y0 +
      (hash01(stations[i]!.id, 11) - 0.5) * 2 * slack +
      (hash01(stations[i]!.id, 5) - 0.5) * 2 * o.jitter * 0.5
    xs.push(x)
    ys.push(y)

    // 松弛：躲开所有已经放下的点，不只是前一个 ——
    // 前后隔几站也可能挤到一起，只跟邻居比是不够的。
    for (let pass = 0; pass < o.relaxIterations; pass++) {
      let moved = false
      for (let j = 0; j < i; j++) {
        const ddx = x - xs[j]!
        // X 相距够远就碰不着，Y 怎么摆都行
        if (Math.abs(ddx) >= minSep) continue
        const want = Math.sqrt(minSep * minSep - ddx * ddx)
        const dy = y - ys[j]!
        if (Math.abs(dy) < want) {
          // 完全重合时向上推；否则沿当前方向推开
          y += dy >= 0 ? want - Math.abs(dy) : -(want - Math.abs(dy))
          if (dy === 0) y += want
          moved = true
        }
      }
      if (!moved) break
    }
  }

  return stations.map((s, i) => {
    const z = (hash01(s.id, 29) - 0.5) * 2 * o.depth
    return {
      ...s,
      index: i,
      position: [xs[i]!, ys[i]!, z] as [number, number, number],
      hue: Math.floor(hash01(s.id, 7) * 360),
    }
  })
}

/** 一维等距排布。段长恒定，与图片数无关 —— 见本文件顶部的设计决定。 */
function layoutLine(stations: readonly Station[], o: Resolved): Placed[] {
  const n = stations.length
  const midX = -((n - 1) * o.spacing) / 2

  return stations.map((s, i) => {
    const x = midX + i * o.spacing
    // 用归一化进度而不是 x²，否则站数一变弧度就变形。
    const t = n > 1 ? i / (n - 1) : 0.5
    const arcY = Math.sin(Math.PI * t) * o.arc * o.spacing
    const jy = (hash01(s.id, 11) - 0.5) * 2 * o.jitter
    const jz = (hash01(s.id, 29) - 0.5) * 2 * o.depth

    return {
      ...s,
      index: i,
      position: [x, arcY + jy, jz] as [number, number, number],
      hue: Math.floor(hash01(s.id, 7) * 360),
    }
  })
}

/**
 * 二维星团排布 —— 黄金角螺旋 + 哈希扰动。
 *
 * 按时间顺序从内向外铺开：第一站落在中心，旅程向外生长。
 * 这既填满画面（横排填不满），也让「越早的事越靠里」成为一个可读的直觉。
 */
function layoutScatter(stations: readonly Station[], o: Resolved): Placed[] {
  const n = stations.length
  // 场地大小按节点数自适应：站多了就摊开，站少了就收紧，
  // 这样 2 站和 40 站的构图密度是一样的。
  const field = o.spacing * Math.sqrt(n) * 0.52

  return stations.map((s, i) => {
    const t = n > 1 ? i / n : 0.5
    // 螺旋半径按 sqrt 分布，保证点与点的间距大致均匀
    const r = Math.sqrt((i + 0.5) / n)
    const a = i * GOLDEN

    // 场地按视口比例拉宽，否则横屏时上下会空一大片
    const x = Math.cos(a) * r * field * o.fieldAspect
    const y = Math.sin(a) * r * field
    // 最后几站略微外扩，避免全部挤在中心
    const push = 1 + t * 0.35

    const jx = (hash01(s.id, 3) - 0.5) * 2 * o.jitter * 0.8
    const jy = (hash01(s.id, 11) - 0.5) * 2 * o.jitter
    const jz = (hash01(s.id, 29) - 0.5) * 2 * o.depth

    return {
      ...s,
      index: i,
      position: [x * push + jx, y * push + jy, jz] as [number, number, number],
      hue: Math.floor(hash01(s.id, 7) * 360),
    }
  })
}

/**
 * 相邻两站的最小直线距离。
 * 这是排布最重要的一条数：小于符号外框直径，两个符号的线就会缠在一起；
 * 航线也会因为「相邻站不够近」而退化成蛛网。
 * 量出来而不是推算 —— 扰动、场地比例都会影响最终结果。
 */
export function minAdjacentGap(placed: readonly Placed[]): number {
  let min = Infinity
  for (let i = 0; i < placed.length - 1; i++) {
    const a = placed[i]!.position
    const b = placed[i + 1]!.position
    min = Math.min(min, Math.hypot(a[0] - b[0], a[1] - b[1]))
  }
  return min === Infinity ? 0 : min
}

/** 全部节点到图心的最大距离 —— 取景要盖住它。 */
export function maxRadius(placed: readonly Placed[]): number {
  let m = 0
  for (const p of placed) {
    m = Math.max(m, Math.hypot(p.position[0], p.position[1]))
  }
  return m
}

export interface Frame {
  /** 透视相机下的距离。正交相机用不到，但保留以便两套排布共用一个取景函数。 */
  distance: number
  /** 节点包围盒中心 —— 相机看向这里，而不是原点 */
  center: [number, number, number]
  /** 包围盒半尺寸。正交相机的视锥由它决定 */
  half: [number, number, number]
}

/**
 * 让全部节点落进一个可视球里。
 * 站数从 2 变到 40 都不需要改任何布局参数。
 */
export function fitView(
  placed: readonly Placed[],
  radius: number,
  fovDeg: number,
  aspect: number,
  padding = 1.14,
): Frame {
  if (placed.length === 0) return { distance: radius * 4, center: [0, 0, 0], half: [radius, radius, 0] }

  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (const p of placed) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, p.position[k]!)
      hi[k] = Math.max(hi[k]!, p.position[k]!)
    }
  }

  const center: [number, number, number] = [
    (lo[0]! + hi[0]!) / 2,
    (lo[1]! + hi[1]!) / 2,
    (lo[2]! + hi[2]!) / 2,
  ]
  const half: [number, number, number] = [
    (hi[0]! - lo[0]!) / 2,
    (hi[1]! - lo[1]!) / 2,
    (hi[2]! - lo[2]!) / 2,
  ]

  const vFov = (fovDeg * Math.PI) / 180
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect)
  // 横向通常先撑满，但竖屏时纵向会变成瓶颈 —— 取更严的那个。
  const byWidth = half[0] / Math.tan(hFov / 2)
  const byHeight = half[1] / Math.tan(vFov / 2)

  // 星点的视觉外缘是「半径 × 光环系数」，不是半径本身。
  // 按半径算，星点会正好贴在画面边缘上。
  const glyph = radius * 2.2

  return {
    distance: Math.max(byWidth, byHeight, half[2]! + glyph * 4) * padding + glyph,
    center,
    half,
  }
}
