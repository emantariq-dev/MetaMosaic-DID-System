# MetaMosaic – Decentralized Identity System

---

## 🔹 Description

MetaMosaic is a secure identity management system designed for the metaverse. 
It leverages blockchain technology, Decentralized Identifiers (DIDs), and Zero-Knowledge Proofs (ZKP) to provide privacy-preserving, tamper-proof, and verifiable digital identities for users in virtual reality environments.

## 🔹 Project Structure
```text

MetaMosaic-DID-System/
├─ Dashboard/             # React.js frontend dashboard for DID management
├─ Truffle/               # Solidity smart contracts and deployment scripts
├─ VR classroom/                   # VR App integration files
├─ compute.js             # Script to compute ZKP inputs
├─ mergeInputsIntoProof.js# Merges ZKP inputs with proof files
├─ README.md              # Project documentation
└─ contracts/             # Smart contracts (Verifier.sol, DIDRegistry.sol, etc.)

---

## 🔹 Features

- **Decentralized Identity (DID) Management**  
  Create, verify, and revoke digital identities without relying on a central authority.

- **Blockchain-Powered Security**  
  All identity operations are stored on a blockchain, ensuring immutability and transparency.

- **Zero-Knowledge Proof (ZKP) Verification**  
  Users can prove their identity or credentials without revealing sensitive information.

- **VR App Integration**  
  Designed for seamless integration with metaverse and VR platforms for real-time identity verification.

- **Admin & User Roles**  
  - **Admin:** Can verify or revoke identities.  
  - **User:** Can create a DID, submit proofs, and access services in the metaverse securely.

---

## 🔹 Tech Stack

- **Frontend (VR App / Dashboard):** React.js  
- **Backend / Smart Contract:** Solidity, Truffle  
- **Blockchain:** Ethereum (Ganache for local development)  
- **ZKP Tools:** ZoKrates (MiMC hashing)  
- **Interaction:** Web3.js for connecting frontend with smart contracts  

---

## 🔹 How It Works

1. **DID Creation:**  
   Users create a unique Decentralized Identifier on the blockchain.

2. **ZKP Verification:**  
   Users generate a proof using ZoKrates without revealing the secret.

3. **Proof Submission:**  
   The proof is submitted to the smart contract.

4. **Contract Verification:**  
   Smart contract verifies the proof and grants access or verification.

5. **Admin Actions:**  
   Admin can verify or revoke DIDs through the dashboard.

---
