/** Motif display helpers shared by Review chips and the hint ladder.
 * Names arrive underscored from the fixed taxonomy (server app/motifs.py). */

export function humanizeMotif(motif: string): string {
	return motif.replaceAll('_', ' ');
}

/** Templated one-line reason for hint Level 4 ("Nc7 forks the king and
 * rook" style) — full LLM narration is deferred to Phase 5. */
export function motifReason(motif: string, san: string): string {
	const templates: Record<string, string> = {
		fork: `${san} attacks two targets at once — one of them must fall`,
		pin: `${san} pins a piece against something more valuable behind it`,
		skewer: `${san} skewers: the front piece must move and what's behind falls`,
		back_rank_mate: `${san} mates on the back rank — the king has no escape squares`,
		hanging_piece: `${san} wins a piece that isn't adequately defended`,
		discovered_check: `${san} uncovers a check from the piece behind`,
		double_check: `${san} gives double check — the king has to move`,
		discovered_attack: `${san} uncovers an attack from the piece behind`,
		removing_the_defender: `${san} removes the piece holding the defense together`,
		deflection: `${san} deflects the defender away from its job`,
		x_ray_attack: `${san} attacks through the piece in the way`,
		zwischenzug: `${san} is an in-between move — the threat comes first`,
		trapped_piece: `${san} traps a piece with nowhere safe to go`
	};
	return templates[motif] ?? `${san} executes the ${humanizeMotif(motif)}`;
}
