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
For approved work in the V1 second-trip scope, apply `v1-second-trip` and
confirm the matching issue card appears in **To Do**. Auto-add is scoped to
open issues with that label in `Maratatasan/cheapo-app`. Labeling
[issue #137](https://github.com/Maratatasan/cheapo-app/issues/137) verified intake
on 19 November 2026. If access, tooling, or automation prevents verification,
report board sync as pending with the issue link and next action.

## Keep current PR links visible

Put **Current work / PR links** at the top of the issue body. Start with
`No PR yet.` List each draft or open PR on its own line with its slice and review
state. Keep merged or superseded supporting work separate from current PRs.

The worker updates the section when opening or revising a PR or marking it
ready. The person reconciling a merge or replacing a PR updates the section
and records any remaining slices on the open issue.

## Move the issue as work progresses

- **To Do** holds the approved, ordered queue. The project owner approves
  scope and priorities. Keep unapproved ideas in the backlog. When capacity
  opens, the primary agent dispatches the highest-priority defined, unblocked
  ticket after eligible **Paused** work. Check existing claims and work before
  assigning one worker to the ticket. Keep one named integration owner.
- **In Progress** means the assigned worker has started the authorized
  issue. The worker records their name, scope and next action on the issue,
  moves the card and verifies the transition before implementation. If the
  board write fails, follow the retry rules above and continue the assignment.
- **Paused** means previously started work is interrupted and still approved.
  Record the reason and next action. Resume eligible **Paused** work before
  starting new **To Do** work when capacity opens.
- **On hold** means work is waiting on a dependency, a decision or the project
  owner's explicit release. Record the condition and who can resolve it.
  Work held until the owner says otherwise requires their release. Resume
  once the condition is resolved and the work is authorized.
- **Ready for review** means the issue lists the actual PR in
  **Current work / PR links**. Include checks, applicable evidence, remaining
  gaps and a clear reviewer action. Record the
  checked commit and distinguish CI, bundle export, browser, simulator and
  physical-device evidence. Before moving the card, verify that the applicable
  PR evidence is present. For UI changes, verify that the PR's embedded
  screenshots render and the handoff's Storybook link opens the relevant story.
  Follow the [UI verification standard](ui-verification.md).
  Moving here frees an implementation slot. The worker verifies the transition
  and reports the issue, PR, checked revision and results to the primary agent.
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

## Changes requested in review

The primary agent records the feedback on the PR and dispatches the revision
when an implementation slot opens. While it waits for capacity, record that
review changes were requested and leave the card in **Ready for review**. Use
**Paused** or **On hold** only when the conditions above apply.

When the worker begins revisions, they move their card to **In Progress** and
read back the status. Before returning it to **Ready for review**, rerun the
affected required checks on the revised PR head. For changed UI, refresh the
embedded screenshots for the affected states, identify the exact capture commit,
and verify that the images render and the updated Storybook preview opens.
Link the revised PR and evidence, then read back the return to **Ready for review**.
The reviewer decides whether the revisions satisfy the requirements.

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

New cards start in **To Do**. Closing an issue moves its card to **Done**.
Linking or merging a PR does not change the issue card automatically. Moving
a card to **Done** does not close the issue. Move issue cards at the milestones
above, read back each change, and report any pending board update.

The [Auto-archive workflow](https://github.com/users/Maratatasan/projects/1/workflows/132736292)
archives issues closed as completed after 14 days without updates. It runs
every 12 hours with `is:issue is:closed reason:completed updated:<@today-14d`.
Archived cards retain their fields and can be restored from the project archive.
