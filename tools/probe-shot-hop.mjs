/**
 * 探针：等到章名环到了某个状态就冻结画面，好让截图能定在那一帧。
 *
 * `?shot=full` —— 环刚涨满、还是实心的一瞬
 * `?shot=fade` —— 满屏之后化到一半
 */
;(() => {
  const mode = new URLSearchParams(location.search).get('shot') ?? 'full'
  const j = window.journey
  if (!j) return 'no journey'
  const id = setInterval(() => {
    const c = j.debug().cruise
    if (!c) return
    const hops = c.live.filter((l) => l.kind === 'hop')
    let hit = null
    if (mode === 'full') {
      hit = hops.find((l) => l.r >= 252 && l.alpha > 0.97)
    } else if (mode === 'multi') {
      // 场上同时挂着几枚环时 —— 看同心圆叠起来什么样
      hit = hops.length >= 3 ? hops[0] : null
    } else {
      hit = hops.find((l) => l.r >= 252 && l.alpha < 0.62 && l.alpha > 0.32)
    }
    if (hit) {
      clearInterval(id)
      j.freeze()
    }
  }, 40)
  return 'ok'
})()
