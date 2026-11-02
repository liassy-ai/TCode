import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { LoginAuthEvent, LoginAuthPrompt, LoginEventPayload, LoginResult } from "@tcode/shared";

type InteractionPrompt = LoginAuthPrompt & { signal?: AbortSignal };

interface PendingPrompt {
	resolve: (value: string) => void;
	reject: (error: Error) => void;
}

interface ActiveLogin {
	loginId: string;
	providerId: string;
	abort: AbortController;

	prompts: Map<string, PendingPrompt>;
	promptSeq: number;
}

export interface LoginServiceDeps {
	getRuntime: () => Promise<ModelRuntime>;

	send: (payload: LoginEventPayload) => void;
}

const VERTEX_UNSUPPORTED_AUTH_OPTIONS: Record<string, string[]> = {
	"google-vertex": ["api-key"],
};

export function filterAuthSelectOptions<TOption extends { id: string; label: string; description?: string }>(
	providerId: string,
	options: readonly TOption[],
): readonly TOption[] {
	const blocked = VERTEX_UNSUPPORTED_AUTH_OPTIONS[providerId];
	if (!blocked) return options;
	return options.filter((option) => !blocked.includes(option.id));
}

export class LoginService {
	private active: ActiveLogin | undefined;

	constructor(private readonly deps: LoginServiceDeps) {}

	async startLogin(loginId: string, providerId: string): Promise<LoginResult> {
		if (!loginId) throw new Error("loginId 不能为空");

		if (this.active) {
			this.cancel(this.active.loginId);
		}

		const login: ActiveLogin = {
			loginId,
			providerId,
			abort: new AbortController(),
			prompts: new Map(),
			promptSeq: 0,
		};
		this.active = login;

		try {
			const runtime = await this.deps.getRuntime();
			const provider = runtime.getProvider(providerId);
			if (!provider) throw new Error(`未知 provider：${providerId}`);

			const method = provider.auth.oauth
				? ("oauth" as const)
				: provider.auth.apiKey?.login
					? ("api_key" as const)
					: undefined;
			if (!method) throw new Error(`${provider.name || providerId} 不支持登录`);

			await runtime.login(providerId, method, {
				signal: login.abort.signal,
				notify: (event) => this.notify(login, event),
				prompt: (prompt) => this.prompt(login, prompt),
			});
			return { ok: true };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const cancelled = login.abort.signal.aborted || message === "Login cancelled";
			return { ok: false, cancelled, error: message };
		} finally {
			this.settle(login);
		}
	}

	respond(loginId: string, promptId: string, value: string): void {
		const login = this.active;
		if (!login || login.loginId !== loginId) return;
		const pending = login.prompts.get(promptId);
		if (!pending) return;
		login.prompts.delete(promptId);
		pending.resolve(value);
	}

	cancel(loginId: string): void {
		if (this.active?.loginId === loginId) this.active.abort.abort();
	}

	private notify(login: ActiveLogin, event: LoginAuthEvent): void {
		this.deps.send({ loginId: login.loginId, kind: "event", event });
	}

	private prompt(login: ActiveLogin, prompt: InteractionPrompt): Promise<string> {
		const promptId = `${login.loginId}:${++login.promptSeq}`;

		const wire: LoginAuthPrompt =
			prompt.type === "select"
				? {
						type: "select",
						message: prompt.message,
						options: filterAuthSelectOptions(login.providerId, prompt.options),
					}
				: { type: prompt.type, message: prompt.message, placeholder: prompt.placeholder };
		return new Promise<string>((resolve, reject) => {
			login.prompts.set(promptId, { resolve, reject });
			this.deps.send({ loginId: login.loginId, kind: "prompt", promptId, prompt: wire });
			const onAbort = () => {
				if (!login.prompts.delete(promptId)) return;
				this.deps.send({ loginId: login.loginId, kind: "prompt-cancel", promptId });
				reject(new Error("Login cancelled"));
			};

			if (prompt.signal) {
				if (prompt.signal.aborted) onAbort();
				else prompt.signal.addEventListener("abort", onAbort, { once: true });
			}

			if (login.abort.signal.aborted) onAbort();
			else login.abort.signal.addEventListener("abort", onAbort, { once: true });
		});
	}

	private settle(login: ActiveLogin): void {
		if (this.active === login) this.active = undefined;
		login.abort.abort();
		for (const [promptId, pending] of login.prompts) {
			this.deps.send({ loginId: login.loginId, kind: "prompt-cancel", promptId });
			pending.reject(new Error("Login cancelled"));
		}
		login.prompts.clear();
	}
}
