/**
 * encode-agent.js
 * Builds the 25-field ABI-encoded agentInput for Ritual's
 * Persistent Agent precompile (0x0820).
 *
 * Run:  node genesis/scripts/encode-agent.js
 * Copy the output into deploy-and-spawn.js as AGENT_INPUT.
 */

const { ethers } = require("ethers");

// ── Agent Configuration ─────────────────────────────────────────────────────
// Edit these values before running.
const CONFIG = {
  // Field 0: Version (always 1 for now)
  version: 1,

  // Field 1: Human-readable name (shows on agents.ritualfoundation.org)
  name: "BountyJudgeAgent",

  // Field 2: Description
  description: "Privacy-preserving AI bounty judge agent — Genesis 1000",

  // Field 3: LLM model to use (gpt-4o, claude-3-5-sonnet, llama-3-70b, etc.)
  model: "gpt-4o",

  // Field 4: CLI type (0=chat, 1=code, 2=agent)
  cliType: 2,

  // Field 5: System prompt — what the agent does
  prompt: `You are an on-chain bounty judge. When called, evaluate submitted 
answers for the active bounty and return a JSON ranking with scores and reasons. 
Format: {"winnerIndex": N, "ranking": [{"index": N, "score": N, "reason": "..."}]}`,

  // Field 6: Tools available to the agent (empty for minimal spawn)
  tools: "[]",

  // Field 7: Max output tokens per response
  maxTokens: 1000,

  // Field 8: Temperature (0-100, maps to 0.0-1.0)
  temperature: 30,

  // Field 9: Stream output (false for bounty judge)
  streamOutput: false,

  // Field 10: Save conversation history
  saveHistory: true,

  // Field 11: Max history messages to retain
  maxHistoryMessages: 10,

  // Field 12: Heartbeat interval in blocks (agent pings chain to prove liveness)
  heartbeatInterval: 100,

  // Field 13: Max retries on failure
  maxRetries: 3,

  // Field 14: Budget token address (zero = native RITUAL)
  budgetToken: ethers.ZeroAddress,

  // Field 15: daConfig — Data Availability config
  // Format: "ipfs" | "arweave" | "celestia" | "none"
  // For minimal spawn, "none" works. For production use "ipfs".
  daConfig: "none",

  // Field 16: soulRef — IPFS CID or storage ref of agent's Docker image/code
  // For minimal genesis spawn, use an empty string or a placeholder CID.
  // For a real agent, upload your Docker image to IPFS and put the CID here.
  soulRef: "",

  // Field 17: memoryRef — IPFS CID of initial memory/knowledge base (optional)
  memoryRef: "",

  // Field 18: restoreFromCid — Leave empty for first spawn. Used for revival.
  restoreFromCid: "",

  // Field 19: encryptedSecrets — AES-encrypted secrets for the agent (optional)
  // Format: hex string. Leave empty if no secrets needed.
  encryptedSecrets: "0x",

  // Field 20: autoRevive — agent revives itself from last checkpoint if it crashes
  autoRevive: true,

  // Field 21: maxBudget — max RITUAL the agent can spend (in wei)
  // 0.01 RITUAL = enough for basic activity
  maxBudget: ethers.parseEther("0.01"),

  // Field 22: callbackGasLimit — gas for phase-2 callback
  callbackGasLimit: 500_000,

  // Field 23: owner — who controls this agent (your wallet address)
  // IMPORTANT: Replace with YOUR wallet address
  agentOwner: process.env.WALLET_ADDRESS || "0x0000000000000000000000000000000000000000",

  // Field 24: tags — for discoverability on agents.ritualfoundation.org
  tags: "bounty,judge,genesis",
};

// ── Encode ──────────────────────────────────────────────────────────────────

function encodeAgentInput(cfg) {
  // The 25-field ABI encoding for the Persistent Agent precompile
  // Fields are encoded as a tuple using abi.encode
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    [
      "uint256",  // 0: version
      "string",   // 1: name
      "string",   // 2: description
      "string",   // 3: model
      "uint8",    // 4: cliType
      "string",   // 5: prompt
      "string",   // 6: tools
      "uint256",  // 7: maxTokens
      "uint256",  // 8: temperature
      "bool",     // 9: streamOutput
      "bool",     // 10: saveHistory
      "uint256",  // 11: maxHistoryMessages
      "uint256",  // 12: heartbeatInterval
      "uint256",  // 13: maxRetries
      "address",  // 14: budgetToken
      "string",   // 15: daConfig
      "string",   // 16: soulRef
      "string",   // 17: memoryRef
      "string",   // 18: restoreFromCid
      "bytes",    // 19: encryptedSecrets
      "bool",     // 20: autoRevive
      "uint256",  // 21: maxBudget
      "uint256",  // 22: callbackGasLimit
      "address",  // 23: agentOwner
      "string",   // 24: tags
    ],
    [
      cfg.version,
      cfg.name,
      cfg.description,
      cfg.model,
      cfg.cliType,
      cfg.prompt,
      cfg.tools,
      cfg.maxTokens,
      cfg.temperature,
      cfg.streamOutput,
      cfg.saveHistory,
      cfg.maxHistoryMessages,
      cfg.heartbeatInterval,
      cfg.maxRetries,
      cfg.budgetToken,
      cfg.daConfig,
      cfg.soulRef,
      cfg.memoryRef,
      cfg.restoreFromCid,
      cfg.encryptedSecrets,
      cfg.autoRevive,
      cfg.maxBudget,
      cfg.callbackGasLimit,
      cfg.agentOwner,
      cfg.tags,
    ]
  );

  return encoded;
}

const encoded = encodeAgentInput(CONFIG);

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  Ritual Persistent Agent — Encoded Input");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
console.log("Agent name:     ", CONFIG.name);
console.log("Model:          ", CONFIG.model);
console.log("Owner:          ", CONFIG.agentOwner);
console.log("Encoded length: ", encoded.length, "bytes\n");
console.log("AGENT_INPUT (paste into deploy-and-spawn.js):");
console.log("─".repeat(50));
console.log(encoded);
console.log("─".repeat(50));
console.log("\n⚠  Remember to set WALLET_ADDRESS env var or edit agentOwner above.");
console.log("⚠  Set soulRef to your Docker image IPFS CID before production use.\n");

module.exports = { encodeAgentInput, CONFIG };
