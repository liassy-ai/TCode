import type { PluginProfile } from "@tcode/shared";
import { useEffect, useRef, useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import { usePluginNotifyStore } from "../../stores/plugin-notify";
import { useSettingsStore } from "../../stores/settings";
import { useUiPluginsStore } from "../../stores/ui-plugins";
import { useUpdateStore } from "../../stores/update";
import { DownloadIcon, GearIcon, LogoutIcon, PetIcon, UserIcon } from "../icons";
import { ConfirmDialog } from "../ui/ConfirmDialog";

function Avatar({ name, avatar, size = 28 }: { name: string; avatar?: string; size?: number }) {
	if (avatar) {
		return (
			<img
				src={avatar}
				alt=""
				className="shrink-0 rounded-full object-cover"
				style={{ width: size, height: size }}
			/>
		);
	}
	return (
		<div
			title={name}
			className="flex shrink-0 items-center justify-center rounded-full bg-hover text-ink-2"
			style={{ width: size, height: size }}
		>
			<UserIcon size={Math.round(size * 0.58)} />
		</div>
	);
}

function UpdateControl() {
	const t = useT();
	const status = useUpdateStore((s) => s.status);
	const percent = useUpdateStore((s) => s.percent);
	const error = useUpdateStore((s) => s.error);
	const download = useUpdateStore((s) => s.download);
	const install = useUpdateStore((s) => s.install);
	const version = useUpdateStore((s) => s.version);
	const required = useUpdateStore((s) => s.required);
	const notes = useUpdateStore((s) => s.notes);

	if (status === "available") {
		return (
			<button
				type="button"
				aria-label={t("sidebar.updateDownload")}
				title={[required ? `必须升级到 ${version}` : t("sidebar.updateDownload"), notes]
					.filter(Boolean)
					.join("\n")}
				className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-hover ${required ? "text-error" : "text-ink-dim hover:text-ink"}`}
				onClick={(e) => {
					e.stopPropagation();
					void download();
				}}
			>
				<DownloadIcon size={16} />
			</button>
		);
	}
	if (status === "downloading") {
		return (
			<span
				className="flex h-7 shrink-0 items-center gap-1 rounded-md px-1 text-[10px] tabular-nums text-ink-faint"
				title={t("sidebar.updateDownload")}
			>
				<span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-ink-faint border-t-transparent" />
				{percent > 0 ? `${percent}%` : ""}
			</span>
		);
	}
	if (status === "downloaded") {
		return (
			<button
				type="button"
				aria-label={t("sidebar.updateInstall")}
				title={t("sidebar.updateInstall")}
				className="flex h-7 shrink-0 items-center rounded-md px-2 text-[12px] font-medium text-ink-dim hover:bg-hover hover:text-ink"
				onClick={(e) => {
					e.stopPropagation();
					void install();
				}}
			>
				{t("sidebar.updateInstall")}
			</button>
		);
	}
	if (status === "error") {
		return (
			<button
				type="button"
				aria-label={t("sidebar.updateDownload")}
				title={error || t("sidebar.updateDownload")}
				className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-error hover:bg-hover"
				onClick={(e) => {
					e.stopPropagation();
					void download();
				}}
			>
				<DownloadIcon size={16} />
			</button>
		);
	}
	return null;
}

function LoginQr({
	image,
	text,
	scanned,
	pending,
	refreshing,
	onRefresh,
}: {
	image?: string;
	text?: string;
	scanned?: boolean;
	pending?: boolean;
	refreshing?: boolean;
	onRefresh?: () => void;
}) {
	const waiting = pending === true || (refreshing === true && !image);
	return (
		<div className="flex flex-col items-center gap-2 px-2 py-2">
			{scanned ? (
				<div className="flex h-[168px] w-[168px] flex-col items-center justify-center gap-1 text-center">
					<span className="text-[13px] font-medium text-ink">已扫码</span>
					<span className="text-[11px] text-ink-faint">请在手机上确认</span>
				</div>
			) : image ? (
				<>
					<div className="text-[12.5px] font-medium text-ink">{text || "请使用微信扫码登录"}</div>
					<img src={image} alt="登录二维码" className="h-[168px] w-[168px] rounded-lg bg-white" />
				</>
			) : waiting ? (
				<div className="flex h-[168px] w-[168px] flex-col items-center justify-center text-center text-[12px] text-ink-faint">
					<span>{text || "正在生成二维码…"}</span>
				</div>
			) : (
				<div className="flex h-[168px] w-[168px] flex-col text-[12px] text-ink-faint">
					<div className="flex flex-1 items-center justify-center text-center">{text || "二维码已过期"}</div>
					<div className="flex justify-center pb-2">
						<button
							type="button"
							className="rounded-md border border-border px-3 py-1 text-[12px] text-ink-dim transition-colors hover:bg-hover hover:text-ink"
							onClick={onRefresh}
						>
							刷新二维码
						</button>
					</div>
				</div>
			)}
		</div>
	);
}

export function SidebarFooter() {
	const t = useT();
	const setSettingsOpen = useSettingsStore((s) => s.setOpen);

	const [confirmLogout, setConfirmLogout] = useState(false);

	const petOn = useUiPluginsStore(
		(s) => s.plugins.find((p) => p.name === "ds-whale-maid-q")?.enabled ?? false,
	);
	const togglePet = async () => {
		const st = useUiPluginsStore.getState();
		if (!st.config.enabled) await st.setMaster(true).catch(() => undefined);
		await useUiPluginsStore
			.getState()
			.setPluginEnabled("ds-whale-maid-q", !petOn)
			.catch(() => undefined);
	};
	const [profile, setProfile] = useState<PluginProfile | null>(null);
	const [open, setOpen] = useState(false);
	const [qrOpen, setQrOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const qr = usePluginNotifyStore((s) => s.qr);
	const loginEnabled = usePluginNotifyStore((s) => s.loginEnabled);
	const [refreshing, setRefreshing] = useState(false);
	const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (qr?.image) setRefreshing(false);
	}, [qr]);

	useEffect(
		() => () => {
			if (refreshTimer.current) clearTimeout(refreshTimer.current);
		},
		[],
	);

	const requestRefresh = () => {
		usePluginNotifyStore.getState().clearQr();
		setRefreshing(true);
		void getPi()
			.pluginCommand({ cmd: "refresh-login" })
			.catch(() => undefined);
		if (refreshTimer.current) clearTimeout(refreshTimer.current);
		refreshTimer.current = setTimeout(() => setRefreshing(false), 12000);
	};

	useEffect(() => {
		const apply = (p: PluginProfile) => setProfile(p);
		const off = getPi().onPluginProfile(apply);
		const offProgress = getPi().onUpdateDownloadProgress((p) =>
			useUpdateStore.setState({ percent: p.percent }),
		);
		void getPi()
			.pluginProfileGet()
			.then((p) => {
				if (p) apply(p);
			})
			.catch(() => undefined);
		return () => {
			off();
			offProgress();
		};
	}, []);

	useEffect(() => {
		if (!open) return;
		const onDown = (e: PointerEvent) => {
			if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
		};
		window.addEventListener("pointerdown", onDown);
		return () => window.removeEventListener("pointerdown", onDown);
	}, [open]);

	const name = (profile?.name ?? "").trim();
	const displayName = name || t("sidebar.guestName");
	const stars = Number(profile?.stars ?? 0);
	const starsText = Number.isFinite(stars) ? stars.toLocaleString() : "0";

	const toggleOpen = () => {
		setOpen((v) => !v);
		setQrOpen(false);
	};

	const logout = () => {
		setOpen(false);
		setQrOpen(false);
		setProfile(null);
		usePluginNotifyStore.getState().clearQr();
		usePluginNotifyStore.getState().clearAccountState();
		useUpdateStore.getState().reset();
		void getPi()
			.pluginCommand({ cmd: "logout" })
			.catch(() => undefined);
	};

	if (!loginEnabled && !name) {
		return (
			<div className="relative shrink-0 p-2">
				<div className="flex h-10 items-center gap-1 rounded-[7px] px-1">
					<button
						type="button"
						className="flex min-w-0 flex-1 items-center gap-2 rounded-[7px] px-2 py-1 text-left hover:bg-hover"
						onClick={() => setSettingsOpen(true)}
					>
						<GearIcon size={14} />
						<span className="min-w-0 flex-1 truncate text-[13.5px] text-ink-dim">
							{t("sidebar.settings")}
						</span>
					</button>
					<UpdateControl />
				</div>
			</div>
		);
	}

	return (
		<div ref={rootRef} className="relative shrink-0 p-2">
			{open ? (
				<div className="absolute inset-x-2 bottom-full z-30 mb-1 rounded-xl border border-border bg-surface p-1 shadow-pop">
					{!name && qrOpen ? (
						<>
							<LoginQr
								image={qr?.image}
								text={qr?.text}
								scanned={qr?.scanned}
								pending={qr?.pending}
								refreshing={refreshing}
								onRefresh={requestRefresh}
							/>
							<div
								className="my-1 h-px bg-border"
								style={{
									WebkitMaskImage: "linear-gradient(to right, transparent, #000, transparent)",
									maskImage: "linear-gradient(to right, transparent, #000, transparent)",
								}}
							/>
						</>
					) : null}

					{name ? (
						<div className="flex items-center gap-2 px-2 py-1.5">
							<Avatar name={displayName} avatar={profile?.avatar} size={34} />
							<span className="min-w-0 flex-1 truncate text-[13px] text-ink">{displayName}</span>
							<span
								className="flex shrink-0 items-baseline rounded-full border border-[rgba(28,32,42,0.1)] bg-[rgba(43,92,255,0.07)] px-[10px] py-[3px]"
								title="星星余额"
							>
								<span className="text-[13px] font-bold tabular-nums text-[#2563eb]">{starsText}</span>
							</span>
						</div>
					) : (
						<button
							type="button"
							className="flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left hover:bg-hover"
							onClick={() => {
								if (!qrOpen) requestRefresh();
								setQrOpen(!qrOpen);
							}}
						>
							<Avatar name={displayName} avatar={profile?.avatar} size={34} />
							<span className="min-w-0 flex-1 truncate text-[13px] text-ink">{displayName}</span>
						</button>
					)}

					<div
						className="my-1 h-px bg-border"
						style={{
							WebkitMaskImage: "linear-gradient(to right, transparent, #000, transparent)",
							maskImage: "linear-gradient(to right, transparent, #000, transparent)",
						}}
					/>
					<button
						type="button"
						className="flex h-8 w-full items-center gap-[9px] rounded-[7px] px-2 text-[13.5px] text-ink-dim transition-colors hover:bg-hover hover:text-ink"
						onClick={() => {
							setOpen(false);
							setQrOpen(false);
							setSettingsOpen(true);
						}}
					>
						<GearIcon size={14} />
						<span>{t("sidebar.settings")}</span>
					</button>
					<button
						type="button"
						title={petOn ? t("sidebar.petOn") : t("sidebar.petOff")}
						className="flex h-8 w-full items-center gap-[9px] rounded-[7px] px-2 text-[13.5px] text-ink-dim transition-colors hover:bg-hover hover:text-ink"
						onClick={() => {
							setOpen(false);
							setQrOpen(false);
							void togglePet();
						}}
					>
						<PetIcon size={14} />
						<span>{t("sidebar.pet")}</span>
					</button>
					{name ? (
						<button
							type="button"
							className="flex h-8 w-full items-center gap-[9px] rounded-[7px] px-2 text-[13.5px] text-red-500 transition-colors hover:bg-red-600/10 hover:text-red-600"
							onClick={() => {
								setOpen(false);
								setConfirmLogout(true);
							}}
						>
							<LogoutIcon size={14} />
							<span>{t("sidebar.logout")}</span>
						</button>
					) : null}
				</div>
			) : null}

			{confirmLogout ? (
				<ConfirmDialog
					title={t("sidebar.logoutConfirmTitle")}
					description={t("sidebar.logoutConfirmDesc")}
					confirmLabel={t("sidebar.logout")}
					cancelLabel={t("common.cancel")}
					danger
					onConfirm={() => {
						setConfirmLogout(false);
						logout();
					}}
					onCancel={() => setConfirmLogout(false)}
				/>
			) : null}

			<div className="flex h-10 items-center gap-1 rounded-[7px] px-1 transition-colors hover:bg-hover">
				<button
					type="button"
					className="flex min-w-0 flex-1 items-center gap-2 rounded-[7px] px-1 py-1 text-left"
					onClick={toggleOpen}
				>
					<Avatar name={displayName} avatar={profile?.avatar} size={28} />
					<span className="min-w-0 flex-1 truncate text-[13.5px] text-ink-dim">{displayName}</span>
				</button>
				<UpdateControl />
			</div>
		</div>
	);
}
