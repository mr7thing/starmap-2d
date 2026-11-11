/**
 * 探针：数三秒里画了多少帧 —— 用来量 `ctx.filter` 模糊的开销。
 *
 * 用法：
 *   node tools/probe.mjs "http://127.0.0.1:4203/?cruise=1&warp=9" tools/probe-fps.mjs 6000
 */
;(() => {
  let n = 0
  const t0 = performance.now()
  const tick = () => {
    n++
    const dt = performance.now() - t0
    if (dt < 3000) {
      requestAnimationFrame(tick)
      return
    }
    const host = document.createElement('div')
    host.id = 'probe-out'
    host.dataset.probe = JSON.stringify({
      fps: +(n / (dt / 1000)).toFixed(1),
      frames: n,
    })
    host.style.display = 'none'
    document.body.append(host)
  }
  requestAnimationFrame(tick)
  return 'ok'
})()
