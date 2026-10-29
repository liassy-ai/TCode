import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import { copyText } from "../../lib/clipboard";
import { usePluginNotifyStore } from "../../stores/plugin-notify";
import { useSettingsStore } from "../../stores/settings";
import { CheckIcon, ChevronDownIcon } from "../icons";
import { Switch } from "../ui/Switch";

export function WebAccessPanel() {
	const t = useT();
	const status = useSettingsStore((s) => s.webAccessStatus);
	const saving = useSettingsStore((s) => s.webAccessSaving);
	const refresh = useSettingsStore((s) => s.refreshWebAccessStatus);
	const setEnabled = useSettingsStore((s) => s.setWebAccessEnabled);
	const setScope = useSettingsStore((s) => s.setWebAccessScope);
	const regenerateToken = useSettingsStore((s) => s.regenerateWebAccessToken);
	const [portInput, setPortInput] = useState("");
	const [copied, setCopied] = useState(false);
	const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
	const [scopeOpen, setScopeOpen] = useState(false);
	const scopeRef = useRef<HTMLDivElement>(null);
	const tunnel = usePluginNotifyStore((s) => s.tunnel);
	const loginEnabled = usePluginNotifyStore((s) => s.loginEnabled);

	useEffect(() => {
		if (!scopeOpen) return;
		const onPointerDown = (e: PointerEvent) => {
			if (scopeRef.current && !scopeRef.current.contains(e.target as Node)) setScopeOpen(false);
		};
		window.addEventListener("pointerdown", onPointerDown);
		return () => window.removeEventListener("pointerdown", onPointerDown);
	}, [scopeOpen]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	useEffect(() => {
		if (!status) return;
		if (loginEnabled && status.enabled && status.listening && status.scope === "internet" && status.port) {
			void getPi().pluginCommand({ cmd: `tunnel-on:${status.port}` });
		} else {
			void getPi().pluginCommand({ cmd: "tunnel-off" });
		}
	}, [loginEnabled, status?.enabled, status?.listening, status?.scope, status?.port]);
	useEffect(() => {
		if (status?.port != null) setPortInput(String(status.port));
	}, [status?.port]);

	useEffect(() => getPi().onWebAccessChanged((s) => useSettingsStore.setState({ webAccessStatus: s })), []);

	const parsedPort = Number(portInput);
	const portValid = Number.isInteger(parsedPort) && parsedPort >= 1024 && parsedPort <= 65535;

	const effectiveScope = status?.scope === "internet" && !loginEnabled ? "local" : (status?.scope ?? "local");
	const internetBlocked = status?.scope === "internet" && !loginEnabled;
	const downgradeTriedRef = useRef(false);
	useEffect(() => {
		if (!internetBlocked) {
			downgradeTriedRef.current = false;
			return;
		}
		if (downgradeTriedRef.current) return;
		downgradeTriedRef.current = true;
		void setScope("local");
	}, [internetBlocked, setScope]);
	const scopeChoices = loginEnabled ? (["local", "lan", "internet"] as const) : (["local", "lan"] as const);

	const tunnelBase =
		effectiveScope === "internet" && tunnel?.state === "ready" && tunnel.url
			? `${tunnel.url.replace(/\/+$/, "")}/`
			: null;
	const accessBase = effectiveScope === "internet" ? tunnelBase : status?.url;
	const pairUrl = accessBase ? `${accessBase.replace(/\/+$/, "")}/?token=${status?.token ?? ""}` : null;

	useEffect(() => {
		if (!pairUrl) {
			setQrDataUrl(null);
			return;
		}
		let cancelled = false;
		void QRCode.toDataURL(pairUrl, { width: 240, margin: 1, color: { dark: "#17171a", light: "#ffffff" } })
			.then((dataUrl) => {
				if (!cancelled) setQrDataUrl(dataUrl);
			})
			.catch(() => {
				if (!cancelled) setQrDataUrl(null);
			});
		return () => {
			cancelled = true;
		};
	}, [pairUrl]);

	const copyLink = async () => {
		if (!pairUrl) return;
		if (await copyText(pairUrl)) {
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		}
	};

	const regenerate = () => {
		if (!window.confirm(t("settings.web.regenerateConfirm"))) return;
		void regenerateToken();
	};

	const applyPort = () => {
		if (!portValid) return;
		if (Number(parsedPort) === status?.port) return;

		const webServed = !window.pi && !import.meta.env.DEV;

		void setEnabled(status?.enabled === true, parsedPort).then(() => {
			if (!webServed || status?.enabled !== true) return;
			setTimeout(() => {
				const url = new URL(window.location.href);
				url.port = String(parsedPort);
				window.location.replace(url.toString());
			}, 300);
		});
	};

	return (
		<div className="flex flex-col gap-5">
			<div>
				<div className="flex items-center justify-between gap-4">
					<h3 className="text-[13px] font-medium text-ink">{t("settings.web.title")}</h3>
					<Switch
						checked={status?.enabled === true}
						disabled={
							saving || status === null || (status?.enabled !== true && !portValid && portInput !== "")
						}
						onCheckedChange={(enabled) => {
							if (enabled) {
								if (!portValid) return;
								void setEnabled(true, parsedPort);
							} else {
								void setEnabled(false);
							}
						}}
					/>
				</div>
				<p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">{t("settings.web.hint")}</p>
			</div>

			{status?.enabled &&
				(status.listening ? (
					<div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
						<div className="flex items-center justify-between text-[11px] text-ink-dim">
							<span>{t("settings.web.listening")}</span>
							<span>{t("settings.web.port", { port: status.port })}</span>
						</div>
						{pairUrl ? (
							<>
								<div className="flex gap-2">
									<input
										className="min-w-0 flex-1 rounded-md border border-border bg-canvas px-2 py-1 text-[11px] text-ink"
										readOnly
										value={pairUrl}
									/>
									<button
										type="button"
										className="rounded-md border border-border px-2 text-[11px] text-ink-2 hover:bg-hover"
										onClick={() => void copyLink()}
									>
										{copied ? t("settings.web.copied") : t("settings.web.copy")}
									</button>
									<button
										type="button"
										className="rounded-md border border-border px-2 text-[11px] text-ink-2 hover:bg-hover"
										onClick={() => void window.open(pairUrl, "_blank")}
									>
										{t("settings.web.open")}
									</button>
								</div>
								<div className="flex flex-col items-center gap-2 rounded-md border border-border bg-canvas p-3">
									{qrDataUrl && (
										<img src={qrDataUrl} alt={t("settings.web.qr")} className="h-[180px] w-[180px]" />
									)}
								</div>
								<div className="flex justify-end">
									<button
										type="button"
										className="text-[11px] text-ink-faint transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
										disabled={saving}
										onClick={regenerate}
									>
										{t("settings.web.regenerate")}
									</button>
								</div>
							</>
						) : (
							<p className="text-[11px] text-ink-faint">
								{effectiveScope === "internet" ? tunnel?.text : t("settings.web.noAddress")}
							</p>
						)}
					</div>
				) : (
					<div className="rounded-lg border border-border bg-surface p-3 text-[11px] text-warning">
						{t("settings.web.portBusy")}
					</div>
				))}

			<div>
				<div className="flex items-center gap-2">
					<span className="text-[11px] text-ink-dim">{t("settings.web.scopeLabel")}</span>

					<div className="relative" ref={scopeRef}>
						<button
							type="button"
							className="flex h-7 items-center gap-1 rounded-md border border-border bg-canvas pr-1.5 pl-2 text-[12px] text-ink outline-none transition-colors hover:border-border-strong focus:border-border-strong"
							disabled={saving}
							onClick={() => setScopeOpen((v) => !v)}
						>
							{t(
								effectiveScope === "lan"
									? "settings.web.scopeLan"
									: effectiveScope === "internet"
										? "settings.web.scopeInternet"
										: "settings.web.scopeLocal",
							)}
							<ChevronDownIcon
								size={12}
								className={`text-ink-faint transition-transform ${scopeOpen ? "rotate-180" : ""}`}
							/>
						</button>
						{scopeOpen && (
							<div className="absolute top-full left-0 z-30 mt-1 w-32 rounded-lg border border-border bg-surface p-1 shadow-pop">
								{scopeChoices.map((scope) => {
									const active = effectiveScope === scope;
									return (
										<button
											key={scope}
											type="button"
											className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-hover ${
												active ? "font-medium text-ink" : "text-ink-2"
											}`}
											onClick={() => {
												setScopeOpen(false);
												if (!active) void setScope(scope);
											}}
										>
											{t(
												scope === "local"
													? "settings.web.scopeLocal"
													: scope === "lan"
														? "settings.web.scopeLan"
														: "settings.web.scopeInternet",
											)}
											{active && <CheckIcon size={12} />}
										</button>
									);
								})}
							</div>
						)}
					</div>
					<label className="text-[11px] text-ink-dim" htmlFor="web-access-port">
						{t("settings.web.portLabel")}
					</label>
					<input
						id="web-access-port"
						inputMode="numeric"
						value={portInput}
						onChange={(event) => setPortInput(event.target.value.replace(/\D/g, ""))}
						onBlur={applyPort}
						disabled={saving}
						className="h-7 w-24 rounded-md border border-border bg-canvas px-2 text-[12px] text-ink outline-none focus:border-border-strong"
					/>
					<span className="text-[11px] text-ink-faint">{t("settings.web.portRange")}</span>
				</div>
				<p className="mt-0.5 text-[11px] text-ink-faint">{t("settings.web.portHint")}</p>
				{effectiveScope === "internet" && tunnel?.hint && (
					<p className="mt-1 text-[11px] leading-relaxed text-ink-faint">{tunnel.hint}</p>
				)}
				{effectiveScope === "internet" && tunnel?.billing && (
					<p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">{tunnel.billing}</p>
				)}
			</div>

			<div className="rounded-lg border border-border bg-surface p-3 text-[11px] leading-relaxed text-ink-dim">
				<p className="font-medium text-ink-2">{t("settings.web.securityTitle")}</p>
				<ul className="mt-1 list-disc space-y-1 pl-4">
					<li>{t("settings.web.securityScope")}</li>
					<li>{t("settings.web.securityInternet")}</li>
					<li>{t("settings.web.securityToken")}</li>
					<li>{t("settings.web.securityRotate")}</li>
					<li>{t("settings.web.securityOrigin")}</li>
				</ul>
			</div>
		</div>
	);
}
