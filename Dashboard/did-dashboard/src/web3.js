// src/web3.js
import Web3 from "web3";
import SecureDIDRegistry from "./SecureDIDRegistry.json";
import VerifierArtifact from "./Verifier.json";

let web3;
let registryContract;
let verifierContract;
let selectedAccount = null;

const initWeb3 = async () => {
  if (!window.ethereum) {
    console.error("MetaMask not detected! Please install MetaMask.");
    throw new Error("MetaMask not detected");
  }

  web3 = new Web3(window.ethereum);

  try {
    // Request and store selected account (this triggers the MetaMask popup on first load)
    if (!selectedAccount) {
      const accounts = await web3.eth.requestAccounts();
      selectedAccount = accounts && accounts[0] ? accounts[0] : null;
    }

    const networkId = await web3.eth.net.getId();
    const registryNetwork = SecureDIDRegistry.networks[networkId];
    const verifierNetwork = VerifierArtifact.networks[networkId];

    if (registryNetwork) {
      registryContract = new web3.eth.Contract(
        SecureDIDRegistry.abi,
        registryNetwork.address
      );
      // Verifier is optional for your on-chain flows; Option-A uses backend verify
      if (verifierNetwork) {
        verifierContract = new web3.eth.Contract(
          VerifierArtifact.abi,
          verifierNetwork.address
        );
      } else {
        console.warn("Verifier not deployed for this network id — continuing without it.");
        verifierContract = null;
      }
    } else {
      console.error("SecureDIDRegistry not deployed to this network.");
      registryContract = null;
    }

    // Listen for account changes
    if (window.ethereum && window.ethereum.on) {
      window.ethereum.on("accountsChanged", (accounts) => {
        selectedAccount = accounts && accounts[0] ? accounts[0] : null;
        console.log("Switched to account:", selectedAccount);
      });
      window.ethereum.on("chainChanged", (_chainId) => {
        // Reload to refresh netId / artifacts
        window.location.reload();
      });
    }
  } catch (error) {
    console.error("MetaMask error:", error);
    throw error;
  }
};

export { web3, registryContract, verifierContract, initWeb3, selectedAccount };
