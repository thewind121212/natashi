import { Link, useLocation } from 'react-router-dom';
import { Radio, Bot } from 'lucide-react';

export function ModeSwitch() {
  const location = useLocation();
  const isBotMode = location.pathname.startsWith('/bot');

  return (
    <div className="flex items-center gap-2 bg-slate-800 p-1 rounded-lg border border-slate-700">
      <Link
        to="/"
        className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
          !isBotMode ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        <Radio size={14} /> Audio Play
      </Link>
      <Link
        to="/bot"
        className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
          isBotMode ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        <Bot size={14} /> Bot Control
      </Link>
    </div>
  );
}
