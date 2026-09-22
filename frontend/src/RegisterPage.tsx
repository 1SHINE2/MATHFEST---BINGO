import React, { useState, useRef, useEffect } from 'react';
import { getBackendUrl, setCustomBackendUrl } from './utils';

type Step = 'form' | 'pin' | 'card' | 'join' | 'confirmed';

interface FormData {
  name: string;
  email: string;
}

// ── 3D CYBERPUNK GRID ARENA BACKGROUND ─────────────────────────────────────────
function CyberGridArenaBackground({ children }: { children: React.ReactNode }) {
  const equalizerBarsLeft = [18, 32, 45, 28, 56, 38, 62, 48, 22, 50, 35, 60, 42, 25, 48];
  const equalizerBarsRight = [25, 42, 60, 35, 50, 22, 48, 62, 38, 56, 28, 45, 32, 18, 40];

  return (
    <div className="min-h-screen w-full bg-[#090014] text-white flex items-center justify-center relative overflow-hidden font-sans select-none">
      {/* ── 1. PERSPECTIVE 3D GRID FLOOR & CEILING ── */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(168,85,247,0.18)_0%,rgba(0,245,212,0.08)_35%,rgba(9,0,20,0.98)_75%)]" />

        {/* Top 3D Perspective Grid */}
        <div className="absolute -top-[50%] left-[-50%] right-[-50%] h-[100%] opacity-20 transform -perspective-[800px] rotate-x-[60deg] pointer-events-none">
          <div className="w-full h-full bg-[linear-gradient(to_right,rgba(168,85,247,0.3)_1px,transparent_1px),linear-gradient(to_bottom,rgba(168,85,247,0.3)_1px,transparent_1px)] bg-[size:60px_60px] animate-pulse" />
        </div>

        {/* Bottom 3D Perspective Grid */}
        <div className="absolute -bottom-[50%] left-[-50%] right-[-50%] h-[100%] opacity-25 transform -perspective-[800px] -rotate-x-[60deg] pointer-events-none">
          <div className="w-full h-full bg-[linear-gradient(to_right,rgba(0,245,212,0.35)_1px,transparent_1px),linear-gradient(to_bottom,rgba(217,70,239,0.35)_1px,transparent_1px)] bg-[size:60px_60px]" />
        </div>

        {/* Horizon Glow Line */}
        <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-[#00F5D4] to-transparent shadow-[0_0_20px_#00F5D4] opacity-80" />
      </div>

      {/* ── 2. FLOATING 3D WIREFRAME GEOMETRIC POLYHEDRONS ── */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
        {/* Floating Wireframe Cube */}
        <svg className="absolute top-16 left-12 md:left-24 w-28 h-28 opacity-40 animate-spin-slow" viewBox="0 0 100 100">
          <polygon points="30,20 70,20 85,35 45,35" fill="none" stroke="#D946EF" strokeWidth="1.5" />
          <polygon points="30,20 45,35 45,75 30,60" fill="none" stroke="#D946EF" strokeWidth="1.5" />
          <polygon points="70,20 85,35 85,75 70,60" fill="none" stroke="#D946EF" strokeWidth="1.5" />
          <polygon points="30,60 70,60 85,75 45,75" fill="none" stroke="#D946EF" strokeWidth="1.5" />
        </svg>

        {/* Floating Icosahedron */}
        <svg className="absolute top-20 right-16 md:right-28 w-32 h-32 opacity-45 animate-pulse" viewBox="0 0 100 100">
          <polygon points="50,10 85,30 50,50 15,30" fill="none" stroke="#00F5D4" strokeWidth="1.5" />
          <polygon points="50,50 85,30 85,70 50,90 15,70 15,30" fill="none" stroke="#00F5D4" strokeWidth="1.5" />
          <polygon points="50,10 50,50 50,90" fill="none" stroke="#00F5D4" strokeWidth="1.5" />
        </svg>

        {/* Floating Octahedron */}
        <svg className="absolute bottom-20 left-16 md:left-32 w-32 h-32 opacity-40 animate-bounce-slow" viewBox="0 0 100 100">
          <polygon points="50,10 90,50 50,90 10,50" fill="none" stroke="#FF6B35" strokeWidth="1.5" />
          <line x1="10" y1="50" x2="90" y2="50" stroke="#FF6B35" strokeWidth="1.5" />
          <line x1="50" y1="10" x2="50" y2="90" stroke="#FF6B35" strokeWidth="1.5" />
        </svg>

        {/* Floating Dodecahedron */}
        <svg className="absolute bottom-24 right-20 md:right-36 w-28 h-28 opacity-45 animate-spin-slow" viewBox="0 0 100 100">
          <polygon points="50,15 80,30 80,70 50,85 20,70 20,30" fill="none" stroke="#A855F7" strokeWidth="1.5" />
          <polygon points="50,30 70,40 70,60 50,70 30,60 30,40" fill="none" stroke="#A855F7" strokeWidth="1.5" />
        </svg>
      </div>

      {/* ── 3. DRIFTING NEON MATH SYMBOLS ── */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden text-2xl md:text-4xl font-mono select-none">
        <span className="absolute top-[18%] left-[8%] text-[#FF6B35] opacity-60 drop-shadow-[0_0_10px_#FF6B35] animate-pulse">∫</span>
        <span className="absolute top-[35%] left-[5%] text-[#00F5D4] opacity-70 drop-shadow-[0_0_10px_#00F5D4]">π</span>
        <span className="absolute bottom-[35%] left-[7%] text-[#D946EF] opacity-60 drop-shadow-[0_0_10px_#D946EF]">Σ</span>
        <span className="absolute bottom-[18%] left-[10%] text-[#FFE066] opacity-70 drop-shadow-[0_0_10px_#FFE066]">√</span>

        <span className="absolute top-[20%] right-[10%] text-[#00F5D4] opacity-70 drop-shadow-[0_0_10px_#00F5D4]">∞</span>
        <span className="absolute top-[40%] right-[6%] text-[#A855F7] opacity-60 drop-shadow-[0_0_10px_#A855F7]">π</span>
        <span className="absolute bottom-[30%] right-[8%] text-[#FF6B35] opacity-70 drop-shadow-[0_0_10px_#FF6B35]">∫</span>
        <span className="absolute bottom-[15%] right-[12%] text-[#00F5D4] opacity-60 drop-shadow-[0_0_10px_#00F5D4]">√</span>
      </div>

      {/* ── 4. LEFT & RIGHT EDGE AUDIO EQUALIZERS ── */}
      <div className="absolute left-3 md:left-6 top-0 bottom-0 z-10 hidden sm:flex flex-col items-center justify-center gap-1.5 pointer-events-none">
        {equalizerBarsLeft.map((h, i) => (
          <div
            key={`eq-l-${i}`}
            className="w-1 bg-gradient-to-r from-[#FF6B35] via-[#FF8C42] to-[#FFE066] rounded-full shadow-[0_0_8px_#FF6B35] animate-pulse"
            style={{ width: `${h * 0.5}px`, height: '3px', animationDuration: `${0.6 + (i % 5) * 0.2}s` }}
          />
        ))}
      </div>

      <div className="absolute right-3 md:right-6 top-0 bottom-0 z-10 hidden sm:flex flex-col items-center justify-center gap-1.5 pointer-events-none">
        {equalizerBarsRight.map((h, i) => (
          <div
            key={`eq-r-${i}`}
            className="w-1 bg-gradient-to-l from-[#FF6B35] via-[#FF8C42] to-[#FFE066] rounded-full shadow-[0_0_8px_#FF6B35] animate-pulse"
            style={{ width: `${h * 0.5}px`, height: '3px', animationDuration: `${0.7 + (i % 4) * 0.25}s` }}
          />
        ))}
      </div>

      {/* ── 5. CYBER TELEMETRY HUD OVERLAYS ── */}
      <div className="absolute top-4 left-6 z-10 hidden lg:block font-mono text-[10px] text-[#00F5D4]/70 leading-tight pointer-events-none">
        <div>// SYS.LOC: KN480EFS</div>
        <div>// T: 08:04:18</div>
        <div className="text-[#67E8F9] font-bold mt-0.5">0492024.110</div>
        <div className="text-emerald-400">STAT: INITIALIZED</div>
      </div>

      <div className="absolute top-4 right-6 z-10 hidden lg:block font-mono text-[10px] text-right text-[#00F5D4]/70 leading-tight pointer-events-none">
        <div>0492024.110</div>
        <div>STAT: 11AGUO40E</div>
        <div>PROGRAM: T&E00</div>
        <div className="text-amber-300">GENIS: 049.80est.</div>
        <div className="text-red-400 font-bold flex items-center justify-end gap-1 mt-0.5">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" /> RECON.SYNC
        </div>
      </div>

      {/* ── 6. MAIN CONTENT CONTAINER ── */}
      <div className="relative z-20 w-full max-w-md px-4 py-8">
        {children}
      </div>
    </div>
  );
}

// ── MAIN REGISTER PAGE COMPONENT ──────────────────────────────────────────────
export default function RegisterPage() {
  const API = getBackendUrl();
  const [step, setStep] = useState<Step>('form');
  const [formData, setFormData] = useState<FormData>({ name: '', email: '' });
  const [pin, setPin] = useState(['', '', '', '', '', '']);
  const [cardIdInput, setCardIdInput] = useState('');
  const [assignedCardId, setAssignedCardId] = useState('');
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
          if (v <= 1) {
            clearInterval(cooldownRef.current!);
            return 0;
          }
          return v - 1;
        });
      }, 1000);
    }
    return () => { if (cooldownRef.current) clearInterval(cooldownRef.current); };
  }, [resendCooldown]);

  useEffect(() => {
    if (step === 'pin') {
      setTimeout(() => pinRefs.current[0]?.focus(), 100);
    }
  }, [step]);

  const handleSendPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const name = formData.name.trim();
    const email = formData.email.trim().toLowerCase();

    if (!name) return setError('Please enter your full name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError('Please enter a valid email address.');

    setLoading(true);
    try {
      const res = await fetch(`${API}/api/register/send-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email }),
      });
      const data = await res.json();
      if (!res.ok) return setError(data.error || 'Failed to send PIN.');
      setStep('pin');
      setResendCooldown(60);
      setPin(['', '', '', '', '', '']);
    } catch {
      setError('Network error. Could not connect to host. Please ensure backend is running.');
    } finally {
      setLoading(false);
    }
  };

  const handlePinChange = (i: number, value: string) => {
    const v = value.replace(/\D/g, '').slice(-1);
    const next = [...pin];
    next[i] = v;
    setPin(next);
    setError('');
    if (v && i < 5) {
      pinRefs.current[i + 1]?.focus();
    }
  };

  const handlePinKeyDown = (i: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !pin[i] && i > 0) {
      pinRefs.current[i - 1]?.focus();
    }
  };

  const handlePinPaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      setPin(pasted.split(''));
      pinRefs.current[5]?.focus();
    }
    e.preventDefault();
  };

  // Step 2: Verify PIN (moves to Step 3 Booth & Card Link)
  const handleVerifyPin = async (e: React.FormEvent) => {
    e.preventDefault();
    const pinStr = pin.join('');
    if (pinStr.length < 6) return setError('Please enter all 6 digits.');
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/register/verify-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formData.email.trim().toLowerCase(), pin: pinStr }),
      });
      const data = await res.json();
      if (!res.ok) return setError(data.error || 'Verification failed.');
      setRegisteredName(data.player?.name || formData.name);
      if (data.player?.assignedCardId) {
        setAssignedCardId(data.player.assignedCardId);
        setStep('join');
      } else {
        setStep('card');
      }
    } catch {
      setError('Network error. Could not connect to host.');
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Link Physical Card ID
  const handleAssignCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cardIdInput.trim()) return setError('Please enter your Bingo Card ID.');
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/register/assign-card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formData.email.trim().toLowerCase(), cardId: cardIdInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) return setError(data.error || 'Failed to link card.');
      setAssignedCardId(data.cardId);
      setStep('join');
    } catch {
      setError('Network error. Could not connect to host.');
    } finally {
      setLoading(false);
    }
  };

  // Step 4: Official Join Tournament Grid Button
  const handleJoinGrid = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/register/join-grid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formData.email.trim().toLowerCase(), cardId: assignedCardId }),
      });
      const data = await res.json();
      if (!res.ok) return setError(data.error || 'Failed to join tournament roster.');
      setRegisteredName(data.player?.name || formData.name);
      setStep('confirmed');
    } catch {
      setError('Network error. Could not connect to host.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/register/send-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formData.name.trim(), email: formData.email.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) return setError(data.error || 'Failed to resend PIN.');
      setPin(['', '', '', '', '', '']);
      setResendCooldown(60);
      setTimeout(() => pinRefs.current[0]?.focus(), 50);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const stepOrder: Step[] = ['form', 'pin', 'card', 'join'];

  return (
    <CyberGridArenaBackground>
      {/* Brand Header */}
      <div className="text-center mb-6">
        <div className="text-xs font-black uppercase tracking-[0.4em] text-[#00F5D4] drop-shadow-[0_0_8px_#00F5D4] mb-1">
          MathFest 2026
        </div>
        <h1 className="text-4xl font-black tracking-tight mb-1">
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#00F5D4] via-[#D946EF] to-[#FF6B35] drop-shadow-lg">
            AI Speed Bingo
          </span>
        </h1>
        <p className="text-slate-400 text-xs tracking-wider uppercase font-semibold">Player Registration Portal</p>
      </div>

      {/* 4-Step Progress Indicator */}
      <div className="flex items-center justify-center gap-1.5 mb-6">
        {stepOrder.map((s, idx) => {
          const currentIdx = stepOrder.indexOf(step === 'confirmed' ? 'join' : step);
          const done = currentIdx > idx || step === 'confirmed';
          const active = step === s;
          const labels = ['Profile', 'PIN', 'Card ID', 'Join Grid'];

          return (
            <React.Fragment key={s}>
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black border-2 transition-all duration-300 ${
                    active
                      ? 'bg-[#00F5D4] border-[#00F5D4] text-[#090014] shadow-[0_0_18px_#00F5D4]'
                      : done
                      ? 'bg-[#00F5D4]/20 border-[#00F5D4] text-[#00F5D4]'
                      : 'bg-slate-900/80 border-slate-700 text-slate-500'
                  }`}
                >
                  {done ? '✓' : idx + 1}
                </div>
                <span className={`text-[10px] font-bold uppercase tracking-wider ${active ? 'text-[#00F5D4]' : done ? 'text-slate-300' : 'text-slate-600'}`}>
                  {labels[idx]}
                </span>
              </div>
              {idx < 3 && (
                <div
                  className={`w-8 h-0.5 mb-4 transition-all duration-500 ${
                    done ? 'bg-[#00F5D4] shadow-[0_0_8px_#00F5D4]' : 'bg-slate-800'
                  }`}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* ── STEP 1: Registration Form ── */}
      {step === 'form' && (
        <form
          onSubmit={handleSendPin}
          className="bg-[#0E0124]/90 backdrop-blur-md border-2 border-[#A855F7]/60 rounded-3xl p-7 shadow-[0_0_35px_rgba(168,85,247,0.3)] space-y-5"
        >
          <div>
            <h2 className="text-xl font-black text-white mb-0.5">Create Player Profile</h2>
            <p className="text-slate-400 text-xs">Enter your name and email address to register for the event.</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-[11px] font-black text-[#00F5D4] uppercase tracking-widest mb-1.5">
                Full Name
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={e => setFormData(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Juan dela Cruz"
                autoFocus
                className="w-full px-4 py-3.5 bg-slate-950/80 border border-slate-700 rounded-xl text-white text-base
                  placeholder-slate-500 outline-none focus:border-[#00F5D4] focus:ring-2 focus:ring-[#00F5D4]/20
                  transition-all"
              />
            </div>

            <div>
              <label className="block text-[11px] font-black text-[#00F5D4] uppercase tracking-widest mb-1.5">
                Email Address
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={e => setFormData(f => ({ ...f, email: e.target.value }))}
                placeholder="yourname@email.com"
                className="w-full px-4 py-3.5 bg-slate-950/80 border border-slate-700 rounded-xl text-white text-base
                  placeholder-slate-500 outline-none focus:border-[#00F5D4] focus:ring-2 focus:ring-[#00F5D4]/20
                  transition-all"
              />
              <p className="text-slate-400 text-xs mt-1.5 ml-1">
                A 6-digit verification PIN will be dispatched to this email.
              </p>
              <p className="text-amber-400/90 text-xs mt-1 ml-1 flex items-center gap-1.5 font-medium">
                <span>📥</span> <span>Check your <strong>Spam / Junk</strong> folder if not found in your Inbox.</span>
              </p>
            </div>
          </div>

          {error && (
            <div className="bg-red-950/60 border border-red-700 rounded-xl p-3.5 text-red-300 text-xs space-y-2">
              <div className="flex items-start gap-2">
                <span className="text-base leading-none">⚠️</span>
                <span className="flex-1">{error}</span>
              </div>
              {error.toLowerCase().includes('network') && (
                <div className="pt-1 border-t border-red-800/60">
                  <button
                    type="button"
                    onClick={() => {
                      const url = prompt('Enter your active Backend Host / Tunnel URL (e.g. https://mathfest.loca.lt or http://192.168.x.x:3001):', API);
                      if (url !== null) {
                        setCustomBackendUrl(url);
                        window.location.reload();
                      }
                    }}
                    className="text-xs font-bold text-[#00F5D4] hover:underline cursor-pointer"
                  >
                    ⚙️ Configure Host / Tunnel API URL →
                  </button>
                </div>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-gradient-to-r from-[#00F5D4] via-[#00D4B2] to-[#0284C7] hover:from-[#00F5D4] hover:to-[#0284C7]
              rounded-xl font-black text-slate-950 text-base tracking-widest uppercase transition-all hover:scale-[1.02] active:scale-[0.98]
              shadow-[0_0_25px_rgba(0,245,212,0.4)] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 cursor-pointer"
          >
            {loading ? 'Sending PIN...' : 'Send Verification PIN →'}
          </button>
        </form>
      )}

      {/* ── STEP 2: PIN Verification ── */}
      {step === 'pin' && (
        <form
          onSubmit={handleVerifyPin}
          className="bg-[#0E0124]/90 backdrop-blur-md border-2 border-[#A855F7]/60 rounded-3xl p-7 shadow-[0_0_35px_rgba(168,85,247,0.3)] space-y-6"
        >
          <div>
            <h2 className="text-xl font-black text-white mb-0.5">Check Your Email</h2>
            <p className="text-slate-300 text-xs leading-relaxed">
              A 6-digit PIN was dispatched to <span className="text-[#00F5D4] font-bold">{formData.email}</span>.
              Enter it below to validate your PIN.
            </p>
            <div className="mt-2.5 px-3.5 py-2 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-xs flex items-center gap-2">
              <span className="text-base">📬</span>
              <span>Can't find it in your Inbox? Please check your <strong>Spam / Junk</strong> folder!</span>
            </div>
          </div>

          <div onPaste={handlePinPaste}>
            <label className="block text-[11px] font-black text-[#00F5D4] uppercase tracking-widest mb-3 text-center">
              Enter 6-Digit Verification PIN
            </label>
            <div className="flex justify-center gap-2.5">
              {pin.map((digit, i) => (
                <input
                  key={i}
                  ref={el => { pinRefs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={e => handlePinChange(i, e.target.value)}
                  onKeyDown={e => handlePinKeyDown(i, e)}
                  className={`w-11 h-14 text-center text-2xl font-black rounded-xl border-2 bg-slate-950 text-white outline-none transition-all ${
                    digit
                      ? 'border-[#00F5D4] text-[#00F5D4] shadow-[0_0_12px_rgba(0,245,212,0.4)]'
                      : 'border-slate-700 focus:border-[#00F5D4]'
                  }`}
                />
              ))}
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 bg-red-950/60 border border-red-700 rounded-xl px-4 py-3 text-red-300 text-xs leading-relaxed">
              <span className="text-base leading-none">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || pin.join('').length < 6}
            className="w-full py-4 bg-gradient-to-r from-[#00F5D4] via-[#00D4B2] to-[#0284C7] hover:from-[#00F5D4] hover:to-[#0284C7]
              rounded-xl font-black text-slate-950 text-base tracking-widest uppercase transition-all hover:scale-[1.02] active:scale-[0.98]
              shadow-[0_0_25px_rgba(0,245,212,0.4)] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 cursor-pointer"
          >
            {loading ? 'Verifying...' : 'Validate PIN →'}
          </button>

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => { setStep('form'); setError(''); setPin(['', '', '', '', '', '']); }}
              className="text-slate-400 hover:text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              ← Change email
            </button>
            <button
              type="button"
              onClick={handleResend}
              disabled={resendCooldown > 0 || loading}
              className="text-xs font-bold text-[#00F5D4] hover:text-[#4DFFDB] disabled:text-slate-600 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {resendCooldown > 0 ? `Resend PIN in ${resendCooldown}s` : 'Resend PIN'}
            </button>
          </div>
        </form>
      )}

      {/* ── STEP 3: Booth Instruction & Link Card ID ── */}
      {step === 'card' && (
        <form
          onSubmit={handleAssignCard}
          className="bg-[#0E0124]/90 backdrop-blur-md border-2 border-[#00F5D4]/60 rounded-3xl p-7 shadow-[0_0_35px_rgba(0,245,212,0.3)] space-y-5"
        >
          {/* Booth Banner Notice */}
          <div className="bg-amber-950/70 border-2 border-amber-500/70 rounded-2xl p-4 text-left shadow-[0_0_20px_rgba(245,158,11,0.2)]">
            <div className="flex items-center gap-2 text-amber-300 font-black text-sm uppercase tracking-wider mb-1">
              <span>📍</span> <span>Step 3: Proceed to Bingo Booth</span>
            </div>
            <p className="text-amber-100 text-xs leading-relaxed font-semibold">
              Please proceed to the <strong>BINGO CARD BOOTH</strong> to receive your physical Bingo Card! Once you receive your card, enter the Card ID below.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-black text-white mb-0.5">Link Your Physical Bingo Card</h2>
            <p className="text-slate-400 text-xs">Enter the 6-digit Card ID printed at the bottom of your physical card.</p>
          </div>

          <div>
            <label className="block text-[11px] font-black text-[#00F5D4] uppercase tracking-widest mb-1.5">
              Card ID Number
            </label>
            <div className="relative">
              <input
                type="text"
                value={cardIdInput}
                onChange={e => setCardIdInput(e.target.value)}
                placeholder="e.g. 000123 or #CARD-000123"
                autoFocus
                className="w-full px-4 py-3.5 bg-slate-950/80 border border-slate-700 rounded-xl text-white font-mono text-lg tracking-widest
                  placeholder-slate-600 outline-none focus:border-[#00F5D4] focus:ring-2 focus:ring-[#00F5D4]/20
                  transition-all"
              />
            </div>
            <p className="text-slate-400 text-[11px] mt-1.5 ml-1 font-mono">
              Format: #CARD-000000 to #CARD-000999
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 bg-red-950/60 border border-red-700 rounded-xl px-4 py-3 text-red-300 text-xs leading-relaxed">
              <span className="text-base leading-none">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !cardIdInput.trim()}
            className="w-full py-4 bg-gradient-to-r from-[#00F5D4] via-[#00D4B2] to-[#0284C7] hover:from-[#00F5D4] hover:to-[#0284C7]
              rounded-xl font-black text-slate-950 text-base tracking-widest uppercase transition-all hover:scale-[1.02] active:scale-[0.98]
              shadow-[0_0_25px_rgba(0,245,212,0.4)] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 cursor-pointer"
          >
            {loading ? 'Linking Card...' : 'Link Bingo Card →'}
          </button>
        </form>
      )}

      {/* ── STEP 4: Join Tournament Grid Button (Final Confirmation) ── */}
      {step === 'join' && (
        <div className="bg-[#0E0124]/90 backdrop-blur-md border-2 border-[#D946EF]/60 rounded-3xl p-7 shadow-[0_0_40px_rgba(217,70,239,0.35)] text-center space-y-6">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.4em] text-[#D946EF] drop-shadow-[0_0_8px_#D946EF] mb-1">
              Final Verification Step
            </div>
            <h2 className="text-2xl font-black text-white">Confirm &amp; Join Roster</h2>
            <p className="text-slate-300 text-xs mt-1">
              Review your details below and click the button to officially join the tournament.
            </p>
          </div>

          {/* Registration Details Card */}
          <div className="bg-slate-950/80 border border-slate-700/80 rounded-2xl p-4 text-left space-y-2.5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#00F5D4]/10 border border-[#00F5D4]/40 flex items-center justify-center text-lg">
                🎟️
              </div>
              <div>
                <div className="text-white font-black text-sm leading-none">{registeredName || formData.name}</div>
                <div className="text-[#00F5D4] font-mono text-[11px] mt-0.5">{formData.email}</div>
              </div>
            </div>
            <div className="h-px bg-slate-800" />
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Linked Card ID</span>
                <span className="text-emerald-400 font-mono font-bold text-sm bg-emerald-950/60 px-2.5 py-0.5 rounded-lg border border-emerald-700">{assignedCardId}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Status</span>
                <span className="text-amber-300 font-bold flex items-center gap-1.5">
                  <span className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" /> PENDING VERIFICATION
                </span>
              </div>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 bg-red-950/60 border border-red-700 rounded-xl px-4 py-3 text-red-300 text-xs text-left">
              <span className="text-base leading-none">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {/* Official JOIN TOURNAMENT GRID Button */}
          <button
            onClick={handleJoinGrid}
            disabled={loading}
            className="w-full py-5 bg-gradient-to-r from-[#00F5D4] via-[#D946EF] to-[#FF6B35] hover:opacity-95
              rounded-2xl font-black text-slate-950 text-lg tracking-widest uppercase transition-all hover:scale-[1.03] active:scale-[0.98]
              shadow-[0_0_35px_rgba(0,245,212,0.6)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2 animate-pulse"
          >
            <span>⚡</span> <span>JOIN TOURNAMENT GRID</span>
          </button>
        </div>
      )}

      {/* ── STEP 5: Confirmed (Officially Verified & Live) ── */}
      {step === 'confirmed' && (
        <div className="bg-[#0E0124]/90 backdrop-blur-md border-2 border-[#00F5D4]/60 rounded-3xl p-7 shadow-[0_0_40px_rgba(0,245,212,0.3)] text-center">
          <div className="w-20 h-20 mx-auto mb-5 rounded-full bg-[#00F5D4]/10 border-4 border-[#00F5D4] flex items-center justify-center shadow-[0_0_30px_rgba(0,245,212,0.5)] relative">
            <svg className="w-10 h-10 text-[#00F5D4]" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <div className="absolute inset-0 rounded-full border-4 border-[#00F5D4] opacity-40 animate-ping" />
          </div>

          <div className="text-xs font-black uppercase tracking-[0.4em] text-[#00F5D4] drop-shadow-[0_0_8px_#00F5D4] mb-1">
            Tournament Roster Verified
          </div>
          <h2 className="text-2xl font-black text-white mb-1">
            You're In, {registeredName.split(' ')[0]}!
          </h2>
          <p className="text-slate-300 text-xs mb-5">
            You are officially verified and entered into the live competition roster.
          </p>

          <div className="bg-slate-950/80 border border-slate-700/80 rounded-2xl p-4 text-left space-y-2.5 mb-5">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#00F5D4]/10 border border-[#00F5D4]/40 flex items-center justify-center text-base">
                🎲
              </div>
              <div>
                <div className="text-white font-black text-sm leading-none">MathFest AI Speed Bingo</div>
                <div className="text-slate-400 text-[11px] mt-0.5">3 Rounds · 240 Unique Problems</div>
              </div>
            </div>
            <div className="h-px bg-slate-800" />
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between"><span className="text-slate-400">Name</span><span className="text-white font-bold">{registeredName}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Email</span><span className="text-[#00F5D4] font-mono text-[11px]">{formData.email}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Linked Card ID</span><span className="text-emerald-400 font-mono font-bold text-xs">{assignedCardId}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Status</span>
                <span className="text-[#00F5D4] font-bold flex items-center gap-1.5"><span className="w-2 h-2 bg-[#00F5D4] rounded-full animate-pulse" />Verified &amp; Live</span>
              </div>
            </div>
          </div>

          <p className="text-slate-400 text-xs leading-relaxed">
            Your card is registered and ready in the host system. Please wait for the event host to begin Round 1. Good luck! 🍀
          </p>
        </div>
      )}
    </CyberGridArenaBackground>
  );
}
