import { redirect } from '@sveltejs/kit';

// The old History page, folded into Care → Hours & Pay. The query string
// rides along so ?nanny=<id> still opens that nanny's ledger.
export function load({ url }) {
	redirect(307, '/care/hours' + url.search);
}
