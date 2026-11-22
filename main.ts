// Tiny stack VM for make.fun's ISA v1. Run: node main.ts
import * as fs from "node:fs";
import * as path from "node:path";

const MAX_STEPS = 1000000;
const MAX_OUTPUT = 65536;
const STACK_SIZE = 256;
const CALL_SIZE = 64;
const MEM_SIZE = 256;

// Binary operations by opcode. Division by zero raises trap 4.
const BINOPS = new Map([
  [0x10, (a, b) => (a + b) | 0],
  [0x11, (a, b) => (a - b) | 0],
  [0x12, (a, b) => Math.imul(a, b)],
  [0x13, (a, b) => {
    if (b === 0) throw 4;
    return a === -2147483648 && b === -1 ? a : (a / b) | 0;
  }],
  [0x14, (a, b) => {
    if (b === 0) throw 4;
    return b === -1 ? 0 : (a % b) | 0;
  }],
  [0x15, (a, b) => {
    if (b === 0) throw 4;
    return Math.floor((a >>> 0) / (b >>> 0)) | 0;
  }],
  [0x16, (a, b) => {
    if (b === 0) throw 4;
    return ((a >>> 0) % (b >>> 0)) | 0;
  }],
  [0x18, (a, b) => a & b],
  [0x19, (a, b) => a | b],
  [0x1a, (a, b) => a ^ b],
  [0x1c, (a, b) => a << (b & 31)],
  [0x1d, (a, b) => a >> (b & 31)],
  [0x1e, (a, b) => (a >>> (b & 31)) | 0],
  [0x20, (a, b) => (a === b ? 1 : 0)],
  [0x21, (a, b) => (a < b ? 1 : 0)],
  [0x22, (a, b) => ((a >>> 0) < (b >>> 0) ? 1 : 0)],
]);

function run(prog, input) {
  const stack = new Int32Array(STACK_SIZE);
  const calls = new Int32Array(CALL_SIZE);
  const mem = new Int32Array(MEM_SIZE);
  const out = new Uint8Array(MAX_OUTPUT);
  let sp = 0, rp = 0, pc = 0, ip = 0, olen = 0, steps = 0;
  const finish = (code) => ({
    out: out.subarray(0, olen),
    code,
  });
  let code = -1;
  try {
    for (;;) {
      if (steps >= MAX_STEPS) throw 10;
      if (pc < 0 || pc >= prog.length) throw 9;
      const op = prog[pc];
      pc += 1;
      steps += 1;
      const f = BINOPS.get(op);
      if (f !== undefined) {
        if (sp < 2) throw 2;
        const b = stack[sp - 1];
        const a = stack[sp - 2];
        stack[sp - 2] = f(a, b);
        sp -= 1;
        continue;
      }
      if (op === 0x30 || op === 0x31 || op === 0x32) {
        if (pc + 1 >= prog.length) throw 9;
        const rel = ((prog[pc] | (prog[pc + 1] << 8)) << 16) >> 16;
        let take = op === 0x30;
        if (!take) {
          if (sp < 1) throw 2;
          const v = stack[--sp];
          take = (v === 0) === (op === 0x31);
        }
        pc += take ? 2 + rel : 2;
        continue;
      }
      switch (op) {
        case 0x00:
          return finish(0);
        case 0x01:
          if (pc >= prog.length) throw 9;
          if (sp === STACK_SIZE) throw 3;
          stack[sp++] = (prog[pc++] << 24) >> 24;
          break;
        case 0x02:
          if (pc + 3 >= prog.length) throw 9;
          if (sp === STACK_SIZE) throw 3;
          stack[sp++] = prog[pc] | (prog[pc + 1] << 8) | (prog[pc + 2] << 16) | (prog[pc + 3] << 24);
          pc += 4;
          break;
        case 0x03:
          if (sp < 1) throw 2;
          sp -= 1;
          break;
        case 0x04:
          if (sp < 1) throw 2;
          if (sp === STACK_SIZE) throw 3;
          stack[sp] = stack[sp - 1];
          sp += 1;
          break;
        case 0x05: {
          if (sp < 2) throw 2;
          const t = stack[sp - 1];
          stack[sp - 1] = stack[sp - 2];
          stack[sp - 2] = t;
          break;
        }
        case 0x06:
          if (sp < 2) throw 2;
          if (sp === STACK_SIZE) throw 3;
          stack[sp] = stack[sp - 2];
          sp += 1;
          break;
        case 0x07: {
          if (sp < 3) throw 2;
          const a = stack[sp - 3];
          stack[sp - 3] = stack[sp - 2];
          stack[sp - 2] = stack[sp - 1];
          stack[sp - 1] = a;
          break;
        }
        case 0x17:
          if (sp < 1) throw 2;
          stack[sp - 1] = -stack[sp - 1] | 0;
          break;
        case 0x1b:
          if (sp < 1) throw 2;
          stack[sp - 1] = ~stack[sp - 1];
          break;
        case 0x33:
          if (pc + 1 >= prog.length) throw 9;
          if (rp === CALL_SIZE) throw 7;
          calls[rp++] = pc + 2;
          pc = prog[pc] | (prog[pc + 1] << 8);
          break;
        case 0x34:
          if (rp === 0) throw 8;
          pc = calls[--rp];
          break;
        case 0x40: {
          if (sp < 1) throw 2;
          const a = stack[sp - 1];
          if (a < 0 || a >= MEM_SIZE) throw 6;
          stack[sp - 1] = mem[a];
          break;
        }
        case 0x41: {
          if (sp < 2) throw 2;
          const a = stack[sp - 1];
          const v = stack[sp - 2];
          if (a < 0 || a >= MEM_SIZE) throw 6;
          mem[a] = v;
          sp -= 2;
          break;
        }
        case 0x50: {
          if (sp < 1) throw 2;
          const s = String(stack[sp - 1]);
          if (olen + s.length > MAX_OUTPUT) throw 11;
          sp -= 1;
          let j = 0;
          while (j < s.length) {
            out[olen++] = s.charCodeAt(j);
            j += 1;
          }
          break;
        }
        case 0x51:
          if (sp < 1) throw 2;
          if (olen + 1 > MAX_OUTPUT) throw 11;
          out[olen++] = stack[--sp] & 255;
          break;
        case 0x52:
          if (sp === STACK_SIZE) throw 3;
          stack[sp++] = ip < input.length ? input[ip++] : -1;
          break;
        case 0x53:
          if (sp < 1) throw 2;
          return finish(stack[--sp] & 255);
        default:
          throw 5;
      }
    }
  } catch (e) {
    if (typeof e !== "number") throw e;
    code = e;
  }
  return finish(code);
}

const IN_DIR = process.env.MAKEFUN_INPUT_DIR ?? "/input";
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
const ids = fs.readdirSync(IN_DIR).sort();
for (let k = 0; k < ids.length; k++) {
  const id = ids[k];
  const progPath = path.join(IN_DIR, id, "program.bin");
  const prog = new Uint8Array(fs.readFileSync(progPath));
  const input = new Uint8Array(fs.readFileSync(path.join(IN_DIR, id, "input.bin")));
  const result = run(prog, input);
  const dir = path.join(OUT_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "exit.txt"), `${result.code}\n`);
  fs.writeFileSync(path.join(dir, "stdout.bin"), result.out);
}
