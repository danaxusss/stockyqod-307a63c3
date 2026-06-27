import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

function normalizePhoneNumber(phone: string): string | null {
  const cleaned = phone.replace(/[^\d+]/g, '');
  if (!cleaned) return null;

  if (cleaned.startsWith('+')) return cleaned;

  const digits = cleaned.replace(/\D/g, '');
  if (!digits) return null;

  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('212')) return `+${digits}`;
  if (/^0[5-7]\d{8}$/.test(digits)) return `+212${digits.slice(1)}`;
  if (/^[5-7]\d{8}$/.test(digits)) return `+212${digits}`;

  return `+${digits}`;
}

export async function sendWhatsAppNotification(
  phoneNumbers: string[],
  title: string,
  message: string,
  taskId?: string,
  type?: string
) {
  if (!phoneNumbers.length) return;

  const validNumbers = Array.from(
    new Set(phoneNumbers.map(normalizePhoneNumber).filter((phone): phone is string => Boolean(phone)))
  );
  if (!validNumbers.length) return;

  try {
    const { data, error } = await supabase.functions.invoke('send-sms', {
      body: {
        phone_numbers: validNumbers,
        title,
        message,
      },
    });

    // Handle rate limit (Twilio sandbox 50/day limit)
    if (data?.rate_limited || error?.message?.includes('429')) {
      toast({
        title: '⚠️ Limite WhatsApp atteinte',
        description: 'La limite quotidienne de 50 messages WhatsApp (sandbox Twilio) a été atteinte. Les notifications seront envoyées demain.',
        variant: 'destructive',
      });
      return data;
    }

    if (error) console.warn('WhatsApp notification error:', error);
    if (data?.results?.some((result: { success: boolean }) => !result.success)) {
      console.warn('Some WhatsApp notifications failed:', data.results);
    }

    return data;
  } catch (e) {
    console.warn('Failed to send WhatsApp notification:', e);
  }
}
