/**
 * 探针：墨色换色到底生效没有 —— 在一张干净的画布上画一枚环，读回像素。
 *
 * 为什么不在巡航画面里取色：那儿有照片、有背景光环、还有字，
 * 取到的十有八九不是环。**单独画一枚环**才是干净的对照。
 *
 * 用法：
 *   node tools/probe.mjs "http://127.0.0.1:4203/?cruise=1" tools/probe-ink.mjs 6000
 */
;(async () => {
  // Vite 的根在 examples/demo，源码要走 /@fs/ 才能拿到
  const m = await import('/@fs/C:/Users/dream/Desktop/works/dj-intro/starmap-2d/src/ring.ts')

  /** 在干净的画布上画一枚环，取笔画上的像素 */
  function sample(ink, alpha) {
    const c = document.createElement('canvas')
    c.width = 400
    c.height = 400
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#04070e'
    ctx.fillRect(0, 0, 400, 400)
    m.drawBadge(ctx, {
      cx: 200,
      cy: 200,
      r: 150,
      alpha,
      title: '安徽建筑大学',
      meta: '2024.05 · 合肥',
      bold: true,
      ink,
    })
    const hits = []
    // 避开整 10° 的刻度位置 —— 那里叠着刻度，取到的是刻度的色
    for (const deg of [3, 7, 13, 17, 23, 27]) {
      const a = (deg * Math.PI) / 180
      const x = Math.round(200 + Math.cos(a) * 150)
      const y = Math.round(200 + Math.sin(a) * 150)
      const d = ctx.getImageData(x - 1, y - 1, 3, 3).data
      let best = null
      for (let k = 0; k < 9; k++) {
        const sum = d[k * 4] + d[k * 4 + 1] + d[k * 4 + 2]
        if (!best || sum > best.sum) best = { sum, rgb: [d[k * 4], d[k * 4 + 1], d[k * 4 + 2]] }
      }
      if (best) hits.push(best.rgb)
    }
    hits.sort((p, q) => p[0] + p[1] + p[2] - (q[0] + q[1] + q[2]))
    return hits[Math.floor(hits.length / 2)] ?? [0, 0, 0]
  }

  const host = document.createElement('div')
  host.id = 'probe-out'
  host.dataset.probe = JSON.stringify({
    mix: {
      'k=0': m.mixInk(m.RING_INK, m.RING_INK_COOL, 0).body,
      'k=0.25': m.mixInk(m.RING_INK, m.RING_INK_COOL, 0.25).body,
      'k=0.5': m.mixInk(m.RING_INK, m.RING_INK_COOL, 0.5).body,
      'k=0.75': m.mixInk(m.RING_INK, m.RING_INK_COOL, 0.75).body,
      'k=1': m.mixInk(m.RING_INK, m.RING_INK_COOL, 1).body,
    },
    // 画出来的实际像素
    drawn: {
      base: sample(m.RING_INK, 1),
      half: sample(m.mixInk(m.RING_INK, m.RING_INK_COOL, 0.5), 1),
      cool: sample(m.RING_INK_COOL, 1),
      baseHalfAlpha: sample(m.RING_INK, 0.44),
      halfHalfAlpha: sample(m.mixInk(m.RING_INK, m.RING_INK_COOL, 0.5), 0.44),
    },
  })
  host.style.display = 'none'
  document.body.append(host)
  return 'ok'
})()
