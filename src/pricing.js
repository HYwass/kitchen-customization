import pricingCatalog from "../catalog/pricing.json";

function polygonArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[(index + 1) % points.length];
    twiceArea += x1 * y2 - x2 * y1;
  }
  return Math.abs(twiceArea) / 2;
}

function cabinetFramePrice(asset) {
  const rules = pricingCatalog.cabinet;
  if (asset.construction.carrier_only) return rules.carrier_only_price;
  if (asset.cornerGeometry) return rules.corner_base_price + (asset.configuration ? rules.builtin_premium : 0);
  const [width, , height] = asset.dimensions;
  const family = asset.family;
  const base = rules.family_base_price[family] ?? rules.family_base_price.base;
  const widthPrice = width * (rules.width_rate[family] ?? 0);
  const heightPrice = height * (rules.height_rate[family] ?? 0);
  return base + widthPrice + heightPrice + (asset.configuration ? rules.builtin_premium : 0);
}

function internalFittingPrice(front, cabinet) {
  if (!front) return 0;
  const rules = pricingCatalog.cabinet;
  if (front.layoutKind === "drawer") return front.panelCount * rules.drawer_fitting_per_drawer;
  if (front.layoutKind === "door") {
    const tallPremium = ["high", "top"].includes(cabinet.family) ? rules.tall_storage_fitting : 0;
    return front.panelCount * rules.door_fitting_per_panel + tallPremium;
  }
  return front.handleCount * rules.door_fitting_per_panel
    + (cabinet.family === "high" ? rules.tall_storage_fitting : 0);
}

function frontPrice(front, cabinet) {
  if (!front) return 0;
  const rules = pricingCatalog.front;
  const [width, , height] = cabinet.dimensions;
  const coverage = rules.mixed_layout_coverage[front.layoutId] ?? 1;
  const areaPrice = width * height * coverage * (rules.price_per_square_metre[front.styleId] ?? 0);
  return Math.max(areaPrice, front.panelCount * rules.minimum_per_panel);
}

function roundPrice(value) {
  return Math.round(value / 10) * 10;
}

export function estimateKitchenPrice(scene, catalogs, finishMetrics = {}) {
  const { cabinets, fronts, appliances, furniture } = catalogs;
  const detail = {
    cabinet: 0,
    front: 0,
    handle: 0,
    furniture: 0,
    worktop: 0,
    backsplash: 0,
    panel: 0,
    appliance: 0,
  };

  for (const item of scene.objects ?? []) {
    if (item.cabinetAssetId) {
      const cabinet = cabinets[item.cabinetAssetId];
      if (!cabinet) continue;
      const front = item.frontAssetId ? fronts[item.frontAssetId] : null;
      detail.cabinet += cabinetFramePrice(cabinet) + internalFittingPrice(front, cabinet);
      detail.front += frontPrice(front, cabinet);
      if (item.handleAssetId && front) {
        detail.handle += front.handleCount * (pricingCatalog.handle_unit_price[item.handleAssetId] ?? 0);
      }
      for (const applianceId of item.applianceAssetIds ?? []) {
        detail.appliance += pricingCatalog.appliance_unit_price[applianceId] ?? 0;
      }
      continue;
    }

    if (item.assetKind === "furniture" && furniture[item.assetId]) {
      detail.furniture += pricingCatalog.furniture_unit_price[item.assetId] ?? 0;
    } else if (item.assetKind === "appliance" && appliances[item.assetId]) {
      detail.appliance += pricingCatalog.appliance_unit_price[item.assetId] ?? 0;
    }
  }

  const worktopArea = (scene.worktop?.regions ?? [])
    .reduce((sum, region) => sum + polygonArea(region.outline), 0);
  const worktopRate = pricingCatalog.surface.worktop_price_per_square_metre[scene.worktop?.assetId] ?? 0;
  const cutoutCount = (scene.objects ?? []).reduce((count, item) => count + (
    item.applianceAssetIds ?? []
  ).filter((id) => appliances[id]?.worktopCutout).length, 0);
  detail.worktop = worktopArea > 0
    ? Math.max(worktopArea * worktopRate, pricingCatalog.surface.minimum_worktop_price)
      + cutoutCount * pricingCatalog.surface.cutout_each
    : 0;
  detail.backsplash = (finishMetrics.backsplashArea ?? 0)
    * pricingCatalog.surface.backsplash_tile_per_square_metre;
  detail.panel = (finishMetrics.endPanelArea ?? 0)
      * pricingCatalog.surface.end_panel_per_square_metre
    + (finishMetrics.fillerPanelArea ?? 0)
      * pricingCatalog.surface.filler_panel_per_square_metre;

  for (const key of Object.keys(detail)) detail[key] = roundPrice(detail[key]);
  const groups = {
    furniture: detail.cabinet + detail.front + detail.handle + detail.furniture,
    surfaces: detail.worktop + detail.backsplash + detail.panel,
    appliances: detail.appliance,
  };
  return {
    currency: pricingCatalog.currency,
    currencySymbol: pricingCatalog.currency_symbol,
    detail,
    groups,
    total: groups.furniture + groups.surfaces + groups.appliances,
    disclaimer: "演示估价，不含安装、运输、税费及硬装工程，以实际采购报价为准。",
  };
}
