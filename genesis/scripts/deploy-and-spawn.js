/**
 * deploy-and-spawn.js
 * ───────────────────
 * Deploys ChessTournamentAgent and spawns a Sovereign Agent on Ritual Chain.
 * Uses precompile 0x080C — the PROVEN path for Genesis 1000.
 *
 * Usage:
 *   PRIVATE_KEY=0x... node genesis/scripts/deploy-and-spawn.js
 */

const { ethers } = require("ethers");
const fs   = require("fs");
const path = require("path");
const solc = require("solc");
const { buildAgentInput } = require("./encode-agent.js");

const RITUAL_RPC   = "https://rpc.ritualfoundation.org";
const CHAIN_ID     = 1979;
const TEE_REGISTRY = "0x9644e8562cE0Fe12b4deeC4163c064A8862Bf47F";
const RITUAL_WALLET = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948";
const FEE_DEPOSIT  = ethers.parseEther("0.05");

const TEE_ABI = [
  "function getExecutors() external view returns (address[])",
];
const WALLET_ABI = [
  "function deposit(uint256 lockDuration) external payable",
];

const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error("\n❌  Set PRIVATE_KEY:  export PRIVATE_KEY=0x...\n");
  process.exit(1);
}

function compile() {
  const src = fs.readFileSync(
    path.join(__dirname, "../contracts/ChessTournamentAgent.sol"), "utf8"
  );
  const out = JSON.parse(solc.compile(JSON.stringify({
    language: "Solidity",
    sources: { "ChessTournamentAgent.sol": { content: src } },
    settings: { outputSelection: { "*": { "*": ["abi","evm.bytecode"] } } },
  })));
  const errs = (out.errors||[]).filter(e => e.severity==="error");
  if (errs.length) { errs.forEach(e => console.error(e.formattedMessage)); throw new Error("Compile failed"); }
  const c = out.contracts["ChessTournamentAgent.sol"]["ChessTournamentAgent"];
  return { abi: c.abi, bytecode: "0x" + c.evm.bytecode.object };
}

async function main() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Chess Tournament Judge — Genesis 1000 Spawn");
  console.log("  Sovereign Agent (0x080C) — same path as #002, #004, #009");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const provider = new ethers.JsonRpcProvider(RITUAL_RPC, { chainId: CHAIN_ID, name: "ritual" });
  const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);

  const balance = await provider.getBalance(wallet.address);
  console.log("Wallet:  ", wallet.address);
  console.log("Balance: ", ethers.formatEther(balance), "RITUAL\n");

  if (balance < ethers.parseEther("0.1")) {
    console.error("❌  Need at least 0.1 RITUAL. Get from faucet.ritualfoundation.org\n");
    process.exit(1);
  }

  // Step 1: Compile
  console.log("▶ Step 1/4  Compiling ChessTournamentAgent...");
  const { abi, bytecode } = compile();
  console.log("  ✔ Compiled\n");

  // Step 2: Deploy
  console.log("▶ Step 2/4  Deploying ChessTournamentAgent...");
  const factory  = new ethers.ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();
  console.log("  ✔ Deployed:", contractAddress);
  console.log("    https://explorer.ritualfoundation.org/address/" + contractAddress + "\n");

  // Step 3: Deposit fees
  console.log("▶ Step 3/4  Depositing fees into RitualWallet...");
  const rw = new ethers.Contract(RITUAL_WALLET, WALLET_ABI, wallet);
  const depTx = await rw.deposit(0, { value: FEE_DEPOSIT });
  await depTx.wait();
  console.log("  ✔ Deposited", ethers.formatEther(FEE_DEPOSIT), "RITUAL\n");

  // Step 4: Get executor + spawn
  console.log("▶ Step 4/4  SPAWNING Chess Tournament Judge Agent...");

  let executorAddress;
  try {
    const reg = new ethers.Contract(TEE_REGISTRY, TEE_ABI, provider);
    const execs = await reg.getExecutors();
    executorAddress = execs[0];
    console.log("  ✔ Executor:", executorAddress);
  } catch {
    executorAddress = "0x0000000000000000000000000000000000000001";
    console.log("  ⚠ Using fallback executor:", executorAddress);
  }

  const agentInput = buildAgentInput(contractAddress, executorAddress);
  console.log("  ✔ Encoded", agentInput.length / 2 - 1, "bytes");
  console.log("  ⏳ Sending spawn transaction...\n");

  const agent  = new ethers.Contract(contractAddress, abi, wallet);
  const spawnTx = await agent.spawnAgent(agentInput, { gasLimit: 2_000_000 });
  const receipt  = await spawnTx.wait();

  console.log("  🎉 CHESS TOURNAMENT JUDGE SPAWNED — GENESIS 1000!");
  console.log("  ─────────────────────────────────────────────────");
  console.log("  Tx hash:  ", spawnTx.hash);
  console.log("  Block:    ", receipt.blockNumber);
  console.log("  Contract: ", contractAddress);
  console.log("  Explorer: ", "https://explorer.ritualfoundation.org/tx/" + spawnTx.hash);
  console.log("  Agents:   ", "https://agents.ritualfoundation.org");
  console.log("  ─────────────────────────────────────────────────\n");

  const result = {
    network: "ritual-testnet",
    chainId: CHAIN_ID,
    wallet: wallet.address,
    contractAddress,
    executorAddress,
    agentType: "Sovereign Agent (0x080C)",
    agentName: "Chess Tournament Judge",
    spawnTxHash: spawnTx.hash,
    spawnBlock: receipt.blockNumber,
    spawnTimestamp: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(__dirname, "../deployment.json"), JSON.stringify(result, null, 2));
  console.log("  ✔ Saved to genesis/deployment.json");
  console.log("  ✅ Check your rank at https://agents.ritualfoundation.org\n");
}

main().catch(err => {
  console.error("\n❌ Error:", err.message);
  if (err.data) console.error("   Revert data:", err.data);
  process.exit(1);
});
