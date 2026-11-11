/**
 * 一级 · 环行场景 —— 一排环，一段旅程的总览。
 *
 * ## 先叠着，再拉开
 *
 * 默认进入时，**所有环按原来的顺序叠在屏幕正中间** —— 间距被压到 18px，
 * 一枚一枚错开，每一枚露出前面那枚的一点边。
 *
 * 但**只有前四五层看得清**：再往后的暗下去 —— 十三层全摞在一处
 * 只会糊成一片。环展开的时候，那些暗掉的才一个个显出来。
 *
 * 再往后也不是全灭：留一点底，压在最里面的那几枚还认得出是环。
 *
 * 指针一动，环就**一个一个拉开**：每一枚都有自己的时刻，
 * 前一枚还没走完，后一枚才开始动 —— 不齐步走。
 *
 * ```
 *      ◎        ◎        ◎        ◎        ◎
 *   01 宣城   02 常州   03 成都   04 广美   05 太湖
 * ```
 *
 * ## 环上一直有字
 *
 * 环跟二级光隧的章名环一个分工：**站名和时间地点长在环上**，
 * 不靠旁边那张列表撑着。
 *
 * **环上是「年·月 · 地点」，环下是名称** —— 跟二级光隧一模一样：
 * 时间地点是坐标，是主角；名称是注脚，小一号挂在下面。
 *
 * 叠着的时候**每一枚都带着字**，只是压在后面的暗到看不清：
 * 那一叠看着像一摞写好了名字的卡片。当前站那一枚最亮、压在最上层，
 * 名字直接读。
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

import { badgeType, drawBadge, type Badge } from './ring.ts'
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
/**
 * 叠在一起时，相邻两枚环错开多远（像素）。
 *
 * **不是乱叠** —— 顺序照旧，只是把一排的间距从 320 压到这么点：
 * 一枚一枚错开，每一枚露出前面那枚的一点边，数得出有几层。
 */
const STACK_GAP = 18
/**
 * 叠在一起时压得多暗。
 *
 * 不是所有层一个亮度 —— 那样十三层全摞在一处只会糊成一片。
 * 前面几层露出来，后面的暗到看不见；环展开了，它们才一个个显出来。
 */
const STACK_ALPHA = 0.55
/**
 * 叠着的时候看得清的有几层。
 *
 * 再往后的按层递减，暗到看不见 —— 读者看到的是「四五层」，
 * 不是「十三层」。
 */
const STACK_LAYERS = 5
/** 再往后一层，暗掉多少 */
const STACK_FADE = 0.25
/**
 * 压到最里面那几枚还留多少。
 *
 * 不是全灭 —— 那一叠看着像一摞写好了名字的卡片，
 * 压在最底下的也还认得出是个环（只是看不清写了什么）。
 */
const STACK_FLOOR = 0.18
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

  /**
   * 面板不是「当前这一环的介绍」—— 是整个内容的介绍。
   *
   * 上面一句总述，下面列出**所有**站点。
   * 列表跟着环的展开走：环开到第几站，列表就显到第几站。
   */
  const intro = document.createElement('div')
  intro.className = 'sm2-scene__intro'
  intro.textContent = '部分培训剪辑'

  const list = document.createElement('ol')
  list.className = 'sm2-scene__list'

  const items: HTMLButtonElement[] = stations.map((st, k) => {
    const li = document.createElement('li')
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'sm2-scene__item'
    // 列表只给时间地点 —— 站名交给环，跟二级光隧一个分工
    const when = document.createElement('em')
    when.textContent = st.date ? st.date.replace(/-/g, '.') : ''
    const where = document.createElement('span')
    where.textContent = st.short || st.place || ''
    if (when.textContent) btn.append(when)
    btn.append(where)
    btn.addEventListener('click', () => handlers.onPick?.(k))
    li.append(btn)
    list.append(li)
    return btn
  })

  panel.append(intro, list)

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
  /** 叠着的时候第一枚环的位置 —— 让整叠居中在画幅正中 */
  function stackOrigin(): number {
    return stackX() - ((N - 1) / 2) * STACK_GAP
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

  /**
   * 第 k 枚环展开到几分（0～1）。
   *
   * 环一个一个来 —— 前一枚还没走完，后一枚才动。
   * 面板里的站点列表跟着它走：环开到哪，列表就显到哪。
   */
  function openOf(k: number): number {
    const p = clamp01((openAcc - k * OPEN_STAGGER) / OPEN_SPAN)
    return p * p * (3 - 2 * p)
  }

  /** 第 k 枚环现在在哪儿 */
  function ringAt(k: number): RingSpot | null {
    // 展开度：环一个一个来 —— 前一枚还没走完，后一枚才动
    const ease = openOf(k)

    // 叠着的时候：一排的间距压到 9px —— 一个一个错开，各露一点边
    const stackCX = stackOrigin() + k * STACK_GAP
    // 拉开之后：回到原来那一排，间距 320
    const rowCX = readX() + (k - scroll) * RING_GAP
    const cx = stackCX + (rowCX - stackCX) * ease
    const cy = readY()
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
    const posAlpha = Math.max(0.34, 1 - dist * 0.2) * (current ? 1 : 0.82)
    // 叠着的时候：前面几层看得清，后面的暗到看不见；
    // 展开的时候这一层一层的影响被冲掉，暗掉的环重新显出来
    const stackVis =
      k < STACK_LAYERS
        ? 1
        : Math.max(STACK_FLOOR, 1 - (k - STACK_LAYERS + 1) * STACK_FADE)
    // 当前站那一枚不吃层压制，也不吃叠合压暗 ——
    // 它是牌堆最上面那张：得亮，得有名，别的都躲在它后头
    const vis = current ? 1 : stackVis + (1 - stackVis) * ease
    const dim = current ? 1 : STACK_ALPHA + (1 - STACK_ALPHA) * ease
    let alpha = posAlpha * dim * vis * arrive
    // 滚到文字面板下面的环要淡出 —— 文字不能被环压住
    const into = cx + r - (panelLeft() - 24)
    if (into > 0) alpha *= Math.max(0, 1 - into / (r * 1.6))
    return { k, cx, cy, r, alpha, current, open: ease }
  }

  // -------------------------------------------------------------------------
  // 帧
  // -------------------------------------------------------------------------

  /** 画第 k 枚环 —— 本体 + 站名 + 时间地点 */
  function drawRingSpot(k: number): void {
    const s = ringAt(k)
    if (!s) return
    const st = stations[k]!
    // 环上两行字跟二级光隧共用一套式样：时间地点大、名称小
    const type = badgeType(s.r)
    const badge: Badge = {
      cx: s.cx,
      cy: s.cy,
      r: s.r,
      alpha: s.alpha,
      title: st.title,
      meta: whenOf(st),
      titleSize: type.title,
      metaSize: type.meta,
      // 站名往往很长，外弧留得宽些，字才不用缩到看不清
      titleSpan: Math.PI * 0.9,
      metaSpan: Math.PI * 0.7,
      // 时间地点在环上，站名在同一段环线的下面（跟二级光隧一致）
      titleOn: 'bottom',
      // 环和字都加粗 —— 跟背景那些装饰环分得开
      bold: true,
      // 每一枚都带字 —— 压在后面的暗到看不清，但都在
      textAlpha: s.alpha,
    }
    drawBadge(ctx, badge)
  }

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

    // 环：从远到近画。当前站那一枚压到最上层 ——
    // 叠着的时候它是牌堆最前那张，字得在最上面才读得出来
    for (let k = N - 1; k >= 0; k--) {
      if (k === index) continue
      drawRingSpot(k)
    }
    drawRingSpot(index)

    drawVignette()
    drawCursor()

    updateList()

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

  /**
   * 列表跟着环的展开往下走吗 —— 用户自己滚走了就停，滚回来再跟上。
   */
  let followList = true
  /** 上一次跟着到第几站 */
  let lastFront = -1

  list.addEventListener('scroll', () => {
    // 用户自己滚了就别再拽回去；滚回环指的位置就重新跟上
    followList = Math.abs(list.scrollTop - anchorTop(frontOf())) <= 6
  })

  /** 开到第几站了 —— 最后一枚开始动的环 */
  function frontOf(): number {
    let front = 0
    for (let k = 0; k < N; k++) if (openOf(k) > 0.02) front = k
    return front
  }

  /** 列表该滚到哪儿 —— 第 k 站停在列表中间 */
  function anchorTop(k: number): number {
    const el = items[k]
    if (!el) return 0
    const er = el.getBoundingClientRect()
    const lr = list.getBoundingClientRect()
    const target = list.scrollTop + (er.top - lr.top) - (list.clientHeight - er.height) / 2
    const max = Math.max(0, list.scrollHeight - list.clientHeight)
    return Math.max(0, Math.min(max, target))
  }

  /**
   * 站点列表。
   *
   * **全部站点一直在列** —— 每条只给时间 · 地点，站名长在环上。
   * 当前站亮着；环开出去的时候列表跟着往下走，环开到第几站，
   * 列表就看到第几站。
   */
  function updateList(): void {
    // 当前站亮一下
    for (let k = 0; k < N; k++) {
      const cur = k === index ? '1' : '0'
      if (items[k]!.dataset.current !== cur) items[k]!.dataset.current = cur
    }
    const front = frontOf()
    if (front === lastFront) return
    lastFront = front
    if (!followList) return
    list.scrollTop = anchorTop(front)
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
