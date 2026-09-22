import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { Server } from 'socket.io';
import http from 'http';
import path from 'path';
import fs from 'fs';
import PDFDocument from 'pdfkit';
import nodemailer from 'nodemailer';
import {
  checkWin,
  POINT_MATRIX,
  FALSE_ALARM_PENALTY,
  PATTERN_NAMES,
  PHASE_NAMES,
  PHASE_DESCRIPTIONS,
  getMathErrorPoints,
} from './patterns';
import { seedDatabase } from './seed';


const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const SYSTEM_CARD_ID = '#SYSTEM';
async function initSystemCard() {
  try {
    await prisma.bingoCard.upsert({
      where: { id: SYSTEM_CARD_ID },
      create: { id: SYSTEM_CARD_ID, grid: '[]' },
      update: {}
    });
  } catch (err) {
    console.error('Error initializing system card:', err);
  }
}
initSystemCard();

app.use(cors());
app.use(express.json());

// Health Check Endpoints for Cloud Deployments (Render / Vercel proxy)
app.get('/', (_req, res) => res.json({ status: 'ok', message: 'MathFest 2026 AI Speed Bingo Backend API' }));
app.get('/api/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date() }));


// ─── GAME STATE ────────────────────────────────────────────────────────────────
let currentSequence: any[] = [];
let drawnNumbers: Set<number> = new Set();
let wipedNumbers: Set<number> = new Set();
let currentRound = 1;

export type GameStatus = 
  | 'title_main' | 'allison_intro' | 'mechanics' | 'title_hype' | 'loading' | 'title_round'
  | 'stopped' | 'playing' | 'paused'
  | 'math_error_verifying' | 'math_error' | 'power_selection' | 'power_activated' | 'math_error_false'
  | 'bingo_claimed_by' | 'verifying_buildup' | 'bingo' | 'leaderboard' | 'end_round';

interface GameState {
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
  dualCallActive: boolean;
  dualCallRemaining: number;
  usedPowers: Record<string, boolean>;
  verifyingPlayerName: string;
  mathErrorPlayerName: string;
  activatedPower: string;
  highlightedPower: string;
  powerTargetNumber: string;
  powerDrawnNumber: string;
}

let gameState: GameState = {
  status: 'title_main' as GameStatus,
  allisonLine: 1,
  allisonSpeaking: false,
  currentEquationIndex: 0,
  timerSeconds: 10,
  maxTimerSeconds: 10,
  timerEndTime: null,
  round: 1,
  phase: 1,
  dualCallActive: false,
  dualCallRemaining: 0,
  usedPowers: {
    stealTheNumber: false,
    memoryWipe: false,
    extraTicket: false,
    doublePoints: false,
    dualCall: false,
  },
  verifyingPlayerName: '',
  mathErrorPlayerName: '',
  activatedPower: '',
  highlightedPower: '',
  powerTargetNumber: '',
  powerDrawnNumber: '',
};

function broadcastState() {
  if (gameState.status !== 'playing') {
    gameState.timerEndTime = null;
  }
  io.emit('gameStateUpdate', {
    ...gameState,
    phaseName: PHASE_NAMES[gameState.phase],
    patternName: gameState.phase === 2 ? PATTERN_NAMES[gameState.round] : null,
    phaseDescription: PHASE_DESCRIPTIONS[gameState.phase],
    pointMatrix: POINT_MATRIX[gameState.round],
  });
}

function broadcastSequence() {
  const sequenceWithFlags = currentSequence.map(eq => ({
    ...eq,
    isRecalled: wipedNumbers.has(eq.targetNumber)
  }));
  io.emit('sequenceUpdate', sequenceWithFlags);
}

// ─── SEQUENCE ─────────────────────────────────────────────────────────────────
app.get('/api/game/sequence', async (req, res) => {
  try {
    const round = parseInt(req.query.round as string) || currentRound;
    if (currentSequence.length === 0 || currentRound !== round) {
      currentRound = round;
      drawnNumbers.clear();
      let equations = await prisma.equation.findMany({ where: { difficulty: round } });
      if (equations.length === 0) {
        await seedDatabase(prisma);
        equations = await prisma.equation.findMany({ where: { difficulty: round } });
      }
      for (let i = equations.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [equations[i], equations[j]] = [equations[j], equations[i]];
      }
      currentSequence = equations;
      broadcastSequence();
    }
    res.json(currentSequence);
  } catch {
    res.status(500).json({ error: 'Failed to fetch equations' });
  }
});

app.post('/api/game/sequence/reset', (_req, res) => {
  currentSequence = [];
  drawnNumbers.clear();
  res.json({ message: 'Reset' });
});

app.post('/api/game/drawn', (req, res) => {
  const { targetNumbers } = req.body; // Can be an array of numbers (for Dual Call)
  if (Array.isArray(targetNumbers)) {
    targetNumbers.forEach(n => {
      if (n !== null && n !== undefined) drawnNumbers.add(Number(n));
    });
  } else if (req.body.targetNumber !== undefined && req.body.targetNumber !== null) {
    drawnNumbers.add(Number(req.body.targetNumber));
  }
  res.json({ success: true, totalDrawn: drawnNumbers.size });
});

app.get('/api/game/drawn', (_req, res) => {
  res.json({ drawn: Array.from(drawnNumbers) });
});

// ─── TACTICAL POWERS ──────────────────────────────────────────────────────────
app.post('/api/game/use-power', async (req, res) => {
  const { power, targetNumber, playerName, drawnNumber } = req.body;
  
  if (power === 'stealTheNumber') {
    if (!targetNumber) return res.status(400).json({ error: 'targetNumber required' });
    const num = Number(targetNumber);
    if (isNaN(num) || num < 1 || num > 75)
      return res.status(400).json({ error: 'Number must be between 1 and 75' });

    // 1. Add directly to drawn pool — no equation shown on stage
    drawnNumbers.add(num);

    // 2. Remove the matching equation from the FUTURE sequence so it never
    //    shows up as a problem for an already-answered number
    const futureStart = gameState.currentEquationIndex + 1;
    const matchIdx = currentSequence.findIndex(
      (eq: any, i: number) => i >= futureStart && eq.targetNumber === num
    );
    if (matchIdx !== -1) {
      currentSequence.splice(matchIdx, 1);
    }

    gameState.usedPowers.stealTheNumber = true;
    io.emit('drawnUpdate', Array.from(drawnNumbers));
    broadcastSequence(); // count may have dropped by 1
    broadcastState();
    return res.json({ success: true, message: `Number ${num} stolen — added to drawn pool and its equation removed.` });
  }

  if (power === 'memoryWipe') {
    if (drawnNumber === undefined) return res.status(400).json({ error: 'drawnNumber required' });
    drawnNumbers.delete(Number(drawnNumber));
    wipedNumbers.add(Number(drawnNumber));
    gameState.usedPowers.memoryWipe = true;
    broadcastState();
    return res.json({ success: true, message: `Number ${drawnNumber} wiped from active memory.` });
  }

  if (power === 'extraTicket') {
    if (!playerName) return res.status(400).json({ error: 'playerName required' });
    await prisma.player.update({ where: { name: playerName }, data: { extraTickets: true } });
    gameState.usedPowers.extraTicket = true;
    broadcastState();
    const leaderboard = await getLeaderboard();
    io.emit('leaderboardUpdate', leaderboard);
    return res.json({ success: true, message: `${playerName} flagged for Extra Ticket.` });
  }

  if (power === 'doublePoints') {
    if (!playerName) return res.status(400).json({ error: 'playerName required' });
    await prisma.player.update({ where: { name: playerName }, data: { doublePoints: true } });
    gameState.usedPowers.doublePoints = true;
    broadcastState();
    const leaderboard = await getLeaderboard();
    io.emit('leaderboardUpdate', leaderboard);
    return res.json({ success: true, message: `${playerName} boosted with 2x Points multiplier!` });
  }

  if (power === 'dualCall') {
    gameState.dualCallActive = true;
    gameState.dualCallRemaining = 5;
    gameState.usedPowers.dualCall = true;

    // Discard the Math Error equation at currentEquationIndex completely
    const errorIdx = gameState.currentEquationIndex;
    const remaining = currentSequence.slice(errorIdx + 1); // everything after the math error
    const cleanSlots: any[] = [];
    const rest: any[] = [];

    for (const eq of remaining) {
      if (!eq.isError && cleanSlots.length < 10) {
        cleanSlots.push(eq);
      } else {
        rest.push(eq); // math errors and overflow go here untouched
      }
    }

    // Top up cleanSlots from DB if there aren't 10 clean equations remaining
    if (cleanSlots.length < 10) {
      const existingIds = new Set(currentSequence.map((e: any) => e.id));
      const extras = await prisma.equation.findMany({
        where: { difficulty: gameState.round, isError: false },
        take: 30,
      });
      for (const eq of extras) {
        if (!existingIds.has(eq.id)) {
          cleanSlots.push(eq);
          existingIds.add(eq.id);
          if (cleanSlots.length >= 10) break;
        }
      }
    }

    // Rebuild: drop math error, insert 10 clean slots right at errorIdx, then rest
    currentSequence = [
      ...currentSequence.slice(0, errorIdx), // everything before math error
      ...cleanSlots,                         // 10 clean equations start right at errorIdx (Pair 1 = [errorIdx, errorIdx+1])
      ...rest,                               // rest of round — math errors survive!
    ];

    broadcastSequence();
    broadcastState();
    return res.json({ success: true, message: 'Dual Call: 5 pairs ready, zero errors guaranteed.' });
  }

  res.status(400).json({ error: 'Unknown power' });
});

// Allow host to toggle a power back to unused
app.post('/api/game/toggle-power', (req, res) => {
  const { power, active } = req.body;
  if (power in gameState.usedPowers) {
    (gameState.usedPowers as any)[power] = active;
    broadcastState();
    res.json({ success: true, power, active });
  } else {
    res.status(400).json({ error: 'Invalid power' });
  }
});

app.post('/api/game/resume', (req, res) => {
  if (gameState.status !== 'playing') {
    gameState.status = 'playing';
    broadcastState();
  }
  res.json({ success: true });
});

// ─── PLAYERS ──────────────────────────────────────────────────────────────────
app.get('/api/players', async (_req, res) => {
  try {
    const players = await prisma.player.findMany({
      where: { isVerified: true },
      orderBy: { name: 'asc' },
    });
    res.json(players);
  } catch {
    res.status(500).json({ error: 'Failed to fetch players' });
  }
});

app.post('/api/players', async (req, res) => {
  const { name } = req.body as { name: string };
  const trimmedName = name?.trim();
  if (!trimmedName) return res.status(400).json({ error: 'Name required' });
  try {
    let player = await prisma.player.findUnique({ where: { name: trimmedName } });
    if (!player) {
      player = await prisma.player.create({ data: { name: trimmedName, score: 0, isVerified: true } });
    } else if (!player.isVerified) {
      player = await prisma.player.update({ where: { id: player.id }, data: { isVerified: true } });
    }
    const verifiedPlayers = await prisma.player.findMany({ where: { isVerified: true }, orderBy: { name: 'asc' } });
    io.emit('playersUpdate', verifiedPlayers);
    res.json(player);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create or fetch player' });
  }
});

app.delete('/api/players/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
  try {
    await prisma.scoreLog.deleteMany({ where: { playerId: id } });
    await prisma.player.delete({ where: { id } });
    const verifiedPlayers = await prisma.player.findMany({ where: { isVerified: true }, orderBy: { name: 'asc' } });
    io.emit('playersUpdate', verifiedPlayers);
    const leaderboard = await getLeaderboard();
    io.emit('leaderboardUpdate', leaderboard);
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: 'Player not found' });
  }
});



function normalizeCardId(input: string): string {
  if (!input) return '';
  const digits = input.replace(/\D/g, '');
  if (!digits) return input.trim().toUpperCase();
  const padded = digits.padStart(6, '0');
  return `#CARD-${padded}`;
}

app.post('/api/verify', async (req, res) => {
  const { cardId, playerName } = req.body as { cardId: string; playerName: string };

  try {
    const targetCardId = normalizeCardId(cardId);
    const card = await prisma.bingoCard.findUnique({ where: { id: targetCardId } });
    if (!card) return res.status(404).json({ error: `Card "${cardId}" not found.` });

    const grid: number[] = JSON.parse(card.grid);
    const { round, phase } = gameState;
    const result = checkWin(grid, drawnNumbers, round, phase);

    let player = await prisma.player.findUnique({ where: { name: playerName } });
    if (!player) {
      player = await prisma.player.create({ data: { name: playerName, score: 0 } });
    }

    let finalPoints = result.win ? result.points : FALSE_ALARM_PENALTY;
    
    // Apply Double Points Booster
    if (result.win && player.doublePoints) {
      finalPoints *= 2;
      // Consume the booster
      player = await prisma.player.update({ where: { id: player.id }, data: { doublePoints: false } });
    }

    const reason = result.win ? result.reason : 'False Alarm';

    const updated = await prisma.player.update({
      where: { id: player.id },
      data: { score: { increment: finalPoints } },
    });

    await prisma.scoreLog.create({
      data: { playerId: player.id, cardId: card.id, round, phase, points: finalPoints, reason },
    });

    // Update state to buildup
    gameState.status = 'verifying_buildup';
    gameState.verifyingPlayerName = playerName;
    broadcastState();

    // After 3 second buildup, emit the actual result to transition to bingo screen
    setTimeout(() => {
      gameState.status = 'bingo';
      broadcastState();
      
      const payload = {
        valid: result.win,
        grid,
        drawnNumbers: Array.from(drawnNumbers),
        round,
        phase,
        reason,
        points: finalPoints,
        playerName: updated.name,
        cardId: card.id,
      };
      io.emit('verificationResult', payload);
      logEvent('BINGO', playerName, result.win ? 'Valid BINGO Victory!' : 'False BINGO Penalty', result.win ? `+${finalPoints} PTS` : `${finalPoints} PTS`, reason, card.id);
    }, 3000);

    const leaderboard = await getLeaderboard();
    io.emit('leaderboardUpdate', leaderboard);

    return res.json({
      valid: result.win,
      message: result.win
        ? `✅ Valid ${result.reason}! +${finalPoints} points`
        : `❌ False Alarm! ${result.reason}. ${finalPoints} points.`,
      points: finalPoints,
      totalScore: updated.score,
      playerName: updated.name,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Verification failed.' });
  }
});

app.post('/api/game/advance-phase', async (_req, res) => {
  if (gameState.phase < 3) {
    gameState.phase += 1;
    gameState.status = 'title_round'; // Transition back to Round Title seamlessly
    broadcastState();
    return res.json({ phase: gameState.phase });
  } else {
    // End the round
    gameState.status = 'end_round';
    broadcastState();
    
    // Auto-transition to leaderboard for this round after 4 seconds
    setTimeout(async () => {
      if (gameState.status === 'end_round') {
        gameState.status = 'leaderboard';
        const lb = await getLeaderboard(gameState.round);
        io.emit('showLeaderboardStage', { leaderboard: lb, mode: 'round', round: gameState.round });
        broadcastState();
      }
    }, 4000);

    return res.json({ message: 'Round complete.' });
  }
});

// ─── LEADERBOARD ──────────────────────────────────────────────────────────────
async function getLeaderboard(round?: number) {
  let playersData: any[];
  if (round) {
    const allPlayers = await prisma.player.findMany({ where: { isVerified: true } });
    const logs = await prisma.scoreLog.groupBy({ by: ['playerId'], where: { round }, _sum: { points: true } });
    const scoreMap = new Map(logs.map((l: any) => [l.playerId, l._sum.points ?? 0]));

    playersData = allPlayers.map((p: any) => ({
      id: p.id,
      name: p.name,
      score: scoreMap.get(p.id) ?? 0,
      extraTickets: p.extraTickets,
      doublePoints: p.doublePoints
    }));
  } else {
    playersData = await prisma.player.findMany({ where: { isVerified: true }, orderBy: { score: 'desc' }, take: 10 });
  }
  return playersData.sort((a, b) => b.score - a.score).slice(0, 10);
}


app.get('/api/leaderboard', async (req, res) => {
  const round = req.query.round ? parseInt(req.query.round as string) : undefined;
  res.json(await getLeaderboard(round));
});

// Clear an individual player's buffs
app.post('/api/players/:id/clear-buffs', async (req, res) => {
  await prisma.player.update({
    where: { id: Number(req.params.id) },
    data: { extraTickets: false, doublePoints: false }
  });
  const leaderboard = await getLeaderboard();
  io.emit('leaderboardUpdate', leaderboard);
  res.json({ success: true });
});

app.get('/api/score-log', async (_req, res) => {
  const logs = await prisma.scoreLog.findMany({
    include: { player: true, card: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json(logs);
});

app.post('/api/reset-scores', async (_req, res) => {
  await prisma.scoreLog.deleteMany();
  await prisma.player.updateMany({ data: { score: 0, extraTickets: false, doublePoints: false } });
  const leaderboard = await getLeaderboard();
  io.emit('leaderboardUpdate', leaderboard);
  res.json({ message: 'All scores have been reset.' });
});

// ─── BINGO CARDS (GREEN AI GALAXY THEME) ──────────────────────────────────────
app.post('/api/cards/generate', async (req, res) => {
  const { count = 100 } = req.body;
  const cards = [];
  for (let i = 0; i < count; i++) {
    const nums = new Set<number>();
    while (nums.size < 24) nums.add(Math.floor(Math.random() * 75) + 1);
    const cardId = `#CARD-${String(Math.floor(Math.random() * 1000000)).padStart(6, '0')}`;
    cards.push({ id: cardId, grid: JSON.stringify(Array.from(nums)) });
  }
  try {
    await prisma.bingoCard.createMany({ data: cards });
  } catch { /* ignore duplicates */ }
  res.json({ message: `Generated ${cards.length} cards` });
});

const findFontPath = (filename: string) => {
  const candidates = [
    path.join(__dirname, 'fonts', filename),
    path.join(__dirname, '..', 'src', 'fonts', filename),
    path.join(process.cwd(), 'src', 'fonts', filename),
    path.join(process.cwd(), 'backend', 'src', 'fonts', filename),
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
};

app.get('/api/cards/print', async (req, res) => {
  const count = parseInt(req.query.count as string) || 2;
  const cards = await prisma.bingoCard.findMany({ take: count, orderBy: { id: 'asc' } });
  if (!cards.length) return res.status(404).json({ error: 'No cards found.' });

  // US Letter Landscape Short Bond Paper: 792 x 612 pt (11 x 8.5 in)
  const doc = new PDFDocument({ size: [792, 612], margin: 0 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename=bingo_cards.pdf');
  doc.pipe(res);

  const rajdhaniPath = findFontPath('Rajdhani-Bold.ttf');
  const chakraPath = findFontPath('ChakraPetch-Bold.ttf');

  if (rajdhaniPath) doc.registerFont('Rajdhani', rajdhaniPath);
  if (chakraPath) doc.registerFont('ChakraPetch', chakraPath);

  const mainFont = rajdhaniPath ? 'Rajdhani' : chakraPath ? 'ChakraPetch' : 'Helvetica-Bold';
  const badgeFont = chakraPath ? 'ChakraPetch' : mainFont;

  const drawCard = (xOffset: number, card: any) => {
    const cardWidth = 360;
    const cardHeight = 564;
    const cardX = xOffset + 18;
    const cardY = 24;

    doc.save();
    // Clean off-white background matching inspiration image canvas texture
    doc.roundedRect(cardX, cardY, cardWidth, cardHeight, 16).fill('#FAFAFC');

    // Outer double cyan border matching inspiration image lines
    doc.roundedRect(cardX, cardY, cardWidth, cardHeight, 16).lineWidth(2.5).stroke('#4A92B8');
    doc.roundedRect(cardX + 4, cardY + 4, cardWidth - 8, cardHeight - 8, 12).lineWidth(1.2).stroke('#4A92B8');

    // Header Title Box: "MATHFEST: AI SPEED BINGO"
    doc.roundedRect(cardX + 14, cardY + 14, cardWidth - 28, 48, 10).lineWidth(1.5).stroke('#4A92B8');
    doc.font(mainFont).fontSize(22).fillColor('#0B1938')
       .text('MATHFEST: AI SPEED BINGO', cardX + 14, cardY + 27, { width: cardWidth - 28, align: 'center', characterSpacing: 1 });

    const gridX = cardX + 14;
    const gridY = cardY + 70;
    const totalGridWidth = cardWidth - 28; // 332 pt
    const colW = totalGridWidth / 5; // 66.4 pt
    const headerH = 36;
    const rowH = 75;

    // Header Pills (B I N G O)
    const letters = ['B', 'I', 'N', 'G', 'O'];
    letters.forEach((letter, colIdx) => {
      const cx = gridX + colIdx * colW + 2;
      const cy = gridY;
      const cw = colW - 4;
      doc.roundedRect(cx, cy, cw, headerH, 8).lineWidth(1.5).stroke('#4A92B8');
      doc.font(mainFont).fontSize(24).fillColor('#0B1938')
         .text(letter, cx, cy + 6, { width: cw, align: 'center' });
    });

    // 5x5 Matrix Grid
    const numbers: number[] = JSON.parse(card.grid);
    const matrixTop = gridY + headerH + 8; // cardY + 114

    // Outer grid border
    doc.rect(gridX, matrixTop, totalGridWidth, rowH * 5).lineWidth(1.5).stroke('#4A92B8');

    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        const cx = gridX + c * colW;
        const cy = matrixTop + r * rowH;
        
        doc.rect(cx, cy, colW, rowH).lineWidth(1).stroke('#4A92B8');

        const gridIdx = r * 5 + c;
        if (r === 2 && c === 2) {
          doc.font(mainFont).fontSize(22).fillColor('#0B1938')
             .text('FREE', cx, cy + (rowH / 2) - 10, { width: colW, align: 'center', characterSpacing: 1 });
        } else {
          const numVal = numbers[gridIdx];
          doc.font(mainFont).fontSize(36).fillColor('#0B1938')
             .text(String(numVal), cx, cy + (rowH / 2) - 18, { width: colW, align: 'center' });
        }
      }
    }

    // Bottom Badge: #CARD - XXXXXX
    const badgeW = 155;
    const badgeH = 26;
    const badgeX = cardX + (cardWidth - badgeW) / 2;
    const badgeY = cardY + cardHeight - 13;

    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 6).fill('#FFFFFF');
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 6).lineWidth(1.5).stroke('#4A92B8');
    doc.font(badgeFont).fontSize(12).fillColor('#0B1938')
       .text(card.id, badgeX, badgeY + 6, { width: badgeW, align: 'center', characterSpacing: 1 });

    doc.restore();
  };

  for (let i = 0; i < cards.length; i += 2) {
    if (i > 0) doc.addPage();
    drawCard(0, cards[i]); // Left card
    if (cards[i + 1]) drawCard(396, cards[i + 1]); // Right card
    
    // Central Dotted Cut Line
    doc.save().moveTo(396, 12).lineTo(396, 600)
       .dash(6, { space: 4 }).lineWidth(1).strokeColor('#94A3B8').stroke().restore();
  }
  doc.end();
});

// ─── WEBSOCKETS ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.emit('gameStateUpdate', {
    ...gameState,
    phaseName: PHASE_NAMES[gameState.phase],
    patternName: gameState.phase === 2 ? PATTERN_NAMES[gameState.round] : null,
    phaseDescription: PHASE_DESCRIPTIONS[gameState.phase],
    pointMatrix: POINT_MATRIX[gameState.round],
  });
  if (currentSequence.length > 0) {
    socket.emit('sequenceUpdate', currentSequence);
  }

  socket.on('updateGameState', (newState: Partial<typeof gameState>) => {
    if (newState.timerSeconds !== undefined && newState.timerEndTime === undefined) {
      newState.timerEndTime = Date.now() + newState.timerSeconds * 1000;
    }
    gameState = { ...gameState, ...newState };
    broadcastState();
  });

  socket.on('loadSequence', async (data: { round: number }) => {
    currentRound = data.round;
    drawnNumbers.clear();
    wipedNumbers.clear();
    
    // Reset per-round powers
    gameState.usedPowers = { stealTheNumber: false, memoryWipe: false, extraTicket: false, doublePoints: false, dualCall: false };
    gameState.dualCallActive = false;
    gameState.dualCallRemaining = 0;
    
    let equations = await prisma.equation.findMany({ where: { difficulty: data.round } });
    if (equations.length === 0) {
      await seedDatabase(prisma);
      equations = await prisma.equation.findMany({ where: { difficulty: data.round } });
    }
    for (let i = equations.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [equations[i], equations[j]] = [equations[j], equations[i]];
    }
    currentSequence = equations;
    
    // Transition to Second Main Title Screen (title_hype) so round-specific wording shows
    gameState.status = 'title_hype';
    gameState.round = currentRound;
    gameState.phase = 1;
    gameState.currentEquationIndex = 0;
    
    broadcastSequence();
    broadcastState();
  });

  // ── ALLISON INTRODUCTION CONTROLS ───────────────────────────────────────
  socket.on('playAllisonLine', (data: { line: number }) => {
    gameState.status = 'allison_intro';
    gameState.allisonLine = data.line;
    gameState.allisonSpeaking = true;
    broadcastState();
    io.emit('allisonLinePlayed', data);
  });

  socket.on('stopAllisonAudio', () => {
    gameState.allisonSpeaking = false;
    broadcastState();
    io.emit('stopAllisonAudio');
  });

  socket.on('allisonSpeakingFinished', (data?: { line: number }) => {
    gameState.allisonSpeaking = false;
    broadcastState();
  });

  // ── MATH ERRORS / TACTICAL POWERS ───────────────────────────────────────
  socket.on('verifyMathError', (data: { playerName: string }) => {
    gameState.status = 'math_error_verifying';
    gameState.mathErrorPlayerName = data.playerName;
    broadcastState();
  });

  socket.on('mathErrorClaimed', async (data: { playerName: string }) => {
    gameState.status = 'math_error';
    gameState.mathErrorPlayerName = data.playerName;
    broadcastState();

    const round = gameState.round || 1;
    const errorPoints = getMathErrorPoints(round);

    if (data.playerName) {
      try {
        let player = await prisma.player.findUnique({ where: { name: data.playerName } });
        if (!player) {
          player = await prisma.player.create({ data: { name: data.playerName, score: 0 } });
        }
        await prisma.player.update({
          where: { id: player.id },
          data: { score: { increment: errorPoints } }
        });
        await prisma.scoreLog.create({
          data: {
            playerId: player.id,
            cardId: SYSTEM_CARD_ID,
            round: gameState.round || 1,
            phase: gameState.phase || 1,
            points: errorPoints,
            reason: `Math Error Claimed (+${errorPoints} pts)`
          }
        });
        logEvent('MATH ERROR', player.name, 'Valid Math Error Claimed', `+${errorPoints} PTS`, `Round ${gameState.round || 1} - Phase ${gameState.phase || 1}`, player.assignedCardId || SYSTEM_CARD_ID);
        const leaderboard = await getLeaderboard();
        io.emit('leaderboardUpdate', leaderboard);
        const allPlayers = await prisma.player.findMany({ orderBy: { name: 'asc' } });
        io.emit('playersUpdate', allPlayers);

        if ((gameState.status as string) === 'leaderboard') {
          const lb = await getLeaderboard(gameState.round);
          io.emit('showLeaderboardStage', { leaderboard: lb, mode: 'round', round: gameState.round });
        }
      } catch (err) {
        console.error('Error awarding math error points:', err);
      }
    }
    
    setTimeout(() => {
      if (gameState.status === 'math_error') {
        gameState.status = 'power_selection';
        gameState.highlightedPower = ''; // Reset any previously highlighted power
        broadcastState();
      }
    }, 3000);
  });

  socket.on('mathErrorFalseAlarm', async (data?: { playerName?: string }) => {
    gameState.status = 'math_error_false';
    gameState.mathErrorPlayerName = data?.playerName ?? '';
    broadcastState();
    if (data?.playerName) {
      try {
        const player = await prisma.player.findUnique({ where: { name: data.playerName } });
        if (player) {
          await prisma.player.update({
            where: { id: player.id },
            data: { score: player.score - 100 }
          });
          await prisma.scoreLog.create({
            data: {
              playerId: player.id,
              cardId: SYSTEM_CARD_ID,
              round: gameState.round || 1,
              phase: gameState.phase || 1,
              points: -100,
              reason: 'False Alarm (Math Error Claimed)'
            }
          });
          logEvent('MATH ERROR', player.name, 'False Math Error Penalty', '-100 PTS', `Round ${gameState.round || 1} - Phase ${gameState.phase || 1}`, player.assignedCardId || SYSTEM_CARD_ID);
          const leaderboard = await getLeaderboard();
          io.emit('leaderboardUpdate', leaderboard);
          const allPlayers = await prisma.player.findMany({ orderBy: { name: 'asc' } });
          io.emit('playersUpdate', allPlayers);

          if ((gameState.status as string) === 'leaderboard') {
            const lb = await getLeaderboard(gameState.round);
            io.emit('showLeaderboardStage', { leaderboard: lb, mode: 'round', round: gameState.round });
          }
        }
      } catch (err) {
        console.error('Error handling math error false alarm:', err);
      }
    }
  });

  socket.on('bingoClaimed', (data: { playerName: string }) => {
    gameState.status = 'bingo_claimed_by';
    gameState.verifyingPlayerName = data.playerName;
    broadcastState();
    setTimeout(() => {
      if (gameState.status === 'bingo_claimed_by') {
        gameState.status = 'verifying_buildup';
        broadcastState();
      }
    }, 3000);
  });

  socket.on('highlightPower', (data: { power: string }) => {
    gameState.status = 'power_selection';
    gameState.highlightedPower = data.power;
    broadcastState();
  });

  socket.on('activatePower', (data: { power: string; playerName: string; targetNumber?: string; drawnNumber?: string }) => {
    gameState.status = 'power_activated';
    gameState.activatedPower = data.power;
    gameState.mathErrorPlayerName = data.playerName;
    gameState.powerTargetNumber = data.targetNumber || '';
    gameState.powerDrawnNumber = data.drawnNumber || '';
    broadcastState();
  });

  socket.on('showLeaderboard', async (data: { mode: 'cumulative' | 'round'; round?: number }) => {
    gameState.status = 'leaderboard';
    const lb = await getLeaderboard(data.mode === 'round' ? data.round : undefined);
    io.emit('showLeaderboardStage', { leaderboard: lb, mode: data.mode, round: data.round });
    broadcastState();
  });
});

// ─── REGISTRATION ─────────────────────────────────────────────────────────────

// Nodemailer transporter — forces family: 4 (IPv4) to eliminate Render IPv6 ENETUNREACH error
function createEmailTransporter() {
  const smtpUser = (process.env.SMTP_USER || process.env.GMAIL_USER || '').trim();
  const rawPass = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || process.env.GMAIL_PASS || '';
  const smtpPass = rawPass.replace(/\s+/g, ''); // strip any spaces from Gmail App Passwords!
  const smtpHost = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();

  if (smtpUser && smtpPass) {
    console.log(`📧 Configured Nodemailer IPv4 SSL Port 465 for user: ${smtpUser}`);
    return nodemailer.createTransport({
      host: smtpHost,
      port: 465,
      secure: true, // SSL port 465 is open on Render
      family: 4, // FORCE IPv4 to eliminate Render IPv6 ENETUNREACH error!
      auth: { user: smtpUser, pass: smtpPass },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 8000,
    } as any);
  }

  console.log('⚠️ No SMTP credentials configured. Nodemailer running in DEV console mode.');
  return nodemailer.createTransport({ jsonTransport: true });
}

const emailTransporter = createEmailTransporter();

function generatePin(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function dispatchPinEmail(toEmail: string, name: string, pin: string) {
  const webhookUrl = process.env.GMAIL_WEBHOOK_URL?.trim();
  const smtpUser = (process.env.SMTP_USER || process.env.GMAIL_USER || '').trim();
  const resendKey = process.env.RESEND_API_KEY?.trim();
  const html = `
    <div style="font-family: Arial, sans-serif; background: #0f172a; color: #e2e8f0; padding: 32px; border-radius: 16px; max-width: 480px; margin: 0 auto;">
      <h1 style="color: #34d399; font-size: 28px; margin-bottom: 4px;">MathFest AI Speed Bingo</h1>
      <p style="color: #94a3b8; margin-bottom: 24px;">Welcome, <strong style="color: #fff;">${name}</strong>!</p>
      <p style="margin-bottom: 16px;">Your 6-digit verification PIN is:</p>
      <div style="background: #1e293b; border: 2px solid #34d399; border-radius: 12px; text-align: center; padding: 24px 0; margin-bottom: 24px;">
        <span style="font-size: 48px; font-weight: 900; letter-spacing: 12px; color: #34d399;">${pin}</span>
      </div>
      <p style="color: #94a3b8; font-size: 14px;">This PIN expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
      <hr style="border-color: #334155; margin: 24px 0;" />
      <p style="color: #475569; font-size: 12px;">MathFest 2026 · AI Speed Bingo Registration</p>
    </div>
  `;

  // Priority #1: Google Apps Script Webhook (Port 443 HTTPS — 100% cloud delivery to ALL email addresses)
  if (webhookUrl) {
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          to: toEmail,
          subject: '🎲 MathFest Bingo — Your Verification PIN',
          html,
        }),
      });
      const responseText = await res.text();
      if (res.ok && (responseText.includes('success') || responseText.includes('true'))) {
        console.log(`📧 PIN Email dispatched via Google Webhook HTTPS API to ${toEmail}`);
        return;
      } else {
        console.error(`❌ Google Webhook response was not success: ${responseText.slice(0, 200).replace(/\s+/g, ' ')}`);
      }
    } catch (err: any) {
      console.error('❌ Google Webhook email dispatch error:', err.message);
    }
  }

  // First priority: Standard Gmail SMTP (sends to ALL recipient email accounts worldwide)
  if (smtpUser) {
    try {
      const mailOptions = {
        from: `MathFest Bingo <${smtpUser}>`,
        to: toEmail,
        subject: '🎲 MathFest Bingo — Your Verification PIN',
        html,
      };
      await emailTransporter.sendMail(mailOptions);
      console.log(`📧 PIN Email dispatched via Gmail SMTP (${smtpUser}) to ${toEmail}`);
      return;
    } catch (err: any) {
      console.error('❌ Gmail SMTP send error:', err.message);
    }
  }

  // Second priority: Resend HTTPS API (if configured)
  if (resendKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM || 'MathFest Bingo <onboarding@resend.dev>',
          to: [toEmail],
          subject: '🎲 MathFest Bingo — Your Verification PIN',
          html,
        }),
      });
      if (res.ok) {
        console.log(`📧 PIN Email dispatched via Resend HTTPS API to ${toEmail}`);
        return;
      }
      const errJson = await res.json().catch(() => ({}));
      console.error('❌ Resend API error response:', errJson);
    } catch (err: any) {
      console.error('❌ Resend API fetch error:', err.message);
    }
  }

  console.log(`\n📧 [DEV Fallback] PIN for ${toEmail}: ${pin}\n`);
}

// POST /api/register/send-pin
app.post('/api/register/send-pin', async (req, res) => {
  const { name, email } = req.body as { name: string; email: string };
  const trimmedName = name?.trim();
  const trimmedEmail = email?.trim().toLowerCase();

  if (!trimmedName) return res.status(400).json({ error: 'Name is required.' });
  if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }

  // Check if another player already registered with this email
  const existingByEmail = await prisma.player.findUnique({ where: { email: trimmedEmail } });
  if (existingByEmail && existingByEmail.name !== trimmedName) {
    return res.status(409).json({ error: 'This email is already registered to another player.' });
  }

  // Check if name is already taken by a different email
  const existingByName = await prisma.player.findUnique({ where: { name: trimmedName } });
  if (existingByName && existingByName.email && existingByName.email !== trimmedEmail) {
    return res.status(409).json({ error: 'This name is already registered with a different email.' });
  }

  // If already verified, don't re-send
  if ((existingByEmail || existingByName)?.isVerified) {
    return res.status(409).json({ error: 'You are already registered for MathFest Bingo!' });
  }

  const pin = generatePin();
  const pinExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await prisma.player.upsert({
    where: { email: trimmedEmail },
    update: { name: trimmedName, verificationPin: pin, pinExpiresAt, isVerified: false },
    create: { name: trimmedName, email: trimmedEmail, verificationPin: pin, pinExpiresAt, isVerified: false },
  });

  // Instantly notify Admin UI connected clients about the new pending registration
  const allPlayers = await prisma.player.findMany({ orderBy: { name: 'asc' } });
  io.emit('playersUpdate', allPlayers);
  io.emit('playerRegistered', { name: trimmedName, email: trimmedEmail, isPending: true });

  // Dispatch email asynchronously
  dispatchPinEmail(trimmedEmail, trimmedName, pin);

  res.json({ success: true, message: `Verification PIN sent to ${trimmedEmail}.` });
});


// GET /api/admin/test-email — Test email dispatch diagnostics for Gmail SMTP
app.get('/api/admin/test-email', async (req, res) => {
  const targetEmail = (req.query.email as string || process.env.SMTP_USER || '').trim();
  if (!targetEmail) return res.status(400).json({ error: 'No target recipient email specified.' });

  try {
    const info = await emailTransporter.sendMail({
      from: process.env.SMTP_USER || 'noreply@mathfest.ai',
      to: targetEmail,
      subject: '🎲 MathFest Bingo — Test Email Dispatch',
      html: `
        <div style="font-family: Arial, sans-serif; background: #0f172a; color: #e2e8f0; padding: 24px; border-radius: 12px; max-width: 440px;">
          <h2 style="color: #34d399; margin: 0 0 8px 0;">MathFest Bingo Email Test</h2>
          <p style="margin: 0 0 16px 0;">If you receive this message, your <strong>Gmail SMTP server configuration is 100% active and working</strong>!</p>
          <p style="color: #94a3b8; font-size: 12px; margin: 0;">Dispatched at: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' })}</p>
        </div>
      `,
    });
    console.log(`📧 Test email sent to ${targetEmail}:`, info);
    res.json({ success: true, message: `Test email successfully sent to ${targetEmail}!`, info });
  } catch (err: any) {
    console.error('❌ Gmail SMTP test email error:', err);
    res.status(500).json({ error: `Gmail SMTP Error: ${err.message}` });
  }
});



// POST /api/register/verify-pin
app.post('/api/register/verify-pin', async (req, res) => {
  const { email, pin } = req.body as { email: string; pin: string };
  const trimmedEmail = email?.trim().toLowerCase();

  if (!trimmedEmail || !pin) {
    return res.status(400).json({ error: 'Email and PIN are required.' });
  }

  const player = await prisma.player.findUnique({ where: { email: trimmedEmail } });
  if (!player) return res.status(404).json({ error: 'No registration found for this email.' });

  if (player.isVerified) {
    return res.json({ success: true, alreadyVerified: true, player: { name: player.name, email: player.email, assignedCardId: player.assignedCardId } });
  }

  if (!player.verificationPin || player.verificationPin !== pin) {
    return res.status(400).json({ error: 'Incorrect PIN. Please check your email and try again.' });
  }

  if (!player.pinExpiresAt || new Date() > player.pinExpiresAt) {
    return res.status(400).json({ error: 'PIN has expired. Please request a new one.' });
  }

  const updated = await prisma.player.update({
    where: { email: trimmedEmail },
    data: { verificationPin: null, pinExpiresAt: null },
  });

  res.json({ success: true, player: { name: updated.name, email: updated.email, assignedCardId: updated.assignedCardId } });
});

// POST /api/register/assign-card — Step 3: Link physical card ID to player
app.post('/api/register/assign-card', async (req, res) => {
  const { email, cardId } = req.body as { email: string; cardId: string };
  const trimmedEmail = email?.trim().toLowerCase();
  const normalizedId = normalizeCardId(cardId);

  if (!trimmedEmail || !normalizedId) {
    return res.status(400).json({ error: 'Email and valid Card ID are required.' });
  }

  // 1. Verify card exists in DB
  const card = await prisma.bingoCard.findUnique({ where: { id: normalizedId } });
  if (!card) {
    return res.status(404).json({ error: `Card ID "${normalizedId}" was not found in database.` });
  }

  // 2. Verify card not linked to a different player
  const existingAssigned = await prisma.player.findFirst({
    where: { assignedCardId: normalizedId, NOT: { email: trimmedEmail } },
  });
  if (existingAssigned) {
    return res.status(409).json({ error: `Card ${normalizedId} is already linked to player "${existingAssigned.name}".` });
  }

  const updated = await prisma.player.update({
    where: { email: trimmedEmail },
    data: { assignedCardId: normalizedId },
  });

  const allPlayers = await prisma.player.findMany({ orderBy: { name: 'asc' } });
  io.emit('playersUpdate', allPlayers);

  res.json({ success: true, cardId: normalizedId, player: updated });
});

// POST /api/register/join-grid — Step 4: Official Final Verification Button
app.post('/api/register/join-grid', async (req, res) => {
  const { email, cardId } = req.body as { email: string; cardId: string };
  const trimmedEmail = email?.trim().toLowerCase();
  const normalizedId = normalizeCardId(cardId);

  if (!trimmedEmail || !normalizedId) {
    return res.status(400).json({ error: 'Email and Card ID are required.' });
  }

  const player = await prisma.player.findUnique({ where: { email: trimmedEmail } });
  if (!player) return res.status(404).json({ error: 'Player registration record not found.' });

  const verified = await prisma.player.update({
    where: { email: trimmedEmail },
    data: { isVerified: true, assignedCardId: normalizedId, verificationPin: null, pinExpiresAt: null },
  });

  const allPlayers = await prisma.player.findMany({ orderBy: { name: 'asc' } });
  io.emit('playersUpdate', allPlayers);
  io.emit('playerRegistered', { name: verified.name, email: verified.email, cardId: verified.assignedCardId });
  logEvent('REGISTRATION', verified.name, 'Joined Tournament Grid', 'Verified', `Email: ${verified.email}`, verified.assignedCardId || '—');

  res.json({ success: true, player: verified });
});

// ─── AUDIT LOGGING & GOOGLE SHEETS WEBHOOK ──────────────────────────────────────
type AuditLogEntry = {
  id: number;
  timestamp: string;
  category: string;
  playerName: string;
  cardId: string;
  action: string;
  points: number | string;
  details: string;
};

let auditLog: AuditLogEntry[] = [];
let nextLogId = 1;

async function logEvent(category: string, playerName: string, action: string, points: number | string = '—', details: string = '', cardId: string = '—') {
  const timestamp = new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' });
  const entry: AuditLogEntry = {
    id: nextLogId++,
    timestamp,
    category,
    playerName,
    cardId,
    action,
    points,
    details
  };
  auditLog.unshift(entry);
  if (auditLog.length > 500) auditLog.pop();

  io.emit('auditLogUpdate', entry);

  const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      });
    } catch (err: any) {
      console.warn('Google Sheets Webhook log error:', err.message);
    }
  }
}

// GET /api/admin/audit-log
app.get('/api/admin/audit-log', (_req, res) => {
  res.json(auditLog);
});

// GET /api/admin/export-csv — Download full event ledger for Google Sheets
app.get('/api/admin/export-csv', (_req, res) => {
  const headers = ['Timestamp', 'Category', 'Player Name', 'Card ID', 'Action', 'Points', 'Details'];
  const rows = auditLog.map(e => [
    `"${e.timestamp}"`,
    `"${e.category}"`,
    `"${e.playerName.replace(/"/g, '""')}"`,
    `"${(e.cardId || '—').replace(/"/g, '""')}"`,
    `"${e.action.replace(/"/g, '""')}"`,
    `"${e.points}"`,
    `"${e.details.replace(/"/g, '""')}"`
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=mathfest_2026_audit_log.csv');
  res.send(csv);
});

// DELETE /api/register/players/:id — delete a participant from the roster
app.delete('/api/register/players/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
  try {
    const player = await prisma.player.findUnique({ where: { id } });
    if (player) {
      await prisma.scoreLog.deleteMany({ where: { playerId: id } });
      await prisma.player.delete({ where: { id } });
      logEvent('REGISTRATION', player.name, 'Participant Registration Deleted', '—', `Email: ${player.email || 'N/A'}`, player.assignedCardId || '—');
    }
    const allPlayers = await prisma.player.findMany({ orderBy: { name: 'asc' } });
    io.emit('playersUpdate', allPlayers);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete registered player' });
  }
});

// POST /api/register/admin-verify/:id — host manually verifies a pending registration instantly
app.post('/api/register/admin-verify/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
  try {
    const verified = await prisma.player.update({
      where: { id },
      data: { isVerified: true, verificationPin: null, pinExpiresAt: null },
    });
    const allPlayers = await prisma.player.findMany({ orderBy: { name: 'asc' } });
    io.emit('playersUpdate', allPlayers);
    io.emit('playerRegistered', { name: verified.name, email: verified.email, cardId: verified.assignedCardId });
    logEvent('REGISTRATION', verified.name, 'Host Manual Instant Verification', 'Verified', `Email: ${verified.email || 'N/A'}`, verified.assignedCardId || '—');
    res.json({ success: true, player: verified });
  } catch {
    res.status(500).json({ error: 'Failed to verify player' });
  }
});


// ─── 3 STRUCTURED SPREADSHEETS FOR GOOGLE SHEETS EXPORT ───────────────────────

// SPREADSHEET 1: Game Event Timeline (Rounds, Phases & Claims)
app.get('/api/admin/export-sheet1', async (_req, res) => {
  const rows: string[] = [];
  rows.push('=== SPREADSHEET 1: GAME EVENT TIMELINE ===');
  rows.push('Timestamp,Round & Phase,Event Category,Player Name,Card ID,Action,Points,Details');
  
  auditLog.slice().reverse().forEach(e => {
    rows.push(`"${e.timestamp}","${e.details.includes('Round') ? e.details : 'Game Event'}","${e.category}","${e.playerName.replace(/"/g, '""')}","${(e.cardId || '—').replace(/"/g, '""')}","${e.action.replace(/"/g, '""')}","${e.points}","${e.details.replace(/"/g, '""')}"`);
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=spreadsheet_1_timeline_log.csv');
  res.send(rows.join('\n'));
});

// SPREADSHEET 2: Participant Action Ledger (Grouped per Participant with Running Total)
app.get('/api/admin/export-sheet2', async (_req, res) => {
  const players = await prisma.player.findMany({ orderBy: { name: 'asc' } });
  const logs = await prisma.scoreLog.findMany({
    orderBy: { createdAt: 'asc' },
    include: { player: true },
  });

  const lines: string[] = [];
  lines.push('=== SPREADSHEET 2: PARTICIPANT ACTION LEDGER ===');
  lines.push('');

  for (const p of players) {
    lines.push(`"PARTICIPANT: ${p.name.toUpperCase()}"`);
    lines.push(`"Email: ${p.email || 'N/A'} | Card ID: ${p.assignedCardId || 'N/A'} | Status: ${p.isVerified ? 'Verified' : 'Pending'} | Current Score: ${p.score}"`);
    lines.push('Timestamp,Round & Phase,Card / Item ID,Action / Event,Points Earned,Cumulative Score');

    const playerLogs = logs.filter(l => l.playerId === p.id);
    let runningTotal = 0;

    if (playerLogs.length === 0) {
      lines.push('"—","No game events recorded for this participant","—","—","0","0"');
    } else {
      playerLogs.forEach(l => {
        runningTotal += l.points;
        const timeStr = new Date(l.createdAt).toLocaleString('en-US', { timeZone: 'Asia/Manila' });
        lines.push(`"${timeStr}","Round ${l.round} - Phase ${l.phase}","${l.cardId}","${l.reason}","${l.points}","${runningTotal}"`);
      });
    }
    lines.push(''); // blank row separator
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=spreadsheet_2_participant_ledger.csv');
  res.send(lines.join('\n'));
});

// SPREADSHEET 3: Tournament Standings & Ranking (Round 1, Round 2, Round 3 & Overall)
app.get('/api/admin/export-sheet3', async (_req, res) => {
  const lines: string[] = [];
  lines.push('=== SPREADSHEET 3: TOURNAMENT STANDINGS & RANKINGS ===');
  lines.push('');

  // Per Round Standings
  for (const r of [1, 2, 3]) {
    const roundScores = await getLeaderboard(r);
    lines.push(`"--- ROUND ${r} STANDINGS ---"`);
    lines.push('Rank,Player Name,Round Score,Extra Ticket,Double Points');
    if (roundScores.length === 0) {
      lines.push('"—","No scores recorded for this round","0","No","No"');
    } else {
      roundScores.forEach((p, idx) => {
        lines.push(`"${idx + 1}","${p.name}","${p.score}","${p.extraTickets ? 'Yes' : 'No'}","${p.doublePoints ? 'Yes' : 'No'}"`);
      });
    }
    lines.push('');
  }

  // Cumulative Overall Standings
  const overall = await getLeaderboard();
  lines.push('"--- OVERALL CUMULATIVE STANDINGS ---"');
  lines.push('Rank,Player Name,Total Score,Extra Ticket,Double Points');
  if (overall.length === 0) {
    lines.push('"—","No overall scores recorded","0","No","No"');
  } else {
    overall.forEach((p, idx) => {
      lines.push(`"${idx + 1}","${p.name}","${p.score}","${p.extraTickets ? 'Yes' : 'No'}","${p.doublePoints ? 'Yes' : 'No'}"`);
    });
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=spreadsheet_3_tournament_rankings.csv');
  res.send(lines.join('\n'));
});

// ALL IN ONE: Combined 3-Spreadsheet Google Sheets Workbook Exporter
app.get('/api/admin/export-all-sheets', async (_req, res) => {
  const currentPort = process.env.PORT || 3001;
  const req1 = await fetch(`http://127.0.0.1:${currentPort}/api/admin/export-sheet1`).then(r => r.text()).catch(() => '');
  const req2 = await fetch(`http://127.0.0.1:${currentPort}/api/admin/export-sheet2`).then(r => r.text()).catch(() => '');
  const req3 = await fetch(`http://127.0.0.1:${currentPort}/api/admin/export-sheet3`).then(r => r.text()).catch(() => '');

  const combined = [req1, '\n\n', req2, '\n\n', req3].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=mathfest_2026_complete_google_sheets_master.csv');
  res.send(combined);
});

// GET /api/register/players — all registered players for the admin view
app.get('/api/register/players', async (_req, res) => {
  try {
    const players = await prisma.player.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, email: true, isVerified: true, verificationPin: true, assignedCardId: true, score: true, createdAt: true },
    });
    res.json(players);
  } catch {
    res.status(500).json({ error: 'Failed to fetch registered players' });
  }
});

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`Backend running on port ${PORT} (0.0.0.0)`);
  try {
    const count = await prisma.equation.count();
    if (count === 0) {
      console.log('No equations found in DB. Auto-seeding default equations...');
      await seedDatabase(prisma);
    }
  } catch (err) {
    console.error('Error auto-seeding equations on startup:', err);
  }
});


