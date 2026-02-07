
import React from 'react';
import { BotState } from '../types';

interface PulseOrbProps {
  state: BotState;
  isEmergency?: boolean;
}

const PulseOrb: React.FC<PulseOrbProps> = ({ state, isEmergency = false }) => {
  const getOrbColor = () => {
    if (isEmergency) return 'bg-red-600 shadow-[0_0_60px_-10px_rgba(220,38,38,0.8)]';
    switch (state) {
      case 'listening': return 'bg-indigo-600 shadow-[0_0_60px_-10px_rgba(79,70,229,0.8)]';
      case 'speaking': return 'bg-emerald-500 shadow-[0_0_60px_-10px_rgba(16,185,129,0.8)]';
      case 'processing': return 'bg-amber-500 shadow-[0_0_60px_-10px_rgba(245,158,11,0.8)] animate-pulse';
      default: return 'bg-slate-300 shadow-none';
    }
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-12">
      <div className="relative flex items-center justify-center">
        {state !== 'idle' && (
          <>
            <div className={`absolute w-72 h-72 rounded-full opacity-10 animate-[ping_3s_linear_infinite] ${
              isEmergency ? 'bg-red-400' : state === 'listening' ? 'bg-indigo-400' : 'bg-emerald-400'
            }`} />
            <div className={`absolute w-56 h-56 rounded-full opacity-20 animate-[ping_2s_linear_infinite] ${
              isEmergency ? 'bg-red-300' : state === 'listening' ? 'bg-indigo-300' : 'bg-emerald-300'
            }`} />
          </>
        )}
        
        <div className={`w-48 h-48 rounded-[3.5rem] transition-all duration-700 flex items-center justify-center relative z-10 ${getOrbColor()} ${state === 'listening' ? 'scale-110' : 'scale-100'}`}>
          <div className="w-24 h-24 rounded-full bg-white/20 blur-3xl animate-pulse" />
          <div className="absolute inset-4 border-2 border-white/10 rounded-[2.5rem]" />
        </div>
      </div>
      
      <div className="space-y-2">
        <p className={`text-2xl font-black uppercase tracking-[0.25em] transition-colors duration-500 ${isEmergency ? 'text-red-600' : 'text-slate-800'}`}>
          {isEmergency ? 'Emergency Mode' : state.toUpperCase()}
        </p>
        <div className="flex justify-center space-x-1">
          {[1, 2, 3].map(i => (
            <div key={i} className={`w-1 h-1 rounded-full animate-bounce ${isEmergency ? 'bg-red-400' : 'bg-slate-400'}`} style={{ animationDelay: `${i * 0.1}s` }} />
          ))}
        </div>
      </div>
    </div>
  );
};

export default PulseOrb;
