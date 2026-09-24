import { redirect } from '@sveltejs/kit';

// The Admin page is Settings → Accounts now.
export function load() {
	redirect(307, '/settings/accounts');
}
