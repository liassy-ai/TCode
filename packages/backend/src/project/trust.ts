import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import {
	type DefaultProjectTrust,
	hasTrustRequiringProjectResources,
	type ProjectTrustStore,
	type ProjectTrustUpdate,
} from "@earendil-works/pi-coding-agent";
import type { TrustOption, TrustRequest } from "@tcode/shared";

export interface TrustOptionInternal {
	key: TrustOption["key"];
	trusted: boolean;
	updates: ProjectTrustUpdate[];
}

function canonicalize(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

export function buildTrustOptions(cwd: string): TrustOptionInternal[] {
	const trustPath = canonicalize(resolve(cwd));
	return [
		{ key: "trust", trusted: true, updates: [{ path: trustPath, decision: true }] },
		{ key: "deny", trusted: false, updates: [{ path: trustPath, decision: false }] },
	];
}

export interface ResolveTrustOptions {
	cwd: string;
	trustStore: ProjectTrustStore;
	defaultProjectTrust: DefaultProjectTrust;

	askUser?: (cwd: string, options: TrustOptionInternal[]) => Promise<number | undefined>;
}

export async function resolveProjectTrust(options: ResolveTrustOptions): Promise<boolean> {
	const { cwd, trustStore, defaultProjectTrust, askUser } = options;
	if (!hasTrustRequiringProjectResources(cwd)) return true;
	const decision = trustStore.get(cwd);
	if (decision !== null) return decision;
	switch (defaultProjectTrust) {
		case "always":
			return true;
		case "never":
			return false;
	}
	if (!askUser) return false;
	const trustOptions = buildTrustOptions(cwd);
	const selected = await askUser(cwd, trustOptions);
	const option = selected === undefined ? undefined : trustOptions[selected];
	if (!option) return false;
	if (option.updates.length > 0) {
		trustStore.setMany(option.updates);
	}
	return option.trusted;
}

export type TrustResponder = (req: TrustRequest) => void;

let nextId = 0;

export class TrustGate {
	private readonly pending = new Map<
		string,
		{ optionCount: number; resolve: (answer: number | undefined) => void }
	>();

	private readonly inflightByCwd = new Map<string, Promise<number | undefined>>();

	constructor(private readonly onRequest: TrustResponder) {}

	ask(cwd: string, options: TrustOptionInternal[]): Promise<number | undefined> {
		const inflight = this.inflightByCwd.get(cwd);
		if (inflight) return inflight;
		const id = `trust-${nextId++}`;
		const promise = new Promise<number | undefined>((resolve) => {
			this.pending.set(id, { optionCount: options.length, resolve });
			this.onRequest({
				id,
				cwd,
				options: options.map((o) => ({ key: o.key })),
			});
		});
		this.inflightByCwd.set(cwd, promise);
		void promise.then(() => this.inflightByCwd.delete(cwd));
		return promise;
	}

	respond(requestId: string, answer: number): void {
		const entry = this.pending.get(requestId);
		if (!entry) return;
		this.pending.delete(requestId);
		if (!Number.isInteger(answer) || answer < 0 || answer >= entry.optionCount) {
			entry.resolve(undefined);
			return;
		}
		entry.resolve(answer);
	}

	dispose(): void {
		for (const entry of this.pending.values()) entry.resolve(undefined);
		this.pending.clear();
		this.inflightByCwd.clear();
	}
}
