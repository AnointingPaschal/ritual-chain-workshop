# Reflection Question

> "What should be public, what should stay hidden, and what should be decided
> by AI versus by a human in a bounty system?"

In a fair bounty system, the **structure** of the competition should be fully
public — the bounty details, reward amount, submission deadline, and judging
criteria should all be visible on-chain so participants can decide whether to
enter with full information. However, the **content of individual submissions**
must remain hidden until the submission phase closes; exposing answers before
the deadline creates an unfair advantage for later submitters who can read and
improve on earlier ideas, which is precisely the problem this commit-reveal
design solves.

After the submission window closes, revealing submissions is acceptable and
even desirable, because transparency after judging builds trust in the system —
participants can verify that the winner's answer was genuinely the best. What
should remain permanently private is any **salt, encryption key, or off-chain
credential** used to protect submissions, since exposing those would allow
retroactive commitment forgery in future bounties.

**AI is well-suited** for the comparative evaluation step: reading all
submissions together, applying a rubric consistently, and ranking without bias
or fatigue. However, AI should not directly trigger a financial payout. The
**final winner selection should remain a human decision** because the owner has
context the model may lack — for instance, detecting plagiarism, resolving
ties, or recognizing that a high-scoring answer violates unstated bounty
requirements. This human-in-the-loop step also provides accountability: if the
AI's output is garbled or manipulated, the owner serves as the last line of
defense before funds are moved. In short, AI handles the cognitive labor of
fair evaluation, while humans retain control over the irreversible transfer of
value.
