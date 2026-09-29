export interface PrintSettings {
  userId: string;
  filamentCostPerKg: number;
  printerPowerWatts: number;
  kwhCost: number;
  depreciationCostPerHour: number;
  updatedAt: Date;
}

export interface PrintCalculation {
  id?: string;
  userId: string;
  projectName: string;
  weightGrams: number;
  printTimeHours: number;
  kwhConsumed: number;
  materialCost: number;
  energyCost: number;
  depreciationCost: number;
  totalCost: number;
  priceProfit30: number;
  priceProfit50: number;
  priceProfit100: number;
  createdAt?: Date;
}
