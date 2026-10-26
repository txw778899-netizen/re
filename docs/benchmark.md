# 基准实测与复现指南

## 测的是什么

对齐 [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) 的 9 项 CPU 操作与 5 项内存指标，@zhenre 实现页与官方 `keyed/vanillajs` 参考实现**逐字保留**后同机对比：

| # | 操作 | 官方语义 |
| --- | --- | --- |
| 01 | create 1k | 页面加载后首次创建 1000 行（无预热） |
| 02 | replace 1k | 替换全部 1000 行（5 预热 + 测量） |
| 03 | partial update | 每 10 行更新标签（同上） |
| 04 | select | 点击高亮一行（同上） |
| 05 | swap | 交换第 2/999 行（同上） |
| 06 | remove | 删除单行（无预热，每轮重载） |
| 07 | create 10k | 首次创建 10000 行（无预热） |
| 08 | append 10k | 万行表追加 1000 行（无预热） |
| 09 | clear 10k | 清空万行表（无预热） |
| 10–26 | memory | ready / run / update / replace / repeat-clear（CDP + 强制 GC） |

计时口径：`button.click()` → 双 `requestAnimationFrame`，包含样式/布局/绘制。与官方用 Chrome timeline 度量「click 到 paint」的口径一致。

## 目录

```
bench/
├── re/           # @zhenre 合规实现（index.html + src/main.ts，esbuild 打包）
├── vanilla/      # 官方 keyed/vanillajs 参考实现（逐字保留）
├── css/          # 官方 bootstrap + main.css
├── server.mjs    # 零依赖静态服务器（:8080）
└── harness/
    ├── verify.mjs   # 38 项行为正确性断言（对齐官方 webdriver 检查 + keyed 身份契约）
    ├── run.mjs      # 计时 + 内存采集
    ├── stats.mjs    # 统计与对比
    ├── profile.mjs  # 微分析（定位残余差距用）
    └── micro.*      # 阶段级分解（buildData / sync / paint / 实例化 / clone）
```

## 复现

```bash
npm install
node bench/build.mjs          # 打包 @zhenre 实现页
node bench/harness/verify.mjs # 38/38 行为校验（两实现各跑一遍）
node bench/harness/run.mjs    # 完整实测（ROUNDS=2 轮次交替）
node bench/harness/stats.mjs  # 输出对比表 + bench/results/summary.json
```

> 建议在你的目标机器上跑 3 轮取中位。沙箱/共享 CPU 的轮间波动可达 ±10%，
> 但 A/B 同轮对比（factor 列）是稳定的。

## @zhenre 实现页的关键手法（全部为公开 API）

- **每行一个 label 信号**：partial update 只触碰 100 个文本节点，零列表 diff；
- **锚点 keyed 视图**：`each(rows, r => r.id, rowTpl)`；
- **事件委托**：tbody 两个监听器（与官方参考实现同构），选中/删除在委托处理器里用 `list.swap/list.remove/list.ref` 的 O(1) 直操完成；
- **容器快路径**：run/runlots 走 replace-all（replaceChildren）与 detach 构建，add 走前缀追加，clear 走 replaceChildren。

## 诚实性说明

- 本仓库数据来自共享 CPU 沙箱（Chromium via Playwright），绝对值不可与官方榜单跨机对比；**factor（相对同轮 vanilla）是本仓库的有效结论**。
- 「启动时间 / Lighthouse 类」指标未采集（官方口径依赖其 runner），核心 gzip 3.9KB、运行时零调度器是定性的启动优势。
- 提交官方仓库前需按其 `npm run rebuild-ci` 与 `isKeyed` 校验流程再验一遍（本仓库 verify.mjs 已覆盖其行为断言的超集）。
