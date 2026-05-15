export interface Shortcut {
  mod: boolean;
  shift?: boolean;
  key: string;
  descriptionKey: string;
  scope: "global" | "editor";
}

export const SHORTCUTS: Shortcut[] = [
  { mod: true, key: "Z",   descriptionKey: "shortcuts:undo",          scope: "global" },
  { mod: true, shift: true, key: "Z", descriptionKey: "shortcuts:redo", scope: "global" },
  { mod: true, key: "/",   descriptionKey: "shortcuts:openShortcuts", scope: "global" },
  { mod: true, key: ",",   descriptionKey: "shortcuts:openSettings",  scope: "global" },
];
