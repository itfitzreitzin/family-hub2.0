import { redirect } from '@sveltejs/kit';

// The Chronicle is Care → Journal now.
export function load() {
	redirect(307, '/care/journal');
}
