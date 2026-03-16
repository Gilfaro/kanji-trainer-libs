import { el } from "./dom";
import { strokeColor } from "./palette";
import type { OverlayValidationData } from "./types";

const GREEN = "#31a24c";
const RED = "#cf2f2f";
const GRAY = "#999999";

export interface MetricRow {
	row: HTMLDivElement;
	valueLabel: HTMLSpanElement;
	fill: HTMLDivElement;
	thresholdLine: HTMLDivElement;
}

export function createMetricRow(title: string): MetricRow {
	const fill = el("div", { cls: "kvp-metric-fill", style: { background: GREEN } });
	const thresholdLine = el("div", { cls: "kvp-metric-threshold" });
	const bar = el("div", { cls: "kvp-metric-bar" }, fill, thresholdLine);
	const valueLabel = el("span", { cls: "kvp-mono", text: "-" });
	const row = el("div", { cls: "kvp-metric-row" },
		el("div", { cls: "kvp-metric-name", text: title }),
		bar,
		valueLabel,
	);
	return { row, valueLabel, fill, thresholdLine };
}

export function setMetricRow(row: MetricRow, value: number | undefined, threshold: number | undefined): void {
	if (value === undefined || Number.isNaN(value)) {
		row.valueLabel.textContent = "-";
		row.fill.style.width = "0%";
		row.fill.style.background = GRAY;
		row.thresholdLine.style.display = "none";
		return;
	}
	const clamped = Math.max(0, Math.min(1, value));
	row.valueLabel.textContent = `${Math.round(clamped * 100)}%`;
	row.fill.style.width = `${clamped * 100}%`;

	if (threshold === undefined || Number.isNaN(threshold)) {
		row.fill.style.background = GREEN;
		row.thresholdLine.style.display = "none";
		return;
	}
	const tc = Math.max(0, Math.min(1, threshold));
	row.thresholdLine.style.display = "block";
	row.thresholdLine.style.left = `calc(${tc * 100}% - 1px)`;
	row.fill.style.background = value <= threshold ? GREEN : RED;
}

export function createAngleIssueItem(value: number, threshold: number | undefined): HTMLDivElement {
	const clamped = Math.max(0, Math.min(1, value));
	const fill = el("div", {
		cls: "kvp-angle-fill",
		style: {
			width: `${clamped * 100}%`,
			background: threshold !== undefined && value > threshold ? RED : GREEN,
		},
	});
	const bar = el("div", { cls: "kvp-angle-bar" }, fill);

	if (threshold !== undefined && !Number.isNaN(threshold)) {
		const tc = Math.max(0, Math.min(1, threshold));
		bar.appendChild(el("div", {
			cls: "kvp-metric-threshold",
			style: { left: `calc(${tc * 100}% - 1px)` },
		}));
	}

	const val = el("span", { cls: "kvp-mono", text: `${Math.round(clamped * 100)}%` });
	return el("div", { cls: "kvp-angle-row" }, el("div", undefined, bar), val);
}

export function renderZones(container: HTMLDivElement, strokeCount: number, warnByStroke: boolean[]): void {
	container.innerHTML = "";
	const count = Math.max(strokeCount, 1);
	for (let i = 0; i < count; i += 1) {
		const zone = el("span", {
			cls: "kvp-zone",
			style: { background: strokeColor(i) },
		});
		if (warnByStroke[i]) {
			zone.appendChild(el("span", { cls: "kvp-badge", text: "!" }));
		}
		container.appendChild(zone);
	}
}

export function buildStrokeWarnings(data: OverlayValidationData, strokeCount: number): boolean[] {
	const warnings = Array.from({ length: strokeCount }, () => false);
	const thr = data.thresholds;
	const refCount = data.reference_raw.strokes.length;
	const usrCount = data.user_raw.strokes.length;

	const positionByIndex = new Map<number, number>();
	for (const s of data.composition.stroke_details ?? []) {
		positionByIndex.set(s.stroke_idx, Math.max(s.start.distance, s.end.distance));
	}

	for (let i = 0; i < strokeCount; i += 1) {
		const missing = i >= refCount || i >= usrCount;
		const dtw = data.dtw?.strokes?.[i]?.dtw_error;
		const rms = data.rms?.strokes?.[i]?.rms;
		const pos = positionByIndex.get(i);
		const dtwBad = thr?.dtw !== undefined && dtw !== undefined && dtw > thr.dtw;
		const rmsBad = thr?.rms !== undefined && rms !== undefined && rms > thr.rms;
		const posBad = thr?.position !== undefined && pos !== undefined && pos > thr.position;
		warnings[i] = missing || dtwBad || rmsBad || posBad;
	}
	return warnings;
}
