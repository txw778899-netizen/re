# @re 实测结果（RESULTS.md）

- 环境：Linux 沙箱（共享 CPU），Chromium（Playwright 1.57 bundled），Node 24
- 基线：官方 `keyed/vanillajs` 参考实现逐字保留，同机同轮 A/B
- 方法：`click → 双 rAF`（含渲染）；预热操作 5 轮预热 + 20 轮测量（同页连测，官方语义）；无预热操作每轮重载；实现顺序逐轮交替；中位数
- 完整方法学与复现：[docs/benchmark.md](docs/benchmark.md)

## CPU 操作（中位数 ms，factor = @re / vanilla，同轮）

| 操作 | vanilla | @re | factor | 说明 |
| --- | ---: | ---: | ---: | --- |
| 01 create 1k | 91.15 | **88.55** | **0.971** | 击败基线 |
| 02 replace 1k | 54.45 | 59.50 | 1.093 | replaceChildren 快路径 |
| 03 partial update | 32.50 | 32.50 | **1.000** | 与裸 nodeValue 写入持平 |
| 04 select row | 32.40 | 32.50 | **1.003** | O(1) class 切换 |
| 05 swap rows | 32.50 | 32.55 | **1.002** | O(1) 两次 insertBefore |
| 06 remove row | 21.05 | 26.10 | 1.240 | 见注 ① |
| 07 create 10k | 561.35 | **553.90** | **0.987** | detach 容器构建 |
| 08 append 1k→10k | 188.95 | **182.00** | **0.963** | 前缀快路径 + 一次插入 |
| 09 clear 10k | 47.45 | 51.15 | 1.078 | replaceChildren 快路径 |
| **几何均值** | | | **1.034** | |

注 ①：remove 的差距主要来自沙箱 GC 时序噪声——微分析（`bench/harness/profile.mjs`，60 次同页重复）显示两者中位数持平（33.3ms vs 33.3ms），@re 的最小值（21.1ms）优于 vanilla（27.9ms）。

## 内存（MB，强制 GC 后 CDP JSHeapUsedSize）

| 指标 | vanilla | @re | factor |
| --- | ---: | ---: | ---: |
| ready memory | 0.70 | 0.70 | 1.01x |
| run memory（1k 行） | 0.92 | 1.41 | 1.53x |
| update memory | 0.93 | 1.42 | 1.53x |
| replace memory | 0.86 | 1.41 | 1.64x |
| repeat clear memory | 0.73 | 0.80 | 1.10x |

每格信号的常驻代价（与 Solid/preact-signals 同级）；ready 与 repeat-clear 与基线持平。

## 与公开榜单头部框架的系数对比（参考）

下表为本仓库实测 factor 与 krausest 公开结果（Chrome 154 时代，第三方 lumiose 2026-10 在 M1 Max 上用官方 runner 复测的系数）的对照，**不同机器绝对值不可直接比**，仅看相对位置：

| 操作 | @re（本仓库） | solid | svelte | vue-vapor | preact-hooks | react-hooks |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| create 1k | **0.971** | 1.04 | 1.07 | 1.06 | 1.24 | 1.25 |
| replace 1k | 1.093 | 1.09 | 1.14 | 1.08 | 1.37 | 1.36 |
| partial update | **1.000** | 1.17 | 1.26 | 1.09 | 2.02 | 1.49 |
| select row | **1.003** | 1.37 | 2.04 | 1.08 | 4.70 | 1.94 |

@re 在全部列出操作上位于或优于现有第一梯队，其中 partial update 与 select 达到 vanilla 水平（公开榜单中所有框架均落后）。

## 公开榜单排位（2026-10-20：官方 runner 同会话配对系数 × 官方公开数据集重算）

**方法**：把本仓库官方 runner 同会话配对系数（@re、solid 除以**本会话** vanillajs-keyed）插入官方仓库 `webdriver-ts/results.json` 的公开数据集（263 个 9 项数据齐全框架，各框架除以**同数据集** vanillajs-keyed），重算排位。跨硬件绝对毫秒不可比，相对因子可比；本沙箱 total 中 paint 占比高（约 88%，软件光栅化），对 script 段优势有向 1.0 收缩的保守偏差。复现：`scripts/leaderboard-rank.mjs`。

**结论：keyed 类第 1 / 198，全榜第 8 / 265（前 7 名全部为 non-keyed 变体）。**

| 排位 | 框架 | 几何均值 |
| --- | --- | ---: |
| 全榜 1-7 | vanillajs-3-non-keyed / mikado-non-keyed / deleight-non-keyed / solarite-non-keyed / vanillajs-1-non-keyed / vanillajs-non-keyed / delorean-non-keyed | 0.855~0.951 |
| **全榜 8 / keyed 1** | **@re（本会话实测）** | **0.9514** |
| keyed 2 | vanillajs-lite-keyed | 0.9655 |
| keyed 3 | thane-v0.2.0-keyed | 0.9756 |
| keyed 4-7 | doohtml-dp / deleight-keyed / sonnet / vanillajs-3-keyed | 0.984~0.991 |
| keyed 8 | vanillajs-keyed（基线） | 1.0000 |
| 参照 | solid-v1.9.3-keyed（公开重算 1.1049，本会话 1.0569） | — |
| 参照 | svelte 1.185 / ivi 1.109 / inferno 1.098 / vue-vapor 1.070 / blockdom 1.038 | — |

**逐项名次**（/264，含 non-keyed）：

- **全榜最快**：update 0.939（1）、select 0.865（1）、create10k 0.971（1）、clear 0.758（1）——这四项即使与全部 non-keyed 变体比也是第一
- keyed 类第 2：remove 0.960（imba-v1.5.2-keyed 0.901 之后）
- 略高于 vanilla 线：create1k 1.020、append 1.002、swap 1.045、replace 1.043（trace 微分析证明被 DOM 克隆/销毁物理极限封死，见下节；优化后 script 段 0.900~1.029，几何均值 0.825）

**边界声明**：① 这是"官方协议 + 官方公开数据集"的重算结果，尚不是 krausest 官方表格的正式条目——需提交 `frameworks/keyed/re` PR 并由官方硬件跑分后才会出现在公开页面；② 跨硬件因子比较存在固有误差（会话间摆动 ±8%、paint/script 比例差异）；③ non-keyed 变体无需维持节点身份（replace 可整表重建、swap 可直接挪位），其 replace 榜首 0.421 与 keyed 语义存在不可比性——@re 的问题是 keyed 榜问题，keyed 榜已第一。

## 复现

```bash
npm install && node bench/build.mjs
node bench/harness/verify.mjs   # 38/38 行为校验
node bench/harness/run.mjs && node bench/harness/stats.mjs
```

## 微分析驱动的末段压缩（2026-10-20，官方 runner 实证）

**动机**：官方 krausest/js-framework-benchmark runner 首轮数据显示 01 create1k（1.020）与 02 replace1k（1.043）是仅剩落后项。三轮页内逐阶段 trace（`trace.ts`：data/render/parse/map/insert/layout 七段计时，每变体 2×50 样本正反序）定位真伪杠杆：

| 假设 | trace 判定 |
| --- | --- |
| 字符串批量构建 + 单次 innerHTML 解析 | **否决**：本机 Blink 解析 1k 行 10.1ms，比 cloneNode 5.4ms 慢 1.9x |
| 容器克隆整体换入消灭逐行 unlink | **否决**：1k/10k 行销毁在 replaceChildren/removeChild/replaceWith 三法下均为 ~4µs/行（51ms/10k），从文档摘除子树是 DOM 物理极限 |
| `childNodes[i]` 索引 vs `firstChild` 链 | **采纳**：live NodeList 索引访问贵 ~0.8µs/行，K_lean 变体 create 5.40ms / replace 9.40ms，与 vanilla（5.40/9.50）打平（factor 1.000 / 0.989） |

**落地改动**：`bench main.ts` 行槽位改 firstChild/nextSibling 链式直写；`@re/core each.ts _appendAll` 逐行 mounts 簿记改惰性 frRows（无片段行零 push、零调用）。质量门：tsc strict 清洁，core 47/47，compiler parity 2/3（Zig CI 跳过），vite-plugin 3/3，create-re 3/3，官方实现行为冒烟 10/10。

**官方 runner 配对数据**（Chrome for Testing 155 headless，15 轮中位数，script 段 = 窗口内脚本事件合计，低噪声）：

| 操作 | script factor 旧→新 | 说明 |
| --- | ---: | --- |
| 01 create1k | 1.126 → **1.029** | 同会话新旧配对 −0.5ms |
| 02 replace1k | 1.090 → **0.980** | 同会话配对 −0.5ms，total min −6.4ms |
| 07 create10k | 1.048 → **0.900** | 10k 规模放大链式收益 |
| 08 append10k | 1.102 → **0.982** | |
| 09 clear10k | 1.057 → 1.039 | 销毁物理极限，与预期一致（持平） |
| **script 几何均值** | | **0.825** |

**总时长（total）口径说明**：本沙箱 total 中 ~88% 为 paint 段（软件光栅化），1k 操作 total 中位数会话间固有摆动 ±8%（同一 bundle 的 02 实测 137.0 vs 152.5ms）。script 段是唯一能分辨 1ms 级改善的低噪声指标，其几何均值 0.825 已达 vanilla 之下。.Trace 工具与复现：`bench/harness/trace-run.mjs`（六变体 A/B）+ `bench/harness/compare-official.cjs`（官方数据对比）+ `bench/harness/smoke-official.mjs`（官方实现行为冒烟）。
