/**
 * 探针：二级的完整出场时序。
 *
 * 看三件事：
 * 1. 一站是不是**多张图**依次冒出来（不是一站一张）
 * 2. 章名环是不是和照片一样会消失
 * 3. 顺序是不是 [环][图…][环][图…]
 */
;(() => {
  const j = window.journey
  if (!j) return JSON.stringify({ error: 'journey 未挂上' })
  // 不动起手位置 —— URL 的 ?cruise= 已经把它放到位了
  const seen = []
  const id = setInterval(() => {
    const c = j.debug().cruise
    if (!c) return
    const line = c.live.map((l) => `${l.kind[0]}#${l.k + 1}`).join(' ')
    if (seen[seen.length - 1] !== line) seen.push(line)
  }, 50)
  setTimeout(() => {
    clearInterval(id)
    const host = document.createElement('div')
    host.id = 'probe-out'
    host.dataset.probe = JSON.stringify(seen)
    host.style.display = 'none'
    document.body.append(host)
  }, 9000)
  return 'ok'
})()
