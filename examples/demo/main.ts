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
  /**
   * `&exit=sweep` / `&exit=recede` 钉死图的退场方式。
   * 默认 auto：指针慢的往后飞走，快的迎面掠过。
   */
  imageExit:
    params.get('exit') === 'sweep' || params.get('exit') === 'recede'
      ? (params.get('exit') as 'sweep' | 'recede')
      : 'auto',
  forceTier: tier,
  hint: '移动鼠标 = 推进航段 · 划得快 = 放行更多层 · 点一下 = 钉住那张',
  onEnterCruise() {
    document.body.dataset.view = 'cruise'
    setHint('移动鼠标推进光隧 · Esc 退回星图', true)
  },
  onBackToMap() {
    document.body.dataset.view = 'map'
    setHint('点击任意站点进入光隧')
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

// Esc 回到星图
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && journey.view === 'cruise') journey.toMap()
})

// 开发期把实例挂到 window，方便在控制台里 goto / toMap / debug
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

/** 光隧的画布 —— 合成指针事件要打在它身上 */
function cruiseCanvas(): HTMLElement | null {
  return document.querySelector('.sm2-cruise__canvas')
}

/**
 * `?move=340` 合成一段指针移动（总像素数），验证「图从深处冲过来」。
 *
 * 走的是和读者一样的那条路（真的 pointermove 事件）——
 * 不给库开后门，否则验的就不是读者看到的东西。
 *
 * **按帧发，而不是按定时器发**：读者挪一次鼠标就是一次事件，
 * 而定时器在 headless 里会把一串事件挤进同一帧 ——
 * 那样一帧里跨过几百像素，速度与档位都会失真。
 *
 * 像素数是可控的，所以段内进度也是可控的：
 * `SEG_PX = 620`，移动 341px 正好把项目环推到「停住让人读」那一档。
 */
const movePx = Number(params.get('move') ?? 0)
let moveDone = false
if (Number.isFinite(movePx) && movePx > 0) {
  let x = window.innerWidth * 0.36
  let moved = 0
  const tick = () => {
    const canvas = cruiseCanvas()
    if (!canvas || moved >= movePx) {
      moveDone = true
      return
    }
    const step = Math.min(18, movePx - moved)
    moved += step
    x += step
    canvas.dispatchEvent(
      new PointerEvent('pointermove', {
        clientX: x,
        clientY: window.innerHeight * 0.44,
        bubbles: true,
      }),
    )
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

/**
 * `?freeze=1` 把画面定住再截。
 *
 * 截图往返有几百毫秒，稍纵即逝的帧抓不住 —— 先停住，截到的才是那一帧。
 *
 * 移动了一段之后才定格：光靠定时器会撞上页面还在加载素材的时候，
 * 冻结发生在移动完成之前，段内进度就不是想要的那一档了。
 */
if (params.get('freeze') === '1') {
  const at = Number(params.get('freezeAt') ?? 1200)
  const wait = movePx > 0 ? () => moveDone : () => true
  const poll = setInterval(() => {
    if (!wait()) return
    clearInterval(poll)
    setTimeout(() => journey.freeze(), at)
  }, 50)
}

/**
 * `?pin=1` 验「点图钉住」。
 *
 * 先像读者那样动鼠标，让图在光标那儿长出来；停手，再在那个位置点一下 ——
 * 那张图就该留在原地不走。
 */
if (params.get('pin') === '1') {
  let x = window.innerWidth * 0.36
  const y = window.innerHeight * 0.44
  let n = 0
  const move = () => {
    const canvas = cruiseCanvas()
    if (!canvas || n >= 14) {
      // 停手，等图长完，再点它
      setTimeout(() => {
        canvas?.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }))
        canvas?.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, bubbles: true }))
      }, 260)
      return
    }
    n++
    x += 18
    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }))
    requestAnimationFrame(move)
  }
  requestAnimationFrame(move)
}

/**
 * `?freeze=1` 把画面定住再截。
 *
 * 截图往返有几百毫秒，稍纵即逝的帧抓不住 —— 先停住，截到的才是那一帧。
 */

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
      `第 ${String(c.seg + 1).padStart(2, '0')} 段 · 段内进度 ${c.u.toFixed(2)} · 穿越 ${c.warp >= 0 ? `${(c.warp * 100).toFixed(0)}%` : '—'}\n` +
      `速度 ${c.speed.toFixed(0)}px/s · 档 ${c.tier.toFixed(2)} · 在场 ${c.count} 条 · 累计位移 ${c.travel.toFixed(0)}px\n` +
      `轴心 ${c.axis[0].toFixed(0)},${c.axis[1].toFixed(0)}`
    return
  }
  const d = journey.debug().map
  readout.textContent =
    `站数 ${d.count} · 视口比 ${d.aspect.toFixed(2)}\n` +
    `符号外框 ${d.symbolSize.toFixed(1)} · 实测最小间距 ${d.minGap.toFixed(1)} ${d.minGap >= d.symbolSize ? 'OK' : '重叠!'}`
}
paint()
setInterval(paint, 250)
