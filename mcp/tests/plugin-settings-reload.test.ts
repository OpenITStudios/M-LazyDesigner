import { expect, test } from "bun:test";
import { settingsSetup, settingsTeardown, setExtendedMcpFamiliesEnabled, setExtendedMcpProfileHandler } from "@/ui/settings";

test("native reload preserves master settings and retires callbacks from the previous generation", () => {
  const globals = globalThis as any;
  const originalSetting = globals.Setting;
  const originalSettings = globals.Settings;
  const originalBlockbench = globals.Blockbench;
  const profileChanges: boolean[] = [];
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const storage = new Map<string, string>();
  const registry = new Map<string, any>();
  const stored: Record<string, { value: unknown }> = {};
  class NativeSetting {
    master_value: unknown;
    constructor(public id: string, data: { value: unknown }) {
      // Blockbench 5.2 reads the startup cache, not the removed Setting instance.
      this.master_value = stored[id]?.value ?? data.value;
      registry.set(id, this);
    }
    get value() { return "active-profile-override"; }
    delete() { registry.delete(this.id); }
  }
  try {
    globals.Setting = NativeSetting;
    globals.Settings = { stored, save() {} };
    globals.Blockbench = { showQuickMessage() {} };
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => { storage.set(key, value); },
      },
    });
    settingsSetup();
    registry.get("mcp_port").master_value = 3011;
    registry.get("mcp_endpoint").master_value = "/acceptance-test";
    const toggle = [...registry.values()].find(setting => setting.master_value === false)!;
    const toggleId = toggle.id;
    toggle.master_value = false;
    setExtendedMcpProfileHandler(value => { profileChanges.push(value); });
    setExtendedMcpFamiliesEnabled(true);
    expect(profileChanges).toEqual([true]);
    settingsTeardown();
    expect(registry.size).toBe(0);
    setExtendedMcpFamiliesEnabled(false);
    expect(profileChanges).toEqual([true]);
    settingsSetup();
    setExtendedMcpFamiliesEnabled(false);
    expect(profileChanges).toEqual([true]);
    setExtendedMcpProfileHandler(value => { profileChanges.push(value); });
    setExtendedMcpFamiliesEnabled(false);
    expect(profileChanges).toEqual([true, false]);
    expect(registry.get("mcp_port").master_value).toBe(3011);
    expect(registry.get("mcp_endpoint").master_value).toBe("/acceptance-test");
    expect(registry.get(toggleId).master_value).toBe(false);
    registry.get("mcp_endpoint").master_value = "";
    settingsTeardown();
    settingsSetup();
    expect(registry.get("mcp_endpoint").master_value).toBe("");
  } finally {
    settingsTeardown();
    globals.Setting = originalSetting;
    globals.Settings = originalSettings;
    globals.Blockbench = originalBlockbench;
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
