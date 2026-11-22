// Tiny stack VM for make.fun's ISA v1, byte-exact with the reference vm.mjs.
// Run: node main.ts (reads /input, writes /output; see MAKEFUN_*_DIR).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function run(p: Uint8Array, inp: Uint8Array): { out: Uint8Array; code: number } {
  const n = p.length;
  const D = new Int32Array(256);
  let sp = 0;
  const C = new Int32Array(64);
  let cp = 0;
  const M = new Int32Array(256);
  const out = new Uint8Array(65536);
  let ol = 0;
  let ip = 0;
  let pc = 0;
  let steps = 0;
  const done = (code: number): { out: Uint8Array; code: number } => ({ out: out.subarray(0, ol), code });
  for (;;) {
    if (steps === 1000000) return done(10);
    if (pc < 0 || pc >= n) return done(9);
    const op = p[pc];
    steps++;
    switch (op) {
      case 0x00:
        return done(0);
      case 0x01:
        if (pc + 1 >= n) return done(9);
        if (sp === 256) return done(3);
        D[sp++] = (p[pc + 1] << 24) >> 24;
        pc += 2;
        break;
      case 0x02:
        if (pc + 4 >= n) return done(9);
        if (sp === 256) return done(3);
        D[sp++] = p[pc + 1] | (p[pc + 2] << 8) | (p[pc + 3] << 16) | (p[pc + 4] << 24);
        pc += 5;
        break;
      case 0x03:
        if (sp < 1) return done(2);
        sp--;
        pc++;
        break;
      case 0x04:
        if (sp < 1) return done(2);
        if (sp === 256) return done(3);
        D[sp] = D[sp - 1];
        sp++;
        pc++;
        break;
      case 0x05: {
        if (sp < 2) return done(2);
        const t = D[sp - 1];
        D[sp - 1] = D[sp - 2];
        D[sp - 2] = t;
        pc++;
        break;
      }
      case 0x06:
        if (sp < 2) return done(2);
        if (sp === 256) return done(3);
        D[sp] = D[sp - 2];
        sp++;
        pc++;
        break;
      case 0x07: {
        if (sp < 3) return done(2);
        const a = D[sp - 3];
        D[sp - 3] = D[sp - 2];
        D[sp - 2] = D[sp - 1];
        D[sp - 1] = a;
        pc++;
        break;
      }
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
      case 0x20: case 0x21: case 0x22: {
        if (sp < 2) return done(2);
        const b = D[sp - 1];
        const a = D[sp - 2];
        let r: number;
        if (op === 0x10) r = (a + b) | 0;
        else if (op === 0x11) r = (a - b) | 0;
        else if (op === 0x12) r = Math.imul(a, b);
        else if (op === 0x13) {
          if (b === 0) return done(4);
          r = a === -2147483648 && b === -1 ? a : (a / b) | 0;
        } else if (op === 0x14) {
          if (b === 0) return done(4);
          r = b === -1 ? 0 : (a % b) | 0;
        } else if (op === 0x15) {
          if (b === 0) return done(4);
          r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
        } else if (op === 0x16) {
          if (b === 0) return done(4);
          r = ((a >>> 0) % (b >>> 0)) | 0;
        } else if (op === 0x18) r = a & b;
        else if (op === 0x19) r = a | b;
        else if (op === 0x1a) r = a ^ b;
        else if (op === 0x1c) r = a << (b & 31);
        else if (op === 0x1d) r = a >> (b & 31);
        else if (op === 0x1e) r = (a >>> (b & 31)) | 0;
        else if (op === 0x20) r = a === b ? 1 : 0;
        else if (op === 0x21) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        sp -= 2;
        D[sp++] = r;
        pc++;
        break;
      }
      case 0x17:
        if (sp < 1) return done(2);
        D[sp - 1] = (-D[sp - 1]) | 0;
        pc++;
        break;
      case 0x1b:
        if (sp < 1) return done(2);
        D[sp - 1] = ~D[sp - 1];
        pc++;
        break;
      case 0x30: case 0x31: case 0x32: {
        if (pc + 2 >= n) return done(9);
        const rel = ((p[pc + 1] | (p[pc + 2] << 8)) << 16) >> 16;
        let take = true;
        if (op !== 0x30) {
          if (sp < 1) return done(2);
          const v = D[--sp];
          take = op === 0x31 ? v === 0 : v !== 0;
        }
        pc = take ? pc + 3 + rel : pc + 3;
        break;
      }
      case 0x33:
        if (pc + 2 >= n) return done(9);
        if (cp === 64) return done(7);
        C[cp++] = pc + 3;
        pc = p[pc + 1] | (p[pc + 2] << 8);
        break;
      case 0x34:
        if (cp === 0) return done(8);
        pc = C[--cp];
        break;
      case 0x40: {
        if (sp < 1) return done(2);
        const a = D[sp - 1];
        if (a < 0 || a >= 256) return done(6);
        D[sp - 1] = M[a];
        pc++;
        break;
      }
      case 0x41: {
        if (sp < 2) return done(2);
        const a = D[sp - 1];
        const v = D[sp - 2];
        if (a < 0 || a >= 256) return done(6);
        M[a] = v;
        sp -= 2;
        pc++;
        break;
      }
      case 0x50: {
        if (sp < 1) return done(2);
        const s = String(D[sp - 1]);
        if (ol + s.length > 65536) return done(11);
        sp--;
        for (let i = 0; i < s.length; i++) out[ol++] = s.charCodeAt(i);
        pc++;
        break;
      }
      case 0x51:
        if (sp < 1) return done(2);
        if (ol + 1 > 65536) return done(11);
        out[ol++] = D[--sp] & 255;
        pc++;
        break;
      case 0x52:
        if (sp === 256) return done(3);
        D[sp++] = ip < inp.length ? inp[ip++] : -1;
        pc++;
        break;
      case 0x53:
        if (sp < 1) return done(2);
        return done(D[--sp] & 255);
      default:
        return done(5);
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const r = run(new Uint8Array(readFileSync(join(I, id, 'program.bin'))), new Uint8Array(readFileSync(join(I, id, 'input.bin'))));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.out);
  writeFileSync(join(O, id, 'exit.txt'), `${r.code}\n`);
}
