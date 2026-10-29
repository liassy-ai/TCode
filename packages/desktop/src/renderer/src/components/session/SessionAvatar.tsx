import type { SessionMeta } from "@tcode/shared";
import { isDailyCwd } from "../../lib/daily";
import { CoffeeIcon, SubagentIcon } from "../icons";
import { type SessionStatus, sessionAvatarClass, sessionLetter } from "./session-status";

export function SessionAvatar({
	session,
	status,
	isActive,
	size = 16,

	dotRing = "ring-surface",
}: {
	session: SessionMeta;
	status: SessionStatus;
	isActive: boolean;

	size?: 16 | 18;
	dotRing?: "ring-canvas" | "ring-surface";
}) {
	const daily = isDailyCwd(session.cwd);
	const box = size === 18 ? "h-[18px] w-[18px] rounded-[5px] text-[10.5px]" : "h-4 w-4 rounded text-[10px]";
	return (
		<span
			className={`relative flex shrink-0 items-center justify-center font-semibold ${box} ${sessionAvatarClass(
				status,
				{ isActive, daily, readOnly: session.readOnly },
			)}`}
		>
			{session.readOnly ? (
				<SubagentIcon size={11} />
			) : daily ? (
				<CoffeeIcon size={10} />
			) : (
				sessionLetter(session).toUpperCase()
			)}
			{!session.readOnly && status === "done" && (
				<span
					className={`absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-green-500 ring-1 ${dotRing}`}
				/>
			)}
		</span>
	);
}
