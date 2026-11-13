# iOS shopping fixture check

This branch supports local verification for [#92](https://github.com/Maratatasan/cheapo-app/issues/92).
It creates a separate app named **Cheapo Shopping Test** with bundle
`com.maratatasan.cheapo.shopping-test`. The regular Cheapo app uses a different
data container. This branch is for test builds.

From the repository root, use the pinned Node and pnpm versions and set
`CHEAPO_IOS_SHOPPING_FIXTURE=1` during Expo prebuild and Xcode build. Follow
the [local iOS build guide](ios-local-build.md), substituting
`CheapoShoppingTest.xcworkspace` and the `CheapoShoppingTest` scheme.
Use the same source revision and fixture setup on both device types.

1. From Home tap **Load fixtures** to create five labelled records and open
   Saved products and photos. Check for four complete offers, including the
   photo-less Test shop C entry, and one unfinished photo draft.
2. Open Fixture Potatoes at Test shop A, then tap **Compare saved prices**.
   Price first ranks B before C and leaves D unranked. Same variety shows B
   only, Same brand shows C only, and combining both filters shows no offers.
   The unfinished draft is excluded from each mode.
3. Edit the saved offer from Test shop A. Change the price from £2.40 to £2.55,
   cancel, and reopen to confirm £2.40 remains. Repeat and save, then confirm
   £2.55 is shown and the saved list still has five records. Check keyboard
   dismissal and access to the bottom actions.
4. From Home open the shop selector, add a shop named **Test shop E**, and
   check the current shop on Home. In the chooser, search for E, edit the
   address, and cancel. Reopen and save the address. Cancel one removal, then
   confirm removal of E and check that Home clears its current selection.
5. Rename Test shop A and reopen the original saved offer. The saved record
   should retain its original shop name. Open the fictional sample price
   explorer and return Home without writing any records.

For test-only native evidence, capture the build commit, app identity, target
OS and visible results. Record iOS Simulator and physical iPhone separately.
