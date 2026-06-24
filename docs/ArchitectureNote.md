# Architecture Note: Commit-Reveal vs Ritual-Native Hidden Submissions

## Overview

Both approaches solve the same fairness problem — preventing participants from
reading each other's answers before the deadline — but they differ fundamentally
in *when* answers become visible and *who* can see them.

---

## Approach A: Commit-Reveal (Required Track)

### How it works

Participants submit a cryptographic hash of their answer during the submission
phase. After the deadline, they reveal the plaintext. The contract verifies the
hash matches before treating the answer as eligible.

### Where plaintext answers exist

```
Phase         |  On-chain state          |  Who can read the answer
──────────────|──────────────────────────|─────────────────────────
Commit phase  |  keccak256 hash only     |  Nobody — hash is one-way
Reveal phase  |  Plaintext stored        |  Everyone (public chain)
After judging |  Plaintext stored        |  Everyone
```

### What is stored on-chain vs off-chain

| Data | Location |
|------|----------|
| Commitment hash | On-chain (submission phase) |
| Plaintext answer | On-chain (after reveal) |
| Salt | On-chain (after reveal, for auditability) |
| LLM judging output | Off-chain (only a hash stored on-chain) |

### How the LLM receives submissions

After the reveal deadline, `judgeAll()` reads all eligible revealed answers
from contract storage, encodes them as a batch alongside the rubric, and sends
them to the Ritual AI node in a single request. The LLM compares all answers
at once rather than scoring them individually.

### Limitations

1. **Answers become public before AI judging.** Between the reveal deadline and
   the moment the AI result is delivered, anyone can read all revealed answers
   on-chain. A very fast participant could theoretically submit a revised answer
   to *another* bounty that reuses the revealed ideas (cross-bounty copying).

2. **Requires active participation in two phases.** Participants who forget to
   reveal forfeit their chance to win, even if their committed answer was the
   best.

3. **Works on any EVM chain** — no special infrastructure required beyond the
   Ritual Infernet Coordinator contract.

### Sequence diagram

```
  Participant         Contract            Ritual AI
      │                   │                   │
  commit phase:           │                   │
      │──submitCommit()──▶│                   │
      │  (hash only)      │                   │
      │                   │                   │
  after subDeadline:      │                   │
      │──revealAnswer()──▶│                   │
      │  (plaintext now   │                   │
      │   visible)        │                   │
      │                   │                   │
  owner (after revDeadline):                  │
      │──judgeAll()──────▶│──batch request───▶│
      │                   │                   │ (LLM evaluates)
      │                   │◀─callback─────────│
      │                   │ receiveJudging()  │
      │──finalizeWinner()▶│                   │
      │                   │──ETH to winner───▶│
```

---

## Approach B: Ritual-Native Hidden Submissions (Advanced Track)

### How it works

Participants encrypt their answers using the public key of a Ritual TEE
(Trusted Execution Environment) executor. Only the encrypted ciphertext is
stored on-chain. When `judgeAll()` is called, the TEE executor decrypts all
submissions privately inside the secure enclave, feeds them to the LLM in a
single batch, and returns only the result. Answers remain hidden until judging
is complete.

### Where plaintext answers exist

```
Phase          |  On-chain state           |  Plaintext location
───────────────|───────────────────────────|─────────────────────
Submit phase   |  Encrypted ciphertext     |  Participant's device only
Judging phase  |  Encrypted ciphertext     |  TEE enclave only (private)
After judging  |  Revealed bundle hash     |  IPFS / off-chain store
```

### What is stored on-chain vs off-chain

| Data | Location | Why |
|------|----------|-----|
| Encrypted answer | On-chain (or hash + IPFS ref) | Commitment to submission; small blobs on-chain, large ones off-chain |
| TEE executor's public key | On-chain (TEEServiceRegistry) | So participants know which key to encrypt to |
| LLM judging output + answers bundle | Off-chain (IPFS / storage) | Gas cost — large text blobs are expensive to store on-chain |
| Hash of revealed bundle | On-chain | Allows anyone to verify the off-chain bundle hasn't been tampered with |
| `winnerIndex` | On-chain | Compact; drives the ETH payout |

**On Ritual Chain**, encrypted secrets can be stored via the Secrets precompile
(`address(0x0802)`), eliminating the need for IPFS for the encryption key
material.

### How the LLM receives submissions

1. `judgeAll()` is called on-chain.
2. The Ritual TEE executor picks up the request.
3. Inside the secure enclave:
   - It decrypts each submission using the TEE's private key.
   - It concatenates all plaintexts into one prompt.
   - It calls the LLM once with the full batch.
   - It produces a result `{ winnerIndex, ranking, revealedAnswersRef, revealedAnswersHash }`.
4. The TEE publishes the plaintext answers bundle to IPFS and stores the hash
   on-chain.
5. The contract receives the winner index and marks the bounty as judged.

The LLM never sees individual answers in isolation — it always receives the
full batch, enabling fair comparative ranking.

### Example final output shape (from PDF spec)

```json
{
  "winnerIndex": 2,
  "ranking": [
    { "index": 2, "score": 94, "reason": "Best satisfies the rubric." },
    { "index": 0, "score": 81, "reason": "Good but less thorough." },
    { "index": 1, "score": 67, "reason": "Partially correct." }
  ],
  "revealedAnswersRef": "ipfs://Qm...",
  "revealedAnswersHash": "0xabc123...",
  "summary": "Submission 2 is the strongest answer."
}
```

### Sequence diagram

```
  Participant         Contract        TEE Executor         LLM
      │                   │                │                │
      │─encrypt(answer,   │                │                │
      │  TEE_pubkey)      │                │                │
      │──submitEncrypted()▶               │                │
      │  (ciphertext)     │                │                │
      │                   │                │                │
  owner (after deadline): │                │                │
      │──judgeAll()──────▶│──request──────▶│                │
      │                   │                │─decrypt all────│
      │                   │                │─batch prompt──▶│
      │                   │                │◀─ranking───────│
      │                   │                │─publish to IPFS│
      │                   │◀─result hash───│                │
      │                   │ (only hash +   │                │
      │                   │  winnerIndex)  │                │
      │──finalizeWinner()▶│                │                │
      │                   │──ETH ─────────────────────────▶│
```

---

## Side-by-Side Comparison

| Property | Commit-Reveal | Ritual-Native TEE |
|----------|--------------|-------------------|
| Answers public during reveal phase? | **Yes** (before judging) | **No** (never, until after judging) |
| Works on any EVM chain? | ✅ Yes | ❌ Requires Ritual |
| Special infrastructure? | Only Infernet Coordinator | TEE executor + Ritual Chain |
| Participant UX complexity | Medium (two tx required) | Low (one encrypted tx) |
| Gas cost | Low (short strings on-chain) | Medium (encrypted blobs or IPFS refs) |
| Verifiability | Hash on-chain; anyone can verify | TEE attestation + IPFS hash |
| Protection against copying | After reveal deadline, answers are public | Never public until judging done |
| Cross-bounty idea copying risk | Possible (answers visible briefly) | Eliminated |
| Human-in-the-loop finalization | ✅ Owner confirms | ✅ Owner confirms |
| Batch LLM judging | ✅ One call per bounty | ✅ One call per bounty inside TEE |

---

## Which Should You Use?

**Use commit-reveal** when:
- Deploying to a chain without Ritual Chain support.
- Simplicity and auditability are the priority.
- The brief window where answers are public before AI judging is an acceptable tradeoff.

**Use Ritual-native TEE** when:
- Maximum privacy is required (answers never touch the public chain).
- You are building on Ritual Chain or connecting via Infernet to a TEE node.
- The bounty is high-value enough to justify the extra infrastructure cost.

---

## Ritual Features Used

| Feature | Commit-Reveal | Ritual-Native |
|---------|--------------|---------------|
| Infernet / LLM precompile | ✅ Batch judging | ✅ Batch judging inside TEE |
| TEE-backed execution | ❌ | ✅ Decrypts submissions privately |
| Encrypted secrets (precompile 0x0802) | ❌ | ✅ Stores encryption key material |
| IPFS / revealed bundle hash | Optional | ✅ Avoid on-chain plaintext storage |
| Human-in-the-loop finalization | ✅ | ✅ |
