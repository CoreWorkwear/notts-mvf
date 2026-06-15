# Email templates (Supabase Auth)

Club-voice, branded replacements for the default Supabase auth emails. Paste the
HTML into **Supabase → Authentication → Email Templates**, and set the subject.

| Template (Supabase) | File | Subject to set |
|---|---|---|
| **Reset Password** | `reset-password.html` | `Reset your Notts MvF password` |
| **Confirm signup** | `confirm-signup.html` | `Confirm your spot — Notts MvF` |

Notes:
- Both use the `{{ .ConfirmationURL }}` variable Supabase substitutes at send time.
- The crest image loads from the live site (`https://notts-mvf.pages.dev/pwa-192x192.png`), so it shows once the site is deployed.
- These only send from "Nottinghamshire MvF" (not Supabase's shared address) and reliably reach the inbox **once custom SMTP is configured** (Project Settings → Authentication → SMTP Settings — e.g. Brevo/Resend). Without custom SMTP they still render, but keep the default sender + deliverability.
- Keep the templates in sync here if you edit them in the dashboard.
