# Frontend Task: Promo Code Integration

## Overview
Add promo code support to the add-on checkout flow. Users can enter a promo code to get a 20% discount on add-on purchases.

## Endpoints

### 1. Validate Promo Code (Before Checkout)
**`POST /payments/promo-code/validate`** (requires auth)

**Request:**
```json
{
  "code": "PROMO2025A",
  "amount": 10.00
}
```

**Response (valid):**
```json
{
  "valid": true,
  "code": "PROMO2025A",
  "discountPercentage": 20,
  "discountAmount": 2.00,
  "originalAmount": 10.00,
  "finalAmount": 8.00
}
```

**Response (invalid):**
```json
{
  "valid": false,
  "error": "Invalid promo code"
}
```

### 2. Purchase Add-On with Promo Code
**`POST /payments/secure-processor/token`** (requires auth)

**Request:**
```json
{
  "itemType": "addon",
  "addonCode": "EXTRA_SMALL",
  "promoCode": "PROMO2025A"  // Optional
}
```

Or for flexible top-up:
```json
{
  "itemType": "addon",
  "addonCode": "FLEX_TOP_UP",
  "amount": 10.00,
  "currency": "EUR",
  "promoCode": "PROMO2025A"  // Optional
}
```

## UI Requirements

1. **Add promo code input field** to the checkout form
2. **Validate promo code** when user enters it (debounce ~500ms)
3. **Show discount preview**:
   - Display original price (strikethrough)
   - Show discount amount
   - Display final price (highlighted)
4. **Handle validation errors**:
   - Show error message if code is invalid/expired
   - Allow user to remove/change code
5. **Submit promo code** with checkout request

## Flow

1. User selects add-on → shows base price
2. User enters promo code → validate via API
3. If valid → show discounted price preview
4. User clicks "Buy" → include `promoCode` in checkout request
5. Payment processes with discounted amount

## Example Promo Codes
- `PROMO2025A` through `PROMO2025J` (10 codes total)
- All provide 20% discount
- Reusable (no usage limits)

## Notes
- Promo codes are **optional** - checkout works without them
- Only valid for **add-ons** (not plans, since plans are removed)
- Discount is applied server-side, so the final charged amount matches the preview

