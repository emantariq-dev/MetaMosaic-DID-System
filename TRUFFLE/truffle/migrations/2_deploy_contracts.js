const Verifier = artifacts.require("Verifier");
const SecureDIDRegistry = artifacts.require("SecureDIDRegistry");

module.exports = async function (deployer) {
  await deployer.deploy(Verifier);
  const verifier = await Verifier.deployed();
  await deployer.deploy(SecureDIDRegistry, verifier.address);
};