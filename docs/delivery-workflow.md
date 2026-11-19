# Cheapo delivery workflow

Use the [GitHub delivery board](https://github.com/users/Maratatasan/projects/1/views/1)
for current delivery status. GitHub issues hold scope, dependencies and
acceptance criteria. Pull requests hold changes and review evidence. The
[Mindomo shopping flow](https://www.mindomo.com/mindmap/0038af2fa76c4108a2dbc283a0052402)
shows the expandable app flow with links to issues. Open the board for day-to-day
status. Drive holds the [standards](https://docs.google.com/document/d/1i5Z2u3SqBXDPaob6HQAua0Ya_Vyk5IFpbT21OCx5a7M/edit)
and [product and architecture decisions](https://docs.google.com/document/d/1RiVeT6NU-aVZa9y-uvB5qSQ1OYPbxUB8tzFhrNS7Z84/edit).

## Access the board

Use the [official GitHub Projects MCP tools](https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md#remote-mcp-toolsets)
for supported operations when the current session has access. If MCP is
unavailable, use an authenticated GitHub CLI or API. Use the browser for
sign-in, visual verification, or actions unavailable through both programmatic
paths. Read back each change from the board. If a write fails, report it
promptly to the primary agent, read the current state before retrying, and
retry only when the failure is recoverable. Reassess after two unsuccessful
attempts. Continue already-assigned work while the board update is pending.

## Start an assignment

Read `AGENTS.md` and this workflow. Check the live issue, board status,
dependencies, existing PR and available board tools. Confirm the named
worker before writing or starting implementation. Use the current GitHub
records when resuming an assignment in a new session.

## Add work to the board

Create the issue using the
[Cheapo ticket standard](https://docs.google.com/document/d/18ieR_MKB3bKWyl5SK0ZEJlwFMOKvlFsFyBDh7sBKnmg/edit).
For work in the V1 second-trip scope, apply `v1-second-trip` and confirm the
matching issue card appears in **Ready**. Auto-add is scoped to open issues
with that label in `Maratatasan/cheapo-app`. Labeling
[issue #137](https://github.com/Maratatasan/cheapo-app/issues/137) verified intake
on 19 November 2026. If access, tooling, or automation prevents verification,
report board sync as pending with the issue link and next action.

## Move the issue as work progresses

- **Ready** means the issue is queued. The project owner approves scope
  and priorities. When capacity opens, the primary agent dispatches the
  highest-priority approved, defined, unblocked ticket, after eligible
  **Paused** work. Check existing claims and work before assigning one
  worker to the ticket. Keep one named integration owner.
- **In Progress** means the assigned worker has started the authorized
  issue. The worker records their name, scope and next action on the issue,
  moves the card and verifies the transition before implementation. If the
  board write fails, follow the retry rules above and continue the assignment.
- **Paused** means previously started work is interrupted and still approved.
  Record the reason and next action. Resume eligible **Paused** work before
  starting new **Ready** work when capacity opens.
- **On hold** means work is waiting on a dependency, a decision or the project
  owner's explicit release. Record the condition and who can resolve it.
  Work held until the owner says otherwise requires their release. Resume
  once the condition is resolved and the work is authorized.
- **Ready for review** means the issue links to an actual PR, with checks,
  applicable evidence, remaining gaps and a clear reviewer action. Record the
  checked commit and distinguish CI, bundle export, browser, simulator and
  physical-device evidence. Before moving the card, verify that the applicable
  PR evidence is present. For UI changes, verify that the PR's embedded
  screenshots render and the handoff's Storybook link opens the relevant story.
  Follow the [UI verification standard](ui-verification.md).
  Moving here frees an implementation slot. The worker verifies the transition
  and reports the issue, PR, checked revision and results to the primary agent.
  Queue requested revisions and move the ticket back to **In Progress** when
  its worker starts them within an available slot.
- **Done** means the issue's acceptance criteria are satisfied. Verify the
  landed change and the evidence required by the issue. Use `Closes #123` in a
  PR only when merging it satisfies every criterion. Use `Refs #123` for a
  partial slice and record the remaining work on the open issue. Record merge,
  installation and native verification as distinct events. For example, a
  code-only issue can close while live AI and phone acceptance remain on
  [epic #100](https://github.com/Maratatasan/cheapo-app/issues/100).

The assigned worker owns issue and board progress through review. On handoff,
they record the issue, actual PR, target branch, checked commit, evidence and
next action. The primary agent handles review, reconciles the merge and
dispatches the next eligible ticket. Assign a delivery coordinator only for a
bounded reconciliation across workstreams. Follow the project owner's merge
instructions, including any explicit delegation of merge authority.

## Parallel and dependent work

Run at most two tickets in active implementation unless the project owner
sets a different limit. Pull requests waiting for review leave those slots
available. For independent tickets, use separate worktrees and agree on file
ownership before starting. Sequence changes that overlap heavily.

An approved dependent ticket may use a stacked PR based on the parent PR's
branch. Link the parent issue and PR, name the base branch, and state the
dependency order and pending integration into `main`. Expect overlapping
changes to need reconciliation. Keep stacks shallow while a design awaits
review. After the parent lands, retarget the child PR to `main`, rebase onto the
landed changes, and rerun the relevant checks at the new exact head before
handing it back for review.

## Status automation

New cards start in **Ready**. Closing an issue moves its card to **Done**.
Linking or merging a PR does not change the issue card automatically. Moving
a card to **Done** does not close the issue. Move issue cards at the milestones
above, read back each change, and report any pending board update.
