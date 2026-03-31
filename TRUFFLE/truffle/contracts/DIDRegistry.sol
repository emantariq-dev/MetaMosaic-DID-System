// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./verifier.sol";

contract SecureDIDRegistry {
    /* ------------------------------- Errors ------------------------------- */
    error NotAdmin();
    error DidExists();
    error DidMissing();
    error DidAlreadyVerified();
    error DidRevoked();
    error InsufficientDeposit();
    error CannotRemoveSelf();
    error RefundFailed();

    /* ------------------------------ Verifier ------------------------------ */
    Verifier private verifier;

    /* -------------------------------- Types ------------------------------- */
    struct DID {
        address owner;
        bool verified;
        bool revoked;
        uint64 timestamp; // tighter type for gas
    }

    struct TransactionStats {
        uint64 total;
        uint64 success;
        uint64 failed;
    }

    /* -------------------------------- State ------------------------------- */
    mapping(address => DID) private dids;
    mapping(address => bool) private admins;
    address[] private adminList;

    // Escrowed user deposits until verification
    mapping(address => uint256) private deposits;

    // Per-user tx stats (simple counters)
    mapping(address => TransactionStats) private userTransactions;

    // Optional “analytics” sets
    mapping(address => bool) private activeUsers;
    address[] private allUsers;

    // Global counters
    uint256 public totalDIDsCreated;
    uint256 public totalDIDsVerified;
    uint256 public totalDIDsRevoked;
    uint256 public totalTransactions;
    uint256 public successfulTransactions;
    uint256 public failedTransactions;

    // Economic parameter
    uint256 public constant requiredDeposit = 0.01 ether;

    /* -------------------------------- Events ------------------------------- */
    event DIDCreated(address indexed owner, uint256 timestamp);
    event DIDVerified(address indexed owner, uint256 timestamp);
    event DIDRevoked(address indexed owner, uint256 timestamp);
    event DepositRefunded(address indexed owner, uint256 amount);
    event AdminAdded(address indexed newAdmin);
    event AdminRemoved(address indexed removedAdmin);
    event TransactionRecorded(address indexed user, bool success);

    /* ----------------------------- Modifiers ------------------------------ */
    modifier onlyAdmin() {
        if (!admins[msg.sender]) revert NotAdmin();
        _;
    }

    /* ----------------------------- Constructor ---------------------------- */
    constructor(address _verifierAddress) {
        verifier = Verifier(_verifierAddress);
        admins[msg.sender] = true;
        adminList.push(msg.sender);
    }

    /* ---------------------------- Core Functions -------------------------- */

    /// @notice Register a DID with a refundable deposit.
    function createDID() external payable {
        if (dids[msg.sender].owner != address(0)) revert DidExists();
        if (msg.value < requiredDeposit) revert InsufficientDeposit();

        dids[msg.sender] = DID({
            owner: msg.sender,
            verified: false,
            revoked: false,
            timestamp: uint64(block.timestamp)
        });

        deposits[msg.sender] = msg.value;

        // Simple analytics
        if (!activeUsers[msg.sender]) {
            activeUsers[msg.sender] = true;
            allUsers.push(msg.sender);
            // initialize stats lazily
            userTransactions[msg.sender] = TransactionStats(0, 0, 0);
        }

        unchecked {
            totalDIDsCreated++;
            totalTransactions++;
        }
        _recordTransaction(msg.sender, true);
        emit DIDCreated(msg.sender, block.timestamp);
    }

    /// @notice Admin-only verification; refunds the deposit on success.
    function verifyDID(address user) public onlyAdmin {
        DID storage d = dids[user];
        if (d.owner == address(0)) revert DidMissing();
        if (d.verified) revert DidAlreadyVerified();
        if (d.revoked) revert DidRevoked();

        d.verified = true;

        unchecked {
            totalDIDsVerified++;
            totalTransactions++;
        }

        uint256 refundAmount = deposits[user];
        if (refundAmount > 0) {
            deposits[user] = 0;
            // use .call for future-proof gas behavior
            (bool ok, ) = payable(user).call{value: refundAmount}("");
            if (!ok) revert RefundFailed();
            emit DepositRefunded(user, refundAmount);
        }

        _recordTransaction(user, true);
        emit DIDVerified(user, block.timestamp);
    }

    /// @notice Admin-only revocation; scalable, gas-cheap (flag flip only).
    function revokeDID(address user) public onlyAdmin {
        DID storage d = dids[user];
        if (d.owner == address(0)) revert DidMissing();
        if (d.revoked) revert DidRevoked();

        d.revoked = true;
        d.verified = false; // keep invariant: verified && !revoked

        unchecked {
            totalDIDsRevoked++;
            totalTransactions++;
        }

        // IMPORTANT: revocation is a successful transaction (counts +1 success)
        _recordTransaction(user, true);
        emit DIDRevoked(user, block.timestamp);
    }

    /* ------------------------------ Batch Ops ----------------------------- */
    /// @notice Batch verify (optional; keeps single-verify semantics).
    function batchVerifyDID(address[] calldata users) external onlyAdmin {
        uint256 len = users.length;
        for (uint256 i = 0; i < len; ) {
            // best-effort: skip users that would revert to keep batch progress
            address u = users[i];
            DID storage d = dids[u];
            if (d.owner != address(0) && !d.verified && !d.revoked) {
                d.verified = true;

                unchecked {
                    totalDIDsVerified++;
                    totalTransactions++;
                }

                uint256 refundAmount = deposits[u];
                if (refundAmount > 0) {
                    deposits[u] = 0;
                    (bool ok, ) = payable(u).call{value: refundAmount}("");
                    if (!ok) revert RefundFailed();
                    emit DepositRefunded(u, refundAmount);
                }

                _recordTransaction(u, true);
                emit DIDVerified(u, block.timestamp);
            }
            unchecked { i++; }
        }
    }

    /// @notice Batch revoke to improve scalability under load.
    function batchRevokeDID(address[] calldata users) external onlyAdmin {
        uint256 len = users.length;
        for (uint256 i = 0; i < len; ) {
            address u = users[i];
            DID storage d = dids[u];
            if (d.owner != address(0) && !d.revoked) {
                d.revoked = true;
                d.verified = false;

                unchecked {
                    totalDIDsRevoked++;
                    totalTransactions++;
                }

                _recordTransaction(u, true);
                emit DIDRevoked(u, block.timestamp);
            }
            unchecked { i++; }
        }
    }

    /* ------------------------------ Admin Ops ----------------------------- */
    function addNewAdmin(address newAdmin) external onlyAdmin {
        if (admins[newAdmin]) revert DidExists(); // reuse existing error for compact bytecode
        admins[newAdmin] = true;
        adminList.push(newAdmin);
        emit AdminAdded(newAdmin);
    }

    function removeAdmin(address admin) external onlyAdmin {
        if (!admins[admin]) revert DidMissing(); // compact reuse
        if (admin == msg.sender) revert CannotRemoveSelf();

        admins[admin] = false;

        // swap & pop to remove from list
        uint256 n = adminList.length;
        for (uint256 i = 0; i < n; ) {
            if (adminList[i] == admin) {
                adminList[i] = adminList[n - 1];
                adminList.pop();
                break;
            }
            unchecked { i++; }
        }

        emit AdminRemoved(admin);
    }

    /* ------------------------------- Getters ------------------------------ */
    function isDIDVerified(address user) external view returns (bool) {
        DID storage d = dids[user];
        if (d.owner == address(0)) revert DidMissing();
        return d.verified && !d.revoked;
    }

    function getDIDStatus(address user) external view returns (string memory) {
        DID storage d = dids[user];
        if (d.owner == address(0)) revert DidMissing();
        if (d.revoked) return "Revoked";
        if (d.verified) return "Verified";
        return "Unverified";
    }

    function isAdmin(address user) external view returns (bool) {
        return admins[user];
    }

    function getGlobalStats()
        external
        view
        returns (uint256, uint256, uint256, uint256, uint256, uint256)
    {
        return (
            totalDIDsCreated,
            totalDIDsVerified,
            totalDIDsRevoked,
            totalTransactions,
            successfulTransactions,
            failedTransactions
        );
    }

    /* ----------------------------- ZKP Path ------------------------------- */
    function verifyDIDWithZKP(
        address user,
        uint[2] memory a,
        uint[2][2] memory b,
        uint[2] memory c,
        uint[2] memory input
    ) public onlyAdmin {
        DID storage d = dids[user];
        if (d.owner == address(0)) revert DidMissing();
        if (d.verified) revert DidAlreadyVerified();
        if (d.revoked) revert DidRevoked();

        Verifier.Proof memory proof = Verifier.Proof({
            a: Pairing.G1Point(a[0], a[1]),
            b: Pairing.G2Point([b[0][0], b[0][1]], [b[1][0], b[1][1]]),
            c: Pairing.G1Point(c[0], c[1])
        });
        require(verifier.verifyTx(proof, input), "Invalid ZKP proof");

        d.verified = true;

        unchecked {
            totalDIDsVerified++;
            totalTransactions++;
        }

        uint256 refundAmount = deposits[user];
        if (refundAmount > 0) {
            deposits[user] = 0;
            (bool ok, ) = payable(user).call{value: refundAmount}("");
            if (!ok) revert RefundFailed();
            emit DepositRefunded(user, refundAmount);
        }

        _recordTransaction(user, true);
        emit DIDVerified(user, block.timestamp);
    }

    /* ---------------------------- Internals ------------------------------- */
    function _recordTransaction(address user, bool success) internal {
        TransactionStats storage s = userTransactions[user];
        unchecked {
            s.total++;
            if (success) {
                s.success++;
                successfulTransactions++;
            } else {
                s.failed++;
                failedTransactions++;
            }
        }
        if (!activeUsers[user]) {
            activeUsers[user] = true;
            allUsers.push(user);
        }
        emit TransactionRecorded(user, success);
    }

    /* ------------------------------- Ether -------------------------------- */
    receive() external payable {}
}
