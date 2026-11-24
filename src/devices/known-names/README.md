# Known device names

`known-device-names.ts` is a **hand-maintained** list of name parts of trainers and sensors (`kickr`, `tacx`,
`vanrysel`, `hrm*`, ...), with a `version`. It is delivered to the desktop app with the UI bundle (no installer needed):
the web-ui hands `getKnownDeviceNames()` to the WebBLE binding at startup.

What the desktop app does with it: it keeps a **permanent block list** of devices that are not worth probing again
(`webble-devices.json`). A device whose name contains a listed part is **never put on that list because it did not
respond** (busy, out of reach, not ready yet). A device that connects and reports that it is not a fitness device is
blocked anyway.

## Matching

The advertised name is split into lower case parts; serial numbers and MAC fragments are dropped
(`VANRYSEL-HT-c4d1` -> `vanrysel`, `AssiomaPRO12774R` -> `assiomapro`). A part matches an entry if it is equal to it.
An entry ending with `*` is a **family**: `hrm*` matches `hrm`, `hrm200`, `hrm600` and `hrmpro`; `bkool*` matches
`bkoolsmartpro`, `bkoolsmartgo`, ... Use a family for a product line instead of listing every model. A family needs 3
characters before the `*`.

`matching.ts` implements this for tests and other consumers. The desktop app has its own copy of the matching (it runs
in a process that does not load this library): both are covered by the same test cases, keep them in line.

## Changing the list

1. Edit `known-device-names.ts` by hand: keep `names` sorted, lower case, without entries that a family already
   matches (tests check this).
2. **Increase `version`.** The desktop app stores the version it last cleaned its block list against. If the list has a
   higher version, every block that the list matches is removed once, whatever the reason (unsupported, did not respond):
   those devices are probed again, in the worst case they are blocked again by their next probes. If you forget to
   increase the version, the blocks that exist already stay until the next change.
3. Release as usual (a list change reaches the desktop with the next UI bundle).

## Suggestions

`desktop/scripts/known-device-names/suggest.js` prints suggestions for additions from the event log (the BLE devices
that connected fine, `start result: success`), what the list covers and which listed parts no device of the last
90 days contains. It never changes this file. A new trainer that is blocked although it is a trainer: add a part of its
name and increase the version.
