/**
 * 探针：拖动光隧，然后把在场元素的真实坐标写出来。
 *
 * 画面上「照片聚在一边」这种事，看图会看错，看数不会。
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
    t += 0.16
    x = W * 0.5 + Math.cos(t) * W * 0.3
    y = H * 0.5 + Math.sin(t * 0.7) * H * 0.22
    c.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }))
  }, 16)
  setTimeout(() => {
    clearInterval(id)
    const j = window.journey
    const s = j.debug().cruise
    const host = document.createElement('div')
    host.id = 'probe-out'
    host.dataset.probe = JSON.stringify({
      seg: s.seg,
      tier: s.tier,
      speed: Math.round(s.speed),
      flow: Math.round(s.flow),
      count: s.count,
      light: s.light.map((v) => Math.round(v)),
      live: s.live.map((l) => `${l.kind}#${l.k + 1} age${l.age.toFixed(1)} a${l.alpha.toFixed(2)} @${l.x},${l.y} r${l.r}`),
    })
    host.style.display = 'none'
    document.body.append(host)
  }, 4000)
  return 'ok'
})()
