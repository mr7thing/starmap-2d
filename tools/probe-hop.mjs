/**
 * 探针：盯住章名环的半径随时间怎么走。
 *
 * 要看三件事：
 * 1. 半径是不是跟照片同速在涨（涨得快不快）
 * 2. 涨到满屏（= min(屏宽, 屏高) / 2）之后**停住**不再涨
 * 3. 停住之后才开始慢慢化掉（alpha 往下走）
 *
 * 每 0.4 秒采一次，采满 26 秒。
 */
;(() => {
  const samples = []
  const t0 = performance.now()
  const id = setInterval(() => {
    const j = window.journey
    if (!j) return
    const c = j.debug().cruise
    if (!c) return
    const hops = c.live
      .filter((l) => l.kind === 'hop')
      .map((l) => `#${l.k + 1} age${l.age.toFixed(1)} r${l.r} a${l.alpha.toFixed(2)}`)
    samples.push(
      `${((performance.now() - t0) / 1000).toFixed(1)}s ${innerWidth}x${innerHeight} 第${c.seg + 1}站 在场${c.count} | ${hops.join(' | ')}`,
    )
  }, 400)
  setTimeout(() => {
    clearInterval(id)
    const host = document.createElement('div')
    host.id = 'probe-out'
    host.dataset.probe = samples.join('\n')
    host.style.display = 'none'
    document.body.append(host)
  }, 26000)
  return 'ok'
})()
