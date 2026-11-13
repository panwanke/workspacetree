# tests/fixtures

本目录只放**最小合法样例** `minimal.branch.json`（由 `pnpm --filter @workspacetree/cli exec tsx src/index.ts create --out tests/fixtures/minimal.branch.json` 生成，或由 `createMinimalBranchFile()` 产出）。

它**不是**固定种子 Golden Fixture。按 `06 §一.7`，Golden Fixture 需要包含论文总项目、WPT / PDD 子项目、多主干、任务、跨边、归档及缩放分支，且提交生成脚本与固定种子——该项属本轮授权范围外（Phase 0 剩余项，G0 未闭合）。

不要在此目录放入真实研究数据。开发 / 原型阶段，不得承载正式项目数据（C16 / ADR-022）。
