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

const DETAIL_GROUP = {
  cabinet: "furniture",
  front: "furniture",
  handle: "furniture",
  furniture: "furniture",
  worktop: "surfaces",
  backsplash: "surfaces",
  panel: "surfaces",
  appliance: "appliances",
};

function cabinetFrameBasis(asset) {
  const rules = pricingCatalog.cabinet;
  if (asset.construction.carrier_only) return "设备承托柜固定价";
  if (asset.cornerGeometry) {
    return asset.configuration ? "角柜固定价 + 嵌入结构附加" : "角柜固定价";
  }
  const [width, , height] = asset.dimensions;
  const family = asset.family;
  const widthRate = rules.width_rate[family] ?? 0;
  const heightRate = rules.height_rate[family] ?? 0;
  const parts = [`${family} 基础价`, `${width.toFixed(2)} m × ¥${widthRate}/m`];
  if (heightRate) parts.push(`${height.toFixed(2)} m × ¥${heightRate}/m`);
  if (asset.configuration) parts.push("嵌入结构附加");
  return parts.join(" + ");
}

function fittingBasis(front, cabinet) {
  if (!front) return "";
  const rules = pricingCatalog.cabinet;
  if (front.layoutKind === "drawer") {
    return `${front.panelCount} 个抽屉 × ¥${rules.drawer_fitting_per_drawer}`;
  }
  if (front.layoutKind === "door") {
    const suffix = ["high", "top"].includes(cabinet.family) ? " + 高柜储物五金" : "";
    return `${front.panelCount} 块门板五金 × ¥${rules.door_fitting_per_panel}${suffix}`;
  }
  const suffix = cabinet.family === "high" ? " + 高柜储物五金" : "";
  return `${front.handleCount} 组门板五金 × ¥${rules.door_fitting_per_panel}${suffix}`;
}

function addLineItem(lineItems, detailKey, item) {
  lineItems.push({
    group: DETAIL_GROUP[detailKey],
    detailKey,
    ...item,
  });
}

export function estimateKitchenPrice(scene, catalogs, finishMetrics = {}) {
  const { cabinets, fronts, appliances, furniture } = catalogs;
  const lineItems = [];
  const warnings = [];
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
      if (!cabinet) {
        warnings.push(`${item.name || item.id}：未知柜体 ${item.cabinetAssetId}，未计价。`);
        continue;
      }
      const front = item.frontAssetId ? fronts[item.frontAssetId] : null;
      const framePrice = cabinetFramePrice(cabinet);
      const fittingPrice = internalFittingPrice(front, cabinet);
      const itemFrontPrice = frontPrice(front, cabinet);
      detail.cabinet += framePrice + fittingPrice;
      detail.front += itemFrontPrice;
      addLineItem(lineItems, "cabinet", {
        name: `${item.name || item.id} · 柜体`,
        assetId: item.cabinetAssetId,
        basis: cabinetFrameBasis(cabinet),
        quantity: 1,
        unit: "件",
        unitPrice: framePrice,
        subtotal: framePrice,
      });
      if (fittingPrice > 0) {
        addLineItem(lineItems, "cabinet", {
          name: `${item.name || item.id} · 内部五金`,
          assetId: item.frontAssetId || "-",
          basis: fittingBasis(front, cabinet),
          quantity: 1,
          unit: "组",
          unitPrice: fittingPrice,
          subtotal: fittingPrice,
        });
      }
      if (item.frontAssetId && !front) {
        warnings.push(`${item.name || item.id}：未知门板 ${item.frontAssetId}，未计价。`);
      } else if (front && itemFrontPrice > 0) {
        const [width, , height] = cabinet.dimensions;
        const coverage = pricingCatalog.front.mixed_layout_coverage[front.layoutId] ?? 1;
        const area = width * height * coverage;
        const rate = pricingCatalog.front.price_per_square_metre[front.styleId] ?? 0;
        const minimum = front.panelCount * pricingCatalog.front.minimum_per_panel;
        addLineItem(lineItems, "front", {
          name: `${item.name || item.id} · 门板`,
          assetId: item.frontAssetId,
          basis: area * rate < minimum
            ? `${front.panelCount} 块门板最低价`
            : `${area.toFixed(3)} ㎡ × ¥${rate}/㎡`,
          quantity: area,
          unit: "㎡",
          unitPrice: rate,
          subtotal: itemFrontPrice,
        });
      }
      if (item.handleAssetId && front) {
        const handleUnitPrice = pricingCatalog.handle_unit_price[item.handleAssetId];
        if (handleUnitPrice === undefined) {
          warnings.push(`${item.name || item.id}：拉手 ${item.handleAssetId} 未配置价格。`);
        } else {
          const handlePrice = front.handleCount * handleUnitPrice;
          detail.handle += handlePrice;
          addLineItem(lineItems, "handle", {
            name: `${item.name || item.id} · 拉手`,
            assetId: item.handleAssetId,
            basis: `${front.handleCount} 个 × ¥${handleUnitPrice}`,
            quantity: front.handleCount,
            unit: "个",
            unitPrice: handleUnitPrice,
            subtotal: handlePrice,
          });
        }
      }
      for (const applianceId of item.applianceAssetIds ?? []) {
        const appliancePrice = pricingCatalog.appliance_unit_price[applianceId];
        if (appliancePrice === undefined) {
          warnings.push(`${item.name || item.id}：电器 ${applianceId} 未配置价格。`);
          continue;
        }
        detail.appliance += appliancePrice;
        addLineItem(lineItems, "appliance", {
          name: `${item.name || item.id} · 嵌入组件`,
          assetId: applianceId,
          basis: "目录单价",
          quantity: 1,
          unit: "件",
          unitPrice: appliancePrice,
          subtotal: appliancePrice,
        });
      }
      continue;
    }

    if (item.assetKind === "furniture" && furniture[item.assetId]) {
      const furniturePrice = pricingCatalog.furniture_unit_price[item.assetId];
      if (furniturePrice === undefined) {
        warnings.push(`${item.name || item.id}：家具 ${item.assetId} 未配置价格。`);
      } else {
        detail.furniture += furniturePrice;
        addLineItem(lineItems, "furniture", {
          name: item.name || item.id,
          assetId: item.assetId,
          basis: "目录单价",
          quantity: 1,
          unit: "件",
          unitPrice: furniturePrice,
          subtotal: furniturePrice,
        });
      }
    } else if (item.assetKind === "appliance" && appliances[item.assetId]) {
      const appliancePrice = pricingCatalog.appliance_unit_price[item.assetId];
      if (appliancePrice === undefined) {
        warnings.push(`${item.name || item.id}：电器 ${item.assetId} 未配置价格。`);
      } else {
        detail.appliance += appliancePrice;
        addLineItem(lineItems, "appliance", {
          name: item.name || item.id,
          assetId: item.assetId,
          basis: "目录单价",
          quantity: 1,
          unit: "件",
          unitPrice: appliancePrice,
          subtotal: appliancePrice,
        });
      }
    }
  }

  const worktopArea = (scene.worktop?.regions ?? [])
    .reduce((sum, region) => sum + polygonArea(region.outline), 0);
  const worktopRate = pricingCatalog.surface.worktop_price_per_square_metre[scene.worktop?.assetId] ?? 0;
  const cutoutCount = (scene.objects ?? []).reduce((count, item) => count + (
    item.applianceAssetIds ?? []
  ).filter((id) => appliances[id]?.worktopCutout).length, 0);
  if (worktopArea > 0) {
    const materialPrice = Math.max(
      worktopArea * worktopRate,
      pricingCatalog.surface.minimum_worktop_price,
    );
    detail.worktop = materialPrice + cutoutCount * pricingCatalog.surface.cutout_each;
    addLineItem(lineItems, "worktop", {
      name: "台面材料",
      assetId: scene.worktop?.assetId || "-",
      basis: worktopArea * worktopRate < pricingCatalog.surface.minimum_worktop_price
        ? `面积 ${worktopArea.toFixed(3)} ㎡，按最低价计`
        : `${worktopArea.toFixed(3)} ㎡ × ¥${worktopRate}/㎡`,
      quantity: worktopArea,
      unit: "㎡",
      unitPrice: worktopRate,
      subtotal: materialPrice,
    });
    if (cutoutCount > 0) {
      addLineItem(lineItems, "worktop", {
        name: "台面设备开孔",
        assetId: "sink / faucet / cooktop",
        basis: `${cutoutCount} 个 × ¥${pricingCatalog.surface.cutout_each}`,
        quantity: cutoutCount,
        unit: "个",
        unitPrice: pricingCatalog.surface.cutout_each,
        subtotal: cutoutCount * pricingCatalog.surface.cutout_each,
      });
    }
    if (!Object.hasOwn(pricingCatalog.surface.worktop_price_per_square_metre, scene.worktop?.assetId)) {
      warnings.push(`台面 ${scene.worktop?.assetId || "-"} 未配置面积单价。`);
    }
  }
  detail.backsplash = (finishMetrics.backsplashArea ?? 0)
    * pricingCatalog.surface.backsplash_tile_per_square_metre;
  if (detail.backsplash > 0) {
    addLineItem(lineItems, "backsplash", {
      name: "台面后挡墙面砖",
      assetId: "PROCEDURAL_BACKSPLASH",
      basis: `${finishMetrics.backsplashArea.toFixed(3)} ㎡ × ¥${pricingCatalog.surface.backsplash_tile_per_square_metre}/㎡`,
      quantity: finishMetrics.backsplashArea,
      unit: "㎡",
      unitPrice: pricingCatalog.surface.backsplash_tile_per_square_metre,
      subtotal: detail.backsplash,
    });
  }
  const endPanelPrice = (finishMetrics.endPanelArea ?? 0)
    * pricingCatalog.surface.end_panel_per_square_metre;
  const fillerPanelPrice = (finishMetrics.fillerPanelArea ?? 0)
    * pricingCatalog.surface.filler_panel_per_square_metre;
  detail.panel = endPanelPrice + fillerPanelPrice;
  if (endPanelPrice > 0) {
    addLineItem(lineItems, "panel", {
      name: "柜体外露侧板",
      assetId: "PROCEDURAL_END_PANEL",
      basis: `${finishMetrics.endPanelArea.toFixed(3)} ㎡ × ¥${pricingCatalog.surface.end_panel_per_square_metre}/㎡`,
      quantity: finishMetrics.endPanelArea,
      unit: "㎡",
      unitPrice: pricingCatalog.surface.end_panel_per_square_metre,
      subtotal: endPanelPrice,
    });
  }
  if (fillerPanelPrice > 0) {
    addLineItem(lineItems, "panel", {
      name: "柜墙填缝板",
      assetId: "PROCEDURAL_FILLER_PANEL",
      basis: `${finishMetrics.fillerPanelArea.toFixed(3)} ㎡ × ¥${pricingCatalog.surface.filler_panel_per_square_metre}/㎡`,
      quantity: finishMetrics.fillerPanelArea,
      unit: "㎡",
      unitPrice: pricingCatalog.surface.filler_panel_per_square_metre,
      subtotal: fillerPanelPrice,
    });
  }

  for (const key of Object.keys(detail)) {
    const rawPrice = detail[key];
    const roundedPrice = roundPrice(rawPrice);
    const adjustment = roundedPrice - rawPrice;
    detail[key] = roundedPrice;
    if (Math.abs(adjustment) >= 0.005) {
      addLineItem(lineItems, key, {
        name: "分类金额取整调整",
        assetId: "-",
        basis: "该成本分类按 ¥10 取整",
        quantity: 1,
        unit: "项",
        unitPrice: adjustment,
        subtotal: adjustment,
        adjustment: true,
      });
    }
  }
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
    lineItems,
    warnings,
    total: groups.furniture + groups.surfaces + groups.appliances,
    disclaimer: "演示估价，不含安装、运输、税费及硬装工程，以实际采购报价为准。",
  };
}
