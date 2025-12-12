## Secure Processor Checkout (Plans + Add-ons)

You must be authenticated before starting checkout. If the user is not authenticated, redirect to the auth page before calling the token API.

### References
- Widget docs: https://docs.secure-processor.com/en/integration/widget/payment_page/
- Widget script: `https://js.secure-processor.com/widget/be_gateway.js`
- Checkout host: `https://checkout.secure-processor.com`
- Test flag: `NEXT_PUBLIC_SECURE_PROCESSOR_TEST_MODE` (use for widget config)

### Backend contract
- `POST /payments/secure-processor/token` (requires auth cookie or Bearer token)
  - Body (plan purchase): `{ itemType?: "plan", planCode: "STARTER"|"PRO", billingPeriod: "monthly"|"yearly" }`
  - Body (add-on purchase): `{ itemType: "addon", addonCode: "EXTRA_POSTS_100"|"EXTRA_SCHEDULES_100"|"EXTRA_AI_50" }`
  - Response: `{ token, checkout: { token } }` — pass this token to the widget.
- Return URLs the backend redirects to after payment:
  - `/payments/secure-processor/success?status=successful&token=...`
  - `/payments/secure-processor/pending?status=pending&token=...`
  - `/payments/secure-processor/failed?status=failed|error|declined&token=...`
- Webhook is already handled on the backend; just surface user-friendly messaging on the frontend.

### Plan and add-on behavior
- Base plans (also enforce on the UI):
  - `STARTER`: 300 posts, 200 scheduled, 10 accounts, 0 AI
  - `PRO`: 500 posts, 400 scheduled, 30 accounts, 50 AI
- Free/Starter users should explicitly see AI as `0 / 0` (no included AI) but can purchase add-ons.
- Add-ons (one-time bumps for the current period):
  - `EXTRA_SMALL`: +20 posts, +10 schedules, +10 AI — $1
  - `EXTRA_MEDIUM`: +100 posts, +80 schedules, +30 AI — $5
  - `EXTRA_LARGE`: +500 posts, +450 schedules, +100 AI — $10

### Frontend tasks
- Add “Buy” flows for add-ons when a limit is reached; call the token API with `itemType: "addon"` + `addonCode` (`EXTRA_SMALL`, `EXTRA_MEDIUM`, `EXTRA_LARGE`). This must work for free users too.
- Add plan checkout flow using `itemType: "plan"` + `planCode`/`billingPeriod`.
- Initialize the widget with the returned `token` following the Secure Processor payment_page docs (respect test mode).
- On success/pending/failure return pages, show clear messages and a CTA back to billing/subscription; after load, refresh subscription/usage (e.g., call `/user/user-info`).
- Handle token creation errors with UI feedback; disable buttons while token is loading.
- Enforce auth: if the token API returns 401, redirect to sign-in and retry after login.
