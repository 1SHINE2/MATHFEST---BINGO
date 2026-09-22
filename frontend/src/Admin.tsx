import { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  Play, Pause, FastForward, Printer,
  Trophy, CheckCircle, XCircle, ChevronRight, ChevronDown, RefreshCw, Zap, RotateCcw, Home, Users, Plus, X, Menu, BookOpen, MonitorPlay, Cpu, Volume2, Radio, Square
} from 'lucide-react';
import { getBackendUrl, setCustomBackendUrl, DEFAULT_PUBLIC_BACKEND } from './utils';

const SOCKET_URL = getBackendUrl();

const ROUND_NAMES: Record<number, string> = {
  1: 'Easy', 2: 'Medium', 3: 'Difficult',
};

const TIMER_FOR_ROUND: Record<number, number> = {
  1: 10, 2: 15, 3: 20,
};

type Equation = {
  id: number;
  equationText: string;
  targetNumber: number | null;
  difficulty: number;
  isError: boolean;
};

export type GameStatus = 
  | 'title_main' | 'allison_intro' | 'mechanics' | 'title_hype' | 'loading' | 'title_round'
  | 'stopped' | 'playing' | 'paused'
  | 'math_error' | 'math_error_verifying' | 'power_selection' | 'power_activated' | 'math_error_false'
  | 'bingo_claimed_by' | 'verifying_buildup' | 'bingo' | 'leaderboard' | 'end_round';

export const ALLISON_SCRIPT = [
  {
    line: 1,
    title: "Part 1: Meet Allison",
    duration: "8s",
    cohost: "Alright everyone, give it up for our AI co-host for today’s grand finale!",
    allison: "Hey, everyone! I’m Allison. Honestly, I’ve been looking forward to this all month—it’s great to finally be here with you all."
  },
  {
    line: 2,
    title: "Part 2: Readiness & Millisecond Math",
    duration: "16s",
    cohost: "We’re super excited to have you, Allison! So, tell us… are you actually ready to run this Digital BINGO, or are you still loading?",
    allison: "Very funny! Don't worry, my numbers are shuffled and my systems are good to go. Though I have to admit… I can crunch the math in milliseconds, but I still rely on you humans to actually spot the patterns and call out BINGO!"
  },
  {
    line: 3,
    title: "Part 3: Game Partner & Arena Launch",
    duration: "10s",
    cohost: "Exactly! You handle the heavy lifting, but the real intuition comes from the crowd.",
    allison: "Couldn't have said it better myself. Think of me as your ultimate game partner today. Ready to jump in and make some history together? Let’s do this!"
  },
  {
    line: 4,
    title: "Part 4: Bridging to Mechanics",
    duration: "3.5s",
    cohost: "Well Allison, why don't you break down the mechanics for everyone?",
    allison: "I'd be glad to! Here's how we're playing today."
  }
];

type GameState = {
  status: GameStatus;
  mechanicsSlide?: number;
  allisonLine?: number;
  allisonSpeaking?: boolean;
  currentEquationIndex: number;
  timerSeconds: number;
  maxTimerSeconds: number;
  timerEndTime?: number | null;
  round: number;
  phase: number;
  phaseName: string;
  patternName: string | null;
  phaseDescription: string;
  pointMatrix: Record<number, number>;
  dualCallActive: boolean;
  dualCallRemaining?: number;
  usedPowers: Record<string, boolean>;
  mathErrorPlayerName?: string;
};

type VerifyResult = {
  valid: boolean;
  message: string;
  points: number;
  totalScore: number;
  playerName: string;
};

type Player = { id: number; name: string; score: number; extraTickets: boolean; doublePoints: boolean; assignedCardId?: string | null };
type RegisteredPlayer = { id: number; name: string; email: string | null; isVerified: boolean; verificationPin?: string | null; assignedCardId?: string | null; score: number; createdAt: string };

// Reusable Player Selection Modal (defined outside Admin to prevent unmounting on state updates)
function PlayerSelectModal({ 
  title, 
  players, 
  onSelect, 
  onClose 
}: { 
  title: string; 
  players: Player[]; 
  onSelect: (p: Player) => void; 
  onClose: () => void; 
}) {
  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-3xl p-6 w-full max-w-md shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex justify-between items-center mb-4 border-b border-slate-800 pb-4">
          <h3 className="text-xl font-bold text-white">{title}</h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-2">
          {players.map(p => (
            <button key={p.id} onClick={() => onSelect(p)}
              className="w-full text-left px-4 py-3 bg-slate-800 hover:bg-emerald-900/60 hover:border-emerald-700 border border-transparent rounded-xl text-white font-bold transition-colors flex items-center justify-between">
              <span>{p.name}</span>
              {p.assignedCardId && (
                <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-950 px-2.5 py-1 rounded border border-emerald-800">
                  {p.assignedCardId}
                </span>
              )}
            </button>
          ))}
          {players.length === 0 && <p className="text-slate-500 text-center py-4">No participants added.</p>}
        </div>
      </div>
    </div>
  );
}

export default function Admin() {
  const socketRef = useRef<Socket | null>(null);
  const [equations, setEquations] = useState<Equation[]>([]);
  const [drawn, setDrawn] = useState<number[]>([]);
  const [ticketCount, setTicketCount] = useState(20);
  const [selectedRound, setSelectedRound] = useState(1);
  const [roundDropdownOpen, setRoundDropdownOpen] = useState(false);
  const [gameState, setGameState] = useState<GameState>({
    status: 'title_main', currentEquationIndex: 0,
    timerSeconds: 10, maxTimerSeconds: 10,
    round: 1, phase: 1, phaseName: 'Line Bingo',
    patternName: null, phaseDescription: '', pointMatrix: { 1: 100, 2: 200, 3: 500 },
    dualCallActive: false,
    dualCallRemaining: 0,
    usedPowers: { stealTheNumber: false, memoryWipe: false, extraTicket: false, doublePoints: false, dualCall: false }
  });

  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Participants
  const [playerList, setPlayerList] = useState<Player[]>([]);
  const [addingPlayer, setAddingPlayer] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState('');

  // Modals for Player Selection
  const [mathErrorModalOpen, setMathErrorModalOpen] = useState(false);
  const [bingoSelectModalOpen, setBingoSelectModalOpen] = useState(false);

  // Verify Modal (Bingo)
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [cardInput, setCardInput] = useState('#CARD-');
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyingPlayer, setVerifyingPlayer] = useState<Player | null>(null);

  // Power Selector Modal
  const [powerOpen, setPowerOpen] = useState(false);
  const [selectedPower, setSelectedPower] = useState<string | null>(null);
  const [powerTargetNumber, setPowerTargetNumber] = useState('');
  const [powerDrawnNumber, setPowerDrawnNumber] = useState('');
  const [powerTargetPlayer, setPowerTargetPlayer] = useState<Player | null>(null);

  // Tracks whether a power has been executed and game is staged, waiting for host to press Continue
  const [pendingPowerResume, setPendingPowerResume] = useState(false);
  const [executedPowerName, setExecutedPowerName] = useState('');

  // Leaderboard
  const [lbRound, setLbRound] = useState<number | 'cumulative'>('cumulative');
  const lbRoundRef = useRef<number | 'cumulative'>('cumulative');
  const [leaderboard, setLeaderboard] = useState<Player[]>([]);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Registration & Audit panels
  const [activePanel, setActivePanel] = useState<'game' | 'registration' | 'audit'>('game');
  const [registeredPlayers, setRegisteredPlayers] = useState<RegisteredPlayer[]>([]);
  const [regFilter, setRegFilter] = useState<'all' | 'verified' | 'pending'>('all');
  const [auditLog, setAuditLog] = useState<{ id: number; timestamp: string; category: string; playerName: string; cardId?: string; action: string; points: number | string; details: string }[]>([]);

  useEffect(() => {
    lbRoundRef.current = lbRound;
  }, [lbRound]);

  useEffect(() => {
    const s = io(SOCKET_URL);
    socketRef.current = s;
    s.on('gameStateUpdate', (state: GameState) => {
      setGameState(state);
      if (state.round && state.round !== selectedRound) {
        setSelectedRound(state.round);
      }
    });
    s.on('sequenceUpdate', (seq: Equation[]) => setEquations(seq));
    s.on('leaderboardUpdate', () => {
      refreshLeaderboard(lbRoundRef.current);
      refreshPlayers();
    });
    s.on('playersUpdate', (players: Player[]) => {
      setPlayerList(players);
    });
    s.on('playerRegistered', () => {
      refreshRegisteredPlayers();
      refreshPlayers();
      refreshAuditLog();
    });
    s.on('auditLogUpdate', (entry: any) => {
      setAuditLog(prev => [entry, ...prev.filter(e => e.id !== entry.id)]);
    });
    fetch(`${SOCKET_URL}/api/game/drawn`).then(r => r.json()).then(d => setDrawn(d.drawn)).catch(() => null);
    fetch(`${SOCKET_URL}/api/game/sequence?round=1`).then(r => r.json()).then(seq => {
      if (Array.isArray(seq) && seq.length > 0) setEquations(seq);
    }).catch(() => null);
    refreshPlayers();
    refreshLeaderboard();
    refreshRegisteredPlayers();
    refreshAuditLog();

    const pollInterval = setInterval(() => {
      refreshPlayers();
      refreshRegisteredPlayers();
      refreshAuditLog();
    }, 3000);

    return () => {
      s.disconnect();
      clearInterval(pollInterval);
    };
  }, []);

  const emit = useCallback((event: string, data?: any) => socketRef.current?.emit(event, data), []);

  const refreshPlayers = async () => {
    try {
      const res = await fetch(`${SOCKET_URL}/api/players`);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        setPlayerList(data);
        return data as Player[];
      } else if (SOCKET_URL !== DEFAULT_PUBLIC_BACKEND) {
        const cloudRes = await fetch(`${DEFAULT_PUBLIC_BACKEND}/api/players`).catch(() => null);
        if (cloudRes && cloudRes.ok) {
          const cloudData = await cloudRes.json();
          if (Array.isArray(cloudData) && cloudData.length > 0) {
            setPlayerList(cloudData);
            return cloudData as Player[];
          }
        }
      }
      setPlayerList(data || []);
      return (data || []) as Player[];
    } catch {
      return [] as Player[];
    }
  };

  const refreshRegisteredPlayers = async () => {
    try {
      const res = await fetch(`${SOCKET_URL}/api/register/players`);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        setRegisteredPlayers(data);
      } else if (SOCKET_URL !== DEFAULT_PUBLIC_BACKEND) {
        const cloudRes = await fetch(`${DEFAULT_PUBLIC_BACKEND}/api/register/players`).catch(() => null);
        if (cloudRes && cloudRes.ok) {
          const cloudData = await cloudRes.json();
          setRegisteredPlayers(cloudData || []);
        } else {
          setRegisteredPlayers(data || []);
        }
      } else {
        setRegisteredPlayers(data || []);
      }
    } catch {
      try {
        const cloudRes = await fetch(`${DEFAULT_PUBLIC_BACKEND}/api/register/players`);
        const cloudData = await cloudRes.json();
        setRegisteredPlayers(cloudData || []);
      } catch { /* ignore */ }
    }
  };


  const refreshAuditLog = async () => {
    try {
      const res = await fetch(`${SOCKET_URL}/api/admin/audit-log`);
      const data = await res.json();
      setAuditLog(data);
    } catch { /* ignore */ }
  };

  const adminVerifyPlayer = async (id: number, name: string) => {
    if (!confirm(`Manually verify participant "${name}" without requiring email PIN?`)) return;
    try {
      await fetch(`${SOCKET_URL}/api/register/admin-verify/${id}`, { method: 'POST' });
      refreshRegisteredPlayers();
      refreshPlayers();
      refreshAuditLog();
    } catch { /* ignore */ }
  };

  const deleteRegisteredPlayer = async (id: number, name: string) => {
    if (!confirm(`Are you sure you want to delete participant "${name}"?`)) return;
    try {
      await fetch(`${SOCKET_URL}/api/register/players/${id}`, { method: 'DELETE' });
      refreshRegisteredPlayers();
      refreshPlayers();
      refreshAuditLog();
    } catch { /* ignore */ }
  };

  const addPlayer = async () => {
    const name = newPlayerName.trim();
    if (!name) return;
    await fetch(`${SOCKET_URL}/api/players`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    setNewPlayerName('');
    setAddingPlayer(false);
    await refreshPlayers();
  };

  const deletePlayer = async (id: number) => {
    if (!confirm('Remove this participant?')) return;
    await fetch(`${SOCKET_URL}/api/players/${id}`, { method: 'DELETE' });
    await refreshPlayers();
  };

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (gameState.status !== 'playing') return;
    const interval = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(interval);
  }, [gameState.status]);

  const displaySeconds = (gameState.status === 'playing' && gameState.timerEndTime)
    ? Math.max(0, Math.ceil((gameState.timerEndTime - now) / 1000))
    : gameState.timerSeconds;

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (gameState.status !== 'playing') return;

    const interval = setInterval(() => {
      if (gameState.timerEndTime && Date.now() >= gameState.timerEndTime) {
        handleNext();
      }
    }, 200);

    return () => clearInterval(interval);
  }, [gameState.status, gameState.timerEndTime, gameState.currentEquationIndex]);

  // Game Actions
  const showMainTitle = () => emit('updateGameState', { status: 'title_main' });
  const showAllisonIntro = () => emit('updateGameState', { status: 'allison_intro', allisonLine: 1, allisonSpeaking: false });
  const playAllisonLine = (line: number) => emit('playAllisonLine', { line });
  const stopAllisonAudio = () => emit('stopAllisonAudio');
  const nextAllisonLine = () => {
    const cur = gameState.allisonLine ?? 1;
    const nxt = cur >= 4 ? 1 : cur + 1;
    emit('playAllisonLine', { line: nxt });
  };
  const showMechanics = (slide = 1) => emit('updateGameState', { status: 'mechanics', mechanicsSlide: slide });
  const nextMechanicsSlide = () => emit('updateGameState', { mechanicsSlide: Math.min(14, (gameState.mechanicsSlide ?? 1) + 1) });
  const prevMechanicsSlide = () => emit('updateGameState', { mechanicsSlide: Math.max(1, (gameState.mechanicsSlide ?? 1) - 1) });
  const showHypeTitle = () => emit('updateGameState', { status: 'title_hype' });
  const showLoadingSequence = () => emit('updateGameState', { status: 'loading' });
  const loadSequenceForRound = (round: number) => {
    setSelectedRound(round);
    emit('loadSequence', { round });
  };

  const startPhaseIntro = () => {
    const t = TIMER_FOR_ROUND[gameState.round] ?? 10;
    emit('updateGameState', { status: 'title_round', timerSeconds: t, maxTimerSeconds: t });
  };

  const startPlaying = async () => {
    if (gameState.currentEquationIndex === 0) {
      const eq = equations[0];
      if (eq?.targetNumber != null) {
        await fetch(`${SOCKET_URL}/api/game/drawn`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetNumber: eq.targetNumber }),
        });
      }
    }
    emit('updateGameState', { status: 'playing' });
  };

  const handlePause = () => emit('updateGameState', { status: 'paused' });

  const handleNext = useCallback(async () => {
    const isDual = gameState.dualCallActive && (gameState.dualCallRemaining ?? 0) > 0;
    const increment = isDual ? 2 : 1;
    const nextIdx = gameState.currentEquationIndex + increment;

    if (nextIdx < equations.length) {
      const nextEq = equations[nextIdx];
      const t = TIMER_FOR_ROUND[nextEq.difficulty] ?? 10;

      const targets: number[] = [];
      if (nextEq.targetNumber != null) targets.push(nextEq.targetNumber);

      let newDualRemaining = gameState.dualCallRemaining ?? 0;
      let newDualActive = gameState.dualCallActive;

      if (isDual) {
        const dualEq = equations[nextIdx + 1];
        if (dualEq?.targetNumber != null) targets.push(dualEq.targetNumber);

        newDualRemaining = (gameState.dualCallRemaining ?? 5) - 1;
        if (newDualRemaining <= 0) {
          newDualActive = false;
          newDualRemaining = 0;
        }
      }

      emit('updateGameState', {
        currentEquationIndex: nextIdx,
        timerSeconds: t, 
        maxTimerSeconds: t,
        status: 'playing',
        dualCallActive: newDualActive,
        dualCallRemaining: newDualRemaining,
      });

      if (targets.length > 0) {
        await fetch(`${SOCKET_URL}/api/game/drawn`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetNumbers: targets }),
        });
        fetch(`${SOCKET_URL}/api/game/drawn`).then(r => r.json()).then(d => setDrawn(d.drawn));
      }
    } else {
      emit('updateGameState', { status: 'stopped' });
    }
  }, [gameState.currentEquationIndex, gameState.dualCallActive, gameState.dualCallRemaining, equations, emit]);

  const advancePhase = async () => {
    await fetch(`${SOCKET_URL}/api/game/advance-phase`, { method: 'POST' });
    refreshLeaderboard();
  };

  // Leaderboard
  const refreshLeaderboard = async (round: number | 'cumulative' = lbRound) => {
    const res = await fetch(round === 'cumulative' ? `${SOCKET_URL}/api/leaderboard` : `${SOCKET_URL}/api/leaderboard?round=${round}`);
    setLeaderboard(await res.json());
  };

  const resetScores = async () => {
    if (!confirm('Reset ALL scores? This cannot be undone.')) return;
    await fetch(`${SOCKET_URL}/api/reset-scores`, { method: 'POST' });
    setLeaderboard([]);
  };

  const showLeaderboardOnStage = () => {
    if (gameState.status === 'playing') emit('updateGameState', { status: 'paused' });
    if (lbRound === 'cumulative') {
      emit('showLeaderboard', { mode: 'cumulative' });
    } else {
      emit('showLeaderboard', { mode: 'round', round: lbRound });
    }
  };

  // Bingo Flow
  const handleBingoClaimed = (player: Player) => {
    setBingoSelectModalOpen(false);
    setVerifyingPlayer(player);
    emit('bingoClaimed', { playerName: player.name });
    setVerifyOpen(true);
    setVerifyResult(null);
    setCardInput(player.assignedCardId ? player.assignedCardId : '#CARD-');
  };

  const runVerify = async () => {
    if (!verifyingPlayer) return;
    setVerifying(true);
    try {
      const res = await fetch(`${SOCKET_URL}/api/verify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: cardInput.trim().toUpperCase(), playerName: verifyingPlayer.name }),
      });
      const data = await res.json();
      setVerifyResult(res.ok ? data : { ...data, valid: false, message: data.error ?? 'Error' });
      refreshLeaderboard();
      refreshPlayers();
    } finally {
      setVerifying(false);
    }
  };

  const closeVerify = () => {
    setVerifyOpen(false);
    emit('updateGameState', { status: 'paused' });
  };

  // Math Error Flow
  const claimMathError = (player: Player) => {
    setMathErrorModalOpen(false);
    const currentEq = equations[gameState.currentEquationIndex];
    const isDual = gameState.dualCallActive && (gameState.dualCallRemaining ?? 0) > 0;
    const dualEq = isDual ? equations[gameState.currentEquationIndex + 1] : null;
    const hasError = (currentEq && currentEq.isError) || (dualEq && dualEq.isError);
    
    if (hasError) {
      emit('mathErrorClaimed', { playerName: player.name });
      setPowerTargetPlayer(player);
      setSelectedPower(null);
      setPowerTargetNumber('');
      setPowerDrawnNumber('');
      setPendingPowerResume(false);
      setExecutedPowerName('');
      fetch(`${SOCKET_URL}/api/game/drawn`).then(r => r.json()).then(d => setDrawn(d.drawn));
      refreshLeaderboard(lbRound);
      refreshPlayers();
      // Open power modal immediately — no 3s timer needed
      setPowerOpen(true);
    } else {
      // False Alarm!
      emit('mathErrorFalseAlarm', { playerName: player.name });
      refreshLeaderboard(lbRound);
      refreshPlayers();
      alert(`False Alarm! 100 points deducted from ${player.name}.`);
    }
  };

  const handleFalseAlarmManual = () => {
    if (powerTargetPlayer) {
      emit('mathErrorFalseAlarm', { playerName: powerTargetPlayer.name });
      refreshLeaderboard(lbRound);
      refreshPlayers();
    }
    setPowerOpen(false);
    setPendingPowerResume(false);
    setExecutedPowerName('');
  };

  // Called after a power was executed and the host presses Continue
  const resumeWithPower = useCallback(async () => {
    setPendingPowerResume(false);
    setExecutedPowerName('');
    if (gameState.dualCallActive && (gameState.dualCallRemaining ?? 0) > 0) {
      // Dual Call: Math error was already dropped by backend.
      // Pair 1 is ready right now at currentEquationIndex & currentEquationIndex + 1.
      const eq1 = equations[gameState.currentEquationIndex];
      const eq2 = equations[gameState.currentEquationIndex + 1];
      const targets: number[] = [];
      if (eq1?.targetNumber != null) targets.push(eq1.targetNumber);
      if (eq2?.targetNumber != null) targets.push(eq2.targetNumber);
      if (targets.length > 0) {
        await fetch(`${SOCKET_URL}/api/game/drawn`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetNumbers: targets }),
        });
        fetch(`${SOCKET_URL}/api/game/drawn`).then(r => r.json()).then(d => setDrawn(d.drawn));
      }
      const t = TIMER_FOR_ROUND[eq1?.difficulty ?? gameState.round] ?? 10;
      emit('updateGameState', { status: 'playing', timerSeconds: t, maxTimerSeconds: t });
    } else {
      // For all other powers, advance to the next equation
      await handleNext();
    }
  }, [handleNext, gameState.dualCallActive, gameState.dualCallRemaining, gameState.currentEquationIndex, gameState.round, equations, emit]);

  const selectPower = (powerId: string) => {
    setSelectedPower(powerId);
    emit('highlightPower', { power: powerId });
  };

  const executePower = async () => {
    if (!selectedPower || !powerTargetPlayer) return;
    if (selectedPower === 'stealTheNumber') {
      const num = Number(powerTargetNumber);
      if (!powerTargetNumber || drawn.includes(num)) {
        return alert(`Number ${num} is already drawn!`);
      }
    }
    if (selectedPower === 'memoryWipe') {
      const num = Number(powerDrawnNumber);
      if (!powerDrawnNumber || !drawn.includes(num)) {
        return alert(`Number ${num} has not been drawn!`);
      }
    }

    try {
      const res = await fetch(`${SOCKET_URL}/api/game/use-power`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          power: selectedPower,
          targetNumber: powerTargetNumber,
          playerName: powerTargetPlayer.name,
          drawnNumber: powerDrawnNumber
        })
      });
      if (!res.ok) {
        const err = await res.json();
        return alert(err.error);
      }
      
      const payload = {
        power: selectedPower, 
        playerName: powerTargetPlayer.name,
        targetNumber: powerTargetNumber,
        drawnNumber: powerDrawnNumber
      };
      emit('activatePower', payload);
      
      // Stage the power — close modal, show Continue button
      const powerLabel = selectedPower === 'dualCall' ? 'Dual Call'
        : selectedPower === 'stealTheNumber' ? 'Steal the Number'
        : selectedPower === 'memoryWipe' ? 'Memory Wipe'
        : selectedPower === 'extraTicket' ? 'Extra Ticket'
        : selectedPower === 'doublePoints' ? 'Double Points'
        : selectedPower;
      setExecutedPowerName(powerLabel);
      setPendingPowerResume(true);
      setPowerOpen(false);
    } catch (e) {
      console.error(e);
    }
  };

  const undoPower = async (power: string) => {
    await fetch(`${SOCKET_URL}/api/game/toggle-power`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ power, active: false })
    });
  };

  const generatePDFs = async () => {
    await fetch(`${SOCKET_URL}/api/cards/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: ticketCount }),
    });
    const a = document.createElement('a');
    a.href = `${SOCKET_URL}/api/cards/print?count=${ticketCount}`;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const currentEq = equations[gameState.currentEquationIndex];
  const dualEq = gameState.dualCallActive ? equations[gameState.currentEquationIndex + 1] : null;

  // Open Math Error flow: IMMEDIATELY pause the game so timer & audio freeze
  const openMathError = () => {
    if (gameState.status === 'playing') {
      emit('updateGameState', { status: 'paused' });
    }
    setMathErrorModalOpen(true);
  };

  // Open Bingo flow: IMMEDIATELY pause the game so timer & audio freeze
  const openBingo = () => {
    if (gameState.status === 'playing') {
      emit('updateGameState', { status: 'paused' });
    }
    setBingoSelectModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      {/* TOP BAR */}
      <div className="bg-slate-900 border-b border-slate-800 px-6 py-3 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-4">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300">
            <Menu className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-black bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-teal-400">
              Host Controller
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Interactive Round Selector Dropdown (Seamless click & re-select) */}
          <div className="relative">
            <button
              onClick={() => setRoundDropdownOpen(v => !v)}
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl px-3 py-1.5 text-sm transition-colors cursor-pointer select-none"
            >
              <span className="text-slate-400 text-sm">Round:</span>
              <span className="text-white font-semibold text-sm">
                {selectedRound} — {ROUND_NAMES[selectedRound]} ({TIMER_FOR_ROUND[selectedRound]}s)
              </span>
              <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${roundDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {roundDropdownOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setRoundDropdownOpen(false)} />
                <div className="absolute left-0 mt-2 w-64 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl py-1.5 z-50 overflow-hidden">
                  {[1, 2, 3].map(r => (
                    <button
                      key={r}
                      onClick={() => {
                        loadSequenceForRound(r);
                        setRoundDropdownOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2.5 text-sm font-semibold flex items-center justify-between transition-colors cursor-pointer ${
                        selectedRound === r
                          ? 'bg-emerald-600/25 text-emerald-400 border-l-4 border-emerald-400'
                          : 'text-slate-200 hover:bg-slate-700 hover:text-white'
                      }`}
                    >
                      <span>{r} — {ROUND_NAMES[r]}</span>
                      <span className="text-xs text-slate-400 font-mono">({TIMER_FOR_ROUND[r]}s)</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="w-px h-6 bg-slate-800 mx-1" />

          <div className="flex items-center gap-1">
            <input type="number" min={2} step={2} value={ticketCount}
              onChange={e => setTicketCount(parseInt(e.target.value) || 2)}
              className="w-14 text-center px-2 py-1.5 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm" />
            <button onClick={generatePDFs}
              className="flex items-center gap-2 px-4 py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded-xl text-sm font-medium transition-colors">
              <Printer className="w-4 h-4" /> Generate PDF
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* LEFT PANEL: PARTICIPANTS */}
        <div className={`${sidebarOpen ? 'w-72' : 'w-0'} flex-shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col transition-all duration-300 overflow-hidden`}>
          <div className="p-4 border-b border-slate-800 flex items-center justify-between min-w-[18rem]">
            <div className="flex items-center gap-2 text-emerald-400 font-bold">
              <Users className="w-5 h-5" />
              <span>Participants</span>
            </div>
            <button onClick={() => setAddingPlayer(v => !v)}
              className="w-7 h-7 rounded-lg bg-emerald-900/40 text-emerald-400 hover:bg-emerald-800/60 flex items-center justify-center transition-colors">
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {addingPlayer && (
            <div className="p-3 border-b border-slate-800 space-y-2 min-w-[18rem]">
              <input
                type="text"
                value={newPlayerName}
                onChange={e => setNewPlayerName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addPlayer()}
                placeholder="Enter name..."
                autoFocus
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white text-sm outline-none focus:border-emerald-500"
              />
              <div className="flex gap-2">
                <button onClick={addPlayer}
                  className="flex-1 py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded-lg text-sm font-bold transition-colors">
                  Add
                </button>
                <button onClick={() => { setAddingPlayer(false); setNewPlayerName(''); }}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar min-w-[18rem]">
            {playerList.map(p => (
              <div key={p.id} className="w-full flex items-center gap-1 rounded-xl border border-transparent hover:bg-slate-800 transition-all">
                <div className="flex-1 px-3 py-2 text-sm font-medium flex items-center justify-between gap-2 min-w-0">
                  <span className="truncate text-slate-300">{p.name}</span>
                  <div className="flex items-center gap-1 flex-shrink-0 text-xs">
                    {p.extraTickets && <span title="Extra Ticket">🎟️</span>}
                    {p.doublePoints && <span title="Double Points">⚡</span>}
                    <span className="text-emerald-400 font-mono">{p.score}</span>
                  </div>
                </div>
                <button onClick={() => deletePlayer(p.id)}
                  title="Remove participant"
                  className="p-1.5 mr-1 text-slate-600 hover:text-red-400 hover:bg-red-950/40 rounded-lg transition-colors flex-shrink-0">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* CENTER PANEL: GAMEPLAY / REGISTRATION */}
        <div className="flex-1 flex flex-col p-6 overflow-y-auto custom-scrollbar">

          {/* Tab Switcher */}
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setActivePanel('game')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
                activePanel === 'game'
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/20'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
              }`}
            >
              <MonitorPlay className="w-4 h-4" /> Game Control
            </button>
            <button
              onClick={() => { setActivePanel('registration'); refreshRegisteredPlayers(); }}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
                activePanel === 'registration'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
              }`}
            >
              <Users className="w-4 h-4" /> Registration
            </button>
            <button
              onClick={() => { setActivePanel('audit'); refreshAuditLog(); }}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
                activePanel === 'audit'
                  ? 'bg-amber-600 text-white shadow-lg shadow-amber-500/20'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
              }`}
            >
              <Trophy className="w-4 h-4" /> Audit Ledger
            </button>
          </div>

          {/* ── REGISTRATION PANEL ── */}
          {activePanel === 'registration' && (
            <div className="space-y-5">
              {/* Connected Server Indicator Banner */}
              <div className="bg-slate-900 border border-indigo-900/60 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-slate-300 font-semibold">Active Admin Backend:</span>
                  <span className="font-mono text-indigo-300 font-bold bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
                    {SOCKET_URL || 'https://mathfest-bingo.onrender.com (Proxy)'}
                  </span>
                </div>
                  <button
                    onClick={() => {
                      const url = prompt(
                        'Enter Backend API Server URL for Admin UI:\n\n• For Render Cloud: https://mathfest-bingo.onrender.com\n• For Local Laptop: http://localhost:3001',
                        SOCKET_URL || 'https://mathfest-bingo.onrender.com'
                      );
                      if (url !== null) {
                        setCustomBackendUrl(url);
                        window.location.reload();
                      }
                    }}
                    className="px-3 py-1.5 bg-indigo-900/40 hover:bg-indigo-800/60 border border-indigo-700/60 text-indigo-300 rounded-lg font-bold transition-all cursor-pointer"
                  >
                    ⚙️ Switch Server Database →
                  </button>
              </div>




              {/* Header */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-black text-white flex items-center gap-2">
                    <span className="text-2xl">📋</span> Registration Management
                  </h2>
                  <p className="text-slate-400 text-sm mt-0.5">
                    Players who registered via the <span className="text-indigo-400 font-mono">/register</span> page. Verified players are automatically added to the Participants list.
                  </p>
                </div>
                <button onClick={refreshRegisteredPlayers}
                  className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer" title="Refresh list">
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>

              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'Total Registrations', value: registeredPlayers.length, color: 'text-white' },
                  { label: 'Verified', value: registeredPlayers.filter(p => p.isVerified).length, color: 'text-emerald-400' },
                  { label: 'Pending', value: registeredPlayers.filter(p => !p.isVerified).length, color: 'text-amber-400' },
                ].map(stat => (
                  <div key={stat.label} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center">
                    <div className={`text-3xl font-black ${stat.color}`}>{stat.value}</div>
                    <div className="text-slate-400 text-xs mt-1 uppercase tracking-widest">{stat.label}</div>
                  </div>
                ))}
              </div>

              {/* Filter Tabs */}
              <div className="flex gap-2">
                {(['all', 'verified', 'pending'] as const).map(f => (
                  <button key={f} onClick={() => setRegFilter(f)}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                      regFilter === f
                        ? f === 'verified' ? 'bg-emerald-700 text-white'
                          : f === 'pending' ? 'bg-amber-700 text-white'
                          : 'bg-slate-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    {f === 'all' ? `All (${registeredPlayers.length})` : f === 'verified'
                      ? `Verified (${registeredPlayers.filter(p => p.isVerified).length})`
                      : `Pending (${registeredPlayers.filter(p => !p.isVerified).length})`}
                  </button>
                ))}
              </div>

              {/* Player Table */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                <div className="grid grid-cols-[1fr_1.2fr_1fr_auto_auto_auto] text-xs font-bold uppercase tracking-widest text-slate-500 px-5 py-3 border-b border-slate-800">
                  <span>Name</span>
                  <span>Google Account</span>
                  <span>Card ID</span>
                  <span className="text-center">Status</span>
                  <span className="text-center">Registered</span>
                  <span className="text-right">Actions</span>
                </div>
                <div className="divide-y divide-slate-800/60 max-h-[400px] overflow-y-auto custom-scrollbar">
                  {registeredPlayers
                    .filter(p => regFilter === 'all' || (regFilter === 'verified' ? p.isVerified : !p.isVerified))
                    .map(p => (
                      <div key={p.id} className="grid grid-cols-[1fr_1.2fr_1fr_auto_auto_auto] items-center px-5 py-3.5 hover:bg-slate-800/40 transition-colors">
                        <div className="font-semibold text-white truncate pr-3">{p.name}</div>
                        <div className="text-slate-400 font-mono text-xs truncate pr-3">{p.email || '—'}</div>
                        <div className="text-emerald-400 font-mono text-xs font-bold truncate pr-3">
                          {p.assignedCardId ? (
                            <span className="bg-emerald-950/70 border border-emerald-800 px-2.5 py-1 rounded-lg">{p.assignedCardId}</span>
                          ) : (
                            <span className="text-slate-600 font-normal">—</span>
                          )}
                        </div>
                        <div className="text-center px-3">
                          {p.isVerified ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-900/50 border border-emerald-700 rounded-full text-emerald-400 text-xs font-bold">
                              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />Verified
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-900/40 border border-amber-600/80 rounded-full text-amber-300 text-xs font-bold shadow-[0_0_10px_rgba(245,158,11,0.2)]" title="Host PIN Backup">
                              🔑 PIN: <strong className="text-amber-200 font-mono text-sm tracking-wider">{p.verificationPin || 'Generating'}</strong>
                            </span>
                          )}
                        </div>
                        <div className="text-slate-500 text-xs font-mono text-center whitespace-nowrap px-3">
                          {new Date(p.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                        <div className="text-right flex items-center justify-end gap-2">
                          {!p.isVerified && (
                            <button
                              onClick={() => adminVerifyPlayer(p.id, p.name)}
                              className="px-2.5 py-1.5 bg-emerald-950/60 hover:bg-emerald-600/50 border border-emerald-700 text-emerald-300 hover:text-emerald-100 rounded-lg transition-all cursor-pointer inline-flex items-center gap-1 text-xs font-bold"
                              title="Manually verify participant immediately"
                            >
                              <CheckCircle className="w-3.5 h-3.5" /> Verify
                            </button>
                          )}
                          <button
                            onClick={() => deleteRegisteredPlayer(p.id, p.name)}
                            className="px-2.5 py-1.5 bg-red-950/40 hover:bg-red-600/30 border border-red-800/50 text-red-400 hover:text-red-200 rounded-lg transition-all cursor-pointer inline-flex items-center gap-1 text-xs font-bold"
                            title="Delete participant registration"
                          >
                            <X className="w-3.5 h-3.5" /> Delete
                          </button>
                        </div>
                      </div>
                    ))}

                  {registeredPlayers.filter(p => regFilter === 'all' || (regFilter === 'verified' ? p.isVerified : !p.isVerified)).length === 0 && (
                    <div className="px-5 py-10 text-center text-slate-600 text-sm">
                      {regFilter === 'all' ? 'No registrations yet. Share the /register link with players.' : `No ${regFilter} players.`}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── AUDIT LEDGER PANEL ── */}
          {activePanel === 'audit' && (
            <div className="space-y-5">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-black text-white flex items-center gap-2">
                    <span className="text-2xl">📊</span> Event Audit Ledger &amp; 3-Spreadsheet Exporter
                  </h2>
                  <p className="text-slate-400 text-sm mt-0.5">
                    Official timestamped records for Game Event Timelines, Participant Ledgers, and Standings.
                  </p>
                </div>
                <a
                  href={`${SOCKET_URL}/api/admin/export-all-sheets`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-6 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 rounded-xl font-black text-white text-sm tracking-wide shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 transition-all hover:scale-105"
                >
                  📊 Download Master 3-in-1 Google Sheets Workbook ⬇
                </a>
              </div>

              {/* 3 Structured Spreadsheet Buttons */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <a
                  href={`${SOCKET_URL}/api/admin/export-sheet1`}
                  target="_blank"
                  rel="noreferrer"
                  className="p-4 bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-indigo-500/50 rounded-2xl transition-all group"
                >
                  <div className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-1">1st Spreadsheet</div>
                  <div className="text-white font-bold text-base group-hover:text-indigo-300 transition-colors">📄 Game Event Timeline</div>
                  <div className="text-slate-400 text-xs mt-1">Round &amp; Phase Starts, Bingos, Math Errors &amp; False Alarms</div>
                </a>

                <a
                  href={`${SOCKET_URL}/api/admin/export-sheet2`}
                  target="_blank"
                  rel="noreferrer"
                  className="p-4 bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-purple-500/50 rounded-2xl transition-all group"
                >
                  <div className="text-xs font-bold text-purple-400 uppercase tracking-widest mb-1">2nd Spreadsheet</div>
                  <div className="text-white font-bold text-base group-hover:text-purple-300 transition-colors">👤 Participant Action Ledger</div>
                  <div className="text-slate-400 text-xs mt-1">Detailed action breakdown &amp; cumulative points per participant</div>
                </a>

                <a
                  href={`${SOCKET_URL}/api/admin/export-sheet3`}
                  target="_blank"
                  rel="noreferrer"
                  className="p-4 bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-amber-500/50 rounded-2xl transition-all group"
                >
                  <div className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-1">3rd Spreadsheet</div>
                  <div className="text-white font-bold text-base group-hover:text-amber-300 transition-colors">🏆 Tournament Standings</div>
                  <div className="text-slate-400 text-xs mt-1">Round 1, Round 2, Round 3 &amp; Overall Cumulative Standings</div>
                </a>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-950 text-slate-400 text-xs font-bold uppercase tracking-wider border-b border-slate-800">
                    <tr>
                      <th className="px-5 py-3.5">Timestamp</th>
                      <th className="px-5 py-3.5">Category</th>
                      <th className="px-5 py-3.5">Player Name</th>
                      <th className="px-5 py-3.5">Card ID</th>
                      <th className="px-5 py-3.5">Action</th>
                      <th className="px-5 py-3.5">Points</th>
                      <th className="px-5 py-3.5">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {auditLog.length === 0 ? (
                      <tr><td colSpan={7} className="px-5 py-8 text-center text-slate-500 font-sans italic">No events logged yet. Events will appear here as players register and play.</td></tr>
                    ) : (
                      auditLog.map(e => (
                        <tr key={e.id} className="hover:bg-slate-800/40 transition-colors">
                          <td className="px-5 py-3 text-slate-400 text-xs">{e.timestamp}</td>
                          <td className="px-5 py-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                              e.category === 'REGISTRATION' ? 'bg-indigo-900/60 text-indigo-300 border border-indigo-700'
                              : e.category === 'BINGO' ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-700'
                              : e.category === 'TACTICAL POWER' ? 'bg-purple-900/60 text-purple-300 border border-purple-700'
                              : 'bg-amber-900/60 text-amber-300 border border-amber-700'
                            }`}>{e.category}</span>
                          </td>
                          <td className="px-5 py-3 text-white font-bold font-sans">{e.playerName}</td>
                          <td className="px-5 py-3 text-emerald-400 font-bold font-mono text-xs">{e.cardId || '—'}</td>
                          <td className="px-5 py-3 text-slate-200">{e.action}</td>
                          <td className="px-5 py-3 text-emerald-400 font-bold">{e.points}</td>
                          <td className="px-5 py-3 text-slate-400 text-xs font-sans">{e.details}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── GAME CONTROL PANEL ── */}
          {activePanel === 'game' && (
          <div>
          {/* Status Banner */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex items-center justify-between shadow-xl mb-6">
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
                Round {gameState.round} — {ROUND_NAMES[gameState.round]} · Phase {gameState.phase}
              </div>
              <div className="text-2xl font-black text-white flex items-center gap-3">
                State:
                <span className="text-emerald-400 uppercase tracking-widest">{gameState.status.replace(/_/g, ' ')}</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {gameState.status === 'allison_intro' && (
                <button onClick={() => showMechanics(1)}
                  className="px-6 py-3 bg-teal-600 hover:bg-teal-500 rounded-xl font-bold transition-all shadow-lg text-white flex items-center gap-2 animate-pulse cursor-pointer">
                  <BookOpen className="w-5 h-5" /> Proceed to Mechanics ▶
                </button>
              )}
              {gameState.status === 'title_hype' && (
                <button onClick={showLoadingSequence}
                  className="px-6 py-3 bg-cyan-600 hover:bg-cyan-500 rounded-xl font-bold transition-all shadow-lg text-white flex items-center gap-2 animate-pulse cursor-pointer">
                  <Cpu className="w-5 h-5" /> Show Generating Sequence ▶
                </button>
              )}
              {gameState.status === 'loading' && (
                <button onClick={startPhaseIntro}
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold transition-all shadow-lg text-white flex items-center gap-2 animate-pulse cursor-pointer">
                  <Volume2 className="w-5 h-5" /> Show Winning Patterns (AI Voice) ▶
                </button>
              )}
              {gameState.status === 'title_round' && (
                <button onClick={startPlaying}
                  className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-bold transition-all shadow-lg text-white flex items-center gap-2 animate-pulse cursor-pointer">
                  <Play className="w-5 h-5" /> Start Timer & Play ▶
                </button>
              )}
            </div>
          </div>

          <div className="flex gap-6">
            {/* Equation & Timer Area / Allison Script Controller */}
            {gameState.status === 'allison_intro' ? (
              <div className="flex-1 space-y-4">
                <div className="bg-slate-900 border border-fuchsia-500/30 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
                  {/* Header */}
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5 mb-5">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-fuchsia-500/20 border border-fuchsia-500/50 flex items-center justify-center text-fuchsia-400 shadow-[0_0_20px_rgba(217,70,239,0.3)]">
                        <Radio className="w-6 h-6 animate-pulse" />
                      </div>
                      <div>
                        <h2 className="text-xl font-black text-white flex items-center gap-2">
                          <span>Allison AI Co-Host Introduction</span>
                          <span className={`text-xs font-mono px-2.5 py-0.5 rounded-full border ${
                            gameState.allisonSpeaking
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 animate-pulse'
                              : 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40'
                          }`}>
                            {gameState.allisonSpeaking ? '● BROADCASTING' : 'IDLE / STANDBY'}
                          </span>
                        </h2>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Read the MC / Co-Host cues aloud to the audience, then click each corresponding button for Allison to speak.
                        </p>
                      </div>
                    </div>

                    {/* Prompter Controls */}
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <button
                        onClick={nextAllisonLine}
                        className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-sm font-bold flex items-center gap-2 shadow-[0_0_20px_rgba(16,185,129,0.35)] transition-all hover:scale-105 active:scale-95 cursor-pointer"
                      >
                        <Play className="w-4 h-4 fill-white" />
                        Next Line (Part {((gameState.allisonLine ?? 1) >= 4 ? 1 : (gameState.allisonLine ?? 1) + 1)}) ▶
                      </button>
                      <button
                        onClick={stopAllisonAudio}
                        className="px-4 py-2.5 bg-rose-900/80 hover:bg-rose-700 border border-rose-700/60 text-white rounded-xl text-sm font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Square className="w-4 h-4" /> Stop Voice
                      </button>
                      <button
                        onClick={() => showMechanics(1)}
                        className="px-5 py-2.5 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-sm font-bold flex items-center gap-2 shadow-lg transition-all cursor-pointer"
                      >
                        <BookOpen className="w-4 h-4" /> Next: Mechanics ▶
                      </button>
                    </div>
                  </div>

                  {/* 3 Dialogue Cards */}
                  <div className="space-y-4">
                    {ALLISON_SCRIPT.map((item) => {
                      const isCurrent = (gameState.allisonLine ?? 1) === item.line;
                      const isSpeakingNow = isCurrent && !!gameState.allisonSpeaking;

                      return (
                        <div
                          key={item.line}
                          className={`rounded-2xl p-5 border transition-all duration-300 ${
                            isSpeakingNow
                              ? 'bg-fuchsia-950/40 border-fuchsia-400 shadow-[0_0_30px_rgba(217,70,239,0.35)] ring-2 ring-fuchsia-500/50'
                              : isCurrent
                              ? 'bg-slate-800/80 border-fuchsia-500/40 shadow-lg'
                              : 'bg-slate-950/70 border-slate-800/80 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-3.5">
                            <div className="flex items-center gap-2.5">
                              <span className={`font-mono text-xs font-black px-3 py-1 rounded-lg ${
                                isSpeakingNow
                                  ? 'bg-fuchsia-500 text-white shadow-[0_0_10px_#D946EF]'
                                  : isCurrent
                                  ? 'bg-fuchsia-900/60 text-fuchsia-300 border border-fuchsia-500/50'
                                  : 'bg-slate-800 text-slate-400'
                              }`}>
                                PART {item.line}
                              </span>
                              <h3 className="font-bold text-white text-base">{item.title}</h3>
                              <span className="text-xs font-mono text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded">
                                Audio Duration: {item.duration}
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              {isSpeakingNow && (
                                <span className="flex items-center gap-1.5 text-xs font-mono font-bold text-emerald-400 px-3 py-1 bg-emerald-950/60 border border-emerald-500/40 rounded-full animate-pulse">
                                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                                  SPEAKING ON STAGE...
                                </span>
                              )}
                              <button
                                onClick={() => playAllisonLine(item.line)}
                                className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer ${
                                  isSpeakingNow
                                    ? 'bg-fuchsia-600 hover:bg-fuchsia-500 text-white shadow-[0_0_15px_rgba(217,70,239,0.8)] animate-pulse'
                                    : 'bg-slate-800 hover:bg-fuchsia-600 hover:text-white text-slate-200 border border-slate-700 hover:border-fuchsia-500'
                                }`}
                              >
                                <Play className="w-3.5 h-3.5 fill-current" />
                                {isSpeakingNow ? '↺ Replay Line' : `▶ Trigger Line ${item.line}`}
                              </button>
                            </div>
                          </div>

                          {/* Dialogue Prompts */}
                          <div className="space-y-3 text-sm">
                            {/* Human Co-Host Cue */}
                            <div className="p-3.5 rounded-xl bg-cyan-950/30 border border-cyan-500/30 flex items-start gap-3">
                              <span className="text-xs font-black text-cyan-400 uppercase tracking-wider font-mono shrink-0 px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/30">
                                🎙️ MC / Co-Host
                              </span>
                              <p className="text-cyan-100 font-medium text-sm leading-relaxed">
                                "{item.cohost}"
                              </p>
                            </div>

                            {/* Allison AI Voiced Response */}
                            <div className={`p-3.5 rounded-xl border flex items-start gap-3 transition-colors ${
                              isSpeakingNow
                                ? 'bg-fuchsia-900/30 border-fuchsia-500 text-white shadow-inner'
                                : 'bg-slate-900/80 border-slate-700/60 text-slate-200'
                            }`}>
                              <span className={`text-xs font-black uppercase tracking-wider font-mono shrink-0 px-2 py-0.5 rounded ${
                                isSpeakingNow
                                  ? 'bg-fuchsia-500 text-white shadow-[0_0_8px_#D946EF]'
                                  : 'bg-fuchsia-950/60 text-fuchsia-300 border border-fuchsia-500/40'
                              }`}>
                                🤖 Allison (AI)
                              </span>
                              <p className="font-semibold text-sm leading-relaxed text-slate-100">
                                "{item.allison}"
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 space-y-4">
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 min-h-[300px] flex flex-col items-center justify-center relative">
                  <div className="absolute top-4 right-4 text-center">
                    <div className="text-slate-500 text-xs uppercase tracking-widest mb-1">Timer</div>
                    <div className={`text-4xl font-black font-mono leading-none ${
                      displaySeconds <= 4 ? 'text-red-400' :
                      displaySeconds <= 8 ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {displaySeconds}s
                    </div>
                    <select value={gameState.maxTimerSeconds}
                      onChange={e => emit('updateGameState', { maxTimerSeconds: Number(e.target.value), timerSeconds: Number(e.target.value) })}
                      className="bg-slate-800 border border-slate-700 rounded-lg px-1 py-0.5 mt-2 text-white text-[10px] outline-none">
                      {[5, 8, 10, 12, 15, 17, 20, 25, 30].map(v => <option key={v} value={v}>Override: {v}s</option>)}
                    </select>
                  </div>

                  {!equations.length ? (
                    <div className="flex flex-col items-center gap-4 py-6">
                      <div className="text-emerald-400 font-bold text-lg flex items-center gap-2">
                        <Zap className="w-5 h-5 animate-pulse text-yellow-400" /> Select a Round to Load Problem Generator:
                      </div>
                      <div className="flex flex-wrap gap-3 justify-center">
                        <button onClick={() => loadSequenceForRound(1)}
                          className="px-5 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-black text-white transition-all shadow-lg flex items-center gap-2">
                          <Play className="w-4 h-4 fill-current" /> Load Round 1 (Easy · 10s)
                        </button>
                        <button onClick={() => loadSequenceForRound(2)}
                          className="px-5 py-3 bg-blue-600 hover:bg-blue-500 rounded-xl font-black text-white transition-all shadow-lg flex items-center gap-2">
                          <Play className="w-4 h-4 fill-current" /> Load Round 2 (Medium · 15s)
                        </button>
                        <button onClick={() => loadSequenceForRound(3)}
                          className="px-5 py-3 bg-purple-600 hover:bg-purple-500 rounded-xl font-black text-white transition-all shadow-lg flex items-center gap-2">
                          <Play className="w-4 h-4 fill-current" /> Load Round 3 (Difficult · 20s)
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="text-slate-500 font-mono text-lg mb-6">
                        {gameState.dualCallActive
                          ? `Eq ${gameState.currentEquationIndex + 1} & ${gameState.currentEquationIndex + 2} / ${equations.length} · DUAL CALL (${gameState.dualCallRemaining ?? 0} draws left)`
                          : `Equation ${gameState.currentEquationIndex + 1} / ${equations.length}`
                        }
                      </div>

                      <div className="flex gap-8 items-center w-full justify-center">
                        <div className={`text-6xl font-black tracking-tight text-center leading-tight
                          ${currentEq?.isError ? 'text-red-400' : 'text-white'}`}>
                          {currentEq?.equationText}
                        </div>

                        {gameState.dualCallActive && dualEq && (
                          <>
                            <div className="w-px h-24 bg-slate-700" />
                            <div className={`text-6xl font-black tracking-tight text-center leading-tight
                              ${dualEq.isError ? 'text-red-400' : 'text-white'}`}>
                              {dualEq.equationText}
                            </div>
                          </>
                        )}
                      </div>

                      {(currentEq?.isError || (gameState.dualCallActive && dualEq?.isError)) && (
                        <div className="mt-8 px-5 py-2 bg-red-500/20 border border-red-500/30 rounded-full
                          text-red-400 font-bold uppercase tracking-widest text-sm animate-pulse">
                          ⚠ Math Error Trap
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Playback Controls */}
                <div className="flex gap-4 justify-center bg-slate-900 border border-slate-800 rounded-2xl p-4 flex-wrap">
                  {/* Power Continue Button — shown after a power is staged */}
                  {pendingPowerResume ? (
                    <button onClick={resumeWithPower}
                      className="flex items-center gap-2 px-8 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-black text-lg transition-all shadow-[0_0_25px_rgba(16,185,129,0.4)] animate-pulse w-full justify-center">
                      <Play className="w-5 h-5" /> ▶ Continue Game{executedPowerName ? ` / ${executedPowerName} Applied` : ''}
                    </button>
                  ) : gameState.status === 'paused' || gameState.status === 'stopped' || gameState.status === 'math_error_false' || gameState.status === 'verifying_buildup' || gameState.status === 'bingo' ? (
                    <button onClick={startPlaying} disabled={!equations.length}
                      className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-xl font-bold transition-all">
                      <Play className="w-5 h-5" /> Resume
                    </button>
                  ) : (
                    <button onClick={handlePause}
                      disabled={gameState.status !== 'playing'}
                      className="flex items-center gap-2 px-6 py-3 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 rounded-xl font-bold transition-all">
                      <Pause className="w-5 h-5" /> Pause
                    </button>
                  )}

                  {!pendingPowerResume && (
                    <button onClick={handleNext} disabled={!equations.length}
                      className="flex items-center gap-2 px-6 py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl font-bold transition-all">
                      <FastForward className="w-5 h-5" /> Force Next
                    </button>
                  )}

                  {!pendingPowerResume && gameState.status === 'paused' && gameState.phase <= 3 && (
                    <button onClick={advancePhase}
                      className="flex items-center gap-2 px-6 py-3 bg-violet-700 hover:bg-violet-600 rounded-xl font-bold transition-all ml-auto">
                      <ChevronRight className="w-5 h-5" />
                      {gameState.phase < 3 ? `Advance Phase` : 'End Round'}
                    </button>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <button onClick={openMathError} disabled={gameState.status !== 'playing' && gameState.status !== 'paused'}
                    className="flex flex-col items-center justify-center p-6 bg-red-950/60 hover:bg-red-900/60 disabled:opacity-50 border border-red-800 rounded-2xl transition-all group">
                    <Zap className="w-8 h-8 text-red-500 mb-2 group-hover:scale-110 transition-transform" />
                    <span className="font-black text-red-500 text-lg tracking-widest">MATH ERROR CLAIMED</span>
                    <span className="text-xs text-amber-400 font-mono font-bold mt-1 tracking-wider">
                      (+{50 + Math.max(0, (gameState.round || 1) - 1) * 50} PTS)
                    </span>
                  </button>

                  <button onClick={openBingo} disabled={gameState.status !== 'playing' && gameState.status !== 'paused'}
                    className="flex flex-col items-center justify-center p-6 bg-emerald-950/60 hover:bg-emerald-900/60 disabled:opacity-50 border border-emerald-800 rounded-2xl transition-all group shadow-[0_0_15px_rgba(16,185,129,0.15)]">
                    <Trophy className="w-8 h-8 text-emerald-400 mb-2 group-hover:scale-110 transition-transform" />
                    <span className="font-black text-emerald-400 text-lg tracking-widest">BINGO CLAIMED</span>
                  </button>
                </div>
              </div>
            )}
          </div>
          
          {/* Leaderboard Section (Bottom Center) */}
          <div className="mt-6 bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Trophy className="w-6 h-6 text-amber-400" />
                <h3 className="font-bold text-xl text-white">Scores & Leaderboard</h3>
              </div>
              <div className="flex items-center gap-3">
                <select value={lbRound}
                  onChange={e => {
                    const v = e.target.value === 'cumulative' ? 'cumulative' : parseInt(e.target.value);
                    setLbRound(v); refreshLeaderboard(v);
                  }}
                  className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm outline-none">
                  <option value="cumulative">Cumulative</option>
                  {[1, 2, 3].map(r => <option key={r} value={r}>Round {r}</option>)}
                </select>
                <button onClick={() => refreshLeaderboard()} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white transition-colors">
                  <RefreshCw className="w-5 h-5" />
                </button>
                <button onClick={resetScores} className="px-4 py-2 bg-red-900/50 hover:bg-red-900 border border-red-800 rounded-lg text-red-300 text-sm font-bold transition-colors">
                  Reset Scores
                </button>
              </div>
            </div>
            
            {leaderboard.length === 0 ? <p className="text-slate-600 italic text-sm">No scores recorded yet.</p> : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {leaderboard.map((p, i) => (
                  <div key={p.id} className="flex justify-between items-center px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl">
                    <span className="text-white font-bold flex items-center gap-3">
                      <span className="text-slate-500 w-5 text-right">{i + 1}.</span>
                      {p.name}
                      {p.extraTickets && <span title="Extra Ticket" className="text-lg">🎟️</span>}
                      {p.doublePoints && <span title="Double Points" className="text-lg">⚡</span>}
                    </span>
                    <span className="font-mono font-bold text-emerald-400 text-lg">{p.score}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          </div>
          )}
        </div>

        {/* RIGHT PANEL: STAGE PREVIEW & CONTROLS */}
        <div className="w-80 bg-slate-900 border-l border-slate-800 flex flex-col p-4 overflow-y-auto custom-scrollbar">
          <div className="flex items-center gap-2 text-indigo-400 font-bold mb-4">
            <MonitorPlay className="w-5 h-5" />
            <span>Stage Display</span>
          </div>

          <div className="bg-black rounded-xl border border-slate-700 overflow-hidden mb-6 relative aspect-video shadow-lg">
            {/* We scale the stage view to fit this box so Admin can see a live preview — preview=1 disables all audio */}
            <iframe 
              src="/stage?preview=1" 
              className="absolute top-0 left-0 w-[1920px] h-[1080px]"
              style={{ transform: 'scale(0.15)', transformOrigin: '0 0' }}
              title="Stage Preview"
              scrolling="no"
              tabIndex={-1}
              aria-hidden="true"
            />
            {/* Overlay to block clicks in preview */}
            <div className="absolute inset-0 z-10" />
          </div>

          <div className="space-y-3">
            <button onClick={showMainTitle}
              className={`w-full flex items-center justify-center gap-2 px-4 py-3 border rounded-xl text-sm font-bold transition-all ${
                gameState.status === 'title_main' ? 'bg-pink-600 border-pink-400 text-white shadow-[0_0_15px_rgba(255,0,127,0.5)]' : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
              }`}>
              <Home className="w-5 h-5" /> Main Title Screen
            </button>

            <button onClick={showAllisonIntro}
              className={`w-full flex items-center justify-center gap-2 px-4 py-3 border rounded-xl text-sm font-bold transition-all cursor-pointer ${
                gameState.status === 'allison_intro' ? 'bg-fuchsia-600 border-fuchsia-400 text-white shadow-[0_0_15px_rgba(217,70,239,0.5)]' : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
              }`}>
              <Radio className="w-5 h-5" /> Allison AI Introduction
            </button>

            {gameState.status === 'allison_intro' && (
              <div className="p-3 bg-slate-950 border border-fuchsia-700/60 rounded-xl space-y-2">
                <div className="flex items-center justify-between text-xs font-mono font-bold text-fuchsia-300">
                  <span>ALLISON SCRIPT</span>
                  <span className={gameState.allisonSpeaking ? 'text-emerald-400 animate-pulse' : 'text-slate-500'}>
                    {gameState.allisonSpeaking ? '● SPEAKING...' : 'IDLE'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {[1, 2, 3].map(line => (
                    <button
                      key={line}
                      onClick={() => playAllisonLine(line)}
                      className={`px-2 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        gameState.allisonLine === line && gameState.allisonSpeaking
                          ? 'bg-fuchsia-600 text-white shadow-[0_0_10px_rgba(217,70,239,0.6)] animate-pulse'
                          : gameState.allisonLine === line
                          ? 'bg-slate-700 text-fuchsia-300 border border-fuchsia-500/50'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                      }`}
                    >
                      Line {line}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    onClick={nextAllisonLine}
                    className="px-2 py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded-lg text-xs font-bold transition-colors text-white cursor-pointer flex items-center justify-center gap-1"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" /> Next Line
                  </button>
                  <button
                    onClick={stopAllisonAudio}
                    className="px-2 py-1.5 bg-rose-800/80 hover:bg-rose-700 rounded-lg text-xs font-bold transition-colors text-white cursor-pointer flex items-center justify-center gap-1"
                  >
                    <Square className="w-3.5 h-3.5" /> Stop
                  </button>
                </div>
              </div>
            )}

            <button onClick={() => showMechanics(1)}
              className={`w-full flex items-center justify-center gap-2 px-4 py-3 border rounded-xl text-sm font-bold transition-all ${
                gameState.status === 'mechanics' ? 'bg-teal-600 border-teal-400 text-white shadow-[0_0_15px_rgba(0,245,212,0.5)]' : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
              }`}>
              <BookOpen className="w-5 h-5" /> Mechanics (14 Slides)
            </button>

            {gameState.status === 'mechanics' && (
              <div className="p-3 bg-slate-950 border border-teal-700/60 rounded-xl space-y-2">
                <div className="text-center text-xs font-mono font-bold text-teal-300">
                  SLIDE {gameState.mechanicsSlide ?? 1} / 14
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={prevMechanicsSlide} disabled={(gameState.mechanicsSlide ?? 1) <= 1}
                    className="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 rounded-lg text-xs font-bold transition-colors">
                    ◀ Previous
                  </button>
                  <button onClick={nextMechanicsSlide} disabled={(gameState.mechanicsSlide ?? 1) >= 14}
                    className="px-2 py-1.5 bg-teal-700 hover:bg-teal-600 disabled:opacity-40 rounded-lg text-xs font-bold transition-colors">
                    Next ▶
                  </button>
                </div>
              </div>
            )}

            <button onClick={showHypeTitle}
              className={`w-full flex items-center justify-center gap-2 px-4 py-3 border rounded-xl text-sm font-bold transition-all cursor-pointer ${
                gameState.status === 'title_hype' ? 'bg-amber-600 border-amber-400 text-white shadow-[0_0_15px_rgba(255,107,53,0.5)]' : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
              }`}>
              <Zap className="w-5 h-5" /> Arena Hype (Second Title)
            </button>

            <button onClick={showLoadingSequence}
              className={`w-full flex items-center justify-center gap-2 px-4 py-3 border rounded-xl text-sm font-bold transition-all cursor-pointer ${
                gameState.status === 'loading' ? 'bg-cyan-600 border-cyan-400 text-white shadow-[0_0_15px_rgba(6,182,212,0.5)]' : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
              }`}>
              <Cpu className="w-5 h-5" /> Generating Sequence
            </button>

            <button onClick={startPhaseIntro}
              className={`w-full flex items-center justify-center gap-2 px-4 py-3 border rounded-xl text-sm font-bold transition-all cursor-pointer ${
                gameState.status === 'title_round' ? 'bg-blue-600 border-blue-400 text-white shadow-[0_0_15px_rgba(59,130,246,0.5)]' : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
              }`}>
              <Volume2 className="w-5 h-5" /> Winning Patterns (AI Voice)
            </button>

            <button onClick={showLeaderboardOnStage}
              className={`w-full flex items-center justify-center gap-2 px-4 py-3 border rounded-xl text-sm font-bold transition-all cursor-pointer ${
                gameState.status === 'leaderboard' ? 'bg-indigo-600 border-indigo-400 text-white shadow-[0_0_15px_rgba(99,102,241,0.5)]' : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
              }`}>
              <Trophy className="w-5 h-5" /> Championship Standings
            </button>
          </div>
        </div>
      </div>

      {/* MODALS */}
      
      {mathErrorModalOpen && (
        <PlayerSelectModal 
          title="Who claimed the Math Error?" 
          players={playerList}
          onSelect={claimMathError} 
          onClose={() => setMathErrorModalOpen(false)} 
        />
      )}

      {bingoSelectModalOpen && (
        <PlayerSelectModal 
          title="Who claimed BINGO?" 
          players={playerList}
          onSelect={handleBingoClaimed} 
          onClose={() => setBingoSelectModalOpen(false)} 
        />
      )}

      {/* VERIFY MODAL */}
      {verifyOpen && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-8 w-full max-w-lg shadow-2xl">
            <div className="flex items-center gap-3 mb-6">
              <Trophy className="w-7 h-7 text-emerald-400" />
              <h3 className="text-2xl font-black text-white">Bingo Verifier</h3>
            </div>

            <div className="mb-4 p-4 bg-emerald-950/50 border border-emerald-800 rounded-xl flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-emerald-500" />
              <div>
                <div className="text-xs text-emerald-600 uppercase tracking-widest">Verifying for</div>
                <div className="text-white font-bold text-lg">{verifyingPlayer?.name}</div>
              </div>
            </div>

            <div className="space-y-4 mb-6">
              <div>
                <label className="text-slate-400 text-sm block mb-1">Ticket Card ID</label>
                <input type="text" value={cardInput} onChange={e => setCardInput(e.target.value)}
                  placeholder="#CARD-000000"
                  className="w-full px-4 py-3 bg-slate-950 border border-slate-700 rounded-xl text-white font-mono text-xl uppercase tracking-widest outline-none focus:border-emerald-500" />
              </div>
            </div>

            {verifyResult && (
              <div className={`mb-6 p-5 rounded-2xl border flex gap-4 items-start ${verifyResult.valid ? 'bg-emerald-950/60 border-emerald-700 text-emerald-300' : 'bg-red-950/60 border-red-800 text-red-300'}`}>
                {verifyResult.valid ? <CheckCircle className="w-7 h-7 flex-shrink-0" /> : <XCircle className="w-7 h-7 flex-shrink-0" />}
                <div>
                  <div className="font-bold text-lg leading-snug">{verifyResult.message}</div>
                  <div className="text-sm opacity-70 mt-1">{verifyResult.playerName} · Total: {verifyResult.totalScore}</div>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              {!verifyResult ? (
                <button onClick={runVerify} disabled={verifying || !verifyingPlayer}
                  className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-bold text-lg disabled:opacity-50 transition-colors">
                  {verifying ? 'Verifying...' : '✓ Verify'}
                </button>
              ) : (
                <button onClick={() => { setVerifyResult(null); setCardInput('#CARD-'); }}
                  className="flex-1 py-3 bg-blue-700 hover:bg-blue-600 rounded-xl font-bold text-lg transition-colors">
                  Verify Another
                </button>
              )}
              <button onClick={closeVerify}
                className="px-6 py-3 bg-slate-800 border border-slate-700 hover:bg-slate-700 rounded-xl font-bold text-lg transition-colors">
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* POWER MODAL */}
      {powerOpen && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-8 w-full max-w-4xl shadow-2xl">
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-2xl font-black text-red-500 flex items-center gap-3">
                <Zap className="w-7 h-7" /> Tactical Power Selector
              </h3>
              <button onClick={handleFalseAlarmManual}
                className="px-4 py-1.5 bg-red-950/60 hover:bg-red-900 border border-red-800 rounded-xl text-red-300 text-xs font-bold transition-colors">
                Cancel & Mark False Alarm
              </button>
            </div>

            <div className="mb-5 px-4 py-3 bg-emerald-950/40 border border-emerald-900 rounded-xl text-sm flex items-center gap-2">
              <span className="text-emerald-500 font-bold">Awarded to:</span>
              <span className="text-white font-bold">{powerTargetPlayer?.name}</span>
            </div>

            <div className="grid grid-cols-2 gap-8">
              <div className="space-y-2">
                {[
                  { id: 'stealTheNumber', name: 'Steal the Number', desc: 'Silently add any # to drawn pool', icon: '🎯' },
                  { id: 'memoryWipe',     name: 'Memory Wipe',       desc: 'Erase a called # — gone for good!', icon: '🧹' },
                  { id: 'extraTicket',   name: 'Extra Ticket',       desc: 'Award player an extra bingo ticket', icon: '🎟️' },
                  { id: 'doublePoints',  name: 'Double Points',      desc: 'Next BINGO pays 2× points',  icon: '⚡' },
                  { id: 'dualCall',      name: 'Dual Call',          desc: '5 pairs of 2 simultaneous problems', icon: '📡' },
                ].map(p => {
                  const used = gameState.usedPowers[p.id];
                  return (
                    <div key={p.id} className="flex gap-2">
                      <button onClick={() => !used && selectPower(p.id)} disabled={used}
                        className={`flex-1 flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all
                          ${used
                            ? 'bg-slate-950 border-slate-800 opacity-40 cursor-not-allowed'
                            : selectedPower === p.id
                              ? 'bg-red-900/40 border-red-500 text-red-300 shadow-[0_0_20px_rgba(239,68,68,0.2)]'
                              : 'bg-slate-800 hover:bg-slate-700 border-slate-700 hover:border-slate-600'}`}>
                        <span className="text-2xl">{p.icon}</span>
                        <div className="flex-1">
                          <div className="font-bold text-sm">{p.name}</div>
                          <div className="text-xs opacity-60">{p.desc}</div>
                        </div>
                        {used && <span className="text-xs uppercase bg-slate-800 px-2 py-1 rounded text-slate-500">Used</span>}
                      </button>
                      {used && (
                        <button onClick={() => undoPower(p.id)} title="Undo & Reset"
                          className="px-3 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-400 hover:text-white transition-colors">
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="bg-slate-950 rounded-2xl border border-slate-800 p-6 flex flex-col justify-between">
                {!selectedPower ? (
                  <div className="text-slate-500 text-center m-auto text-sm">Select an unused power on the left.</div>
                ) : (
                  <>
                    <div className="space-y-4">
                      <h4 className="font-bold text-lg text-white border-b border-slate-800 pb-2 capitalize">
                        Configure: {selectedPower.replace(/([A-Z])/g, ' $1').trim()}
                      </h4>

                      {selectedPower === 'stealTheNumber' && (
                        <div>
                          <label className="text-slate-400 text-sm block mb-1">Target Number (1–75)</label>
                          <input type="number" min={1} max={75} value={powerTargetNumber}
                            onChange={e => setPowerTargetNumber(e.target.value)}
                            className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white outline-none focus:border-emerald-600" />
                          <p className="text-slate-500 text-xs mt-2 leading-relaxed">
                            Chosen number is silently added to the drawn pool — no equation shown. Its future problem (if not yet played) will be removed so it cannot appear again.
                          </p>
                        </div>
                      )}
                      {selectedPower === 'memoryWipe' && (
                        <div>
                          <label className="text-slate-400 text-sm block mb-1">Number to Erase</label>
                          <select value={powerDrawnNumber} onChange={e => setPowerDrawnNumber(e.target.value)}
                            className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white outline-none">
                            <option value="">Select a drawn number...</option>
                            {drawn.map(n => <option key={n} value={n}>{n}</option>)}
                          </select>
                          <p className="text-slate-500 text-xs mt-2 leading-relaxed">
                            Erases a called number — all players must unmark it. Since each number appears only once per round, it is <span className="text-red-400 font-semibold">permanently gone</span>. (Can be countered by Steal the Number.)
                          </p>
                        </div>
                      )}
                      {(selectedPower === 'extraTicket' || selectedPower === 'doublePoints') && (
                        <div>
                          <label className="text-slate-400 text-sm block mb-1">
                            {selectedPower === 'extraTicket' ? 'Awarded to' : 'Double Points for'}
                          </label>
                          <div className="px-4 py-3 bg-slate-900 border border-emerald-800 rounded-xl text-white font-bold">
                            {powerTargetPlayer?.name}
                          </div>
                          <p className="text-slate-500 text-xs mt-2 leading-relaxed">
                            {selectedPower === 'extraTicket'
                              ? 'Awards an extra bingo ticket — the player can claim BINGO with it even if their main card is not complete.'
                              : 'The next BINGO this player calls will pay out 2× points.'}
                          </p>
                        </div>
                      )}
                      {selectedPower === 'dualCall' && (
                        <div className="mt-4 animate-in fade-in slide-in-from-top-4">
                          <p className="text-slate-300 text-sm leading-relaxed mb-4">
                            Splits the stage into two simultaneous problems. The current <span className="text-red-400 font-bold">Math Error is discarded</span>, and the next TWO clean problems are shown together for <strong className="text-emerald-400">5 draws</strong> — zero Math Errors guaranteed!
                          </p>
                          <div className="text-xs text-slate-500 mb-4 border border-slate-700 rounded-lg p-3">
                            After clicking Execute, press the glowing <span className="text-emerald-400 font-bold">Continue Game</span> button to advance.
                          </div>
                          <button onClick={executePower}
                            className="w-full py-4 bg-red-600 hover:bg-red-500 rounded-xl font-black text-xl shadow-[0_0_20px_rgba(220,38,38,0.4)] flex items-center justify-center gap-2 transition-all">
                            <Zap className="w-6 h-6" /> Execute Power
                          </button>
                        </div>
                      )}
                      {selectedPower !== 'dualCall' && (
                        <>
                          <div className="text-xs text-slate-500 mt-2 border border-slate-700 rounded-lg p-3">
                            After clicking Execute, press the glowing <span className="text-emerald-400 font-bold">Continue Game</span> button to advance.
                          </div>
                          <button onClick={executePower}
                            className="w-full py-4 mt-4 bg-red-600 hover:bg-red-500 rounded-xl font-bold text-lg shadow-lg transition-colors">
                            ⚡ Execute Power
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
