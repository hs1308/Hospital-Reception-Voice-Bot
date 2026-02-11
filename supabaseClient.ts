
import { createClient } from '@supabase/supabase-js';

// Vite 'define' replaces these process.env references at build time
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = () => {
  return !!supabaseUrl && !!supabaseAnonKey;
};

const createSupabaseClient = () => {
  if (!isSupabaseConfigured()) {
    console.warn("Supabase configuration missing. Database features will be disabled.");
    // Return a proxy that handles common calls gracefully
    return new Proxy({} as any, {
      get: (target, prop) => {
        return () => ({
          select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }), maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
          insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
          update: () => ({ eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) }),
        });
      },
    });
  }
  return createClient(supabaseUrl, supabaseAnonKey);
};

export const supabase = createSupabaseClient();
