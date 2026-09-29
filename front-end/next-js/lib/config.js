// front-end/local/lib/config.js
//
// Runtime configuration for the Coding Agent front-end.
//
// GitHub and GitLab OAuth client IDs are intentionally NOT exposed here.
// NEXT_PUBLIC_* values are inlined into the browser bundle at build time,
// so anything placed here is public. OAuth client IDs are not secrets by
// protocol design (they appear in the provider's authorization redirect
// regardless), but keeping them server-side only means this app never
// ships them in a static asset, source map, or public repo build output --
// only the backend-issued redirect URL momentarily contains them in the
// browser's address bar during the OAuth handshake. See lib/integrations.js.

export const APP_CONFIG = {
  BACKEND_URL: process.env.NEXT_PUBLIC_BACKEND_URL,
};
