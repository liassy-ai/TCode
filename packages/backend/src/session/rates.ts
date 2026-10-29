const WINDOW_SECONDS = 60;

const STALE_MS = 60_000;

export interface SessionRateSnapshot {
	window60s: number[];

	lastEventAt: number;
}

interface RateState {
	counts: number[];
	secStart: number;
	lastEventAt: number;
}

export class EventRateTracker {
	private readonly states = new Map<string, RateState>();

	tick(sessionId: string, now: number = Date.now()): void {
		const sec = Math.floor(now / 1000) * 1000;
		let st = this.states.get(sessionId);
		if (!st) {
			st = { counts: [], secStart: sec, lastEventAt: now };
			this.states.set(sessionId, st);
		} else if (sec > st.secStart) {
			const gapSec = (sec - st.secStart) / 1000;
			if (gapSec >= WINDOW_SECONDS) st.counts.length = 0;
			else for (let i = 0; i < gapSec; i++) st.counts.push(0);
			while (st.counts.length > WINDOW_SECONDS) st.counts.shift();
			st.secStart = sec;
		}
		st.lastEventAt = now;
		const last = st.counts.length - 1;
		if (last >= 0) st.counts[last] = (st.counts[last] ?? 0) + 1;
		else st.counts.push(1);
	}

	snapshot(): Map<string, SessionRateSnapshot> {
		const out = new Map<string, SessionRateSnapshot>();
		for (const [id, st] of this.states) {
			out.set(id, { window60s: [...st.counts], lastEventAt: st.lastEventAt });
		}
		return out;
	}

	delete(sessionId: string): void {
		this.states.delete(sessionId);
	}

	prune(keep: (sessionId: string) => boolean, now: number = Date.now()): void {
		for (const [id, st] of this.states) {
			if (!keep(id) && now - st.lastEventAt > STALE_MS) this.states.delete(id);
		}
	}
}
