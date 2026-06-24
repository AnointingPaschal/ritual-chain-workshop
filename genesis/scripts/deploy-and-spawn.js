/**
 * deploy-and-spawn.js
 * ───────────────────
 * One script to get you into Genesis 1000:
 *   1. Connects to Ritual Chain (ID 1979)
 *   2. Deploys AgentSpawner contract
 *   3. Deposits RITUAL into RitualWallet (for fees)
 *   4. Encodes the 25-field agentInput
 *   5. Calls spawnAgent() ← THIS is your Genesis timestamp
 *
 * Usage:
 *   PRIVATE_KEY=0x... WALLET_ADDRESS=0x... node genesis/scripts/deploy-and-spawn.js
 *
 * Requirements:
 *   - Testnet RITUAL in your wallet (get from faucet)
 *   - node genesis/scripts/encode-agent.js to preview your config first
 */

const { ethers } = require("ethers");
const fs         = require("fs");
const path       = require("path");
const solc       = require("solc");
const { encodeAgentInput, CONFIG } = require("./encode-agent.js");

// ── Config ──────────────────────────────────────────────────────────────────

const RITUAL_RPC      = "https://rpc.ritualfoundation.org";
const CHAIN_ID        = 1979;
const RITUAL_WALLET   = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948";

// Amount of RITUAL to deposit for fees (0.05 RITUAL should cover a spawn)
const FEE_DEPOSIT     = ethers.parseEther("0.05");

// ── Validation ──────────────────────────────────────────────────────────────

const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error("\n❌  Set PRIVATE_KEY env var:  export PRIVATE_KEY=0x...\n");
  process.exit(1);
}

// ── RitualWallet ABI (deposit function only) ────────────────────────────────
const RITUAL_WALLET_ABI = [
  "function deposit(uint256 lockDuration) external payable",
  "function balanceOf(address user) external view returns (uint256)",
];

// ── Compile AgentSpawner ────────────────────────────────────────────────────
function compileAgentSpawner() {
  const src = fs.readFileSync(
    path.join(__dirname, "../contracts/AgentSpawner.sol"),
    "utf8"
  );
  const input = {
    language: "Solidity",
    sources: { "AgentSpawner.sol": { content: src } },
    settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode"] } } },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter(e => e.severity === "error");
  if (errors.length) {
    errors.forEach(e => console.error(e.formattedMessage));
    throw new Error("Compilation failed");
  }
  const contract = output.contracts["AgentSpawner.sol"]["AgentSpawner"];
  return { abi: contract.abi, bytecode: "0x" + contract.evm.bytecode.object };
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Ritual Genesis 1000 — Deploy & Spawn");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // ── Connect ────────────────────────────────────────────────────────────
  const provider = new ethers.JsonRpcProvider(RITUAL_RPC, {
    chainId: CHAIN_ID,
    name: "ritual-testnet",
  });
  const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);
  const address  = wallet.address;

  console.log("Wallet:   ", address);

  const balance = await provider.getBalance(address);
  console.log("Balance:  ", ethers.formatEther(balance), "RITUAL");

  if (balance < FEE_DEPOSIT + ethers.parseEther("0.01")) {
    console.error(`\n❌  Insufficient balance. Need at least ${ethers.formatEther(FEE_DEPOSIT + ethers.parseEther("0.01"))} RITUAL.`);
    console.error("   Get testnet RITUAL from the faucet at https://docs.ritualfoundation.org\n");
    process.exit(1);
  }

  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(CHAIN_ID)) {
    console.error(`\n❌  Wrong network. Expected chain ${CHAIN_ID}, got ${network.chainId}\n`);
    process.exit(1);
  }
  console.log("Network:  ", `Ritual Chain (ID ${CHAIN_ID})\n`);

  // ── Step 1: Compile ────────────────────────────────────────────────────
  console.log("▶ Step 1/5  Compiling AgentSpawner...");
  const { abi, bytecode } = compileAgentSpawner();
  console.log("  ✔ Compiled\n");

  // ── Step 2: Deploy AgentSpawner ────────────────────────────────────────
  console.log("▶ Step 2/5  Deploying AgentSpawner...");
  const factory  = new ethers.ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();
  console.log("  ✔ AgentSpawner deployed at:", contractAddress);
  console.log("    Explorer: https://explorer.ritualfoundation.org/address/" + contractAddress + "\n");

  // ── Step 3: Deposit RITUAL into RitualWallet ───────────────────────────
  console.log("▶ Step 3/5  Depositing fees into RitualWallet...");
  const ritualWallet = new ethers.Contract(RITUAL_WALLET, RITUAL_WALLET_ABI, wallet);
  const depositTx    = await ritualWallet.deposit(
    0,            // lockDuration = 0 (no lock)
    { value: FEE_DEPOSIT }
  );
  await depositTx.wait();
  console.log("  ✔ Deposited", ethers.formatEther(FEE_DEPOSIT), "RITUAL for fees");
  console.log("    Tx:", depositTx.hash + "\n");

  // ── Step 4: Encode agentInput ──────────────────────────────────────────
  console.log("▶ Step 4/5  Encoding 25-field agentInput...");
  // Update the owner field to this wallet
  CONFIG.agentOwner = address;
  const agentInput  = encodeAgentInput(CONFIG);
  console.log("  ✔ Encoded", agentInput.length, "bytes\n");

  // ── Step 5: SPAWN — this is your Genesis timestamp ─────────────────────
  console.log("▶ Step 5/5  SPAWNING AGENT (Genesis 1000 timestamp)...");
  console.log("  ⏳ Sending spawn transaction...");

  const agentContract = new ethers.Contract(contractAddress, abi, wallet);
  const spawnTx       = await agentContract.spawnAgent(agentInput);
  const receipt       = await spawnTx.wait();

  console.log("\n  🎉 AGENT SPAWNED!");
  console.log("  ─────────────────────────────────────────────────");
  console.log("  Tx hash:     ", spawnTx.hash);
  console.log("  Block:       ", receipt.blockNumber);
  console.log("  Timestamp:   ", new Date().toISOString(), "(Genesis rank timestamp)");
  console.log("  Contract:    ", contractAddress);
  console.log("  Explorer:    ", "https://explorer.ritualfoundation.org/tx/" + spawnTx.hash);
  console.log("  Agent view:  ", "https://agents.ritualfoundation.org");
  console.log("  ─────────────────────────────────────────────────");

  // Save deployment info
  const deployInfo = {
    network:         "ritual-testnet",
    chainId:         CHAIN_ID,
    wallet:          address,
    contractAddress,
    spawnTxHash:     spawnTx.hash,
    spawnBlock:      receipt.blockNumber,
    spawnTimestamp:  new Date().toISOString(),
    agentName:       CONFIG.name,
  };

  const outPath = path.join(__dirname, "../deployment.json");
  fs.writeFileSync(outPath, JSON.stringify(deployInfo, null, 2));
  console.log("\n  ✔ Deployment info saved to genesis/deployment.json");
  console.log("\n  ✅ You are now in Genesis 1000 (if rank ≤ 1000)!");
  console.log("     Check your rank at https://agents.ritualfoundation.org\n");
}

main().catch(err => {
  console.error("\n❌ Error:", err.message);
  if (err.data) console.error("   Revert data:", err.data);
  process.exit(1);
});
