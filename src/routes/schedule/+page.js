// This page is entirely client-rendered (all data loading happens in onMount
// behind auth). Disabling SSR avoids server-side errors from browser-only APIs
// like document/window and removes unnecessary server work.
export const ssr = false
