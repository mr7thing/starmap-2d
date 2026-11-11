/**
 * 页面脚本：把画面卡在某个时刻冻住（给 shot.mjs 用）。
 *
 * 用法：
 *   node tools/shot.mjs "http://127.0.0.1:4203/?cruise=1" out.png 2000 @tools/freeze-at.mjs
 *
 * 两种卡法（用 URL 参数选）：
 *   `?mode=exit`  —— 等章名环淡到一半时冻住（看「变色 + 变淡」）
 *   `?mode=flash` —— 等环刚出生那一下时冻住（看出场辉光）
 *   `?exitAlpha=0.25` —— 指定淡到多少时冻住
 */
;(async () => {
  const j = window.journey
  const q = new URLSearchParams(location.search)
  const mode = q.get('mode') ?? 'exit'
  const want = Number(q.get('exitAlpha') ?? '0.4')
  for (let i = 0; i < 1200; i++) {
    const c = j.debug().cruise
    if (c) {
      const hops = c.live.filter((l) => l.kind === 'hop')
      if (mode === 'flash') {
        // 环刚出生 —— 辉光最亮的那一下
        const fresh = hops.find((l) => l.age < 0.3 && l.age >= 0)
        if (fresh) {
          j.freeze()
          return `frozen: flash age${fresh.age.toFixed(2)} r${Math.round(fresh.r)}`
        }
      } else {
        // 已经涨到满屏、正在离场的那枚
        const hop = hops.reduce((a, b) => (!a || b.r > a.r ? b : a), null)
        if (hop && hop.r > 150 && hop.alpha > 0.1 && hop.alpha < want) {
          j.freeze()
          return `frozen: r${Math.round(hop.r)} a${hop.alpha.toFixed(2)}`
        }
      }
    }
    await new Promise((r) => setTimeout(r, 40))
  }
  return 'timeout'
})()
