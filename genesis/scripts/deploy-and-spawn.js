/**
 * deploy-and-spawn.js — Genesis 1000 in one command
 *
 * Usage:
 *   PRIVATE_KEY=0x... node genesis/scripts/deploy-and-spawn.js
 *
 * The AgentSpawner contract is already deployed at:
 *   0xdaC0e77d9b0769BA67a7bB49C3aB0E96dd9b14D6
 *
 * This script:
 *   1. Fetches first registered executor from TEEServiceRegistry
 *   2. Encodes the 25-field agentInput with the correct executor address
 *   3. Calls spawnAgent() on the existing AgentSpawner contract
 *   4. Your Genesis rank = block timestamp of this tx
 */

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const { buildAgentInput } = require("./encode-agent.js");

// ── Chain config ──────────────────────────────────────────────────────────
const RITUAL_RPC      = "https://rpc.ritualfoundation.org";
const CHAIN_ID        = 1979;

// ── Contract addresses ────────────────────────────────────────────────────
const TEE_REGISTRY    = "0x9644e8562cE0Fe12b4deeC4163c064A8862Bf47F";
const RITUAL_WALLET   = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948";

// Already deployed in a previous run — reuse it
const SPAWNER_ADDRESS = process.env.SPAWNER_ADDRESS || "0xdaC0e77d9b0769BA67a7bB49C3aB0E96dd9b14D6";

// ── ABIs (minimal) ────────────────────────────────────────────────────────
const TEE_REGISTRY_ABI = [
  "function getExecutors() external view returns (address[])",
  "function executorCount() external view returns (uint256)",
];

const RITUAL_WALLET_ABI = [
  "function deposit(uint256 lockDuration) external payable",
  "function balanceOf(address user) external view returns (uint256)",
];

const SPAWNER_ABI = [
  "function spawnAgent(bytes calldata agentInput) external",
  "function agentSpawned() external view returns (bool)",
  "function spawnTimestamp() external view returns (uint256)",
  "function agentJobId() external view returns (bytes32)",
];

// ── Validate ──────────────────────────────────────────────────────────────
const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error("\n❌  Set PRIVATE_KEY:  export PRIVATE_KEY=0x...\n");
  process.exit(1);
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Ritual Genesis 1000 — Spawn Agent");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const provider = new ethers.JsonRpcProvider(RITUAL_RPC, {
    chainId: CHAIN_ID,
    name: "ritual-testnet",
  });
  const wallet  = new ethers.Wallet(PRIVATE_KEY, provider);
  const address = wallet.address;

  const balance = await provider.getBalance(address);
  console.log("Wallet:  ", address);
  console.log("Balance: ", ethers.formatEther(balance), "RITUAL");

  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(CHAIN_ID)) {
    console.error(`\n❌  Wrong network — expected ${CHAIN_ID}, got ${network.chainId}\n`);
    process.exit(1);
  }
  console.log("Network:  Ritual Chain (ID", CHAIN_ID, ")\n");

  // ── Step 1: Get executor address from TEEServiceRegistry ───────────────
  console.log("▶ Step 1/3  Fetching executor from TEEServiceRegistry...");
  let executorAddress;
  try {
    const registry = new ethers.Contract(TEE_REGISTRY, TEE_REGISTRY_ABI, provider);
    const executors = await registry.getExecutors();
    if (!executors || executors.length === 0) {
      throw new Error("No executors registered yet");
    }
    executorAddress = executors[0];
    console.log("  ✔ Executor:", executorAddress, "\n");
  } catch (e) {
    // Fallback: use address(1) as placeholder if registry query fails
    console.log("  ⚠ Could not fetch executor:", e.message.slice(0, 80));
    console.log("  ⚠ Using placeholder executor address(1) — may still work on testnet\n");
    executorAddress = "0x0000000000000000000000000000000000000001";
  }

  // ── Step 2: Encode the 25-field agentInput ─────────────────────────────
  console.log("▶ Step 2/3  Encoding 25-field agentInput...");
  const agentInput = buildAgentInput(SPAWNER_ADDRESS, executorAddress);
  console.log("  ✔ Encoded", agentInput.length / 2 - 1, "bytes\n");

  // ── Step 3: Call spawnAgent() ──────────────────────────────────────────
  console.log("▶ Step 3/3  SPAWNING AGENT (Genesis 1000 timestamp)...");

  const spawner = new ethers.Contract(SPAWNER_ADDRESS, SPAWNER_ABI, wallet);

  // Check if already spawned
  try {
    const alreadySpawned = await spawner.agentSpawned();
    if (alreadySpawned) {
      const ts = await spawner.spawnTimestamp();
      const jobId = await spawner.agentJobId();
      console.log("\n  ℹ Agent was already spawned!");
      console.log("  Spawn timestamp:", ts.toString());
      console.log("  Job ID:         ", jobId);
      console.log("  Contract:       ", SPAWNER_ADDRESS);
      console.log("  Explorer:  https://explorer.ritualfoundation.org/address/" + SPAWNER_ADDRESS + "\n");
      return;
    }
  } catch {}

  console.log("  ⏳ Submitting spawn transaction...");
  const spawnTx  = await spawner.spawnAgent(agentInput, { gasLimit: 2_000_000 });
  const receipt  = await spawnTx.wait();

  console.log("\n  🎉 AGENT SPAWNED — GENESIS 1000!");
  console.log("  ─────────────────────────────────────────────────");
  console.log("  Tx hash:    ", spawnTx.hash);
  console.log("  Block:      ", receipt.blockNumber);
  console.log("  Timestamp:  ", new Date().toISOString());
  console.log("  Contract:   ", SPAWNER_ADDRESS);
  console.log("  Explorer:   ", "https://explorer.ritualfoundation.org/tx/" + spawnTx.hash);
  console.log("  Agents:     ", "https://agents.ritualfoundation.org");
  console.log("  ─────────────────────────────────────────────────");

  const result = {
    network: "ritual-testnet",
    chainId: CHAIN_ID,
    wallet: address,
    contractAddress: SPAWNER_ADDRESS,
    executorAddress,
    spawnTxHash: spawnTx.hash,
    spawnBlock: receipt.blockNumber,
    spawnTimestamp: new Date().toISOString(),
  };

  fs.writeFileSync(
    path.join(__dirname, "../deployment.json"),
    JSON.stringify(result, null, 2)
  );
  console.log("\n  ✔ Saved to genesis/deployment.json");
  console.log("  ✅ Check your rank at https://agents.ritualfoundation.org\n");
}

main().catch(err => {
  console.error("\n❌ Error:", err.message);
  if (err.data) console.error("   Revert data:", err.data);
  process.exit(1);
});
