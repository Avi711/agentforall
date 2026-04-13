export function ChatMockup() {
  return (
    <div className="animate-float mx-auto w-full max-w-[320px]" dir="ltr">
      {/* Phone frame */}
      <div className="overflow-hidden rounded-[2.5rem] border-[3px] border-espresso/10 bg-white shadow-2xl shadow-espresso/10">
        {/* Status bar */}
        <div className="flex items-center justify-between bg-wa-dark px-5 pt-3 pb-1 text-[11px] text-white/80">
          <span className="font-medium">9:41</span>
          <div className="flex items-center gap-1.5">
            <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24"><path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3a4.237 4.237 0 00-6 0zm-4-4l2 2a7.074 7.074 0 0110 0l2-2C15.14 9.14 8.87 9.14 5 13z"/></svg>
            <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M15.67 4H14V2h-4v2H8.33C7.6 4 7 4.6 7 5.33v15.33C7 21.4 7.6 22 8.33 22h7.33c.74 0 1.34-.6 1.34-1.33V5.33C17 4.6 16.4 4 15.67 4z"/></svg>
          </div>
        </div>

        {/* WhatsApp header */}
        <div className="flex items-center gap-3 bg-wa-dark px-4 pb-3">
          <svg className="h-5 w-5 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-wa-green to-wa-dark text-sm font-bold text-white">
            ס
          </div>
          <div className="flex-1">
            <p className="text-[15px] font-semibold text-white">הסוכן שלי</p>
            <p className="text-[12px] text-wa-green">מקליד...</p>
          </div>
          <div className="flex items-center gap-4 text-white/70">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
          </div>
        </div>

        {/* Chat wallpaper + messages */}
        <div
          className="space-y-1.5 px-3 py-4"
          dir="rtl"
          style={{
            backgroundColor: "#ECE5DD",
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23c8c3ba' fill-opacity='0.15'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
        >
          <MessageOut text="מה יש לי היום?" time="09:41" />
          <MessageIn
            text="בוקר טוב! יש לך 3 פגישות היום. הראשונה ב-10:00 עם צוות העיצוב. אל תשכח — היום יום הולדת של שרה, כבר הכנתי טיוטה של הודעה."
            time="09:41"
          />
          <MessageOut text="תשלח. וכמה הוצאתי השבוע?" time="09:42" />
          <MessageIn
            text="הודעת יום הולדת נשלחה! השבוע הוצאת 1,250 ש״ח — 15% מתחת לתקציב השבועי. כל הכבוד."
            time="09:42"
          />
        </div>

        {/* Input bar */}
        <div className="flex items-center gap-2 bg-[#F0F0F0] px-3 py-2">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-wa-green">
            <svg className="h-5 w-5 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 15c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v7c0 1.66 1.34 3 3 3z"/>
              <path d="M17.3 12c0 3-2.54 5.1-5.3 5.1S6.7 15 6.7 12H5c0 3.41 2.72 6.23 6 6.72V22h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/>
            </svg>
          </div>
          <div className="flex-1 rounded-full bg-white px-4 py-2.5 text-end text-[14px] text-gray-400" dir="rtl">
            הקלידו הודעה
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageOut({ text, time }: { text: string; time: string }) {
  return (
    <div className="flex justify-end">
      <div className="relative max-w-[80%] rounded-lg rounded-tl-none bg-wa-light px-3 pt-2 pb-4 text-[14px] leading-relaxed text-espresso shadow-sm">
        {text}
        <span className="absolute bottom-1 left-2 text-[10px] text-gray-500">{time}</span>
        <svg className="absolute bottom-1 left-8 h-3 w-3 text-blue-500" viewBox="0 0 16 11" fill="currentColor">
          <path d="M11.071.653a.457.457 0 0 0-.304-.102.493.493 0 0 0-.381.178l-6.19 7.636-2.011-2.095a.463.463 0 0 0-.659.003.41.41 0 0 0 .003.611l2.355 2.453a.453.453 0 0 0 .659-.003l6.525-8.055a.41.41 0 0 0 .003-.611v-.015z"/>
          <path d="M14.071.653a.457.457 0 0 0-.304-.102.493.493 0 0 0-.381.178l-6.19 7.636-2.011-2.095a.463.463 0 0 0-.659.003.41.41 0 0 0 .003.611l2.355 2.453a.453.453 0 0 0 .659-.003l6.525-8.055a.41.41 0 0 0 .003-.611v-.015z"/>
        </svg>
      </div>
    </div>
  );
}

function MessageIn({ text, time }: { text: string; time: string }) {
  return (
    <div className="flex justify-start">
      <div className="relative max-w-[80%] rounded-lg rounded-tr-none bg-white px-3 pt-2 pb-4 text-[14px] leading-relaxed text-espresso shadow-sm">
        {text}
        <span className="absolute bottom-1 left-2 text-[10px] text-gray-500">{time}</span>
      </div>
    </div>
  );
}
