import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-sand/30 bg-cream-dark/20 px-5 py-12 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-8 sm:grid-cols-[1.5fr_1fr_1fr]">
          {/* Brand */}
          <div>
            <span className="text-xl tracking-tight text-espresso" style={{ letterSpacing: '-0.02em' }}>
              <span className="font-extrabold">Agent</span><span className="font-normal text-espresso-light">for</span><span className="font-extrabold text-terra">All</span>
            </span>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-espresso-light">
              סוכן AI אישי בוואטסאפ וטלגרם. מ-199 ש״ח לחודש, כולל מע״מ.
            </p>
          </div>

          {/* Product */}
          <div>
            <h3 className="mb-3 text-sm font-bold text-espresso">המוצר</h3>
            <ul className="space-y-2 text-sm text-espresso-light">
              <li><Link href="/#features" className="transition hover:text-terra">יכולות</Link></li>
              <li><Link href="/#how-it-works" className="transition hover:text-terra">איך זה עובד</Link></li>
              <li><Link href="/#faq" className="transition hover:text-terra">שאלות נפוצות</Link></li>
              <li><Link href="/#signup" className="transition hover:text-terra">הצטרפו לרשימה</Link></li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h3 className="mb-3 text-sm font-bold text-espresso">משפטי</h3>
            <ul className="space-y-2 text-sm text-espresso-light">
              <li><Link href="/terms" className="transition hover:text-terra">תנאי שימוש</Link></li>
              <li><Link href="/privacy" className="transition hover:text-terra">מדיניות פרטיות</Link></li>
              <li><Link href="/accessibility" className="transition hover:text-terra">הצהרת נגישות</Link></li>
              <li>
                <a href="https://wa.me/972552506938" target="_blank" rel="noopener noreferrer" className="transition hover:text-terra">
                  צור קשר
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-sand/30 pt-6 text-xs text-espresso-light/80 sm:flex-row">
          <p>
            &copy; {new Date().getFullYear()} Agent For All. כל הזכויות שמורות.
          </p>
          <p>
            מחירים כוללים מע״מ · תמיכה בעברית · שירות ישראלי
          </p>
        </div>
      </div>
    </footer>
  );
}
