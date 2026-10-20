// Narrow runtime declarations not yet included in the pinned upstream typings.
interface BlockbenchNativeModulePermissionOptions {
  message?: string;
  detail?: string;
  optional?: boolean;
}

declare function requireNativeModule(
  moduleName: "net",
  options?: BlockbenchNativeModulePermissionOptions
): typeof import("node:net") | undefined;


interface NullObject {
  /** Blockbench 5.2+ native IK root/source UUID. */
  ik_source?: string;
  /** Blockbench 5.2+ native IK pole UUID. */
  ik_pole?: string;
}
