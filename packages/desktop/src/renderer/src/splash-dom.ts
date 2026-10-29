const DOT_COUNT = 64;
const GOLDEN_ANGLE_RAD = 137.508 * (Math.PI / 180);
const SPREAD = 13.2;

function buildDots(): string {
	let html = "";
	for (let i = 1; i <= DOT_COUNT; i++) {
		const r = SPREAD * Math.sqrt(i);
		const theta = i * GOLDEN_ANGLE_RAD;
		const x = Math.round(r * Math.cos(theta));
		const y = Math.round(r * Math.sin(theta));

		const size = Math.max(3, 13.5 - r * 0.1 + ((i * 7) % 3) - 1);
		const opacity = Math.min(1, Math.max(0.35, 1.02 - r * 0.0065));
		const duration = 3.1 + ((i * 13) % 37) / 10;
		const delay = -((i * 29) % 67) / 10;

		const ex = Math.round(x * 3 + Math.cos(theta) * 1100);
		const ey = Math.round(y * 3 + Math.sin(theta) * 1100);
		html += `<i class="sp-dot" style="--x:${x}px;--y:${y}px;--ex:${ex}px;--ey:${ey}px;--s:${size.toFixed(1)}px;--o:${opacity.toFixed(2)};--t:${duration.toFixed(1)}s;--dl:${delay.toFixed(1)}s"></i>`;
	}
	return html;
}

const splash = document.createElement("div");
splash.id = "splash";
splash.setAttribute("aria-hidden", "true");
splash.innerHTML = `
	<div class="sp-swarm">
		<div class="sp-swarm-in">
			<div class="sp-swarm-breathe">${buildDots()}</div>
		</div>
	</div>
	<div class="sp-rings"></div>
	<div class="sp-wave"></div>
	<div class="sp-word">TCode</div>
	<div class="sp-line"></div>`;
document.body.append(splash);
