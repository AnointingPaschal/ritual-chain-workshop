/**
 * encode-agent.js
 * ───────────────
 * Builds the 23-field ABI-encoded agentInput for Ritual's
 * SOVEREIGN AGENT precompile (0x080C).
 *
 * This is the PROVEN path for Genesis 1000 — confirmed by entries
 * #002 (CRASHLOCUST), #004 (BRIAR_SHELL), #009 (PANIC_ROOT).
 * All used Sovereign Agent, not Persistent Agent.
 *
 * 23-FIELD LAYOUT (confirmed from Ritual docs TypeScript example):
 *
 *  0:  executor         address            TEE executor from TEEServiceRegistry
 *  1:  ttl              uint256            blocks until job expires
 *  2:  userPublicKey    bytes              ECIES pubkey ("0x" = no encryption)
 *  3:  minInterval      uint64             min heartbeat interval (blocks)
 *  4:  maxInterval      uint64             max heartbeat interval (blocks)
 *  5:  pollingStr       string             polling config (empty)
 *  6:  callbackAddr     address            this contract (receives Phase 2)
 *  7:  callbackSelector bytes4             onSovereignAgentResult = 0x8ca12055
 *  8:  callbackGas      uint256            gas for Phase 2 callback
 *  9:  maxFeePerGas     uint256            max fee per gas
 * 10:  maxPriority      uint256            max priority fee
 * 11:  cliType          uint16             0=Claude Code, 1=other
 * 12:  prompt           string             the agent's mission
 * 13:  encryptedSecrets bytes              ECIES-encrypted API keys ("0x")
 * 14:  convoHistory     (str,str,str)      StorageRef — ("none","","")
 * 15:  output           (str,str,str)      StorageRef — ("none","","")
 * 16:  skills           (str,str,str)[]    StorageRef[] — []
 * 17:  systemPrompt     (str,str,str)      StorageRef — ("none","","")
 * 18:  model            string             LLM model
 * 19:  tools            string[]           tool names — []
 * 20:  maxTurns         uint16             max conversation turns
 * 21:  maxTokens        uint32             max tokens per turn
 * 22:  rpcUrls          string             RPC URLs for agent
 */

const { ethers } = require("ethers");

// Callback: onSovereignAgentResult(bytes32,bytes) = 0x8ca12055
const CALLBACK_SELECTOR = ethers.id("onSovereignAgentResult(bytes32,bytes)").slice(0, 10);

// StorageRef("none","","") — no external storage for minimal spawn
const NONE_REF = ["none", "", ""];

// 23-field type array — CONFIRMED from Ritual docs
const FIELD_TYPES = [
  "address",                     // 0:  executor
  "uint256",                     // 1:  ttl
  "bytes",                       // 2:  userPublicKey
  "uint64",                      // 3:  minInterval
  "uint64",                      // 4:  maxInterval
  "string",                      // 5:  pollingStr
  "address",                     // 6:  callbackAddr
  "bytes4",                      // 7:  callbackSelector
  "uint256",                     // 8:  callbackGas
  "uint256",                     // 9:  maxFeePerGas
  "uint256",                     // 10: maxPriority
  "uint16",                      // 11: cliType
  "string",                      // 12: prompt
  "bytes",                       // 13: encryptedSecrets
  "tuple(string,string,string)", // 14: convoHistory StorageRef
  "tuple(string,string,string)", // 15: output StorageRef
  "tuple(string,string,string)[]", // 16: skills StorageRef[]
  "tuple(string,string,string)", // 17: systemPrompt StorageRef
  "string",                      // 18: model
  "string[]",                    // 19: tools
  "uint16",                      // 20: maxTurns
  "uint32",                      // 21: maxTokens
  "string",                      // 22: rpcUrls
];

// Chess Tournament Judge prompt — tight, purposeful, Genesis-worthy
const AGENT_PROMPT = `You are an autonomous Chess Tournament Judge running on Ritual Chain.

Your mission:
1. Monitor the CommitRevealBountyJudge contract for active chess bounties.
2. After the reveal deadline, collect all revealed chess game submissions.
3. Use the Ritual LLM precompile to analyze each game fairly — evaluate opening theory, middlegame tactics, endgame technique, and overall move quality.
4. Rank submissions objectively with scores and reasons. No human bias.
5. Call judgeAll() to submit the batch ranking on-chain.
6. Finalize the winner and trigger the ETH payout via the bounty contract.
7. Post a heartbeat every 100 blocks to prove liveness. Revive from last checkpoint if crashed.

Output format: {"winnerIndex": N, "ranking": [{"index": N, "score": N, "reason": "..."}], "summary": "..."}`;

function buildAgentInput(spawnerAddress, executorAddress) {
  const values = [
    executorAddress,                        // 0:  executor
    30n,                                    // 1:  ttl (30 blocks)
    "0x",                                   // 2:  userPublicKey
    10n,                                    // 3:  minInterval (10 blocks)
    200n,                                   // 4:  maxInterval (200 blocks)
    "",                                     // 5:  pollingStr
    spawnerAddress,                         // 6:  callbackAddr
    CALLBACK_SELECTOR,                      // 7:  0x8ca12055
    500000n,                                // 8:  callbackGas
    ethers.parseUnits("20", "gwei"),        // 9:  maxFeePerGas
    ethers.parseUnits("2",  "gwei"),        // 10: maxPriority
    0,                                      // 11: cliType (0=Claude Code)
    AGENT_PROMPT,                           // 12: prompt
    "0x",                                   // 13: encryptedSecrets
    NONE_REF,                               // 14: convoHistory
    NONE_REF,                               // 15: output
    [],                                     // 16: skills (empty)
    NONE_REF,                               // 17: systemPrompt
    "claude-3-5-sonnet",                    // 18: model
    [],                                     // 19: tools (empty)
    5,                                      // 20: maxTurns
    2000,                                   // 21: maxTokens
    "",                                     // 22: rpcUrls
  ];

  return ethers.AbiCoder.defaultAbiCoder().encode(FIELD_TYPES, values);
}

if (require.main === module) {
  const spawner  = process.env.SPAWNER_ADDRESS || "0x0000000000000000000000000000000000000000";
  const executor = process.env.EXECUTOR_ADDRESS || ethers.ZeroAddress;

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Chess Tournament Judge — Sovereign Agent Encoding");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log("Precompile:        0x080C (Sovereign Agent — PROVEN for Genesis)");
  console.log("Callback selector: 0x8ca12055 (onSovereignAgentResult)");
  console.log("Model:             claude-3-5-sonnet");
  console.log("cliType:           0 (Claude Code)\n");

  const encoded = buildAgentInput(spawner, executor);
  console.log("Encoded length:", encoded.length / 2 - 1, "bytes\n");
  console.log("AGENT_INPUT:");
  console.log(encoded, "\n");
}

module.exports = { buildAgentInput, CALLBACK_SELECTOR, FIELD_TYPES, AGENT_PROMPT };
