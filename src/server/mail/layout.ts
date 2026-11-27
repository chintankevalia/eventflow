/**
 * Branded email layout. Table-based with inline styles so it renders in Outlook, Gmail and mobile clients.
 * Header/footer follow the PRD document style (motadata wordmark, www.motadata.com | support@motadata.com).
 */

export function appUrl(pathname = "/") {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}${pathname}`;
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type LayoutInput = {
  preheader: string;
  heading: string;
  paragraphs: string[]; // already escaped / trusted HTML
  action?: { label: string; url: string };
  /** Table rows replacing the single action button, for emails that offer more than one choice. */
  actionsHtml?: string;
  footnote?: string;
};

export function renderEmail({ preheader, heading, paragraphs, action, actionsHtml, footnote }: LayoutInput) {
  const button =
    actionsHtml ??
    (action
      ? `<tr><td style="padding:8px 0 24px">
         <a href="${escapeHtml(action.url)}" style="display:inline-block;background:#F17463;color:#ffffff;font-weight:600;font-size:15px;text-decoration:none;padding:12px 24px;border-radius:8px">${escapeHtml(action.label)}</a>
       </td></tr>
       <tr><td style="padding:0 0 24px;font-size:12px;color:#6b7280;line-height:1.5">
         If the button does not work, copy this link into your browser:<br>
         <span style="color:#0f172a;word-break:break-all">${escapeHtml(action.url)}</span>
       </td></tr>`
      : "");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:#f7f8fa;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8fa;padding:24px 12px">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px">
    <tr><td style="padding:24px 32px;border-bottom:1px solid #e5e7eb">
      <img src="${appUrl("/brand/motadata-logo-email.png")}" width="132" height="21" alt="motadata" style="display:block;border:0">
    </td></tr>
    <tr><td style="padding:28px 32px 4px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:0 0 16px;font-size:20px;font-weight:600;line-height:1.3">${escapeHtml(heading)}</td></tr>
        ${paragraphs.map((p) => `<tr><td style="padding:0 0 16px;font-size:15px;line-height:1.6;color:#334155">${p}</td></tr>`).join("")}
        ${button}
        ${footnote ? `<tr><td style="padding:0 0 24px;font-size:13px;line-height:1.5;color:#6b7280">${footnote}</td></tr>` : ""}
      </table>
    </td></tr>
    <tr><td style="padding:16px 32px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280">
      EventFlow · Event Request &amp; Approval Management<br>
      <a href="https://www.motadata.com" style="color:#6b7280">www.motadata.com</a> | <a href="mailto:support@motadata.com" style="color:#6b7280">support@motadata.com</a>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
}
