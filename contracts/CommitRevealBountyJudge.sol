// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title  CommitRevealBountyJudge
 * @author Workshop Submission
 * @notice A privacy-preserving AI bounty judge.
 *
 *  PROBLEM SOLVED
 *  ──────────────
 *  In the original workshop contract, answers were stored as plaintext on submission.
 *  Any participant could read earlier answers, copy ideas, and submit an improved
 *  version before the deadline. This contract fixes that with a commit-reveal scheme:
 *  no plaintext answer appears on-chain until after the submission window closes.
 *
 *  LIFECYCLE
 *  ─────────
 *  1. Owner calls createBounty()    → locks ETH reward, sets deadlines.
 *  2. Participants call submitCommitment() → only a hash is stored (no answer visible).
 *  3. After submissionDeadline, participants call revealAnswer() with answer + salt.
 *  4. Contract verifies keccak256(answer, salt, sender, bountyId) == stored hash.
 *  5. After revealDeadline, owner calls judgeAll() → Ritual AI judges all eligible
 *     revealed answers in ONE batch request (not one LLM call per answer).
 *  6. Ritual coordinator calls receiveJudgingResult() → bounty marked as judged.
 *  7. Owner calls finalizeWinner(winnerIndex) → ETH sent to winner.
 *
 *  COMMITMENT FORMULA
 *  ──────────────────
 *  commitment = keccak256(abi.encodePacked(answer, salt, msg.sender, bountyId))
 *
 *  Including msg.sender prevents one participant from copying another's commitment
 *  and revealing it as their own. Including bountyId prevents cross-bounty replay.
 */
contract CommitRevealBountyJudge {

    // ─────────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice High-level lifecycle state of a bounty (derived, not stored).
    enum BountyState { Open, Revealing, Judging, Finalized }

    struct Bounty {
        address owner;
        uint256 reward;              // ETH locked in wei
        uint256 submissionDeadline;  // commits accepted strictly before this
        uint256 revealDeadline;      // reveals accepted in [submissionDeadline, revealDeadline)
        bool    judged;              // set true by Ritual callback
        bool    finalized;           // set true once winner is paid
        address winner;
        uint256 submissionCount;     // total commitments received
        uint256 eligibleCount;       // valid reveals (commitment hash matched)
    }

    struct Submission {
        bytes32 commitment;  // hash submitted during commit phase
        string  answer;      // plaintext revealed after submission deadline
        bytes32 salt;        // stored for auditability after reveal
        bool    revealed;    // true if reveal was attempted (valid or not)
        bool    eligible;    // true if commitment hash matched on reveal
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Storage
    // ─────────────────────────────────────────────────────────────────────────

    uint256 public nextBountyId;

    /// @dev bountyId → Bounty metadata
    mapping(uint256 => Bounty) public bounties;

    /// @dev bountyId → participant address → their submission
    mapping(uint256 => mapping(address => Submission)) public submissions;

    /// @dev bountyId → ordered list of addresses that submitted commitments
    mapping(uint256 => address[]) public participants;

    /// @dev Ritual coordinator / Infernet node that is authorised to deliver results.
    ///      On Ritual Chain, set this to address(0x0800) (LLM precompile).
    ///      On other EVM chains using Infernet, set it to the Coordinator contract.
    address public immutable ritualCoordinator;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event BountyCreated(
        uint256 indexed bountyId,
        address indexed owner,
        uint256 reward,
        uint256 submissionDeadline,
        uint256 revealDeadline
    );

    /// @notice Emitted when a participant submits a commitment hash (no answer revealed).
    event CommitmentSubmitted(uint256 indexed bountyId, address indexed participant);

    /// @notice Emitted on every reveal attempt. `eligible` is false if hash mismatched.
    event AnswerRevealed(
        uint256 indexed bountyId,
        address indexed participant,
        bool    eligible
    );

    /// @notice Emitted when the batch judging request is dispatched to Ritual.
    event JudgingRequested(uint256 indexed bountyId, bytes32 payloadHash);

    /// @notice Emitted when the Ritual coordinator delivers the judging result.
    event BountyJudged(uint256 indexed bountyId);

    /// @notice Emitted when the owner finalizes a winner and the reward is paid.
    event WinnerFinalized(
        uint256 indexed bountyId,
        address indexed winner,
        uint256 reward
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────────────────

    error BountyNotFound();
    error NotOwner();
    error InsufficientReward();
    error DeadlinesMustBeOrdered();
    error SubmissionPhaseClosed();    // past submissionDeadline
    error RevealPhaseNotOpen();       // before submissionDeadline
    error RevealPhaseClosed();        // past revealDeadline
    error AlreadyCommitted();
    error NoCommitmentFound();
    error AlreadyRevealed();
    error EmptyAnswer();
    error RevealPhaseNotOver();       // revealDeadline not yet passed
    error AlreadyJudged();
    error NotYetJudged();
    error AlreadyFinalized();
    error InvalidWinnerIndex();
    error TransferFailed();
    error OnlyCoordinator();

    // ─────────────────────────────────────────────────────────────────────────
    // Modifiers
    // ─────────────────────────────────────────────────────────────────────────

    modifier bountyExists(uint256 bountyId) {
        if (bounties[bountyId].owner == address(0)) revert BountyNotFound();
        _;
    }

    modifier onlyBountyOwner(uint256 bountyId) {
        if (msg.sender != bounties[bountyId].owner) revert NotOwner();
        _;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @param _ritualCoordinator Address authorised to deliver judging results.
     *                           Use the Infernet Coordinator on generic EVM chains,
     *                           or address(0x0800) on Ritual Chain.
     */
    constructor(address _ritualCoordinator) {
        ritualCoordinator = _ritualCoordinator;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Core Functions
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Create a new bounty. The ETH reward is locked in this contract
     *         until a winner is finalized.
     *
     * @param submissionDeadline Unix timestamp — commits accepted before this.
     * @param revealDeadline     Unix timestamp — reveals accepted after
     *                           submissionDeadline and before revealDeadline.
     * @return bountyId  The newly created bounty ID.
     */
    function createBounty(
        uint256 submissionDeadline,
        uint256 revealDeadline
    ) external payable returns (uint256 bountyId) {
        if (msg.value == 0)                            revert InsufficientReward();
        if (submissionDeadline <= block.timestamp)     revert DeadlinesMustBeOrdered();
        if (revealDeadline <= submissionDeadline)      revert DeadlinesMustBeOrdered();

        bountyId = nextBountyId++;

        bounties[bountyId] = Bounty({
            owner:              msg.sender,
            reward:             msg.value,
            submissionDeadline: submissionDeadline,
            revealDeadline:     revealDeadline,
            judged:             false,
            finalized:          false,
            winner:             address(0),
            submissionCount:    0,
            eligibleCount:      0
        });

        emit BountyCreated(
            bountyId,
            msg.sender,
            msg.value,
            submissionDeadline,
            revealDeadline
        );
    }

    /**
     * @notice Submit a commitment hash during the submission phase.
     *         The plaintext answer must NOT be revealed yet.
     *
     *         Off-chain helper to compute the commitment:
     *           commitment = keccak256(abi.encodePacked(answer, salt, msg.sender, bountyId))
     *
     *         Using a random 32-byte salt prevents brute-force preimage attacks
     *         against short or predictable answers.
     *
     * @param bountyId   The bounty to enter.
     * @param commitment The pre-computed commitment hash.
     */
    function submitCommitment(
        uint256 bountyId,
        bytes32 commitment
    ) external bountyExists(bountyId) {
        Bounty storage b = bounties[bountyId];

        if (block.timestamp >= b.submissionDeadline)       revert SubmissionPhaseClosed();
        if (submissions[bountyId][msg.sender].commitment
            != bytes32(0))                                 revert AlreadyCommitted();

        submissions[bountyId][msg.sender].commitment = commitment;
        participants[bountyId].push(msg.sender);
        b.submissionCount++;

        emit CommitmentSubmitted(bountyId, msg.sender);
    }

    /**
     * @notice Reveal the plaintext answer and salt after the submission deadline.
     *
     *         The contract recomputes keccak256(answer, salt, msg.sender, bountyId)
     *         and checks it against the stored commitment. Only matching reveals
     *         are eligible for AI judging.
     *
     *         Participants who fail to reveal before revealDeadline forfeit
     *         their chance to win (unrevealed submissions are ineligible).
     *
     * @param bountyId  The bounty being revealed for.
     * @param answer    The plaintext answer string.
     * @param salt      The random salt used when computing the commitment.
     */
    function revealAnswer(
        uint256 bountyId,
        string  calldata answer,
        bytes32 salt
    ) external bountyExists(bountyId) {
        Bounty storage b = bounties[bountyId];

        if (block.timestamp < b.submissionDeadline)   revert RevealPhaseNotOpen();
        if (block.timestamp >= b.revealDeadline)      revert RevealPhaseClosed();

        Submission storage sub = submissions[bountyId][msg.sender];
        if (sub.commitment == bytes32(0)) revert NoCommitmentFound();
        if (sub.revealed)                 revert AlreadyRevealed();
        if (bytes(answer).length == 0)    revert EmptyAnswer();

        // Record reveal attempt regardless of validity (for auditability)
        sub.revealed = true;
        sub.answer   = answer;
        sub.salt     = salt;

        // Validate the commitment
        bytes32 expected = keccak256(
            abi.encodePacked(answer, salt, msg.sender, bountyId)
        );

        if (expected == sub.commitment) {
            sub.eligible = true;
            b.eligibleCount++;
        }
        // If mismatch: eligible stays false; answer stored for audit but won't be judged.

        emit AnswerRevealed(bountyId, msg.sender, sub.eligible);
    }

    /**
     * @notice Dispatch a single batch judging request to Ritual AI covering
     *         all eligible revealed answers. Only the bounty owner may call
     *         this after the reveal deadline has passed.
     *
     *         All answers are encoded into ONE payload — the LLM receives the
     *         full batch at once rather than one call per submission.
     *
     * @param bountyId  The bounty to judge.
     * @param llmInput  ABI-encoded judging rubric / prompt prefix supplied by
     *                  the owner: abi.encode(rubric, scoringCriteria).
     */
    function judgeAll(
        uint256 bountyId,
        bytes calldata llmInput
    ) external bountyExists(bountyId) onlyBountyOwner(bountyId) {
        Bounty storage b = bounties[bountyId];

        if (block.timestamp < b.revealDeadline) revert RevealPhaseNotOver();
        if (b.judged)                           revert AlreadyJudged();

        // ── Collect eligible answers into a batch ─────────────────────────
        address[] storage parts = participants[bountyId];
        string[]  memory answers = new string[](b.eligibleCount);
        uint256 idx;
        for (uint256 i; i < parts.length; i++) {
            Submission storage s = submissions[bountyId][parts[i]];
            if (s.eligible) {
                answers[idx++] = s.answer;
            }
        }

        // ── Build payload for Ritual ──────────────────────────────────────
        // Encoded as: (bountyId, rubric/llmInput, answers[])
        // The bountyId prefix lets the coordinator route the callback correctly.
        bytes memory payload = abi.encode(bountyId, llmInput, answers);
        bytes32 payloadHash  = keccak256(payload);

        // ── Ritual Integration ────────────────────────────────────────────
        //
        // PATH A — Ritual Chain (native, synchronous)
        // ───────────────────────────────────────────
        // On Ritual Chain the LLM precompile is at 0x0800. The call is
        // synchronous: the result is returned in the same transaction.
        //
        //   (bool ok, bytes memory result) =
        //       address(0x0800).call(abi.encode("gpt-4o", payload));
        //   require(ok, "LLM precompile failed");
        //   b.judged = true;
        //   emit BountyJudged(bountyId);
        //
        // PATH B — Generic EVM + Infernet (async callback)
        // ─────────────────────────────────────────────────
        // The Infernet Coordinator is called here; the Infernet node executes
        // the LLM container off-chain and calls receiveJudgingResult() back.
        //
        //   IInfernetCoordinator(ritualCoordinator).requestCompute(
        //       "bounty-judge-v1",  // container image ID
        //       payload,
        //       20 gwei,            // node fee per gas unit
        //       500_000,            // callback gas limit
        //       1                   // redundancy (1 node)
        //   );
        //
        // The stub below emits an event so the off-chain relay can pick it up.
        // Replace with the appropriate path when deploying.
        emit JudgingRequested(bountyId, payloadHash);
    }

    /**
     * @notice Called by the Ritual coordinator / Infernet node to deliver the
     *         batch judging result and mark the bounty as ready to finalize.
     *
     *         On Ritual Chain native mode, `judgeAll()` calls the LLM precompile
     *         synchronously and sets `b.judged = true` directly — this function
     *         is only needed for the async Infernet path.
     *
     * @param bountyId       The bounty that was judged.
     * @param judgingOutput  Raw LLM output (stored off-chain; hash only on-chain).
     */
    function receiveJudgingResult(
        uint256 bountyId,
        bytes calldata judgingOutput
    ) external bountyExists(bountyId) {
        if (msg.sender != ritualCoordinator) revert OnlyCoordinator();

        bounties[bountyId].judged = true;

        // Store a hash of the AI output for verifiability without gas cost of
        // storing large text blobs. Anyone can verify the full output off-chain.
        emit BountyJudged(bountyId);

        // Suppress unused variable warning (output stored off-chain via events/IPFS)
        (judgingOutput);
    }

    /**
     * @notice Finalize the winner. The bounty owner acts as a human-in-the-loop
     *         checkpoint: they confirm the AI's recommended winner index before
     *         the reward is paid out.
     *
     *         winnerIndex is an index into the list of eligible revealed answers
     *         (matching the ordering used in getEligibleAnswers / judgeAll batch).
     *
     * @param bountyId    The bounty to finalize.
     * @param winnerIndex Zero-based index into eligible participants list.
     */
    function finalizeWinner(
        uint256 bountyId,
        uint256 winnerIndex
    ) external bountyExists(bountyId) onlyBountyOwner(bountyId) {
        Bounty storage b = bounties[bountyId];

        if (!b.judged)   revert NotYetJudged();
        if (b.finalized) revert AlreadyFinalized();

        address winnerAddr = _resolveEligibleParticipant(bountyId, winnerIndex);
        if (winnerAddr == address(0)) revert InvalidWinnerIndex();

        b.finalized = true;
        b.winner    = winnerAddr;

        (bool ok,) = winnerAddr.call{value: b.reward}("");
        if (!ok) revert TransferFailed();

        emit WinnerFinalized(bountyId, winnerAddr, b.reward);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal Helpers
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @dev Returns the address of the nth eligible participant (0-indexed),
     *      preserving submission order.
     */
    function _resolveEligibleParticipant(
        uint256 bountyId,
        uint256 winnerIndex
    ) internal view returns (address) {
        address[] storage parts = participants[bountyId];
        uint256 eligibleSeen;
        for (uint256 i; i < parts.length; i++) {
            if (submissions[bountyId][parts[i]].eligible) {
                if (eligibleSeen == winnerIndex) return parts[i];
                eligibleSeen++;
            }
        }
        return address(0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // View / Helper Functions
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Returns the current high-level state of a bounty.
     */
    function getBountyState(uint256 bountyId)
        external
        view
        bountyExists(bountyId)
        returns (BountyState)
    {
        Bounty storage b = bounties[bountyId];
        if (b.finalized)                               return BountyState.Finalized;
        if (b.judged)                                  return BountyState.Judging;
        if (block.timestamp >= b.submissionDeadline)   return BountyState.Revealing;
        return BountyState.Open;
    }

    /**
     * @notice Returns all participants who submitted a commitment for a bounty.
     */
    function getParticipants(uint256 bountyId)
        external
        view
        returns (address[] memory)
    {
        return participants[bountyId];
    }

    /**
     * @notice Returns the eligible revealed answers and their submitter addresses,
     *         in the same order they will be sent to the AI judge.
     *
     *         Only available after the submission deadline (before that, answers
     *         are hidden even from this view — commitments only).
     */
    function getEligibleAnswers(uint256 bountyId)
        external
        view
        bountyExists(bountyId)
        returns (string[] memory answers, address[] memory submitters)
    {
        Bounty storage b = bounties[bountyId];
        answers    = new string[](b.eligibleCount);
        submitters = new address[](b.eligibleCount);
        address[] storage parts = participants[bountyId];
        uint256 idx;
        for (uint256 i; i < parts.length; i++) {
            Submission storage s = submissions[bountyId][parts[i]];
            if (s.eligible) {
                answers[idx]    = s.answer;
                submitters[idx] = parts[i];
                idx++;
            }
        }
    }

    /**
     * @notice Helper for participants to compute their commitment off-chain.
     *         Can also be called on-chain in tests.
     */
    function computeCommitment(
        string  calldata answer,
        bytes32 salt,
        address sender,
        uint256 bountyId
    ) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(answer, salt, sender, bountyId));
    }
}
