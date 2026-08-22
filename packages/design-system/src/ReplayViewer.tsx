import { cx } from './cx';

export interface ReplayViewerProps {
  /** Path/URL to a replay video. */
  videoPath?: string;
  /** Screenshot thumbnail paths/URLs. */
  screenshots?: string[];
  /** Path/URL to a downloadable trace file. */
  tracePath?: string;
  /**
   * What an absence of media is about — two different facts that read differently.
   *
   * `'test'` (default): the run captured media, this test did not. `'run'`: no test in the
   * run captured any, which is not a gap in one result but a property of the runner, so the
   * empty state says that about the run and names what does produce media.
   */
  emptyScope?: 'test' | 'run';
  className?: string;
}

/**
 * Test-replay viewer: an HTML5 video, a screenshot thumbnail gallery, and a
 * trace download link. Renders an empty state when no media is supplied.
 */
export function ReplayViewer({
  videoPath,
  screenshots,
  tracePath,
  emptyScope = 'test',
  className,
}: ReplayViewerProps) {
  const hasScreenshots = !!screenshots && screenshots.length > 0;
  const hasMedia = !!videoPath || hasScreenshots || !!tracePath;

  if (!hasMedia) {
    return (
      <div
        className={cx('sentinel-replay', 'sentinel-replay--empty', className)}
        data-empty-scope={emptyScope}
      >
        {emptyScope === 'run' ? (
          <>
            <p className="sentinel-replay-emptytext">
              No replay media was captured anywhere in this run.
            </p>
            <p className="sentinel-replay-emptyhint">
              Screenshots, video and traces come from a runner that captures them — a Playwright run
              with screenshots or tracing turned on. Unit runners such as Vitest capture none, so
              this panel stays empty for them.
            </p>
          </>
        ) : (
          <p className="sentinel-replay-emptytext">No replay media captured for this test.</p>
        )}
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
