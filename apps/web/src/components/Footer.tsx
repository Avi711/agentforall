export function Footer() {
  return (
    <footer className="border-t border-sand/30 px-5 py-12 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 sm:flex-row">
        <span className="text-lg font-black tracking-tight text-espresso">
          Agent<span className="text-terra">ForAll</span>
        </span>
        <p className="text-sm text-espresso-light">
          &copy; {new Date().getFullYear()} Agent For All. כל הזכויות שמורות.
        </p>
      </div>
    </footer>
  );
}
