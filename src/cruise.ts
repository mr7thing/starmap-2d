/**
 * 二级 · 光隧 —— 2D 版的巡航。
 *
 * ## 一句话
 *
 * 你在看哪儿，隧道就朝哪儿开；划得越快，环冲得越快、内容从眼前掠过；
 * 划得慢，它就停在半路等你看。
 *
 * ## 一切只由深度决定
 *
 * 屏幕上每个东西的位置都来自一条式子：**r = K / z**（z 是深度，r 是屏幕半径）。
 *
 * 这条 1/z 律就是「隧道」的全部来源 ——
 * 远处的环挤在消失点成一小簇，近处的环撑满画幅，一眼就看出这是穿过的东西，
 * 而不是雷达屏上等距的同心圆。
 *
 * 内容也挂在同一根线上：它在 z = Z_FAR 诞生，一路朝你冲过来，
 * 半径自己胀大，到达近平面时按你的速度决定是**掠过飞走**还是**退远**。
 *
 * ## 项目环
 *
 * 每一站外面套一个环：**上弧走站名，下弧走时间地点**，两边字都正着念。
 * 环从远处来 → 停住让人读 → 冲过去。停住那一段是这一站的「读图时间」。
 *
 * 环上字会压到浅色的照片上（海报、课堂照），所以每个字描一圈深色边 ——
 * 是字缘，不是底板。
 *
 * ## 三条规矩（和三维版一致）
 *
 * 1. 档位由指针速度决定：慢 = 只放行 highlight，快 = overview / details 也放行。
 * 2. 图的死活由读者决定：读者移速决定流速，流速决定它冲多快、什么时候走。
 * 3. 点一下 = 钉住那一张：它停在那个深度上，并拿到眼前来看。
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
/** 诞生深度 */
const Z_FAR = 20
/** 投影常数：r = K / z */
const K = R0 * Z_FAR
/** 最近深度（近平面） */
const Z_NEAR = 0.7
/** 出了这个半径就出画 */
const R_MAX = K / Z_NEAR
/** 内容高度 = 半径 × SIZE_K（贴在管壁上，角尺寸不变） */
const SIZE_K = 0.44
/** 钉住后拿到眼前的高度占比 */
const READ_SIZE = 0.46
/** 掠过时的淡出带（占 R_MAX 的比例）：起 / 止 */
const FADE_START = 0.55
const FADE_END = 0.95
/** 转向深度：图冲到这么浅就决定是掠过还是退远 */
const Z_TURN = 2.2

// --- 隧道丝网 ---
/** 环在深度上的等距间隔（等距 → 屏幕上自然往消失点聚拢） */
const RING_DZ = 0.7
/** 丝网最深到哪儿 */
const Z_RING_FAR = 7.7
/** 纵向线条数（基础值，档位会加） */
const MERIDIANS = 6

// --- 流速 ---
/** 静止时的流速（深度/秒）：保证画面永远在动，不会冻住 */
const VZ_FLOOR = 7.7
/** 每 px/s 指针速度换来的额外流速 */
const VZ_K = 0.02
/** 指针速度上限 */
const SPEED_MAX = 1500

// --- 发射与推进 ---
/** 指针每走多远放一条内容 */
const SPAWN_PX = 36
/** 指针累计走多远推进一段 */
const SEG_PX = 620
/** 光速穿越时长（秒） */
const WARP_TIME = 0.9
/** 在场内容上限 */
const MAX_ITEMS = 16

// --- 退场 ---
/** 掠过时的额外推进（深度/秒）。故意不快 —— 1/z 律下最后那点深度是屏幕空间的猛冲。 */
const SWEEP_V = 3
/** 掠过时的横向甩动（弧度/秒） */
const SWEEP_TURN = 3.4
/** 退远时的反向流速（深度/秒） */
const RECEDE_V = 24

// --- 钉住 ---
const PIN_RADIUS = 110
const CLICK_SLOP = 8

// --- 项目环 ---
/** 环出场时的深度 */
const RING_FAR = 6
/** 环停住的深度（这一段就在这儿让人读） */
const RING_READ = 2.3
/** 环冲过去的深度 */
const RING_NEAR = 0.8
/** 环停住时的半径占画幅短边的比例。
 *  0.42 会让上弧的站名贴到画幅顶边（再被指针一带就出画），0.38 留得住。 */
const RING_READ_K = 0.38
/** 环上的字：外弧走站名、内弧走时间地点。偏移与字号都按环半径走 */
const RING_TEXT_OUT = 0.09
const RING_TEXT_IN = 0.09
const RING_TITLE_K = 0.09
const RING_META_K = 0.058

/** 黄金角：内容的角度按它散开，环上才铺得匀 */
const GOLDEN = 2.39996323

/** 左侧文字面板的宽度 —— 视野中心要给它让开 */
const PANEL_W = 240

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

/** 用种子洗牌（Fisher–Yates），不碰原数组 */
function shuffled<T>(arr: readonly T[], seed: number): T[] {
  const out = arr.slice()
  const r = rng(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = (r() * (i + 1)) | 0
    const t = out[i]!
    out[i] = out[j]!
    out[j] = t
  }
  return out
}

function smoother(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * x * x * (x * (x * 6 - 15) + 10)
}

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 图的退场方式 */
export type ImageExit = 'auto' | 'sweep' | 'recede'

export interface CruiseOptions {
  /**
   * 指针速度基准（px/s）。默认 260，按键鼠调的。
   *
   * 档位判定用的是「相对基准的倍率」，所以换设备只需要改这一个数。
   */
  speedBase?: number
  /** 图退场的方式。默认 `auto` —— 慢的时候往后飞走，快的时候迎面掠过。 */
  imageExit?: ImageExit
  /** 强制档位。给自动化与截图用；`null` 表示由指针速度决定。 */
  forceTier?: Tier | null
  /** 开局落在第几站 */
  startIndex?: number
  /** 画面上是否显示读数（调试用） */
  debug?: boolean
  /** 开场提示语。不给就不显示 —— 库里不替宿主说话。 */
  hint?: string
}

interface Trail {
  x: number
  y: number
  s: number
}

interface Item {
  src: string
  tier: Tier
  ang: number
  /** 掠过时往自己那一侧甩出去，不往轴心压 */
  dir: number
  z: number
  age: number
  /** 0 冲来 / 1 退场 */
  phase: 0 | 1
  mode: 'sweep' | 'recede' | null
  pinned: boolean
  pinT: number
  /** 拖影：沿真实走过的路径留的几帧 */
  trail: Trail[]
}

export interface CruiseDebug {
  seg: number
  u: number
  tier: number
  speed: number
  travel: number
  warp: number
  count: number
  axis: [number, number]
  items: { src: string; z: number; x: number; y: number; pinned: boolean }[]
}

export interface CruiseView {
  readonly dom: HTMLElement
  /** 画布尺寸变了 */
  resize(w: number, h: number): void
  /** 落到第 i 站 */
  focus(index: number): void
  /** 当前在第几站 */
  at(): number
  /** 一帧 */
  frame(dt: number, time: number): void
  /**
   * 定格：把 dt 掐成 0，整个场景停住。
   *
   * 截图往返有几百毫秒，稍纵即逝的帧（「掠过」只有零点几秒）抓不住，
   * 只能先把它停住再截。
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
  const exitMode: ImageExit = options.imageExit ?? 'auto'
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
      texCache.set(src, t)
    }
    return t.complete && t.naturalWidth > 0 ? t : null
  }

  /** 预载一站的图，等它们解码完再进这一段 */
  function preload(segIndex: number): Promise<void> {
    const st = stations[segIndex]
    if (!st) return Promise.resolve()
    return Promise.all(
      (st.images ?? []).map(
        (im) =>
          new Promise<void>((res) => {
            const t = tex(im.src)
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

  let seg = 0 // 当前航段（目标站）
  let u = 0 // 段内进度 0→1
  let warp = -1 // 穿越进度；−1 = 不在穿越
  let speed = 0 // 平滑后的指针速度
  let travel = 0 // 指针累计位移
  let spawnAcc = 0
  let tier = 0 // 档位（浮点，0 高亮 → 2 细节）
  let ringPhase = 0 // 环在深度上的相位
  let flash = 0 // 穿越白场
  let seq = 0 // 内容序号（角度用）
  let panelT = 0 // 面板逐行浮现的计时
  let shownStation = -1
  let queue: { src: string; tier: Tier }[] = [] // 本段素材队列
  let queueRound = 0 // 素材放行完重新洗牌的轮次

  let items: Item[] = []

  let px = 0
  let py = 0
  let lpx = 0
  let lpy = 0
  let pressing = false
  let pressMoved = 0
  let pointerIn = false
  let frozen = false

  /** 轴心（跟指针走，带滞后和阻尼） */
  let ax = 0
  let ay = 0

  /** 视野中心：让开左侧面板 */
  function panelWidth(): number {
    return Math.min(PANEL_W, Math.max(0, W - 56))
  }
  function viewCx(): number {
    return W * 0.5 + panelWidth() * 0.36
  }
  function viewCy(): number {
    return H * 0.5
  }

  // -------------------------------------------------------------------------
  // 指针
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
    pressMoved += Math.hypot(x - lpx, y - lpy)
    px = x
    py = y
    if (hintEl) hideHint()
  })

  canvas.addEventListener('pointerdown', (e) => {
    const { x, y } = pointerPos(e)
    pressing = true
    pressMoved = 0
    px = x
    py = y
  })

  canvas.addEventListener('pointerup', () => {
    if (pressing && pressMoved < CLICK_SLOP) pinNearest()
    pressing = false
  })

  canvas.addEventListener('pointerleave', () => {
    pointerIn = false
  })

  let hintTimer = 0
  function hideHint(): void {
    if (!hintEl || hintTimer) return
    hintEl.style.opacity = '0'
    hintTimer = window.setTimeout(() => {
      hintTimer = 0
    }, 500)
  }

  // -------------------------------------------------------------------------
  // 放行
  // -------------------------------------------------------------------------

  /** 当前档位下能放行的图（读数用，不分配数组） */
  function eligibleCount(): number {
    const pool = pools[seg] ?? []
    const t = Math.floor(tier + 1e-6)
    let n = 0
    for (let i = 0; i <= t; i++) n += (pool[i] ?? []).length
    return n
  }

  /** 换段：重排素材队列 */
  function refillQueue(i: number): void {
    const st = stations[i]
    if (!st) {
      queue = []
      return
    }
    const list = (st.images ?? []).map((im) => ({
      src: im.src,
      tier: Math.min(2, im.tier | 0) as Tier,
    }))
    queue = shuffled(list, 0x5eed + i * 7919 + queueRound * 104729)
  }

  function loadSegment(i: number): void {
    queueRound = 0
    refillQueue(i)
    void preload(i)
  }

  /**
   * 放一条内容。
   *
   * 队列是全站洗牌过的，但**只放行档位以内的**：
   * 慢的时候一条一条轮过高亮图，快的时候概览、细节也一起进场。
   * 不合格的留在队列里等档位涨上来 —— 档位是「解锁」，不是「筛选」。
   */
  function spawn(): void {
    const t = Math.floor(tier + 1e-6)
    let idx = -1
    for (let i = 0; i < queue.length; i++) {
      if (queue[i]!.tier <= t) {
        idx = i
        break
      }
    }
    if (idx < 0) {
      // 这一档一张都没有 —— 有些站压根没备高亮图（宣城、太湖就是），
      // 不兜底的话那一段隧道是空的。退到还剩的那一档最低层。
      let low = 3
      for (let i = 0; i < queue.length; i++) low = Math.min(low, queue[i]!.tier)
      for (let i = 0; i < queue.length; i++) {
        if (queue[i]!.tier === low) {
          idx = i
          break
        }
      }
    }
    if (idx < 0) {
      // 这一站的素材放行完了 → 重新洗牌再来一轮（换个顺序，别原地重复）
      queueRound++
      refillQueue(seg)
      if (!queue.length) return
      idx = 0
    }
    const im = queue.splice(idx, 1)[0]
    if (!im) return
    items.push({
      src: im.src,
      tier: im.tier,
      ang: seq * GOLDEN,
      dir: Math.cos(seq * GOLDEN) >= 0 ? 1 : -1,
      z: Z_FAR,
      age: 0,
      phase: 0,
      mode: null,
      pinned: false,
      pinT: 0,
      trail: [],
    })
    seq++
  }

  /** 钉住离指针最近的那一条 */
  function pinNearest(): void {
    let best: Item | null = null
    let bd = PIN_RADIUS
    for (const it of items) {
      if (it.pinned) continue
      const s = place(it)
      const d = Math.hypot(s.x - px, s.y - py)
      if (d < bd) {
        bd = d
        best = it
      }
    }
    if (!best) return
    for (const it of items) if (it.pinned && it !== best) it.pinned = false
    best.pinned = true
  }

  // -------------------------------------------------------------------------
  // 位置
  // -------------------------------------------------------------------------

  /** 一条内容在屏幕上的位置与半径 */
  function place(it: Item): { x: number; y: number; r: number } {
    const r = K / it.z
    return { x: ax + Math.cos(it.ang) * r, y: ay + Math.sin(it.ang) * r, r }
  }

  // -------------------------------------------------------------------------
  // 项目环
  // -------------------------------------------------------------------------

  /**
   * 项目环的深度。
   *
   * 环从远处来 → 停住让人读 → 冲过去。
   *
   * 停住时的半径按**画幅短边**算 —— 环是竖着放的，半径超过半屏高，
   * 上弧的字就跑到画幅外去了。
   */
  function ringDepth(uu: number): number {
    const readZ = K / (Math.min(W, H) * RING_READ_K)
    const approach = 1 - smoother(Math.min(1, uu / 0.55))
    const rush = smoother(Math.max(0, (uu - 0.88) / 0.12))
    return readZ + (RING_FAR - readZ) * approach - (readZ - RING_NEAR) * rush
  }

  /**
   * 轴心的纵向范围 —— 项目环的上弧（站名）不能出画幅。
   *
   * 环停住时的半径是确定的（按画幅短边算），上弧该落在哪儿也就确定了。
   * 轴心在这个范围里走，环上的字就永远在画幅内 ——
   * 指针往上一甩，站名不会跟着飘出顶边。
   */
  function ayLimits(): { top: number; bottom: number } {
    const r = Math.min(W, H) * RING_READ_K
    const titleR = r * (1 + RING_TEXT_OUT)
    const titleH = (r * RING_TITLE_K) / 2
    const metaR = r * (1 - RING_TEXT_IN)
    const metaH = (r * RING_META_K) / 2
    const pad = 10
    return { top: titleR + titleH + pad, bottom: H - (metaR + metaH + pad) }
  }

  /** 项目环的半径与不透明度 */
  function stationRing(): { st: Station; r: number; a: number } | null {
    const st = stations[seg]
    if (!st) return null
    const r = K / ringDepth(u)
    if (r < 34) return null
    const a = Math.min(1, (r - 34) / 90) * (1 - smoother((r / R_MAX - 0.62) / 0.38))
    if (a <= 0.01) return null
    return { st, r, a }
  }

  /** 环本体：双圈 + 刻度。像一个仪表的表圈。 */
  function drawStationRing(): void {
    const g = stationRing()
    if (!g) return
    const { r, a } = g
    ctx.save()
    ctx.globalAlpha = a
    ctx.lineWidth = 1.6
    ctx.strokeStyle = 'rgba(176,230,255,.78)'
    ctx.beginPath()
    ctx.arc(ax, ay, r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(150,206,246,.34)'
    ctx.beginPath()
    ctx.arc(ax, ay, r * 0.955, 0, Math.PI * 2)
    ctx.stroke()
    for (let i = 0; i < 72; i++) {
      const t = (i / 72) * Math.PI * 2
      const long = i % 6 === 0
      const len = long ? 16 : 6
      ctx.strokeStyle = long ? 'rgba(186,236,255,.66)' : 'rgba(132,192,236,.32)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(ax + Math.cos(t) * (r - len / 2), ay + Math.sin(t) * (r - len / 2))
      ctx.lineTo(ax + Math.cos(t) * (r + len / 2), ay + Math.sin(t) * (r + len / 2))
      ctx.stroke()
    }
    ctx.restore()
  }

  /** 环上的字：站名走外弧（上），时间地点走内弧（下） */
  function drawStationRingText(): void {
    const g = stationRing()
    if (!g) return
    const { st, r, a } = g
    const font = 'system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif'
    const titleSize = Math.max(11, Math.min(52, r * RING_TITLE_K))
    const metaSize = Math.max(9, Math.min(32, r * RING_META_K))
    ctx.save()
    ctx.globalAlpha = a
    arcText(st.title ?? '', ax, ay, r * (1 + RING_TEXT_OUT), -Math.PI / 2, 1, titleSize, 'rgba(234,247,255,.95)', font)
    arcText(
      `${String(seg + 1).padStart(2, '0')} · ${st.date ?? ''} · ${st.place ?? ''}`,
      ax,
      ay,
      r * (1 - RING_TEXT_IN),
      Math.PI / 2,
      -1,
      metaSize,
      'rgba(178,224,255,.95)',
      font,
    )
    ctx.restore()
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
  ): void {
    ctx.save()
    ctx.font = `${size}px ${font}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    // 环上的字会压到浅色的照片上（海报、课堂照）—— 没有底板，
    // 就给每个字描一圈深色边。描边是跟着字走的，不是块板。
    ctx.lineJoin = 'round'
    ctx.miterLimit = 2
    ctx.strokeStyle = 'rgba(3,10,20,.82)'
    ctx.lineWidth = Math.max(1.5, size * 0.17)
    const chars = [...text]
    const widths = chars.map((c) => ctx.measureText(c).width)
    const total = widths.reduce((a, b) => a + b, 0)
    const span = total / r
    let a = mid - (dir * span) / 2
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

  // -------------------------------------------------------------------------
  // 画
  // -------------------------------------------------------------------------

  /** 隧道尽头的辉光 —— 那是「前面」 */
  function drawGlow(): void {
    const g = ctx.createRadialGradient(ax, ay, 0, ax, ay, H * 0.62)
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
      const a = (i / n) * Math.PI * 2 + ringPhase * 0.012
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      const g = ctx.createLinearGradient(ax, ay, ax + ca * R_MAX, ay + sa * R_MAX)
      g.addColorStop(0, 'rgba(138,204,244,.34)')
      g.addColorStop(0.22, 'rgba(96,168,224,.13)')
      g.addColorStop(1, 'rgba(60,120,180,0)')
      ctx.strokeStyle = g
      ctx.beginPath()
      ctx.moveTo(ax + ca * R0 * 0.5, ay + sa * R0 * 0.5)
      ctx.lineTo(ax + ca * R_MAX, ay + sa * R_MAX)
      ctx.stroke()
    }
  }

  /** 环：深度等距，屏幕上自然往消失点聚拢 —— 这是隧道，不是雷达 */
  function drawRings(): void {
    const count = 8 + Math.round(tier * 3)
    const span = RING_DZ * count
    ctx.lineWidth = 1
    for (let i = 0; i < count; i++) {
      const z = Z_NEAR + ((ringPhase + i * RING_DZ) % span)
      if (z > Z_RING_FAR) continue
      const r = K / z
      if (r > R_MAX * 1.02) continue
      const a = 0.38 * (1 - z / (Z_RING_FAR + 1)) + 0.07
      ctx.strokeStyle = `rgba(112,184,236,${a.toFixed(3)})`
      ctx.beginPath()
      ctx.arc(ax, ay, r, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  /** 星尘：向外冲的颗粒，靠近相机时拉成速度线 */
  const DUST: { ang: number; z: number; k: number }[] = (() => {
    const r = rng(0x9e3779b9)
    const out: { ang: number; z: number; k: number }[] = []
    for (let i = 0; i < 320; i++) {
      out.push({ ang: r() * Math.PI * 2, z: 0.6 + r() * Z_RING_FAR, k: 0.7 + r() * 0.7 })
    }
    return out
  })()

  function drawDust(dt: number, vz: number): void {
    const active = 140 + Math.round(tier * 70)
    for (let i = 0; i < Math.min(active, DUST.length); i++) {
      const d = DUST[i]!
      d.z -= vz * d.k * dt
      if (d.z < Z_NEAR) {
        d.z = Z_RING_FAR * (0.6 + (0.4 * ((i * 37) % 10)) / 10)
        d.ang = (i * GOLDEN) % (Math.PI * 2)
      }
      const r = K / d.z
      const r2 = K / (d.z + 0.45 + d.k * 0.5)
      const x = ax + Math.cos(d.ang) * r
      const y = ay + Math.sin(d.ang) * r
      const x2 = ax + Math.cos(d.ang) * r2
      const y2 = ay + Math.sin(d.ang) * r2
      const al = Math.min(0.9, r / 300) * (1 - r / R_MAX)
      if (al <= 0.02) continue
      // 尾巴淡、头亮 —— 只画一根硬线会像划痕
      ctx.strokeStyle = `rgba(150,200,240,${(al * 0.4).toFixed(3)})`
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      const s = r > 400 ? 1.8 : 1.2
      ctx.fillStyle = `rgba(216,238,255,${al.toFixed(3)})`
      ctx.fillRect(x - s / 2, y - s / 2, s, s)
    }
  }

  /** 内容 + 它的速度线 */
  function drawItems(): void {
    // 远的先画（z 大 = 远），近的盖在上面；钉住的那张最后画，压在最上层
    const sorted = items.slice().sort((a, b) => (a.pinned ? 1 : 0) - (b.pinned ? 1 : 0) || b.z - a.z)
    for (const it of sorted) {
      const t = tex(it.src)
      if (!t) continue
      const s = place(it)
      if (s.r > R_MAX * 1.08) continue

      let h = s.r * SIZE_K
      let a = Math.min(1, it.age / 0.18)
      if (it.phase === 1 && it.mode === 'recede') {
        a *= 1 - smoother((it.z - Z_TURN) / (Z_FAR - Z_TURN))
      } else {
        // 掠过时淡出：越胀大越透明，不让它糊住画面
        const k = Math.min(1, Math.max(0, (s.r / R_MAX - FADE_START) / (FADE_END - FADE_START)))
        a *= 1 - k * k * (3 - 2 * k)
      }
      if (a <= 0.01) continue

      // 钉住 = 拿到眼前来看：尺寸离开半径的束缚，长到能读的大小
      if (it.pinned) h = h + (READ_SIZE * H - h) * it.pinT
      const ar = t.naturalWidth / t.naturalHeight
      const w = h * ar

      // 头图：本体永远要画。
      ctx.globalAlpha = a
      ctx.drawImage(t, s.x - w / 2, s.y - h / 2, w, h)

      // 拖影：沿**真实走过的路径**留几帧，不是按深度硬塞几个副本。
      // 按深度塞副本会叠成一摞灰盒子（海报本来就是大色块，一叠就露馅），
      // 沿路径留帧才像运动模糊 —— 帧数还得给够，副本太少反而看得出「一张张」。
      for (let k = it.trail.length - 1; k >= 0; k--) {
        const tr = it.trail[k]!
        const ts = tr.s / s.r
        ctx.globalAlpha = a * 0.12
        ctx.drawImage(t, tr.x - (w * ts) / 2, tr.y - (h * ts) / 2, w * ts, h * ts)
      }
      ctx.globalAlpha = 1

      // 光片边框：让它看起来是隧道里的一块光板，而不是贴上去的照片
      if (!it.pinned) {
        ctx.globalAlpha = a * 0.55
        ctx.strokeStyle = 'rgba(150,214,255,.8)'
        ctx.lineWidth = 1
        ctx.strokeRect(s.x - w / 2 + 0.5, s.y - h / 2 + 0.5, w - 1, h - 1)
        ctx.globalAlpha = 1
      }
    }
  }

  /** 暗角：把注意力压回轴心 */
  function drawVignette(): void {
    const g = ctx.createRadialGradient(ax, ay, H * 0.2, ax, ay, H * 0.95)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, 'rgba(0,0,0,.66)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
  }

  /** 指针：一个小十字 */
  function drawCursor(): void {
    if (!pointerIn) return
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

  // -------------------------------------------------------------------------
  // 段落结构
  // -------------------------------------------------------------------------

  function startWarp(): void {
    if (warp >= 0 || seg >= N - 1) return
    warp = 0
    flash = 1
    for (const it of items) it.pinned = false
  }

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
    // 站名、时间、地点已经在环上了 —— 面板只带环上放不下的那些
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
    travel += moved

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

    // 轴心跟指针走（阻尼 + 滞后 → 甩起来有惯性，但不会晕）
    // 横向跟得多、纵向几乎不跟：项目环是竖着放的，轴心一飘，
    // 环上弧的字就跟着跑到画幅外去了。
    const lag = 1 - Math.exp(-dt / 0.12)
    const wantX = Math.min(W * 0.78, Math.max(W * 0.24, viewCx() + (px - viewCx()) * 0.32))
    const lim = ayLimits()
    const wantY = Math.min(lim.bottom, Math.max(lim.top, viewCy() + (py - viewCy()) * 0.06))
    ax += (wantX - ax) * lag
    ay += (wantY - ay) * lag

    // 穿越
    if (warp >= 0) {
      warp += dt / WARP_TIME
      if (warp >= 1) {
        warp = -1
        seg += 1
        u = 0
        items.length = 0
        loadSegment(seg)
      }
    } else {
      // 段内推进：读者走得越多，航段走得越远
      u = Math.max(0, Math.min(1, u + moved / SEG_PX))
      if (u >= 1) startWarp()
    }
    warpTag.classList.toggle('is-on', warp >= 0)
    flash = Math.max(0, flash - dt * 2.2)

    // 流速：环冲多快由指针速度决定 —— 这就是「鼠标移过时的流动感」
    const vz = (VZ_FLOOR + speed * VZ_K) * (warp >= 0 ? 5 : 1)
    ringPhase += vz * dt

    // 发射。指针不动时按「慢慢淌」的速度补一条 ——
    // 展台上没人动鼠标，画面不能是空的（但补得很慢，读者一动就立刻听他的）。
    const idle = moved > 0 ? 0 : SPAWN_PX / 1.6
    spawnAcc = Math.min(spawnAcc + Math.max(moved, idle * dt), SPAWN_PX)
    if (spawnAcc >= SPAWN_PX) {
      spawnAcc = 0
      spawn()
    }

    // 内容随深度朝读者冲来
    for (const it of items) {
      it.age += dt
      if (it.pinned) {
        it.pinT = Math.min(1, it.pinT + dt * 3)
        continue
      }
      // 拖影历史：记下**这一步之前**的位置，慢的时候不留（没有拖影可留）
      if (vz > 26) {
        const p0 = place(it)
        it.trail.push({ x: p0.x, y: p0.y, s: p0.r })
        if (it.trail.length > 7) it.trail.shift()
      } else if (it.trail.length) {
        it.trail.length = 0
      }
      if (it.phase === 0) {
        it.z -= vz * dt
        if (it.z <= Z_TURN) {
          // 到了转向点：你冲得快，它就掠过飞走；你慢，它就退远
          it.phase = 1
          it.mode =
            exitMode === 'auto' ? (speed > speedBase * 0.85 ? 'sweep' : 'recede') : exitMode
        }
      } else if (it.mode === 'sweep') {
        it.z -= SWEEP_V * dt
        // 角度往最近的水平方向拉：图横着滑出画幅
        const target = it.dir >= 0 ? 0 : Math.PI
        let d = target - it.ang
        while (d > Math.PI) d -= Math.PI * 2
        while (d < -Math.PI) d += Math.PI * 2
        it.ang += Math.sign(d) * Math.min(Math.abs(d), SWEEP_TURN * dt)
      } else {
        it.z += RECEDE_V * dt
      }
    }
    items = items.filter((it) =>
      it.pinned ||
      (it.phase === 0
        ? it.z > Z_TURN * 0.5
        : it.mode === 'sweep'
          ? it.z > K / (R_MAX * 1.06) // 胀出画幅
          : it.z < Z_FAR), // 退回消失点
    )
    if (items.length > MAX_ITEMS) {
      items = items
        .filter((it) => it.pinned)
        .concat(items.filter((it) => !it.pinned).slice(-MAX_ITEMS))
    }

    // --- 画 ---
    ctx.fillStyle = '#04070e'
    ctx.fillRect(0, 0, W, H)
    drawGlow()
    drawMeridians()
    drawRings()
    drawStationRing()
    drawDust(dt, vz)
    drawItems()
    drawVignette()
    drawStationRingText()
    if (flash > 0) {
      ctx.fillStyle = `rgba(200,230,255,${(flash * 0.5).toFixed(3)})`
      ctx.fillRect(0, 0, W, H)
    }
    drawCursor()

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
      seg >= N - 1
        ? '已是最后一站'
        : `${next?.date ?? ''} ${next?.place ?? ''} · 还剩 ${N - 1 - seg} 站`
    if (glabel.textContent !== label) glabel.textContent = label
    ticks.forEach((t, i) => t.classList.toggle('is-on', i < seg))

    if (options.debug) {
      readout.textContent =
        `第 ${String(seg + 1).padStart(2, '0')} 段 · 段内进度 ${u.toFixed(2)} · 穿越 ${warp >= 0 ? `${(warp * 100).toFixed(0)}%` : '—'}\n` +
        `速度 ${speed.toFixed(0)}px/s · 档 ${Math.floor(tier)}（放行 ${eligibleCount()} 张）· 流速 ${vz.toFixed(1)} 深度/s\n` +
        `在场 ${items.length} 条 · 钉住 ${items.filter((i) => i.pinned).length} 条 · 轴心 ${ax.toFixed(0)},${ay.toFixed(0)}`
    }
  }

  // -------------------------------------------------------------------------
  // 起手
  // -------------------------------------------------------------------------

  seg = Math.max(0, Math.min(N - 1, options.startIndex ?? 0))
  loadSegment(seg)
  px = lpx = viewCx()
  py = lpy = viewCy()
  ax = viewCx()
  ay = viewCy()
  if (forcedTier !== null) tier = forcedTier

  /** 开场就给画面：先铺几条在不同深度上的内容，别等读者先动 */
  function seedItems(): void {
    for (let i = 0; i < 6; i++) {
      spawn()
      const last = items[items.length - 1]
      if (last) {
        last.z = Z_FAR - (Z_FAR - 3.2) * (i / 5)
        last.age = 0.3
      }
    }
  }
  seedItems()

  return {
    dom,

    at: () => seg,

    focus(index) {
      const next = Math.max(0, Math.min(N - 1, index))
      seg = next
      u = 0
      warp = -1
      items = []
      shownStation = -1
      loadSegment(seg)
      seedItems()
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
      return {
        seg,
        u,
        tier,
        speed,
        travel,
        warp,
        count: items.length,
        axis: [ax, ay],
        items: items.map((it) => {
          const s = place(it)
          return { src: it.src, z: it.z, x: s.x, y: s.y, pinned: it.pinned }
        }),
      }
    },

    dispose() {
      dom.remove()
      texCache.clear()
    },
  }
}
