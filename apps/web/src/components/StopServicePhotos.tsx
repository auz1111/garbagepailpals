import { useEffect, useState } from "react";
import type { StopServiceVerificationItem } from "@gpp/shared";
import { fetchServicePhotoUrl } from "../lib/api";

// Shows the verification photos an operator captured for a serviced stop, grouped
// by item (e.g. "1 Trash", "Pet waste"). Photos live in a private blob container,
// so each is fetched through the auth-gated API into an object URL for display.
export function StopServicePhotos({
  verification,
  accessToken
}: {
  verification: StopServiceVerificationItem[];
  accessToken: string;
}): JSX.Element | null {
  const paths = verification.flatMap((v) => v.photoBlobPaths);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});

  // Fetch each photo once; revoke the object URLs on unmount / change.
  useEffect(() => {
    let active = true;
    const made: string[] = [];
    void (async () => {
      for (const path of paths) {
        try {
          const url = await fetchServicePhotoUrl(path, accessToken);
          if (!active) {
            URL.revokeObjectURL(url);
            return;
          }
          made.push(url);
          setUrls((prev) => ({ ...prev, [path]: url }));
        } catch {
          // Blob missing/unreadable — mark it so we show an "unavailable" tile
          // instead of a perpetual loading placeholder.
          if (active) setFailed((prev) => ({ ...prev, [path]: true }));
        }
      }
    })();
    return () => {
      active = false;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths.join("|"), accessToken]);

  if (paths.length === 0) {
    return null;
  }

  return (
    <div className="stop-photos">
      {verification
        .filter((v) => v.photoBlobPaths.length > 0)
        .map((v) => (
          <div className="stop-photo-group" key={v.key}>
            <span className="stop-photo-label">{v.label}</span>
            <div className="stop-photo-thumbs">
              {v.photoBlobPaths.map((path) =>
                urls[path] ? (
                  <a
                    key={path}
                    href={urls[path]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="stop-photo-thumb"
                  >
                    <img src={urls[path]} alt={`${v.label} verification`} loading="lazy" />
                  </a>
                ) : failed[path] ? (
                  <span
                    key={path}
                    className="stop-photo-thumb is-unavailable"
                    title="Photo unavailable"
                  >
                    ⚠︎
                  </span>
                ) : (
                  <span key={path} className="stop-photo-thumb is-loading" aria-hidden="true" />
                )
              )}
            </div>
          </div>
        ))}
    </div>
  );
}
