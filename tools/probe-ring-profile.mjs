/**
 * 探针：径向剖面 —— 环线上内外 12px 的颜色分布。
 *
 * 用来定位「环的笔画到底在哪一格」。
 * 单点取色会踩坑：环笔画只有 2~3px 宽，照片又比它亮，
 * 取到的很可能不是环。
 *
 * 用法：
 *   node tools/probe.mjs "http://127.0.0.1:4203/?cruise=1" tools/probe-ring-profile.mjs 20000
 */
;(() => {
  const j = window.journey
  const canvas = document.querySelector('.sm2-cruise__canvas')
  if (!canvas || !j) return 'no-canvas'
  const ctx = canvas.getContext('2d')
  let done = false
  const id = setInterval(() => {
    if (done) return
    const c = j.debug().cruise
    if (!c) return
    const hops = c.live.filter((l) => l.kind === 'hop')
    if (!hops.length) return
    const hop = hops.reduce((a, b) => (b.r > a.r ? b : a))
    // 等那枚**已经涨到满屏、正在离场**的环淡到一半以下 ——
    // 这时候「有没有变色」才看得出来
    if (hop.r < 150 || hop.alpha > 0.45 || hop.alpha < 0.05) return
    done = true
    clearInterval(id)
    const dpr = canvas.width / parseFloat(canvas.style.width || '1')
    const profile = []
    for (let off = -12; off <= 12; off++) {
      const rad = hop.r + off
      const hits = []
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2
        const x = Math.round((c.light[0] + Math.cos(a) * rad) * dpr)
        const y = Math.round((c.light[1] + Math.sin(a) * rad) * dpr)
        if (x < 1 || y < 1 || x >= canvas.width - 1 || y >= canvas.height - 1) continue
        const d = ctx.getImageData(x - 1, y - 1, 3, 3).data
        let best = null
        for (let k = 0; k < 9; k++) {
          const sum = d[k * 4] + d[k * 4 + 1] + d[k * 4 + 2]
          if (!best || sum > best.sum) best = { sum, rgb: [d[k * 4], d[k * 4 + 1], d[k * 4 + 2]] }
        }
        if (best) hits.push(best.rgb)
      }
      hits.sort((p, q) => p[0] + p[1] + p[2] - (q[0] + q[1] + q[2]))
      const med = hits[Math.floor(hits.length / 2)] ?? [0, 0, 0]
      profile.push({ off, rgb: med, n: hits.length })
    }
    const host = document.createElement('div')
    host.id = 'probe-out'
    host.dataset.probe = JSON.stringify({
      alpha: +hop.alpha.toFixed(2),
      r: Math.round(hop.r),
      dpr,
      profile,
    })
    host.style.display = 'none'
    document.body.append(host)
  }, 120)
  setTimeout(() => clearInterval(id), 22000)
  return 'ok'
})()
