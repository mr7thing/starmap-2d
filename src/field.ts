/**
 * 底子 —— 光与尘。
 *
 * 两个视图共用一套底：**光心周围一圈圈涨开的光环** + **往外冲的星尘**。
 *
 * 抽出来是因为两个视图必须长得一样 —— 同一个光心、同一种扩散节奏。
 * 换视图就换质感，会让人以为换了个产品。
 *
 * ## 光环与照片走同一条流
 *
 * 光环不是自己按秒长的 —— 它的半径由 `flow` 决定，
 * 而 `flow` 就是二级光隧里照片飞出去的那条流。
 * 所以光环和照片永远同步：照片往外飞，光圈就一圈圈涨开。
 *
 * ## 确定性
 *
 * 没有 Math.random()：星尘用固定种子的 mulberry32，
 * 每次重开的位置、角度、速度都一样，截图才可复现。
 */

/** 黄金角：星尘复位时按它散开，才不会挤成一束 */
const GOLDEN = 2.39996323

/** 第一圈光环的半径 —— 照片也从这个半径出生 */
export const HALO_R0 = 26
/** 光环的间距（px） */
export const HALO_GAP = 165
/** 同时在场的圈数 */
export const HALO_COUNT = 9
/** 光环铺开的总跨度（px）—— 涨过这个数就从里圈重新开始 */
export const HALO_SPAN = HALO_GAP * HALO_COUNT

export interface FieldOptions {
  /** 星尘颗粒数（档 0 时的基础值） */
  dustCount?: number
  /** 星尘往外冲的速度 */
  dustSpeed?: number
}

export interface Field {
  /**
   * 画一帧底子。
   *
   * @param dt 这一帧过了多少秒（冻结时传 0）
   * @param tier 当前档位 0/1/2 —— 越快放出来的尘越多
   * @param flow 流走过的距离（px）—— 光环按它涨开，和照片同流
   */
  draw(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    lx: number,
    ly: number,
    dt: number,
    tier: number,
    flow: number,
  ): void
}

export function createField(options: FieldOptions = {}): Field {
  const dustCount = options.dustCount ?? 240
  const dustSpeed = options.dustSpeed ?? 2.4

  // --- 星尘 ---
  const DUST: { ang: number; z: number; k: number }[] = (() => {
    const r = rng(0x9e3779b9)
    const out: { ang: number; z: number; k: number }[] = []
    for (let i = 0; i < 300; i++) {
      out.push({ ang: r() * Math.PI * 2, z: 0.6 + r() * 7.7, k: 0.7 + r() * 0.7 })
    }
    return out
  })()

  return {
    draw(ctx, w, h, lx, ly, dt, tier, flow) {
      // --- 光心那团辉光 ---
      const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, Math.max(w, h) * 0.62)
      g.addColorStop(0, 'rgba(130,205,255,.22)')
      g.addColorStop(0.16, 'rgba(74,146,214,.09)')
      g.addColorStop(0.55, 'rgba(30,70,120,.03)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)

      // --- 同心光环：从光心一圈圈涨开，越远越淡 ---
      // 半径由 flow 决定 —— 和照片飞出去的是同一条流。
      const base = HALO_R0 + flow
      ctx.lineWidth = 1
      for (let i = 0; i < HALO_COUNT; i++) {
        const r = ((base + i * HALO_GAP) % HALO_SPAN) + 20
        const a = 0.24 * Math.pow(Math.max(0, 1 - r / HALO_SPAN), 1.4)
        if (a <= 0.004) continue
        ctx.strokeStyle = `rgba(112,184,236,${a.toFixed(3)})`
        ctx.beginPath()
        ctx.arc(lx, ly, r, 0, Math.PI * 2)
        ctx.stroke()
      }

      // --- 星尘：往外冲的颗粒 ---
      const active = Math.min(
        DUST.length,
        Math.round(dustCount * (0.55 + tier * 0.3)),
      )
      for (let i = 0; i < active; i++) {
        const d = DUST[i]!
        d.z -= dustSpeed * d.k * dt
        if (d.z < 0.7) {
          d.z = 7.7 * (0.6 + (0.4 * ((i * 37) % 10)) / 10)
          d.ang = (i * GOLDEN) % (Math.PI * 2)
        }
        const r = 800 / d.z
        // 尾巴只有十几像素 —— 拉成几百像素就成了蜘蛛网，不是尘
        const len = 5 + 9 * (1 - d.z / 8.3)
        const al = Math.min(0.8, r / 320) * (1 - r / 1143)
        if (al <= 0.02) continue
        ctx.strokeStyle = `rgba(150,200,240,${(al * 0.42).toFixed(3)})`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(lx + Math.cos(d.ang) * r, ly + Math.sin(d.ang) * r)
        ctx.lineTo(
          lx + Math.cos(d.ang) * (r + len),
          ly + Math.sin(d.ang) * (r + len),
        )
        ctx.stroke()
      }
    },
  }
}

// ---------------------------------------------------------------------------

/** mulberry32：同一个种子永远同一串数 */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
