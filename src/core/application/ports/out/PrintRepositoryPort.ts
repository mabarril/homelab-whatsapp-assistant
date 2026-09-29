import { PrintCalculation, PrintSettings } from '../../../domain/entities/PrintCalculation.js';

export interface UpdatePrintSettingsData {
  filamentCostPerKg?: number;
  printerPowerWatts?: number;
  kwhCost?: number;
  depreciationCostPerHour?: number;
}

export interface PrintRepositoryPort {
  getSettings(userId: string): Promise<PrintSettings>;
  updateSettings(userId: string, data: UpdatePrintSettingsData): Promise<PrintSettings>;
  saveCalculation(calc: Omit<PrintCalculation, 'id' | 'createdAt'>): Promise<PrintCalculation>;
  getRecentCalculations(userId: string, limit?: number): Promise<PrintCalculation[]>;
}
