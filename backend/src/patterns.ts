/**
 * Pattern & Points Logic for MathFest AI Speed Bingo
 * Central module shared across the backend.
 */

// ─── POINT MATRIX ────────────────────────────────────────────────────────────
// [round][phase] => points
export const POINT_MATRIX: Record<number, Record<number, number>> = {
  1: { 1: 100,  2: 200,  3: 500  },
  2: { 1: 150,  2: 300,  3: 700  },
  3: { 1: 250,  2: 400,  3: 1000 },
};

export const FALSE_ALARM_PENALTY = -100;

// ─── MATH ERROR POINTS ────────────────────────────────────────────────────────
// R1: 50, R2: 100, R3: 150
export const MATH_ERROR_POINTS: Record<number, number> = {
  1: 50,
  2: 100,
  3: 150,
};

export function getMathErrorPoints(round: number): number {
  return MATH_ERROR_POINTS[round] ?? (50 + Math.max(0, round - 1) * 50);
}

// ─── PATTERN NAMES ────────────────────────────────────────────────────────────
export const PHASE_NAMES: Record<number, string> = {
  1: 'Line Bingo',
  2: 'Special Pattern',
  3: 'Blackout',
};

export const PATTERN_NAMES: Record<number, string> = {
  1: 'X-Pattern',
  2: 'Frame Pattern',
  3: 'Diamond Pattern',
};

export const PHASE_DESCRIPTIONS: Record<number, string> = {
  1: 'Complete any horizontal, vertical, or diagonal line (including FREE space).',
  2: 'See the pattern displayed on screen.',
  3: 'Cover ALL 25 spaces on your card — including FREE!',
};

// ─── PATTERN GRID INDICES (0-24, index 12 = FREE space) ──────────────────────
// 5x5 grid layout (row-major):
// [ 0,  1,  2,  3,  4]
// [ 5,  6,  7,  8,  9]
// [10, 11, 12, 13, 14]
// [15, 16, 17, 18, 19]
// [20, 21, 22, 23, 24]

// Phase 1 winning sets (any ONE must be complete)
const LINES = [
  [0,  1,  2,  3,  4],   // Row 1
  [5,  6,  7,  8,  9],   // Row 2
  [10, 11, 12, 13, 14],  // Row 3 (middle, includes FREE)
  [15, 16, 17, 18, 19],  // Row 4
  [20, 21, 22, 23, 24],  // Row 5
  [0,  5,  10, 15, 20],  // Col 1
  [1,  6,  11, 16, 21],  // Col 2
  [2,  7,  12, 17, 22],  // Col 3 (middle, includes FREE)
  [3,  8,  13, 18, 23],  // Col 4
  [4,  9,  14, 19, 24],  // Col 5
  [0,  6,  12, 18, 24],  // Diagonal TL→BR (includes FREE)
  [4,  8,  12, 16, 20],  // Diagonal TR→BL (includes FREE)
];

// Phase 2 Special Patterns (by round)
const PATTERNS: Record<number, number[][]> = {
  1: [[0, 6, 12, 18, 24], [4, 8, 12, 16, 20]], // Round 1: X-Pattern (both diagonals)
  2: [[0,1,2,3,4, 5,9, 10,14, 15,19, 20,21,22,23,24]],  // Round 2: Frame / Outer Border
  3: [[2, 6, 7, 8, 10, 11, 12, 13, 14, 16, 17, 18, 22]], // Round 3: Solid Diamond (13 squares)
};

// ─── CHECKER FUNCTIONS ────────────────────────────────────────────────────────

// Convert the grid (24 numbers) to a 25-element array (with FREE at index 12)
function buildGridMap(grid: number[], drawn: Set<number>): boolean[] {
  // grid has 24 numbers, index 12 is FREE
  const cells: boolean[] = new Array(25).fill(false);
  let gridIdx = 0;
  for (let cellIdx = 0; cellIdx < 25; cellIdx++) {
    if (cellIdx === 12) {
      cells[cellIdx] = true; // FREE space always marked
    } else {
      cells[cellIdx] = drawn.has(grid[gridIdx]);
      gridIdx++;
    }
  }
  return cells;
}

export function checkLine(grid: number[], drawn: Set<number>): boolean {
  const cells = buildGridMap(grid, drawn);
  return LINES.some(line => line.every(i => cells[i]));
}

export function checkPattern(grid: number[], drawn: Set<number>, round: number): boolean {
  const cells = buildGridMap(grid, drawn);
  const pattern = PATTERNS[round];
  if (!pattern) return false;
  // ALL sub-patterns of the round must be complete
  return pattern.every(subPattern => subPattern.every(i => cells[i]));
}

export function checkBlackout(grid: number[], drawn: Set<number>): boolean {
  // All 24 numbers must be drawn (FREE is always free)
  return grid.every(n => drawn.has(n));
}

export type WinCheckResult =
  | { win: true;  points: number; reason: string }
  | { win: false; reason: string };

export function checkWin(
  grid: number[],
  drawn: Set<number>,
  round: number,
  phase: number
): WinCheckResult {
  let win = false;
  if (phase === 1) win = checkLine(grid, drawn);
  if (phase === 2) win = checkPattern(grid, drawn, round);
  if (phase === 3) win = checkBlackout(grid, drawn);

  if (win) {
    const points = POINT_MATRIX[round]?.[phase] ?? 0;
    const reason = phase === 1 ? 'Line Bingo'
      : phase === 2 ? PATTERN_NAMES[round] ?? 'Special Pattern'
      : 'Blackout';
    return { win: true, points, reason };
  }

  return { win: false, reason: 'No valid win pattern found' };
}
