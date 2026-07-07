/**
 * The Warden portcullis mark — an arched frame over seven spiked vertical bars.
 * A gate of falling bars: the medieval warden's last line of defense, and the
 * verdict shape of the quality gate. Fills with `currentColor`.
 */
export interface PortcullisLogoProps {
  /** Rendered width/height in px. Defaults to 24. */
  size?: number;
  /** Accessible title. When omitted the mark is decorative (aria-hidden). */
  title?: string;
  className?: string;
}

export function PortcullisLogo({ size = 24, title, className }: PortcullisLogoProps) {
  const labelled = typeof title === 'string' && title.length > 0;
  return (
    <svg
      className={['sentinel-portcullis', className].filter(Boolean).join(' ')}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="currentColor"
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? title : undefined}
      aria-hidden={labelled ? undefined : true}
    >
      {labelled ? <title>{title}</title> : null}
      {/* arched keystone frame */}
      <path
        d="M8 17 Q8 9 24 9 Q40 9 40 17"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        opacity={0.9}
      />
      {/* two horizontal rails */}
      <rect x="8" y="16" width="32" height="2.6" />
      <rect x="8" y="25" width="32" height="2.2" />
      {/* spiked vertical bars — read as a gate at 16px, as chart columns at 320px */}
      <path d="M10.5 16 h2.4 v18 l-1.2 3 -1.2 -3 z" />
      <path d="M16.8 16 h2.4 v18 l-1.2 3 -1.2 -3 z" />
      <path d="M23.1 16 h2.4 v18 l-1.2 3 -1.2 -3 z" />
      <path d="M29.4 16 h2.4 v18 l-1.2 3 -1.2 -3 z" />
      <path d="M35.7 16 h2.4 v18 l-1.2 3 -1.2 -3 z" transform="translate(-.5 0)" />
    </svg>
  );
}
