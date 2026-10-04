/**
 * Minimal inline-SVG icon set (stroke-based, inherits currentColor). Matches
 * the line-icon style of the CX mocks. Keeping them inline avoids an icon-font
 * dependency and keeps bundle size small.
 */
export interface IconProps {
  size?: number;
  strokeWidth?: number;
  'aria-hidden'?: boolean;
}

function svg(path: React.ReactNode, { size = 24, strokeWidth = 1.8 }: IconProps = {}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {path}
    </svg>
  );
}

export const HomeIcon = (p: IconProps) =>
  svg(
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </>,
    p
  );

export const ChartIcon = (p: IconProps) =>
  svg(
    <>
      <path d="M5 4v16h16" />
      <path d="M8 15v2M12 11v6M16 7v10" />
    </>,
    p
  );

export const ChatIcon = (p: IconProps) => svg(<path d="M4 5h16v11H9l-5 4V5Z" />, p);

export const CareTeamIcon = (p: IconProps) =>
  svg(<path d="M12 3l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V6l7-3Z" />, p);

export const ProfileIcon = (p: IconProps) =>
  svg(
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20c.6-3.3 3-5 5.5-5s4.9 1.7 5.5 5" />
      <path d="M17 9h4M19 7v4" />
    </>,
    p
  );

export const PlusIcon = (p: IconProps) =>
  svg(
    <>
      <path d="M12 5v14M5 12h14" />
    </>,
    p
  );

export const ArrowRightIcon = (p: IconProps) =>
  svg(
    <>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </>,
    p
  );

export const ArrowLeftIcon = (p: IconProps) =>
  svg(
    <>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </>,
    p
  );

export const ShieldCheckIcon = (p: IconProps) =>
  svg(
    <>
      <path d="M12 3l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V6l7-3Z" />
      <path d="M9 12l2 2 4-4" />
    </>,
    p
  );

export const GlobeIcon = (p: IconProps) =>
  svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
    </>,
    p
  );

export const HospitalIcon = (p: IconProps) =>
  svg(
    <>
      <rect x="5" y="4" width="14" height="17" rx="1.5" />
      <path d="M12 8v4M10 10h4M9 21v-3h6v3" />
    </>,
    p
  );

export const PillIcon = (p: IconProps) =>
  svg(
    <>
      <rect x="3" y="8" width="18" height="8" rx="4" transform="rotate(45 12 12)" />
      <path d="M9 9l6 6" />
    </>,
    p
  );

export const CheckCircleIcon = (p: IconProps) =>
  svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12l2.5 2.5L16 9" />
    </>,
    p
  );
