/**
 * 速度 → 档位 —— 决定「这一站能看几张图」。
 *
 * ## 为什么不是一个阈值函数
 *
 * 早先就是 `speed > 3.2 ? L2 : speed > 1.1 ? L1 : L0`。
 * 那样档位会在阈值上反复横跳：指针抖一下，能放出来的图忽多忽少，
 * 读者的眼睛根本跟不上 —— 滑动就没有持续感，只有一顿一顿。
 *
 * 现在是四件事：
 *
 * 1. **升档要连续** —— 快过一次不等于快，要**持续**快。
 * 2. **降档要迟滞** —— 降档阈值比升档低，降得也慢。一次减速不该立刻掉回最小档。
 * 3. **最快档要按住** —— 进了 L2 先待一会儿，别因为一个尖峰就把整池图放出来。
 * 4. **完全停住一定回 L0** —— 停住就是停住，画面彻底静止。
 *
 * 档位**不是**透明度门控，而是发射池的来源层：
 * highlight → +overview → +details。慢下来池子变窄，画面上自然只剩最该看的。
 */

import type { Tier } from './types.ts'

export type { Tier }

/** 升档阈值（相对基准速度的倍率） */
const UP = [0, 1.0, 2.4]
/** 降档阈值。比升档低一档，免得在边界上反复横跳 */
const DOWN = [0, 0.7, 1.7]
/** 升到 L1 / L2 需要连续快多久（秒） */
const UP_DELAY = [0, 0.25, 0.35]
/** 降一档需要持续慢多久（秒） */
const DOWN_DELAY = 0.3
/** 进了 L2 要按住多久才允许降（秒） */
const HOLD_L2 = 0.9
/** 慢到这份以下就算「停住了」 */
const STOPPED = 0.12
/** 判定停住要连续多久，才真的回 L0（秒） */
const STOP_HOLD = 0.12

/**
 * 档位状态机。
 *
 * 输入是**相对基准的倍率** `|speed| / base`，不是绝对速度 ——
 * 键鼠和手指差一个量级，倍率才是可比的。
 */
export class TierTracker {
  #tier: Tier = 0
  /** 候选升档已经持续了多久 */
  #up = 0
  /** 候选降档已经持续了多久 */
  #down = 0
  /** 当前档还要按住多久 */
  #hold = 0
  /** 慢速已经持续了多久 */
  #stop = 0

  push(ratio: number, dt: number): Tier {
    const r = Math.abs(ratio)

    // 完全停住：回 L0，并且清空所有计时 —— 下一次起步从 L0 重新开始
    if (r < STOPPED) {
      this.#stop += dt
      if (this.#stop >= STOP_HOLD) {
        this.#tier = 0
        this.#up = 0
        this.#down = 0
        this.#hold = 0
      }
      return this.#tier
    }
    this.#stop = 0

    const want: Tier = r > UP[2]! ? 2 : r > UP[1]! ? 1 : 0

    if (want > this.#tier) {
      // 升档：要连续快
      this.#up += dt
      this.#down = 0
      if (this.#up >= UP_DELAY[want]!) {
        this.#tier = want
        this.#up = 0
        if (want === 2) this.#hold = HOLD_L2
      }
    } else if (want < this.#tier) {
      // 降档：L2 还要先按住
      if (this.#hold > 0) {
        this.#hold -= dt
        this.#up = 0
        return this.#tier
      }
      if (r < DOWN[this.#tier]!) {
        this.#down += dt
        if (this.#down >= DOWN_DELAY) {
          this.#tier = (this.#tier - 1) as Tier
          this.#down = 0
          this.#up = 0
        }
      } else {
        this.#down = 0
      }
    } else {
      this.#up = 0
      this.#down = 0
    }
    return this.#tier
  }

  get tier(): Tier {
    return this.#tier
  }

  reset(): void {
    this.#tier = 0
    this.#up = 0
    this.#down = 0
    this.#hold = 0
    this.#stop = 0
  }
}

/**
 * 速度的平滑 —— 原始速度是抖的，直接拿来定档会一跳一跳。
 *
 * **跟手要快，松手要慢**，所以攻放用两个时间常数：
 * 动的时候几乎立刻跟上（不然档位反应不过来），松手之后慢慢衰减
 * （不然一停就掉档，画面一卡一卡的）。
 *
 * 攻放都按 `1 − e^(−dt/τ)` 算，不用固定系数 ——
 * 固定系数会让同样的手速在 60Hz 和 144Hz 上得出不同的档位，
 * 而这个库要能截图：同样的操作必须得到同样的画面。
 */
export class SpeedTracker {
  #v = 0
  constructor(
    /** 跟上输入的时间常数（秒） */
    private attack = 0.06,
    /** 松手后衰减的时间常数（秒） */
    private release = 0.22,
  ) {}

  push(pxPerSec: number, dt: number): number {
    const tau = pxPerSec > this.#v ? this.attack : this.release
    this.#v += (pxPerSec - this.#v) * (1 - Math.exp(-dt / tau))
    return this.#v
  }

  get value(): number {
    return this.#v
  }

  reset(): void {
    this.#v = 0
  }
}
