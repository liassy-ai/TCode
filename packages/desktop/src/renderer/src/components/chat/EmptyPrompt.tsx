import { useT } from "../../i18n";
import { folderName } from "../../lib/folder-name";
import { useSessionsStore } from "../../stores/sessions";

function CloudMark({ size }: { size: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.45}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className="text-ink"
		>
			<path d="M4.6 18h12.9a3.6 3.6 0 0 0 .45-7.16A6.1 6.1 0 0 0 7.2 9.7 3.9 3.9 0 0 0 4.6 18Z" />
			<path d="M9.7 11.9 11.5 13.7 9.7 15.5" />
			<path d="M13 15.5h2.5" />
		</svg>
	);
}

export function EmptyPrompt() {
	const t = useT();
	const cwd = useSessionsStore((s) => s.cwd);

	return (
		<div className="flex select-none flex-row items-center gap-4.5">
			<CloudMark size={76} />
			<p
				className="max-w-[min(620px,78vw)] text-center text-[28px] font-normal leading-tight break-words text-ink"
				title={cwd || undefined}
			>
				{cwd ? t("chat.emptyPromptWithFolder", { name: folderName(cwd) }) : t("chat.emptyPrompt")}
			</p>
		</div>
	);
}
