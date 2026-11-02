import { useEffect, useRef, useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import { usePluginNotifyStore } from "../../stores/plugin-notify";
import { useUpdateStore } from "../../stores/update";
import { BugReportDialog } from "./BugReportDialog";
import { ReleaseNotes } from "./ReleaseNotes";

export function UpdatePanel() {
	const t = useT();
	const current = useUpdateStore((s) => s.current);
	const status = useUpdateStore((s) => s.status);
	const version = useUpdateStore((s) => s.version);
	const notes = useUpdateStore((s) => s.notes);
	const percent = useUpdateStore((s) => s.percent);
	const error = useUpdateStore((s) => s.error);
	const required = useUpdateStore((s) => s.required);
	const download = useUpdateStore((s) => s.download);
	const install = useUpdateStore((s) => s.install);
	const channel = usePluginNotifyStore((s) => s.updateChannel);
	const channelLocked = usePluginNotifyStore((s) => s.updateChannelLocked);

	const locked = channelLocked;
	const internalAvailable = usePluginNotifyStore((s) => s.internalAvailable);
	const versionChannel = usePluginNotifyStore((s) => s.versionChannel);
	const internalState = usePluginNotifyStore((s) => s.internalState);
	const internalVersion = usePluginNotifyStore((s) => s.internalVersion);

	const [checking, setChecking] = useState(false);
	const [applying, setApplying] = useState(false);
	const [bugOpen, setBugOpen] = useState(false);

	const [loggedIn, setLoggedIn] = useState(false);
	const publishedChannels = usePluginNotifyStore((s) => s.channels);

	const internalVisible = loggedIn && (internalAvailable || publishedChannels.includes("internal"));

	const canApplyInternal = internalAvailable && internalState !== "approved" && internalState !== "pending";

	const chipChannels = [
		{ v: "stable", label: t("settings.channel.stable") },
		...(loggedIn && publishedChannels.includes("beta")
			? [{ v: "beta", label: t("settings.channel.beta") }]
			: []),
		...(internalVisible ? [{ v: "internal", label: t("settings.channel.internal") }] : []),
	];
	const showChannels = publishedChannels.length > 0;

	const [showInternal, setShowInternal] = useState(false);
	const [releaseNotes, setReleaseNotes] = useState<{ version: string; notes: string; url: string } | null>(
		null,
	);
	const [notesLoading, setNotesLoading] = useState(false);
	const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		const apply = (p: { name?: string } | null) => setLoggedIn(Boolean((p?.name ?? "").trim()));
		const off = getPi().onPluginProfile(apply);
		void getPi()
			.pluginProfileGet()
			.then(apply)
			.catch(() => undefined);
		return off;
	}, []);

	useEffect(() => {
		if (!internalVisible) setShowInternal(false);
	}, [internalVisible]);

	useEffect(() => {
		void useUpdateStore.getState().init();
		return () => {
			if (checkTimer.current) clearTimeout(checkTimer.current);
		};
	}, []);

	const pickChannel = (v: string) => {
		if (v === channel) return;
		usePluginNotifyStore.setState({ updateChannel: v });
		void getPi()
			.pluginCommand({ cmd: `update-channel:${v}` })
			.catch(() => undefined);
	};

	const applyInternal = () => {
		setApplying(true);

		setTimeout(() => setApplying(false), 5000);
		void getPi()
			.pluginCommand({ cmd: "apply-internal" })
			.catch(() => setApplying(false));
	};

	const checkNow = () => {
		setChecking(true);
		if (checkTimer.current) clearTimeout(checkTimer.current);

		checkTimer.current = setTimeout(() => setChecking(false), 4000);
		void getPi()
			.pluginCommand({ cmd: "check-update" })
			.catch(() => setChecking(false));
	};

	const pendingVersion =
		status === "available" || status === "downloading" || status === "downloaded" ? version : "";

	const internalTarget = showInternal && internalVersion ? internalVersion : "";
	const targetVersion =
		(status === "available" && version) || pendingVersion || internalTarget || current || "";

	useEffect(() => {
		const want = targetVersion.trim();
		if (!want) {
			setReleaseNotes(null);
			return;
		}
		let alive = true;
		setNotesLoading(true);
		void getPi()
			.getReleaseNotes({ version: want })
			.then((res) => {
				if (alive) setReleaseNotes(res ?? null);
			})
			.catch(() => {
				if (alive) setReleaseNotes(null);
			})
			.finally(() => {
				if (alive) setNotesLoading(false);
			});
		return () => {
			alive = false;
		};
	}, [targetVersion]);

	const showInternalTarget =
		internalTarget !== "" && status !== "available" && internalTarget !== (pendingVersion || current);

	const statusText =
		status === "available"
			? `${t("settings.newVersionAvailable")} v${version}`
			: status === "downloading"
				? `${percent}%`
				: status === "downloaded"
					? t("settings.updateReady")
					: status === "error"
						? error || t("settings.updateFailed")
						: t("settings.upToDate");

	const statusLine =
		showInternal && internalVersion && internalState !== "approved" && status !== "available"
			? t("settings.internalNeedApproved")
			: statusText;

	const channelBadge =
		versionChannel === "internal" ? (
			<span className="rounded-md bg-amber-500/15 px-1.5 py-[1px] text-[11px] font-medium text-amber-600">
				{t("settings.channel.internal")}
			</span>
		) : versionChannel === "beta" ? (
			<span className="rounded-md bg-blue-500/12 px-1.5 py-[1px] text-[11px] font-medium text-blue-600">
				{t("settings.channel.beta")}
			</span>
		) : null;

	return (
		<div className="flex flex-col gap-6">
			<div>
				<div className="flex items-center justify-between gap-4">
					<h3 className="text-[13px] font-medium text-ink">
						{t("settings.softwareVersion")}

						{pendingVersion ? (
							<span className="ml-2 font-mono text-[12px] font-normal text-ink-faint">v{current || "…"}</span>
						) : null}
					</h3>
					<div className="flex rounded-lg border border-border p-[2px]">
						{}
						<button
							type="button"
							onClick={() => setBugOpen(true)}
							className="rounded-md px-3 py-[3px] text-[12px] text-ink-faint transition-colors hover:bg-hover hover:text-ink"
						>
							{t("settings.bugTitle")}
						</button>
						{showChannels
							? chipChannels.map((c) => (
									<button
										key={c.v}
										type="button"
										disabled={locked}
										className={`rounded-md px-3 py-[3px] text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
											!locked && (showInternal ? c.v === "internal" : channel === c.v)
												? "bg-ink text-on-ink"
												: "text-ink-faint hover:text-ink"
										}`}
										onClick={() => {
											if (c.v === "internal") {
												setShowInternal(true);

												pickChannel("internal");
												return;
											}
											setShowInternal(false);
											pickChannel(c.v);
										}}
									>
										{c.label}
									</button>
								))
							: null}
					</div>
				</div>
				<div className="relative mt-8 overflow-hidden rounded-[26px] border border-border bg-surface-solid px-8 py-9 shadow-[var(--diff-card-shadow)]">
					<span
						aria-hidden="true"
						className="pointer-events-none absolute inset-0"
						style={{
							background:
								"radial-gradient(120% 88% at 50% -18%, color-mix(in oklab, var(--color-ink) 10%, transparent), transparent 68%)",
						}}
					/>
					<div className="relative flex flex-col items-center gap-5">
						<span className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-[11px] tracking-wide text-ink-2">
							<span
								className={`size-1.5 rounded-full ${
									status === "available" || status === "downloaded" ? "bg-ink" : "bg-ink-faint"
								}`}
							/>
							{status === "available" || status === "downloaded"
								? t("settings.newVersionAvailable")
								: status === "downloading"
									? t("settings.downloadUpdate")
									: t("settings.upToDate")}
						</span>
						<div className="flex items-center gap-2.5">
							<span className="font-mono text-[44px] font-semibold leading-none tracking-tight text-ink">
								v
								{status === "available"
									? version
									: showInternalTarget
										? internalTarget
										: pendingVersion || current || "…"}
							</span>
							{channelBadge}
						</div>
						{status === "downloading" ? (
							<div className="w-full max-w-[300px]">
								<div className="h-1.5 w-full overflow-hidden rounded-full bg-hover">
									<div
										className="h-full rounded-full bg-ink transition-[width] duration-200"
										style={{ width: `${Math.max(2, percent)}%` }}
									/>
								</div>
								<div className="mt-2 text-center font-mono text-[11px] text-ink-faint">{percent}%</div>
							</div>
						) : null}
						<div className="flex items-center gap-2.5">
							{status === "available" ? (
								<button
									type="button"
									className="min-w-[132px] rounded-full bg-ink px-8 py-3 text-[13.5px] font-medium text-on-ink transition-opacity hover:opacity-90"
									onClick={() => void download()}
								>
									{t("settings.downloadUpdate")}
								</button>
							) : status === "downloaded" ? (
								<button
									type="button"
									className="min-w-[132px] rounded-full bg-ink px-8 py-3 text-[13.5px] font-medium text-on-ink transition-opacity hover:opacity-90"
									onClick={() => void install()}
								>
									{t("settings.installUpdate")}
								</button>
							) : null}
							{status === "available" ||
							status === "downloaded" ||
							status === "downloading" ? null : showInternal && canApplyInternal ? (
								<button
									type="button"
									disabled={applying}
									className="min-w-[132px] rounded-full bg-ink px-8 py-3 text-[13.5px] font-medium text-on-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
									onClick={applyInternal}
								>
									{applying
										? t("settings.internalApplying")
										: internalState === "rejected"
											? t("settings.internalReapply")
											: t("settings.internalApply")}
								</button>
							) : (
								<button
									type="button"
									disabled={checking}
									className="rounded-full border border-border px-6 py-2.5 text-[13px] text-ink-2 transition-colors hover:border-border-strong hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60"
									onClick={checkNow}
								>
									{checking ? t("settings.checking") : t("settings.checkUpdate")}
								</button>
							)}
						</div>
					</div>
				</div>
			</div>

			{showInternal ? (
				<div>
					<div className="flex items-center justify-between gap-4">
						{internalAvailable ? (
							<p className="text-[11px] leading-relaxed text-ink-faint">
								{t("settings.internalAvailableHint")}
							</p>
						) : null}
						<div className="flex shrink-0 items-center gap-3">
							{internalState === "approved" ? (
								<span className="text-[12.5px] text-ink-dim">{t("settings.internalApproved")}</span>
							) : internalState === "pending" ? (
								<span className="text-[12.5px] text-ink-dim">{t("settings.internalPending")}</span>
							) : internalState === "rejected" ? (
								<span className="text-[12.5px] text-ink-dim">{t("settings.internalRejected")}</span>
							) : null}
						</div>
					</div>
				</div>
			) : null}
			<div>
				<div className="flex items-center justify-between gap-4">
					<h3 className="text-[13px] font-medium text-ink">{t("settings.updateStatus")}</h3>
					{status === "available" ? null : <span className="text-[12.5px] text-ink-faint">{statusLine}</span>}
				</div>
				{status === "available" && notes ? (
					<div className="mt-2 rounded-lg border border-border bg-surface-solid px-3 py-2">
						<ReleaseNotes text={notes} />
					</div>
				) : (
					<div className="mt-2 rounded-lg border border-border bg-surface-solid px-3 py-2">
						{notesLoading ? (
							<div className="text-[12px] text-ink-faint">{t("settings.releaseNotesLoading")}</div>
						) : releaseNotes?.notes ? (
							<div>
								<ReleaseNotes text={releaseNotes.notes} />
							</div>
						) : (
							<div className="text-[12px] text-ink-faint">{t("settings.releaseNotesEmpty")}</div>
						)}
					</div>
				)}
				{required ? (
					<div className="mt-2 text-[11.5px] text-ink-faint">{t("settings.updateRequired")}</div>
				) : null}
			</div>

			{bugOpen ? <BugReportDialog onClose={() => setBugOpen(false)} /> : null}
		</div>
	);
}
