import { cx } from './cx';

export interface ReplayViewerProps {
  /** Path/URL to a replay video. */
  videoPath?: string;
  /** Screenshot thumbnail paths/URLs. */
  screenshots?: string[];
  /** Path/URL to a downloadable trace file. */
  tracePath?: string;
  className?: string;
}

/**
 * Test-replay viewer: an HTML5 video, a screenshot thumbnail gallery, and a
 * trace download link. Renders an empty state when no media is supplied.
 */
export function ReplayViewer({ videoPath, screenshots, tracePath, className }: ReplayViewerProps) {
  const hasScreenshots = !!screenshots && screenshots.length > 0;
  const hasMedia = !!videoPath || hasScreenshots || !!tracePath;

  if (!hasMedia) {
    return (
      <div className={cx('sentinel-replay', 'sentinel-replay--empty', className)}>
        <p className="sentinel-replay-emptytext">No replay media captured for this run.</p>
      </div>
    );
  }

  return (
    <div className={cx('sentinel-replay', className)}>
      {videoPath ? (
        <video
          className="sentinel-replay-video"
          controls
          src={videoPath}
          aria-label="Test replay"
        />
      ) : null}

      {hasScreenshots ? (
        <div className="sentinel-replay-gallery">
          {screenshots!.map((src, i) => (
            <img
              key={`${src}-${i}`}
              className="sentinel-replay-thumb"
              src={src}
              alt={`Screenshot ${i + 1}`}
            />
          ))}
        </div>
      ) : null}

      {tracePath ? (
        <a className="sentinel-replay-trace" href={tracePath} download>
          Download trace
        </a>
      ) : null}
    </div>
  );
}
