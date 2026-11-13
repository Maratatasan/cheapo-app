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

## Pull request screenshots

For every pull request that changes UI, embed representative screenshots in the
PR description. Show the changed states with sample or sanitized data, and label
whether each image is from Storybook/browser or a native target. Identify the
source commit rendered; include before/after images when they clarify the change.
Refresh screenshots after material UI changes. If capture is blocked, state why
and what remains unverified instead of omitting the evidence silently.

Screenshots help review visible changes; they do not replace automated tests,
CI, or platform checks. Report browser, simulator, physical-device, and bundle
results separately.

In the handoff, link the PR, relevant stories and test evidence. Name the target
for each device check and call out any verification gaps.
