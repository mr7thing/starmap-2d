/**
 * 探针：快档拖动时，把「到底有几块画布、谁在画、场上有什么」摊开。
 *
 * 画面上冒出没交代的字，得先知道它是谁画的。
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
    const canvases = [...document.querySelectorAll('canvas')].map(
      (el) => `${el.className} ${el.width}x${el.height} @${el.style.left || '0'},${el.style.top || '0'} z${getComputedStyle(el).zIndex} disp${getComputedStyle(el).display}`,
    )
    const dbg = j.debug()
    const st = j.debug().scene
    const host = document.createElement('div')
    host.id = 'probe-out'
    host.dataset.probe = JSON.stringify(
      {
        view: j.view,
        canvases,
        cruise: dbg.cruise
          ? {
              count: dbg.cruise.count,
              seg: dbg.cruise.seg,
              live: dbg.cruise.live.map((l) => `${l.kind}#${l.k + 1} r${l.r} a${l.alpha.toFixed(2)}`),
            }
          : null,
        scene: st ? { index: st.index, scroll: st.scroll, light: st.light } : null,
        bodyView: document.body.dataset.view,
      },
      null,
      1,
    )
    host.style.display = 'none'
    document.body.append(host)
  }, 9000)
  return 'ok'
})()
