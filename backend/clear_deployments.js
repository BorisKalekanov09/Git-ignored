const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function clearActiveDeployments() {
  const { data, error } = await supabase
    .from('deployments')
    .update({ status: 'completed', ended_at: new Date().toISOString() })
    .eq('status', 'active');
    
  if (error) {
    console.error('Error clearing deployments:', error);
  } else {
    console.log('Successfully cleared active deployments:', data);
  }
}

clearActiveDeployments();
