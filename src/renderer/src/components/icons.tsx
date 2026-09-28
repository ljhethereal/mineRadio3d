export const HeartIcon = ({ active = false, size = 18 }: { active?: boolean; size?: number }) => (
  <svg
    className="heart-svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={active ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth={active ? '0' : '2'}
  >
    <path d="M12 21.45c-.32 0-.62-.12-.86-.34l-1.23-1.12C5.54 16.03 2.25 13.05 2.25 8.9 2.25 5.48 4.88 2.9 8.28 2.9c1.7 0 3.35.72 4.52 1.96C13.97 3.62 15.62 2.9 17.32 2.9c3.4 0 6.03 2.58 6.03 6 0 4.15-3.29 7.13-7.66 11.09l-1.23 1.12c-.24.22-.54.34-.86.34z" />
  </svg>
)

export const PlusIcon = ({ size = 16 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.4}
    strokeLinecap="round"
  >
    <path d="M12 5v14M5 12h14" />
  </svg>
)