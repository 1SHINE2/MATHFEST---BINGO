import { useState, useEffect } from 'react';
import Admin from './Admin';
import Stage from './Stage';
import RegisterPage from './RegisterPage';

function App() {
  const [route, setRoute] = useState(window.location.pathname);

  useEffect(() => {
    const handlePopState = () => setRoute(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    setRoute(path);
  };

  if (route === '/stage') return <Stage />;
  if (route === '/admin') return <Admin />;
  if (route === '/register') return <RegisterPage />;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-white relative overflow-hidden">
      {/* Ambient glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_30%,_rgba(59,130,246,0.12)_0%,_transparent_65%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_80%,_rgba(16,185,129,0.07)_0%,_transparent_65%)]" />

      <div className="z-10 text-center space-y-6 px-8">
        <div className="text-white/30 text-base uppercase tracking-[0.4em] font-bold">Welcome to</div>

        <h1 className="text-7xl font-black tracking-tight leading-none">
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-400 to-emerald-400">
            MathFest
          </span>
          <br />
          <span className="text-white/90">AI Speed Bingo</span>
        </h1>

        <p className="text-white/40 text-lg max-w-md mx-auto leading-relaxed">
          A live paper-based math competition. Select a view to begin.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center mt-8">
          <button
            onClick={() => navigate('/admin')}
            className="group px-10 py-5 bg-blue-600 hover:bg-blue-500 rounded-2xl text-xl font-bold
              transition-all hover:scale-105 shadow-lg shadow-blue-500/20 hover:shadow-blue-500/40"
          >
            <span className="mr-2">🎮</span> Host Controller
            <div className="text-xs font-normal text-blue-200/70 mt-0.5">Admin UI · Controls the game</div>
          </button>

          <button
            onClick={() => navigate('/stage')}
            className="group px-10 py-5 bg-emerald-700 hover:bg-emerald-600 rounded-2xl text-xl font-bold
              transition-all hover:scale-105 shadow-lg shadow-emerald-500/15 hover:shadow-emerald-500/30"
          >
            <span className="mr-2">📺</span> Stage Display
            <div className="text-xs font-normal text-emerald-200/70 mt-0.5">Project on main screen</div>
          </button>

          <button
            onClick={() => navigate('/register')}
            className="group px-10 py-5 bg-indigo-700 hover:bg-indigo-600 rounded-2xl text-xl font-bold
              transition-all hover:scale-105 shadow-lg shadow-indigo-500/15 hover:shadow-indigo-500/30"
          >
            <span className="mr-2">📱</span> Player Registration
            <div className="text-xs font-normal text-indigo-200/70 mt-0.5">Register for the event</div>
          </button>
        </div>
      </div>

      <div className="absolute bottom-8 text-white/15 text-sm font-mono">
        3 Rounds · 3 Phases Each · 240 Unique Problems
      </div>
    </div>
  );
}

export default App;
