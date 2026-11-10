# 探针工具

排布是纯函数 —— **画面不对的时候，看数，不要靠感觉**。

这些脚本用 CDP 驱动一个已经开着的 headless 浏览器，
在页面里读真实数值，比看截图可靠得多。

## 用法

先起 headless（要带远程调试端口）：

```
msedge --headless=new --remote-debugging-port=9333 --disable-gpu --use-gl=swiftshader
```

再跑：

```
node tools/probe.mjs <url> <探针文件> [等多少毫秒]
```

`probe.mjs` 会：导航 → 注入探针 → 轮询等结果写进 DOM → 打印 `#probe-out` 的 `data-probe`。

## 探针怎么写

探针是一个**表达式**（不是模块，`Runtime.evaluate` 不吃 `export default`）。
它要把结果塞进 DOM，`probe.mjs` 才读得到：

```js
;(() => {
  const j = window.journey
  const seen = []
  const id = setInterval(() => {
    const c = j.debug().cruise
    const line = c.live.map((l) => `${l.kind[0]}#${l.k + 1}`).join(' ')
    if (seen[seen.length - 1] !== line) seen.push(line)
  }, 50)
  setTimeout(() => {
    clearInterval(id)
    const host = document.createElement('div')
    host.id = 'probe-out'
    host.dataset.probe = JSON.stringify(seen)
    host.style.display = 'none'
    document.body.append(host)
  }, 9000)
  return 'ok'
})()
```

**必须返回 `'ok'`**，否则 `probe.mjs` 会因为拿不到返回值而误判成失败。

## 现成的探针

| 文件 | 看什么 |
|---|---|
| `probe-queue.mjs` | 二级队列的时序 —— `[环][图][图]…[环][图]…` 的顺序对不对 |
| `probe-read.mjs` | 页面里有几个读数元素、分别在哪（叠字排查） |

## 配套

截图在隔壁仓（3D 版）的 `tools/shot.mjs`：

```
node tools/shot.mjs <url> <out.png> [等待毫秒] ["页面脚本" | @脚本文件]
```
