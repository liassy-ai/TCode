import type { UIToolCall } from "../../stores/transcript";
import { Markdown } from "./Markdown";
import { MetaGroup, type MetaItem } from "./MetaGroup";

export function AssistantMessage({
	text,
	thinking,
	tools,
	streaming,
	metaInGroup = false,
}: {
	text: string;
	thinking: string;
	tools: UIToolCall[];
	streaming?: boolean;

	metaInGroup?: boolean;
}) {
	const items: MetaItem[] = [];
	if (!metaInGroup && (thinking || tools.length > 0)) items.push({ thinking, tools });

	return (
		<div className="flex flex-col gap-2">
			{items.length > 0 && <MetaGroup items={items} working={Boolean(streaming) && !text} />}
			{text && <Markdown text={text} streaming={streaming} />}
			{streaming && !text && !thinking && tools.length === 0 && (
				<div className="flex items-center gap-1 text-ink-faint">
					<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-faint" />
					<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-faint [animation-delay:150ms]" />
					<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-faint [animation-delay:300ms]" />
				</div>
			)}
		</div>
	);
}
