import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const NL = String.fromCharCode(10);
const ACCENT = "#18181b";
const INK = "#18181b";

const CRC_TABLE = (() => {
	const t = [];
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();
function crc32(buf) {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length, 0);
	const t = Buffer.from(type, "ascii");
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
	return Buffer.concat([len, t, data, crc]);
}
function encodePng(w, h, rgba) {
	const raw = Buffer.alloc((w * 4 + 1) * h);
	for (let y = 0; y < h; y++) {
		raw[y * (w * 4 + 1)] = 0;
		rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(raw, { level: 9 })),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

function hex(c) {
	return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

function sdRoundRect(x, y, left, top, w, h, r) {
	const cx = left + w / 2;
	const cy = top + h / 2;
	const dx = Math.abs(x - cx) - (w / 2 - r);
	const dy = Math.abs(y - cy) - (h / 2 - r);
	const ox = Math.max(dx, 0);
	const oy = Math.max(dy, 0);
	return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(dx, dy), 0) - r;
}

const BASE = 1024;

const CARD = { left: 72, top: 72, w: 880, h: 880, r: 198 };
const SHADOW_DY = 16;
const SHADOW_BLUR = 26;
const SHADOW_ALPHA = 0.22;

const BAR = { left: 272, top: 296, w: 480, h: 112, r: 56 };
const STEM = { left: 456, top: 372, w: 112, h: 352, r: 56 };

function render(S) {
	const k = S / BASE;
	const out = new Uint8ClampedArray(S * S * 4);
	const accent = hex(ACCENT);

	function blend(x, y, rgb, alpha) {
		if (alpha <= 0) return;
		const i = (y * S + x) * 4;
		const a = Math.min(1, alpha);
		out[i] = out[i] * (1 - a) + rgb[0] * a;
		out[i + 1] = out[i + 1] * (1 - a) + rgb[1] * a;
		out[i + 2] = out[i + 2] * (1 - a) + rgb[2] * a;
		out[i + 3] = out[i + 3] * (1 - a) + 255 * a;
	}

	function paint(sd, rgb, soft) {
		for (let y = 0; y < S; y++) {
			for (let x = 0; x < S; x++) {
				let cov = 0;
				for (let sy = 0; sy < 3; sy++) {
					for (let sx = 0; sx < 3; sx++) {
						const d = sd((x + (sx + 0.5) / 3) / k, (y + (sy + 0.5) / 3) / k);
						cov += soft ? Math.min(1, Math.max(0, 1 - d / soft.blur)) * soft.alpha : d <= 0 ? 1 : 0;
					}
				}
				blend(x, y, rgb, cov / 9);
			}
		}
	}

	paint((x, y) => sdRoundRect(x, y - SHADOW_DY, CARD.left, CARD.top, CARD.w, CARD.h, CARD.r), [24, 24, 27], {
		blur: SHADOW_BLUR,
		alpha: SHADOW_ALPHA,
	});

	paint((x, y) => sdRoundRect(x, y, CARD.left, CARD.top, CARD.w, CARD.h, CARD.r), [255, 255, 255], null);

	paint((x, y) => sdRoundRect(x, y, BAR.left, BAR.top, BAR.w, BAR.h, BAR.r), accent, null);
	paint((x, y) => sdRoundRect(x, y, STEM.left, STEM.top, STEM.w, STEM.h, STEM.r), accent, null);
	return Buffer.from(out.buffer);
}

function icoEntry(size, rgba) {
	const header = Buffer.alloc(40);
	header.writeUInt32LE(40, 0);
	header.writeInt32LE(size, 4);
	header.writeInt32LE(size * 2, 8);
	header.writeUInt16LE(1, 12);
	header.writeUInt16LE(32, 14);
	header.writeUInt32LE(size * size * 4, 20);
	const xor = Buffer.alloc(size * size * 4);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const src = ((size - 1 - y) * size + x) * 4;
			const dst = (y * size + x) * 4;
			xor[dst] = rgba[src + 2];
			xor[dst + 1] = rgba[src + 1];
			xor[dst + 2] = rgba[src];
			xor[dst + 3] = rgba[src + 3];
		}
	}
	const maskRow = Math.ceil(size / 32) * 4;
	const mask = Buffer.alloc(maskRow * size);
	return Buffer.concat([header, xor, mask]);
}

mkdirSync("packages/desktop/build", { recursive: true });
mkdirSync("packages/desktop/src/renderer/src/assets", { recursive: true });

const big = render(1024);
writeFileSync("packages/desktop/build/icon.png", encodePng(1024, 1024, big));
writeFileSync("packages/desktop/src/renderer/src/assets/app-icon.png", encodePng(512, 512, render(512)));

const sizes = [16, 32, 48, 64, 128, 256];
const entries = sizes.map((s) => icoEntry(s, render(s)));
const dir = Buffer.alloc(6);
dir.writeUInt16LE(0, 0);
dir.writeUInt16LE(1, 2);
dir.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const dirEntries = sizes.map((s, i) => {
	const e = Buffer.alloc(16);
	e[0] = s === 256 ? 0 : s;
	e[1] = s === 256 ? 0 : s;
	e.writeUInt16LE(1, 4);
	e.writeUInt16LE(32, 6);
	e.writeUInt32LE(entries[i].length, 8);
	e.writeUInt32LE(offset, 12);
	offset += entries[i].length;
	return e;
});
writeFileSync("packages/desktop/build/icon.ico", Buffer.concat([dir, ...dirEntries, ...entries]));

const svg = [
	'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">',
	"  <title>TCode</title>",
	"  <defs>",
	'    <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">',
	'      <feDropShadow dx="0" dy="' +
		SHADOW_DY +
		'" stdDeviation="' +
		SHADOW_BLUR +
		'" flood-color="#18181b" flood-opacity="' +
		SHADOW_ALPHA +
		'"/>',
	"    </filter>",
	"  </defs>",
	'  <rect x="' +
		CARD.left +
		'" y="' +
		CARD.top +
		'" width="' +
		CARD.w +
		'" height="' +
		CARD.h +
		'" rx="' +
		CARD.r +
		'" fill="#ffffff" filter="url(#shadow)"/>',
	'  <rect x="' +
		BAR.left +
		'" y="' +
		BAR.top +
		'" width="' +
		BAR.w +
		'" height="' +
		BAR.h +
		'" rx="' +
		BAR.r +
		'" fill="' +
		ACCENT +
		'"/>',
	'  <rect x="' +
		STEM.left +
		'" y="' +
		STEM.top +
		'" width="' +
		STEM.w +
		'" height="' +
		STEM.h +
		'" rx="' +
		STEM.r +
		'" fill="' +
		ACCENT +
		'"/>',
	"</svg>",
	"",
].join(NL);
writeFileSync("packages/desktop/build/icon.svg", svg);
process.stdout.write("已生成 icon.png(1024) / app-icon.png(512) / icon.ico(6 档) / icon.svg" + NL);
