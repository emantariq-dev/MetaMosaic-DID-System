// truffle/backend/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const jwtLib = require('jsonwebtoken');
const crypto = require('crypto');
const Web3 = require('web3');
const fs = require('fs');
const path = require('path');

const app = express();

/* ========= ENV ========= */
const PORT = process.env.PORT || 4000;
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
const REGISTRY_ADDRESS_OVERRIDE = process.env.REGISTRY_ADDRESS || null;
const VERIFIER_ADDRESS_OVERRIDE = process.env.VERIFIER_ADDRESS || null;
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY || ''; // optional (only needed if you want server to send tx)
const JWT_TTL_SECONDS = Number(process.env.JWT_TTL_SECONDS || 300);

// Dev-friendly secret if not supplied (tokens won’t survive restarts)
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  JWT_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[warn] No JWT_SECRET set. Generated ephemeral secret for this run.');
}

/* ========= APP ========= */
app.use(express.json({ limit: '2mb' }));
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true
}));

/* ========= WEB3 / ARTIFACTS ========= */
const web3 = new Web3(new Web3.providers.HttpProvider(RPC_URL));

function loadArtifact(name) {
  const p = path.join(__dirname, 'artifacts', `${name}.json`);
  if (!fs.existsSync(p)) throw new Error(`Missing artifacts/${name}.json`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Use YOUR real Truffle build artifacts (copied to backend/artifacts)
const regArtifact = loadArtifact('SecureDIDRegistry');
const verArtifact = loadArtifact('Verifier');

async function getDeployedAddress(artifact) {
  const netId = await web3.eth.net.getId();
  const entry = artifact.networks?.[netId];
  return entry?.address || null;
}

async function contracts() {
  const netId = await web3.eth.net.getId();
  const registryAddr = REGISTRY_ADDRESS_OVERRIDE || (await getDeployedAddress(regArtifact));
  const verifierAddr = VERIFIER_ADDRESS_OVERRIDE || (await getDeployedAddress(verArtifact));
  if (!verifierAddr) {
    throw new Error(`Verifier not found for netId=${netId}. Deploy or set VERIFIER_ADDRESS.`);
  }
  // registry may be optional for pure Option-A (off-chain only). We’ll handle null gracefully.
  const registry = registryAddr ? new web3.eth.Contract(regArtifact.abi, registryAddr) : null;
  const verifier = new web3.eth.Contract(verArtifact.abi, verifierAddr);
  return { registry, verifier, netId, registryAddr, verifierAddr };
}

/* ========= ADMIN ACCOUNT (optional, only for sending tx) ========= */
let adminAcct = null;
if (ADMIN_PRIVATE_KEY && ADMIN_PRIVATE_KEY.trim() && ADMIN_PRIVATE_KEY !== '0xYOUR_GANACHE_PRIVATE_KEY') {
  const a = web3.eth.accounts.privateKeyToAccount(ADMIN_PRIVATE_KEY.trim());
  web3.eth.accounts.wallet.add(a);
  web3.eth.defaultAccount = a.address;
  adminAcct = a;
  console.log(`[admin] Using ADMIN_PRIVATE_KEY: ${a.address}`);
} else {
  console.log('[admin] No ADMIN_PRIVATE_KEY provided — server will NOT send on-chain tx; will cache verifications only.');
}

/* ========= IN-MEMORY STATE ========= */
const verifiedWallets = new Map(); // address → true (Option-A cache)
const usedJtis = new Set();        // one-time token protection

/* ========= JWT HELPERS ========= */
function issueJwtFor(address) {
  const jti = uuidv4();
  const payload = {
    sub: web3.utils.toChecksumAddress(address),
    zkp: true,
    verified: true,
    jti
  };
  const token = jwtLib.sign(payload, JWT_SECRET, { expiresIn: JWT_TTL_SECONDS });
  return { token, jti };
}
function verifyJwt(token) {
  return jwtLib.verify(token, JWT_SECRET);
}

/* ========= ROUTES ========= */
app.get('/health', async (_req, res) => {
  try {
    const netId = await web3.eth.net.getId();
    res.json({ ok: true, ts: Date.now(), netId, defaultAccount: web3.eth.defaultAccount || null });
  } catch (e) {
    res.json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * Option-A ZKP verify (OFF-CHAIN against your Verifier.verifyTx).
 * Body:
 * {
 *   "address": "0xUser",
 *   "proof": { "a": [ax,ay], "b": [[bx0,bx1],[by0,by1]], "c": [cx,cy] },
 *   "input": [expectedHash, userAddressHash]  // uint[2]
 * }
 */
app.post('/zkp/verify', async (req, res) => {
  try {
    const { address, proof, input } = req.body || {};
    if (!address || !proof || !proof.a || !proof.b || !proof.c || !input) {
      return res.status(400).json({ ok: false, error: 'Missing address/proof/input' });
    }

    const addr = web3.utils.toChecksumAddress(address);
    const { registry, verifier } = await contracts();

    // ---- EXACTLY MATCH your Solidity signature: verifyTx(Proof, uint[2]) ----
    // Proof is a tuple: ((uint,uint), (uint[2],uint[2]), (uint,uint))
    // web3.js accepts objects/arrays for tuples:
    const proofTuple = {
      a: [proof.a[0], proof.a[1]],
      b: [
        [proof.b[0][0], proof.b[0][1]], // X
        [proof.b[1][0], proof.b[1][1]]  // Y
      ],
      c: [proof.c[0], proof.c[1]]
    };
    const publicInputs = [input[0], input[1]]; // uint[2]

    // OFF-CHAIN verification via eth_call
    // (If ABI mismatches, this call will throw; ensure backend/artifacts/Verifier.json is from THIS contract)
    const valid = await verifier.methods.verifyTx(proofTuple, publicInputs).call();
    if (!valid) {
      return res.json({ ok: false, valid: false, step: 'verifier.verifyTx=false' });
    }

    // Optionally mark on-chain as verified (requires admin account that is an admin in registry)
    let txHash = null;
    if (registry && adminAcct) {
      try {
        const gas = await registry.methods.verifyDID(addr).estimateGas({ from: adminAcct.address }).catch(() => 600000);
        const receipt = await registry.methods.verifyDID(addr).send({ from: adminAcct.address, gas });
        txHash = receipt.transactionHash || null;
      } catch (e) {
        // Not fatal for Option-A; we can still consider backend-verified for JWT issuance
        console.warn('[zkp/verify] Could not call registry.verifyDID (admin missing or not an admin?):', e.message || e);
      }
    } else {
      console.log('[zkp/verify] Skipping on-chain verify (no registry or no admin key).');
    }

    // Cache backend verification
    verifiedWallets.set(addr, true);

    return res.json({ ok: true, valid: true, txHash });
  } catch (err) {
    console.error('/zkp/verify error:', err);
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

/**
 * Issue a short-lived JWT AFTER backend verification.
 * Body: { "address": "0xUser" }
 */
app.post('/token/issue', async (req, res) => {
  try {
    const { address } = req.body || {};
    if (!address) return res.status(400).json({ ok: false, error: 'Missing address' });
    const addr = web3.utils.toChecksumAddress(address);
    if (!verifiedWallets.get(addr)) {
      return res.status(403).json({ ok: false, error: 'Address not verified yet' });
    }
    const { token, jti } = issueJwtFor(addr);
    return res.json({ ok: true, token, jti, expSeconds: JWT_TTL_SECONDS });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

/**
 * Unity validates the token once.
 * Body: { "token": "..." }
 */
app.post('/session/verify', (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ ok: false, error: 'Missing token' });

    const payload = verifyJwt(token);
    if (usedJtis.has(payload.jti)) {
      return res.status(409).json({ ok: false, error: 'Token already used' });
    }
    if (!payload.verified || !payload.zkp) {
      return res.status(401).json({ ok: false, error: 'Invalid claims' });
    }
    usedJtis.add(payload.jti);
    return res.json({ ok: true, sub: payload.sub });
  } catch (_e) {
    return res.status(401).json({ ok: false, error: 'Invalid/expired token' });
  }
});

/* ========= BOOT ========= */
app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
