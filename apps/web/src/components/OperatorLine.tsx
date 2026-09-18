import { SITE_EMAIL, SITE_LOCATION, SITE_NAME } from "@/lib/site";

export function OperatorLine() {
  return (
    <>
      {SITE_NAME}, {SITE_LOCATION}. דוא״ל:{" "}
      <a href={`mailto:${SITE_EMAIL}`} className="hover:underline" dir="ltr">
        {SITE_EMAIL}
      </a>
    </>
  );
}
