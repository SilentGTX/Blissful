// Tracks whether the currently-focused CONTENT element sits at the LEFT EDGE of
// its row (the first card in a row / the first dropdown / the leftmost hero
// button). The NavRail opens ONLY when D-pad Left is pressed while focus is on a
// left-edge element — so Left on the 2nd card just moves to the 1st card, and
// only a Left on the 1st card (already at the edge) opens the rail.
//
// This is deterministic (a flag set on focus), unlike a timing heuristic that
// races the FlatList's focus event.
let atLeftEdge = false;

export function markContentFocus(rowStart: boolean): void {
  atLeftEdge = rowStart;
}

export function isAtLeftEdge(): boolean {
  return atLeftEdge;
}
