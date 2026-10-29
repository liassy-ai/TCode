import type { AgentToolResult, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ExtensionDialogQuestion } from "@tcode/shared";
import { Type } from "typebox";

const MAX_QUESTIONS = 6;

const MAX_OPTIONS = 9;

const questionSchema = Type.Object({
	question: Type.String({ minLength: 1, description: "One question (same language as the conversation)" }),
	options: Type.Optional(
		Type.Array(Type.String({ minLength: 1 }), {
			minItems: 2,
			maxItems: MAX_OPTIONS,
			description: `Answer choices for a choice-shaped question (2-${MAX_OPTIONS}); omit for open questions`,
		}),
	),
	allowCustom: Type.Optional(
		Type.Boolean({ description: "With options: also offer a free-form entry beside the choices" }),
	),
	multiple: Type.Optional(
		Type.Boolean({
			description:
				"Let the user pick several options. The answer comes back as ONE string with the picks joined by 、(ideographic comma)",
		}),
	),
	placeholder: Type.Optional(Type.String({ description: "Placeholder for the free-form input" })),
});

const askUserParams = Type.Object({
	questions: Type.Optional(
		Type.Array(questionSchema, {
			minItems: 1,
			maxItems: MAX_QUESTIONS,
			description:
				"All the questions to ask in one card. Prefer putting several here over asking them in separate rounds.",
		}),
	),
	question: Type.Optional(
		Type.String({
			minLength: 1,
			description: "Single-question shorthand, equivalent to questions: [{ question }]",
		}),
	),
	options: Type.Optional(
		Type.Array(Type.String({ minLength: 1 }), {
			minItems: 2,
			maxItems: MAX_OPTIONS,
			description: "Choices for the single-question shorthand (with `question`)",
		}),
	),
	allowCustom: Type.Optional(
		Type.Boolean({ description: "Single-question shorthand: allow a free-form answer" }),
	),
	multiple: Type.Optional(
		Type.Boolean({
			description: "Single-question shorthand: let the user pick several options (answer joined by 、)",
		}),
	),
	placeholder: Type.Optional(Type.String({ description: "Single-question shorthand: input placeholder" })),
});

export interface AskUserDetails {
	questions: ExtensionDialogQuestion[];

	answers?: string[];
	cancelled?: boolean;
}

export interface AskUserDeps {
	askForm?: (
		sessionId: string | undefined,
		questions: ExtensionDialogQuestion[],
	) => Promise<string[] | undefined>;
}

function sessionIdOf(ctx: unknown): string | undefined {
	try {
		const manager = (ctx as { sessionManager?: { getSessionId?: () => string } }).sessionManager;
		return manager?.getSessionId?.();
	} catch {
		return undefined;
	}
}

function normalizeQuestions(params: {
	questions?: ExtensionDialogQuestion[];
	question?: string;
	options?: string[];
	allowCustom?: boolean;
	multiple?: boolean;
	placeholder?: string;
}): ExtensionDialogQuestion[] {
	if (params.questions && params.questions.length > 0) return params.questions.slice(0, MAX_QUESTIONS);
	if (!params.question) return [];
	return [
		{
			question: params.question,
			...(params.options ? { options: params.options } : {}),
			...(params.allowCustom !== undefined ? { allowCustom: params.allowCustom } : {}),
			...(params.multiple !== undefined ? { multiple: params.multiple } : {}),
			...(params.placeholder !== undefined ? { placeholder: params.placeholder } : {}),
		},
	];
}

async function askOneByOne(
	ctx: ExtensionContext,
	questions: ExtensionDialogQuestion[],
): Promise<string[] | undefined> {
	const answers: string[] = [];
	for (const item of questions) {
		const options = item.options ?? [];
		let answer: string | undefined;
		if (options.length > 0) {
			const custom = "其他…（手动输入）";

			const title = item.multiple ? `${item.question}\n（可多选，多个答案用「、」分隔）` : item.question;
			const picked = await ctx.ui.select(title, item.allowCustom ? [...options, custom] : options);
			answer = picked === custom ? await ctx.ui.input(title, item.placeholder ?? "") : picked;
		} else {
			answer = await ctx.ui.input(item.question, item.placeholder ?? "");
		}
		const trimmed = answer?.trim();
		if (!trimmed) return undefined;
		answers.push(trimmed);
	}
	return answers;
}

export function makeAskUserTool(deps: AskUserDeps = {}): ToolDefinition<typeof askUserParams> {
	return {
		name: "ask_user",
		label: "Ask User",
		description:
			"Ask the user questions and wait for the answers; they render as a docked card in the chat UI rather than a plain paragraph. Use it when the run cannot continue without a decision only the user can make (approach, scope, target) or a value only they know. Put every question into ONE call (questions, up to 6), never in separate rounds. For choice-shaped questions pass options (2-9) and omit them for open ones; add multiple: true when several options may be picked at once — that answer returns as ONE string joined by 、. Answers come back in order. If the card is dismissed, do not re-ask: choose the safest defaults, state the assumptions, continue.",
		promptSnippet: "ask_user({questions: [{question, options?, multiple?}]})",
		promptGuidelines: [
			"Use it for decisions you must not guess (approach, scope, target) or values only the user knows; never for anything you can find out yourself (reading files, searching, running commands).",
			"Ask everything you need in ONE call (up to 6 questions), not one question per round; keep each question short — a decision prompt, never a container for command output, file contents or logs.",
			'Set multiple: true when more than one option may reasonably be picked (e.g. "which features should I enable"); a multi-select answer arrives as one string joined by 、 — split it yourself.',
		],
		parameters: askUserParams,
		execute: async (
			_toolCallId,
			params,
			_signal,
			_onUpdate,
			ctx,
		): Promise<AgentToolResult<AskUserDetails>> => {
			const questions = normalizeQuestions(params);
			const details: AskUserDetails = { questions };
			if (questions.length === 0) {
				return {
					content: [{ type: "text" as const, text: "ask_user needs at least one question." }],
					details,
				};
			}

			let answers: string[] | undefined;
			if (deps.askForm) {
				answers = await deps.askForm(sessionIdOf(ctx), questions);
			} else if (ctx.hasUI) {
				answers = await askOneByOne(ctx, questions);
			} else {
				return {
					content: [
						{
							type: "text" as const,
							text: "No UI is attached to this session, so the questions cannot be shown as a card. Ask them as plain text in your reply instead.",
						},
					],
					details,
				};
			}

			const filled = (answers ?? []).map((answer) => answer?.trim() ?? "");
			if (filled.length !== questions.length || filled.some((answer) => answer.length === 0)) {
				details.cancelled = true;
				return {
					content: [
						{
							type: "text" as const,
							text: "The user dismissed the card without answering all questions. Do not ask again: pick the safest defaults, state the assumptions you made, and continue.",
						},
					],
					details,
				};
			}
			details.answers = filled;
			const lines = questions.map((item, index) => `${index + 1}. ${item.question}\n   ${filled[index]}`);
			return {
				content: [{ type: "text" as const, text: `User answers:\n${lines.join("\n")}` }],
				details,
			};
		},
	};
}
