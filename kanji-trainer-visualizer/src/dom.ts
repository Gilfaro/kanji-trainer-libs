import type { ValidationThemeMode } from "./renderCanvas";
import CSS from "./panel.css";

const THEME_VARS: Record<ValidationThemeMode, Record<string, string>> = {
	light: {
		"--kvp-text": "#1f232b",
		"--kvp-muted-text": "#777777",
		"--kvp-border": "#d4d4d4",
		"--kvp-track-bg": "#e6e6e6",
		"--kvp-marker": "#202020",
		"--kvp-marker-shadow": "0 0 0 1px rgba(255,255,255,0.7)",
		"--kvp-btn-bg": "#f3f5f8",
		"--kvp-btn-active-bg": "#dce7ff",
		"--kvp-bar-bg": "#f8f8f8",
		"--kvp-bar-border": "#cfcfcf",
		"--kvp-threshold": "#364fc7",
		"--kvp-hover-bg": "rgba(54, 79, 199, 0.10)",
		"--kvp-hover-ring": "inset 0 0 0 1px rgba(54, 79, 199, 0.35)",
		"--kvp-panel-bg": "transparent",
		"--kvp-canvas-border": "#d4d4d4",
	},
	dark: {
		"--kvp-text": "#e3e8f1",
		"--kvp-muted-text": "#adb7ca",
		"--kvp-border": "#57637d",
		"--kvp-track-bg": "#3f4b63",
		"--kvp-marker": "#f2f5fa",
		"--kvp-marker-shadow": "0 0 0 1px rgba(0,0,0,0.45)",
		"--kvp-btn-bg": "#2f394c",
		"--kvp-btn-active-bg": "#3e5382",
		"--kvp-bar-bg": "#2f394c",
		"--kvp-bar-border": "#6a7895",
		"--kvp-threshold": "#8ea3ff",
		"--kvp-hover-bg": "rgba(142, 163, 255, 0.13)",
		"--kvp-hover-ring": "inset 0 0 0 1px rgba(142, 163, 255, 0.45)",
		"--kvp-panel-bg": "transparent",
		"--kvp-canvas-border": "#57637d",
	},
};


export function injectStyles(container: HTMLElement): void {
	const style = document.createElement("style");
	style.textContent = CSS;
	container.prepend(style);
}

export function applyTheme(root: HTMLElement, mode: ValidationThemeMode): void {
	for (const [k, v] of Object.entries(THEME_VARS[mode])) {
		root.style.setProperty(k, v);
	}
}

interface ElProps {
	cls?: string;
	style?: Partial<CSSStyleDeclaration>;
	text?: string;
	html?: string;
	dataset?: Record<string, string>;
	attrs?: Record<string, string>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	props?: ElProps,
	...children: (HTMLElement | null | undefined)[]
): HTMLElementTagNameMap[K] {
	const e = document.createElement(tag);
	if (props?.cls) e.className = props.cls;
	if (props?.style) Object.assign(e.style, props.style);
	if (props?.text) e.textContent = props.text;
	if (props?.html) e.innerHTML = props.html;
	if (props?.dataset) {
		for (const [k, v] of Object.entries(props.dataset)) e.dataset[k] = v;
	}
	if (props?.attrs) {
		for (const [k, v] of Object.entries(props.attrs)) e.setAttribute(k, v);
	}
	for (const child of children) {
		if (child) e.appendChild(child);
	}
	return e;
}

export function setRowHoverStyle(row: HTMLDivElement, active: boolean): void {
	row.style.background = active ? "var(--kvp-hover-bg)" : "transparent";
	row.style.boxShadow = active ? "var(--kvp-hover-ring)" : "none";
}
