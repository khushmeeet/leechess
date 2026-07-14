import { browser } from '$app/environment';
import { moveSoundKind, playSound, type Sound } from '$lib/sound';

const SOUND_KEY = 'leechess.sound';

/** Game-sound toggle, set from the nav's Settings menu and persisted across
 * sessions — same pattern as displayPrefs. Playback goes through here so the
 * mute check lives in one place rather than at every board. */
class SoundPrefs {
	enabled = $state(true);

	constructor() {
		if (!browser) return;
		if (localStorage.getItem(SOUND_KEY) === 'false') this.enabled = false;
	}

	setEnabled(value: boolean) {
		this.enabled = value;
		if (browser) localStorage.setItem(SOUND_KEY, String(value));
		// switching it on previews the sound, and the click is the user gesture
		// the AudioContext needs to start
		if (value) playSound('move-self');
	}

	/** Sound a move that was just played on a board, by its SAN. */
	move(san: string, byOpponent = false) {
		this.play(moveSoundKind(san, byOpponent));
	}

	play(sound: Sound) {
		if (this.enabled) playSound(sound);
	}
}

export const soundPrefs = new SoundPrefs();
