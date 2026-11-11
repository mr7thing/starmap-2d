/**
 * 探针：点导航页面板里的站点列表，能不能进那一站的光隧。
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
    const items = [...document.querySelectorAll('.sm2-scene__item')]
    const before = window.journey.view
    const shown = items.filter((el) => el.style.display !== 'none').length
    // 点第 3 项 —— 「临平科技馆 · AIGC 共同创作」
    items[2]?.click()
    setTimeout(() => {
      const host = document.createElement('div')
      host.id = 'probe-out'
      host.dataset.probe = JSON.stringify({
        viewBefore: before,
        viewAfter: window.journey.view,
        cruiseSeg: window.journey.debug().cruise?.seg ?? null,
        itemsShown: shown,
        itemsTotal: items.length,
        clickedText: items[2]?.textContent ?? null,
      })
      host.style.display = 'none'
      document.body.append(host)
    }, 600)
  }, 4000)
  return 'ok'
})()
