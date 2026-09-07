<script lang="ts">
	let { class: className = '' }: { class?: string } = $props();
</script>

<svg
	class={className}
	viewBox="0 0 48 48"
	fill="none"
	stroke="currentColor"
	stroke-width="1.6"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	<path d="M14 38c0-6 4-10 9-14l-4-4-5 5-6-3 4-9 10-5 1-5 5 6c8 2 11 9 9 18l-2 11" />
	<path d="m13 14 5 1m5-7 4 7M14 38h23v4H12v-4h2ZM10 45h29v-3H10z" />
	<circle cx="24" cy="15" r="1" fill="currentColor" stroke="none" />
</svg>
