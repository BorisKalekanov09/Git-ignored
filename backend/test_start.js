const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function checkHangar() {
  const { data, error } = await supabase.from('hangars')
    .select('id, starting_cell_id, created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) { console.error(error); return; }
  console.log('Latest Hangar:', data);

  if (data.starting_cell_id) {
    const { data: cell } = await supabase.from('cells').select('id, index_x, index_y').eq('id', data.starting_cell_id).single();
    console.log('Starting cell info:', cell);
  } else {
    console.log('No starting_cell_id set in DB for this hangar!');
  }
}

checkHangar();
