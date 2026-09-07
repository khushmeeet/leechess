<script lang="ts">
	import type { Snippet } from 'svelte';
	import StudyOrnament from './StudyOrnament.svelte';
	let {
		eyebrow,
		title,
		description,
		badge,
		children
	}: { eyebrow: string; title: string; description?: string; badge?: string; children?: Snippet } =
		$props();
</script>

<header class="page-heading">
	<div class="min-w-0">
		<div class="heading-copy">
			<h1>
				{title}{#if badge}<span class="heading-badge">{badge}</span>{/if}
			</h1>
			<p class="eyebrow">{eyebrow}</p>
		</div>
		{#if description}<p class="page-description">{description}</p>{/if}
	</div>
	{#if children}<div class="page-heading-actions">{@render children()}</div>{/if}
	<StudyOrnament class="heading-ornament" />
</header>
