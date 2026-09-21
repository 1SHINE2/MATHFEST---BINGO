import { useState, useEffect, useRef, useMemo } from 'react';
import { io } from 'socket.io-client';
import {
  Trophy, CheckCircle, XCircle, ScanSearch, AlertCircle,
  Zap, Ticket, Sparkles, Crown, Medal, ShieldAlert, Award,
  Play, Radio, Maximize, Minimize
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { GameStatus } from './Admin';
import { ALLISON_AUDIO_PROFILES } from './allisonAudioData';

const SOCKET_URL = 'http://localhost:3001';

const ROUND_NAMES: Record<number, string> = {
  1: 'Easy', 2: 'Medium', 3: 'Difficult',
};

const TIMER_FOR_ROUND: Record<number, number> = {
  1: 10, 2: 15, 3: 20,
};

// Round-specific background theme colors for the HUD frame
const ROUND_THEME: Record<number, { primary: string; accent: string; glow: string }> = {
  1: { primary: '#00F5D4', accent: '#FF6B35', glow: 'rgba(0,245,212,0.7)' },
  2: { primary: '#4DFFDB', accent: '#9B5CF6', glow: 'rgba(77,255,219,0.7)' },
  3: { primary: '#00FFD0', accent: '#FF00CC', glow: 'rgba(0,255,208,0.8)' },
};

const LINES = [
  [0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11, 12, 13, 14], [15, 16, 17, 18, 19], [20, 21, 22, 23, 24],
  [0, 5, 10, 15, 20], [1, 6, 11, 16, 21], [2, 7, 12, 17, 22], [3, 8, 13, 18, 23], [4, 9, 14, 19, 24],
  [0, 6, 12, 18, 24], [4, 8, 12, 16, 20],
];

type GameState = {
  status: GameStatus;
  mechanicsSlide?: number;
  allisonLine?: number;
  allisonSpeaking?: boolean;
  currentEquationIndex: number;
  timerSeconds: number;
  maxTimerSeconds: number;
  round: number;
  phase: number;
  phaseName: string;
  patternName: string | null;
  phaseDescription: string;
  pointMatrix: Record<number, number>;
  usedPowers: Record<string, boolean>;
  dualCallActive: boolean;
  dualCallRemaining?: number;
  verifyingPlayerName: string;
  mathErrorPlayerName?: string;
  activatedPower: string;
  highlightedPower: string;
  powerTargetNumber?: string;
  powerDrawnNumber?: string;
};

type VerificationResult = {
  valid: boolean;
  grid: number[];
  drawnNumbers: number[];
  round: number;
  phase: number;
  reason: string;
  points: number;
  playerName: string;
};

type Player = { id: number; name: string; score: number; extraTickets: boolean; doublePoints: boolean };
type Equation = {
  id: number;
  equationText: string;
  targetNumber: number | null;
  difficulty: number;
  isError: boolean;
  isRecalled?: boolean;
};
type LeaderboardStageData = { leaderboard: Player[]; mode: 'cumulative' | 'round'; round?: number };

// ─── TTS ──────────────────────────────────────────────────────────────────────
function toSpokenText(raw: string): string {
  let text = raw.replace(/=\s*\?/, '').trim();

  // 1. Handle sqrt(...)
  text = text.replace(/sqrt\(([^)]+)\)/gi, 'the square root of $1');

  // 2. Handle expressions inside parentheses
  text = text.replace(/\(([^)]+)\)/g, (_match, inner) => {
    let sub = inner.trim();
    sub = sub
      .replace(/(\d+\.?\d*)\s*%\s*of\s*/gi, '$1 percent of ')
      .replace(/\*/g, ' multiplied by ')
      .replace(/\//g, ' divided by ')
      .replace(/\+/g, ' plus ')
      .replace(/(\d+)\s*-\s*(\d+)/g, '$1 minus $2')
      .replace(/(^|\s)-(\d+)/g, '$1negative $2');

    return ` the quantity ${sub} `;
  });

  // 3. Handle outer operators
  text = text
    .replace(/(\d+\.?\d*)\s*%\s*of\s*/gi, '$1 percent of ')
    .replace(/%/g, ' percent ')
    .replace(/\*/g, ' multiplied by ')
    .replace(/\//g, ' divided by ')
    .replace(/\+/g, ' plus ')
    .replace(/(\d+)\s*-\s*(\d+)/g, '$1 minus $2')
    .replace(/(^|\s)-(\d+)/g, '$1negative $2')
    .replace(/=/g, ' equals ');

  // 4. Handle "all divided by" or "multiplied by" after a parenthesized quantity
  text = text
    .replace(/the quantity ([^,]+) divided by/gi, 'the quantity $1, all divided by')
    .replace(/the quantity ([^,]+) multiplied by/gi, 'the quantity $1, multiplied by');

  return text.replace(/\s{2,}/g, ' ').trim();
}

// ─── PATTERN CHECKER ──────────────────────────────────────────────────────────
function getWinningIndices(grid: number[], drawn: Set<number>, phase: number, round: number): Set<number> {
  const cells: boolean[] = Array.from({ length: 25 }, (_, i) => {
    if (i === 12) return true;
    const gIdx = i < 12 ? i : i - 1;
    return drawn.has(grid[gIdx]);
  });

  if (phase === 1) {
    for (const line of LINES) {
      if (line.every(i => cells[i])) return new Set(line);
    }
  } else if (phase === 2) {
    let required: number[] = [];
    if (round === 1) required = [0, 6, 12, 18, 24, 4, 8, 16, 20]; // X-Pattern
    if (round === 2) required = [0, 1, 2, 3, 4, 5, 9, 10, 14, 15, 19, 20, 21, 22, 23, 24]; // Frame
    if (round === 3) required = [2, 6, 7, 8, 10, 11, 12, 13, 14, 16, 17, 18, 22]; // Diamond
    if (required.every(i => cells[i])) return new Set(required);
  } else if (phase === 3) {
    if (cells.every(Boolean)) return new Set(Array.from({ length: 25 }, (_, i) => i));
  }
  return new Set();
}


// ─── PHASE INTRO VISUALIZER ───────────────────────────────────────────────────
function PhaseIntroCard({ phase, round }: { phase: number; round: number }) {
  const [activeLineIdx, setActiveLineIdx] = useState(0);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (phase !== 1) {
      // For phase 2 & 3, blink the entire pattern
      const t = setInterval(() => {
        setIsVisible(v => !v);
      }, 1200);
      return () => clearInterval(t);
    }

    // For phase 1, cycle through lines
    setIsVisible(true);
    const t = setInterval(() => {
      setActiveLineIdx(i => (i + 1) % LINES.length);
    }, 1200);
    return () => clearInterval(t);
  }, [phase]);

  const getWinSet = () => {
    if (phase === 1) return new Set(LINES[activeLineIdx]);
    if (phase === 2) {
      if (round === 1) return new Set([0, 6, 12, 18, 24, 4, 8, 16, 20]);
      if (round === 2) return new Set([0, 1, 2, 3, 4, 5, 9, 10, 14, 15, 19, 20, 21, 22, 23, 24]);
      if (round === 3) return new Set([2, 6, 7, 8, 10, 11, 12, 13, 14, 16, 17, 18, 22]);
    }
    if (phase === 3) return new Set(Array.from({ length: 25 }, (_, i) => i));
    return new Set();
  };

  const winSet = getWinSet();

  return (
    <div className="relative bg-[#070014]/95 border-2 border-[#00F5D4] rounded-3xl p-6 shadow-[0_0_50px_rgba(0,245,212,0.35),inset_0_0_30px_rgba(123,44,191,0.25)] backdrop-blur-xl select-none">
      {/* Corner cyber brackets */}
      <div className="absolute top-2.5 left-2.5 w-3.5 h-3.5 border-t-2 border-l-2 border-[#00F5D4]" />
      <div className="absolute top-2.5 right-2.5 w-3.5 h-3.5 border-t-2 border-r-2 border-[#00F5D4]" />
      <div className="absolute bottom-2.5 left-2.5 w-3.5 h-3.5 border-b-2 border-l-2 border-[#00F5D4]" />
      <div className="absolute bottom-2.5 right-2.5 w-3.5 h-3.5 border-b-2 border-r-2 border-[#00F5D4]" />

      {/* Top telemetry tag */}
      <div className="flex items-center justify-between mb-3 px-1">
        <span className="font-mono text-[10px] text-[#00F5D4] font-black tracking-[0.28em] uppercase drop-shadow-[0_0_8px_rgba(0,245,212,0.8)]">
          NEURAL MATRIX // PATTERN TARGET
        </span>
        <span className="font-mono text-[9px] text-[#FF007F] font-bold tracking-widest uppercase flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[#FF007F] animate-ping" />
          ACTIVE
        </span>
      </div>

      <div className="grid grid-cols-5 gap-3">
        {[
          { l: 'B', color: '#00F5D4' },
          { l: 'I', color: '#00CFFF' },
          { l: 'N', color: '#FF007F' },
          { l: 'G', color: '#FFE066' },
          { l: 'O', color: '#00F5D4' },
        ].map(item => (
          <div
            key={item.l}
            className="text-[4vh] font-arcade font-black text-center pb-1 transition-transform"
            style={{
              color: item.color,
              textShadow: `0 0 16px ${item.color}, 0 0 30px ${item.color}88`,
            }}
          >
            {item.l}
          </div>
        ))}
        {Array.from({ length: 25 }).map((_, i) => {
          const isWin = winSet.has(i);
          const isFree = i === 12;

          let cellClass = '';
          if (isFree) {
            cellClass = isWin && isVisible
              ? 'bg-gradient-to-br from-[#FF007F]/40 to-[#FFE066]/30 border-2 border-[#FFE066] text-[#FFE066] shadow-[0_0_25px_#FFE066,inset_0_0_15px_#FF007F] scale-110 z-10'
              : 'bg-[#180033]/80 border-2 border-[#FF007F]/50 text-[#FF007F] shadow-[0_0_10px_rgba(255,0,127,0.3)]';
          } else if (isWin && isVisible) {
            cellClass = 'bg-gradient-to-br from-[#00F5D4]/35 to-[#00CFFF]/20 border-2 border-[#00F5D4] text-white shadow-[0_0_25px_#00F5D4,inset_0_0_12px_rgba(0,245,212,0.6)] scale-110 z-10';
          } else if (isWin && !isVisible) {
            cellClass = 'bg-[#0F0024]/70 border border-[#00F5D4]/30 text-slate-500 opacity-60';
          } else {
            cellClass = 'bg-[#0E0022]/80 border border-[#7B2CBF]/30 text-slate-600';
          }

          return (
            <div
              key={i}
              className={`w-[6.5vh] h-[6.5vh] flex items-center justify-center rounded-xl font-black transition-all duration-300 relative overflow-hidden ${cellClass}`}
            >
              {isFree ? (
                <span className="text-2xl drop-shadow-[0_0_12px_#FFE066]">★</span>
              ) : isWin && isVisible ? (
                <div className="w-2.5 h-2.5 rounded-sm bg-[#00F5D4] shadow-[0_0_10px_#00F5D4]" />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── BINGO CARD COMPONENT ─────────────────────────────────────────────────────
function BingoCard({ result }: { result: VerificationResult }) {
  const drawnSet = new Set(result.drawnNumbers);
  const winSet = getWinningIndices(result.grid, drawnSet, result.phase, result.round);

  return (
    <div className="relative bg-[#070014]/95 border-2 border-[#00F5D4] rounded-2xl p-3 sm:p-4 shadow-[0_0_35px_rgba(0,245,212,0.35),inset_0_0_20px_rgba(123,44,191,0.25)] backdrop-blur-xl select-none max-w-[90vw]">
      {/* Corner cyber brackets */}
      <div className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-[#00F5D4]" />
      <div className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-[#00F5D4]" />
      <div className="absolute bottom-2 left-2 w-3 h-3 border-b-2 border-l-2 border-[#00F5D4]" />
      <div className="absolute bottom-2 right-2 w-3 h-3 border-b-2 border-r-2 border-[#00F5D4]" />

      <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
        {[
          { l: 'B', color: '#00F5D4' },
          { l: 'I', color: '#00CFFF' },
          { l: 'N', color: '#FF007F' },
          { l: 'G', color: '#FFE066' },
          { l: 'O', color: '#00F5D4' },
        ].map(item => (
          <div
            key={item.l}
            className="text-[2.5vh] font-arcade font-black text-center pb-0.5"
            style={{
              color: item.color,
              textShadow: `0 0 12px ${item.color}, 0 0 20px ${item.color}88`,
            }}
          >
            {item.l}
          </div>
        ))}
        {Array.from({ length: 25 }).map((_, i) => {
          const isFree = i === 12;
          const num = isFree ? 'FREE' : result.grid[i < 12 ? i : i - 1];
          const isDrawn = isFree || drawnSet.has(num as number);
          const isWin = winSet.has(i);

          let cellClass = '';
          if (isWin) {
            cellClass = 'bg-gradient-to-br from-[#00F5D4]/40 to-[#00CFFF]/25 border-2 border-[#00F5D4] text-white shadow-[0_0_20px_#00F5D4,inset_0_0_10px_rgba(0,245,212,0.6)] scale-105 z-10';
          } else if (isDrawn) {
            cellClass = 'bg-[#150033]/80 border border-[#7B2CBF]/60 text-slate-300 shadow-[0_0_8px_rgba(123,44,191,0.4)]';
          } else {
            cellClass = 'bg-[#0E0022]/70 border border-slate-800 text-slate-600 opacity-60';
          }

          return (
            <div
              key={i}
              className={`w-[5.2vh] h-[5.2vh] max-w-[52px] max-h-[52px] flex items-center justify-center rounded-lg font-black transition-all ${isFree ? 'text-[1.5vh] sm:text-xs text-[#FFE066]' : 'text-[2.0vh] sm:text-base'
                } ${cellClass}`}
            >
              {num}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── STAGE PREVIEW DETECTION (SILENCES ALL AUDIO IF EMBEDDED IN ADMIN IFRAME) ──
const isPreviewMode = typeof window !== 'undefined' && (
  window.self !== window.top ||
  new URLSearchParams(window.location.search).get('preview') === '1' ||
  new URLSearchParams(window.location.search).get('preview') === 'true'
);

// ─── PROCEDURAL SOUND EFFECTS (WEB AUDIO API) ─────────────────────────────────
class SoundEffects {
  private static ctx: AudioContext | null = null;
  static isMuted = isPreviewMode;

  private static getCtx(): AudioContext | null {
    if (SoundEffects.isMuted || isPreviewMode) return null;
    try {
      if (!SoundEffects.ctx) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        SoundEffects.ctx = new AudioCtx();
      }
      if (SoundEffects.ctx.state === 'suspended') {
        SoundEffects.ctx.resume();
      }
      return SoundEffects.ctx;
    } catch {
      return null;
    }
  }

  static playTick(freq = 950) {
    const ctx = SoundEffects.getCtx();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(0.09, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.035);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.035);
    } catch { }
  }

  static playSweep() {
    const ctx = SoundEffects.getCtx();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(550, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(140, ctx.currentTime + 0.32);
      gain.gain.setValueAtTime(0.14, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.32);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.32);
    } catch { }
  }

  static playGlideChime() {
    const ctx = SoundEffects.getCtx();
    if (!ctx) return;
    try {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, ctx.currentTime + i * 0.07);
        gain.gain.setValueAtTime(0.06, ctx.currentTime + i * 0.07);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.07 + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.07);
        osc.stop(ctx.currentTime + i * 0.07 + 0.35);
      });
    } catch { }
  }

  static playThunder() {
    const ctx = SoundEffects.getCtx();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(1400, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(45, ctx.currentTime + 0.55);
      gain.gain.setValueAtTime(0.24, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.55);
    } catch { }
  }

  static playMegaphone() {
    const ctx = SoundEffects.getCtx();
    if (!ctx) return;
    try {
      [440, 554.37, 659.25].forEach((f, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(f, ctx.currentTime + i * 0.05);
        gain.gain.setValueAtTime(0.07, ctx.currentTime + i * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.05);
        osc.stop(ctx.currentTime + 0.5);
      });
    } catch { }
  }

  static playPodium(rank: number) {
    const ctx = SoundEffects.getCtx();
    if (!ctx) return;
    try {
      const base = rank === 1 ? 523.25 : rank === 2 ? 440 : 349.23;
      [1, 1.25, 1.5, 2].forEach((m, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(base * m, ctx.currentTime + i * 0.1);
        gain.gain.setValueAtTime(0.12, ctx.currentTime + i * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.1 + 0.6);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.1);
        osc.stop(ctx.currentTime + i * 0.1 + 0.6);
      });
    } catch { }
  }

  static playSiren() {
    const ctx = SoundEffects.getCtx();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      [880, 660, 880, 660, 880].forEach((f, i) => {
        osc.frequency.setValueAtTime(f, ctx.currentTime + i * 0.14);
      });
      gain.gain.setValueAtTime(0.16, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.7);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.7);
    } catch { }
  }

  static playBuzzer() {
    const ctx = SoundEffects.getCtx();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(80, ctx.currentTime + 0.6);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.6);
    } catch { }
  }

  static playScanner() {
    const ctx = SoundEffects.getCtx();
    if (!ctx) return;
    try {
      [1800, 2200, 2600].forEach((f, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, ctx.currentTime + i * 0.08);
        gain.gain.setValueAtTime(0.08, ctx.currentTime + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.08 + 0.06);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.08);
        osc.stop(ctx.currentTime + i * 0.08 + 0.06);
      });
    } catch { }
  }

  static playSuccess() {
    const ctx = SoundEffects.getCtx();
    if (!ctx) return;
    try {
      [523.25, 659.25, 783.99, 1046.50, 1318.51].forEach((f, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f, ctx.currentTime + i * 0.08);
        gain.gain.setValueAtTime(0.12, ctx.currentTime + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.08 + 0.45);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.08);
        osc.stop(ctx.currentTime + i * 0.08 + 0.45);
      });
    } catch { }
  }
}

// ─── CIRCULAR SPEED DIAL COUNTDOWN GAUGE (MATCHING INSPIRATION IMAGE 4) ───────
function SpeedDialTimer({ seconds, maxSeconds }: { seconds: number; maxSeconds: number }) {
  const size = 110;
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const max = Math.max(1, maxSeconds || 10);
  const fraction = Math.max(0, Math.min(1, seconds / max));
  const strokeDashoffset = circumference * (1 - fraction);

  const isUrgent = seconds <= 3;
  const isWarning = seconds <= 6;
  const strokeColor = isUrgent ? '#FF007F' : isWarning ? '#FF6B35' : '#00F5D4';
  const glowColor = isUrgent ? 'rgba(255,0,127,0.9)' : isWarning ? 'rgba(255,107,53,0.9)' : 'rgba(0,245,212,0.9)';

  return (
    <div className="flex flex-col items-center select-none">
      <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
        {/* Ambient background blur */}
        <div
          className="absolute inset-2 rounded-full blur-md opacity-35 transition-colors duration-300"
          style={{ background: strokeColor }}
        />

        {/* Circular SVG Gauge */}
        <svg width={size} height={size} className="relative z-10 -rotate-90">
          {/* Track background circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="rgba(10, 1, 28, 0.85)"
            stroke="rgba(255, 255, 255, 0.08)"
            strokeWidth={strokeWidth}
          />
          {/* Active progress arc */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            style={{
              transition: 'stroke-dashoffset 900ms linear, stroke 300ms ease',
              filter: `drop-shadow(0 0 8px ${glowColor})`,
            }}
          />
        </svg>

        {/* Center Text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center z-20 text-center pointer-events-none">
          <span
            className={`font-black font-mono tracking-tight leading-none ${isUrgent ? 'text-[#FF007F] animate-pulse' : 'text-white'
              }`}
            style={{
              fontSize: '28px',
              textShadow: `0 0 16px ${glowColor}`,
            }}
          >
            {seconds}s
          </span>
          <span
            className="font-mono font-bold text-[8.5px] uppercase tracking-[0.25em] mt-1 text-[#00F5D4]"
            style={{ textShadow: '0 0 8px rgba(0,245,212,0.6)' }}
          >
            SPEED DIAL
          </span>
        </div>
      </div>

      {/* Label under circle matching inspiration 4th image */}
      <span
        className="font-mono font-black text-[10px] sm:text-[11px] text-[#00F5D4] tracking-[0.22em] uppercase mt-2 drop-shadow-[0_0_8px_rgba(0,245,212,0.8)]"
      >
        RAPID REACTION WINDOW
      </span>
    </div>
  );
}

// ─── SHARED HUD FRAME (FAITHFUL RECREATION OF INSPIRATION IMAGE 2) ─────────────
function HudFrame({ round, portLabel = 'data-port' }: { round: number; portLabel?: string }) {
  const t = ROUND_THEME[round] ?? ROUND_THEME[1];
  return (
    <div
      className="absolute inset-x-5 md:inset-x-8 lg:inset-x-12 inset-y-3 md:inset-y-4 lg:inset-y-5 pointer-events-none z-30 select-none"
    >
      {/* ── 1. MAIN OUTER NEON BORDER (WITH NATIVE TOP NOTCH GAP - NO BLACK BOX) ── */}
      {/* Left Top & Left Side */}
      <div
        className="absolute top-0 bottom-0 left-0 rounded-tl-2xl md:rounded-tl-3xl rounded-bl-2xl md:rounded-bl-3xl pointer-events-none"
        style={{
          right: 'calc(50% + 185px)',
          borderTop: `2.5px solid ${t.primary}`,
          borderLeft: `2.5px solid ${t.primary}`,
          borderBottom: `2.5px solid ${t.primary}`,
          boxShadow: `0 0 20px ${t.glow}, inset 0 0 16px ${t.glow}22`,
        }}
      />
      {/* Right Top & Right Side */}
      <div
        className="absolute top-0 bottom-0 right-0 rounded-tr-2xl md:rounded-tr-3xl rounded-br-2xl md:rounded-br-3xl pointer-events-none"
        style={{
          left: 'calc(50% + 185px)',
          borderTop: `2.5px solid ${t.primary}`,
          borderRight: `2.5px solid ${t.primary}`,
          borderBottom: `2.5px solid ${t.primary}`,
          boxShadow: `0 0 20px ${t.glow}, inset 0 0 16px ${t.glow}22`,
        }}
      />
      {/* Bottom Center Bridge */}
      <div
        className="absolute bottom-0 pointer-events-none"
        style={{
          left: 'calc(50% - 186px)',
          right: 'calc(50% - 186px)',
          borderBottom: `2.5px solid ${t.primary}`,
          boxShadow: `0 0 20px ${t.glow}`,
        }}
      />
      {/* Inner Subtle Accent Line */}
      <div
        className="absolute top-[3px] bottom-[3px] left-[3px] rounded-tl-2xl md:rounded-tl-3xl rounded-bl-2xl md:rounded-bl-3xl pointer-events-none opacity-40"
        style={{
          right: 'calc(50% + 185px)',
          borderTop: `1px solid ${t.primary}`,
          borderLeft: `1px solid ${t.primary}`,
          borderBottom: `1px solid ${t.primary}`,
        }}
      />
      <div
        className="absolute top-[3px] bottom-[3px] right-[3px] rounded-tr-2xl md:rounded-tr-3xl rounded-br-2xl md:rounded-br-3xl pointer-events-none opacity-40"
        style={{
          left: 'calc(50% + 185px)',
          borderTop: `1px solid ${t.primary}`,
          borderRight: `1px solid ${t.primary}`,
          borderBottom: `1px solid ${t.primary}`,
        }}
      />
      <div
        className="absolute bottom-[3px] pointer-events-none opacity-40"
        style={{
          left: 'calc(50% - 186px)',
          right: 'calc(50% - 186px)',
          borderBottom: `1px solid ${t.primary}`,
        }}
      />

      {/* ── 2. VERTICAL AUDIO FREQUENCY WAVEFORM (LEFT BORDER) ── */}
      <div className="absolute left-0 top-[18%] bottom-[24%] w-6 -translate-x-1/2 flex items-center justify-center overflow-visible pointer-events-none">
        <svg className="h-full w-8 overflow-visible" viewBox="0 0 32 300" preserveAspectRatio="none" fill="none">
          <path
            d="M 16 0 C 8 25, 24 50, 16 75 C 6 100, 26 125, 16 150 C 4 175, 28 200, 16 225 C 8 250, 24 275, 16 300"
            stroke={t.primary}
            strokeWidth="2.5"
            style={{ filter: `drop-shadow(0 0 6px ${t.primary})` }}
          />
          <path
            d="M 16 20 C 10 40, 22 60, 16 80 C 8 110, 24 135, 16 160 C 6 185, 26 210, 16 235 C 10 260, 22 280, 16 300"
            stroke={t.primary}
            strokeWidth="1.2"
            opacity="0.45"
          />
        </svg>
      </div>

      {/* ── 3. VERTICAL AUDIO FREQUENCY WAVEFORM (RIGHT BORDER) ── */}
      <div className="absolute right-0 top-[18%] bottom-[24%] w-6 translate-x-1/2 flex items-center justify-center overflow-visible pointer-events-none">
        <svg className="h-full w-8 overflow-visible" viewBox="0 0 32 300" preserveAspectRatio="none" fill="none">
          <path
            d="M 16 0 C 24 25, 8 50, 16 75 C 26 100, 6 125, 16 150 C 28 175, 4 200, 16 225 C 24 250, 8 275, 16 300"
            stroke={t.primary}
            strokeWidth="2.5"
            style={{ filter: `drop-shadow(0 0 6px ${t.primary})` }}
          />
          <path
            d="M 16 20 C 22 40, 10 60, 16 80 C 24 110, 8 135, 16 160 C 26 185, 6 210, 16 235 C 22 260, 10 280, 16 300"
            stroke={t.primary}
            strokeWidth="1.2"
            opacity="0.45"
          />
        </svg>
      </div>

      {/* ── 4. TOP HEADER BAR WITH STEPPED NOTCHES (100% TRANSPARENT - NO CUTOFF BOX) ── */}
      <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center pointer-events-none px-4 bg-transparent">
        <div className="flex items-center gap-3">
          <div className="w-8 sm:w-14 h-1 bg-gradient-to-r from-transparent to-[#00F5D4]" />
          <span
            className="font-arcade text-sm sm:text-base md:text-lg font-black tracking-[0.35em] uppercase text-[#FF007F]"
            style={{ textShadow: '0 0 14px #FF007F, 0 0 28px #FF007F88' }}
          >
            AI-DRIVEN CHALLENGE MATRIX
          </span>
          <div className="w-8 sm:w-14 h-1 bg-gradient-to-l from-transparent to-[#00F5D4]" />
        </div>
        <span
          className="font-mono text-[10px] sm:text-xs font-black tracking-[0.28em] uppercase text-[#00F5D4] mt-0.5"
          style={{ textShadow: `0 0 8px ${t.glow}` }}
        >
          INITIATING DATASET ROUND {round}
        </span>
      </div>

      {/* ── 5. BOTTOM HORIZONTAL SEPARATOR LINE ── */}
      <div
        className="absolute left-6 right-6 h-[2px] pointer-events-none"
        style={{
          bottom: '92px',
          background: `linear-gradient(to right, transparent, ${t.primary}88, ${t.primary}, ${t.primary}88, transparent)`,
          boxShadow: `0 0 14px ${t.glow}`,
        }}
      />

      {/* ── 6. BOTTOM DECK: WIREFRAME CUBE + DATA-PORT TERMINAL + SATELLITE DISH ── */}
      <div
        className="absolute left-0 right-0 pointer-events-none flex items-center justify-between px-8 md:px-14"
        style={{ bottom: '16px' }}
      >
        {/* Wireframe 3D Cube Icon (Authentic Nested Geometry) */}
        <svg width="56" height="56" viewBox="0 0 56 56" fill="none" style={{ filter: `drop-shadow(0 0 6px ${t.primary})` }}>
          {/* Outer Hexagon */}
          <polygon points="28,4 48,15 48,39 28,50 8,39 8,15" stroke={t.primary} strokeWidth="2" fill="none" />
          {/* Center Y */}
          <line x1="28" y1="4" x2="28" y2="28" stroke={t.primary} strokeWidth="1.5" />
          <line x1="8" y1="15" x2="28" y2="28" stroke={t.primary} strokeWidth="1.5" />
          <line x1="48" y1="15" x2="28" y2="28" stroke={t.primary} strokeWidth="1.5" />
          <line x1="28" y1="28" x2="28" y2="50" stroke={t.primary} strokeWidth="1.5" />
          {/* Inner Inverted Triangle / Cube Core */}
          <polygon points="28,14 38,32 18,32" stroke={t.primary} strokeWidth="1" opacity="0.6" fill="none" />
          <circle cx="28" cy="28" r="2" fill={t.primary} />
        </svg>

        {/* Center data-port terminal (Exact match to Image 2) */}
        <div className="flex items-center">
          {/* Left Conduits */}
          <div className="flex flex-col gap-1.5 mr-2">
            <div className="flex items-center gap-1">
              <div className="w-6 h-[2px]" style={{ background: t.primary }} />
              <div className="w-2 h-2 rounded-[1px] border" style={{ borderColor: t.primary }} />
              <div className="w-4 h-[2px]" style={{ background: t.primary }} />
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-[2px]" style={{ background: t.primary, opacity: 0.6 }} />
              <div className="w-2 h-2 rounded-[1px] border" style={{ borderColor: t.primary, opacity: 0.6 }} />
              <div className="w-6 h-[2px]" style={{ background: t.primary, opacity: 0.6 }} />
            </div>
          </div>

          {/* Terminal Box */}
          <div
            className="px-6 py-2.5 rounded-xl font-mono text-sm md:text-base font-black tracking-widest relative overflow-hidden"
            style={{
              border: `2px solid ${t.primary}`,
              color: t.primary,
              boxShadow: `0 0 20px ${t.glow}, inset 0 0 12px ${t.glow}33`,
              background: 'rgba(5, 0, 18, 0.92)',
              minWidth: '150px',
              textAlign: 'center',
            }}
          >
            {/* Top-left LED bars */}
            <div className="flex gap-1.5 mb-1 justify-start">
              <div className="w-4 h-1 rounded-sm bg-[#FF007F] shadow-[0_0_6px_#FF007F]" />
              <div className="w-6 h-1 rounded-sm bg-[#00F5D4] shadow-[0_0_6px_#00F5D4]" />
            </div>
            {/* Terminal Label */}
            <span style={{ textShadow: `0 0 10px ${t.primary}` }}>
              {portLabel}
            </span>
            {/* Bottom-right LED bar */}
            <div className="flex justify-end mt-1">
              <div className="w-5 h-1 rounded-sm bg-[#00F5D4] shadow-[0_0_6px_#00F5D4]" />
            </div>
          </div>

          {/* Right Conduits */}
          <div className="flex flex-col gap-1.5 ml-2">
            <div className="flex items-center gap-1">
              <div className="w-4 h-[2px]" style={{ background: t.primary }} />
              <div className="w-2 h-2 rounded-[1px] border" style={{ borderColor: t.primary }} />
              <div className="w-6 h-[2px]" style={{ background: t.primary }} />
            </div>
            <div className="flex items-center gap-1">
              <div className="w-6 h-[2px]" style={{ background: t.primary, opacity: 0.6 }} />
              <div className="w-2 h-2 rounded-[1px] border" style={{ borderColor: t.primary, opacity: 0.6 }} />
              <div className="w-4 h-[2px]" style={{ background: t.primary, opacity: 0.6 }} />
            </div>
          </div>
        </div>

        {/* Satellite dish icon with wireless transmission signal arcs */}
        <svg width="56" height="56" viewBox="0 0 56 56" fill="none" style={{ filter: `drop-shadow(0 0 6px ${t.primary})` }}>
          {/* Main Dish Arc */}
          <ellipse cx="22" cy="32" rx="16" ry="12" stroke={t.primary} strokeWidth="2" fill="none" />
          {/* Dish Base Tripod */}
          <line x1="22" y1="36" x2="16" y2="48" stroke={t.primary} strokeWidth="2" />
          <line x1="22" y1="36" x2="28" y2="48" stroke={t.primary} strokeWidth="2" />
          <line x1="14" y1="48" x2="30" y2="48" stroke={t.primary} strokeWidth="2" />
          {/* Receiver Arm */}
          <line x1="22" y1="32" x2="38" y2="16" stroke={t.primary} strokeWidth="2.5" />
          <circle cx="38" cy="16" r="3" fill={t.primary} />
          {/* Transmitting Wireless Signal Waves */}
          <path d="M 38 10 A 8 8 0 0 1 46 18" stroke={t.primary} strokeWidth="1.5" strokeLinecap="round" fill="none" />
          <path d="M 40 6 A 14 14 0 0 1 52 20" stroke={t.primary} strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.7" />
        </svg>
      </div>
    </div>
  );
}

// ─── ROUND 1 BG: Orange perspective grid floor + dark navy + cyan HUD ──────────
function Round1Background() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let frame = 0;
    let raf: number;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);
    const draw = () => {
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      // Sky gradient: dark navy
      const sky = ctx.createLinearGradient(0, 0, 0, H * 0.55);
      sky.addColorStop(0, '#06001A');
      sky.addColorStop(1, '#0D0033');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H * 0.55);
      // Horizon glow
      const hGlow = ctx.createRadialGradient(W / 2, H * 0.52, 0, W / 2, H * 0.52, W * 0.5);
      hGlow.addColorStop(0, 'rgba(255,107,53,0.18)'); hGlow.addColorStop(1, 'transparent');
      ctx.fillStyle = hGlow; ctx.fillRect(0, 0, W, H);
      // Floor: deep dark purple
      const floor = ctx.createLinearGradient(0, H * 0.52, 0, H);
      floor.addColorStop(0, '#0A0020'); floor.addColorStop(1, '#050012');
      ctx.fillStyle = floor; ctx.fillRect(0, H * 0.52, W, H);
      // Perspective grid lines
      const vp = { x: W / 2, y: H * 0.52 };
      const gridOffset = (frame * 0.4) % 60;
      // Orange horizontal lines (parallax receding)
      const numH = 18;
      for (let i = 0; i < numH; i++) {
        const t = (i + gridOffset / 60) / numH;
        const perspective = Math.pow(t, 1.8);
        const y = vp.y + (H - vp.y) * perspective;
        if (y < vp.y || y > H + 2) continue;
        const alpha = Math.min(1, t * 2.5) * 0.75;
        ctx.strokeStyle = `rgba(255,100,20,${alpha})`;
        ctx.lineWidth = Math.max(0.3, t * 1.8);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      // Vertical lines radiating from vanishing point
      const numV = 20;
      for (let i = 0; i <= numV; i++) {
        const angle = -Math.PI / 2 + (i / numV) * Math.PI * 0.95 - Math.PI * 0.475;
        const dist = Math.max(W, H) * 1.5;
        const ex = vp.x + Math.cos(angle) * dist;
        const ey = vp.y + Math.sin(angle) * dist;
        const alpha = 0.4 - Math.abs(i / numV - 0.5) * 0.5;
        ctx.strokeStyle = `rgba(255,100,20,${alpha})`;
        ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(vp.x, vp.y); ctx.lineTo(ex, ey); ctx.stroke();
      }
      // Cyan grid overlay (very subtle)
      for (let i = 1; i < 5; i++) {
        const y = vp.y + (H - vp.y) * (i / 5);
        ctx.strokeStyle = `rgba(0,245,212,0.08)`; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      frame++;
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { window.removeEventListener('resize', resize); cancelAnimationFrame(raf); };
  }, []);
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      <HudFrame round={1} />
      {/* Top vignette */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#06001A]/60 via-transparent to-[#050012]/40 pointer-events-none z-20" />
    </div>
  );
}

// ─── ROUND 2 BG: Cosmic nebula starfield + wireframe terrain + floating polyhedra
function Round2Background() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let frame = 0; let raf: number;
    const stars: { x: number, y: number, r: number, a: number }[] = [];
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; stars.length = 0; for (let i = 0; i < 180; i++) stars.push({ x: Math.random(), y: Math.random() * 0.6, r: Math.random() * 1.5 + 0.2, a: Math.random() }); };
    resize(); window.addEventListener('resize', resize);
    // Wireframe terrain mesh points
    const meshCols = 14, meshRows = 8;
    const getMeshY = (c: number, r: number, t: number) => {
      const base = r / meshRows;
      return base + Math.sin(c * 0.7 + t * 0.015) * 0.04 * (1 - base) + Math.sin(r * 0.5 + t * 0.01) * 0.03;
    };
    const draw = () => {
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      // Deep space gradient
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#080020'); bg.addColorStop(0.5, '#120030'); bg.addColorStop(1, '#050012');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      // Nebula cloud (pinkish)
      const neb = ctx.createRadialGradient(W * 0.35, H * 0.35, 0, W * 0.35, H * 0.35, W * 0.4);
      neb.addColorStop(0, 'rgba(180,50,140,0.18)'); neb.addColorStop(0.5, 'rgba(120,30,100,0.10)'); neb.addColorStop(1, 'transparent');
      ctx.fillStyle = neb; ctx.fillRect(0, 0, W, H);
      const neb2 = ctx.createRadialGradient(W * 0.6, H * 0.25, 0, W * 0.6, H * 0.25, W * 0.3);
      neb2.addColorStop(0, 'rgba(60,20,160,0.15)'); neb2.addColorStop(1, 'transparent');
      ctx.fillStyle = neb2; ctx.fillRect(0, 0, W, H);
      // Stars
      for (const s of stars) {
        const twinkle = 0.5 + 0.5 * Math.sin(frame * 0.04 + s.a * 10);
        ctx.fillStyle = `rgba(255,255,255,${s.a * 0.8 * twinkle})`;
        ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2); ctx.fill();
      }
      // Wireframe terrain mesh
      const horizonY = H * 0.55;
      ctx.strokeStyle = 'rgba(255,40,200,0.28)'; ctx.lineWidth = 0.8;
      for (let r = 0; r < meshRows; r++) {
        for (let c = 0; c < meshCols; c++) {
          const x1 = (c / meshCols) * W, x2 = ((c + 1) / meshCols) * W;
          const y1 = horizonY + (H - horizonY) * getMeshY(c, r, frame);
          const y2 = horizonY + (H - horizonY) * getMeshY(c, r + 1, frame);
          const y3 = horizonY + (H - horizonY) * getMeshY(c + 1, r, frame);
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1, y2); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y3); ctx.stroke();
        }
      }
      frame++; raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { window.removeEventListener('resize', resize); cancelAnimationFrame(raf); };
  }, []);
  // Floating polyhedra as SVG overlays
  const polyhedra = [
    { top: '8%', right: '5%', size: 110, rot: 15 },
    { top: '15%', right: '20%', size: 70, rot: -20 },
    { top: '30%', right: '3%', size: 85, rot: 8 },
  ];
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      {polyhedra.map((p, i) => (
        <svg key={i} className="absolute" style={{ top: p.top, right: p.right ? p.right : undefined, width: p.size, height: p.size, animation: `glyph-float ${7 + i}s ease-in-out infinite ${i * 1.5}s` }} viewBox="0 0 100 100" fill="none">
          <polygon points="50,8 85,30 85,70 50,92 15,70 15,30" stroke="#00CFFF" strokeWidth="1.2" opacity="0.55" style={{ filter: 'drop-shadow(0 0 4px #00CFFF)' }} />
          <line x1="50" y1="8" x2="50" y2="92" stroke="#FF38C8" strokeWidth="0.8" opacity="0.35" />
          <line x1="15" y1="30" x2="85" y2="70" stroke="#00CFFF" strokeWidth="0.8" opacity="0.35" />
          <line x1="85" y1="30" x2="15" y2="70" stroke="#00CFFF" strokeWidth="0.8" opacity="0.35" />
        </svg>
      ))}
      <HudFrame round={2} />
      <div className="absolute inset-0 bg-gradient-to-b from-[#080020]/50 via-transparent to-[#050012]/50 pointer-events-none z-20" />
    </div>
  );
}

// ─── ROUND 3 BG: Neural web filaments + sacred geometry + math equations ────────
function Round3Background() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let frame = 0; let raf: number;
    type Node3 = { x: number, y: number, vx: number, vy: number, con: number[] };
    const nodes: Node3[] = [];
    const NUM_NODES = 38;
    const resize = () => {
      canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight;
      nodes.length = 0;
      for (let i = 0; i < NUM_NODES; i++) nodes.push({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3, con: [] });
    };
    resize(); window.addEventListener('resize', resize);
    const draw = () => {
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      // Deep space bg
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#06001A'); bg.addColorStop(0.5, '#0A0030'); bg.addColorStop(1, '#04000E');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      // Radial glow in center
      const glow = ctx.createRadialGradient(W * 0.6, H * 0.45, 0, W * 0.6, H * 0.45, W * 0.5);
      glow.addColorStop(0, 'rgba(150,60,255,0.22)'); glow.addColorStop(0.4, 'rgba(0,200,220,0.10)'); glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
      const glow2 = ctx.createRadialGradient(W * 0.25, H * 0.5, 0, W * 0.25, H * 0.5, W * 0.35);
      glow2.addColorStop(0, 'rgba(200,50,220,0.18)'); glow2.addColorStop(1, 'transparent');
      ctx.fillStyle = glow2; ctx.fillRect(0, 0, W, H);
      // Update + draw neural filaments
      for (const n of nodes) { n.x += n.vx; n.y += n.vy; if (n.x < 0 || n.x > W) n.vx *= -1; if (n.y < 0 || n.y > H) n.vy *= -1; }
      for (let a = 0; a < nodes.length; a++) {
        for (let b = a + 1; b < nodes.length; b++) {
          const dx = nodes[a].x - nodes[b].x, dy = nodes[a].y - nodes[b].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 180) {
            const alpha = (1 - dist / 180) * 0.45;
            // Alternate purple/cyan
            const col = a % 2 === 0 ? `rgba(150,80,255,${alpha})` : `rgba(0,220,255,${alpha})`;
            ctx.strokeStyle = col; ctx.lineWidth = 0.7 + alpha;
            ctx.beginPath(); ctx.moveTo(nodes[a].x, nodes[a].y); ctx.lineTo(nodes[b].x, nodes[b].y); ctx.stroke();
          }
        }
      }
      for (const n of nodes) {
        ctx.fillStyle = 'rgba(200,120,255,0.7)'; ctx.beginPath(); ctx.arc(n.x, n.y, 1.5, 0, Math.PI * 2); ctx.fill();
      }
      frame++; raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { window.removeEventListener('resize', resize); cancelAnimationFrame(raf); };
  }, []);
  const mathEqs = ['∫f(x)dx', '∑xᵢ', '∇²ψ=0', 'θ=α+ΔΨ', 'v=√(2gh)', '∂u/∂t'];
  const geoShapes = [{ top: '12%', left: '4%' }, { top: '40%', left: '2%' }, { top: '65%', left: '6%' }, { top: '15%', right: '3%' }, { top: '45%', right: '2%' }];
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      {/* Math equation watermarks on left */}
      {mathEqs.map((eq, i) => (
        <div key={i} className="absolute font-mono font-bold select-none" style={{ left: '2%', top: `${15 + i * 12}%`, color: 'rgba(77,255,219,0.18)', fontSize: '15px', letterSpacing: '0.1em' }}>{eq}</div>
      ))}
      {/* Sacred geometry shapes */}
      {geoShapes.map((p, i) => (
        <svg key={i} className="absolute" style={{ top: p.top, left: p.left, right: (p as any).right, width: 70, height: 70, animation: `glyph-float ${8 + i}s ease-in-out infinite ${i * 1.2}s`, opacity: 0.3 }} viewBox="0 0 100 100" fill="none">
          <polygon points="50,5 95,27.5 95,72.5 50,95 5,72.5 5,27.5" stroke="#4DFFDB" strokeWidth="1.5" />
          <polygon points="50,20 80,35 80,65 50,80 20,65 20,35" stroke="#9B5CF6" strokeWidth="1" />
          <line x1="50" y1="5" x2="50" y2="95" stroke="#4DFFDB" strokeWidth="0.6" />
          <line x1="5" y1="50" x2="95" y2="50" stroke="#4DFFDB" strokeWidth="0.6" />
        </svg>
      ))}
      <HudFrame round={3} portLabel="Singularity Nexus-Port" />
      <div className="absolute inset-0 bg-gradient-to-b from-[#06001A]/55 via-transparent to-[#04000E]/55 pointer-events-none z-20" />
    </div>
  );
}

// ─── ROUND 4 BG: Swirling nebula clouds + constellation polyhedra network ────────
function Round4Background() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let frame = 0; let raf: number;
    type Poly4 = { x: number, y: number, vx: number, vy: number, r: number, rot: number, vrot: number, sides: number };
    const polys: Poly4[] = [];
    for (let i = 0; i < 7; i++) polys.push({ x: Math.random(), y: Math.random() * 0.8, vx: (Math.random() - 0.5) * 0.15, vy: (Math.random() - 0.5) * 0.1, r: 30 + Math.random() * 55, rot: Math.random() * Math.PI * 2, vrot: (Math.random() - 0.5) * 0.004, sides: i % 2 === 0 ? 4 : 5 });
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize(); window.addEventListener('resize', resize);
    const draw = () => {
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      // Dark nebula gradient
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#0A0025'); bg.addColorStop(0.4, '#140035'); bg.addColorStop(1, '#060015');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      // Swirling nebula clouds
      [[0.4, 0.4, 0.38, 'rgba(120,40,200,0.18)'], [0.7, 0.3, 0.28, 'rgba(200,80,50,0.12)'], [0.2, 0.6, 0.3, 'rgba(80,30,180,0.14)'], [0.65, 0.65, 0.25, 'rgba(180,60,150,0.12)']].forEach((arr) => {
        const [cx, cy, sr, col] = [arr[0] as number, arr[1] as number, arr[2] as number, arr[3] as string];
        const c = ctx.createRadialGradient(cx * W, cy * H, 0, cx * W, cy * H, sr * W);
        c.addColorStop(0, col); c.addColorStop(1, 'transparent');
        ctx.fillStyle = c; ctx.fillRect(0, 0, W, H);
      });
      // Animated constellation polyhedra
      for (const p of polys) {
        p.x += p.vx / W; p.y += p.vy / H; p.rot += p.vrot;
        if (p.x < -0.1 || p.x > 1.1) p.vx *= -1; if (p.y < -0.1 || p.y > 1.1) p.vy *= -1;
        const px = p.x * W, py = p.y * H;
        // Draw poly
        ctx.strokeStyle = 'rgba(56,190,255,0.55)'; ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let s = 0; s <= p.sides; s++) {
          const a = p.rot + (s / p.sides) * Math.PI * 2;
          const x2 = px + Math.cos(a) * p.r, y2 = py + Math.sin(a) * p.r;
          s === 0 ? ctx.moveTo(x2, y2) : ctx.lineTo(x2, y2);
        }
        ctx.closePath(); ctx.stroke();
        // Inner cross-lines
        ctx.strokeStyle = 'rgba(255,45,155,0.3)'; ctx.lineWidth = 0.6;
        for (let s = 0; s < p.sides; s += 2) {
          const a1 = p.rot + (s / p.sides) * Math.PI * 2;
          const a2 = p.rot + ((s + 2) / p.sides) * Math.PI * 2;
          ctx.beginPath(); ctx.moveTo(px + Math.cos(a1) * p.r, py + Math.sin(a1) * p.r);
          ctx.lineTo(px + Math.cos(a2) * p.r, py + Math.sin(a2) * p.r); ctx.stroke();
        }
        // Node dots
        ctx.fillStyle = 'rgba(255,45,155,0.8)';
        for (let s = 0; s < p.sides; s++) {
          const a = p.rot + (s / p.sides) * Math.PI * 2;
          ctx.beginPath(); ctx.arc(px + Math.cos(a) * p.r, py + Math.sin(a) * p.r, 2.5, 0, Math.PI * 2); ctx.fill();
        }
      }
      // Connection lines between polys
      ctx.strokeStyle = 'rgba(56,190,255,0.12)'; ctx.lineWidth = 0.5;
      for (let a = 0; a < polys.length; a++) for (let b = a + 1; b < polys.length; b++) {
        const dx = (polys[a].x - polys[b].x) * W, dy = (polys[a].y - polys[b].y) * H;
        if (dx * dx + dy * dy < (250 * 250)) { ctx.beginPath(); ctx.moveTo(polys[a].x * W, polys[a].y * H); ctx.lineTo(polys[b].x * W, polys[b].y * H); ctx.stroke(); }
      }
      frame++; raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { window.removeEventListener('resize', resize); cancelAnimationFrame(raf); };
  }, []);
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      <HudFrame round={4} />
      <div className="absolute inset-0 bg-gradient-to-b from-[#0A0025]/55 via-transparent to-[#060015]/55 pointer-events-none z-20" />
    </div>
  );
}

// ─── ROUND 5 BG: THE SINGULARITY — everything amplified + crystal monolith ──────
function Round5Background() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let frame = 0; let raf: number;
    type Node5 = { x: number, y: number, vx: number, vy: number };
    const nodes: Node5[] = [];
    const NUM = 50;
    const resize = () => {
      canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight;
      nodes.length = 0;
      for (let i = 0; i < NUM; i++) nodes.push({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4 });
    };
    resize(); window.addEventListener('resize', resize);
    const binaryChars = '01';
    let binStr = '';
    for (let i = 0; i < 200; i++) binStr += binaryChars[Math.floor(Math.random() * 2)] + (i % 8 === 7 ? '\n' : '');
    const draw = () => {
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      // Very dark base
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#08001F'); bg.addColorStop(0.5, '#0E0030'); bg.addColorStop(1, '#040010');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      // Multiple intense glows
      [[0.5, 0.4, 0.4, 'rgba(0,255,200,0.12)'], [0.3, 0.5, 0.3, 'rgba(200,0,255,0.15)'], [0.7, 0.5, 0.3, 'rgba(0,100,255,0.12)'], [0.5, 0.5, 0.2, 'rgba(255,0,200,0.1)']].forEach((arr) => {
        const [cx, cy, sr, col] = [arr[0] as number, arr[1] as number, arr[2] as number, arr[3] as string];
        const c = ctx.createRadialGradient(cx * W, cy * H, 0, cx * W, cy * H, sr * W);
        c.addColorStop(0, col); c.addColorStop(1, 'transparent');
        ctx.fillStyle = c; ctx.fillRect(0, 0, W, H);
      });
      // Swirling paint strokes (cosmic energy)
      const t = frame * 0.008;
      for (let s = 0; s < 5; s++) {
        ctx.strokeStyle = `rgba(${s % 2 ? 180 : 0},${s % 2 ? 0 : 200},${200 + s * 10},0.06)`; ctx.lineWidth = 30;
        ctx.beginPath();
        const cx = W * 0.5 + Math.cos(t + s) * W * 0.2, cy = H * 0.5 + Math.sin(t * 0.7 + s) * H * 0.2;
        ctx.arc(cx, cy, W * 0.15 + s * W * 0.04, 0, Math.PI * (1 + s * 0.3)); ctx.stroke();
      }
      // Dense neural mesh
      for (const n of nodes) { n.x += n.vx; n.y += n.vy; if (n.x < 0 || n.x > W) n.vx *= -1; if (n.y < 0 || n.y > H) n.vy *= -1; }
      for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) {
        const dx = nodes[a].x - nodes[b].x, dy = nodes[a].y - nodes[b].y, dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 160) {
          const alpha = (1 - dist / 160) * 0.4;
          ctx.strokeStyle = a % 3 === 0 ? `rgba(0,255,208,${alpha})` : (a % 3 === 1 ? `rgba(255,0,200,${alpha})` : `rgba(60,150,255,${alpha})`);
          ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(nodes[a].x, nodes[a].y); ctx.lineTo(nodes[b].x, nodes[b].y); ctx.stroke();
        }
      }
      for (const n of nodes) {
        ctx.fillStyle = 'rgba(0,255,208,0.6)'; ctx.beginPath(); ctx.arc(n.x, n.y, 1.2, 0, Math.PI * 2); ctx.fill();
      }
      // Central crystal monolith shape
      const mx = W / 2, my = H / 2;
      const pulse5 = 0.3 + 0.2 * Math.sin(frame * 0.05);
      const cg5 = ctx.createRadialGradient(mx, my - 20, 0, mx, my - 20, 110);
      cg5.addColorStop(0, `rgba(0,255,208,${pulse5 * 0.25})`); cg5.addColorStop(1, 'transparent');
      ctx.fillStyle = cg5; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = `rgba(0,255,208,${0.45 + pulse5 * 0.3})`; ctx.lineWidth = 1.8;
      ctx.shadowBlur = 10; ctx.shadowColor = '#00FFD0';
      const cPts5: [number, number][] = [[mx - 25, my + 75], [mx - 15, my - 45], [mx, my - 90], [mx + 15, my - 45], [mx + 25, my + 75]];
      ctx.beginPath(); cPts5.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)); ctx.closePath(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = `rgba(180,255,240,0.25)`; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(mx, my - 90); ctx.lineTo(mx, my + 75); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mx - 25, my + 75); ctx.lineTo(mx + 15, my - 45); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mx + 25, my + 75); ctx.lineTo(mx - 15, my - 45); ctx.stroke();
      frame++; raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { window.removeEventListener('resize', resize); cancelAnimationFrame(raf); };
  }, []);
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      <HudFrame round={5} portLabel="data-port" />
      <div className="absolute inset-0 pointer-events-none z-25"
        style={{ boxShadow: 'inset 0 0 50px rgba(0,255,208,0.10), inset 0 0 10px rgba(255,0,200,0.08)' }} />
      <div className="absolute left-1/2 -translate-x-1/2 z-30 font-mono text-xs tracking-[0.25em] uppercase pointer-events-none"
        style={{ bottom: 6, color: 'rgba(0,255,208,0.60)', textShadow: '0 0 10px rgba(0,255,208,0.5)' }}>
        CORE INTEGRITY: 100% | UPLINK: PRIME
      </div>
      <div className="absolute inset-0 bg-gradient-to-b from-[#060018]/65 via-transparent to-[#050012]/65 pointer-events-none z-20" />
    </div>
  );
}

function SynthwaveBackground({ round }: { round?: number } = {}) {
  if (round === 1) return <Round1Background />;
  if (round === 2) return <Round2Background />;
  if (round === 3) return <Round3Background />;
  if (round === 4) return <Round4Background />;
  if (round === 5) return <Round5Background />;
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
      <div className="absolute inset-0 bg-[#10002B]" />
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[120vw] h-[60vh] bg-gradient-to-t from-[#FF007F]/25 via-[#7B2CBF]/20 to-transparent blur-3xl pointer-events-none" />
      <div className="absolute top-[16%] left-1/2 -translate-x-1/2 w-80 h-80 md:w-96 md:h-96 rounded-full bg-gradient-to-t from-[#FF007F] via-[#FF6B35] to-[#FFE066] shadow-[0_0_120px_rgba(255,107,53,0.85)]" />
      <div className="absolute top-[52%] left-0 right-0 h-[3px] bg-gradient-to-r from-transparent via-[#FF007F] to-transparent shadow-[0_0_20px_#FF007F]" />
      <div className="absolute bottom-0 left-0 right-0 h-[48%] synthwave-grid-floor overflow-hidden pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-b from-[#10002B]/85 via-transparent to-[#10002B]/60 pointer-events-none" />
    </div>
  );
}

// ─── 1. 3D CYBERPUNK PRIZE ROULETTE (STEAL THE NUMBER) ────────────────────────
// ─── 1. 3D CYBERPUNK PRIZE ROULETTE (STEAL THE NUMBER) ────────────────────────
const BASE_ROULETTE_SLICES = [14, 52, 89, 31, 68, 9, 38, 59, 2, 75, 41, 23, 87, 16, 94, 60];

function RouletteAnimation({
  targetNumber,
  playerName,
  isSelecting,
  round,
}: {
  targetNumber?: string;
  playerName?: string;
  isSelecting: boolean;
  bg?: string;
  round?: number;
}) {
  const [rotation, setRotation] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [displayedSlices, setDisplayedSlices] = useState<number[]>(BASE_ROULETTE_SLICES);
  const animRef = useRef<number | null>(null);

  // Dynamic slice number shuffling while spinning (NOT pre-determined!)
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    if (!isLocked) {
      intervalId = setInterval(() => {
        setDisplayedSlices(prev =>
          prev.map((_, idx) => (idx === 0 && isLocked && targetNumber ? Number(targetNumber) : Math.floor(Math.random() * 90) + 1))
        );
      }, 90);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isLocked, targetNumber]);

  useEffect(() => {
    if (isSelecting || !targetNumber) {
      let angle = 0;
      const spin = () => {
        angle = (angle + 14) % 360;
        setRotation(angle);
        if (Math.random() > 0.6) SoundEffects.playTick(900 + Math.random() * 200);
        animRef.current = requestAnimationFrame(spin);
      };
      animRef.current = requestAnimationFrame(spin);
      return () => {
        if (animRef.current) cancelAnimationFrame(animRef.current);
      };
    } else {
      const targetDeg = 1440 + 720;
      setRotation(targetDeg);

      const tickDelays = [80, 160, 260, 390, 550, 750, 1000, 1350, 1800, 2300, 2900];
      const timers = tickDelays.map(delay =>
        setTimeout(() => SoundEffects.playTick(1100), delay)
      );

      const lockTimer = setTimeout(() => {
        setIsLocked(true);
        confetti({
          particleCount: 160,
          spread: 90,
          origin: { y: 0.5 },
          colors: ['#FF6B35', '#FF007F', '#00F5D4', '#ffffff']
        });
      }, 3400);

      return () => {
        timers.forEach(clearTimeout);
        clearTimeout(lockTimer);
      };
    }
  }, [isSelecting, targetNumber]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-between relative overflow-hidden pt-20 pb-24 px-6 select-none">
      <SynthwaveBackground round={round} />

      {/* Top Section Header */}
      <div className="relative z-10 flex flex-col items-center text-center w-full max-w-4xl">
        <div className="flex items-center gap-3 px-6 py-2 bg-[#10002B]/85 border-2 border-[#FF6B35] rounded-full shadow-[0_0_25px_rgba(255,107,53,0.6)]">
          <Sparkles className="w-5 h-5 text-[#FF6B35] animate-pulse" />
          <span className="text-[#FF6B35] font-black uppercase tracking-[0.3em] text-xs sm:text-sm">
            {isSelecting ? 'Tactical Power: Steal The Number' : 'Roulette Locked On Target!'}
          </span>
        </div>
      </div>

      {/* Center 3D Tilted Arcade Prize Roulette Stage */}
      <div className="relative z-10 w-[340px] h-[340px] sm:w-[380px] sm:h-[380px] md:w-[420px] md:h-[420px] flex items-center justify-center my-auto"
        style={{ perspective: '1200px' }}>
        {/* Top Indicator Pointer */}
        <div className="absolute -top-5 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center drop-shadow-[0_0_20px_rgba(255,107,53,1)]">
          <div className="w-0 h-0 border-l-[16px] border-l-transparent border-r-[16px] border-r-transparent border-t-[28px] border-t-[#FF6B35]" />
        </div>

        {/* Outer Chrome Bezel with LED Chase Studs */}
        <div className="absolute inset-0 rounded-full border-6 border-[#FF6B35] shadow-[0_0_80px_rgba(255,107,53,0.6)] pointer-events-none z-20 flex items-center justify-center">
          {Array.from({ length: 16 }).map((_, i) => (
            <div key={i} className="absolute w-3 h-3 bg-[#FFE066] rounded-full shadow-[0_0_10px_rgba(255,224,102,1)]"
              style={{ transform: `rotate(${i * 22.5}deg) translateY(-195px)` }} />
          ))}
        </div>

        {/* Spinning 3D SVG Wheel */}
        <div
          className="w-full h-full rounded-full overflow-hidden relative shadow-[0_0_70px_rgba(0,0,0,0.9)]"
          style={{
            transform: `rotate(${rotation}deg)`,
            transition: !isSelecting && targetNumber ? 'transform 3.4s cubic-bezier(0.12, 0.85, 0.2, 1)' : 'none'
          }}
        >
          <svg width="100%" height="100%" viewBox="-200 -200 400 400">
            {displayedSlices.map((num, i) => {
              const angleStep = 360 / 16;
              const startAngle = (i * angleStep - 90 - angleStep / 2) * (Math.PI / 180);
              const endAngle = ((i + 1) * angleStep - 90 - angleStep / 2) * (Math.PI / 180);
              const r = 195;
              const x1 = r * Math.cos(startAngle);
              const y1 = r * Math.sin(startAngle);
              const x2 = r * Math.cos(endAngle);
              const y2 = r * Math.sin(endAngle);
              const colors = ['#7B2CBF', '#FF007F', '#10002B', '#FF6B35'];
              const sliceColor = colors[i % colors.length];
              const displayNum = isLocked && i === 0 && targetNumber ? targetNumber : num;

              return (
                <g key={i}>
                  {/* Radial Pie Wedge */}
                  <path
                    d={`M 0 0 L ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2} Z`}
                    fill={sliceColor}
                    stroke="#FFE066"
                    strokeWidth="1.5"
                  />
                  {/* Upright Outward Radial Number Text */}
                  <g transform={`rotate(${i * angleStep}) translate(0, -145)`}>
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#ffffff"
                      fontSize="18"
                      fontWeight="900"
                      className="font-mono drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]"
                    >
                      {displayNum}
                    </text>
                  </g>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Center Hub */}
        <div className="absolute w-28 h-28 sm:w-32 sm:h-32 rounded-full bg-gradient-to-tr from-[#10002B] via-[#3A0CA3] to-[#7209B7] border-4 border-[#00F5D4] shadow-[0_0_35px_rgba(0,245,212,0.8)] z-20 flex flex-col items-center justify-center">
          <span className="text-3xl drop-shadow-md">🎯</span>
          <span className="text-[10px] text-[#00F5D4] font-black uppercase tracking-widest mt-1">
            {isSelecting ? 'SPINNING' : 'LOCKED'}
          </span>
        </div>
      </div>

      {/* Bottom Announcement Banner - Styled Glassmorphism Box Placed Safely Above Data-Port */}
      <div className="relative z-10 w-full max-w-3xl text-center">
        {isSelecting || !targetNumber ? (
          <div className="px-6 py-3 bg-[#10002B]/90 border border-[#00F5D4]/40 rounded-2xl shadow-[0_0_20px_rgba(0,245,212,0.3)] animate-pulse">
            <h2 className="text-2xl sm:text-3xl font-black text-white tracking-widest uppercase mb-1">
              Roulette In Motion...
            </h2>
            <p className="text-[#00F5D4] text-sm sm:text-base font-bold tracking-widest uppercase">
              {playerName ? `${playerName} is choosing a number to steal` : 'Awaiting selection...'}
            </p>
          </div>
        ) : (
          <div className="px-8 py-4 bg-[#10002B]/95 border-2 border-[#FFE066] rounded-2xl shadow-[0_0_35px_rgba(255,224,102,0.6)] animate-in zoom-in duration-500">
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-[#FFE066] via-white to-[#FF6B35] tracking-widest uppercase mb-1 drop-shadow-md">
              NUMBER {targetNumber} STOLEN!
            </h1>
            <span className="text-base sm:text-xl font-black text-[#00F5D4] tracking-[0.2em] uppercase">
              CLAIMED BY {playerName}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 2. GRAND FULL-SCREEN SWEEPING BROOM (MEMORY WIPE) ────────────────────────
function BroomSweepAnimation({
  erasedNumber,
  playerName,
  round,
}: {
  erasedNumber?: string;
  playerName?: string;
  bg?: string;
  round?: number;
}) {
  const [sweepPhase, setSweepPhase] = useState<'entering' | 'sweeping' | 'wiped'>('entering');

  useEffect(() => {
    const t1 = setTimeout(() => {
      setSweepPhase('sweeping');
      SoundEffects.playSweep();
    }, 800);

    const t2 = setTimeout(() => {
      SoundEffects.playSweep();
    }, 1800);

    const t3 = setTimeout(() => {
      setSweepPhase('wiped');
      SoundEffects.playSweep();
      confetti({
        particleCount: 140,
        spread: 90,
        colors: ['#FF007F', '#ffffff', '#FF6B35']
      });
    }, 2800);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-between relative overflow-hidden pt-16 pb-20 px-6 select-none">
      <SynthwaveBackground round={round} />

      {/* Red Alert Ambient Glow */}
      <div className="absolute inset-0 bg-[#FF007F]/15 pointer-events-none" />

      {/* Top Banner */}
      <div className="relative z-10 flex flex-col items-center text-center w-full max-w-4xl">
        <div className="flex items-center gap-3 px-7 py-2 bg-[#10002B]/85 border-2 border-[#FF007F] rounded-full shadow-[0_0_25px_rgba(255,0,127,0.6)]">
          <ShieldAlert className="w-5 h-5 text-[#FF007F] animate-pulse" />
          <span className="text-[#FF007F] font-black uppercase tracking-[0.35em] text-xs sm:text-sm">
            Tactical Power Activated · Memory Wipe
          </span>
        </div>
      </div>

      {/* GRAND FULL-SCREEN STAGE FOR BROOM AND NUMBER */}
      <div className="relative w-full h-[45vh] flex items-center justify-center my-auto">
        {/* Giant Erased Number */}
        <div
          className={`transition-all duration-1000 flex flex-col items-center select-none ${sweepPhase === 'wiped'
            ? '-translate-x-[150vw] opacity-0 rotate-[-60deg] scale-50'
            : sweepPhase === 'sweeping'
              ? 'animate-shake text-[#FF007F]'
              : 'text-white'
            }`}
        >
          <span className="text-[12rem] sm:text-[15rem] md:text-[18rem] font-black leading-none tracking-tighter drop-shadow-[0_0_80px_rgba(255,0,127,0.9)]">
            {erasedNumber ?? '??'}
          </span>
        </div>

        {/* Massive 3D Sweeping Broom */}
        {sweepPhase !== 'wiped' && (
          <div
            className="absolute z-30 pointer-events-none"
            style={{
              top: '5%',
              right: sweepPhase === 'sweeping' ? '38%' : '10%',
              animation: sweepPhase === 'sweeping' ? 'broom-sweep 0.75s ease-in-out infinite' : 'none',
              transition: 'all 0.7s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
          >
            {/* SVG 3D Detailed Sweeping Broom */}
            <svg width="280" height="360" viewBox="0 0 160 220" className="drop-shadow-[0_0_35px_rgba(255,107,53,0.8)]">
              {/* Wooden Grain Handle */}
              <line x1="140" y1="8" x2="55" y2="150" stroke="#78350f" strokeWidth="12" strokeLinecap="round" />
              <line x1="138" y1="12" x2="57" y2="148" stroke="#b45309" strokeWidth="4" strokeLinecap="round" />
              {/* Metallic Brass Ferrule Wire */}
              <rect x="42" y="140" width="30" height="14" rx="3" fill="#FFE066" stroke="#b45309" strokeWidth="2.5" transform="rotate(-35 56 147)" />
              {/* Dense Straw Bristles with 3D Depth */}
              <path d="M 32 160 L 5 210 C 18 220, 75 210, 68 175 Z" fill="#f59e0b" stroke="#d97706" strokeWidth="3" />
              <path d="M 18 175 L 22 212 M 28 170 L 38 212 M 40 168 L 52 208 M 50 166 L 62 202" stroke="#92400e" strokeWidth="2.5" strokeLinecap="round" />
            </svg>

            {/* Dust Vortex Swirls */}
            {sweepPhase === 'sweeping' && (
              <div className="absolute bottom-4 left-0 text-5xl animate-bounce drop-shadow-[0_0_15px_#FF6B35]">
                💨
              </div>
            )}
          </div>
        )}

        {/* Slammed Rubber Stamp */}
        {sweepPhase === 'wiped' && (
          <div className="absolute z-40 border-8 border-[#FF007F] rounded-3xl px-12 sm:px-16 py-6 sm:py-8 bg-[#10002B]/95 shadow-[0_0_120px_rgba(255,0,127,1)] rotate-[-8deg] animate-in zoom-in duration-300">
            <h1 className="text-7xl sm:text-8xl md:text-9xl font-black text-[#FF007F] tracking-widest uppercase mb-2 drop-shadow-2xl">
              ERASED!
            </h1>
            <p className="text-lg sm:text-2xl text-white font-black uppercase tracking-[0.4em]">
              Permanently Removed From Arena Play
            </p>
          </div>
        )}
      </div>

      {/* Announcement Footer Placed Safely Above Data-Port */}
      <div className="relative z-10 w-full max-w-3xl text-center">
        <div className="px-6 py-3 bg-[#10002B]/90 border border-[#FF007F]/60 rounded-2xl shadow-[0_0_25px_rgba(255,0,127,0.4)]">
          <h2 className="text-2xl sm:text-3xl font-black text-white tracking-widest uppercase mb-1 drop-shadow-lg">
            NUMBER {erasedNumber} WIPED OUT!
          </h2>
          <p className="text-xs sm:text-sm text-[#FF007F] font-bold tracking-[0.2em] uppercase">
            Executed by {playerName ?? 'Tactical Unit'} · All players must unmark this cell
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── 3. 3D GOLDEN VIP TICKET FLY-THROUGH (EXTRA TICKET) ────────────────────────
function TicketGlideAnimation({
  playerName,
  round,
}: {
  playerName?: string;
  bg?: string;
  round?: number;
}) {
  const [ticketState, setTicketState] = useState<'entering' | 'floating' | 'exiting'>('entering');

  useEffect(() => {
    SoundEffects.playGlideChime();
    const t1 = setTimeout(() => setTicketState('floating'), 1200);
    const t2 = setTimeout(() => {
      setTicketState('exiting');
      confetti({
        particleCount: 90,
        spread: 70,
        origin: { x: 0.9, y: 0.5 },
        colors: ['#FFE066', '#FF6B35', '#ffffff']
      });
    }, 3800);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-between relative overflow-hidden pt-20 pb-24 px-6 select-none">
      <SynthwaveBackground round={round} />

      {/* Top Banner */}
      <div className="relative z-10 flex flex-col items-center text-center w-full max-w-4xl">
        <div className="flex items-center gap-3 px-6 py-2 bg-[#10002B]/85 border-2 border-[#FFE066] rounded-full shadow-[0_0_25px_rgba(255,224,102,0.6)]">
          <Ticket className="w-5 h-5 text-[#FFE066]" />
          <span className="text-[#FFE066] font-black uppercase tracking-[0.3em] text-xs sm:text-sm">
            Tactical Power Activated · Extra Ticket
          </span>
        </div>
      </div>

      {/* Center 3D Ticket Stage */}
      <div className="relative z-10 w-full max-w-xl h-[280px] sm:h-[320px] my-auto flex items-center justify-center overflow-visible"
        style={{ perspective: '1200px' }}>
        <div
          className={`w-[480px] sm:w-[540px] max-w-full h-[220px] sm:h-[250px] rounded-3xl bg-gradient-to-r from-[#FFE066] via-[#FF6B35] to-[#FFE066] border-4 border-white shadow-[0_0_80px_rgba(255,224,102,0.8)] p-6 flex flex-col justify-between relative overflow-hidden transition-all duration-700 ${ticketState === 'floating' ? 'animate-ticket-float' : ''}`}
          style={{
            animation:
              ticketState === 'entering'
                ? 'ticket-enter 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards'
                : ticketState === 'exiting'
                  ? 'ticket-exit 1.0s cubic-bezier(0.7, 0, 0.84, 0) forwards'
                  : undefined
          }}
        >
          {/* Scalloped Side Notches */}
          <div className="absolute -left-5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-[#10002B] border-r-4 border-white" />
          <div className="absolute -right-5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-[#10002B] border-l-4 border-white" />

          {/* Ticket Header */}
          <div className="flex justify-between items-center border-b-2 border-dashed border-[#10002B]/40 pb-2">
            <div className="flex items-center gap-2">
              <Crown className="w-6 h-6 text-[#10002B]" />
              <span className="font-black tracking-widest text-lg sm:text-xl uppercase text-[#10002B]">VIP Extra Ticket</span>
            </div>
            <span className="font-mono font-black text-xs bg-[#10002B] text-[#FFE066] px-3 py-1 rounded-full">
              #TKT-VIP-2026
            </span>
          </div>

          {/* Ticket Body */}
          <div className="my-auto py-1">
            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-[#78350f] mb-0.5">
              Authorized Participant
            </div>
            <div className="text-3xl sm:text-4xl font-black tracking-wider text-[#10002B] uppercase truncate drop-shadow-sm">
              {playerName ?? 'Lucky Player'}
            </div>
            <div className="text-xs font-black text-[#78350f] mt-0.5">
              Grants +1 valid bingo ticket for tournament scoring
            </div>
          </div>

          {/* Barcode Footer */}
          <div className="flex justify-between items-end border-t border-[#10002B]/30 pt-2">
            <div className="flex gap-1 items-end h-5">
              {[3, 1, 4, 2, 5, 2, 1, 4, 3, 2, 4, 1, 3, 2, 4].map((w, i) => (
                <div key={i} className="bg-[#10002B] h-full" style={{ width: `${w * 2}px` }} />
              ))}
            </div>
            <span className="font-black text-xs sm:text-sm tracking-[0.25em] text-[#10002B]">AUTHENTICATED</span>
          </div>
        </div>
      </div>

      {/* Bottom Announcement Banner Placed Safely Above Data-Port */}
      <div className="relative z-10 w-full max-w-3xl text-center">
        <div className="px-8 py-3.5 bg-[#10002B]/95 border-2 border-[#FFE066] rounded-2xl shadow-[0_0_35px_rgba(255,224,102,0.6)]">
          <h2 className="text-2xl sm:text-3xl font-black text-white tracking-widest uppercase mb-1">
            +1 Bingo Ticket Dispatched!
          </h2>
          <p className="text-xs sm:text-sm text-[#FFE066] font-bold tracking-[0.2em] uppercase">
            Awarded to {playerName}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── 4. HIGH-VOLTAGE LIGHTNING ARC REACTOR (DOUBLE POINTS) ───────────────────
function LightningSmokeAnimation({
  playerName,
  round,
}: {
  playerName?: string;
  bg?: string;
  round?: number;
}) {
  const [animStage, setAnimStage] = useState<'lightning' | 'surge' | 'burst'>('lightning');

  useEffect(() => {
    SoundEffects.playThunder();
    const t1 = setTimeout(() => setAnimStage('surge'), 700);
    const t2 = setTimeout(() => {
      setAnimStage('burst');
      confetti({
        particleCount: 160,
        spread: 90,
        colors: ['#FFE066', '#FF6B35', '#00F5D4', '#ffffff']
      });
    }, 1600);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-between relative overflow-hidden pt-20 pb-24 px-6 select-none">
      <SynthwaveBackground round={round} />

      {/* Top Banner */}
      <div className="relative z-10 flex flex-col items-center text-center w-full max-w-4xl">
        <div className="flex items-center gap-3 px-6 py-2 bg-[#10002B]/85 border-2 border-[#FFE066] rounded-full shadow-[0_0_25px_rgba(255,224,102,0.6)]">
          <Zap className="w-5 h-5 text-[#FFE066]" />
          <span className="text-[#FFE066] font-black uppercase tracking-[0.3em] text-xs sm:text-sm">
            Tactical Power Activated · Double Points
          </span>
        </div>
      </div>

      {/* Center High-Voltage Lightning Arc Stage */}
      <div className="relative z-10 w-full max-w-2xl h-[320px] sm:h-[360px] my-auto flex items-center justify-center">
        {animStage === 'lightning' && (
          <svg className="w-72 h-72 text-[#FFE066] drop-shadow-[0_0_60px_rgba(255,224,102,1)] animate-shake" viewBox="0 0 100 100" fill="none">
            <path d="M 50 0 L 42 40 L 62 40 L 32 100 L 45 55 L 22 55 Z" fill="#FFE066" stroke="#ffffff" strokeWidth="2" />
          </svg>
        )}

        {animStage === 'surge' && (
          <div className="relative flex items-center justify-center">
            <div className="w-64 h-64 rounded-full border-4 border-[#FFE066] shadow-[0_0_80px_rgba(255,224,102,0.9)] animate-spin" style={{ animationDuration: '3s' }} />
            <div className="absolute w-48 h-48 rounded-full bg-[#FF6B35]/40 blur-2xl animate-pulse" />
          </div>
        )}

        {animStage === 'burst' && (
          <div className="flex flex-col items-center animate-in zoom-in duration-500">
            <div className="relative flex items-center justify-center">
              <div className="absolute w-72 h-72 rounded-full border-4 border-[#FFE066] shadow-[0_0_90px_rgba(255,224,102,0.9)] animate-spin" style={{ animationDuration: '5s' }} />
              <div className="w-56 h-56 rounded-full bg-gradient-to-tr from-[#FF6B35] via-[#FFE066] to-[#FF007F] flex flex-col items-center justify-center border-4 border-white shadow-[0_0_100px_rgba(255,107,53,1)]">
                <span className="text-8xl font-black text-[#10002B] tracking-tighter drop-shadow-md leading-none">
                  2X
                </span>
                <span className="text-[#10002B] font-black text-xs uppercase tracking-[0.3em] mt-1">
                  Points Multiplier
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Announcement Banner Placed Safely Above Data-Port */}
      <div className="relative z-10 w-full max-w-3xl text-center">
        <div className="px-8 py-4 bg-[#10002B]/95 border-2 border-[#FFE066] rounded-2xl shadow-[0_0_35px_rgba(255,224,102,0.6)]">
          <h2 className="text-2xl sm:text-3xl font-black text-white tracking-widest uppercase mb-1">
            Double Points Activated!
          </h2>
          <p className="text-xs sm:text-sm text-[#FFE066] font-bold tracking-[0.2em] uppercase">
            Next BINGO by {playerName} will pay 2× Points!
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── 5. LITERAL 3D OPPOSING BROADCAST MEGAPHONES (DUAL CALL) ──────────────────
function DualMegaphonesAnimation({
  playerName,
  round,
}: {
  playerName?: string;
  bg?: string;
  round?: number;
}) {
  useEffect(() => {
    SoundEffects.playMegaphone();
    confetti({
      particleCount: 120,
      spread: 80,
      colors: ['#00F5D4', '#FF007F', '#ffffff']
    });
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-between relative overflow-hidden pt-16 pb-20 px-6 select-none">
      <SynthwaveBackground round={round} />

      {/* Top Banner */}
      <div className="relative z-10 flex flex-col items-center text-center w-full max-w-4xl">
        <div className="flex items-center gap-3 px-7 py-2 bg-[#10002B]/85 border-2 border-[#00F5D4] rounded-full shadow-[0_0_25px_rgba(0,245,212,0.6)]">
          <Radio className="w-5 h-5 text-[#00F5D4] animate-pulse" />
          <span className="text-[#00F5D4] font-black uppercase tracking-[0.35em] text-xs sm:text-sm">
            Tactical Power Activated · Dual Call
          </span>
        </div>
      </div>

      {/* Grand Full-Screen Arena with 3D Opposing Megaphones */}
      <div className="relative w-full min-h-[380px] flex items-center justify-between px-4 my-auto">
        {/* Left 3D High-Tech Megaphone */}
        <div className="relative flex items-center animate-in slide-in-from-left duration-700">
          <svg width="280" height="230" viewBox="0 0 200 160" className="drop-shadow-[0_0_40px_rgba(0,245,212,0.85)]">
            <defs>
              <linearGradient id="coneGradL" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#0B132B" />
                <stop offset="40%" stopColor="#1C2541" />
                <stop offset="85%" stopColor="#00F5D4" />
                <stop offset="100%" stopColor="#ffffff" />
              </linearGradient>
              <linearGradient id="bodyGradL" x1="0%" y1="0%" x2="100%" y2="50%">
                <stop offset="0%" stopColor="#3A0CA3" />
                <stop offset="100%" stopColor="#7209B7" />
              </linearGradient>
              <linearGradient id="rimGradL" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#00F5D4" />
                <stop offset="50%" stopColor="#ffffff" />
                <stop offset="100%" stopColor="#00F5D4" />
              </linearGradient>
            </defs>
            <path d="M 45 90 L 55 145 L 75 140 L 65 90 Z" fill="#1C2541" stroke="#00F5D4" strokeWidth="2.5" />
            <rect x="52" y="98" width="10" height="15" rx="3" fill="#FF007F" />
            <rect x="15" y="55" width="35" height="42" rx="6" fill="#10002B" stroke="#7B2CBF" strokeWidth="3" />
            <circle cx="28" cy="76" r="6" fill="#00F5D4" className="animate-pulse" />
            <rect x="45" y="45" width="45" height="62" rx="8" fill="url(#bodyGradL)" stroke="#00F5D4" strokeWidth="2" />
            <polygon points="90,45 165,15 165,137 90,107" fill="url(#coneGradL)" stroke="#00F5D4" strokeWidth="2" />
            <ellipse cx="165" cy="76" rx="14" ry="61" fill="#0B132B" stroke="url(#rimGradL)" strokeWidth="6" />
            <ellipse cx="165" cy="76" rx="7" ry="32" fill="#00F5D4" opacity="0.75" />
            <line x1="165" y1="44" x2="165" y2="108" stroke="#ffffff" strokeWidth="2" />
          </svg>

          {/* Concentric Full-Screen Sonic Shockwaves */}
          <div className="absolute top-1/2 left-[150px] -translate-y-1/2 w-40 h-40 rounded-full border-4 border-[#00F5D4] pointer-events-none"
            style={{ animation: 'sonic-ring 1.5s ease-out infinite' }} />
          <div className="absolute top-1/2 left-[150px] -translate-y-1/2 w-40 h-40 rounded-full border-4 border-[#FF007F] pointer-events-none"
            style={{ animation: 'sonic-ring 1.5s ease-out infinite 0.5s' }} />
        </div>

        {/* Center Grand Holographic Badge */}
        <div className="relative z-20 flex flex-col items-center animate-in zoom-in duration-500 mx-2">
          <div className="px-8 py-6 rounded-3xl bg-[#10002B]/95 border-4 border-[#00F5D4] shadow-[0_0_80px_rgba(0,245,212,0.8)] flex flex-col items-center text-center">
            <span className="text-5xl sm:text-7xl font-black text-transparent bg-clip-text bg-gradient-to-r from-[#00F5D4] via-white to-[#FF007F] tracking-widest uppercase drop-shadow-[0_0_30px_rgba(0,245,212,0.9)]">
              DUAL CALL
            </span>
            <div className="h-1 w-36 bg-gradient-to-r from-[#00F5D4] via-[#FF007F] to-[#00F5D4] my-3 rounded-full" />
            <span className="text-sm sm:text-base font-black text-[#00F5D4] tracking-[0.35em] uppercase">
              2 Problems At Once · 5 Consecutive Draws
            </span>
          </div>
        </div>

        {/* Right 3D High-Tech Megaphone (Mirrored) */}
        <div className="relative flex items-center animate-in slide-in-from-right duration-700">
          <div className="absolute top-1/2 right-[150px] -translate-y-1/2 w-40 h-40 rounded-full border-4 border-[#00F5D4] pointer-events-none"
            style={{ animation: 'sonic-ring 1.5s ease-out infinite' }} />
          <div className="absolute top-1/2 right-[150px] -translate-y-1/2 w-40 h-40 rounded-full border-4 border-[#FF007F] pointer-events-none"
            style={{ animation: 'sonic-ring 1.5s ease-out infinite 0.5s' }} />

          <div style={{ transform: 'scaleX(-1)' }}>
            <svg width="280" height="230" viewBox="0 0 200 160" className="drop-shadow-[0_0_40px_rgba(0,245,212,0.85)]">
              <polygon points="90,45 165,15 165,137 90,107" fill="url(#coneGradL)" stroke="#00F5D4" strokeWidth="2" />
              <rect x="45" y="45" width="45" height="62" rx="8" fill="url(#bodyGradL)" stroke="#00F5D4" strokeWidth="2" />
              <rect x="15" y="55" width="35" height="42" rx="6" fill="#10002B" stroke="#7B2CBF" strokeWidth="3" />
              <path d="M 45 90 L 55 145 L 75 140 L 65 90 Z" fill="#1C2541" stroke="#00F5D4" strokeWidth="2.5" />
              <rect x="52" y="98" width="10" height="15" rx="3" fill="#FF007F" />
              <ellipse cx="165" cy="76" rx="14" ry="61" fill="#0B132B" stroke="url(#rimGradL)" strokeWidth="6" />
              <ellipse cx="165" cy="76" rx="7" ry="32" fill="#00F5D4" opacity="0.75" />
            </svg>
          </div>
        </div>
      </div>

      {/* Announcement Footer Placed Safely Above Data-Port */}
      <div className="relative z-10 w-full max-w-3xl text-center">
        <div className="px-6 py-3 bg-[#10002B]/90 border border-[#00F5D4]/60 rounded-2xl shadow-[0_0_25px_rgba(0,245,212,0.4)]">
          <h2 className="text-2xl sm:text-3xl font-black text-white tracking-widest uppercase mb-1 drop-shadow-lg">
            STAGE SPLIT INTO 2 SIMULTANEOUS PROBLEMS!
          </h2>
          <p className="text-xs sm:text-sm text-[#00F5D4] font-bold tracking-[0.2em] uppercase">
            Activated by {playerName ?? 'Tactical Unit'} · Next 5 calls will draw two equations simultaneously
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── LIVE COUNT-UP NUMBER COMPONENT (FOR DYNAMIC LEADERBOARD SCORES) ────────
function CountUpScore({ target, duration = 1200 }: { target: number; duration?: number }) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    if (target === 0) {
      setDisplayValue(0);
      return;
    }
    let startTimestamp: number | null = null;
    let animationFrameId: number;

    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.round(easedProgress * target));
      if (progress < 1) {
        animationFrameId = requestAnimationFrame(step);
      }
    };

    animationFrameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animationFrameId);
  }, [target, duration]);

  return <span>{displayValue.toLocaleString()} pts</span>;
}

// ─── DEDICATED LEADERBOARD BACKGROUND (LAYER 1: DEEP BACKGROUND) ─────────────
function LeaderboardBackground() {
  return (
    <div className="absolute inset-0 w-full h-full pointer-events-none select-none overflow-hidden bg-[#0d021a]">
      {/* 1. High-fidelity 80s arcade synthwave room background without baked podiums */}
      <img
        src="/leaderboard_room_bg.jpg"
        alt="Leaderboard Arena"
        className="absolute inset-0 w-full h-full object-cover object-center"
      />

      {/* 2. Ambient neon bloom layers */}
      {/* Crown portal glow accent */}
      <div
        className="absolute left-1/2 -translate-x-1/2 top-[24%] w-64 h-32 rounded-full pointer-events-none opacity-60 animate-pulse"
        style={{
          background: 'radial-gradient(ellipse, rgba(255, 224, 102, 0.45) 0%, rgba(255, 0, 127, 0.25) 50%, transparent 80%)',
          filter: 'blur(20px)',
          animationDuration: '4s'
        }}
      />

      {/* Left pink arch glow */}
      <div
        className="absolute left-[20%] top-[45%] w-48 h-64 rounded-full pointer-events-none opacity-45 animate-pulse"
        style={{
          background: 'radial-gradient(ellipse, rgba(255, 0, 127, 0.4) 0%, transparent 75%)',
          filter: 'blur(25px)',
          animationDuration: '5s'
        }}
      />

      {/* Right amber arch glow */}
      <div
        className="absolute right-[20%] top-[45%] w-48 h-64 rounded-full pointer-events-none opacity-45 animate-pulse"
        style={{
          background: 'radial-gradient(ellipse, rgba(255, 107, 53, 0.4) 0%, transparent 75%)',
          filter: 'blur(25px)',
          animationDuration: '5s'
        }}
      />

      {/* 3. Animated floor grid runner light streams scrolling towards camera */}
      <svg
        viewBox="0 0 1920 1080"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 w-full h-full pointer-events-none opacity-70"
      >
        <defs>
          <linearGradient id="gridBeamPink" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FF007F" stopOpacity="0" />
            <stop offset="60%" stopColor="#FF007F" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#FF55D2" stopOpacity="1" />
          </linearGradient>
          <linearGradient id="gridBeamCyan" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00F5D4" stopOpacity="0" />
            <stop offset="60%" stopColor="#00F5D4" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#38BDF8" stopOpacity="1" />
          </linearGradient>
          <linearGradient id="gridBeamGold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFE066" stopOpacity="0" />
            <stop offset="70%" stopColor="#FFB700" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#FFE066" stopOpacity="1" />
          </linearGradient>
        </defs>

        <g className="animate-pulse" style={{ animationDuration: '3s' }}>
          <line x1="960" y1="670" x2="520" y2="1080" stroke="url(#gridBeamCyan)" strokeWidth="3" filter="drop-shadow(0 0 8px #00F5D4)" />
          <line x1="960" y1="670" x2="960" y2="1080" stroke="url(#gridBeamGold)" strokeWidth="3" filter="drop-shadow(0 0 10px #FFE066)" />
          <line x1="960" y1="670" x2="1400" y2="1080" stroke="url(#gridBeamPink)" strokeWidth="3" filter="drop-shadow(0 0 8px #FF007F)" />
        </g>
      </svg>
    </div>
  );
}

// ─── CYBER CORNER BRACKETS (ANIMATED TECH BORDER ACCENTS) ───────────────────
function CyberCardCorners({ color = '#FFE066' }: { color?: string }) {
  return (
    <div className="absolute inset-0 pointer-events-none z-20">
      {/* Top Left */}
      <div className="absolute top-1.5 left-1.5 w-3.5 h-3.5 border-t-2 border-l-2" style={{ borderColor: color, filter: `drop-shadow(0 0 5px ${color})` }}>
        <div className="absolute -top-1 -left-1 w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      </div>
      {/* Top Right */}
      <div className="absolute top-1.5 right-1.5 w-3.5 h-3.5 border-t-2 border-r-2" style={{ borderColor: color, filter: `drop-shadow(0 0 5px ${color})` }}>
        <div className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      </div>
      {/* Bottom Left */}
      <div className="absolute bottom-1.5 left-1.5 w-3.5 h-3.5 border-b-2 border-l-2" style={{ borderColor: color, filter: `drop-shadow(0 0 5px ${color})` }}>
        <div className="absolute -bottom-1 -left-1 w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      </div>
      {/* Bottom Right */}
      <div className="absolute bottom-1.5 right-1.5 w-3.5 h-3.5 border-b-2 border-r-2" style={{ borderColor: color, filter: `drop-shadow(0 0 5px ${color})` }}>
        <div className="absolute -bottom-1 -right-1 w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      </div>
    </div>
  );
}

// ─── 6. CHAMPIONSHIP STANDINGS PODIUM (LAYERS 2 & 3: PODIUM BLOCKS & OVERLAY) ─
function ChampionshipPodium({
  leaderboardData,
  round: _round,
}: {
  leaderboardData: LeaderboardStageData;
  bg?: string;
  round?: number;
}) {
  const [revealStep, setRevealStep] = useState(0);
  const top3 = leaderboardData.leaderboard.slice(0, 3);
  const ranks4to10 = leaderboardData.leaderboard.slice(3, 10);

  useEffect(() => {
    setRevealStep(0);
    const t1 = setTimeout(() => {
      setRevealStep(1);
      SoundEffects.playPodium(3);
      confetti({ particleCount: 60, spread: 60, colors: ['#FF6B35'], origin: { x: 0.8, y: 0.7 } });
    }, 800);

    const t2 = setTimeout(() => {
      setRevealStep(2);
      SoundEffects.playPodium(2);
      confetti({ particleCount: 80, spread: 70, colors: ['#00F5D4'], origin: { x: 0.2, y: 0.6 } });
    }, 2800);

    const t3 = setTimeout(() => {
      setRevealStep(3);
      SoundEffects.playPodium(1);
      confetti({
        particleCount: 200,
        spread: 110,
        colors: ['#FFE066', '#FF007F', '#FF6B35'],
        origin: { x: 0.5, y: 0.5 }
      });
    }, 5200);

    const t4 = setTimeout(() => setRevealStep(4), 8000);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, [leaderboardData]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-between relative overflow-hidden select-none p-3 sm:p-5 md:p-6">
      {/* ── LAYER 1: DEEP BACKGROUND (EMPTY ARCADE HALL & PERSPECTIVE GRID) ── */}
      <LeaderboardBackground />

      {/* ── LEFT FLANK: CYBER TELEMETRY SIDEBAR (SOUNDWAVES & TELEMETRY) ── */}
      <CyberTelemetrySidebar />

      {/* ── RIGHT FLANK: CYBER TELEMETRY RIGHT SIDEBAR (SOUNDWAVES & MATH SYMBOLS) ── */}
      <CyberTelemetryRightSidebar />

      {/* ── LAYER 3: TOP HEADER BAR ── */}
      <div className="relative z-20 text-center pt-1 pb-1">
        <div className="inline-flex items-center gap-2 px-6 py-1 bg-[#090018]/95 border border-[#FFE066]/80 rounded-full mb-1.5 shadow-[0_0_20px_rgba(255,224,102,0.4)] backdrop-blur-md">
          <Trophy className="w-4 h-4 text-[#FFE066]" />
          <span className="text-[#FFE066] font-black uppercase tracking-[0.35em] text-[11px]">
            {leaderboardData.mode === 'cumulative' ? 'Overall Championship Standings' : `Round ${leaderboardData.round} Standings`}
          </span>
        </div>
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-[#FFE066] via-white to-[#FF6B35] uppercase tracking-[0.15em] drop-shadow-[0_0_25px_rgba(255,183,0,0.8)] leading-tight">
          Championship Standings
        </h1>
      </div>

      {/* ── LAYER 2 & 3: 3D PODIUM BLOCKS & DYNAMIC SLOT CONTAINERS ── */}
      <div className="relative z-20 w-full max-w-5xl flex items-end justify-center gap-3 sm:gap-6 md:gap-8 px-2 my-auto">

        {/* ── #2 SILVER COLUMN (LEFT, UNVEILS AT STEP 2) ── */}
        <div
          className={`flex-1 max-w-[280px] flex flex-col items-center select-none transition-all duration-700 ${revealStep >= 2 ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-32 scale-90 pointer-events-none'
            }`}
        >
          {/* Dynamic Slot Container (Hovers above #2 podium) */}
          <div className="w-full flex flex-col items-center mb-3">
            {top3[1] && (
              <div className="relative overflow-hidden p-[2px] rounded-2xl w-full shadow-[0_0_35px_rgba(0,245,212,0.5)]">
                {/* Animated Rotating Border Beam */}
                <div
                  className="absolute -inset-[200%] animate-border-beam pointer-events-none z-0"
                  style={{
                    background: 'conic-gradient(from 0deg, transparent 0deg, #00F5D4 45deg, #FFFFFF 60deg, #00F5D4 75deg, transparent 120deg)',
                  }}
                />
                {/* 100% Solid Opaque Black Card */}
                <div className="relative z-10 bg-[#040C12] rounded-[14px] p-3 sm:p-4 text-center border border-[#00F5D4]/70">
                  <CyberCardCorners color="#00F5D4" />
                  <div className="w-12 h-12 rounded-full bg-[#00F5D4]/20 border-2 border-[#00F5D4] flex items-center justify-center mb-1.5 shadow-[0_0_15px_#00F5D4] mx-auto">
                    <Medal className="w-7 h-7 text-[#00F5D4]" />
                  </div>
                  <div className="text-lg sm:text-xl font-black text-white uppercase tracking-wider truncate max-w-[200px] mx-auto drop-shadow-[0_2px_4px_#000]">
                    {top3[1].name}
                  </div>
                  <div className="text-[#00F5D4] font-mono font-black text-2xl mt-0.5 drop-shadow-[0_0_12px_#00F5D4]">
                    <CountUpScore target={top3[1].score} />
                  </div>
                  <span className="inline-block text-[10px] font-black uppercase tracking-[0.25em] text-[#00F5D4] bg-[#00F5D4]/15 border border-[#00F5D4]/50 px-3 py-0.5 rounded-full mt-1.5">
                    2ND PLACE // SILVER
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* 3D Elevated Podium Block #2 (Cyan) - 100% SOLID OPAQUE */}
          <div className="w-full relative flex flex-col items-center select-none animate-podium-bounce">
            {/* Top 3D Isometric Surface */}
            <div
              className="w-full h-10 z-10"
              style={{
                clipPath: 'polygon(12% 0%, 88% 0%, 100% 100%, 0% 100%)',
                background: 'linear-gradient(180deg, #072B33 0%, #03151A 100%)',
                borderTop: '3px solid #00F5D4',
                borderLeft: '2.5px solid #00F5D4',
                borderRight: '2.5px solid #00F5D4',
                boxShadow: '0 0 25px rgba(0, 245, 212, 0.7)',
              }}
            />
            {/* Front Vertical Face - Solid Opaque */}
            <div
              className="w-full rounded-b-xl flex flex-col items-center justify-between py-5 relative overflow-hidden"
              style={{
                height: '190px',
                background: 'linear-gradient(180deg, #03343C 0%, #061B24 20%, #030C12 60%, #010609 100%)',
                border: '3px solid #00F5D4',
                borderTop: 'none',
                boxShadow: '0 0 45px rgba(0, 245, 212, 0.6), inset 0 0 30px rgba(0, 245, 212, 0.25)',
              }}
            >
              <CyberCardCorners color="#00F5D4" />
              <div
                className="font-arcade text-7xl font-black text-[#00F5D4] my-auto select-none"
                style={{ textShadow: '0 0 20px #00F5D4, 0 0 40px rgba(0, 245, 212, 0.7)' }}
              >
                #2
              </div>
              <div className="w-4/5 flex flex-col items-center gap-1.5 opacity-85">
                <div className="w-full h-[2.5px] bg-[#00F5D4] shadow-[0_0_10px_#00F5D4] animate-pulse" />
                <div className="w-2/3 h-[1.5px] bg-[#00F5D4]/70" />
                <div className="w-full flex items-center justify-between text-[8px] font-mono text-[#00F5D4] tracking-widest opacity-60">
                  <span>◄ ◄</span><span>SILVER // 02</span><span>► ►</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── #1 GOLD CHAMPION COLUMN (CENTER, TALLEST, UNVEILS AT STEP 3) ── */}
        <div
          className={`flex-1 max-w-[340px] flex flex-col items-center select-none z-30 transition-all duration-700 ${revealStep >= 3 ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-32 scale-90 pointer-events-none'
            }`}
        >
          {/* Dynamic Slot Container (Hovers above #1 champion podium) */}
          <div className="w-full flex flex-col items-center mb-4">
            {top3[0] && (
              <div className="relative overflow-hidden p-[3px] rounded-3xl w-full shadow-[0_0_55px_rgba(255,224,102,0.7)]">
                {/* Animated Rotating Multi-Color Laser Border Beam */}
                <div
                  className="absolute -inset-[200%] animate-border-beam pointer-events-none z-0"
                  style={{
                    background: 'conic-gradient(from 0deg, transparent 0deg, #FFE066 35deg, #FFFFFF 50deg, #FF8C00 70deg, #FF007F 90deg, transparent 135deg)',
                  }}
                />
                {/* 100% Solid Opaque Black Champion Plaque */}
                <div className="relative z-10 bg-[#06000E] rounded-[21px] p-5 sm:p-6 text-center border-2 border-[#FFE066]">
                  <CyberCardCorners color="#FFE066" />
                  <div className="flex justify-center -mt-1 mb-1">
                    <Crown className="w-16 h-16 text-[#FFE066] drop-shadow-[0_0_30px_#FFE066] animate-bounce" />
                  </div>
                  <div className="text-2xl sm:text-3xl font-black text-white uppercase tracking-wider truncate max-w-[250px] mx-auto drop-shadow-[0_2px_6px_#000000]">
                    {top3[0].name}
                  </div>
                  <div className="text-[#FFE066] font-mono font-black text-3xl sm:text-4xl mt-1.5 drop-shadow-[0_0_18px_rgba(255,224,102,0.9)]">
                    <CountUpScore target={top3[0].score} />
                  </div>
                  <span className="inline-block text-xs font-black uppercase tracking-[0.35em] text-[#0A0014] bg-gradient-to-r from-[#FFB700] via-[#FFE066] to-[#FF8C00] px-6 py-1 rounded-full mt-2.5 shadow-[0_0_20px_#FFE066]">
                    CHAMPION // #1
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* 3D Elevated Podium Block #1 (Gold) - 100% SOLID OPAQUE */}
          <div className="w-full relative flex flex-col items-center select-none animate-podium-bounce">
            {/* Top 3D Isometric Surface */}
            <div
              className="w-full h-12 z-10"
              style={{
                clipPath: 'polygon(12% 0%, 88% 0%, 100% 100%, 0% 100%)',
                background: 'linear-gradient(180deg, #4A2803 0%, #1A0B01 100%)',
                borderTop: '3.5px solid #FFE066',
                borderLeft: '3px solid #FFE066',
                borderRight: '3px solid #FFE066',
                boxShadow: '0 0 35px rgba(255, 224, 102, 0.85)',
              }}
            />
            {/* Front Vertical Face - Solid Opaque */}
            <div
              className="w-full rounded-b-xl flex flex-col items-center justify-between py-6 relative overflow-hidden"
              style={{
                height: '255px',
                background: 'linear-gradient(180deg, #5C3202 0%, #291201 20%, #120500 55%, #050100 100%)',
                border: '3.5px solid #FFE066',
                borderTop: 'none',
                boxShadow: '0 0 60px rgba(255, 224, 102, 0.85), inset 0 0 40px rgba(255, 224, 102, 0.3)',
              }}
            >
              <CyberCardCorners color="#FFE066" />
              <div
                className="font-arcade text-8xl font-black text-[#FFE066] my-auto select-none"
                style={{ textShadow: '0 0 25px #FFE066, 0 0 50px rgba(255, 224, 102, 0.8)' }}
              >
                #1
              </div>
              <div className="w-4/5 flex flex-col items-center gap-1.5 opacity-90">
                <div className="w-full h-[3.5px] bg-[#FFE066] shadow-[0_0_15px_#FFE066] animate-pulse" />
                <div className="w-2/3 h-[2px] bg-[#FF8C00] shadow-[0_0_8px_#FF8C00]" />
                <div className="w-full flex items-center justify-between text-[9px] font-mono text-[#FFE066] tracking-widest opacity-70">
                  <span>◄ ◄ ◄</span><span>CHAMPION // 01</span><span>► ► ►</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── #3 BRONZE COLUMN (RIGHT, UNVEILS AT STEP 1) ── */}
        <div
          className={`flex-1 max-w-[280px] flex flex-col items-center select-none transition-all duration-700 ${revealStep >= 1 ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-32 scale-90 pointer-events-none'
            }`}
        >
          {/* Dynamic Slot Container (Hovers above #3 podium) */}
          <div className="w-full flex flex-col items-center mb-3">
            {top3[2] && (
              <div className="relative overflow-hidden p-[2px] rounded-2xl w-full shadow-[0_0_35px_rgba(232,121,249,0.5)]">
                {/* Animated Rotating Border Beam */}
                <div
                  className="absolute -inset-[200%] animate-border-beam pointer-events-none z-0"
                  style={{
                    background: 'conic-gradient(from 0deg, transparent 0deg, #E879F9 45deg, #FFFFFF 60deg, #FF007F 75deg, transparent 120deg)',
                  }}
                />
                {/* 100% Solid Opaque Black Card */}
                <div className="relative z-10 bg-[#07000F] rounded-[14px] p-3 sm:p-4 text-center border border-[#E879F9]/70">
                  <CyberCardCorners color="#E879F9" />
                  <div className="w-12 h-12 rounded-full bg-[#E879F9]/20 border-2 border-[#E879F9] flex items-center justify-center mb-1.5 shadow-[0_0_15px_#E879F9] mx-auto">
                    <Award className="w-7 h-7 text-[#E879F9]" />
                  </div>
                  <div className="text-lg sm:text-xl font-black text-white uppercase tracking-wider truncate max-w-[200px] mx-auto drop-shadow-[0_2px_4px_#000]">
                    {top3[2].name}
                  </div>
                  <div className="text-[#E879F9] font-mono font-black text-2xl mt-0.5 drop-shadow-[0_0_12px_#E879F9]">
                    <CountUpScore target={top3[2].score} />
                  </div>
                  <span className="inline-block text-[10px] font-black uppercase tracking-[0.25em] text-[#E879F9] bg-[#E879F9]/15 border border-[#E879F9]/50 px-3 py-0.5 rounded-full mt-1.5">
                    3RD PLACE // BRONZE
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* 3D Elevated Podium Block #3 (Bronze/Purple) - 100% SOLID OPAQUE */}
          <div className="w-full relative flex flex-col items-center select-none animate-podium-bounce">
            {/* Top 3D Isometric Surface */}
            <div
              className="w-full h-10 z-10"
              style={{
                clipPath: 'polygon(12% 0%, 88% 0%, 100% 100%, 0% 100%)',
                background: 'linear-gradient(180deg, #380B3E 0%, #140217 100%)',
                borderTop: '3px solid #E879F9',
                borderLeft: '2.5px solid #E879F9',
                borderRight: '2.5px solid #E879F9',
                boxShadow: '0 0 25px rgba(232, 121, 249, 0.7)',
              }}
            />
            {/* Front Vertical Face - Solid Opaque */}
            <div
              className="w-full rounded-b-xl flex flex-col items-center justify-between py-5 relative overflow-hidden"
              style={{
                height: '145px',
                background: 'linear-gradient(180deg, #420847 0%, #200424 22%, #0E0111 60%, #050006 100%)',
                border: '3px solid #C084FC',
                borderTop: 'none',
                boxShadow: '0 0 45px rgba(192, 132, 252, 0.6), inset 0 0 30px rgba(192, 132, 252, 0.25)',
              }}
            >
              <CyberCardCorners color="#E879F9" />
              <div
                className="font-arcade text-7xl font-black text-[#E879F9] my-auto select-none"
                style={{ textShadow: '0 0 20px #E879F9, 0 0 40px rgba(232, 121, 249, 0.7)' }}
              >
                #3
              </div>
              <div className="w-4/5 flex flex-col items-center gap-1.5 opacity-85">
                <div className="w-full h-[2.5px] bg-[#C084FC] shadow-[0_0_10px_#C084FC] animate-pulse" />
                <div className="w-2/3 h-[1.5px] bg-[#C084FC]/70" />
                <div className="w-full flex items-center justify-between text-[8px] font-mono text-[#E879F9] tracking-widest opacity-60">
                  <span>◄ ◄</span><span>BRONZE // 03</span><span>► ►</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── LAYER 3: RANKS 4-10 ROSTER (ONLY IN CUMULATIVE STANDINGS) ── */}
      {revealStep >= 4 && leaderboardData.mode === 'cumulative' && ranks4to10.length > 0 && (
        <div className="relative z-20 w-full max-w-4xl bg-[#090018]/94 border border-[#7B2CBF]/80 rounded-2xl p-4 backdrop-blur-md shadow-[0_0_35px_rgba(168,85,247,0.45),inset_0_0_20px_rgba(168,85,247,0.15)] animate-in slide-in-from-bottom duration-700 mt-6 sm:mt-8 mb-4">
          <h3 className="text-xs font-bold text-[#00F5D4] uppercase tracking-[0.4em] mb-2.5 text-center">
            Arena Leaderboard (Ranks 4+)
          </h3>
          <div className={`grid ${ranks4to10.length === 1 ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'} gap-2.5 max-h-36 overflow-y-auto custom-scrollbar pr-2`}>
            {ranks4to10.map((p, idx) => (
              <div
                key={p.id}
                className={`flex justify-between items-center bg-[#140226]/90 border border-[#7B2CBF]/60 rounded-xl px-5 py-2.5 hover:border-[#00F5D4] transition-colors w-full ${ranks4to10.length === 1 ? 'col-span-full' : ''
                  }`}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className="text-slate-400 font-mono font-bold text-sm sm:text-base w-7 flex-shrink-0">
                    #{idx + 4}
                  </span>
                  <span className="text-white font-bold text-sm sm:text-base truncate">
                    {p.name}
                  </span>
                </div>
                <span className="text-[#00F5D4] font-mono font-black text-sm sm:text-base flex-shrink-0 ml-4">
                  {p.score} pts
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CYBER TELEMETRY SIDEBAR (FAITHFUL RECREATION OF INSPIRATION IMAGE 3) ────
function CyberTelemetrySidebar() {
  const horizBars = [8, 14, 22, 30, 36, 42, 36, 30, 22, 14, 8];
  const spindleBars = [8, 14, 20, 28, 36, 44, 52, 58, 52, 44, 36, 28, 20, 14, 8];

  return (
    <div className="absolute left-2 sm:left-4 md:left-6 top-0 bottom-0 z-20 pointer-events-none flex flex-col justify-between py-6 select-none w-72">
      {/* Subtle purple dashed guideline running vertically behind the module */}
      <div className="absolute left-4 top-0 bottom-0 w-px border-r border-dashed border-[#A855F7]/30 pointer-events-none" />

      {/* ── TOP GROUP: Sigma + Horizontal Equalizer + Telemetry Block ── */}
      <div className="flex items-center gap-3 z-10 pl-1">
        <span className="font-pixel-math text-3xl sm:text-4xl text-[#FFA057] select-none animate-border-symbol drop-shadow-[0_0_10px_#FF8C42]">
          ∑
        </span>

        {/* Animated Horizontal Equalizer Packet */}
        <div className="flex items-center gap-[2.5px] h-11 px-1">
          {horizBars.map((h, i) => (
            <div
              key={`top-h-bar-${i}`}
              className="w-[3px] bg-gradient-to-t from-[#FF4500] via-[#FFA057] to-[#FFE066] rounded-full shadow-[0_0_8px_rgba(255,140,66,0.9)]"
              style={{
                height: `${h}px`,
                animation: `soundwave-h-fluctuate ${0.65 + (i % 5) * 0.15}s ease-in-out infinite ${(i * 0.07).toFixed(2)}s`,
                transformOrigin: 'center',
              }}
            />
          ))}
        </div>

        {/* Telemetry Block */}
        <div className="font-telemetry text-[10px] sm:text-[11px] leading-tight text-[#38BDF8] drop-shadow-[0_0_6px_#38BDF8]">
          <div className="opacity-80 tracking-widest">// SYS.LOC. KH40DEF5</div>
          <div className="opacity-75 tracking-widest">// T: 00:04:10</div>
          <div className="text-[#00F5D4] font-black tracking-wider text-xs mt-0.5">0491024.110</div>
          <div className="text-[#34D399] font-black tracking-widest text-[9.5px]">STAT: INITIALIZED</div>
        </div>
      </div>

      {/* ── MIDDLE GROUP: Integral, Pi, Spindle Equalizer, Sigma, Integral ── */}
      <div className="flex flex-col items-center gap-2.5 my-auto z-10 w-20">
        <span className="font-pixel-math text-3xl sm:text-4xl text-[#FFA057] select-none animate-border-symbol drop-shadow-[0_0_10px_#FF8C42]">
          ∫
        </span>
        <span className="font-pixel-math text-2xl sm:text-3xl text-[#FFA057] select-none animate-border-symbol drop-shadow-[0_0_10px_#FF8C42]" style={{ animationDelay: '0.5s' }}>
          π
        </span>

        {/* Vertical Soundwave Spindle (horizontal bars stacked vertically) */}
        <div className="flex flex-col items-center gap-[2.5px] my-2">
          {spindleBars.map((w, i) => (
            <div
              key={`mid-spindle-${i}`}
              className="h-[2.5px] bg-gradient-to-r from-[#FF4500] via-[#FFA057] to-[#FFE066] rounded-full shadow-[0_0_8px_rgba(255,140,66,0.9)]"
              style={{
                width: `${w}px`,
                animation: `soundwave-v-spindle-fluctuate ${0.75 + (i % 5) * 0.16}s ease-in-out infinite ${(i * 0.06).toFixed(2)}s`,
                transformOrigin: 'center',
              }}
            />
          ))}
        </div>

        <span className="font-pixel-math text-3xl sm:text-4xl text-[#FFA057] select-none animate-border-symbol drop-shadow-[0_0_10px_#FF8C42]" style={{ animationDelay: '1.0s' }}>
          ∑
        </span>
        <span className="font-pixel-math text-3xl sm:text-4xl text-[#FFA057] select-none animate-border-symbol drop-shadow-[0_0_10px_#FF8C42]" style={{ animationDelay: '1.5s' }}>
          ∫
        </span>
      </div>

      {/* ── BOTTOM GROUP: Telemetry Block + Sigma + Horizontal Equalizer ── */}
      <div className="flex flex-col gap-2 z-10 pl-1">
        {/* Bottom Telemetry Text */}
        <div className="font-telemetry text-[10px] sm:text-[11px] leading-tight text-[#38BDF8] drop-shadow-[0_0_6px_#38BDF8] ml-1">
          <div className="opacity-80 tracking-widest">LOC.ID: 882-A</div>
          <div className="text-[#00F5D4] font-black tracking-wider">COORD: [42.10, 89.04]</div>
          <div className="text-[#FBBF24] font-bold tracking-widest">SYS.FREQ: 1420 MHz</div>
        </div>

        {/* Bottom Sigma + Soundwave packet */}
        <div className="flex items-center gap-3">
          <span className="font-pixel-math text-3xl sm:text-4xl text-[#FFA057] select-none animate-border-symbol drop-shadow-[0_0_10px_#FF8C42]">
            ∑
          </span>
          <div className="flex items-center gap-[2.5px] h-11 px-1">
            {horizBars.map((h, i) => (
              <div
                key={`bot-h-bar-${i}`}
                className="w-[3px] bg-gradient-to-t from-[#FF4500] via-[#FFA057] to-[#FFE066] rounded-full shadow-[0_0_8px_rgba(255,140,66,0.9)]"
                style={{
                  height: `${h}px`,
                  animation: `soundwave-h-fluctuate ${0.7 + (i % 4) * 0.18}s ease-in-out infinite ${(i * 0.08).toFixed(2)}s`,
                  transformOrigin: 'center',
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── CYBER TELEMETRY RIGHT SIDEBAR (ANIMATED SOUNDWAVES & PIXEL MATH SYMBOLS) ─
function CyberTelemetryRightSidebar() {
  const rightEqualizerBars = [10, 16, 26, 36, 44, 52, 44, 36, 26, 16, 10];
  const rightSpindleBars = [6, 12, 20, 28, 38, 48, 54, 48, 38, 28, 20, 12, 6];

  return (
    <div className="absolute right-2 sm:right-4 md:right-6 top-0 bottom-0 z-20 pointer-events-none hidden xl:flex flex-col justify-between py-6 select-none w-64 origin-right scale-90 2xl:scale-100">
      {/* Subtle purple dashed guideline running vertically behind the module */}
      <div className="absolute right-4 top-0 bottom-0 w-px border-r border-dashed border-[#A855F7]/30 pointer-events-none" />

      {/* ── TOP GROUP: Telemetry Block + Horizontal Equalizer + Infinity Symbol ── */}
      <div className="flex items-center justify-end gap-3 z-10 pr-1">
        {/* Telemetry Block */}
        <div className="font-telemetry text-[10px] sm:text-[11px] leading-tight text-[#38BDF8] drop-shadow-[0_0_6px_#38BDF8] text-right">
          <div className="opacity-80 tracking-widest">// SEC.NODE. 77X-B</div>
          <div className="opacity-75 tracking-widest">// STATUS: SYNCED</div>
          <div className="text-[#FFE066] font-black tracking-wider text-xs mt-0.5">CHAMPION.OPS</div>
          <div className="text-[#34D399] font-black tracking-widest text-[9.5px]">FREQ: 2.45 GHz</div>
        </div>

        {/* Animated Horizontal Equalizer Packet */}
        <div className="flex items-center gap-[2.5px] h-11 px-1">
          {rightEqualizerBars.map((h, i) => (
            <div
              key={`top-r-bar-${i}`}
              className="w-[3px] bg-gradient-to-t from-[#FF007F] via-[#FFA057] to-[#FFE066] rounded-full shadow-[0_0_8px_rgba(255,140,66,0.9)]"
              style={{
                height: `${h}px`,
                animation: `soundwave-h-fluctuate ${0.68 + (i % 5) * 0.14}s ease-in-out infinite ${(i * 0.08).toFixed(2)}s`,
                transformOrigin: 'center',
              }}
            />
          ))}
        </div>

        <span className="font-pixel-math text-3xl sm:text-4xl text-[#FFA057] select-none animate-border-symbol drop-shadow-[0_0_10px_#FF8C42]">
          ∞
        </span>
      </div>

      {/* ── MIDDLE GROUP: Square Root, Delta, Spindle Equalizer, Pi, Approx ── */}
      <div className="flex flex-col items-center gap-2.5 my-auto z-10 w-20 ml-auto mr-1">
        <span className="font-pixel-math text-3xl sm:text-4xl text-[#FFA057] select-none animate-border-symbol drop-shadow-[0_0_10px_#FF8C42]">
          √
        </span>
        <span className="font-pixel-math text-2xl sm:text-3xl text-[#FFA057] select-none animate-border-symbol drop-shadow-[0_0_10px_#FF8C42]" style={{ animationDelay: '0.6s' }}>
          ∆
        </span>

        {/* Vertical Soundwave Spindle */}
        <div className="flex flex-col items-center gap-[2.5px] my-2">
          {rightSpindleBars.map((w, i) => (
            <div
              key={`mid-r-spindle-${i}`}
              className="h-[2.5px] bg-gradient-to-r from-[#FFE066] via-[#FFA057] to-[#FF007F] rounded-full shadow-[0_0_8px_rgba(255,140,66,0.9)]"
              style={{
                width: `${w}px`,
                animation: `soundwave-v-spindle-fluctuate ${0.72 + (i % 5) * 0.15}s ease-in-out infinite ${(i * 0.07).toFixed(2)}s`,
                transformOrigin: 'center',
              }}
            />
          ))}
        </div>

        <span className="font-pixel-math text-3xl sm:text-4xl text-[#FFA057] select-none animate-border-symbol drop-shadow-[0_0_10px_#FF8C42]" style={{ animationDelay: '1.2s' }}>
          π
        </span>
        <span className="font-pixel-math text-3xl sm:text-4xl text-[#FFA057] select-none animate-border-symbol drop-shadow-[0_0_10px_#FF8C42]" style={{ animationDelay: '1.8s' }}>
          ≈
        </span>
      </div>

      {/* ── BOTTOM GROUP: Horizontal Equalizer + Sigma Symbol + Telemetry ── */}
      <div className="flex flex-col gap-2 z-10 pr-1">
        <div className="flex items-center justify-end gap-3">
          <div className="flex items-center gap-[2.5px] h-11 px-1">
            {rightEqualizerBars.map((h, i) => (
              <div
                key={`bot-r-bar-${i}`}
                className="w-[3px] bg-gradient-to-t from-[#00F5D4] via-[#38BDF8] to-[#FFE066] rounded-full shadow-[0_0_8px_rgba(56,189,248,0.9)]"
                style={{
                  height: `${h}px`,
                  animation: `soundwave-h-fluctuate ${0.75 + (i % 4) * 0.16}s ease-in-out infinite ${(i * 0.07).toFixed(2)}s`,
                  transformOrigin: 'center',
                }}
              />
            ))}
          </div>
          <span className="font-pixel-math text-3xl sm:text-4xl text-[#FFA057] select-none animate-border-symbol drop-shadow-[0_0_10px_#FF8C42]">
            ≠
          </span>
        </div>

        {/* Bottom Telemetry Text */}
        <div className="font-telemetry text-[10px] sm:text-[11px] leading-tight text-[#38BDF8] drop-shadow-[0_0_6px_#38BDF8] text-right mr-1">
          <div className="opacity-80 tracking-widest">GRID.MATRIX: ACTIVE</div>
          <div className="text-[#00F5D4] font-black tracking-wider">AUDIO.VU: +3.2 dB</div>
          <div className="text-[#FBBF24] font-bold tracking-widest">FPS: 60 // LOCKED</div>
        </div>
      </div>
    </div>
  );
}

// ─── 3D MOVING PERSPECTIVE HALLWAY CORRIDOR GRID COMPONENT ──────────────────
// Authentic retro-futuristic hallway travel with moving tiles on floor, ceiling, and both walls
function MovingPerspectiveFloorGrid() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let raf: number;
    const startTime = performance.now();

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = (now: number) => {
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      const horizonY = H * 0.464; // Vanishing point horizon
      const vpX = W / 2;

      // ── 1. CLEAN STRUCTURAL TILE DIVIDERS (NO EXTRA DIAGONAL RAYS) ──
      // 1a. Ceiling Tile Dividers (Only 3 clean interior lines forming 4 wide ceiling tiles)
      ctx.lineWidth = 0.9;
      ctx.strokeStyle = 'rgba(192, 132, 252, 0.22)';
      const ceilCols = [0.25, 0.5, 0.75];
      for (const rx of ceilCols) {
        ctx.beginPath();
        ctx.moveTo(vpX, horizonY);
        ctx.lineTo(W * rx, 0);
        ctx.stroke();
      }

      // 1b. Wall Horizontal Shelf Dividers (1 upper line, 1 lower line per wall - NO diagonal ray fans)
      ctx.lineWidth = 0.9;
      ctx.strokeStyle = 'rgba(168, 85, 247, 0.20)';
      const wallTiers = [horizonY * 0.45, horizonY + (H - horizonY) * 0.52];
      for (const wy of wallTiers) {
        // Left wall shelf line
        ctx.beginPath();
        ctx.moveTo(vpX, horizonY);
        ctx.lineTo(0, wy);
        ctx.stroke();
        // Right wall shelf line
        ctx.beginPath();
        ctx.moveTo(vpX, horizonY);
        ctx.lineTo(W, wy);
        ctx.stroke();
      }

      // 1c. Floor Tile Dividers (Only 3 clean interior lines forming 4 wide, spacious floor tiles)
      // Strictly bounded within [0.25W, 0.75W] so NO diagonal lines ever crowd the corner beams
      ctx.lineWidth = 1.1;
      ctx.strokeStyle = 'rgba(192, 132, 252, 0.32)';
      const floorCols = [0.25, 0.5, 0.75];
      for (const rx of floorCols) {
        ctx.beginPath();
        ctx.moveTo(vpX, horizonY);
        ctx.lineTo(W * rx, H);
        ctx.stroke();
      }

      // 1d. Four Corner Seam Beams (The clean structural corners of the corridor)
      // Top corners (Ceiling/Wall boundary)
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(192, 132, 252, 0.55)';
      ctx.shadowColor = '#C084FC';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(vpX, horizonY);
      ctx.lineTo(0, 0);
      ctx.moveTo(vpX, horizonY);
      ctx.lineTo(W, 0);
      ctx.stroke();

      // Bottom corners (Floor/Wall boundary - clean single line to corners)
      ctx.strokeStyle = 'rgba(217, 70, 239, 0.65)';
      ctx.shadowColor = '#E879F9';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(vpX, horizonY);
      ctx.lineTo(0, H);
      ctx.moveTo(vpX, horizonY);
      ctx.lineTo(W, H);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // ── 2. MOVING CORRIDOR TILES (ALL 4 SURFACES AT A CALM, CONTROLLED WALKING PACE) ──
      const numTiles = 8; // Spacious, distinct tile proportions
      const speed = 0.00014; // Calm, steady walking speed (slowed down from 0.00022)
      const offset = ((now - startTime) * speed) % 1; // 0 to 1

      for (let i = 0; i < numTiles; i++) {
        const progress = (i + offset) / numTiles;
        if (progress <= 0.02 || progress >= 0.98) continue;

        // Exponential 3D perspective foreshortening
        const perspective = Math.pow(progress, 2.2);

        // Calculate corridor cross-section perimeter at this depth
        const xLeft = vpX * (1 - perspective);
        const xRight = vpX + (W - vpX) * perspective;
        const yTop = horizonY * (1 - perspective);
        const yBottom = horizonY + (H - horizonY) * perspective;

        // Sine envelope: smooth fade-in at vanishing point, fade-out near screen edges
        const alpha = Math.sin(progress * Math.PI) * 0.72;
        const strokeW = 0.85 + progress * 1.8;

        // 2a. CEILING TILE LINE (Horizontal segment across ceiling)
        ctx.lineWidth = strokeW;
        ctx.strokeStyle = `rgba(192, 132, 252, ${alpha * 0.65})`;
        ctx.shadowColor = '#C084FC';
        ctx.shadowBlur = progress * 5;
        ctx.beginPath();
        ctx.moveTo(xLeft, yTop);
        ctx.lineTo(xRight, yTop);
        ctx.stroke();

        // 2b. FLOOR TILE LINE (Horizontal segment across floor)
        ctx.strokeStyle = `rgba(217, 70, 239, ${alpha * 0.80})`;
        ctx.shadowColor = '#E879F9';
        ctx.shadowBlur = progress * 6;
        ctx.beginPath();
        ctx.moveTo(xLeft, yBottom);
        ctx.lineTo(xRight, yBottom);
        ctx.stroke();

        // 2c. LEFT WALL TILE LINE (Vertical segment down left wall)
        ctx.strokeStyle = `rgba(168, 85, 247, ${alpha * 0.70})`;
        ctx.shadowColor = '#A855F7';
        ctx.shadowBlur = progress * 5;
        ctx.beginPath();
        ctx.moveTo(xLeft, yTop);
        ctx.lineTo(xLeft, yBottom);
        ctx.stroke();

        // 2d. RIGHT WALL TILE LINE (Vertical segment down right wall)
        ctx.beginPath();
        ctx.moveTo(xRight, yTop);
        ctx.lineTo(xRight, yBottom);
        ctx.stroke();

        ctx.shadowBlur = 0;
      }

      // ── 3. HORIZON NEON BEAM (Subtle horizon line) ──
      ctx.strokeStyle = 'rgba(192, 132, 252, 0.60)';
      ctx.lineWidth = 1.4;
      ctx.shadowColor = '#C084FC';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(0, horizonY);
      ctx.lineTo(W, horizonY);
      ctx.stroke();
      ctx.shadowBlur = 0;

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }} />;
}

// ─── LIVE ANIMATED ARENA STADIUM BACKGROUND COMPONENT ────────────────────────
function ArenaStadiumBackground({ children }: { children: React.ReactNode }) {
  const spindleWaveBars = [6, 10, 14, 18, 24, 30, 36, 40, 44, 40, 36, 30, 24, 18, 14, 10, 6];

  return (
    <div
      className="min-h-screen w-full flex flex-col justify-between relative overflow-hidden select-none"
      style={{
        background: 'radial-gradient(ellipse at 50% 46%, #220738 0%, #130324 45%, #070012 100%)'
      }}
    >
      {/* ── 1. 3D MOVING PERSPECTIVE FLOOR & CLEAN SOLID CORRIDOR RAYS ── */}
      <MovingPerspectiveFloorGrid />

      {/* ── 2. LEFT MARGIN: FAITHFUL CYBER TELEMETRY & SOUNDWAVE MODULE (MATCHING INSPIRATION IMAGE 3) ── */}
      <CyberTelemetrySidebar />

      {/* ── 4. RIGHT MARGIN SOUNDWAVES & PIXEL MATH SYMBOLS ── */}
      <div className="absolute right-4 md:right-6 top-0 bottom-0 z-10 pointer-events-none hidden lg:flex flex-col justify-between py-6 select-none font-pixel-math text-2xl text-[#FFA057] items-center w-16">
        <div className="flex items-center gap-2">
          <span className="animate-border-symbol drop-shadow-[0_0_8px_rgba(255,160,87,0.8)]">√</span>
          <span className="animate-border-symbol drop-shadow-[0_0_8px_rgba(255,160,87,0.8)]" style={{ animationDelay: '0.4s' }}>∞</span>
        </div>
        <div className="flex flex-col items-center gap-2 my-auto">
          {spindleWaveBars.map((w, i) => (
            <div key={`rv-mid-${i}`} className="h-[2.5px] bg-gradient-to-r from-[#FF6B35] via-[#FF8C42] to-[#FFE066] rounded-full shadow-[0_0_6px_#FF8C42]" style={{ width: `${w * 0.75}px`, animation: `soundwave-v-spindle-fluctuate 1.0s ease-in-out infinite ${(i * 0.07).toFixed(2)}s` }} />
          ))}
          <span className="animate-border-symbol drop-shadow-[0_0_8px_rgba(255,160,87,0.8)] mt-2">π</span>
          <span className="animate-border-symbol drop-shadow-[0_0_8px_rgba(255,160,87,0.8)]" style={{ animationDelay: '0.8s' }}>∫</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="animate-border-symbol drop-shadow-[0_0_8px_rgba(255,160,87,0.8)]">π</span>
          <span className="animate-border-symbol drop-shadow-[0_0_8px_rgba(255,160,87,0.8)]" style={{ animationDelay: '0.6s' }}>√</span>
          <span className="animate-border-symbol drop-shadow-[0_0_8px_rgba(255,160,87,0.8)]" style={{ animationDelay: '1.2s' }}>∞</span>
        </div>
      </div>

      {/* Content wrapper */}
      <div className="relative z-20 w-full min-h-screen flex flex-col justify-between p-4 md:p-6 lg:p-8">
        {children}
      </div>
    </div>
  );
}

// ─── REUSABLE NOTCHED SCI-FI CYBER HUD PANEL (NO GAP AT TOP) ──────────────────
function HudPanel({
  title,
  icon,
  badge,
  children,
  className = '',
  borderColor = '#00F5D4',
  glowColor = 'rgba(0, 245, 212, 0.55)'
}: {
  title: string;
  icon?: string;
  badge?: string;
  children: React.ReactNode;
  className?: string;
  borderColor?: string;
  glowColor?: string;
}) {
  return (
    <div
      className={`relative bg-[#090018]/92 backdrop-blur-md rounded-xl p-5 select-none transition-all flex flex-col justify-start ${className}`}
      style={{
        border: `2px solid ${borderColor}`,
        boxShadow: `0 0 24px ${glowColor}, inset 0 0 16px rgba(0, 245, 212, 0.14)`
      }}
    >
      {/* Decorative Cyber Corner Brackets */}
      <div className="absolute -top-1.5 -left-1.5 w-3.5 h-3.5 border-t-2 border-l-2 border-[#00F5D4] pointer-events-none" />
      <div className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 border-t-2 border-r-2 border-[#00F5D4] pointer-events-none" />
      <div className="absolute -bottom-1.5 -left-1.5 w-3.5 h-3.5 border-b-2 border-l-2 border-[#00F5D4] pointer-events-none" />
      <div className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 border-b-2 border-r-2 border-[#00F5D4] pointer-events-none" />

      {/* Top Stepped Notch Cutout Tab */}
      <div className="absolute -top-3 left-6 px-3 py-0.5 bg-[#090018] border border-[#00F5D4] rounded text-[10px] font-mono text-[#00F5D4] tracking-[0.2em] uppercase shadow-[0_0_8px_#00F5D4]">
        SYS.SEC // ACTIVE
      </div>

      {/* Panel Header */}
      <div className="flex items-center justify-between gap-2 mb-2.5 border-b border-[#00F5D4]/25 pb-2 flex-shrink-0">
        <h3 className="font-arcade text-lg md:text-xl font-black text-[#FF55D2] tracking-wider uppercase drop-shadow-[0_0_10px_#FF55D2] flex items-center gap-2">
          <span>{title}</span>
          {icon && <span className="text-xl">{icon}</span>}
        </h3>
        {badge && (
          <span className="px-2.5 py-0.5 rounded text-[10px] font-mono font-black uppercase tracking-wider bg-[#FF007F]/25 border border-[#FF007F] text-[#FF55D2] shadow-[0_0_10px_#FF007F]">
            {badge}
          </span>
        )}
      </div>

      {/* Content — Starts immediately below header line, zero gap */}
      <div className="text-slate-100 text-sm md:text-[15px] font-medium leading-relaxed flex-1 flex flex-col justify-start">
        {children}
      </div>
    </div>
  );
}

// ─── 7. MECHANICS PRESENTATION (14 SCI-FI ARENA SLIDES) ───────────────────────
const MECHANICS_SLIDE_AUDIO_COUNTS: Record<number, number> = {
  1: 3,
  2: 3,
  3: 4,
  4: 4,
  5: 4,
  6: 4,
  7: 4,
  8: 5,
  9: 5,
  10: 4,
  11: 4,
  12: 4,
  13: 3,
  14: 2
};

function MechanicsScreen({
  slideNumber,
  onNext,
  onPrev,
  onFinish
}: {
  slideNumber: number;
  onNext: () => void;
  onPrev: () => void;
  onFinish: () => void;
}) {
  // Automatic Allison Voice Line Sequencer for Mechanics Presentation
  // Plays lines within the slide automatically one after another; stops when slide completes.
  const [currentLine, setCurrentLine] = useState(1);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // If preview mode (e.g. Admin iframe), do not play audio
    const isPreview = new URLSearchParams(window.location.search).get('preview') === '1';
    if (isPreview) return;

    let isMounted = true;
    const totalLinesForSlide = MECHANICS_SLIDE_AUDIO_COUNTS[slideNumber] || 0;

    const playLine = (lineIdx: number) => {
      if (!isMounted || lineIdx > totalLinesForSlide) {
        setIsSpeaking(false);
        return;
      }

      setCurrentLine(lineIdx);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }

      const audioUrl = `/audio/mechanics/slide_${slideNumber}/line_${lineIdx}.mp3`;
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      setIsSpeaking(true);

      audio.onended = () => {
        if (!isMounted) return;
        // Automatically play next line in the same slide!
        if (lineIdx < totalLinesForSlide) {
          setTimeout(() => {
            if (isMounted) playLine(lineIdx + 1);
          }, 350);
        } else {
          setIsSpeaking(false);
        }
      };

      audio.onerror = (e) => {
        console.warn(`Could not load audio for slide ${slideNumber} line ${lineIdx}:`, e);
        setIsSpeaking(false);
      };

      audio.play().catch(err => {
        console.warn('Auto-play blocked or audio interrupted:', err);
        setIsSpeaking(false);
      });
    };

    // When slideNumber changes, start from Line 1 automatically!
    playLine(1);

    return () => {
      isMounted = false;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
      }
      setIsSpeaking(false);
    };
  }, [slideNumber]);

  // Automatic auto-cycling for pattern visualizer (Slide 9)
  const [selectedPatternIndex, setSelectedPatternIndex] = useState(0);
  useEffect(() => {
    if (slideNumber === 9) {
      const timer = setInterval(() => {
        setSelectedPatternIndex(prev => (prev + 1) % 3);
      }, 2500);
      return () => clearInterval(timer);
    }
  }, [slideNumber]);

  // Keyboard Navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || (slideNumber === 14 && e.key === 'Enter')) {
        e.preventDefault();
        if (slideNumber < 14) onNext();
        else onFinish();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (slideNumber > 1) onPrev();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [slideNumber, onNext, onPrev, onFinish]);

  // Slides Data 1-14
  const slides: Record<number, {
    title: string;
    subtitle: string;
    boxLeftTop: { title: string; icon?: string; badge?: string; lines: string[] };
    boxLeftBottom: { title: string; icon?: string; badge?: string; lines: string[] };
    boxCenter: { title: string; icon?: string; badge?: string; lines: string[] };
    visualizerType: string;
  }> = {
    1: {
      title: 'WELCOME TO THE GRID',
      subtitle: 'AUTONOMOUS AI SPEED ARITHMETIC TOURNAMENT',
      boxLeftTop: {
        title: 'PLAYER REGISTRATION:',
        icon: '👤',
        lines: [
          '1. Scan dynamic arena QR code.',
          '2. Your name registers in Host Controller.'
        ]
      },
      boxLeftBottom: {
        title: 'SCORING PROTOCOL:',
        lines: [
          '• Straight Line, Special Pattern, Blackout.',
          '• Multiple winners possible in same draw.'
        ]
      },
      boxCenter: {
        title: 'PARTICIPATION NOTES:',
        lines: [
          '📄 Issue of official printed 5x5 card.',
          '📝 Card ID enters verification system.',
          '✏️ Blank scratch paper & pens allowed.',
          '🚫 Zero calculators or smart devices. 🖩'
        ]
      },
      visualizerType: 'qr_to_card'
    },
    2: {
      title: 'INSTANT QR ONBOARDING',
      subtitle: 'FAST PARTICIPANT ENTRY // ZERO INSTALLATION',
      boxLeftTop: {
        title: 'MOBILE CAMERA ENTRY:',
        icon: '📱',
        lines: [
          '1. Point smartphone camera at stage QR.',
          '2. Browser opens participant registration link.',
          '3. Zero app downloads or accounts needed.'
        ]
      },
      boxLeftBottom: {
        title: 'NAME SUBMISSION:',
        lines: [
          '• Input your official student or team name.',
          '• Tap "Join Tournament Grid".'
        ]
      },
      boxCenter: {
        title: 'LIVE ROSTER SYNC:',
        lines: [
          '🟢 Name pops up live on Host Controller.',
          '🟢 Network status indicates [ONLINE].',
          '🟢 Assigned official player seat number.',
          '🟢 Stow mobile device away after registering.'
        ]
      },
      visualizerType: 'roster_sync'
    },
    3: {
      title: 'CARDS & UNIQUE ID TAGS',
      subtitle: 'PHYSICAL 5X5 GRID WITH REAL-TIME VERIFICATION',
      boxLeftTop: {
        title: 'CARD DISTRIBUTION:',
        icon: '🎟️',
        lines: [
          '1. Every player receives an official 5×5 card.',
          '2. Card contains 24 distinct math answers.',
          '3. Center square is a universal FREE space.'
        ]
      },
      boxLeftBottom: {
        title: 'IDENTIFICATION TAG:',
        icon: '🏷️',
        badge: 'CRITICAL',
        lines: [
          '• Unique ID Tag in header: #CARD-XXXXXX.',
          '• Bound mathematically to your layout.'
        ]
      },
      boxCenter: {
        title: 'INSTANT AUDIT SYSTEM:',
        lines: [
          '⚡ When shouting BINGO, host enters your ID.',
          '⚡ System instantly audits your 24 numbers.',
          '⚡ Checks against exact drawn sequence.',
          '⚡ Verified within 0.2 seconds by the AI.'
        ]
      },
      visualizerType: 'card_id_tag'
    },
    4: {
      title: 'ACADEMIC INTEGRITY',
      subtitle: 'STRICT ARENA PROTOCOL // ARETE 2026 ETHICS',
      boxLeftTop: {
        title: 'SCRATCH PAPER ONLY:',
        icon: '✏️',
        lines: [
          '1. Bring ample blank physical scratch paper.',
          '2. Pencils and pens only for calculation.',
          '3. All mental arithmetic must be manual.'
        ]
      },
      boxLeftBottom: {
        title: 'DEVICE PROHIBITION:',
        icon: '🚫',
        badge: 'ZERO TOLERANCE',
        lines: [
          '• Strictly NO phones or smartwatches.',
          '• Phones must be stowed away after QR scan.'
        ]
      },
      boxCenter: {
        title: 'STRICT DISQUALIFICATION:',
        lines: [
          '⛔ ANY calculator usage = IMMEDIATE DQ.',
          '⛔ External assistance = Score wipeout.',
          '⛔ ARETE 2026 Code of Ethics strictly enforced.',
          '⛔ Transparent sportsmanship and fair play.'
        ]
      },
      visualizerType: 'integrity_rules'
    },
    5: {
      title: '5X5 CARD ANATOMY',
      subtitle: 'STANDARD 75-BALL COLUMN PARTITIONS',
      boxLeftTop: {
        title: 'COLUMNS B & I:',
        icon: '🔢',
        lines: [
          '• Column B: Numbers 1 through 15.',
          '• Column I: Numbers 16 through 30.'
        ]
      },
      boxLeftBottom: {
        title: 'COLUMNS G & O:',
        lines: [
          '• Column G: Numbers 46 through 60.',
          '• Column O: Numbers 61 through 75.'
        ]
      },
      boxCenter: {
        title: 'COLUMN N & FREE SPACE:',
        icon: '⭐',
        badge: 'FREE SPACE',
        lines: [
          '• Column N: Numbers 31 through 45.',
          '• Center (Row 3, Col 3) is ALWAYS FREE.',
          '• Counts automatically toward all patterns.',
          '• Mark your FREE center space immediately!'
        ]
      },
      visualizerType: 'card_columns'
    },
    6: {
      title: 'ARITHMETIC PROGRESSION',
      subtitle: '3 ROUNDS OF ESCALATING MATHEMATICAL RIGOR',
      boxLeftTop: {
        title: 'ROUND 1 (EASY):',
        icon: '📈',
        lines: [
          '• Round 1: 2 terms, +, -, *, /, integers ≤ 3 digits.',
          '• Includes negative numbers & sign rules.'
        ]
      },
      boxLeftBottom: {
        title: 'ROUND 2 (MEDIUM - PEMDAS):',
        lines: [
          '• 2–3 terms with parentheses & strict order.',
          '• Example: (12 × 4) - (18 ÷ 3) = 42.'
        ]
      },
      boxCenter: {
        title: 'ROUND 3 (DIFFICULT):',
        icon: '🔥',
        badge: 'CHAMPIONSHIP',
        lines: [
          '• Percentage equations (X% of Y).',
          '• Decimals & division remainders.',
          '• Highest point multipliers of the tournament.'
        ]
      },
      visualizerType: 'progression_tiers'
    },
    7: {
      title: 'DYNAMIC SPEED TIMERS',
      subtitle: 'REACTION WINDOWS PER EQUATION',
      boxLeftTop: {
        title: 'REACTION WINDOWS:',
        icon: '⏱️',
        lines: [
          '• Round 1 (Easy): 10 Seconds per Problem.',
          '• Round 2 (Medium): 15 Seconds per Problem.',
          '• Round 3 (Difficult): 20 Seconds per Problem.'
        ]
      },
      boxLeftBottom: {
        title: 'ZERO-TIME ADVANCE:',
        lines: [
          '• Timer strikes 0 -> AI immediately advances!',
          '• Missed problems cannot be re-called.'
        ]
      },
      boxCenter: {
        title: 'SPEED DISCIPLINE:',
        icon: '⚡',
        lines: [
          '🔔 Listen to the audio chime prompt.',
          '🔔 Solve, find, and mark card before expiry.',
          '🔔 Watch countdown color: Cyan -> Orange -> Pink.',
          '🔔 Sharp focus separates winners from rest.'
        ]
      },
      visualizerType: 'countdown_dial'
    },
    8: {
      title: '3 WINNING PHASES',
      subtitle: 'PROGRESSIVE VICTORY TIERS IN EVERY ROUND',
      boxLeftTop: {
        title: 'PHASE 1: STRAIGHT LINE',
        icon: '🥇',
        lines: [
          '• Any 5-in-a-row completed.',
          '• Horizontal row, vertical column, or diagonal.',
          '• Opens round scoring (+100 to +250 pts).'
        ]
      },
      boxLeftBottom: {
        title: 'PHASE 2: PATTERN',
        icon: '🥈',
        lines: [
          '• Target assigned geometric shape.',
          '• Round 1: X | Round 2: Frame | Round 3: Diamond.'
        ]
      },
      boxCenter: {
        title: 'PHASE 3: BLACKOUT',
        icon: '👑',
        badge: 'GRAND SLAM',
        lines: [
          '• Complete coverall: All 24 squares filled!',
          '• Highest score tier (+500 to +1,000 pts).',
          '• Rounds do NOT reset between phases!',
          '• Drawn numbers carry forward seamlessly.'
        ]
      },
      visualizerType: 'phases_progression'
    },
    9: {
      title: 'SPECIAL PATTERNS GUIDE',
      subtitle: 'PHASE 2 GEOMETRIC CARD FORMATIONS',
      boxLeftTop: {
        title: 'ROUND 1: THE "X"',
        icon: '🔷',
        lines: [
          '• Both diagonals crossing center FREE space.',
          '• Forms a full diagonal cross across card.'
        ]
      },
      boxLeftBottom: {
        title: 'ROUND 2: PICTURE FRAME',
        lines: [
          '• All 16 outer perimeter squares.',
          '• Forms a complete outer border frame.'
        ]
      },
      boxCenter: {
        title: 'ROUND 3: SOLID DIAMOND',
        icon: '💎',
        lines: [
          '• Complete 13-square solid diamond.',
          '• Assigned before each round on stage HUD.',
          '• Patterns display automatically on stage.',
          '• FREE space helps form center of diamond.'
        ]
      },
      visualizerType: 'pattern_selector'
    },
    10: {
      title: 'CLAIMING & SIMULTANEOUS WINS',
      subtitle: 'STRICT DRAW-SYNCHRONIZATION RULES',
      boxLeftTop: {
        title: 'SHOUT "BINGO!" LOUDLY:',
        icon: '🗣️',
        lines: [
          '1. Shout "BINGO!" instantly upon solving.',
          '2. Stand up immediately so host spots you.',
          '3. Game pauses for automated audit.'
        ]
      },
      boxLeftBottom: {
        title: 'SIMULTANEOUS WINNERS:',
        badge: 'SAME DRAW',
        lines: [
          '• Multiple players CAN win simultaneously!',
          '• Must claim during the EXACT SAME DRAW.'
        ]
      },
      boxCenter: {
        title: 'LATE CLAIM FORFEIT:',
        icon: '⚠️',
        lines: [
          '❌ If host resumes draw, late claims are VOID.',
          '❌ Must wait until the next available phase.',
          '❌ Do not hesitate when your pattern hits!',
          '❌ All valid simultaneous claims share points.'
        ]
      },
      visualizerType: 'simultaneous_draw'
    },
    11: {
      title: 'CHAMPIONSHIP SCORING',
      subtitle: 'CUMULATIVE 3-ROUND PODIUM LEADERBOARD',
      boxLeftTop: {
        title: 'PHASE POINT TIERS:',
        icon: '📊',
        lines: [
          '• Phase 1 (Straight Line): +100 to +250 Pts.',
          '• Phase 2 (Special Pattern): +200 to +400 Pts.',
          '• Phase 3 (Blackout): +500 to +1,000 Pts.'
        ]
      },
      boxLeftBottom: {
        title: 'MATH ERROR BONUS:',
        icon: '⚡',
        lines: [
          '• Math Error: +50 Pts (R1), +50 each round.',
          '• Live 3D podium updates after each round.'
        ]
      },
      boxCenter: {
        title: 'GRAND AWARDS:',
        icon: '🏆',
        badge: 'TROPHIES',
        lines: [
          '🥇 1st Place: MathFest 2026 Grand Champion.',
          '🥈 2nd Place: Mathematical Excellence Cup.',
          '🥉 3rd Place: Precision Arithmetic Medal.',
          '📜 Official institutional certificates for all.'
        ]
      },
      visualizerType: 'podium_scores'
    },
    12: {
      title: 'MATH ERROR TRAPS',
      subtitle: 'CATCH AI GLITCHES // +50 TO +150 PTS & TACTICAL POWERS',
      boxLeftTop: {
        title: 'INTENTIONAL AI GLITCHES:',
        icon: '⚠️',
        lines: [
          '1. The AI host injects intentional math errors!',
          '2. Incorrect equations or out-of-bounds answers (<1 or >75).',
          '3. Listen closely to spoken arithmetic.'
        ]
      },
      boxLeftBottom: {
        title: 'CALL "MATH ERROR!":',
        icon: '🚨',
        lines: [
          '• Stand up and shout "MATH ERROR!".',
          '• First player halts draw for investigation.'
        ]
      },
      boxCenter: {
        title: 'REWARDS & PENALTIES:',
        icon: '⚖️',
        badge: 'RISK / REWARD',
        lines: [
          '⚡ VALID CATCH: +50 PTS (R1) & 1 Tactical Power!',
          '⚡ SCALING BONUS: +50 PTS each round:',
          '   • R1: 50 | R2: 100 | R3: 150',
          '⛔ FALSE CLAIM: Deducts -100 Tournament Points!',
          '⛔ Do not guess — verify your mental arithmetic.'
        ]
      },
      visualizerType: 'math_error_trap'
    },
    13: {
      title: 'TACTICAL POWERS BANK',
      subtitle: '5 GAME-ALTERING QUANTUM OVERRIDES',
      boxLeftTop: {
        title: 'HOW TO UNLOCK:',
        icon: '🔓',
        lines: [
          '1. Catch an intentional AI Math Error.',
          '2. Awarded +50 to +150 Points instantly!',
          '3. Host confirms glitch & unlocks power.'
        ]
      },
      boxLeftBottom: {
        title: 'DEPLOYMENT STRATEGY:',
        lines: [
          '• Tactical powers cannot be saved—must be used immediately upon calling a Math Error.',
          '• Once a tactical power is used by someone, it cannot be used again.'
        ]
      },
      boxCenter: {
        title: 'THE 5 TACTICAL POWERS:',
        icon: '⚡',
        badge: 'QUANTUM BANK',
        lines: [
          '🎯 Steal the Number: Roulette steals opponent answer.',
          '🧹 Memory Wipe: Sweep away previously drawn target.',
          '🎟️ Extra Ticket: Issue a 2nd active card in play.',
          '⚡ Double Points: 2x score multiplier on your win.',
          '📡 Dual Call: AI broadcasts 2 equations in parallel.'
        ]
      },
      visualizerType: 'powers_bank'
    }
  };

  const current = slides[slideNumber] || slides[1];

  return (
    <ArenaStadiumBackground>
      {/* ── TOP HEADER: TOURNAMENT TAG & CHROME SLIDE TITLE ── */}
      <div className="relative z-10 flex flex-col items-center text-center max-w-5xl mx-auto w-full pt-1">
        <div className="font-arcade text-[#00F5D4] text-xs md:text-sm font-black uppercase tracking-[0.32em] drop-shadow-[0_0_12px_#00F5D4] mb-1">
          MATHFEST 2026: AI SPEED BINGO
        </div>

        {/* 3D Chrome Slide Heading */}
        <div className="w-full flex justify-center items-center">
          <svg viewBox="0 0 1000 76" className="w-full max-w-4xl h-12 md:h-16 overflow-visible select-none">
            <defs>
              <linearGradient id="slideDualChromeGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#7DD3FC" />
                <stop offset="38%" stopColor="#0284C7" />
                <stop offset="48%" stopColor="#0F172A" />
                <stop offset="52%" stopColor="#831843" />
                <stop offset="74%" stopColor="#FF007F" />
                <stop offset="100%" stopColor="#FF55D2" />
              </linearGradient>

              <filter id="slideTitleSoftGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#00F5D4" floodOpacity="0.4" />
                <feDropShadow dx="0" dy="0" stdDeviation="8" floodColor="#FF007F" floodOpacity="0.3" />
              </filter>
            </defs>

            {/* 3D Extrusion Shadow (Angled down-right in deep dark indigo for massive contrast) */}
            <text
              x="503"
              y="59"
              textAnchor="middle"
              style={{
                fontFamily: "'Boogaloo', 'Audiowide', sans-serif",
                fontWeight: 900,
                fontSize: '56px',
                letterSpacing: '3px'
              }}
              fill="#080016"
              stroke="#080016"
              strokeWidth="6"
              strokeLinejoin="round"
            >
              {slideNumber === 14 ? 'ARENA LAUNCH PROTOCOL' : current.title}
            </text>

            {/* Outer Soft Cyan/Pink Rim */}
            <text
              x="500"
              y="56"
              textAnchor="middle"
              style={{
                fontFamily: "'Boogaloo', 'Audiowide', sans-serif",
                fontWeight: 900,
                fontSize: '56px',
                letterSpacing: '3px'
              }}
              fill="none"
              stroke="#00E5FF"
              strokeWidth="3.5"
              strokeLinejoin="round"
              filter="url(#slideTitleSoftGlow)"
            >
              {slideNumber === 14 ? 'ARENA LAUNCH PROTOCOL' : current.title}
            </text>

            {/* Crisp Dark Contour Line for Maximum Readability */}
            <text
              x="500"
              y="56"
              textAnchor="middle"
              style={{
                fontFamily: "'Boogaloo', 'Audiowide', sans-serif",
                fontWeight: 900,
                fontSize: '56px',
                letterSpacing: '3px'
              }}
              fill="none"
              stroke="#090018"
              strokeWidth="1.8"
              strokeLinejoin="round"
            >
              {slideNumber === 14 ? 'ARENA LAUNCH PROTOCOL' : current.title}
            </text>

            {/* Dual-Tone Synthwave Chrome Fill (Cyan top -> Hot Magenta bottom) */}
            <text
              x="500"
              y="56"
              textAnchor="middle"
              style={{
                fontFamily: "'Boogaloo', 'Audiowide', sans-serif",
                fontWeight: 900,
                fontSize: '56px',
                letterSpacing: '3px'
              }}
              fill="url(#slideDualChromeGradient)"
            >
              {slideNumber === 14 ? 'ARENA LAUNCH PROTOCOL' : current.title}
            </text>
          </svg>
        </div>

        {/* Subtitle in Neon Pink */}
        <div className="font-arcade text-[#FF55D2] text-[11px] md:text-xs font-bold tracking-[0.28em] uppercase drop-shadow-[0_0_8px_#FF55D2] -mt-1">
          {slideNumber === 14 ? 'ALL SYSTEMS PRIMED · COMMENCE COMPETITION' : current.subtitle}
        </div>
      </div>

      {/* ── CENTER CONTENT ── */}
      {slideNumber === 14 ? (
        /* ══════════════════════════════════════════════════════════════════════
           SLIDE 14: DEDICATED MASTER ARENA LAUNCH CONSOLE (UNIQUE DESIGN)
           ══════════════════════════════════════════════════════════════════════ */
        <div className="relative z-10 max-w-4xl mx-auto w-full flex flex-col items-center justify-center my-auto py-2">
          <div
            className="relative w-full bg-[#090018]/92 backdrop-blur-md rounded-2xl p-6 md:p-8 flex flex-col items-center text-center shadow-[0_0_50px_rgba(0,245,212,0.45),inset_0_0_30px_rgba(0,245,212,0.12)]"
            style={{ border: '2px solid #00F5D4' }}
          >
            {/* Corner Cyber Brackets */}
            <div className="absolute -top-1.5 -left-1.5 w-4 h-4 border-t-3 border-l-3 border-[#00F5D4]" />
            <div className="absolute -top-1.5 -right-1.5 w-4 h-4 border-t-3 border-r-3 border-[#00F5D4]" />
            <div className="absolute -bottom-1.5 -left-1.5 w-4 h-4 border-b-3 border-l-3 border-[#00F5D4]" />
            <div className="absolute -bottom-1.5 -right-1.5 w-4 h-4 border-b-3 border-r-3 border-[#00F5D4]" />

            {/* Top Cutout Tab */}
            <div className="absolute -top-3.5 left-10 px-4 py-0.5 bg-[#090018] border border-[#00F5D4] rounded text-xs font-mono text-[#00F5D4] tracking-[0.25em] uppercase shadow-[0_0_10px_#00F5D4]">
              MASTER LAUNCH COMMAND // READY
            </div>

            {/* Header Badge */}
            <div className="inline-flex items-center gap-2 px-6 py-1.5 bg-[#14052E] border border-[#00F5D4] rounded-full text-[#00F5D4] font-arcade text-xs tracking-[0.3em] uppercase shadow-[0_0_15px_rgba(0,245,212,0.6)] mb-3">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span>TOURNAMENT ENGINE INITIALIZED</span>
            </div>

            <p className="text-slate-200 font-medium text-sm md:text-base max-w-xl mb-4 leading-relaxed">
              Cards verified · Scratchpads staged · Zero devices active · Ready for Round 1 speed arithmetic.
            </p>

            {/* ══ GIANT MASTER LAUNCH BUTTON (CENTERPIECE) ══ */}
            <button
              onClick={onFinish}
              className="group relative cursor-pointer my-2 transition-all duration-300 hover:scale-105 active:scale-95"
            >
              {/* Pulsing Outer Neon Aura */}
              <div className="absolute -inset-3 rounded-3xl bg-gradient-to-r from-[#00F5D4] via-[#FF007F] to-[#FFE066] opacity-75 blur-xl group-hover:opacity-100 transition-opacity duration-300 animate-pulse" />

              {/* Master Core */}
              <div className="relative px-12 md:px-20 py-5 md:py-6 rounded-2xl border-3 border-white bg-gradient-to-r from-[#00F5D4] via-[#FF007F] to-[#FF6B35] shadow-[0_0_50px_rgba(0,245,212,0.9)] flex items-center justify-center gap-4">
                <Play className="w-8 h-8 fill-white text-white animate-bounce" />
                <span className="font-arcade text-2xl md:text-3xl font-black text-white uppercase tracking-[0.28em] drop-shadow-[0_0_15px_rgba(0,0,0,0.8)]">
                  LAUNCH ARENA NOW
                </span>
              </div>
            </button>

            {/* 4 Illuminated Readiness Badges */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full mt-6 text-left font-mono text-xs">
              <div className="p-3 rounded-lg bg-[#14052E]/90 border border-emerald-500 text-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.25)]">
                <div className="text-[10px] text-slate-400">CARDS &amp; ID TAGS</div>
                <div className="font-bold mt-0.5">✓ 5×5 CARDS ACTIVE</div>
              </div>
              <div className="p-3 rounded-lg bg-[#14052E]/90 border border-emerald-500 text-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.25)]">
                <div className="text-[10px] text-slate-400">ARENA INTEGRITY</div>
                <div className="font-bold mt-0.5">✓ ZERO CALCULATORS</div>
              </div>
              <div className="p-3 rounded-lg bg-[#14052E]/90 border border-emerald-500 text-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.25)]">
                <div className="text-[10px] text-slate-400">AUDIO ENGINE</div>
                <div className="font-bold mt-0.5">✓ AI VOICE READY</div>
              </div>
              <div className="p-3 rounded-lg bg-[#14052E]/90 border border-emerald-500 text-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.25)]">
                <div className="text-[10px] text-slate-400">ROUND 1 DIFFICULTY</div>
                <div className="font-bold mt-0.5">✓ EQUATIONS PRIMED</div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ══════════════════════════════════════════════════════════════════════
           SLIDES 1-13: 3-COLUMN NOTCHED HUD GRID (NO GAP IN CENTER BOX)
           ══════════════════════════════════════════════════════════════════════ */
        <div className="relative z-10 max-w-6xl mx-auto w-full my-auto py-2">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
            {/* Column 1: Left Stacked Boxes (4 cols on lg) */}
            <div className="lg:col-span-4 flex flex-col gap-4 justify-between">
              <HudPanel
                title={current.boxLeftTop.title}
                icon={current.boxLeftTop.icon}
                badge={current.boxLeftTop.badge}
                className="flex-1"
              >
                <ul className="space-y-2 mt-1">
                  {current.boxLeftTop.lines.map((line, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-[#00F5D4] font-mono font-bold mt-0.5">›</span>
                      <span className="text-slate-100 font-medium">{line}</span>
                    </li>
                  ))}
                </ul>
              </HudPanel>

              <HudPanel
                title={current.boxLeftBottom.title}
                icon={current.boxLeftBottom.icon}
                badge={current.boxLeftBottom.badge}
                className="flex-1"
              >
                <ul className="space-y-1.5 mt-1">
                  {current.boxLeftBottom.lines.map((line, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-[#FF55D2] font-mono font-bold mt-0.5">›</span>
                      <span className="text-slate-100 font-medium">{line}</span>
                    </li>
                  ))}
                </ul>
              </HudPanel>
            </div>

            {/* Column 2: Center Box (4 cols on lg) — NO GAP AT TOP */}
            <div className="lg:col-span-4 flex flex-col">
              <HudPanel
                title={current.boxCenter.title}
                icon={current.boxCenter.icon}
                badge={current.boxCenter.badge}
                className="h-full"
              >
                {/* Items start immediately below header with neat spacing */}
                <div className="flex flex-col gap-2.5 mt-1">
                  {current.boxCenter.lines.map((line, idx) => (
                    <div key={idx} className="flex items-start gap-2.5 p-2 rounded-lg bg-[#14052E]/70 border border-[#00F5D4]/20">
                      <span className="text-amber-300 font-bold mt-0.5">▪</span>
                      <span className="text-slate-100 font-medium leading-relaxed">{line}</span>
                    </div>
                  ))}
                </div>
              </HudPanel>
            </div>

            {/* Column 3: Right Visualizer Schematic (4 cols on lg) */}
            <div className="lg:col-span-4 flex flex-col">
              <div className="relative bg-[#090018]/92 backdrop-blur-md rounded-xl p-4 h-full border-2 border-[#00F5D4] shadow-[0_0_24px_rgba(0,245,212,0.45),inset_0_0_16px_rgba(0,245,212,0.12)] flex flex-col items-center justify-center select-none overflow-hidden">
                {/* Decorative Cyber Brackets */}
                <div className="absolute -top-1.5 -left-1.5 w-3.5 h-3.5 border-t-2 border-l-2 border-[#00F5D4] pointer-events-none" />
                <div className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 border-t-2 border-r-2 border-[#00F5D4] pointer-events-none" />
                <div className="absolute -bottom-1.5 -left-1.5 w-3.5 h-3.5 border-b-2 border-l-2 border-[#00F5D4] pointer-events-none" />
                <div className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 border-b-2 border-r-2 border-[#00F5D4] pointer-events-none" />

                {/* ── VISUALIZER TYPE 1: PHONE QR TO BINGO CARD (SLIDE 1 MATCH) ── */}
                {current.visualizerType === 'qr_to_card' && (
                  <div className="w-full flex flex-col items-center justify-center py-2">
                    <div className="flex items-center justify-center gap-3 w-full">
                      {/* Holographic Phone with QR Code */}
                      <div className="flex flex-col items-center">
                        <div className="w-24 h-44 rounded-2xl border-2 border-[#00F5D4] bg-[#0A001F] shadow-[0_0_20px_rgba(0,245,212,0.8)] relative p-2 flex flex-col items-center justify-between">
                          <div className="w-6 h-1 bg-[#00F5D4]/70 rounded-full" />
                          <div className="w-20 h-20 bg-white p-1 rounded-md relative overflow-hidden shadow-inner">
                            <svg viewBox="0 0 29 29" className="w-full h-full text-[#090014]">
                              <rect x="0" y="0" width="7" height="7" fill="currentColor" />
                              <rect x="1" y="1" width="5" height="5" fill="#fff" />
                              <rect x="2" y="2" width="3" height="3" fill="currentColor" />
                              <rect x="22" y="0" width="7" height="7" fill="currentColor" />
                              <rect x="23" y="1" width="5" height="5" fill="#fff" />
                              <rect x="24" y="2" width="3" height="3" fill="currentColor" />
                              <rect x="0" y="22" width="7" height="7" fill="currentColor" />
                              <rect x="1" y="23" width="5" height="5" fill="#fff" />
                              <rect x="2" y="24" width="3" height="3" fill="currentColor" />
                              <rect x="8" y="2" width="2" height="2" fill="currentColor" />
                              <rect x="12" y="2" width="2" height="2" fill="currentColor" />
                              <rect x="16" y="2" width="2" height="2" fill="currentColor" />
                              <rect x="9" y="8" width="3" height="3" fill="currentColor" />
                              <rect x="14" y="9" width="4" height="2" fill="currentColor" />
                              <rect x="10" y="14" width="2" height="4" fill="currentColor" />
                              <rect x="15" y="15" width="3" height="3" fill="currentColor" />
                              <rect x="20" y="11" width="3" height="2" fill="currentColor" />
                              <rect x="22" y="15" width="2" height="3" fill="currentColor" />
                              <rect x="10" y="22" width="4" height="2" fill="currentColor" />
                              <rect x="18" y="22" width="3" height="3" fill="currentColor" />
                            </svg>
                            <div className="absolute inset-x-0 h-0.5 bg-[#00F5D4] shadow-[0_0_8px_#00F5D4] animate-qr-laser" />
                          </div>
                          <div className="w-3.5 h-3.5 rounded-full border border-[#00F5D4]/70" />
                        </div>
                        <span className="font-telemetry text-[9px] text-[#00F5D4] font-bold tracking-wider mt-2 uppercase">
                          SCAN QR TO REGISTER
                        </span>
                      </div>

                      <div className="text-[#00F5D4] text-3xl font-black animate-pulse drop-shadow-[0_0_12px_#00F5D4]">
                        ➔
                      </div>

                      {/* BINGO Matrix 5x5 Card */}
                      <div className="flex flex-col items-center">
                        <div className="w-36 rounded-lg border-2 border-[#00F5D4] bg-[#0A001F] shadow-[0_0_20px_rgba(0,245,212,0.8)] p-1.5">
                          <div className="grid grid-cols-5 gap-0.5 text-center font-arcade text-[10px] font-black text-[#00F5D4] border-b border-[#00F5D4]/40 pb-1 mb-1">
                            <span>B</span><span>I</span><span>N</span><span>G</span><span>O</span>
                          </div>
                          <div className="grid grid-cols-5 gap-1 text-center font-mono text-[9px] text-white">
                            <span className="bg-[#190435] py-0.5 rounded">5</span>
                            <span className="bg-[#190435] py-0.5 rounded">24</span>
                            <span className="bg-[#190435] py-0.5 rounded">45</span>
                            <span className="bg-[#190435] py-0.5 rounded">49</span>
                            <span className="bg-[#190435] py-0.5 rounded">72</span>

                            <span className="bg-[#190435] py-0.5 rounded">5</span>
                            <span className="bg-[#190435] py-0.5 rounded">20</span>
                            <span className="bg-[#190435] py-0.5 rounded">43</span>
                            <span className="bg-[#190435] py-0.5 rounded">48</span>
                            <span className="bg-[#190435] py-0.5 rounded">65</span>

                            <span className="bg-[#190435] py-0.5 rounded">11</span>
                            <span className="bg-[#190435] py-0.5 rounded">27</span>
                            <span className="bg-[#FF007F]/40 text-[#00F5D4] font-black py-0.5 rounded border border-[#00F5D4]">★</span>
                            <span className="bg-[#190435] py-0.5 rounded">55</span>
                            <span className="bg-[#190435] py-0.5 rounded">66</span>

                            <span className="bg-[#190435] py-0.5 rounded">5</span>
                            <span className="bg-[#190435] py-0.5 rounded">20</span>
                            <span className="bg-[#190435] py-0.5 rounded">33</span>
                            <span className="bg-[#190435] py-0.5 rounded">53</span>
                            <span className="bg-[#190435] py-0.5 rounded">75</span>
                          </div>
                          <div className="mt-1 text-center text-[8px] font-mono text-[#FFE066] border-t border-[#00F5D4]/30 pt-0.5">
                            ID: #CARD-849201
                          </div>
                        </div>
                        <span className="font-telemetry text-[9px] text-[#00F5D4] font-bold tracking-wider mt-2 uppercase">
                          BINGO MATRIX &amp; CARD ID
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── VISUALIZER TYPE 2: LIVE ROSTER SIMULATOR ── */}
                {current.visualizerType === 'roster_sync' && (
                  <div className="w-full flex flex-col items-center text-center p-2">
                    <div className="w-full bg-[#050012] border border-[#00F5D4] rounded-lg p-3 text-left font-mono text-xs shadow-[0_0_15px_rgba(0,245,212,0.4)]">
                      <div className="text-[#00F5D4] font-bold border-b border-[#00F5D4]/40 pb-1 mb-2 flex justify-between">
                        <span>HOST ROSTER TERMINAL</span>
                        <span className="animate-pulse">● LIVE</span>
                      </div>
                      <div className="space-y-1.5 text-[11px]">
                        <div className="text-emerald-400">✓ [ONLINE] Sarah Jenkins (#041)</div>
                        <div className="text-emerald-400">✓ [ONLINE] Marcus Thorne (#042)</div>
                        <div className="text-emerald-400">✓ [ONLINE] Elena Rostova (#043)</div>
                        <div className="text-cyan-300 animate-pulse">› [SYNCING] Team Archimedes...</div>
                      </div>
                    </div>
                    <span className="font-telemetry text-[10px] text-[#00F5D4] font-bold tracking-wider mt-3 uppercase">
                      AUTONOMOUS ROSTER SYNCHRONIZATION
                    </span>
                  </div>
                )}

                {/* ── VISUALIZER TYPE 3: CARD & ID TAG VERIFICATION ── */}
                {current.visualizerType === 'card_id_tag' && (
                  <div className="w-full flex flex-col items-center text-center p-2">
                    <div className="p-3 bg-[#0A001F] border-2 border-[#FFE066] rounded-xl shadow-[0_0_25px_rgba(255,224,102,0.6)] w-56">
                      <div className="flex justify-between items-center text-[10px] font-mono font-bold text-[#FFE066] border-b border-[#FFE066]/40 pb-1 mb-2">
                        <span>OFFICIAL CARD</span>
                        <span className="bg-[#FFE066]/20 px-2 py-0.5 rounded">VERIFIED</span>
                      </div>
                      <div className="text-xl font-mono font-black text-white tracking-widest my-1 drop-shadow-[0_0_8px_#FFE066]">
                        #CARD-849201
                      </div>
                      <div className="h-6 flex items-center justify-center gap-1 my-2 opacity-85">
                        {Array.from({ length: 28 }).map((_, i) => (
                          <div
                            key={i}
                            className="h-full bg-white"
                            style={{ width: i % 3 === 0 ? '3px' : i % 2 === 0 ? '1.5px' : '2px' }}
                          />
                        ))}
                      </div>
                      <div className="text-[9px] font-mono text-[#00F5D4]">
                        CRYPTOGRAPHICALLY BOUND TO 24 ANSWERS
                      </div>
                    </div>
                    <span className="font-telemetry text-[10px] text-[#FFE066] font-bold tracking-wider mt-3 uppercase">
                      UNIQUE CARD ID TAG FOR SUB-SECOND AUDIT
                    </span>
                  </div>
                )}

                {/* ── VISUALIZER TYPE 4: ACADEMIC INTEGRITY ── */}
                {current.visualizerType === 'integrity_rules' && (
                  <div className="w-full flex flex-col items-center text-center p-2">
                    <div className="flex items-center gap-6 my-2">
                      <div className="flex flex-col items-center">
                        <div className="w-16 h-16 rounded-full border-2 border-emerald-400 bg-emerald-950/40 flex items-center justify-center text-2xl shadow-[0_0_15px_#34D399]">
                          ✏️
                        </div>
                        <span className="font-mono text-[10px] text-emerald-400 font-bold mt-1">ALLOWED</span>
                      </div>
                      <div className="text-[#FF007F] text-2xl font-black">VS</div>
                      <div className="flex flex-col items-center">
                        <div className="w-16 h-16 rounded-full border-2 border-[#FF007F] bg-rose-950/40 flex items-center justify-center text-2xl shadow-[0_0_20px_#FF007F] animate-pulse">
                          🚫
                        </div>
                        <span className="font-mono text-[10px] text-[#FF007F] font-bold mt-1">PROHIBITED</span>
                      </div>
                    </div>
                    <div className="px-3 py-1.5 bg-[#FF007F]/20 border border-[#FF007F] rounded text-[11px] font-mono font-black text-[#FF55D2] mt-2">
                      CALCULATORS &amp; PHONES = INSTANT DISQUALIFICATION
                    </div>
                  </div>
                )}

                {/* ── VISUALIZER TYPE 5: 5X5 CARD COLUMNS ── */}
                {current.visualizerType === 'card_columns' && (
                  <div className="w-full flex flex-col items-center text-center p-2">
                    <div className="grid grid-cols-5 gap-1.5 w-full max-w-xs font-mono text-center">
                      <div className="p-2 rounded bg-amber-500/20 border border-amber-500">
                        <div className="text-xs font-black text-amber-400">B</div>
                        <div className="text-[9px] text-slate-300">1–15</div>
                      </div>
                      <div className="p-2 rounded bg-pink-500/20 border border-pink-500">
                        <div className="text-xs font-black text-pink-400">I</div>
                        <div className="text-[9px] text-slate-300">16–30</div>
                      </div>
                      <div className="p-2 rounded bg-cyan-500/20 border border-cyan-400 shadow-[0_0_10px_#00F5D4]">
                        <div className="text-xs font-black text-cyan-300">N</div>
                        <div className="text-[9px] text-cyan-200">FREE ★</div>
                      </div>
                      <div className="p-2 rounded bg-purple-500/20 border border-purple-500">
                        <div className="text-xs font-black text-purple-400">G</div>
                        <div className="text-[9px] text-slate-300">46–60</div>
                      </div>
                      <div className="p-2 rounded bg-rose-500/20 border border-rose-500">
                        <div className="text-xs font-black text-rose-400">O</div>
                        <div className="text-[9px] text-slate-300">61–75</div>
                      </div>
                    </div>
                    <span className="font-telemetry text-[10px] text-[#00F5D4] font-bold tracking-wider mt-3 uppercase">
                      COLUMN NUMBER PARTITIONING
                    </span>
                  </div>
                )}

                {/* ── VISUALIZER TYPE 6: ARITHMETIC PROGRESSION ── */}
                {current.visualizerType === 'progression_tiers' && (
                  <div className="w-full flex flex-col items-center p-2 font-mono text-xs space-y-2 text-left">
                    <div className="w-full p-2 rounded bg-emerald-950/40 border border-emerald-500 text-emerald-300 flex justify-between">
                      <span>R1 (Easy): Negatives</span>
                      <span className="font-bold">15 - (-8) = 23</span>
                    </div>
                    <div className="w-full p-2 rounded bg-cyan-950/40 border border-cyan-500 text-cyan-300 flex justify-between">
                      <span>R2 (Medium): PEMDAS</span>
                      <span className="font-bold">(6×8) - (12÷3) = 44</span>
                    </div>
                    <div className="w-full p-2 rounded bg-purple-950/40 border border-purple-500 text-purple-300 flex justify-between">
                      <span>R3 (Difficult): Percents & Decimals</span>
                      <span className="font-bold">40% of 150 + 1.8</span>
                    </div>
                  </div>
                )}

                {/* ── VISUALIZER TYPE 7: COUNTDOWN DIAL ── */}
                {current.visualizerType === 'countdown_dial' && (
                  <div className="w-full flex flex-col items-center text-center p-2">
                    <div className="relative w-32 h-32 flex items-center justify-center">
                      <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="44" stroke="#1F103A" strokeWidth="8" fill="none" />
                        <circle
                          cx="50"
                          cy="50"
                          r="44"
                          stroke="#00F5D4"
                          strokeWidth="8"
                          strokeDasharray="276"
                          strokeDashoffset="70"
                          strokeLinecap="round"
                          fill="none"
                          className="transition-all duration-1000 drop-shadow-[0_0_10px_#00F5D4]"
                        />
                      </svg>
                      <div className="absolute flex flex-col items-center">
                        <span className="font-mono text-3xl font-black text-white drop-shadow-[0_0_12px_#00F5D4] animate-pulse">
                          10s
                        </span>
                        <span className="font-telemetry text-[8px] text-[#00F5D4] uppercase">SPEED DIAL</span>
                      </div>
                    </div>
                    <span className="font-telemetry text-[10px] text-[#00F5D4] font-bold tracking-wider mt-2 uppercase">
                      RAPID REACTION WINDOW
                    </span>
                  </div>
                )}

                {/* ── VISUALIZER TYPE 8: PHASES PROGRESSION ── */}
                {current.visualizerType === 'phases_progression' && (
                  <div className="w-full flex flex-col items-center p-2 space-y-2 text-center">
                    <div className="w-full p-2 bg-[#1A0538] border border-[#00F5D4] rounded-lg flex items-center justify-between">
                      <span className="font-arcade text-xs text-[#00F5D4]">PHASE 1: LINE</span>
                      <span className="font-mono text-xs font-bold text-white">+100 to +250 PTS</span>
                    </div>
                    <div className="text-[#00F5D4] text-xs">▼ CONTINUES SEAMLESSLY</div>
                    <div className="w-full p-2 bg-[#1A0538] border border-[#FF55D2] rounded-lg flex items-center justify-between">
                      <span className="font-arcade text-xs text-[#FF55D2]">PHASE 2: PATTERN</span>
                      <span className="font-mono text-xs font-bold text-white">+200 to +400 PTS</span>
                    </div>
                    <div className="text-[#FF55D2] text-xs">▼ NO NUMBER RESETS</div>
                    <div className="w-full p-2 bg-[#1A0538] border border-[#FFE066] rounded-lg flex items-center justify-between shadow-[0_0_15px_rgba(255,224,102,0.5)]">
                      <span className="font-arcade text-xs text-[#FFE066]">PHASE 3: BLACKOUT</span>
                      <span className="font-mono text-xs font-bold text-white">+500 to +1000 PTS</span>
                    </div>
                  </div>
                )}

                {/* ── VISUALIZER TYPE 9: HANDS-FREE AUTOMATED PATTERN SHOWCASE (3 ROUND PATTERNS ONLY) ── */}
                {current.visualizerType === 'pattern_selector' && (
                  <div className="w-full flex flex-col items-center p-2 text-center">
                    {/* 3 Non-interactive pattern badges with automatic animated cycle */}
                    <div className="flex gap-2 mb-2.5">
                      {['X', 'FRAME', 'DIAMOND'].map((p, i) => (
                        <span
                          key={p}
                          className={`px-3 py-1 rounded text-[10px] font-mono font-black uppercase transition-all duration-300 ${selectedPatternIndex === i
                            ? 'bg-[#00F5D4] text-black shadow-[0_0_12px_#00F5D4] scale-105'
                            : 'bg-[#15042E] text-slate-400 border border-[#00F5D4]/30'
                            }`}
                        >
                          {p}
                        </span>
                      ))}
                    </div>

                    {/* 5x5 Pattern Visualizer Grid */}
                    <div className="grid grid-cols-5 gap-1.5 p-2 bg-[#0A001F] border-2 border-[#00F5D4] rounded-xl w-36 h-36 shadow-[0_0_20px_rgba(0,245,212,0.5)]">
                      {Array.from({ length: 25 }).map((_, i) => {
                        const r = Math.floor(i / 5);
                        const c = i % 5;
                        let isMarked = false;

                        if (selectedPatternIndex === 0) {
                          // Round 1: The "X" Pattern
                          isMarked = r === c || r + c === 4;
                        } else if (selectedPatternIndex === 1) {
                          // Round 2: Picture Frame
                          isMarked = r === 0 || r === 4 || c === 0 || c === 4;
                        } else if (selectedPatternIndex === 2) {
                          // Round 3: Solid Diamond
                          isMarked = Math.abs(r - 2) + Math.abs(c - 2) <= 2;
                        }

                        return (
                          <div
                            key={i}
                            className={`rounded-md transition-all duration-300 ${isMarked
                              ? r === 2 && c === 2
                                ? 'bg-[#FF007F] shadow-[0_0_10px_#FF007F]'
                                : 'bg-[#00F5D4] shadow-[0_0_8px_#00F5D4]'
                              : r === 2 && c === 2
                                ? 'bg-[#FF007F]/40 border border-[#FF007F]'
                                : 'bg-[#180436]'
                              }`}
                          />
                        );
                      })}
                    </div>
                    <span className="font-telemetry text-[10px] text-[#00F5D4] font-bold tracking-wider mt-2.5 uppercase">
                      AUTONOMOUS PATTERN ROTATION // PHASE 2
                    </span>
                  </div>
                )}

                {/* ── VISUALIZER TYPE 10: SIMULTANEOUS DRAW TIMELINE ── */}
                {current.visualizerType === 'simultaneous_draw' && (
                  <div className="w-full flex flex-col items-center p-2 text-center">
                    <div className="w-full space-y-2 font-mono text-xs">
                      <div className="p-2 bg-[#0E0024] border border-[#00F5D4] rounded text-emerald-300">
                        <div>🔊 Draw #14 Equation Broadcast</div>
                        <div className="text-[10px] text-slate-400">Target Answer: 42</div>
                      </div>
                      <div className="p-2 bg-emerald-950/50 border border-emerald-400 rounded text-white shadow-[0_0_15px_#34D399]">
                        <div className="font-bold text-emerald-300">✓ SAME-DRAW CLAIMS VALIDATED</div>
                        <div className="text-[10px] text-slate-300">Alex &amp; Maya both shout ➔ Both Awarded Win!</div>
                      </div>
                      <div className="p-2 bg-rose-950/40 border border-rose-500 rounded text-rose-300">
                        <div>❌ Late Claim After Draw #15</div>
                        <div className="text-[9px] text-rose-400">Disqualified for Phase 1 (Must wait)</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── VISUALIZER TYPE 11: 3D PODIUM LEADERBOARD ── */}
                {current.visualizerType === 'podium_scores' && (
                  <div className="w-full flex flex-col items-center p-2 text-center">
                    <div className="flex items-end justify-center gap-2 h-36 w-full max-w-xs pt-2">
                      <div className="w-16 bg-gradient-to-t from-[#1A0538] to-[#94A3B8] border border-slate-400 rounded-t-lg h-24 flex flex-col items-center justify-between p-1">
                        <span className="text-xl">🥈</span>
                        <span className="font-arcade text-[11px] font-black text-white">2ND</span>
                      </div>
                      <div className="w-20 bg-gradient-to-t from-[#1A0538] to-[#FFE066] border border-[#FFE066] rounded-t-lg h-32 flex flex-col items-center justify-between p-1 shadow-[0_0_20px_rgba(255,224,102,0.6)]">
                        <span className="text-2xl">🥇</span>
                        <span className="font-arcade text-xs font-black text-black bg-[#FFE066] px-2 rounded">CHAMPION</span>
                      </div>
                      <div className="w-16 bg-gradient-to-t from-[#1A0538] to-[#FF6B35] border border-[#FF6B35] rounded-t-lg h-20 flex flex-col items-center justify-between p-1">
                        <span className="text-lg">🥉</span>
                        <span className="font-arcade text-[11px] font-black text-white">3RD</span>
                      </div>
                    </div>
                    <span className="font-telemetry text-[10px] text-[#FFE066] font-bold tracking-wider mt-2 uppercase">
                      CUMULATIVE 3-ROUND PODIUM STANDINGS
                    </span>
                  </div>
                )}

                {/* ── VISUALIZER TYPE 12: MATH ERROR TRAP ── */}
                {current.visualizerType === 'math_error_trap' && (
                  <div className="w-full flex flex-col items-center p-2 text-center">
                    <div className="w-full bg-[#0E0024] border-2 border-[#FF007F] rounded-lg p-3 shadow-[0_0_20px_rgba(255,0,127,0.7)]">
                      <div className="flex justify-between items-center text-xs font-mono font-bold text-[#FF55D2] mb-1">
                        <span>GLITCH DETECTOR</span>
                        <span className="animate-ping">● ALERT</span>
                      </div>
                      <svg viewBox="0 0 100 24" className="w-full h-8 stroke-[#FF007F] fill-none stroke-[1.5]">
                        <path d="M 0 12 L 20 12 L 25 3 L 30 21 L 35 7 L 40 16 L 45 12 L 100 12" />
                      </svg>
                      <div className="mt-2 text-[11px] font-mono text-white">
                        AI Spoke: <span className="text-[#FF55D2] font-black">"15 + 22 = 40"</span> (WRONG!)
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5 w-full mt-2 text-[10px] font-mono">
                      <div className="flex gap-2 w-full">
                        <div className="flex-1 p-1.5 bg-emerald-950 border border-emerald-400 rounded text-emerald-300 flex flex-col items-center justify-center">
                          <span className="font-bold text-white">✓ VALID CATCH</span>
                          <span className="text-[#FFE066] font-bold">+50 PTS (+50/rd)</span>
                          <span className="text-[9px] text-emerald-400">+ 1 TACTICAL POWER</span>
                        </div>
                        <div className="flex-1 p-1.5 bg-rose-950 border border-rose-500 rounded text-rose-300 flex flex-col items-center justify-center">
                          <span className="font-bold text-white">⛔ FALSE ALARM</span>
                          <span className="text-rose-400 font-bold">-100 POINTS</span>
                          <span className="text-[9px] text-rose-400">PENALTY TO PLAYER</span>
                        </div>
                      </div>
                      <div className="p-1 rounded bg-[#14052E] border border-[#00F5D4]/40 text-[9px] text-[#00F5D4] text-center font-bold tracking-wider">
                        R1: 50 | R2: 100 | R3: 150 PTS
                      </div>
                    </div>
                  </div>
                )}

                {/* ── VISUALIZER TYPE 13: POWERS BANK ── */}
                {current.visualizerType === 'powers_bank' && (
                  <div className="w-full flex flex-col items-center p-2 space-y-1.5">
                    <div className="w-full p-1.5 bg-[#14052E] border border-[#00F5D4] rounded flex items-center justify-between text-xs font-mono">
                      <span className="text-white">🎯 Steal the Number</span>
                      <span className="text-[#00F5D4] font-bold">ROULETTE</span>
                    </div>
                    <div className="w-full p-1.5 bg-[#14052E] border border-[#FF007F] rounded flex items-center justify-between text-xs font-mono">
                      <span className="text-white">🧹 Memory Wipe</span>
                      <span className="text-[#FF55D2] font-bold">ERASER</span>
                    </div>
                    <div className="w-full p-1.5 bg-[#14052E] border border-[#FFE066] rounded flex items-center justify-between text-xs font-mono">
                      <span className="text-white">🎟️ Extra Ticket</span>
                      <span className="text-[#FFE066] font-bold">2ND CARD</span>
                    </div>
                    <div className="w-full p-1.5 bg-[#14052E] border border-[#FF6B35] rounded flex items-center justify-between text-xs font-mono">
                      <span className="text-white">⚡ Double Points</span>
                      <span className="text-[#FF6B35] font-bold">2X WIN</span>
                    </div>
                    <div className="w-full p-1.5 bg-[#14052E] border border-[#C084FC] rounded flex items-center justify-between text-xs font-mono">
                      <span className="text-white">📡 Dual Call</span>
                      <span className="text-[#C084FC] font-bold">PARALLEL</span>
                    </div>
                  </div>
                )}

              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── BOTTOM FOOTER: SLIDE INDICATOR & GLOWING PROGRESS BAR (CLEAN HUD - NO BUTTONS) ── */}
      <div className="relative z-10 flex flex-col items-center justify-center max-w-6xl mx-auto w-full pt-2 gap-1.5 pointer-events-none">
        <div className="font-telemetry text-xs md:text-sm font-bold text-[#38BDF8] tracking-[0.2em] uppercase drop-shadow-[0_0_8px_#38BDF8] flex items-center gap-3">
          <span>SLIDE {slideNumber} of 14</span>
          {isSpeaking && (
            <span className="text-xs font-mono text-[#00F5D4] flex items-center gap-1.5 font-bold">
              <span className="w-2 h-2 rounded-full bg-[#00F5D4] animate-ping" />
              ALLISON NARRATING (LINE {currentLine}/{MECHANICS_SLIDE_AUDIO_COUNTS[slideNumber] || 1})
            </span>
          )}
        </div>
        {/* Glowing Pill Bar */}
        <div className="w-64 sm:w-80 md:w-96 h-2.5 bg-[#090014] border border-[#00F5D4] rounded-full overflow-hidden shadow-[0_0_12px_rgba(0,245,212,0.6)]">
          <div
            className="h-full bg-gradient-to-r from-[#00F5D4] via-[#FF55D2] to-[#FFE066] transition-all duration-300 shadow-[0_0_10px_#00F5D4]"
            style={{ width: `${(slideNumber / 14) * 100}%` }}
          />
        </div>
      </div>
    </ArenaStadiumBackground>
  );
}

// ─── LIVING CONSTELLATION WEB & FLOATING 3D SHAPES COMPONENT ────────────────
// Organic turtle-pace floating motion for geometric shapes & constellation network
const CELESTIAL_NODES_CONFIG = [
  // 15 3D geometric shapes
  { id: 1, x: 285, y: 150, scale: 0.72, ampX: 7.5, ampY: 6.0, speed: 0.00042, px: 0.0, py: 1.2, rotAmp: 3.5 },
  { id: 2, x: 385, y: 115, scale: 0.60, ampX: 6.5, ampY: 7.0, speed: 0.00038, px: 1.5, py: 2.5, rotAmp: 3.0 },
  { id: 3, x: 500, y: 95, scale: 0.82, ampX: 7.0, ampY: 5.5, speed: 0.00035, px: 2.8, py: 0.8, rotAmp: 2.5 },
  { id: 4, x: 615, y: 118, scale: 0.65, ampX: 6.5, ampY: 7.0, speed: 0.00040, px: 4.1, py: 3.2, rotAmp: 3.0 },
  { id: 5, x: 715, y: 135, scale: 0.68, ampX: 8.0, ampY: 6.0, speed: 0.00036, px: 5.2, py: 1.9, rotAmp: 2.5 },
  { id: 6, x: 805, y: 185, scale: 0.70, ampX: 7.0, ampY: 8.0, speed: 0.00044, px: 0.8, py: 4.3, rotAmp: 3.5 },
  { id: 7, x: 245, y: 270, scale: 0.72, ampX: 6.5, ampY: 5.5, speed: 0.00032, px: 2.0, py: 1.1, rotAmp: 2.8 },
  { id: 8, x: 765, y: 275, scale: 0.72, ampX: 6.5, ampY: 5.5, speed: 0.00034, px: 3.5, py: 2.6, rotAmp: 2.8 },
  { id: 9, x: 445, y: 135, scale: 0.42, ampX: 5.5, ampY: 6.0, speed: 0.00048, px: 1.2, py: 3.9, rotAmp: 4.0 },
  { id: 10, x: 555, y: 130, scale: 0.42, ampX: 5.5, ampY: 6.0, speed: 0.00046, px: 4.7, py: 1.4, rotAmp: 4.0 },
  { id: 11, x: 345, y: 175, scale: 0.38, ampX: 5.0, ampY: 5.5, speed: 0.00052, px: 0.5, py: 2.8, rotAmp: 3.5 },
  { id: 12, x: 655, y: 165, scale: 0.40, ampX: 5.0, ampY: 5.5, speed: 0.00050, px: 3.2, py: 5.1, rotAmp: 3.5 },
  { id: 13, x: 500, y: 205, scale: 0.45, ampX: 6.0, ampY: 4.5, speed: 0.00036, px: 2.4, py: 1.8, rotAmp: 2.5 },
  { id: 14, x: 745, y: 220, scale: 0.36, ampX: 5.0, ampY: 5.0, speed: 0.00046, px: 4.0, py: 0.7, rotAmp: 3.0 },
  { id: 15, x: 500, y: 520, scale: 0.55, ampX: 6.0, ampY: 4.0, speed: 0.00030, px: 1.8, py: 3.4, rotAmp: 2.0 },
  // 9 auxiliary constellation anchor points
  { id: 16, x: 180, y: 195, scale: 1, ampX: 6.0, ampY: 6.0, speed: 0.00035, px: 0.3, py: 2.1, rotAmp: 0 },
  { id: 17, x: 210, y: 260, scale: 1, ampX: 5.0, ampY: 5.0, speed: 0.00033, px: 1.7, py: 4.0, rotAmp: 0 },
  { id: 18, x: 235, y: 145, scale: 1, ampX: 6.0, ampY: 6.0, speed: 0.00040, px: 3.1, py: 1.1, rotAmp: 0 },
  { id: 19, x: 310, y: 235, scale: 1, ampX: 5.0, ampY: 5.0, speed: 0.00036, px: 4.8, py: 2.9, rotAmp: 0 },
  { id: 20, x: 345, y: 110, scale: 1, ampX: 6.0, ampY: 5.0, speed: 0.00042, px: 2.3, py: 0.4, rotAmp: 0 },
  { id: 21, x: 420, y: 245, scale: 1, ampX: 5.0, ampY: 5.0, speed: 0.00034, px: 0.9, py: 3.7, rotAmp: 0 },
  { id: 22, x: 580, y: 245, scale: 1, ampX: 5.0, ampY: 5.0, speed: 0.00036, px: 3.8, py: 1.6, rotAmp: 0 },
  { id: 23, x: 665, y: 105, scale: 1, ampX: 6.0, ampY: 5.0, speed: 0.00041, px: 1.4, py: 4.5, rotAmp: 0 },
  { id: 24, x: 850, y: 150, scale: 1, ampX: 6.0, ampY: 6.0, speed: 0.00038, px: 5.0, py: 2.0, rotAmp: 0 },
];

function AnimatedCelestialMatrix() {
  const [frameTime, setFrameTime] = useState(0);

  useEffect(() => {
    let raf: number;
    let start = performance.now();
    const tick = (now: number) => {
      setFrameTime(now - start);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const nodeMap = useMemo(() => {
    const map = new Map<number, { x: number; y: number; rot: number; scale: number }>();
    for (const n of CELESTIAL_NODES_CONFIG) {
      const dx = Math.sin(frameTime * n.speed + n.px) * n.ampX + Math.cos(frameTime * n.speed * 0.7 + n.py) * (n.ampX * 0.25);
      const dy = Math.cos(frameTime * n.speed * 0.85 + n.py) * n.ampY + Math.sin(frameTime * n.speed * 0.5 + n.px) * (n.ampY * 0.25);
      const rot = Math.sin(frameTime * n.speed * 0.6 + n.px) * n.rotAmp;
      map.set(n.id, { x: n.x + dx, y: n.y + dy, rot, scale: n.scale });
    }
    return map;
  }, [frameTime]);

  const p = (id: number) => nodeMap.get(id) || { x: 0, y: 0, rot: 0, scale: 1 };
  const pts = (...ids: number[]) => ids.map(id => {
    const pt = p(id);
    return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
  }).join(' ');

  return (
    <svg
      viewBox="0 0 1000 560"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 1 }}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="wireGlowOrange" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#FF6B35" floodOpacity="0.85" />
          <feDropShadow dx="0" dy="0" stdDeviation="8" floodColor="#FF6B35" floodOpacity="0.45" />
        </filter>
        <filter id="wireGlowMagenta" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#FF007F" floodOpacity="0.85" />
          <feDropShadow dx="0" dy="0" stdDeviation="8" floodColor="#FF007F" floodOpacity="0.45" />
        </filter>
        <filter id="wireGlowPurple" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="0" stdDeviation="3.5" floodColor="#A855F7" floodOpacity="0.85" />
          <feDropShadow dx="0" dy="0" stdDeviation="8" floodColor="#A855F7" floodOpacity="0.4" />
        </filter>
        <filter id="wireGlowCyan" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#00F5D4" floodOpacity="0.9" />
          <feDropShadow dx="0" dy="0" stdDeviation="8" floodColor="#00F5D4" floodOpacity="0.5" />
        </filter>
        <filter id="nodeGlowWhite" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="#FFFFFF" floodOpacity="1" />
          <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#38BDF8" floodOpacity="0.6" />
        </filter>
      </defs>

      {/* ── CONSTELLATION NETWORK: ANIMATED SLOW-DRIFTING CELESTIAL MATRIX ── */}
      <g id="constellationNetwork" opacity="0.76">
        {/* Layer 1: Upper Primary Constellation Ribbon */}
        <polyline
          points={pts(16, 18, 1, 20, 2, 9, 3, 10, 4, 23, 5, 6, 24)}
          fill="none"
          stroke="#93C5FD"
          strokeWidth="0.85"
          strokeDasharray="4 2.5"
        />

        {/* Layer 2: Mid-Level Inter-shape Cross-bracing Matrix */}
        <polyline
          points={pts(1, 11, 2, 9, 13, 10, 4, 12, 5, 14, 6)}
          fill="none"
          stroke="#C084FC"
          strokeWidth="0.75"
          strokeDasharray="3 3"
        />

        {/* Layer 3: Lower Arch framing the title base & HUD */}
        <polyline
          points={pts(17, 7, 19, 11, 21, 13, 22, 12, 8)}
          fill="none"
          stroke="#67E8F9"
          strokeWidth="0.75"
          strokeDasharray="4 2"
        />

        {/* Secondary Cross-rays */}
        <line x1={p(1).x} y1={p(1).y} x2={p(2).x} y2={p(2).y} stroke="#A5B4FC" strokeWidth="0.7" strokeDasharray="3 3" />
        <line x1={p(2).x} y1={p(2).y} x2={p(3).x} y2={p(3).y} stroke="#A5B4FC" strokeWidth="0.7" strokeDasharray="3 3" />
        <line x1={p(3).x} y1={p(3).y} x2={p(4).x} y2={p(4).y} stroke="#A5B4FC" strokeWidth="0.7" strokeDasharray="3 3" />
        <line x1={p(4).x} y1={p(4).y} x2={p(5).x} y2={p(5).y} stroke="#A5B4FC" strokeWidth="0.7" strokeDasharray="3 3" />
        <line x1={p(7).x} y1={p(7).y} x2={p(1).x} y2={p(1).y} stroke="#FF55D2" strokeWidth="0.7" strokeDasharray="3 2" />
        <line x1={p(8).x} y1={p(8).y} x2={p(6).x} y2={p(6).y} stroke="#FF8C42" strokeWidth="0.7" strokeDasharray="3 2" />
        <line x1={p(9).x} y1={p(9).y} x2={p(13).x} y2={p(13).y} stroke="#93C5FD" strokeWidth="0.65" strokeDasharray="2 2" />
        <line x1={p(10).x} y1={p(10).y} x2={p(13).x} y2={p(13).y} stroke="#93C5FD" strokeWidth="0.65" strokeDasharray="2 2" />

        {/* Concentric Orbital Target Rings on Key Anchor Stars */}
        <circle cx={p(1).x} cy={p(1).y} r={7} fill="none" stroke="#38BDF8" strokeWidth="0.6" strokeDasharray="2 2" opacity="0.8" />
        <circle cx={p(3).x} cy={p(3).y} r={8} fill="none" stroke="#A855F7" strokeWidth="0.6" strokeDasharray="2 2" opacity="0.8" />
        <circle cx={p(5).x} cy={p(5).y} r={7} fill="none" stroke="#00F5D4" strokeWidth="0.6" strokeDasharray="2 2" opacity="0.8" />
        <circle cx={p(13).x} cy={p(13).y} r={6} fill="none" stroke="#FFE066" strokeWidth="0.6" strokeDasharray="2 2" opacity="0.7" />

        {/* Constellation Nodes (Glowing Celestial Dots & Diamond Pins) */}
        <circle cx={p(16).x} cy={p(16).y} r={2.5} fill="#38BDF8" className="animate-twinkle" />
        <circle cx={p(17).x} cy={p(17).y} r={2.2} fill="#FFFFFF" />
        <circle cx={p(18).x} cy={p(18).y} r={2.8} fill="#FFE066" />
        <circle cx={p(19).x} cy={p(19).y} r={2.5} fill="#38BDF8" />
        <circle cx={p(7).x} cy={p(7).y} r={3.2} fill="#FF55D2" filter="url(#wireGlowMagenta)" />
        <circle cx={p(1).x} cy={p(1).y} r={3.5} fill="#FFFFFF" filter="url(#nodeGlowWhite)" />
        <circle cx={p(20).x} cy={p(20).y} r={2.8} fill="#FFFFFF" />
        <circle cx={p(11).x} cy={p(11).y} r={3.0} fill="#FF55D2" />
        <circle cx={p(2).x} cy={p(2).y} r={3.5} fill="#FF55D2" filter="url(#wireGlowMagenta)" />
        <circle cx={p(21).x} cy={p(21).y} r={2.2} fill="#FFE066" />
        <circle cx={p(9).x} cy={p(9).y} r={3.0} fill="#00F5D4" filter="url(#wireGlowCyan)" />
        <circle cx={p(3).x} cy={p(3).y} r={4.0} fill="#C084FC" filter="url(#wireGlowPurple)" />
        <circle cx={p(13).x} cy={p(13).y} r={3.2} fill="#FFE066" filter="url(#wireGlowOrange)" />
        <circle cx={p(10).x} cy={p(10).y} r={3.0} fill="#FFE066" filter="url(#wireGlowOrange)" />
        <circle cx={p(22).x} cy={p(22).y} r={2.2} fill="#38BDF8" />
        <circle cx={p(4).x} cy={p(4).y} r={3.5} fill="#FF8C42" filter="url(#wireGlowOrange)" />
        <circle cx={p(12).x} cy={p(12).y} r={3.0} fill="#C084FC" />
        <circle cx={p(23).x} cy={p(23).y} r={2.5} fill="#FFFFFF" className="animate-twinkle" />
        <circle cx={p(5).x} cy={p(5).y} r={3.8} fill="#00F5D4" filter="url(#wireGlowCyan)" />
        <circle cx={p(14).x} cy={p(14).y} r={2.8} fill="#00F5D4" />
        <circle cx={p(8).x} cy={p(8).y} r={3.2} fill="#FF8C42" filter="url(#wireGlowOrange)" />
        <circle cx={p(6).x} cy={p(6).y} r={3.5} fill="#C084FC" filter="url(#wireGlowPurple)" />
        <circle cx={p(24).x} cy={p(24).y} r={2.5} fill="#FFFFFF" className="animate-twinkle" />

        {/* 45-degree Diamond Cyber-Nodes */}
        <rect x={p(1).x - 2.25} y={p(1).y - 2.25} width="4.5" height="4.5" transform={`rotate(45 ${p(1).x} ${p(1).y})`} fill="#38BDF8" />
        <rect x={p(2).x - 2.0} y={p(2).y - 2.0} width="4" height="4" transform={`rotate(45 ${p(2).x} ${p(2).y})`} fill="#FFFFFF" />
        <rect x={p(3).x - 2.5} y={p(3).y - 2.5} width="5" height="5" transform={`rotate(45 ${p(3).x} ${p(3).y})`} fill="#00F5D4" />
        <rect x={p(4).x - 2.25} y={p(4).y - 2.25} width="4.5" height="4.5" transform={`rotate(45 ${p(4).x} ${p(4).y})`} fill="#FFE066" />
        <rect x={p(5).x - 2.25} y={p(5).y - 2.25} width="4.5" height="4.5" transform={`rotate(45 ${p(5).x} ${p(5).y})`} fill="#FFFFFF" />
        <rect x={p(13).x - 2.0} y={p(13).y - 2.0} width="4" height="4" transform={`rotate(45 ${p(13).x} ${p(13).y})`} fill="#FF8C42" />
      </g>

      {/* ── 3D WIREFRAME SHAPES (15 GENTLY FLOATING SHAPES IN TURTLE-LIKE MOTION BEHIND "MATH BINGO") ── */}

      {/* 1. Primary: Top-Left Orange Wireframe Icosahedron (behind/above 'M' & 'A') */}
      <g transform={`translate(${p(1).x}, ${p(1).y}) scale(${p(1).scale}) rotate(${p(1).rot})`} opacity="0.92" filter="url(#wireGlowOrange)">
        <polygon points="0,-70 60,-35 60,35 0,70 -60,35 -60,-35" fill="none" stroke="#FF6B35" strokeWidth="1.5" />
        <polygon points="0,-40 35,-20 35,20 0,40 -35,20 -35,-20" fill="none" stroke="#FF8C42" strokeWidth="1.2" />
        <line x1="0" y1="-70" x2="0" y2="-40" stroke="#FF6B35" strokeWidth="1.2" />
        <line x1="60" y1="-35" x2="35" y2="-20" stroke="#FF6B35" strokeWidth="1.2" />
        <line x1="60" y1="35" x2="35" y2="20" stroke="#FF6B35" strokeWidth="1.2" />
        <line x1="0" y1="70" x2="0" y2="40" stroke="#FF6B35" strokeWidth="1.2" />
        <line x1="-60" y1="35" x2="-35" y2="20" stroke="#FF6B35" strokeWidth="1.2" />
        <line x1="-60" y1="-35" x2="-35" y2="-20" stroke="#FF6B35" strokeWidth="1.2" />
        <circle cx="0" cy="-70" r="2.5" fill="#FFE066" />
        <circle cx="60" cy="-35" r="2.5" fill="#FFE066" />
        <circle cx="60" cy="35" r="2.5" fill="#FFE066" />
        <circle cx="0" cy="70" r="2.5" fill="#FFE066" />
        <circle cx="-60" cy="35" r="2.5" fill="#FFE066" />
        <circle cx="-60" cy="-35" r="2.5" fill="#FFE066" />
      </g>

      {/* 2. Primary: Top Mid-Left Neon Pink 3D Extruded Box (above 'T'/'H') */}
      <g transform={`translate(${p(2).x}, ${p(2).y}) scale(${p(2).scale}) rotate(${p(2).rot})`} opacity="0.88" filter="url(#wireGlowMagenta)">
        <polygon points="-35,-45 25,-45 45,-15 -15,-15" fill="none" stroke="#FF007F" strokeWidth="1.5" />
        <polygon points="-15,-15 45,-15 45,35 -15,35" fill="none" stroke="#FF55D2" strokeWidth="1.5" />
        <polygon points="-35,-45 -15,-15 -15,35 -35,5" fill="none" stroke="#FF007F" strokeWidth="1.5" />
        <line x1="25" y1="-45" x2="45" y2="-15" stroke="#FF55D2" strokeWidth="1.2" />
        <circle cx="45" cy="-15" r="2.5" fill="#FFE066" />
      </g>

      {/* 3. Primary: Top Center Neon Purple Faceted Octahedron (centered behind PRIME MEMBERS) */}
      <g transform={`translate(${p(3).x}, ${p(3).y}) scale(${p(3).scale}) rotate(${p(3).rot})`} opacity="0.90" filter="url(#wireGlowPurple)">
        <polygon points="0,-65 58,-12 40,48 -40,48 -58,-12" fill="none" stroke="#A855F7" strokeWidth="1.5" />
        <line x1="0" y1="-65" x2="0" y2="12" stroke="#C084FC" strokeWidth="1.2" />
        <line x1="58" y1="-12" x2="0" y2="12" stroke="#C084FC" strokeWidth="1.2" />
        <line x1="40" y1="48" x2="0" y2="12" stroke="#C084FC" strokeWidth="1.2" />
        <line x1="-40" y1="48" x2="0" y2="12" stroke="#C084FC" strokeWidth="1.2" />
        <line x1="-58" y1="-12" x2="0" y2="12" stroke="#C084FC" strokeWidth="1.2" />
        <circle cx="0" cy="12" r="2.5" fill="#00F5D4" />
      </g>

      {/* 4. Primary: Top Mid-Right Sunset Orange Wireframe Pyramid (above 'B'/'I') */}
      <g transform={`translate(${p(4).x}, ${p(4).y}) scale(${p(4).scale}) rotate(${p(4).rot})`} opacity="0.88" filter="url(#wireGlowOrange)">
        <polygon points="0,-65 55,30 -55,30" fill="none" stroke="#FF8C42" strokeWidth="1.5" />
        <line x1="0" y1="-65" x2="18" y2="15" stroke="#FF6B35" strokeWidth="1.2" />
        <line x1="55" y1="30" x2="18" y2="15" stroke="#FF6B35" strokeWidth="1.2" />
        <line x1="-55" y1="30" x2="18" y2="15" stroke="#FF6B35" strokeWidth="1.2" />
        <circle cx="0" cy="-65" r="2.5" fill="#FFE066" />
      </g>

      {/* 5. Primary: Top Right Glowing Neon Cyan 3D Infinity Symbol ∞ (above 'N'/'G'/'O') */}
      <g transform={`translate(${p(5).x}, ${p(5).y}) scale(${p(5).scale}) rotate(${p(5).rot})`} opacity="0.95" filter="url(#wireGlowCyan)">
        <path
          d="M -48 0 C -48 -24 -24 -24 0 0 C 24 24 48 24 48 0 C 48 -24 24 -24 0 0 C -24 24 -48 24 -48 0 Z"
          fill="none"
          stroke="#00F5D4"
          strokeWidth="3.5"
        />
        <path
          d="M -44 0 C -44 -20 -22 -20 0 0 C 22 20 44 20 44 0 C 44 -20 22 -20 0 0 C -22 20 -44 20 -44 0 Z"
          fill="none"
          stroke="#A5F3FC"
          strokeWidth="1.3"
        />
      </g>

      {/* 6. Primary: Far Right Neon Purple 3D Wireframe Cube (shoulder of 'O') */}
      <g transform={`translate(${p(6).x}, ${p(6).y}) scale(${p(6).scale}) rotate(${p(6).rot})`} opacity="0.88" filter="url(#wireGlowPurple)">
        <polygon points="-30,-40 30,-40 45,-15 -15,-15" fill="none" stroke="#C084FC" strokeWidth="1.5" />
        <polygon points="-30,-40 -15,-15 -15,45 -30,20" fill="none" stroke="#A855F7" strokeWidth="1.5" />
        <polygon points="-15,-15 45,-15 45,45 -15,45" fill="none" stroke="#A855F7" strokeWidth="1.5" />
        <line x1="30" y1="-40" x2="45" y2="-15" stroke="#C084FC" strokeWidth="1.2" />
        <circle cx="45" cy="-15" r="2.5" fill="#00F5D4" />
      </g>

      {/* 7. Primary: Lower Left Neon Magenta Wireframe Geodesic (under 'M' & HUD) */}
      <g transform={`translate(${p(7).x}, ${p(7).y}) scale(${p(7).scale}) rotate(${p(7).rot})`} opacity="0.88" filter="url(#wireGlowMagenta)">
        <polygon points="0,-55 48,-28 48,28 0,55 -48,28 -48,-28" fill="none" stroke="#FF007F" strokeWidth="1.5" />
        <line x1="0" y1="-55" x2="0" y2="55" stroke="#FF007F" strokeWidth="1" />
        <line x1="-48" y1="-28" x2="48" y2="28" stroke="#FF55D2" strokeWidth="1" />
        <line x1="-48" y1="28" x2="48" y2="-28" stroke="#FF55D2" strokeWidth="1" />
        <circle cx="0" cy="0" r="2.8" fill="#00F5D4" />
      </g>

      {/* 8. Primary: Lower Right Sunset Orange Wireframe Prism (under 'O' & HUD) */}
      <g transform={`translate(${p(8).x}, ${p(8).y}) scale(${p(8).scale}) rotate(${p(8).rot})`} opacity="0.88" filter="url(#wireGlowOrange)">
        <polygon points="0,-55 48,-28 48,28 0,55 -48,28 -48,-28" fill="none" stroke="#FF8C42" strokeWidth="1.6" />
        <line x1="0" y1="-55" x2="0" y2="55" stroke="#FF6B35" strokeWidth="1.2" />
        <line x1="-48" y1="-28" x2="48" y2="28" stroke="#FF6B35" strokeWidth="1.2" />
        <line x1="-48" y1="28" x2="48" y2="-28" stroke="#FF6B35" strokeWidth="1.2" />
        <circle cx="0" cy="-55" r="2.5" fill="#FFE066" />
      </g>

      {/* 9. Small Scale: Cyan Wireframe Dodecahedron Facet (between pink box & purple crystal, above 'A'/'T') */}
      <g transform={`translate(${p(9).x}, ${p(9).y}) scale(${p(9).scale}) rotate(${p(9).rot})`} opacity="0.85" filter="url(#wireGlowCyan)">
        <polygon points="0,-35 33,-11 20,28 -20,28 -33,-11" fill="none" stroke="#00F5D4" strokeWidth="1.3" />
        <polygon points="0,-18 16,-5 10,14 -10,14 -16,-5" fill="none" stroke="#A5F3FC" strokeWidth="1.0" />
        <line x1="0" y1="-35" x2="0" y2="-18" stroke="#00F5D4" strokeWidth="1.0" />
        <line x1="33" y1="-11" x2="16" y2="-5" stroke="#00F5D4" strokeWidth="1.0" />
        <line x1="20" y1="28" x2="10" y2="14" stroke="#00F5D4" strokeWidth="1.0" />
        <line x1="-20" y1="28" x2="-10" y2="14" stroke="#00F5D4" strokeWidth="1.0" />
        <line x1="-33" y1="-11" x2="-16" y2="-5" stroke="#00F5D4" strokeWidth="1.0" />
        <circle cx="0" cy="-35" r="2" fill="#FFFFFF" />
      </g>

      {/* 10. Small Scale: Amber Wireframe Tetrahedron (between purple crystal & orange pyramid, above 'B') */}
      <g transform={`translate(${p(10).x}, ${p(10).y}) scale(${p(10).scale}) rotate(${p(10).rot})`} opacity="0.85" filter="url(#wireGlowOrange)">
        <polygon points="0,-38 32,20 -32,20" fill="none" stroke="#FFE066" strokeWidth="1.3" />
        <line x1="0" y1="-38" x2="10" y2="8" stroke="#FF8C42" strokeWidth="1.0" />
        <line x1="32" y1="20" x2="10" y2="8" stroke="#FF8C42" strokeWidth="1.0" />
        <line x1="-32" y1="20" x2="10" y2="8" stroke="#FF8C42" strokeWidth="1.0" />
        <circle cx="10" cy="8" r="2" fill="#FFFFFF" />
      </g>

      {/* 11. Mini Scale: Neon Pink Wireframe Cube (peeking behind 'A' and 'T') */}
      <g transform={`translate(${p(11).x}, ${p(11).y}) scale(${p(11).scale}) rotate(${p(11).rot})`} opacity="0.80" filter="url(#wireGlowMagenta)">
        <polygon points="-25,-25 15,-25 30,-5 -10,-5" fill="none" stroke="#FF007F" strokeWidth="1.3" />
        <polygon points="-10,-5 30,-5 30,30 -10,30" fill="none" stroke="#FF55D2" strokeWidth="1.3" />
        <polygon points="-25,-25 -10,-5 -10,30 -25,10" fill="none" stroke="#FF007F" strokeWidth="1.3" />
        <circle cx="30" cy="-5" r="2" fill="#00F5D4" />
      </g>

      {/* 12. Mini Scale: Neon Purple Wireframe Octahedron (peeking behind 'I' and 'N') */}
      <g transform={`translate(${p(12).x}, ${p(12).y}) scale(${p(12).scale}) rotate(${p(12).rot})`} opacity="0.82" filter="url(#wireGlowPurple)">
        <polygon points="0,-35 30,-5 20,25 -20,25 -30,-5" fill="none" stroke="#C084FC" strokeWidth="1.3" />
        <line x1="0" y1="-35" x2="0" y2="5" stroke="#A855F7" strokeWidth="1.0" />
        <line x1="30" y1="-5" x2="0" y2="5" stroke="#A855F7" strokeWidth="1.0" />
        <line x1="-30" y1="-5" x2="0" y2="5" stroke="#A855F7" strokeWidth="1.0" />
        <circle cx="0" cy="5" r="2" fill="#FFE066" />
      </g>

      {/* 13. Small Scale: Golden Diamond Wireframe Prism (lower center under MATH/BINGO gap) */}
      <g transform={`translate(${p(13).x}, ${p(13).y}) scale(${p(13).scale}) rotate(${p(13).rot})`} opacity="0.82" filter="url(#wireGlowOrange)">
        <polygon points="0,-30 25,0 0,30 -25,0" fill="none" stroke="#FF8C42" strokeWidth="1.4" />
        <line x1="0" y1="-30" x2="0" y2="30" stroke="#FFE066" strokeWidth="1.0" />
        <line x1="-25" y1="0" x2="25" y2="0" stroke="#FFE066" strokeWidth="1.0" />
        <circle cx="0" cy="0" r="2.2" fill="#00F5D4" />
      </g>

      {/* 14. Mini Scale: Cyan Wireframe Hexagon Star (peeking under 'G'/'O') */}
      <g transform={`translate(${p(14).x}, ${p(14).y}) scale(${p(14).scale}) rotate(${p(14).rot})`} opacity="0.80" filter="url(#wireGlowCyan)">
        <polygon points="0,-25 22,-12 22,12 0,25 -22,12 -22,-12" fill="none" stroke="#00F5D4" strokeWidth="1.3" />
        <line x1="0" y1="-25" x2="0" y2="25" stroke="#A5F3FC" strokeWidth="1.0" />
        <line x1="-22" y1="-12" x2="22" y2="12" stroke="#A5F3FC" strokeWidth="1.0" />
        <line x1="-22" y1="12" x2="22" y2="-12" stroke="#A5F3FC" strokeWidth="1.0" />
        <circle cx="0" cy="0" r="2" fill="#FFE066" />
      </g>

      {/* 15. Base: Bottom Center Sunset Orange Diamond (behind HUD card base) */}
      <g transform={`translate(${p(15).x}, ${p(15).y}) scale(${p(15).scale}) rotate(${p(15).rot})`} opacity="0.75" filter="url(#wireGlowOrange)">
        <polygon points="-40,0 0,-40 40,0 0,40" fill="none" stroke="#FF6B35" strokeWidth="1.4" />
        <line x1="-40" y1="0" x2="40" y2="0" stroke="#FF8C42" strokeWidth="1" />
        <line x1="0" y1="-40" x2="0" y2="40" stroke="#FF8C42" strokeWidth="1" />
      </g>
    </svg>
  );
}

// ─── 8. MAIN TITLE SCREEN (SYNTHWAVE ARCADE THEME) ───────────────────────────
function MainTitleScreen({ onEnterGrid }: { onEnterGrid: () => void }) {
  // Horizontal soundwave packet (vertical bars side-by-side, diamond envelope)
  const horizWaveBars = [6, 10, 16, 22, 28, 32, 36, 32, 28, 22, 16, 10, 6];
  // Vertical soundwave spindle (horizontal bars stacked vertically, diamond envelope)
  const spindleWaveBars = [6, 10, 14, 18, 24, 30, 36, 40, 44, 40, 36, 30, 24, 18, 14, 10, 6];

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-between relative overflow-hidden select-none"
      style={{
        background: 'radial-gradient(ellipse at 50% 46%, #220738 0%, #130324 45%, #070012 100%)'
      }}
    >
      {/* ── 1. CLEAN MOVING PERSPECTIVE FLOOR & STATIC CORRIDOR RAYS (NO EXPANDING SQUARES, NO DASHED RAYS) ── */}
      <MovingPerspectiveFloorGrid />

      {/* ── 2. LIVING ANIMATED CONSTELLATION WEB & FLOATING 3D SHAPES (TURTLE-PACE ORGANIC DRIFT) ── */}
      <AnimatedCelestialMatrix />

      {/* ── DYNAMICALLY SPREAD HUD MONOSPACE TELEMETRY (RIGHT CLUSTERS) ── */}
      {/* Cluster 2: Upper Right (ceiling grid depth) */}
      <div
        className="absolute top-7 right-32 z-10 pointer-events-none hidden md:block font-telemetry text-[11px] leading-tight text-[#38BDF8] drop-shadow-[0_0_6px_#38BDF8] text-right animate-incandescent"
        style={{ animationDelay: '1.4s' }}
      >
        <div className="opacity-80">0492024.110</div>
        <div className="opacity-70">11-23-4 0004-611</div>
        <div className="text-cyan-300">ID: 68307</div>
        <div className="text-emerald-400 font-bold">10101</div>
      </div>

      {/* Cluster 3: Mid-Right (beside infinity and right 3D cube) */}
      <div
        className="absolute top-28 right-20 z-10 pointer-events-none hidden lg:block font-telemetry text-[11px] leading-tight text-[#38BDF8] drop-shadow-[0_0_6px_#38BDF8] text-right animate-incandescent"
        style={{ animationDelay: '2.2s' }}
      >
        <div className="text-[#67E8F9] font-bold">0492024.110</div>
        <div className="opacity-80">STAT: 11AGUO40E</div>
        <div className="opacity-70">PROGRAM: T&E00</div>
        <div className="text-amber-300 opacity-90">GENIS: 049.80est.</div>
        <div className="flex items-center justify-end gap-1.5 mt-0.5">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_6px_#EF4444] animate-ping" />
          <span className="text-red-400 font-bold text-[10px]">RECON.SYNC</span>
        </div>
      </div>

      {/* Cluster 5: Lower Right (near orange prism floor) */}
      <div
        className="absolute bottom-20 right-28 z-10 pointer-events-none hidden lg:block font-telemetry text-[10px] leading-tight text-cyan-400/80 drop-shadow-[0_0_5px_#38BDF8] text-right animate-incandescent"
        style={{ animationDelay: '3.6s' }}
      >
        <div className="opacity-70">DATA.STREAM // 010110</div>
        <div className="text-emerald-400 font-bold">MATRIX: RESOLVED</div>
        <div className="text-[#67E8F9]">CH-04 ONLINE</div>
      </div>

      {/* ── LEFT MARGIN: FAITHFUL CYBER TELEMETRY & SOUNDWAVE MODULE (MATCHING INSPIRATION IMAGE 3) ── */}
      <CyberTelemetrySidebar />

      {/* ── RIGHT MARGIN BORDER: SOUND WAVES & CLASSY PIXEL MATH SYMBOLS ── */}
      <div className="absolute right-4 md:right-6 top-0 bottom-0 z-20 flex flex-col justify-between items-center py-5 pointer-events-none w-20">
        {/* Top-Right Group: Sqrt, Infinity + HORIZONTAL Soundwave Packet */}
        <div className="flex items-center gap-2 mt-1">
          <div className="flex flex-col items-center">
            <span className="font-pixel-math text-2xl md:text-3xl text-[#FFA057] select-none animate-border-symbol">
              √
            </span>
            <span className="font-pixel-math text-2xl md:text-3xl text-[#FFA057] select-none animate-border-symbol" style={{ animationDelay: '0.4s' }}>
              ∞
            </span>
          </div>
          <div className="flex items-center gap-[2.5px] h-9 px-1">
            {horizWaveBars.map((h, i) => (
              <div
                key={`h-top-r-${i}`}
                className="w-[2.5px] bg-gradient-to-t from-[#FF6B35] via-[#FF8C42] to-[#FFE066] rounded-full shadow-[0_0_6px_#FF6B35]"
                style={{
                  height: `${h}px`,
                  animation: `soundwave-h-fluctuate ${0.85 + (i % 4) * 0.2}s ease-in-out infinite ${(i * 0.08).toFixed(2)}s`,
                  transformOrigin: 'center'
                }}
              />
            ))}
          </div>
        </div>

        {/* Center-Right Group: Pi + VERTICAL Soundwave Spindle + Integral */}
        <div className="flex flex-col items-center gap-3 my-auto">
          {/* Right VERTICAL Soundwave Spindle (horizontal bars stacked vertically) */}
          <div className="flex flex-col items-center gap-[2.5px] my-2 px-1">
            {spindleWaveBars.map((w, i) => (
              <div
                key={`v-spindle-right-${i}`}
                className="h-[2.5px] bg-gradient-to-r from-[#FF6B35] via-[#FF8C42] to-[#FFE066] rounded-full shadow-[0_0_6px_#FF6B35]"
                style={{
                  width: `${w}px`,
                  animation: `soundwave-v-spindle-fluctuate ${0.95 - (i % 5) * 0.15}s ease-in-out infinite ${(i * 0.08).toFixed(2)}s`,
                  transformOrigin: 'center'
                }}
              />
            ))}
          </div>

          <span className="font-pixel-math text-2xl md:text-3xl text-[#FFA057] select-none animate-border-symbol" style={{ animationDelay: '1.4s' }}>
            π
          </span>
          <span className="font-pixel-math text-3xl md:text-4xl text-[#FFA057] select-none animate-border-symbol" style={{ animationDelay: '2.0s' }}>
            ∫
          </span>
        </div>

        {/* Bottom-Right Group: Pi, Sqrt, Infinity + HORIZONTAL Soundwave Packet */}
        <div className="flex items-center gap-1.5 mb-1">
          <div className="flex items-center gap-1">
            <span className="font-pixel-math text-xl md:text-2xl text-[#FFA057] select-none animate-border-symbol" style={{ animationDelay: '2.6s' }}>
              π
            </span>
            <span className="font-pixel-math text-xl md:text-2xl text-[#FFA057] select-none animate-border-symbol" style={{ animationDelay: '2.9s' }}>
              √
            </span>
            <span className="font-pixel-math text-xl md:text-2xl text-[#FFA057] select-none animate-border-symbol" style={{ animationDelay: '3.2s' }}>
              ∞
            </span>
          </div>
          <div className="flex items-center gap-[2.5px] h-9 px-1">
            {horizWaveBars.map((h, i) => (
              <div
                key={`h-bot-r-${i}`}
                className="w-[2.5px] bg-gradient-to-t from-[#FF6B35] via-[#FF8C42] to-[#FFE066] rounded-full shadow-[0_0_6px_#FF6B35]"
                style={{
                  height: `${h}px`,
                  animation: `soundwave-h-fluctuate ${0.82 + (i % 4) * 0.22}s ease-in-out infinite ${(i * 0.09).toFixed(2)}s`,
                  transformOrigin: 'center'
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ── CENTER STAGE: LOGO, HUD FRAME & ACTION ── */}
      <div className="relative z-20 flex-1 flex flex-col items-center justify-center text-center px-4 w-full max-w-6xl my-auto">
        {/* Top Header Tag: PRIME MEMBERS PRESENTS */}
        <div className="font-arcade text-lg md:text-xl font-bold tracking-[0.38em] text-[#FF55D2] uppercase drop-shadow-[0_0_14px_rgba(255,85,210,0.95)] mb-1 select-none">
          PRIME MEMBERS PRESENTS
        </div>

        {/* Main Header: MATH BINGO in Rich Royal Blue with Deep Jet-Black Outline & Warm Yellowish Neon Aura */}
        <div className="w-full flex justify-center items-center select-none">
          <svg viewBox="0 0 1150 185" className="w-full max-w-5xl h-auto overflow-visible select-none">
            <defs>
              {/* Rich Royal Blue Chrome Gradient: Crystalline Ice White Highlight -> Azure -> Electric Royal Blue -> Deep Classic Royal Blue -> Sapphire */}
              <linearGradient id="mathBingoRoyalBlueGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#F0F9FF" />
                <stop offset="18%" stopColor="#BAE6FD" />
                <stop offset="42%" stopColor="#60A5FA" />
                <stop offset="50%" stopColor="#3B82F6" />
                <stop offset="56%" stopColor="#2563EB" />
                <stop offset="80%" stopColor="#1D4ED8" />
                <stop offset="100%" stopColor="#1E40AF" />
              </linearGradient>

              {/* Radiant Warm Yellowish Neon Aura Bloom Filter (Behind jet-black outline) */}
              <filter id="yellowishAuraGlow" x="-35%" y="-35%" width="170%" height="170%">
                <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#FFE066" floodOpacity="0.95" />
                <feDropShadow dx="0" dy="0" stdDeviation="16" floodColor="#FFB700" floodOpacity="0.75" />
                <feDropShadow dx="0" dy="0" stdDeviation="28" floodColor="#FF8C42" floodOpacity="0.45" />
              </filter>

              {/* Subtle Electric Royal Blue Tube Edge Filter */}
              <filter id="royalBlueEdgeGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="#60A5FA" floodOpacity="0.75" />
                <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor="#3B82F6" floodOpacity="0.45" />
              </filter>
            </defs>

            {/* Layer 1: Warm Yellowish Neon Aura (Farthest back - radiant solar halo) */}
            <text
              x="575"
              y="136"
              textAnchor="middle"
              style={{
                fontFamily: "'Boogaloo', 'Audiowide', sans-serif",
                fontWeight: 900,
                fontSize: '148px',
                letterSpacing: '2px'
              }}
              fill="none"
              stroke="#FFE066"
              strokeWidth="26"
              strokeLinejoin="round"
              strokeLinecap="round"
              filter="url(#yellowishAuraGlow)"
            >
              MATH BINGO
            </text>

            {/* Layer 2: Deep Jet-Black Heavy Base (Fills inner gaps/holes of 'B', 'A', 'O' & forms bold outer black rim) */}
            <text
              x="575"
              y="136"
              textAnchor="middle"
              style={{
                fontFamily: "'Boogaloo', 'Audiowide', sans-serif",
                fontWeight: 900,
                fontSize: '148px',
                letterSpacing: '2px'
              }}
              fill="#000000"
              stroke="#000000"
              strokeWidth="20"
              strokeLinejoin="round"
              strokeLinecap="round"
            >
              MATH BINGO
            </text>

            {/* Layer 3: Crisp Jet-Black Contour Rim */}
            <text
              x="575"
              y="136"
              textAnchor="middle"
              style={{
                fontFamily: "'Boogaloo', 'Audiowide', sans-serif",
                fontWeight: 900,
                fontSize: '148px',
                letterSpacing: '2px'
              }}
              fill="#000000"
              stroke="#000000"
              strokeWidth="10"
              strokeLinejoin="round"
              strokeLinecap="round"
            >
              MATH BINGO
            </text>

            {/* Layer 4: Inner Electric Royal Blue Neon Edge */}
            <text
              x="575"
              y="136"
              textAnchor="middle"
              style={{
                fontFamily: "'Boogaloo', 'Audiowide', sans-serif",
                fontWeight: 900,
                fontSize: '148px',
                letterSpacing: '2px'
              }}
              fill="none"
              stroke="#3B82F6"
              strokeWidth="3.2"
              strokeLinejoin="round"
              strokeLinecap="round"
              filter="url(#royalBlueEdgeGlow)"
            >
              MATH BINGO
            </text>

            {/* Layer 5: Needle-Sharp Pure Black Inner Contour */}
            <text
              x="575"
              y="136"
              textAnchor="middle"
              style={{
                fontFamily: "'Boogaloo', 'Audiowide', sans-serif",
                fontWeight: 900,
                fontSize: '148px',
                letterSpacing: '2px'
              }}
              fill="none"
              stroke="#000000"
              strokeWidth="1.8"
              strokeLinejoin="round"
            >
              MATH BINGO
            </text>

            {/* Layer 6: Rich Royal Blue Chrome Core Fill */}
            <text
              x="575"
              y="136"
              textAnchor="middle"
              style={{
                fontFamily: "'Boogaloo', 'Audiowide', sans-serif",
                fontWeight: 900,
                fontSize: '148px',
                letterSpacing: '2px'
              }}
              fill="url(#mathBingoRoyalBlueGradient)"
              filter="drop-shadow(0 0 14px rgba(37,99,235,0.70))"
            >
              MATH BINGO
            </text>
          </svg>
        </div>

        {/* ── SUB-ORG THEME HUD FRAME (FLUSH TIGHTLY UNDER TITLE) ── */}
        <div className="relative -mt-5 md:-mt-6 z-20 w-full max-w-3xl px-2">
          <div className="hud-notched-frame border-2 border-[#A855F7] bg-[#0E0124]/92 px-6 py-4 md:px-10 md:py-5 shadow-[0_0_35px_rgba(168,85,247,0.7),inset_0_0_20px_rgba(168,85,247,0.3)] backdrop-blur-md text-center">
            <h2 className="font-arcade text-base sm:text-lg md:text-2xl font-black text-white tracking-[0.16em] uppercase leading-tight drop-shadow-md">
              THROUGH TIME AND EQUATIONS:
            </h2>
            <h3 className="font-arcade text-sm sm:text-base md:text-xl font-black text-slate-100 tracking-[0.16em] uppercase leading-tight mt-1 drop-shadow-md">
              DISCOVERING THE FUTURE OF INTELLIGENCE
            </h3>
          </div>
        </div>

        {/* ── MOTHER-ORG THEME TEXT (UNDER FRAME) ── */}
        <div className="mt-3.5 text-center max-w-full px-4 overflow-hidden">
          <p className="font-arcade text-xs sm:text-sm md:text-[14px] lg:text-[15px] font-bold tracking-[0.24em] text-[#67E8F9] uppercase drop-shadow-[0_0_12px_rgba(0,245,212,0.9)] whitespace-nowrap">
            ARETE 2026: ACTUALIZING RESPONSIVE ETHICS TOWARDS EXCELLENCE IN EDUCATION
          </p>
        </div>

        {/* ── INTERACTIVE BUTTON: ENTER THE GRID ── */}
        <button
          onClick={onEnterGrid}
          className="mt-6 group relative inline-flex items-center justify-center cursor-pointer transition-all duration-300 hover:scale-105 active:scale-95"
        >
          <div className="relative px-14 py-3 rounded-full border-2 border-[#00F5D4] bg-[#090014]/90 shadow-[0_0_28px_rgba(0,245,212,0.85),inset_0_0_15px_rgba(0,245,212,0.35)] transition-all group-hover:shadow-[0_0_45px_rgba(0,245,212,1),inset_0_0_25px_rgba(0,245,212,0.5)]">
            <div className="absolute inset-1 rounded-full border border-[#00F5D4]/70 pointer-events-none" />
            <span className="font-arcade text-xl md:text-2xl font-black text-[#00F5D4] uppercase tracking-[0.3em] drop-shadow-[0_0_10px_#00F5D4]">
              ENTER THE GRID
            </span>
          </div>
        </button>
      </div>

      {/* Bottom spacing buffer */}
      <div className="h-4 w-full" />
    </div>
  );
}

// ─── 8.5. SECOND SCREEN CLUSTERED CELESTIAL MATRIX ───────────────────────────
// Clustered tightly around and behind the central marquee card (x: 190..810, y: 220..360)
const SURROUND_NODES_CONFIG = [
  // ── 1. TOP MARQUEE CLUSTER (peeking along top edge of card, y: 140..210) ──
  { id: 1, x: 260, y: 195, scale: 0.58, ampX: 4.5, ampY: 4.0, speed: 0.00038, px: 0.0, py: 1.2, rotAmp: 3.0 }, // Orange Icosahedron (top-left corner of card)
  { id: 2, x: 360, y: 175, scale: 0.52, ampX: 4.0, ampY: 4.5, speed: 0.00042, px: 1.5, py: 2.5, rotAmp: 2.5 }, // Golden Tetrahedron
  { id: 3, x: 460, y: 160, scale: 0.48, ampX: 4.0, ampY: 3.5, speed: 0.00035, px: 2.8, py: 0.8, rotAmp: 2.0 }, // Cyan Crystal Prism
  { id: 4, x: 540, y: 160, scale: 0.48, ampX: 4.0, ampY: 3.5, speed: 0.00040, px: 4.1, py: 3.2, rotAmp: 2.0 }, // Purple Wireframe Octahedron
  { id: 5, x: 640, y: 175, scale: 0.52, ampX: 4.0, ampY: 4.5, speed: 0.00036, px: 5.2, py: 1.9, rotAmp: 2.5 }, // Electric Yellow Pyramid
  { id: 6, x: 740, y: 195, scale: 0.58, ampX: 4.5, ampY: 4.0, speed: 0.00044, px: 0.8, py: 4.3, rotAmp: 3.0 }, // Violet Dodecahedron (top-right corner of card)

  // ── 2. LEFT FLANK CLUSTER (hugging left edge of card, x: 120..200, y: 220..360) ──
  { id: 7, x: 155, y: 230, scale: 0.60, ampX: 5.0, ampY: 4.0, speed: 0.00034, px: 2.0, py: 1.1, rotAmp: 2.8 }, // Glowing Cyan Infinity Loop
  { id: 8, x: 135, y: 290, scale: 0.55, ampX: 4.5, ampY: 4.5, speed: 0.00038, px: 3.5, py: 2.6, rotAmp: 3.0 }, // Hot Pink 3D Wireframe Cube
  { id: 9, x: 160, y: 350, scale: 0.58, ampX: 5.0, ampY: 4.0, speed: 0.00040, px: 1.2, py: 3.9, rotAmp: 2.8 }, // Purple Octahedron

  // ── 3. RIGHT FLANK CLUSTER (hugging right edge of card, x: 800..880, y: 220..360) ──
  { id: 10, x: 845, y: 230, scale: 0.60, ampX: 5.0, ampY: 4.0, speed: 0.00036, px: 4.7, py: 1.4, rotAmp: 2.8 }, // Sky Blue Wireframe Cube
  { id: 11, x: 865, y: 290, scale: 0.55, ampX: 4.5, ampY: 4.5, speed: 0.00041, px: 0.5, py: 2.8, rotAmp: 3.0 }, // Cyan Hexagon Star
  { id: 12, x: 840, y: 350, scale: 0.58, ampX: 5.0, ampY: 4.0, speed: 0.00037, px: 3.2, py: 5.1, rotAmp: 2.8 }, // Sunset Orange Icosahedron

  // ── 4. BOTTOM MARQUEE CLUSTER (peeking along bottom edge of card, y: 370..430) ──
  { id: 13, x: 270, y: 385, scale: 0.52, ampX: 4.0, ampY: 4.0, speed: 0.00036, px: 2.4, py: 1.8, rotAmp: 2.5 }, // Golden Diamond Prism
  { id: 14, x: 380, y: 405, scale: 0.48, ampX: 4.0, ampY: 3.5, speed: 0.00042, px: 4.0, py: 0.7, rotAmp: 2.0 }, // Mini Cyan Geodesic
  { id: 15, x: 500, y: 420, scale: 0.50, ampX: 4.5, ampY: 3.5, speed: 0.00030, px: 1.8, py: 3.4, rotAmp: 2.0 }, // Central Base Diamond
  { id: 16, x: 620, y: 405, scale: 0.48, ampX: 4.0, ampY: 3.5, speed: 0.00040, px: 3.8, py: 1.6, rotAmp: 2.0 }, // Mini Magenta Octahedron
  { id: 17, x: 730, y: 385, scale: 0.52, ampX: 4.0, ampY: 4.0, speed: 0.00038, px: 1.4, py: 4.5, rotAmp: 2.5 }, // Amber Tetrahedron

  // ── 5. BEHIND-CARD CROSS-TIE STAR NODES (weaving intricate constellation patterns behind the text) ──
  { id: 18, x: 300, y: 270, scale: 1, ampX: 3.5, ampY: 3.5, speed: 0.00045, px: 0.3, py: 2.1, rotAmp: 0 },
  { id: 19, x: 420, y: 240, scale: 1, ampX: 3.5, ampY: 3.5, speed: 0.00040, px: 1.7, py: 4.0, rotAmp: 0 },
  { id: 20, x: 500, y: 260, scale: 1, ampX: 4.0, ampY: 3.0, speed: 0.00035, px: 3.1, py: 1.1, rotAmp: 0 },
  { id: 21, x: 580, y: 240, scale: 1, ampX: 3.5, ampY: 3.5, speed: 0.00042, px: 4.8, py: 2.9, rotAmp: 0 },
  { id: 22, x: 700, y: 270, scale: 1, ampX: 3.5, ampY: 3.5, speed: 0.00038, px: 2.3, py: 0.4, rotAmp: 0 },
  { id: 23, x: 350, y: 330, scale: 1, ampX: 3.5, ampY: 3.5, speed: 0.00044, px: 0.9, py: 3.7, rotAmp: 0 },
  { id: 24, x: 500, y: 340, scale: 1, ampX: 4.0, ampY: 3.0, speed: 0.00033, px: 3.8, py: 1.6, rotAmp: 0 },
  { id: 25, x: 650, y: 330, scale: 1, ampX: 3.5, ampY: 3.5, speed: 0.00041, px: 5.0, py: 2.0, rotAmp: 0 },

  // ── 6. AUXILIARY CONSTELLATION NODES (Dense geometric celestial network) ──
  { id: 26, x: 210, y: 160, scale: 1, ampX: 3.5, ampY: 3.5, speed: 0.00042, px: 1.1, py: 0.5, rotAmp: 0 },
  { id: 27, x: 310, y: 140, scale: 1, ampX: 3.5, ampY: 3.5, speed: 0.00039, px: 3.3, py: 2.2, rotAmp: 0 },
  { id: 28, x: 500, y: 120, scale: 1, ampX: 4.0, ampY: 3.0, speed: 0.00036, px: 0.6, py: 3.8, rotAmp: 0 },
  { id: 29, x: 690, y: 140, scale: 1, ampX: 3.5, ampY: 3.5, speed: 0.00040, px: 4.4, py: 1.5, rotAmp: 0 },
  { id: 30, x: 790, y: 160, scale: 1, ampX: 3.5, ampY: 3.5, speed: 0.00043, px: 2.5, py: 4.7, rotAmp: 0 },
  { id: 31, x: 190, y: 410, scale: 1, ampX: 3.5, ampY: 3.5, speed: 0.00037, px: 0.2, py: 1.8, rotAmp: 0 },
  { id: 32, x: 320, y: 430, scale: 1, ampX: 3.5, ampY: 3.5, speed: 0.00041, px: 3.9, py: 3.0, rotAmp: 0 },
  { id: 33, x: 680, y: 430, scale: 1, ampX: 3.5, ampY: 3.5, speed: 0.00040, px: 1.6, py: 0.9, rotAmp: 0 },
  { id: 34, x: 810, y: 410, scale: 1, ampX: 3.5, ampY: 3.5, speed: 0.00038, px: 4.7, py: 2.4, rotAmp: 0 },
];

function SecondScreenSurroundingMatrix() {
  const [frameTime, setFrameTime] = useState(0);

  useEffect(() => {
    let raf: number;
    let start = performance.now();
    const tick = (now: number) => {
      setFrameTime(now - start);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const nodeMap = useMemo(() => {
    const map = new Map<number, { x: number; y: number; rot: number; scale: number }>();
    for (const n of SURROUND_NODES_CONFIG) {
      const t = frameTime * n.speed;
      const dx = Math.sin(t + n.px) * n.ampX;
      const dy = Math.cos(t * 0.85 + n.py) * n.ampY;
      const rot = Math.sin(t * 0.6 + n.px) * n.rotAmp;
      map.set(n.id, {
        x: n.x + dx,
        y: n.y + dy,
        rot,
        scale: n.scale
      });
    }
    return map;
  }, [frameTime]);

  const p = (id: number) => nodeMap.get(id) || { x: 0, y: 0, rot: 0, scale: 1 };

  const pts = (...ids: number[]) => ids.map(id => {
    const pt = p(id);
    return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
  }).join(' ');

  return (
    <svg
      viewBox="0 0 1000 560"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 w-full h-full pointer-events-none z-0 overflow-hidden"
    >
      <defs>
        <filter id="wireGlowOrange" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#FF6B35" floodOpacity="0.85" />
          <feDropShadow dx="0" dy="0" stdDeviation="8" floodColor="#FF6B35" floodOpacity="0.45" />
        </filter>
        <filter id="wireGlowMagenta" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#FF007F" floodOpacity="0.85" />
          <feDropShadow dx="0" dy="0" stdDeviation="8" floodColor="#FF007F" floodOpacity="0.45" />
        </filter>
        <filter id="wireGlowPurple" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="0" stdDeviation="3.5" floodColor="#A855F7" floodOpacity="0.85" />
          <feDropShadow dx="0" dy="0" stdDeviation="8" floodColor="#A855F7" floodOpacity="0.4" />
        </filter>
        <filter id="wireGlowCyan" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#00F5D4" floodOpacity="0.9" />
          <feDropShadow dx="0" dy="0" stdDeviation="8" floodColor="#00F5D4" floodOpacity="0.5" />
        </filter>
        <filter id="wireGlowYellow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#FFE066" floodOpacity="0.85" />
          <feDropShadow dx="0" dy="0" stdDeviation="8" floodColor="#FFB700" floodOpacity="0.5" />
        </filter>
      </defs>

      {/* ── 1. DENSE CLUSTERED CONSTELLATION NETWORK AROUND MARQUEE ── */}
      <g id="clusteredConstellationWeb" opacity="0.80">
        {/* Layer 1: Upper Primary Constellation Ribbon */}
        <polyline
          points={pts(26, 1, 27, 2, 19, 3, 28, 4, 21, 5, 29, 6, 30)}
          fill="none"
          stroke="#93C5FD"
          strokeWidth="0.95"
          strokeDasharray="4 2.5"
        />

        {/* Layer 2: Left Flank Constellation Ladder */}
        <polyline
          points={pts(26, 7, 18, 8, 23, 9, 31, 13)}
          fill="none"
          stroke="#C084FC"
          strokeWidth="0.85"
          strokeDasharray="3 3"
        />

        {/* Layer 3: Right Flank Constellation Ladder */}
        <polyline
          points={pts(30, 10, 22, 11, 25, 12, 34, 17)}
          fill="none"
          stroke="#C084FC"
          strokeWidth="0.85"
          strokeDasharray="3 3"
        />

        {/* Layer 4: Lower Primary Constellation Arch */}
        <polyline
          points={pts(31, 13, 32, 14, 24, 15, 16, 33, 17, 34)}
          fill="none"
          stroke="#67E8F9"
          strokeWidth="0.85"
          strokeDasharray="4 2"
        />

        {/* ── Geometric Diamond & Triangular Constellation Clusters ── */}
        <polygon points={pts(1, 27, 18, 7)} fill="none" stroke="#67E8F9" strokeWidth="0.75" strokeDasharray="3 3" opacity="0.7" />
        <polygon points={pts(27, 2, 19, 18)} fill="none" stroke="#C084FC" strokeWidth="0.75" strokeDasharray="3 3" opacity="0.7" />
        <polygon points={pts(19, 3, 28, 20)} fill="none" stroke="#93C5FD" strokeWidth="0.75" strokeDasharray="3 3" opacity="0.7" />
        <polygon points={pts(28, 4, 21, 20)} fill="none" stroke="#93C5FD" strokeWidth="0.75" strokeDasharray="3 3" opacity="0.7" />
        <polygon points={pts(21, 5, 29, 22)} fill="none" stroke="#C084FC" strokeWidth="0.75" strokeDasharray="3 3" opacity="0.7" />
        <polygon points={pts(29, 6, 30, 10, 22)} fill="none" stroke="#67E8F9" strokeWidth="0.75" strokeDasharray="3 3" opacity="0.7" />

        {/* Left Flank Interconnected Triangular Constellation Web */}
        <polygon points={pts(7, 18, 8)} fill="none" stroke="#FF55D2" strokeWidth="0.75" strokeDasharray="3 2" opacity="0.7" />
        <polygon points={pts(8, 23, 9)} fill="none" stroke="#FF8C42" strokeWidth="0.75" strokeDasharray="3 2" opacity="0.7" />
        <polygon points={pts(9, 31, 13)} fill="none" stroke="#FFE066" strokeWidth="0.75" strokeDasharray="3 2" opacity="0.7" />

        {/* Right Flank Interconnected Triangular Constellation Web */}
        <polygon points={pts(10, 22, 11)} fill="none" stroke="#FF55D2" strokeWidth="0.75" strokeDasharray="3 2" opacity="0.7" />
        <polygon points={pts(11, 25, 12)} fill="none" stroke="#FF8C42" strokeWidth="0.75" strokeDasharray="3 2" opacity="0.7" />
        <polygon points={pts(12, 34, 17)} fill="none" stroke="#FFE066" strokeWidth="0.75" strokeDasharray="3 2" opacity="0.7" />

        {/* Lower Geometric Constellations */}
        <polygon points={pts(13, 32, 14, 23)} fill="none" stroke="#C084FC" strokeWidth="0.75" strokeDasharray="3 3" opacity="0.65" />
        <polygon points={pts(14, 15, 24)} fill="none" stroke="#00F5D4" strokeWidth="0.75" strokeDasharray="3 3" opacity="0.65" />
        <polygon points={pts(15, 16, 24)} fill="none" stroke="#00F5D4" strokeWidth="0.75" strokeDasharray="3 3" opacity="0.65" />
        <polygon points={pts(16, 33, 17, 25)} fill="none" stroke="#C084FC" strokeWidth="0.75" strokeDasharray="3 3" opacity="0.65" />

        {/* Behind-the-card Weaving Constellation Paths */}
        <polyline points={pts(18, 19, 20, 21, 22)} fill="none" stroke="#00F5D4" strokeWidth="0.85" strokeDasharray="4 3" opacity="0.6" />
        <polyline points={pts(23, 24, 25)} fill="none" stroke="#FF007F" strokeWidth="0.85" strokeDasharray="4 3" opacity="0.6" />
        <line x1={p(19).x} y1={p(19).y} x2={p(24).x} y2={p(24).y} stroke="#38BDF8" strokeWidth="0.75" strokeDasharray="3 3" opacity="0.55" />
        <line x1={p(21).x} y1={p(21).y} x2={p(24).x} y2={p(24).y} stroke="#38BDF8" strokeWidth="0.75" strokeDasharray="3 3" opacity="0.55" />
        <line x1={p(20).x} y1={p(20).y} x2={p(24).x} y2={p(24).y} stroke="#FFE066" strokeWidth="0.75" strokeDasharray="3 3" opacity="0.55" />
        <line x1={p(7).x} y1={p(7).y} x2={p(20).x} y2={p(20).y} stroke="#00F5D4" strokeWidth="0.7" strokeDasharray="4 3" opacity="0.5" />
        <line x1={p(10).x} y1={p(10).y} x2={p(20).x} y2={p(20).y} stroke="#00F5D4" strokeWidth="0.7" strokeDasharray="4 3" opacity="0.5" />

        {/* ── Concentric Orbital Target Rings on Key Anchor Stars ── */}
        <circle cx={p(1).x} cy={p(1).y} r={8} fill="none" stroke="#FF8C42" strokeWidth="0.7" strokeDasharray="2 2" opacity="0.8" />
        <circle cx={p(6).x} cy={p(6).y} r={8} fill="none" stroke="#C084FC" strokeWidth="0.7" strokeDasharray="2 2" opacity="0.8" />
        <circle cx={p(7).x} cy={p(7).y} r={9} fill="none" stroke="#00F5D4" strokeWidth="0.7" strokeDasharray="2 2" opacity="0.85" />
        <circle cx={p(10).x} cy={p(10).y} r={9} fill="none" stroke="#38BDF8" strokeWidth="0.7" strokeDasharray="2 2" opacity="0.85" />
        <circle cx={p(20).x} cy={p(20).y} r={12} fill="none" stroke="#FFE066" strokeWidth="0.7" strokeDasharray="3 3" opacity="0.7" />
        <circle cx={p(24).x} cy={p(24).y} r={10} fill="none" stroke="#FF55D2" strokeWidth="0.7" strokeDasharray="3 3" opacity="0.7" />

        {/* ── Constellation Star Nodes (Twinkling Dots at Every Vertex) ── */}
        {SURROUND_NODES_CONFIG.map((n) => {
          const pt = p(n.id);
          const color = n.id % 4 === 0 ? '#00F5D4' : n.id % 4 === 1 ? '#FFE066' : n.id % 4 === 2 ? '#FF55D2' : '#FFFFFF';
          return (
            <g key={`star-point-${n.id}`} transform={`translate(${pt.x}, ${pt.y})`}>
              <circle cx="0" cy="0" r="3.8" fill="none" stroke={color} strokeWidth="0.8" opacity="0.75" />
              <circle cx="0" cy="0" r="2.0" fill="#FFFFFF" />
            </g>
          );
        })}

        {/* 45-degree Diamond Cyber-Nodes */}
        <rect x={p(1).x - 2.5} y={p(1).y - 2.5} width="5" height="5" transform={`rotate(45 ${p(1).x} ${p(1).y})`} fill="#FF8C42" />
        <rect x={p(6).x - 2.5} y={p(6).y - 2.5} width="5" height="5" transform={`rotate(45 ${p(6).x} ${p(6).y})`} fill="#C084FC" />
        <rect x={p(7).x - 2.5} y={p(7).y - 2.5} width="5" height="5" transform={`rotate(45 ${p(7).x} ${p(7).y})`} fill="#00F5D4" />
        <rect x={p(10).x - 2.5} y={p(10).y - 2.5} width="5" height="5" transform={`rotate(45 ${p(10).x} ${p(10).y})`} fill="#38BDF8" />
        <rect x={p(15).x - 2.5} y={p(15).y - 2.5} width="5" height="5" transform={`rotate(45 ${p(15).x} ${p(15).y})`} fill="#FFE066" />
        <rect x={p(20).x - 2.5} y={p(20).y - 2.5} width="5" height="5" transform={`rotate(45 ${p(20).x} ${p(20).y})`} fill="#FFFFFF" />
      </g>

      {/* ── 2. GEOMETRIC 3D SHAPES CLUSTERED CLOSELY AROUND MARQUEE CARD ── */}

      {/* 1. Top-Left Corner: Sunset Orange Wireframe Icosahedron */}
      <g transform={`translate(${p(1).x}, ${p(1).y}) scale(${p(1).scale}) rotate(${p(1).rot})`} opacity="0.92" filter="url(#wireGlowOrange)">
        <polygon points="0,-60 52,-18 32,48 -32,48 -52,-18" fill="none" stroke="#FF6B35" strokeWidth="1.6" />
        <line x1="0" y1="-60" x2="0" y2="48" stroke="#FF8C42" strokeWidth="1.2" />
        <line x1="-52" y1="-18" x2="52" y2="-18" stroke="#FF8C42" strokeWidth="1.2" />
        <line x1="0" y1="-60" x2="32" y2="48" stroke="#FF8C42" strokeWidth="1.0" />
        <line x1="0" y1="-60" x2="-32" y2="48" stroke="#FF8C42" strokeWidth="1.0" />
        <circle cx="0" cy="-60" r="2.5" fill="#FFE066" />
        <circle cx="52" cy="-18" r="2.5" fill="#FFE066" />
        <circle cx="-52" cy="-18" r="2.5" fill="#FFE066" />
      </g>

      {/* 2. Top-Left Inner: Golden Wireframe Tetrahedron */}
      <g transform={`translate(${p(2).x}, ${p(2).y}) scale(${p(2).scale}) rotate(${p(2).rot})`} opacity="0.88" filter="url(#wireGlowYellow)">
        <polygon points="0,-38 32,20 -32,20" fill="none" stroke="#FFE066" strokeWidth="1.5" />
        <line x1="0" y1="-38" x2="10" y2="8" stroke="#FFB700" strokeWidth="1.1" />
        <line x1="32" y1="20" x2="10" y2="8" stroke="#FFB700" strokeWidth="1.1" />
        <line x1="-32" y1="20" x2="10" y2="8" stroke="#FFB700" strokeWidth="1.1" />
        <circle cx="10" cy="8" r="2.2" fill="#FFFFFF" />
      </g>

      {/* 3. Top-Center Left: Cyan Crystal Prism */}
      <g transform={`translate(${p(3).x}, ${p(3).y}) scale(${p(3).scale}) rotate(${p(3).rot})`} opacity="0.85" filter="url(#wireGlowCyan)">
        <polygon points="0,-32 24,0 0,32 -24,0" fill="none" stroke="#00F5D4" strokeWidth="1.4" />
        <line x1="0" y1="-32" x2="0" y2="32" stroke="#A5F3FC" strokeWidth="1.0" />
      </g>

      {/* 4. Top-Center Right: Purple Wireframe Octahedron */}
      <g transform={`translate(${p(4).x}, ${p(4).y}) scale(${p(4).scale}) rotate(${p(4).rot})`} opacity="0.85" filter="url(#wireGlowPurple)">
        <polygon points="0,-28 22,0 0,28 -22,0" fill="none" stroke="#A855F7" strokeWidth="1.4" />
        <line x1="-22" y1="0" x2="22" y2="0" stroke="#C084FC" strokeWidth="1.0" />
      </g>

      {/* 5. Top-Right Inner: Electric Yellow Wireframe Pyramid */}
      <g transform={`translate(${p(5).x}, ${p(5).y}) scale(${p(5).scale}) rotate(${p(5).rot})`} opacity="0.88" filter="url(#wireGlowYellow)">
        <polygon points="0,-40 34,20 -34,20" fill="none" stroke="#FFE066" strokeWidth="1.6" />
        <line x1="0" y1="-40" x2="12" y2="26" stroke="#FFC700" strokeWidth="1.1" />
        <line x1="34" y1="20" x2="12" y2="26" stroke="#FFC700" strokeWidth="1.1" />
        <line x1="-34" y1="20" x2="12" y2="26" stroke="#FFC700" strokeWidth="1.1" />
        <circle cx="0" cy="-40" r="2.5" fill="#FFFFFF" />
      </g>

      {/* 6. Top-Right Corner: Radiant Violet Dodecahedron */}
      <g transform={`translate(${p(6).x}, ${p(6).y}) scale(${p(6).scale}) rotate(${p(6).rot})`} opacity="0.92" filter="url(#wireGlowPurple)">
        <polygon points="0,-50 42,-16 26,40 -26,40 -42,-16" fill="none" stroke="#C084FC" strokeWidth="1.6" />
        <line x1="0" y1="-50" x2="26" y2="40" stroke="#A855F7" strokeWidth="1.2" />
        <line x1="0" y1="-50" x2="-26" y2="40" stroke="#A855F7" strokeWidth="1.2" />
        <circle cx="0" cy="-50" r="2.5" fill="#38BDF8" />
      </g>

      {/* 7. Left Flank Upper: Glowing Cyan Infinity Loop */}
      <g transform={`translate(${p(7).x}, ${p(7).y}) scale(${p(7).scale}) rotate(${p(7).rot})`} opacity="0.95" filter="url(#wireGlowCyan)">
        <path
          d="M -34 0 C -34 -18 -16 -18 0 0 C 16 18 34 18 34 0 C 34 -18 16 -18 0 0 C -16 18 -34 18 -34 0 Z"
          fill="none"
          stroke="#00F5D4"
          strokeWidth="3.2"
        />
        <circle cx="0" cy="0" r="2.5" fill="#FFFFFF" />
      </g>

      {/* 8. Left Flank Mid: Hot Pink 3D Wireframe Cube */}
      <g transform={`translate(${p(8).x}, ${p(8).y}) scale(${p(8).scale}) rotate(${p(8).rot})`} opacity="0.88" filter="url(#wireGlowMagenta)">
        <polygon points="-26,-26 16,-26 34,-8 -8,-8" fill="none" stroke="#FF007F" strokeWidth="1.6" />
        <polygon points="-8,-8 34,-8 34,34 -8,34" fill="none" stroke="#FF55D2" strokeWidth="1.6" />
        <polygon points="-26,-26 -8,-8 -8,34 -26,16" fill="none" stroke="#FF007F" strokeWidth="1.6" />
        <circle cx="34" cy="-8" r="2.5" fill="#00F5D4" />
      </g>

      {/* 9. Left Flank Lower: Electric Purple 3D Wireframe Octahedron */}
      <g transform={`translate(${p(9).x}, ${p(9).y}) scale(${p(9).scale}) rotate(${p(9).rot})`} opacity="0.88" filter="url(#wireGlowPurple)">
        <polygon points="0,-45 38,-7 25,35 -25,35 -38,-7" fill="none" stroke="#A855F7" strokeWidth="1.6" />
        <line x1="0" y1="-45" x2="0" y2="35" stroke="#C084FC" strokeWidth="1.1" />
        <line x1="-38" y1="-7" x2="38" y2="-7" stroke="#C084FC" strokeWidth="1.1" />
        <circle cx="0" cy="-45" r="2.5" fill="#FFE066" />
      </g>

      {/* 10. Right Flank Upper: Sky Blue 3D Wireframe Cube */}
      <g transform={`translate(${p(10).x}, ${p(10).y}) scale(${p(10).scale}) rotate(${p(10).rot})`} opacity="0.90" filter="url(#wireGlowCyan)">
        <polygon points="-28,-28 16,-28 36,-8 -8,-8" fill="none" stroke="#38BDF8" strokeWidth="1.6" />
        <polygon points="-8,-8 36,-8 36,36 -8,36" fill="none" stroke="#00F5D4" strokeWidth="1.6" />
        <polygon points="-28,-28 -8,-8 -8,36 -28,16" fill="none" stroke="#0284C7" strokeWidth="1.6" />
        <circle cx="36" cy="-8" r="2.5" fill="#FFFFFF" />
      </g>

      {/* 11. Right Flank Mid: Cyan Wireframe Hexagon Star */}
      <g transform={`translate(${p(11).x}, ${p(11).y}) scale(${p(11).scale}) rotate(${p(11).rot})`} opacity="0.88" filter="url(#wireGlowCyan)">
        <polygon points="0,-28 26,-14 26,14 0,28 -26,14 -26,-14" fill="none" stroke="#00F5D4" strokeWidth="1.5" />
        <line x1="0" y1="-28" x2="0" y2="28" stroke="#A5F3FC" strokeWidth="1.0" />
        <circle cx="0" cy="0" r="2.5" fill="#FFE066" />
      </g>

      {/* 12. Right Flank Lower: Sunset Orange Wireframe Icosahedron */}
      <g transform={`translate(${p(12).x}, ${p(12).y}) scale(${p(12).scale}) rotate(${p(12).rot})`} opacity="0.88" filter="url(#wireGlowOrange)">
        <polygon points="0,-42 38,-12 22,34 -22,34 -38,-12" fill="none" stroke="#FF6B35" strokeWidth="1.6" />
        <line x1="0" y1="-42" x2="0" y2="34" stroke="#FFA057" strokeWidth="1.1" />
        <circle cx="0" cy="-42" r="2.5" fill="#FFE066" />
      </g>

      {/* 13. Bottom-Left Corner: Golden Diamond Wireframe Prism */}
      <g transform={`translate(${p(13).x}, ${p(13).y}) scale(${p(13).scale}) rotate(${p(13).rot})`} opacity="0.88" filter="url(#wireGlowOrange)">
        <polygon points="0,-32 26,0 0,32 -26,0" fill="none" stroke="#FFA057" strokeWidth="1.5" />
        <line x1="0" y1="-32" x2="0" y2="32" stroke="#FFE066" strokeWidth="1.0" />
        <circle cx="0" cy="0" r="2.5" fill="#00F5D4" />
      </g>

      {/* 14. Bottom-Mid Left: Mini Cyan Geodesic Node */}
      <g transform={`translate(${p(14).x}, ${p(14).y}) scale(${p(14).scale}) rotate(${p(14).rot})`} opacity="0.85" filter="url(#wireGlowCyan)">
        <polygon points="0,-24 20,-10 20,10 0,24 -20,10 -20,-10" fill="none" stroke="#00F5D4" strokeWidth="1.4" />
        <circle cx="0" cy="0" r="2.2" fill="#FFFFFF" />
      </g>

      {/* 15. Bottom-Center: Golden Diamond Base Pin */}
      <g transform={`translate(${p(15).x}, ${p(15).y}) scale(${p(15).scale}) rotate(${p(15).rot})`} opacity="0.88" filter="url(#wireGlowYellow)">
        <polygon points="0,-26 24,0 0,26 -24,0" fill="none" stroke="#FFE066" strokeWidth="1.5" />
        <circle cx="0" cy="0" r="2.2" fill="#00F5D4" />
      </g>

      {/* 16. Bottom-Mid Right: Mini Magenta Octahedron */}
      <g transform={`translate(${p(16).x}, ${p(16).y}) scale(${p(16).scale}) rotate(${p(16).rot})`} opacity="0.85" filter="url(#wireGlowMagenta)">
        <polygon points="0,-24 18,0 0,24 -18,0" fill="none" stroke="#FF007F" strokeWidth="1.4" />
        <line x1="-18" y1="0" x2="18" y2="0" stroke="#FF55D2" strokeWidth="1.0" />
      </g>

      {/* 17. Bottom-Right Corner: Amber Wireframe Tetrahedron */}
      <g transform={`translate(${p(17).x}, ${p(17).y}) scale(${p(17).scale}) rotate(${p(17).rot})`} opacity="0.88" filter="url(#wireGlowYellow)">
        <polygon points="0,-32 26,16 -26,16" fill="none" stroke="#FFB700" strokeWidth="1.5" />
        <line x1="0" y1="-32" x2="8" y2="6" stroke="#FFE066" strokeWidth="1.0" />
        <circle cx="8" cy="6" r="2.0" fill="#FFFFFF" />
      </g>
    </svg>
  );
}

// ─── 8.6. ALLISON AI INTRODUCTION SCREEN (BIG ANIMATED CENTRAL AUDIOWAVE) ─────
type AllisonSentence = {
  text: string;
  startTime: number;
  duration: number;
};

const ALLISON_LINE_SENTENCES: Record<number, AllisonSentence[]> = {
  1: [
    {
      text: "Hey, everyone! I’m Allison.",
      startTime: 0,
      duration: 2.6
    },
    {
      text: "Honestly, I’ve been looking forward to this all month—it’s great to finally be here with you all.",
      startTime: 2.6,
      duration: 5.9
    }
  ],
  2: [
    {
      text: "Very funny! Don't worry, my numbers are shuffled and my systems are good to go.",
      startTime: 0,
      duration: 7.2
    },
    {
      text: "Though I have to admit… I can crunch the math in milliseconds, but I still rely on you humans to actually spot the patterns and call out BINGO!",
      startTime: 7.2,
      duration: 9.0
    }
  ],
  3: [
    {
      text: "Couldn't have said it better myself.",
      startTime: 0,
      duration: 2.6
    },
    {
      text: "Think of me as your ultimate game partner today.",
      startTime: 2.6,
      duration: 3.6
    },
    {
      text: "Ready to jump in and make some history together? Let’s do this!",
      startTime: 6.2,
      duration: 4.2
    }
  ],
  4: [
    {
      text: "I'd be glad to!",
      startTime: 0,
      duration: 1.4
    },
    {
      text: "Here's how we're playing today.",
      startTime: 1.6,
      duration: 1.74
    }
  ]
};

function BigCentralAudioWave({
  isSpeaking,
  activeLine = 1,
  elapsedTime = 0
}: {
  isSpeaking: boolean;
  activeLine?: number;
  elapsedTime?: number;
}) {
  // Track real-time speech amplitude & pauses from pre-extracted 50ms audio profiles
  const activeProfile = ALLISON_AUDIO_PROFILES[activeLine];
  let currentAmp = 0;
  if (isSpeaking && activeProfile && elapsedTime > 0) {
    const bucketIndex = Math.floor(elapsedTime / (activeProfile.bucketMs / 1000));
    if (bucketIndex >= 0 && bucketIndex < activeProfile.envelopes.length) {
      currentAmp = activeProfile.envelopes[bucketIndex];
    }
  }

  // Active vocalization vs. pause/silence:
  // When quiet or in a speech gap, it smoothly reverts back to the original sound wave!
  const isVocalizing = isSpeaking && currentAmp > 0.08;

  // 38 sleek vertical equalizer bars arranged horizontally.
  // Instead of a smooth curve, adjacent bars alternate between tall peaks and shorter valleys
  // matching an authentic digital frequency spectrum analyzer (and the reference image).
  const SPEAKING_HEIGHTS_38 = [
    30, 42, 58, 42, 74, 52, 94, 64, 118, 80, 142, 92, 158, 112, 168, 124, 174, 132, 178,
    178, 132, 174, 124, 168, 112, 158, 92, 142, 80, 118, 64, 94, 52, 74, 42, 58, 42, 30
  ];
  const totalBars = SPEAKING_HEIGHTS_38.length;
  const bars = useMemo(() => {
    return Array.from({ length: totalBars }, (_, i) => {
      // Sleek, uniform horizontal line when idle / paused (28px to 32px)
      const flatHeight = Math.round(30 + Math.sin(i * 0.5) * 2.5);
      const speakingHeight = SPEAKING_HEIGHTS_38[i];
      
      const delay = (((i * 7) % 13) * 0.04).toFixed(2);
      const idleDuration = (2.6 + ((i * 3) % 5) * 0.25).toFixed(2);
      const activeDuration = (0.28 + ((i * 5) % 8) * 0.045).toFixed(2);
      return { id: i, flatHeight, speakingHeight, idleDuration, activeDuration, delay };
    });
  }, []);

  return (
    <div className="relative w-full max-w-5xl xl:max-w-6xl h-48 md:h-56 flex items-center justify-center select-none my-1">
      {/* Background Subtle Horizontal Glow Beam */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="absolute w-full h-12 bg-gradient-to-r from-transparent via-[#00F5D4]/15 to-transparent blur-2xl" />
        <div className="absolute w-3/4 h-10 bg-gradient-to-r from-transparent via-[#FF007F]/15 to-transparent blur-2xl" />
        {/* Sleek rotating ring around center core */}
        <div
          className={`absolute w-36 h-36 md:w-40 md:h-40 rounded-full border border-cyan-400/30 border-dashed animate-spin transition-opacity duration-300 ${
            isVocalizing ? 'opacity-100' : 'opacity-40'
          }`}
          style={{ animationDuration: isVocalizing ? '10s' : '26s' }}
        />
      </div>

      {/* Symmetrical Soundwave Spectrum: Flat Line at Rest, Jagged Spectrum Bars when Speaking */}
      <div className="relative z-10 w-full flex items-center justify-center gap-1.5 sm:gap-2 md:gap-2.5 px-4 h-full">
        {bars.map((b) => (
          <div
            key={b.id}
            className="w-2 sm:w-2.5 md:w-3 rounded-full relative origin-center"
            style={{
              height: `${isVocalizing ? b.speakingHeight : b.flatHeight}px`,
              background: 'linear-gradient(to top, #00F5D4 0%, #00B4D8 25%, #8B5CF6 50%, #D946EF 75%, #FF007F 90%, #FFE066 100%)',
              boxShadow: isVocalizing
                ? '0 0 14px rgba(255, 0, 127, 0.9), 0 0 22px rgba(0, 245, 212, 0.6)'
                : '0 0 4px rgba(0, 245, 212, 0.35)',
              animationName: isVocalizing ? 'allison-wave-active' : 'allison-wave-idle',
              animationDuration: isVocalizing ? `${b.activeDuration}s` : `${b.idleDuration}s`,
              animationDelay: `${b.delay}s`,
              animationIterationCount: 'infinite',
              animationTimingFunction: 'ease-in-out',
              transition: 'height 0.32s cubic-bezier(0.34, 1.3, 0.64, 1), box-shadow 0.3s ease'
            }}
          />
        ))}

        {/* Center Floating Audio Core Orb */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none">
          {/* Ambient luminous halo when vocalizing */}
          {isVocalizing && (
            <div className="absolute -inset-4 rounded-full bg-[#00F5D4]/35 blur-xl animate-pulse pointer-events-none" />
          )}

          <div
            className={`relative w-24 h-24 md:w-28 md:h-28 rounded-full flex flex-col items-center justify-center backdrop-blur-md transition-all duration-300 ${
              isVocalizing
                ? 'border-2 border-white bg-gradient-to-b from-[#1C1630] via-[#0E0A1E] to-[#080414] shadow-[0_0_40px_#00F5D4,0_0_70px_rgba(217,70,239,0.8),inset_0_0_24px_rgba(0,245,212,0.6)]'
                : 'border border-cyan-400/50 bg-gradient-to-b from-[#161228] via-[#0A0718] to-[#050310] shadow-[0_0_18px_rgba(0,245,212,0.3),inset_0_0_12px_rgba(0,245,212,0.15)]'
            }`}
          >
            {/* Concentric inner ring */}
            <div
              className={`absolute inset-2 rounded-full border border-dotted animate-spin transition-colors duration-300 ${
                isVocalizing
                  ? 'border-[#00F5D4] opacity-100 drop-shadow-[0_0_8px_#00F5D4]'
                  : 'border-fuchsia-500/40 opacity-60'
              }`}
              style={{ animationDuration: isVocalizing ? '8s' : '20s' }}
            />

            {/* Center Animated Voice Core Icon */}
            <Radio
              className={`w-7 h-7 md:w-8 md:h-8 transition-all duration-300 ${
                isVocalizing
                  ? 'text-white drop-shadow-[0_0_14px_#00F5D4] drop-shadow-[0_0_28px_rgba(0,245,212,0.9)] animate-pulse'
                  : 'text-cyan-400/60 drop-shadow-[0_0_5px_rgba(0,245,212,0.3)]'
              }`}
            />

            <span
              className={`font-telemetry text-[8.5px] md:text-[9.5px] font-black tracking-wider uppercase mt-1 transition-all duration-300 ${
                isVocalizing
                  ? 'text-white drop-shadow-[0_0_8px_#00F5D4] tracking-widest'
                  : 'text-cyan-400/50'
              }`}
            >
              {isVocalizing ? 'SPEAKING' : 'AUDIO CORE'}
            </span>
          </div>
        </div>
      </div>

      {/* Top & Bottom Cyber Grid Frequency Markers */}
      <div className="absolute top-0 left-8 right-8 flex justify-between text-[8.5px] font-mono text-cyan-400/70 tracking-widest pointer-events-none">
        <span>FREQ: 1420.00 MHz</span>
        <span className="text-fuchsia-400 font-bold">▲ 0 dB PEAK</span>
        <span>DSP: QUANTUM-SYNC</span>
      </div>
      <div className="absolute bottom-0 left-8 right-8 flex justify-between text-[8.5px] font-mono text-cyan-400/70 tracking-widest pointer-events-none">
        <span>SAMPLING: 44.1 kHz</span>
        <span className="text-emerald-400 font-bold">CORE: ONLINE</span>
        <span>LATENCY: 0.2 ms</span>
      </div>
    </div>
  );
}

function AllisonIntroScreen({
  activeLine,
  isSpeaking,
  audioRef
}: {
  activeLine: number;
  isSpeaking: boolean;
  audioRef?: React.RefObject<HTMLAudioElement | null>;
}) {
  const [elapsedTime, setElapsedTime] = useState(0);

  useEffect(() => {
    if (!isSpeaking) {
      setElapsedTime(0);
      return;
    }
    let rafId: number;
    const startPerf = performance.now();
    const tick = () => {
      if (audioRef?.current && !audioRef.current.paused && audioRef.current.currentTime > 0) {
        setElapsedTime(audioRef.current.currentTime);
      } else {
        setElapsedTime((performance.now() - startPerf) / 1000);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isSpeaking, activeLine, audioRef]);

  // Determine current active single sentence
  const sentences = ALLISON_LINE_SENTENCES[activeLine] ?? ALLISON_LINE_SENTENCES[1];
  const activeSentence =
    sentences.find((s) => elapsedTime >= s.startTime && elapsedTime < s.startTime + s.duration) ||
    sentences[sentences.length - 1];

  // Calculate typewriter character count
  const sentenceElapsed = Math.max(0, elapsedTime - activeSentence.startTime);
  const typingProgress = Math.min(1, sentenceElapsed / (activeSentence.duration * 0.85));
  const charCount = Math.floor(typingProgress * activeSentence.text.length);
  const displayedText = isSpeaking ? activeSentence.text.slice(0, charCount) : '';

  // Right margin soundwave configurations (matching Image 3)
  const rightHorizBars = [6, 10, 16, 22, 28, 32, 36, 32, 28, 22, 16, 10, 6];
  const rightSpindleBars = [6, 10, 14, 18, 24, 30, 36, 40, 44, 40, 36, 30, 24, 18, 14, 10, 6];

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-between relative overflow-hidden select-none"
      style={{
        background: 'radial-gradient(ellipse at 50% 46%, #220738 0%, #130324 45%, #070012 100%)'
      }}
    >
      {/* ── 1. CLEAN MOVING PERSPECTIVE FLOOR & STATIC CORRIDOR RAYS ── */}
      <MovingPerspectiveFloorGrid />

      {/* ── 2. LIVING ANIMATED CONSTELLATION WEB & FLOATING 3D SHAPES (CLUSTERED SURROUND - IMAGE 4) ── */}
      <SecondScreenSurroundingMatrix />

      {/* ── 3. LEFT MARGIN: FAITHFUL CYBER TELEMETRY & SOUNDWAVE MODULE (IMAGE 2) ── */}
      <CyberTelemetrySidebar />

      {/* ── 4. RIGHT MARGIN: DYNAMIC HUD TELEMETRY CLUSTERS (IMAGE 3) ── */}
      {/* Cluster 2: Upper Right (Ceiling Grid Depth) */}
      <div
        className="absolute top-7 right-32 z-10 pointer-events-none hidden md:block font-telemetry text-[11px] leading-tight text-[#38BDF8] drop-shadow-[0_0_6px_#38BDF8] text-right animate-incandescent"
        style={{ animationDelay: '1.4s' }}
      >
        <div className="opacity-80">0492024.110</div>
        <div className="opacity-70">11-23-4 0004-611</div>
        <div className="text-cyan-300">ID: 68307</div>
        <div className="text-emerald-400 font-bold">10101</div>
      </div>

      {/* Cluster 3: Mid-Right */}
      <div
        className="absolute top-28 right-20 z-10 pointer-events-none hidden lg:block font-telemetry text-[11px] leading-tight text-[#38BDF8] drop-shadow-[0_0_6px_#38BDF8] text-right animate-incandescent"
        style={{ animationDelay: '2.2s' }}
      >
        <div className="text-[#67E8F9] font-bold">0492024.110</div>
        <div className="opacity-80">STAT: 11AGUO40E</div>
        <div className="opacity-70">PROGRAM: T&amp;E00</div>
        <div className="text-amber-300 opacity-90">GENIS: 049.80est.</div>
        <div className="flex items-center justify-end gap-1.5 mt-0.5">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_6px_#EF4444] animate-ping" />
          <span className="text-red-400 font-bold text-[10px]">RECON.SYNC</span>
        </div>
      </div>

      {/* Cluster 5: Lower Right */}
      <div
        className="absolute bottom-20 right-28 z-10 pointer-events-none hidden lg:block font-telemetry text-[10px] leading-tight text-cyan-400/80 drop-shadow-[0_0_5px_#38BDF8] text-right animate-incandescent"
        style={{ animationDelay: '3.6s' }}
      >
        <div className="opacity-70">DATA.STREAM // 010110</div>
        <div className="text-emerald-400 font-bold">MATRIX: RESOLVED</div>
        <div className="text-[#67E8F9]">CH-04 ONLINE</div>
      </div>

      {/* ── 5. RIGHT MARGIN BORDER: SOUND WAVES & CLASSY PIXEL MATH SYMBOLS (IMAGE 3) ── */}
      <div className="absolute right-4 md:right-6 top-0 bottom-0 z-20 flex flex-col justify-between items-center py-5 pointer-events-none w-20">
        {/* Top-Right Group: Sqrt, Infinity + HORIZONTAL Soundwave Packet */}
        <div className="flex items-center gap-2 mt-1">
          <div className="flex flex-col items-center">
            <span className="font-pixel-math text-2xl md:text-3xl text-[#FFA057] select-none animate-border-symbol">
              √
            </span>
            <span className="font-pixel-math text-2xl md:text-3xl text-[#FFA057] select-none animate-border-symbol" style={{ animationDelay: '0.4s' }}>
              ∞
            </span>
          </div>
          <div className="flex items-center gap-[2.5px] h-9 px-1">
            {rightHorizBars.map((h, i) => (
              <div
                key={`allison-h-top-r-${i}`}
                className="w-[2.5px] bg-gradient-to-t from-[#FF6B35] via-[#FF8C42] to-[#FFE066] rounded-full shadow-[0_0_6px_#FF6B35]"
                style={{
                  height: `${h}px`,
                  animation: `soundwave-h-fluctuate ${0.85 + (i % 4) * 0.2}s ease-in-out infinite ${(i * 0.08).toFixed(2)}s`,
                  transformOrigin: 'center'
                }}
              />
            ))}
          </div>
        </div>

        {/* Center-Right Group: Pi + VERTICAL Soundwave Spindle + Integral */}
        <div className="flex flex-col items-center gap-3 my-auto">
          {/* Right VERTICAL Soundwave Spindle (horizontal bars stacked vertically) */}
          <div className="flex flex-col items-center gap-[2.5px] my-2 px-1">
            {rightSpindleBars.map((w, i) => (
              <div
                key={`allison-v-spindle-right-${i}`}
                className="h-[2.5px] bg-gradient-to-r from-[#FF6B35] via-[#FF8C42] to-[#FFE066] rounded-full shadow-[0_0_6px_#FF6B35]"
                style={{
                  width: `${w}px`,
                  animation: `soundwave-v-spindle-fluctuate ${0.95 - (i % 5) * 0.15}s ease-in-out infinite ${(i * 0.08).toFixed(2)}s`,
                  transformOrigin: 'center'
                }}
              />
            ))}
          </div>

          <span className="font-pixel-math text-2xl md:text-3xl text-[#FFA057] select-none animate-border-symbol" style={{ animationDelay: '1.4s' }}>
            π
          </span>
          <span className="font-pixel-math text-3xl md:text-4xl text-[#FFA057] select-none animate-border-symbol" style={{ animationDelay: '2.0s' }}>
            ∫
          </span>
        </div>

        {/* Bottom-Right Group: Pi, Sqrt, Infinity + HORIZONTAL Soundwave Packet */}
        <div className="flex items-center gap-1.5 mb-1">
          <div className="flex items-center gap-1">
            <span className="font-pixel-math text-xl md:text-2xl text-[#FFA057] select-none animate-border-symbol" style={{ animationDelay: '2.6s' }}>
              π
            </span>
            <span className="font-pixel-math text-xl md:text-2xl text-[#FFA057] select-none animate-border-symbol" style={{ animationDelay: '2.9s' }}>
              √
            </span>
            <span className="font-pixel-math text-xl md:text-2xl text-[#FFA057] select-none animate-border-symbol" style={{ animationDelay: '3.2s' }}>
              ∞
            </span>
          </div>
          <div className="flex items-center gap-[2.5px] h-9 px-1">
            {rightHorizBars.map((h, i) => (
              <div
                key={`allison-h-bot-r-${i}`}
                className="w-[2.5px] bg-gradient-to-t from-[#FF6B35] via-[#FF8C42] to-[#FFE066] rounded-full shadow-[0_0_6px_#FF6B35]"
                style={{
                  height: `${h}px`,
                  animation: `soundwave-h-fluctuate ${0.82 + (i % 4) * 0.22}s ease-in-out infinite ${(i * 0.09).toFixed(2)}s`,
                  transformOrigin: 'center'
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Top Header Pill */}
      <div className="w-full flex items-center justify-center pt-5 z-20">
        <div className="px-6 py-1.5 rounded-full border border-fuchsia-500/50 bg-[#09001A]/80 backdrop-blur-md shadow-[0_0_20px_rgba(217,70,239,0.4)] flex items-center gap-2.5">
          <span className={`w-2 h-2 rounded-full ${isSpeaking ? 'bg-emerald-400 animate-ping' : 'bg-fuchsia-400 animate-pulse'}`} />
          <span className="font-arcade text-xs md:text-sm font-black text-fuchsia-300 tracking-[0.25em] uppercase drop-shadow-[0_0_8px_#D946EF]">
            ARETE 2026 // AUTONOMOUS AI CO-HOST
          </span>
        </div>
      </div>

      {/* Center Stage: Title + Big Animated Audiowave (Surrounded by shapes & lines) + Wide Subtitle Card */}
      {/* Shifted lower down to gracefully occupy the space vacated by the proceed button */}
      <div className="flex-1 w-full flex flex-col items-center justify-center px-4 z-20 pt-8 sm:pt-10 pb-4 translate-y-6 sm:translate-y-8 md:translate-y-10 my-auto">
        {/* Chrome Title "ALLISON" */}
        <div className="text-center mb-0 relative">
          <h1
            className="font-arcade text-4xl sm:text-5xl md:text-6xl font-black uppercase tracking-[0.22em] text-transparent bg-clip-text bg-gradient-to-b from-white via-[#00F5D4] to-[#A855F7]"
            style={{
              filter: 'drop-shadow(0 0 25px rgba(0,245,212,0.8)) drop-shadow(0 0 50px rgba(168,85,247,0.6))',
              letterSpacing: '0.22em'
            }}
          >
            ALLISON
          </h1>
          <p className="font-telemetry text-xs sm:text-sm text-cyan-300 font-bold tracking-[0.3em] uppercase mt-0.5 drop-shadow-[0_0_8px_#00F5D4]">
            DIGITAL EMCEE &amp; ARITHMETIC INTELLECT
          </p>
        </div>

        {/* ── THE BIG ANIMATED AUDIOWAVE (AT THE CENTER OF THE SURROUNDING SHAPES) ── */}
        <BigCentralAudioWave isSpeaking={isSpeaking} activeLine={activeLine} elapsedTime={elapsedTime} />

        {/* ── WIDE HORIZONTAL DIALOGUE SUBTITLE CARD (STRETCHED WIDE ACROSS SCREEN) ── */}
        <div className="w-full max-w-5xl 2xl:max-w-6xl px-4 z-20 mt-2 mb-1">
          <div className="hud-notched-frame relative rounded-2xl border-2 border-[#00F5D4] bg-gradient-to-b from-[#02131F]/95 via-[#031B2C]/95 to-[#010D17]/95 px-6 py-4 md:px-8 md:py-5 shadow-[0_0_45px_rgba(0,245,212,0.55),0_0_15px_rgba(56,189,248,0.7),inset_0_0_30px_rgba(0,245,212,0.20)] backdrop-blur-xl">
            {/* 4 Gold Tech Corner Brackets */}
            <div className="absolute top-2.5 left-2.5 w-3.5 h-3.5 border-t-2 border-l-2 border-[#FFE066] drop-shadow-[0_0_6px_#FFE066] pointer-events-none" />
            <div className="absolute top-2.5 right-2.5 w-3.5 h-3.5 border-t-2 border-r-2 border-[#FFE066] drop-shadow-[0_0_6px_#FFE066] pointer-events-none" />
            <div className="absolute bottom-2.5 left-2.5 w-3.5 h-3.5 border-b-2 border-l-2 border-[#FFE066] drop-shadow-[0_0_6px_#FFE066] pointer-events-none" />
            <div className="absolute bottom-2.5 right-2.5 w-3.5 h-3.5 border-b-2 border-r-2 border-[#FFE066] drop-shadow-[0_0_6px_#FFE066] pointer-events-none" />

            {/* Center Top Header: "ALLISON SPEAKING" — Lights up when speaking, transparent when not speaking! */}
            <div
              className={`flex items-center justify-center pb-2 mb-2 border-b transition-all duration-300 ${
                isSpeaking
                  ? 'border-[#00F5D4]/40 opacity-100'
                  : 'border-transparent opacity-0 pointer-events-none select-none'
              }`}
            >
              <span className="font-arcade text-base sm:text-lg md:text-xl font-black tracking-[0.3em] uppercase text-transparent bg-clip-text bg-gradient-to-r from-[#00F5D4] via-white to-[#00F5D4] drop-shadow-[0_0_16px_#00F5D4] drop-shadow-[0_0_30px_rgba(0,245,212,0.85)] animate-pulse">
                ALLISON SPEAKING
              </span>
            </div>

            {/* Single Sentence Spoken — Animated Typing Effect */}
            <div className="min-h-[85px] md:min-h-[105px] flex items-center justify-center px-2 py-1 text-center">
              {isSpeaking ? (
                <p className="font-arcade text-lg sm:text-xl md:text-2xl 2xl:text-3xl text-white font-bold leading-relaxed tracking-wide text-center drop-shadow-[0_0_14px_rgba(255,255,255,0.45)]">
                  "{displayedText}"
                  <span className="inline-block w-2.5 h-5 md:h-6 ml-1.5 bg-[#00F5D4] shadow-[0_0_10px_#00F5D4] animate-pulse align-middle" />
                </p>
              ) : (
                /* Reverts into typing standby mode when not speaking */
                <div className="flex items-center justify-center gap-2">
                  <span className="font-telemetry text-xs sm:text-sm md:text-base text-cyan-400/60 font-bold tracking-[0.25em] uppercase">
                    // SYSTEM STANDBY · AWAITING TRANSMISSION
                  </span>
                  <span className="inline-block w-2.5 h-5 md:h-6 bg-[#00F5D4] shadow-[0_0_10px_#00F5D4] animate-pulse align-middle" />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="h-2 w-full" />
    </div>
  );
}



// ─── 9. SECOND MAIN TITLE SCREEN (SYSTEMS ONLINE!) ───────────────────────────
function SecondMainTitleScreen({
  round,
  onConfirm
}: {
  round: number;
  onConfirm: () => void;
}) {
  const currentRound = Math.min(5, Math.max(1, round || 1));
  const onConfirmRef = useRef(onConfirm);
  useEffect(() => {
    onConfirmRef.current = onConfirm;
  }, [onConfirm]);

  const voiceRef = useRef<HTMLAudioElement | null>(null);
  const hasAdvancedRef = useRef(false);
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const advanceToSequence = () => {
    if (hasAdvancedRef.current) return;
    hasAdvancedRef.current = true;
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = null;
    }
    if (voiceRef.current) {
      voiceRef.current.pause();
      voiceRef.current.src = '';
      voiceRef.current = null;
    }
    if (!isPreviewMode) {
      onConfirmRef.current();
    }
  };

  // Play Allison's Round Hype voice when screen is shown; auto-advance when 100% done speaking
  useEffect(() => {
    hasAdvancedRef.current = false;
    if (isPreviewMode) {
      // In preview mode (Admin iframe), do not auto-advance or play audio; live stage drives state
      return;
    }

    const voice = new Audio(`/audio/hype/round_${currentRound}_hype.mp3`);
    voice.volume = 1.0;
    voiceRef.current = voice;

    // When Allison is 100% done speaking, wait a brief 400ms pause and automatically go to generating sequence screen
    voice.onended = () => {
      console.log(`[STAGE] Allison Hype voice for round ${currentRound} finished speaking naturally.`);
      transitionTimeoutRef.current = setTimeout(() => {
        advanceToSequence();
      }, 400);
    };

    voice.onerror = (err) => {
      console.warn('Hype audio error:', err);
      // Generous fallback only if audio fails to load completely
      transitionTimeoutRef.current = setTimeout(() => {
        advanceToSequence();
      }, 15000);
    };

    voice.play().then(() => {
      console.log('[STAGE] Playing Allison Hype voice for round', currentRound);
    }).catch(e => {
      console.warn('Hype audio playback note:', e);
      // Do NOT cut Allison off with a short timeout; wait generous time or user can press Space/Enter
      transitionTimeoutRef.current = setTimeout(() => {
        advanceToSequence();
      }, 15000);
    });

    return () => {
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
        transitionTimeoutRef.current = null;
      }
      if (voiceRef.current) {
        voiceRef.current.pause();
        voiceRef.current.src = '';
        voiceRef.current = null;
      }
    };
  }, [currentRound]);

  // Keyboard navigation (optional manual skip)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        advanceToSequence();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <ArenaStadiumBackground>
      {/* ── LIVING GEOMETRIC CONSTELLATION WEB SURROUNDING MARQUEE & SPANNING ENTIRE ARENA ── */}
      <SecondScreenSurroundingMatrix />

      <div className="relative z-10 flex flex-col items-center justify-between h-full flex-1 w-full max-w-5xl mx-auto py-1 select-none">
        {/* ── TOP SECTION: TAGLINE & DUAL-TUBE TITLE ── */}
        <div className="flex flex-col items-center text-center w-full">
          {/* Arched / Neon Top Tagline */}
          <div className="font-arcade text-[#FF55D2] text-lg sm:text-xl md:text-2xl font-black uppercase tracking-[0.28em] drop-shadow-[0_0_12px_#FF007F] mb-0.5">
            PREPARE YOURSELVES!
          </div>

          {/* SYSTEMS ONLINE! Title */}
          <div className="relative w-full max-w-4xl flex items-center justify-center my-0.5">
            {/* Title Text SVG: SYSTEMS ONLINE! (Non-blinding, crisp retro chrome) */}
            <svg viewBox="0 0 1000 100" className="w-full max-w-4xl h-16 md:h-22 overflow-visible select-none">
              <defs>
                <linearGradient id="systemsOnlineFill" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#A5F3FC" />
                  <stop offset="25%" stopColor="#38BDF8" />
                  <stop offset="48%" stopColor="#0284C7" />
                  <stop offset="50%" stopColor="#061B30" />
                  <stop offset="54%" stopColor="#0B132B" />
                  <stop offset="80%" stopColor="#0F172A" />
                  <stop offset="100%" stopColor="#0284C7" />
                </linearGradient>
                <filter id="systemsOnlineSoftGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#00F5D4" floodOpacity="0.45" />
                  <feDropShadow dx="0" dy="0" stdDeviation="8" floodColor="#FF6B35" floodOpacity="0.4" />
                </filter>
              </defs>

              {/* Layer 1: Outer Warm Orange Neon Tube Stroke */}
              <text
                x="500"
                y="76"
                textAnchor="middle"
                style={{
                  fontFamily: "'Boogaloo', 'Audiowide', sans-serif",
                  fontWeight: 900,
                  fontSize: '78px',
                  letterSpacing: '3px'
                }}
                fill="none"
                stroke="#FF6B35"
                strokeWidth="12"
                strokeLinejoin="round"
                filter="url(#systemsOnlineSoftGlow)"
              >
                SYSTEMS ONLINE!
              </text>

              {/* Layer 2: Dark Channel Gap */}
              <text
                x="500"
                y="76"
                textAnchor="middle"
                style={{
                  fontFamily: "'Boogaloo', 'Audiowide', sans-serif",
                  fontWeight: 900,
                  fontSize: '78px',
                  letterSpacing: '3px'
                }}
                fill="none"
                stroke="#090014"
                strokeWidth="7"
                strokeLinejoin="round"
              >
                SYSTEMS ONLINE!
              </text>

              {/* Layer 3: Inner Cyan Neon Tube */}
              <text
                x="500"
                y="76"
                textAnchor="middle"
                style={{
                  fontFamily: "'Boogaloo', 'Audiowide', sans-serif",
                  fontWeight: 900,
                  fontSize: '78px',
                  letterSpacing: '3px'
                }}
                fill="none"
                stroke="#00E5FF"
                strokeWidth="3"
                strokeLinejoin="round"
              >
                SYSTEMS ONLINE!
              </text>

              {/* Layer 4: Crisp Dark Contour for Razor-Sharp Readability */}
              <text
                x="500"
                y="76"
                textAnchor="middle"
                style={{
                  fontFamily: "'Boogaloo', 'Audiowide', sans-serif",
                  fontWeight: 900,
                  fontSize: '78px',
                  letterSpacing: '3px'
                }}
                fill="none"
                stroke="#050014"
                strokeWidth="2"
                strokeLinejoin="round"
              >
                SYSTEMS ONLINE!
              </text>

              {/* Layer 5: Ice Sky Blue Chrome Fill */}
              <text
                x="500"
                y="76"
                textAnchor="middle"
                style={{
                  fontFamily: "'Boogaloo', 'Audiowide', sans-serif",
                  fontWeight: 900,
                  fontSize: '78px',
                  letterSpacing: '3px'
                }}
                fill="url(#systemsOnlineFill)"
              >
                SYSTEMS ONLINE!
              </text>
            </svg>
          </div>
        </div>

        {/* ── CENTER SECTION: HIGH-CONTRAST CYBER MARQUEE DISPLAY PANEL ── */}
        <div className="relative w-full max-w-3xl my-3 pt-4">
          {/* Ambient Outer Aura Glow (Separates sharply from purple background) */}
          <div className="absolute inset-0 bg-gradient-to-r from-[#00F5D4]/20 via-[#38BDF8]/25 to-[#00F5D4]/20 blur-xl -z-10 rounded-2xl" />

          {/* Stepped Top Notch Tab (Electric Cyan & Live Signal Pulse) */}
          <div className="absolute top-1 left-1/2 -translate-x-1/2 z-20 px-5 py-1 bg-[#020B16] border-2 border-[#00F5D4] rounded-md text-[10px] md:text-xs font-arcade font-black text-[#00F5D4] tracking-[0.28em] uppercase shadow-[0_0_16px_rgba(0,245,212,0.9)] flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#00F5D4] shadow-[0_0_8px_#00F5D4] animate-ping" />
            SYS.STATUS // BROADCAST
          </div>

          <div className="hud-notched-frame relative bg-gradient-to-b from-[#02131F]/96 via-[#031B2C]/96 to-[#010D17]/96 backdrop-blur-xl p-6 md:p-8 border-2 border-[#00F5D4] shadow-[0_0_45px_rgba(0,245,212,0.55),0_0_15px_rgba(56,189,248,0.7),inset_0_0_30px_rgba(0,245,212,0.20)] flex flex-col items-center justify-center text-center">
            {/* 4 Tech Corner Brackets in Radiant Gold */}
            <div className="absolute top-2.5 left-2.5 w-3.5 h-3.5 border-t-2 border-l-2 border-[#FFE066] drop-shadow-[0_0_6px_#FFE066] pointer-events-none" />
            <div className="absolute top-2.5 right-2.5 w-3.5 h-3.5 border-t-2 border-r-2 border-[#FFE066] drop-shadow-[0_0_6px_#FFE066] pointer-events-none" />
            <div className="absolute bottom-2.5 left-2.5 w-3.5 h-3.5 border-b-2 border-l-2 border-[#FFE066] drop-shadow-[0_0_6px_#FFE066] pointer-events-none" />
            <div className="absolute bottom-2.5 right-2.5 w-3.5 h-3.5 border-b-2 border-r-2 border-[#FFE066] drop-shadow-[0_0_6px_#FFE066] pointer-events-none" />

            {/* Glowing Lateral Laser Pillars */}
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-14 bg-gradient-to-b from-transparent via-[#00F5D4] to-transparent shadow-[0_0_10px_#00F5D4]" />
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-14 bg-gradient-to-b from-transparent via-[#00F5D4] to-transparent shadow-[0_0_10px_#00F5D4]" />

            {/* Line 1: ROUND X COMMENCING SOON (Radiant Gold/White) */}
            <div className="font-arcade italic text-2xl sm:text-3xl md:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-[#FFFFFF] via-[#FFF3B0] to-[#FFD166] tracking-wider uppercase drop-shadow-[0_0_14px_rgba(255,224,102,0.85)] leading-tight">
              {round === 3 ? 'CHAMPIONSHIP ROUND COMMENCING SOON:' : `ROUND ${round} COMMENCING SOON:`}
            </div>

            {/* Line 2: SUBTITLE (Electric Cyan Pulsing Glow) */}
            <div className="font-arcade italic text-xl sm:text-2xl md:text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-[#00F5D4] via-[#67E8F9] to-[#00F5D4] tracking-widest uppercase drop-shadow-[0_0_18px_rgba(0,245,212,1)] mt-2 leading-tight">
              {round === 1 && 'ENGAGING NEGATIVE INTEGER LOGIC!'}
              {round === 2 && 'SYNCHRONIZING COMPOUND PEMDAS NEXUS!'}
              {round === 3 && 'MAXIMUM OVERCLOCK: DECIMAL ARITHMETIC CORE!'}
            </div>
          </div>
        </div>

        {/* ── BOTTOM SECTION: TRIPLE CONCENTRIC CYAN NEON CAPSULE PILL (NON-CLICKABLE STATUS BADGE) ── */}
        <div className="relative my-2 select-none pointer-events-none cursor-default">
          {/* Outer Breathing Glow Ring */}
          <div className="absolute -inset-1 rounded-full bg-[#00F5D4] opacity-40 blur-md animate-pulse" />

          {/* Concentric Ring 1 (Outer) */}
          <div className="p-1 rounded-full border-2 border-[#00F5D4] bg-[#090018]/90 shadow-[0_0_20px_rgba(0,245,212,0.5)]">
            {/* Concentric Ring 2 (Middle) */}
            <div className="p-0.5 rounded-full border border-[#00F5D4]/60">
              {/* Inner Core */}
              <div className="px-10 md:px-14 py-2.5 md:py-3 rounded-full bg-[#0C0024] border border-[#00F5D4]/40 flex items-center justify-center">
                <span className="font-arcade text-xs sm:text-sm font-black text-[#00F5D4] uppercase tracking-[0.32em] drop-shadow-[0_0_8px_#00F5D4] animate-pulse">
                  AWAITING CONFIRMATION
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ArenaStadiumBackground>
  );
}

const ROUND_SUBTITLES: Record<number, string> = {
  1: 'ENGAGING NEGATIVE INTEGER LOGIC!',
  2: 'SYNCHRONIZING COMPOUND PEMDAS NEXUS!',
  3: 'MAXIMUM OVERCLOCK: DECIMAL ARITHMETIC CORE!'
};

// ─── 10. GENERATING SEQUENCE SCREEN (15-SEGMENT NEON LED & QUANTUM SPHERE) ────
function GeneratingSequenceScreen({
  round,
  onExecute
}: {
  round: number;
  onExecute: () => void;
}) {
  const [loadedBlocks, setLoadedBlocks] = useState(1);
  const onExecuteRef = useRef(onExecute);
  useEffect(() => {
    onExecuteRef.current = onExecute;
  }, [onExecute]);

  const voiceRef = useRef<HTMLAudioElement | null>(null);
  const hasAdvancedRef = useRef(false);
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Progressive filling of 15 LED blocks with Allison voice, synchronized to advance only when BOTH are done
  useEffect(() => {
    hasAdvancedRef.current = false;
    let animationDone = false;
    let voiceDone = isPreviewMode ? true : false;

    const advanceToWinningPatterns = () => {
      if (hasAdvancedRef.current) return;
      hasAdvancedRef.current = true;
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
        transitionTimeoutRef.current = null;
      }
      if (voiceRef.current) {
        voiceRef.current.pause();
        voiceRef.current.src = '';
        voiceRef.current = null;
      }
      if (!isPreviewMode) {
        onExecuteRef.current();
      }
    };

    const checkReadyToAdvance = () => {
      if (animationDone && voiceDone && !hasAdvancedRef.current) {
        transitionTimeoutRef.current = setTimeout(() => {
          advanceToWinningPatterns();
        }, 400);
      }
    };

    // 1. Play Allison's "GENERATING SEQUENCE... please wait" voice
    if (!isPreviewMode) {
      const voice = new Audio('/audio/sequence/generating_sequence.mp3');
      voice.volume = 1.0;
      voiceRef.current = voice;

      voice.onended = () => {
        console.log('[STAGE] Allison Generating Sequence voice finished speaking.');
        voiceDone = true;
        checkReadyToAdvance();
      };

      voice.onerror = () => {
        voiceDone = true;
        checkReadyToAdvance();
      };

      voice.play().then(() => {
        console.log('[STAGE] Playing Allison Generating Sequence voice');
      }).catch(e => {
        console.warn('Generating sequence audio note:', e);
        voiceDone = true;
        checkReadyToAdvance();
      });
    }

    // 2. Progressive 15-segment LED progression (paced at 290ms per block so Allison can speak comfortably)
    let blockCount = 1;
    const timer = setInterval(() => {
      blockCount += 1;
      setLoadedBlocks(blockCount);

      // Once the animation is done (all 15 blocks lit), mark animation as finished and check voice
      if (blockCount >= 15) {
        clearInterval(timer);
        animationDone = true;
        checkReadyToAdvance();
      }
    }, 290);

    return () => {
      clearInterval(timer);
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
        transitionTimeoutRef.current = null;
      }
      if (voiceRef.current) {
        voiceRef.current.pause();
        voiceRef.current.src = '';
        voiceRef.current = null;
      }
    };
  }, [round]);

  // Optional keyboard skip (Space/Enter) in case the host wants to skip immediately
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (hasAdvancedRef.current) return;
        hasAdvancedRef.current = true;
        if (transitionTimeoutRef.current) {
          clearTimeout(transitionTimeoutRef.current);
          transitionTimeoutRef.current = null;
        }
        if (voiceRef.current) {
          voiceRef.current.pause();
          voiceRef.current.src = '';
          voiceRef.current = null;
        }
        if (!isPreviewMode) {
          onExecuteRef.current();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 15 Gradient Colors: Purple -> Magenta -> Pink -> Orange -> Amber Gold
  const seqColors = [
    '#7C3AED', '#8B5CF6', '#A855F7', '#C084FC',
    '#D946EF', '#E879F9', '#FF007F', '#FF3399',
    '#FF55D2', '#F43F5E', '#FB7185', '#FF6B35',
    '#FF8C42', '#FFA057', '#FBBF24'
  ];

  return (
    <ArenaStadiumBackground>
      {/* ── LIVING GEOMETRIC CONSTELLATION WEB & DRIFTING 3D SHAPES ── */}
      <SecondScreenSurroundingMatrix />

      <div className="relative z-10 flex flex-col items-center justify-between h-full flex-1 w-full max-w-5xl mx-auto py-1 select-none">
        {/* ── TOP SECTION: TAGLINE & DUAL-TUBE TITLE ── */}
        <div className="flex flex-col items-center text-center w-full">
          <div className="font-arcade text-[#FF55D2] text-lg sm:text-xl md:text-2xl font-black uppercase tracking-[0.28em] drop-shadow-[0_0_12px_#FF007F] mb-0.5">
            PREPARE YOURSELVES!
          </div>

          <div className="relative w-full max-w-4xl flex items-center justify-center my-0.5">
            {/* Title Text SVG (Non-blinding, crisp retro chrome) */}
            <svg viewBox="0 0 1000 100" className="w-full max-w-4xl h-16 md:h-22 overflow-visible select-none">
              <text
                x="500"
                y="76"
                textAnchor="middle"
                style={{
                  fontFamily: "'Boogaloo', 'Audiowide', sans-serif",
                  fontWeight: 900,
                  fontSize: '78px',
                  letterSpacing: '3px'
                }}
                fill="none"
                stroke="#FF6B35"
                strokeWidth="12"
                strokeLinejoin="round"
                filter="url(#systemsOnlineSoftGlow)"
              >
                SYSTEMS ONLINE!
              </text>
              <text
                x="500"
                y="76"
                textAnchor="middle"
                style={{
                  fontFamily: "'Boogaloo', 'Audiowide', sans-serif",
                  fontWeight: 900,
                  fontSize: '78px',
                  letterSpacing: '3px'
                }}
                fill="none"
                stroke="#090014"
                strokeWidth="7"
                strokeLinejoin="round"
              >
                SYSTEMS ONLINE!
              </text>
              <text
                x="500"
                y="76"
                textAnchor="middle"
                style={{
                  fontFamily: "'Boogaloo', 'Audiowide', sans-serif",
                  fontWeight: 900,
                  fontSize: '78px',
                  letterSpacing: '3px'
                }}
                fill="none"
                stroke="#00E5FF"
                strokeWidth="3"
                strokeLinejoin="round"
              >
                SYSTEMS ONLINE!
              </text>
              <text
                x="500"
                y="76"
                textAnchor="middle"
                style={{
                  fontFamily: "'Boogaloo', 'Audiowide', sans-serif",
                  fontWeight: 900,
                  fontSize: '78px',
                  letterSpacing: '3px'
                }}
                fill="none"
                stroke="#050014"
                strokeWidth="2"
                strokeLinejoin="round"
              >
                SYSTEMS ONLINE!
              </text>
              <text
                x="500"
                y="76"
                textAnchor="middle"
                style={{
                  fontFamily: "'Boogaloo', 'Audiowide', sans-serif",
                  fontWeight: 900,
                  fontSize: '78px',
                  letterSpacing: '3px'
                }}
                fill="url(#systemsOnlineFill)"
              >
                SYSTEMS ONLINE!
              </text>
            </svg>
          </div>
        </div>

        {/* ── CENTER SECTION: PANORAMIC CYBER PANEL WITH PROGRESS & SPHERE ── */}
        <div className="relative w-full max-w-4xl my-3 pt-3">
          {/* Stepped Top Notch Tab (Placed outside hud-notched-frame so clip-path never slices it) */}
          <div className="absolute top-0.5 left-1/2 -translate-x-1/2 z-20 px-4 py-0.5 bg-[#090018] border border-[#C084FC] rounded text-[10px] font-mono text-[#C084FC] tracking-[0.25em] uppercase shadow-[0_0_10px_#C084FC]">
            GENERATOR_v3.8 // ACTIVE
          </div>

          <div className="hud-notched-frame relative bg-[#090018]/92 backdrop-blur-md p-5 md:p-7 border-2 border-[#C084FC] shadow-[0_0_35px_rgba(192,132,252,0.4),inset_0_0_20px_rgba(168,85,247,0.15)]">

            <div className="flex flex-col lg:flex-row items-center justify-between gap-6 w-full">
              {/* Left Side: Header, 15-Block LED Progress Bar, Subtitle */}
              <div className="flex-1 flex flex-col items-center lg:items-start text-center lg:text-left w-full">
                {/* Header Text */}
                <h3 className="font-arcade text-lg sm:text-xl md:text-2xl font-black text-[#38BDF8] tracking-wider uppercase drop-shadow-[0_0_8px_rgba(56,189,248,0.5)] mb-2.5">
                  GENERATING SEQUENCE... <span className="text-slate-300 lowercase text-sm sm:text-base font-mono">please wait</span>
                </h3>

                {/* 15-Segment Neon LED Progress Bar */}
                <div className="flex items-center gap-1.5 sm:gap-2 my-1.5 w-full max-w-xl justify-center lg:justify-start">
                  {seqColors.map((col, i) => {
                    const isLit = i < loadedBlocks;
                    return (
                      <div
                        key={i}
                        className="flex-1 h-6 sm:h-7 md:h-8 rounded-md transition-all duration-200"
                        style={{
                          backgroundColor: isLit ? col : 'rgba(24, 4, 54, 0.6)',
                          border: isLit ? `1.5px solid ${col}` : '1px solid rgba(148, 163, 184, 0.2)',
                          boxShadow: isLit ? `0 0 12px ${col}, inset 0 0 5px rgba(255,255,255,0.4)` : 'none',
                          transform: isLit ? 'scale(1.02)' : 'scale(1)'
                        }}
                      />
                    );
                  })}
                </div>

                {/* Subtitle */}
                <div className="font-mono text-[11px] sm:text-xs font-bold text-slate-300 uppercase tracking-widest mt-2.5">
                  {round === 5 ? 'CHAMPIONSHIP ROUND COMMENCING SOON: ' : `ROUND ${round} COMMENCING SOON: `}
                  {ROUND_SUBTITLES[round] || 'INITIALIZING AI-DRIVEN MATRIX!'}
                </div>
              </div>

              {/* Right Side: Holographic 3D Quantum Math Energy Sphere & Robot */}
              <div className="relative w-32 h-32 flex items-center justify-center flex-shrink-0">
                {/* Matrix Equation Flow Stream */}
                <div className="absolute inset-0 flex flex-col justify-between font-mono text-[7.5px] text-[#00F5D4]/40 pointer-events-none select-none overflow-hidden leading-tight text-left">
                  <div>Pr(X) = Σ p_i · x_i</div>
                  <div>∫₀^∞ e^(-x²) dx = √π/2</div>
                  <div>det(A - λI) = 0</div>
                  <div>lim (1 + 1/n)ⁿ = e</div>
                  <div>∇ × B = μ₀J</div>
                </div>

                {/* Rotating Intersecting Cyan Wireframe Rings */}
                <svg viewBox="0 0 100 100" className="w-24 h-24 animate-quantum-spin overflow-visible drop-shadow-[0_0_12px_#00F5D4]">
                  <circle cx="50" cy="50" r="45" fill="none" stroke="#00F5D4" strokeWidth="1.2" strokeDasharray="6 3" />
                  <ellipse cx="50" cy="50" rx="45" ry="18" fill="none" stroke="#00F5D4" strokeWidth="1.5" />
                  <ellipse cx="50" cy="50" rx="45" ry="18" fill="none" stroke="#00F5D4" strokeWidth="1.4" transform="rotate(45 50 50)" />
                  <ellipse cx="50" cy="50" rx="45" ry="18" fill="none" stroke="#00F5D4" strokeWidth="1.4" transform="rotate(90 50 50)" />
                  <ellipse cx="50" cy="50" rx="45" ry="18" fill="none" stroke="#00F5D4" strokeWidth="1.4" transform="rotate(135 50 50)" />
                  <circle cx="50" cy="50" r="5" fill="#00F5D4" filter="drop-shadow(0 0 6px #00F5D4)" className="animate-ping" />
                </svg>

                {/* Pixel Robot 🤖 */}
                <div className="absolute -bottom-1 -left-2 text-xl animate-bounce drop-shadow-[0_0_8px_#00F5D4]">
                  🤖
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── BOTTOM SECTION: TRIPLE CONCENTRIC CYAN NEON CAPSULE PILL (NON-CLICKABLE STATUS BADGE) ── */}
        <div className="relative my-2 select-none pointer-events-none cursor-default">
          <div className="absolute -inset-1 rounded-full bg-[#00F5D4] opacity-40 blur-md animate-pulse" />
          <div className="p-1 rounded-full border-2 border-[#00F5D4] bg-[#090018]/90 shadow-[0_0_20px_rgba(0,245,212,0.5)]">
            <div className="p-0.5 rounded-full border border-[#00F5D4]/60">
              <div className="px-10 md:px-14 py-2.5 md:py-3 rounded-full bg-[#0C0024] border border-[#00F5D4]/40 flex items-center justify-center">
                <span className="font-arcade text-xs sm:text-sm font-black text-[#00F5D4] uppercase tracking-[0.32em] drop-shadow-[0_0_8px_#00F5D4] animate-pulse">
                  AWAITING AI EXECUTION...
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ArenaStadiumBackground>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function Stage() {
  const [equations, setEquations] = useState<Equation[]>([]);
  const [gameState, setGameState] = useState<GameState>({
    status: 'title_main', currentEquationIndex: 0,
    timerSeconds: 10, maxTimerSeconds: 10,
    round: 1, phase: 1, phaseName: '', patternName: null, phaseDescription: '',
    pointMatrix: {}, usedPowers: {}, dualCallActive: false, verifyingPlayerName: '',
    activatedPower: '', highlightedPower: ''
  });
  const [verifyResult, setVerifyResult] = useState<VerificationResult | null>(null);
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardStageData | null>(null);
  const [audioUnlocked, setAudioUnlocked] = useState(isPreviewMode);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);

  // ── PRESENTATION MODE / FULLSCREEN CONTROLLER ─────────────────────────────
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showHudControls, setShowHudControls] = useState(false);
  const hudTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerBriefHud = (durationMs = 2200) => {
    setShowHudControls(prev => (prev ? prev : true));
    if (hudTimeoutRef.current) clearTimeout(hudTimeoutRef.current);
    hudTimeoutRef.current = setTimeout(() => {
      setShowHudControls(false);
    }, durationMs);
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
      triggerBriefHud(2200);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    triggerBriefHud(2500);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    triggerBriefHud(2200);
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // Keyboard shortcut 'F' to toggle presentation mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const lastMouseMoveRef = useRef(0);
  const handleMouseMove = () => {
    const now = Date.now();
    if (now - lastMouseMoveRef.current > 300) {
      lastMouseMoveRef.current = now;
      triggerBriefHud(2200);
    }
  };

  // Allison Audio Engine State & Refs
  const allisonAudioRef = useRef<HTMLAudioElement | null>(null);
  const [allisonSpeaking, setAllisonSpeaking] = useState(false);
  const [allisonActiveLine, setAllisonActiveLine] = useState(gameState.allisonLine ?? 1);

  // Sync Allison line and speaking state with gameState
  useEffect(() => {
    if (gameState.allisonLine && gameState.allisonLine !== allisonActiveLine) {
      setAllisonActiveLine(gameState.allisonLine);
    }
    if (gameState.allisonSpeaking !== undefined) {
      setAllisonSpeaking(gameState.allisonSpeaking);
    }
  }, [gameState.allisonLine, gameState.allisonSpeaking]);

  const stopActiveAudio = () => {
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current.currentTime = 0;
      activeAudioRef.current = null;
    }
    if (allisonAudioRef.current) {
      allisonAudioRef.current.pause();
      allisonAudioRef.current.currentTime = 0;
      allisonAudioRef.current = null;
    }
    setAllisonSpeaking(false);
    window.speechSynthesis.cancel();
  };

  const playAllisonAudio = (line: number) => {
    if (isPreviewMode) return;
    stopActiveAudio();
    setAllisonActiveLine(line);
    setAllisonSpeaking(true);

    const handleSpeechEnded = (finishedLine: number) => {
      setAllisonSpeaking(false);
      emit('allisonSpeakingFinished', { line: finishedLine });
      // When Allison finishes speaking the bridging line (line 4), automatically advance to mechanics!
      if (finishedLine === 4) {
        setTimeout(() => {
          emit('updateGameState', { status: 'mechanics', mechanicsSlide: 1 });
        }, 500);
      }
    };

    const audio = new Audio(`/audio/allison/line_${line}.mp3`);
    allisonAudioRef.current = audio;

    audio.onended = () => {
      handleSpeechEnded(line);
    };
    audio.onerror = () => {
      console.warn(`Could not load /audio/allison/line_${line}.mp3, trying fallback...`);
      const fallbackName =
        line === 1
          ? '1ST%20LINE.mp3'
          : line === 2
          ? '2ND%20LINE.mp3'
          : line === 3
          ? '3RD%20LINE.mp3'
          : '4TH%20LINE.mp3';
      const fallbackAudio = new Audio(`/audio/allison/${fallbackName}`);
      allisonAudioRef.current = fallbackAudio;
      fallbackAudio.onended = () => {
        handleSpeechEnded(line);
      };
      fallbackAudio.onerror = () => {
        setAllisonSpeaking(false);
        emit('allisonSpeakingFinished', { line });
      };
      fallbackAudio.play().catch(() => setAllisonSpeaking(false));
    };

    audio.play().catch(e => {
      console.warn("Autoplay blocked or audio error:", e);
      setAllisonSpeaking(false);
    });
  };

  const socketRef = useRef<any>(null);
  const emit = (event: string, data: any) => {
    if (isPreviewMode) return; // Preview iframe in Admin must never emit game state updates!
    if (socketRef.current) socketRef.current.emit(event, data);
  };

  useEffect(() => {
    const s = io(SOCKET_URL);
    socketRef.current = s;
    s.on('gameStateUpdate', (state: GameState) => {
      setGameState(state);
      if (state.status !== 'leaderboard') setLeaderboardData(null);
      // Clear verify result when we leave the bingo verification flow
      if (state.status !== 'bingo' && state.status !== 'verifying_buildup' && state.status !== 'bingo_claimed_by') {
        setVerifyResult(null);
      }
    });
    s.on('allisonLinePlayed', (data: { line: number }) => {
      playAllisonAudio(data.line);
    });
    s.on('stopAllisonAudio', () => {
      if (allisonAudioRef.current) {
        allisonAudioRef.current.pause();
        allisonAudioRef.current.currentTime = 0;
        allisonAudioRef.current = null;
      }
      setAllisonSpeaking(false);
    });
    s.on('sequenceUpdate', setEquations);
    s.on('verificationResult', (res: VerificationResult) => setVerifyResult(res));
    s.on('showLeaderboardStage', (data: LeaderboardStageData) => setLeaderboardData(data));
    s.on('leaderboardUpdate', (lb: Player[]) => {
      setLeaderboardData(prev => {
        if (!prev) return null;
        if (prev.mode === 'cumulative') {
          return { ...prev, leaderboard: lb };
        }
        return prev;
      });
    });
    return () => {
      stopActiveAudio();
      s.disconnect();
    };
  }, []);

  const currentEq = equations[gameState.currentEquationIndex];
  const dualEq = gameState.dualCallActive ? equations[gameState.currentEquationIndex + 1] : null;

  // ── TTS AUDIO ENGINE & AI PERSONALITY ───────────────────────────────────────

  // Voice lines dictionaries for fallback
  const VOICE_LINES = {
    bingoValid: [
      "Verification complete. That is a valid BINGO!",
      "Math checks out. BINGO confirmed!",
      "Pattern locked and verified. We have a winner!",
      "Scanning card... Grid verified! Excellent work.",
      "Calculations match. You've earned this BINGO.",
      "Auditing ticket... Everything is perfect. BINGO!",
      "Valid BINGO detected! The AI concedes this round.",
      "Card authenticated. That's a perfect match!",
      "Numbers align. BINGO is official.",
      "System confirms: Valid BINGO! Great job, human."
    ],
    bingoFalse: [
      "System Audit Failed! Check your math, human!",
      "Calculation rejected! That card math doesn't add up.",
      "Nice try, organic unit, but that's a false BINGO!",
      "Error 404: Valid BINGO not found on that paper sheet!",
      "Deducting 100 points! My quantum memory says otherwise.",
      "Negative! Return to your desk and recalculate.",
      "Auditing card... Verification failed! Better luck next turn.",
      "False alarm detected! My subroutines are unamused.",
      "Math error on your end, human! Penalty applied.",
      "Incorrect! Your card state does not match my logs."
    ],
    mathErrorValid: [
      "Logic malfunction spotted! Tactical power granted.",
      "System anomaly caught! Accessing power bank menu now.",
      "Alert! Out of bounds equation identified. Sharp listening!",
      "You caught my intentional error! Select your tactical power.",
      "Syntax error confirmed! Human processing speed exceeds expectation.",
      "Math error verified! Power granted to the sharp-eared human.",
      "Warning! Broken math detected. Tactical override enabled.",
      "Good catch! My equation subroutine was compromised.",
      "System defect spotted! Pick your power wisely.",
      "Divide by zero error detected! Good eye, human!"
    ],
    mathErrorFalse: [
      "My math is flawless, human. That is a false claim!",
      "Are you questioning my logic? The equation is perfectly valid.",
      "False alarm! My processors do not make mistakes like that.",
      "Nice try, but this equation is mathematically sound. Penalty!",
      "I double-checked my cache. The math is correct. You are incorrect.",
      "System logs confirm the math is accurate. Try again!",
      "Your human brain must be lagging. The math is correct!",
      "False math error claim! Do not doubt the algorithm.",
      "Verification complete: The equation has zero errors.",
      "Invalid claim! My equations are currently functioning optimally."
    ],
    memoryRecall: [
      "Wait, wasn't this number erased earlier? Calling it again!",
      "Memory wipe detected, but my randomizer drew it once more!",
      "Recycling erased target! Solve this new equation for it.",
      "Target resurrected! Different equation, same target number!",
      "Did you think erasing it would stop me? Number recalled!",
      "Re-issuing erased target answer! Calculate fast!",
      "System memory bypass! Target number back in play.",
      "Erased but not forgotten! Solve this new expression.",
      "Target number re-drawn! A fresh equation approaches.",
      "Quantum loop activated! Erased number strikes back."
    ]
  };

  // Named MP3 file prefixes for each category (matches renamed audio files)
  const AUDIO_PREFIXES: Record<keyof typeof VOICE_LINES, string> = {
    bingoValid: 'bingo_valid',
    bingoFalse: 'bingo_false',
    mathErrorValid: 'math_error_valid',
    mathErrorFalse: 'math_error_false',
    memoryRecall: 'memory_recall',
  };

  // Browser TTS Fallback & Equation Reader (used ONLY for math equations)
  const speak = (text: string): Promise<void> => {
    return new Promise(resolve => {
      if (isPreviewMode) return resolve();
      window.speechSynthesis.cancel();
      const ut = new SpeechSynthesisUtterance(text);

      const voices = window.speechSynthesis.getVoices();
      const preferredVoice = voices.find(v =>
        v.name.includes('Zira') || v.name.includes('Samantha') ||
        (v.name.includes('Female') && v.lang.includes('en')) ||
        (v.name.includes('Google US English') && v.name.includes('Female'))
      ) || voices.find(v => v.lang.startsWith('en'));

      if (preferredVoice) ut.voice = preferredVoice;
      ut.pitch = 1.15;
      ut.rate = 1.10;
      ut.volume = 1.0;

      ut.onend = () => resolve();
      ut.onerror = () => resolve();
      window.speechSynthesis.speak(ut);
    });
  };

  // Play Ivanna (ElevenLabs) named MP3 — falls back to TTS if file missing
  const playPersonalityLine = (category: keyof typeof VOICE_LINES): Promise<void> => {
    return new Promise(resolve => {
      if (isPreviewMode) return resolve();
      stopActiveAudio();
      const idx = Math.floor(Math.random() * 10);
      const prefix = AUDIO_PREFIXES[category];
      const audio = new Audio(`/audio/${prefix}_${idx}.mp3`);
      activeAudioRef.current = audio;

      audio.onended = () => {
        if (activeAudioRef.current === audio) activeAudioRef.current = null;
        resolve();
      };
      audio.onerror = () => {
        if (activeAudioRef.current === audio) activeAudioRef.current = null;
        console.warn(`MP3 /audio/${prefix}_${idx}.mp3 not found — falling back to TTS.`);
        speak(VOICE_LINES[category][idx]).then(resolve);
      };

      audio.play().catch(() => {
        if (activeAudioRef.current === audio) activeAudioRef.current = null;
        speak(VOICE_LINES[category][idx]).then(resolve);
      });
    });
  };

  // 3-tone descending "calculator mode" transition beep
  // Signals: AI is handing off to calculator subroutine for math reading
  const playCalculatorBeep = (): Promise<void> => {
    return new Promise(resolve => {
      if (isPreviewMode) return resolve();
      try {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioContext();

        const playTone = (freq: number, startTime: number, duration: number) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'square';
          osc.frequency.setValueAtTime(freq, startTime);
          gain.gain.setValueAtTime(0.07, startTime);
          gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(startTime);
          osc.stop(startTime + duration);
        };

        const t = ctx.currentTime;
        playTone(1200, t + 0.00, 0.12);
        playTone(900, t + 0.16, 0.12);
        playTone(650, t + 0.32, 0.18);

        setTimeout(resolve, 650);
      } catch (e) {
        resolve();
      }
    });
  };

  // Event hooks for Math Errors & Bingo Results
  useEffect(() => {
    if (isPreviewMode) return;
    if (gameState.status === 'math_error_false') {
      playPersonalityLine('mathErrorFalse');
    } else if (gameState.status === 'math_error') {
      playPersonalityLine('mathErrorValid');
    }
  }, [gameState.status]);

  // Hook specifically for Bingo Verification Result Audio (game stays paused)
  useEffect(() => {
    if (isPreviewMode) return;
    if (verifyResult) {
      if (verifyResult.valid) playPersonalityLine('bingoValid');
      else playPersonalityLine('bingoFalse');
    }
  }, [verifyResult]);

  // Hook for playing Allison's Winning Pattern voice lines on Title Round / Phase Intro screen
  useEffect(() => {
    if (isPreviewMode) return;
    if (gameState.status === 'title_round') {
      stopActiveAudio();
      const round = gameState.round || 1;
      const phase = gameState.phase || 1;
      const audioUrl = `/audio/titles/title_${round}_${phase}.mp3`;
      const audio = new Audio(audioUrl);
      audio.volume = 1.0;
      activeAudioRef.current = audio;

      audio.onended = () => {
        if (activeAudioRef.current === audio) activeAudioRef.current = null;
      };
      audio.onerror = (e) => {
        console.warn(`Could not load title audio for round ${round} phase ${phase}:`, e);
        if (activeAudioRef.current === audio) activeAudioRef.current = null;
      };
      audio.play().catch(err => {
        console.warn('Title audio autoplay blocked or interrupted:', err);
        if (activeAudioRef.current === audio) activeAudioRef.current = null;
      });
    }
    return () => {
      if (gameState.status === 'title_round') stopActiveAudio();
    };
  }, [gameState.status, gameState.round, gameState.phase]);

  // ── TIMER SOUND EFFECT (CLOCK TICK ON BEAT) ──────────────────────────────────
  const clockAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (isPreviewMode) return;
    if (gameState.status === 'playing' && gameState.timerSeconds > 0) {
      if (!clockAudioRef.current) {
        clockAudioRef.current = new Audio('/audio/sfx/clock.mp3');
        clockAudioRef.current.volume = 0.85;
      }
      const audio = clockAudioRef.current;
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } else {
      if (clockAudioRef.current) {
        clockAudioRef.current.pause();
      }
    }
  }, [gameState.status, gameState.timerSeconds]);

  // ── PROBLEM COMPLETE CHIME & POWER SELECTION SFX ─────────────────────────────
  const prevEqIdxRef = useRef<number>(gameState.currentEquationIndex);

  useEffect(() => {
    if (isPreviewMode) return;
    // Play chime when current problem advances or finishes
    if (
      gameState.currentEquationIndex !== prevEqIdxRef.current ||
      (gameState.status === 'playing' && gameState.timerSeconds === 0)
    ) {
      prevEqIdxRef.current = gameState.currentEquationIndex;
      const chime = new Audio('/audio/sfx/chime.mp3');
      chime.volume = 0.9;
      chime.play().catch(() => {});
    }
  }, [gameState.currentEquationIndex, gameState.timerSeconds, gameState.status]);

  // ── TACTICAL POWER ACTIVATION SFX (plays once when admin clicks a power) ──────
  useEffect(() => {
    if (isPreviewMode) return;
    if (gameState.status === 'power_activated') {
      const sfx = new Audio('/audio/sfx/selection.mp3');
      sfx.volume = 0.9;
      sfx.play().catch(() => {});
    }
  }, [gameState.status]);


  // Event hook for playing equations (with Memory Wipe Recalls)
  useEffect(() => {
    if (isPreviewMode || gameState.status !== 'playing') return;

    let isCancelled = false;

    const readEquationFlow = async () => {
      await new Promise(r => setTimeout(r, 2000)); // Initial 2s delay
      if (isCancelled || isPreviewMode) return;

      if (currentEq?.isRecalled && !gameState.dualCallActive) {
        await playPersonalityLine('memoryRecall');
        if (isCancelled || isPreviewMode) return;
        await playCalculatorBeep();
        if (isCancelled || isPreviewMode) return;
      }

      if (gameState.dualCallActive && currentEq && dualEq) {
        await speak('First problem... ' + toSpokenText(currentEq.equationText) + '. . . Second problem... ' + toSpokenText(dualEq.equationText));
      } else if (currentEq) {
        await speak(toSpokenText(currentEq.equationText));
      }
    };

    readEquationFlow();

    return () => {
      isCancelled = true;
      window.speechSynthesis.cancel();
    };
  }, [gameState.currentEquationIndex, gameState.status, gameState.dualCallActive]);

  const progressPct = gameState.maxTimerSeconds > 0
    ? (gameState.timerSeconds / gameState.maxTimerSeconds) * 100
    : 0;
  const isStopped = gameState.status === 'stopped' || gameState.status === 'paused';

  // ── AUDIO & PRESENTATION UNLOCK OVERLAY ──────────────────────────────────────
  if (!audioUnlocked && !isPreviewMode) {
    return (
      <div
        onClick={() => {
          setAudioUnlocked(true);
          // Auto-launch fullscreen presentation mode on click
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
          }
          // Unlock TTS
          const ut = new SpeechSynthesisUtterance('');
          window.speechSynthesis.speak(ut);
          // Unlock Web Audio API
          const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
          if (AudioContext) {
            const ctx = new AudioContext();
            ctx.resume();
          }
        }}
        className="fixed inset-0 w-screen h-screen bg-slate-950 flex flex-col items-center justify-center text-center cursor-pointer transition-all hover:bg-slate-900 select-none z-50"
      >
        <div className="w-40 h-40 bg-emerald-500/10 border-2 border-emerald-500/30 rounded-full flex items-center justify-center mb-8 animate-pulse shadow-[0_0_40px_rgba(52,211,153,0.3)]">
          <Maximize className="w-20 h-20 text-emerald-400" />
        </div>
        <h1 className="text-5xl md:text-6xl font-black text-white tracking-widest uppercase mb-4 drop-shadow-[0_0_25px_rgba(52,211,153,0.6)]">
          Tap to Launch Stage
        </h1>
        <p className="text-slate-300 text-xl font-bold tracking-wider max-w-lg">
          Enters Fullscreen Presentation Mode &amp; Unlocks Audio
        </p>
        <div className="mt-8 flex items-center gap-3 px-5 py-2 rounded-full border border-[#00F5D4]/40 bg-[#00F5D4]/10 text-[#00F5D4] font-mono text-xs tracking-[0.25em] uppercase">
          <Play className="w-4 h-4 fill-[#00F5D4]" /> CLICK ANYWHERE TO BEGIN [F]
        </div>
      </div>
    );
  }

  const renderStageView = () => {
    // ── 1. MAIN TITLE SCREEN ───────────────────────────────────────────────────
    if (gameState.status === 'title_main') {
      return (
        <MainTitleScreen
          onEnterGrid={() => emit('updateGameState', { status: 'allison_intro', allisonLine: 1 })}
        />
      );
    }

    // ── 1.5. ALLISON AI INTRODUCTION SCREEN (BIG ANIMATED CENTRAL AUDIOWAVE) ──
    if (gameState.status === 'allison_intro') {
      return (
        <AllisonIntroScreen
          activeLine={allisonActiveLine}
          isSpeaking={allisonSpeaking}
          audioRef={allisonAudioRef}
        />
      );
    }

    // ── 2. MECHANICS PRESENTATION (14 SLIDES - SLIDE INSPIRATION THEME) ────────
    if (gameState.status === 'mechanics') {
      return (
        <MechanicsScreen
          slideNumber={gameState.mechanicsSlide ?? 1}
          onNext={() => emit('updateGameState', { mechanicsSlide: Math.min(14, (gameState.mechanicsSlide ?? 1) + 1) })}
          onPrev={() => emit('updateGameState', { mechanicsSlide: Math.max(1, (gameState.mechanicsSlide ?? 1) - 1) })}
          onFinish={() => emit('updateGameState', { status: 'title_hype' })}
        />
      );
    }

  // ── 3. SECOND MAIN TITLE SCREEN (SYSTEMS ONLINE!) ───────────────────────────
  if (gameState.status === 'title_hype') {
    return (
      <SecondMainTitleScreen
        round={gameState.round}
        onConfirm={() => emit('updateGameState', { status: 'loading' })}
      />
    );
  }

  // ── 4. LOADING / GENERATING SEQUENCE (15-SEGMENT LED & QUANTUM SPHERE) ─────
  if (gameState.status === 'loading') {
    const t = TIMER_FOR_ROUND[gameState.round] ?? 10;
    return (
      <GeneratingSequenceScreen
        round={gameState.round}
        onExecute={() => emit('updateGameState', { status: 'title_round', timerSeconds: t, maxTimerSeconds: t })}
      />
    );
  }

  // ── 5. TITLE ROUND / PHASE INTRO ────────────────────────────────────────────
  if (gameState.status === 'title_round') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden p-6 md:p-8 select-none">
        <SynthwaveBackground round={gameState.round} />

        <div className="relative z-10 text-center flex flex-col items-center justify-center my-auto px-4 w-full max-w-6xl mx-auto">
          {/* Header pill: ROUND X · EASY/MEDIUM/HARD */}
          <div className="font-arcade text-xl sm:text-2xl md:text-3xl font-black text-[#FFE066] tracking-[0.4em] uppercase mb-8 drop-shadow-[0_0_15px_rgba(255,224,102,0.6)]">
            ROUND {gameState.round} · {ROUND_NAMES[gameState.round]?.toUpperCase()}
          </div>

          <div className="flex flex-col md:flex-row gap-10 md:gap-14 lg:gap-16 items-center justify-center w-full">
            {/* Left: 5x5 Bingo Card highlighting the phase winning pattern */}
            <PhaseIntroCard phase={gameState.phase} round={gameState.round} />

            {/* Glowing Vertical Neon Divider */}
            <div className="hidden md:block w-1.5 h-64 bg-gradient-to-b from-[#00F5D4] via-[#FF007F] to-[#FFE066] rounded-full shadow-[0_0_15px_#00F5D4]" />

            {/* Right: Phase Details */}
            <div className="text-center md:text-left py-2 max-w-xl">
              <h1 className="text-7xl sm:text-8xl md:text-9xl font-black text-white leading-none drop-shadow-2xl mb-3 tracking-wide">
                PHASE {gameState.phase}
              </h1>
              <h3 className="text-4xl sm:text-5xl font-black bg-clip-text text-transparent bg-gradient-to-r from-[#00F5D4] via-[#FF55D2] to-[#FFE066] mb-3 drop-shadow-md">
                {gameState.phaseName}
              </h3>
              {(gameState.patternName || gameState.phase === 2) && (
                <p className="text-2xl sm:text-3xl font-black text-[#FFE066] mb-3 drop-shadow-[0_0_8px_rgba(255,224,102,0.6)] uppercase tracking-wider">
                  ★ {gameState.phase === 2
                    ? (gameState.round === 1 ? 'X-PATTERN' : gameState.round === 2 ? 'FRAME PATTERN' : 'DIAMOND PATTERN')
                    : gameState.patternName}
                </p>
              )}
              <p className="text-lg sm:text-xl md:text-2xl text-slate-100 font-bold tracking-wider uppercase leading-relaxed drop-shadow">
                {gameState.phaseDescription}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── 6. MATH ERROR LOGIC & VERIFYING ─────────────────────────────────────────
  if (gameState.status === 'math_error_verifying') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden select-none">
        <SynthwaveBackground round={gameState.round} />
        <div className="absolute inset-0 bg-[#FF6B35]/15 pointer-events-none" />

        <div className="relative z-10 text-center flex flex-col items-center">
          <AlertCircle className="w-44 h-44 text-[#FF6B35] mb-8 drop-shadow-[0_0_60px_rgba(255,107,53,0.9)] animate-pulse" />
          <h1 className="text-7xl font-black text-white mb-6 tracking-widest drop-shadow-2xl uppercase">
            INVESTIGATING MATH ERROR
          </h1>
          <p className="text-3xl text-[#FF6B35] font-black uppercase tracking-[0.3em] bg-[#10002B]/90 px-10 py-4 rounded-2xl border-2 border-[#FF6B35] shadow-[0_0_30px_rgba(255,107,53,0.5)]">
            CLAIMED BY {gameState.mathErrorPlayerName}
          </p>
        </div>
      </div>
    );
  }

  if (gameState.status === 'math_error') {
    const errorPoints = 50 + Math.max(0, (gameState.round || 1) - 1) * 50;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden select-none">
        <SynthwaveBackground round={gameState.round} />
        <div className="absolute inset-0 bg-[#FF007F]/20 pointer-events-none" />

        <div className="relative z-10 text-center flex flex-col items-center">
          <div className="w-36 h-36 bg-[#FF007F] rounded-full flex items-center justify-center mb-8 shadow-[0_0_70px_rgba(255,0,127,0.9)] animate-bounce">
            <span className="text-white text-7xl font-black">!</span>
          </div>
          <h1 className="text-8xl font-black text-white mb-4 tracking-widest drop-shadow-2xl uppercase">
            MATH ERROR CLAIMED!
          </h1>
          <p className="text-4xl text-[#00F5D4] font-black uppercase tracking-[0.3em] bg-[#10002B]/90 px-10 py-4 rounded-2xl border-2 border-[#00F5D4] shadow-[0_0_30px_rgba(0,245,212,0.6)]">
            CAUGHT BY {gameState.mathErrorPlayerName}
          </p>
          <div className="mt-6 px-10 py-3 rounded-2xl bg-gradient-to-r from-[#FFE066]/20 via-[#FFB700]/30 to-[#FFE066]/20 border-2 border-[#FFE066] shadow-[0_0_40px_rgba(255,183,0,0.7)] flex items-center gap-3 animate-pulse">
            <Sparkles className="w-8 h-8 text-[#FFE066]" />
            <span className="font-arcade text-3xl md:text-4xl font-black text-[#FFE066] tracking-[0.25em] uppercase drop-shadow-[0_0_14px_#FFB700]">
              +{errorPoints} POINTS AWARDED!
            </span>
            <Sparkles className="w-8 h-8 text-[#FFE066]" />
          </div>
        </div>
      </div>
    );
  }

  if (gameState.status === 'math_error_false') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden select-none">
        <SynthwaveBackground round={gameState.round} />
        <div className="absolute inset-0 bg-[#FF007F]/30 pointer-events-none" />

        <div className="relative z-10 text-center flex flex-col items-center animate-shake">
          <XCircle className="w-44 h-44 text-[#FF007F] mb-8 drop-shadow-[0_0_60px_rgba(255,0,127,1)]" />
          <h1 className="text-8xl font-black text-white mb-6 tracking-widest drop-shadow-2xl uppercase">
            FALSE ALARM!
          </h1>
          <p className="text-4xl text-[#FFE066] font-black uppercase tracking-[0.3em] bg-[#10002B]/95 px-12 py-5 rounded-2xl border-4 border-[#FF007F] shadow-[0_0_50px_rgba(255,0,127,0.8)]">
            PENALTY: -100 POINTS TO {gameState.mathErrorPlayerName}
          </p>
        </div>
      </div>
    );
  }

  // ── 7. TACTICAL POWER ANIMATIONS ────────────────────────────────────────────
  if (gameState.status === 'power_selection' || gameState.status === 'power_activated') {
    const isActivating = gameState.status === 'power_activated';
    const activePower = isActivating ? gameState.activatedPower : gameState.highlightedPower;

    if (activePower === 'stealTheNumber' && isActivating) {
      return (
        <RouletteAnimation
          targetNumber={gameState.powerTargetNumber}
          playerName={gameState.mathErrorPlayerName}
          isSelecting={false}
          round={gameState.round}
        />
      );
    }

    if (activePower === 'memoryWipe' && isActivating) {
      return (
        <BroomSweepAnimation
          erasedNumber={gameState.powerDrawnNumber}
          playerName={gameState.mathErrorPlayerName}
          round={gameState.round}
        />
      );
    }

    if (activePower === 'extraTicket' && isActivating) {
      return (
        <TicketGlideAnimation
          playerName={gameState.mathErrorPlayerName}
          round={gameState.round}
        />
      );
    }

    if (activePower === 'doublePoints' && isActivating) {
      return (
        <LightningSmokeAnimation
          playerName={gameState.mathErrorPlayerName}
          round={gameState.round}
        />
      );
    }

    if (activePower === 'dualCall' && isActivating) {
      return (
        <DualMegaphonesAnimation
          playerName={gameState.mathErrorPlayerName}
          round={gameState.round}
        />
      );
    }

    // Default Power Selection Grid (Contained cleanly inside HUD Frame, above data-port)
    return (
      <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden px-6 py-4 select-none">
        <SynthwaveBackground round={gameState.round} />

        <div className="relative z-20 w-full max-w-5xl text-center my-auto -translate-y-4">
          <div className="inline-block px-4 py-1 rounded-full bg-[#00F5D4]/10 border border-[#00F5D4]/40 text-[#00F5D4] text-xs font-mono font-bold tracking-[0.3em] uppercase mb-3 drop-shadow-[0_0_10px_rgba(0,245,212,0.4)]">
            TACTICAL RECON SYSTEM // PROTOCOL ACTIVE
          </div>

          <h2 className="text-2xl sm:text-3xl md:text-4xl text-[#00F5D4] font-black tracking-[0.25em] uppercase mb-6 sm:mb-8 animate-pulse drop-shadow-[0_0_20px_rgba(0,245,212,0.7)]">
            {isActivating ? `POWER ACTIVATED BY ${gameState.mathErrorPlayerName}` : `${gameState.mathErrorPlayerName} IS SELECTING A TACTICAL POWER`}
          </h2>

          <div className="grid grid-cols-5 gap-3 sm:gap-4 md:gap-5 w-full items-stretch justify-center">
            {[
              { id: 'stealTheNumber', name: 'Steal the Number', icon: '🎯', desc: 'Silently grab any number' },
              { id: 'memoryWipe', name: 'Memory Wipe', icon: '🧹', desc: 'Erase called number forever' },
              { id: 'extraTicket', name: 'Extra Ticket', icon: '🎟️', desc: 'Bonus ticket advantage' },
              { id: 'doublePoints', name: 'Double Points', icon: '⚡', desc: '2× points on next BINGO' },
              { id: 'dualCall', name: 'Dual Call', icon: '📡', desc: '5 double-problem bursts' },
            ].map(p => {
              const isTarget = activePower === p.id;
              return (
                <div
                  key={p.id}
                  className={`relative flex flex-col items-center justify-center p-3 sm:p-4 rounded-2xl border-2 transition-all duration-300 overflow-hidden ${isTarget
                      ? 'border-[#00F5D4] bg-[#00F5D4]/25 scale-105 shadow-[0_0_40px_rgba(0,245,212,0.8),inset_0_0_20px_rgba(0,245,212,0.3)] z-20 ring-2 ring-[#00F5D4]/60'
                      : 'border-[#7B2CBF]/50 bg-[#0A0016]/90 opacity-60 hover:opacity-90 scale-95'
                    }`}
                  style={{ minHeight: '185px', maxHeight: '215px' }}
                >
                  {/* Subtle top indicator line */}
                  <div
                    className="absolute top-0 left-0 right-0 h-1"
                    style={{ background: isTarget ? '#00F5D4' : '#7B2CBF' }}
                  />

                  <span className={`text-4xl sm:text-5xl md:text-6xl mb-2 sm:mb-3 transition-transform ${isTarget ? 'scale-110' : ''}`}>
                    {p.icon}
                  </span>
                  <span className={`text-xs sm:text-sm font-black tracking-wide text-center leading-tight ${isTarget ? 'text-white' : 'text-slate-300'}`}>
                    {p.name}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono mt-1 opacity-70 text-center leading-tight hidden sm:block">
                    {p.desc}
                  </span>

                  {isTarget && (
                    <div className="absolute bottom-1 px-2 py-0.5 rounded-full bg-[#00F5D4] text-[#050012] font-mono text-[9px] font-black uppercase tracking-widest animate-pulse mt-2">
                      ACTIVE
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ── 8. BINGO CLAIMED BY ─────────────────────────────────────────────────────
  if (gameState.status === 'bingo_claimed_by') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden select-none">
        <SynthwaveBackground round={gameState.round} />
        <div className="absolute inset-0 bg-[#FFE066]/15 pointer-events-none" />

        <div className="relative z-10 flex flex-col items-center text-center animate-in zoom-in duration-500">
          <Trophy className="w-52 h-52 text-[#FFE066] mb-8 drop-shadow-[0_0_80px_rgba(255,224,102,1)] animate-bounce" />
          <h1 className="text-8xl md:text-9xl font-black text-white tracking-widest uppercase mb-4 drop-shadow-2xl">
            BINGO CLAIMED!
          </h1>
          <div className="px-14 py-5 bg-[#10002B]/95 border-4 border-[#FFE066] rounded-3xl mt-4 shadow-[0_0_60px_rgba(255,224,102,0.8)]">
            <h2 className="text-6xl font-black text-[#FFE066] tracking-[0.2em] uppercase">
              {gameState.verifyingPlayerName}
            </h2>
          </div>
        </div>
      </div>
    );
  }

  // ── 9. VERIFYING BUILDUP (CYBER RADAR SCANNER) ──────────────────────────────
  if (gameState.status === 'verifying_buildup') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden select-none">
        <SynthwaveBackground round={gameState.round} />

        <div className="relative z-10 flex flex-col items-center text-center">
          <ScanSearch className="w-48 h-48 text-[#00F5D4] mb-8 animate-pulse drop-shadow-[0_0_60px_rgba(0,245,212,0.8)]" />
          <h2 className="text-6xl font-black text-white tracking-widest uppercase mb-3 drop-shadow-2xl">
            Verifying Ticket Matrix...
          </h2>
          <p className="text-5xl font-black text-[#00F5D4] mb-12">
            {gameState.verifyingPlayerName}
          </p>
          <div className="w-[480px] h-4 bg-[#10002B] border-2 border-[#00F5D4] rounded-full overflow-hidden shadow-[0_0_30px_rgba(0,245,212,0.6)]">
            <div className="h-full bg-gradient-to-r from-[#00F5D4] via-[#FF007F] to-[#FFE066] rounded-full"
              style={{ animation: 'progress 3s ease-in-out forwards' }} />
          </div>
          <style>{`@keyframes progress { from { width: 0% } to { width: 100% } }`}</style>
        </div>
      </div>
    );
  }

  // ── 10. CHAMPIONSHIP STANDINGS (LEADERBOARD) ────────────────────────────────
  if (gameState.status === 'leaderboard' && leaderboardData) {
    return <ChampionshipPodium leaderboardData={leaderboardData} round={gameState.round} />;
  }

  // ── 11. END ROUND SCREEN ────────────────────────────────────────────────────
  if (gameState.status === 'end_round') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden select-none">
        <SynthwaveBackground round={gameState.round} />

        <div className="relative z-10 text-center flex flex-col items-center animate-in zoom-in duration-700">
          <CheckCircle className="w-48 h-48 text-[#00F5D4] mb-8 drop-shadow-[0_0_60px_rgba(0,245,212,0.9)]" />
          <p className="text-4xl font-black text-[#FFE066] uppercase tracking-[0.5em] mb-4">
            Round {gameState.round}
          </p>
          <h1 className="text-9xl font-black text-white tracking-widest uppercase drop-shadow-2xl">
            COMPLETE
          </h1>
        </div>
      </div>
    );
  }

  // ── 12. BINGO VERIFY RESULT & WINNER REVEAL ─────────────────────────────────
  if (gameState.status === 'bingo' || verifyResult) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden p-6 select-none">
        <SynthwaveBackground round={gameState.round} />

        <div className="relative z-10 w-full flex flex-col items-center">
          {!verifyResult ? (
            <div className="flex flex-col items-center animate-bounce">
              <Trophy className="w-44 h-44 text-[#FFE066] drop-shadow-[0_0_70px_rgba(255,224,102,0.9)]" />
              <h1 className="text-8xl font-black text-white mt-8 tracking-widest drop-shadow-2xl uppercase">
                BINGO CLAIMED!
              </h1>
            </div>
          ) : (
            <div className="w-full max-w-4xl flex flex-col items-center gap-3 sm:gap-4 animate-in zoom-in duration-500 my-auto -translate-y-3">
              <div className="flex items-center gap-4 sm:gap-6">
                {verifyResult.valid
                  ? <CheckCircle className="w-14 h-14 sm:w-16 sm:h-16 text-[#00F5D4] drop-shadow-[0_0_25px_rgba(0,245,212,0.9)]" />
                  : <XCircle className="w-14 h-14 sm:w-16 sm:h-16 text-[#FF007F] drop-shadow-[0_0_25px_rgba(255,0,127,0.9)]" />}
                <div className="text-center">
                  <h1 className={`text-4xl sm:text-5xl font-black mb-1 uppercase tracking-widest ${verifyResult.valid ? 'text-[#00F5D4]' : 'text-[#FF007F]'}`}>
                    {verifyResult.playerName}
                  </h1>
                  <h2 className="text-xl sm:text-2xl font-bold text-white">{verifyResult.reason}</h2>
                  <div className="text-xl sm:text-2xl text-[#FFE066] mt-1 font-mono font-black">
                    {verifyResult.valid ? '+' : ''}{verifyResult.points} POINTS
                  </div>
                </div>
              </div>
              <BingoCard result={verifyResult} />
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── 13. MAIN GAMEPLAY SCREEN (PLAYING & PAUSED) ─────────────────────────────
  return (
    <div className="min-h-screen overflow-hidden flex flex-col justify-between relative select-none">
      <SynthwaveBackground round={gameState.round} />

      {/* TOP HUD */}
      <div className="relative z-10 flex justify-between items-start pt-12 sm:pt-14 md:pt-16 px-12 sm:px-16 md:px-20 lg:px-24">
        <div>
          <div className="text-[#00F5D4] text-xs sm:text-sm font-black uppercase tracking-[0.4em]">
            Round {gameState.round} — {ROUND_NAMES[gameState.round]}
          </div>
          <div className="text-white text-3xl sm:text-4xl font-black mt-1 drop-shadow-md">
            Phase {gameState.phase}: {gameState.phaseName}
            {gameState.patternName && (
              <span className="text-[#FFE066]"> — {gameState.patternName}</span>
            )}
          </div>
          <div className="text-slate-300 text-xs sm:text-sm mt-0.5">{gameState.phaseDescription}</div>
        </div>

        {/* Dynamic Circular Speed Dial Timer matching Inspiration Image 4 */}
        <SpeedDialTimer
          seconds={gameState.timerSeconds}
          maxSeconds={gameState.maxTimerSeconds}
        />
      </div>

      {/* CENTER EQUATION STAGE - Centered nicely in the open upper/middle viewing viewport */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-8 md:px-12 -translate-y-8 sm:-translate-y-12 md:-translate-y-16">
        <div className="text-[#00F5D4]/70 font-mono text-lg sm:text-2xl font-black tracking-widest uppercase mb-3 sm:mb-4">
          {gameState.dualCallActive && dualEq
            ? `Problems ${gameState.currentEquationIndex + 1} & ${gameState.currentEquationIndex + 2}`
            : `Problem ${gameState.currentEquationIndex + 1}`
          }
        </div>

        {gameState.status === 'paused' ? (
          <div className="font-black tracking-widest uppercase text-slate-500 drop-shadow-2xl animate-pulse"
            style={{ fontSize: 'clamp(4rem, 14vw, 11rem)' }}>
            PAUSED
          </div>
        ) : gameState.dualCallActive && dualEq ? (
          <div className="flex w-full items-center justify-center gap-10 md:gap-16">
            <div className={`flex-1 font-black tracking-tighter leading-none text-white drop-shadow-[0_0_30px_rgba(0,245,212,0.6)] transition-opacity duration-500 ${isStopped ? 'opacity-20' : 'opacity-100'}`}
              style={{ fontSize: 'clamp(2.5rem, 7vw, 6.5rem)' }}>
              {currentEq?.equationText}
            </div>
            <div className="w-1.5 h-40 bg-gradient-to-b from-[#00F5D4] via-[#FF007F] to-[#FF6B35] rounded-full shadow-[0_0_20px_#FF007F]" />
            <div className={`flex-1 font-black tracking-tighter leading-none text-white drop-shadow-[0_0_30px_rgba(255,0,127,0.6)] transition-opacity duration-500 ${isStopped ? 'opacity-20' : 'opacity-100'}`}
              style={{ fontSize: 'clamp(2.5rem, 7vw, 6.5rem)' }}>
              {dualEq.equationText}
            </div>
          </div>
        ) : (
          <div className={`font-black tracking-tighter leading-none text-white drop-shadow-[0_0_40px_rgba(0,245,212,0.7)] transition-opacity duration-500 ${isStopped ? 'opacity-20' : 'opacity-100'}`}
            style={{ fontSize: 'clamp(3.5rem, 10vw, 8.5rem)' }}>
            {currentEq?.equationText}
          </div>
        )}
      </div>

      {/* BOTTOM PROGRESS BAR */}
      <div className="h-4 w-full bg-[#10002B] border-t-2 border-[#7B2CBF]/60 relative z-10">
        <div
          className="h-full bg-gradient-to-r from-[#00F5D4] via-[#FF007F] to-[#FFE066] transition-all ease-linear shadow-[0_0_20px_rgba(0,245,212,0.8)]"
          style={{ width: `${progressPct}%`, transitionDuration: gameState.status === 'playing' ? '1000ms' : '0ms' }}
        />
      </div>
    </div>
    );
  };

  return (
    <div
      onMouseMove={handleMouseMove}
      className="fixed inset-0 w-screen h-screen max-w-screen max-h-screen overflow-hidden bg-[#060012] select-none flex flex-col"
    >
      <div className="flex-1 w-full h-full relative overflow-hidden flex flex-col">
        {renderStageView()}
      </div>

      {/* Floating Presentation Mode Toggle HUD (Auto-hides after ~2s on minimize/maximize/idle) */}
      {!isPreviewMode && (
        <div
          onMouseEnter={() => {
            if (hudTimeoutRef.current) clearTimeout(hudTimeoutRef.current);
            setShowHudControls(true);
          }}
          onMouseLeave={() => triggerBriefHud(1500)}
          className={`fixed top-3.5 right-3.5 z-50 transition-opacity duration-500 ${
            showHudControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <button
            onClick={toggleFullscreen}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#090018]/90 hover:bg-[#140226] border border-[#00F5D4]/60 hover:border-[#00F5D4] text-[#00F5D4] font-mono text-xs font-bold uppercase tracking-wider shadow-[0_0_20px_rgba(0,245,212,0.4)] backdrop-blur-md cursor-pointer transition-all duration-300 hover:scale-105 active:scale-95"
            title="Toggle Presentation Mode (F)"
          >
            {isFullscreen ? (
              <>
                <Minimize className="w-4 h-4 text-[#FF007F]" />
                <span className="hidden sm:inline">EXIT FULLSCREEN</span>
                <span className="text-[10px] text-slate-400 font-mono">[F]</span>
              </>
            ) : (
              <>
                <Maximize className="w-4 h-4 text-[#00F5D4]" />
                <span className="hidden sm:inline">PRESENTATION MODE</span>
                <span className="text-[10px] text-slate-400 font-mono">[F]</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
