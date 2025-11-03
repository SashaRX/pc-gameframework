export function normalizePlayCanvasAssetUrl(rawUrl?: string | null): string | undefined {
  if (!rawUrl) {
    return undefined;
  }

  let normalized = rawUrl.trim();
  if (!normalized) {
    return undefined;
  }

  if (typeof window === 'undefined') {
    return normalized;
  }

  const location = window.location;

  if (!location) {
    return normalized;
  }

  const publishOrigin = location.origin;
  const publishHost = location.hostname;

  if (!/playcanv\.as$/i.test(publishHost)) {
    return normalized;
  }

  let parsed: URL;

  try {
    parsed = new URL(normalized);
  } catch {
    return normalized;
  }

  const pathSegments = parsed.pathname.split('/').filter(Boolean);

  let buildId: string | undefined;
  let remainderSegments: string[] | undefined;

  if (parsed.hostname === 'apps.playcanvas.com' && pathSegments.length >= 2) {
    buildId = pathSegments[0];
    remainderSegments = pathSegments.slice(1);
  } else if (parsed.hostname.endsWith('amazonaws.com') && pathSegments.length >= 3) {
    if (pathSegments[0] === 'apps.playcanvas.com') {
      buildId = pathSegments[1];
      remainderSegments = pathSegments.slice(2);
    }
  }

  if (!buildId || !remainderSegments?.length) {
    return normalized;
  }

  const sanitizedSegments: string[] = [];

  for (const segment of remainderSegments) {
    if (!segment || segment === '.') {
      continue;
    }

    if (segment === '..') {
      sanitizedSegments.pop();
      continue;
    }

    sanitizedSegments.push(segment);
  }

  if (!sanitizedSegments.length) {
    return normalized;
  }

  const sanitizedPath = sanitizedSegments.join('/');

  return `${publishOrigin}/p/${buildId}/${sanitizedPath}${parsed.search}${parsed.hash}`;
}
