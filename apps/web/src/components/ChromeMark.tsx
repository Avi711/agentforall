export function ChromeMark({ className = "h-[22px] w-[22px]" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className={`shrink-0 ${className}`}>
      <path fill="#EA4335" d="M24 13.5H43.333A22 22 0 0 0 5.24 12.507L14.907 29.25A10.5 10.5 0 0 1 24 13.5Z" />
      <path fill="#FBBC05" d="M24 13.5H43.333A22 22 0 0 1 23.426 45.993L33.093 29.25A10.5 10.5 0 0 0 24 13.5Z" />
      <path fill="#34A853" d="M33.093 29.25L23.426 45.993A22 22 0 0 1 5.24 12.507L14.907 29.25A10.5 10.5 0 0 0 33.093 29.25Z" />
      <circle cx="24" cy="24" r="10.5" fill="#fff" />
      <circle cx="24" cy="24" r="8.5" fill="#4285F4" />
    </svg>
  );
}
