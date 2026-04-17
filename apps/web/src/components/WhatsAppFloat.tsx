import { WhatsAppIcon } from "./WhatsAppIcon";

export function WhatsAppFloat() {
  return (
    <a
      href="https://wa.me/972552506938"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="צור קשר בוואטסאפ (נפתח בחלון חדש)"
      className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg shadow-black/20 transition hover:scale-105 hover:bg-[#1ebd5a] sm:bottom-6 sm:right-6 sm:h-16 sm:w-16"
    >
      <WhatsAppIcon className="h-7 w-7 sm:h-8 sm:w-8" />
    </a>
  );
}
