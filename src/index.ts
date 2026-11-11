/**
 * @uncle7/starmap-2d —— 星图展示库（二维版）
 *
 * ```ts
 * import { createJourney } from '@uncle7/starmap-2d'
 *
 * const journey = createJourney(document.querySelector('#stage'), manifest, {
 *   onEnterCruise: (i) => console.log('进入第', i, '段巡航'),
 * })
 * ```
 *
 * 库不知道你的内容是什么。它只认 `Manifest`。
 *
 * ## 两层
 *
 * - **一级 · 环行场景**：一排环，一段旅程的总览。环里没有照片。
 *   默认所有环叠在画幅正中央，指针一动就一个一个拉开。
 *   光线随鼠标游动，点一枚环进去。
 * - **二级 · 光隧**：一条**元素队列** —— 环（带项目名）和照片同一套逻辑，
 *   一张张冒出来，这一站冒完了下一个项目的环带字飞出来。
 *
 * ## 与三维版的关系
 *
 * 两个包并存，内容标准、航线布局、档位状态机完全一致 ——
 * 同一份内容在两边画出同一张图、同一条航线。
 *
 * 差别只在渲染器：一级星图是 Canvas 2D 的环行场景，
 * 二级光隧是 Canvas 2D 的元素流。**零运行时依赖。**
 */

import { createCruise, type CruiseOptions, type CruiseDebug } from './cruise.ts'
import { createScene, type SceneOptions, type SceneView, type SceneDebug } from './scene.ts'
import { validateManifest, type Manifest, type Tier } from './types.ts'

export interface JourneyOptions extends SceneOptions {
  /**
   * 巡航速度基准（px/s）。默认 260，按键鼠调的。
   *
   * 档位判定用的是「相对基准的倍率」，所以换设备只需要改这一个数。
   */
  speedBase?: number
  /** 强制档位。给自动化与截图用；不传就由指针速度决定。 */
  forceTier?: Tier | null
  /** 开场提示语。不给就不显示 —— 库里不替宿主说话。 */
  hint?: string
  /** 画面上显示读数（调试用） */
  debug?: boolean
  /** 进入巡航第 i 段 */
  onEnterCruise?: (index: number) => void
  /** 回到环行场景 */
  onBackToScene?: () => void
  /** 站点被悬停（−1 = 指针离开了环） */
  onHover?: (index: number) => void
}

export type View = 'scene' | 'cruise'

export interface Journey {
  readonly manifest: Manifest
  readonly view: View
  /** 直接进入第 i 段的光隧（i 从 0 开始） */
  goto(i: number): void
  /**
   * 回到一级 · 环行场景。
   *
   * 带 index 时顺带落到那一站（`toScene(4)` = 回到场景并停在第 5 站）。
   */
  toScene(index?: number): void
  /** 巡航里前进一站 */
  next(): void
  /** 巡航里后退一站 */
  prev(): void
  /**
   * 定格：把时间掐成 0，整个场景停住。
   *
   * 截图往返有几百毫秒，稍纵即逝的帧抓不住，只能先把它停住再截。
   */
  freeze(): void
  thaw(): void
  on(ev: 'view' | 'hover', cb: (view?: View, index?: number) => void): void
  /**
   * 取景与投影的真实数值。排布是纯函数，出问题要看数，不要靠感觉。
   */
  debug(): { scene: SceneDebug; cruise?: CruiseDebug }
  destroy(): void
}

const STYLE_ID = 'sm2-style'

const CSS = `
.sm2-root{position:relative;width:100%;height:100%;overflow:hidden;background:#04070e}

/* ---- 通用：面板逐行浮现 ---- */
@keyframes sm2-rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.sm2-panel>*{animation:sm2-rise .5s ease both}
.sm2-panel>*:nth-child(2){animation-delay:.06s}
.sm2-panel>*:nth-child(3){animation-delay:.12s}
.sm2-panel>*:nth-child(4){animation-delay:.18s}
.sm2-panel>*:nth-child(5){animation-delay:.24s}

/* ---- 一级 · 环行场景 ---- */
.sm2-scene{position:absolute;inset:0;overflow:hidden;background:#04070e;pointer-events:auto;
  font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.sm2-scene__canvas{display:block;width:100%;height:100%;cursor:none}
/* 文字块在环的右边：环往左排，右边空出来给文字 */
.sm2-scene__panel{
  position:absolute;right:28px;top:50%;transform:translateY(-50%);
  width:min(300px,calc(100vw - 56px));
  display:flex;flex-direction:column;gap:12px;
  pointer-events:none;
  max-height:calc(100vh - 72px);
}
/* 整体介绍：不是当前这一环的 */
.sm2-scene__intro{
  flex:0 0 auto;font-size:11px;letter-spacing:.2em;color:#6f9fc8;
  /* 环的弧线会从字底下穿过去 —— 描一圈暗晕，字才压得住（不是底板） */
  text-shadow:0 0 4px #04070e,0 0 9px #04070e;
}
/* 所有站点 —— 跟着环的展开一条条显出来 */
.sm2-scene__list{
  list-style:none;margin:0;padding:0 6px 0 0;
  overflow-y:auto;overscroll-behavior:contain;min-height:0;
  pointer-events:auto;
  display:flex;flex-direction:column;gap:1px;
  scrollbar-width:thin;scrollbar-color:rgba(110,160,205,.32) transparent;
}
.sm2-scene__list::-webkit-scrollbar{width:4px}
.sm2-scene__list::-webkit-scrollbar-track{background:transparent}
.sm2-scene__list::-webkit-scrollbar-thumb{
  background:rgba(110,160,205,.32);border-radius:2px;
}
.sm2-scene__item{
  display:block;width:100%;text-align:left;border:0;background:none;
  font:inherit;font-size:12px;line-height:1.4;cursor:pointer;
  padding:3px 0;color:#7ea6cf;
  transition:color .2s ease;
  text-shadow:0 0 4px #04070e,0 0 9px #04070e;
}
.sm2-scene__item:hover{color:#e4f3ff}
.sm2-scene__item[data-current="1"]{color:#e4f3ff}
.sm2-scene__item em{
  font-style:normal;color:#4f7fa8;margin-right:.5em;
  font-variant-numeric:tabular-nums;
}
.sm2-scene__item[data-current="1"] em{color:#6f9fc8}
.sm2-scene__read{
  position:absolute;left:24px;bottom:20px;font-size:10px;line-height:1.85;color:#5b8cb8;
  white-space:pre;text-align:left;
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
}
.sm2-scene__hint{
  position:absolute;left:50%;bottom:26px;transform:translateX(-50%);
  font-size:10.5px;letter-spacing:.18em;color:#3f6f9c;transition:opacity .5s ease;
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
}

/* ---- 二级 · 光隧 ---- */
.sm2-cruise{position:absolute;inset:0;overflow:hidden;background:#04070e;pointer-events:auto;
  font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.sm2-cruise__canvas{display:block;width:100%;height:100%;cursor:none}
.sm2-cruise__panel{
  position:absolute;right:28px;bottom:28px;
  width:min(240px,calc(100vw - 56px));display:flex;flex-direction:column;gap:7px;
  pointer-events:none;
  align-items:flex-end;text-align:right;
}
.sm2-cruise__when{font-size:10.5px;letter-spacing:.14em;color:#5f93c2}
.sm2-cruise__title{font-size:16px;line-height:1.4;color:#e4f3ff;margin-top:4px}
.sm2-cruise__read{
  position:absolute;left:24px;bottom:20px;font-size:10px;line-height:1.85;color:#5b8cb8;
  white-space:pre;text-align:left;
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
}
.sm2-cruise__hint{
  position:absolute;left:50%;bottom:26px;transform:translateX(-50%);
  font-size:10.5px;letter-spacing:.18em;color:#3f6f9c;transition:opacity .5s ease;
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
}
.sm2-cruise__read{
  position:absolute;left:24px;bottom:20px;font-size:10px;line-height:1.85;color:#5b8cb8;
  white-space:pre;text-align:left;
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
}
.sm2-cruise__sr{
  position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;
}
`

function ensureStyle(): void {
  if (typeof document === 'undefined') return
  if (!document.getElementById(STYLE_ID)) {
    const el = document.createElement('style')
    el.id = STYLE_ID
    el.textContent = CSS
    document.head.append(el)
  }
}

export function createJourney(
  container: HTMLElement,
  manifestInput: unknown,
  options: JourneyOptions = {},
): Journey {
  const manifest = validateManifest(manifestInput)
  ensureStyle()

  container.classList.add('sm2-root')

  let current: View = 'scene'
  const listeners: { ev: string; cb: (view?: View, index?: number) => void }[] = []

  // --- 一级 · 环行场景 ---
  const scene: SceneView = createScene(
    manifest,
    { ...options },
    {
      onPick: (index) => {
        current = 'cruise'
        enterCruise(index)
        options.onEnterCruise?.(index)
        emit('view', current, index)
      },
      onHover: (index) => {
        options.onHover?.(index)
        emit('hover', current, index)
      },
    },
  )
  container.append(scene.dom)

  // --- 二级 · 光隧 ---
  let cruise: ReturnType<typeof createCruise> | null = null

  function enterCruise(index: number): void {
    if (!cruise) {
      const cruiseOpts: CruiseOptions = {
        speedBase: options.speedBase,
        forceTier: options.forceTier,
        hint: options.hint,
        debug: options.debug,
      }
      cruise = createCruise(manifest, cruiseOpts)
    }
    // resize 必须排在 focus 前面 —— focus 要按画幅算光心的落位，
    // 顺序反了的话它用的是上一帧（甚至构造时的）画幅。
    cruise.resize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight))
    cruise.focus(index)
    if (!cruise.dom.isConnected) container.append(cruise.dom)
    scene.dom.style.display = 'none'
    cruise.dom.style.display = ''
  }

  function leaveCruise(): void {
    if (cruise) cruise.dom.style.display = 'none'
    scene.dom.style.display = ''
  }

  /**
   * **不碰宿主的定位。**
   *
   * 早先有一行 `container.style.position = 'relative'` —— 想让子元素有定位上下文。
   * 但宿主的 `#stage { position: fixed }` 被内联样式覆盖后，容器高度塌成 0，
   * ResizeObserver 再也不会触发，画布永远停在第一次量到的尺寸。
   *
   * 正确的做法是：库只填满宿主给的盒子；盒子塌了就告诉宿主。
   */
  const fit = (): void => {
    const r = container.getBoundingClientRect()
    const w = Math.max(1, r.width)
    const h = Math.max(1, r.height)

    if (r.height === 0 && !warnedNoHeight) {
      warnedNoHeight = true
      console.warn(
        '[starmap-2d] 容器高度为 0。库只填满宿主给的盒子 —— 请给容器一个明确的高度' +
          '（例如 position:fixed; inset:0，或 width/height 100%）。',
      )
    }

    scene.resize(w, h)
    if (cruise && current === 'cruise') cruise.resize(w, h)
  }
  let warnedNoHeight = false
  fit()

  // 容器尺寸不一定随窗口变（比如宿主把它写死在一个 flex 行里），
  // 所以除了 ResizeObserver 还要听窗口本身。
  const ro = new ResizeObserver(fit)
  ro.observe(container)
  window.addEventListener('resize', fit)

  // --- 循环 ---
  let raf = 0
  let last = performance.now()
  let time = 0

  const tick = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    time += dt

    if (current === 'cruise' && cruise) {
      cruise.frame(dt, time)
      emit('cruise', current, cruise.at())
    } else {
      scene.frame(dt, time)
    }

    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)

  function emit(ev: string, view?: View, index?: number): void {
    for (const l of listeners) if (l.ev === ev) l.cb(view, index)
  }

  /**
   * 方向键 = 前进 / 后退。
   *
   * 只在光隧里生效，且放过输入框 —— 宿主页面里可能有搜索框，
   * 库不该抢它的方向键。
   */
  function onKey(e: KeyboardEvent): void {
    if (current !== 'cruise' || !cruise) return
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    if (e.key === 'ArrowRight') {
      cruise.forward()
      e.preventDefault()
    } else if (e.key === 'ArrowLeft') {
      cruise.back()
      e.preventDefault()
    }
  }
  window.addEventListener('keydown', onKey)

  return {
    manifest,
    get view() {
      return current
    },
    goto(i) {
      if (i < 0 || i >= manifest.stations.length) {
        throw new RangeError(`站点下标越界：${i}（共 ${manifest.stations.length} 站）`)
      }
      current = 'cruise'
      enterCruise(i)
      options.onEnterCruise?.(i)
      emit('view', current, i)
    },
    toScene(index) {
      current = 'scene'
      if (index !== undefined) scene.focus(index)
      leaveCruise()
      options.onBackToScene?.()
      emit('view', current)
    },
    next() {
      cruise?.forward()
    },
    prev() {
      cruise?.back()
    },
    freeze() {
      if (current === 'cruise') cruise?.freeze()
      else scene.freeze()
    },
    thaw() {
      if (current === 'cruise') cruise?.thaw()
      else scene.thaw()
    },
    on(ev, cb) {
      listeners.push({ ev, cb })
    },
    debug: () => ({ scene: scene.debug(), cruise: cruise?.debug() }),
    destroy() {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('resize', fit)
      window.removeEventListener('keydown', onKey)
      scene.dispose()
      cruise?.dispose()
      container.classList.remove('sm2-root')
      listeners.length = 0
    },
  }
}

export { validateManifest, ManifestError } from './types.ts'
export type { Manifest, Station, ImageRef, Tier } from './types.ts'
export { TierTracker, SpeedTracker } from './window.ts'
export { drawBadge, arcText, drawRingBody, RING_INK } from './ring.ts'
export type { Badge, RingInk } from './ring.ts'
export type { CruiseOptions as CruiseConfig, CruiseDebug as CruiseState }
export type { SceneOptions as SceneConfig, SceneDebug as SceneState }
