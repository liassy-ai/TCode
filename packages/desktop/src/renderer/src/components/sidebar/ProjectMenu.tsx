import type { Translate } from "../../i18n";
import { PinIcon, TrashIcon } from "../icons";
import type { ContextMenuItem } from "../ui/ContextMenu";

export function projectMenuItems(
	t: Translate,
	ops: { pinned: boolean; onTogglePin: () => void; onRemove?: () => void },
): ContextMenuItem[] {
	return [
		{
			key: "pin",
			label: ops.pinned ? t("sidebar.unpin") : t("sidebar.pin"),
			icon: <PinIcon size={13} />,
			onSelect: ops.onTogglePin,
		},
		...(ops.onRemove
			? [
					{
						key: "remove",
						label: t("sidebar.removeProject"),
						icon: <TrashIcon size={13} />,
						separatorBefore: true,
						danger: true,
						onSelect: ops.onRemove,
					} satisfies ContextMenuItem,
				]
			: []),
	];
}
