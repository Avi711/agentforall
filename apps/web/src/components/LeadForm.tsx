"use client";

import { useState } from "react";
import { trackLead } from "./MetaPixel";

type FormState = "idle" | "submitting" | "success" | "error";

const platforms = [
  { value: "whatsapp", label: "וואטסאפ" },
  { value: "telegram", label: "טלגרם" },
  { value: "both", label: "שניהם" },
];

const interests = [
  { value: "calendar", label: "יומן" },
  { value: "budget", label: "תקציב" },
  { value: "reminders", label: "תזכורות" },
  { value: "research", label: "מחקר" },
  { value: "automation", label: "אוטומציות" },
  { value: "everything", label: "הכל!" },
];

export function LeadForm() {
  const [state, setState] = useState<FormState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [phone, setPhone] = useState("");
  const [platform, setPlatform] = useState("whatsapp");
  const [interest, setInterest] = useState("");

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, "");
    if (val.length > 10) val = val.slice(0, 10);
    if (val.length > 3) val = `${val.slice(0, 3)}-${val.slice(3)}`;
    setPhone(val);
  };

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("submitting");
    setErrorMessage("");

    const form = e.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "");
    const email = String(data.get("email") ?? "");
    const phoneValue = String(data.get("phone") ?? "");
    const eventId = crypto.randomUUID();

    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          phone: phoneValue,
          platform,
          interest,
          eventId,
        }),
      });

      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        duplicate?: boolean;
      };

      if (!res.ok) {
        throw new Error(body.error || "משהו השתבש");
      }

      setState("success");
      if (!body.duplicate) {
        trackLead({ eventId, email, phone: phoneValue, name });
      }
      form.reset();
    } catch (err) {
      setState("error");
      setErrorMessage(err instanceof Error ? err.message : "משהו השתבש");
    }
  }

  if (state === "success") {
    return (
      <section id="signup" className="px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-lg text-center">
          <div className="mb-6 inline-flex h-20 w-20 items-center justify-center rounded-full bg-sage-pale text-4xl">
            🎉
          </div>
          <h2 className="text-3xl font-black text-espresso">
            אתם ברשימה!
          </h2>
          <p className="mt-3 text-lg text-espresso-light">
            ניצור איתכם קשר ברגע שהסוכן שלכם יהיה מוכן. עקבו אחרי תיבת המייל.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section id="signup" className="grain relative overflow-hidden px-5 py-24 sm:px-8">
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-cream to-terra-pale/40" />

      <div className="mx-auto max-w-6xl">
        <div className="grid items-start gap-12 lg:grid-cols-[1fr_1fr] lg:gap-20">
          {/* Left side - copy */}
          <div>
            <h2 className="font-display text-4xl font-black leading-[1.05] tracking-tight text-espresso sm:text-5xl">
              הצטרפו
              <br />
              <span className="text-terra">לרשימת ההמתנה</span>
            </h2>
            <p className="mt-5 text-lg font-light leading-relaxed text-espresso-light">
              הצטרפו לרשימת ההמתנה וקבלו גישה מוקדמת לסוכן AI אישי משלכם. השאירו פרטים ואנחנו נסדר הכל בשבילכם.
            </p>

            <div className="mt-8 space-y-4">
              {[
                "הקמה תוך דקות — בלי להתקין כלום",
                "סוכן פרטי על שרת מאובטח, נתונים בישראל/אירופה",
                "החל מ-199 ש״ח/חודש (כולל מע״מ) — לפי שימוש",
                "תעריף מייסדים מיוחד למצטרפים מרשימת ההמתנה",
              ].map((item) => (
                <div key={item} className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sage text-white">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <span className="text-base text-espresso">{item}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right side - form */}
          <div className="rounded-3xl border border-sand/40 bg-white/80 p-6 shadow-xl shadow-espresso/5 backdrop-blur-sm sm:p-8">
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Name */}
              <div>
                <label htmlFor="name" className="mb-2 block text-sm font-bold text-espresso">
                  שם מלא
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  className="w-full rounded-xl border-0 bg-cream px-5 py-4 text-base text-espresso ring-1 ring-sand/50 transition-all placeholder:text-espresso-light/40 focus:ring-2 focus:ring-terra focus:outline-none"
                  placeholder="השם שלכם"
                />
              </div>

              {/* Email */}
              <div>
                <label htmlFor="email" className="mb-2 block text-sm font-bold text-espresso">
                  אימייל
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  dir="ltr"
                  className="w-full rounded-xl border-0 bg-cream px-5 py-4 text-base text-espresso ring-1 ring-sand/50 transition-all placeholder:text-espresso-light/40 focus:ring-2 focus:ring-terra focus:outline-none"
                  placeholder="you@example.com"
                />
              </div>

              {/* Phone */}
              <div>
                <label htmlFor="phone" className="mb-2 block text-sm font-bold text-espresso">
                  טלפון
                </label>
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  required
                  value={phone}
                  onChange={handlePhoneChange}
                  pattern="^05[0-9]-[0-9]{7}$"
                  title="מספר הטלפון חייב להיות בן 10 ספרות ולהתחיל ב-05 (למשל 050-1234567)"
                  dir="ltr"
                  className="w-full rounded-xl border-0 bg-cream px-5 py-4 text-base text-espresso ring-1 ring-sand/50 transition-all placeholder:text-espresso-light/40 focus:ring-2 focus:ring-terra focus:outline-none"
                  placeholder="050-0000000"
                />
              </div>

              {/* Platform - pill selector */}
              <div>
                <label className="mb-3 block text-sm font-bold text-espresso">
                  איפה רוצים את הסוכן?
                </label>
                <div className="flex gap-2">
                  {platforms.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setPlatform(p.value)}
                      className={`flex-1 rounded-xl px-3 py-3.5 text-center text-sm font-bold transition-all ${
                        platform === p.value
                          ? "bg-espresso text-cream shadow-md"
                          : "bg-cream text-espresso-light ring-1 ring-sand/50 hover:ring-sand"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                {(platform === "whatsapp" || platform === "both") && (
                  <p className="mt-2.5 flex items-start gap-2 rounded-xl bg-cream-dark/60 px-3.5 py-2.5 text-xs leading-relaxed text-espresso-light">
                    <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-terra" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    לוואטסאפ של הסוכן צריך מספר ייעודי. יש לכם? מעולה. אין? נסדר לכם.
                  </p>
                )}
              </div>

              {/* Interest - chip selector */}
              <div>
                <label className="mb-3 block text-sm font-bold text-espresso">
                  מה הכי מעניין אתכם?
                </label>
                <div className="flex flex-wrap gap-2">
                  {interests.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setInterest(interest === item.value ? "" : item.value)}
                      className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
                        interest === item.value
                          ? "bg-terra text-white shadow-md"
                          : "bg-cream text-espresso-light ring-1 ring-sand/50 hover:ring-sand"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {state === "error" && (
                <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                  {errorMessage}
                </div>
              )}

              <button
                type="submit"
                disabled={state === "submitting"}
                className="w-full rounded-xl bg-terra px-8 py-4 text-lg font-bold text-white transition-all hover:bg-espresso hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
              >
                {state === "submitting" ? "שולח..." : "שמרו לי מקום ברשימה"}
              </button>

              <p className="text-center text-xs text-espresso-light/60">
                בלי ספאם. פרטיות מלאה. תמיד.
              </p>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}
