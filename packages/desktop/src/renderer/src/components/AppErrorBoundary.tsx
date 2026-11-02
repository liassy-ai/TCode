import { Component, type ErrorInfo, type ReactNode } from "react";
import { type MessageKey, useT } from "../i18n";

type TFunc = (key: MessageKey, params?: Record<string, string | number>) => string;

interface State {
	error: Error | null;
}

class ErrorFallback extends Component<{ error: Error; t: TFunc }> {
	render() {
		const { error, t } = this.props;
		return (
			<div className="flex h-full flex-col items-center justify-center gap-3 bg-canvas px-6 text-center">
				<div className="text-[13px] font-medium text-ink">{t("appError.title")}</div>
				<p className="max-w-md text-[12px] leading-relaxed text-ink-faint">
					{t("appError.desc", { detail: String(error.message ?? error) })}
				</p>
				<button
					type="button"
					onClick={() => window.location.reload()}
					className="rounded-lg bg-ink px-4 py-1.5 text-[12px] font-medium text-surface transition-opacity hover:opacity-80"
				>
					{t("appError.reload")}
				</button>
			</div>
		);
	}
}

class BoundaryInner extends Component<{ children: ReactNode; t: TFunc }, State> {
	state: State = { error: null };

	static getDerivedStateFromError(error: Error): State {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error("[app-error-boundary]", error, info.componentStack);
	}

	render() {
		if (!this.state.error) return this.props.children;
		return <ErrorFallback error={this.state.error} t={this.props.t} />;
	}
}

export function AppErrorBoundary({ children }: { children: ReactNode }) {
	const t = useT();
	return <BoundaryInner t={t}>{children}</BoundaryInner>;
}
