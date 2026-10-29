import type { LoginAuthPrompt } from "@tcode/shared";
import { useEffect, useRef, useState } from "react";
import { getPi } from "../../../api";
import { useT } from "../../../i18n";
import { useProviderLoginStore } from "../../../stores/provider-login";
import { Button } from "../../ui/Button";

export function LoginDialog() {
	const t = useT();
	const login = useProviderLoginStore((s) => s.login);
	const respond = useProviderLoginStore((s) => s.respondLoginPrompt);
	const cancel = useProviderLoginStore((s) => s.cancelProviderLogin);
	const dismiss = useProviderLoginStore((s) => s.dismissLogin);

	useEffect(
		() => () => {
			const s = useProviderLoginStore.getState();
			if (s.login && !s.login.error) s.cancelProviderLogin();
			useProviderLoginStore.setState({ login: null });
		},
		[],
	);

	if (!login) return null;
	const { pendingPrompt, deviceCode, authUrl, infoLinks } = login;
	const prompt = pendingPrompt?.prompt;

	return (
		<div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/20" role="dialog" aria-modal>
			<div className="w-[440px] rounded-xl border border-border bg-surface p-4 shadow-dialog">
				<h3 className="text-sm font-semibold text-ink">
					{t(login.loginKind === "apiKey" ? "settings.login.apiKeyTitle" : "settings.login.title", {
						name: login.providerName,
					})}
				</h3>

				{deviceCode && (
					<div className="mt-3 rounded-lg bg-hover px-3 py-2.5">
						<p className="text-[11px] text-ink-faint">{t("settings.login.deviceCodeHint")}</p>
						<p className="mt-1 select-all text-center font-mono text-lg font-semibold tracking-widest text-ink">
							{deviceCode.userCode}
						</p>
						<button
							type="button"
							className="mt-1 block w-full truncate text-center text-[11px] text-ink-dim underline underline-offset-2 hover:text-ink"
							onClick={() => void getPi().openExternal({ url: deviceCode.verificationUri })}
						>
							{deviceCode.verificationUri}
						</button>
						{deviceCode.expiresInSeconds ? (
							<p className="mt-1 text-center text-[10px] text-ink-faint">
								{t("settings.login.deviceCodeExpires", {
									minutes: Math.ceil(deviceCode.expiresInSeconds / 60),
								})}
							</p>
						) : null}
					</div>
				)}

				{authUrl && (
					<div className="mt-3 rounded-lg bg-hover px-3 py-2.5">
						<p className="text-[11px] text-ink-2">{t("settings.login.browserHint")}</p>
						<button
							type="button"
							className="mt-1 block w-full truncate text-left font-mono text-[11px] text-ink-dim underline underline-offset-2 hover:text-ink"
							title={authUrl.url}
							onClick={() => void getPi().openExternal({ url: authUrl.url })}
						>
							{authUrl.url}
						</button>
						{authUrl.instructions && (
							<p className="mt-1 text-[10px] text-ink-faint">{authUrl.instructions}</p>
						)}
					</div>
				)}

				{prompt?.type === "select" && (
					<div className="mt-3">
						<p className="text-[12px] text-ink-2">{prompt.message}</p>
						<div className="mt-2 flex flex-col items-stretch gap-1.5">
							{prompt.options.map((option) => (
								<Button
									key={option.id}
									variant="primary"
									className="justify-start text-left"
									onClick={() => respond(option.id)}
								>
									{option.label}
									{option.description && (
										<span className="ml-1 text-[11px] opacity-70">{option.description}</span>
									)}
								</Button>
							))}
						</div>
					</div>
				)}

				{prompt && prompt.type !== "select" && pendingPrompt && (
					<PromptInput key={pendingPrompt.promptId} prompt={prompt} onSubmit={respond} />
				)}

				{infoLinks && infoLinks.length > 0 && (
					<div className="mt-2 flex flex-wrap gap-2">
						{infoLinks.map((link) => (
							<button
								key={link.url}
								type="button"
								className="text-[11px] text-ink-dim underline underline-offset-2 hover:text-ink"
								onClick={() => void getPi().openExternal({ url: link.url })}
							>
								{link.label ?? link.url}
							</button>
						))}
					</div>
				)}

				{!login.error && (
					<div className="mt-3 flex items-center gap-2 text-[11px] text-ink-faint">
						<span className="h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
						<span className="truncate">
							{login.statusLine ??
								t(
									login.loginKind === "apiKey"
										? "settings.login.waitingInteractive"
										: "settings.login.waiting",
								)}
						</span>
					</div>
				)}

				{login.error && (
					<p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[12px] break-all text-red-600">
						{t("settings.login.failed")}：{login.error}
					</p>
				)}

				<div className="mt-4 flex justify-end">
					{login.error ? (
						<Button variant="primary" onClick={dismiss}>
							{t("common.close")}
						</Button>
					) : (
						<Button onClick={cancel}>{t("common.cancel")}</Button>
					)}
				</div>
			</div>
		</div>
	);
}

function PromptInput({
	prompt,
	onSubmit,
}: {
	prompt: Exclude<LoginAuthPrompt, { type: "select" }>;
	onSubmit: (value: string) => void;
}) {
	const t = useT();
	const [input, setInput] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const allowEmpty = prompt.type !== "secret";
	const submit = () => {
		if (!allowEmpty && !input.trim()) return;
		onSubmit(input.trim());
	};

	return (
		<div className="mt-3">
			<p className="text-[12px] text-ink-2">{prompt.message}</p>
			<div className="mt-2 flex items-center gap-2">
				<input
					ref={inputRef}
					type={prompt.type === "secret" ? "password" : "text"}
					className="min-w-0 flex-1 rounded-lg border border-border px-2.5 py-1.5 text-[12px] outline-none focus:border-ink-faint"
					placeholder={prompt.placeholder}
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && submit()}
				/>
				<Button variant="primary" onClick={submit} disabled={!allowEmpty && !input.trim()}>
					{t("settings.login.submit")}
				</Button>
			</div>
		</div>
	);
}
