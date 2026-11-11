/**
 * 探针：用**真实鼠标事件**点列表项里的「时间」那几个字，看能不能进站。
 *
 * `tools/probe.mjs` 走的是页面内脚本（`.click()`），那绕过命中测试；
 * 这里从 CDP 发真实的 mousePressed / mouseReleased，
 * 才能验出「点的是不是那个字」「有没有被别的东西挡住」。
 *
 * 用法：
 *   node tools/probe-list-mouse.mjs <url> [第几项，从 0 起] [点日期还是地点]
 */

const [, , url, itemArg = '2', what = 'date'] = process.argv
if (!url) {
  console.error('用法: node tools/probe-list-mouse.mjs <url> [第几项] [date|place]')
  process.exit(1)
}
const item = Number(itemArg)
const PORT = process.env.CDP_PORT ?? '9333'

async function newTarget() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })
  if (!r.ok) throw new Error(`新建标签页失败: ${r.status}`)
  return r.json()
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let id = 0
  const pending = new Map()
  const events = new Map()
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', () => res())
    ws.addEventListener('error', (e) => rej(new Error(`websocket 出错: ${e.message ?? e}`)))
  })
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result)
    } else if (msg.method && events.has(msg.method)) {
      for (const cb of events.get(msg.method) ?? []) cb(msg.params)
    }
  })
  return {
    ready,
    on(method, cb) {
      if (!events.has(method)) events.set(method, [])
      events.get(method).push(cb)
    },
    send(method, params = {}) {
      const mid = ++id
      return new Promise((res, rej) => {
        pending.set(mid, { res, rej })
        ws.send(JSON.stringify({ id: mid, method, params }))
      })
    },
    close: () => ws.close(),
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const target = await newTarget()
const cdp = connect(target.webSocketDebuggerUrl)
await cdp.ready
await cdp.send('Page.enable')
await cdp.send('Runtime.enable')

const problems = []
cdp.on('Runtime.exceptionThrown', (p) => {
  problems.push(`未捕获异常: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`)
})

const loaded = new Promise((res) => cdp.on('Page.loadEventFired', res))
await cdp.send('Page.navigate', { url })
await loaded
await sleep(1200)

// 找到目标文字的中心坐标
// 第二参数写成 "x,y" 就是直接点那个坐标（用来点环上的字）
let pick
if (/^\s*[\d.]+\s*,\s*[\d.]+\s*$/.test(itemArg)) {
  const [x, y] = itemArg.split(',').map(Number)
  pick = { result: { value: JSON.stringify({ text: `坐标 ${x},${y}`, x, y, w: 0, h: 0, total: 0 }) } }
} else {
  pick = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
    const items = [...document.querySelectorAll('.sm2-scene__item')]
    const el = items[${item}]
    if (!el) return null
    const node = ${what === 'place' ? 'el.querySelector("span")' : 'el.querySelector("em")'} ?? el
    const r = node.getBoundingClientRect()
    return JSON.stringify({
      text: node.textContent,
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
      w: r.width,
      h: r.height,
      total: items.length,
    })
  })()`,
    returnByValue: true,
  })
}
if (!pick.result?.value) {
  console.log('找不到列表项', pick.result?.value)
  process.exit(1)
}
const target4 = JSON.parse(pick.result.value)
console.log(`点第 ${item} 项的「${target4.text}」（${target4.w.toFixed(0)}×${target4.h.toFixed(0)} px）`)

// 真鼠标：移过去 → 按下 → 松开
await cdp.send('Input.dispatchMouseEvent', {
  type: 'mouseMoved',
  x: target4.x,
  y: target4.y,
  button: 'none',
})
// 想看悬停长什么样：SHOT=路径 存一张（点击之前）
if (process.env.SHOT) {
  await sleep(250)
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const { writeFileSync } = await import('node:fs')
  writeFileSync(process.env.SHOT, Buffer.from(shot.data, 'base64'))
  console.log(`已写入 ${process.env.SHOT}`)
}
await cdp.send('Input.dispatchMouseEvent', {
  type: 'mousePressed',
  x: target4.x,
  y: target4.y,
  button: 'left',
  clickCount: 1,
})
await cdp.send('Input.dispatchMouseEvent', {
  type: 'mouseReleased',
  x: target4.x,
  y: target4.y,
  button: 'left',
  clickCount: 1,
})
await sleep(800)

const after = await cdp.send('Runtime.evaluate', {
  expression: `JSON.stringify({
    view: window.journey?.view,
    cruiseSeg: window.journey?.debug().cruise?.seg ?? null,
  })`,
  returnByValue: true,
})
console.log(after.result?.value ?? '(读不到状态)')
if (problems.length) console.log('⚠ 页面报错:', problems.join(' | '))

await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`)
cdp.close()
process.exit(0)
