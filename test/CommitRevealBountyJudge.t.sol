// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/CommitRevealBountyJudge.sol";

/**
 * @title  CommitRevealBountyJudgeTest
 * @notice Foundry test suite — run with: forge test --match-contract CommitRevealBountyJudgeTest -vv
 */
contract CommitRevealBountyJudgeTest is Test {

    CommitRevealBountyJudge public judge;

    address internal owner       = makeAddr("owner");
    address internal alice       = makeAddr("alice");
    address internal bob         = makeAddr("bob");
    address internal charlie     = makeAddr("charlie");
    address internal attacker    = makeAddr("attacker");
    address internal coordinator = makeAddr("ritualCoordinator");

    uint256 internal constant T0 = 1_000_000;
    uint256 internal subDeadline = T0 + 1 days;
    uint256 internal revDeadline = T0 + 2 days;

    bytes32 internal aliceSalt   = bytes32(uint256(0xA1));
    bytes32 internal bobSalt     = bytes32(uint256(0xB0));
    bytes32 internal charlieSalt = bytes32(uint256(0xC1));

    string internal aliceAnswer   = "The answer is 42";
    string internal bobAnswer     = "It depends on the context";
    string internal charlieAnswer = "Use a commit-reveal scheme";

    function setUp() public {
        vm.warp(T0);
        judge = new CommitRevealBountyJudge(coordinator);
        deal(owner, 10 ether);
        deal(alice, 1 ether);
        deal(bob, 1 ether);
        deal(charlie, 1 ether);
        deal(attacker, 1 ether);
    }

    function _c(string memory ans, bytes32 salt, address sender, uint256 id)
        internal pure returns (bytes32)
    {
        return keccak256(abi.encodePacked(ans, salt, sender, id));
    }

    function _createBounty() internal returns (uint256 id) {
        vm.prank(owner);
        id = judge.createBounty{value: 1 ether}(subDeadline, revDeadline);
    }

    function _submitAll(uint256 id) internal {
        vm.prank(alice);   judge.submitCommitment(id, _c(aliceAnswer,   aliceSalt,   alice,   id));
        vm.prank(bob);     judge.submitCommitment(id, _c(bobAnswer,     bobSalt,     bob,     id));
        vm.prank(charlie); judge.submitCommitment(id, _c(charlieAnswer, charlieSalt, charlie, id));
    }

    function _revealAll(uint256 id) internal {
        vm.warp(subDeadline + 1);
        vm.prank(alice);   judge.revealAnswer(id, aliceAnswer,   aliceSalt);
        vm.prank(bob);     judge.revealAnswer(id, bobAnswer,     bobSalt);
        vm.prank(charlie); judge.revealAnswer(id, charlieAnswer, charlieSalt);
    }

    function _judgeAndFinalize(uint256 id, uint256 winnerIdx) internal {
        vm.warp(revDeadline + 1);
        vm.prank(owner);      judge.judgeAll(id, abi.encode("Score by clarity."));
        vm.prank(coordinator); judge.receiveJudgingResult(id, bytes("{}"));
        vm.prank(owner);      judge.finalizeWinner(id, winnerIdx);
    }

    // ── GROUP 1: Bounty creation ──────────────────────────────────────────

    function test_createBounty_success() public {
        uint256 id = _createBounty();
        assertEq(id, 0);
        (address bOwner, uint256 reward,,,,,,,) = judge.bounties(0);
        assertEq(bOwner, owner);
        assertEq(reward, 1 ether);
    }

    function test_createBounty_revertZeroReward() public {
        vm.prank(owner);
        vm.expectRevert(CommitRevealBountyJudge.InsufficientReward.selector);
        judge.createBounty{value: 0}(subDeadline, revDeadline);
    }

    function test_createBounty_revertPastSubDeadline() public {
        vm.prank(owner);
        vm.expectRevert(CommitRevealBountyJudge.DeadlinesMustBeOrdered.selector);
        judge.createBounty{value: 1 ether}(T0 - 1, revDeadline);
    }

    function test_createBounty_revertRevNotAfterSub() public {
        vm.prank(owner);
        vm.expectRevert(CommitRevealBountyJudge.DeadlinesMustBeOrdered.selector);
        judge.createBounty{value: 1 ether}(subDeadline, subDeadline);
    }

    // ── GROUP 2: Commitment submission ───────────────────────────────────

    function test_submitCommitment_success() public {
        uint256 id = _createBounty();
        bytes32 c  = _c(aliceAnswer, aliceSalt, alice, id);
        vm.prank(alice);
        vm.expectEmit(true, true, false, false);
        emit CommitRevealBountyJudge.CommitmentSubmitted(id, alice);
        judge.submitCommitment(id, c);
        (bytes32 stored,,,,) = judge.submissions(id, alice);
        assertEq(stored, c);
    }

    function test_submitCommitment_noPlaintextDuringCommit() public {
        uint256 id = _createBounty();
        vm.prank(alice);
        judge.submitCommitment(id, _c(aliceAnswer, aliceSalt, alice, id));
        (, string memory storedAnswer,,,) = judge.submissions(id, alice);
        assertEq(bytes(storedAnswer).length, 0);
    }

    function test_submitCommitment_revertAfterDeadline() public {
        uint256 id = _createBounty();
        vm.warp(subDeadline + 1);
        vm.prank(alice);
        vm.expectRevert(CommitRevealBountyJudge.SubmissionPhaseClosed.selector);
        judge.submitCommitment(id, bytes32(0));
    }

    function test_submitCommitment_revertDuplicate() public {
        uint256 id = _createBounty();
        bytes32 c  = _c(aliceAnswer, aliceSalt, alice, id);
        vm.startPrank(alice);
        judge.submitCommitment(id, c);
        vm.expectRevert(CommitRevealBountyJudge.AlreadyCommitted.selector);
        judge.submitCommitment(id, c);
        vm.stopPrank();
    }

    // ── GROUP 3: Reveal — valid ───────────────────────────────────────────

    function test_revealAnswer_validMarksEligible() public {
        uint256 id = _createBounty();
        _submitAll(id);
        vm.warp(subDeadline + 1);
        vm.prank(alice);
        judge.revealAnswer(id, aliceAnswer, aliceSalt);
        (, string memory ans,, bool revealed, bool eligible) = judge.submissions(id, alice);
        assertEq(ans, aliceAnswer);
        assertTrue(revealed);
        assertTrue(eligible);
    }

    function test_revealAnswer_incrementsEligibleCount() public {
        uint256 id = _createBounty();
        _submitAll(id);
        _revealAll(id);
        (,,,,,,,, uint256 eligibleCount) = judge.bounties(id);
        assertEq(eligibleCount, 3);
    }

    // ── GROUP 4: Reveal — invalid ─────────────────────────────────────────

    function test_revealAnswer_wrongAnswer_notEligible() public {
        uint256 id = _createBounty();
        _submitAll(id);
        vm.warp(subDeadline + 1);
        vm.prank(alice);
        judge.revealAnswer(id, "WRONG ANSWER", aliceSalt);
        (,,,, bool eligible) = judge.submissions(id, alice);
        assertFalse(eligible);
    }

    function test_revealAnswer_wrongSalt_notEligible() public {
        uint256 id = _createBounty();
        _submitAll(id);
        vm.warp(subDeadline + 1);
        vm.prank(alice);
        judge.revealAnswer(id, aliceAnswer, bytes32(uint256(0xDEAD)));
        (,,,, bool eligible) = judge.submissions(id, alice);
        assertFalse(eligible);
    }

    function test_revealAnswer_revertBeforeSubDeadline() public {
        uint256 id = _createBounty();
        _submitAll(id);
        vm.prank(alice);
        vm.expectRevert(CommitRevealBountyJudge.RevealPhaseNotOpen.selector);
        judge.revealAnswer(id, aliceAnswer, aliceSalt);
    }

    function test_revealAnswer_revertAfterRevealDeadline() public {
        uint256 id = _createBounty();
        _submitAll(id);
        vm.warp(revDeadline + 1);
        vm.prank(alice);
        vm.expectRevert(CommitRevealBountyJudge.RevealPhaseClosed.selector);
        judge.revealAnswer(id, aliceAnswer, aliceSalt);
    }

    function test_revealAnswer_revertNoCommitment() public {
        uint256 id = _createBounty();
        vm.warp(subDeadline + 1);
        vm.prank(attacker);
        vm.expectRevert(CommitRevealBountyJudge.NoCommitmentFound.selector);
        judge.revealAnswer(id, "anything", bytes32(0));
    }

    function test_revealAnswer_revertDoubleReveal() public {
        uint256 id = _createBounty();
        _submitAll(id);
        vm.warp(subDeadline + 1);
        vm.startPrank(alice);
        judge.revealAnswer(id, aliceAnswer, aliceSalt);
        vm.expectRevert(CommitRevealBountyJudge.AlreadyRevealed.selector);
        judge.revealAnswer(id, aliceAnswer, aliceSalt);
        vm.stopPrank();
    }

    function test_revealAnswer_revertEmptyAnswer() public {
        uint256 id = _createBounty();
        bytes32 c = keccak256(abi.encodePacked("", aliceSalt, alice, id));
        vm.prank(alice); judge.submitCommitment(id, c);
        vm.warp(subDeadline + 1);
        vm.prank(alice);
        vm.expectRevert(CommitRevealBountyJudge.EmptyAnswer.selector);
        judge.revealAnswer(id, "", aliceSalt);
    }

    function test_attackerCannotReplayCommitment() public {
        uint256 id = _createBounty();
        bytes32 aliceCommit = _c(aliceAnswer, aliceSalt, alice, id);
        vm.prank(attacker); judge.submitCommitment(id, aliceCommit);
        vm.warp(subDeadline + 1);
        vm.prank(attacker); judge.revealAnswer(id, aliceAnswer, aliceSalt);
        (,,,, bool eligible) = judge.submissions(id, attacker);
        assertFalse(eligible);
    }

    // ── GROUP 5–9 (condensed) ─────────────────────────────────────────────

    function test_judgeAll_onlyOwner() public {
        uint256 id = _createBounty(); _submitAll(id); _revealAll(id);
        vm.warp(revDeadline + 1);
        vm.prank(alice);
        vm.expectRevert(CommitRevealBountyJudge.NotOwner.selector);
        judge.judgeAll(id, bytes("rubric"));
    }

    function test_judgeAll_revertBeforeRevealDeadline() public {
        uint256 id = _createBounty(); _submitAll(id); _revealAll(id);
        vm.prank(owner);
        vm.expectRevert(CommitRevealBountyJudge.RevealPhaseNotOver.selector);
        judge.judgeAll(id, bytes("rubric"));
    }

    function test_receiveJudgingResult_onlyCoordinator() public {
        uint256 id = _createBounty(); _submitAll(id); _revealAll(id);
        vm.warp(revDeadline + 1);
        vm.prank(owner); judge.judgeAll(id, bytes("rubric"));
        vm.prank(alice);
        vm.expectRevert(CommitRevealBountyJudge.OnlyCoordinator.selector);
        judge.receiveJudgingResult(id, bytes("{}"));
    }

    function test_finalizeWinner_aliceWins() public {
        uint256 id = _createBounty(); _submitAll(id); _revealAll(id);
        uint256 before = address(alice).balance;
        _judgeAndFinalize(id, 0);
        assertGt(address(alice).balance, before);
    }

    function test_finalizeWinner_revertNotJudged() public {
        uint256 id = _createBounty(); _submitAll(id); _revealAll(id);
        vm.warp(revDeadline + 1);
        vm.prank(owner); judge.judgeAll(id, bytes("rubric"));
        vm.prank(owner);
        vm.expectRevert(CommitRevealBountyJudge.NotYetJudged.selector);
        judge.finalizeWinner(id, 0);
    }

    function test_finalizeWinner_revertDoubleFinalize() public {
        uint256 id = _createBounty(); _submitAll(id); _revealAll(id);
        _judgeAndFinalize(id, 0);
        vm.prank(owner);
        vm.expectRevert(CommitRevealBountyJudge.AlreadyFinalized.selector);
        judge.finalizeWinner(id, 0);
    }

    function test_partialReveal_onlyRevealedEligible() public {
        uint256 id = _createBounty(); _submitAll(id);
        vm.warp(subDeadline + 1);
        vm.prank(alice);   judge.revealAnswer(id, aliceAnswer, aliceSalt);
        vm.prank(bob);     judge.revealAnswer(id, bobAnswer, bobSalt);
        (,,,,,,,, uint256 eligibleCount) = judge.bounties(id);
        assertEq(eligibleCount, 2);
    }

    function test_getBountyState_fullLifecycle() public {
        uint256 id = _createBounty();
        assertEq(uint8(judge.getBountyState(id)), 0); // Open
        vm.warp(subDeadline + 1);
        assertEq(uint8(judge.getBountyState(id)), 1); // Revealing
        _submitAll(id); _revealAll(id);
        vm.warp(revDeadline + 1);
        vm.prank(owner); judge.judgeAll(id, bytes("rubric"));
        vm.prank(coordinator); judge.receiveJudgingResult(id, bytes("{}"));
        assertEq(uint8(judge.getBountyState(id)), 2); // Judging
        vm.prank(owner); judge.finalizeWinner(id, 0);
        assertEq(uint8(judge.getBountyState(id)), 3); // Finalized
    }
}
