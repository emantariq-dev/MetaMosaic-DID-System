const fs = require("fs");

// Load existing proof.json
const proof = require("./proof.json");

// Read inputs.txt containing 4 space-separated values
// Format: secret key expectedHash userAddressHash
const inputRaw = fs.readFileSync("inputs.txt", "utf8").trim();
const parts = inputRaw.split(/\s+/);

if (parts.length !== 4) {
  console.error("❌ Expected 4 values in inputs.txt: secret key expectedHash userAddressHash");
  process.exit(1);
}

const expectedHash = parts[2];
const userAddressHash = parts[3];

// Overwrite proof.inputs with only the 2 required public values
proof.inputs = [expectedHash, userAddressHash];

// Write updated proof.json
fs.writeFileSync("proof.json", JSON.stringify(proof, null, 2));

console.log("✅ proof.json updated with public inputs:", proof.inputs);
