/**
 * 二级 · 光隧 —— 一条不断往外淌的流。
 *
 * ## 一句话
 *
 * 鼠标所在的地方是源头。照片从那儿一张张冒出来，越飞越远；
 * 背景是一圈圈涨开的光环 —— 光环和照片走的是**同一条流**。
 *
 * ```
 *        ◎ 光圈（带站名）
 *      ◎    ◎      ◎     ← 照片从鼠标位置散开
 *   ◎             ◎
 * ```
 *
 * ## 发牌靠指针
 *
 * 指针每划过 `SPAWN_PX` 像素就发一张；指针不动，也有保底的定时器在发。
 * 所以画面永远不会停 ——「一直有照片飞出来」是这儿的默认状态，
 * 不是「鼠标动了才有」。
 *
 * 同屏数量**没有上限**：它由「存活时长 ÷ 发射间隔」自然决定。
 * 飞得慢、活得久，屏上就堆得多。
 *
 * ## 档位是「跳过」
 *
 * 慢 = 全放（高亮 + 概览 + 细节），快 = 只放高亮。
 * 快速操作时把细节跳过，慢下来才一张张看得清。
 *
 * ## 节奏：慢
 *
 * 全部按秒控制，不按「流相位」：
 * 胀大 0.9 秒、离场 3.6 秒、环离场 2.6 秒。
 * 慢到能看清一张照片，再看它化掉。
 *
 * ## 章名环
 *
 * 每一站先飞出一枚环：**外弧是站名，内弧是时间地点**。
 * 这一站的照片全部飞完，环才开始淡出；下一站的环不等它淡完。
 *
 * ## 确定性
 *
 * 没有 Math.random()：星尘用固定种子的 mulberry32。
 * 素材按 manifest 的顺序取，同一站永远以同样的顺序出场。
 */

import { drawBadge, type Badge } from './ring.ts'
import { createField, HALO_R0 } from './field.ts'
import { orderedImages, type ImageRef, type Manifest, type Station, type Tier } from './types.ts'
import { SpeedTracker, TierTracker } from './window.ts'

// --- 流 ---
/**
 * 指针静止时的流速（px/s）。
 *
 * 这不只是「飞多快」—— 它同时决定照片铺开的范围：
 * 铺开的半径 ≈ 发射频率 × 存活时长 × 流速。
 * 太小就挤成一团，太大就只剩空屏。
 */
const V_BASE = 46
/** 每 px/s 指针速度换来的额外流速 */
const V_K = 0.12
/** 元素出生时的半径（px）—— 和第一圈光环同一个半径 */
const R0 = HALO_R0

// --- 发牌 ---
/** 指针走多少像素算发一张 */
const SPAWN_PX = 80
/** 保底：不管指针动不动，每隔这么久也发一张 */
const SPAWN_GAP = 0.26
/** 一帧最多补几张 —— 指针瞬移时不该炸出几百张 */
const MAX_EMIT = 4

// --- 生长与离场（秒） ---
/** 从 16% 胀到 100% 要多久 */
const GROW_T = 0.9
/** 照片离场要淡多久 —— 慢下来才看得清，也铺得开 */
const EXIT_T = 5
/** 章名环离场要淡多久 */
const EXIT_HOP = 1.8
/** 章名环上的字最多化多久 —— 化完了就只剩圈 */
const TEXT_EXIT = 1.2
/** 照片最终多大（高，px） */
const IMG_H = 150

// --- 章名环 ---
/** 环的初始半径 —— 从这么大体量出场，字才读得清 */
const HOP_R0 = 96
/** 环比照片慢多少 —— 慢一点，照片才追得上、穿得过去 */
const HOP_K = 0.55
/** 环上站名的字号 */
const HOP_TITLE = 12.5
/** 环上时间地点的字号 */
const HOP_META = 10

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
  /** 流走过的距离（px） */
  flow: number
  tier: number
  speed: number
  /** 在场元素数 */
  count: number
  /** 光心 */
  light: [number, number]
  /** 在场元素 */
  live: { kind: string; k: number; age: number; alpha: number; x: number; y: number; r: number }[]
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

/** 流里的一个东西：章名环或一张照片 */
interface El {
  kind: 'hop' | 'img'
  /** 属于第几站 */
  k: number
  /** 图片路径（环没有） */
  src: string | null
  /** 出生的时刻（秒） */
  bornT: number
  /** 出生的流位置（px） */
  bornF: number
  /** 角度（照片用） */
  ang: number
  /** 离场的时刻（秒），null = 还在场上 */
  exitT: number | null
  /** 离场要淡多久（秒） */
  exitDur: number
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
  /** 每站的照片，按 tier 从低到高排好（高亮在前） */
  const pools: ImageRef[][] = stations.map((st) => orderedImages(st))

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
    for (const img of pools[k] ?? []) {
      const t = tex(img.src)
      if (t && !t.complete) void t.decode?.().catch(() => {})
    }
  }

  // --- 状态 ---
  let W = 1
  let H = 1
  let DPR = 1

  let clock = 0 // 场景时间（秒）
  let flow = 0 // 流走过的距离（px）
  let seg = 0 // 当前站
  let tier = 0
  let speed = 0

  /** 正在发的站 */
  let cursorStation = 0
  /** 这一站已经发了几张图 */
  let cursorImage = 0
  /** 这一站的环还没发 */
  let ringPending = true
  /** 在场元素 */
  let live: El[] = []
  /** 照片的角度游标 */
  let angSeq = 0

  /** 指针位移累积：走够 SPAWN_PX 就发一张 */
  let spawnAcc = 0
  /** 定时器累积：保证指针不动也有东西飞出来 */
  let gapAcc = 0

  let px = 0
  let py = 0
  let lpx = 0
  let lpy = 0
  let pointerIn = false
  let frozen = false

  /** 光心（跟着指针走） */
  let lx = 0
  let ly = 0

  let zoomed: string | null = null
  let shownStation = -1

  const speedTrack = new SpeedTracker()
  const tierTrack = new TierTracker()
  const field = createField()

  // -------------------------------------------------------------------------
  // 放行到第几层
  // -------------------------------------------------------------------------

  /**
   * 当前放行到第几层。
   *
   * **慢 = 全放，快 = 只放高亮** —— 和「档位是发射池的来源层」正好相反：
   * 快速操作时跳过细节，慢下来才一张张看清。
   */
  function release(): Tier {
    return (2 - tier) as Tier
  }

  /** 这一站在当前档位下放行的图 */
  function allowed(k: number): ImageRef[] {
    const max = release()
    return (pools[k] ?? []).filter((im) => im.tier <= max)
  }

  // -------------------------------------------------------------------------
  // 离场
  // -------------------------------------------------------------------------

  /**
   * 让一个元素开始离场。
   *
   * **文字化开的时间跟这一站待了多久走**：
   * 慢慢读的时候，站名要「慢慢模糊」；快速跳过的时候，站名就得赶紧走 ——
   * 否则十几个站名会同时挂在屏幕上，叠成一堆字。
   */
  function startExit(el: El): void {
    if (el.exitT !== null) return
    el.exitT = clock
    if (el.kind === 'hop') {
      const lived = clock - el.bornT
      el.exitDur = Math.max(0.35, Math.min(TEXT_EXIT, lived * 0.5))
    }
  }

  // -------------------------------------------------------------------------
  // 发射
  // -------------------------------------------------------------------------

  /**
   * 发下一个东西。
   *
   * 一站的东西按顺序发：**章名环 → 这一站的全部照片**。
   * 环发出去的时候，上一站的环开始离场；
   * 照片发出去的时候，上一张照片开始离场。
   *
   * 走完最后一站就从头再来 —— 光隧是一条不断的流，停下来画面就空了。
   */
  function emit(): void {
    for (;;) {
      if (cursorStation >= N) {
        cursorStation = 0
        cursorImage = 0
        ringPending = true
      }
      if (ringPending) {
        ringPending = false
        // 上一站的环开始离场 —— 下一站不等它淡完
        for (const el of live) {
          if (el.kind === 'hop') startExit(el)
        }
        live.push({
          kind: 'hop',
          k: cursorStation,
          src: null,
          bornT: clock,
          bornF: flow,
          ang: 0,
          exitT: null,
          exitDur: EXIT_HOP,
        })
        seg = cursorStation
        shownStation = -1
        preload(Math.min(N - 1, cursorStation + 1))
        return
      }
      const pool = allowed(cursorStation)
      if (cursorImage < pool.length) {
        const img = pool[cursorImage]!
        // 新的照片把在场的照片顶走（开始离场）
        for (const el of live) {
          if (el.kind === 'img') startExit(el)
        }
        live.push({
          kind: 'img',
          k: cursorStation,
          src: img.src,
          bornT: clock,
          bornF: flow,
          ang: angSeq * GOLDEN,
          exitT: null,
          exitDur: EXIT_T,
        })
        angSeq++
        cursorImage++
        return
      }
      // 这一站在当前档位下发完了 → 下一站
      cursorStation++
      cursorImage = 0
      ringPending = true
    }
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
      const s = placeImg(el)
      const t = tex(el.src)
      if (!t) continue
      const w = s.h * (t.naturalWidth / t.naturalHeight)
      if (Math.abs(x - s.x) <= w / 2 && Math.abs(y - s.y) <= s.h / 2) {
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
    seg = next
    cursorStation = next
    cursorImage = 0
    ringPending = true
    // 旧的元素开始离场，不硬切
    for (const el of live) startExit(el)
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
    /** 高（照片用） */
    h: number
  }

  /**
   * 照片现在在哪儿。
   *
   * 半径 `R0 + (flow - 出生的流位置)` —— 和光环是同一条流，
   * 所以照片永远从光环里长出来。
   */
  function placeImg(el: El): Spot {
    const r = R0 + Math.max(0, flow - el.bornF)
    const grow = 0.16 + 0.84 * smooth((clock - el.bornT) / GROW_T)
    // 越飞越远就略微大一点 —— 一点透视，不多
    const depth = 0.7 + 0.45 * Math.min(1, r / 420)
    return {
      x: lx + Math.cos(el.ang) * r,
      y: ly + Math.sin(el.ang) * r,
      r,
      h: IMG_H * grow * depth,
    }
  }

  /** 章名环现在在哪儿 —— 它套在光心上，照片从它里面穿出去 */
  function placeHop(el: El): Spot {
    const r = HOP_R0 + Math.max(0, flow - el.bornF) * HOP_K
    return { x: lx, y: ly, r, h: 0 }
  }

  // -------------------------------------------------------------------------
  // 画
  // -------------------------------------------------------------------------

  /** 一张照片 */
  function drawImage(el: El, alpha: number): void {
    if (!el.src) return
    const t = tex(el.src)
    if (!t) return
    const s = placeImg(el)
    const ar = t.naturalWidth / t.naturalHeight
    const h = s.h
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

  /** 一枚章名环 —— 外弧站名，内弧时间地点 */
  function drawHop(el: El, alpha: number): void {
    const st = stations[el.k]
    if (!st) return
    const s = placeHop(el)
    const badge: Badge = {
      cx: s.x,
      cy: s.y,
      r: s.r,
      alpha,
      title: st.title,
      meta: whenOf(st),
      titleSize: HOP_TITLE,
      metaSize: HOP_META,
      // 外弧留得宽 —— 站名往往很长；内弧留给时间地点
      titleSpan: Math.PI * 1.05,
      metaSpan: Math.PI * 0.8,
      metaOn: 'inner',
      // 旧环的字先化掉 —— 同时只有一枚环带字，名字才不会叠成一堆
      textAlpha: textAlphaOf(el),
      // 离场时字慢慢「化」掉
      blur: blurOf(el),
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

  function panelWidth(): number {
    return Math.min(260, Math.max(0, W - 56))
  }
  /** 文字面板的左边界 */
  function panelLeft(): number {
    return W - panelWidth() - 28
  }

  function updatePanel(): void {
    if (shownStation === seg) return
    shownStation = seg
    const st = stations[seg]
    if (!st) return
    panel.replaceChildren()
    // 第一行是时间地点，下面是站名 —— 就这两行
    const when = document.createElement('span')
    when.className = 'sm2-cruise__when'
    when.textContent = whenOf(st)
    panel.append(when)
    const title = document.createElement('span')
    title.className = 'sm2-cruise__title'
    title.textContent = st.title
    panel.append(title)
  }

  // -------------------------------------------------------------------------
  // 帧
  // -------------------------------------------------------------------------

  function tick(dtRaw: number): void {
    const dt = frozen ? 0 : Math.min(0.05, dtRaw)
    clock += dt

    const moved = Math.hypot(px - lpx, py - lpy)
    lpx = px
    lpy = py
    speed = speedTrack.push(moved / Math.max(1e-3, dtRaw), dt)
    tier = forcedTier !== null ? forcedTier : tierTrack.push(speed / speedBase, dt)

    // 流速：指针越快，流得越快 —— 快就是「掠过」
    const v = V_BASE + speed * V_K
    flow += v * dt

    // 光心跟着指针走（带滞后，甩起来有惯性）
    const lag = 1 - Math.exp(-dt / 0.09)
    lx += (px - lx) * lag
    ly += (py - ly) * lag

    // --- 发牌 ---
    spawnAcc += moved
    gapAcc += dt
    let budget = MAX_EMIT
    while (budget > 0) {
      if (spawnAcc >= SPAWN_PX) spawnAcc -= SPAWN_PX
      else if (gapAcc >= SPAWN_GAP) gapAcc -= SPAWN_GAP
      else break
      budget--
      emit()
    }

    // --- 离场 ---
    live = live.filter((el) => {
      if (el.exitT === null) return true
      return clock - el.exitT < exitSpan(el)
    })

    // --- 画 ---
    ctx.fillStyle = '#04070e'
    ctx.fillRect(0, 0, W, H)
    field.draw(ctx, W, H, lx, ly, dt, tier, flow)

    // 照片先画，环后画（章名压在最上面）
    for (const el of live) {
      if (el.kind !== 'img') continue
      drawImage(el, alphaOf(el))
    }
    for (const el of live) {
      if (el.kind !== 'hop') continue
      drawHop(el, alphaOf(el))
    }

    drawZoom()
    drawCursor()
    updatePanel()

    if (options.debug) {
      readout.textContent =
        `第 ${String(seg + 1).padStart(2, '0')} 站 · 流 ${flow.toFixed(0)}px · 档 ${tier}\n` +
        `速度 ${speed.toFixed(0)}px/s · 在场 ${live.length} 个 · 光心 ${lx.toFixed(0)},${ly.toFixed(0)}\n` +
        live
          .map((el) => {
            const s = el.kind === 'hop' ? placeHop(el) : placeImg(el)
            return `${el.kind === 'hop' ? '环' : '图'} #${el.k + 1} age${(clock - el.bornT).toFixed(1)} a${alphaOf(el).toFixed(2)} r${s.r.toFixed(0)}`
          })
          .join('\n')
    }
  }

  /** 元素的透明度 */
  function alphaOf(el: El): number {
    // 出生时淡入
    let a = Math.min(1, (clock - el.bornT) / (el.kind === 'hop' ? 0.5 : 0.18))
    if (el.exitT !== null) {
      const t = Math.min(1, Math.max(0, (clock - el.exitT) / exitSpan(el)))
      a *= 1 - smooth(t)
    }
    return a
  }

  /** 离场要淡多久 */
  function exitSpan(el: El): number {
    return el.kind === 'hop' ? EXIT_HOP : EXIT_T
  }

  /**
   * 文字单独的透明度。
   *
   * **同时只有一枚环带字** —— 旧章名环只剩圈，名字交给当前站那一枚。
   * 快速操作时一口气跳过十几站，否则十几个站名会叠成一堆字。
   */
  function textAlphaOf(el: El): number {
    const a = alphaOf(el)
    if (el.exitT === null) return a
    // 离场中：字在 exitDur 秒里慢慢化掉，圈继续淡
    return a * (1 - smooth((clock - el.exitT) / el.exitDur))
  }

  /** 文字的模糊量：离场时慢慢化掉 */
  function blurOf(el: El): number {
    if (el.exitT === null) return 0
    const t = Math.min(1, Math.max(0, (clock - el.exitT) / el.exitDur))
    return 3.2 * smooth(t)
  }

  // -------------------------------------------------------------------------
  // 起手
  // -------------------------------------------------------------------------

  seg = Math.max(0, Math.min(N - 1, options.startIndex ?? 0))
  cursorStation = seg
  cursorImage = 0
  ringPending = true
  lx = W * 0.42
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
      cursorImage = 0
      ringPending = true
      live = []
      shownStation = -1
      zoomed = null
      spawnAcc = 0
      gapAcc = 0
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
        live: live.map((el) => {
          const s = el.kind === 'hop' ? placeHop(el) : placeImg(el)
          return {
            kind: el.kind,
            k: el.k,
            age: clock - el.bornT,
            alpha: alphaOf(el),
            x: Math.round(s.x),
            y: Math.round(s.y),
            r: Math.round(s.r),
          }
        }),
        zoomed,
      }
    },
    dispose() {
      dom.remove()
      texCache.clear()
    },
  }
}

// ---------------------------------------------------------------------------

/** 时间地点 —— 面板和环上用的是同一句 */
function whenOf(st: Station): string {
  const d = st.date ? st.date.replace(/-/g, '.') : ''
  const p = st.short || st.place || ''
  return [d, p].filter(Boolean).join(' · ')
}

/** 五次平滑：两头慢中间快 */
function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * x * x * (x * (x * 6 - 15) + 10)
}

export type { Station }
