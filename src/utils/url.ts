export function normalizePlayCanvasAssetUrl(rawUrl?: string | null): string | undefined {
  if (!rawUrl) {
    return undefined;
  }

  let normalized = rawUrl.trim();
  if (!normalized) {
    return undefined;
  }

  if (typeof window !== 'undefined') {
    try {
      const location = window.location;

      if (location && location.hostname === 'playcanv.as') {
        const publishMatch = location.pathname.match(/^\/p\/([^/]+)\//);

        if (publishMatch) {
          const buildId = publishMatch[1];

          try {
            const parsed = new URL(normalized);

            const hostname = parsed.hostname;
            const pathSegments = parsed.pathname.split('/').filter(Boolean);

            let buildIndex = 0;

            if (hostname.endsWith('playcanvas.com')) {
              buildIndex = 0;
            } else if (
              hostname.endsWith('amazonaws.com') &&
              pathSegments.length >= 2 &&
              pathSegments[0] === 'apps.playcanvas.com'
            ) {
              buildIndex = 1;
            } else {
              buildIndex = -1;
            }

            if (buildIndex >= 0 && pathSegments.length > buildIndex) {
              const candidateBuildId = pathSegments[buildIndex];

              if (candidateBuildId === buildId) {
                const remainder = pathSegments
                  .slice(buildIndex + 1)
                  .filter(segment => segment !== '.')
                  .join('/');

                if (remainder) {
                  normalized = `${location.origin}/p/${buildId}/${remainder}${parsed.search}${parsed.hash}`;
                }

              }
            }
          } catch (absoluteError) {
            // Ignore parsing failures for non-absolute URLs
          }
        }
      }
    } catch (error) {
      // In non-browser or restricted environments, fall back to the original URL
    }
  }

  return normalized;
}
