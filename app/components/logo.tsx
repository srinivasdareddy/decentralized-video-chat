/** The Zipcall mark: two overlapping drops, drawn in the current text color. */
export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 35" fill="currentColor" aria-hidden="true">
      <path d="M20 29c8-6.915 12-12.582 12-17 0-6.627-5.373-12-12-12S8 5.373 8 12c0 4.418 4 10.085 12 17z" />
      <path
        opacity="0.45"
        transform="matrix(1 0 0 -1 0 35)"
        d="M12 32c8-6.915 12-12.582 12-17 0-6.627-5.373-12-12-12S0 8.373 0 15c0 4.418 4 10.085 12 17z"
      />
    </svg>
  );
}
