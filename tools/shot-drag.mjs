/**
 * 截图工具 —— 在页面里先做点什么（比如模拟拖动），再抓那一帧。
 *
 * `tools/shot.mjs` 是「导航 → 等 → 跑一次脚本 → 截一张图」，
 * 拖动这类要持续几秒的动作它抓不到 ——
 * 脚本跑完就停了，截图时鼠标早就不动了。
 *
 * 这里自己开一条 CDP 会话：导航 → 注入脚本 → 等它跑完 → 截屏。
 *
 * 用法：
 *   node tools/shot-drag.mjs <url> <out.png> <脚本文件> [脚本跑完后等多少毫秒]
 */

const [, , url, out, scriptFile, waitMs = '300'] = process.argv
if (!url || !out || !scriptFile) {
  console.error('用法: node tools/shot-drag.mjs <url> <out.png> <脚本文件> [等多少毫秒]')
  process.exit(1)
}

const PORT = process.env.CDP_PORT ?? '9333'
const { readFileSync, writeFileSync } = await import('node:fs')

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
await sleep(900)

const script = readFileSync(scriptFile, 'utf8')
const r = await cdp.send('Runtime.evaluate', {
  expression: script,
  returnByValue: true,
  awaitPromise: true,
})
if (r.exceptionDetails) console.error('脚本出错:', JSON.stringify(r.exceptionDetails))
else if (r.result?.value !== undefined) console.log('脚本返回:', r.result.value)

await sleep(Number(waitMs))

const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
writeFileSync(out, Buffer.from(shot.data, 'base64'))
console.log(`已写入 ${out}`)

if (problems.length) {
  console.log(`\n⚠ 页面报了 ${problems.length} 条问题:`)
  for (const p of problems) console.log('  ' + p)
} else {
  console.log('页面无报错')
}

await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`)
cdp.close()
process.exit(0)
