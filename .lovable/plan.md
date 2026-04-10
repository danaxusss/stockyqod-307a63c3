

## Problem

The WhatsApp message template has proper newlines in the source, but `URLSearchParams` encodes newlines as `%0A` or `+` which WhatsApp doesn't always interpret as line breaks. WhatsApp expects `%0a` (lowercase) for newlines.

## Fix

In `src/utils/whatsappShare.ts`, change `buildWhatsAppShareUrl` to manually build the `text` parameter by replacing newlines with `%0a` instead of using `URLSearchParams` for the text value.

```typescript
export function buildWhatsAppShareUrl(rawPhone: string, messageText: string): string {
  const phone = normalizeWhatsAppPhone(rawPhone);
  const encodedText = messageText.replace(/\n/g, '%0a').replace(/ /g, '%20');
  
  let url = `${WHATSAPP_BASE_URL}?text=${encodedText}`;
  if (phone) {
    url = `${WHATSAPP_BASE_URL}?phone=${phone}&text=${encodedText}`;
  }
  return url;
}
```

Single file change, ~5 lines modified.

