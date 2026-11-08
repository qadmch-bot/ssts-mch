# WhatsApp Business Platform setup (Cloud API)

SSTS uses Meta's official WhatsApp Business Platform. Alerts are business-initiated, so they must use a
**Meta-approved message template**.

## 1. Accounts
1. Meta Business Manager verified for the hospital / cluster.
2. WhatsApp Business Account with a dedicated phone number (not a personal number).
3. Create a **System User** with `whatsapp_business_messaging` permission → generate a permanent token → `WHATSAPP_ACCESS_TOKEN`.
4. Copy the **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`. App secret → `WHATSAPP_APP_SECRET`.

## 2. Template (category: Utility, language: English)

Name: `ssts_alert` (→ `WHATSAPP_TEMPLATE_NAME`). Body with four variables:

```
{{1}}
Maternity & Children Hospital
Case ID: {{2}}
Department: {{3}}
Status: {{4}}

Please review the case in the secure hospital system.
```

Add a **URL button** "Open SSTS" pointing to the application address (users must sign in; the link carries no token).

The app fills: `{{1}}` alert title (e.g. NEW SEPSIS CASE ALERT), `{{2}}` Case ID, `{{3}}` department,
`{{4}}` status and required action. **No MRN, patient name, date of birth, diagnosis or laboratory values are ever sent.**
Test messages are prefixed `[TEST]`.

## 3. Webhook (delivery status)

Callback URL: `https://<app>/api/webhooks/whatsapp` · Verify token: `WHATSAPP_WEBHOOK_VERIFY_TOKEN` · Subscribe to **messages**.
Signatures are verified with `WHATSAPP_APP_SECRET`. Status mapping: accepted by API → **Sent**; webhook `delivered`/`read` → **Delivered**; webhook `failed` → **Failed** with Meta's error.

## 4. Recipients & consent
Register each recipient in Settings → WhatsApp Recipients (E.164, e.g. `+9665XXXXXXXX`). Confirm that staff
consent to receive work alerts on WhatsApp and that this channel is approved by hospital policy.
