// test/gasMetrics.test.js
const SecureDIDRegistry = artifacts.require("SecureDIDRegistry");
const Verifier = artifacts.require("Verifier"); // your real verifier

contract("Gas metrics – SecureDIDRegistry", (accounts) => {
  const [admin, user1, user2, user3] = accounts;
  let registry;
  let requiredDeposit;

  before(async () => {
    const verifier = await Verifier.new(); // adjust ctor args if needed
    registry = await SecureDIDRegistry.new(verifier.address, { from: admin });

    // make sure it matches your constant in the contract
    requiredDeposit = web3.utils.toWei("0.01", "ether");
  });

  it("collects gas usage for main functions", async () => {
    const results = {};

    // createDID
    let tx = await registry.createDID({ from: user1, value: requiredDeposit });
    results.createDID = Number(tx.receipt.gasUsed);

    // verifyDID
    tx = await registry.verifyDID(user1, { from: admin });
    results.verifyDID = Number(tx.receipt.gasUsed);

    // revokeDID
    tx = await registry.revokeDID(user1, { from: admin });
    results.revokeDID = Number(tx.receipt.gasUsed);

    // create two more DIDs for batch ops
    await registry.createDID({ from: user2, value: requiredDeposit });
    await registry.createDID({ from: user3, value: requiredDeposit });

    // batchVerifyDID
    tx = await registry.batchVerifyDID([user2, user3], { from: admin });
    results.batchVerifyDID = Number(tx.receipt.gasUsed);

    // batchRevokeDID
    tx = await registry.batchRevokeDID([user2, user3], { from: admin });
    results.batchRevokeDID = Number(tx.receipt.gasUsed);

    // addNewAdmin
    tx = await registry.addNewAdmin(accounts[4], { from: admin });
    results.addNewAdmin = Number(tx.receipt.gasUsed);

    // removeAdmin
    tx = await registry.removeAdmin(accounts[4], { from: admin });
    results.removeAdmin = Number(tx.receipt.gasUsed);

    console.log("=== GAS_METRICS ===");
    console.log(JSON.stringify(results, null, 2));
  });
});