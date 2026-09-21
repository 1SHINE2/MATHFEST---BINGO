import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

const randomChoice = <T>(arr: T[]): T => arr[randomInt(0, arr.length - 1)];

type RoundConfig = {
  round: number;
  minTerms: number;
  maxTerms: number;
  maxDigits: number;
  allowNegatives: boolean;
  allowDecimals: boolean;
  allowPercents: boolean;
};

const configs: Record<number, RoundConfig> = {
  1: { round: 1, minTerms: 2, maxTerms: 2, maxDigits: 3, allowNegatives: true, allowDecimals: false, allowPercents: false },  // Easy (was R2)
  2: { round: 2, minTerms: 2, maxTerms: 3, maxDigits: 3, allowNegatives: true, allowDecimals: false, allowPercents: false }, // Medium (was R3)
  3: { round: 3, minTerms: 2, maxTerms: 3, maxDigits: 3, allowNegatives: true, allowDecimals: true, allowPercents: true }    // Difficult (was R5)
};

// Represents a node in the expression tree
type ExprNode = 
  | { type: 'num', value: number }
  | { type: 'op', op: '+' | '-' | '*' | '/' | '%', left: ExprNode, right: ExprNode, value: number };

const opPrecedence = {
  '+': 1,
  '-': 1,
  '*': 2,
  '/': 2,
  '%': 3, // L% of R
};

function formatDecimals(num: number): string {
  // avoid crazy floating point errors
  const s = parseFloat(num.toFixed(4)).toString();
  return s;
}

function astToString(node: ExprNode): string {
  if (node.type === 'num') {
    return formatDecimals(node.value);
  }
  
  const currentPrecedence = opPrecedence[node.op];

  // Format left child with precedence check
  let leftStr = astToString(node.left);
  if (node.left.type === 'op') {
    const leftPrec = opPrecedence[node.left.op];
    if (leftPrec < currentPrecedence) {
      leftStr = `(${leftStr})`;
    }
  }

  // Format right child with precedence and non-associativity check
  let rightStr = astToString(node.right);
  if (node.right.type === 'op') {
    const rightPrec = opPrecedence[node.right.op];
    if (rightPrec < currentPrecedence) {
      rightStr = `(${rightStr})`;
    } else if (rightPrec === currentPrecedence && (node.op === '-' || node.op === '/' || node.op === '%')) {
      rightStr = `(${rightStr})`;
    }
  }

  if (node.op === '%') {
    return `${leftStr}% of ${rightStr}`;
  }
  return `${leftStr} ${node.op} ${rightStr}`;
}

function expandNode(node: { type: 'num', value: number }, config: RoundConfig): ExprNode {
  const ops = ['+', '-', '*', '/'];
  if (config.allowPercents) ops.push('%');
  
  const op = randomChoice(ops) as '+' | '-' | '*' | '/' | '%';
  let leftVal: number = 0;
  let rightVal: number = 0;
  const val = node.value;

  const maxVal = Math.pow(10, config.maxDigits) - 1;

  if (op === '+') {
    leftVal = randomInt(config.allowNegatives ? -100 : 0, val + 100);
    rightVal = val - leftVal;
  } else if (op === '-') {
    leftVal = randomInt(val, val + 100);
    rightVal = leftVal - val;
  } else if (op === '*') {
    // try to find factors if no decimals
    if (!config.allowDecimals) {
      const factors = [];
      for (let i = 1; i <= Math.abs(val); i++) {
        if (val % i === 0) factors.push(i);
      }
      if (factors.length > 0) {
        leftVal = randomChoice(factors);
        if (config.allowNegatives && Math.random() > 0.5) leftVal = -leftVal;
        rightVal = val / leftVal;
      } else {
        // Fallback to non-trivial addition if prime-ish
        const a = randomInt(1, Math.max(1, val - 1));
        return { type: 'op', op: '+', left: { type: 'num', value: a }, right: { type: 'num', value: val - a }, value: val };
      }
    } else {
      // Allow decimals, pick random integer factor
      leftVal = randomInt(1, 10);
      if (config.allowNegatives && Math.random() > 0.5) leftVal = -leftVal;
      rightVal = val / leftVal;
    }
  } else if (op === '/') {
    rightVal = randomInt(1, 20);
    if (config.allowNegatives && Math.random() > 0.5) rightVal = -rightVal;
    leftVal = val * rightVal;
  } else if (op === '%') {
    // leftVal % of rightVal = val => (leftVal / 100) * rightVal = val
    // Let's pick leftVal to be a nice percentage: 10, 20, 25, 50, 100, 200
    leftVal = randomChoice([10, 20, 25, 50, 100, 200]);
    rightVal = (val * 100) / leftVal;
  }

  // Cap digits — fall back to a non-trivial addition split
  if (Math.abs(leftVal) > maxVal || Math.abs(rightVal) > maxVal) {
    const a = randomInt(1, Math.max(1, val - 1));
    const b = val - a;
    return { type: 'op', op: '+', left: { type: 'num', value: a }, right: { type: 'num', value: b }, value: val };
  }

  if (!config.allowNegatives && (leftVal < 0 || rightVal < 0)) {
    const a = randomInt(1, Math.max(1, val - 1));
    const b = val - a;
    return { type: 'op', op: '+', left: { type: 'num', value: a }, right: { type: 'num', value: b }, value: val };
  }

  if (!config.allowDecimals && (!Number.isInteger(leftVal) || !Number.isInteger(rightVal))) {
    const a = randomInt(1, Math.max(1, val - 1));
    const b = val - a;
    return { type: 'op', op: '+', left: { type: 'num', value: a }, right: { type: 'num', value: b }, value: val };
  }

  return {
    type: 'op',
    op,
    left: { type: 'num', value: leftVal },
    right: { type: 'num', value: rightVal },
    value: val
  };
}

function countTerms(node: ExprNode): number {
  if (node.type === 'num') return 1;
  return countTerms(node.left) + countTerms(node.right);
}

function getExpandableNodes(node: ExprNode): { type: 'num', value: number }[] {
  if (node.type === 'num') return [node];
  return [...getExpandableNodes(node.left), ...getExpandableNodes(node.right)];
}

function replaceNode(root: ExprNode, oldNode: ExprNode, newNode: ExprNode): ExprNode {
  if (root === oldNode) return newNode;
  if (root.type === 'op') {
    return {
      ...root,
      left: replaceNode(root.left, oldNode, newNode),
      right: replaceNode(root.right, oldNode, newNode)
    };
  }
  return root;
}

function generateEquation(target: number, config: RoundConfig): string {
  let ast: ExprNode = { type: 'num', value: target };
  let terms = 1;

  const targetTerms = randomInt(config.minTerms, config.maxTerms);

  while (terms < targetTerms) {
    const candidates = getExpandableNodes(ast);
    const leaf = randomChoice(candidates);
    const expanded = expandNode(leaf, config);
    ast = replaceNode(ast, leaf, expanded);
    terms++;
  }

  return astToString(ast);
}

const usedEquations = new Set<string>();

function generateUniqueEquation(target: number, round: number): string {
  const config = configs[round];
  let eqStr = "";
  let attempts = 0;
  while (attempts < 1000) {
    eqStr = generateEquation(target, config);
    // basic cleanup
    eqStr = eqStr.replace(/\+ -/g, '- ');
    
    // Quick evaluate to ensure no JS math errors drifted it
    try {
      const evalStr = eqStr.replace(/% of/g, '/ 100 *');
      const evaluated = eval(evalStr);
      if (Math.abs(evaluated - target) < 0.01) {
        if (!usedEquations.has(eqStr)) {
          usedEquations.add(eqStr);
          return `${eqStr} = ?`;
        }
      }
    } catch(e) {}
    attempts++;
  }
  throw new Error("Could not generate unique equation");
}

async function main() {
  console.log('Clearing old data...');
  await prisma.equation.deleteMany();

  const equationsToInsert = [];

  for (let round = 1; round <= 3; round++) {
    console.log(`Generating Round ${round}...`);
    // 1 unique valid equation per number (75 valid + 5 errors = 80 per round)
    for (let target = 1; target <= 75; target++) {
      equationsToInsert.push({
        equationText: generateUniqueEquation(target, round),
        targetNumber: target,
        difficulty: round,
        isError: false
      });
    }

    // 5 unique errors per round
    const roundInvalidTargets: Record<number, number[]> = {
      1: [-5, -10, -15, 80, 90, 100, 0],
      2: [-10, -20, 85, 95, 100, 110],
      3: [-15, 0.25, 0.5, 2.5, 80, 100],
    };
    for (let i = 0; i < 5; i++) {
      const target = randomChoice(roundInvalidTargets[round]);
      equationsToInsert.push({
        equationText: generateUniqueEquation(target, round),
        targetNumber: null,
        difficulty: round,
        isError: true
      });
    }
  }

  console.log(`Seeding ${equationsToInsert.length} equations into DB...`);
  await prisma.equation.createMany({
    data: equationsToInsert
  });
  console.log('Done!');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
