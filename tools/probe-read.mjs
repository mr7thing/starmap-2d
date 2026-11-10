/**
 * 探针：读数与提示都摆在哪儿。
 *
 * 库自带的 `.sm2-scene__read` 和 demo 页面自己的 `#readout` 曾经在同一个位置
 * → 叠字。这个探针用来确认现在各有几个、各在哪儿。
 *
 * 两种入口都能跑：
 * - `probe.mjs`（读 DOM 里的 `data-probe`）
 * - `shot.mjs`（直接拿返回值）
 */
;(() => {
  const pick = (sel) =>
    [...document.querySelectorAll(sel)].map((el) => {
      const r = el.getBoundingClientRect()
      return {
        sel,
        text: (el.textContent || '').slice(0, 80),
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      }
    })
  const out = JSON.stringify({
    libRead: pick('.sm2-scene__read, .sm2-cruise__read'),
    demoRead: pick('#readout'),
    hint: pick('.sm2-scene__hint, .sm2-cruise__hint, #hint'),
  })

  // 写进 DOM，probe.mjs 读得到
  const host = document.createElement('div')
  host.id = 'probe-out'
  host.dataset.probe = out
  host.style.display = 'none'
  document.body.append(host)

  return out
})()
