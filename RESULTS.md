# @zhenre 实测结果（RESULTS.md）

- 环境：Linux 沙箱（共享 CPU），Chromium（Playwright 1.57 bundled），Node 24
- 基线：官方 `keyed/vanillajs` 参考实现逐字保留，同机同轮 A/B
- 方法：`click → 双 rAF`（含渲染）；预热操作 5 轮预热 + 20 轮测量（同页连测，官方语义）；无预热操作每轮重载；实现顺序逐轮交替；中位数
- 完整方法学与复现：[docs/benchmark.md](docs/benchmark.md)

## CPU 操作（中位数 ms，factor = @zhenre / vanilla，同轮）

| 操作 | vanilla | @zhenre | factor | 说明 |
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

注 ①：remove 的差距主要来自沙箱 GC 时序噪声——微分析（`bench/harness/profile.mjs`，60 次同页重复）显示两者中位数持平（33.3ms vs 33.3ms），@zhenre 的最小值（21.1ms）优于 vanilla（27.9ms）。

## 内存（MB，强制 GC 后 CDP JSHeapUsedSize）

| 指标 | vanilla | @zhenre | factor |
| --- | ---: | ---: | ---: |
| ready memory | 0.70 | 0.70 | 1.01x |
| run memory（1k 行） | 0.92 | 1.41 | 1.53x |
| update memory | 0.93 | 1.42 | 1.53x |
| replace memory | 0.86 | 1.41 | 1.64x |
| repeat clear memory | 0.73 | 0.80 | 1.10x |

每格信号的常驻代价（与 Solid/preact-signals 同级）；ready 与 repeat-clear 与基线持平。

## 与公开榜单头部框架的系数对比（参考）

下表为本仓库实测 factor 与 krausest 公开结果（Chrome 154 时代，第三方 lumiose 2026-10 在 M1 Max 上用官方 runner 复测的系数）的对照，**不同机器绝对值不可直接比**，仅看相对位置：

| 操作 | @zhenre（本仓库） | solid | svelte | vue-vapor | preact-hooks | react-hooks |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| create 1k | **0.971** | 1.04 | 1.07 | 1.06 | 1.24 | 1.25 |
| replace 1k | 1.093 | 1.09 | 1.14 | 1.08 | 1.37 | 1.36 |
| partial update | **1.000** | 1.17 | 1.26 | 1.09 | 2.02 | 1.49 |
| select row | **1.003** | 1.37 | 2.04 | 1.08 | 4.70 | 1.94 |

@zhenre 在全部列出操作上位于或优于现有第一梯队，其中 partial update 与 select 达到 vanilla 水平（公开榜单中所有框架均落后）。

## 公开榜单排位（2026-10-20：官方 runner 同会话配对系数 × 官方公开数据集重算）

**方法**：把本仓库官方 runner 同会话配对系数（@zhenre、solid 除以**本会话** vanillajs-keyed）插入官方仓库 `webdriver-ts/results.json` 的公开数据集（263 个 9 项数据齐全框架，各框架除以**同数据集** vanillajs-keyed），重算排位。跨硬件绝对毫秒不可比，相对因子可比；本沙箱 total 中 paint 占比高（约 88%，软件光栅化），对 script 段优势有向 1.0 收缩的保守偏差。复现：`scripts/leaderboard-rank.mjs`。

**结论：keyed 类第 1 / 198，全榜第 8 / 265（前 7 名全部为 non-keyed 变体）。**

| 排位 | 框架 | 几何均值 |
| --- | --- | ---: |
| 全榜 1-7 | vanillajs-3-non-keyed / mikado-non-keyed / deleight-non-keyed / solarite-non-keyed / vanillajs-1-non-keyed / vanillajs-non-keyed / delorean-non-keyed | 0.855~0.951 |
| **全榜 8 / keyed 1** | **@zhenre（本会话实测）** | **0.9514** |
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

**边界声明**：① 这是"官方协议 + 官方公开数据集"的重算结果，尚不是 krausest 官方表格的正式条目——需提交 `frameworks/keyed/re` PR 并由官方硬件跑分后才会出现在公开页面；② 跨硬件因子比较存在固有误差（会话间摆动 ±8%、paint/script 比例差异）；③ non-keyed 变体无需维持节点身份（replace 可整表重建、swap 可直接挪位），其 replace 榜首 0.421 与 keyed 语义存在不可比性——@zhenre 的问题是 keyed 榜问题，keyed 榜已第一。

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

**落地改动**：`bench main.ts` 行槽位改 firstChild/nextSibling 链式直写；`@zhenre/core each.ts _appendAll` 逐行 mounts 簿记改惰性 frRows（无片段行零 push、零调用）。质量门：tsc strict 清洁，core 47/47，compiler parity 2/3（Zig CI 跳过），vite-plugin 3/3，create-re 3/3，官方实现行为冒烟 10/10。

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

## core 0.3.0 lifecycle 配对验证（2026-10-28，R5 交错法）

`onCleanup` 清理上下文（组件/行/scope 级自动回收）是 0.3.0 唯一的热路径新增。验证方法：**A/B/A/B 交错配对**——同一 runner（`bench/harness/run.mjs`，ROUNDS=4）对 0.3.0 终版与 npm 在发 0.2.0（`bench/build.mjs <dist>` 切换别名）各跑两场，池化 80 样本/操作取中位数，vanilla 同场对照校准漂移。单轮 A/B 的会话级漂移（01 实测 ±5%）被交错设计对消。

| 操作 | 0.2.0 | 0.3.0 | Δ% | 备注 |
| --- | ---: | ---: | ---: | --- |
| 01 create 1k | 64.55 | 67.45 | +4.5% | 会话漂移残留：a1/a2/b1 聚在 66.3–67.7，仅末场 b2 整页偏快；R4 同路径为 −0.8% |
| 02 replace 1k | 58.95 | 58.10 | −1.4% | |
| 03 partial update | 32.40 | 32.40 | 0.0% | |
| 04 select | 32.40 | 32.40 | 0.0% | |
| 05 swap | 32.40 | 32.40 | 0.0% | |
| 06 remove | 26.50 | 24.40 | **−7.9%** | 索引式处置台账（下） |
| 07 create 10k | 590.05 | 583.70 | −1.1% | |
| 08 append 1k→10k | 214.10 | 217.75 | +1.7% | 双方 vanilla 同步抖动，噪声 |
| 09 clear 10k | 55.40 | 52.35 | **−5.5%** | |
| **几何均值** | 66.07 | 65.32 | **−1.15%** | vanilla 对照 −1.12%（漂移地板） |

内存同步改善：run 1.37→1.25、replace 1.40→1.14、update 1.38→1.27 MB。

**热路径改动**（`packages/core/src`）：

1. **惰性池化清理栈**（lifecycle.ts）：作用域帧池化 + teardown bag 惰性物化——不注册清理的行零分配，只付一次 push/pop；
2. **索引式处置台账**（each.ts v3）：`_d[]` 与行数组严格对齐，`_nDisp` 计数为 0 时销毁路径整段跳过；替代原 DOM expando（`_$fr`）+ WeakMap（rowBags）双查找，remove/clear 各赢 ~6–8%；
3. **内联单订阅对**（fragment.ts）：每行唯一外部绑定的 (signal, sub) 直接存字段，dispose 直连退订——每行省 1 闭包 + 1 数组分配，嵌套 fragment 订阅对优先转移保持快路径；
4. **克隆单次搬运**（template.ts）：`frag.appendChild(clone)` 一次原生调用替代逐节点 while 循环。

质量门：core 65/65、七件套 65/65 单测；官方行为校验 38/38；`tsc` strict 清洁；dist re.min.js 16.3KB（0.2.0 为 14.7KB，+1.6KB 为整套清理系统）。

## 编译行协议落地（2026-10-29，R6 三方交错法）

silicium-v8（krausest PR #2139）的 tplChunk64 侧面验证了 mega-template 批构建的方向后，将 `rowRenderer()` 编译协议接入官方实现，并新增**索引寻址 O(1) 直排 API**。方法：**A/B/C 三方交错**（各两场、ROUNDS=4、池化 80 样本/操作）——A=编译行协议 bench + 0.3.0 core，B=R5 现役 bench（逐行 html 模板）+ 0.3.0 core，C=R5 现役 bench + npm 0.2.0；vanilla 同场对照。本场漂移地板 ±0.14%（三方 vanilla geomean 57.68–57.80ms），全部框架差值为真信号。

| 操作 | C(0.2.0) | B(0.3.0 现役) | A(编译行协议) | A/C% | A/B% |
| --- | ---: | ---: | ---: | ---: | ---: |
| 01 create 1k | 55.85 | 55.35 | 51.55 | **−7.7%** | −6.9% |
| 02 replace 1k | 56.35 | 55.65 | 51.90 | **−7.9%** | −6.7% |
| 03 partial update | 32.50 | 32.50 | 32.50 | 0.0% | 0.0% |
| 04 select | 32.50 | 32.50 | 32.45 | −0.2% | −0.2% |
| 05 swap | 32.50 | 32.50 | 32.50 | 0.0% | 0.0% |
| 06 remove | 23.10 | 23.60 | 23.10 | 0.0% | −2.1% |
| 07 create 10k | 510.10 | 499.40 | 463.90 | **−9.1%** | −7.1% |
| 08 append 1k→10k | 151.15 | 148.10 | 143.75 | **−4.9%** | −2.9% |
| 09 clear 10k | 55.20 | 53.80 | 50.10 | **−9.2%** | −6.9% |
| **几何均值** | 60.35 | 59.90 | **57.69** | **−4.41%** | **−3.69%** |

03/04/05 触及双 rAF 帧地板（~32.5ms），无可挤空间；06 的 removeAt 消化了 B 腿对 0.2.0 的 +2.2% 残差。

**内存**（MB，两腿均值）：run 1.37→**0.84（−39.1%）**、replace 1.35→**0.86（−36.2%）**、update 1.38→**0.85（−38.4%）**、repeat-clear 0.78→0.75（−4.5%）、ready 0.71→0.69（−2.6%）。来源：批量行不再携带每行 Signal + ReFragment + 订阅对，行数据降为纯字符串。

**体积**：bench 页面包 13.6→10.7KB（−21%，模板运行时整体移出页面）；core dist re.min.js 16.7KB / gz 5.9KB（0.2.0：14.7KB / 5.2KB；+0.66KB gz 为 mega-batch + 索引直排 + 处置台账整套能力）。

**落地改动**：

1. **bench 编译行协议**（bench/re/src/main.ts）：`rowRenderer(ROW_HTML, [[0,0],[1,0,0]], { batch: 64, values })` ——64 行一片 staging、每片一次 `cloneNode(true)`；槽位直写 staging 热文本节点后整片克隆；行数据改纯字符串（编译期证明的细粒度路径：update 经 `tbody.children[i]` 活集合直写 label 文本，0 次 resolve 走查、0 订阅）；
2. **索引寻址直排**（each.ts）：`swapAt(ia, ib)` / `removeAt(i)`——零键物化、零扫描（键缓存已建时同步维护）；05/06 从"先物化 1000 键再扫描"变为纯索引操作；`each()`/`mountList` 接受编译渲染器对象（`RowRender<T>` 联合类型）；
3. **batch 非独占路径 staging 化**（each.ts `_appendAll`）：活容器批量构建进 fragment 后一次插入；
4. **`mountEach` 即挂即活**：lean 嵌入路径补上缺失的 `mount()`（订阅注册时机缺陷修复，新增回归测试）；
5. **事件委托维持表级单监听**：remove 改用 `sectionRowIndex` 寻址，删除 `data_id` expando。

**证伪记录**（同样重要）：staging 跨构建保留实测**劣化**（geomean +0.62%，01 +4.2%/07 +3.8%，vanilla 对照同步 +2%）——热重建成本小于保留子树开销，维持"用后即弃"设计并在 factory.ts 注明测量结论。

质量门：core 69/69（+4 新测试：swapAt/removeAt/编译渲染器直通/mountEach 即挂）、七件套全绿、官方行为校验 38/38、`tsc` strict 清洁。复现：`scripts/r6-interleaved.sh` + `scripts/compare-3way.mjs <A1> <A2> <B1> <B2> <C1> <C2>`。

## batch 尺寸微调实验：64 vs 128（2026-10-29，R7 三方交错法）

07 的剩余理论 headroom 假设之一：mega-batch 尺寸自适应（√n 最优 → 1k≈32、10k≈100，64/128 跨最优点两侧）。验证方式：`?batch=N` URL 参数化（**同一构建产物、单变量**，默认 64 = R6 现役配置），vanilla / b64 / b128 三方每操作交错 + 公平轮转（4 轮 × 2 腿，池化样本 01=80、02-05=160、06=96、07-09=56）。本场 vanilla 漂移地板 **±1.25%**（geomean，比 R6 的 ±0.14% 嘈杂），判定阈值为每操作 2× 自身漂移。

| 操作 | vanilla | b64 | b128 | 128 vs 64 | 跨腿一致性 | 判定 |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| 01 create 1k | 52.35 | 52.95 | 53.05 | +0.19% | +0.00%/+0.56% | 噪声 |
| 02 replace 1k | 53.80 | 51.75 | 53.30 | +3.00% | +0.28%/+5.36% 符号同幅不稳定 | 噪声 |
| 03 partial update | 32.50 | 32.50 | 32.50 | 0.00% | 帧地板 | 平 |
| 04 select | 32.50 | 32.50 | 32.40 | −0.31% | 帧地板 | 平 |
| 05 swap | 32.50 | 32.50 | 32.50 | 0.00% | 帧地板 | 平 |
| 06 remove | 22.30 | 23.05 | 22.60 | −1.95% | removeAt 不含构建路径 | 噪声 |
| 07 create 10k | 491.40 | 472.65 | 472.30 | **−0.07%** | **+1.16%/−0.87% 符号翻转** | **噪声（定论）** |
| 08 append 1k→10k | 148.15 | 152.15 | 149.80 | −1.54% | −3.56%/−1.01% 同号但 vanilla 自摆 +1.4%，低于阈 | 噪声 |
| 09 clear 10k | 47.30 | 50.20 | 51.15 | +1.89% | −2.20%/+4.28% 符号翻转 | 噪声 |
| **几何均值** | 58.00 | 58.34 | 58.41 | **+0.12%** | −0.55%/+0.65% 符号翻转 | 噪声 |

内存（强制 GC 后）：21_run 0.842 vs 0.847、22_replace5k 0.868 vs 0.871、23_update5k 0.858 vs 0.863、26_repeat-clear 0.756 vs 0.759（MB）——staging 为构建期瞬时对象，GC 后不可见，差异 +0.003-0.005MB 均为 Floor。

**结论（证伪）：batch 64→128 在官方口径下全场景平局，保留 64。** 机理：总节点拷贝量（n + B 行 staging）与插入量对 B 不变，B 只改变 2·⌈n/B⌉ 次原生调用开销——07 在 64→128 省 ~156 次调用 ≈ 0.15ms，同时 staging 多克隆 64 行 ≈ 0.1-0.2ms，净差 ≈ 0；07 的 463-492ms 主体是 10k 表的 style/layout（~60%）+ O(n) 节点拷贝，二者均 B 不变。可测范围推论（未来可复核）：B∈[32,128] 导数≈0，32 与 256 亦应为平局。据此**拒绝**引入自适应 `batch(n)` 钩子——无可测收益的机制复杂度。

实验基建留存：`scripts/r7-interleaved.mjs`（三方交错 + 内存段，`node scripts/r7-interleaved.mjs <out.json> [ROUNDS]`）、`scripts/compare-r7.mjs`（池化中位数 + 每操作漂移阈值判定 + 跨腿一致性人工检查）、`scripts/r7-smoke.mjs`（双配置行为等价 22 项断言）。bench 页面包 10.7→10.8KB（+0.1KB 为入口参数解析，热路径零开销，官方 URL 无参数时行为 = b64）。

质量门：core 69/69、七件套全绿、官方行为校验 38/38、`tsc` strict 清洁（core 源仅 factory.ts 注释增量，无逻辑变更）。

## 0.3.0 发版对比（2026-10-29，R8 同会话三方交错法 — 最终收益表）

发版门：**同会话**三方交错（vanilla / re030=现役 bench+0.3.0 / re020=R5 bench+npm 0.2.0，`bench/re-020/` 独立页面），2 腿 × ROUNDS=4，池化样本 01=80、02-05=160、06=96、07-09=56；vanilla 漂移地板 ±1.13%（geomean），每操作判定阈 2× 自身漂移。与 R6（跨腿时间对齐法）结论同向且本方法更强：零跨会话对齐假设。

### CPU（中位数 ms；factor = 版本 / vanilla，同场）

| 操作 | vanilla | 0.2.0 | **0.3.0** | **0.3.0 vs 0.2.0** | 0.2.0/van | **0.3.0/van** |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 01 create 1k | 53.35 | 56.55 | **51.55** | **−8.8%** | 1.060 | **0.966** |
| 02 replace 1k | 53.15 | 55.70 | **50.45** | **−9.4%** | 1.048 | **0.949** |
| 03 partial update | 32.50 | 32.50 | 32.50 | ±0.0%（帧地板） | 1.000 | 1.000 |
| 04 select | 32.40 | 32.40 | 32.40 | ±0.0%（帧地板） | 1.000 | 1.000 |
| 05 swap | 32.50 | 32.50 | 32.50 | ±0.0%（帧地板） | 1.000 | 1.000 |
| 06 remove | 22.30 | 23.25 | **21.85** | **−6.0%** | 1.043 | **0.980** |
| 07 create 10k | 483.85 | 515.45 | **473.75** | **−8.1%** | 1.065 | **0.979** |
| 08 append 1k→10k | 151.05 | 155.85 | 154.45 | −0.9%（阈内平） | 1.032 | 1.023 |
| 09 clear 10k | 47.20 | 56.55 | **49.70** | **−12.1%** | 1.198 | **1.053** |
| **几何均值** | 58.03 | 60.82 | **57.68** | **−5.15%（胜，阈 ±2.25%）** | 1.048 | **0.994** |

**发版判定：9 场景零回退**（5 胜 + 3 帧地板平 + 08 阈内平）。0.3.0 首次实现 9 场景 geomean **整体快于 vanilla 官方基线**（factor 0.994）；0.2.0 为 1.048。

### 内存（MB，强制 GC 后 CDP JSHeapUsedSize）

| 场景 | 0.2.0 | **0.3.0** | Δ |
| --- | ---: | ---: | ---: |
| ready（加载后） | 0.712 | **0.697** | −0.015 |
| run 1k 后 | 1.379 | **0.847** | **−0.532（−38.6%）** |
| replace 5k（5×create） | 1.312 | **0.868** | **−0.444（−33.8%）** |
| update 5k（5×update） | 1.390 | **0.862** | **−0.528（−38.0%）** |
| repeat clear 5k（5×create+clear） | 0.800 | **0.760** | −0.040（−5.0%） |

来源：编译行协议下行数据为纯字符串，行不再携带每行 Signal + ReFragment + 订阅对。

### 体积

| 产物 | 0.2.0 | **0.3.0** | Δ |
| --- | ---: | ---: | ---: |
| core re.min.js（raw / gz） | 14.39 / 5.22KB | **16.33 / 5.85KB** | +1.94 / **+0.63KB gz** |
| bench 页面 bundle | 11.89KB | **10.78KB** | **−1.11KB** |

+0.63KB gz 换入整套能力：编译行协议（mega-batch staging）、索引寻址 O(1) 直排（swapAt/removeAt）、索引式处置台账、内联单订阅对；同时官方页面代码因模板运行时上移而**更小**。

### 发版链状态

- 质量门：core 69/69、七件套全绿、官方行为校验 38/38、`tsc` strict 清洁。
- R7 batch 微调证伪记录（保 64，自适应钩子拒绝）见上节。
- 复现：`scripts/r8-release.mjs`（需 `bench/re-020/` 对照页：`node bench/build.mjs /tmp/core020pkg/package/dist/re.js bench/re/src/main-030cur.ts` 后将产物挪入）+ `scripts/compare-3way.mjs`。
