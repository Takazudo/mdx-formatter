const NEW_DOC_ORIGIN = 'https://mdx-formatter.takazudomodular.com';
const LEGACY_PATH_PREFIX = '/pj/mdx-formatter';
const LEGACY_HOSTS = new Set(['takazudomodular.com', 'mdx-formatter.takazudomodular.com']);

export function getLegacyRedirect(requestUrl) {
  const url = new URL(requestUrl);

  if (!LEGACY_HOSTS.has(url.hostname)) {
    return null;
  }

  const isLegacyPath =
    url.pathname === LEGACY_PATH_PREFIX || url.pathname.startsWith(`${LEGACY_PATH_PREFIX}/`);

  if (!isLegacyPath) {
    return null;
  }

  const destinationPath = url.pathname.slice(LEGACY_PATH_PREFIX.length) || '/';
  const destination = new URL(destinationPath, NEW_DOC_ORIGIN);
  destination.search = url.search;

  return destination.toString();
}

export default {
  fetch(request, env) {
    const redirectLocation = getLegacyRedirect(request.url);

    if (redirectLocation) {
      return Response.redirect(redirectLocation, 301);
    }

    // This Worker is layered over the parent site's origin only for the
    // legacy docs route. Defer any non-matching request to that origin.
    if (new URL(request.url).hostname === 'takazudomodular.com') {
      return fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
