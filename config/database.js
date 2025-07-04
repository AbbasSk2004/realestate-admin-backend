const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL, Anonymous Key, or Service Role Key in environment variables');
}

// Only log configuration details in non-production environments to avoid leaking sensitive data
if (process.env.NODE_ENV !== 'production') {
  // Log the configuration (redacting sensitive parts)
  console.log('Supabase Configuration:');
  console.log('- URL:', supabaseUrl);
  console.log('- Anon Key:', supabaseKey ? supabaseKey.substring(0, 5) + '...' + supabaseKey.substring(supabaseKey.length - 5) : 'MISSING');
  console.log('- Service Key:', supabaseServiceKey ? supabaseServiceKey.substring(0, 5) + '...' + supabaseServiceKey.substring(supabaseServiceKey.length - 5) : 'MISSING');
}

// Create regular client with anon key
const supabase = createClient(supabaseUrl, supabaseKey);

// Create admin client with service role key (has higher privileges)
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Export both clients
module.exports = { supabase, supabaseAdmin }; 