<script lang="ts">
	import '$lib/pieces.css';
	import { boardImageUrl } from '$lib/boardThemes';
	import { boardPrefs } from '$lib/stores/boardPrefs.svelte';

	// Static position diagram: renders the placement field of a FEN with the
	// user's board palette and piece set, like a plate in a chess book.
	let { fen, label }: { fen: string; label: string } = $props();

	const ROLE: Record<string, string> = {
		p: 'pawn',
		n: 'knight',
		b: 'bishop',
		r: 'rook',
		q: 'queen',
		k: 'king'
	};

	interface Placed {
		key: string;
		cls: string;
		x: number;
		y: number;
	}

	const pieces = $derived.by((): Placed[] => {
		const out: Placed[] = [];
		fen
			.split(' ')[0]
			.split('/')
			.forEach((row, y) => {
				let x = 0;
				for (const ch of row) {
					if (ch >= '1' && ch <= '8') {
						x += Number(ch);
						continue;
					}
					const role = ROLE[ch.toLowerCase()];
					if (role) {
						out.push({
							key: `${x}${y}`,
							cls: `${role} ${ch === ch.toLowerCase() ? 'black' : 'white'}`,
							x,
							y
						});
						x++;
					}
				}
			});
		return out;
	});
</script>

<div
	class="miniboard pieces-{boardPrefs.pieceSet}"
	style="background-image: {boardImageUrl(boardPrefs.theme)}"
	role="img"
	aria-label={label}
>
	{#each pieces as p (p.key)}
		<piece class={p.cls} style="left: {p.x * 12.5}%; top: {p.y * 12.5}%"></piece>
	{/each}
</div>

<style>
	.miniboard {
		position: relative;
		aspect-ratio: 1;
		background-size: cover;
	}
	.miniboard piece {
		position: absolute;
		width: 12.5%;
		height: 12.5%;
		background-size: cover;
		background-repeat: no-repeat;
		pointer-events: none;
	}
</style>
