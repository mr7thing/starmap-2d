/**
 * 环 —— 一级场景和二级光隧共用的画法。
 *
 * 一枚环徽章 = **外弧站名 + 内弧序号·时间·地点**，环心留给照片（想放才放）。
 *
 * 抽出来是因为两处要用同一套：一级是「一排环」的场景，
 * 二级是「环带着文字飞出来」的章节标记。字距、描边、转角三件事只做一次。
 */

export interface RingInk {
  /** 环本体 */
  body: string
  /** 内圈 */
  inner: string
  /** 刻度 */
  tick: string
  /** 长刻度 */
  tickLong: string
  /** 外弧站名 */
  title: string
  /** 内弧时间地点 */
  meta: string
}

export const RING_INK: RingInk = {
  body: 'rgba(176,230,255,.78)',
  inner: 'rgba(150,206,246,.34)',
  tick: 'rgba(132,192,236,.32)',
  tickLong: 'rgba(186,236,255,.66)',
  title: 'rgba(234,247,255,.95)',
  meta: 'rgba(178,224,255,.95)',
}

export const RING_FONT = 'system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif'

/** 环本体：双圈 + 刻度。像一个仪表的表圈 */
export function drawRingBody(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  alpha: number,
  /** 线宽倍率 —— 章名环要粗一档，才能跟背景装饰环分开 */
  weight = 1,
): void {
  if (alpha <= 0.02 || r <= 2) return
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.lineWidth = 1.6 * weight
  ctx.strokeStyle = RING_INK.body
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 1 * weight
  ctx.strokeStyle = RING_INK.inner
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.955, 0, Math.PI * 2)
  ctx.stroke()
  // 刻度：36 格，每 6 格一道长刻
  // 刻度不能太长 —— 外弧站着字，刻度顶到字上就糊了
  const ticks = r > 150 ? 48 : 36
  for (let i = 0; i < ticks; i++) {
    const t = (i / ticks) * Math.PI * 2
    const long = i % (ticks / 12) === 0
    const len = long ? 11 : 5
    ctx.strokeStyle = long ? RING_INK.tickLong : RING_INK.tick
    ctx.lineWidth = 1 * weight
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(t) * (r - len / 2), cy + Math.sin(t) * (r - len / 2))
    ctx.lineTo(cx + Math.cos(t) * (r + len / 2), cy + Math.sin(t) * (r + len / 2))
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * 沿一段圆弧排字。
 *
 * 逐字摆：每个字转到自己的切线角度再画。
 *
 * `dir` 决定走哪个方向，顺着角度增大走（`dir = 1`）或逆着走（`dir = -1`）。
 * **两种方向的字都是正着念的**，因为转角取的是各自方向的切线角：
 *
 * ```
 *   dir = 1  θ = ca + π/2    上弧：字站在环外侧，从左往右读
 *   dir = -1 θ = ca - π/2    下弧：字朝环内侧立，从左往右读
 * ```
 *
 * 用错一条就会把字倒过来 —— 下弧最容易倒。
 *
 * `maxSpan` 是这段弧最多能占多少弧度。字太长就缩字号，
 * 不缩的话一圈字会首尾相接叠成一坨。
 */
export function arcText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  r: number,
  mid: number,
  dir: number,
  size: number,
  color: string,
  font = RING_FONT,
  maxSpan = Math.PI * 0.62,
  /** 字重（CSS font-weight） */
  weight = 400,
): void {
  if (!text || r <= 4) return
  ctx.save()
  ctx.font = `${weight} ${size}px ${font}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const chars = [...text]
  let widths = chars.map((c) => ctx.measureText(c).width)
  let total = widths.reduce((a, b) => a + b, 0)
  const span = total / r
  if (span > maxSpan && span > 0) {
    const k = maxSpan / span
    ctx.font = `${weight} ${Math.max(7, size * k)}px ${font}`
    widths = chars.map((c) => ctx.measureText(c).width)
    total = widths.reduce((a, b) => a + b, 0)
  }
  // 环上的字会压到浅色的照片上（海报、课堂照）—— 没有底板，
  // 就给每个字描一圈深色边。描边是跟着字走的，不是块板。
  ctx.lineJoin = 'round'
  ctx.miterLimit = 2
  ctx.strokeStyle = 'rgba(3,10,20,.82)'
  ctx.lineWidth = Math.max(1.5, size * 0.17)
  const totalSpan = total / r
  let a = mid - (dir * totalSpan) / 2
  for (let i = 0; i < chars.length; i++) {
    const step = widths[i]! / r
    const ca = a + (dir * step) / 2
    ctx.save()
    ctx.translate(cx + Math.cos(ca) * r, cy + Math.sin(ca) * r)
    ctx.rotate(ca + (dir * Math.PI) / 2)
    ctx.strokeText(chars[i]!, 0, 0)
    ctx.fillStyle = color
    ctx.fillText(chars[i]!, 0, 0)
    ctx.restore()
    a += dir * step
  }
  ctx.restore()
}

/** 一枚环徽章 */
export interface Badge {
  cx: number
  cy: number
  r: number
  alpha: number
  /** 外弧：站名 */
  title: string
  /** 序号 · 时间 · 地点 */
  meta: string
  /** 站名字号（不给就按半径算） */
  titleSize?: number
  /** 时间地点字号 */
  metaSize?: number
  /** 外弧的弧长上限 */
  titleSpan?: number
  /** 内弧的弧长上限 */
  metaSpan?: number
  /**
   * 时间地点摆哪条弧。
   *
   * - `inner`（默认）：环内下弧 —— 环是徽章时好看，两行字被环框住
   * - `outer`：环外下弧 —— 环心要留给别的东西飞过时用
   */
  metaOn?: 'inner' | 'outer'
  /**
   * 文字的模糊半径（px）。
   *
   * 环飞远的时候字要慢慢失焦 —— 不用 blur 滤镜也能做：
   * 字号跟着缩、描边跟着淡，字就「化」掉了。
   */
  blur?: number
  /**
   * 文字单独的透明度（缺省跟环一样）。
   *
   * 一枚环可以「圈还在、字已经走了」——
   * 旧的章名环只剩圈，名字交给当前站的那一枚。
   */
  textAlpha?: number
  /**
   * 站名摆哪条弧。
   *
   * - `top`（默认）：环外上弧 —— 名字在头顶
   * - `bottom`：环外下弧 —— 名字在时间地点的下面，同一段环线之下
   */
  titleOn?: 'top' | 'bottom'
  /**
   * 加粗：环本体粗一档、字用粗字重。
   *
   * 章名环要跟背景那些装饰环分得开 —— 不然一屏套十几个环，
   * 哪个是站名、哪个是装饰，看不出来。
   */
  bold?: boolean
}

/** 画一枚环徽章：本体 + 站名 + 时间地点 */
export function drawBadge(ctx: CanvasRenderingContext2D, b: Badge): void {
  if (b.alpha <= 0.02) return
  const bold = b.bold === true
  drawRingBody(ctx, b.cx, b.cy, b.r, b.alpha, bold ? 1.7 : 1)
  const textAlpha = b.textAlpha ?? b.alpha
  if (textAlpha <= 0.02) return
  ctx.save()
  ctx.globalAlpha = textAlpha
  const titleSize = b.titleSize ?? Math.max(9, Math.min(48, b.r * 0.085))
  const metaSize = b.metaSize ?? Math.max(8, Math.min(28, b.r * 0.052))
  // 模糊 = 字号缩小 + 描边变淡。字「化」掉，不是糊成一团。
  const blur = b.blur ?? 0
  const shrink = 1 - Math.min(0.45, blur * 0.14)
  const weight = bold ? 700 : 400
  // 站名：默认在环外上弧；'bottom' 时落到环外下弧（时间地点的下面）
  const titleBottom = b.titleOn === 'bottom'
  arcText(
    ctx,
    b.title,
    b.cx,
    b.cy,
    titleBottom ? b.r * 1.2 : b.r * 1.1,
    titleBottom ? Math.PI / 2 : -Math.PI / 2,
    titleBottom ? -1 : 1,
    titleSize * shrink,
    RING_INK.title,
    RING_FONT,
    b.titleSpan ?? Math.PI * 0.62,
    weight,
  )
  const outer = b.metaOn === 'outer'
  arcText(
    ctx,
    b.meta,
    b.cx,
    b.cy,
    outer ? b.r * 1.12 : b.r * 0.89,
    Math.PI / 2,
    -1,
    metaSize * shrink,
    RING_INK.meta,
    RING_FONT,
    b.metaSpan ?? Math.PI * (outer ? 0.6 : 0.55),
    weight,
  )
  ctx.restore()
}
