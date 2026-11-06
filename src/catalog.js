import cabinetsCatalog from "../catalog/cabinets.json";
import frontsCatalog from "../catalog/front_styles.json";
import handlesCatalog from "../catalog/handles.json";
import appliancesCatalog from "../catalog/appliances.json";
import furnitureCatalog from "../catalog/furniture.json";
import worktopsCatalog from "../catalog/worktops.json";

const publicAssetUrl = (path) => `/${path.replace(/^assets\//, "")}`;

function humanizeId(id) {
  return id
    .replace(/^(CAB|FRONT|HANDLE|APPL|FURN|WORKTOP)_/, "")
    .replaceAll("__", " · ")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function cabinetConstruction(definition, configuration) {
  const profile = cabinetsCatalog.slot_profiles[definition.slot_profile_id];
  return {
    ...(profile.construction ?? {}),
    ...(configuration ? profile.configurations?.[configuration]?.construction ?? {} : {}),
  };
}

function defaultLayoutId(definition, profile, configurationDefinition) {
  if (configurationDefinition?.front_layout_id) return configurationDefinition.front_layout_id;
  if (definition.default_front_layout_id) return definition.default_front_layout_id;
  const allowed = profile.front?.allowed_layout_ids ?? [];
  if (definition.dimensions[0] >= 0.6 && allowed.includes("DOOR_DOUBLE")) return "DOOR_DOUBLE";
  return allowed[0] ?? null;
}

function cabinetApplianceSlots(profile, configurationDefinition) {
  if (configurationDefinition?.appliance_slots) {
    return configurationDefinition.appliance_slots.map((slot) => ({
      id: slot.id,
      interfaceId: slot.interface_id,
      slot: slot.slot ?? null,
    }));
  }
  if (configurationDefinition?.interface_id) {
    return [
      {
        id: "primary",
        interfaceId: configurationDefinition.interface_id,
        slot: configurationDefinition.slot ?? null,
      },
      ...(configurationDefinition.secondary_interface_ids ?? []).map((interfaceId, index) => ({
        id: `secondary_${index + 1}`,
        interfaceId,
        slot: null,
      })),
    ];
  }
  if (profile.appliance?.interface_id) {
    return [{
      id: "primary",
      interfaceId: profile.appliance.interface_id,
      slot: {
        mount_type: profile.appliance.mount_type,
        local_center: profile.appliance.local_center,
        niche_size: profile.appliance.niche_size,
      },
    }];
  }
  return [];
}

function createCabinetAsset(definition, configuration = null) {
  const profile = cabinetsCatalog.slot_profiles[definition.slot_profile_id];
  const configurationDefinition = configuration ? profile.configurations[configuration] : null;
  const id = configuration ? `${definition.id}__${configuration}` : definition.id;
  const applianceSlots = cabinetApplianceSlots(profile, configurationDefinition);
  return {
    id,
    label: humanizeId(id),
    baseId: definition.id,
    configuration,
    construction: cabinetConstruction(definition, configuration),
    family: definition.family,
    variant: definition.variant ?? null,
    cornerGeometry: definition.corner_geometry ?? null,
    dimensions: definition.dimensions,
    defaultFrontLayoutId: defaultLayoutId(definition, profile, configurationDefinition),
    applianceSlots,
    interfaceId: applianceSlots[0]?.interfaceId ?? null,
    secondaryInterfaceIds: applianceSlots.slice(1).map((slot) => slot.interfaceId),
    applianceSlot: applianceSlots[0]?.slot ?? null,
    path: publicAssetUrl(`assets/cabinets/${id}.glb`),
  };
}

export const CABINET_ASSETS = Object.fromEntries(
  cabinetsCatalog.cabinet_models.flatMap((definition) => {
    const profile = cabinetsCatalog.slot_profiles[definition.slot_profile_id];
    const configurations = Object.keys(profile.configurations ?? {});
    const assets = configurations.length
      ? configurations.map((configuration) => createCabinetAsset(definition, configuration))
      : [createCabinetAsset(definition)];
    return assets.map((asset) => [asset.id, asset]);
  }),
);

function createFrontAsset(style, layout) {
  const isMixed = layout.kind === "mixed";
  const panelLayout = isMixed
    ? frontsCatalog.layout_presets.find((candidate) => candidate.id === "DOOR_SINGLE")
    : layout;
  const horizontalPanelLayout = frontsCatalog.layout_presets.find((candidate) => candidate.id === "DOOR_HORIZONTAL");
  const [templateWidth, templateHeight] = panelLayout.template_size;
  const path = style.asset_path_template
    .replace("{layout_id}", panelLayout.id)
    .replace("{width_mm}", String(Math.round(templateWidth * 1000)))
    .replace("{height_mm}", String(Math.round(templateHeight * 1000)));
  const horizontalPanelPath = style.asset_path_template
    .replace("{layout_id}", horizontalPanelLayout.id)
    .replace("{width_mm}", String(Math.round(horizontalPanelLayout.template_size[0] * 1000)))
    .replace("{height_mm}", String(Math.round(horizontalPanelLayout.template_size[1] * 1000)));
  return {
    id: `${style.id}__${layout.id}`,
    label: `${style.name} · ${humanizeId(layout.id)}`,
    styleId: style.id,
    layoutId: layout.id,
    layoutKind: layout.kind,
    templateSize: panelLayout.template_size,
    zones: layout.zones ?? null,
    material: style.material,
    mixedPanelTemplates: isMixed
      ? {
          vertical: { path: publicAssetUrl(path), size: panelLayout.template_size },
          horizontal: { path: publicAssetUrl(horizontalPanelPath), size: horizontalPanelLayout.template_size },
        }
      : null,
    drawerBox: frontsCatalog.generation_policy.drawer_box,
    path: publicAssetUrl(path),
  };
}

export const FRONT_ASSETS = Object.fromEntries(
  frontsCatalog.styles.flatMap((style) =>
    frontsCatalog.layout_presets
      .map((layout) => {
        const asset = createFrontAsset(style, layout);
        return [asset.id, asset];
      }),
  ),
);

export const HANDLE_ASSETS = Object.fromEntries(
  handlesCatalog.handles.map((item) => [
    item.id,
    {
      id: item.id,
      label: humanizeId(item.id),
      type: item.type,
      dimensions: item.dimensions,
      allowedFrontKinds: item.allowed_front_kinds ?? null,
      path: publicAssetUrl(item.asset_path),
    },
  ]),
);

export const APPLIANCE_ASSETS = Object.fromEntries(
  appliancesCatalog.appliances.map((item) => [
    item.id,
    {
      id: item.id,
      label: humanizeId(item.id),
      category: item.category,
      interfaceId: item.interface_id,
      origin: item.origin,
      bodySize: item.body_size,
      placement: item.placement ?? null,
      worktopCutout: item.worktop_cutout ?? null,
      path: publicAssetUrl(item.asset_path),
    },
  ]),
);

export const FURNITURE_ASSETS = Object.fromEntries(
  furnitureCatalog.furniture.map((item) => [
    item.id,
    {
      id: item.id,
      label: humanizeId(item.id),
      category: item.category,
      bodySize: item.body_size,
      placement: item.placement,
      path: publicAssetUrl(item.asset_path),
    },
  ]),
);

export const WORKTOP_ASSETS = Object.fromEntries(
  worktopsCatalog.styles.map((item) => [
    item.id,
    {
      id: item.id,
      label: item.name,
      thickness: item.thickness,
      defaultDepth: worktopsCatalog.generation_policy.default_depth,
      material: item.material,
      path: publicAssetUrl(item.asset_path_template.replace("{run_id}", "demo_run")),
    },
  ]),
);

export const CATALOG_META = {
  units: cabinetsCatalog.units,
  dimensionOrder: cabinetsCatalog.dimension_order,
  coordinateSystem: cabinetsCatalog.coordinate_system,
};

export function defaultFrontForCabinet(cabinetAssetId) {
  const layoutId = CABINET_ASSETS[cabinetAssetId]?.defaultFrontLayoutId;
  const id = layoutId ? `FRONT_FLAT_MATTE_WHITE__${layoutId}` : null;
  return id && FRONT_ASSETS[id] ? id : null;
}
