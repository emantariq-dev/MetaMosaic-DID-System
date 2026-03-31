const fs = require("fs");

async function gen() {
  const ethAddress = "0xbf99FAD360Df6AAF7a27890749Bec42236Ab824c";

  const FIELD_PRIME = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

  const cleaned = "0x" + ethAddress.toLowerCase().replace("0x", "");
  const secret = BigInt(cleaned) % FIELD_PRIME;
  const key = secret;

  let xl = secret;
  let xr = secret;
  const constants = [1n, 2n, 3n, 4n, 5n, 6n];
  for (let i = 0; i < constants.length; i++) {
    let t = xl + key + constants[i];
    let t2 = t * t;
    let t4 = t2 * t2;
    let t7 = t4 * t2 * t;
    let tmp = (t7 + xr) % FIELD_PRIME;
    xr = xl;
    xl = tmp;
  }

  const expectedHash = xl;
  const userAddressHash = secret;

  // Write all 4 values to inputs.txt (space separated)
  fs.writeFileSync("inputs.txt", `${secret} ${key} ${expectedHash} ${userAddressHash}`);

  // Also write decimal-formatted proof.inputs
  const jsonInputs = {
    proof: {
      a: ["0x...", "0x..."],
      b: [["0x...", "0x..."], ["0x...", "0x..."]],
      c: ["0x...", "0x..."]
    },
    inputs: [
      expectedHash.toString(),
      userAddressHash.toString()
    ]
  };

  fs.writeFileSync("zkp_inputs_snippet.json", JSON.stringify(jsonInputs, null, 2));
  console.log("✅ inputs.txt and zkp_inputs_snippet.json written");
}

gen();
