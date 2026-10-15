export function GlobeIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.4 2.5 3.5 5.5 3.5 9s-1.1 6.5-3.5 9c-2.4-2.5-3.5-5.5-3.5-9S9.6 5.5 12 3Z" />
    </svg>
  );
}

export function EyeIcon({ visible }: { visible: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {visible ? (
        <>
          <path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M7 7c-2.1 1.4-3.5 3.3-4 5 1.5 4 5 7 9 7 1.8 0 3.4-.5 4.8-1.4M10 5.2c.7-.1 1.3-.2 2-.2 4 0 7.5 3 9 7-.5 1.5-1.5 3-2.7 4.2" />
        </>
      ) : (
        <>
          <path d="M3 12c1.5-4 5-7 9-7s7.5 3 9 7c-1.5 4-5 7-9 7s-7.5-3-9-7Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}
