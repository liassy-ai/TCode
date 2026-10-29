import { useEffect } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import { useAppQuitStore } from "../../stores/app-quit";
import { ConfirmDialog } from "./ConfirmDialog";

export function QuitConfirmDialog() {
	const t = useT();
	const visible = useAppQuitStore((s) => s.visible);

	useEffect(() => {
		if (visible) void getPi().quitDialogShown();
	}, [visible]);

	if (!visible) return null;
	return (
		<ConfirmDialog
			title={t("quitConfirm.title")}
			description={t("quitConfirm.desc")}
			confirmLabel={t("quitConfirm.confirm")}
			cancelLabel={t("common.cancel")}
			autoFocusConfirm
			onConfirm={() => {
				void getPi().confirmQuit();
			}}
			onCancel={() => useAppQuitStore.setState({ visible: false })}
		/>
	);
}
