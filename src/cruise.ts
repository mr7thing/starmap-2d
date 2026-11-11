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
 * ## 发牌靠指针，跟着档位
 *
 * 指针每划过 `SPAWN_PX` 像素就发一张；指针不动，也有保底的定时器在发。
 * **两者的间隔都跟着档位走** —— 指针越快，档位越高，出图越密。
 *
 * 指针停住 = 档 0 = 最慢的一档：不会停在这儿还在哗哗出图。
 * 快速扫过 = 档 2：这才哗哗出。
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
 * 胀大 0.9 秒、照片离场 5 秒、环离场 8 秒。
 * 慢到能看清一张照片，再看它化掉。
 *
 * ## 章名环
 *
 * 每一站先飞出一枚环：**外弧是站名，内弧是时间地点**。
 *
 * 环涨的节奏和照片**完全一样**（同一条流），所以照片始终在环里面飞。
 * 环一路涨到**满屏** —— 涨到把整块屏幕都套进去为止 —— 然后停在那儿，
 * 把站名亮到这一站结束，再**换个颜色淡掉**。
 *
 * 环刚出来的时候**在最上层闪一下** —— 一路走过去，得让人注意到又到了一站。
 *
 * ## 离场只做「变色 + 变淡」
 *
 * **不做虚化**。`ctx.filter` 的 blur 每一帧都要重采样整块画布，
 * 屏上环一多就卡成幻灯片。换色只是算几个数字，不花钱。
 *
 * ## 确定性
 *
 * 没有 Math.random()：星尘用固定种子的 mulberry32。
 * 素材按 manifest 的顺序取，同一站永远以同样的顺序出场。
 */

import { badgeType, drawBadge, mixInk, RING_INK, RING_INK_COOL, TITLE_OUT_K, type Badge } from './ring.ts'
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
/** 慢档的位移阈值（px）与保底间隔（秒）—— 数组下标越界时的兜底 */
const SPAWN_PX_SLOW = 220
const SPAWN_GAP_SLOW = 0.8
/**
 * 指针走多少像素发一张，按档位。
 *
 * 慢档要划很远才发一张 —— 指针慢，屏幕也跟着慢。
 */
const SPAWN_PX = [SPAWN_PX_SLOW, 120, 60]
/**
 * 保底发牌间隔（秒），按档位。
 *
 * 指针不动时按这个节奏发：慢档一张要等 0.8 秒，不是停在这儿还在出图。
 */
const SPAWN_GAP = [SPAWN_GAP_SLOW, 0.42, 0.2]
/** 一帧最多补几张 —— 指针瞬移时不该炸出几百张 */
const MAX_EMIT = 4

// --- 生长与离场（秒） ---
/** 从 16% 胀到 100% 要多久 */
const GROW_T = 0.9
/** 照片离场要淡多久 —— 慢下来才看得清，也铺得开 */
const EXIT_T = 5
/** 慢档的环化时长（秒）—— 也是下标越界时的兜底 */
const EXIT_HOP_SLOW = 8
/**
 * 章名环化掉要多久（秒），按档位。
 *
 * 慢 = 8 秒：环涨到满屏才停，停了再慢慢化 —— 「开到最大」那一刻才看得清。
 * 快 = 1.5 秒：一口气跳过十几站，环要是也化那么慢，
 * 屏幕上就叠着十几枚还没化完的同心圆。
 */
const EXIT_HOP = [EXIT_HOP_SLOW, 4, 1.5]
/** 章名环上的字最多化多久 —— 化完了就只剩圈 */
const TEXT_EXIT = 1.2
/**
 * 站与站之间空多久（秒）。
 *
 * 一站的照片飞完了，先空一拍，再出下一站的环，然后才是下一站的图。
 * 按档位缩：慢慢读的时候留足一拍，快速跳过时就短一点（不然跳过也不快）。
 */
const STATION_GAP = [1, 0.6, 0.3]
/** 照片最终多大（高，px） */
const IMG_H = 225

// --- 章名环 ---
/** 环的初始半径 —— 从这么大体量出场，字才读得清 */
const HOP_R0 = 96
/**
 * 环比照片慢多少。
 *
 * **1 = 跟照片一样快** —— 环从光心往外涨，涨的节奏和照片完全一致，
 * 照片始终在环里面飞。
 */
const HOP_K = 1
/**
 * 环出场时那一下光的时长（秒）。
 *
 * **每站的信息环出来都闪一下** —— 不闪的话，环从光心悄悄涨开，
 * 一路走过去没人注意到又到了一站。
 */
const FLASH_T = 1.3

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
  /** 字什么时候开始化掉（秒），null = 字还在 */
  textEndT: number | null
  /** 字化开要多久（秒） */
  textDur: number
  /** 环涨到这么大就停（满屏），照片用不上 */
  maxR: number
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
  /** 下一站最早什么时候能发（站与站之间要空一拍） */
  let waitUntil = 0
  /** 上一次发牌的时刻 */
  let lastEmitT = 0
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
   * 照片：被下一张顶走就走。
   * 环：**下一站的环来了才走** —— 它会一路涨到满屏停在那儿，
   * 把站名亮到这一站结束，再慢慢化掉。
   */
  function startExit(el: El): void {
    if (el.exitT !== null) return
    el.exitT = clock
    el.exitDur = el.kind === 'hop' ? (EXIT_HOP[tier] ?? EXIT_HOP_SLOW) : EXIT_T
  }

  /**
   * 把名字交出去。
   *
   * 下一站的环一出生，上一站的字就开始化 —— 但**圈留着**，
   * 它继续涨，涨到满屏才停、才慢慢化掉。
   *
   * 化开的时间跟这一站待了多久走：慢慢读的时候名字慢慢糊，
   * 快速跳过的时候名字赶紧走，不然十几个站名会同时挂在屏幕上。
   */
  function handOverText(el: El): void {
    if (el.textEndT !== null) return
    const lived = clock - el.bornT
    el.textEndT = clock
    el.textDur = Math.max(0.35, Math.min(TEXT_EXIT, lived * 0.5))
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
    // 站与站之间空一拍 —— 上一站的图飞完了，先静一下
    if (clock < waitUntil) return
    for (;;) {
      if (cursorStation >= N) {
        cursorStation = 0
        cursorImage = 0
        ringPending = true
      }
      if (ringPending) {
        ringPending = false
        // 上一站的环把名字交出去 —— 字化掉，圈也开始退场
        for (const el of live) {
          if (el.kind === 'hop') {
            handOverText(el)
            startExit(el)
          }
        }
        live.push({
          kind: 'hop',
          k: cursorStation,
          src: null,
          bornT: clock,
          bornF: flow,
          ang: 0,
          exitT: null,
          exitDur: EXIT_HOP[tier] ?? EXIT_HOP_SLOW,
          textEndT: null,
          textDur: 0,
          maxR: hopMaxR(),
        })
        seg = cursorStation
        shownStation = -1
        lastEmitT = clock
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
          textEndT: null,
          textDur: 0,
          maxR: 0,
        })
        angSeq++
        cursorImage++
        lastEmitT = clock
        return
      }
      // 这一站在当前档位下发完了 → 空一拍，下一站的环再出来
      cursorStation++
      cursorImage = 0
      ringPending = true
      // 这一拍从**最后一张照片**算起，不是从「发现发完了」算起
      waitUntil = lastEmitT + (STATION_GAP[tier] ?? 1)
      return
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

  /**
   * 环涨到多大算「满屏」。
   *
   * 环开到最大时，**连站名一起顶到屏幕边** ——
   * 站名挂在环外 `TITLE_OUT_K` 倍处，所以环涨到那个位置就停。
   *
   * 环真占满屏幕的话，站名就没地方站了（环外 = 屏幕外），
   * 所以「满屏」按「环 + 站名」这一整块算。
   */
  function hopMaxR(): number {
    return Math.min(W, H) / 2 / TITLE_OUT_K
  }

  /**
   * 章名环现在在哪儿 —— 它套在光心上，照片从它里面穿出去。
   *
   * 半径跟照片走**同一条流**（`HOP_K = 1`），涨到满屏就停住。
   */
  function placeHop(el: El): Spot {
    const raw = HOP_R0 + Math.max(0, flow - el.bornF) * HOP_K
    const r = Math.min(el.maxR, raw)
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
    // 整张在屏幕外的就别画了 —— 快档下一半元素都飞到几千像素外
    if (s.x + w / 2 < 0 || s.x - w / 2 > W || s.y + h / 2 < 0 || s.y - h / 2 > H) return
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
    // 环上两行字跟一级场景共用一套式样：时间地点大、名称小
    const type = badgeType(s.r)
    const badge: Badge = {
      cx: s.x,
      cy: s.y,
      r: s.r,
      alpha,
      title: st.title,
      meta: whenOf(st),
      titleSize: type.title,
      metaSize: type.meta,
      // 外弧留得宽 —— 站名往往很长
      titleSpan: Math.PI * 1.05,
      metaSpan: Math.PI * 0.8,
      // 时间地点在环上，站名就在同一段环线的下面
      metaOn: 'inner',
      titleOn: 'bottom',
      // 环和字都加粗 —— 跟背景那些装饰环分得开
      bold: true,
      // 旧环的字先化掉 —— 同时只有一枚环带字，名字才不会叠成一堆
      textAlpha: textAlphaOf(el),
      // 离场时字慢慢「化」掉
      haze: hazeOf(el),
      // 离场时换色：冰蓝褪成靛青
      ink: mixInk(RING_INK, RING_INK_COOL, coolOf(el)),
    }
    // 离场：涨到满屏就停住，**不缩小** —— 换个颜色淡掉，像一层光凉在空气里
    drawBadge(ctx, badge)
  }

  /**
   * 环出场时那一下闪光的强度（0～1）。
   *
   * 起手一下就亮到顶，然后散掉 —— 是「闪」，不是「亮着」。
   */
  function flashOf(el: El): number {
    if (el.kind !== 'hop') return 0
    const age = clock - el.bornT
    if (age < 0 || age > FLASH_T) return 0
    const t = age / FLASH_T
    // 起手一下就亮到顶（0.22 秒），然后慢慢散
    const rise = smooth(Math.min(1, age / 0.22))
    return (1 - t) * (1 - t) * (0.35 + 0.65 * rise)
  }

  /**
   * 环出场的那一下：辉光 + 往外推的一圈。
   *
   * 画在**最上层** —— 这一下就是给人看的，压在照片上面才抓得住眼睛。
   */
  function drawHopFlash(el: El): void {
    const f = flashOf(el)
    if (f <= 0.01) return
    const s = placeHop(el)
    ctx.save()
    // 辉光：粗的一层光晕
    ctx.globalAlpha = f * 0.75
    ctx.strokeStyle = 'rgba(120,205,255,.6)'
    ctx.lineWidth = 9
    ctx.shadowBlur = 30
    ctx.shadowColor = 'rgba(130,215,255,.95)'
    ctx.beginPath()
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
    ctx.stroke()
    // 亮芯 —— 环刚出来那一刻，它就是这一道白光
    ctx.globalAlpha = f
    ctx.strokeStyle = 'rgba(235,251,255,.98)'
    ctx.lineWidth = 1.8
    ctx.shadowBlur = 10
    ctx.beginPath()
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
    ctx.stroke()
    // 往外推出去的一圈
    ctx.globalAlpha = f * 0.5
    ctx.lineWidth = 1.4
    ctx.shadowBlur = 14
    ctx.strokeStyle = 'rgba(190,235,255,.9)'
    ctx.beginPath()
    ctx.arc(s.x, s.y, s.r + (1 - f) * 60, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  /**
   * 离场时墨色往「冷」那边走多少（0～1）。
   *
   * 环涨到满屏就停住 —— **不再缩小**，只是**变色 + 变淡**：
   * 冰蓝褪成靛青，再淡没。
   *
   * **不做虚化**：`ctx.filter` 每一帧都要把整块画布重采样，
   * 屏上环一多就卡成幻灯片。换色只是算几个数字，白给的。
   *
   * **变色比淡出快** —— 颜色得先冷下来，才看得见它冷下来了；
   * 跟淡出同步的话，环只是「暗掉」，看不出换过色。
   */
  function coolOf(el: El): number {
    if (el.kind !== 'hop') return 0
    if (el.exitT === null) return 0
    const t = Math.min(1, Math.max(0, (clock - el.exitT) / exitSpan(el)))
    return smooth(Math.min(1, t * 2))
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
    // 间隔跟着档位走：指针停住 = 最慢的一档
    const spawnPx = SPAWN_PX[tier] ?? SPAWN_PX_SLOW
    const spawnGap = SPAWN_GAP[tier] ?? SPAWN_GAP_SLOW
    spawnAcc += moved
    gapAcc += dt
    let budget = MAX_EMIT
    while (budget > 0) {
      if (spawnAcc >= spawnPx) spawnAcc -= spawnPx
      else if (gapAcc >= spawnGap) gapAcc -= spawnGap
      else break
      budget--
      emit()
    }

    // --- 离场 ---
    // 环涨到满屏就停在那儿（到了最大点），化开要等这一站结束
    for (const el of live) {
      if (el.kind !== 'hop') continue
      // 窗口变了，「满屏」的半径也跟着变 —— 只涨不缩，环才不会忽然缩回去
      if (hopMaxR() > el.maxR) el.maxR = hopMaxR()
    }
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
    // 环出场的那一下 —— 压在最上层
    for (const el of live) {
      if (el.kind !== 'hop') continue
      drawHopFlash(el)
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
    return el.exitDur
  }

  /**
   * 文字单独的透明度。
   *
   * **同时只有一枚环带字** —— 旧章名环把名字交出去，只剩圈，
   * 圈继续涨到满屏。名字交给当前站那一枚。
   */
  function textAlphaOf(el: El): number {
    const a = alphaOf(el)
    if (el.kind === 'img') return a
    if (el.textEndT === null) return a
    // 名字交出去之后：在 textDur 秒里慢慢化掉
    return a * (1 - smooth((clock - el.textEndT) / el.textDur))
  }

  /** 字的化开程度：离场时字号缩一点、整体淡掉（不是滤镜） */
  function hazeOf(el: El): number {
    if (el.kind === 'img') return 0
    if (el.textEndT === null) return 0
    const t = Math.min(1, Math.max(0, (clock - el.textEndT) / el.textDur))
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
