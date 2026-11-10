/**
 * 探针：在 flow.html 的光隧模式里模拟拖动，看图片真正飞出来的样子。
 *
 * 光隧的图片是靠指针移动触发的（spawnAcc 累积位移），
 * 静止截图只能看到空屏 —— 必须真的拖一下。
 */
;(() => {
  const c = document.querySelector('#c')
  const W = innerWidth
  const H = innerHeight
  let x = W * 0.5
  let y = H * 0.5
  let t = 0
  const id = setInterval(() => {
    // 画一个来回的弧线，模拟真的在拖
    t += 0.16
    x = W * 0.5 + Math.cos(t) * W * 0.3
    y = H * 0.5 + Math.sin(t * 0.7) * H * 0.22
    c.dispatchEvent(
      new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }),
    )
  }, 16)
  setTimeout(() => {
    clearInterval(id)
    const host = document.createElement('div')
    host.id = 'probe-out'
    host.dataset.probe = JSON.stringify({ x: Math.round(x), y: Math.round(y) })
    host.style.display = 'none'
    document.body.append(host)
  }, 6000)
  return 'ok'
})()
