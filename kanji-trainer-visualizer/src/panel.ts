import {
	renderValidationPanel,
	type AngleIssueFocus,
	type MetricFocus,
	type ValidationThemeMode,
	type ValidationPanelController,
} from "./renderCanvas";
import type { AffineTransform, OverlayValidationData, Point, Stroke } from "./types";
import { strokeColor } from "./palette";
import { el, injectStyles, applyTheme, setRowHoverStyle } from "./dom";
import { createTimelineRow } from "./timeline";
import { createMetricRow, setMetricRow, createAngleIssueItem, renderZones, buildStrokeWarnings } from "./metrics";

const RIGHT_PANEL_WIDTH = 340;
const METRIC_WIDTH = 220;
const DEFAULT_PANEL_WIDTH = 1000;
const DEFAULT_PANEL_HEIGHT = 500;
const TOP_ROW_HEIGHT = 70;
const ROOT_ROW_GAP = 10;

export interface ValidationGuiPanel {
	element: HTMLDivElement;
	setData: (input: string | OverlayValidationData) => void;
	play: () => void;
	pause: () => void;
	restart: () => void;
	dispose: () => void;
}

export interface CreateValidationGuiPanelOptions {
	themeMode?: ValidationThemeMode;
	initialMode?: "draw" | "draw_loop" | "morph" | "morph_loop" | "overall";
}


function applyAffineToPoint(point: Point, t: AffineTransform): Point {
	return { x: t.scale_x * point.x + t.translate_x, y: t.scale_y * point.y + t.translate_y };
}

function applyAffineToStrokePoints(points: Point[] | undefined, t: AffineTransform): Point[] | undefined {
	return points?.map((p) => applyAffineToPoint(p, t));
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, color: string, lineWidth: number): void {
	if (stroke.points.length < 2) return;
	ctx.strokeStyle = color;
	ctx.lineWidth = lineWidth;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	ctx.beginPath();
	ctx.moveTo(stroke.points[0]!.x, stroke.points[0]!.y);
	for (let i = 1; i < stroke.points.length; i += 1) {
		ctx.lineTo(stroke.points[i]!.x, stroke.points[i]!.y);
	}
	ctx.stroke();
}

function drawCurrentStrokePreview(
	canvas: HTMLCanvasElement,
	referencePoints: Point[] | undefined,
	userPoints: Point[] | undefined,
	strokeIndex: number,
	panelBg: string,
	borderColor: string,
): void {
	const ctx = canvas.getContext("2d");
	if (!ctx) return;
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	ctx.fillStyle = panelBg;
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.strokeStyle = borderColor;
	ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);

	const ref = referencePoints ? { points: referencePoints, label_pos: null } : undefined;
	const usr = userPoints ? { points: userPoints, label_pos: null } : undefined;
	const strokes = [ref, usr].filter(Boolean) as Stroke[];
	if (strokes.length === 0) return;

	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const s of strokes) {
		for (const p of s.points) {
			minX = Math.min(minX, p.x);
			minY = Math.min(minY, p.y);
			maxX = Math.max(maxX, p.x);
			maxY = Math.max(maxY, p.y);
		}
	}

	const padding = 12;
	const srcW = Math.max(maxX - minX, 1e-9);
	const srcH = Math.max(maxY - minY, 1e-9);
	const dstW = Math.max(canvas.width - padding * 2, 1);
	const dstH = Math.max(canvas.height - padding * 2, 1);
	const scale = Math.min(dstW / srcW, dstH / srcH);
	const ox = padding + (dstW - srcW * scale) / 2;
	const oy = padding + (dstH - srcH * scale) / 2;

	const mapStroke = (s: Stroke): Stroke => ({
		points: s.points.map((p) => ({
			x: ox + (p.x - minX) * scale,
			y: oy + (p.y - minY) * scale,
		})),
		label_pos: null,
	});

	const color = strokeColor(strokeIndex);
	if (ref) drawStroke(ctx, mapStroke(ref), color.replace("rgb(", "rgba(").replace(")", ", 0.25)"), 5);
	if (usr) drawStroke(ctx, mapStroke(usr), color, 2.4);
}


function parseInput(input: string | OverlayValidationData): OverlayValidationData {
	return typeof input === "string" ? JSON.parse(input) as OverlayValidationData : input;
}

export function createValidationGuiPanel(
	input: string | OverlayValidationData,
	options?: CreateValidationGuiPanelOptions,
): ValidationGuiPanel {
	const themeMode = options?.themeMode ?? "light";
	const initialMode = options?.initialMode ?? "morph_loop";
	const panelBg = themeMode === "dark" ? "transparent" : "transparent";
	const borderColor = themeMode === "dark" ? "#57637d" : "#d4d4d4";

	const root = el("div", { cls: "kvp-root" });
	injectStyles(root);
	applyTheme(root, themeMode);

	const drawTimeline = createTimelineRow(true, 1000);
	const morphTimeline = createTimelineRow(false, 0);
	const top = el("div", { cls: "kvp-top" }, drawTimeline.row, morphTimeline.row);
	root.appendChild(top);

	const viewerCanvas = el("canvas", { cls: "kvp-viewer" });
	viewerCanvas.width = 1;
	viewerCanvas.height = 1;

	const overallBtn = el("button", {
		cls: "kvp-btn",
		text: "Show",
		dataset: { overallBtn: "1" },
	});
	const summaryHeader = el("div", { cls: "kvp-summary-header" },
		el("div", { cls: "kvp-title", text: "Overall" }),
		overallBtn,
	);
	const summaryDtw = createMetricRow("Direction");
	const summaryRms = createMetricRow("Shape");
	const summaryPosition = createMetricRow("Placement");
	const summaryRelative = createMetricRow("Angles");
	summaryDtw.row.dataset.metricFocus = "dtw";
	summaryRms.row.dataset.metricFocus = "rms";
	summaryPosition.row.dataset.metricFocus = "position";
	const summaryZone = el("div", { cls: "kvp-flex-col" },
		summaryHeader,
		summaryDtw.row,
		summaryRms.row,
		summaryPosition.row,
	);

	const strokeTitle = el("div", { cls: "kvp-title", text: "Stroke -" });
	const previewCanvas = el("canvas", { cls: "kvp-preview" });
	previewCanvas.width = METRIC_WIDTH;
	previewCanvas.height = 120;
	const currentDtw = createMetricRow("Direction");
	const currentRms = createMetricRow("Shape");
	const currentPosition = createMetricRow("Placement");
	const strokeSection = el("div", { cls: "kvp-layer kvp-layer-visible" },
		el("div", { cls: "kvp-divider" }),
		strokeTitle,
		previewCanvas,
		currentDtw.row,
		currentRms.row,
		currentPosition.row,
	);

	const angleList = el("div", { cls: "kvp-angle-list" });
	const angleSection = el("div", { cls: "kvp-layer kvp-layer-hidden" },
		el("div", { cls: "kvp-divider" }),
		el("div", { cls: "kvp-title", text: "Top Angle Issues" }),
		angleList,
	);

	const lowerSection = el("div", { cls: "kvp-lower" }, strokeSection, angleSection);
	const angleHoverZone = el("div", { cls: "kvp-angle-hover" }, summaryRelative.row, lowerSection);
	const side = el("div", { cls: "kvp-side" }, summaryZone, angleHoverZone);

	const body = el("div", { cls: "kvp-body" }, viewerCanvas, side);
	root.appendChild(body);

	let controller: ValidationPanelController | null = null;
	let data: OverlayValidationData = parseInput(input);
	let drawLoopActive = false;
	let morphLoopActive = false;
	let drawPlaying = false;
	let morphPlaying = false;
	let activeSummaryMetric: MetricFocus | null = null;
	let activeSummaryRow: HTMLDivElement | null = null;
	let activeAngleRow: HTMLDivElement | null = null;
	let angleSectionOpened = false;

	const setOverallButtonState = (active: boolean): void => {
		overallBtn.textContent = active ? "Showing" : "Show";
		overallBtn.style.background = active ? "var(--kvp-btn-active-bg)" : "var(--kvp-btn-bg)";
	};

	const setMetricFocus = (focus: MetricFocus | null): void => {
		controller?.setMetricFocus(focus);
	};

	const clearSummaryFocus = (): void => {
		if (activeSummaryRow) { setRowHoverStyle(activeSummaryRow, false); activeSummaryRow = null; }
		activeSummaryMetric = null;
		setMetricFocus(null);
	};
	const clearAngleFocus = (): void => {
		if (activeAngleRow) { setRowHoverStyle(activeAngleRow, false); activeAngleRow = null; }
		controller?.setAngleIssueFocus(null);
	};
	const clearAllFocus = (): void => { clearSummaryFocus(); clearAngleFocus(); };

	const updateSummaryMetrics = (): void => {
		const max = data.max_errors;
		const thr = data.thresholds;
		setMetricRow(summaryDtw, max?.dtw, thr?.dtw);
		setMetricRow(summaryRms, max?.rms, thr?.rms);
		setMetricRow(summaryPosition, max?.position, thr?.position);
		setMetricRow(summaryRelative, max?.relative_angle, thr?.relative_angle);
	};

	const openAngleSection = (): void => {
		if (angleSectionOpened) return;
		angleSectionOpened = true;
		strokeSection.className = "kvp-layer kvp-layer-hidden";
		angleSection.className = "kvp-layer kvp-layer-visible";
	};

	const closeAngleSection = (): void => {
		if (!angleSectionOpened) return;
		angleSectionOpened = false;
		angleSection.className = "kvp-layer kvp-layer-hidden";
		strokeSection.className = "kvp-layer kvp-layer-visible";
		controller?.setAngleIssueFocus(null);
		setMetricFocus(null);
	};

	const updateRelativeAngleList = (): void => {
		angleList.innerHTML = "";
		activeAngleRow = null;
		const details = [...(data.composition.angle_details ?? [])];
		details.sort((a, b) => b.weighted_diff - a.weighted_diff);
		const topItems = details.slice(0, 5);

		if (topItems.length === 0) {
			angleList.appendChild(el("div", { cls: "kvp-empty", text: "No angle details" }));
			return;
		}

		const threshold = data.thresholds?.relative_angle;
		for (const item of topItems) {
			const row = createAngleIssueItem(item.weighted_diff, threshold);
			const focus: AngleIssueFocus = {
				strokeIndices: item.stroke_indices,
				pointTypes: item.point_types,
			};
			row.addEventListener("mouseenter", () => {
				if (activeAngleRow && activeAngleRow !== row) setRowHoverStyle(activeAngleRow, false);
				activeAngleRow = row;
				setRowHoverStyle(row, true);
				controller?.setAngleIssueFocus(focus);
			});
			angleList.appendChild(row);
		}
	};

	const updateCurrentStrokeInfo = (strokeIndex: number): void => {
		const strokeCount = controller?.getStrokeCount() ?? 0;
		const expectedStrokeCount = data.reference_raw.strokes.length;
		if (strokeIndex < 0 || strokeCount === 0) {
			strokeTitle.textContent = `Stroke - / ${expectedStrokeCount}`;
			setMetricRow(currentDtw, undefined, data.thresholds?.dtw);
			setMetricRow(currentRms, undefined, data.thresholds?.rms);
			setMetricRow(currentPosition, undefined, data.thresholds?.position);
			drawCurrentStrokePreview(previewCanvas, undefined, undefined, 0, panelBg, borderColor);
			return;
		}

		strokeTitle.textContent = `Stroke ${strokeIndex + 1} / ${expectedStrokeCount}`;
		const dtwValue = data.dtw?.strokes?.[strokeIndex]?.dtw_error;
		const rmsStroke = data.rms?.strokes?.[strokeIndex];
		const rmsValue = rmsStroke?.rms;
		const compStroke = data.composition.stroke_details?.find((s) => s.stroke_idx === strokeIndex);
		const positionValue = compStroke ? Math.max(compStroke.start.distance, compStroke.end.distance) : undefined;

		setMetricRow(currentDtw, dtwValue, data.thresholds?.dtw);
		setMetricRow(currentRms, rmsValue, data.thresholds?.rms);
		setMetricRow(currentPosition, positionValue, data.thresholds?.position);
		const refPts = rmsStroke?.reference_points_normalized
			?? applyAffineToStrokePoints(
				data.reference_raw.strokes[strokeIndex]?.points,
				data.composition.alignment.reference_to_aligned,
			);
		const usrPts = rmsStroke?.user_points_normalized
			?? applyAffineToStrokePoints(
				data.user_raw.strokes[strokeIndex]?.points,
				data.composition.alignment.user_to_aligned,
			);
		drawCurrentStrokePreview(previewCanvas, refPts, usrPts, strokeIndex, panelBg, borderColor);
	};

	const mountData = (payload: string | OverlayValidationData): void => {
		data = parseInput(payload);
		const pw = Math.max(root.clientWidth || DEFAULT_PANEL_WIDTH, 320);
		const ph = Math.max(root.clientHeight || DEFAULT_PANEL_HEIGHT, 260);
		const vw = Math.max(pw - RIGHT_PANEL_WIDTH - 16, 220);
		const vh = Math.max(ph - TOP_ROW_HEIGHT - ROOT_ROW_GAP, 180);
		viewerCanvas.width = vw;
		viewerCanvas.height = vh;
		viewerCanvas.style.height = `${vh}px`;
		controller?.dispose();
		controller = renderValidationPanel(viewerCanvas, data, {
			onDrawProgress: (progress) => {
				drawTimeline.input.value = String(Math.round(progress * 1000));
				drawTimeline.updateMarker();
			},
			onMorphProgress: (progress) => {
				morphTimeline.input.value = String(Math.round(progress * 1000));
				morphTimeline.updateMarker();
			},
			onStrokeIndexChange: (i) => updateCurrentStrokeInfo(i),
			onDrawLoopChange: (active) => { drawLoopActive = active; drawTimeline.setLoopState(active); },
			onMorphLoopChange: (active) => { morphLoopActive = active; morphTimeline.setLoopState(active); },
			onOverallModeChange: (active) => setOverallButtonState(active),
			themeMode,
		});
		const strokeCount = controller.getStrokeCount();
		renderZones(drawTimeline.segments, strokeCount, buildStrokeWarnings(data, strokeCount));
		updateSummaryMetrics();
		updateRelativeAngleList();
		closeAngleSection();
		drawTimeline.setLoopState(false);
		morphTimeline.setLoopState(false);
		drawTimeline.setPlayState(false);
		morphTimeline.setPlayState(false);
		setOverallButtonState(false);
		drawLoopActive = false;
		morphLoopActive = false;
		drawPlaying = false;
		morphPlaying = false;
		controller.setDrawProgress(1);
		drawTimeline.input.value = "1000";
		morphTimeline.input.value = "0";
		drawTimeline.updateMarker();
		morphTimeline.updateMarker();
		updateCurrentStrokeInfo(Math.max(0, strokeCount - 1));

		if (initialMode === "overall") {
			setOverallButtonState(controller.toggleOverallMode());
		} else if (initialMode === "draw") {
			controller.setDrawProgress(0);
			controller.playDraw();
			drawPlaying = true;
			drawTimeline.setPlayState(true);
		} else if (initialMode === "draw_loop") {
			controller.setDrawProgress(0);
			drawTimeline.setLoopState(controller.toggleDrawLoop());
			controller.playDraw();
			drawPlaying = true;
			drawTimeline.setPlayState(true);
		} else if (initialMode === "morph") {
			controller.setMorphProgress(0);
			controller.playMorph();
			morphPlaying = true;
			morphTimeline.setPlayState(true);
		} else if (initialMode === "morph_loop") {
			controller.setMorphProgress(0);
			morphTimeline.setLoopState(controller.toggleMorphLoop());
			controller.playMorph();
			morphPlaying = true;
			morphTimeline.setPlayState(true);
		}
	};

	drawTimeline.playBtn.addEventListener("click", () => {
		if (!controller) return;
		if (drawPlaying) {
			controller.pauseDraw();
			drawPlaying = false;
			drawTimeline.setPlayState(false);
		} else {
			controller.playDraw();
			drawPlaying = true;
			drawTimeline.setPlayState(true);
		}
	});
	drawTimeline.loopBtn.addEventListener("click", () => {
		if (!controller) return;
		if (drawLoopActive) {
			const active = controller.toggleDrawLoop();
			drawTimeline.setLoopState(active);
			if (!active && drawPlaying) {
				controller.pauseDraw();
				drawPlaying = false;
				drawTimeline.setPlayState(false);
			}
		} else {
			drawTimeline.setLoopState(controller.toggleDrawLoop());
			controller.playDraw();
			drawPlaying = true;
			drawTimeline.setPlayState(true);
		}
	});
	drawTimeline.startBtn.addEventListener("click", () => {
		if (!controller) return;
		clearAllFocus();
		if (drawLoopActive) {
			const active = controller.toggleDrawLoop();
			drawTimeline.setLoopState(active);
			drawLoopActive = active;
		}
		controller.pauseDraw();
		drawTimeline.input.value = "0";
		drawTimeline.updateMarker();
		controller.setDrawProgress(0);
		drawPlaying = false;
		drawTimeline.setPlayState(false);
	});
	drawTimeline.endBtn.addEventListener("click", () => {
		if (!controller) return;
		controller.pauseDraw();
		controller.setDrawProgress(1);
		drawPlaying = false;
		drawTimeline.setPlayState(false);
	});
	drawTimeline.input.addEventListener("input", () => {
		if (!controller) return;
		controller.setDrawProgress(Number(drawTimeline.input.value) / 1000);
		drawTimeline.updateMarker();
	});

	morphTimeline.playBtn.addEventListener("click", () => {
		if (!controller) return;
		clearAllFocus();
		if (morphPlaying) {
			controller.pauseMorph();
			morphPlaying = false;
			morphTimeline.setPlayState(false);
		} else {
			controller.playMorph();
			morphPlaying = true;
			morphTimeline.setPlayState(true);
		}
	});
	morphTimeline.loopBtn.addEventListener("click", () => {
		if (!controller) return;
		if (morphLoopActive) {
			const active = controller.toggleMorphLoop();
			morphTimeline.setLoopState(active);
			if (!active && morphPlaying) {
				controller.pauseMorph();
				morphPlaying = false;
				morphTimeline.setPlayState(false);
			}
		} else {
			morphTimeline.setLoopState(controller.toggleMorphLoop());
			controller.playMorph();
			morphPlaying = true;
			morphTimeline.setPlayState(true);
		}
	});
	morphTimeline.startBtn.addEventListener("click", () => {
		if (!controller) return;
		controller.pauseMorph();
		controller.setMorphProgress(0);
		morphPlaying = false;
		morphTimeline.setPlayState(false);
	});
	morphTimeline.endBtn.addEventListener("click", () => {
		if (!controller) return;
		controller.pauseMorph();
		controller.setMorphProgress(1);
		morphPlaying = false;
		morphTimeline.setPlayState(false);
	});
	morphTimeline.input.addEventListener("input", () => {
		if (!controller) return;
		controller.setMorphProgress(Number(morphTimeline.input.value) / 1000);
		morphTimeline.updateMarker();
	});

	overallBtn.addEventListener("click", () => {
		if (!controller) return;
		clearAllFocus();
		setOverallButtonState(controller.toggleOverallMode());
	});

	summaryZone.addEventListener("mousemove", (event) => {
		const target = event.target as HTMLElement | null;
		const metricRow = target?.closest("[data-metric-focus]") as HTMLElement | null;
		if (!metricRow) {
			if (target?.closest("[data-overall-btn='1']")) {
				if (activeSummaryRow) { setRowHoverStyle(activeSummaryRow, false); activeSummaryRow = null; }
				activeSummaryMetric = null;
				setMetricFocus(null);
			}
			return;
		}
		const metric = metricRow.dataset.metricFocus as MetricFocus | undefined;
		if (!metric || metric === activeSummaryMetric) return;
		activeSummaryMetric = metric;
		if (activeSummaryRow) setRowHoverStyle(activeSummaryRow, false);
		activeSummaryRow = metricRow as HTMLDivElement;
		setRowHoverStyle(activeSummaryRow, true);
		setMetricFocus(metric);
	});
	summaryZone.addEventListener("mouseleave", () => {
		activeSummaryMetric = null;
		if (activeSummaryRow) setRowHoverStyle(activeSummaryRow, false);
		activeSummaryRow = null;
		setMetricFocus(null);
	});

	angleList.addEventListener("mouseleave", () => {
		if (activeAngleRow) { setRowHoverStyle(activeAngleRow, false); activeAngleRow = null; }
		controller?.setAngleIssueFocus(null);
	});
	summaryRelative.row.addEventListener("mouseenter", () => {
		setRowHoverStyle(summaryRelative.row, true);
		openAngleSection();
	});
	angleSection.addEventListener("mouseenter", () => openAngleSection());
	angleHoverZone.addEventListener("mouseleave", () => {
		setRowHoverStyle(summaryRelative.row, false);
		closeAngleSection();
	});

	requestAnimationFrame(() => mountData(data));

	return {
		element: root,
		setData: (payload) => mountData(payload),
		play: () => controller?.playDraw(),
		pause: () => {},
		restart: () => { controller?.setDrawProgress(0); controller?.playDraw(); },
		dispose: () => { controller?.dispose(); controller = null; root.remove(); },
	};
}
