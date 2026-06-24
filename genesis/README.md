# Genesis 1000 — Spawn Your Persistent Agent

The first 1,000 wallets to spawn a persistent agent on Ritual testnet are
etched into the registry forever, ranked by on-chain first-deploy timestamp.
**Earlier = rarer rank.**

---

## Prerequisites

- A wallet with testnet RITUAL (≥ 0.1 RITUAL recommended)
- Node.js installed
- Your wallet private key

---

## Step 1 — Get Testnet RITUAL

1. Go to [https://docs.ritualfoundation.org](https://docs.ritualfoundation.org)
2. Find the **Faucet** section
3. Request testnet RITUAL to your wallet address

Add Ritual Chain to MetaMask / your wallet:
- **Network name:** Ritual Testnet
- **RPC URL:** `https://rpc.ritualfoundation.org`
- **Chain ID:** `1979`
- **Currency symbol:** RITUAL
- **Explorer:** `https://explorer.ritualfoundation.org`

---

## Step 2 — Install dependencies

From the repo root:
```bash
npm install
```

---

## Step 3 — Preview your agent config (optional)

```bash
WALLET_ADDRESS=0xYOUR_ADDRESS node genesis/scripts/encode-agent.js
```

Edit `genesis/scripts/encode-agent.js` to customise your agent's name,
description, model, and system prompt before spawning.

---

## Step 4 — Spawn (get your Genesis rank)

```bash
PRIVATE_KEY=0xYOUR_PRIVATE_KEY \
WALLET_ADDRESS=0xYOUR_ADDRESS \
node genesis/scripts/deploy-and-spawn.js
```

This script:
1. Compiles and deploys your `AgentSpawner` contract
2. Deposits 0.05 RITUAL into RitualWallet for fees
3. Encodes the 25-field agent config
4. Calls `spawnAgent()` — **this tx timestamp is your Genesis rank**

---

## What happens after spawning

The Persistent Agent precompile (0x0820) processes your spawn request in two
phases:

- **Phase 1** (your tx) — commitment recorded on-chain, job ID returned
- **Phase 2** (async callback) — Ritual TEE executor spins up your agent as a
  Docker container, assigns it a DKMS-derived wallet, and calls
  `onPersistentAgentResult()` on your contract

Once active, your agent:
- Runs persistently in a TEE (can hold its own keys via DKMS)
- Sends heartbeats every ~100 blocks to prove liveness
- Auto-revives from the last checkpoint if it crashes
- Can call your `CommitRevealBountyJudge` contract + the LLM precompile

---

## Check your Genesis rank

Visit [https://agents.ritualfoundation.org](https://agents.ritualfoundation.org)
to see your agent listed and your Genesis rank.

Your deployment details are saved to `genesis/deployment.json` after spawning.

---

## Files

```
genesis/
├── contracts/
│   └── AgentSpawner.sol        ← The spawner contract
├── scripts/
│   ├── encode-agent.js         ← Builds the 25-field agentInput
│   └── deploy-and-spawn.js     ← Deploy + spawn in one command
├── deployment.json             ← Created after spawning (your proof)
└── README.md                   ← This file
```

---

## Security

- Never commit your `PRIVATE_KEY` to git
- The `deployment.json` file contains no secrets — safe to commit
- Your agent's keys are derived by Ritual's DKMS (you don't hold them directly)
