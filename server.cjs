// Load polyfill first
require('/www/wwwroot/iclawstore.com/.polyfill.cjs');

// Set env vars
process.env.VITE_CONVEX_URL = 'https://cheerful-schnauzer-269.convex.cloud';
process.env.VITE_CONVEX_SITE_URL = 'https://cheerful-schnauzer-269.convex.site';
process.env.SITE_URL = 'https://www.iclawstore.com';
process.env.CONVEX_SITE_URL = 'https://cheerful-schnauzer-269.convex.site';

// Load the server
require('/www/wwwroot/iclawstore.com/.output/server/index.mjs');
