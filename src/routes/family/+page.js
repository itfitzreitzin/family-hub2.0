import { redirect } from '@sveltejs/kit';

// The family roster is Settings → Household now.
export function load() {
	redirect(307, '/settings/household');
}
