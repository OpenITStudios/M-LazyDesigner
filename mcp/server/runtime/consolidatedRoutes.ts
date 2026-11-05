import type { McpRegistrationFamily } from "@/lib/capabilities/registrationProfile";

export const CONSOLIDATED_EXECUTOR_ROUTES = {
  inspect_elements: {
    family: "element_inspection",
    discriminator: "mode",
    routes: {
      outline: "list_outline",
      search: "find_elements_by_criteria",
      detail: "inspect_element",
    },
  },
  manage_material: {
    family: "textures",
    discriminator: "operation",
    routes: {
      create: "create_pbr_material",
      configure: "configure_material",
      assign_channel: "assign_texture_channel",
      save: "save_material_config",
    },
  },
  manage_animation_timeline: {
    family: "animation",
    discriminator: "operation",
    routes: {
      keyframes: "manage_keyframes",
      graph: "animation_graph_editor",
      timeline: "animation_timeline",
      batch: "batch_keyframe_operations",
      copy_paste: "animation_copy_paste",
    },
  },
  manage_material_instances: {
    family: "material_instances",
    discriminator: "operation",
    routes: {
      list: "list_material_instances",
      get: "get_face_material_instances",
      set: "set_face_material_instance",
      bulk_set: "bulk_set_material_instances",
      clear: "clear_material_instances",
    },
  },
} as const satisfies Record<
  string,
  {
    family: McpRegistrationFamily;
    discriminator: string;
    routes: Record<string, string>;
  }
>;

export type ConsolidatedCapability = keyof typeof CONSOLIDATED_EXECUTOR_ROUTES;

const CONSOLIDATED_EXECUTOR_LISTS = Object.freeze(
  Object.fromEntries(
    Object.entries(CONSOLIDATED_EXECUTOR_ROUTES).map(([capability, route]) => [
      capability,
      Object.freeze(Object.values(route.routes)),
    ])
  )
) as Readonly<Record<ConsolidatedCapability, readonly string[]>>;

export function getConsolidatedExecutor(
  capability: ConsolidatedCapability,
  discriminatorValue: string
): string {
  const route = CONSOLIDATED_EXECUTOR_ROUTES[capability];
  const routes = route.routes as Record<string, string>;
  // Input discriminators are external schema values. Never resolve inherited
  // Object.prototype names as executor identities when validating a branch.
  const executor = Object.prototype.hasOwnProperty.call(routes, discriminatorValue)
    ? routes[discriminatorValue]
    : undefined;
  if (!executor) {
    throw new Error(
      `Consolidated capability ${capability} has no executor for ${route.discriminator}=${discriminatorValue}.`
    );
  }
  return executor;
}

export function getConsolidatedExecutors(
  capability: ConsolidatedCapability
): readonly string[] {
  return CONSOLIDATED_EXECUTOR_LISTS[capability];
}

export function getConsolidatedFamily(
  capability: ConsolidatedCapability
): McpRegistrationFamily {
  return CONSOLIDATED_EXECUTOR_ROUTES[capability].family;
}
