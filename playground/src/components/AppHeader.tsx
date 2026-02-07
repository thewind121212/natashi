import { Radio } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ModeSwitch } from './ModeSwitch';
import { LoginButton } from './LoginButton';

export function AppHeader() {
  return (
    <header className="flex-none h-16 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 z-40">
      <div className="max-w-7xl mx-auto h-full flex items-center justify-between px-4 md:px-8">
        <Link to="/" className="flex items-center gap-3">
          <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center shadow-[0_0_15px_rgba(99,102,241,0.4)]">
            <Radio className="text-white w-5 h-5" />
          </div>
          <span className="text-lg font-bold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
            Natashi
          </span>
        </Link>

        <div className="flex items-center gap-3">
          <ModeSwitch />
          <LoginButton />
        </div>
      </div>
    </header>
  );
}
