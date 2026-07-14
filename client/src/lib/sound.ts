/** Chess event sounds backed by the bundled MP3 files. */

export type Sound =
	| 'game-start'
	| 'game-end'
	| 'capture'
	| 'castle'
	| 'premove'
	| 'move-self'
	| 'move-opponent'
	| 'check'
	| 'promote'
	| 'notify'
	| 'illegal'
	| 'tenseconds';

const MASTER_GAIN = 0.8;
const SAMPLE_URLS = {
	'game-start': '/sounds/game-start.mp3',
	'game-end': '/sounds/game-end.mp3',
	capture: '/sounds/capture.mp3',
	castle: '/sounds/castle.mp3',
	premove: '/sounds/premove.mp3',
	'move-self': '/sounds/move-self.mp3',
	'move-opponent': '/sounds/move-opponent.mp3',
	check: '/sounds/move-check.mp3',
	promote: '/sounds/promote.mp3',
	notify: '/sounds/notify.mp3',
	illegal: '/sounds/illegal.mp3',
	tenseconds: '/sounds/tenseconds.mp3'
} as const;

type Sample = keyof typeof SAMPLE_URLS;

/** Choose the most specific sound for a move from its SAN. */
export function moveSoundKind(san: string, byOpponent = false): Sound {
	if (san.includes('+') || san.includes('#')) return 'check';
	if (san.startsWith('O-O')) return 'castle';
	if (san.includes('=')) return 'promote';
	if (san.includes('x')) return 'capture';
	return byOpponent ? 'move-opponent' : 'move-self';
}

interface Audio {
	ctx: AudioContext;
	out: GainNode;
}

let audio: Audio | undefined;
const samples: Partial<Record<Sample, AudioBuffer>> = {};
const loading: Partial<Record<Sample, Promise<AudioBuffer>>> = {};

/** Built on first play, not at import: an AudioContext created before any user
 * gesture starts suspended under the autoplay policy. Every call site here is
 * a move, which only ever follows a click or a drag. */
function open(): Audio | undefined {
	if (typeof window === 'undefined' || !('AudioContext' in window)) return undefined;
	if (!audio) {
		const ctx = new AudioContext();
		const out = ctx.createGain();
		out.gain.value = MASTER_GAIN;
		out.connect(ctx.destination);
		audio = { ctx, out };
	}
	const ctx = audio.ctx;
	if (ctx.state === 'suspended') void ctx.resume();
	return audio;
}

function loadSample(ctx: AudioContext, sample: Sample): Promise<AudioBuffer> {
	const loaded = samples[sample];
	if (loaded) return Promise.resolve(loaded);
	if (!loading[sample]) {
		loading[sample] = fetch(SAMPLE_URLS[sample])
			.then((response) => {
				if (!response.ok) throw new Error(`sound request failed: ${response.status}`);
				return response.arrayBuffer();
			})
			.then((bytes) => ctx.decodeAudioData(bytes))
			.then((buffer) => (samples[sample] = buffer));
	}
	return loading[sample];
}

function playSample(a: Audio, sample: Sample): void {
	void loadSample(a.ctx, sample)
		.then((buffer) => {
			const source = a.ctx.createBufferSource();
			source.buffer = buffer;
			source.connect(a.out);
			source.start();
		})
		.catch(() => {}); // sound must never interrupt the game
}

export function playSound(kind: Sound): void {
	const a = open();
	if (!a) return;
	playSample(a, kind);
}
