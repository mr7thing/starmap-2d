import { createJourney } from '../../src/index.ts'
import type { Manifest, Tier } from '../../src/types.ts'

const stage = document.querySelector<HTMLElement>('#stage')!
const readout = document.querySelector<HTMLElement>('#readout')!
const hint = document.querySelector<HTMLElement>('#hint')!

const res = await fetch('./manifest.json')
if (!res.ok) throw new Error(`manifest.json 未生成（${res.status}）。先跑 pnpm gen:manifest`)
const manifest = (await res.json()) as Manifest

const params = new URLSearchParams(location.search)

/**
 * 提示只亮几秒就淡出。
 *
 * 操作提示讲一次就够了，久了它自己就是噪音。
 */
let hintTimer = 0
function setHint(text: string, autoHide = false) {
  hint.textContent = text
  hint.style.opacity = '1'
  clearTimeout(hintTimer)
  if (autoHide) hintTimer = window.setTimeout(() => (hint.style.opacity = '0'), 4200)
}

/** `?tier=0|1|2` 钉死档位 */
const tierRaw = params.get('tier')
const tier: Tier | null =
  tierRaw === '0' || tierRaw === '1' || tierRaw === '2' ? (Number(tierRaw) as Tier) : null

const journey = createJourney(stage, manifest, {
  /**
   * 巡航速度基准（px/s）。
   * 档位判定用的是「相对基准的倍率」，所以换设备只需要改这一个数。
   */
  speedBase: 260,
  forceTier: tier,
  onEnterCruise() {
    document.body.dataset.view = 'cruise'
    setHint('图片会一张张冒出来 · ←→ 翻站 · Esc 退回场景', true)
  },
  onBackToScene() {
    document.body.dataset.view = 'scene'
    setHint('晃动鼠标展开环 · 点击进入光隧')
  },
})

// 指针一动就撤掉提示 —— 读者已经在操作了
stage.addEventListener('pointermove', () => {
  if (hintTimer) {
    clearTimeout(hintTimer)
    hintTimer = 0
    hint.style.opacity = '0'
  }
})

// Esc 回到一级场景
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && journey.view === 'cruise') journey.toScene()
})

// 开发期把实例挂到 window，方便在控制台里 goto / toScene / debug
;(window as unknown as { journey: unknown }).journey = journey

/**
 * `?cruise=3` 直接进入第 3 段光隧。
 * 调试构图与项目环时不用每次都去星图上点符号。
 */
const jumpRaw = params.get('cruise')
const jump = jumpRaw === null ? NaN : Number(jumpRaw)
if (Number.isFinite(jump) && jump >= 0) {
  journey.goto(Math.min(jump, manifest.stations.length - 1))
  document.body.dataset.view = 'cruise'
}

/**
 * `?scene=3` 直接落到一级场景的第 4 站。
 */
const sceneRaw = params.get('scene')
const sceneJump = sceneRaw === null ? NaN : Number(sceneRaw)
/** 光隧的画布 —— 合成指针事件要打在它身上 */
function cruiseCanvas(): HTMLElement | null {
  return document.querySelector('.sm2-cruise__canvas')
}

/**
 * `?zoom=1`（旧名 `?pin=1`）验「点图拿到眼前来看」。
 */
if (params.get('zoom') === '1' || params.get('pin') === '1') {
  setTimeout(() => {
    const canvas = cruiseCanvas()
    const c = journey.debug().cruise
    if (!canvas || !c) return
    // 点最靠前的那个图
    const img = c.live.find((l) => l.kind === 'img')
    if (!img) return
    const r = canvas.getBoundingClientRect()
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        clientX: r.left + c.light[0],
        clientY: r.top + c.light[1],
        bubbles: true,
      }),
    )
  }, 1600)
}

/**
 * `?warp=0.5` 定格在**流相位**对应的进度上。
 *
 * headless 里帧率不稳，按毫秒定时会落到进度不对的地方 ——
 * 按进度定格才是可复现的。
 */
const warpAt = Number(params.get('warp') ?? NaN)
if (Number.isFinite(warpAt)) {
  const poll = setInterval(() => {
    const c = journey.debug().cruise
    if (c && c.live.length >= warpAt) {
      clearInterval(poll)
      journey.freeze()
    }
  }, 25)
}

/**
 * `?step=N` 前进 N 站 —— 重发那一站的环标记。
 * `?back=N` 后退 N 站。
 */
const stepN = Math.max(0, Math.floor(Number(params.get('step') ?? 0)))
const backN = Math.max(0, Math.floor(Number(params.get('back') ?? 0)))
if (stepN > 0 || backN > 0) {
  setTimeout(() => {
    const acts: (() => void)[] = []
    for (let i = 0; i < stepN; i++) acts.push(() => journey.next())
    for (let i = 0; i < backN; i++) acts.push(() => journey.prev())
    acts.forEach((fn, i) => setTimeout(fn, i * 700))
  }, 400)
}

/**
 * 把真实数值打在角上。
 * 排布与取景都是纯函数 —— 画面不对的时候，唯一可靠的办法是读数。
 */
function paint() {
  try {
    paintInner()
  } catch (err) {
    // 读数出错就把它写出来 —— 角上这块字是唯一的仪表，静默失败会让人以为「机制没生效」
    readout.textContent = `读数异常：${String(err)}`
  }
}

function paintInner() {
  if (journey.view === 'cruise') {
    const c = journey.debug().cruise
    if (!c) return
    readout.textContent =
      `第 ${String(c.seg + 1).padStart(2, '0')} 段 · 流 ${c.flow.toFixed(0)}px · 档 ${c.tier}\n` +
      `速度 ${c.speed.toFixed(0)}px/s · 在场 ${c.count} 个 · 光心 ${c.light[0].toFixed(0)},${c.light[1].toFixed(0)}\n` +
      c.live
        .map((l) => `${l.kind === 'hop' ? '环' : '图'} #${l.k + 1} age${l.age.toFixed(1)} a${l.alpha.toFixed(2)}`)
        .join('\n')
    return
  }
  const s = journey.debug().scene
  readout.textContent =
    `第 ${String(s.index + 1).padStart(2, '0')} 站 · 整排 ${s.scroll.toFixed(2)} · 档 ${s.tier}\n` +
    `速度 ${s.speed.toFixed(0)}px/s · 光心 ${s.light[0].toFixed(0)},${s.light[1].toFixed(0)}`
}
paint()
setInterval(paint, 250)

if (Number.isFinite(sceneJump) && sceneJump >= 0) {
  // 一级场景是默认视图，落点过去就行
  journey.toScene(Math.min(sceneJump, manifest.stations.length - 1))
  document.body.dataset.view = 'scene'
}
