const { createClient } = require('@supabase/supabase-js');
require('./loadEnv');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const missingSupabaseConfig = !supabaseUrl || !supabaseServiceKey;

if (missingSupabaseConfig) {
  console.warn('Supabase URL or Service Key missing in environment configuration');
}

const notConfiguredClient = new Proxy({}, {
  get() {
    throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  },
});

const supabase = missingSupabaseConfig
  ? notConfiguredClient
  : createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

module.exports = supabase;
