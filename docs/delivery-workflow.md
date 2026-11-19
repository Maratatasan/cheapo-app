# Cheapo delivery workflow

Use the [GitHub delivery board](https://github.com/users/Maratatasan/projects/1/views/1)
for current delivery status. GitHub issues hold scope, dependencies and
acceptance criteria. Pull requests hold changes and review evidence. The
[Mindomo delivery map](https://www.mindomo.com/mindmap/1e2624fc65444984a5d005e6de40d7f4)
shows the expandable flow with links to issues. Open the board for day-to-day
status. Drive holds the [standards](https://docs.google.com/document/d/1i5Z2u3SqBXDPaob6HQAua0Ya_Vyk5IFpbT21OCx5a7M/edit)
and [product and architecture decisions](https://docs.google.com/document/d/1RiVeT6NU-aVZa9y-uvB5qSQ1OYPbxUB8tzFhrNS7Z84/edit).

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

- **Ready** means the issue is queued. A card here does not authorize work.
  The project owner or coordinating agent sets priorities and approves scope.
  When authorized to assign work, the delivery coordinator dispatches the next
  approved, unblocked ticket from that queue. Keep at most two implementation
  tickets active by default, with one named owner per ticket and one named
  integration owner.
- **In Progress** means an owner has started the named, authorized issue.
  Record the owner, scope and next action on the issue, then move its card.
  When blocked, record the reason, the action that would unblock it and who
  owns that action. Keep the issue open and its board status at the current
  stage until the owner updates it.
- **Ready for review** means the issue links to an actual PR, with checks,
  applicable evidence, remaining gaps and a clear reviewer action. Record the
  checked commit and distinguish CI, bundle export, browser, simulator and
  physical-device evidence. For UI changes, follow the
  [UI verification standard](ui-verification.md).
- **Done** means the issue's acceptance criteria are satisfied. Verify the
  landed change and the evidence required by the issue. Use `Closes #123` in a
  PR only when merging it satisfies every criterion. Use `Refs #123` for a
  partial slice and record the remaining work on the open issue. Record merge,
  installation and native verification as distinct events. For example, a
  code-only issue can close while live AI and phone acceptance remain on
  [epic #100](https://github.com/Maratatasan/cheapo-app/issues/100).

On handoff, the owner records the issue, PR, target branch, checked commit,
evidence and next action. The delivery coordinator reconciles status at
handoff, review and merge. The authorized integration owner handles merges.

## Status automation

New cards start in **Ready**. Closing an issue moves its card to **Done**.
Linking or merging a PR does not change the issue card automatically. Moving
a card to **Done** does not close the issue. Move issue cards at the milestones
above, read back each change, and report any pending board update.
