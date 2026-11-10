/**
 * 探针：数出牌节奏。
 *
 * 要看两件事：
 * 1. 指针不动时，出图是不是慢下来了
 * 2. 拖起来时，出图是不是跟上来了
 */
;(() => {
  const drag = new URLSearchParams(location.search).get('drag') === '1'
  const c = document.querySelector('.sm2-cruise__canvas')
  let id2 = 0
  if (drag && c) {
    const W = innerWidth
    const H = innerHeight
    let x = W * 0.5
    let y = H * 0.5
    let t = 0
    id2 = setInterval(() => {
      t += 0.16
      x = W * 0.5 + Math.cos(t) * W * 0.3
      y = H * 0.5 + Math.sin(t * 0.7) * H * 0.22
      c.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }))
    }, 16)
  }
  const samples = []
  const t0 = performance.now()
  const id = setInterval(() => {
    const c2 = window.journey.debug().cruise
    if (!c2) return
    const imgs = c2.live.filter((l) => l.kind === 'img').length
    const hops = c2.live.filter((l) => l.kind === 'hop').length
    samples.push(
      `${((performance.now() - t0) / 1000).toFixed(1)}s 档${c2.tier} 速${c2.speed.toFixed(0)} 在场${c2.count} 图${imgs} 环${hops}`,
    )
  }, 500)
  setTimeout(() => {
    clearInterval(id)
    clearInterval(id2)
    const host = document.createElement('div')
    host.id = 'probe-out'
    host.dataset.probe = samples.join('\n')
    host.style.display = 'none'
    document.body.append(host)
  }, 14000)
  return 'ok'
})()
