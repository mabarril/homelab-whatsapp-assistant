import { PrintCalculation, PrintSettings } from '../../domain/entities/PrintCalculation.js';

export interface CalculateCostParams {
  userId: string;
  projectName: string;
  weightGrams: number;
  printTimeHours: number;
  settings: PrintSettings;
}

export function calculate3dPrintCost(params: CalculateCostParams): Omit<PrintCalculation, 'id' | 'createdAt'> {
  const { userId, projectName, weightGrams, printTimeHours, settings } = params;

  // Consumo em kWh = (tempo_horas * potencia_watts) / 1000
  const kwhConsumed = Number(((printTimeHours * settings.printerPowerWatts) / 1000).toFixed(3));

  // Custo de material = (peso_gramas / 1000) * custo_por_kg
  const materialCost = Number(((weightGrams / 1000) * settings.filamentCostPerKg).toFixed(2));

  // Custo de energia = kWh_consumido * custo_kwh
  const energyCost = Number((kwhConsumed * settings.kwhCost).toFixed(2));

  // Custo de depreciação = tempo_horas * custo_depreciacao_hora
  const depreciationCost = Number((printTimeHours * settings.depreciationCostPerHour).toFixed(2));

  // Custo total
  const totalCost = Number((materialCost + energyCost + depreciationCost).toFixed(2));

  // Preços sugeridos com margem
  const priceProfit30 = Number((totalCost * 1.3).toFixed(2));
  const priceProfit50 = Number((totalCost * 1.5).toFixed(2));
  const priceProfit100 = Number((totalCost * 2.0).toFixed(2));

  return {
    userId,
    projectName,
    weightGrams,
    printTimeHours,
    kwhConsumed,
    materialCost,
    energyCost,
    depreciationCost,
    totalCost,
    priceProfit30,
    priceProfit50,
    priceProfit100,
  };
}
