// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title  AgentSpawner
 * @notice Spawns a persistent AI agent on Ritual Chain via precompile 0x0820.
 *         Calling spawnAgent() is what registers your wallet in Genesis 1000.
 *
 *         LIFECYCLE
 *         ─────────
 *         1. Deploy this contract on Ritual Chain (ID 1979).
 *         2. Deposit RITUAL into RitualWallet (0x532F...3948).
 *         3. Call spawnAgent() from YOUR wallet → this tx timestamp = Genesis rank.
 *         4. AsyncDelivery (0x5A16...39F6) calls onPersistentAgentResult() when done.
 *
 *         PRECOMPILE ADDRESSES
 *         ────────────────────
 *         0x0820 — Persistent Agent (spawn / revive)
 *         0x0802 — LLM inference
 *         0x0801 — HTTP requests
 */
contract AgentSpawner {

    // ── Ritual Chain System Addresses ───────────────────────────────────────
    address public constant PERSISTENT_AGENT_PRECOMPILE = address(0x0820);
    address public constant ASYNC_DELIVERY              = address(0x5A16214fF555848411544b005f7Ac063742f39F6);
    address public constant RITUAL_WALLET               = address(0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948);

    // ── State ───────────────────────────────────────────────────────────────
    address public immutable owner;
    bytes32 public latestJobId;
    bytes   public latestResult;
    bool    public agentSpawned;
    uint256 public spawnTimestamp;     // Block timestamp when spawnAgent() was called
    bytes32 public agentJobId;         // Job ID returned from precompile

    // ── Events ──────────────────────────────────────────────────────────────
    event AgentSpawned(bytes32 indexed jobId, uint256 timestamp, address indexed spawner);
    event AgentResult(bytes32 indexed jobId, bytes result);
    event AgentRevived(bytes32 indexed jobId);

    // ── Errors ──────────────────────────────────────────────────────────────
    error NotOwner();
    error AlreadySpawned();
    error NotAsyncDelivery();
    error PrecompileCallFailed();
    error NotYetSpawned();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Core: Spawn
    // ────────────────────────────────────────────────────────────────────────

    /**
     * @notice Spawns a persistent agent. THIS IS THE TRANSACTION THAT GETS
     *         YOU INTO GENESIS 1000. Call it ASAP — rank is by block timestamp.
     *
     * @param agentInput  ABI-encoded 25-field persistent agent config.
     *                    Build this with scripts/encode-agent.js.
     */
    function spawnAgent(bytes calldata agentInput) external onlyOwner {
        if (agentSpawned) revert AlreadySpawned();

        // Call the Persistent Agent precompile (phase 1 of 2-phase async)
        (bool ok, bytes memory returnData) = PERSISTENT_AGENT_PRECOMPILE.call(agentInput);
        if (!ok) revert PrecompileCallFailed();

        // Decode the job ID from the precompile's return data
        bytes32 jobId = returnData.length >= 32
            ? abi.decode(returnData, (bytes32))
            : keccak256(abi.encodePacked(block.timestamp, msg.sender));

        agentSpawned    = true;
        spawnTimestamp  = block.timestamp;
        agentJobId      = jobId;
        latestJobId     = jobId;

        emit AgentSpawned(jobId, block.timestamp, msg.sender);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Core: Revive (if agent crashes)
    // ────────────────────────────────────────────────────────────────────────

    /**
     * @notice Revives a crashed agent. Pass the same config but with
     *         restoreFromCid set to the last checkpoint CID.
     *         encryptedSecrets should be empty (recovered from DKMS escrow).
     */
    function reviveAgent(bytes calldata reviveInput) external onlyOwner {
        if (!agentSpawned) revert NotYetSpawned();

        (bool ok, bytes memory returnData) = PERSISTENT_AGENT_PRECOMPILE.call(reviveInput);
        if (!ok) revert PrecompileCallFailed();

        bytes32 jobId = returnData.length >= 32
            ? abi.decode(returnData, (bytes32))
            : keccak256(abi.encodePacked(block.timestamp, msg.sender, "revive"));

        latestJobId = jobId;
        emit AgentRevived(jobId);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Phase 2 Callback: AsyncDelivery calls this when agent completes
    // ────────────────────────────────────────────────────────────────────────

    /**
     * @notice Called by Ritual's AsyncDelivery contract when the agent
     *         produces output (phase 2 of the 2-phase async flow).
     */
    function onPersistentAgentResult(
        bytes32 jobId,
        bytes calldata result
    ) external {
        if (msg.sender != ASYNC_DELIVERY) revert NotAsyncDelivery();
        latestJobId  = jobId;
        latestResult = result;
        emit AgentResult(jobId, result);
    }

    // ────────────────────────────────────────────────────────────────────────
    // View helpers
    // ────────────────────────────────────────────────────────────────────────

    function getStatus() external view returns (
        bool    spawned,
        uint256 timestamp,
        bytes32 jobId,
        address spawnerOwner
    ) {
        return (agentSpawned, spawnTimestamp, agentJobId, owner);
    }

    /// @notice Allows contract to receive ETH (for fee deposits if needed)
    receive() external payable {}
}
