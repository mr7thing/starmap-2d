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
 * ## 与三维版的关系
 *
 * 两个包并存，内容标准、航线布局、档位状态机完全一致 ——
 * 同一份内容在两边画出同一张图、同一条航线。
 *
 * 差别只在渲染器：一级星图是 SVG 海图面 + 制图符号，
 * 二级光隧是 Canvas 2D。**零运行时依赖。**
 */

import { createCruise, type CruiseOptions, type CruiseDebug } from './cruise.ts'
import { createMapView, type MapOptions, type MapView } from './map.ts'
import { validateManifest, type Manifest, type Tier } from './types.ts'

export interface JourneyOptions extends MapOptions {
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
  /** 回到星图 */
  onBackToMap?: () => void
  /** 站点被悬停 */
  onHover?: (index: number) => void
}

export type View = 'map' | 'cruise'

export interface Journey {
  readonly manifest: Manifest
  readonly view: View
  /** 星图 → 巡航第 i 段（i 从 0 开始） */
  goto(i: number): void
  /** 回到星图 */
  toMap(): void
  /** 巡航里前进一站（走光速穿越） */
  next(): void
  /** 巡航里后退一站（走光速穿越） */
  prev(): void
  /**
   * 定格：把时间掐成 0，整个场景停住。
   *
   * 截图往返有几百毫秒，稍纵即逝的帧（「掠过」只有零点几秒）抓不住，
   * 只能先把它停住再截。
   */
  freeze(): void
  thaw(): void
  on(ev: 'view' | 'hover', cb: (view?: View, index?: number) => void): void
  /**
   * 取景与投影的真实数值。排布是纯函数，出问题要看数，不要靠感觉。
   */
  debug(): { map: ReturnType<MapView['debug']>; cruise?: CruiseDebug }
  destroy(): void
}

const STYLE_ID = 'sm2-style'

const CSS = `
.sm2-root{position:relative;width:100%;height:100%;overflow:hidden;background:#04070e}

/* ---- 一级 · 星图 ---- */
.sm2-map{position:absolute;inset:0;overflow:hidden;background:#04070e}
.sm2-map svg{position:absolute;inset:0;display:block;width:100%;height:100%}
/* 海图上的线是**发丝线**：1 设备像素，不管图放大多少。
   不加这一条，线宽会跟着世界→像素的倍率走 —— 一个世界单位是十几像素，
   网格和航线就全成了粗色块。 */
.sm2-map svg *{vector-effect:non-scaling-stroke}
.sm2-dust{position:absolute;inset:0;display:block;width:100%;height:100%}
.sm2-label-layer{position:absolute;inset:0;pointer-events:none}

/* 标注 —— 海图上的字：小、字距拉开、技术感，不与图面争 */
.sm2-label{
  position:absolute;left:0;top:0;transform:translate(-50%,-50%);
  pointer-events:auto;appearance:none;background:none;border:0;padding:3px 6px;
  display:flex;flex-direction:column;align-items:flex-start;gap:1px;cursor:pointer;
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,"PingFang SC","Microsoft YaHei",monospace;
  color:#bcdcf5;white-space:nowrap;line-height:1.2;
  transition:opacity .16s ease,color .16s ease;
}
.sm2-label__no{
  font-size:8px;letter-spacing:.18em;color:#3f6f9c;
  border:1px solid rgba(63,111,156,.45);border-radius:2px;padding:0 3px;line-height:1.25;
}
.sm2-label__date{font-size:8.5px;letter-spacing:.14em;color:#4f83b4}
/* 地点才是图上的主标注。短是硬要求，不是审美偏好 ——
   14 个站排成一条航线，标注宽度必须小于站距才排得下。 */
.sm2-label__place{
  font-size:11.5px;font-weight:500;letter-spacing:.08em;color:#cfe6ff;white-space:nowrap;
  text-shadow:0 1px 3px #04070e,0 0 10px rgba(4,7,14,.95);
}
.sm2-label:hover{opacity:1 !important;color:#eaf6ff}
html[data-sm2-outline] .sm2-label{outline:1px solid #ff2d55 !important;background:rgba(255,45,85,.15) !important}

/* 图廓外的固定注记 */
.sm2-chrome{position:absolute;inset:0;pointer-events:none;font-family:ui-monospace,"SF Mono",Menlo,Consolas,"PingFang SC",monospace}
.sm2-chrome__title{
  position:absolute;left:22px;top:20px;font-size:12px;letter-spacing:.34em;color:#7fb4dd;
  text-shadow:0 0 14px rgba(80,160,220,.35);
}
.sm2-chrome__sub{position:absolute;left:22px;top:41px;font-size:9.5px;letter-spacing:.2em;color:#3f6f9c}
.sm2-chrome__north{position:absolute;right:24px;top:20px;font-size:10px;letter-spacing:.28em;color:#7fb4dd}

/* ---- 二级 · 光隧 ---- */
.sm2-cruise{position:absolute;inset:0;overflow:hidden;background:#04070e;pointer-events:auto;
  font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.sm2-cruise__canvas{display:block;width:100%;height:100%;cursor:none}

/* 文字块在**环的右边**。
   一级星图从左往右读，文字跟着环走才是一件事 —— 环往左上排，
   右边空出来给文字，视线不用来回折返。 */
.sm2-cruise__panel{
  position:absolute;right:28px;top:50%;transform:translateY(-50%);
  width:min(260px,calc(100vw - 56px));display:flex;flex-direction:column;gap:7px;
  pointer-events:none;
}
/* 逐行浮现由渲染时钟驱动（见 cruise.ts），
   这里的初始状态只负责「没亮之前别占位」 */
.sm2-cruise__panel > *{opacity:0;transform:translateY(6px)}
.sm2-cruise__no{font-size:10px;letter-spacing:.2em;color:#4f83b4}
.sm2-cruise__title{font-size:16px;line-height:1.4;color:#e4f3ff;margin-top:2px}
.sm2-cruise__lead{font-size:11.5px;line-height:1.75;color:#9dc2e0;margin-top:4px}
.sm2-cruise__role{font-size:10.5px;line-height:1.7;color:#6f9fc8}

/* 里程尺 —— 海图上量程的老做法：刻度 + 游标 + 下一站。
   一屏两站靠透视，但「还剩几站」是数，得有一条尺子说清楚。 */
.sm2-cruise__gauge{
  position:absolute;right:28px;bottom:52px;width:min(260px,calc(100vw - 56px));height:1px;
  background:rgba(79,131,180,.28);
}
.sm2-cruise__tick{position:absolute;top:-4px;width:1px;height:9px;background:rgba(79,131,180,.55)}
.sm2-cruise__tick.is-on{background:#8fd0ff}
.sm2-cruise__pip{
  position:absolute;top:-3px;width:7px;height:7px;margin-left:-3.5px;border-radius:50%;
  background:#bfe9ff;box-shadow:0 0 9px rgba(120,200,255,.85);
}
.sm2-cruise__gauge-label{
  position:absolute;left:0;top:13px;font-size:9.5px;letter-spacing:.14em;
  color:#3f6f9c;white-space:nowrap;
}
.sm2-cruise__warp{
  position:absolute;right:28px;top:24px;padding:5px 10px;
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,"PingFang SC","Microsoft YaHei",monospace;
  font-size:10px;letter-spacing:.2em;color:#9fd0f0;
  border:1px solid rgba(124,192,240,.4);border-radius:2px;background:rgba(4,7,14,.6);
  opacity:0;transition:opacity .18s ease;
}
.sm2-cruise__warp.is-on{opacity:1}
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
.sm2-cruise__sr{
  position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;
}
/* 照片拿到眼前时，文字块和里程尺让开 */
.sm2-cruise__panel,.sm2-cruise__gauge{transition:opacity .18s ease}
.sm2-cruise.is-zoomed .sm2-cruise__panel,
.sm2-cruise.is-zoomed .sm2-cruise__gauge{opacity:0}
`

function ensureStyle(): void {
  if (typeof document === 'undefined') return
  if (!document.getElementById(STYLE_ID)) {
    const el = document.createElement('style')
    el.id = STYLE_ID
    el.textContent = CSS
    document.head.append(el)
  }
  // 诊断开关：?outline=1 给所有标签描边
  if (location.search.includes('outline=1')) document.documentElement.dataset.sm2Outline = '1'
}

export function createJourney(
  container: HTMLElement,
  manifestInput: unknown,
  options: JourneyOptions = {},
): Journey {
  const manifest = validateManifest(manifestInput)
  ensureStyle()

  container.classList.add('sm2-root')

  let current: View = 'map'
  const listeners: { ev: string; cb: (view?: View, index?: number) => void }[] = []

  // --- 一级星图 ---
  const map = createMapView(manifest, { ...options }, (index) => {
    current = 'cruise'
    enterCruise(index)
    options.onEnterCruise?.(index)
    emit('view', current, index)
  })
  container.append(map.dom)

  // --- 二级光隧 ---
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
    // resize 必须排在 focus 前面 —— focus 要按画幅算环停住时的半径，
    // 顺序反了的话它用的是上一帧（甚至构造时的）画幅，环一下就冲出画幅。
    cruise.resize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight))
    cruise.focus(index)
    if (!cruise.dom.isConnected) container.append(cruise.dom)
    map.dom.style.display = 'none'
    cruise.dom.style.display = ''
  }

  function leaveCruise(): void {
    if (cruise) cruise.dom.style.display = 'none'
    map.dom.style.display = ''
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

    map.resize(w, h)
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
  let lastHover = -1

  const tick = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    time += dt

    if (current === 'cruise' && cruise) {
      cruise.frame(dt, time)
      emit('cruise', current, cruise.at())
    } else {
      const h = map.hovered()
      if (h !== lastHover) {
        lastHover = h
        options.onHover?.(h)
        emit('hover', current, h)
      }
      map.frame(dt, time)
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
    toMap() {
      current = 'map'
      leaveCruise()
      options.onBackToMap?.()
      emit('view', current)
    },
    next() {
      cruise?.forward()
    },
    prev() {
      cruise?.back()
    },
    freeze() {
      cruise?.freeze()
    },
    thaw() {
      cruise?.thaw()
    },
    on(ev, cb) {
      listeners.push({ ev, cb })
    },
    debug: () => ({ map: map.debug(), cruise: cruise?.debug() }),
    destroy() {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('resize', fit)
      window.removeEventListener('keydown', onKey)
      map.dispose()
      cruise?.dispose()
      container.classList.remove('sm2-root')
      listeners.length = 0
    },
  }
}

export { validateManifest, ManifestError } from './types.ts'
export type { Manifest, Station, ImageRef, Tier } from './types.ts'
export { layoutStations, hash01, fitView } from './layout.ts'
export type { LayoutOptions, Placed, Frame } from './layout.ts'
export { CHART_INK, createChart } from './chart.ts'
export type { ChartInk, ChartOptions } from './chart.ts'
export type { SymbolShape } from './symbol.ts'
export type { CourseStyle } from './course.ts'
export type { JourneyOptions as Options }
