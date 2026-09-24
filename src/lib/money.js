// Dollars for display. Venmo deep links and CSV cells keep plain
// toFixed(2) numbers — this is only for what people read on screen.

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/**
 * @param {number | string | null | undefined} value
 * @returns {string} e.g. '$1,006.50'
 */
export function formatMoney(value) {
	const n = typeof value === 'number' ? value : parseFloat(value ?? '');
	return USD.format(Number.isFinite(n) ? n : 0);
}
