// scripts/metrics.js
// Run with: truffle exec scripts/metrics.js

const SecureDIDRegistry = artifacts.require("SecureDIDRegistry");
const Verifier = artifacts.require("Verifier");

module.exports = async function (callback) {
  try {
    const accounts = await web3.eth.getAccounts();
    const [admin, user1, user2, user3, user4] = accounts;

    const requiredDeposit = web3.utils.toWei("0.01", "ether");

    // ---------------------------
    // 1. Deploy base contracts
    // ---------------------------
    const verifier = await Verifier.new({ from: admin });
    const registry = await SecureDIDRegistry.new(verifier.address, {
      from: admin,
    });

    // Helper to time a transaction in milliseconds
    async function timeTx(promise) {
      const start = Date.now();
      const tx = await promise;
      const end = Date.now();
      const elapsedMs = end - start;
      return { tx, elapsedMs };
    }

    const gasMetrics = {};
    const timeMetricsMs = {};

    // ---------------------------
    // 2. Measure gas + time
    // ---------------------------

    // createDID
    let { tx, elapsedMs } = await timeTx(
      registry.createDID({ from: user1, value: requiredDeposit })
    );
    gasMetrics.createDID = Number(tx.receipt.gasUsed);
    timeMetricsMs.createDID = elapsedMs;

    // verifyDID (admin)
    ({ tx, elapsedMs } = await timeTx(
      registry.verifyDID(user1, { from: admin })
    ));
    gasMetrics.verifyDID = Number(tx.receipt.gasUsed);
    timeMetricsMs.verifyDID = elapsedMs;

    // revokeDID
    ({ tx, elapsedMs } = await timeTx(
      registry.revokeDID(user1, { from: admin })
    ));
    gasMetrics.revokeDID = Number(tx.receipt.gasUsed);
    timeMetricsMs.revokeDID = elapsedMs;

    // Create two more DIDs for batch ops
    await registry.createDID({ from: user2, value: requiredDeposit });
    await registry.createDID({ from: user3, value: requiredDeposit });

    // batchVerifyDID
    ({ tx, elapsedMs } = await timeTx(
      registry.batchVerifyDID([user2, user3], { from: admin })
    ));
    gasMetrics.batchVerifyDID = Number(tx.receipt.gasUsed);
    timeMetricsMs.batchVerifyDID = elapsedMs;

    // batchRevokeDID
    ({ tx, elapsedMs } = await timeTx(
      registry.batchRevokeDID([user2, user3], { from: admin })
    ));
    gasMetrics.batchRevokeDID = Number(tx.receipt.gasUsed);
    timeMetricsMs.batchRevokeDID = elapsedMs;

    // addNewAdmin
    ({ tx, elapsedMs } = await timeTx(
      registry.addNewAdmin(user4, { from: admin })
    ));
    gasMetrics.addNewAdmin = Number(tx.receipt.gasUsed);
    timeMetricsMs.addNewAdmin = elapsedMs;

    // removeAdmin
    ({ tx, elapsedMs } = await timeTx(
      registry.removeAdmin(user4, { from: admin })
    ));
    gasMetrics.removeAdmin = Number(tx.receipt.gasUsed);
    timeMetricsMs.removeAdmin = elapsedMs;

    // ---------------------------
    // 3. Global stats from contract
    // ---------------------------
    const stats = await registry.getGlobalStats();

    const globalStats = {
      totalDIDsCreated: Number(stats[0]),
      totalDIDsVerified: Number(stats[1]),
      totalDIDsRevoked: Number(stats[2]),
      totalTransactions: Number(stats[3]),
      successfulTransactions: Number(stats[4]),
      failedTransactions: Number(stats[5]),
    };

    // Derived “detection-like” metrics
    let detectionMetrics = {};
    if (globalStats.totalDIDsCreated > 0) {
      detectionMetrics.creationSuccessRate =
        (globalStats.totalDIDsVerified / globalStats.totalDIDsCreated) * 100;
      detectionMetrics.revocationRate =
        (globalStats.totalDIDsRevoked / globalStats.totalDIDsCreated) * 100;
    } else {
      detectionMetrics.creationSuccessRate = 0;
      detectionMetrics.revocationRate = 0;
    }

    if (globalStats.totalTransactions > 0) {
      detectionMetrics.overallSuccessRate =
        (globalStats.successfulTransactions /
          globalStats.totalTransactions) *
        100;
      detectionMetrics.overallFailureRate =
        (globalStats.failedTransactions /
          globalStats.totalTransactions) *
        100;
    } else {
      detectionMetrics.overallSuccessRate = 0;
      detectionMetrics.overallFailureRate = 0;
    }

    // ---------------------------
    // 4. Throughput / Latency benchmark (fixed)
    // ---------------------------
    async function benchmarkCreateDID(load) {
      // new fresh registry for this benchmark
      const v = await Verifier.new({ from: admin });
      const r = await SecureDIDRegistry.new(v.address, { from: admin });

      // we can only create at most (accounts.length - 1) DIDs
      const maxUsers = Math.min(load, accounts.length - 1);

      const start = Date.now();
      for (let i = 0; i < maxUsers; i++) {
        const fromAcc = accounts[i + 1]; // unique account each time, skip admin
        await r.createDID({ from: fromAcc, value: requiredDeposit });
      }
      const end = Date.now();

      const totalMs = end - start;
      const totalSec = totalMs / 1000;

      const effectiveLoad = maxUsers === 0 ? 1 : maxUsers;
      const tps = effectiveLoad / totalSec;
      const latencyMs = totalMs / effectiveLoad;

      return { tps, latencyMs };
    }

    const loads = [1, 2, 3, 4, 5, 6, 7, 8, 9]; // avoid > available accounts
    const throughput = [];
    const latency = [];

    for (let l of loads) {
      const { tps, latencyMs } = await benchmarkCreateDID(l);
      throughput.push(tps);
      latency.push(latencyMs);
    }

    const scalabilityMetrics = {
      loads,
      throughput,   // transactions per second
      latencyMs: latency,
    };

    // ---------------------------
    // 5. Print final METRICS JSON
    // ---------------------------
    const result = {
      gasMetrics,
      timeMetricsMs,
      globalStats,
      detectionMetrics,
      scalabilityMetrics,
    };

    console.log("=== METRICS ===");
    console.log(JSON.stringify(result, null, 2));

    callback();
  } catch (err) {
    console.error(err);
    callback(err);
  }
};