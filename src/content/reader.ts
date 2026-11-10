/**
 * 内容读取器 —— 目录 → Manifest。Node 端，纯函数，无 CLI。
 *
 * 站点在构建脚本里 `import { readStations } from '@uncle7/starmap/content'` 调一次即可。
 * 它不是工具，因为它**不做判断**：不生成文案、不改图片、不补默认值。
 * 那些是「加工技能」的职责，不是库的职责。
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'
import type { ImageRef, Manifest, Station, Tier } from '../types.ts'
import { validateManifest } from '../types.ts'

const EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'])

/** 目录名 → tier。与展示层级一一对应，这个映射是整个 LOD 的来源。 */
const TIER_DIRS: [string, Tier][] = [
  ['highlight', 0],
  ['overview', 1],
  ['details', 2],
]

// 目录名的容错：早期笔误（detailes）与常见变体。
const TIER_ALIASES: Record<string, Tier> = {
  highlight: 0,
  highlights: 0,
  overview: 1,
  overviews: 1,
  details: 2,
  detailes: 2,
  detail: 2,
}

export interface ReadOptions {
  /** 只要这几个站（按 id）。缺省全要。 */
  only?: string[]
  /** 图片 src 的前缀。缺省相对 manifest.json。 */
  base?: string
}

/**
 * 极简 front matter 解析：只支持 `key: value` 与 `- 元素` 两种行。
 * 不引 YAML 依赖，是因为内容规范本来就不需要嵌套结构 ——
 * 需要嵌套说明这份规范该改，不该让解析器变复杂。
 */
function parseFrontMatter(src: string): { data: Record<string, string>; body: string } {
  if (!src.startsWith('---')) return { data: {}, body: src }
  const end = src.indexOf('\n---', 3)
  if (end === -1) return { data: {}, body: src }

  const head = src.slice(3, end)
  const body = src.slice(end + 4).replace(/^\r?\n/, '')
  const data: Record<string, string> = {}

  let key: string | null = null
  for (const raw of head.split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (!line.trim() || line.trim().startsWith('#')) continue
    const item = /^\s*-\s+(.*)$/.exec(line)
    if (item && key) {
      const cur = data[key]!
      data[key] = cur ? `${cur}\n${item[1]!.trim()}` : item[1]!.trim()
      continue
    }
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (kv) {
      key = kv[1]!
      data[key] = kv[2]!.trim()
    }
  }
  return { data, body }
}

function asBool(v: string | undefined): boolean | undefined {
  if (v === undefined) return undefined
  return v === 'true' || v === 'yes' || v === '1'
}

async function readImages(dir: string, base: string): Promise<ImageRef[]> {
  const out: ImageRef[] = []

  for (const [dirName, tier] of TIER_DIRS) {
    const aliasKey = dirName === 'details' ? 'detailes' : dirName
    const candidates = [dirName, aliasKey]
    let real: string | null = null
    for (const c of candidates) {
      const p = join(dir, c)
      try {
        if ((await stat(p)).isDirectory()) {
          real = c
          break
        }
      } catch {
        /* 试下一个 */
      }
    }
    if (!real) continue

    const files = (await readdir(join(dir, real)))
      .filter((f: string) => EXTS.has(extname(f).toLowerCase()))
      .sort()

    for (const f of files) out.push({ src: `${base}/${real}/${f}`, tier })
  }

  // 容错目录：不在标准四层里的图片，归入 details，不静默丢弃。
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !EXTS.has(extname(entry.name).toLowerCase())) continue
    out.push({ src: `${base}/${entry.name}`, tier: 2 })
  }

  return out
}

/** 读一个站点目录。 */
export async function readStation(dir: string, base: string): Promise<Station> {
  const readme = await readFile(join(dir, 'README.md'), 'utf8')
  const { data, body } = parseFrontMatter(readme)
  const id = data['id'] ?? dir.split(/[\\/]/).pop()!

  // 图片 URL 必须带上 `images/` 这一层，否则 manifest 里的路径和磁盘上的对不上 ——
  // 表现是「接口返回 200，内容却是宿主的兜底页」，很容易被当成服务器问题查错方向。
  const images = await readImages(
    join(dir, 'images'),
    base ? `${base}/${id}/images` : `${id}/images`,
  )

  const station: Station = {
    id,
    title: data['title'] ?? id,
    images,
  }

  for (const k of ['date', 'end', 'place', 'short', 'role', 'audience', 'lead', 'summary'] as const) {
    const v = data[k]
    if (v) station[k] = v
  }
  const draft = asBool(data['draft'])
  if (draft) station.draft = true

  // 正文（概要等）作为 summary 的补充：front matter 没写 summary 时用正文首段。
  if (!station.summary) {
    const first = body
      .split(/\r?\n\r?\n/)
      .map((p) => p.trim())
      .find((p) => p && !p.startsWith('#'))
    if (first) station.summary = first.replace(/\r?\n/g, ' ')
  }

  return station
}

/** 读整个 stations/ 目录。 */
export async function readStations(root: string, options: ReadOptions = {}): Promise<Manifest> {
  const base = options.base ?? 'stations'
  const entries = await readdir(root, { withFileTypes: true })
  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'))
    .map((e) => e.name)

  const picked = options.only ? dirs.filter((d) => options.only!.includes(d)) : dirs
  if (picked.length === 0) throw new Error(`${root} 下没有找到任何站点目录`)

  const stations: Station[] = []
  // 只传 base，站点这一段由 readStation 用 id 拼 —— 拼两次会变成 /id/id/images
  for (const d of picked) stations.push(await readStation(join(root, d), base))

  const title = titleFrom(root)
  return validateManifest({ title, stations })
}

function titleFrom(root: string): string | undefined {
  const name = root.split(/[\\/]/).pop() ?? ''
  return name === 'stations' ? undefined : name
}
