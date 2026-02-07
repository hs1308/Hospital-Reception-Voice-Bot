import { createClient } from '@supabase/supabase-js';

const getSupabaseConfig = () => {
  // Using string-based access to bypass strict TS checks for the demo
  const meta = import.meta as any;
  return {
    url: meta.env?.VITE_SUPABASE_URL || '',
    anonKey: meta.env?.VITE_SUPABASE_ANON_KEY || '',
  };
};

const createSupabaseClient = () => {
  const { url, anonKey } = getSupabaseConfig();
  
  if (!url || !anonKey) {
    return new Proxy({} as any, {
      get: (target, prop) => {
        if (prop === 'isProxy') return true;
        if (prop === 'from') {
           return () => ({
             select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: new Error("Supabase URL/Key missing") }) }) }),
             insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: new Error("Supabase URL/Key missing") }) }) })
           });
        }
        return () => {};
      },
    });
  }
  
  try {
    return createClient(url, anonKey);
  } catch (e: any) {
    return new Proxy({} as any, {
      get: () => {
        throw new Error(`Failed to initialize Supabase: ${e.message}`);
      }
    });
  }
};

export const supabase = createSupabaseClient();

export const isSupabaseConfigured = () => {
  const { url, anonKey } = getSupabaseConfig();
  return !!url && !!anonKey;
};
