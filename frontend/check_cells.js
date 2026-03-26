const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://rsilwokzrjleoymbclqc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzaWx3b2t6cmpsZW95bWJjbHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MDg4MDksImV4cCI6MjA5MDA4NDgwOX0.EZHu24ghF1mHVKdgPFU6vOYih5vKZ-Xccd4j7h7WqTs';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function check() {
  const { data: hangars, error: hErr } = await supabase.from('hangars').select('*').limit(5);
  console.log('Hangars:', hangars?.length, hErr ? hErr.message : '');

  const { data: cells, error: cErr } = await supabase.from('cells').select('*').limit(5);
  console.log('Cells error:', cErr ? cErr.message : 'None');
  console.log('Cells count:', cells ? cells.length : 0);
  
  if (!cErr && cells && cells.length === 0 && hangars && hangars.length > 0) {
     const hangar = hangars[0];
     if (hangar.shape === 'rectangle') {
       console.log('Generating cells for hangar', hangar.id, 'width', hangar.width, 'height', hangar.height);
       const cols = Math.ceil(hangar.width / 0.2);
       const rows = Math.ceil(hangar.height / 0.2);
       const newCells = [];
       for (let y = 0; y < rows; y++) {
         for (let x = 0; x < cols; x++) {
           newCells.push({
             hangar_id: hangar.id,
             index_x: x,
             index_y: y,
             status: 'pending'
           });
         }
       }
       console.log(`Inserting ${newCells.length} cells...`);
       const chunkSize = 500;
       for (let i = 0; i < newCells.length; i += chunkSize) {
         const chunk = newCells.slice(i, i + chunkSize);
         const { error } = await supabase.from('cells').insert(chunk);
         if (error) console.log('Insert error:', error.message);
       }
       console.log('Cells generated!');
     }
  }
}

check();
