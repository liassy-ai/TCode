import type { HTMLAttributes, Ref } from "react";

export interface WebviewElement extends HTMLElement {
	executeJavaScript(code: string): Promise<unknown>;
	loadURL(url: string): Promise<void>;
	reload(): void;
	stop(): void;
	canGoBack(): boolean;
	goBack(): void;
	canGoForward(): boolean;
	goForward(): void;
	getURL(): string;
	getTitle(): string;
	getFavicon(): string[] | string | null;
	isLoading(): boolean;

	setZoomFactor(factor: number): void;
	getZoomFactor(): number;

	getWebContentsId(): number;
}

declare module "react" {
	namespace JSX {
		interface IntrinsicElements {
			webview: HTMLAttributes<HTMLElement> & {
				src?: string;
				partition?: string;
				allowpopups?: string;
				webpreferences?: string;
				ref?: Ref<HTMLElement>;
			};
		}
	}
}
