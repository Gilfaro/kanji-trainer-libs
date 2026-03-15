import { animate } from "animejs";
import type { AffineTransform, Kanji, OverlayValidationData, Point, Stroke } from "./types";
import { strokeColor } from "./palette";
import { createMorphPlan, sampleMorphFrame } from "./morph";

const PADDING = 12;
const PANEL_GAP = 16;
const TITLE_HEIGHT = 0;
const REFERENCE_WIDTH = 2.5;
const USER_WIDTH = 2.5;
const STROKE_DURATION_MS = 450;
export type ValidationThemeMode = "light" | "dark";

interface CanvasTheme {
	panelBackground: string;
	panelBorder: string;
	title: string;
	referenceGhost: string;
}

const CANVAS_THEME: Record<ValidationThemeMode, CanvasTheme> = {
	light: {
		panelBackground: "transparent",
		panelBorder: "#d4d4d4",
		title: "#555555",
		referenceGhost: "rgba(120, 120, 120, 0.18)",
	},
	dark: {
		panelBackground: "transparent",
		panelBorder: "#57637d",
		title: "#d1d6e0",
		referenceGhost: "rgba(190, 200, 220, 0.22)",
	},
};

interface Bounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

interface PanelRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface AngleIssueFocus {
	strokeIndices: [number, number];
	pointTypes?: ["Start" | "End", "Start" | "End"];
}

export type MetricFocus = "dtw" | "rms" | "position";

export interface ValidationPanelController {
	playDraw: () => void;
	pauseDraw: () => void;
	toggleDrawLoop: () => boolean;
	setDrawProgress: (progress01: number) => void;
	getDrawProgress: () => number;
	playMorph: () => void;
	pauseMorph: () => void;
	toggleMorphLoop: () => boolean;
	setMorphProgress: (progress01: number) => void;
	getMorphProgress: () => number;
	toggleOverallMode: () => boolean;
	setAngleIssueFocus: (focus: AngleIssueFocus | null) => void;
	setMetricFocus: (focus: MetricFocus | null) => void;
	getStrokeCount: () => number;
	dispose: () => void;
}

export interface ValidationPanelOptions {
	onDrawProgress?: (progress01: number) => void;
	onMorphProgress?: (progress01: number) => void;
	onStrokeIndexChange?: (strokeIndex: number) => void;
	onDrawLoopChange?: (active: boolean) => void;
	onMorphLoopChange?: (active: boolean) => void;
	onOverallModeChange?: (active: boolean) => void;
	themeMode?: ValidationThemeMode;
}

function parseInput(input: string | OverlayValidationData): OverlayValidationData {
	if (typeof input === "string") {
		return JSON.parse(input) as OverlayValidationData;
	}
	return input;
}

function applyAffineToPoint(point: Point, transform: AffineTransform): Point {
	return {
		x: transform.scale_x * point.x + transform.translate_x,
		y: transform.scale_y * point.y + transform.translate_y,
	};
}

function applyAffineToKanji(kanji: Kanji, transform: AffineTransform): Kanji {
	return {
		strokes: kanji.strokes.map((stroke) => ({
			points: stroke.points.map((point) => applyAffineToPoint(point, transform)),
			label_pos: stroke.label_pos ? applyAffineToPoint(stroke.label_pos, transform) : stroke.label_pos,
		})),
	};
}

function computeBounds(kanjiList: Kanji[]): Bounds | null {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	let hasPoint = false;

	for (const kanji of kanjiList) {
		for (const stroke of kanji.strokes) {
			for (const point of stroke.points) {
				hasPoint = true;
				minX = Math.min(minX, point.x);
				minY = Math.min(minY, point.y);
				maxX = Math.max(maxX, point.x);
				maxY = Math.max(maxY, point.y);
			}
		}
	}

	if (!hasPoint) {
		return null;
	}

	return { minX, minY, maxX, maxY };
}

function fitPointToPanel(point: Point, bounds: Bounds, panel: PanelRect): Point {
	const innerWidth = Math.max(panel.width - PADDING * 2, 1);
	const innerHeight = Math.max(panel.height - PADDING * 2 - TITLE_HEIGHT, 1);
	const srcWidth = Math.max(bounds.maxX - bounds.minX, 1e-9);
	const srcHeight = Math.max(bounds.maxY - bounds.minY, 1e-9);
	const scale = Math.min(innerWidth / srcWidth, innerHeight / srcHeight);

	const xOffset = panel.x + PADDING + (innerWidth - srcWidth * scale) / 2;
	const yOffset = panel.y + TITLE_HEIGHT + PADDING + (innerHeight - srcHeight * scale) / 2;

	return {
		x: xOffset + (point.x - bounds.minX) * scale,
		y: yOffset + (point.y - bounds.minY) * scale,
	};
}

function drawPanel(ctx: CanvasRenderingContext2D, panel: PanelRect, theme: CanvasTheme): void {
	ctx.fillStyle = theme.panelBackground;
	ctx.fillRect(panel.x, panel.y, panel.width, panel.height);
	ctx.strokeStyle = theme.panelBorder;
	ctx.lineWidth = 1;
	ctx.strokeRect(panel.x + 0.5, panel.y + 0.5, panel.width - 1, panel.height - 1);
}

function drawPartialStroke(
	ctx: CanvasRenderingContext2D,
	stroke: Stroke,
	progress: number,
	strokeIndex: number,
	lineWidth: number,
): void {
	if (stroke.points.length < 2 || progress <= 0) {
		return;
	}

	ctx.strokeStyle = strokeColor(strokeIndex);
	ctx.lineWidth = lineWidth;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";

	if (progress >= 1) {
		ctx.beginPath();
		ctx.moveTo(stroke.points[0]!.x, stroke.points[0]!.y);
		for (let i = 1; i < stroke.points.length; i += 1) {
			const point = stroke.points[i]!;
			ctx.lineTo(point.x, point.y);
		}
		ctx.stroke();
		return;
	}

	let totalLength = 0;
	for (let i = 1; i < stroke.points.length; i += 1) {
		const a = stroke.points[i - 1]!;
		const b = stroke.points[i]!;
		totalLength += Math.hypot(b.x - a.x, b.y - a.y);
	}
	if (totalLength <= 0) {
		return;
	}

	let targetLength = totalLength * progress;
	ctx.beginPath();
	ctx.moveTo(stroke.points[0]!.x, stroke.points[0]!.y);

	for (let i = 1; i < stroke.points.length; i += 1) {
		const a = stroke.points[i - 1]!;
		const b = stroke.points[i]!;
		const segLength = Math.hypot(b.x - a.x, b.y - a.y);
		if (segLength <= 0) {
			continue;
		}

		if (targetLength >= segLength) {
			ctx.lineTo(b.x, b.y);
			targetLength -= segLength;
			continue;
		}

		const ratio = targetLength / segLength;
		const x = a.x + (b.x - a.x) * ratio;
		const y = a.y + (b.y - a.y) * ratio;
		ctx.lineTo(x, y);
		break;
	}

	ctx.stroke();
}

function drawFullStroke(
	ctx: CanvasRenderingContext2D,
	stroke: Stroke,
	color: string,
	lineWidth: number,
): void {
	if (stroke.points.length < 2) {
		return;
	}
	ctx.strokeStyle = color;
	ctx.lineWidth = lineWidth;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	ctx.beginPath();
	ctx.moveTo(stroke.points[0]!.x, stroke.points[0]!.y);
	for (let i = 1; i < stroke.points.length; i += 1) {
		const point = stroke.points[i]!;
		ctx.lineTo(point.x, point.y);
	}
	ctx.stroke();
}

function pointFromStroke(stroke: Stroke | undefined, pointType: "Start" | "End" | undefined): Point | null {
	if (!stroke || stroke.points.length === 0) {
		return null;
	}
	if (pointType === "End") {
		return stroke.points[stroke.points.length - 1] ?? null;
	}
	return stroke.points[0] ?? null;
}

function drawAngleFocusOnPanels(
	ctx: CanvasRenderingContext2D,
	referenceLeft: Kanji,
	userRight: Kanji,
	focus: AngleIssueFocus,
	animationTimeSec: number,
	showStrokeHighlight: boolean = true,
): void {
	const [a, b] = focus.strokeIndices;
	const refA = pointFromStroke(referenceLeft.strokes[a], focus.pointTypes?.[0]);
	const refB = pointFromStroke(referenceLeft.strokes[b], focus.pointTypes?.[1]);
	const usrA = pointFromStroke(userRight.strokes[a], focus.pointTypes?.[0]);
	const usrB = pointFromStroke(userRight.strokes[b], focus.pointTypes?.[1]);
	if (!refA || !refB || !usrA || !usrB) {
		return;
	}

	if (showStrokeHighlight) {
		const glowPulse = 0.5 + 0.5 * Math.sin(animationTimeSec * 7.0);
		const glowWidth = 6.2 + glowPulse * 2.8;
		const glowBlur = 24 + glowPulse * 20;

		ctx.save();
		ctx.globalCompositeOperation = "source-over";
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		ctx.globalAlpha = 0.52;
		for (const index of [a, b]) {
			const c = strokeColor(index);
			ctx.shadowBlur = glowBlur;
			ctx.shadowColor = c;
			ctx.strokeStyle = c;
			const refStroke = referenceLeft.strokes[index];
			const usrStroke = userRight.strokes[index];
			if (refStroke) {
				drawFullStroke(ctx, refStroke, c, glowWidth);
			}
			if (usrStroke) {
				drawFullStroke(ctx, usrStroke, c, glowWidth);
			}
		}
		ctx.restore();

		for (const index of [a, b]) {
			const c = strokeColor(index);
			const refStroke = referenceLeft.strokes[index];
			const usrStroke = userRight.strokes[index];
			if (refStroke) {
				drawFullStroke(ctx, refStroke, c, REFERENCE_WIDTH);
			}
			if (usrStroke) {
				drawFullStroke(ctx, usrStroke, c, USER_WIDTH);
			}
		}
	}

	const t = animationTimeSec;
	const growDuration = 0.62;
	const holdDuration = 0.24;
	const cycleDuration = growDuration + holdDuration;
	const cycleTime = Math.max(0, Math.min(t, cycleDuration));
	const grow = cycleTime < growDuration ? (cycleTime / growDuration) : 1;

	const drawArrow = (
		from: Point,
		to: Point,
		color: string,
		alpha: number,
		grow: number,
	): void => {
		const dx = to.x - from.x;
		const dy = to.y - from.y;
		const len = Math.hypot(dx, dy);
		if (len < 1e-6) {
			return;
		}
		const ux = dx / len;
		const uy = dy / len;
		const clampedGrow = Math.max(0.04, Math.min(1, grow));
		const ex = from.x + dx * clampedGrow;
		const ey = from.y + dy * clampedGrow;
		const segLen = Math.hypot(ex - from.x, ey - from.y);
		const head = Math.min(10, Math.max(6, segLen * 0.2));
		const half = head * 0.45;
		const bx = ex - ux * head;
		const by = ey - uy * head;
		const px = -uy;
		const py = ux;

		ctx.lineWidth = 2.4;
		ctx.lineCap = "round";
		ctx.strokeStyle = color;
		ctx.beginPath();
		ctx.moveTo(from.x, from.y);
		ctx.lineTo(ex, ey);
		ctx.stroke();

		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.moveTo(ex, ey);
		ctx.lineTo(bx + px * half, by + py * half);
		ctx.lineTo(bx - px * half, by - py * half);
		ctx.closePath();
		ctx.fill();
	};

	const alpha = 0.58;
	drawArrow(usrA, usrB, `rgba(210, 35, 35, ${alpha})`, alpha, grow);
	drawArrow(refA, refB, `rgba(35, 165, 70, ${alpha})`, alpha, grow);
}

function drawMetricFocusOverlay(
	ctx: CanvasRenderingContext2D,
	reference: Kanji,
	user: Kanji,
	_focus: MetricFocus,
	badIndices: Set<number>,
): void {
	if (badIndices.size === 0) {
		return;
	}

	const t = performance.now() / 1000;
	const pulse = 0.5 + 0.5 * Math.sin(t * 7.0);
	const width = 6.2 + pulse * 3.0;
	const blur = 26 + pulse * 22;

	ctx.save();
	ctx.globalCompositeOperation = "source-over";
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	ctx.globalAlpha = 0.56;
	ctx.lineWidth = width;

	for (const index of badIndices) {
		const glowColor = strokeColor(index);
		ctx.shadowBlur = blur;
		ctx.shadowColor = glowColor;
		ctx.strokeStyle = glowColor;
		const refStroke = reference.strokes[index];
		const userStroke = user.strokes[index];
		if (refStroke) {
			drawFullStroke(ctx, refStroke, glowColor, width);
		}
		if (userStroke) {
			drawFullStroke(ctx, userStroke, glowColor, width);
		}
	}
	ctx.restore();

	ctx.save();
	ctx.globalCompositeOperation = "source-over";
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	ctx.globalAlpha = 1;
	for (const index of badIndices) {
		const refStroke = reference.strokes[index];
		const userStroke = user.strokes[index];
		if (refStroke) {
			drawFullStroke(ctx, refStroke, strokeColor(index), REFERENCE_WIDTH);
		}
		if (userStroke) {
			drawFullStroke(ctx, userStroke, strokeColor(index), USER_WIDTH);
		}
	}
	ctx.restore();
}

function drawStrokeGlowOverlay(
	ctx: CanvasRenderingContext2D,
	reference: Kanji,
	user: Kanji,
	badIndices: Set<number>,
): void {
	if (badIndices.size === 0) {
		return;
	}

	const t = performance.now() / 1000;
	const pulse = 0.5 + 0.5 * Math.sin(t * 7.0);
	const width = 6.2 + pulse * 3.0;
	const blur = 26 + pulse * 22;

	ctx.save();
	ctx.globalCompositeOperation = "source-over";
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	ctx.globalAlpha = 0.56;
	ctx.lineWidth = width;

	for (const index of badIndices) {
		const glowColor = strokeColor(index);
		ctx.shadowBlur = blur;
		ctx.shadowColor = glowColor;
		ctx.strokeStyle = glowColor;
		const refStroke = reference.strokes[index];
		const userStroke = user.strokes[index];
		if (refStroke) {
			drawFullStroke(ctx, refStroke, glowColor, width);
		}
		if (userStroke) {
			drawFullStroke(ctx, userStroke, glowColor, width);
		}
	}
	ctx.restore();

	ctx.save();
	ctx.globalCompositeOperation = "source-over";
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	ctx.globalAlpha = 1;
	for (const index of badIndices) {
		const c = strokeColor(index);
		const refStroke = reference.strokes[index];
		const userStroke = user.strokes[index];
		if (refStroke) {
			drawFullStroke(ctx, refStroke, c, REFERENCE_WIDTH);
		}
		if (userStroke) {
			drawFullStroke(ctx, userStroke, c, USER_WIDTH);
		}
	}
	ctx.restore();
}

function normalizeKanjiToCanvas(
	kanji: Kanji,
	allBounds: Bounds,
	panel: PanelRect,
): Kanji {
	return {
		strokes: kanji.strokes.map((stroke) => ({
			points: stroke.points.map((point) => fitPointToPanel(point, allBounds, panel)),
			label_pos: stroke.label_pos
				? fitPointToPanel(stroke.label_pos, allBounds, panel)
				: stroke.label_pos,
		})),
	};
}

function drawAnimationFrame(
	ctx: CanvasRenderingContext2D,
	canvas: HTMLCanvasElement,
	reference: Kanji,
	user: Kanji,
	progressByStroke: number[],
	angleFocus: AngleIssueFocus | null,
	metricFocus: MetricFocus | null,
	metricBadByType: Record<MetricFocus, Set<number>>,
	endSummaryActive: boolean,
	angleIssuesForSummary: AngleIssueFocus[],
	theme: CanvasTheme,
): void {
	const leftPanel: PanelRect = {
		x: 0,
		y: 0,
		width: (canvas.width - PANEL_GAP) / 2,
		height: canvas.height,
	};
	const rightPanel: PanelRect = {
		x: leftPanel.width + PANEL_GAP,
		y: 0,
		width: (canvas.width - PANEL_GAP) / 2,
		height: canvas.height,
	};

	ctx.clearRect(0, 0, canvas.width, canvas.height);
	drawPanel(ctx, leftPanel, theme);
	drawPanel(ctx, rightPanel, theme);

	const useFullKanjiContext = angleFocus !== null || metricFocus !== null;
	for (let i = 0; i < progressByStroke.length; i += 1) {
		const progress = useFullKanjiContext ? 1 : (progressByStroke[i] ?? 0);
		const referenceStroke = reference.strokes[i];
		const userStroke = user.strokes[i];
		if (referenceStroke) {
			drawPartialStroke(ctx, referenceStroke, progress, i, REFERENCE_WIDTH);
		}
		if (userStroke) {
			drawPartialStroke(ctx, userStroke, progress, i, USER_WIDTH);
		}
	}

	if (angleFocus) {
		const issueDurationSec = 1.05;
		const t = performance.now() / 1000;
		const localIssueTimeSec = t % issueDurationSec;
		drawAngleFocusOnPanels(ctx, reference, user, angleFocus, localIssueTimeSec);
		return;
	}

	if (metricFocus) {
		drawMetricFocusOverlay(ctx, reference, user, metricFocus, metricBadByType[metricFocus]);
		return;
	}

	if (endSummaryActive) {
		const combinedBad = new Set<number>([
			...metricBadByType.dtw,
			...metricBadByType.rms,
			...metricBadByType.position,
		]);
		drawStrokeGlowOverlay(ctx, reference, user, combinedBad);
		if (angleIssuesForSummary.length > 0) {
			const issueDurationSec = 1.05;
			const t = performance.now() / 1000;
			const issueIndex = Math.floor(t / issueDurationSec) % angleIssuesForSummary.length;
			const localIssueTimeSec = t % issueDurationSec;
			drawAngleFocusOnPanels(
				ctx,
				reference,
				user,
				angleIssuesForSummary[issueIndex]!,
				localIssueTimeSec,
				false,
			);
		}
	}
}

export function renderValidationPanel(
	canvas: HTMLCanvasElement,
	input: string | OverlayValidationData,
	options?: ValidationPanelOptions,
): ValidationPanelController {
	const result = parseInput(input);
	const theme = CANVAS_THEME[options?.themeMode ?? "light"];
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return {
			playDraw: () => {},
			pauseDraw: () => {},
			toggleDrawLoop: () => false,
			setDrawProgress: () => {},
			getDrawProgress: () => 0,
			playMorph: () => {},
			pauseMorph: () => {},
			toggleMorphLoop: () => false,
			setMorphProgress: () => {},
			getMorphProgress: () => 0,
			toggleOverallMode: () => false,
			setAngleIssueFocus: () => {},
			setMetricFocus: () => {},
			getStrokeCount: () => 0,
			dispose: () => {},
		};
	}

	const referenceAligned = applyAffineToKanji(
		result.reference_raw,
		result.composition.alignment.reference_to_aligned,
	);
	const userAligned = applyAffineToKanji(result.user_raw, result.composition.alignment.user_to_aligned);

	const bounds = computeBounds([referenceAligned, userAligned]);
	if (!bounds) {
		return {
			playDraw: () => {},
			pauseDraw: () => {},
			toggleDrawLoop: () => false,
			setDrawProgress: () => {},
			getDrawProgress: () => 0,
			playMorph: () => {},
			pauseMorph: () => {},
			toggleMorphLoop: () => false,
			setMorphProgress: () => {},
			getMorphProgress: () => 0,
			toggleOverallMode: () => false,
			setAngleIssueFocus: () => {},
			setMetricFocus: () => {},
			getStrokeCount: () => 0,
			dispose: () => {},
		};
	}

	const leftPanel: PanelRect = {
		x: 0,
		y: 0,
		width: (canvas.width - PANEL_GAP) / 2,
		height: canvas.height,
	};
	const rightPanel: PanelRect = {
		x: leftPanel.width + PANEL_GAP,
		y: 0,
		width: (canvas.width - PANEL_GAP) / 2,
		height: canvas.height,
	};
	const referenceFitted = normalizeKanjiToCanvas(referenceAligned, bounds, leftPanel);
	const referenceFittedRight = normalizeKanjiToCanvas(referenceAligned, bounds, rightPanel);
	const userFitted = normalizeKanjiToCanvas(userAligned, bounds, rightPanel);
	const morphPlan = createMorphPlan(referenceFittedRight, userFitted);
	const strokeCount = Math.max(referenceFitted.strokes.length, userFitted.strokes.length);
	const progressByStroke = Array.from({ length: strokeCount }, () => 0);
	const totalDuration = Math.max(strokeCount, 1) * STROKE_DURATION_MS;
	let angleFocus: AngleIssueFocus | null = null;
	let metricFocus: MetricFocus | null = null;
	const metricBadByType: Record<MetricFocus, Set<number>> = {
		dtw: new Set<number>(),
		rms: new Set<number>(),
		position: new Set<number>(),
	};
	const dtwThreshold = result.thresholds?.dtw;
	const rmsThreshold = result.thresholds?.rms;
	const positionThreshold = result.thresholds?.position;
	for (let i = 0; i < strokeCount; i += 1) {
		const dtw = result.dtw?.strokes?.[i]?.dtw_error;
		const rms = result.rms?.strokes?.[i]?.rms;
		const posDetail = result.composition.stroke_details?.find((s) => s.stroke_idx === i);
		const pos = posDetail ? Math.max(posDetail.start.distance, posDetail.end.distance) : undefined;
		if (dtwThreshold !== undefined && dtw !== undefined && dtw > dtwThreshold) {
			metricBadByType.dtw.add(i);
		}
		if (rmsThreshold !== undefined && rms !== undefined && rms > rmsThreshold) {
			metricBadByType.rms.add(i);
		}
		if (positionThreshold !== undefined && pos !== undefined && pos > positionThreshold) {
			metricBadByType.position.add(i);
		}
	}
	const relativeAngleThreshold = result.thresholds?.relative_angle;
	const angleIssuesForSummary: AngleIssueFocus[] = [];
	for (const item of result.composition.angle_details ?? []) {
		const isBad = relativeAngleThreshold !== undefined
			? item.weighted_diff > relativeAngleThreshold
			: item.weighted_diff > 0;
		if (!isBad) {
			continue;
		}
		angleIssuesForSummary.push({
			strokeIndices: item.stroke_indices,
			pointTypes: item.point_types,
		});
	}

	drawAnimationFrame(
		ctx,
		canvas,
		referenceFitted,
		userFitted,
		progressByStroke,
		angleFocus,
		metricFocus,
		metricBadByType,
		false,
		angleIssuesForSummary,
		theme,
	);

	const state = { phase: 0 };
	const morphState = { phase: 0 };
	let activeMode: "draw" | "morph" = "draw";
	let overallMode = false;
	const setOverallMode = (active: boolean): void => {
		if (overallMode === active) {
			return;
		}
		overallMode = active;
		options?.onOverallModeChange?.(active);
	};
	const isEndSummaryActive = (): boolean => {
		if (!overallMode) {
			return false;
		}
		if (angleFocus || metricFocus) {
			return false;
		}
		return true;
	};

	let focusAnimation: any = null;
	const stopFocusAnimation = (): void => {
		if (focusAnimation !== null) {
			focusAnimation.pause();
			focusAnimation = null;
		}
	};
	const runFocusAnimation = (): void => {
		if (!angleFocus && !metricFocus && !isEndSummaryActive()) {
			stopFocusAnimation();
			return;
		}
		renderFromPhase();
	};
	const ensureFocusAnimation = (): void => {
		if (!angleFocus && !metricFocus && !isEndSummaryActive()) {
			stopFocusAnimation();
			return;
		}
		if (focusAnimation === null) {
			focusAnimation = animate(canvas, {
				duration: 1000,
				loop: true,
				update: runFocusAnimation,
			});
		}
	};
	const renderFromPhase = (): void => {
		for (let i = 0; i < strokeCount; i += 1) {
			const p = state.phase - i;
			progressByStroke[i] = Math.max(0, Math.min(1, p));
		}
		const activeStrokeIndex = strokeCount > 0
			? Math.min(strokeCount - 1, Math.max(0, Math.floor(state.phase)))
			: -1;
		drawAnimationFrame(
			ctx,
			canvas,
			referenceFitted,
			userFitted,
			progressByStroke,
			angleFocus,
			metricFocus,
			metricBadByType,
			isEndSummaryActive(),
			angleIssuesForSummary,
			theme,
		);
		const progress = strokeCount > 0 ? Math.max(0, Math.min(1, state.phase / strokeCount)) : 0;
		options?.onDrawProgress?.(progress);
		options?.onStrokeIndexChange?.(activeStrokeIndex);
	};
	const renderFocusedDrawView = (): void => {
		const fullProgress = Array.from({ length: strokeCount }, () => 1);
		drawAnimationFrame(
			ctx,
			canvas,
			referenceFitted,
			userFitted,
			fullProgress,
			angleFocus,
			metricFocus,
			metricBadByType,
			false,
			angleIssuesForSummary,
			theme,
		);
	};
	const morphCycleDurationMs = morphPlan.totalDurationMs;

	const drawMorphFrameAtCycle = (cycle: number): void => {
		const frame = sampleMorphFrame(morphPlan, cycle);

		const leftPanelMorph: PanelRect = {
			x: 0,
			y: 0,
			width: (canvas.width - PANEL_GAP) / 2,
			height: canvas.height,
		};
		const rightPanelMorph: PanelRect = {
			x: leftPanelMorph.width + PANEL_GAP,
			y: 0,
			width: (canvas.width - PANEL_GAP) / 2,
			height: canvas.height,
		};

		ctx.clearRect(0, 0, canvas.width, canvas.height);
		drawPanel(ctx, leftPanelMorph, theme);
		drawPanel(ctx, rightPanelMorph, theme);

		for (let i = 0; i < referenceFitted.strokes.length; i += 1) {
			const refStroke = referenceFitted.strokes[i];
			if (refStroke) {
				drawFullStroke(ctx, refStroke, strokeColor(i), REFERENCE_WIDTH);
			}
		}

		for (const s of frame.strokes) {
			if (s.alpha <= 0) {
				continue;
			}
			ctx.save();
			ctx.globalAlpha = s.alpha;
			drawFullStroke(ctx, s.stroke, strokeColor(s.strokeIndex), USER_WIDTH);
			ctx.restore();
		}

		if (angleFocus || metricFocus) {
			renderFocusedDrawView();
		}
	};

	let drawLoopEnabled = false;
	const setDrawLoopEnabled = (active: boolean): void => {
		if (drawLoopEnabled === active) {
			return;
		}
		drawLoopEnabled = active;
		options?.onDrawLoopChange?.(active);
	};

	let morphLoopEnabled = false;
	const setMorphLoopEnabled = (active: boolean): void => {
		if (morphLoopEnabled === active) {
			return;
		}
		morphLoopEnabled = active;
		options?.onMorphLoopChange?.(active);
	};

	const renderMorphProgress = (): void => {
		const clamped = Math.max(0, Math.min(1, morphState.phase));
		const cycle = clamped * morphCycleDurationMs;
		drawMorphFrameAtCycle(cycle);
		options?.onMorphProgress?.(clamped);
	};

	let drawAnim: any = null;
	let morphAnim: any = null;

	const stopMorphPlayback = (): void => {
		if (morphAnim) {
			morphAnim.pause();
		}
	};
	const stopDrawLoopPlayback = (): void => {
		if (drawAnim) {
			drawAnim.pause();
		}
	};

	const deactivateMorphMode = (): void => {
		stopMorphPlayback();
		setMorphLoopEnabled(false);
		activeMode = "draw";
	};

	const activateMorphMode = (): void => {
		stopDrawLoopPlayback();
		setDrawLoopEnabled(false);
		setOverallMode(false);
		stopFocusAnimation();
		angleFocus = null;
		metricFocus = null;
		activeMode = "morph";
	};

	const startDrawPlayback = () => {
		stopDrawLoopPlayback();

		drawAnim = animate(state, {
			phase: strokeCount,
			duration: totalDuration * (1 - state.phase / Math.max(1, strokeCount)),
			ease: "linear",
			loop: drawLoopEnabled ? true : false,
			playbackRate: 1,
			update: () => {
				if (activeMode === "draw") {
					renderFromPhase();
				}
			},
			complete: () => {
				if (activeMode === "draw") {
					renderFromPhase();
					ensureFocusAnimation();
				}
			}
		});
	};

	const startMorphPlayback = () => {
		stopMorphPlayback();

		morphAnim = animate(morphState, {
			phase: [morphState.phase, 1],
			duration: morphCycleDurationMs * (1 - morphState.phase),
			ease: "linear",
			alternate: morphLoopEnabled,
			loop: morphLoopEnabled ? true : false,
			update: () => {
				renderMorphProgress();
			}
		});
	};

	renderFromPhase();

	return {
		playDraw: () => {
			deactivateMorphMode();
			setOverallMode(false);
			if (state.phase >= strokeCount) state.phase = 0;
			startDrawPlayback();
		},
		pauseDraw: () => {
			stopDrawLoopPlayback();
		},
		toggleDrawLoop: () => {
			setDrawLoopEnabled(!drawLoopEnabled);
			if (drawAnim) {
				const isPlaying = !drawAnim.paused;
				startDrawPlayback();
				if (!isPlaying) drawAnim.pause();
			}
			return drawLoopEnabled;
		},
		setDrawProgress: (progress01: number) => {
			deactivateMorphMode();
			setOverallMode(false);
			stopDrawLoopPlayback();
			const clamped = Math.max(0, Math.min(1, progress01));
			state.phase = clamped * strokeCount;
			renderFromPhase();
			ensureFocusAnimation();
		},
		getDrawProgress: () => {
			return strokeCount > 0 ? Math.max(0, Math.min(1, state.phase / strokeCount)) : 0;
		},
		playMorph: () => {
			activateMorphMode();
			angleFocus = null;
			metricFocus = null;
			if (morphState.phase >= 1 && !morphLoopEnabled) morphState.phase = 0;
			startMorphPlayback();
		},
		pauseMorph: () => {
			stopMorphPlayback();
		},
		toggleMorphLoop: () => {
			const next = !morphLoopEnabled;
			setMorphLoopEnabled(next);
			if (morphAnim) {
				const isPlaying = !morphAnim.paused;
				startMorphPlayback();
				if (!isPlaying) morphAnim.pause();
			} else if (activeMode === "morph") {
				renderMorphProgress();
			}
			return morphLoopEnabled;
		},
		setMorphProgress: (progress01: number) => {
			activateMorphMode();
			stopMorphPlayback();
			morphState.phase = Math.max(0, Math.min(1, progress01));
			renderMorphProgress();
		},
		getMorphProgress: () => morphState.phase,
		toggleOverallMode: () => {
			if (activeMode === "morph") {
				deactivateMorphMode();
			}
			setOverallMode(!overallMode);
			if (activeMode === "draw") {
				renderFromPhase();
				ensureFocusAnimation();
			}
			return overallMode;
		},
		setAngleIssueFocus: (focus: AngleIssueFocus | null) => {
			angleFocus = focus;
			if (focus) {
				metricFocus = null;
			}
			if (activeMode === "morph") {
				renderMorphProgress();
			} else {
				renderFromPhase();
				ensureFocusAnimation();
			}
		},
		setMetricFocus: (focus: MetricFocus | null) => {
			metricFocus = focus;
			if (focus) {
				angleFocus = null;
			}
			if (activeMode === "morph") {
				renderMorphProgress();
			} else {
				renderFromPhase();
				ensureFocusAnimation();
			}
		},
		getStrokeCount: () => strokeCount,
		dispose: () => {
			stopMorphPlayback();
			stopDrawLoopPlayback();
			stopFocusAnimation();
		},
	};
}
