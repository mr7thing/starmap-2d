/**
 * 探针：记录每一站的切换时刻，看站与站之间是不是真的空了一拍。
 *
 * 记两件事：
 * - 这一站最后一张照片消失的时刻
 * - 下一站的环出场的时刻
 * 两者之差就是「空的那一拍」。
 */
;(() => {
  const j = window.journey
  if (!j) return 'journey 未挂上'
  const marks = []
  let lastSeg = -1
  let lastImgSeen = 0
  const t0 = performance.now()
  const at = () => ((performance.now() - t0) / 1000).toFixed(2)
  const id = setInterval(() => {
    const c = j.debug().cruise
    if (!c) return
    if (c.seg !== lastSeg) {
      if (lastSeg >= 0) {
        // 上一站**最后**一张照片，到这一刻已经活了多少秒 —— 这就是「空的那一拍」
        const prev = c.live.filter((l) => l.kind === 'img' && l.k === lastSeg)
        const youngest = prev.reduce((m, l) => Math.min(m, l.age), 99)
        marks.push(`站${c.seg + 1} 的环出场时，上一站最后一张已活 ${youngest.toFixed(2)}s`)
      }
      lastSeg = c.seg
    }
  }, 20)
  setTimeout(() => {
    clearInterval(id)
    const host = document.createElement('div')
    host.id = 'probe-out'
    host.dataset.probe = JSON.stringify(marks)
    host.style.display = 'none'
    document.body.append(host)
  }, 26000)
  return 'ok'
})()
