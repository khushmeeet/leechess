import { ApiError } from '$lib/api/client';

/** Turn a failed auth request into something worth reading.
 *
 * The backend answers with machine-readable codes (USERNAME_TAKEN, …) rather
 * than prose, so the wording lives here — one place, and the server stays free
 * to be terse. Anything unrecognised falls back to a neutral line instead of
 * leaking a status code or a raw body into the page.
 */
export function authErrorMessage(error: unknown): string {
	if (!(error instanceof ApiError)) {
		return 'Something went wrong. Check your connection and try again.';
	}

	switch (error.detail) {
		case 'USERNAME_TAKEN':
			return 'That name is already taken.';
		case 'USERNAME_INVALID':
			return '3–24 characters: letters, numbers, underscores and hyphens.';
		case 'PASSWORD_INVALID':
			return 'Passwords need to be at least 8 characters.';
		case 'LOGIN_BAD_CREDENTIALS':
			return "Username and password don't match.";
		case 'TOO_MANY_ATTEMPTS':
			return 'Too many attempts. Wait a few minutes and try again.';
		case 'ALREADY_REGISTERED':
			return 'This account already has a password.';
	}

	// 422 is pydantic rejecting the shape before the route runs — for these
	// forms that only ever means the username.
	if (error.status === 422) {
		return '3–24 characters: letters, numbers, underscores and hyphens.';
	}
	return 'Something went wrong. Please try again.';
}
