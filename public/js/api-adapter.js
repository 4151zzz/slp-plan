/**
 * Dynamic Universal API Adapter
 * Automatically routes /api requests to current deployment subfolder
 * Developed by: wunPiyapong
 */
(function() {
  const loc = window.location.pathname;
  const dir = loc.substring(0, loc.lastIndexOf('/'));
  // If running in a subfolder like /plan or /data/public_html/plan/public
  const apiBase = (dir && dir !== '/') ? dir + '/api' : '/api';
  window.API_BASE_URL = apiBase;

  const origFetch = window.fetch;
  window.fetch = function(resource, init) {
    if (typeof resource === 'string' && resource.startsWith('/api')) {
      resource = apiBase + resource.substring(4);
    }
    return origFetch.call(this, resource, init);
  };
})();
