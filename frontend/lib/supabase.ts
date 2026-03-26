import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const SUPABASE_URL = 'https://rsilwokzrjleoymbclqc.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzaWx3b2t6cmpsZW95bWJjbHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MDg4MDksImV4cCI6MjA5MDA4NDgwOX0.EZHu24ghF1mHVKdgPFU6vOYih5vKZ-Xccd4j7h7WqTs';

// In-memory storage for native (Expo Go compatible — no native module needed).
// Sessions won't survive app restarts, but everything works in Expo Go.
const memoryStore: Record<string, string> = {};
const inMemoryStorage = {
  getItem: (key: string) => Promise.resolve(memoryStore[key] ?? null),
  setItem: (key: string, value: string) => {
    memoryStore[key] = value;
    return Promise.resolve();
  },
  removeItem: (key: string) => {
    delete memoryStore[key];
    return Promise.resolve();
  },
};

// For web: use localStorage when available (safe for SSR too)
const webStorage =
  typeof window !== 'undefined'
    ? {
        getItem: (key: string) => Promise.resolve(localStorage.getItem(key)),
        setItem: (key: string, value: string) =>
          Promise.resolve(localStorage.setItem(key, value)),
        removeItem: (key: string) =>
          Promise.resolve(localStorage.removeItem(key)),
      }
    : undefined;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: Platform.OS === 'web' ? webStorage : inMemoryStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});
