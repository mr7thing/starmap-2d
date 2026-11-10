# @uncle7/starmap-2d

**把按标准结构组织的站点内容，变成一张可截图的星图。**
一级是一排环，二级是一段可以钻进去的**光隧**。

库不知道你的内容是什么。它只认 `Manifest` 这一个结构。

```bash
npm i @uncle7/starmap-2d
```

```ts
import { createJourney } from '@uncle7/starmap-2d'

const journey = createJourney(document.querySelector('#stage'), manifest, {
  onEnterCruise: (i) => console.log('进入第', i, '段光隧'),
})
```

宿主需要给容器一个**明确的高度**（`position:fixed; inset:0`，或 `width/height:100%`）。
库只填满宿主给的盒子；盒子高度为 0 时它会警告，而不是静默画错。

**零运行时依赖** —— 没有 three.js，没有 canvas 库。一级和二级都是 Canvas 2D。

---

## 两级视图

```
一级 · 环行场景     一排环，从左往右，间距拉开，环里没有照片
      │ 点击一枚环
      ▼
二级 · 光隧         一条元素队列：章名环（带项目名）和照片同一套逻辑
```

| | `@uncle7/starmap`（三维版） | `@uncle7/starmap-2d`（本包） |
|---|---|---|
| 一级 | three.js 星图 | **Canvas 2D 环行场景** |
| 二级 | three.js 光隧 | **Canvas 2D 元素队列** |
| 运行时依赖 | three | **无** |

两个包共用同一套内容标准（`Manifest`）、同一套档位状态机。
换渲染器不换内容。

---

## 一级 · 环行场景：一排环

```
      ◎        ◎        ◎        ◎        ◎
   01 宣城   02 常州   03 成都   04 广美   05 太湖
```

**一级是索引，不是内容。** 每一站一枚环，从左往右排开、间距拉得很宽，
**环里不放照片** —— 照片留给二级。

- **光心跟着指针走**（带滞后，甩起来有惯性）。场景的底是一团光：
  同心光环从光心一圈圈涨开、扩散掉。于是光在屏幕上随意游动。
- **环滚进画幅时会涨进来**，不是突然出现在那儿。
- 越靠当前站的环越亮、越大；远处更暗，但暗到仍数得出有几站。
- **滚到文字面板下面的环会淡出** —— 文字不能被环压住。

```
    滚轮 / 指针横向拖     翻站
    点任意一枚环           进入那一站的光隧
```

## 二级 · 光隧：一条元素队列

队列里只有两种东西：**章名环**（带项目名）和**照片**。
它们**同一套逻辑** —— 出生、胀大、被下一条顶走、淡出。
环只是「大一点、带字」的那种元素。

```
    ◎ 环(项目名)  →  图  图  图  →  ◎ 环(下一个项目名)  →  图  图 …
```

**一站的照片要一张张全部冒出来**，不是一站只给一张。
这一站冒完了，下一个项目的环带字飞出来，接着是下一个项目的照片。

### 元素怎么动

照抄「流动感实验台」里 tunnel 模式那套：

1. **光心跟着指针走**（带滞后）—— 光在屏幕上随意游动。
2. 元素**从光心里冒出来**，一边冒一边胀大（轨道半径随年龄增长）。
3. 下一条出生时，上一条开始离场：淡出（`EXIT_SPACING` 之内淡完）。
4. 照片按**黄金角**散开；章名环的轨道角慢慢收回到**正上方** ——
   飞出去是为了「冒出来」，但标题最终得停在能读的位置。

章名环比照片**涨得慢**（小），所以它留在光心附近，标题读得清；
照片涨得快（大），冲到前面去。

### 环上的字

```
              ┌─────────────┐
              │ AIGC 创新实践周 │      ← 外弧：站名
        ╭─────┴─────────────┴─────╮
       │      双圈 + 刻度的表圈      │
        ╰─────────────────────────╯
              │ 01 · 2024-04-08 · 南京艺术学院 │   ← 外弧下缘：序号 时间 地点
```

三件让弧形文字站得住的事：

1. **上弧和下弧的转角不同**（`ca + π/2` / `ca - π/2`）。用错一条下弧的字会倒过来。
2. **字描一圈深色边。** 环上的字会压到浅色照片上（海报、课堂照），
   浅蓝字在浅色海报上几乎读不出来。描边是**字缘**，不是底板。
3. **弧长有上限。** 字太长就缩字号 —— 不缩的话一圈字首尾相接叠成一坨。

二级里时间地点摆在**环外下弧**（`metaOn: 'outer'`）——
环心要留给照片飞过，压在里面的字读不全。

### 档位不筛图

档位（`TierTracker`）只管**画面密度**（星尘多少），**不筛照片** ——
一站的照片必须全部冒出来，这是浏览的底线。

```
    左右划过 160px      跳一站
    滚轮                 跳一站
    ← →                 跳一站
    点照片               拿到眼前来看
    Esc                  退回一级场景
```

### 确定性

没有 `Math.random()`：素材按 manifest 的顺序取，星尘用固定种子的 mulberry32。
同一站永远以同样的顺序出场 —— 这个库的用途之一是**被截图**，
每次刷新都换一套的库没法当效果资产用。

`journey.freeze()` / `journey.thaw()` 可以把画面钉住再截：截图往返有几百毫秒，
稍纵即逝的帧抓不住，只能先停住。

---

## 内容契约

库只认 `Manifest`：

```ts
interface Manifest {
  title?: string
  stations: Station[]
}

interface Station {
  id: string              // kebab-case，唯一
  title: string
  date?: string           // YYYY-MM / YYYY-MM-DD，排序唯一依据
  end?: string
  place?: string
  short?: string          // 标注用的短地名，缺省用 place
  role?: string
  audience?: string
  lead?: string
  summary?: string
  draft?: boolean         // 未校订的占位文案
  images: ImageRef[]      // { src, tier: 0|1|2, caption? }
}
```

**能校验的绝不默认值。** 字段缺失有明确的降级路径，字段写错必须报错，
而不是悄悄按缺省渲染出一个错的页面 —— `validateManifest()` 会抛 `ManifestError`（带路径）。

`images[].tier` 就是 LOD：`0` 高亮 / `1` 概览 / `2` 细节。
目录分类同时就是 LOD 数据。

把标准目录读成 manifest 用附带的工具：

```ts
import { readStations } from '@uncle7/starmap-2d/content'

const manifest = await readStations('./stations', { base: '/stations' })
```

## API

```ts
const journey = createJourney(container, manifestInput, options)
```

| 选项 | 默认 | 说明 |
|---|---|---|
| `speedBase` | 260 | 指针速度基准（px/s）。档位判定用**相对倍率**，换设备只改这一个数 |
| `forceTier` | `null` | 强制档位（0/1/2），给自动化与截图用 |
| `hint` | — | 开场提示语。不给就不显示 —— 库里不替宿主说话 |
| `debug` | `false` | 画面上显示读数 |
| `onEnterCruise` | — | 进入第 i 站光隧 |
| `onBackToScene` | — | 回到环行场景 |
| `onHover` | — | 站点被悬停 |

| 方法 | 说明 |
|---|---|
| `journey.goto(i)` | 跳到第 i 站的光隧 |
| `journey.toScene(index?)` | 回到一级场景；带 index 时顺带落到那一站 |
| `journey.next()` / `prev()` | 光隧里前进 / 后退一站 |
| `journey.freeze()` / `thaw()` | 定格 / 恢复（截图用） |
| `journey.on('view' \| 'hover', cb)` | 订阅视图与悬停 |
| `journey.debug()` | 取景与投影的真实数值。**排布是纯函数，出问题要看数，不要靠感觉** |
| `journey.destroy()` | 拆掉 |

---

## 开发

```bash
pnpm install
pnpm gen:manifest   # 把 ../stations 读成 examples/demo/public/manifest.json
pnpm dev            # 起 demo
pnpm typecheck
pnpm check:tier     # 档位状态机的 11 条断言
pnpm build
```

`examples/demo/public/stations` 是指向 `../stations` 的目录联接（Windows 本机用）。
正式接入时素材前缀由宿主的静态资源根决定，库本身不关心。

### 目录

```
src/
  types.ts           内容契约与校验
  window.ts          速度平滑 + 档位状态机（与三维版同一份）
  content/reader.ts  把标准目录读成 manifest（Node 侧）
  field.ts           底子：光心 + 同心光环 + 星尘（一二级共用）
  ring.ts            环徽章：本体 + 弧形站名 + 弧形时间地点（一二级共用）
  scene.ts           一级 · 环行场景
  cruise.ts          二级 · 光隧（元素队列）
  index.ts           公共 API + CSS
```

**一二级共用 `field.ts` 和 `ring.ts`** —— 同一个光心、同一种扩散节奏、
同一套字的画法。换视图就换质感，会让人以为换了个产品。
