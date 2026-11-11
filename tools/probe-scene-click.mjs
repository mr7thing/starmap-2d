/**
 * 探针：一级场景点一下，会不会真的进光隧。
 *
 * 先晃动把环拉开，再按已知位置点第一枚环，
 * 然后看 journey.view 是不是 cruise。
 */
;(() => {
  const c = document.querySelector('.sm2-scene__canvas')
  if (!c) return 'no canvas'
  const W = innerWidth
  const H = innerHeight
  let x = W * 0.5
  let y = H * 0.5
  let t = 0
  const id = setInterval(() => {
    t += 0.2
    x = W * 0.5 + Math.cos(t) * W * 0.3
    y = H * 0.5 + Math.sin(t * 0.8) * H * 0.25
    c.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }))
  }, 16)

  setTimeout(() => {
    clearInterval(id)
    const before = window.journey.view
    // 第一枚环展开后的位置：左边那一枚
    const panelW = Math.min(260, Math.max(0, W - 56))
    const usable = W - panelW - 28 - 48
    const ringX = Math.max(104 * 1.5, usable * 0.38)
    const ringY = H * 0.5
    c.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: ringX, clientY: ringY, bubbles: true }),
    )
    setTimeout(() => {
      const s = window.journey.debug().scene
      const host = document.createElement('div')
      host.id = 'probe-out'
      host.dataset.probe = JSON.stringify({
        viewBefore: before,
        viewAfter: window.journey.view,
        cruiseSeg: window.journey.debug().cruise?.seg ?? null,
        open: Number(s.open.toFixed(2)),
        clickAt: [Math.round(ringX), Math.round(ringY)],
      })
      host.style.display = 'none'
      document.body.append(host)
    }, 600)
  }, 5000)
  return 'ok'
})()
