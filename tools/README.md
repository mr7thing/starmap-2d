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
| `probe-queue.mjs` | 二级的出场时序 —— `[环][图][图]…[环][图]…` 的顺序对不对 |
| `probe-read.mjs` | 页面里有几个读数元素、分别在哪（叠字排查） |
| `probe-drag.mjs` | 在 3D 版的 flow.html 光隧模式里模拟拖动 |
| `probe-drag-canvas.mjs` | 在二级光隧里模拟拖动 —— 发牌靠指针位移，静止截图看不到 |
| `probe-drag-state.mjs` | 拖动之后把在场元素的**真实坐标**读出来（看数不看图） |
| `probe-stations.mjs` | 站与站之间空没空一拍 —— 量上一站最后一张活了多久 |
| `probe-fps.mjs` | 三秒画了多少帧 —— 量 `ctx.filter` 之类的开销 |
| `probe-ring-color.mjs` | 环离场时颜色怎么变 —— 读画布像素，出一串 RGB |
| `probe-ring-profile.mjs` | 环线内外 12px 的颜色剖面 —— 定位笔画在哪一格 |
| `probe-ink.mjs` | 在**干净画布**上单独画一枚环，验墨色换色真的生效 |

> 取色有坑：巡航画面里有照片、有背景光环、还有字，
> 单点取色十有八九取到的不是环。
> `probe-ink.mjs` 单独画一枚环做对照，那才是干净的。

## 卡住某一刻

`freeze-at.mjs` 是**页面脚本**，给 `shot.mjs` 用（用 `@` 指向文件）：

```
node tools/shot.mjs "http://127.0.0.1:4203/?cruise=1&mode=flash" out.png 2000 @tools/freeze-at.mjs
node tools/shot.mjs "http://127.0.0.1:4203/?cruise=1&mode=exit&exitAlpha=0.35" out.png 2000 @tools/freeze-at.mjs
```

| 参数 | 卡在哪 |
|---|---|
| `mode=flash` | 环刚出生那一下（辉光最亮） |
| `mode=exit` | 环涨到满屏、正在离场时（`exitAlpha` 决定淡到多少） |

**headless 窗口小，环涨到满屏很快** —— 新环会立刻把旧环盖住，
离场那几秒什么都看不见。验离场要用大窗口：

```
msedge --headless=new --remote-debugging-port=9334 --window-size=1600,1000 ...
$env:CDP_PORT='9334'; node tools/shot.mjs ...
```

## 配套

截图在隔壁仓（3D 版）的 `tools/shot.mjs`：

```
node tools/shot.mjs <url> <out.png> [等待毫秒] ["页面脚本" | @脚本文件]
```

本仓还有一个 `shot-drag.mjs` —— `shot.mjs` 只能「导航 → 等 → 跑一次脚本 → 截一张」，
拖动这类要持续几秒的动作它抓不到（脚本跑完鼠标就不动了）。
`shot-drag.mjs` 会**等脚本跑完再截**，正好对上：

```
node tools/shot-drag.mjs <url> <out.png> <脚本文件> [脚本跑完后等多少毫秒]
```
