/**
 * 探针：在二级光隧里模拟真实的指针移动，看「照片从鼠标位置不断飞出」的样子。
 *
 * 光隧的发牌靠指针位移（每走够 80px 发一张），
 * 静止截图只能看到保底定时器在发 —— 拖起来才是真的样子。
 */
;(() => {
  const c = document.querySelector('.sm2-cruise__canvas')
  if (!c) return 'no canvas'
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
  }, 9000)
  return 'ok'
})()
