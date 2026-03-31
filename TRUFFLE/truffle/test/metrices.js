const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const mkdirp = promisify(fs.mkdir);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

const configPath = path.resolve("bench/functions.json");
let CFG;

// ---------- helpers ----------
const clean = (e) => (e && e.message ? e.message : String(e || "")).replace(/[\r\n]+/g, " ");
const nowMs = () => Date.now();
const avg = (a) => (a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0);
const q = (a,p) => {
  if (!a.length) return 0;
  const s = a.slice().sort((x,y)=>x-y);
  const pos = (s.length-1)*p, b = Math.floor(pos), r = pos - b;
  return s[b+1] !== undefined ? s[b] + r*(s[b+1]-s[b]) : s[b];
};
const fmtPct = (x) => `${(x || 0).toFixed(2)}%`;
const fmt1  = (x) => (x===undefined||x===null? "0" : x.toFixed ? x.toFixed(1) : String(x));

// ANSI colors
const C = {
  R: s => `\x1b[31m${s}\x1b[0m`,
  G: s => `\x1b[32m${s}\x1b[0m`,
  Y: s => `\x1b[33m${s}\x1b[0m`,
  C: s => `\x1b[36m${s}\x1b[0m`,
  B: s => `\x1b[1m${s}\x1b[0m`,
  W: s => `\x1b[37m${s}\x1b[0m`
};
const HR = () => console.log("────────────────────────────────────────────────────────────────────");

async function loadCfg() {
  const raw = await readFile(configPath, "utf8");
  CFG = JSON.parse(raw);
  if (!CFG.outputDir) CFG.outputDir = "./bench/out";
  if (!Array.isArray(CFG.scalabilityTrials)) CFG.scalabilityTrials = [];
}
const outFile = (n) => path.join(CFG.outputDir, n);
const ensureOut = async () => mkdirp(CFG.outputDir, { recursive: true });

async function timeTx(txP, confirmations = 0) {
  const t0 = nowMs();
  const receipt = await txP;
  if (confirmations && confirmations > 0) {
    const target = receipt.blockNumber + confirmations;
    let latest;
    do {
      latest = await web3.eth.getBlockNumber();
      if (latest < target) await new Promise((r) => setTimeout(r, 200));
    } while (latest < target);
  }
  const t1 = nowMs();
  return { receipt, wallMs: t1 - t0 };
}

function eventsOf(receipt) {
  if (!receipt || !receipt.logs) return [];
  const names = receipt.logs.map((l)=>l.event||"").filter(Boolean);
  return [...new Set(names)];
}

// Load proof once (paths come from functions.json)
async function loadProofIfNeeded() {
  if (!CFG.useZKP) return null;
  const p = JSON.parse(await readFile(path.resolve(CFG.proofJson), "utf8"));
  const i = JSON.parse(await readFile(path.resolve(CFG.publicInputsJson), "utf8"));
  const proof = p.proof || p;
  const inputs = p.inputs || i.inputs || i;
  const a = [String(proof.a[0]), String(proof.a[1])];
  const b = [[String(proof.b[0][0]), String(proof.b[0][1])],[String(proof.b[1][0]), String(proof.b[1][1])]];
  const c = [String(proof.c[0]), String(proof.c[1])];
  let input = (Array.isArray(inputs) ? inputs.map(String) : []).slice(0, 2);
  while (input.length < 2) input.push("0");
  return { a, b, c, input };
}

// simple async pool for controlled concurrency
async function withPool(limit, tasks) {
  const ret = [];
  let i = 0;
  const run = async () => {
    while (i < tasks.length) {
      const cur = i++;
      ret[cur] = await tasks[cur]();
    }
  };
  const workers = Array.from({ length: Math.max(1, limit) }, () => run());
  await Promise.all(workers);
  return ret;
}

function briefErr(e) {
  const s = (e && (e.reason || e.message)) ? (e.reason || e.message) : String(e || "");
  return s.split("\n")[0].slice(0, 160);
}

contract(" RESULTS METRICS", (accounts) => {
  it("prints compact colored results & writes bench/out/results.json", async function () {
    this.timeout(0);

    await loadCfg();
    await ensureOut();

    const Contract = artifacts.require(CFG.contract);
    const c = await Contract.deployed();

    // pick first admin account quietly
    let admin = accounts[0];
    for (const a of accounts) { try { if (await c.isAdmin(a)) { admin = a; break; } } catch (_) {} }

    const usersPool = accounts.filter(a => a !== admin); // Ganache-unlocked only
    const requiredDeposit = await c.requiredDeposit();
    const proof = await loadProofIfNeeded();
    const netId = await web3.eth.net.getId();
    const frontendOverhead = Number(CFG.frontendOverheadMs || 0);

    const has = (fn) => typeof c[fn] === "function";
    const lifecycleSupport = {
      create: has(CFG.createDID),
      verify: CFG.useZKP ? has("verifyDIDWithZKP") : has(CFG.verify),
      revoke: has(CFG.revoke),
      reverify: false,
      refund: true
    };

    const store = {
      ops: { create:[], verify:[], revoke:[] },
      sec: { duplicateCreateAttempts:0, duplicateCreateBlocked:0, verifyAttempts:0, verifySuccess:0, refundWei:[] },
      reliability: { intendedTotal:0, ok:0, fail:0 },
      scalability: [],
      scErrorsSample: []
    };

    async function doCreate(u, confirmations = CFG.confirmations) {
      const tx = await timeTx(c[CFG.createDID]({ from: u, value: requiredDeposit }), confirmations);
      store.ops.create.push({ gas: tx.receipt.gasUsed, ms: tx.wallMs, ok: true, ev: eventsOf(tx.receipt) });
      store.reliability.intendedTotal++; store.reliability.ok++;
    }
    async function doVerify(u, confirmations = CFG.confirmations) {
      const txP = CFG.useZKP
        ? c.verifyDIDWithZKP(u, proof.a, proof.b, proof.c, proof.input, { from: admin })
        : c[CFG.verify](u, { from: admin });
      const before = BigInt(await web3.eth.getBalance(u));
      const tx = await timeTx(txP, confirmations);
      const after = BigInt(await web3.eth.getBalance(u));
      store.sec.refundWei.push(Number((after - before).toString()));
      store.ops.verify.push({ gas: tx.receipt.gasUsed, ms: tx.wallMs, ok: true });
      store.reliability.intendedTotal++; store.reliability.ok++;
      store.sec.verifySuccess++;
    }
    async function doRevoke(u, confirmations = CFG.confirmations) {
      const tx = await timeTx(c[CFG.revoke](u, { from: admin }), confirmations);
      store.ops.revoke.push({ gas: tx.receipt.gasUsed, ms: tx.wallMs, ok: true });
      store.reliability.intendedTotal++; store.reliability.ok++;
    }

    // ---------------- Baseline (sequential correctness) ----------------
    const baselineUsers = Math.max(1, Math.min(Number(CFG.baselineUsers || (CFG.trials || 10)), usersPool.length));
    const baselineStart = nowMs();
    const N = baselineUsers;
    const users = usersPool.slice(0, N);
    for (let i=0;i<N;i++){
      const u = users[i];
      try { await doCreate(u); } catch(e){ store.ops.create.push({ gas:0, ms:0, ok:false, err:clean(e) }); store.reliability.intendedTotal++; store.reliability.fail++; }
      store.sec.duplicateCreateAttempts++;
      try { await timeTx(c[CFG.createDID]({ from:u, value: requiredDeposit })); store.ops.create.push({gas:0,ms:0,ok:true,note:"dup-should-fail"}); }
      catch { store.sec.duplicateCreateBlocked++; }
      store.sec.verifyAttempts++;
      try { await doVerify(u); } catch(e){ store.ops.verify.push({ gas:0,ms:0,ok:false,err:clean(e)}); store.reliability.intendedTotal++; store.reliability.fail++; }
      try { await doRevoke(u); } catch(e){ store.ops.revoke.push({ gas:0,ms:0,ok:false,err:clean(e)}); store.reliability.intendedTotal++; store.reliability.fail++; }
    }
    const baselineElapsedMs = nowMs() - baselineStart;
    const baselineOps = ["create","verify","revoke"].map(k=>store.ops[k].length).reduce((a,b)=>a+b,0);
    const baselineTpsApprox = baselineOps ? (baselineOps / (baselineElapsedMs/1000)) : 0;

    // ---------------- Scalable, concurrent runs (auto-shrink to available accounts) ----------------
    const scenarioDefs = CFG.scalabilityTrials.map(x => {
      const globalConc = Number(CFG.scalabilityConcurrency || 10);
      if (typeof x === "number") return { trials: x, concurrency: globalConc };
      const r = { trials: Number(x.trials || 0), concurrency: Number(x.concurrency || globalConc) };
      if (x.confirmationsDuringScale !== undefined) r.confirmationsDuringScale = Number(x.confirmationsDuringScale);
      return r;
    });

    const totalRequestedOps = scenarioDefs.reduce((a,x)=> a + (x.trials||0), 0);

    // Use ONLY Ganache-provided unlocked accounts, excluding those used in baseline
    const unlockedUsers = usersPool.slice(N);

    // Auto-truncate scenarios if we don't have enough fresh addresses
    let capacity = unlockedUsers.length;
    const adjustedScenarios = [];
    for (const s of scenarioDefs) {
      if (!capacity) break;
      const req = Math.max(0, Number(s.trials || 0));
      const run = Math.min(req, capacity);
      if (run > 0) {
        adjustedScenarios.push({ ...s, trials: run });
        capacity -= run;
      }
    }
    if (adjustedScenarios.length === 0) {
      console.log(C.Y("[WARN] No free unlocked accounts left for scalability; skipping scalability phase."));
    }
    if (unlockedUsers.length < totalRequestedOps) {
      console.log(C.Y(`[WARN] Not enough unlocked accounts for requested scalability load. Requested ${totalRequestedOps}, available ${unlockedUsers.length}. Trials were auto-truncated.`));
    }

    let freshIdx = 0;
    const nextFreshUser = () => unlockedUsers[freshIdx++];  // no wrap-around: one unique user per lifecycle

    const makeLifecycleTask = (confirmations) => async () => {
      const u = nextFreshUser();
      let okC=false, okV=false, okR=false;
      let errC="", errV="", errR="";

      try { await timeTx(c[CFG.createDID]({from:u,value:requiredDeposit}), confirmations); okC=true; }
      catch(e){ errC = briefErr(e); }

      try {
        const txP = CFG.useZKP ? c.verifyDIDWithZKP(u, proof.a, proof.b, proof.c, proof.input, {from:admin})
                               : c[CFG.verify](u,{from:admin});
        await timeTx(txP, confirmations); okV=true;
      } catch(e){ errV = briefErr(e); }

      try { await timeTx(c[CFG.revoke](u,{from:admin}), confirmations); okR=true; }
      catch(e){ errR = briefErr(e); }

      const ret = { okC, okV, okR };
      if ((!okC || !okV || !okR) && store.scErrorsSample.length < 8) {
        store.scErrorsSample.push({ u, errC, errV, errR });
      }
      return ret;
    };

    for (const scenario of adjustedScenarios) {
      const totalOps = Math.max(0, Number(scenario.trials || 0));
      if (!totalOps) continue;

      const confirmationsDuringScale =
        scenario.confirmationsDuringScale !== undefined ? scenario.confirmationsDuringScale : 0;

      const tasks = Array.from({ length: totalOps }, () => makeLifecycleTask(confirmationsDuringScale));

      const t0 = nowMs();
      const results = await withPool(Math.max(1, scenario.concurrency), tasks);
      const elapsed = nowMs() - t0;

      const minedCreates = results.filter(r => r.okC).length;
      const minedVerifies = results.filter(r => r.okV).length;
      const minedRevokes = results.filter(r => r.okR).length;
      const minedOps = minedCreates + minedVerifies + minedRevokes;

      const tpsApprox = minedOps ? (minedOps / (elapsed/1000)) : 0;

      store.scalability.push({
        trials: totalOps,
        concurrency: scenario.concurrency,
        confirmations: confirmationsDuringScale,
        tpsApprox,
        minedOps,
        minedCreates,
        minedVerifies,
        minedRevokes,
        avgMsCreate: 0, avgMsVerify: 0, avgMsRevoke: 0,
        avgGasCreate: 0, avgGasVerify: 0, avgGasRevoke: 0
      });
    }

    // ---------------- aggregate ----------------
    const ag = (samples) => ({
      count: samples.length,
      success: samples.filter(s=>s.ok).length,
      successRatePct: samples.length ? (samples.filter(s=>s.ok).length / samples.length * 100) : 0,
      chainLatencyMs: { avg: avg(samples.map(s=>s.ms||0)), p50: q(samples.map(s=>s.ms||0),0.5), p90: q(samples.map(s=>s.ms||0),0.9) },
      avgGas: avg(samples.map(s=>s.gas||0)), p50Gas: q(samples.map(s=>s.gas||0),0.5), p90Gas: q(samples.map(s=>s.gas||0),0.9)
    });
    const agg = { create: ag(store.ops.create), verify: ag(store.ops.verify), revoke: ag(store.ops.revoke) };

    const duplicatePreventionPct = store.sec.duplicateCreateAttempts
      ? (store.sec.duplicateCreateBlocked/store.sec.duplicateCreateAttempts*100) : 0;
    const verificationAccuracyPct = store.sec.verifyAttempts ? (store.sec.verifySuccess/store.sec.verifyAttempts*100) : 0;

    const expectedWei = Number((await c.requiredDeposit()).toString());
    const depositRefund = {
      expectedWei,
      avgWei: avg(store.sec.refundWei),
      minWei: store.sec.refundWei.length ? Math.min(...store.sec.refundWei) : 0,
      maxWei: store.sec.refundWei.length ? Math.max(...store.sec.refundWei) : 0,
      accuracyPct: store.sec.refundWei.length
        ? (store.sec.refundWei.filter(v=>v===expectedWei).length/store.sec.refundWei.length*100) : 0
    };

    const revocationEfficiency = {
      msAvg: agg.revoke.chainLatencyMs.avg, msP50: agg.revoke.chainLatencyMs.p50, msP90: agg.revoke.chainLatencyMs.p90,
      gasAvg: agg.revoke.avgGas, gasP50: agg.revoke.p50Gas, gasP90: agg.revoke.p90Gas
    };

    const verificationLatency = {
      chainMs: agg.verify.chainLatencyMs,
      endToEndMs: {
        avg: agg.verify.chainLatencyMs.avg + frontendOverhead,
        p50: agg.verify.chainLatencyMs.p50 + frontendOverhead,
        p90: agg.verify.chainLatencyMs.p90 + frontendOverhead
      }
    };

    const transactionReliabilityPct = store.reliability.intendedTotal
      ? (store.reliability.ok/store.reliability.intendedTotal*100) : 0;

    const totalTransitions = agg.create.count + agg.verify.count + agg.revoke.count;
    const adminDecentralizationIdxPct = totalTransitions ? (agg.create.count/totalTransitions*100) : 0;

    let bestSc=null; for (const s of store.scalability){ if(!bestSc || s.tpsApprox>bestSc.tpsApprox) bestSc=s; }

    // ---------------- print ----------------
    const title = C.B(C.C(" RESULTS — METRICS "));
    HR(); console.log(title); HR();
    console.log(`${C.W("Network")}     : ${C.B(netId)}   ${C.W("| Trials")}: ${C.B(N)}   ${C.W("| VerifyFn")}: ${C.B(CFG.useZKP ? "verifyDIDWithZKP" : CFG.verify)}`);
    HR();

    console.log(C.C("Performance (Latency, ms) & Success"));
    console.log("Op      | Success    |  Avg   P50   P90 ");
    console.log("--------+------------+-------------------");
    for (const [op,x] of Object.entries(agg)) {
      const color = x.successRatePct===100 ? C.G : (x.successRatePct>=95 ? C.Y : C.R);
      const row = [
        op.padEnd(7),
        color(`${x.success}/${x.count} (${fmtPct(x.successRatePct)})`).padEnd(12),
        `${fmt1(x.chainLatencyMs.avg).padStart(5)}  ${fmt1(x.chainLatencyMs.p50).padStart(4)}  ${fmt1(x.chainLatencyMs.p90).padStart(4)}`
      ].join(" | ");
      console.log(row);
    }
    HR();

    console.log(C.C("Security Performance"));
    console.log(`Verification Accuracy   : ${C.G(fmtPct(verificationAccuracyPct))}`);
    console.log(`Duplicate Prevention    : ${C.G(fmtPct(duplicatePreventionPct))}`);
    console.log(`Deposit Refund Accuracy : ${C.G(fmtPct(depositRefund.accuracyPct))}  (expected=${depositRefund.expectedWei} wei)`);

    HR();
    console.log(C.C("Reliability & Governance"));
    console.log(`Transaction Reliability : ${C.G(fmtPct(transactionReliabilityPct))}`);
    console.log(`Admin Decentralization  : ${C.Y(fmtPct(adminDecentralizationIdxPct))}`);

    HR();
    console.log(C.C("Revocation Efficiency"));
    console.log(`Latency (ms)            : avg=${fmt1(revocationEfficiency.msAvg)}  p50=${fmt1(revocationEfficiency.msP50)}  p90=${fmt1(revocationEfficiency.msP90)}`);
    console.log(`Gas (units)             : avg=${fmt1(revocationEfficiency.gasAvg)}  p50=${fmt1(revocationEfficiency.p50Gas)}  p90=${fmt1(revocationEfficiency.p90Gas)}`);

    HR();
    console.log(C.C("Scalability"));
    console.log(`Baseline TPS            : ${C.B(fmt1(baselineTpsApprox))}`);
    if (store.scalability.length){
      console.log("Trials (conc, conf)  →  TPS   | minedOps (C/V/R)");
      for (const sc of store.scalability) {
        console.log(
          `${String(sc.trials).padStart(5)} ` +
          `(c=${String(sc.concurrency).padStart(3)}, k=${String(sc.confirmations).padStart(1)})  →  ` +
          `${fmt1(sc.tpsApprox).padStart(5)} | ${sc.minedOps} (${sc.minedCreates}/${sc.minedVerifies}/${sc.minedRevokes})`
        );
      }
      console.log(`Best TPS                : ${C.B(bestSc ? `${fmt1(bestSc.tpsApprox)} (trials=${bestSc.trials}, c=${bestSc.concurrency})` : "N/A")}`);
    } 

    if (store.scErrorsSample.length) {
      HR();
      console.log(C.Y("Scalability error samples (first few):"));
      for (const e of store.scErrorsSample) {
        console.log(`- u=${e.u}  create: ${e.errC || "ok"} | verify: ${e.errV || "ok"} | revoke: ${e.errR || "ok"}`);
      }
    }
    HR();

    const results = {
      meta: { networkId: netId, contract: CFG.contract, verifyFn: CFG.useZKP ? "verifyDIDWithZKP" : CFG.verify,
              trialsRequested: CFG.trials, confirmations: CFG.confirmations, timestamp: new Date().toISOString() },
      lifecycleSupport,
      aggregates: agg,
      verificationLatency,
      verificationAccuracyPct,
      duplicatePreventionPct,
      depositRefund,
      revocationEfficiency,
      scalability: store.scalability,
      transactionReliabilityPct,
      adminDecentralizationIdxPct,
      baseline: { elapsedMs: baselineElapsedMs, ops: baselineOps, tpsApprox: baselineTpsApprox },
      scalabilityErrorsSample: store.scErrorsSample
    };
    await writeFile(outFile("results.json"), JSON.stringify(results, null, 2), "utf8");
  });
});
