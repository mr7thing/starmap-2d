/**
 * 内容规范 —— 库的唯一输入契约。
 *
 * 一条原则：**能校验的绝不默认值。** 字段缺失有明确的降级路径，
 * 但字段写错必须报错，而不是悄悄按缺省渲染出一个错的页面。
 */

export type Tier = 0 | 1 | 2

export interface ImageRef {
  /** 已优化图片路径，浏览器可直接取用 */
  src: string
  /** 0=highlight 1=overview 2=details。目录分类同时就是 LOD 数据 */
  tier: Tier
  /** details 层文字 · 慢下来才浮现 */
  caption?: string
  srcSet?: string
}

export interface Station {
  id: string
  /** 站名。用于悬停提示与二级巡航，不一定上图 */
  title: string
  /** ISO 日期，排序唯一依据 */
  date?: string
  end?: string
  /** 场馆全名 —— 学校、博物馆、公司。给详情用，不上环 */
  place?: string
  /**
   * 显示用的地点 —— **城市名**。
   *
   * 环上、站点列表都用它：读者先知道「在哪座城」，再读名称。
   * 学校名、场馆全名不进这里 —— 那些进站名（`title`），以「·」区隔。
   * 缺省用 `place`。
   */
  short?: string
  role?: string
  audience?: string
  /** 打字机文字的来源 */
  lead?: string
  summary?: string
  /** 未校订的占位文案 · 页面打角标 */
  draft?: boolean
  /** 按 highlight → overview → details 拼好的有序队列 */
  images: ImageRef[]
}

export interface Manifest {
  title?: string
  stations: Station[]
}

// ---------------------------------------------------------------------------

const ID_RE = /^[a-z0-9][a-z0-9-]*$/
const ISO_RE = /^\d{4}-\d{2}(-\d{2})?$/

export class ManifestError extends Error {
  readonly path: string
  readonly reason: string

  constructor(path: string, reason: string) {
    super(`${path}：${reason}`)
    this.name = 'ManifestError'
    this.path = path
    this.reason = reason
  }
}

function bad(path: string, reason: string): never {
  throw new ManifestError(path, reason)
}

/** 校验并返回同一份对象。失败抛 `ManifestError`（带路径，便于定位到具体站）。 */
export function validateManifest(input: unknown): Manifest {
  if (typeof input !== 'object' || input === null) bad('$', '必须是对象')
  const m = input as Manifest

  if (!Array.isArray(m.stations)) bad('stations', '必须是数组')
  if (m.stations.length === 0) bad('stations', '至少要有一个站点')

  const seen = new Set<string>()
  m.stations.forEach((s, i) => {
    const at = `stations[${i}]`
    if (typeof s.id !== 'string' || !ID_RE.test(s.id))
      bad(`${at}.id`, `必须是 kebab-case，收到 ${JSON.stringify(s.id)}`)
    if (seen.has(s.id)) bad(`${at}.id`, `重复的 id「${s.id}」`)
    seen.add(s.id)

    if (typeof s.title !== 'string' || s.title.length === 0)
      bad(`${at}.title`, '必须是非空字符串')

    for (const k of ['date', 'end'] as const) {
      const v = s[k]
      if (v !== undefined && !ISO_RE.test(v))
        bad(`${at}.${k}`, `必须是 YYYY-MM 或 YYYY-MM-DD，收到 ${JSON.stringify(v)}`)
    }
    if (s.date && s.end && s.end < s.date)
      bad(`${at}.end`, '结束日期早于开始日期')

    if (!Array.isArray(s.images)) bad(`${at}.images`, '必须是数组')
    s.images.forEach((img, j) => {
      const p = `${at}.images[${j}]`
      if (typeof img.src !== 'string' || img.src.length === 0)
        bad(`${p}.src`, '必须是非空字符串')
      if (img.tier !== 0 && img.tier !== 1 && img.tier !== 2)
        bad(`${p}.tier`, `必须是 0 / 1 / 2，收到 ${JSON.stringify(img.tier)}`)
    })
  })

  // 排序：有 date 的按 date 升序在前，无 date 的保持原序跟在后面。
  // 不静默打乱 —— 调用方拿到的是确定的顺序。
  m.stations = sortStations(m.stations)
  return m
}

function sortStations(list: readonly Station[]): Station[] {
  const dated = list.filter((s) => s.date)
  const undated = list.filter((s) => !s.date)
  dated.sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0))
  return [...dated, ...undated]
}

/** 站点的图片队列按 tier 稳定排序，保证 highlight 一定在最前。 */
export function orderedImages(s: Station): ImageRef[] {
  return s.images
    .map((img, i) => ({ img, i }))
    .sort((a, b) => a.img.tier - b.img.tier || a.i - b.i)
    .map((x) => x.img)
}
