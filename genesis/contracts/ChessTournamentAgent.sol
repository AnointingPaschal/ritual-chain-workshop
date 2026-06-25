// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title  ChessTournamentAgent
 * @notice Spawns a Sovereign Agent on Ritual Chain that autonomously:
 *         - Monitors the CommitRevealBountyJudge contract
 *         - Uses Ritual LLM precompile to evaluate chess games fairly
 *         - Judges submissions via commit-reveal (no human bias)
 *         - Declares winners and triggers payouts via RitualWallet
 *         - Posts heartbeats and revives itself if needed
 *         - Exposes results via HTTP precompile for the Vercel frontend
 *
 *         Uses the SOVEREIGN AGENT precompile (0x080C) — the proven
 *         path for Genesis 1000 (confirmed by entries #002, #004, #009).
 *
 *         LIFECYCLE
 *         ─────────
 *         1. Deploy this contract on Ritual Chain (ID 1979).
 *         2. Call spawnAgent(agentInput) from your wallet.
 *            → Your tx timestamp = Genesis rank.
 *         3. Ritual TEE spins up the agent with your prompt.
 *         4. Agent calls back onSovereignAgentResult() when it acts.
 */
contract ChessTournamentAgent {

    // ── Ritual System Addresses ──────────────────────────────────────────
    address public constant SOVEREIGN_AGENT_PRECOMPILE =
        address(0x000000000000000000000000000000000000080C);
    address public constant ASYNC_DELIVERY =
        address(0x5A16214fF555848411544b005f7Ac063742f39F6);

    // ── State ────────────────────────────────────────────────────────────
    address public immutable owner;
    bool    public agentSpawned;
    uint256 public spawnTimestamp;
    bytes32 public latestJobId;
    bytes   public latestResult;

    // ── Events ───────────────────────────────────────────────────────────
    event AgentSpawned(bytes32 indexed jobId, uint256 timestamp);
    event AgentResult(bytes32 indexed jobId, bytes result);

    // ── Errors ───────────────────────────────────────────────────────────
    error NotOwner();
    error AlreadySpawned();
    error NotAsyncDelivery();
    error SpawnFailed();

    constructor() {
        owner = msg.sender;
    }

    /**
     * @notice Spawn the Chess Tournament Judge sovereign agent.
     *         THIS tx timestamp = your Genesis 1000 rank.
     *
     * @param agentInput  23-field ABI-encoded sovereign agent config.
     *                    Build with: node genesis/scripts/encode-agent.js
     */
    function spawnAgent(bytes calldata agentInput) external {
        if (msg.sender != owner)  revert NotOwner();
        if (agentSpawned)         revert AlreadySpawned();

        (bool ok, bytes memory ret) = SOVEREIGN_AGENT_PRECOMPILE.call(agentInput);
        if (!ok) revert SpawnFailed();

        bytes32 jobId = ret.length >= 32
            ? abi.decode(ret, (bytes32))
            : keccak256(abi.encodePacked(block.timestamp, msg.sender));

        agentSpawned    = true;
        spawnTimestamp  = block.timestamp;
        latestJobId     = jobId;

        emit AgentSpawned(jobId, block.timestamp);
    }

    /**
     * @notice Phase 2 callback — Ritual AsyncDelivery calls this when
     *         the sovereign agent produces output.
     */
    function onSovereignAgentResult(
        bytes32 jobId,
        bytes calldata result
    ) external {
        if (msg.sender != ASYNC_DELIVERY) revert NotAsyncDelivery();
        latestJobId  = jobId;
        latestResult = result;
        emit AgentResult(jobId, result);
    }

    function getStatus() external view returns (
        bool    spawned,
        uint256 timestamp,
        bytes32 jobId,
        address agentOwner
    ) {
        return (agentSpawned, spawnTimestamp, latestJobId, owner);
    }

    receive() external payable {}
}
