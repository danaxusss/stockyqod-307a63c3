import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Drivers & technicians in the Tasks module (tasks_role) with a phone number.
    const { data: drivers, error } = await supabase
      .from('app_users')
      .select('id, username, custom_seller_name, phone, tasks_role')
      .in('tasks_role', ['driver', 'technician'])
      .not('phone', 'is', null);

    if (error) throw error;

    const driversWithPhone = (drivers || []).filter(d => d.phone && d.phone.trim() !== '');
    console.log(`Found ${driversWithPhone.length} drivers/technicians to remind`);

    const results = [];

    for (const driver of driversWithPhone) {
      const toNumber = normalizePhoneNumber(driver.phone!);
      if (!toNumber) {
        results.push({ driver: driver.id, success: false, error: 'Invalid phone' });
        continue;
      }

      const name = (driver.custom_seller_name && String(driver.custom_seller_name).trim()) || driver.username || '';
      const whatsappTo = `whatsapp:${toNumber}`;
      const whatsappFrom = TWILIO_FROM_NUMBER.startsWith('whatsapp:') ? TWILIO_FROM_NUMBER : `whatsapp:${TWILIO_FROM_NUMBER}`;

      const body = `Bonjour ${name}! 🕘\n\nN'oubliez pas de pointer votre arrivée pour démarrer votre journée.\n\nBonne journée! 💪`;

      console.log(`Sending reminder to ${name} (${whatsappTo})`);

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

      if (result?.code === 63038) {
        console.error('Twilio daily limit reached');
        results.push({ driver: driver.id, success: false, rate_limited: true });
        break;
      }

      results.push({ driver: driver.id, success: response.ok });

      if (!response.ok) {
        console.error(`Failed for ${name}:`, JSON.stringify(result));
      }
    }

    return new Response(
      JSON.stringify({ success: true, sent: results.length, results }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Daily checkin reminder error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
