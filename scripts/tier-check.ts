/**
 * 档位状态机的行为检查。
 *
 * 截图验不了「延迟起步」「最快档要按住」「停住回 L0」这几条 ——
 * 它们是时间上的性质，得用时间去试。
 *
 * 跑法：
 *   npx tsc scripts/tier-check.ts --outDir scripts/.out --module esnext \
 *     --target es2022 --moduleResolution bundler --rewriteRelativeImportExtensions --skipLibCheck
 *   node scripts/.out/scripts/tier-check.js
 */
import { TierTracker } from '../src/window.ts'

const DT = 1 / 60

interface Step {
  t: number
  ratio: number
}

/** 推一段恒定倍率的序列 */
function seg(t: number, ratio: number, seconds: number): Step[] {
  return Array.from({ length: Math.round(seconds / DT) }, (_, i) => ({ t: t + i * DT, ratio }))
}

/** 跑一遍时间轴，返回每帧的档位 */
function timeline(script: Step[]) {
  const tr = new TierTracker()
  return script.map((s) => ({ t: s.t, tier: tr.push(s.ratio, DT) }))
}

/** 取 t 时刻的档位（取不晚于 t 的最后一帧） */
function at(tl: { t: number; tier: number }[], t: number): number {
  let last = tl[0]!
  for (const s of tl) {
    if (s.t <= t + 1e-9) last = s
    else break
  }
  return last.tier
}

let failed = 0
function check(name: string, actual: number, expected: number) {
  const ok = actual === expected
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name} → 档 ${actual}（期望 ${expected}）`)
}

console.log('\n档位状态机检查')

// ① 慢速滑行 —— 从 L0 起步，不要因为「在动」就升档
{
  const tl = timeline(seg(0, 0.8, 2))
  check('① 慢滑（0.8 倍）2 秒后仍在 L0', at(tl, 2), 0)
}

// ② 快一下就停 —— 升档要**连续**快
{
  const tl = timeline([...seg(0, 3.5, 0.2), ...seg(0.2, 0, 1.5)])
  check('② 快 0.2 秒就停 → 升不上去', at(tl, 1.7), 0)
}

// ③ 中速持续滑 —— L1 要等 0.25 秒
{
  const tl = timeline(seg(0, 1.5, 1.5))
  check('③ 中速滑 0.24 秒 → 还是 L0', at(tl, 0.24), 0)
  check('③ 中速滑 0.30 秒 → 到 L1', at(tl, 0.3), 1)
}

// ④ 快速持续滑 —— L2 要等 0.35 秒（够快就直接奔 L2，不经过 L1）
{
  const tl = timeline(seg(0, 3.5, 2))
  check('④ 快滑 0.30 秒 → 还没到 L2', at(tl, 0.3), 0)
  check('④ 快滑 0.40 秒 → 到 L2', at(tl, 0.4), 2)
}

// ⑤ 刚到 L2 就减速 —— 最快档要按住 0.9 秒才准降
{
  const tl = timeline([...seg(0, 3.5, 0.4), ...seg(0.4, 1.0, 2)])
  check('⑤ 刚到 L2 就减速 → 1.0 秒时还按着 L2', at(tl, 1.0), 2)
  check('⑤ 减速 1.7 秒后 → 降到 L1', at(tl, 1.7), 1)
}

// ⑥ 降档有迟滞 —— 1.2 倍不算慢，别急着掉档
{
  const tl = timeline([...seg(0, 3.5, 3), ...seg(3, 1.2, 1)])
  check('⑥ L2 时降到 1.2 倍 → 仍是 L2', at(tl, 4), 2)
}

// ⑦ 完全停住 —— 一定回 L0
{
  const tl = timeline([...seg(0, 3.5, 3), ...seg(3, 0, 1.5)])
  check('⑦ 停住 0.05 秒 → 还没回 L0', at(tl, 3.05), 2)
  check('⑦ 停住 0.2 秒 → 回到 L0', at(tl, 3.2), 0)
}

console.log(failed ? `\n${failed} 条不通过` : '\n全部通过')
if (failed) process.exitCode = 1
