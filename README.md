# pi-tidy

`pi-tidy` 把 `/tidy` 命令带入 Pi，用于持续维护项目的 `AGENTS.md` 协作契约。
三个模式是同一生命周期的三个阶段：

```
              init ──→ AGENTS.md（引导生成）
                        │
              learn ──→ AGENTS.md（会话经验累积）
                        │
              clean → AGENTS.md（清除显然/过期条目）
```

## 安装

```bash
pi install git:github.com/vhxnif/pi-tidy
```

## 模式说明

- **init** — 扫描项目结构、构建配置、依赖图与代码约定，在合适的目录层级
  创建或补充 AGENTS.md。只记录 agent 无法通过读代码推断出的内容。
- **learn** — 回顾**当前会话**，把不显眼的发现（隐藏的执行路径、共用命令、
  联动修改规则、禁止/必须护栏）沉淀到离代码最近的 AGENTS.md。
- **clean** — 精简所有 AGENTS.md：移除显然、冗长、重复、过期的条目，
  空泛原则去除，低频知识和 API 文档标记迁移到 Skill。

所有模式产出的 AGENTS.md 一律使用简体中文（命令、路径、代码、标识符除外）。

## 用法

```bash
/tidy              # 交互式选择器
/tidy init         # 扫描代码库，创建/补充 AGENTS.md
/tidy learn        # 从当前会话沉淀经验
/tidy clean        # 清理精简 AGENTS.md
/end-tidy          # 结束 tidy 分支，返回原位置
```

## 分支选择

参考 `pi-review` 的机制：

- `init` 和 `clean` 运行前会询问**在新分支还是当前会话**运行；
  选新分支则当当前上下文不受整理过程的影响，整理分支用标签
  `tidy-init` / `tidy-clean` 标记，完成后用 `/end-tidy` 返回原位置。
- 空会话中启动的 tidy 默认直接在新分支运行。
- `learn` 需要分析当前会话本身，因此不提供分支选择，始终在当前会话运行。

三个 skill（`tidy-init` / `tidy-learn` / `tidy-clean`）也随包分发，模型可以自动加载，
也可以用 `/skill:tidy-init`、`/skill:tidy-learn`、`/skill:tidy-clean` 显式触发。
