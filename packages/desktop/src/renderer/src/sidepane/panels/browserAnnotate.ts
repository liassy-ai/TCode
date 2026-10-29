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

export function candidateWorkspacePaths(stylesheetHref: string): string[] {
	try {
		const url = new URL(stylesheetHref);
		if (url.protocol !== "http:" && url.protocol !== "https:") return [];
		const path = decodeURIComponent(url.pathname).replace(/^\/+/, "");
		return path ? [path] : [];
	} catch {
		return [];
	}
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
	try {
		const payload = JSON.parse(
			command.slice(WEB_ANNOTATE_SKILL_COMMAND.length + 1),
		) as Partial<AnnotationPayload>;
		return {
			pageUrl: typeof payload.pageUrl === "string" ? payload.pageUrl : "",
			note: typeof payload.note === "string" ? payload.note : "",
			elementLabel: elementLabel(payload.element),
		};
	} catch {
		return null;
	}
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

export function buildPickerScript(): string {
	return `(() => {
  const token = Math.random().toString(36).slice(2);
  document.querySelectorAll("[data-tcode-picker]").forEach((n) => n.remove());
  if (typeof window.__tcodePickerAbort === "function") window.__tcodePickerAbort();
  if (window.__tcodePickerActive) return Promise.resolve(null);
  window.__tcodePickerActive = token;
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.setAttribute("data-tcode-picker", "overlay");
    Object.assign(overlay.style, {
      position: "fixed", left: "0", top: "0", width: "0", height: "0",
      pointerEvents: "none", zIndex: "2147483647",
      border: "3px solid #2563eb", background: "rgba(59,130,246,0.18)", borderRadius: "3px",
    });
    const label = document.createElement("div");
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
    const SEMANTIC_TAGS = { button: 1, a: 1, input: 1, select: 1, textarea: 1, label: 1, summary: 1, img: 1, option: 1, li: 1, td: 1, th: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1, canvas: 1, iframe: 1, video: 1, audio: 1 };
    const CONTROL_SELECTOR = "button,a,label,summary,input,select,textarea,[role='button'],[role='link'],[role='tab'],[role='menuitem']";
    const controlTarget = (el) => {
      try { return el.closest ? el.closest(CONTROL_SELECTOR) : null; } catch { return null; }
    };
    const meaningfulTarget = (el, deep = false) => {
      if (!deep) {
        const control = controlTarget(el);
        if (control) return control;
      }
      let node = el;
      let depth = 0;
      while (node instanceof Element && node !== document.body && node !== document.documentElement && depth < 6) {
        const tag = node.tagName ? node.tagName.toLowerCase() : "";
        const attr = (name) => (node.getAttribute ? node.getAttribute(name) : "");
        if (node.id || attr("data-testid") || attr("role") || attr("aria-label") || attr("name") || attr("href") || attr("style") || (node.classList && node.classList.length) || SEMANTIC_TAGS[tag]) return node;
        node = node.parentElement;
        depth++;
      }
      return el;
    };
    const collect = (el) => {
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
          walkRules(rules, sheet.href);
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
        styles,
        computed,
        rect: r ? { left: r.left, top: r.top, width: r.width, height: r.height } : { left: 0, top: 0, width: 0, height: 0 },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
    };
    const abort = () => {
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", key, true);
      overlay.remove();
      label.remove();
      if (window.__tcodePickerAbort === abort) window.__tcodePickerAbort = null;
      if (window.__tcodePickerActive === token) window.__tcodePickerActive = false;
      resolve(null);
    };
    const finish = (payload) => {
      resolve(payload);
      abort();
    };
    const move = (e) => {
      const hit = e.target;
      if (!(hit instanceof Element) || hit.closest("[data-tcode-picker]")) return;
      const el = meaningfulTarget(hit, e.altKey);
      current = el;
      const r = el.getBoundingClientRect();
      overlay.style.left = r.left + "px";
      overlay.style.top = r.top + "px";
      overlay.style.width = r.width + "px";
      overlay.style.height = r.height + "px";
      label.textContent = labelOf(el);
      label.style.left = r.left + "px";
      label.style.top = Math.max(0, r.top - label.offsetHeight - 3) + "px";
    };
    const click = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const el = e.altKey ? meaningfulTarget(e.target, true) : current && current.contains(e.target) ? current : meaningfulTarget(e.target);
      finish(collect(el instanceof Element ? el : null) || null);
    };
    const key = (e) => {
      if (e.key === "Escape") { e.preventDefault(); finish(null); }
    };
    document.addEventListener("pointermove", move, true);
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", key, true);
    document.body.append(overlay, label);
    window.__tcodePickerAbort = abort;
  });
})()`;
}
