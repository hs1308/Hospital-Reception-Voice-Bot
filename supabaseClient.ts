import { createClient } from '@supabase/supabase-js';

const getSupabaseConfig = () => {
  // Use (import.meta as any).env for robust access in Vite/Vercel environments
  const env = (import.meta as any).env;
  return {
    url: env?.VITE_SUPABASE_URL || '',
    anonKey: env?.VITE_SUPABASE_ANON_KEY || '',
  };
};

const createSupabaseClient = () => {
  const { url, anonKey } = getSupabaseConfig();
  
  if (!url || !anonKey) {
    // Return a proxy that provides a friendly error message when any method is called
    return new Proxy({} as any, {
      get: (target, prop) => {
        if (prop === 'isProxy') return true;
        if (prop === 'from') {
           return () => ({
             select: () => ({ 
               eq: () => ({ 
                 maybeSingle: () => Promise.resolve({ data: null, error: new Error("Supabase VITE_ variables missing") }),
                 order: () => ({ 
                   maybeSingle: () => Promise.resolve({ data: null, error: new Error("Supabase VITE_ variables missing") }) 
                 })
               }) 
             }),
             insert: () => ({ 
               select: () => ({ 
                 single: () => Promise.resolve({ data: null, error: new Error("Supabase VITE_ variables missing") }) 
               }) 
             })
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
