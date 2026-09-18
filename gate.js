/* Unlock gate for the public host.
   bank.enc and reference.enc are AES-256-GCM ciphertext. The key is derived from a
   passphrase with PBKDF2-SHA256 at 600k iterations; nothing here validates a password
   against a stored value, because there is no stored value - the wrong passphrase simply
   fails to decrypt. "Remember this device" keeps the derived key in this browser so the
   passphrase is only typed once per device. */

const ITER = 600000, SALTLEN = 16, IVLEN = 12, LS_KEY = "evp-device-key";

const gateEl = () => document.getElementById("gate");
const msg = (text, cls) => {
  const m = document.getElementById("gmsg");
  m.className = cls || "mut";
  m.textContent = text;
};

async function deriveKey(pass, salt) {
  const mat = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass),
    "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256"},
    mat, {name: "AES-GCM", length: 256}, true, ["decrypt"]);
}

async function fetchBlob(name) {
  // no-cache revalidates with the server and reuses the bytes when the ETag matches.
  // force-cache would happily serve a bank encrypted under a passphrase you have since
  // rotated, so the old passphrase would keep working on that device.
  const r = await fetch(name, {cache: "no-cache"});
  if (!r.ok) throw new Error(`${name} is missing (${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}

async function decrypt(blob, key) {
  const iv = blob.slice(SALTLEN, SALTLEN + IVLEN);
  const body = blob.slice(SALTLEN + IVLEN);
  const plain = await crypto.subtle.decrypt({name: "AES-GCM", iv}, key, body);
  return new TextDecoder().decode(plain);
}

function runScript(source) {
  // A classic script, so the bank's top-level bindings land in the same scope app.js reads.
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(new Blob([source], {type: "text/javascript"}));
    const s = document.createElement("script");
    s.src = url;
    s.onload = () => { URL.revokeObjectURL(url); res(); };
    s.onerror = () => { URL.revokeObjectURL(url); rej(new Error("script failed to run")); };
    document.head.appendChild(s);
  });
}

/* reference.enc is fetched only when something asks for it, so an ordinary drilling
   session never downloads it. app.js calls this through window.__loadReference. */
function makeReferenceLoader(key) {
  let started = null;
  return () => started || (started = (async () => {
    try { await runScript(await decrypt(await fetchBlob("reference.enc"), key)); return true; }
    catch (e) { return false; }
  })());
}

async function unlock(pass, remember) {
  msg("Deriving key…", "mut");
  const blob = await fetchBlob("bank.enc");
  const salt = blob.slice(0, SALTLEN);
  const key = await deriveKey(pass, salt);
  let source;
  try {
    source = await decrypt(blob, key);
  } catch (e) {
    throw new Error("wrong passphrase");     // GCM tag mismatch: the only failure mode
  }
  if (remember) {
    try {
      const raw = await crypto.subtle.exportKey("raw", key);
      localStorage.setItem(LS_KEY, btoa(String.fromCharCode(...new Uint8Array(raw))));
    } catch (e) { /* private window, or storage blocked: stay unlocked for this visit */ }
  }
  await start(source, key);
}

async function start(bankSource, key) {
  msg("Loading the bank…", "mut");
  await runScript(bankSource);
  window.__loadReference = makeReferenceLoader(key);
  window.__forgetDevice = () => { try { localStorage.removeItem(LS_KEY); } catch (e) {} };
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "app.js"; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  gateEl().hidden = true;
  document.getElementById("app").hidden = false;
}

async function tryRemembered() {
  let stored = null;
  try { stored = localStorage.getItem(LS_KEY); } catch (e) { return false; }
  if (!stored) return false;
  try {
    const raw = Uint8Array.from(atob(stored), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", true, ["decrypt"]);
    const source = await decrypt(await fetchBlob("bank.enc"), key);
    await start(source, key);
    return true;
  } catch (e) {
    // The bank was re-encrypted under a new passphrase, or the stored key is corrupt.
    try { localStorage.removeItem(LS_KEY); } catch (e2) {}
    return false;
  }
}

(async () => {
  if (!window.crypto || !crypto.subtle) {
    msg("This browser cannot decrypt the bank. It needs a secure context — https, or localhost.", "bad");
    return;
  }
  if (await tryRemembered()) return;
  gateEl().hidden = false;
  const form = document.getElementById("gform");
  const pw = document.getElementById("gpass");
  pw.focus();
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = document.getElementById("gbtn");
    btn.disabled = pw.disabled = true;
    try {
      await unlock(pw.value, document.getElementById("gremember").checked);
    } catch (err) {
      msg(err.message === "wrong passphrase"
        ? "That passphrase does not decrypt the bank."
        : err.message, "bad");
      btn.disabled = pw.disabled = false;
      pw.select();
    }
  };
})();
