import type { UIMessage } from "./types";

export interface TurnTiming {
	turnIndex: number;
	startedAt: number;
	endedAt?: number;
}

function stampOf(message: UIMessage): number | undefined {
	if (message.kind === "assistant") {
		let max: number | undefined = message.timestamp;
		for (const tool of message.tools) {
			if (tool.endedAt !== undefined && (max === undefined || tool.endedAt > max)) max = tool.endedAt;
		}
		return max;
	}
	if (message.kind === "subagent" || message.kind === "image") return message.timestamp;
	return undefined;
}

export function deriveTurnTimings(messages: UIMessage[], runEndedAt?: number): TurnTiming[] {
	const timings: TurnTiming[] = [];
	let turnIndex = -1;
	let startedAt = 0;
	let endedAt: number | undefined;
	let open = false;

	const flush = (): void => {
		if (!open) return;

		timings.push({
			turnIndex,
			startedAt,
			...(endedAt !== undefined && endedAt > startedAt ? { endedAt } : {}),
		});
	};

	for (const message of messages) {
		if (message.kind === "user") {
			flush();
			turnIndex++;
			open = true;
			startedAt = message.timestamp;
			endedAt = undefined;
			continue;
		}
		if (!open) continue;
		const stamp = stampOf(message);
		if (stamp !== undefined && (endedAt === undefined || stamp > endedAt)) endedAt = stamp;
	}
	flush();

	if (runEndedAt !== undefined && timings.length > 0) {
		const last = timings[timings.length - 1];
		if (last && runEndedAt > last.startedAt && (last.endedAt === undefined || runEndedAt > last.endedAt)) {
			timings[timings.length - 1] = { ...last, endedAt: runEndedAt };
		}
	}
	return timings;
}
