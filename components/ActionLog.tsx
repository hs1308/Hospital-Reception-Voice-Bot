
import React from 'react';
import { ActionLog as LogType } from '../types';
import { Activity, Info, AlertCircle } from 'lucide-react';

interface ActionLogProps {
  logs: LogType[];
}

const ActionLog: React.FC<ActionLogProps> = ({ logs }) => {
  return (
    <div className="h-full flex flex-col bg-white border-l border-gray-200">
      <div className="p-4 border-b border-gray-100 flex items-center space-x-2">
        <Activity className="w-5 h-5 text-blue-600" />
        <h2 className="font-semibold text-gray-700">Live Activity Log</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {logs.length === 0 ? (
          <div className="text-gray-400 text-sm text-center py-10">
            No activity yet. Speak to Maya to start.
          </div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className={`p-3 rounded-lg text-sm border ${
              log.type === 'tool' ? 'bg-blue-50 border-blue-100' : 
              log.type === 'error' ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-100'
            }`}>
              <div className="flex items-start space-x-2">
                {log.type === 'tool' ? <Activity className="w-4 h-4 text-blue-500 mt-0.5" /> : 
                 log.type === 'error' ? <AlertCircle className="w-4 h-4 text-red-500 mt-0.5" /> : 
                 <Info className="w-4 h-4 text-gray-500 mt-0.5" />}
                <div className="flex-1">
                  <p className="text-gray-800 leading-tight">{log.message}</p>
                  <span className="text-[10px] text-gray-400 mt-1 block">
                    {log.timestamp.toLocaleTimeString()}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ActionLog;
