#!/usr/bin/env node
/* Encrypt the bank for a public host.
   Derives an AES-256-GCM key from a passphrase with PBKDF2-SHA256, then writes
   salt || iv || ciphertext || tag. Run locally: the passphrase is never stored,
   never committed, and never leaves this machine. */
const fs = require("fs"), crypto = require("crypto"), path = require("path");

const ITER = 600000, KEYLEN = 32, SALTLEN = 16, IVLEN = 12;
const ROOT = path.join(__dirname, "..");
const FILES = [["bank.js", "bank.enc"], ["reference.js", "reference.enc"]];

let piped = null;
const CTRL = { ENTER: "\r", NEWLINE: "\n", EOT: "\u0004", ETX: "\u0003", DEL: "\u007f" };

function ask(prompt) {
  return new Promise(res => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    if (!stdin.isTTY) {                               // piped input: one line per prompt
      if (piped === null) {
        let d = "";
        stdin.setEncoding("utf8");
        stdin.on("data", c => { d += c; });
        stdin.on("end", () => { piped = d.split("\n"); res((piped.shift() || "").trim()); });
        return;
      }
      return res((piped.shift() || "").trim());
    }
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
    let buf = "";
    const on = c => {
      if (c === CTRL.ENTER || c === CTRL.NEWLINE || c === CTRL.EOT) {
        stdin.setRawMode(false); stdin.pause(); stdin.removeListener("data", on);
        process.stdout.write("\n");
        return res(buf);
      }
      if (c === CTRL.ETX) { process.stdout.write("\n"); process.exit(1); }
      if (c === CTRL.DEL) { buf = buf.slice(0, -1); return; }
      buf += c;
    };
    stdin.on("data", on);
  });
}

(async () => {
  const pass = await ask("Passphrase: ");
  if (pass.length < 12) {
    console.error("\nToo short. This passphrase is the only thing between a public URL and the");
    console.error("guide text, and it can be brute forced offline against the downloaded file.");
    console.error("Use at least 12 characters - several unrelated words is ideal.");
    process.exit(1);
  }
  const again = await ask("Again: ");
  if (pass !== again) { console.error("\nThey do not match."); process.exit(1); }

  const salt = crypto.randomBytes(SALTLEN);
  const key = crypto.pbkdf2Sync(pass, salt, ITER, KEYLEN, "sha256");
  console.log("");
  for (const [src, out] of FILES) {
    const srcPath = path.join(ROOT, src);
    if (!fs.existsSync(srcPath)) {
      console.error(`Missing ${src}. Rebuild it with tools/run.sh first.`);
      process.exit(1);
    }
    const plain = fs.readFileSync(srcPath);
    const iv = crypto.randomBytes(IVLEN);
    const c = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([c.update(plain), c.final()]);
    const blob = Buffer.concat([salt, iv, ct, c.getAuthTag()]);
    fs.writeFileSync(path.join(ROOT, out), blob);
    const kb = n => (n / 1024).toFixed(0).padStart(5);
    console.log(`  ${src.padEnd(14)}${kb(plain.length)} KB  ->  ${out.padEnd(14)}${kb(blob.length)} KB`);
  }
  console.log(`\nDone. PBKDF2-SHA256 at ${ITER.toLocaleString()} iterations, AES-256-GCM.`);
  console.log("Commit the .enc files. bank.js and reference.js stay gitignored and local.");
})();
