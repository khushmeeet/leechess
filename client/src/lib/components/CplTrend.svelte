<script lang="ts">
	import type { GameCplPoint } from '$lib/api/client';

	interface Props {
		trend: GameCplPoint[];
		onselect?: (gameId: number) => void;
	}

	let { trend, onselect }: Props = $props();

	// Phase hues live in layout.css so dark mode is defined in one place; they
	// were picked by running the data-viz validator against both card surfaces
	// (see the comment on --color-series-* there). "Overall" is ink, not a
	// category color — it's the aggregate the phases decompose.
	const series = [
		{ key: 'avg_cpl', label: 'Overall', color: 'var(--color-ink)', width: 2.5 },
		{ key: 'opening_cpl', label: 'Opening', color: 'var(--color-series-opening)', width: 2 },
		{
			key: 'middlegame_cpl',
			label: 'Middlegame',
			color: 'var(--color-series-middlegame)',
			width: 2
		},
		{ key: 'endgame_cpl', label: 'Endgame', color: 'var(--color-series-endgame)', width: 2 }
	] as const;
	type SeriesKey = (typeof series)[number]['key'];

	// The chart is measured, not scaled: the SVG renders at 1 unit = 1 CSS pixel
	// so text, strokes and markers keep their true size at any width, and the
	// horizontal room per game grows with the container instead of staying
	// pinned to a fixed viewBox. /progress returns every analyzed game with no
	// cap, so that room is the whole ballgame.
	let boxWidth = $state(0);
	const W = $derived(boxWidth || 640); // fallback keeps the SVG non-empty pre-measure
	const H = $derived(W < 520 ? 220 : 280);
	const PAD = { top: 12, right: 16, bottom: 28, left: 42 };

	const plotW = $derived(Math.max(1, W - PAD.left - PAD.right));
	const plotH = $derived(Math.max(1, H - PAD.top - PAD.bottom));

	/** Pixels between adjacent games — the density signal the marks react to. */
	const spacing = $derived(trend.length <= 1 ? plotW : plotW / (trend.length - 1));
	const dense = $derived(spacing < 14);

	const x = $derived((i: number) =>
		trend.length <= 1 ? PAD.left + plotW / 2 : PAD.left + i * spacing
	);

	/** Rounded axis steps, 4-ish of them, so one 480-CPL disaster doesn't
	 * collapse every other game onto the baseline with nothing to read against. */
	function niceTicks(max: number, target = 4): number[] {
		const mag = 10 ** Math.floor(Math.log10(max / target));
		const norm = max / target / mag;
		const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
		const ticks: number[] = [];
		for (let v = 0; v <= Math.ceil(max / step) * step + 1e-9; v += step) ticks.push(v);
		return ticks;
	}

	// Lower CPL is better, so the axis runs 0 (bottom) → a rounded-up max.
	const ticks = $derived.by(() => {
		let max = 50;
		for (const point of trend) {
			for (const { key } of series) {
				const value = point[key];
				if (value !== null) max = Math.max(max, value);
			}
		}
		return niceTicks(max);
	});
	const yMax = $derived(ticks[ticks.length - 1]);

	const y = $derived((cpl: number) => PAD.top + plotH - (cpl / yMax) * plotH);

	/** Series with at least one value — short games never reach the endgame,
	 * and an all-empty series earns no legend entry. */
	const activeSeries = $derived(series.filter((s) => trend.some((point) => point[s.key] !== null)));

	// Clicking a legend entry isolates that phase; the others stay put and keep
	// their hue, just dimmed. Emphasis, never a recolor and never a data filter —
	// the tooltip still reads out every series.
	let focused = $state<SeriesKey | null>(null);
	const focus = $derived(
		focused !== null && activeSeries.some((s) => s.key === focused) ? focused : null
	);
	const dimmed = $derived((key: SeriesKey) => focus !== null && focus !== key);
	const strokeWidth = $derived((s: (typeof series)[number]) => (dense ? s.width - 0.5 : s.width));

	/** Focused series paints last so it sits above the others; otherwise Overall
	 * does, being the line the screen is about. (Array.sort is stable, so ties
	 * keep the fixed series order.) */
	const drawOrder = $derived.by(() => {
		const rank = (key: SeriesKey) =>
			key === focus ? 2 : focus === null && key === 'avg_cpl' ? 1 : 0;
		return [...activeSeries].sort((a, b) => rank(a.key) - rank(b.key));
	});

	/** SVG path with pen-up breaks where a phase value is null. */
	const path = $derived((key: SeriesKey): string => {
		let d = '';
		let pen = false;
		trend.forEach((point, i) => {
			const value = point[key];
			if (value === null) {
				pen = false;
				return;
			}
			d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(value).toFixed(1)}`;
			pen = true;
		});
		return d;
	});

	/** Points a path can't show: no neighbor on either side. */
	const lonePoints = $derived((key: SeriesKey) =>
		trend
			.map((point, i) => ({ value: point[key], i }))
			.filter(
				({ value, i }) =>
					value !== null &&
					(trend[i - 1]?.[key] ?? null) === null &&
					(trend[i + 1]?.[key] ?? null) === null
			)
	);

	let hovered = $state<number | null>(null);
	const hoveredPoint = $derived(hovered !== null ? trend[hovered] : null);

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}

	/** A handful of dates across the run, deduped — a few hundred games can all
	 * land on the same day, and repeating "Jul 12" five times says nothing. */
	const dateTicks = $derived.by(() => {
		if (trend.length === 0) return [];
		const count = Math.max(2, Math.min(6, Math.floor(plotW / 110)));
		const out: { i: number; label: string; anchor: string }[] = [];
		for (let k = 0; k < count; k++) {
			const i = Math.round((k / (count - 1)) * (trend.length - 1));
			const label = formatDate(trend[i].created_at);
			if (out.some((tick) => tick.label === label)) continue;
			out.push({
				i,
				label,
				anchor: i === 0 ? 'start' : i === trend.length - 1 ? 'end' : 'middle'
			});
		}
		return out;
	});

	/** Nearest-point lookup: the pointer only has to be closest, not land on a
	 * mark. At a few hundred games a per-point hit target is a sub-pixel sliver.
	 * The layer covers the whole card, axis gutters included, so there's no rim
	 * of dead pixels where the newest game is hardest to reach. */
	function nearest(event: PointerEvent): number {
		const box = (event.currentTarget as SVGRectElement).getBoundingClientRect();
		if (box.width <= 0 || trend.length <= 1) return 0;
		const px = (event.clientX - box.left) / (box.width / W) - PAD.left;
		return Math.min(trend.length - 1, Math.max(0, Math.round((px / plotW) * (trend.length - 1))));
	}

	function step(delta: number) {
		const from = hovered ?? (delta > 0 ? -1 : trend.length);
		hovered = Math.min(trend.length - 1, Math.max(0, from + delta));
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowRight') step(1);
		else if (event.key === 'ArrowLeft') step(-1);
		else if (event.key === 'Enter' && hoveredPoint) onselect?.(hoveredPoint.game_id);
		else if (event.key === 'Escape') hovered = null;
		else return;
		event.preventDefault();
	}

	const TIP_W = 172;
	const tipLeft = $derived(
		hovered === null ? 0 : Math.min(Math.max(x(hovered) - TIP_W / 2, 0), Math.max(0, W - TIP_W))
	);
</script>

{#if trend.length === 0}
	<p class="text-sm text-muted">No analyzed games yet — finish a game and its CPL lands here.</p>
{:else}
	<div class="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs">
		{#each activeSeries as s (s.key)}
			<button
				type="button"
				onclick={() => (focused = focus === s.key ? null : s.key)}
				aria-pressed={focus === s.key}
				title={focus === s.key ? 'Show all phases' : `Show only ${s.label}`}
				class="inline-flex items-center gap-1.5 rounded-xs px-1.5 py-0.5 hover:bg-paper {dimmed(
					s.key
				)
					? 'text-faint'
					: 'text-muted'} {focus === s.key ? 'font-semibold text-ink' : ''}"
			>
				<span
					class="h-0.5 w-4 rounded-full"
					style="background:{s.color}; opacity:{dimmed(s.key) ? 0.35 : 1}"
				></span>
				{s.label}
			</button>
		{/each}
		{#if focus !== null}
			<span class="ml-1 text-faint">— showing one phase; click it again for all</span>
		{/if}
	</div>

	<div class="relative mt-2" bind:clientWidth={boxWidth}>
		<svg
			width={W}
			height={H}
			viewBox="0 0 {W} {H}"
			class="block max-w-full rounded-xs border border-line bg-card"
			role="img"
			aria-label="Average centipawn loss per game over time, split by game phase"
			data-testid="cpl-trend"
			onmouseleave={() => (hovered = null)}
		>
			{#each ticks as value (value)}
				<line
					x1={PAD.left}
					y1={y(value)}
					x2={W - PAD.right}
					y2={y(value)}
					stroke="var(--color-line)"
					stroke-width="1"
				/>
				<text
					x={PAD.left - 8}
					y={y(value) + 3}
					text-anchor="end"
					class="fill-faint tabular-nums"
					font-size="10">{value}</text
				>
			{/each}

			{#if hovered !== null}
				<line
					x1={x(hovered)}
					y1={PAD.top}
					x2={x(hovered)}
					y2={PAD.top + plotH}
					stroke="var(--color-highlight)"
					stroke-width="1.5"
				/>
			{/if}

			{#each drawOrder as s (s.key)}
				<path
					d={path(s.key)}
					fill="none"
					stroke={s.color}
					stroke-width={strokeWidth(s)}
					stroke-linejoin="round"
					stroke-linecap="round"
					opacity={dimmed(s.key) ? 0.12 : 1}
				/>
				{#each lonePoints(s.key) as { value, i } (i)}
					<circle
						cx={x(i)}
						cy={y(value!)}
						r={dense ? 2.5 : 3}
						fill={s.color}
						stroke="var(--color-card)"
						stroke-width="2"
						opacity={dimmed(s.key) ? 0.12 : 1}
					/>
				{/each}
			{/each}

			<!-- Per-game markers on the overall line. Dropped once games are packed
			     closer than a marker is wide, or they merge into a solid band and
			     bury the line they're meant to annotate; the hovered one always
			     draws, so hover still has something to answer with. -->
			{#each trend as point, i (point.game_id)}
				{#if hovered === i || (!dense && !dimmed('avg_cpl'))}
					<circle
						cx={x(i)}
						cy={y(point.avg_cpl)}
						r={hovered === i ? 4.5 : 3}
						fill="var(--color-ink)"
						stroke="var(--color-card)"
						stroke-width="2"
						opacity={dimmed('avg_cpl') && hovered !== i ? 0.12 : 1}
					/>
				{/if}
			{/each}

			{#each dateTicks as tick (tick.i)}
				<text
					x={x(tick.i)}
					y={H - 8}
					text-anchor={tick.anchor}
					font-size="10"
					class="fill-faint tabular-nums">{tick.label}</text
				>
			{/each}

			<!-- One nearest-point layer instead of a hit rect per game, and
			     keyboard-reachable so focus reads out what hover does. -->
			<rect
				x="0"
				y="0"
				width={W}
				height={H}
				fill="transparent"
				class={onselect ? 'cursor-pointer focus:outline-none' : 'focus:outline-none'}
				role="button"
				tabindex="0"
				aria-label={hoveredPoint
					? `Game ${hoveredPoint.number}, ${hoveredPoint.avg_cpl.toFixed(0)} average centipawn loss`
					: 'Browse games with the arrow keys'}
				onpointermove={(e) => (hovered = nearest(e))}
				onfocus={() => (hovered ??= trend.length - 1)}
				onblur={() => (hovered = null)}
				onclick={() => hoveredPoint && onselect?.(hoveredPoint.game_id)}
				{onkeydown}
			/>
		</svg>

		{#if hoveredPoint !== null && hovered !== null}
			<div
				class="pointer-events-none absolute top-2 z-10 rounded-xs border border-line bg-card px-2.5 py-1.5 text-xs shadow-sm"
				style="left:{tipLeft}px; width:{TIP_W}px"
				data-testid="cpl-tooltip"
			>
				<p class="font-semibold text-ink">
					Game #{hoveredPoint.number}
					<span class="font-normal text-muted">· {formatDate(hoveredPoint.created_at)}</span>
				</p>
				{#each series as s (s.key)}
					{@const value = hoveredPoint[s.key]}
					{#if value !== null}
						<p class="mt-0.5 flex items-center gap-1.5 text-muted">
							<span class="h-0.5 w-3 shrink-0 rounded-full" style="background:{s.color}"></span>
							{s.label}: <span class="font-mono text-ink">{value.toFixed(0)}</span>
						</p>
					{/if}
				{/each}
				{#if onselect}
					<p class="mt-1 text-[10px] text-faint">click to open review</p>
				{/if}
			</div>
		{/if}
	</div>

	<details class="mt-2 text-xs text-muted">
		<summary class="cursor-pointer select-none">View as table</summary>
		<table class="mt-1 w-full max-w-md text-left">
			<thead>
				<tr class="text-muted">
					<th class="py-0.5 font-normal">Game</th>
					<th class="py-0.5 font-normal">Date</th>
					{#each activeSeries as s (s.key)}<th class="py-0.5 font-normal">{s.label}</th>{/each}
				</tr>
			</thead>
			<tbody>
				{#each trend as point (point.game_id)}
					<tr class="border-t border-line text-body">
						<td class="py-0.5">#{point.number}</td>
						<td class="py-0.5">{formatDate(point.created_at)}</td>
						{#each activeSeries as s (s.key)}
							<td class="py-0.5 font-mono">{point[s.key]?.toFixed(0) ?? '—'}</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</details>
{/if}
