import { useEffect, useRef, useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import { usePluginNotifyStore } from "../../stores/plugin-notify";
import { useUpdateStore } from "../../stores/update";

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
					{showChannels ? (
						<div className="flex rounded-lg border border-border p-[2px]">
							{chipChannels.map((c) => (
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
							))}
						</div>
					) : null}
				</div>
				<div className="mt-10 flex flex-col items-center gap-2">
					<div className="flex items-center gap-2">
						{status === "available" ? (
							<span className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
								{t("settings.newVersionAvailable")}
								<span className="font-mono text-[22px] font-semibold">v{version}</span>
								{channelBadge}
							</span>
						) : showInternalTarget ? (
							<span className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
								{t("settings.newVersionAvailable")}
								<span className="font-mono text-[22px] font-semibold">v{internalTarget}</span>
								<span className="rounded-md bg-amber-500/15 px-1.5 py-[1px] text-[11px] font-medium text-amber-600">
									{t("settings.channel.internal")}
								</span>
							</span>
						) : (
							<span className="font-mono text-[22px] font-semibold text-ink">
								v{pendingVersion || current || "…"}
							</span>
						)}
					</div>
					<div className="flex items-center gap-2">
						{status === "available" ? (
							<button
								type="button"
								className="rounded-lg bg-ink px-3 py-1.5 text-[12.5px] text-on-ink transition-opacity hover:opacity-90"
								onClick={() => void download()}
							>
								{t("settings.downloadUpdate")}
							</button>
						) : status === "downloaded" ? (
							<button
								type="button"
								className="rounded-lg bg-ink px-3 py-1.5 text-[12.5px] text-on-ink transition-opacity hover:opacity-90"
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
								className="rounded-lg bg-ink px-3 py-1.5 text-[12.5px] text-on-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
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
								className="rounded-lg border border-border px-3 py-1.5 text-[12.5px] text-ink-2 transition-colors hover:border-border-strong hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60"
								onClick={checkNow}
							>
								{checking ? t("settings.checking") : t("settings.checkUpdate")}
							</button>
						)}
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
				{status === "downloading" ? (
					<div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-hover">
						<div
							className="h-full rounded-full bg-ink transition-[width] duration-200"
							style={{ width: `${Math.max(2, percent)}%` }}
						/>
					</div>
				) : null}
				{status === "available" && notes ? (
					<div className="mt-2 whitespace-pre-wrap rounded-lg border border-border bg-surface-solid px-3 py-2 text-[12px] leading-relaxed text-ink-2">
						{notes}
					</div>
				) : null}
				{required ? (
					<div className="mt-2 text-[11.5px] text-ink-faint">{t("settings.updateRequired")}</div>
				) : null}
			</div>
		</div>
	);
}
