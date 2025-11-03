export interface PlayCanvasAssetLike {
  id?: number | string | null;
  file?: {
    url?: string | null;
    filename?: string | null;
    hash?: string | null;
  } | null;
  data?: Record<string, unknown> | null;
}

function getWindowLocation(): Location | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    return window.location;
  } catch {
    return undefined;
  }
}

function getPlayCanvasBuildIdFromUrl(parsed: URL): string | undefined {
  const pathSegments = parsed.pathname.split('/').filter(Boolean);

  if (!pathSegments.length) {
    return undefined;
  }

  if (parsed.hostname === 'apps.playcanvas.com') {
    return pathSegments[0];
  }

  if (parsed.hostname.endsWith('amazonaws.com')) {
    if (pathSegments[0] === 'apps.playcanvas.com' && pathSegments.length >= 2) {
      return pathSegments[1];
    }
  }

  return undefined;
}

function sanitizePathSegments(segments: string[]): string[] {
  const sanitized: string[] = [];

  for (const segment of segments) {
    if (!segment || segment === '.') {
      continue;
    }

    if (segment === '..') {
      sanitized.pop();
      continue;
    }

    sanitized.push(segment);
  }

  return sanitized;
}

function rewriteAppsHostUrl(parsed: URL): string | undefined {
  const pathSegments = parsed.pathname.split('/').filter(Boolean);

  if (!pathSegments.length) {
    return undefined;
  }

  // Handle S3 proxy path: /apps.playcanvas.com/<buildId>/...
  if (parsed.hostname.endsWith('amazonaws.com')) {
    const appsIndex = pathSegments.indexOf('apps.playcanvas.com');

    if (appsIndex !== -1 && pathSegments[appsIndex + 1]) {
      const rewritten = new URL(parsed.href);
      rewritten.hostname = 'apps.playcanvas.com';
      rewritten.pathname = `/${pathSegments.slice(appsIndex + 1).join('/')}`;
      return rewritten.href;
    }
  }

  if (parsed.hostname === 'apps.playcanvas.com') {
    return parsed.href;
  }

  return undefined;
}

export function normalizePlayCanvasAssetUrl(rawUrl?: string | null): string | undefined {
  if (!rawUrl) {
    return undefined;
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return undefined;
  }

  const location = getWindowLocation();

  if (!location || !/playcanv\.as$/i.test(location.hostname)) {
    try {
      const parsed = new URL(trimmed);
      return rewriteAppsHostUrl(parsed) ?? trimmed;
    } catch {
      return trimmed;
    }
  }

  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed;
  }

  const buildId = getPlayCanvasBuildIdFromUrl(parsed);

  if (!buildId) {
    return trimmed;
  }

  const pathSegments = parsed.pathname.split('/').filter(Boolean);

  if (!pathSegments.length) {
    return trimmed;
  }

  // Drop the build id and any intermediate routing segments (apps.playcanvas.com etc)
  const remainderSegments = (() => {
    if (parsed.hostname === 'apps.playcanvas.com') {
      return pathSegments.slice(1);
    }

    if (parsed.hostname.endsWith('amazonaws.com') && pathSegments[0] === 'apps.playcanvas.com') {
      return pathSegments.slice(2);
    }

    return undefined;
  })();

  if (!remainderSegments?.length) {
    return trimmed;
  }

  const sanitizedSegments = sanitizePathSegments(remainderSegments);

  if (!sanitizedSegments.length) {
    return trimmed;
  }

  const sanitizedPath = sanitizedSegments.join('/');

  const publishUrl = `${location.origin}/p/${buildId}/${sanitizedPath}${parsed.search}${parsed.hash}`;

  return publishUrl;
}

export function buildPlayCanvasAppsHostUrl(rawUrl?: string | null): string | undefined {
  if (!rawUrl) {
    return undefined;
  }

  try {
    const parsed = new URL(rawUrl);
    return rewriteAppsHostUrl(parsed);
  } catch {
    return undefined;
  }
}

function extractFilename(asset: PlayCanvasAssetLike | null | undefined, rawUrl?: string | null): string | undefined {
  const filename = asset?.file?.filename;

  if (filename) {
    return filename;
  }

  if (!rawUrl) {
    return undefined;
  }

  try {
    const parsed = new URL(rawUrl);
    const segments = parsed.pathname.split('/').filter(Boolean);
    return segments.pop() ?? undefined;
  } catch {
    return undefined;
  }
}

function extractRevision(candidate: unknown): string | undefined {
  if (typeof candidate === 'number') {
    return Number.isFinite(candidate) ? String(Math.trunc(candidate)) : undefined;
  }

  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    if (trimmed && /^\d+$/.test(trimmed)) {
      return trimmed;
    }
  }

  return undefined;
}

function guessAssetRevision(asset: PlayCanvasAssetLike | null | undefined): string | undefined {
  if (!asset) {
    return undefined;
  }

  const data = asset.data ?? {};
  const candidates = [
    (data as Record<string, unknown>)?.revision,
    (data as Record<string, unknown>)?.version,
    (data as Record<string, unknown>)?.dataVersion,
    (data as Record<string, unknown>)?.dataRevision,
    (data as Record<string, unknown>)?.rev,
    (data as Record<string, unknown>)?.ver,
    (asset.file as { hash?: string | null } | null | undefined)?.hash,
  ];

  for (const candidate of candidates) {
    const revision = extractRevision(candidate as unknown);
    if (revision) {
      return revision;
    }
  }

  return undefined;
}

function extractBuildIdFromLocation(location: Location): string | undefined {
  const segments = location.pathname.split('/').filter(Boolean);

  if (!segments.length) {
    return undefined;
  }

  const publishIndex = segments.indexOf('p');

  if (publishIndex !== -1 && segments[publishIndex + 1]) {
    return segments[publishIndex + 1];
  }

  return segments[0];
}

export function buildPlayCanvasPublishAssetUrl(
  asset: PlayCanvasAssetLike | null | undefined,
  rawUrl?: string | null,
): string | undefined {
  if (!asset) {
    return undefined;
  }

  const location = getWindowLocation();

  if (!location || !/playcanv\.as$/i.test(location.hostname)) {
    return undefined;
  }

  const origin = location.origin;
  const buildId = extractBuildIdFromLocation(location);

  if (!origin || !buildId) {
    return undefined;
  }

  const assetId = asset.id;

  if (assetId === undefined || assetId === null) {
    return undefined;
  }

  const filename = extractFilename(asset, rawUrl);

  if (!filename) {
    return undefined;
  }

  const revision = guessAssetRevision(asset) ?? '1';

  let url = `${origin}/p/${buildId}/files/assets/${assetId}/${revision}/${filename}`;

  const hash = asset.file?.hash;
  if (hash && typeof hash === 'string' && hash.trim()) {
    const separator = url.includes('?') ? '&' : '?';
    url += `${separator}t=${hash}`;
  }

  return url;
}
