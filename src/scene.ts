/**
 * 一级 · 环行场景 —— 一排环，一段旅程的总览。
 *
 * ## 先叠着，再拉开
 *
 * 默认进入时，**所有环叠在屏幕正中间** —— 只错开一点点，
 * 看上去是一叠圈，而不是排开的一串。
 *
 * 指针一动，环就**一个一个拉开**：每一枚都有自己的时刻，
 * 前一枚还没走完，后一枚才开始动 —— 不齐步走。
 *
 * ```
 *      ◎        ◎        ◎        ◎        ◎
 *   01 宣城   02 常州   03 成都   04 广美   05 太湖
 * ```
 *
 * **环里没有照片** —— 一级是索引，不是内容；照片留给二级。
 *
 * ## 光线随鼠标游动
 *
 * 场景的底是**一团光**：同心环从光心一圈圈涨开、扩散掉。
 * 光心跟着指针走（带滞后，甩起来有惯性），于是光在屏幕上随意游动。
 *
 * 底子（光环 + 星尘）和二级光隧共用 —— 两个视图必须长得一样。
 *
 * ## 环怎么冒出来
 *
 * 环在远处是暗的、小的；越靠当前站越亮、越大。
 * 翻站的时候整排环滑过去，新的一枚从远处涨进来。
 *
 * ## 确定性
 *
 * 没有 Math.random()：星尘用固定种子的 mulberry32，
 * 叠在一起时的错位也按固定的角度分布。
 */

import { drawBadge, type Badge } from './ring.ts'
import { createField } from './field.ts'
import type { Manifest, Station, Tier } from './types.ts'
import { SpeedTracker, TierTracker } from './window.ts'

// --- 环排 ---
/** 相邻两环的中心距（像素）—— 拉得开，才排得下一整段旅程 */
const RING_GAP = 320
/** 环的半径 */
const RING_R = 104
/** 当前站那一环放大的倍数 */
const RING_CURRENT_K = 1.14

// --- 叠着 → 拉开 ---
/** 叠在一起时每枚环错开的方向（黄金角）—— 不用随机，保证可复现 */
const GOLDEN = 2.39996323
/** 叠在一起时错开多远（像素）—— 一点点，看得出是「一叠」而不是一个 */
const STACK_JITTER = 16
/** 叠在一起时压得多暗 —— 十几枚圈摞着，不能糊成一团白 */
const STACK_ALPHA = 0.2
/** 指针移动多少像素算「展开一环的量」 */
const OPEN_PER_PX = 1 / 260
/** 相邻两枚环错开多少才开始动 —— 一个一个来，不齐步走 */
const OPEN_STAGGER = 0.55
/** 一枚环从开始动到完全拉开要多少「环」 */
const OPEN_SPAN = 0.9

// --- 导航 ---
/** 指针横向最多能把这一排拖偏几站 */
const SCRUB_STATIONS = 0.7

export interface SceneOptions {
  /** 指针速度基准（px/s），给档位判定用 */
  speedBase?: number
  /** 强制档位（0/1/2），给自动化与截图用 */
  forceTier?: Tier | null
  /** 开场提示语 */
  hint?: string
  /** 显示读数 */
  debug?: boolean
}

export interface SceneDebug {
  /** 当前站 */
  index: number
  /** 整排的位置（浮点） */
  scroll: number
  tier: number
  speed: number
  /** 光心 */
  light: [number, number]
  /** 在场环 */
  rings: number
  /** 展开进度（单位：枚环）—— 叠着时是 0 */
  open: number
}

export interface SceneView {
  readonly dom: HTMLElement
  resize(w: number, h: number): void
  /** 落到第 i 站 */
  focus(index: number): void
  /** 当前在第几站 */
  at(): number
  frame(dt: number, time: number): void
  freeze(): void
  thaw(): void
  debug(): SceneDebug
  dispose(): void
}

export interface SceneHandlers {
  /** 点了一枚环 */
  onPick?: (index: number) => void
  /** 指针悬停到了哪一枚环（−1 = 离开了） */
  onHover?: (index: number) => void
}

export function createScene(
  manifest: Manifest,
  options: SceneOptions = {},
  handlers: SceneHandlers = {},
): SceneView {
  const stations = manifest.stations
  const N = stations.length
  const speedBase = options.speedBase ?? 260
  const forcedTier: Tier | null = options.forceTier ?? null

  // --- 画布 ---
  const dom = document.createElement('div')
  dom.className = 'sm2-scene'

  const canvas = document.createElement('canvas')
  canvas.className = 'sm2-scene__canvas'
  canvas.setAttribute('role', 'img')
  canvas.setAttribute('aria-label', '星图 · 环行场景')
  const ctx2d = canvas.getContext('2d', { alpha: false })
  if (!ctx2d) throw new Error('[starmap-2d] 这一台设备不支持 Canvas 2D')
  const ctx: CanvasRenderingContext2D = ctx2d

  const panel = document.createElement('div')
  panel.className = 'sm2-scene__panel sm2-panel'

  const readout = document.createElement('div')
  readout.className = 'sm2-scene__read'

  dom.append(canvas, panel, readout)

  let hintEl: HTMLElement | null = null
  if (options.hint) {
    hintEl = document.createElement('div')
    hintEl.className = 'sm2-scene__hint'
    hintEl.textContent = options.hint
    dom.append(hintEl)
  }

  // --- 状态 ---
  let W = 1
  let H = 1
  let DPR = 1

  let index = 0 // 当前站
  let scroll = 0 // 整排的位置（浮点）
  let px = 0
  let py = 0
  let lpx = 0
  let lpy = 0
  let pointerIn = false
  let frozen = false
  /** 当前悬停在第几枚环（−1 = 没悬停） */
  let hovered = -1
  /**
   * 展开进度（单位：枚环）。
   *
   * 指针每移动一段距离就多累一点 —— 环据此一个一个拉开。
   * 只增不减：拉开过就摆在那儿，不缩回去。
   */
  let openAcc = 0

  /** 光心（跟着指针走，带滞后） */
  let lx = 0
  let ly = 0

  /**
   * 每枚环**进场的时刻**。
   *
   * 环从画幅外滚进来时不该是「突然在那儿」—— 它得涨进来。
   * 记下它第一次出现在画幅里的时刻，入场动画就从那时算。
   */
  const arrivedAt = new Map<number, number>()
  /** 场景时间（秒） */
  let clock = 0

  const speedTrack = new SpeedTracker()
  const tierTrack = new TierTracker()
  const field = createField()
  let tier = 0
  /** 流走过的距离（px）—— 光环按它涨开 */
  let flow = 0

  // --- 取景 ---
  function panelWidth(): number {
    return Math.min(260, Math.max(0, W - 56))
  }
  /** 文字面板的左边界 —— 环不能压到文字下面 */
  function panelLeft(): number {
    return W - panelWidth() - 28
  }
  /** 当前站那一环停在画幅的哪个位置 */
  function readX(): number {
    const usable = panelLeft() - 48
    return Math.max(RING_R * 1.5, usable * 0.38)
  }
  function readY(): number {
    return H * 0.5
  }
  /** 叠在一起时，那一叠环落在画幅的哪个位置 —— 画幅正中 */
  function stackX(): number {
    return W * 0.5
  }
  function stackY(): number {
    return H * 0.5
  }

  // -------------------------------------------------------------------------
  // 交互
  // -------------------------------------------------------------------------

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
    px = x
    py = y
    if (hintEl) hintEl.style.opacity = '0'
    // 悬停到哪一枚环 —— 只在换目标时报告，别每帧喊一次
    const hit = hitRing(x, y)
    if (hit !== hovered) {
      hovered = hit
      handlers.onHover?.(hit)
    }
  })

  canvas.addEventListener('pointerleave', () => {
    pointerIn = false
    if (hovered !== -1) {
      hovered = -1
      handlers.onHover?.(-1)
    }
  })

  canvas.addEventListener('pointerdown', (e) => {
    const { x, y } = pointerPos(e)
    const hit = hitRing(x, y)
    if (hit >= 0) handlers.onPick?.(hit)
  })

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      moveTo(index + (e.deltaY > 0 ? 1 : -1))
    },
    { passive: false },
  )

  /** 点到了第几枚环（−1 = 没点中） */
  function hitRing(x: number, y: number): number {
    let best = -1
    let bd = 1e9
    for (let k = 0; k < N; k++) {
      const s = ringAt(k)
      if (!s) continue
      const d = Math.hypot(x - s.cx, y - s.cy)
      const tol = s.r + 14
      if (d < tol && d < bd) {
        bd = d
        best = k
      }
    }
    return best
  }

  function moveTo(k: number): void {
    const next = Math.max(0, Math.min(N - 1, k))
    if (next === index) return
    index = next
    // 新的一枚要涨进来 —— 进场动画重新走一遍
    arrivedAt.delete(next)
    shownStation = -1
  }

  // -------------------------------------------------------------------------
  // 环的位置
  // -------------------------------------------------------------------------

  interface RingSpot {
    k: number
    cx: number
    cy: number
    r: number
    alpha: number
    current: boolean
    /** 展开度 0～1 —— 0 = 还叠着，1 = 已经排开了 */
    open: number
  }

  /** 第 k 枚环现在在哪儿 */
  function ringAt(k: number): RingSpot | null {
    const rowX = readX() + (k - scroll) * RING_GAP
    const rowY = readY()

    // 叠着的时候：所有环都在正中央，只按固定角度错开一点点
    const a = k * GOLDEN
    const stackCX = stackX() + Math.cos(a) * STACK_JITTER
    const stackCY = stackY() + Math.sin(a) * STACK_JITTER

    // 展开度：环一个一个来 —— 前一枚还没走完，后一枚才动
    const p = clamp01((openAcc - k * OPEN_STAGGER) / OPEN_SPAN)
    const ease = p * p * (3 - 2 * p)

    const cx = stackCX + (rowX - stackCX) * ease
    const cy = stackCY + (rowY - stackCY) * ease
    if (cx < -RING_R * 2 || cx > W + RING_R * 2) {
      arrivedAt.delete(k)
      return null
    }
    const current = k === index
    // 进场：环第一次出现在画幅里就开始涨
    const born = arrivedAt.get(k)
    if (born === undefined) arrivedAt.set(k, clock)
    const grow = Math.min(1, (clock - (born ?? clock)) / 0.55)
    const arrive = grow * grow * (3 - 2 * grow)
    const r = RING_R * (current ? RING_CURRENT_K : 1) * (0.42 + 0.58 * arrive)
    // 离得越远越暗 —— 但别暗到看不见，读者得数得出有几站
    const dist = Math.abs(k - scroll)
    // 叠着的时候压暗 —— 十几枚圈摞着，得看出是「一叠」而不是一团白
    const stackFade = STACK_ALPHA + (1 - STACK_ALPHA) * ease
    let alpha = Math.max(0.34, 1 - dist * 0.2) * (current ? 1 : 0.82) * arrive * stackFade
    // 滚到文字面板下面的环要淡出 —— 文字不能被环压住
    const into = cx + r - (panelLeft() - 24)
    if (into > 0) alpha *= Math.max(0, 1 - into / (r * 1.6))
    return { k, cx, cy, r, alpha, current, open: ease }
  }

  // -------------------------------------------------------------------------
  // 帧
  // -------------------------------------------------------------------------

  function tick(dtRaw: number): void {
    const dt = frozen ? 0 : Math.min(0.05, dtRaw)
    clock += dt
    flow += dt * 110

    const moved = Math.hypot(px - lpx, py - lpy)
    lpx = px
    lpy = py
    // 指针一动，环就一个一个拉开 —— 挪得越多，开得越快
    if (pointerIn) openAcc += moved * OPEN_PER_PX
    const speed = speedTrack.push(moved / Math.max(1e-3, dtRaw), dt)
    tier =
      forcedTier !== null
        ? forcedTier
        : tierTrack.push(speed / speedBase, dt)

    // 指针横向 = 把这一排拖偏一点（跟 film 模式一样：指针是时间轴）
    const scrub =
      pointerIn && W > 1
        ? Math.max(-1, Math.min(1, (px - W * 0.5) / (W * 0.5))) * SCRUB_STATIONS
        : 0
    const want = index + scrub
    scroll += (want - scroll) * (1 - Math.exp(-dt / 0.16))

    // 光心跟着指针走
    const lag = 1 - Math.exp(-dt / 0.09)
    lx += (px - lx) * lag
    ly += (py - ly) * lag

    // --- 画 ---
    ctx.fillStyle = '#04070e'
    ctx.fillRect(0, 0, W, H)
    field.draw(ctx, W, H, lx, ly, dt, tier, flow)

    // 环：从远到近画
    for (let k = N - 1; k >= 0; k--) {
      const s = ringAt(k)
      if (!s) continue
      const st = stations[k]!
      const badge: Badge = {
        cx: s.cx,
        cy: s.cy,
        r: s.r,
        alpha: s.alpha,
        title: st.title,
        meta: whenOf(st),
        titleSize: Math.max(11, Math.min(26, s.r * 0.115)),
        metaSize: Math.max(9, Math.min(18, s.r * 0.068)),
        // 站名往往很长，外弧留得宽些，字才不用缩到看不清
        titleSpan: Math.PI * 0.9,
        metaSpan: Math.PI * 0.7,
        // 时间地点在环上，站名在同一段环线的下面（跟二级光隧一致）
        titleOn: 'bottom',
        // 环和字都加粗 —— 跟背景那些装饰环分得开
        bold: true,
        // 叠着的时候不出字 —— 十几组字摞在一起是一团浆糊，
        // 环拉开之后字才一个一个浮出来
        textAlpha: s.alpha * s.open,
      }
      drawBadge(ctx, badge)
    }

    drawVignette()
    drawCursor()

    updatePanel()

    if (options.debug) {
      readout.textContent =
        `第 ${String(index + 1).padStart(2, '0')} 站 · 整排 ${scroll.toFixed(2)} · 档 ${tier}\n` +
        `速度 ${speed.toFixed(0)}px/s · 光心 ${lx.toFixed(0)},${ly.toFixed(0)} · 展开 ${openAcc.toFixed(2)}`
    }
  }

  function drawVignette(): void {
    const g = ctx.createRadialGradient(W * 0.4, H * 0.5, H * 0.18, W * 0.4, H * 0.5, H * 0.95)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, 'rgba(0,0,0,.66)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
  }

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
  // 面板
  // -------------------------------------------------------------------------

  let shownStation = -1
  function updatePanel(): void {
    if (shownStation === index) return
    shownStation = index
    const st = stations[index]
    if (!st) return
    panel.replaceChildren()
    // 第一行是时间地点，下面是站名 —— 就这两行
    const when = document.createElement('span')
    when.className = 'sm2-scene__when'
    when.textContent = whenOf(st)
    panel.append(when)
    const title = document.createElement('span')
    title.className = 'sm2-scene__title'
    title.textContent = st.title
    panel.append(title)
  }

  // -------------------------------------------------------------------------
  // 起手
  // -------------------------------------------------------------------------

  index = 0
  scroll = 0
  // 开场时环还叠在正中央 —— 光心也得在那儿，否则底下的光晕缩在一边
  lx = stackX()
  ly = stackY()
  px = lpx = lx
  py = lpy = ly

  return {
    dom,
    at: () => index,
    focus(i) {
      const next = Math.max(0, Math.min(N - 1, i))
      index = next
      scroll = next
      // 只让落到的那一枚重新涨一遍 —— 已经摊开的环不该跟着重播进场
      arrivedAt.delete(next)
      shownStation = -1
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
      lx = stackX()
      ly = stackY()
      px = lpx = lx
      py = lpy = ly
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
        index,
        scroll,
        tier,
        speed: speedTrack.value,
        light: [lx, ly],
        rings: stations.length,
        open: openAcc,
      }
    },
    dispose() {
      dom.remove()
    },
  }
}

export type { Station }

// ---------------------------------------------------------------------------

/** 时间地点 —— 面板和环上用的是同一句 */
function whenOf(st: Station): string {
  const d = st.date ? st.date.replace(/-/g, '.') : ''
  const p = st.short || st.place || ''
  return [d, p].filter(Boolean).join(' · ')
}

/** 掐到 0～1 */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
