import React, { useState } from 'react';
import { supabase, isSupabaseConfigured } from '../supabaseClient';
import { Patient } from '../types';
import { Phone, ArrowRight, Loader2, ShieldCheck, HeartPulse, AlertCircle } from 'lucide-react';

interface PatientSetupProps {
  onComplete: (patient: Patient) => void;
}

const PatientSetup: React.FC<PatientSetupProps> = ({ onComplete }) => {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone) return;
    
    if (!isSupabaseConfigured()) {
      setError("Database keys are missing. Please add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your environment variables or Vercel settings.");
      return;
    }

    setLoading(true);
    setError('');
    try {
      const { data, error: fetchError } = await supabase.from('patients').select('*').eq('phone', phone).maybeSingle();
      if (fetchError) throw fetchError;
      
      if (data) {
        onComplete(data as Patient);
      } else {
        const { data: newData, error: insertError } = await supabase
          .from('patients')
          .insert([{ phone, name: 'Patient ' + phone.slice(-4) }])
          .select()
          .single();
        if (insertError) throw insertError;
        onComplete(newData as Patient);
      }
    } catch (err: any) {
      setError(`Database Error: ${err.message || 'Could not connect to Supabase. Check your VITE_ variables.'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md w-full bg-white p-10 rounded-[2.5rem] shadow-2xl border border-slate-100 animate-in fade-in zoom-in duration-500">
      <div className="mb-10 text-center">
        <div className="bg-indigo-50 w-20 h-20 rounded-[2rem] flex items-center justify-center mx-auto mb-6 shadow-inner ring-4 ring-white">
          <HeartPulse className="w-10 h-10 text-indigo-600" />
        </div>
        <h2 className="text-3xl font-black text-slate-900 tracking-tight">Maya Front Desk</h2>
        <p className="text-slate-500 mt-3 font-medium">Identify yourself to sync with City Health records.</p>
      </div>

      <form onSubmit={handleStart} className="space-y-8">
        <div className="space-y-3">
          <label className="block text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Mobile Number</label>
          <div className="relative">
            <input
              type="tel"
              required
              placeholder="e.g. 9933997356"
              className="w-full px-6 py-5 rounded-2xl bg-white text-slate-900 border-2 border-slate-100 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50/50 transition-all outline-none text-lg font-bold shadow-sm placeholder:text-slate-300"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            {phone.length >= 10 && (
              <div className="absolute right-4 top-1/2 -translate-y-1/2">
                <ShieldCheck className="w-6 h-6 text-emerald-500" />
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl flex items-start space-x-3 animate-shake">
            <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
            <p className="text-rose-600 text-xs font-bold leading-relaxed">{error}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={loading || phone.length < 5}
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black py-5 rounded-[2rem] shadow-xl shadow-indigo-100 transition-all flex items-center justify-center space-x-3 disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none group"
        >
          {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : (
            <>
              <span className="text-lg">Connect to Hospital Database</span>
              <ArrowRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" />
            </>
          )}
        </button>
      </form>
    </div>
  );
};

export default PatientSetup;
