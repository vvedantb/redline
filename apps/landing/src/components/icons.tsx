type IconProps = { size?: number };

/** The Redline mark: a small outlined square, like an overlay outline. */
export function Mark({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="12" height="12" rx="2" stroke="var(--accent)" strokeWidth="2" />
      <rect x="4.5" y="4.5" width="5" height="5" rx="1" fill="var(--accent)" />
    </svg>
  );
}

export function SunIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" strokeLinecap="round" />
    </svg>
  );
}

export function MoonIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
      <path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z" strokeLinejoin="round" />
    </svg>
  );
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false } as const;

export function CompareIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="5" width="8" height="14" rx="1.5" />
      <rect x="13" y="5" width="8" height="14" rx="1.5" />
    </svg>
  );
}

export function OverlayIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="3 3" />
      <rect x="8" y="8" width="8" height="8" rx="1" />
    </svg>
  );
}

export function HistoryIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="M4 12a8 8 0 108-8 8 8 0 00-6 2.7L4 9" />
      <path d="M4 4v5h5M12 8v4l3 2" />
    </svg>
  );
}

export function ReportIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v4h4M10 12h5M10 16h5" />
    </svg>
  );
}
