/**
 * encode-agent.js — Correct 25-field encoding for Ritual Persistent Agent (0x0820)
 */

const { ethers } = require("ethers");

// Callback selector: onPersistentAgentResult(bytes32,bytes) = 0x31dfa1fc
const CALLBACK_SELECTOR = ethers.id("onPersistentAgentResult(bytes32,bytes)").slice(0, 10);

// StorageRef("none","","") — minimal, no external storage needed for Genesis
const NONE_REF = ["none", "", ""];

// 25-field type array (must match exactly what the precompile expects)
const FIELD_TYPES = [
  "address",                    // 0:  executor
  "uint256",                    // 1:  ttl
  "bytes",                      // 2:  userPublicKey
  "uint64",                     // 3:  minHeartbeatInterval
  "uint64",                     // 4:  maxHeartbeatInterval
  "string",                     // 5:  pollingStr
  "address",                    // 6:  callbackAddr
  "bytes4",                     // 7:  callbackSelector
  "uint256",                    // 8:  callbackGasLimit
  "uint256",                    // 9:  maxFeePerGas
  "uint256",                    // 10: maxPriorityFeePerGas
  "uint16",                     // 11: provider (0=anthropic)
  "string",                     // 12: model
  "bytes",                      // 13: encryptedSecrets
  "tuple(string,string,string)",// 14: systemPrompt StorageRef
  "tuple(string,string,string)",// 15: daConfig StorageRef      ← KEY
  "tuple(string,string,string)",// 16: soulRef StorageRef        ← KEY
  "tuple(string,string,string)",// 17: memoryRef StorageRef      ← KEY
  "string[]",                   // 18: skills
  "string[]",                   // 19: tools
  "uint16",                     // 20: maxTurns
  "uint32",                     // 21: maxTokens
  "string",                     // 22: rpcUrls
  "string",                     // 23: restoreFromCid ("" = fresh spawn) ← KEY
  "string",                     // 24: tags
];

function buildAgentInput(spawnerAddress, executorAddress) {
  const values = [
    executorAddress,                           // 0: executor
    30n,                                       // 1: ttl (30 blocks)
    "0x",                                      // 2: userPublicKey (no encryption)
    10n,                                       // 3: minHeartbeatInterval
    200n,                                      // 4: maxHeartbeatInterval
    "",                                        // 5: pollingStr
    spawnerAddress,                            // 6: callbackAddr
    CALLBACK_SELECTOR,                         // 7: callbackSelector (0x31dfa1fc)
    500000n,                                   // 8: callbackGasLimit
    ethers.parseUnits("20", "gwei"),           // 9: maxFeePerGas
    ethers.parseUnits("2",  "gwei"),           // 10: maxPriorityFeePerGas
    0,                                         // 11: provider (0=anthropic)
    "claude-3-5-sonnet",                       // 12: model
    "0x",                                      // 13: encryptedSecrets (none)
    NONE_REF,                                  // 14: systemPrompt
    NONE_REF,                                  // 15: daConfig
    NONE_REF,                                  // 16: soulRef
    NONE_REF,                                  // 17: memoryRef
    [],                                        // 18: skills
    [],                                        // 19: tools
    1,                                         // 20: maxTurns
    1000,                                      // 21: maxTokens
    "",                                        // 22: rpcUrls
    "",                                        // 23: restoreFromCid (fresh spawn)
    "bounty,judge,genesis",                    // 24: tags
  ];

  return ethers.AbiCoder.defaultAbiCoder().encode(FIELD_TYPES, values);
}

if (require.main === module) {
  const spawner  = process.env.SPAWNER_ADDRESS || "0xdaC0e77d9b0769BA67a7bB49C3aB0E96dd9b14D6";
  const executor = process.env.EXECUTOR_ADDRESS || ethers.ZeroAddress;

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Ritual Genesis — 25-Field Persistent Agent Encoding");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const encoded = buildAgentInput(spawner, executor);
  console.log("Spawner:          ", spawner);
  console.log("Executor:         ", executor);
  console.log("Callback selector:", CALLBACK_SELECTOR);
  console.log("Encoded length:   ", encoded.length / 2 - 1, "bytes\n");
  console.log("AGENT_INPUT:");
  console.log(encoded, "\n");
}

module.exports = { buildAgentInput, CALLBACK_SELECTOR, FIELD_TYPES };
