---
name: init
description: >
  扫描项目结构、配置文件与代码约定，创建或补充各级目录的 AGENTS.md。
  是 learn 从会话沉淀经验、clean 修剪维护之外的主动引导手段：
  从代码库已有的事实中初始化协作契约。
---

分析项目，并在合适的目录层级创建或补充 AGENTS.md。`init` 是对
`learn`（从会话经验中提取）和 `clean`（修剪明显/过期条目）的**主动引导**
补充手段。

## 何时使用

- 新项目，或新包/新模块还没有 AGENTS.md
- AGENTS.md 已存在，但缺少标准章节（构建与测试、架构边界、安全护栏）
- 刚经历大规模重构，构建命令、包结构或模块边界发生了变化
- 用户说"给这个项目建 AGENTS.md"或"init AGENTS"

## 它做什么

1. **扫描**目录树，找出包、构建配置和入口文件
2. **读取**关键文件：`package.json`、`tsconfig.json`、构建脚本、
   linter 配置、exports map、依赖关系图
3. **推断**架构边界、构建/测试命令、编码约定——依据是真实的代码和配置
4. **写出**合适的 AGENTS.md，只记录不显眼的条目——跳过任何
   agent 通过读同样的文件就能推断出来的内容

## 过滤——什么不要写

写任何条目前先问：*"agent 能否通过阅读代码库自行发现这一点？"*
能则跳过。init skill 和 agent 读的是同样的文件——只是它把这项工作
做了一次，并只记下其中不显眼的部分。

- ❌ "使用 TypeScript" —— tsconfig.json 里一眼可见
- ❌ "用 vitest 测试" —— package.json scripts 里一眼可见
- ❌ "React SPA + TanStack Router" —— 看 import 就知道
- ✅ "只能从 @vein/core 单入口 import，不允许子路径" —— 是强制的，
  但在任何单个文件里都看不出来
- ✅ "新增一个模型配置字段需要联动修改 6 处" —— 跨模块，
  文件清单无法直接推断

## 扫描清单

### 1. 项目结构
```
find . -maxdepth 3 -type d （排除 node_modules、.git、dist、build）
```
确定：
- Monorepo 包（package.json 里的 workspaces）
- 入口文件（每个 package.json 的 main、exports）
- 构建产物目录

### 2. 构建与测试命令
读 `package.json` 的 scripts 部分，记录非标准命令。
标准脚本（`build`、`test`、`lint`、`dev`）无需写入 AGENTS.md，
除非调用方式带项目特有的坑。

### 3. 架构边界
- `package.json` 的 exports map → import 限制
- 包之间的依赖图 → 谁可以 import 谁
- 强制边界的 linter 规则（`no-restricted-imports` 等）
- 先读父级 AGENTS.md（如有），避免重复

### 4. 编码约定
- linter 配置（biome.json、.eslintrc）→ 强制的规则
- 格式化配置 → 风格约定（只记非标准的）
- 跨文件的稳定模式（错误处理、日志、命名）

### 5. 安全护栏
- 信任边界（CLI ↔ Core、API ↔ DB）
- 安全约束（绝不打印 X、必须校验 Y）
- 数据完整性规则（事务、迁移）

## 输出

为每个需要 AGENTS.md 的目录层级写：

```markdown
# 项目协作契约

## 构建与测试
（具体命令——省略标准的 npm/bun 命令）

## 架构边界
（import 规则、模块边界、包的职责）

## 编码约定
（不显眼的模式、文件联动修改规则）

## 安全护栏
### 禁止（NEVER）
（靠约定而非工具强制执行的硬约束）
### 必须（ALWAYS）
（强制模式）

## 验证
（在该层级如何验证修改）
```

没内容的章节直接省略。如果某个章节里全是一眼可见的条目，整章跳过。

## 与 learn、clean 的协作

```
              init ──→ AGENTS.md（引导生成）
                        │
              learn ──→ AGENTS.md（会话经验累积）
                        │
              clean → AGENTS.md（清除显然/过期条目）
```

- `init` 建立骨架和种子条目
- `learn` 从会话经验中增补条目
- `clean` 移除已经变得显然、过期或冗长的条目

如果 AGENTS.md 已存在，`init` 只补充缺失章节，不整体覆盖。
它绝不删除已有条目——那是 `clean` 的职责。

## 写完之后

总结：
- 创建或更新了哪些文件
- 每个文件新增了哪些章节
- 有意跳过的条目（读代码即可推断的，留给 learn 确认）
