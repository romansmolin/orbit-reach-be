# Frontend Promo Code Testing Guide

## Available Promo Codes

All promo codes provide **20% discount** and are **reusable** (unlimited uses):

- `PROMO2025A`
- `PROMO2025B`
- `PROMO2025C`
- `PROMO2025D`
- `PROMO2025E`
- `PROMO2025F`
- `PROMO2025G`
- `PROMO2025H`
- `PROMO2025I`
- `PROMO2025J`

## Add-On Pricing (Before Discount)

- **EXTRA_SMALL**: €1.00 → **€0.80** with promo code
- **EXTRA_MEDIUM**: €5.00 → **€4.00** with promo code
- **EXTRA_LARGE**: €10.00 → **€8.00** with promo code
- **FLEX_TOP_UP**: Custom amount (min €1.00, max €100.00)

## Testing Flow

### Step 1: Validate Promo Code

**Endpoint:** `POST /payments/promo-code/validate`  
**Auth:** Required (Bearer token or cookie)

**Test Case 1: Valid Promo Code**
```bash
curl -X POST http://localhost:4000/payments/promo-code/validate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "code": "PROMO2025A",
    "amount": 10.00
  }'
```

**Expected Response:**
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

**Test Case 2: Invalid Promo Code**
```bash
curl -X POST http://localhost:4000/payments/promo-code/validate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "code": "INVALID123",
    "amount": 10.00
  }'
```

**Expected Response:**
```json
{
  "valid": false,
  "error": "Invalid promo code"
}
```

**Test Case 3: Case Insensitive (should work)**
```bash
# Try lowercase
{
  "code": "promo2025a",
  "amount": 10.00
}
```

### Step 2: Purchase Add-On with Promo Code

**Endpoint:** `POST /payments/secure-processor/token`  
**Auth:** Required

**Test Case 1: EXTRA_SMALL with Promo Code**
```bash
curl -X POST http://localhost:4000/payments/secure-processor/token \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "itemType": "addon",
    "addonCode": "EXTRA_SMALL",
    "promoCode": "PROMO2025A"
  }'
```

**Expected:** Returns checkout token. The amount charged should be **€0.80** (€1.00 - 20%)

**Test Case 2: EXTRA_MEDIUM with Promo Code**
```bash
{
  "itemType": "addon",
  "addonCode": "EXTRA_MEDIUM",
  "promoCode": "PROMO2025B"
}
```

**Expected:** Amount charged should be **€4.00** (€5.00 - 20%)

**Test Case 3: FLEX_TOP_UP with Promo Code**
```bash
{
  "itemType": "addon",
  "addonCode": "FLEX_TOP_UP",
  "amount": 10.00,
  "currency": "EUR",
  "promoCode": "PROMO2025C"
}
```

**Expected:** Amount charged should be **€8.00** (€10.00 - 20%)

**Test Case 4: Without Promo Code (should still work)**
```bash
{
  "itemType": "addon",
  "addonCode": "EXTRA_SMALL"
}
```

**Expected:** Amount charged should be **€1.00** (no discount)

### Step 3: Verify Purchase History

**Endpoint:** `GET /addons/purchased`  
**Auth:** Required

**Expected Response:**
```json
{
  "addons": [
    {
      "id": "uuid",
      "addonCode": "EXTRA_SMALL",
      "amount": 0.80,
      "currency": "EUR",
      "description": "Extra Small Usage Package",
      "usageDeltas": {
        "sentPosts": 20,
        "scheduledPosts": 10,
        "aiRequests": 10
      },
      "promoCodeId": "uuid",
      "discountAmount": 0.20,
      "originalAmount": 1.00,
      "createdAt": "2025-01-XX..."
    }
  ]
}
```

## UI Testing Checklist

### ✅ Happy Path
1. [ ] User selects add-on (e.g., EXTRA_SMALL - €1.00)
2. [ ] User enters promo code "PROMO2025A"
3. [ ] Validation API is called (debounced)
4. [ ] UI shows:
   - Original price: ~~€1.00~~ (strikethrough)
   - Discount: -€0.20 (20%)
   - Final price: **€0.80** (highlighted)
5. [ ] User clicks "Buy"
6. [ ] Checkout token request includes `promoCode: "PROMO2025A"`
7. [ ] Payment processes with €0.80

### ✅ Error Handling
1. [ ] Invalid promo code shows error message
2. [ ] User can remove/change promo code
3. [ ] Removing promo code reverts to original price
4. [ ] Checkout works without promo code

### ✅ Edge Cases
1. [ ] Case insensitive: "promo2025a" works
2. [ ] Whitespace handling: " PROMO2025A " should be trimmed
3. [ ] Empty promo code field doesn't break checkout
4. [ ] Same promo code can be used multiple times

## Quick Test Commands

### Using curl (replace YOUR_TOKEN with actual token):

```bash
# 1. Validate promo code
curl -X POST http://localhost:4000/payments/promo-code/validate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"code": "PROMO2025A", "amount": 10.00}'

# 2. Purchase with promo code
curl -X POST http://localhost:4000/payments/secure-processor/token \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"itemType": "addon", "addonCode": "EXTRA_SMALL", "promoCode": "PROMO2025A"}'

# 3. Check purchase history
curl -X GET http://localhost:4000/addons/purchased \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Test Promo Codes Summary

| Code | Discount | Status | Uses |
|------|----------|--------|------|
| PROMO2025A | 20% | Active | Unlimited |
| PROMO2025B | 20% | Active | Unlimited |
| PROMO2025C | 20% | Active | Unlimited |
| ... | ... | ... | ... |
| PROMO2025J | 20% | Active | Unlimited |

**Note:** All codes are case-insensitive and reusable. Use any of them for testing!

