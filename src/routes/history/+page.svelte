<script>
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabase';
	import { goto } from '$app/navigation';
	import { toast, confirm as confirmModal } from '$lib/stores/toast.js';
	import Nav from '$lib/Nav.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { getWeekBounds, formatTime, formatDateWeekday as formatDate } from '$lib/time.js';
	import {
		normalizeVenmoHandle,
		isMobileDevice,
		buildVenmoNote,
		buildVenmoLink
	} from '$lib/venmo.js';
	import { buildTimesheetCsv, timesheetFilename, downloadCsv } from '$lib/csv.js';
	import { errorMessage } from '$lib/errors.js';

	let user = null;
	/** @type {any} */
	let profile = null;
	/** @type {any[]} */
	let entries = [];
	let loading = true;
	/** @type {string | null} */
	let initError = null;
	let entriesLoading = false;
	let loadToken = 0;
	/** @type {any[]} */
	let nannies = []; // List of all nannies
	/** @type {string | null} */
	let selectedNannyId = null; // Filter

	// Week filter
	let showingWeek = 'current'; // 'current' or 'all'

	// Check URL params for nanny filter
	onMount(async () => {
		const urlParams = new URLSearchParams(window.location.search);
		const nannyParam = urlParams.get('nanny');
		if (nannyParam) {
			selectedNannyId = nannyParam;
		}

		await initialize();
	});

	async function initialize() {
		loading = true;
		initError = null;

		try {
			const {
				data: { user: currentUser }
			} = await supabase.auth.getUser();

			if (!currentUser) {
				goto('/');
				return;
			}

			user = currentUser;

			// Get profile
			const { data: profileData, error: profileError } = await supabase
				.from('profiles')
				.select('*')
				.eq('id', user.id)
				.maybeSingle();

			if (profileError) throw profileError;
			profile = profileData;

			// If family or admin, load all nannies for the filter dropdown
			if (profile?.role === 'family' || profile?.role === 'admin') {
				const { data: nanniesData, error: nanniesError } = await supabase
					.from('profiles')
					.select('*')
					.eq('role', 'nanny')
					.order('full_name');

				if (nanniesError) throw nanniesError;
				nannies = nanniesData || [];
			}

			// Load time entries
			await loadEntries();

			loading = false;
		} catch (err) {
			initError = errorMessage(err);
			loading = false;
		}
	}

	$: filteredEntries =
		showingWeek === 'current' ? entries.filter((e) => isCurrentWeek(e.clock_in)) : entries;

	$: nannyById = Object.fromEntries(nannies.map((n) => [n.id, n]));
	$: weekTotal = filteredEntries.reduce((sum, e) => sum + (parseFloat(e.hours) || 0), 0);
	$: weekPay = computeWeekPay(filteredEntries, nannyById, profile);
	// The rate shown in the summary: the filtered nanny's rate, or the viewer's
	// own for nannies. Null (shown as —) when "All Nannies" mixes rates.
	$: displayRate = selectedNannyId
		? (nannyById[selectedNannyId]?.hourly_rate ?? 20)
		: profile?.role === 'nanny'
			? (profile?.hourly_rate ?? 20)
			: null;

	// Each entry is priced at its own nanny's rate, not the viewer's.
	/**
	 * @param {any} entry
	 * @param {Record<string, any>} byId
	 * @param {any} viewer
	 */
	function rateForEntry(entry, byId, viewer) {
		const nannyRate = byId[entry.nanny_id]?.hourly_rate;
		if (nannyRate) return nannyRate;
		if (viewer?.role === 'nanny' && viewer?.hourly_rate) return viewer.hourly_rate;
		return 20;
	}

	/**
	 * @param {any[]} list
	 * @param {Record<string, any>} byId
	 * @param {any} viewer
	 */
	function computeWeekPay(list, byId, viewer) {
		return list.reduce(
			(sum, e) => sum + (parseFloat(e.hours) || 0) * rateForEntry(e, byId, viewer),
			0
		);
	}

	function isCurrentWeek(dateString) {
		const { start, end } = getWeekBounds(0);
		const date = new Date(dateString);
		return date >= start && date <= end;
	}

	async function loadEntries() {
		const token = ++loadToken;
		entriesLoading = true;

		try {
			let query = supabase.from('time_entries').select('*').order('clock_in', { ascending: false });

			// Filter by selected nanny
			if (selectedNannyId) {
				query = query.eq('nanny_id', selectedNannyId);
			} else if (profile?.role === 'nanny') {
				// Nannies only see their own
				query = query.eq('nanny_id', user.id);
			}
			// Family/admin see all (unless filtered)

			const { data, error } = await query;

			if (error) throw error;
			if (token !== loadToken) return;

			// Only show completed entries (with clock_out)
			entries = (data || []).filter((e) => e.clock_out);
		} finally {
			if (token === loadToken) entriesLoading = false;
		}
	}

	async function changeNannyFilter(nannyId) {
		selectedNannyId = nannyId;

		try {
			await loadEntries();
		} catch (err) {
			toast.error('Error loading entries: ' + errorMessage(err));
		}

		// Update URL without reload
		const url = new URL(window.location);
		if (nannyId) {
			url.searchParams.set('nanny', nannyId);
		} else {
			url.searchParams.delete('nanny');
		}
		window.history.pushState({}, '', url);
	}

	async function generateVenmoPayment() {
		const nanny = selectedNannyId ? nannyById[selectedNannyId] : null;
		if (!nanny) {
			toast.error('Select a single nanny to generate a payment');
			return;
		}

		if (weekTotal === 0) {
			toast.error('No completed hours for this week');
			return;
		}

		const recipient = normalizeVenmoHandle(nanny.venmo_username);
		if (!recipient) {
			toast.error(`${nanny.full_name} has no Venmo username set. Add it in Settings.`);
			return;
		}

		const rate = nanny.hourly_rate || 20;
		const note = buildVenmoNote({
			direction: 'pay',
			name: nanny.full_name,
			weekStart: getWeekBounds(0).start,
			hours: weekTotal,
			rate,
			total: weekPay
		});

		if (isMobileDevice()) {
			const confirmed = await confirmModal.show({
				title: 'Venmo Payment',
				message: `Pay $${weekPay.toFixed(2)} to @${recipient} via Venmo?`,
				confirmText: 'Pay'
			});
			if (confirmed) {
				window.location.href = buildVenmoLink({ txn: 'pay', recipient, amount: weekPay, note });
			}
		} else {
			// Desktop - copy to clipboard
			try {
				await navigator.clipboard.writeText(note);
				toast.success(
					'Payment details copied. Tip: use the Tracker page to record and track payments.'
				);
			} catch {
				toast.info('Payment details: ' + note, 10000);
			}
		}
	}

	function exportCSV() {
		const nannyName = selectedNannyId
			? nannyById[selectedNannyId]?.full_name
			: profile?.role === 'nanny'
				? profile?.full_name
				: null;
		const bounds = showingWeek === 'current' ? getWeekBounds(0) : null;

		downloadCsv(
			timesheetFilename({
				nannyName,
				weekStart: bounds ? bounds.start : null,
				weekEnd: bounds ? bounds.end : null
			}),
			buildTimesheetCsv(filteredEntries, (e) => rateForEntry(e, nannyById, profile))
		);
	}
</script>

<Nav currentPage="history" />

<div class="container">
	{#if (profile?.role === 'family' || profile?.role === 'admin') && nannies.length > 0}
		<div class="filter-bar">
			<label for="filter">Reading the ledger of</label>
			<select
				id="filter"
				bind:value={selectedNannyId}
				on:change={() => changeNannyFilter(selectedNannyId)}
			>
				<option value={null}>Everyone</option>
				{#each nannies as nanny (nanny.id)}
					<option value={nanny.id}>{nanny.full_name}</option>
				{/each}
			</select>
		</div>
	{/if}

	{#if loading}
		<Skeleton variant="stats" count={3} />
		<div style="height: var(--section-gap)"></div>
		<Skeleton variant="rows" count={5} />
	{:else if initError}
		<div class="card arcana">
			<EmptyState icon="warning" title="The ledger won't open" hint={initError}>
				<button class="btn btn-primary" on:click={initialize}>
					<Icon name="star" size={16} /> Try again
				</button>
			</EmptyState>
		</div>
	{:else}
		<!-- ── Summary ──────────────────────────────────────── -->
		<div class="card arcana">
			<div class="card-header">
				<h2>{showingWeek === 'current' ? 'This Week' : 'All Time'}</h2>
				<div class="week-toggle">
					<button
						class:active={showingWeek === 'current'}
						on:click={() => (showingWeek = 'current')}
					>
						Week
					</button>
					<button class:active={showingWeek === 'all'} on:click={() => (showingWeek = 'all')}>
						All time
					</button>
				</div>
			</div>

			<div class="summary-stats rise-in">
				<div class="stat">
					<span class="stat-icon"><Icon name="hourglass" size={24} /></span>
					<span class="stat-value">{weekTotal.toFixed(1)}</span>
					<span class="stat-label">Hours</span>
				</div>
				<div class="stat">
					<span class="stat-icon"><Icon name="coin" size={24} /></span>
					<span class="stat-value gilt-text">${weekPay.toFixed(2)}</span>
					<span class="stat-label">Total pay</span>
				</div>
				<div class="stat">
					<span class="stat-icon"><Icon name="crystal" size={24} /></span>
					<span class="stat-value">{displayRate !== null ? '$' + displayRate : '—'}</span>
					<span class="stat-label">Per hour</span>
				</div>
			</div>

			<div class="summary-actions">
				{#if (profile?.role === 'family' || profile?.role === 'admin') && showingWeek === 'current' && selectedNannyId}
					<button class="btn btn-primary" on:click={generateVenmoPayment}>
						<Icon name="coin" size={16} /> Send via Venmo
					</button>
				{/if}
				<button class="btn btn-secondary" on:click={exportCSV}>
					<Icon name="download" size={16} /> Export CSV
				</button>
			</div>
		</div>

		<!-- ── Entries ──────────────────────────────────────── -->
		<div class="card arcana">
			<h2>{filteredEntries.length} {filteredEntries.length === 1 ? 'Shift' : 'Shifts'}</h2>

			{#if filteredEntries.length === 0}
				<EmptyState
					icon="scroll"
					title="The page is blank"
					hint="No completed shifts have been written down yet."
				>
					<a href="/tracker" class="btn btn-primary">
						<Icon name="hourglass" size={16} /> Go to the tracker
					</a>
				</EmptyState>
			{:else}
				<div class="table-container desktop-only" class:refreshing={entriesLoading}>
					<table>
						<thead>
							<tr>
								<th>Date</th>
								<th>In</th>
								<th>Out</th>
								<th>Hours</th>
								<th>Earnings</th>
								<th>Notes</th>
							</tr>
						</thead>
						<tbody>
							{#each filteredEntries as entry (entry.id)}
								<tr>
									<td>{formatDate(entry.clock_in)}</td>
									<td>{formatTime(entry.clock_in)}</td>
									<td>{formatTime(entry.clock_out)}</td>
									<td class="num">{(parseFloat(entry.hours) || 0).toFixed(2)}</td>
									<td class="num gilt-text">
										${(
											(parseFloat(entry.hours) || 0) * rateForEntry(entry, nannyById, profile)
										).toFixed(2)}
									</td>
									<td class="notes">{entry.notes || '—'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<div class="mobile-only entry-list" class:refreshing={entriesLoading}>
					{#each filteredEntries as entry (entry.id)}
						<div class="entry-card">
							<div class="entry-top">
								<span class="entry-date">{formatDate(entry.clock_in)}</span>
								<span class="entry-earnings">
									${(
										(parseFloat(entry.hours) || 0) * rateForEntry(entry, nannyById, profile)
									).toFixed(2)}
								</span>
							</div>
							<div class="entry-bottom">
								<span class="entry-time">
									{formatTime(entry.clock_in)} – {formatTime(entry.clock_out)}
								</span>
								<span class="entry-hours">{(parseFloat(entry.hours) || 0).toFixed(2)}h</span>
							</div>
							{#if entry.notes}
								<p class="entry-note">{entry.notes}</p>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<div class="quick-links">
			<a href="/dashboard"><Icon name="chevron-left" size={16} /> Hearth</a>
			<a href="/tracker">The Hours <Icon name="chevron-right" size={16} /></a>
		</div>
	{/if}
</div>

<style>
	.filter-bar {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		flex-wrap: wrap;
		margin-bottom: var(--section-gap);
		padding: 0.85rem 1.1rem;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-radius: var(--card-radius);
	}

	.filter-bar label {
		margin: 0;
		white-space: nowrap;
	}

	.filter-bar select {
		flex: 1;
		min-width: 180px;
	}

	.week-toggle {
		display: flex;
		gap: 0.3rem;
		padding: 0.25rem;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius-sm);
	}

	.week-toggle button {
		min-height: 34px;
		padding: 0.3rem 0.9rem;
		background: none;
		border: none;
		border-radius: 6px;
		color: var(--text-faint);
		font-family: var(--font-body);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.week-toggle button.active {
		background: var(--accent-dim);
		color: var(--accent-bright);
	}

	.summary-stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: var(--grid-gap);
		margin-bottom: 1.25rem;
	}

	.stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		padding: 1.25rem 1rem;
		text-align: center;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-radius: var(--card-radius);
		--icon-accent: var(--accent);
		color: var(--text-faint);
	}

	.stat-icon {
		display: grid;
		place-items: center;
		margin-bottom: 0.3rem;
	}

	.stat-value {
		font-size: clamp(1.4rem, 4vw, 1.8rem);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		line-height: 1.1;
		color: var(--text);
	}

	.stat-label {
		font-family: var(--font-body);
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.13em;
		text-transform: uppercase;
	}

	.summary-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
	}

	.notes {
		color: var(--text-faint);
		font-style: italic;
	}

	.entry-list {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
	}

	.entry-card {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 0.9rem 1rem;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius-sm);
	}

	.entry-top,
	.entry-bottom {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
	}

	.entry-date {
		font-family: var(--font-display);
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--text);
	}

	.entry-earnings,
	.entry-hours {
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--accent-bright);
	}

	.entry-time {
		font-size: 0.88rem;
		color: var(--text-faint);
	}

	.entry-note {
		font-size: 0.85rem;
		font-style: italic;
		color: var(--text-faint);
	}

	.quick-links {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		margin-top: var(--section-gap);
	}

	.quick-links a {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-family: var(--font-display);
		font-size: 0.9rem;
		letter-spacing: 0.04em;
		color: var(--text-muted);
		--icon-accent: var(--accent);
		transition: color var(--transition-fast);
	}

	.quick-links a:hover {
		color: var(--accent-bright);
	}
</style>
