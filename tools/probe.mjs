/**
 * 探针跑器 —— 注入 → 等 → 读回。
 *
 * `tools/shot.mjs` 是「导航 → 等 → 跑一次脚本 → 截一张图」，
 * 探针要跑好几秒才出结果，那条路不够用。
 *
 * 这里自己开一条 CDP 会话：导航 → 注入探针 → 轮询等它出结果 → 打印。
 *
 * 用法：
 *   node tools/probe.mjs <url> <探针文件> [等多少毫秒]
 */

const [, , url, probeFile, waitMs = '8000'] = process.argv
if (!url || !probeFile) {
  console.error('用法: node tools/probe.mjs <url> <探针文件> [等待毫秒]')
  process.exit(1)
}

const PORT = process.env.CDP_PORT ?? '9333'
const { readFileSync } = await import('node:fs')

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
await sleep(600)

// 注入探针
const probe = readFileSync(probeFile, 'utf8')
const r = await cdp.send('Runtime.evaluate', {
  expression: probe,
  returnByValue: true,
  awaitPromise: true,
})
if (r.exceptionDetails) console.error('探针出错:', JSON.stringify(r.exceptionDetails))
else if (r.result?.value !== undefined) console.log('探针返回:', r.result.value)

// 等它把结果写进 DOM
const deadline = Date.now() + Number(waitMs)
let out = null
while (Date.now() < deadline) {
  await sleep(250)
  const got = await cdp.send('Runtime.evaluate', {
    expression: "document.querySelector('#probe-out')?.dataset.probe ?? ''",
    returnByValue: true,
  })
  if (got.result?.value) {
    out = got.result.value
    break
  }
}

console.log(out ? out : '(超时，没拿到探针结果)')
if (problems.length) {
  console.log(`\n⚠ 页面报了 ${problems.length} 条问题:`)
  for (const p of problems) console.log('  ' + p)
}

await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`)
cdp.close()
process.exit(0)
