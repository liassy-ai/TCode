import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { channelRoot, validateTopic } from "./init";

export interface SubscribeOutcome {
	ok: boolean;

	error?: string;

	resumed?: boolean;
}

export interface ChannelToolDeps {
	cwd: string;

	subscribe(topic: string): Promise<SubscribeOutcome>;

	unsubscribe(topic: string): { ok: boolean; error?: string };

	post(topic: string, message: string, closed: boolean): Promise<{ ok: boolean; error?: string }>;

	getSubscriptions(): Set<string>;

	pausedTopics(): Array<{ topic: string; since: number }>;
}

export const subscribeParams = Type.Object({
	topic: Type.String({ description: "频道主题名（.local/agent-work/channel/ 下的目录名）" }),
});

export const unsubscribeParams = Type.Object({
	topic: Type.String({ description: "要退订的频道主题名" }),
});

export const postParams = Type.Object({
	topic: Type.String({ description: "频道主题名（.local/agent-work/channel/ 下的目录名）" }),
	message: Type.String({ description: "消息正文（追加到频道 MESSAGES.md，订阅该频道的会话将收到唤醒）" }),
	closed: Type.Optional(
		Type.Boolean({ description: "终态信号：任务验收通过/频道废弃。订阅方查收后将退订本频道" }),
	),
});

function textResult(text: string): { content: Array<{ type: "text"; text: string }>; details: undefined } {
	return { content: [{ type: "text", text }], details: undefined };
}

export function makeChannelTools(deps: ChannelToolDeps): ToolDefinition[] {
	const subscribe: ToolDefinition<typeof subscribeParams> = {
		name: "channel_subscribe",
		label: "Subscribe channel",
		description:
			"订阅协作频道（.local/agent-work/channel/<topic>，topic 为频道目录名）。此后另一会话用 channel_post 向该频道发消息时，本会话会收到一行唤醒提醒。",
		promptSnippet: "channel_subscribe({ topic }) — 订阅协作频道，接收文件更新唤醒",
		parameters: subscribeParams,
		async execute(_toolCallId, params) {
			const topic = String((params as { topic?: unknown }).topic ?? "").trim();
			const invalid = validateTopic(topic);
			if (invalid) return textResult(`订阅失败：${invalid}`);
			const result = await deps.subscribe(topic);
			if (!result.ok) return textResult(`订阅失败：${result.error ?? "未知错误"}`);
			const resumedNote = result.resumed ? "（该频道此前因频繁互触发被暂停，本次订阅已恢复）" : "";
			return textResult(
				[
					`已订阅频道 [${topic}]，目录 ${channelRoot(deps.cwd)}/${topic}`,
					resumedNote,
					"另一会话向该频道 channel_post 消息时，你会收到 `[channel:<topic>]` 开头的提醒，读频道 MESSAGES.md 查收即可。",
				]
					.filter(Boolean)
					.join("\n"),
			);
		},
	};

	const unsubscribe: ToolDefinition<typeof unsubscribeParams> = {
		name: "channel_unsubscribe",
		label: "Unsubscribe channel",
		description: "退订一个协作频道，不再接收该频道的消息唤醒。",
		promptSnippet: "channel_unsubscribe({ topic }) — 退订频道",
		parameters: unsubscribeParams,
		async execute(_toolCallId, params) {
			const topic = String((params as { topic?: unknown }).topic ?? "").trim();
			const result = deps.unsubscribe(topic);
			if (!result.ok) return textResult(`退订失败：${result.error ?? "未知错误"}`);
			return textResult(`已退订频道 [${topic}]。`);
		},
	};

	const post: ToolDefinition<typeof postParams> = {
		name: "channel_post",
		label: "Post channel message",
		description:
			"向协作频道发消息（追加到 .local/agent-work/channel/<topic>/MESSAGES.md），订阅该频道的会话会自动收到唤醒查收。写完一组频道文件后必须调一次 post 通知对方：只写文件不 post 不会通知。closed=true 表示任务/频道终态，订阅方查收后退订。",
		promptSnippet: "channel_post({ topic, message, closed? }) — 向频道发消息并唤醒订阅者",
		parameters: postParams,
		async execute(_toolCallId, params) {
			const topic = String((params as { topic?: unknown }).topic ?? "").trim();
			const invalid = validateTopic(topic);
			if (invalid) return textResult(`发送失败：${invalid}`);
			const message = String((params as { message?: unknown }).message ?? "").trim();
			if (message.length === 0) return textResult("发送失败：message 不能为空");
			const closed = (params as { closed?: unknown }).closed === true;
			const result = await deps.post(topic, message, closed);
			if (!result.ok) return textResult(`发送失败：${result.error ?? "未知错误"}`);
			const lines = [
				`已发送到频道 [${topic}]（${channelRoot(deps.cwd)}/${topic}/MESSAGES.md）。`,
				"订阅该频道的会话会自动收到唤醒并查收本条消息。",
			];
			if (closed) {
				lines.push("频道已标记关闭（[CLOSED]）：订阅方查收后将退订本频道，本会话如已订阅也请退订。");
			}
			return textResult(lines.join("\n"));
		},
	};

	const list: ToolDefinition<ReturnType<typeof Type.Object>> = {
		name: "channel_list",
		label: "List channels",
		description: "列出本项目全部协作频道与本会话的订阅状态（含因频繁互触发被暂停的频道）。",
		promptSnippet: "channel_list() — 列出频道与订阅状态",
		parameters: Type.Object({}),
		async execute() {
			const subs = deps.getSubscriptions();
			const paused = new Set(deps.pausedTopics().map((p) => p.topic));
			const root = channelRoot(deps.cwd);
			let dirs: string[] = [];
			try {
				const { readdir } = await import("node:fs/promises");
				const entries = await readdir(root, { withFileTypes: true });
				dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
			} catch {
				dirs = [];
			}

			for (const s of subs) if (!dirs.includes(s)) dirs.push(s);
			if (dirs.length === 0) {
				return textResult(`频道根 ${root} 下暂无频道目录，本会话也未订阅任何频道。`);
			}
			const lines = dirs.sort().map((d) => {
				const state = subs.has(d) ? "已订阅" : "未订阅";
				const pause = paused.has(d) ? " ⚠️已暂停（互触发上限，重新订阅可恢复）" : "";
				return `- ${d}：${state}${pause}`;
			});
			return textResult([`频道根：${root}`, ...lines].join("\n"));
		},
	};

	return [subscribe, unsubscribe, post, list];
}
