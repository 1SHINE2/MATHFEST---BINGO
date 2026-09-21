import { useState, useRef, useEffect } from 'react';

const API = 'http://localhost:3001';

type Step = 'form' | 'pin' | 'confirmed';

interface FormData {
  name: string;
  email: string;
}

export default function RegisterPage() {
  const [step, setStep] = useState<Step>('form');
  const [formData, setFormData] = useState<FormData>({ name: '', email: '' });
  const [pin, setPin] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [registeredName, setRegisteredName] = useState('');
  const pinRefs = useRef<(HTMLInputElement | null)[]>([]);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (resendCooldown > 0) {
      cooldownRef.current = setInterval(() => {
        setResendCooldown(v => {
          if (v <= 1) { clearInterval(cooldownRef.current!); return 0; }
          return v - 1;
        });
      }, 1000);
    }
    return () => { if (cooldownRef.current) clearInterval(cooldownRef.current); };
  }, [resendCooldown]);

  useEffect(() => {
    if (step === 'pin') { setTimeout(() => pinRefs.current[0]?.focus(), 100); }
  }, [step]);

  const handleSendPin = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    const name = formData.name.trim();
    const email = formData.email.trim().toLowerCase();
    if (!name) return setError('Please enter your full name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError('Please enter a valid Google (Gmail) account.');
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/register/send-pin`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email }),
      });
      const data = await res.json();
      if (!res.ok) return setError(data.error || 'Failed to send PIN.');
      setStep('pin'); setResendCooldown(60); setPin(['', '', '', '', '', '']);
    } catch { setError('Network error. Please try again.'); }
    finally { setLoading(false); }
  };

  const handlePinChange = (i: number, value: string) => {
    const v = value.replace(/\D/g, '').slice(-1);
    const next = [...pin]; next[i] = v; setPin(next); setError('');
    if (v && i < 5) pinRefs.current[i + 1]?.focus();
  };

  const handlePinKeyDown = (i: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !pin[i] && i > 0) pinRefs.current[i - 1]?.focus();
  };

  const handlePinPaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) { setPin(pasted.split('')); pinRefs.current[5]?.focus(); }
    e.preventDefault();
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    const pinStr = pin.join('');
    if (pinStr.length < 6) return setError('Please enter all 6 digits.');
    setError(''); setLoading(true);
    try {
      const res = await fetch(`${API}/api/register/verify-pin`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formData.email.trim().toLowerCase(), pin: pinStr }),
      });
      const data = await res.json();
      if (!res.ok) return setError(data.error || 'Verification failed.');
      setRegisteredName(data.player?.name || formData.name);
      setStep('confirmed');
    } catch { setError('Network error. Please try again.'); }
    finally { setLoading(false); }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setError(''); setLoading(true);
    try {
      const res = await fetch(`${API}/api/register/send-pin`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formData.name.trim(), email: formData.email.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) return setError(data.error || 'Failed to resend PIN.');
      setPin(['', '', '', '', '', '']); setResendCooldown(60);
      setTimeout(() => pinRefs.current[0]?.focus(), 50);
    } catch { setError('Network error. Please try again.'); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-4 py-12 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_20%,rgba(52,211,153,0.08),transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_80%,rgba(99,102,241,0.07),transparent_60%)]" />
      <div className="z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-xs font-bold uppercase tracking-[0.4em] text-emerald-400/70 mb-2">MathFest 2026</div>
          <h1 className="text-4xl font-black tracking-tight mb-1">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-300 to-indigo-400">AI Speed Bingo</span>
          </h1>
          <p className="text-slate-400 text-sm mt-1">Player Registration</p>
        </div>

        <div className="flex items-center justify-center gap-2 mb-8">
          {(['form', 'pin', 'confirmed'] as Step[]).map((s, idx) => {
            const done = (s === 'form' && (step === 'pin' || step === 'confirmed')) || (s === 'pin' && step === 'confirmed');
            const active = step === s;
            return (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black border-2 transition-all duration-300 ${
                  active ? 'bg-emerald-500 border-emerald-400 text-white' : done ? 'bg-emerald-900/50 border-emerald-600 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-500'}`}>
                  {done ? '✓' : idx + 1}
                </div>
                {idx < 2 && <div className={`w-12 h-0.5 transition-all duration-500 ${done ? 'bg-emerald-500' : 'bg-slate-700'}`} />}
              </div>
            );
          })}
        </div>

        {step === 'form' && (
          <form onSubmit={handleSendPin} className="bg-slate-900/80 backdrop-blur border border-slate-700/60 rounded-3xl p-8 shadow-2xl space-y-5">
            <div>
              <h2 className="text-xl font-black text-white mb-1">Create your profile</h2>
              <p className="text-slate-400 text-sm">Enter your name and Google account to register.</p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Full Name</label>
                <input type="text" value={formData.name} onChange={e => setFormData(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Juan dela Cruz" autoFocus
                  className="w-full px-4 py-3.5 bg-slate-800 border border-slate-600 rounded-xl text-white text-base placeholder-slate-500 outline-none focus:border-emerald-500 transition-all" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Google Account (Gmail)</label>
                <input type="email" value={formData.email} onChange={e => setFormData(f => ({ ...f, email: e.target.value }))}
                  placeholder="yourname@gmail.com"
                  className="w-full px-4 py-3.5 bg-slate-800 border border-slate-600 rounded-xl text-white text-base placeholder-slate-500 outline-none focus:border-emerald-500 transition-all" />
                <p className="text-slate-500 text-xs mt-1.5 ml-1">A 6-digit verification PIN will be sent to this email.</p>
              </div>
            </div>
            {error && <div className="flex items-start gap-2.5 bg-red-950/50 border border-red-700/60 rounded-xl px-4 py-3 text-red-300 text-sm"><span>⚠️</span><span>{error}</span></div>}
            <button type="submit" disabled={loading}
              className="w-full py-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 rounded-xl font-black text-base tracking-wide transition-all hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed">
              {loading ? 'Sending PIN...' : 'Send Verification PIN →'}
            </button>
          </form>
        )}

        {step === 'pin' && (
          <form onSubmit={handleVerify} className="bg-slate-900/80 backdrop-blur border border-slate-700/60 rounded-3xl p-8 shadow-2xl space-y-6">
            <div>
              <h2 className="text-xl font-black text-white mb-1">Check your email</h2>
              <p className="text-slate-400 text-sm">A 6-digit PIN was sent to <span className="text-emerald-400 font-semibold">{formData.email}</span>. Enter it below.</p>
            </div>
            <div onPaste={handlePinPaste}>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 text-center">Enter 6-Digit PIN</label>
              <div className="flex justify-center gap-3">
                {pin.map((digit, i) => (
                  <input key={i} ref={el => { pinRefs.current[i] = el; }} type="text" inputMode="numeric" maxLength={1} value={digit}
                    onChange={e => handlePinChange(i, e.target.value)} onKeyDown={e => handlePinKeyDown(i, e)}
                    className={`w-12 h-16 text-center text-2xl font-black rounded-xl border-2 bg-slate-800 text-white outline-none transition-all ${digit ? 'border-emerald-500 text-emerald-300' : 'border-slate-600 focus:border-emerald-500'}`} />
                ))}
              </div>
            </div>
            {error && <div className="flex items-start gap-2.5 bg-red-950/50 border border-red-700/60 rounded-xl px-4 py-3 text-red-300 text-sm"><span>⚠️</span><span>{error}</span></div>}
            <button type="submit" disabled={loading || pin.join('').length < 6}
              className="w-full py-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 rounded-xl font-black text-base tracking-wide transition-all hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed">
              {loading ? 'Verifying...' : 'Verify & Register ✓'}
            </button>
            <div className="flex items-center justify-between pt-1">
              <button type="button" onClick={() => { setStep('form'); setError(''); setPin(['','','','','','']); }}
                className="text-slate-500 hover:text-slate-300 text-sm transition-colors">← Change email</button>
              <button type="button" onClick={handleResend} disabled={resendCooldown > 0 || loading}
                className="text-sm font-semibold text-emerald-400 hover:text-emerald-300 disabled:text-slate-600 disabled:cursor-not-allowed transition-colors">
                {resendCooldown > 0 ? `Resend PIN in ${resendCooldown}s` : 'Resend PIN'}
              </button>
            </div>
          </form>
        )}

        {step === 'confirmed' && (
          <div className="bg-slate-900/80 backdrop-blur border border-emerald-500/30 rounded-3xl p-8 shadow-2xl text-center">
            <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-emerald-500/10 border-4 border-emerald-500 flex items-center justify-center relative">
              <svg className="w-12 h-12 text-emerald-400" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <div className="absolute inset-0 rounded-full border-4 border-emerald-400 opacity-40 animate-ping" />
            </div>
            <div className="text-xs font-bold uppercase tracking-[0.4em] text-emerald-400 mb-2">Registration Confirmed</div>
            <h2 className="text-3xl font-black text-white mb-1">{`You're in, ${registeredName.split(' ')[0]}!`}</h2>
            <p className="text-slate-400 text-sm mb-6">You have been successfully registered for</p>
            <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-5 mb-6 text-left space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-900/60 border border-emerald-700 flex items-center justify-center text-lg">🎲</div>
                <div>
                  <div className="text-white font-black text-lg leading-none">MathFest AI Speed Bingo</div>
                  <div className="text-slate-400 text-xs mt-0.5">3 Rounds · 3 Phases Each · 240 Unique Problems</div>
                </div>
              </div>
              <div className="h-px bg-slate-700" />
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-400">Name</span><span className="text-white font-semibold">{registeredName}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Email</span><span className="text-emerald-400 font-mono text-xs">{formData.email}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Status</span>
                  <span className="text-emerald-400 font-bold flex items-center gap-1"><span className="w-2 h-2 bg-emerald-400 rounded-full inline-block animate-pulse" />Verified</span>
                </div>
              </div>
            </div>
            <p className="text-slate-500 text-sm">Your name has been added to the roster. Wait for the host to begin. Good luck! 🍀</p>
          </div>
        )}

        <p className="text-center text-slate-600 text-xs mt-6">MathFest 2026 · AI Speed Bingo · Powered by Allison AI</p>
      </div>
    </div>
  );
}
