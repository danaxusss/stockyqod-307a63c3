const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/twilio';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');

    const TWILIO_API_KEY = Deno.env.get('TWILIO_API_KEY');
    if (!TWILIO_API_KEY) throw new Error('TWILIO_API_KEY is not configured');

    const TWILIO_FROM_NUMBER = Deno.env.get('TWILIO_FROM_NUMBER');
    if (!TWILIO_FROM_NUMBER) throw new Error('TWILIO_FROM_NUMBER is not configured');

    const { phone_numbers, title, message } = await req.json();

    if (!phone_numbers?.length) {
      return new Response(
        JSON.stringify({ error: 'phone_numbers is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = `*${title || 'Notification'}*\n\n${message || ''}`;
    const results = [];

    for (const phone of phone_numbers) {
      const toNumber = normalizePhoneNumber(phone);
      if (!toNumber) {
        results.push({ phone, success: false, result: { error: 'Invalid phone number format' } });
        console.error(`Failed to normalize phone number: ${phone}`);
        continue;
      }

      const whatsappTo = `whatsapp:${toNumber}`;
      const whatsappFrom = TWILIO_FROM_NUMBER.startsWith('whatsapp:') ? TWILIO_FROM_NUMBER : `whatsapp:${TWILIO_FROM_NUMBER}`;

      console.log(`Sending WhatsApp to ${whatsappTo}...`);

      const response = await fetch(`${GATEWAY_URL}/Messages.json`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'X-Connection-Api-Key': TWILIO_API_KEY,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: whatsappTo,
          From: whatsappFrom,
          Body: body,
        }),
      });

      const result = await response.json();
      
      // Detect Twilio daily limit error
      if (result?.code === 63038) {
        console.error(`Twilio daily limit reached for ${toNumber}`);
        results.push({ phone: toNumber, success: false, result, rate_limited: true });
        // No point sending more — all will fail
        return new Response(
          JSON.stringify({ success: false, rate_limited: true, results, error: 'Limite quotidienne de 50 messages WhatsApp atteinte. Veuillez upgrader votre compte Twilio.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      results.push({ phone: toNumber, success: response.ok, result });

      if (!response.ok) {
        console.error(`Failed to send to ${toNumber}:`, JSON.stringify(result));
      } else {
        console.log(`Sent to ${toNumber}, SID: ${result.sid}`);
      }
    }

    return new Response(
      JSON.stringify({ success: true, results }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('SMS send error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
