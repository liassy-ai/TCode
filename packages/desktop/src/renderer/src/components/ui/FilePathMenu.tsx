import { getPi } from "../../api";
import { useT } from "../../i18n";
import { errText } from "../../lib/error-text";
import { openCodeViewerTab } from "../../sidepane/openers";
import { useToastsStore } from "../../stores/toasts";
import { CopyIcon, FileTextIcon, FolderIcon } from "../icons";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import type { MenuAnchor } from "./place-menu";

export function FilePathMenu({
	target,
	cwd,
	anchor,
	onClose,
}: {
	target: string;

	cwd: string | null;
	anchor: MenuAnchor;
	onClose: () => void;
}) {
	const t = useT();

	const run = async (action: "open" | "preview" | "reveal" | "copy") => {
		try {
			if (action === "copy") {
				const resolved = await getPi().resolvePath({ target, cwd });
				await navigator.clipboard.writeText(resolved);

				useToastsStore.getState().push("info", "toast.pathCopied", resolved);
				return;
			}
			if (action === "preview") {
				const resolved = await getPi().resolvePath({ target, cwd });
				openCodeViewerTab(resolved);
				return;
			}
			if (action === "open") await getPi().openPath({ target, cwd });
			else await getPi().revealPath({ target, cwd });
		} catch (error) {
			console.error("文件路径操作失败", { action, target, error });
			const key =
				action === "copy"
					? "toast.pathCopyFailed"
					: action === "preview"
						? "toast.pathPreviewFailed"
						: action === "reveal"
							? "toast.pathRevealFailed"
							: "toast.pathOpenFailed";
			useToastsStore.getState().push("error", key, errText(error));
		}
	};

	const items: ContextMenuItem[] = [
		{
			key: "open",
			label: t("pathMenu.open"),
			icon: <FileTextIcon size={13} />,
			onSelect: () => void run("open"),
		},

		...(cwd
			? [
					{
						key: "preview",
						label: t("pathMenu.preview"),
						icon: <FileTextIcon size={13} />,
						onSelect: () => void run("preview"),
					},
				]
			: []),
		{
			key: "reveal",
			label: t("pathMenu.reveal"),
			icon: <FolderIcon size={13} />,
			onSelect: () => void run("reveal"),
		},
		{
			key: "copy",
			label: t("pathMenu.copyPath"),
			icon: <CopyIcon size={13} />,
			onSelect: () => void run("copy"),
		},
	];

	return <ContextMenu anchor={anchor} items={items} onClose={onClose} />;
}
