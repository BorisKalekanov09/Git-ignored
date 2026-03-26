const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://rsilwokzrjleoymbclqc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzaWx3b2t6cmpsZW95bWJjbHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MDg4MDksImV4cCI6MjA5MDA4NDgwOX0.EZHu24ghF1mHVKdgPFU6vOYih5vKZ-Xccd4j7h7WqTs';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkTables() {
    try {
        const { data: hangars, error: hError } = await supabase.from('hangars').select('*').limit(1);
        console.log('Hangars check:', { exists: !hError, error: hError?.message });

        const { data: cells, error: cError } = await supabase.from('cells').select('*').limit(1);
        console.log('Cells check:', { exists: !cError, error: cError?.message });
    } catch (e) {
        console.error(e);
    }
}

checkTables();
