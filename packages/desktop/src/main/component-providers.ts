import { createLogger } from "@tcode/backend";

const log = createLogger("component-providers");

export class ComponentProviders {
	private lastKey = "";
	private onChange: ((raw: unknown) => void) | null = null;

	setHandler(fn: (raw: unknown) => void): void {
		this.onChange = fn;
	}

	deliver(raw: unknown): void {
		let key: string;
		try {
			key = JSON.stringify(raw ?? null);
		} catch {
			log.warn("供应商配置无法序列化，忽略");
			return;
		}
		if (key === this.lastKey) return;
		this.lastKey = key;
		this.onChange?.(raw);
	}

	stop(): void {
		this.lastKey = "";
	}
}
