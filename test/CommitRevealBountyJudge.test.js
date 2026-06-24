const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * CommitRevealBountyJudge — full test suite
 * Run: npx hardhat test
 */
describe("CommitRevealBountyJudge", function () {
  // ── Fixtures & helpers ──────────────────────────────────────────────────

  let judge;
  let owner, alice, bob, charlie, attacker, coordinator;

  const ONE_DAY = 86400;
  const ONE_ETH = ethers.parseEther("1");

  const ALICE_ANSWER   = "The answer is 42";
  const BOB_ANSWER     = "It depends on the context";
  const CHARLIE_ANSWER = "Use a commit-reveal scheme";

  const ALICE_SALT   = ethers.hexlify(ethers.randomBytes(32));
  const BOB_SALT     = ethers.hexlify(ethers.randomBytes(32));
  const CHARLIE_SALT = ethers.hexlify(ethers.randomBytes(32));

  async function commitment(answer, salt, senderAddr, bountyId) {
    return ethers.solidityPackedKeccak256(
      ["string", "bytes32", "address", "uint256"],
      [answer, salt, senderAddr, bountyId]
    );
  }

  async function createBounty() {
    const now = await time.latest();
    const subDeadline = now + ONE_DAY;
    const revDeadline = now + ONE_DAY * 2;
    const tx = await judge.connect(owner).createBounty(
      subDeadline, revDeadline, { value: ONE_ETH }
    );
    const receipt = await tx.wait();
    const event = receipt.logs
      .map(l => { try { return judge.interface.parseLog(l); } catch { return null; } })
      .find(e => e && e.name === "BountyCreated");
    return { bountyId: event.args.bountyId, subDeadline, revDeadline };
  }

  async function submitAll(bountyId) {
    await judge.connect(alice).submitCommitment(
      bountyId, await commitment(ALICE_ANSWER, ALICE_SALT, alice.address, bountyId)
    );
    await judge.connect(bob).submitCommitment(
      bountyId, await commitment(BOB_ANSWER, BOB_SALT, bob.address, bountyId)
    );
    await judge.connect(charlie).submitCommitment(
      bountyId, await commitment(CHARLIE_ANSWER, CHARLIE_SALT, charlie.address, bountyId)
    );
  }

  async function revealAll(bountyId, subDeadline) {
    await time.increaseTo(subDeadline + 1);
    await judge.connect(alice).revealAnswer(bountyId, ALICE_ANSWER, ALICE_SALT);
    await judge.connect(bob).revealAnswer(bountyId, BOB_ANSWER, BOB_SALT);
    await judge.connect(charlie).revealAnswer(bountyId, CHARLIE_ANSWER, CHARLIE_SALT);
  }

  beforeEach(async function () {
    [owner, alice, bob, charlie, attacker, coordinator] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("CommitRevealBountyJudge");
    judge = await Factory.deploy(coordinator.address);
    await judge.waitForDeployment();
  });

  // ── GROUP 1: Bounty creation ────────────────────────────────────────────

  describe("createBounty", function () {
    it("creates a bounty and emits BountyCreated", async function () {
      const { bountyId } = await createBounty();
      expect(bountyId).to.equal(0n);
      const b = await judge.bounties(0);
      expect(b.owner).to.equal(owner.address);
      expect(b.reward).to.equal(ONE_ETH);
    });

    it("reverts with zero reward", async function () {
      const now = await time.latest();
      await expect(
        judge.connect(owner).createBounty(now + ONE_DAY, now + ONE_DAY * 2, { value: 0 })
      ).to.be.revertedWithCustomError(judge, "InsufficientReward");
    });

    it("reverts if submission deadline is in the past", async function () {
      const now = await time.latest();
      await expect(
        judge.connect(owner).createBounty(now - 1, now + ONE_DAY, { value: ONE_ETH })
      ).to.be.revertedWithCustomError(judge, "DeadlinesMustBeOrdered");
    });

    it("reverts if reveal deadline is not after submission deadline", async function () {
      const now = await time.latest();
      await expect(
        judge.connect(owner).createBounty(now + ONE_DAY, now + ONE_DAY, { value: ONE_ETH })
      ).to.be.revertedWithCustomError(judge, "DeadlinesMustBeOrdered");
    });
  });

  // ── GROUP 2: Commitment submission ─────────────────────────────────────

  describe("submitCommitment", function () {
    it("stores commitment and emits event", async function () {
      const { bountyId } = await createBounty();
      const c = await commitment(ALICE_ANSWER, ALICE_SALT, alice.address, bountyId);

      await expect(judge.connect(alice).submitCommitment(bountyId, c))
        .to.emit(judge, "CommitmentSubmitted")
        .withArgs(bountyId, alice.address);

      const sub = await judge.submissions(bountyId, alice.address);
      expect(sub.commitment).to.equal(c);
    });

    it("does NOT store plaintext answer during commit phase", async function () {
      const { bountyId } = await createBounty();
      const c = await commitment(ALICE_ANSWER, ALICE_SALT, alice.address, bountyId);
      await judge.connect(alice).submitCommitment(bountyId, c);

      const sub = await judge.submissions(bountyId, alice.address);
      expect(sub.answer).to.equal("", "Plaintext must not be visible during commit phase");
    });

    it("reverts after submission deadline", async function () {
      const { bountyId, subDeadline } = await createBounty();
      await time.increaseTo(subDeadline + 1);

      await expect(
        judge.connect(alice).submitCommitment(bountyId, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(judge, "SubmissionPhaseClosed");
    });

    it("reverts on duplicate commitment", async function () {
      const { bountyId } = await createBounty();
      const c = await commitment(ALICE_ANSWER, ALICE_SALT, alice.address, bountyId);
      await judge.connect(alice).submitCommitment(bountyId, c);

      await expect(
        judge.connect(alice).submitCommitment(bountyId, c)
      ).to.be.revertedWithCustomError(judge, "AlreadyCommitted");
    });
  });

  // ── GROUP 3: Reveal — valid cases ──────────────────────────────────────

  describe("revealAnswer (valid)", function () {
    it("marks eligible and stores answer on valid reveal", async function () {
      const { bountyId, subDeadline } = await createBounty();
      await submitAll(bountyId);
      await time.increaseTo(subDeadline + 1);

      await judge.connect(alice).revealAnswer(bountyId, ALICE_ANSWER, ALICE_SALT);

      const sub = await judge.submissions(bountyId, alice.address);
      expect(sub.answer).to.equal(ALICE_ANSWER);
      expect(sub.revealed).to.be.true;
      expect(sub.eligible).to.be.true;
    });

    it("increments eligibleCount for each valid reveal", async function () {
      const { bountyId, subDeadline } = await createBounty();
      await submitAll(bountyId);
      await revealAll(bountyId, subDeadline);

      const b = await judge.bounties(bountyId);
      expect(b.eligibleCount).to.equal(3n);
    });

    it("emits AnswerRevealed with eligible=true", async function () {
      const { bountyId, subDeadline } = await createBounty();
      await submitAll(bountyId);
      await time.increaseTo(subDeadline + 1);

      await expect(
        judge.connect(alice).revealAnswer(bountyId, ALICE_ANSWER, ALICE_SALT)
      ).to.emit(judge, "AnswerRevealed").withArgs(bountyId, alice.address, true);
    });
  });

  // ── GROUP 4: Reveal — invalid / edge cases ─────────────────────────────

  describe("revealAnswer (invalid)", function () {
    it("wrong answer: reveals but not eligible", async function () {
      const { bountyId, subDeadline } = await createBounty();
      await submitAll(bountyId);
      await time.increaseTo(subDeadline + 1);

      await judge.connect(alice).revealAnswer(bountyId, "WRONG ANSWER", ALICE_SALT);

      const sub = await judge.submissions(bountyId, alice.address);
      expect(sub.eligible).to.be.false;
    });

    it("wrong salt: reveals but not eligible", async function () {
      const { bountyId, subDeadline } = await createBounty();
      await submitAll(bountyId);
      await time.increaseTo(subDeadline + 1);

      const badSalt = ethers.hexlify(ethers.toUtf8Bytes("badsalt").padEnd(32, "\0"));
      await judge.connect(alice).revealAnswer(bountyId, ALICE_ANSWER, badSalt);

      const sub = await judge.submissions(bountyId, alice.address);
      expect(sub.eligible).to.be.false;
    });

    it("reverts before submission deadline", async function () {
      const { bountyId } = await createBounty();
      await submitAll(bountyId);

      await expect(
        judge.connect(alice).revealAnswer(bountyId, ALICE_ANSWER, ALICE_SALT)
      ).to.be.revertedWithCustomError(judge, "RevealPhaseNotOpen");
    });

    it("reverts after reveal deadline", async function () {
      const { bountyId, revDeadline } = await createBounty();
      await submitAll(bountyId);
      await time.increaseTo(revDeadline + 1);

      await expect(
        judge.connect(alice).revealAnswer(bountyId, ALICE_ANSWER, ALICE_SALT)
      ).to.be.revertedWithCustomError(judge, "RevealPhaseClosed");
    });

    it("reverts with no prior commitment", async function () {
      const { bountyId, subDeadline } = await createBounty();
      await time.increaseTo(subDeadline + 1);

      await expect(
        judge.connect(attacker).revealAnswer(bountyId, "anything", ethers.ZeroHash)
      ).to.be.revertedWithCustomError(judge, "NoCommitmentFound");
    });

    it("reverts on double reveal", async function () {
      const { bountyId, subDeadline } = await createBounty();
      await submitAll(bountyId);
      await time.increaseTo(subDeadline + 1);
      await judge.connect(alice).revealAnswer(bountyId, ALICE_ANSWER, ALICE_SALT);

      await expect(
        judge.connect(alice).revealAnswer(bountyId, ALICE_ANSWER, ALICE_SALT)
      ).to.be.revertedWithCustomError(judge, "AlreadyRevealed");
    });

    it("reverts on empty answer", async function () {
      const { bountyId, subDeadline } = await createBounty();
      const emptyCommit = await commitment("", ALICE_SALT, alice.address, bountyId);
      await judge.connect(alice).submitCommitment(bountyId, emptyCommit);
      await time.increaseTo(subDeadline + 1);

      await expect(
        judge.connect(alice).revealAnswer(bountyId, "", ALICE_SALT)
      ).to.be.revertedWithCustomError(judge, "EmptyAnswer");
    });

    it("SECURITY: attacker cannot replay another participant's commitment", async function () {
      const { bountyId, subDeadline } = await createBounty();

      // Attacker copies alice's commitment hash but submits it under their own address
      const aliceCommit = await commitment(ALICE_ANSWER, ALICE_SALT, alice.address, bountyId);
      await judge.connect(attacker).submitCommitment(bountyId, aliceCommit);
      await time.increaseTo(subDeadline + 1);

      // Try to reveal alice's answer — hash won't match because msg.sender != alice
      await judge.connect(attacker).revealAnswer(bountyId, ALICE_ANSWER, ALICE_SALT);

      const sub = await judge.submissions(bountyId, attacker.address);
      expect(sub.eligible).to.be.false;
    });
  });

  // ── GROUP 5: judgeAll ──────────────────────────────────────────────────

  describe("judgeAll", function () {
    it("reverts if not owner", async function () {
      const { bountyId, revDeadline } = await createBounty();
      await submitAll(bountyId);
      await time.increaseTo(revDeadline + 1);

      await expect(
        judge.connect(alice).judgeAll(bountyId, "0x")
      ).to.be.revertedWithCustomError(judge, "NotOwner");
    });

    it("reverts before reveal deadline", async function () {
      const { bountyId, subDeadline } = await createBounty();
      await submitAll(bountyId);
      await time.increaseTo(subDeadline + 1);

      await expect(
        judge.connect(owner).judgeAll(bountyId, "0x")
      ).to.be.revertedWithCustomError(judge, "RevealPhaseNotOver");
    });

    it("reverts if already judged", async function () {
      const { bountyId, subDeadline, revDeadline } = await createBounty();
      await submitAll(bountyId);
      await revealAll(bountyId, subDeadline);
      await time.increaseTo(revDeadline + 1);

      await judge.connect(owner).judgeAll(bountyId, "0x");
      await judge.connect(coordinator).receiveJudgingResult(bountyId, "0x");

      await expect(
        judge.connect(owner).judgeAll(bountyId, "0x")
      ).to.be.revertedWithCustomError(judge, "AlreadyJudged");
    });

    it("emits JudgingRequested with payload hash", async function () {
      const { bountyId, subDeadline, revDeadline } = await createBounty();
      await submitAll(bountyId);
      await revealAll(bountyId, subDeadline);
      await time.increaseTo(revDeadline + 1);

      await expect(
        judge.connect(owner).judgeAll(bountyId, "0x")
      ).to.emit(judge, "JudgingRequested");
    });
  });

  // ── GROUP 6: receiveJudgingResult ──────────────────────────────────────

  describe("receiveJudgingResult", function () {
    it("reverts if not coordinator", async function () {
      const { bountyId, subDeadline, revDeadline } = await createBounty();
      await submitAll(bountyId);
      await revealAll(bountyId, subDeadline);
      await time.increaseTo(revDeadline + 1);
      await judge.connect(owner).judgeAll(bountyId, "0x");

      await expect(
        judge.connect(alice).receiveJudgingResult(bountyId, "0x")
      ).to.be.revertedWithCustomError(judge, "OnlyCoordinator");
    });

    it("marks bounty as judged", async function () {
      const { bountyId, subDeadline, revDeadline } = await createBounty();
      await submitAll(bountyId);
      await revealAll(bountyId, subDeadline);
      await time.increaseTo(revDeadline + 1);
      await judge.connect(owner).judgeAll(bountyId, "0x");
      await judge.connect(coordinator).receiveJudgingResult(bountyId, "0x");

      const b = await judge.bounties(bountyId);
      expect(b.judged).to.be.true;
    });
  });

  // ── GROUP 7: finalizeWinner ────────────────────────────────────────────

  describe("finalizeWinner", function () {
    async function setup() {
      const { bountyId, subDeadline, revDeadline } = await createBounty();
      await submitAll(bountyId);
      await revealAll(bountyId, subDeadline);
      await time.increaseTo(revDeadline + 1);
      await judge.connect(owner).judgeAll(bountyId, "0x");
      await judge.connect(coordinator).receiveJudgingResult(bountyId, "0x");
      return bountyId;
    }

    it("pays alice (index 0)", async function () {
      const bountyId = await setup();
      const before = await ethers.provider.getBalance(alice.address);
      await judge.connect(owner).finalizeWinner(bountyId, 0);
      const after = await ethers.provider.getBalance(alice.address);
      expect(after - before).to.equal(ONE_ETH);
    });

    it("pays bob (index 1)", async function () {
      const bountyId = await setup();
      const before = await ethers.provider.getBalance(bob.address);
      await judge.connect(owner).finalizeWinner(bountyId, 1);
      const after = await ethers.provider.getBalance(bob.address);
      expect(after - before).to.equal(ONE_ETH);
    });

    it("reverts if not yet judged", async function () {
      const { bountyId, subDeadline, revDeadline } = await createBounty();
      await submitAll(bountyId);
      await revealAll(bountyId, subDeadline);
      await time.increaseTo(revDeadline + 1);
      await judge.connect(owner).judgeAll(bountyId, "0x");
      // No receiveJudgingResult call

      await expect(
        judge.connect(owner).finalizeWinner(bountyId, 0)
      ).to.be.revertedWithCustomError(judge, "NotYetJudged");
    });

    it("reverts on double finalize", async function () {
      const bountyId = await setup();
      await judge.connect(owner).finalizeWinner(bountyId, 0);

      await expect(
        judge.connect(owner).finalizeWinner(bountyId, 0)
      ).to.be.revertedWithCustomError(judge, "AlreadyFinalized");
    });

    it("reverts on invalid winner index", async function () {
      const bountyId = await setup();
      await expect(
        judge.connect(owner).finalizeWinner(bountyId, 99)
      ).to.be.revertedWithCustomError(judge, "InvalidWinnerIndex");
    });

    it("reverts if not owner", async function () {
      const bountyId = await setup();
      await expect(
        judge.connect(alice).finalizeWinner(bountyId, 0)
      ).to.be.revertedWithCustomError(judge, "NotOwner");
    });
  });

  // ── GROUP 8: Partial reveals ───────────────────────────────────────────

  describe("partial reveals", function () {
    it("only revealed answers are eligible", async function () {
      const { bountyId, subDeadline } = await createBounty();
      await submitAll(bountyId);
      await time.increaseTo(subDeadline + 1);

      // Only alice and bob reveal; charlie does not
      await judge.connect(alice).revealAnswer(bountyId, ALICE_ANSWER, ALICE_SALT);
      await judge.connect(bob).revealAnswer(bountyId, BOB_ANSWER, BOB_SALT);

      const b = await judge.bounties(bountyId);
      expect(b.eligibleCount).to.equal(2n);

      const [answers, addrs] = await judge.getEligibleAnswers(bountyId);
      expect(answers.length).to.equal(2);
      expect(addrs[0]).to.equal(alice.address);
      expect(addrs[1]).to.equal(bob.address);
    });
  });

  // ── GROUP 9: View helpers ──────────────────────────────────────────────

  describe("view functions", function () {
    it("getBountyState tracks full lifecycle", async function () {
      const { bountyId, subDeadline, revDeadline } = await createBounty();

      expect(await judge.getBountyState(bountyId)).to.equal(0); // Open

      await time.increaseTo(subDeadline + 1);
      expect(await judge.getBountyState(bountyId)).to.equal(1); // Revealing

      await submitAll(bountyId);
      await revealAll(bountyId, subDeadline);
      await time.increaseTo(revDeadline + 1);
      await judge.connect(owner).judgeAll(bountyId, "0x");
      await judge.connect(coordinator).receiveJudgingResult(bountyId, "0x");
      expect(await judge.getBountyState(bountyId)).to.equal(2); // Judging

      await judge.connect(owner).finalizeWinner(bountyId, 0);
      expect(await judge.getBountyState(bountyId)).to.equal(3); // Finalized
    });

    it("computeCommitment matches manual hash", async function () {
      const manual = ethers.solidityPackedKeccak256(
        ["string", "bytes32", "address", "uint256"],
        [ALICE_ANSWER, ALICE_SALT, alice.address, 0n]
      );
      const fromContract = await judge.computeCommitment(
        ALICE_ANSWER, ALICE_SALT, alice.address, 0n
      );
      expect(fromContract).to.equal(manual);
    });
  });
});
