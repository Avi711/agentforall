import type { ReactNode } from "react";

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-cream flex items-center justify-center px-4 sm:px-6 py-12 sm:py-16">
      <div className="w-full max-w-md">
        <div className="mb-8 sm:mb-10 text-center">
          <h1 className="font-display text-3xl sm:text-4xl text-espresso text-balance">{title}</h1>
          {subtitle ? <p className="mt-3 text-espresso-light">{subtitle}</p> : null}
        </div>
        <div className="bg-white rounded-2xl shadow-lg p-5 sm:p-8 border border-sand-light">{children}</div>
      </div>
    </main>
  );
}
