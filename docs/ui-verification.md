# UI verification standard

For UI changes, cover the behavior and states affected by the change. Reuse
existing stories and tests where they already exercise those outcomes.

- **Reusable components.** Add or update stories for meaningful variants that
  change what the user sees or can do.
- **Assembled screens.** Cover the relevant loading, empty, error and populated
  states using the screen's real UI composition and representative fixtures.
- **Interactions across components.** Add or update a flow story when an action
  in one component changes another. Use a play function to exercise the action
  and verify the visible result.
- **Automated tests.** Extend the existing tests for changed business rules and
  interactions. Assert observable outcomes that would catch a regression. Use
  stories or visual review for styling-only changes.

Use the [component library guide](component-library.md) for Storybook commands
and the [CI standard](ci.md) for repository checks. For documentation-only
changes, verify the edited content and links locally. Required CI still runs.

Verify changed camera, OS permission, keyboard and navigation behavior on the
relevant native target. Check real camera capture on a physical device. Record
browser Storybook, bundle exports, simulators and physical devices separately.

## Screenshots in pull requests

For every UI-affecting PR, embed screenshots of the changed states in the PR
description. Use sample or sanitized fixtures. Label each capture with its
source commit and target, such as Storybook in a browser, a native simulator or
a physical device. Include before and after images when useful and refresh them
after material UI changes.

Embed images from remote attachments that reviewers can open. Open the saved PR
description and confirm the images render there. If capture or attachment is
blocked, record the reason and the missing evidence in the PR. Keep the UI
evidence incomplete until the required images render. Record native checks
separately, including any that the issue allows you to defer.

See the [Agent Documentation standard](https://docs.google.com/document/d/1SJUGxANp46SqcsACD3Si8RQ1RbpBAAcxl9q8IAK7sQA/edit#heading=h.rx2jk8hl5mzl)
for the approved screenshot requirement.

## Storybook preview for review

In the UI PR handoff, link directly to the relevant Storybook story or flow and
give the source commit and browser target. When review starts, start or reuse
the preview from the PR head, open the exact link and confirm the story renders.
Keep the preview available during review. Label a local URL as available on
the review machine while the server is running.

Link the PR and test evidence in the handoff. Record native checks separately.
If the preview cannot be opened, state what is blocked and keep that review
evidence pending.
