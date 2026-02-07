
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all envs regardless of the `VITE_` prefix.
  // Cast process to any to bypass TypeScript error where 'cwd' is not found on 'Process'
  const env = loadEnv(mode, (process as any).cwd(), '');
  
  return {
    plugins: [react()],
    define: {
      // Expose process.env.API_KEY to the browser as required by the Gemini SDK guidelines
      'process.env.API_KEY': JSON.stringify(env.API_KEY || env.VITE_GEMINI_API_KEY || ''),
      // Ensure other Vite variables are defined if needed by non-Vite tools
      'process.env.VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL || ''),
      'process.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY || ''),
    }
  };
});
