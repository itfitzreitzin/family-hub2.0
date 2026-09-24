import { redirect } from '@sveltejs/kit';

// The old Tracker. Clocking in and out, and the Care Day beside it, live on
// Care → Today; the week and the Purse are on Care → Hours & Pay.
export function load() {
	redirect(307, '/care');
}
