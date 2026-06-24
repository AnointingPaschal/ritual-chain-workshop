# Privacy-Preserving AI Bounty Judge — Commit-Reveal Implementation

Extends the workshop's AI Bounty Judge so answers remain hidden during the
submission phase. Participants commit to a hash of their answer; the plaintext
is only revealed after the submission window closes.

---

## Problem

The original workshop contract stored plaintext answers on submission. Because
all on-chain state is public, any later participant could read earlier answers,
improve them, and submit an enhanced version before the deadline. This breaks
the fairness property of a bounty competition.

## Solution: Commit-Reveal

A two-phase protocol ensures no answer is visible until everyone has committed:

1. **Commit phase** — participants submit `keccak256(answer, salt, sender, bountyId)`.
   No plaintext reaches the chain.
2. **Reveal phase** — participants publish their answer and salt. The contract
   verifies the hash matches. Only matching reveals are eligible for judging.

Including `msg.sender` and `bountyId` in the hash prevents an attacker from
copying another participant's commitment and revealing it as their own.

---

## Bounty Lifecycle

```
createBounty()
      │
      ▼
  [ OPEN ]  ──── Participants call submitCommitment() ─────────────────┐
      │                                                                 │
  submissionDeadline passes                                             │
      │                                                                 │
      ▼                                                                 │
[ REVEALING ]  ── Participants call revealAnswer() ────────────────────┤
      │                                                                 │
  revealDeadline passes                                                 │
      │                                                                 │
      ▼                                                                 │
  Owner calls judgeAll()  →  Ritual AI evaluates all eligible answers  │
      │                       in ONE batch request                      │
      │                                                                 │
  Ritual coordinator calls receiveJudgingResult()                      │
      │                                                                 │
      ▼                                                                 │
 [ JUDGING ]  ── Owner calls finalizeWinner(winnerIndex)               │
      │                                                                 │
      ▼                                                                 │
[ FINALIZED ]  ── ETH reward sent to winner ◄──────────────────────────┘
```

---

## Key Functions

### `createBounty(submissionDeadline, revealDeadline) payable → bountyId`
Owner creates a bounty, locking ETH as the reward. Sets two deadlines:
- `submissionDeadline` — end of the commit phase.
- `revealDeadline` — end of the reveal phase.

### `submitCommitment(bountyId, commitment)`
Called during the commit phase. The participant computes:
```solidity
bytes32 commitment = keccak256(
    abi.encodePacked(answer, salt, msg.sender, bountyId)
);
```
Only the hash is stored — no answer is visible on-chain.

### `revealAnswer(bountyId, answer, salt)`
Called after `submissionDeadline` and before `revealDeadline`. The contract
re-computes the hash and marks the submission as eligible only if it matches.
Invalid reveals are still recorded for audit purposes but are not judged.

### `judgeAll(bountyId, llmInput)`
Called by the owner after `revealDeadline`. All eligible answers are collected
into a single batch and sent to Ritual AI in one request. The rubric / judging
criteria are passed via `llmInput`.

**Why one batch call?**
Calling the LLM once per answer would be expensive and prevents the model from
comparing answers against each other. A single batch call is both cheaper and
produces a fairer ranking.

### `receiveJudgingResult(bountyId, judgingOutput)`
Callback from the Ritual coordinator. Marks the bounty as judged so the owner
can finalize.

### `finalizeWinner(bountyId, winnerIndex)`
Human-in-the-loop step: the owner confirms the AI's recommended winner (by
index into the eligible list). The ETH reward is transferred to the winner.

---

## Deadline Rules Summary

| Action | When |
|--------|------|
| `submitCommitment` | `block.timestamp < submissionDeadline` |
| `revealAnswer` | `submissionDeadline ≤ block.timestamp < revealDeadline` |
| `judgeAll` | `block.timestamp ≥ revealDeadline` |
| `finalizeWinner` | After Ritual callback sets `judged = true` |

### Additional constraints
- One commitment per participant per bounty (prevents spam).
- A participant without a commitment cannot reveal.
- A participant can reveal only once.
- Unrevealed commitments are ineligible for judging.
- Only the bounty owner may call `judgeAll` and `finalizeWinner`.
- Only the Ritual coordinator may call `receiveJudgingResult`.
- Only one winner receives the reward.

---

## Off-Chain: Computing a Commitment

```javascript
const { ethers } = require("ethers");

async function computeCommitment(answer, salt, senderAddress, bountyId) {
    return ethers.utils.solidityKeccak256(
        ["string", "bytes32", "address", "uint256"],
        [answer, salt, senderAddress, bountyId]
    );
}

// Generate a cryptographically random salt
const salt = ethers.utils.randomBytes(32);
const commitment = await computeCommitment(
    "My bounty answer here",
    salt,
    wallet.address,
    0  // bountyId
);
```

**Keep your salt secret until the reveal phase.** If you lose it, you cannot
reveal your answer and will be ineligible to win.

---

## Ritual Integration

The contract supports two deployment modes:

**Generic EVM + Infernet (async)**
Set `ritualCoordinator` to the Infernet Coordinator contract address.
`judgeAll()` dispatches an off-chain compute request; the Infernet node
calls `receiveJudgingResult()` asynchronously when the LLM finishes.

**Ritual Chain (synchronous)**
Set `ritualCoordinator` to `address(0x0800)` (LLM precompile).
`judgeAll()` calls the precompile inline — the result is returned in the
same transaction; no callback is needed.

---

## Running Tests

```bash
# Install Foundry if needed
curl -L https://foundry.paradigm.xyz | bash && foundryup

# Clone and test
git clone https://github.com/YOUR_FORK/ritual-chain-workshop
cd ritual-chain-workshop
forge install
forge test --match-contract CommitRevealBountyJudgeTest -vv
```

---

## Security Notes

- **Salt strength**: use at least 32 bytes of randomness. Weak salts allow
  brute-force preimage attacks against short or predictable answers.
- **Reward lock**: ETH is locked in the contract; the owner cannot withdraw
  it until a winner is finalized.
- **No auto-pay from AI output**: the AI recommends a winner index; the
  owner must explicitly confirm via `finalizeWinner`. This prevents
  unexpected payouts if the LLM output is malformed.
