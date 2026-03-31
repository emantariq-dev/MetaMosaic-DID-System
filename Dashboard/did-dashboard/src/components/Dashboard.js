/* global BigInt */

import React, { useEffect, useState, useRef, useCallback } from "react";
import { initWeb3, web3, registryContract } from "../web3";
import { Chart } from "chart.js/auto";
import "bootstrap/dist/css/bootstrap.min.css";
import "../styles/Dashboard.css";
import { QRCodeCanvas } from "qrcode.react";

const Dashboard = () => {
  const [account, setAccount] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [didStatus, setDidStatus] = useState("Not Created");
  const [globalStats, setGlobalStats] = useState({
    totalDIDsCreated: 0,
    totalDIDsVerified: 0,
    totalDIDsRevoked: 0,
    totalTransactions: 0,
    successfulTransactions: 0,
    failedTransactions: 0,
  });

  const [backendUrl] = useState(
    process.env.REACT_APP_BACKEND_URL || "http://localhost:4000"
  );
  const [lastIssuedToken, setLastIssuedToken] = useState(null);
  const [tokenExp, setTokenExp] = useState(null);
  const [zkpBackendStatus, setZkpBackendStatus] = useState(null);

  const barChartRef = useRef(null);
  const pieChartRef = useRef(null);
  const lineChartRef = useRef(null);
  const doughnutChartRef = useRef(null);

  const loadBlockchainData = async () => {
    await initWeb3();
    if (!web3 || !registryContract) return;

    try {
      const accounts = await web3.eth.requestAccounts();
      setAccount(accounts[0]);

      const adminStatus = await registryContract.methods.isAdmin(accounts[0]).call();
      setIsAdmin(adminStatus);

      let status;
      try {
        status = await registryContract.methods.getDIDStatus(accounts[0]).call();
      } catch {
        status = "Not Created";
      }
      setDidStatus(status);

      const stats = await registryContract.methods.getGlobalStats().call();
      setGlobalStats({
        totalDIDsCreated: parseInt(stats[0]),
        totalDIDsVerified: parseInt(stats[1]),
        totalDIDsRevoked: parseInt(stats[2]),
        totalTransactions: parseInt(stats[3]),
        successfulTransactions: parseInt(stats[4]),
        failedTransactions: parseInt(stats[5]),
      });
    } catch (error) {
      console.error("Error loading blockchain data:", error);
    }
  };

  useEffect(() => {
    loadBlockchainData();
    const interval = setInterval(loadBlockchainData, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (window.ethereum) {
      window.ethereum.on("accountsChanged", async (accounts) => {
        setAccount(accounts[0]);
        await loadBlockchainData();
      });
    }
  }, []);

  const createDID = async () => {
    try {
      
      let txParams = {
        from: account,
        gas: 800000,
        value: web3.utils.toWei("0.01", "ether"),
      };
      try {
        await registryContract.methods.createDID().estimateGas(txParams);
      } catch {
        txParams = { from: account, gas: 800000 };
        await registryContract.methods.createDID().estimateGas(txParams);
      }

      await registryContract.methods.createDID().send(txParams);
      await loadBlockchainData();
      alert("DID created successfully!");
    } catch (error) {
      console.error("Create DID error:", error);
      alert("DID creation failed!");
    }
  };

  const verifyDID = async () => {
    try {
      if (!isAdmin) return alert("Only admins can verify DIDs.");

      const userAddress = prompt("Enter user address to verify:");
      if (!web3.utils.isAddress(userAddress)) return alert("Invalid address!");

      const gas = await registryContract.methods
        .verifyDID(userAddress)
        .estimateGas({ from: account })
        .catch(() => 1000000);

      await registryContract.methods.verifyDID(userAddress).send({ from: account, gas });
      await loadBlockchainData();
      alert("DID verified!");
    } catch (error) {
      console.error("Verification failed:", error);
      alert("Failed to verify DID.");
    }
  };

  const verifyWithZKP = async () => {
    try {
      if (!isAdmin) return alert("Only admins can use ZKP verification.");

      const rawAddress = prompt("Enter user address used to generate the proof:");
      if (!web3.utils.isAddress(rawAddress)) return alert("Invalid address!");

      console.log("🔍 [ZKP] User raw Ethereum address:", rawAddress);

      // Step 1: Hash the Ethereum address
      const FIELD_PRIME = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
      const cleaned = rawAddress.toLowerCase().replace("0x", "");
      const userAddressHash = (BigInt("0x" + cleaned) % FIELD_PRIME).toString();

      console.log("🧮 [React] Computed userAddressHash (decimal):", userAddressHash);

      // Step 2: Load proof.json
      const response = await fetch("/proof.json");
      if (!response.ok) throw new Error("proof.json not found in public folder.");
      const proofJson = await response.json();

      const { proof, inputs } = proofJson;

      // Step 3: Validate input length
      if (!inputs || inputs.length !== 2) {
        console.error("Invalid proof.inputs length. Expected 2, got", inputs?.length);
        alert("Invalid proof: Expected 2 public inputs.");
        return;
      }

      // Step 4: Confirm inputs match userAddressHash
      console.log("📦 [Proof] expectedHash:", inputs[0]);
      console.log("📦 [Proof] userAddressHash (from file):", inputs[1]);

      if (inputs[1] !== userAddressHash) {
        console.warn("⚠️ Mismatch: userAddressHash in proof.json does NOT match computed.");
        alert("Mismatch between computed and proof's userAddressHash!");
        return;
      } else {
        console.log("Match: userAddressHash is correct.");
      }

      // Step 5: Format proof parameters
      const a = [proof.a[0], proof.a[1]];
      const b = [
        [proof.b[0][0], proof.b[0][1]],
        [proof.b[1][0], proof.b[1][1]],
      ];
      const c = [proof.c[0], proof.c[1]];
      const input = [inputs[0], userAddressHash];

      console.log("🧮 [ZKP] Prepared inputs:");
      console.log("  a:", a);
      console.log("  b:", b);
      console.log("  c:", c);
      console.log("  input:", input);

      
      const isValid = await registryContract.methods
        .verifyDIDWithZKP(rawAddress, a, b, c, input)
        .call({ from: account });

      if (!isValid) {
        alert("ZKP proof is invalid according to the contract (dry-run).");
        return;
      }

      const gas = await registryContract.methods
        .verifyDIDWithZKP(rawAddress, a, b, c, input)
        .estimateGas({ from: account })
        .catch(() => 1500000);

      const result = await registryContract.methods
        .verifyDIDWithZKP(rawAddress, a, b, c, input)
        .send({ from: account, gas });

      console.log("[ZKP] Verification successful:", result);
      await loadBlockchainData();
      alert("ZKP verification successful!");
    } catch (err) {
      console.error("[ZKP ERROR]:", err);
      if (err?.data?.message) {
        console.error("💡 EVM Revert Reason:", err.data.message);
      } else if (err?.message?.includes("invalid arrayify value")) {
        alert("ZKP proof formatting issue. Check the proof structure.");
      } else {
        alert("ZKP verification failed. Check proof format, contract inputs, and verifier.");
      }
    }
  };

  const loadProofJson = useCallback(async () => {
    const resp = await fetch("/proof.json");
    if (!resp.ok) throw new Error("Missing public/proof.json");
    return await resp.json(); // { proof, inputs }
  }, []);

  const verifyZKP_OnBackend = useCallback(async () => {
    try {
      if (!web3) return alert("Web3 not ready yet.");
      if (!account) return alert("No wallet connected.");

      const proofJson = await loadProofJson();
      const { proof, inputs } = proofJson || {};
      if (!proof || !inputs) {
        alert("Invalid proof.json format.");
        return;
      }

      const body = {
        address: account,
        proof: { a: proof.a, b: proof.b, c: proof.c },
        input: inputs,
      };

      const resp = await fetch(`${backendUrl}/zkp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await resp.json();

      if (!data.ok) {
        console.warn("ZKP backend verify failed:", data);
        setZkpBackendStatus(`Backend verify failed: ${data.error || data.step || "unknown"}`);
        alert("ZKP verification (backend) failed.");
        return;
      }

      setZkpBackendStatus(`Backend verify ok${data.txHash ? ` (tx: ${data.txHash})` : ""}`);
      alert("ZKP verified by backend! Now issue a token.");
    } catch (err) {
      console.error(err);
      setZkpBackendStatus(`Error: ${err.message || err}`);
      alert("ZKP backend error. Check console.");
    }
  }, [account, backendUrl, loadProofJson, web3]);

  const issueShortLivedToken = useCallback(async () => {
    try {
      if (!web3) return alert("Web3 not ready yet.");
      if (!account) return alert("No wallet connected.");

      const resp = await fetch(`${backendUrl}/token/issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: account }),
      });
      const data = await resp.json();

      if (!data.ok) {
        alert(`Token issue failed: ${data.error || "unknown"}`);
        return;
      }
      setLastIssuedToken(data.token);
      setTokenExp(data.expSeconds);
    } catch (err) {
      console.error(err);
      alert("Token issue error. Check console.");
    }
  }, [account, backendUrl, web3]);
  // =====================================

  const createChart = (canvasId, type, data, backgroundColor, chartRef) => {
    const ctx = document.getElementById(canvasId)?.getContext("2d");
    if (!ctx) return;

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    chartRef.current = new Chart(ctx, {
      type,
      data: {
        labels: Object.keys(data),
        datasets: [
          {
            label: "Statistics",
            data: Object.values(data),
            backgroundColor,
          },
        ],
      },
    });
  };

  useEffect(() => {
    createChart(
      "barChart",
      "bar",
      {
        Created: globalStats.totalDIDsCreated,
        Verified: globalStats.totalDIDsVerified,
        Revoked: globalStats.totalDIDsRevoked,
      },
      ["#4CAF50", "#2196F3", "#F44336"],
      barChartRef
    );

    createChart(
      "pieChart",
      "pie",
      {
        Successful: globalStats.successfulTransactions,
        Failed: globalStats.failedTransactions,
      },
      ["#2ECC71", "#E74C3C"],
      pieChartRef
    );

    createChart(
      "lineChart",
      "line",
      {
        Total: globalStats.totalTransactions,
        Successful: globalStats.successfulTransactions,
        Failed: globalStats.failedTransactions,
      },
      ["#8E44AD", "#2ECC71", "#E74C3C"],
      lineChartRef
    );

    createChart(
      "doughnutChart",
      "doughnut",
      {
        Verified: globalStats.totalDIDsVerified,
        Revoked: globalStats.totalDIDsRevoked,
      },
      ["#FFC107", "#607D8B"],
      doughnutChartRef
    );
  }, [globalStats]);

  return (
    <div className="dashboard-container">
      <h2 className="dashboard-title">Meta Mosaic</h2>
      <div className="dashboard-content">
        <div className="side-panel">
          <div className="status-card">
            <h5 className="account-text">Account:</h5>
            <h5 className="account-address">{account}</h5>
            <h5>Status: {didStatus}</h5>
            <h5>Admin: {isAdmin ? "Yes" : "No"}</h5>

            <button className="btn-primary" onClick={createDID}>
              Create DID
            </button>

            <button className="btn-success" onClick={verifyDID} disabled={!isAdmin}>
              Verify DID
            </button>

            <button className="btn btn-warning mt-2" onClick={verifyWithZKP}>
              Verify with ZKP
            </button>

            <div
              className="card mt-3 p-2"
              style={{ background: "rgba(255,255,255,0.06)", borderRadius: 12 }}
            >
             
              <p className="text-muted small mb-2">
              </p>
              <div className="d-flex flex-wrap gap-2">
                <button
                  className="btn btn-outline-primary btn-sm"
                  onClick={verifyZKP_OnBackend}
                >
                  Submit ZKP to Backend
                </button>
                <button
                  className="btn btn-outline-success btn-sm"
                  onClick={issueShortLivedToken}
                >
                  Issue Token
                </button>
              </div>

              {zkpBackendStatus && <p className="mt-2 small">{zkpBackendStatus}</p>}

              {lastIssuedToken && (
                <div className="mt-2">
                  <div className="d-flex flex-wrap gap-2 align-items-start">
                    <div>
                      <strong className="small">JWT (copy to Unity):</strong>
                      <textarea
                        readOnly
                        className="form-control mt-1"
                        style={{ width: "100%", minWidth: 260, height: 72 }}
                        value={lastIssuedToken}
                      />
                      <div className="small text-muted mt-1">
                        Expires in ~{tokenExp || 300}s; one-time use (jti protected).
                      </div>
                    </div>
                    <div>
                      <strong className="small">QR:</strong>
                      <div
                        className="mt-1"
                        style={{ background: "#fff", padding: 8, display: "inline-block", borderRadius: 8 }}
                      >
                        <QRCodeCanvas value={lastIssuedToken} size={112} />
                      </div>
                    </div>
                  </div>
                  <div className="mt-2">
                    <strong className="small">Deeplink:</strong>{" "}
                    <a href={`vrc://login?token=${encodeURIComponent(lastIssuedToken)}`}>
                      vrc://login?token=…
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="charts-container">
          <div className="chart"><canvas id="barChart"></canvas></div>
          <div className="chart"><canvas id="pieChart"></canvas></div>
          <div className="chart"><canvas id="lineChart"></canvas></div>
          <div className="chart"><canvas id="doughnutChart"></canvas></div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
