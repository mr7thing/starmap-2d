/**
 * 探针：一级场景的「叠着 → 拉开」。
 *
 * `?motion=1` 晃动指针，环就一个一个拉开；不带参数就只是叠着不动。
 */
;(() => {
  const c = document.querySelector('.sm2-scene__canvas')
  const motion = new URLSearchParams(location.search).get('motion') === '1'
  let id = 0
  if (motion && c) {
    const W = innerWidth
    const H = innerHeight
    let x = W * 0.5
    let y = H * 0.5
    let t = 0
    id = setInterval(() => {
      t += 0.2
      x = W * 0.5 + Math.cos(t) * W * 0.3
      y = H * 0.5 + Math.sin(t * 0.8) * H * 0.25
      c.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }))
    }, 16)
  }
  setTimeout(() => {
    clearInterval(id)
    const s = window.journey.debug().scene
    const host = document.createElement('div')
    host.id = 'probe-out'
    host.dataset.probe = JSON.stringify({
      open: Number(s.open.toFixed(2)),
      index: s.index,
      light: s.light.map((v) => Math.round(v)),
    })
    host.style.display = 'none'
    document.body.append(host)
  }, 9000)
  return 'ok'
})()
