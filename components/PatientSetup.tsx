import React, { useState } from 'react';
import { supabase, isSupabaseConfigured } from '../supabaseClient';
import { Patient } from '../types';
import { Phone, ArrowRight, Loader2, AlertCircle, CheckCircle2, XCircle, Database, HeartPulse } from 'lucide-react';

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
      setError("Database keys are missing. Please check your environment variables.");
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
      setError(`Database Error: ${err.message || 'Could not connect to Supabase.'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full font-sans selection:bg-indigo-100 selection:text-indigo-900 bg-white">
      <div className="max-w-5xl w-full flex flex-col items-center mx-auto">
        
        <div className="w-full flex flex-col items-center py-6 sm:py-10 px-4 relative">
          <div className="absolute top-0 left-0 w-full h-1 bg-indigo-600 opacity-20" />
          
          <div className="flex flex-col items-center text-center mb-6">
            <h1 className="text-6xl font-[900] text-slate-900 tracking-tighter mb-0">
              Maya
            </h1>
            <p className="text-[13px] font-black text-indigo-600 tracking-wide mt-2">
              AI Hospital Receptionist
            </p>
          </div>

          <div className="w-full max-w-md bg-slate-50/70 pt-8 px-8 pb-6 rounded-[2rem] border border-slate-100 mb-8">
            <form onSubmit={handleStart} className="flex flex-col items-center">
              <div className="w-full space-y-3 mb-6">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Mobile Number</label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Phone className="h-5 w-5 text-slate-300 group-focus-within:text-indigo-500 transition-colors" />
                  </div>
                  <input
                    type="tel"
                    required
                    placeholder="Enter num to test, no OTP needed"
                    className="w-full pl-12 pr-4 py-4 rounded-2xl bg-white text-slate-900 border border-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all outline-none text-base font-medium shadow-sm"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
                <div className="flex items-start mt-4 px-1">
                  <Database className="w-3.5 h-3.5 text-slate-400 mt-1 mr-2 shrink-0" />
                  <p className="text-[13px] text-slate-500 leading-relaxed">
                    Use 123456 for a dummy profile.
                  </p>
                </div>
              </div>

              {error && (
                <div className="w-full p-4 mb-6 bg-rose-50 border border-rose-100 rounded-2xl flex items-start space-x-3">
                  <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                  <p className="text-rose-600 text-xs font-bold leading-relaxed">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || phone.length < 5}
                className="w-full bg-slate-900 hover:bg-indigo-600 text-white font-black py-4 px-8 rounded-2xl shadow-xl hover:shadow-indigo-100 transition-all flex items-center justify-center space-x-3 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none disabled:cursor-not-allowed group active:scale-95"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                  <>
                    <span className="text-sm tracking-wide">Go to Dashboard</span>
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </button>
            </form>
          </div>

          <div className="w-full max-w-3xl text-center space-y-6 mb-12">
            <h2 className="text-3xl font-black text-slate-900 leading-tight">
              Replacing Hospital IVR with Intelligent Voice
            </h2>
            <p className="text-[16px] text-slate-500 font-medium leading-relaxed max-w-2xl mx-auto">
              Meet Maya, a voice assistant designed for <span className="text-slate-900 font-bold">City Health Hospital</span>. Connected to live medical databases, she handles complex patient interactions through natural conversation.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full px-4 sm:px-0">
            <div className="bg-indigo-50/30 border border-indigo-100 rounded-[2rem] p-8 sm:p-10 flex flex-col group hover:bg-white hover:shadow-2xl hover:shadow-indigo-50 transition-all duration-500">
              <div className="flex items-center space-x-4 mb-8">
                <div className="p-3 bg-indigo-500 rounded-2xl text-white shadow-lg shadow-indigo-100">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-black text-slate-900">Capabilities</h3>
              </div>
              <ul className="space-y-5">
                {[
                  "Book Doctor or Lab Appointments",
                  "Cancel or Reschedule Visits",
                  "Query Doctor Bio, Fees & Specialty",
                  "Department Schedules & OPD Info",
                  "Emergency Triage & Redirection"
                ].map((item, i) => (
                  <li key={i} className="flex items-start text-sm text-slate-600 font-medium">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-2 mr-3 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-slate-50 border border-slate-100 rounded-[2rem] p-8 sm:p-10 flex flex-col group hover:bg-white hover:shadow-2xl hover:shadow-slate-50 transition-all duration-500">
              <div className="flex items-center space-x-4 mb-8">
                <div className="p-3 bg-slate-400 rounded-2xl text-white shadow-lg shadow-slate-50">
                  <XCircle className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-black text-slate-900">Limitations</h3>
              </div>
              <ul className="space-y-5">
                {[
                  "No OTP authentication for login",
                  "No OTP verification to cancel or reschedule appointments",
                  "No payment or refund flow",
                  "No Emergency Ambulance Dispatch",
                  "No Insurance Consulting"
                ].map((item, i) => (
                  <li key={i} className="flex items-start text-sm text-slate-500 font-medium opacity-80">
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-300 mt-2 mr-3 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-8 py-6 text-center">
          <p className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center justify-center">
            <HeartPulse className="w-4 h-4 mr-2 text-rose-500" />
            Designed for Modern Healthcare Excellence
          </p>
        </div>
      </div>
    </div>
  );
};

export default PatientSetup;