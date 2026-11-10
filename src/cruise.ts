/**
 * 二级 · 光隧 —— 一串项目环往深处排。
 *
 * ## 一句话
 *
 * 隧道里挂着 4 个环：最近那个是**现在这一站**，后面几个是**接下来要去的**。
 * 每个环都是一个徽章 —— 外弧是活动名字，内弧是时间地点，环心是那张照片。
 *
 * ## 环**排**成一行，不是同心圆
 *
 * 早先的版本是同心套叠的圆。数学上没错（`r = K / z`），但画出来没法看：
 * 四层弧形字半径不同、角度相同，全挤在正中，照片一盖就只剩一个字。
 *
 * 现在：环往**左上方**排成一行，越远越小、越淡，中心点朝消失点收。
 * 于是每一环都读得清 —— 最近那环的照片在正中，后面几环的照片往左上错开，
 * 谁也不压谁。走位变的是**环**，不是照片。
 *
 * ```
 *      ◎ ◎ ◎        ← 越远越小、越淡
 *     ◎ ◎ ◎
 *    ◎ ◎ ◎
 *      ◎            ← 现在这一站：照片在环心
 * ```
 *
 * ## 跳站 = 整行环朝镜头长一格
 *
 * `pos` 是「隧道位置」，浮点站号。当前环在 `pos` 上，深度偏移是 `k - pos`。
 *
 * 跳站时 `pos` 从 `seg` 走到 `seg ± 1`：
 * 最前的环胀大冲出画幅，下一个环长大成新的最前环，末尾从深处补一个新的环进来。
 *
 * **没有任何照片在飞** —— 照片是跟着环走的，跳站时照片淡出、淡入，不做位移。
 *
 * ## 一切只由深度决定
 *
 * 屏幕上每个东西的位置都来自一条式子：**r = K / z**（z 是深度，r 是屏幕半径），
 * 环心的位置则是 **`c = VP + (axis - VP) × (r / r₀)`** —— 半径缩到几成，环心就朝消失点收几成。
 *
 * 这两条式子合起来就是「隧道」的全部来源：远处的一小簇挤在消失点，
 * 近处的一个撑满画幅，一眼就看出这是穿过的东西，而不是雷达屏上等距的同心圆。
 *
 * ## 三条规矩（和三维版一致）
 *
 * 1. 档位由指针速度决定：慢 = 只放行 highlight，快 = overview / details 也放行。
 * 2. 图的死活由读者决定：读者移速决定流速，流速决定它冲多快、什么时候走。
 * 3. 点一下环心的照片 = 把那张照片拿到眼前来看。
 *
 * ## 确定性
 *
 * 没有 Math.random()：素材顺序用站号做种子的定序洗牌，
 * 星尘用固定种子的 mulberry32。同一站永远以同样的顺序出场。
 */

import type { Manifest, Station, Tier } from './types.ts'

// ---------------------------------------------------------------------------
// 规则表
// ---------------------------------------------------------------------------

// --- 透视深度律 ---
/** 诞生半径（像素） */
const R0 = 40
/** 投影常数：r = K / z */
const K = R0 * 20
/** 近平面：比它更近的东西不在画幅里 */
const Z_NEAR = 0.7
/** 出了这个半径就出画 */
const R_MAX = K / Z_NEAR

// --- 环序列 ---
/** 同时挂在隧道里的环数（当前 + 后面几个） */
const RING_COUNT = 4
/**
 * 相邻两环的深度差 —— **相对当前深度**的比例，不是绝对值。
 *
 * 之前写成绝对值 2.2 是错的：当前深度 z₀ = K / r₀ 在 2～3 之间，
 * 2.2 的绝对步长几乎不改变深度，四个环半径一模一样，等于只画了一个环。
 * 相对步长才与画幅无关：0.62 → 半径比 1 : 0.62 : 0.46 : 0.35。
 */
const RING_SEQ_DZ = 0.62
/** 环心的照片：半对角线占环半径的比例 */
const PHOTO_K = 0.92
/** 环上的字：外弧走站名、内弧走序号时间地点 */
const RING_TEXT_OUT = 0.1
const RING_TEXT_IN = 0.11
/** 字号占环半径的比例 */
const RING_TITLE_K = 0.085
const RING_META_K = 0.052
/** 弧形字最多能占多少弧度（太长就缩字号，不然首尾相接叠成一坨） */
const TITLE_SPAN = Math.PI * 0.62
const META_SPAN = Math.PI * 0.55

// --- 行进方向 ---
/**
 * 环往哪个方向排（弧度，屏幕坐标 y 向下）。3.05 ≈ 正左偏下一点。
 *
 * 为什么不是「左上」：弧形字都架在环的**上边**。
 * 环往左上一排，远环的上边正好压在当前环的上边 —— 四层字叠成一团。
 * 改成几乎正左，远环的上边就一路降到左下角，各层各占一档。
 */
const ROW_ANGLE = 3.05
/** 消失点离当前环多远（当前环半径的倍数） */
const VP_DIST = 1.6

// --- 隧道丝网 ---
/** 肋环的深度步长（相对当前深度） */
const MESH_STEP = 0.55
/** 肋环的深度范围 */
const MESH_FROM = -1.05
const MESH_TO = 6.4
/** 纵向线条数（基础值，档位会加） */
const MERIDIANS = 7

// --- 流速 ---
/** 静止时的流速（深度/秒）：保证画面永远在动，不会冻住 */
const VZ_FLOOR = 7.7
/** 每 px/s 指针速度换来的额外流速 */
const VZ_K = 0.02
/** 指针速度上限 */
const SPEED_MAX = 1500

// --- 跳站 ---
/** 光速穿越时长（秒） */
const WARP_TIME = 0.9
/** 指针横向划过多少像素算跳一站 */
const JUMP_PX = 240

// ---------------------------------------------------------------------------
// 确定性随机
// ---------------------------------------------------------------------------

/** mulberry32：同一个种子永远同一串数 */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function smoother(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * x * x * (x * (x * 6 - 15) + 10)
}

/** 标准 smoothstep */
function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface CruiseOptions {
  /**
   * 指针速度基准（px/s）。默认 260，按键鼠调的。
   *
   * 档位判定用的是「相对基准的倍率」，所以换设备只需要改这一个数。
   */
  speedBase?: number
  /** 强制档位。给自动化与截图用；`null` 表示由指针速度决定。 */
  forceTier?: Tier | null
  /** 开局落在第几站 */
  startIndex?: number
  /** 画面上是否显示读数（调试用） */
  debug?: boolean
  /** 开场提示语。不给就不显示 —— 库里不替宿主说话。 */
  hint?: string
}

/** 隧道里的一个环 */
interface Ring {
  /** 这一环代表的站（0 起） */
  k: number
  /** 站序号（1 起） */
  no: number
  st: Station
  /** 深度偏移：0 = 前台，正 = 更深 */
  off: number
  /** 深度 */
  z: number
  /** 屏幕半径 */
  r: number
  /** 环心 */
  cx: number
  cy: number
  /** 不透明度 */
  a: number
  /** 环心照片（这一环没有图时为 null） */
  src: string | null
  /** 照片的不透明度（穿越时淡出淡入） */
  pa: number
}

export interface CruiseDebug {
  /** 当前站 */
  seg: number
  /** 隧道位置（浮点站号） */
  pos: number
  tier: number
  speed: number
  warp: number
  /** 在场环数 */
  count: number
  /** 前台环心 */
  axis: [number, number]
  /** 消失点 */
  vanish: [number, number]
  rings: { no: number; title: string; off: number; z: number; r: number; a: number }[]
  /** 放大看的那张照片 */
  zoomed: string | null
}

export interface CruiseView {
  readonly dom: HTMLElement
  /** 画布尺寸变了 */
  resize(w: number, h: number): void
  /** 落到第 i 站（立即，不走穿越） */
  focus(index: number): void
  /** 当前在第几站 */
  at(): number
  /** 前进一站（走光速穿越） */
  forward(): void
  /** 后退一站（走光速穿越） */
  back(): void
  /** 一帧 */
  frame(dt: number, time: number): void
  /**
   * 定格：把 dt 掐成 0，整个场景停住。
   *
   * 截图往返有几百毫秒，稍纵即逝的帧抓不住，只能先把它停住再截。
   */
  freeze(): void
  thaw(): void
  debug(): CruiseDebug
  dispose(): void
}

// ---------------------------------------------------------------------------

export function createCruise(manifest: Manifest, options: CruiseOptions = {}): CruiseView {
  const stations = manifest.stations
  const N = stations.length
  const speedBase = options.speedBase ?? 260
  const forcedTier: Tier | null = options.forceTier ?? null

  // --- 画布 ---
  const dom = document.createElement('div')
  dom.className = 'sm2-cruise'

  const canvas = document.createElement('canvas')
  canvas.className = 'sm2-cruise__canvas'
  canvas.setAttribute('role', 'img')
  canvas.setAttribute('aria-label', '光隧巡航')
  const ctx2d = canvas.getContext('2d', { alpha: false })
  if (!ctx2d) throw new Error('[starmap-2d] 这一台设备不支持 Canvas 2D')
  // 显式标注一次：收窄要能穿过后面那些闭包，不然每处都要重新判空
  const ctx: CanvasRenderingContext2D = ctx2d

  const panel = document.createElement('div')
  panel.className = 'sm2-cruise__panel'

  const gauge = document.createElement('div')
  gauge.className = 'sm2-cruise__gauge'
  const pip = document.createElement('i')
  pip.className = 'sm2-cruise__pip'
  const glabel = document.createElement('span')
  glabel.className = 'sm2-cruise__gauge-label'
  gauge.append(pip, glabel)

  const warpTag = document.createElement('div')
  warpTag.className = 'sm2-cruise__warp'
  warpTag.textContent = '光速穿越中'

  const readout = document.createElement('div')
  readout.className = 'sm2-cruise__read'

  const sr = document.createElement('ul')
  sr.className = 'sm2-cruise__sr'

  dom.append(canvas, panel, gauge, warpTag, readout, sr)

  let hintEl: HTMLElement | null = null
  if (options.hint) {
    hintEl = document.createElement('div')
    hintEl.className = 'sm2-cruise__hint'
    hintEl.textContent = options.hint
    dom.append(hintEl)
  }

  // --- 内容 ---
  /** 图按档位分池：0 高亮 / 1 概览 / 2 细节 */
  const pools: string[][][] = stations.map((st) => {
    const byTier: string[][] = [[], [], []]
    for (const im of st.images ?? []) byTier[Math.min(2, im.tier | 0)]!.push(im.src)
    return byTier
  })

  /** 贴图缓存：加载好了才画，避免半张图 */
  const texCache = new Map<string, HTMLImageElement>()
  function tex(src: string): HTMLImageElement | null {
    let t = texCache.get(src)
    if (!t) {
      t = new Image()
      t.src = src
      texCache.set(t.src, t)
    }
    return t.complete && t.naturalWidth > 0 ? t : null
  }

  /** 预载一站的图，等它们解码完再进这一段 */
  function preload(segIndex: number): Promise<void> {
    const list: string[] = []
    for (let i = 0; i < 3; i++) {
      const st = stations[segIndex + i]
      if (!st) break
      // 本站的图全载；后面的站只载高亮图 —— 远环上只放得下一张小图
      const tiers = i === 0 ? [0, 1, 2] : [0]
      for (const lv of tiers) list.push(...(pools[segIndex + i]?.[lv] ?? []))
    }
    return Promise.all(
      list.map(
        (src) =>
          new Promise<void>((res) => {
            const t = tex(src)
            if (!t) {
              res()
              return
            }
            if (t.complete) {
              res()
              return
            }
            const done = () => res()
            t.addEventListener('load', done, { once: true })
            t.addEventListener('error', done, { once: true })
            if (t.decode) t.decode().then(done, done)
          }),
      ),
    ).then(() => undefined)
  }

  // --- 状态 ---
  let W = 1
  let H = 1
  let DPR = 1

  let seg = 0 // 当前站
  let pos = 0 // 隧道位置（浮点站号）
  let warp = -1 // 穿越进度；−1 = 不在穿越
  let warpFrom = 0 // 出发站
  let warpTo = 0 // 目标站
  let warpDir = 1 // 穿越方向：+1 前进 / −1 后退
  let speed = 0 // 平滑后的指针速度
  let tier = 0 // 档位（浮点，0 高亮 → 2 细节）
  let meshPhase = 0 // 丝网肋环在深度上的相位
  let flash = 0 // 穿越白场
  let panelT = 0 // 面板逐行浮现的计时
  let shownStation = -1
  let zoomed: string | null = null // 拿到眼前来看的那张

  let px = 0
  let py = 0
  let lpx = 0
  let lpy = 0
  let pointerIn = false
  let frozen = false
  /** 横向累计位移：划过阈值就跳一站 */
  let jumpAcc = 0

  /** 前台环心（跟指针走，带滞后和阻尼） */
  let ax = 0
  let ay = 0
  /** 消失点 */
  let vpx = 0
  let vpy = 0

  // -------------------------------------------------------------------------
  // 取景
  // -------------------------------------------------------------------------

  /** 右侧文字块占多宽 */
  function panelWidth(): number {
    return Math.min(260, Math.max(0, W - 56))
  }

  /** 当前环的半径：受画幅短边和右侧文字块双重限制 */
  function readRadius(): number {
    const avail = Math.max(120, W - panelWidth() - 40)
    return Math.max(90, Math.min(H * 0.42, avail * 0.44))
  }

  /** 前台环心的基准位置（环排往左上，所以基准偏右下） */
  function baseX(): number {
    return (W - panelWidth()) * 0.52
  }
  function baseY(): number {
    return H * 0.53
  }

  /**
   * 深度偏移 → 屏幕上的位置。
   *
   * ```
   *   z  = z₀ × (1 + off × DZ)
   *   r  = K / z
   *   c  = VP + (axis − VP) × (r / r₀)      （off ≥ 0，在消失点那一侧）
   *   c  = axis + (axis − VP) × (r / r₀ − 1) （off < 0，已经越过镜头，从近处压过来）
   * ```
   *
   * 最后一行是关键：半径缩到几成，环心就朝消失点收几成 ——
   * 环排成一行而不是同心圆，靠的就是它。
   */
  function placeAt(off: number): { z: number; r: number; cx: number; cy: number } | null {
    const r0 = readRadius()
    const z0 = K / r0
    const z = z0 * (1 + off * RING_SEQ_DZ)
    if (z <= Z_NEAR) return null
    const r = K / z
    if (r > R_MAX) return null
    const s = r / r0
    const cx = off >= 0 ? vpx + (ax - vpx) * s : ax + (ax - vpx) * (s - 1)
    const cy = off >= 0 ? vpy + (ay - vpy) * s : ay + (ay - vpy) * (s - 1)
    return { z, r, cx, cy }
  }

  /**
   * 站 k 在隧道里的偏移。
   *
   * `pos` 是**镜头在隧道里的位置**（浮点站号）。
   *
   * ```
   *   前进：off = k − pos
   *   后退：off = pos − k
   * ```
   *
   * 后退不是把前进的偏移取绝对值 —— 那样两站会落到同一深度、叠在一起。
   * 后退是**整排调头**：上一站从深处长过来（off 1 → 0），
   * 已经看过的站从镜头边掠过（off 0 → −1）。
   */
  function offsetOf(k: number): number {
    return warpDir >= 0 ? k - pos : pos - k
  }

  // -------------------------------------------------------------------------
  // 环序列
  // -------------------------------------------------------------------------

  /**
   * 这一站按当前档位该拿哪张图。
   *
   * 档位是**解锁**不是**筛选**：慢的时候只出高亮图，快了才出概览和细节。
   */
  function pickPhoto(k: number, tierNow: number): string | null {
    const list = pools[k]
    if (!list) return null
    const t = Math.floor(tierNow + 1e-6)
    const order: Tier[] = t >= 2 ? [2, 1, 0] : t >= 1 ? [1, 0] : [0]
    for (const lv of order) {
      const pool = list[lv] ?? []
      if (pool.length) return pool[0]!
    }
    return null
  }

  /**
   * 照片的不透明度：穿越时淡出淡入，照片本身一点不位移。
   *
   * 静止时**只有当前这一环有照片** —— 远环也塞一张的话，
   * 四张小图会叠在当前站那张大图上，糊成一团。
   */
  function photoAlpha(k: number): number {
    if (warp < 0) return k === seg ? 1 : 0
    const p = Math.min(1, warp)
    // 出发的那个：照片淡出，环自己冲向镜头
    if (k === photoFrom) return 1 - smoothstep(0, 0.32, p)
    // 到达的那个：随环长大淡入
    if (k === photoTo) {
      return warpDir >= 0 ? smoothstep(0.1, 0.6, p) : smoothstep(0.78, 1, p)
    }
    return 0
  }

  let photoFrom = 0
  let photoTo = 0

  /** 环的不透明度：越深越淡，冲过镜头的那个迅速淡出 */
  function ringAlpha(off: number, r: number): number {
    const base = off >= 0 ? Math.max(0.22, 1 - 0.17 * off) : Math.max(0, 1 + 0.9 * off)
    const big = Math.min(1, r / (R_MAX * 0.45))
    return base * (1 - 0.75 * big * big)
  }

  /** 隧道里挂着的那几个环 —— 从远到近 */
  function ringSequence(): Ring[] {
    const out: Ring[] = []
    const base = Math.floor(pos)
    for (let k = base - 3; k <= base + RING_COUNT + 1; k++) {
      const st = stations[k]
      if (!st) continue
      const off = offsetOf(k)
      // 台上只留四个环：偏移 0~3，外加正在冲出画幅的那一个（off ∈ −1~0）
      if (off <= -1 || off > RING_COUNT - 0.5) continue
      const p = placeAt(off)
      if (!p) continue
      const a = ringAlpha(off, p.r)
      if (a <= 0.02) continue
      const pa = photoAlpha(k)
      // 档位一样：穿越途中亮出来的那张，落定后还是同一张，不会跳一下
      const src = pa > 0.02 ? pickPhoto(k, tier) : null
      out.push({
        k,
        no: k + 1,
        st,
        off,
        z: p.z,
        r: p.r,
        cx: p.cx,
        cy: p.cy,
        a,
        src,
        pa,
      })
    }
    return out
  }

  /**
   * 环心照片的尺寸。
   *
   * 用**半对角线**而不是宽高来定：环是个圆，照片要能被它框住，
   * 那约束落在对角线上。
   */
  function photoBox(r: number, ar: number): { w: number; h: number } {
    const diag = 2 * r * PHOTO_K
    const s = Math.sqrt(ar * ar + 1)
    return { w: (diag * ar) / s, h: diag / s }
  }

  // -------------------------------------------------------------------------
  // 交互
  // -------------------------------------------------------------------------

  /**
   * 指针坐标取自画布的矩形，而不是 `offsetX`。
   *
   * `offsetX` 是浏览器按事件目标算的 —— 合成事件（自动化截图）里它可能不准，
   * 而截图正是这个库要保证可复现的场景。读一次矩形更稳。
   */
  function pointerPos(e: PointerEvent): { x: number; y: number } {
    const r = canvas.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  canvas.addEventListener('pointermove', (e) => {
    const { x, y } = pointerPos(e)
    if (!pointerIn) {
      pointerIn = true
      px = x
      py = y
      lpx = px
      lpy = py
    }
    // 横向累计位移：越过阈值就跳一站
    jumpAcc += x - lpx
    px = x
    py = y
    if (hintEl) hideHint()
  })

  canvas.addEventListener('pointerdown', (e) => {
    const { x, y } = pointerPos(e)
    // 已经放大了 → 点一下收回去
    if (zoomed) {
      zoomed = null
      return
    }
    const rings = ringSequence()
    // 1) 点在当前环的照片上 = 拿到眼前来看
    const cur = rings.find((g) => g.off === 0)
    if (cur && cur.src) {
      const t = tex(cur.src)
      if (t) {
        const box = photoBox(cur.r, t.naturalWidth / t.naturalHeight)
        if (Math.abs(x - cur.cx) <= box.w / 2 && Math.abs(y - cur.cy) <= box.h / 2) {
          zoomed = cur.src
          return
        }
      }
    }
    // 2) 点在别的环上 = 直接跳到那一站
    let best: Ring | null = null
    let bestD = 1e9
    for (const g of rings) {
      if (g.off <= 0) continue
      const d = Math.abs(Math.hypot(x - g.cx, y - g.cy) - g.r)
      if (d < bestD) {
        bestD = d
        best = g
      }
    }
    if (best && bestD < Math.max(34, best.r * 0.22)) jumpTo(best.k)
  })

  canvas.addEventListener('pointerleave', () => {
    pointerIn = false
  })

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      jumpTo(e.deltaY > 0 ? seg + 1 : seg - 1)
    },
    { passive: false },
  )

  /** 跳到第 k 站 —— 走光速穿越 */
  function jumpTo(k: number): void {
    if (warp >= 0) return
    const next = Math.max(0, Math.min(N - 1, k))
    if (next === seg) return
    warpFrom = seg
    warpTo = next
    warpDir = next > seg ? 1 : -1
    photoFrom = seg
    photoTo = next
    warp = 0
    zoomed = null
  }

  let hintTimer = 0
  function hideHint(): void {
    if (!hintEl || hintTimer) return
    hintEl.style.opacity = '0'
    hintTimer = window.setTimeout(() => {
      hintTimer = 0
    }, 500)
  }

  // -------------------------------------------------------------------------
  // 画
  // -------------------------------------------------------------------------

  /** 隧道尽头的辉光 —— 那是「前面」 */
  function drawGlow(): void {
    const g = ctx.createRadialGradient(vpx, vpy, 0, vpx, vpy, H * 0.7)
    g.addColorStop(0, 'rgba(130,205,255,.26)')
    g.addColorStop(0.18, 'rgba(74,146,214,.10)')
    g.addColorStop(0.55, 'rgba(30,70,120,.03)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
  }

  /** 纵向线：从消失点射出去的直线，管壁的经线 */
  function drawMeridians(): void {
    const n = MERIDIANS + Math.round(tier * 2)
    ctx.lineWidth = 1
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + meshPhase * 0.012
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      const g = ctx.createLinearGradient(vpx, vpy, vpx + ca * R_MAX, vpy + sa * R_MAX)
      g.addColorStop(0, 'rgba(138,204,244,.34)')
      g.addColorStop(0.22, 'rgba(96,168,224,.13)')
      g.addColorStop(1, 'rgba(60,120,180,0)')
      ctx.strokeStyle = g
      ctx.beginPath()
      ctx.moveTo(vpx + ca * R0 * 0.5, vpy + sa * R0 * 0.5)
      ctx.lineTo(vpx + ca * R_MAX, vpy + sa * R_MAX)
      ctx.stroke()
    }
  }

  /**
   * 肋环：隧道壁上的一圈圈横箍。
   *
   * 它们和项目环用同一条 1/z 律，只是深度错开半格 ——
   * 画出来是一排朝消失点收的圈，纵深感就是这么来的。
   */
  function drawMesh(): void {
    ctx.lineWidth = 1
    const span = MESH_TO - MESH_FROM
    for (let i = 0; i * MESH_STEP < span; i++) {
      const off = MESH_FROM + ((i * MESH_STEP + meshPhase * 0.04) % span)
      const p = placeAt(off)
      if (!p) continue
      const a = 0.16 * (1 - (off - MESH_FROM) / span) + 0.02
      ctx.strokeStyle = `rgba(112,184,236,${a.toFixed(3)})`
      ctx.beginPath()
      ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  /** 星尘：向外冲的颗粒，靠近相机时拉成速度线 */
  const DUST: { ang: number; z: number; k: number }[] = (() => {
    const r = rng(0x9e3779b9)
    const out: { ang: number; z: number; k: number }[] = []
    for (let i = 0; i < 320; i++) {
      out.push({ ang: r() * Math.PI * 2, z: 0.6 + r() * 7.7, k: 0.7 + r() * 0.7 })
    }
    return out
  })()

  function drawDust(dt: number, vz: number): void {
    const active = 140 + Math.round(tier * 70)
    const r0 = readRadius()
    const z0 = K / r0
    for (let i = 0; i < Math.min(active, DUST.length); i++) {
      const d = DUST[i]!
      d.z -= vz * d.k * dt
      if (d.z < Z_NEAR) {
        d.z = 7.7 * (0.6 + (0.4 * ((i * 37) % 10)) / 10)
        d.ang = (i * 2.39996323) % (Math.PI * 2)
      }
      const r = K / d.z
      const r2 = K / (d.z + 0.45 + d.k * 0.5)
      const s = r / r0
      const cx = vpx + (ax - vpx) * s
      const cy = vpy + (ay - vpy) * s
      const s2 = r2 / r0
      const cx2 = vpx + (ax - vpx) * s2
      const cy2 = vpy + (ay - vpy) * s2
      const x = cx + Math.cos(d.ang) * r
      const y = cy + Math.sin(d.ang) * r
      const x2 = cx2 + Math.cos(d.ang) * r2
      const y2 = cy2 + Math.sin(d.ang) * r2
      const al = Math.min(0.9, r / 300) * (1 - r / R_MAX)
      if (al <= 0.02) continue
      // 尾巴淡、头亮 —— 只画一根硬线会像划痕
      ctx.strokeStyle = `rgba(150,200,240,${(al * 0.4).toFixed(3)})`
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      const s2s = r > 400 ? 1.8 : 1.2
      ctx.fillStyle = `rgba(216,238,255,${al.toFixed(3)})`
      ctx.fillRect(x - s2s / 2, y - s2s / 2, s2s, s2s)
    }
  }

  /** 环本体：双圈 + 刻度。像一个仪表的表圈 */
  function drawRingBody(g: Ring): void {
    const { r, a, cx, cy } = g
    ctx.save()
    ctx.globalAlpha = a
    ctx.lineWidth = 1.6
    ctx.strokeStyle = 'rgba(176,230,255,.78)'
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(150,206,246,.34)'
    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.955, 0, Math.PI * 2)
    ctx.stroke()
    // 刻度：72 格，每 6 格一道长刻
    const ticks = r > 120 ? 72 : 36
    for (let i = 0; i < ticks; i++) {
      const t = (i / ticks) * Math.PI * 2
      const long = i % (ticks / 12) === 0
      const len = long ? 16 : 6
      ctx.strokeStyle = long ? 'rgba(186,236,255,.66)' : 'rgba(132,192,236,.32)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(t) * (r - len / 2), cy + Math.sin(t) * (r - len / 2))
      ctx.lineTo(cx + Math.cos(t) * (r + len / 2), cy + Math.sin(t) * (r + len / 2))
      ctx.stroke()
    }
    ctx.restore()
  }

  /** 环里的照片 —— 停在这儿，不飞出去 */
  function drawRingPhoto(g: Ring): void {
    if (!g.src) return
    const t = tex(g.src)
    if (!t) return
    const box = photoBox(g.r, t.naturalWidth / t.naturalHeight)
    ctx.save()
    ctx.globalAlpha = g.a * g.pa
    ctx.drawImage(t, g.cx - box.w / 2, g.cy - box.h / 2, box.w, box.h)
    // 光片边框：让它看起来是隧道里的一块光板，而不是贴上去的照片
    ctx.globalAlpha = g.a * g.pa * 0.55
    ctx.strokeStyle = 'rgba(150,214,255,.8)'
    ctx.lineWidth = 1
    ctx.strokeRect(g.cx - box.w / 2 + 0.5, g.cy - box.h / 2 + 0.5, box.w - 1, box.h - 1)
    ctx.restore()
  }

  /** 环上的字：站名走外弧（上），序号时间地点走内弧（下） */
  function drawRingText(g: Ring): void {
    const { r, a, cx, cy } = g
    const font = 'system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif'
    const titleSize = Math.max(9, Math.min(48, r * RING_TITLE_K))
    const metaSize = Math.max(8, Math.min(28, r * RING_META_K))
    ctx.save()
    ctx.globalAlpha = a * textAlpha()
    arcText(
      g.st.title ?? '',
      cx,
      cy,
      r * (1 + RING_TEXT_OUT),
      -Math.PI / 2,
      1,
      titleSize,
      'rgba(234,247,255,.95)',
      font,
      TITLE_SPAN,
    )
    arcText(
      `${String(g.no).padStart(2, '0')} · ${g.st.date ?? ''} · ${g.st.place ?? ''}`,
      cx,
      cy,
      r * (1 - RING_TEXT_IN),
      Math.PI / 2,
      -1,
      metaSize,
      'rgba(178,224,255,.95)',
      font,
      META_SPAN,
    )
    ctx.restore()
  }

  /** 穿越时字淡一下 —— 白场那一瞬什么都看不清 */
  function textAlpha(): number {
    if (warp < 0) return 1
    return 1 - Math.sin(Math.PI * Math.min(1, warp))
  }

  /**
   * 沿一段圆弧排字。
   *
   * 逐字摆：每个字转到自己的切线角度再画。
   *
   * `dir` 决定走哪个方向，顺着角度增大走（`dir = 1`）或逆着走（`dir = -1`）。
   * **两种方向的字都是正着念的**，因为转角取的是各自方向的切线角：
   *
   * ```
   *   dir = 1  θ = ca + π/2    上弧：字站在环外侧，从左往右读
   *   dir = -1 θ = ca - π/2    下弧：字朝环内侧立，从左往右读
   * ```
   *
   * 用错一条就会把字倒过来 —— 下弧最容易倒。
   *
   * `maxSpan` 是这段弧最多能占多少弧度。字太长就缩字号，
   * 不缩的话一圈字会首尾相接叠成一坨。
   */
  function arcText(
    text: string,
    cx: number,
    cy: number,
    r: number,
    mid: number,
    dir: number,
    size: number,
    color: string,
    font: string,
    maxSpan = Math.PI * 0.9,
  ): void {
    if (!text) return
    ctx.save()
    ctx.font = `${size}px ${font}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const chars = [...text]
    let widths = chars.map((c) => ctx.measureText(c).width)
    let total = widths.reduce((a, b) => a + b, 0)
    // 太长就缩字号
    const span = total / r
    if (span > maxSpan && span > 0) {
      const k = maxSpan / span
      ctx.font = `${Math.max(7, size * k)}px ${font}`
      widths = chars.map((c) => ctx.measureText(c).width)
      total = widths.reduce((a, b) => a + b, 0)
    }
    // 环上的字会压到浅色的照片上（海报、课堂照）—— 没有底板，
    // 就给每个字描一圈深色边。描边是跟着字走的，不是块板。
    ctx.lineJoin = 'round'
    ctx.miterLimit = 2
    ctx.strokeStyle = 'rgba(3,10,20,.82)'
    ctx.lineWidth = Math.max(1.5, size * 0.17)
    const totalSpan = total / r
    let a = mid - (dir * totalSpan) / 2
    for (let i = 0; i < chars.length; i++) {
      const step = widths[i]! / r
      const ca = a + (dir * step) / 2
      ctx.save()
      ctx.translate(cx + Math.cos(ca) * r, cy + Math.sin(ca) * r)
      ctx.rotate(ca + (dir * Math.PI) / 2)
      ctx.strokeText(chars[i]!, 0, 0)
      ctx.fillStyle = color
      ctx.fillText(chars[i]!, 0, 0)
      ctx.restore()
      a += dir * step
    }
    ctx.restore()
  }

  /** 暗角：把注意力压回前台环 */
  function drawVignette(): void {
    const g = ctx.createRadialGradient(ax, ay, H * 0.18, ax, ay, H * 0.95)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, 'rgba(0,0,0,.66)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
  }

  /** 指针：一个小十字 */
  function drawCursor(): void {
    if (!pointerIn || zoomed) return
    ctx.strokeStyle = 'rgba(124,192,240,.5)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(px, py, 6, 0, Math.PI * 2)
    ctx.moveTo(px - 13, py)
    ctx.lineTo(px - 8, py)
    ctx.moveTo(px + 8, py)
    ctx.lineTo(px + 13, py)
    ctx.moveTo(px, py - 13)
    ctx.lineTo(px, py - 8)
    ctx.moveTo(px, py + 8)
    ctx.lineTo(px, py + 13)
    ctx.stroke()
  }

  /**
   * 光速穿越的速度线 —— 从消失点射出去。
   *
   * 这是这一版最被认可的东西：**光速穿越时那束光**。
   * 所以它不是「过场时闪一下白」，而是真的有光从深处射过来。
   */
  function drawWarpLines(): void {
    if (warp < 0) return
    const p = smoother(warp)
    const n = 42
    const r0 = rng(0x51ed270b)
    ctx.save()
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + r0() * 0.06
      const ca = Math.cos(ang)
      const sa = Math.sin(ang)
      const near = H * (0.08 + r0() * 0.5) * (0.25 + p)
      const far = R_MAX * 0.55
      const a = (1 - p) * (0.1 + r0() * 0.34)
      ctx.strokeStyle = `rgba(186,228,255,${a.toFixed(3)})`
      ctx.lineWidth = 1 + r0() * 1.4
      ctx.beginPath()
      ctx.moveTo(vpx + ca * near, vpy + sa * near)
      ctx.lineTo(vpx + ca * far, vpy + sa * far)
      ctx.stroke()
    }
    ctx.restore()
  }

  /** 拿到眼前来看的那张 */
  function drawZoom(): void {
    if (!zoomed) return
    const t = tex(zoomed)
    ctx.save()
    ctx.fillStyle = 'rgba(3,8,16,.88)'
    ctx.fillRect(0, 0, W, H)
    if (t) {
      const ar = t.naturalWidth / t.naturalHeight
      const h = H * 0.86
      const w = h * ar
      const dw = w > W * 0.9 ? W * 0.9 : w
      const dh = dw / ar
      ctx.drawImage(t, (W - dw) / 2, (H - dh) / 2, dw, dh)
      ctx.strokeStyle = 'rgba(150,214,255,.45)'
      ctx.lineWidth = 1
      ctx.strokeRect((W - dw) / 2 + 0.5, (H - dh) / 2 + 0.5, dw - 1, dh - 1)
    }
    ctx.restore()
  }

  // -------------------------------------------------------------------------
  // 面板与里程尺
  // -------------------------------------------------------------------------

  function updatePanel(): void {
    if (shownStation === seg) return
    shownStation = seg
    const st = stations[seg]
    if (!st) return
    panel.replaceChildren()
    const no = document.createElement('span')
    no.className = 'sm2-cruise__no'
    no.textContent = `${String(seg + 1).padStart(2, '0')} / ${N}`
    panel.append(no)
    const title = document.createElement('span')
    title.className = 'sm2-cruise__title'
    title.textContent = st.title
    panel.append(title)
    // 时间地点在环上 —— 面板只带环上放不下的那些
    for (const [cls, text] of [
      ['sm2-cruise__lead', st.lead],
      ['sm2-cruise__role', st.role],
      ['sm2-cruise__role', st.audience],
    ] as const) {
      if (!text) continue
      const el = document.createElement('span')
      el.className = cls
      el.textContent = text
      panel.append(el)
    }
    panelT = 0
  }

  /** 里程尺 —— 「还剩几站」是数，得有一条尺子说清楚 */
  const ticks: HTMLElement[] = []
  for (let i = 0; i < N; i++) {
    const t = document.createElement('i')
    t.className = 'sm2-cruise__tick'
    t.style.left = `${(i / Math.max(1, N - 1)) * 100}%`
    gauge.append(t)
    ticks.push(t)
  }

  /** 屏幕阅读器用的完整站表 */
  for (const [i, st] of stations.entries()) {
    const li = document.createElement('li')
    li.textContent =
      `第 ${i + 1} 站，${st.date ?? ''} ${st.place ?? ''}，${st.title}。` +
      `${st.role ? `角色：${st.role}。` : ''}${st.audience ? `受众：${st.audience}。` : ''}` +
      `${st.summary ?? ''}`
    sr.append(li)
  }

  // -------------------------------------------------------------------------
  // 帧
  // -------------------------------------------------------------------------

  function tick(dtRaw: number): void {
    const dt = frozen ? 0 : Math.min(0.05, dtRaw)

    const dx = px - lpx
    const dy = py - lpy
    const moved = Math.hypot(dx, dy)
    lpx = px
    lpy = py

    // 速度：用真实 dt 算（钳过的 dt 会把数值算虚高）
    const inst = Math.min(SPEED_MAX, moved / Math.max(1e-3, dtRaw))
    speed += (inst - speed) * (moved > 0 ? 0.35 : 1 - Math.exp(-dt / 0.25))

    // 档位：连续快才升档，停住回 L0
    if (forcedTier === null) {
      const rel = speed / speedBase
      if (rel > 1.6 && tier < 2) tier += dt / 0.35
      else if (rel > 0.85 && tier < 1) tier += dt / 0.25
      else if (rel < 0.6) tier -= dt / 0.5
      tier = Math.max(0, Math.min(2, tier))
    } else {
      tier = forcedTier
    }

    // 横向划过阈值 → 跳一站
    if (warp < 0 && Math.abs(jumpAcc) > JUMP_PX) {
      const dir = jumpAcc > 0 ? 1 : -1
      jumpAcc = 0
      jumpTo(seg + dir)
    } else if (warp >= 0) {
      jumpAcc = 0
    }

    // 光速穿越：隧道位置 pos 从 warpFrom 走到 warpTo
    if (warp >= 0) {
      warp += dt / WARP_TIME
      const p = Math.min(1, warp)
      pos = warpFrom + (warpTo - warpFrom) * p
      flash = Math.max(0, 1 - Math.abs(p - 0.5) * 3.0)
      if (warp >= 1) {
        warp = -1
        seg = warpTo
        pos = seg
        warpDir = 1
        shownStation = -1
        zoomed = null
        photoFrom = seg
        photoTo = seg
        void preload(seg)
      }
    } else {
      flash = Math.max(0, flash - dt * 2.2)
    }
    warpTag.classList.toggle('is-on', warp >= 0)

    // 流速：肋环冲多快由指针速度决定 —— 这就是「鼠标移过时的流动感」
    const vz = (VZ_FLOOR + speed * VZ_K) * (warp >= 0 ? 5 : 1)
    meshPhase += vz * dt

    // 前台环心跟指针走（阻尼 + 滞后 → 甩起来有惯性，但不会晕）
    const r0 = readRadius()
    const lag = 1 - Math.exp(-dt / 0.12)
    const bx = baseX()
    const by = baseY()
    const wantX = Math.min(bx + 120, Math.max(bx - 120, bx + (px - bx) * 0.1))
    const wantY = Math.min(by + 90, Math.max(by - 90, by + (py - by) * 0.06))
    ax += (wantX - ax) * lag
    ay += (wantY - ay) * lag
    // 消失点：往前台环心的反方向退出去
    const ux = Math.cos(ROW_ANGLE)
    const uy = Math.sin(ROW_ANGLE)
    vpx = ax + ux * r0 * VP_DIST
    vpy = ay + uy * r0 * VP_DIST

    const rings = ringSequence()

    // --- 画 ---
    ctx.fillStyle = '#04070e'
    ctx.fillRect(0, 0, W, H)
    drawGlow()
    drawMeridians()
    drawMesh()
    drawDust(dt, vz)

    // 环：从远到近画，近的盖住远的
    for (let i = rings.length - 1; i >= 0; i--) {
      const g = rings[i]!
      drawRingPhoto(g)
      drawRingBody(g)
    }

    drawVignette()

    // 环上的字画在暗角之后 —— 永远读得到
    for (let i = rings.length - 1; i >= 0; i--) drawRingText(rings[i]!)

    drawWarpLines()
    if (flash > 0) {
      ctx.fillStyle = `rgba(200,230,255,${(flash * 0.24).toFixed(3)})`
      ctx.fillRect(0, 0, W, H)
    }
    drawZoom()
    drawCursor()

    // 照片拿到眼前时，文字块让开 —— 两层字叠在一起谁也读不了
    dom.classList.toggle('is-zoomed', !!zoomed)

    // 面板与里程尺
    updatePanel()
    if (panelT < 3) {
      panelT += dt
      const rows = panel.children.length
      for (let i = 0; i < rows; i++) {
        const o = smoother((panelT - 0.1 - i * 0.05) / 0.2)
        const el = panel.children[i] as HTMLElement
        el.style.opacity = o.toFixed(3)
        el.style.transform = `translateY(${((1 - o) * 6).toFixed(2)}px)`
      }
    }
    pip.style.left = `${(seg / Math.max(1, N - 1)) * 100}%`
    const nextIdx = Math.min(N - 1, seg + 1)
    const next = stations[nextIdx]
    const label =
      seg >= N - 1 ? '已是最后一站' : `${next?.date ?? ''} ${next?.place ?? ''} · 还剩 ${N - 1 - seg} 站`
    if (glabel.textContent !== label) glabel.textContent = label
    ticks.forEach((t, i) => t.classList.toggle('is-on', i < seg))

    if (options.debug) {
      readout.textContent =
        `第 ${String(seg + 1).padStart(2, '0')} 段 · 位置 ${pos.toFixed(2)} · 穿越 ${warp >= 0 ? `${(warp * 100).toFixed(0)}%` : '—'}\n` +
        `速度 ${speed.toFixed(0)}px/s · 档 ${tier.toFixed(2)} · 流速 ${vz.toFixed(1)} 深度/s\n` +
        `环 ${rings.length} 个（${rings.map((r) => r.no).join(' · ')}）· 前台 ${ax.toFixed(0)},${ay.toFixed(0)}`
    }
  }

  // -------------------------------------------------------------------------
  // 起手
  // -------------------------------------------------------------------------

  seg = Math.max(0, Math.min(N - 1, options.startIndex ?? 0))
  pos = seg
  warpTo = seg
  photoFrom = seg
  photoTo = seg
  ax = baseX()
  ay = baseY()
  px = lpx = ax
  py = lpy = ay
  if (forcedTier !== null) tier = forcedTier
  void preload(seg)

  return {
    dom,

    at: () => seg,

    forward() {
      jumpTo(seg + 1)
    },

    back() {
      jumpTo(seg - 1)
    },

    focus(index) {
      const next = Math.max(0, Math.min(N - 1, index))
      seg = next
      pos = next
      warpTo = next
      warpFrom = next
      photoFrom = next
      photoTo = next
      hopReset()
      warp = -1
      shownStation = -1
      zoomed = null
      jumpAcc = 0
      void preload(seg)
    },

    resize(w, h) {
      W = Math.max(1, w)
      H = Math.max(1, h)
      DPR = Math.min(devicePixelRatio || 1, 2)
      canvas.width = Math.round(W * DPR)
      canvas.height = Math.round(H * DPR)
      canvas.style.width = `${W}px`
      canvas.style.height = `${H}px`
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
      // 画幅变了，取景要重新算：轴心按新画幅落位，指针也归位。
      // 不归位的话，指针还停在旧画幅的坐标上，会把轴心拽偏一截。
      ax = baseX()
      ay = baseY()
      px = lpx = ax
      py = lpy = ay
    },

    frame(dt) {
      tick(dt)
    },

    freeze() {
      frozen = true
    },

    thaw() {
      frozen = false
    },

    debug() {
      const rings = ringSequence()
      return {
        seg,
        pos,
        tier,
        speed,
        warp,
        count: rings.length,
        axis: [ax, ay],
        vanish: [vpx, vpy],
        rings: rings.map((r) => ({
          no: r.no,
          title: r.st.title,
          off: r.off,
          z: r.z,
          r: r.r,
          a: r.a,
        })),
        zoomed,
      }
    },

    dispose() {
      dom.remove()
      texCache.clear()
    },
  }

  /** 落位时把穿越状态清干净 */
  function hopReset(): void {
    warpDir = 1
    flash = 0
  }
}
