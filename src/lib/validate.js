// URL validation. Pure function (no DB/Redis), so it's easy to unit test.
function validateUrl(input, { ownHost } = {}) {
  if (typeof input !== 'string' || input.trim() === '') return { error: 'url is required' };
  if (input.length > 2048) return { error: 'url is too long (max 2048 chars)' };

  let url;
  try {
    url = new URL(input.trim());
  } catch {
    return { error: 'url is not a valid URL' };
  }
  if (!['http:', 'https:'].includes(url.protocol)) return { error: 'only http/https URLs are allowed' };
  if (!url.hostname) return { error: 'url must have a hostname' };
  // https://user:password@site.com — credentials in links leak and are a phishing trick
  if (url.username || url.password) return { error: 'urls with embedded credentials are not allowed' };
  // Shortening our own short links creates redirect loops
  if (ownHost && url.host === ownHost) return { error: 'cannot shorten links to this service' };

  return { url: url.toString() }; // normalised form
}

module.exports = { validateUrl };
