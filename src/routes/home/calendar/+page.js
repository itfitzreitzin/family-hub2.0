// Client-rendered like the other pages: all data loads in onMount behind
// auth, so SSR would only add server work and browser-API hazards.
export const ssr = false;
