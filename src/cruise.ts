/**
 * 二级 · 光隧 —— 一条元素队列。
 *
 * ## 一句话
 *
 * 队列里只有两种东西：**章名环**（带项目名）和**照片**。
 * 它们**同一套逻辑** —— 出生、胀大、被下一条顶走、淡出。
 * 环只是「大一点、带字」的那种元素。
 *
 * ```
 *   ◎ 环(项目名)  →  图  图  图  →  ◎ 环(下一个项目名)  →  图  图 …
 * ```
 *
 * ## 为什么不是「一站一屏」
 *
 * 早先的版本一站只放一张图，读者要一站一站地点进去 —— 图片浏览被限死了。
 * 现在一站的照片**一张张冒出来**，这一站冒完了，下一个项目的环带字飞出来，
 * 接着是下一个项目的照片。整条旅程是一条不断的流。
 *
 * ## 元素怎么动
 *
 * 照抄「流动感实验台」里 tunnel 模式那套：
 *
 * 1. **光心跟着指针走**（带滞后）—— 光在屏幕上随意游动。
 * 2. 元素**从光心里冒出来**，一边冒一边胀大（轨道半径 `R₀ + age × GROW`）。
 * 3. 下一条出生时，上一条开始离场：淡出（`EXIT_SPACING` 之内淡完）。
 * 4. 照片按黄金角散开；章名环固定在光心正上方，字始终朝上读得清。
 *
 * ## 档位不筛图
 *
 * 档位（`TierTracker`）只管**画面密度**（星尘多少），不筛照片 ——
 * 一站的照片必须全部冒出来，这是浏览的底线。
 *
 * ## 确定性
 *
 * 没有 Math.random()：星尘用固定种子的 mulberry32。
 * 素材按 manifest 的顺序取，同一站永远以同样的顺序出场。
 */

import { drawBadge, type Badge } from './ring.ts'
import { createField } from './field.ts'
import type { Manifest, Station, Tier } from './types.ts'
import { SpeedTracker, TierTracker } from './window.ts'

// --- 元素 ---
/** 相邻两个元素之间隔多少流相位 */
const SPACING = 170
/** 照片离场要淡多久（流相位） */
const EXIT_SPACING = 300
/** 章名环离场要淡多久 —— 比照片久，标题得读得完 */
const EXIT_RING = 900
/** 元素出生时的轨道半径 */
const R0 = 26
/** 照片每单位流相位往外冲多远 */
const GROW = 0.9
/** 照片涨到这么大就不涨了（否则会胀出画幅） */
const IMG_MAX_AGE = 240
/** 章名环的初始半径 —— 从小涨大，「放大出来明显点」 */
const RING_R0 = 30
/** 章名环涨到这么大就停 */
const RING_R_MAX = 92
/**
 * 章名环最终停在光心上方多远。
 *
 * 要避开照片带 —— 照片从光心往外冲，会从环心穿过去。
 * 环停在照片上方一点，标题才不会被压住。
 */
const RING_PARK = 158
/** 图的半高占轨道半径的比例 */
const IMG_K = 0.42

// --- 流速 ---
/** 静止时的流速（相位/秒）：画面永远在动，不会冻住 */
const V_BASE = 130
/** 每 px/s 指针速度换来的额外流速 */
const V_K = 0.5

// --- 交互 ---
/** 指针横向划过多少像素算翻一站 */
const SCRUB_PX = 160

/** 黄金角：照片的角度按它散开，围着光心才铺得匀 */
const GOLDEN = 2.39996323

export interface CruiseOptions {
  /** 指针速度基准（px/s），给档位判定用 */
  speedBase?: number
  /** 强制档位（0/1/2），给自动化与截图用 */
  forceTier?: Tier | null
  /** 开局落在第几站 */
  startIndex?: number
  /** 开场提示语 */
  hint?: string
  /** 显示读数 */
  debug?: boolean
}

export interface CruiseDebug {
  /** 当前站 */
  seg: number
  /** 流相位 */
  flow: number
  tier: number
  speed: number
  /** 在场元素数 */
  count: number
  /** 光心 */
  light: [number, number]
  /** 在场元素 */
  live: { kind: string; k: number; age: number; alpha: number }[]
  /** 放大看的那张 */
  zoomed: string | null
}

export interface CruiseView {
  readonly dom: HTMLElement
  resize(w: number, h: number): void
  /** 落到第 i 站（立即，不走流） */
  focus(index: number): void
  /** 当前在第几站 */
  at(): number
  /** 前进一站 */
  forward(): void
  /** 后退一站 */
  back(): void
  frame(dt: number, time: number): void
  freeze(): void
  thaw(): void
  debug(): CruiseDebug
  dispose(): void
}

/** 队列里的一个元素 */
interface El {
  kind: 'ring' | 'img'
  /** 属于第几站 */
  k: number
  /** 图片路径（环没有） */
  src: string | null
  /** 出生的流相位 */
  born: number
  /** 角度 */
  ang: number
  /** 档位（决定图的清晰度来源） */
  tier: number
  /** 离场计时（流相位），0 = 还在场上 */
  exit: number
}

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
  const ctx: CanvasRenderingContext2D = ctx2d

  const panel = document.createElement('div')
  panel.className = 'sm2-cruise__panel sm2-panel'

  const readout = document.createElement('div')
  readout.className = 'sm2-cruise__read'

  dom.append(canvas, panel, readout)

  let hintEl: HTMLElement | null = null
  if (options.hint) {
    hintEl = document.createElement('div')
    hintEl.className = 'sm2-cruise__hint'
    hintEl.textContent = options.hint
    dom.append(hintEl)
  }

  // --- 内容 ---
  /**
   * 每站的照片，按档位从高到低排成一条。
   *
   * **不按档位筛** —— 一站的照片必须全部出场。
   * 高亮的先走，细节的后走，读者的注意力跟着走。
   */
  const pools: string[][] = stations.map((st) => {
    const byTier: string[][] = [[], [], []]
    for (const im of st.images ?? []) byTier[Math.min(2, im.tier | 0)]!.push(im.src)
    return [...byTier[0]!, ...byTier[1]!, ...byTier[2]!]
  })

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

  function preload(k: number): void {
    for (const src of pools[k] ?? []) {
      const t = tex(src)
      if (t && !t.complete) void t.decode?.().catch(() => {})
    }
  }

  // --- 状态 ---
  let W = 1
  let H = 1
  let DPR = 1

  let flow = 0 // 流相位
  let seg = 0 // 当前站
  let tier = 0
  let speed = 0

  /** 发射游标：先发这一站的章名环，再发它的照片 */
  let cursorStation = 0
  let cursorImage = -1
  /** 上一次发射时的流相位 */
  let lastEmit = -SPACING
  /** 在场元素 */
  let live: El[] = []
  /** 照片角度游标 */
  let angSeq = 0

  let px = 0
  let py = 0
  let lpx = 0
  let lpy = 0
  let pointerIn = false
  let frozen = false
  /** 横向累计位移：划过阈值就翻一站 */
  let scrubAcc = 0

  /** 光心（跟着指针走） */
  let lx = 0
  let ly = 0

  let zoomed: string | null = null
  let shownStation = -1

  const speedTrack = new SpeedTracker()
  const tierTrack = new TierTracker()
  const field = createField()

  // -------------------------------------------------------------------------
  // 发射
  // -------------------------------------------------------------------------

  /** 发下一个元素。返回 false = 队列发完了 */
  function emitNext(): boolean {
    for (;;) {
      if (cursorStation >= N) return false
      if (cursorImage === -1) {
        // 章名环：这一站的标题，从头顶偏上飞出来
        live.push({
          kind: 'ring',
          k: cursorStation,
          src: null,
          born: flow,
          ang: -Math.PI / 2 + 0.22,
          tier,
          exit: 0,
        })
        cursorImage = 0
        return true
      }
      const imgs = pools[cursorStation] ?? []
      if (cursorImage < imgs.length) {
        const src = imgs[cursorImage]!
        live.push({
          kind: 'img',
          k: cursorStation,
          src,
          born: flow,
          // 照片按黄金角散开；第一张朝右，避开正上方的章名环
          ang: 0.6 + angSeq * GOLDEN,
          tier,
          exit: 0,
        })
        angSeq++
        cursorImage++
        return true
      }
      // 这一站发完了 → 下一站
      cursorStation++
      cursorImage = -1
    }
  }

  function panelWidth(): number {
    return Math.min(260, Math.max(0, W - 56))
  }
  /** 文字面板的左边界 */
  function panelLeft(): number {
    return W - panelWidth() - 28
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
    scrubAcc += x - lpx
    px = x
    py = y
    if (hintEl) hintEl.style.opacity = '0'
  })

  canvas.addEventListener('pointerdown', (e) => {
    const { x, y } = pointerPos(e)
    if (zoomed) {
      zoomed = null
      return
    }
    // 点图 = 拿到眼前来看
    for (const el of live) {
      if (el.kind !== 'img' || !el.src) continue
      const s = place(el)
      const t = tex(el.src)
      if (!t) continue
      const h = s.r * IMG_K * 2
      const w = h * (t.naturalWidth / t.naturalHeight)
      if (Math.abs(x - s.x) <= w / 2 && Math.abs(y - s.y) <= h / 2) {
        zoomed = el.src
        return
      }
    }
  })

  canvas.addEventListener('pointerleave', () => {
    pointerIn = false
  })

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      moveTo(seg + (e.deltaY > 0 ? 1 : -1))
    },
    { passive: false },
  )

  /** 跳到第 k 站：重新从那一站的章名环开始发 */
  function moveTo(k: number): void {
    const next = Math.max(0, Math.min(N - 1, k))
    if (next === seg && cursorStation === next) return
    seg = next
    cursorStation = next
    cursorImage = -1
    // 旧的元素开始离场，不硬切
    for (const el of live) el.exit = Math.max(el.exit, flow)
    lastEmit = flow
    shownStation = -1
    zoomed = null
    preload(next)
  }

  // -------------------------------------------------------------------------
  // 放置
  // -------------------------------------------------------------------------

  interface Spot {
    x: number
    y: number
    /** 轨道半径 */
    r: number
    alpha: number
  }

  /**
   * 元素现在在哪儿。
   *
   * **全都从光心往外飞** —— 环和照片同一套逻辑，只是：
   * - 环涨得慢（小），所以它留在光心附近，标题读得清
   * - 照片涨得快（大），所以它冲到前面去
   * - 角度都按黄金角散开，谁也不压谁
   *
   * 环的轨道角会**慢慢收回到正上方**：飞出去是为了「冒出来」，
   * 但标题最终得停在能读的位置 —— 停在头顶正上方最稳。
   */
  function place(el: El): Spot {
    const age = flow - el.born
    if (el.kind === 'ring') {
      // 从光心冒出来，慢慢涨大，最后停在光心上方
      const t = Math.min(1, age / 140)
      const ease = t * t * (3 - 2 * t)
      const r = RING_R0 + (RING_R_MAX - RING_R0) * ease
      // 轨道角从出场的角度收回到正上方
      const ang = el.ang + (-Math.PI / 2 - el.ang) * ease
      const dist = RING_PARK * ease
      return {
        x: lx + Math.cos(ang) * dist,
        y: ly + Math.sin(ang) * dist,
        r,
        alpha: 1,
      }
    }
    const rr = R0 + Math.min(age, IMG_MAX_AGE) * GROW
    return {
      x: lx + Math.cos(el.ang) * rr,
      y: ly + Math.sin(el.ang) * rr,
      r: rr,
      alpha: 1,
    }
  }

  // -------------------------------------------------------------------------
  // 画
  // -------------------------------------------------------------------------

  /** 一个图元素 */
  function drawImage(el: El, alpha: number): void {
    if (!el.src) return
    const t = tex(el.src)
    if (!t) return
    const s = place(el)
    const ar = t.naturalWidth / t.naturalHeight
    const h = s.r * IMG_K * 2
    const w = h * ar
    // 飘到文字面板下面的图要淡出 —— 文字不能被照片压住
    const into = s.x + w / 2 - (panelLeft() - 24)
    const clip = into > 0 ? Math.max(0, 1 - into / (w * 0.5 + 40)) : 1
    if (clip <= 0.02) return
    ctx.save()
    ctx.globalAlpha = alpha * clip
    ctx.drawImage(t, s.x - w / 2, s.y - h / 2, w, h)
    ctx.globalAlpha = alpha * clip * 0.5
    ctx.strokeStyle = 'rgba(150,214,255,.8)'
    ctx.lineWidth = 1
    ctx.strokeRect(s.x - w / 2 + 0.5, s.y - h / 2 + 0.5, w - 1, h - 1)
    ctx.restore()
  }

  /** 一个章名环 —— 和照片同一套逻辑，只是大一点、带字 */
  function drawRingElement(el: El, alpha: number): void {
    const st = stations[el.k]
    if (!st) return
    const s = place(el)
    const badge: Badge = {
      cx: s.x,
      cy: s.y,
      r: s.r,
      alpha,
      title: st.title,
      meta: `${String(el.k + 1).padStart(2, '0')} · ${st.date ?? ''} · ${st.place ?? ''}`,
      // 字号跟着环走，但封顶 —— 字跟着环无限涨会糊成一团
      titleSize: Math.max(13, Math.min(22, s.r * 0.13)),
      metaSize: Math.max(9, Math.min(15, s.r * 0.08)),
      titleSpan: Math.PI * 0.72,
      // 环心要给照片飞过 —— 时间地点摆环外下弧，别被压住
      metaOn: 'outer',
    }
    drawBadge(ctx, badge)
  }

  function drawZoom(): void {
    if (!zoomed) return
    const t = tex(zoomed)
    ctx.save()
    ctx.fillStyle = 'rgba(3,8,16,.9)'
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

  // -------------------------------------------------------------------------
  // 面板
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
  }

  // -------------------------------------------------------------------------
  // 帧
  // -------------------------------------------------------------------------

  function tick(dtRaw: number): void {
    const dt = frozen ? 0 : Math.min(0.05, dtRaw)

    const moved = Math.hypot(px - lpx, py - lpy)
    lpx = px
    lpy = py
    speed = speedTrack.push(moved / Math.max(1e-3, dtRaw), dt)
    tier = forcedTier !== null ? forcedTier : tierTrack.push(speed / speedBase, dt)

    // 流速：指针越快，流得越快
    const vz = V_BASE + speed * V_K
    flow += vz * dt

    // 发射：每 SPACING 个相位发一个元素
    while (flow - lastEmit >= SPACING) {
      lastEmit += SPACING
      if (!emitNext()) break
      const k = live[live.length - 1]!.k
      if (k !== seg) {
        seg = k
        shownStation = -1
      }
      preload(Math.min(N - 1, k + 1))
    }

    // 横向划过阈值 → 翻一站
    if (Math.abs(scrubAcc) > SCRUB_PX) {
      const dir = scrubAcc > 0 ? 1 : -1
      scrubAcc = 0
      moveTo(seg + dir)
    }

    // 光心跟着指针走
    const lag = 1 - Math.exp(-dt / 0.09)
    lx += (px - lx) * lag
    ly += (py - ly) * lag

    // 离场：下一条出生了，上一条开始淡
    for (let i = 0; i < live.length; i++) {
      const el = live[i]!
      const next = live[i + 1]
      if (next && el.exit === 0) el.exit = next.born
    }
    live = live.filter((el) => {
      if (el.exit === 0) return true
      const t = (flow - el.exit) / exitSpan(el)
      return t < 1
    })

    // --- 画 ---
    ctx.fillStyle = '#04070e'
    ctx.fillRect(0, 0, W, H)
    field.draw(ctx, W, H, lx, ly, dt, tier)

    // 元素：图先画，环后画（章名压在最上面）
    for (const el of live) {
      if (el.kind !== 'img') continue
      drawImage(el, alphaOf(el))
    }
    for (const el of live) {
      if (el.kind !== 'ring') continue
      drawRingElement(el, alphaOf(el))
    }

    drawZoom()
    drawCursor()
    updatePanel()

    if (options.debug) {
      readout.textContent =
        `第 ${String(seg + 1).padStart(2, '0')} 段 · 相位 ${flow.toFixed(0)} · 档 ${tier}\n` +
        `速度 ${speed.toFixed(0)}px/s · 在场 ${live.length} 个 · 光心 ${lx.toFixed(0)},${ly.toFixed(0)}\n` +
        live
          .map((el) => {
            const s = place(el)
            return `${el.kind === 'ring' ? '环' : '图'} #${el.k + 1} age${(flow - el.born).toFixed(0)} a${alphaOf(el).toFixed(2)} r${s.r.toFixed(0)}`
          })
          .join('\n')
    }
  }

  /** 元素的透明度：出生时 1，被下一条顶走后淡出 */
  function alphaOf(el: El): number {
    if (el.exit === 0) return 1
    const t = Math.min(1, Math.max(0, (flow - el.exit) / exitSpan(el)))
    return 1 - t * t * (3 - 2 * t)
  }

  /** 离场要淡多久 —— 环淡得慢，标题得读得完 */
  function exitSpan(el: El): number {
    return el.kind === 'ring' ? EXIT_RING : EXIT_SPACING
  }

  // -------------------------------------------------------------------------
  // 起手
  // -------------------------------------------------------------------------

  seg = Math.max(0, Math.min(N - 1, options.startIndex ?? 0))
  cursorStation = seg
  cursorImage = -1
  lx = W * 0.5
  ly = H * 0.5
  px = lpx = lx
  py = lpy = ly
  preload(seg)

  return {
    dom,
    at: () => seg,
    forward() {
      moveTo(seg + 1)
    },
    back() {
      moveTo(seg - 1)
    },
    focus(index) {
      const next = Math.max(0, Math.min(N - 1, index))
      seg = next
      cursorStation = next
      cursorImage = -1
      live = []
      flow = 0
      lastEmit = -SPACING
      angSeq = 0
      shownStation = -1
      zoomed = null
      scrubAcc = 0
      preload(next)
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
      lx = W * 0.42
      ly = H * 0.5
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
        seg,
        flow,
        tier,
        speed,
        count: live.length,
        light: [lx, ly],
        live: live.map((el) => ({
          kind: el.kind,
          k: el.k,
          age: flow - el.born,
          alpha: alphaOf(el),
        })),
        zoomed,
      }
    },
    dispose() {
      dom.remove()
      texCache.clear()
    },
  }
}

export type { Station }
