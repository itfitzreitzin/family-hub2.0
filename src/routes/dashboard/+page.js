import { redirect } from '@sveltejs/kit';

// The old Today page. Its household glance is Home now; /home sends the
// nanny on to Care.
export function load() {
	redirect(307, '/home');
}
