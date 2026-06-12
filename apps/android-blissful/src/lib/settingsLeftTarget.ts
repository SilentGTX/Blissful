import { createContext, useContext } from 'react';

// The node handle that D-pad Left should land on for controls INSIDE the Settings
// detail panel — the active category row in the left nav. When a panel control is
// rendered under this provider it routes Left there (and does NOT open the global
// nav rail); outside the provider (Discover/Library) the value is undefined and the
// control keeps its normal at-row-start rail-open behaviour. One context instead of
// threading a `leftTag` prop through every panel control + sub-panel.
export const SettingsLeftTargetContext = createContext<number | undefined>(undefined);

export function useSettingsLeftTarget(): number | undefined {
  return useContext(SettingsLeftTargetContext);
}
