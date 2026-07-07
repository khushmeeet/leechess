<script lang="ts">
	import type { GameCplPoint } from '$lib/api/client';

	interface Props {
		trend: GameCplPoint[];
		onselect?: (gameId: number) => void;
	}

	let { trend, onselect }: Props = $props();

	// Hues validated for CVD separation + contrast on the white card surface
	// (dataviz six-checks); "Overall" is ink, not a category color.
	const series = [
		{ key: 'avg_cpl', label: 'Overall', color: '#292524', width: 2.5 },
		{ key: 'opening_cpl', label: 'Opening', color: '#0369a1', width: 2 },
		{ key: 'middlegame_cpl', label: 'Middlegame', color: '#b45309', width: 2 },
		{ key: 'endgame_cpl', label: 'Endgame', color: '#6d28d9', width: 2 }
	] as const;
	type SeriesKey = (typeof series)[number]['key'];

	const W = 600;
	const H = 200;
	const PAD = { top: 10, right: 86, bottom: 22, left: 34 }; // right holds end labels

	const x = $derived((i: number) =>
		trend.length <= 1
			? PAD.left + (W - PAD.left - PAD.right) / 2
			: PAD.left + (i / (trend.length - 1)) * (W - PAD.left - PAD.right)
	);

	// Lower CPL is better, so the axis runs 0 (bottom) → a rounded-up max.
	// Multiples of 50 keep the mid gridline label whole.
	const yMax = $derived.by(() => {
		let max = 50;
		for (const point of trend) {
			for (const { key } of series) {
				const value = point[key];
				if (value !== null) max = Math.max(max, value);
			}
		}
		return Math.ceil(max / 50) * 50;
	});

	/** Series with at least one value — short games never reach the endgame,
	 * and an all-empty series earns no legend entry. */
	const activeSeries = $derived(series.filter((s) => trend.some((point) => point[s.key] !== null)));

	const y = $derived((cpl: number) => H - PAD.bottom - (cpl / yMax) * (H - PAD.top - PAD.bottom));

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

	// Direct labels at each line's last point, nudged apart when they collide.
	const endLabels = $derived.by(() => {
		const labels = series
			.map((s) => {
				for (let i = trend.length - 1; i >= 0; i--) {
					const value = trend[i][s.key];
					if (value !== null) return { ...s, x: x(i), y: y(value) };
				}
				return null;
			})
			.filter((l) => l !== null)
			.sort((a, b) => a.y - b.y);
		const MIN_GAP = 12;
		for (let i = 1; i < labels.length; i++) {
			labels[i].y = Math.max(labels[i].y, labels[i - 1].y + MIN_GAP);
		}
		return labels;
	});

	let hovered = $state<number | null>(null);
	const hoveredPoint = $derived(hovered !== null ? trend[hovered] : null);

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}

	const gridValues = $derived([0, yMax / 2, yMax]);
</script>

{#if trend.length === 0}
	<p class="text-sm text-stone-500">
		No analyzed games yet — finish a game and its CPL lands here.
	</p>
{:else}
	<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-600">
		{#each activeSeries as s (s.key)}
			<span class="inline-flex items-center gap-1.5">
				<span class="h-0.5 w-4 rounded-full" style="background:{s.color}"></span>
				{s.label}
			</span>
		{/each}
	</div>

	<div class="relative mt-2">
		<svg
			viewBox="0 0 {W} {H}"
			class="w-full rounded-md border border-stone-300 bg-white"
			role="img"
			aria-label="Average centipawn loss per game over time, split by game phase"
			data-testid="cpl-trend"
			onmouseleave={() => (hovered = null)}
		>
			{#each gridValues as value (value)}
				<line
					x1={PAD.left}
					y1={y(value)}
					x2={W - PAD.right}
					y2={y(value)}
					stroke="#e7e5e4"
					stroke-width="1"
				/>
				<text
					x={PAD.left - 6}
					y={y(value) + 3}
					text-anchor="end"
					class="fill-stone-400"
					font-size="9">{value}</text
				>
			{/each}

			{#if hovered !== null}
				<line
					x1={x(hovered)}
					y1={PAD.top}
					x2={x(hovered)}
					y2={H - PAD.bottom}
					stroke="#f59e0b"
					stroke-width="1.5"
				/>
			{/if}

			{#each activeSeries as s (s.key)}
				<path d={path(s.key)} fill="none" stroke={s.color} stroke-width={s.width} />
				{#each lonePoints(s.key) as { value, i } (i)}
					<circle cx={x(i)} cy={y(value!)} r="3" fill={s.color} stroke="#fff" stroke-width="2" />
				{/each}
			{/each}

			<!-- per-game markers on the overall line, ringed to stand off crossings -->
			{#each trend as point, i (point.game_id)}
				<circle
					cx={x(i)}
					cy={y(point.avg_cpl)}
					r={hovered === i ? 4.5 : 3}
					fill="#292524"
					stroke="#fff"
					stroke-width="2"
				/>
			{/each}

			{#each endLabels as label (label.key)}
				<text x={W - PAD.right + 8} y={label.y + 3} font-size="9" class="fill-stone-500"
					>{label.label}</text
				>
			{/each}

			<!-- x-axis: first and last game dates anchor the timeline -->
			<text x={PAD.left} y={H - 6} font-size="9" class="fill-stone-400">
				{formatDate(trend[0].created_at)}
			</text>
			{#if trend.length > 1}
				<text x={W - PAD.right} y={H - 6} text-anchor="end" font-size="9" class="fill-stone-400">
					{formatDate(trend[trend.length - 1].created_at)}
				</text>
			{/if}

			<!-- hover/click hit columns, wider than the marks they target -->
			{#each trend as point, i (point.game_id)}
				<rect
					x={trend.length <= 1 ? 0 : x(i) - (x(1) - x(0)) / 2}
					y="0"
					width={trend.length <= 1 ? W : x(1) - x(0)}
					height={H}
					fill="transparent"
					class={onselect ? 'cursor-pointer' : ''}
					role="button"
					tabindex="-1"
					aria-label="Game {point.game_id}"
					onmouseenter={() => (hovered = i)}
					onclick={() => onselect?.(point.game_id)}
					onkeydown={(e) => e.key === 'Enter' && onselect?.(point.game_id)}
				/>
			{/each}
		</svg>

		{#if hoveredPoint !== null && hovered !== null}
			<div
				class="pointer-events-none absolute top-2 z-10 rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-xs shadow-sm"
				style="left: min(max({((x(hovered) / W) * 100).toFixed(
					1
				)}% - 60px, 0%), calc(100% - 130px))"
				data-testid="cpl-tooltip"
			>
				<p class="font-semibold text-stone-800">
					Game #{hoveredPoint.game_id}
					<span class="font-normal text-stone-500">· {formatDate(hoveredPoint.created_at)}</span>
				</p>
				{#each series as s (s.key)}
					{@const value = hoveredPoint[s.key]}
					{#if value !== null}
						<p class="mt-0.5 flex items-center gap-1.5 text-stone-600">
							<span class="h-0.5 w-3 rounded-full" style="background:{s.color}"></span>
							{s.label}: <span class="font-mono text-stone-800">{value.toFixed(0)}</span>
						</p>
					{/if}
				{/each}
				{#if onselect}
					<p class="mt-1 text-[10px] text-stone-400">click to open review</p>
				{/if}
			</div>
		{/if}
	</div>

	<details class="mt-2 text-xs text-stone-500">
		<summary class="cursor-pointer select-none">View as table</summary>
		<table class="mt-1 w-full max-w-md text-left">
			<thead>
				<tr class="text-stone-500">
					<th class="py-0.5 font-normal">Game</th>
					<th class="py-0.5 font-normal">Date</th>
					{#each activeSeries as s (s.key)}<th class="py-0.5 font-normal">{s.label}</th>{/each}
				</tr>
			</thead>
			<tbody>
				{#each trend as point (point.game_id)}
					<tr class="border-t border-stone-200 text-stone-700">
						<td class="py-0.5">#{point.game_id}</td>
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
