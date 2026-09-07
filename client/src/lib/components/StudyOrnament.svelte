<script lang="ts">
	let { class: className = '' }: { class?: string } = $props();
</script>

<!-- A printer's ornament: decoration only, never an extra stop for readers. -->
<svg
	class={className}
	width="72"
	height="12"
	viewBox="0 0 72 12"
	fill="none"
	stroke="currentColor"
	stroke-width="0.8"
	aria-hidden="true"
>
	<path d="M0 6h18m36 0h18M22 6c4-6 8-6 10 0-2 6-6 6-10 0Zm18 0c2-6 6-6 10 0-4 6-8 6-10 0Z" />
	<path d="m36 2 4 4-4 4-4-4Z" fill="currentColor" stroke="none" />
</svg>
