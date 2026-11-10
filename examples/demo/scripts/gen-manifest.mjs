/**
 * 生成 demo 用的 manifest.json。
 *
 * 这不是 CLI 工具，只是一个构建脚本 —— 它唯一做的事就是把
 * 标准目录读成 manifest，交给库消费。任何判断都不在这里做。
 */
import { readStations } from '../../../src/content/reader.ts'
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const stationsRoot = resolve(here, '../../../../stations')
const out = resolve(here, '../public/manifest.json')

const manifest = await readStations(stationsRoot, {
  only: process.argv[2] ? process.argv[2].split(',') : undefined,
  // 素材目录被 vite 的 publicDir 挂在站点根，所以 URL 是 /<station>/<tier>/<file>。
  // 正式接入时这个前缀由宿主的静态资源根决定，库本身不关心。
  base: '/stations',
})

await mkdir(dirname(out), { recursive: true })
await writeFile(out, JSON.stringify(manifest, null, 2), 'utf8')

console.log(
  `✓ ${manifest.stations.length} 站 → ${out}\n` +
    manifest.stations
      .map(
        (s, i) =>
          `  ${String(i + 1).padStart(2)}. ${s.date ?? '——————'}  ${s.title}  ` +
          `[${s.images.filter((x) => x.tier === 0).length}/${s.images.filter((x) => x.tier === 1).length}/${s.images.filter((x) => x.tier === 2).length}] 略/览/详`,
      )
      .join('\n'),
)
