## Flexible EUR Top-up (Frontend Task)

Implement a custom-amount top-up flow that uses the backend flexible add-on endpoint.

### Backend contract
- Endpoint: `POST /payments/secure-processor/token`
- Payload for flexible top-up: `{"itemType":"addon","addonCode":"FLEX_TOP_UP","amount":<number>,"currency":"EUR"}`
- Amount rules: EUR only, 1.00–10,000.00, max two decimals. Amount is sent as provided (backend rounds to cents).
- Response: `{ token, checkout: { token } }` — pass the `token` to the Secure Processor widget (same as existing checkout).
- Success redirect: `/payments/secure-processor/success?status=successful&token=...` (pending/failed already exist).

### Usage granted per EUR (shown to the user before pay)
- €0–10 portion: +20 posts, +10 schedules, +5 AI per EUR.
- €10–30 portion: +30 posts, +18 schedules, +8 AI per EUR.
- €30+ portion: +45 posts, +25 schedules, +12 AI per EUR.
- Example outputs: €1 → 20/10/5; €17 → 410/226/106; €50.20 → 1709/965/452.

### UI requirements
- Input: numeric field for EUR amount (supports decimals). Disable/validate outside min/max or >2 decimals.
- Live preview: display the posts/schedules/AI the user will receive based on the current amount (use the tier logic above).
- CTA: “Top up” button that calls the token API with `FLEX_TOP_UP` and amount; show loading/disabled state while fetching.
- Errors: show API validation errors (e.g., below min/above max) and widget/token failures.
- Auth: if token API returns 401, redirect to sign-in and retry after login (same pattern as other checkout flows).
- After return: on success/pending/failure pages, surface result and refresh subscription/usage data (call `/user/user-info`).

### Notes
- Reuse the existing Secure Processor widget integration (same host/script as plans/add-ons).
- Do not hardcode limits in multiple places; keep tier data in a single helper used by the input preview.
