const TAU = Math.PI * 2;

const O = {
	count: 170,
	speed: 1.3,
	trail: 0.22,
	linkDist: 6,
	linkAlpha: 0.2,
	lineW: 0.22,
	sigRate: 0.15,
	sweep: 1.5,
	flash: 1,
	flashWeight: 0.95,
	breathPeriod: 3.6,
	dot: 0.6,
	maskR: 36,
	maskAlpha: 0.72,
} as const;

function ink(dark: boolean, a: number): string {
	return dark ? `rgba(244,244,245,${a})` : `rgba(24,24,27,${a})`;
}

const NH = (i: number, k: number): number => {
	const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
	return x - Math.floor(x);
};

const NH3 = (i: number, j: number, s: number): number => {
	const x = Math.sin(i * 127.1 + j * 269.5 + (s % 2048) * 311.7) * 43758.5453;
	return x - Math.floor(x);
};

interface ParticleConst {
	band: 0 | 1;
	th0: number;
	r0: number;
	h1: number;
	h2: number;
	h3: number;
	h5: number;
	h6: number;
}
let cachedN = 0;
let cachedConsts: ParticleConst[] = [];
function particleConsts(N: number): ParticleConst[] {
	if (cachedN === N && cachedConsts.length > 0) return cachedConsts;
	const counts: [number, number] = [0, 0];
	for (let i = 0; i < N; i++) {
		counts[NH(i, 7) < 0.45 ? 0 : 1]++;
	}
	const seen: [number, number] = [0, 0];
	const arr: ParticleConst[] = [];
	for (let i = 0; i < N; i++) {
		const band: 0 | 1 = NH(i, 7) < 0.45 ? 0 : 1;
		arr.push({
			band,

			th0: ((seen[band]++ + 0.5) / counts[band]) * TAU + (NH(i, 4) - 0.5) * 0.5,
			r0: band === 0 ? 2.5 + 10.5 * Math.sqrt(NH(i, 1)) : 14 + 15.5 * Math.sqrt(NH(i, 1)),
			h1: NH(i, 1),
			h2: NH(i, 2),
			h3: NH(i, 3),
			h5: NH(i, 5),
			h6: NH(i, 6),
		});
	}
	cachedConsts = arr;
	cachedN = N;
	return arr;
}

let maskCache: { dark: boolean; c: number; grad: CanvasGradient } | null = null;
function maskGradient(ctx: CanvasRenderingContext2D, c: number, dark: boolean): CanvasGradient {
	if (maskCache && maskCache.dark === dark && maskCache.c === c) return maskCache.grad;
	const grad = ctx.createRadialGradient(c, c, 0, c, c, O.maskR);

	const m = (a: number) => (dark ? `rgba(23,23,26,${a})` : `rgba(250,250,250,${a})`);
	grad.addColorStop(0, m(O.maskAlpha));
	grad.addColorStop(0.55, m(O.maskAlpha * 0.6));
	grad.addColorStop(0.78, m(0));
	grad.addColorStop(1, m(0));
	maskCache = { dark, c, grad };
	return grad;
}

interface Pt {
	p: ParticleConst;
	x: number;
	y: number;
	b: number;
}

export function drawCenterOrb(ctx: CanvasRenderingContext2D, S: number, t: number, dark: boolean): void {
	const o = O;
	const c = S / 2;

	const posAt = (p: ParticleConst, tt: number): [number, number] => {
		const breath = 1 + 0.035 * Math.sin((TAU * tt) / o.breathPeriod);
		const dir = p.band === 0 ? 1 : -1;
		const w = dir * (0.2 + 0.12 * (p.h2 - 0.5)) * o.speed;
		const th = p.th0 + tt * w + 0.3 * Math.sin(tt * (0.1 + 0.15 * p.h1) + p.h2 * TAU);
		const r = (p.r0 + 2.0 * Math.sin(tt * (0.22 + 0.3 * p.h3) + p.h1 * TAU)) * breath;
		return [r, th];
	};
	const pts: Pt[] = [];
	for (const p of particleConsts(Math.round(o.count))) {
		const [r, th] = posAt(p, t);

		const w0 = (p.band === 1 ? -1 : 1) * o.sweep * 0.9;
		const g = (dd: number) => Math.exp(-(dd * dd) / (2 * 0.42 * 0.42));
		const d1 = Math.atan2(Math.sin(th - w0 * t), Math.cos(th - w0 * t));
		const d2 = Math.atan2(Math.sin(th - w0 * t - Math.PI), Math.cos(th - w0 * t - Math.PI));
		let b = g(d1) + 0.6 * g(d2);
		const Pd = (2.5 + 5 * p.h5) / o.flash;
		b += Math.exp(-((t + p.h6 * Pd) % Pd) * 5) * o.flashWeight;
		const ef = r > 26 ? Math.max(0, 1 - (r - 26) / 4.5) : 1;
		pts.push({ p, x: c + r * Math.cos(th), y: c + r * Math.sin(th), b: Math.min(1.4, b) * ef });
	}

	ctx.fillStyle = maskGradient(ctx, c, dark);
	ctx.beginPath();
	ctx.arc(c, c, o.maskR, 0, TAU);
	ctx.fill();
	ctx.lineCap = "round";

	const slotDur = 1.0 / o.speed;
	for (const [i, pi] of pts.entries()) {
		for (const [j, pj] of pts.entries()) {
			if (j <= i) continue;
			const dx = pi.x - pj.x;
			const dy = pi.y - pj.y;
			const d2 = dx * dx + dy * dy;
			if (d2 > o.linkDist * o.linkDist) continue;
			const d = Math.sqrt(d2);
			const g = 1 - d / o.linkDist;
			const a = g * (o.linkAlpha + 0.5 * Math.min(pi.b, pj.b));
			if (a >= 0.02) {
				ctx.beginPath();
				ctx.moveTo(pi.x, pi.y);
				ctx.lineTo(pj.x, pj.y);
				ctx.strokeStyle = ink(dark, a);
				ctx.lineWidth = o.lineW;
				ctx.stroke();
			}

			const bSrc = Math.max(pi.b, pj.b);
			const slotF = t / slotDur + NH3(i, j, 999);
			const slotN = Math.floor(slotF);
			if (NH3(i, j, slotN) >= o.sigRate * (0.25 + 1.6 * bSrc)) continue;
			const prog = slotF - slotN;
			const fromI = pi.b >= pj.b;
			const x0 = fromI ? pi.x : pj.x;
			const y0 = fromI ? pi.y : pj.y;
			const x1 = fromI ? pj.x : pi.x;
			const y1 = fromI ? pj.y : pi.y;
			const env = Math.sin(Math.PI * prog) * Math.min(1, g * 2.5);
			const tb = Math.max(0, prog - 0.18);
			ctx.beginPath();
			ctx.moveTo(x0 + (x1 - x0) * tb, y0 + (y1 - y0) * tb);
			ctx.lineTo(x0 + (x1 - x0) * prog, y0 + (y1 - y0) * prog);
			ctx.strokeStyle = ink(dark, env * 0.45);
			ctx.lineWidth = o.lineW * 1.6;
			ctx.stroke();
			ctx.beginPath();
			ctx.arc(x0 + (x1 - x0) * prog, y0 + (y1 - y0) * prog, o.dot * 0.85, 0, TAU);
			ctx.fillStyle = ink(dark, env * 0.95);
			ctx.fill();
		}
	}

	for (const pt of pts) {
		const [r0, th0] = posAt(pt.p, t - o.trail);
		ctx.beginPath();
		ctx.moveTo(c + r0 * Math.cos(th0), c + r0 * Math.sin(th0));
		ctx.lineTo(pt.x, pt.y);
		ctx.strokeStyle = ink(dark, 0.35 * Math.min(1, pt.b));
		ctx.lineWidth = 0.45;
		ctx.stroke();
		ctx.beginPath();
		ctx.arc(pt.x, pt.y, o.dot * (0.6 + 1.0 * Math.min(1, pt.b)), 0, TAU);
		ctx.fillStyle = ink(dark, Math.min(1, 0.42 + 0.55 * pt.b));
		ctx.fill();
	}

	const cr = 1.35 * (1 + 0.16 * Math.sin((TAU * t) / 3.4 + 1.2));
	ctx.beginPath();
	ctx.arc(c, c, cr, 0, TAU);
	ctx.fillStyle = ink(dark, 0.9);
	ctx.fill();
}
