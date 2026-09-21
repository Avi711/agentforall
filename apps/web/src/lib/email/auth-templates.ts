import type { OutgoingEmail } from "./client";
import { EMAIL_VERIFICATION_TTL_HOURS, RESET_PASSWORD_TTL_MINUTES } from "../auth/policy";

interface Layout {
  subject: string;
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  footnote: string;
}

// No names anywhere: whoever signs up picks one, and the mail may land in someone else's inbox.
export function verifyEmail(to: string, url: string): OutgoingEmail {
  return render(to, {
    subject: "אישור כתובת המייל שלכם",
    heading: "ברוכים הבאים",
    paragraphs: [
      "כדי לסיים את ההרשמה, לחצו על הכפתור והזינו את הסיסמה שבחרתם בהרשמה. כך נדע שזו באמת ההרשמה שלכם.",
    ],
    action: { label: "אישור הכתובת", url },
    footnote: `הקישור בתוקף ל-${EMAIL_VERIFICATION_TTL_HOURS} שעות. לא נרשמתם? התעלמו מהמייל הזה.`,
  });
}

export function resetPasswordEmail(to: string, url: string): OutgoingEmail {
  return render(to, {
    subject: "בחירת סיסמה חדשה",
    heading: "בחירת סיסמה חדשה",
    paragraphs: ["לחצו על הכפתור כדי לבחור סיסמה חדשה. זה גם יאשר את כתובת המייל, אם עוד לא אושרה."],
    action: { label: "בחירת סיסמה חדשה", url },
    footnote: `הקישור בתוקף ל-${RESET_PASSWORD_TTL_MINUTES} דקות. לא ביקשתם? התעלמו מהמייל הזה, והסיסמה לא תשתנה.`,
  });
}

export function existingAccountEmail(to: string, loginUrl: string, verified: boolean): OutgoingEmail {
  return render(to, {
    subject: "כבר יש לכם חשבון",
    heading: "כבר יש לכם חשבון",
    paragraphs: verified
      ? [
          "קיבלנו בקשת הרשמה עם הכתובת הזו, אבל כבר יש לה חשבון.",
          "היכנסו כרגיל, עם הסיסמה או בכפתור של גוגל. שכחתם סיסמה? בחרו ״שכחתי סיסמה״ במסך הכניסה.",
        ]
      : [
          "קיבלנו בקשת הרשמה עם הכתובת הזו, אבל כבר יש לה הרשמה שעוד לא אושרה.",
          "היכנסו עם הסיסמה שבחרתם, ותוכלו לבקש קישור אישור חדש. שכחתם אותה, או שלא אתם נרשמתם? בחרו ״שכחתי סיסמה״ וקבעו סיסמה חדשה.",
        ],
    action: { label: "למסך הכניסה", url: loginUrl },
    footnote: "לא ביקשתם? אין צורך לעשות דבר.",
  });
}

export function passwordChangedEmail(to: string, loginUrl: string): OutgoingEmail {
  return render(to, {
    subject: "הסיסמה שלכם שונתה",
    heading: "הסיסמה שונתה",
    paragraphs: ["הסיסמה לחשבון שלכם שונתה עכשיו, וכל המכשירים המחוברים נותקו."],
    action: { label: "למסך הכניסה", url: loginUrl },
    footnote: "לא אתם? בחרו מיד ״שכחתי סיסמה״ במסך הכניסה וקבעו סיסמה חדשה.",
  });
}

function render(to: string, layout: Layout): OutgoingEmail {
  const button = layout.action
    ? `<p style="margin:28px 0"><a href="${escapeHtml(layout.action.url)}" style="display:inline-block;background:#2C1810;color:#FBF8F3;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:10px">${escapeHtml(layout.action.label)}</a></p>
<p style="margin:0 0 20px;font-size:13px;color:#5C4033">הכפתור לא עובד? העתיקו את הקישור לדפדפן:<br><span dir="ltr" style="word-break:break-all">${escapeHtml(layout.action.url)}</span></p>`
    : "";
  const paragraphs = layout.paragraphs
    .map((p) => `<p style="margin:0 0 14px;line-height:1.6">${escapeHtml(p)}</p>`)
    .join("");

  const html = `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(layout.subject)}</title></head>
<body style="margin:0;background:#FBF8F3;font-family:Arial,Helvetica,sans-serif;color:#2C1810">
<div dir="rtl" style="max-width:520px;margin:0 auto;padding:32px 20px;text-align:right">
<p style="margin:0 0 4px;font-weight:700;font-size:18px">Agent For All</p>
<p style="margin:0 0 24px;font-size:13px;color:#5C4033">הסוכן האישי שלכם בוואטסאפ ובטלגרם.</p>
<div style="background:#ffffff;border:1px solid #E8DCC8;border-radius:16px;padding:28px 24px">
<h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(layout.heading)}</h1>
${paragraphs}${button}
<p style="margin:0;font-size:13px;color:#5C4033;line-height:1.6">${escapeHtml(layout.footnote)}</p>
</div></div></body></html>`;

  const text = [
    layout.heading,
    "",
    ...layout.paragraphs,
    ...(layout.action ? ["", `${layout.action.label}: ${layout.action.url}`] : []),
    "",
    layout.footnote,
  ].join("\n");

  return { to, subject: layout.subject, html, text };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
