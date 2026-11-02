export type WebAccessScope = "local" | "lan" | "internet";

export interface WebAccessStatus {
	enabled: boolean;

	listening: boolean;

	port: number;

	scope: WebAccessScope;

	url: string | null;

	token: string;
}
