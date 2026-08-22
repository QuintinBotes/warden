// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ReplayViewer } from './ReplayViewer';

afterEach(cleanup);

describe('ReplayViewer', () => {
  it('renders a video element when a videoPath is given', () => {
    const { container } = render(<ReplayViewer videoPath="/runs/482/replay.webm" />);
    const video = container.querySelector('video')!;
    expect(video).toBeInTheDocument();
    expect(video).toHaveAttribute('src', '/runs/482/replay.webm');
    expect(video).toHaveAttribute('controls');
  });

  it('renders a screenshot gallery and a trace download link', () => {
    render(<ReplayViewer screenshots={['/a.png', '/b.png']} tracePath="/runs/482/trace.zip" />);
    expect(screen.getByAltText('Screenshot 1')).toBeInTheDocument();
    expect(screen.getByAltText('Screenshot 2')).toBeInTheDocument();
    const trace = screen.getByText('Download trace');
    expect(trace).toHaveAttribute('href', '/runs/482/trace.zip');
    expect(trace).toHaveAttribute('download');
  });

  it('shows an empty state when no media is supplied', () => {
    const { container } = render(<ReplayViewer />);
    expect(container.querySelector('video')).toBeNull();
    expect(screen.getByText(/No replay media/i)).toBeInTheDocument();
    expect(container.querySelector('.sentinel-replay--empty')).toBeInTheDocument();
  });

  it('blames the test, not the run, when only this test is missing media', () => {
    render(<ReplayViewer />);
    expect(screen.getByText('No replay media captured for this test.')).toBeInTheDocument();
  });

  it('says the run captured nothing, and what does capture media, when scoped to the run', () => {
    render(<ReplayViewer emptyScope="run" />);
    expect(
      screen.getByText('No replay media was captured anywhere in this run.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Playwright run with screenshots or tracing/i)).toBeInTheDocument();
    expect(screen.getByText(/Vitest capture none/i)).toBeInTheDocument();
  });
});
