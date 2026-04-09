import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Validate environment variables
function validateSupabaseConfig() {
  if (!supabaseUrl || !supabaseAnonKey) {
    const errorMessage = 'Missing Supabase environment variables. Please check your .env file:\n' +
      `VITE_SUPABASE_URL: ${supabaseUrl ? 'Set' : 'Missing'}\n` +
      `VITE_SUPABASE_ANON_KEY: ${supabaseAnonKey ? 'Set' : 'Missing'}\n` +
      'These variables are required for the application to connect to Supabase.';
    
    console.error(errorMessage);
    return false;
  }
  return true;
}

// Create a function to get the Supabase client safely
function createSupabaseClient() {
  if (!validateSupabaseConfig()) {
    throw new Error('Supabase configuration is invalid');
  }
  
  console.log('Supabase client initialized with URL:', supabaseUrl);
  return createClient(supabaseUrl, supabaseAnonKey);
}

// Export the client, but only create it when environment is valid
export const supabase = createSupabaseClient();