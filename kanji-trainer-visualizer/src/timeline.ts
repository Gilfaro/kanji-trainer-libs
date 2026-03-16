import { el } from "./dom";
import { ICON_END, ICON_PAUSE, ICON_PLAY, ICON_START } from "./icons";

const SCRUBBER_THUMB_RADIUS = 8;

export interface TimelineRow {
	row: HTMLDivElement;
	startBtn: HTMLButtonElement;
	playBtn: HTMLButtonElement;
	endBtn: HTMLButtonElement;
	loopBtn: HTMLButtonElement;
	input: HTMLInputElement;
	segments: HTMLDivElement;
	updateMarker: () => void;
	setLoopState: (active: boolean) => void;
	setPlayState: (playing: boolean) => void;
}

export function createTimelineRow(segmented: boolean, initialValue: number): TimelineRow {
	const row = el("div", { cls: "kvp-tl-row" });

	const startBtn = el("button", { cls: "kvp-btn", html: ICON_START });
	const playBtn = el("button", { cls: "kvp-btn", html: ICON_PLAY });
	const endBtn = el("button", { cls: "kvp-btn", html: ICON_END });
	const loopBtn = el("button", { cls: "kvp-btn", text: "Loop" });
	row.append(startBtn, playBtn, endBtn, loopBtn);

	const scrubberWrap = el("div", { cls: "kvp-scrub-wrap" });
	const segments = el("div", {
		cls: "kvp-scrub-segments",
		style: { gap: segmented ? "1px" : "0" },
	});
	const marker = el("div", { cls: "kvp-scrub-marker" });
	const input = el("input", {
		cls: "kvp-scrub-input",
		attrs: { type: "range", min: "0", max: "1000", step: "1" },
	});
	input.value = String(initialValue);
	scrubberWrap.append(segments, marker, input);
	row.appendChild(scrubberWrap);

	const updateMarker = (): void => {
		const value = Number(input.value);
		const ratio = Number.isFinite(value) ? Math.max(0, Math.min(1, value / 1000)) : 0;
		const minX = SCRUBBER_THUMB_RADIUS;
		const maxX = Math.max(scrubberWrap.clientWidth - SCRUBBER_THUMB_RADIUS, minX);
		marker.style.left = `${minX + (maxX - minX) * ratio}px`;
	};

	const setLoopState = (active: boolean): void => {
		loopBtn.style.background = active ? "var(--kvp-btn-active-bg)" : "var(--kvp-btn-bg)";
	};

	const setPlayState = (playing: boolean): void => {
		playBtn.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
		playBtn.style.background = playing ? "var(--kvp-btn-active-bg)" : "var(--kvp-btn-bg)";
	};

	return {
		row,
		startBtn,
		playBtn,
		endBtn,
		loopBtn,
		input,
		segments,
		updateMarker,
		setLoopState,
		setPlayState,
	};
}
