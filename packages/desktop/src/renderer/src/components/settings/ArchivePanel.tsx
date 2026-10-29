import type { ArchiveEntry } from "@tcode/shared";
import { useCallback, useEffect, useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import { pushToast } from "../../stores/toasts";
import { ConfirmDialog } from "../ui/ConfirmDialog";

export function ArchivePanel() {
	const t = useT();
	const [entries, setEntries] = useState<ArchiveEntry[]>([]);
	const [busy, setBusy] = useState<string | null>(null);
	const [pendingDelete, setPendingDelete] = useState<ArchiveEntry | null>(null);

	const load = useCallback(async () => {
		setEntries(await getPi().listArchives());
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const restore = async (dir: string) => {
		setBusy(dir);
		const result = await getPi().restoreArchive({ dir });
		setBusy(null);

		if (result.ok) pushToast("info", "toast.archiveRestored");
		else pushToast("warning", result.reason === "conflict" ? "toast.archiveConflict" : "toast.archiveFailed");
		await load();
	};

	const remove = async (dir: string) => {
		setBusy(dir);
		await getPi().deleteArchive({ dir });
		setBusy(null);
		pushToast("info", "toast.archiveDeleted");
		await load();
	};

	return (
		<section className="flex flex-col gap-3">
			<div className="flex items-baseline justify-between gap-3">
				<h3 className="text-[13px] font-semibold text-ink">{t("settings.archive.title")}</h3>
				<span className="text-[12px] text-ink-faint">
					{t("settings.archive.hint", { count: entries.length })}
				</span>
			</div>
			{entries.length === 0 ? (
				<p className="rounded-xl border border-border px-3 py-8 text-center text-[13px] text-ink-faint">
					{t("settings.archive.empty")}
				</p>
			) : (
				<ul className="flex flex-col gap-1.5">
					{entries.map((entry) => (
						<li key={entry.dir} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2">
							<div className="min-w-0 flex-1">
								<div className="truncate text-[13px] text-ink-2">
									{entry.name || t("settings.archive.untitled")}
								</div>
								<div className="truncate text-[12px] text-ink-faint">
									{entry.project} · {new Date(entry.archivedAt).toLocaleString()} ·{" "}
									{Math.max(1, Math.round(entry.sizeBytes / 1024))} KB
								</div>
							</div>
							<button
								type="button"
								className="flex h-8 shrink-0 items-center rounded-[9px] px-3 text-[13px] text-ink-dim transition-colors hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
								disabled={busy === entry.dir}
								onClick={() => void restore(entry.dir)}
							>
								{t("settings.archive.restore")}
							</button>
							<button
								type="button"
								className="flex h-8 shrink-0 items-center rounded-[9px] bg-red-600/12 px-3 text-[13px] font-medium text-red-600 transition-colors hover:bg-red-600/20 disabled:cursor-not-allowed disabled:opacity-50"
								disabled={busy === entry.dir}
								onClick={() => setPendingDelete(entry)}
							>
								{t("settings.archive.delete")}
							</button>
						</li>
					))}
				</ul>
			)}
			{pendingDelete && (
				<ConfirmDialog
					title={t("settings.archive.deleteTitle")}
					description={t("settings.archive.deleteDesc")}
					confirmLabel={t("settings.archive.delete")}
					cancelLabel={t("common.cancel")}
					onConfirm={async () => {
						const dir = pendingDelete.dir;
						setPendingDelete(null);
						await remove(dir);
					}}
					onCancel={() => setPendingDelete(null)}
				/>
			)}
		</section>
	);
}
