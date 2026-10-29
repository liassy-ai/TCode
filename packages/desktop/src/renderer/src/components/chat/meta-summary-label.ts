import { ASK_TOOL_NAMES, type SummarySegment } from "@tcode/shared";
import type { useT } from "../../i18n";
import { displayName } from "./tool-label";

const pluralUnit = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function summaryLabel(t: ReturnType<typeof useT>, seg: SummarySegment): string {
	switch (seg.category) {
		case "read":
			return t("message.summaryRead", { n: seg.count, unit: pluralUnit(seg.count, "file", "files") });
		case "edit":
			return t("message.summaryEdit", { n: seg.count, unit: pluralUnit(seg.count, "file", "files") });
		case "explore":
			return t("message.summaryExplore", { n: seg.count, unit: pluralUnit(seg.count, "time", "times") });
		case "search":
			return t("message.summarySearch", { n: seg.count, unit: pluralUnit(seg.count, "time", "times") });
		case "bash":
			return t("message.summaryBash", { n: seg.count, unit: pluralUnit(seg.count, "command", "commands") });
		case "ptc":
			return t("message.summaryPtc", { n: seg.count, unit: pluralUnit(seg.count, "round", "rounds") });
		case "subagent":
			return t("message.summarySubagents", {
				n: seg.count,
				unit: pluralUnit(seg.count, "subagent", "subagents"),
			});
		default:
			if (ASK_TOOL_NAMES.has(seg.name))
				return `${displayName(seg.name, t)} ${t("tool.askUserIssues", { count: seg.count })}`;
			return `${displayName(seg.name, t)} ×${seg.count}`;
	}
}
