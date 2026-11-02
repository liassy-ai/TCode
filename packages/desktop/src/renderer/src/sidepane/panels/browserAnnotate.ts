export interface AnnotationStyleMatch {
	stylesheet: string | null;
	selector: string;

	rule: string;

	group?: string;

	candidateFiles?: string[];

	verifiedFiles?: string[];

	inactive?: boolean;

	unreadable?: boolean;
}

export interface AnnotationSourceFrame {
	component: string;

	file: string;

	line: number;

	column: number;

	url: string;

	own?: boolean;

	mapped?: boolean;

	candidateFiles?: string[];

	verifiedFiles?: string[];
}

export interface ElementAnnotation {
	tag: string;
	id: string;
	classes: string[];

	selector: string;

	selectorMatches: number;

	domPath: string;

	text: string;

	html: string;

	attrs: Record<string, string>;

	ancestor: { tag: string; id: string; testid: string; classes: string[] } | null;

	source?: AnnotationSourceFrame;

	styles: AnnotationStyleMatch[];

	computed: Record<string, string>;

	rect: { left: number; top: number; width: number; height: number };

	viewport: { width: number; height: number };
}

export interface AnnotationPayload {
	pageUrl: string;
	element: ElementAnnotation;
	note: string;
}

export const WEB_ANNOTATE_SKILL_COMMAND = "/skill:web-annotate";

export function candidateWorkspacePaths(stylesheetHref: string, cwd?: string): string[] {
	if (!stylesheetHref) return [];
	try {
		const url = new URL(stylesheetHref);
		if (url.protocol === "http:" || url.protocol === "https:") {
			const path = decodeURIComponent(url.pathname).replace(/^\/+/, "");
			return path ? [path] : [];
		}
	} catch {}
	if (!cwd) return [];
	let raw = stylesheetHref;
	try {
		raw = decodeURIComponent(stylesheetHref).replace(/^file:\/\//i, "");
	} catch {}
	const normalized = raw.replace(/\\/g, "/").replace(/^\/+/, "");
	const base = cwd.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
	if (!normalized || !base) return [];
	const lower = normalized.toLowerCase();
	const lowerBase = base.toLowerCase();
	if (lower.startsWith(lowerBase + "/")) {
		const rel = normalized.slice(base.length + 1);
		return rel ? [rel] : [];
	}
	const marker = lower.indexOf("/src/");
	if (marker > 0) return [normalized.slice(marker + 1)];
	return [];
}

const SOURCE_ROOT_CANDIDATES = ["packages/desktop/src/renderer", "src/renderer", "apps/renderer"];

export function sourceCandidatePaths(
	source: { file?: string; url?: string } | null | undefined,
	cwd: string,
): string[] {
	if (!source) return [];
	const base = candidateWorkspacePaths(source.url || source.file || "", cwd);
	const out = new Set<string>(base);
	for (const path of base) {
		const trimmed = path.replace(/^\.?\/+/, "");
		if (!trimmed) continue;
		for (const root of SOURCE_ROOT_CANDIDATES) out.add(`${root}/${trimmed}`);
	}
	return [...out];
}

export function annotationSkillCommand(payload: AnnotationPayload): string {
	return `${WEB_ANNOTATE_SKILL_COMMAND} ${JSON.stringify(payload)}`;
}

export function elementLabel(element: Partial<ElementAnnotation> | null | undefined): string {
	if (!element) return "";
	const parts: string[] = [];
	if (element.tag) parts.push(element.tag);
	if (element.id) parts.push(`#${element.id}`);
	const classes = element.classes ?? [];
	if (classes.length) parts.push(`.${classes.slice(0, 3).join(".")}`);
	const testid = element.attrs?.["data-testid"];
	if (testid) parts.push(`[data-testid="${testid}"]`);
	return parts.join("");
}

export function parseAnnotationCommand(
	command: string,
): { pageUrl: string; note: string; elementLabel: string } | null {
	if (!command.startsWith(`${WEB_ANNOTATE_SKILL_COMMAND} `)) return null;
	const res = extractLeadingObject(command, WEB_ANNOTATE_SKILL_COMMAND.length + 1);
	if (!res || typeof res.obj !== "object" || res.obj === null) return null;
	const payload = res.obj as Partial<AnnotationPayload>;
	if (typeof payload.pageUrl !== "string") return null;
	return {
		pageUrl: payload.pageUrl,
		note: typeof payload.note === "string" ? payload.note : "",
		elementLabel: elementLabel(payload.element),
	};
}

function extractLeadingObject(text: string, from: number): { end: number; obj: unknown } | null {
	let depth = 0;
	let inStr = false;
	let esc = false;
	for (let i = from; i < text.length; i++) {
		const ch = text[i];
		if (inStr) {
			if (esc) esc = false;
			else if (ch === "\\") esc = true;
			else if (ch === '"') inStr = false;
			continue;
		}
		if (ch === '"') inStr = true;
		else if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) {
				try {
					return { end: i + 1, obj: JSON.parse(text.slice(from, i + 1)) };
				} catch {
					return null;
				}
			}
		}
	}
	return null;
}

export type AnnotationMessageSegment =
	| {
			kind: "card";
			pageUrl: string;
			note: string;

			elementLabel: string;
			command: string;
	  }
	| { kind: "text"; text: string };

export function splitAnnotationMessage(text: string): AnnotationMessageSegment[] {
	const out: AnnotationMessageSegment[] = [];
	let pos = 0;
	let textBuf = "";
	const flush = (trimEnd = false) => {
		const value = trimEnd ? textBuf.replace(/\s+$/, "") : textBuf;
		if (value) out.push({ kind: "text", text: value });
		textBuf = "";
	};
	while (pos < text.length) {
		const hasPrefix = text.startsWith(`${WEB_ANNOTATE_SKILL_COMMAND} `, pos);
		const objStart = hasPrefix ? pos + WEB_ANNOTATE_SKILL_COMMAND.length + 1 : text[pos] === "{" ? pos : -1;
		if (objStart >= 0 && text[objStart] === "{") {
			const res = extractLeadingObject(text, objStart);
			if (
				res &&
				typeof res.obj === "object" &&
				res.obj !== null &&
				typeof (res.obj as { pageUrl?: unknown }).pageUrl === "string"
			) {
				const payload = res.obj as { pageUrl: string; note?: unknown; element?: Partial<ElementAnnotation> };
				flush(true);
				out.push({
					kind: "card",
					pageUrl: payload.pageUrl,
					note: typeof payload.note === "string" ? payload.note : "",
					elementLabel: elementLabel(payload.element),
					command: `${WEB_ANNOTATE_SKILL_COMMAND} ${text.slice(objStart, res.end)}`,
				});
				pos = res.end;

				let next = pos;
				while (next < text.length && /\s/.test(text.charAt(next))) next++;

				pos = next;
				continue;
			}
		}

		const nl = text.indexOf("\n", pos);
		if (nl === -1) {
			textBuf += text.slice(pos);
			pos = text.length;
		} else {
			textBuf += text.slice(pos, nl + 1);
			pos = nl + 1;
		}
	}
	flush();
	return out;
}

export const ABORT_PICKER_SCRIPT =
	'if (typeof window.__tcodePickerAbort === "function") window.__tcodePickerAbort();';

export const PICKER_NEXT_SCRIPT =
	'typeof window.__tcodePickerNext === "function" ? window.__tcodePickerNext() : null';

export function pickerPauseScript(paused: boolean): string {
	return `if (typeof window.__tcodePickerPause === "function") window.__tcodePickerPause(${paused});`;
}

export function buildPickerScript(): string {
	return `(() => {
  const token = Math.random().toString(36).slice(2);
  document.querySelectorAll("[data-tcode-picker]").forEach((n) => n.remove());
  if (typeof window.__tcodePickerAbort === "function") window.__tcodePickerAbort();
  if (window.__tcodePickerActive) return false;
  window.__tcodePickerActive = token;
  window.__tcodePickerPending = null;
  window.__tcodePickerPaused = false;
  window.__tcodePickerNext = () => new Promise((resolve) => { window.__tcodePickerPending = resolve; });
  window.__tcodePickerPause = (paused) => {
    window.__tcodePickerPaused = !!paused;
    if (window.__tcodePickerPaused) {
      const box = document.querySelector("[data-tcode-picker-overlay]");
      if (box) box.style.display = "none";
    }
  };
  const deliver = (payload) => {
    const resolve = window.__tcodePickerPending;
    window.__tcodePickerPending = null;
    if (typeof resolve === "function") resolve(payload);
  };
  {
    const SVG_NS = "http://www.w3.org/2000/svg";
    const overlay = document.createElementNS(SVG_NS, "svg");
    overlay.setAttribute("data-tcode-picker", "overlay");
    Object.assign(overlay.style, {
      position: "fixed", left: "0", top: "0", width: "0", height: "0",
      pointerEvents: "none", zIndex: "2147483647", overflow: "visible",
    });
    const label = document.createElement("div");
    label.setAttribute("data-tcode-picker", "label");
    Object.assign(label.style, {
      position: "fixed", left: "0", top: "0", pointerEvents: "none", zIndex: "2147483647",
      font: '11.5px/1.5 ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
      color: "#fafafa", background: "rgba(24,24,27,0.92)",
      padding: "3px 9px", borderRadius: "999px",
      border: "1px solid rgba(255,255,255,0.14)",
      boxShadow: "0 4px 14px rgba(0,0,0,0.3)",
      maxWidth: "60vw", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
    });
    let current = null;
    const esc = (name) => {
      try { if (window.CSS && window.CSS.escape) return window.CSS.escape(name); } catch (e) {}
      return String(name).replace(/[^a-zA-Z0-9_-]/g, (ch) => "\\\\" + ch);
    };
    const labelOf = (el) => {
      const parts = [];
      if (el.tagName) parts.push(el.tagName.toLowerCase());
      if (el.id) parts.push("#" + el.id);
      if (el.classList && el.classList.length) parts.push("." + [...el.classList].slice(0, 3).join("."));
      const tid = el.getAttribute ? el.getAttribute("data-testid") : "";
      if (tid) parts.push('[data-testid="' + tid + '"]');
      return parts.join("");
    };
    const countOf = (sel) => { try { return document.querySelectorAll(sel).length; } catch (e) { return -1; } };
    const quoteAttr = (v) => '"' + String(v).replace(/[\\\\"]/g, (c) => "\\\\" + c) + '"';
    const domPathOf = (el) => {
      const chain = [];
      let node = el;
      while (node instanceof Element && node !== document.documentElement) {
        if (node.id) { chain.unshift("#" + esc(node.id)); return chain.join(" > "); }
        let name = node.tagName ? node.tagName.toLowerCase() : "node";
        const parent = node.parentElement;
        if (parent) {
          const siblings = [...parent.children].filter((s) => s.tagName === node.tagName);
          if (siblings.length > 1) name += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
        }
        chain.unshift(name);
        node = parent;
      }
      chain.unshift(document.documentElement.tagName.toLowerCase());
      return chain.join(" > ");
    };
    const selectorFor = (el) => {
      const tag = el.tagName ? el.tagName.toLowerCase() : "";
      const attr = (name) => (el.getAttribute ? el.getAttribute(name) : "");
      const tid = attr("data-testid");
      const classes = el.classList ? [...el.classList].filter(Boolean) : [];
      const dotted = (list) => list.map(esc).join(".");
      const candidates = [];
      if (el.id) candidates.push("#" + esc(el.id));
      if (tid) candidates.push(tag + '[data-testid="' + tid + '"]');
      for (const name of ["aria-label", "name", "title", "placeholder", "alt", "href"]) {
        const v = attr(name);
        if (v) candidates.push((tag ? tag : "") + "[" + name + "=" + quoteAttr(v) + "]");
      }
      if (classes.length) {
        candidates.push(tag + "." + dotted(classes));
        candidates.push("." + dotted(classes));
        for (let n = classes.length - 1; n >= 1; n--) candidates.push("." + dotted(classes.slice(0, n)));
      }
      if (tag && tag !== "html" && tag !== "body") candidates.push(tag);
      for (const sel of candidates) {
        if (countOf(sel) === 1) return { selector: sel, matches: 1 };
      }
      const path = domPathOf(el);
      return { selector: path, matches: countOf(path) };
    };
    const attrsOf = (el) => {
      const out = {};
      if (!el.getAttribute) return out;
      const names = ["id","data-testid","name","role","type","aria-label","title","placeholder","alt","href","src","value"];
      for (const name of names) {
        const v = el.getAttribute(name);
        if (v) out[name] = String(v).slice(0, 160);
      }
      if (el.attributes) {
        for (const attr of el.attributes) {
          if (attr.name.indexOf("data-") === 0 && !out[attr.name]) out[attr.name] = String(attr.value).slice(0, 160);
        }
      }
      return out;
    };
    const ancestorOf = (el) => {
      let node = el.parentElement;
      let depth = 0;
      while (node && node !== document.body && node !== document.documentElement && depth < 8) {
        const tid = node.getAttribute ? node.getAttribute("data-testid") : "";
        if (node.id || tid) {
          return {
            tag: node.tagName ? node.tagName.toLowerCase() : "node",
            id: node.id || "",
            testid: tid || "",
            classes: node.classList ? [...node.classList].slice(0, 6) : [],
          };
        }
        node = node.parentElement;
        depth++;
      }
      return null;
    };
    const SVG_PARTS = { svg: 1, path: 1, g: 1, use: 1, circle: 1, rect: 1, line: 1, polyline: 1, polygon: 1, ellipse: 1, defs: 1, clippath: 1, mask: 1, lineargradient: 1, stop: 1, text: 1 };
    const svgRootOf = (el) => {
      let node = el;
      let i = 0;
      while (node instanceof Element && i < 8) {
        const tag = node.tagName ? node.tagName.toLowerCase() : "";
        if (tag === "svg") return node;
        if (!SVG_PARTS[tag]) return el;
        node = node.parentElement;
        i++;
      }
      return el;
    };
    const hitOf = (e) => {
      let stack = [];
      try { stack = document.elementsFromPoint ? document.elementsFromPoint(e.clientX, e.clientY) : []; } catch {}
      for (const node of stack) {
        if (!(node instanceof Element)) continue;
        if (node.closest && node.closest("[data-tcode-picker]")) continue;
        if (node === document.documentElement || node === document.body) continue;
        return node;
      }
      return e.target instanceof Element ? e.target : null;
    };
    const fiberOf = (el) => {
      try {
        const keys = Object.keys(el).filter((k) => k.indexOf("__reactFiber$") === 0);
        return keys.length ? el[keys[0]] : null;
      } catch (e) { return null; }
    };
    const frameOfNode = (node) => {
      let stack = "";
      try { stack = String((node && node._debugStack && node._debugStack.stack) || ""); } catch (e) { return null; }
      if (!stack) return null;
      const lines = stack.split("\\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let start = line.indexOf("http://");
        if (start < 0) start = line.indexOf("https://");
        if (start < 0) continue;
        let url = line.slice(start).trim();
        if (url.slice(-1) === ")") url = url.slice(0, -1);
        if (url.indexOf("/node_modules/") >= 0 || url.indexOf("/@fs/") >= 0) continue;
        if (url.indexOf("/src/") < 0) continue;
        let path = "";
        try { path = new URL(url).pathname; } catch (e) { path = url; }
        let lineNo = 0;
        let column = 0;
        const segs = url.split(":");
        const last = segs[segs.length - 1];
        const prev = segs[segs.length - 2];
        if (/^\\d+$/.test(last) && /^\\d+$/.test(prev)) { column = Number(last); lineNo = Number(prev); }
        let component = "";
        const atIdx = line.indexOf("at ");
        const parenIdx = line.indexOf(" (");
        if (atIdx >= 0 && parenIdx > atIdx) component = line.slice(atIdx + 3, parenIdx).trim();
        return { component, file: path, line: lineNo, column, url };
      }
      return null;
    };
    const mapCache = {};
    const vlqChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const decodeVlq = (seg) => {
      const out = [];
      let shift = 0;
      let value = 0;
      for (let i = 0; i < seg.length; i++) {
        const digit = vlqChars.indexOf(seg[i]);
        if (digit < 0) return null;
        value += (digit & 31) << shift;
        if (digit & 32) { shift += 5; continue; }
        out.push(value & 1 ? -(value >>> 1) : value >>> 1);
        value = 0;
        shift = 0;
      }
      return out;
    };
    const positionInMap = (map, genLine, genCol) => {
      const lines = String(map.mappings || "").split(";");
      let srcIdx = 0;
      let origLine = 0;
      let origCol = 0;
      let best = null;
      const last = Math.min(genLine, lines.length);
      for (let i = 0; i < last; i++) {
        const segs = lines[i].split(",");
        let genAcc = 0;
        for (let s = 0; s < segs.length; s++) {
          const nums = segs[s] ? decodeVlq(segs[s]) : null;
          if (!nums || !nums.length) continue;
          genAcc += nums[0];
          if (nums.length >= 4) {
            srcIdx += nums[1];
            origLine += nums[2];
            origCol += nums[3];
          }
          if (i === last - 1 && nums.length >= 4 && genAcc <= genCol) best = { srcIdx, line: origLine + 1, column: origCol };
        }
      }
      if (!best) return null;
      const source = String((map.sources && map.sources[best.srcIdx]) || "");
      const root = map.sourceRoot ? String(map.sourceRoot).replace(/\\/+$/, "") : "";
      return { file: root ? root + "/" + source : source, line: best.line, column: best.column };
    };
    const mappedPosition = (url, line, column) => {
      const base = String(url).split("?")[0];
      if (!mapCache[base]) {
        mapCache[base] = fetch(base)
          .then((r) => (r.ok ? r.text() : ""))
          .then((text) => {
            const marker = "sourceMappingURL=data:application/json;base64,";
            const at = text.indexOf(marker);
            if (at < 0) return null;
            const rest = text.slice(at + marker.length);
            const nl = rest.indexOf("\\n");
            const b64 = nl >= 0 ? rest.slice(0, nl) : rest;
            try { return JSON.parse(atob(b64.trim())); } catch (e) { return null; }
          })
          .catch(() => null);
      }
      return mapCache[base].then((map) => (map ? positionInMap(map, line, Math.max(0, column - 1)) : null));
    };
    const sourceOf = async (el) => {
      let node = fiberOf(el);
      let depth = 0;
      while (node && depth < 24) {
        const frame = frameOfNode(node);
        if (frame) {
          frame.own = depth === 0;
          if (frame.line > 0 && frame.file.indexOf("/src/") === 0) {
            try {
              const mapped = await mappedPosition(frame.url, frame.line, frame.column);
              if (mapped && mapped.line > 0) {
                const idx = mapped.file.indexOf("/src/");
                if (idx >= 0) frame.file = mapped.file.slice(idx);
                frame.line = mapped.line;
                frame.column = mapped.column;
                frame.mapped = true;
              }
            } catch (e) {}
          }
          return frame;
        }
        node = node.return;
        depth++;
      }
      return null;
    };
    const collect = async (el) => {
      if (!el) return null;
      const picked = selectorFor(el);
      const styles = [];
      const groupActive = (parent) => {
        try {
          const name = parent.constructor.name;
          if (name === "CSSMediaRule") return window.matchMedia(parent.conditionText).matches;
          if (name === "CSSSupportsRule") return !window.CSS || !window.CSS.supports || window.CSS.supports(parent.conditionText);
        } catch {}
        return true;
      };
      const groupLabel = (rule) => {
        const parts = [];
        for (let p = rule.parentRule; p; p = p.parentRule) {
          const name = p.constructor.name;
          if (name === "CSSMediaRule") parts.unshift("@media " + p.conditionText);
          else if (name === "CSSSupportsRule") parts.unshift("@supports " + p.conditionText);
          else if (name === "CSSLayerBlockRule") parts.unshift("@layer " + (p.name || ""));
        }
        return parts.join(" ");
      };
      const seenStyles = new Set();
      const stripState = (selector) => selector
        .replace(/:(hover|focus|focus-visible|active|disabled|enabled|checked|indeterminate|visited|link|target|read-only|read-write|placeholder-shown)/g, "")
        .replace(/::?(before|after|placeholder|selection|backdrop|marker)/g, "");
      const groupInactive = (rule) => {
        for (let p = rule.parentRule; p; p = p.parentRule) {
          if (!groupActive(p)) return true;
        }
        return false;
      };
      const sheetSource = (sheet) => {
        try {
          if (sheet.href) return sheet.href;
          const node = sheet.ownerNode || sheet.owningElement;
          if (node && node.getAttribute) {
            const raw = node.getAttribute("data-vite-dev-id") || node.getAttribute("data-href") || node.getAttribute("data-emotion") || node.getAttribute("data-styled") || "";
            if (raw) return raw;
          }
        } catch {}
        return null;
      };
      const walkRules = (rules, href) => {
        for (const rule of rules) {
          if (styles.length >= 80) return;
          if (rule.selectorText && el.matches) {
            let matched = false;
            try { matched = el.matches(rule.selectorText); } catch { matched = false; }
            if (!matched) {
              const base = stripState(rule.selectorText);
              if (base && base !== rule.selectorText) {
                try { matched = el.matches(base); } catch { matched = false; }
              }
            }
            if (matched) {
              const group = groupLabel(rule) || undefined;
              const key = (href || "") + "|" + rule.selectorText + "|" + (group || "");
              if (!seenStyles.has(key)) {
                seenStyles.add(key);
                styles.push({
                  stylesheet: href,
                  selector: rule.selectorText,
                  rule: String(rule.cssText).slice(0, 300),
                  group,
                  inactive: groupInactive(rule) || undefined,
                });
              }
            }
          }
          if (rule.cssRules && rule.cssRules.length) walkRules(rule.cssRules, href);
        }
      };
      try {
        const sheets = [...document.styleSheets];
        try { for (const sheet of document.adoptedStyleSheets || []) sheets.push(sheet); } catch {}
        for (const sheet of sheets) {
          if (styles.length >= 80) break;
          let rules = null;
          try {
            rules = sheet.cssRules;
          } catch {
            if (sheet.href && !seenStyles.has(sheet.href + "|cross-origin")) {
              seenStyles.add(sheet.href + "|cross-origin");
              styles.push({
                stylesheet: sheet.href,
                selector: "",
                rule: "/* 跨域样式表：浏览器禁止读取 CSSOM，只能参考 computed */",
                unreadable: true,
              });
            }
            continue;
          }
          if (!rules) continue;
          walkRules(rules, sheetSource(sheet));
        }
      } catch {}
      const inlineStyle = el.getAttribute ? el.getAttribute("style") : "";
      if (inlineStyle) styles.push({ stylesheet: null, selector: "style", rule: inlineStyle.slice(0, 300), group: "inline" });
      const computed = {};
      if (el.nodeType === 1) {
        const cs = getComputedStyle(el);
        const computedNames = [
          "backgroundColor","backgroundImage","color","fontFamily","fontSize","fontWeight","fontStyle",
          "lineHeight","letterSpacing","textAlign","textDecoration","whiteSpace","opacity","visibility",
          "display","position","top","right","bottom","left","zIndex","boxSizing","width","height",
          "minWidth","maxWidth","minHeight","maxHeight","margin","padding","border","borderWidth",
          "borderStyle","borderColor","borderRadius","boxShadow","outline","gap","rowGap","columnGap",
          "flexDirection","flexWrap","justifyContent","alignItems","gridTemplateColumns","gridTemplateRows",
          "overflow","overflowX","overflowY","transform","transition","cursor","pointerEvents",
        ];
        for (const name of computedNames) {
          const cssName = name.replace(/[A-Z]/g, (ch) => "-" + ch.toLowerCase());
          try { const v = cs.getPropertyValue(cssName); if (v) computed[name] = v; } catch {}
        }
      }
      const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      return {
        tag: el.tagName ? el.tagName.toLowerCase() : "node",
        id: el.id || "",
		classes: el.classList ? [...el.classList].slice(0, 32) : [],
        selector: picked.selector,
        selectorMatches: picked.matches,
        domPath: domPathOf(el),
        text: (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 120),
        html: (el.outerHTML || "").slice(0, 2000),
        attrs: attrsOf(el),
        ancestor: ancestorOf(el),
        source: (await sourceOf(el)) || undefined,
        styles,
        computed,
        rect: r ? { left: r.left, top: r.top, width: r.width, height: r.height } : { left: 0, top: 0, width: 0, height: 0 },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
    };
    const abort = () => {
      deliver(null);
      window.__tcodePickerNext = null;
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", key, true);
      overlay.remove();
      label.remove();
      if (window.__tcodePickerAbort === abort) window.__tcodePickerAbort = null;
      if (window.__tcodePickerActive === token) window.__tcodePickerActive = false;
    };
    const finish = (payload) => {
      deliver(payload);
      abort();
    };
    const num = (raw, basis) => {
      const text = String(raw == null ? "" : raw).trim();
      if (!text) return NaN;
      if (text.slice(-1) === "%") return (parseFloat(text) / 100) * basis;
      const v = parseFloat(text);
      return isNaN(v) ? NaN : v;
    };
    const pointsOf = (inner, w, h) => inner
      .split(",")
      .map((part) => part.trim().split(/\\s+/))
      .map((pair) => [num(pair[0], w), num(pair[1], h)])
      .filter((p) => !isNaN(p[0]) && !isNaN(p[1]));
    const clipArgs = (clip) => clip.slice(clip.indexOf("(") + 1, clip.lastIndexOf(")"));
    const atOf = (text, w, h) => {
      const parts = text.split(" at ");
      if (!parts[1]) return { cx: w / 2, cy: h / 2 };
      const c = parts[1].trim().split(/\\s+/);
      return { cx: num(c[0], w), cy: num(c[1], h) };
    };
    const shapeOf = (el, w, h) => {
      let cs = null;
      try { cs = getComputedStyle(el); } catch (e) { return { kind: "rect" }; }
      if (!cs) return { kind: "rect" };
      const clip = cs.clipPath && cs.clipPath !== "none" ? String(cs.clipPath) : "";
      if (clip) {
        if (clip.indexOf("polygon(") === 0) {
          const pts = pointsOf(clipArgs(clip).split(" at ")[0], w, h);
          if (pts.length >= 3) return { kind: "polygon", points: pts };
        }
        if (clip.indexOf("circle(") === 0) {
          const inner = clipArgs(clip);
          const r = num(inner.split(" at ")[0], Math.min(w, h) / 2);
          const c = atOf(inner, w, h);
          if (!isNaN(r)) return { kind: "ellipse", cx: c.cx, cy: c.cy, rx: r, ry: r };
        }
        if (clip.indexOf("ellipse(") === 0) {
          const inner = clipArgs(clip);
          const radii = inner.split(" at ")[0].trim().split(/\\s+/);
          const rx = num(radii[0], w / 2);
          const ry = radii[1] ? num(radii[1], h / 2) : rx;
          const c = atOf(inner, w, h);
          if (!isNaN(rx) && !isNaN(ry)) return { kind: "ellipse", cx: c.cx, cy: c.cy, rx: rx, ry: ry };
        }
        if (clip.indexOf("inset(") === 0) {
          const inner = clipArgs(clip);
          const at = inner.indexOf(" round ");
          const r = at === -1 ? NaN : num(inner.slice(at + 7).split(/\\s+/)[0], Math.min(w, h) / 2);
          if (!isNaN(r) && r > 0) return { kind: "round", rx: r, ry: r };
        }
      }
      const readCorner = (raw) => {
        const parts = String(raw == null ? "" : raw).trim().split(/\\s+/);
        const rx = num(parts[0], w);
        const ry = parts[1] ? num(parts[1], h) : rx;
        return { x: isNaN(rx) ? 0 : rx, y: isNaN(ry) ? 0 : ry };
      };
      const radii = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map(readCorner);
      if (radii.every((r) => r.x <= 0.01 && r.y <= 0.01)) return { kind: "rect" };
      const percentAll = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius]
        .every((v) => String(v == null ? "" : v).trim().slice(-1) === "%" && parseFloat(String(v)) >= 45);
      if (percentAll) return { kind: "ellipse", cx: w / 2, cy: h / 2, rx: w / 2, ry: h / 2 };
      let scale = 1;
      const sides = [
        [radii[0].x + radii[1].x, w],
        [radii[1].y + radii[2].y, h],
        [radii[3].x + radii[2].x, w],
        [radii[0].y + radii[3].y, h],
      ];
      for (const side of sides) {
        if (side[0] > 0 && side[1] > 0) scale = Math.min(scale, side[1] / side[0]);
      }
      return {
        kind: "round",
        radii: radii.map((r) => ({ x: r.x * scale, y: r.y * scale })),
      };
    };
    const roundPath = (w, h, radii) => {
      const tl = radii[0], tr = radii[1], br = radii[2], bl = radii[3];
      const d = [];
      d.push("M " + tl.x + " 0");
      d.push("H " + (w - tr.x));
      if (tr.x || tr.y) d.push("A " + tr.x + " " + tr.y + " 0 0 1 " + w + " " + tr.y);
      d.push("V " + (h - br.y));
      if (br.x || br.y) d.push("A " + br.x + " " + br.y + " 0 0 1 " + (w - br.x) + " " + h);
      d.push("H " + bl.x);
      if (bl.x || bl.y) d.push("A " + bl.x + " " + bl.y + " 0 0 1 0 " + (h - bl.y));
      d.push("V " + tl.y);
      if (tl.x || tl.y) d.push("A " + tl.x + " " + tl.y + " 0 0 1 " + tl.x + " 0");
      d.push("Z");
      return d.join(" ");
    };
    const drawShape = (shape, w, h) => {
      while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
      const pad = 1;
      let node = null;
      if (shape.kind === "polygon") {
        node = document.createElementNS(SVG_NS, "polygon");
        node.setAttribute("points", shape.points.map((p) => p[0] + "," + p[1]).join(" "));
      } else if (shape.kind === "ellipse") {
        node = document.createElementNS(SVG_NS, "ellipse");
        node.setAttribute("cx", shape.cx);
        node.setAttribute("cy", shape.cy);
        node.setAttribute("rx", Math.max(0.5, shape.rx - pad));
        node.setAttribute("ry", Math.max(0.5, shape.ry - pad));
      } else {
        node = document.createElementNS(SVG_NS, "path");
        const iw = Math.max(1, w - pad * 2);
        const ih = Math.max(1, h - pad * 2);
        const inner = shape.kind === "round"
          ? shape.radii.map((r) => ({ x: Math.max(0, Math.min(r.x, iw / 2)), y: Math.max(0, Math.min(r.y, ih / 2)) }))
          : [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
        node.setAttribute("d", roundPath(iw, ih, inner));
        node.setAttribute("transform", "translate(" + pad + "," + pad + ")");
      }
      node.setAttribute("fill", "rgba(59,130,246,0.18)");
      node.setAttribute("stroke", "#2563eb");
      node.setAttribute("stroke-width", "2");
      node.setAttribute("stroke-linejoin", "round");
      overlay.appendChild(node);
    };
    const paint = (el) => {
      if (!(el instanceof Element)) return;
      current = el;
      const r = el.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width));
      const h = Math.max(1, Math.round(r.height));
      overlay.style.left = r.left + "px";
      overlay.style.top = r.top + "px";
      overlay.style.width = w + "px";
      overlay.style.height = h + "px";
      overlay.setAttribute("viewBox", "0 0 " + w + " " + h);
      drawShape(shapeOf(el, w, h), w, h);
      label.textContent = labelOf(el);
      label.style.left = r.left + "px";
      label.style.top = Math.max(0, r.top - label.offsetHeight - 3) + "px";
    };
    const move = (e) => {
      if (window.__tcodePickerPaused) return;
      const hit = hitOf(e);
      if (!(hit instanceof Element) || (hit.closest && hit.closest("[data-tcode-picker]"))) return;
      paint(svgRootOf(hit));
    };
    const click = (e) => {
      if (window.__tcodePickerPaused) return;
      e.preventDefault();
      e.stopPropagation();
      const hit = hitOf(e) || e.target;
      const el = hit instanceof Element ? svgRootOf(hit) : null;
      Promise.resolve(collect(el instanceof Element ? el : null)).then(
        (payload) => deliver(payload || null),
        () => {},
      );
    };
    const key = (e) => {
      if (e.key === "Escape") { e.preventDefault(); finish(null); }
    };
    document.addEventListener("pointermove", move, true);
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", key, true);
    document.body.append(overlay, label);
    window.__tcodePickerAbort = abort;
  }
  return true;
})()`;
}
