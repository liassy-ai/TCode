import type { TurnChanges, TurnTiming } from "@tcode/shared";
import { memo, useState } from "react";
import { useT } from "../../i18n";
import { Slot } from "../../plugins/Slot";
import { UI_SLOTS } from "../../plugins/slots";
import { openSubagentSessionTab } from "../../sidepane/openers";
import type { UIMessage } from "../../stores/transcript";
import { AgentBubble } from "./AgentBubble";
import { AssistantMessage } from "./AssistantMessage";
import { ErrorNote } from "./ErrorNote";
import { ImagePreviewOverlay, imageSrc } from "./ImagePreview";
import { Markdown } from "./Markdown";
import { CopyButton, ForkButton } from "./message-actions";
import { SubagentRunCard } from "./SubagentRunCard";
import { SystemMessage } from "./SystemMessage";
import { TurnDiffChip } from "./TurnDiffChip";
import { UserMessage } from "./UserMessage";

export const MessageItem = memo(function MessageItem({
	message,
	streaming,
	metaInGroup,
	showActions = true,
	turnTiming,
	turnChanges,
	sessionId = null,
}: {
	message: UIMessage;
	streaming?: boolean;

	metaInGroup?: boolean;

	showActions?: boolean;

	turnTiming?: TurnTiming;

	turnChanges?: TurnChanges;

	sessionId?: string | null;
}) {
	const t = useT();
	const [previewIndex, setPreviewIndex] = useState<number | null>(null);

	if (message.kind === "user") {
		return <UserMessage message={message} sessionId={sessionId} />;
	}

	if (message.kind === "image") {
		const count = message.images.length;
		const sizeClass =
			count === 1
				? "max-h-36 max-w-48 object-contain"
				: count <= 3
					? "h-24 w-24 object-cover"
					: count <= 6
						? "h-20 w-20 object-cover"
						: "h-16 w-16 object-cover";
		return (
			<div>
				<div className="flex flex-wrap gap-2">
					{message.images.map((image, index) => (
						<button
							key={index}
							type="button"
							className="overflow-hidden rounded-xl border border-border"
							onClick={() => setPreviewIndex(index)}
						>
							<img src={imageSrc(image)} alt={t("message.image")} className={sizeClass} />
						</button>
					))}
				</div>
				{previewIndex !== null && (
					<ImagePreviewOverlay
						images={message.images}
						initialIndex={previewIndex}
						onClose={() => setPreviewIndex(null)}
					/>
				)}
			</div>
		);
	}

	if (message.kind === "subagent") {
		return <Slot name={UI_SLOTS.SubagentCard} props={{ runs: message.runs }} fallback={SubagentRunCard} />;
	}

	if (message.kind === "agent") {
		const file = message.sessionFile;
		return (
			<AgentBubble
				name={message.agent}
				status={message.streaming ? "running" : undefined}
				onAvatarClick={
					file
						? () =>
								openSubagentSessionTab({
									file,
									agent: message.agent,
									task: "",
									sessionId: sessionId ?? null,
								})
						: undefined
				}
			>
				<Markdown text={message.text} />
			</AgentBubble>
		);
	}

	if (message.kind === "error") {
		return <ErrorNote sessionId={sessionId} cardId={message.id} error={message.error} />;
	}

	if (message.kind === "system") {
		return <SystemMessage message={message} />;
	}

	return (
		<div className="group">
			<AssistantMessage
				text={message.text}
				thinking={message.thinking}
				tools={message.tools}
				streaming={streaming}
				metaInGroup={metaInGroup}
			/>

			{!streaming && message.text && showActions && (
				<div className="pointer-coarse:hidden mt-0.5 flex items-start gap-1.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
					<CopyButton text={message.text} />
					<ForkButton
						entryId={message.entryId}
						matchText={message.sourceText ?? message.text}
						sessionId={sessionId}
					/>
					{(turnTiming || turnChanges) && (
						<TurnDiffChip changes={turnChanges} timing={turnTiming} running={false} entering={false} />
					)}
				</div>
			)}
		</div>
	);
});
