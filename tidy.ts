/**
 * Tidy Extension — AGENTS.md maintenance workflow
 *
 * Provides a `/tidy` command that keeps the project's AGENTS.md contract
 * healthy. Three modes are bundled as skills:
 *
 * - init    扫描代码库，创建或补充 AGENTS.md（主动引导）
 * - learn   从当前会话提取不显眼的经验，沉淀到 AGENTS.md（累积）
 * - clean    清移明显、冗长、重复、过期条目，精简 AGENTS.md（修剪）
 *
 * Usage:
 * - `/tidy`            — show interactive selector
 * - `/tidy init`       — bootstrap / supplement AGENTS.md from the codebase
 * - `/tidy learn`      — distill session learnings into AGENTS.md
 * - `/tidy clean`      — prune and simplify AGENTS.md
 *
 * Branch selection (like /review in pi-review):
 * - `init` and `clean` can run in a fresh branch so the current context
 *   stays untouched; finish with `/end-tidy` to return to the origin.
 * - `learn` must inspect the current session, so it always runs in place.
 * - In an empty session, init/clean default to a fresh branch.
 *
 * The skill instructions live in ./skills/tidy-<mode>/SKILL.md and are also
 * discoverable by the model as standalone skills
 * (tidy-init / tidy-learn / tidy-clean).
 * /tidy bundles them into one command and enforces that all AGENTS.md
 * content is written in Chinese (简体中文).
 */

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Skills ship next to this extension file in the package.
const EXTENSION_DIR = path.dirname(fileURLToPath(import.meta.url));

type TidyMode = "init" | "learn" | "clean";

type TidyModeMeta = {
	value: TidyMode;
	// Aliases accepted for direct invocation (e.g. `/tidy clean`)
	aliases: string[];
	label: string;
	description: string;
	// Mode-specific task instruction appended after the skill body
	task: string;
	// Tree label for fresh branches
	branchLabel: string;
};

const TIDY_MODES: TidyModeMeta[] = [
	{
		value: "init",
		aliases: ["init"],
		label: "init — 初始化 AGENTS.md",
		description: "（扫描代码库，创建或补充协作契约）",
		task: "扫描当前项目，按上述指引在合适的目录层级创建或补充 AGENTS.md。已是完整的项目契约则不强行改写。",
		branchLabel: "tidy-init",
	},
	{
		value: "learn",
		aliases: ["learn"],
		label: "learn — 沉淀本会话经验",
		description: "（把本次会话的经验写入 AGENTS.md）",
		task: "回顾本次会话从开始到现在的全部内容，按上述指引把值得沉淀的经验写入合适的 AGENTS.md。当前会话没有值得沉淀的内容时，直接说明即可。",
		branchLabel: "tidy-learn",
	},
	{
		value: "clean",
		aliases: ["clean"],
		label: "clean — 清理精简 AGENTS.md",
		description: "（移除显然、冗长、重复、过期条目）",
		task: "查找项目中的所有 AGENTS.md，逐文件按上述指引清理、精简并重组。没有需要清理的文件时，直接说明即可。",
		branchLabel: "tidy-clean",
	},
];

// AGENTS.md 正文一律用简体中文撰写（命令、路径、代码、标识符除外）。
const AGENTS_MD_LANGUAGE =
	"语言要求：所有创建或更新的 AGENTS.md 内容（标题、章节名、条目、总结）必须使用简体中文撰写。命令、代码块、文件路径、标识符保持原样，不必翻译。";

const COMPLETION_REPORT =
	"完成后用中文简要汇报：改动/创建了哪些文件、每个文件新增或移除了哪些条目、有意跳过或标记迁移到 Skill 的内容（如有）。";

// Branch prompt shown before init/clean runs
const BRANCH_PROMPT = "在哪个分支运行：";

const TIDY_STATE_TYPE = "tidy-session";
const TIDY_ANCHOR_TYPE = "tidy-anchor";

type TidySessionState = {
	active: boolean;
	originId?: string;
};

// Module-level state: only one tidy branch can be active at a time.
let tidyOriginId: string | undefined = undefined;

function setTidyWidget(ctx: ExtensionContext, active: boolean) {
	if (!ctx.hasUI) return;
	if (!active) {
		ctx.ui.setWidget("tidy", undefined);
		return;
	}

	ctx.ui.setWidget("tidy", (_tui, theme) => {
		const message = "Tidy 分支进行中，用 /end-tidy 返回原位置";
		const text = new Text(theme.fg("warning", message), 0, 0);
		return {
			render(width: number) {
				return text.render(width);
			},
			invalidate() {
				text.invalidate();
			},
		};
	});
}

function getTidyState(ctx: ExtensionContext): TidySessionState | undefined {
	let state: TidySessionState | undefined;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type === "custom" && entry.customType === TIDY_STATE_TYPE) {
			state = entry.data as TidySessionState | undefined;
		}
	}

	return state;
}

async function loadSkillInstructions(mode: TidyMode): Promise<string> {
	const skillPath = path.join(EXTENSION_DIR, "skills", `tidy-${mode}`, "SKILL.md");
	let content: string;
	try {
		content = await fs.readFile(skillPath, "utf8");
	} catch (error) {
		throw new Error(
			`读取 ${skillPath} 失败: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		);
	}

	// Strip frontmatter — the routing description is irrelevant once the
	// mode has already been chosen.
	const withoutFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n/, "");
	const trimmed = withoutFrontmatter.trim();
	if (!trimmed) {
		throw new Error(`${skillPath} 内容为空`);
	}
	return trimmed;
}

function findMode(token: string | undefined): TidyMode | undefined {
	if (!token) return undefined;
	const normalized = token.trim().toLowerCase();
	return TIDY_MODES.find((mode) => mode.aliases.includes(normalized))?.value;
}

function showSelector(ctx: ExtensionContext): Promise<TidyMode | null> {
	const items: SelectItem[] = TIDY_MODES.map((mode) => ({
		value: mode.value,
		label: mode.label,
		description: mode.description,
	}));

	return ctx.ui.custom<TidyMode | null>((tui, theme, keybindings, done) => {
		const container = new Container();
		container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
		container.addChild(new Text(theme.fg("accent", theme.bold("选择 AGENTS.md 整理模式"))));

		const selectList = new SelectList(items, items.length, {
			selectedPrefix: (text) => theme.fg("accent", text),
			selectedText: (text) => theme.fg("accent", text),
			description: (text) => theme.fg("muted", text),
			scrollInfo: (text) => theme.fg("dim", text),
			noMatch: (text) => theme.fg("warning", text),
		});

		selectList.onSelect = (item) => done(item.value as TidyMode);
		selectList.onCancel = () => done(null);

		container.addChild(selectList);
		container.addChild(new Text(theme.fg("dim", "enter 确认 • esc 取消")));
		container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

		return {
			render(width: number) {
				return container.render(width);
			},
			invalidate() {
				container.invalidate();
			},
			handleInput(data: string) {
				selectList.handleInput(data);
				tui.requestRender();
			},
		};
	});
}

export default function tidyExtension(pi: ExtensionAPI) {
	function persistTidyState(active: boolean, originId?: string) {
		pi.appendEntry(TIDY_STATE_TYPE, { active, originId });
	}

	function restoreTidyState(
		ctx: ExtensionContext,
		options: { preferCached?: boolean; notifyOnMissingOrigin?: boolean } = {},
	): string | undefined {
		if (options.preferCached !== false && tidyOriginId) {
			return tidyOriginId;
		}

		const state = getTidyState(ctx);
		if (state?.active && state.originId) {
			tidyOriginId = state.originId;
			return tidyOriginId;
		}

		tidyOriginId = undefined;
		if (state?.active && options.notifyOnMissingOrigin) {
			setTidyWidget(ctx, false);
			pi.appendEntry(TIDY_STATE_TYPE, { active: false });
			ctx.ui.notify("Tidy 状态缺失了起点信息，已自动清除标记。", "warning");
		}

		return undefined;
	}

	// session_start / session_tree must trust the persisted branch state, not
	// the module cache: navigating away from a tidy branch should clear it.
	function applyTidyState(ctx: ExtensionContext) {
		setTidyWidget(ctx, restoreTidyState(ctx, { preferCached: false }) !== undefined);
	}

	function clearTidyState(ctx: ExtensionContext) {
		setTidyWidget(ctx, false);
		tidyOriginId = undefined;
		pi.appendEntry(TIDY_STATE_TYPE, { active: false });
	}

	pi.on("session_start", (_event, ctx) => {
		applyTidyState(ctx);
	});

	pi.on("session_tree", (_event, ctx) => {
		applyTidyState(ctx);
	});

	async function buildTidyPrompt(mode: TidyMode): Promise<string> {
		const skill = await loadSkillInstructions(mode);

		const meta = TIDY_MODES.find((m) => m.value === mode)!;
		return [
			skill,
			"---",
			"请立即执行上述流程，具体任务：",
			"",
			meta.task,
			"",
			AGENTS_MD_LANGUAGE,
			COMPLETION_REPORT,
		].join("\n");
	}

	/**
	 * Branch off to a fresh session for the tidy run, so the current context
	 * stays untouched. Mirrors pi-review's fresh-session logic:
	 * remember the origin, navigate to the first user message, and persist
	 * state so tree navigation can restore it.
	 *
	 * Keep in sync with executeReview() in pi-review/review.ts.
	 */
	async function startFreshTidyBranch(
		ctx: ExtensionCommandContext,
		label: string,
	): Promise<boolean> {
		let originId = ctx.sessionManager.getLeafId() ?? undefined;
		if (!originId) {
			// In an empty session there is no leaf yet — create a lightweight anchor.
			pi.appendEntry(TIDY_ANCHOR_TYPE, { createdAt: new Date().toISOString() });
			originId = ctx.sessionManager.getLeafId() ?? undefined;
		}
		if (!originId) {
			ctx.ui.notify("无法确定 tidy 的起点位置。", "error");
			return false;
		}
		tidyOriginId = originId;

		// Keep a local copy so session_tree events during navigation don't wipe it
		const lockedOriginId = originId;

		// Navigate to the first user message to branch from there.
		// If none exists (brand-new session), we stay on the current leaf.
		const entries = ctx.sessionManager.getEntries();
		const firstUserMessage = entries.find(
			(e) => e.type === "message" && e.message.role === "user",
		);

		if (firstUserMessage) {
			try {
				const result = await ctx.navigateTree(firstUserMessage.id, { summarize: false, label });
				if (result.cancelled) {
					tidyOriginId = undefined;
					ctx.ui.notify("已取消在新分支运行 tidy。", "info");
					return false;
				}
			} catch (error) {
				tidyOriginId = undefined;
				ctx.ui.notify(`启动 tidy 分支失败: ${error instanceof Error ? error.message : String(error)}`, "error");
				return false;
			}

			// Clearing the editor matters: navigating to a user message fills it with that message's text.
			ctx.ui.setEditorText("");
		}

		// Restore origin after navigation events (session_tree can reset it)
		tidyOriginId = lockedOriginId;

		setTidyWidget(ctx, true);
		persistTidyState(true, lockedOriginId);
		return true;
	}

	/**
	 * /end-tidy — return to the position where the tidy branch was started.
	 */
	async function runEndTidy(ctx: ExtensionCommandContext): Promise<void> {
		if (!ctx.hasUI) {
			ctx.ui.notify("/end-tidy 需要在交互模式下使用", "error");
			return;
		}

		const originId = restoreTidyState(ctx, { notifyOnMissingOrigin: true });
		if (!originId) {
			ctx.ui.notify("当前没有进行中的 tidy 分支（init/clean 可在分支中运行）", "info");
			return;
		}

		try {
			const result = await ctx.navigateTree(originId, { summarize: false });
			if (result.cancelled) {
				ctx.ui.notify("已取消返回。再次运行 /end-tidy 可重试。", "info");
				return;
			}
		} catch (error) {
			ctx.ui.notify(`返回失败: ${error instanceof Error ? error.message : String(error)}`, "error");
			return;
		}

		clearTidyState(ctx);
		ctx.ui.notify("Tidy 已完成，已返回原位置。", "info");
	}

	pi.registerCommand("end-tidy", {
		description: "结束 tidy 分支并返回原位置",
		handler: async (_args, ctx) => {
			await runEndTidy(ctx);
		},
	});

	// Register the /tidy command
	pi.registerCommand("tidy", {
		description: "整理 AGENTS.md（init 初始化 / learn 沉淀经验 / clean 清理精简）",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/tidy 需要在交互模式下使用", "error");
				return;
			}

			let mode = findMode(args?.trim().split(/\s+/)[0]);

			if (!mode) {
				if (args?.trim()) {
					// Args were given but didn't match a mode — tell the user instead of guessing.
					ctx.ui.notify(`未知模式 "${args.trim()}"。可用模式：init、learn、clean`, "error");
					return;
				}
				const selected = await showSelector(ctx);
				if (!selected) {
					ctx.ui.notify("已取消", "info");
					return;
				}
				mode = selected;
			}

			// Check if we're already in a tidy branch
			if (restoreTidyState(ctx, { notifyOnMissingOrigin: true })) {
				ctx.ui.notify("已有 tidy 分支进行中，先用 /end-tidy 结束再开始新的整理。", "warning");
				return;
			}

			const meta = TIDY_MODES.find((m) => m.value === mode)!;
			let prompt: string;
			try {
				prompt = await buildTidyPrompt(mode);
			} catch (error) {
				// Command boundary: report the real cause instead of guessing.
				ctx.ui.notify(
					`加载 skills/tidy-${mode}/SKILL.md 失败: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
				return;
			}

			// learn must inspect the current session — it always runs in place.
			// init/clean may branch off; empty sessions default to a fresh branch.
			let useFreshSession: boolean | undefined;
			if (mode !== "learn") {
				const messageCount = ctx.sessionManager.getEntries().filter((e) => e.type === "message").length;
				if (messageCount === 0) {
					useFreshSession = true;
				} else {
					const choice = await ctx.ui.select(BRANCH_PROMPT, ["新分支（不影响当前上下文）", "当前会话"]);
					if (choice === undefined) {
						ctx.ui.notify("已取消", "info");
						return;
					}
					useFreshSession = choice === "新分支（不影响当前上下文）";
				}
			}

			if (useFreshSession) {
				const started = await startFreshTidyBranch(ctx, meta.branchLabel);
				if (!started) {
					return;
				}
			}

			ctx.ui.notify(
				`开始整理 AGENTS.md（${mode}${useFreshSession ? "，新分支" : ""}）`,
				"info",
			);
			// Send as a user message that triggers a turn
			pi.sendUserMessage(prompt);
		},
	});
}
