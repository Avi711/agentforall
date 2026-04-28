export function ESimCard() {
  const partnerUrl = process.env.NEXT_PUBLIC_ESIM_PARTNER_URL;
  return (
    <aside className="rounded-xl border border-sage-light bg-sage-pale p-5 flex gap-4 items-start">
      <span aria-hidden className="text-3xl select-none leading-none">
        📱
      </span>
      <div className="flex-1 space-y-2">
        <h3 className="font-display text-lg text-espresso">
          מומלץ: מספר ייעודי לבוט
        </h3>
        <p className="text-sm text-espresso-light">
          eSIM ייעודית או סים משני מוציאים את הסיכון מהמספר האישי שלכם. אם WhatsApp
          ישעה את המספר של הבוט — חשבון הוואטסאפ האישי שלכם ממשיך כרגיל.
        </p>
        {partnerUrl ? (
          <a
            href={partnerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-sm font-medium text-sage-dark underline underline-offset-4 hover:no-underline"
          >
            מעבר לקבלת eSIM ישראלית ←
          </a>
        ) : null}
      </div>
    </aside>
  );
}
