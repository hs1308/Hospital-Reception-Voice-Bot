import { createClient } from '@supabase/supabase-js';

const getSupabaseConfig = () => {
  // Defensive check for import.meta.env
  const env = (import.meta as any).env;
  if (!env) {
    return { url: '', anonKey: '' };
  }
  return {
    url: env.VITE_SUPABASE_URL || '',
    anonKey: env.VITE_SUPABASE_ANON_KEY || '',
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
