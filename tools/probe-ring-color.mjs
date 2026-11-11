/**
 * 探针：环离场时颜色怎么变 —— 读画布像素，不靠眼睛。
 *
 * 章名环从光心往外涨，涨到满屏停住，然后**换色 + 变淡**化掉。
 * 这个探针每 400ms 在环线上取一圈像素，找出最亮的那一个，
 * 记下它的 RGB —— 于是「冰蓝 → 靛青」这条曲线就变成一串数字。
 *
 * 用法：
 *   node tools/probe.mjs "http://127.0.0.1:4203/?cruise=1" tools/probe-ring-color.mjs 26000
 */
;(() => {
  const j = window.journey
  const canvas = document.querySelector('.sm2-cruise__canvas')
  if (!canvas || !j) return 'no-canvas'
  const ctx = canvas.getContext('2d')
  const rows = []
  const started = performance.now()
  const id = setInterval(() => {
    const c = j.debug().cruise
    if (!c) return
    const hops = c.live.filter((l) => l.kind === 'hop')
    if (!hops.length) return
    // 取半径最大的那枚 —— 离场中的环都涨到满屏了
    const hop = hops.reduce((a, b) => (b.r > a.r ? b : a))
    const dpr = canvas.width / parseFloat(canvas.style.width || '1')
    // 每个角度取一小块里最亮的像素 —— 环的笔画只有 2~3px 宽，
    // 取单个点会落到笔画旁边去
    const hits = []
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2
      const x = Math.round((c.light[0] + Math.cos(a) * hop.r) * dpr)
      const y = Math.round((c.light[1] + Math.sin(a) * hop.r) * dpr)
      if (x < 1 || y < 1 || x >= canvas.width - 1 || y >= canvas.height - 1) continue
      const d = ctx.getImageData(x - 1, y - 1, 3, 3).data
      let best = null
      for (let k = 0; k < 9; k++) {
        const r = d[k * 4]
        const g = d[k * 4 + 1]
        const b = d[k * 4 + 2]
        const sum = r + g + b
        if (!best || sum > best.sum) best = { sum, r, g, b }
      }
      if (best) hits.push(best)
    }
    if (hits.length < 8) return
    // **取中位数，不取最亮** —— 环的笔画绕一圈都在，
    // 照片只占几个角度，最亮的那个八成是照片的边
    const mid = (key) => {
      const v = hits.map((h) => h[key]).sort((a, b) => a - b)
      return v[Math.floor(v.length / 2)] ?? 0
    }
    rows.push({
      t: +((performance.now() - started) / 1000).toFixed(1),
      r: Math.round(hop.r),
      a: +hop.alpha.toFixed(2),
      rgb: [mid('r'), mid('g'), mid('b')],
    })
  }, 400)
  setTimeout(() => {
    clearInterval(id)
    const host = document.createElement('div')
    host.id = 'probe-out'
    host.dataset.probe = JSON.stringify(rows)
    host.style.display = 'none'
    document.body.append(host)
  }, 24000)
  return 'ok'
})()
